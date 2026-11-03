import 'reflect-metadata';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { APP_GUARD } from '@nestjs/core';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Request, Response, NextFunction } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loginInput, registration, transactionInput } from '../../shared/schemas';
import { Database } from './database';
import { AuthGuard, AuthRequest, AuthService } from './auth';
import { FinanceService, parse } from './finance';
import { GoogleAuth, GoogleLoginError, googleEnabled } from './google';
import { turnstileSiteKey, verifyTurnstile } from './turnstile';
import { BillingService, PaidGuard } from './billing';
import { AdminGuard, AdminService } from './admin';
import { CrabAiService, crabAiEnabled } from './crab-ai';
import { AccountService } from './account';
import { EmailAccountService } from './email-account';
import { Mailer } from './mail';
@Controller('api/auth')
class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(GoogleAuth) private readonly googleAuth: GoogleAuth,
    @Inject(Database) private readonly db: Database,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(EmailAccountService) private readonly emailAccount: EmailAccountService,
  ) {}
  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async register(@Req() req: Request, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = parse(registration, body);
    await verifyTurnstile(req.headers['x-turnstile-token']);
    const user = await this.auth.register(input, res);
    await this.emailAccount.welcome({ id: user.id, name: user.name, email: input.email });
    return user;
  }
  @Get('verify-email')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async verifyEmail(@Query('token') token: unknown, @Res() res: Response) {
    res.redirect(await this.emailAccount.confirm(token));
  }
  @Post('verify-email/resend')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resendConfirmation(@Req() req: AuthRequest) {
    return this.emailAccount.resendConfirmation(req.userId);
  }
  @Post('password/forgot')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(@Req() req: Request, @Body() body: unknown) {
    await verifyTurnstile(req.headers['x-turnstile-token']);
    return this.emailAccount.forgot(body);
  }
  @Post('password/reset')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async resetPassword(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const userId = await this.emailAccount.reset(body);
    // The new password works right away: the person lands logged in.
    await this.auth.session(userId, res);
    return { ok: true };
  }
  @Post('username')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  chooseUsername(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.auth.chooseUsername(req.userId, body);
  }
  @Post('password')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  changePassword(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.emailAccount.change(req.userId, String(req.cookies.session), body);
  }
  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Req() req: Request, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = parse(loginInput, body);
    await verifyTurnstile(req.headers['x-turnstile-token']);
    return this.auth.login(input, res);
  }
  @Get('config') config() {
    return { google: googleEnabled(), turnstileSiteKey: turnstileSiteKey() };
  }
  @Get('google')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async googleStart(@Query('captcha') captcha: unknown, @Res() res: Response) {
    if (!googleEnabled()) return res.redirect('/?erro=indisponivel');
    try {
      await verifyTurnstile(captcha);
    } catch {
      return res.redirect('/?erro=captcha');
    }
    res.redirect(this.googleAuth.start(res));
  }
  @Get('google/callback')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    if (!googleEnabled()) return res.redirect('/?erro=indisponivel');
    try {
      await this.googleAuth.callback(req, res);
      res.redirect('/');
    } catch (err) {
      if (!(err instanceof GoogleLoginError)) console.error(err);
      res.redirect('/?erro=' + (err instanceof GoogleLoginError ? err.code : 'google'));
    }
  }
  @Post('logout') logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout(req, res);
  }
  @Delete('account')
  @UseGuards(AuthGuard)
  // Same limit as the login: it also checks the password.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  deleteAccount(@Req() req: AuthRequest, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    return this.account.delete(req.userId, body, res);
  }
  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: AuthRequest) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: req.userId },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        emailVerifiedAt: true,
        createdAt: true,
        isAdmin: true,
        passwordHash: true,
      },
    });
    const { passwordHash, emailVerifiedAt, ...profile } = user;
    // Only whether a password exists (Google-only accounts have none), never the hash itself.
    return {
      ...profile,
      hasPassword: passwordHash !== null,
      // Google sign-ups still on the placeholder username are asked to pick one.
      needsUsername: profile.username.startsWith('google:'),
      emailVerified: emailVerifiedAt !== null,
      access: await this.billing.access(req.userId),
    };
  }
}
@Controller('api/admin')
@UseGuards(AuthGuard, AdminGuard)
class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}
  @Get('overview') overview() {
    return this.admin.overview();
  }
  @Get('users') users(@Query() query: { q?: unknown; status?: unknown }) {
    return this.admin.users(query);
  }
  @Get('users/:id') user(@Param('id') id: string) {
    return this.admin.user(id);
  }
  @Patch('users/:id') update(@Req() r: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.admin.update(r.userId, id, body);
  }
  @Post('users/:id/adjust') adjust(@Param('id') id: string, @Body() body: unknown) {
    return this.admin.adjust(id, body);
  }
  @Post('users/:id/end-access') endAccess(@Param('id') id: string) {
    return this.admin.endAccess(id);
  }
  @Post('users/:id/cancel-subscription') cancelSubscription(@Param('id') id: string) {
    return this.admin.cancelSubscription(id);
  }
}
@Controller('api/ai')
@UseGuards(AuthGuard, PaidGuard)
class CrabAiController {
  constructor(@Inject(CrabAiService) private readonly ai: CrabAiService) {}
  @Get('status') status() {
    return { enabled: crabAiEnabled() };
  }
  @Get('usage') usage(@Req() r: AuthRequest) {
    return this.ai.usage(r.userId);
  }
  @Get('conversations') conversations(@Req() r: AuthRequest) {
    return this.ai.conversations(r.userId);
  }
  @Get('search') search(@Req() r: AuthRequest, @Query('q') q: unknown) {
    return this.ai.search(r.userId, q);
  }
  @Patch('conversations/:id') updateConversation(
    @Req() r: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.ai.updateConversation(r.userId, id, body);
  }
  @Get('artifacts') artifacts(@Req() r: AuthRequest) {
    return this.ai.artifacts(r.userId);
  }
  @Patch('messages/:id') saveMessage(@Req() r: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.ai.saveMessage(r.userId, id, body);
  }
  @Get('conversations/:id') conversation(@Req() r: AuthRequest, @Param('id') id: string) {
    return this.ai.conversation(r.userId, id);
  }
  @Delete('conversations/:id') deleteConversation(@Req() r: AuthRequest, @Param('id') id: string) {
    return this.ai.deleteConversation(r.userId, id);
  }
  @Post('chat')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async chat(@Req() req: AuthRequest, @Body() body: unknown, @Res() res: Response) {
    if (!crabAiEnabled()) {
      res.status(503).json({ message: 'O Crab AI ainda não foi configurado neste servidor.' });
      return;
    }
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    await this.ai.chat(req.userId, body, res, abort.signal);
  }
}
@Controller('api/billing')
class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}
  @Get('status') @UseGuards(AuthGuard) status(@Req() r: AuthRequest) {
    return this.billing.access(r.userId);
  }
  @Post('checkout')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  checkout(@Req() r: AuthRequest, @Body() body: unknown) {
    return this.billing.checkout(r.userId, body);
  }
  @Post('cancel') @UseGuards(AuthGuard) cancel(@Req() r: AuthRequest) {
    return this.billing.cancel(r.userId);
  }
  // Mercado Pago sends the buyer back here (no session cookie: the redirect comes from another site).
  @Get('retorno') async returned(@Query('ref') ref: unknown, @Res() res: Response) {
    res.redirect(await this.billing.returned(ref));
  }
  @Post('webhook') @HttpCode(200) webhook(@Req() req: Request) {
    return this.billing.webhook(req);
  }
}
@Controller('api')
@UseGuards(AuthGuard, PaidGuard)
class FinanceController {
  constructor(@Inject(FinanceService) private readonly finance: FinanceService) {}
  @Get('dashboard') dashboard(@Req() r: AuthRequest) {
    return this.finance.dashboard(r.userId);
  }
  @Get('catalog') catalog(@Req() r: AuthRequest) {
    return this.finance.catalog(r.userId);
  }
  @Get('finance') financePage(@Req() r: AuthRequest) {
    return this.finance.finance(r.userId);
  }
  @Get('cards') cards(@Req() r: AuthRequest) {
    return this.finance.cards(r.userId);
  }
  @Post('settings/:resource') saveResource(
    @Req() r: AuthRequest,
    @Param('resource') resource: string,
    @Body() body: unknown,
  ) {
    return this.finance.saveResource(r.userId, resource, body);
  }
  @Patch('settings/:resource/:id') updateResource(
    @Req() r: AuthRequest,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.finance.saveResource(r.userId, resource, body, id);
  }
  @Delete('settings/:resource/:id') deleteResource(
    @Req() r: AuthRequest,
    @Param('resource') resource: string,
    @Param('id') id: string,
  ) {
    return this.finance.deleteResource(r.userId, resource, id);
  }
  @Get('transactions') transactions(@Req() r: AuthRequest, @Query() query: unknown) {
    return this.finance.transactions(r.userId, query);
  }
  @Get('transactions/:id') transaction(@Req() r: AuthRequest, @Param('id') id: string) {
    return this.finance.transaction(r.userId, id);
  }
  @Post('transactions') createTransaction(@Req() r: AuthRequest, @Body() body: unknown) {
    return this.finance.createTransaction(r.userId, parse(transactionInput, body));
  }
  @Patch('transactions/:id') updateTransaction(@Req() r: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.finance.updateTransaction(r.userId, id, parse(transactionInput, body));
  }
  @Delete('transactions/:id') deleteTransaction(@Req() r: AuthRequest, @Param('id') id: string) {
    return this.finance.deleteTransaction(r.userId, id);
  }
  @Get('boxes') boxes(@Req() r: AuthRequest) {
    return this.finance.boxes(r.userId);
  }
  @Post('boxes') createBox(@Req() r: AuthRequest, @Body() body: unknown) {
    return this.finance.saveBox(r.userId, body);
  }
  @Patch('boxes/:id') updateBox(@Req() r: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.finance.saveBox(r.userId, body, id);
  }
  @Post('boxes/:id/movements') moveBox(@Req() r: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.finance.moveBox(r.userId, id, body);
  }
  @Post('boxes/:id/dismiss') dismissBox(@Req() r: AuthRequest, @Param('id') id: string) {
    return this.finance.dismissBox(r.userId, id);
  }
  @Delete('boxes/:id') deleteBox(@Req() r: AuthRequest, @Param('id') id: string) {
    return this.finance.deleteBox(r.userId, id);
  }
  @Get('recurrences') recurrences(@Req() r: AuthRequest) {
    return this.finance.recurrences(r.userId);
  }
  @Patch('recurrences/:id') updateRecurrence(@Req() r: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.finance.updateRecurrence(r.userId, id, body);
  }
  @Delete('recurrences/:id') deleteRecurrence(@Req() r: AuthRequest, @Param('id') id: string) {
    return this.finance.deleteRecurrence(r.userId, id);
  }
  @Get('plans') plans(@Req() r: AuthRequest) {
    return this.finance.plans(r.userId);
  }
  @Patch('plans/:id') updatePlan(@Req() r: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.finance.updatePlan(r.userId, id, body);
  }
  @Delete('plans/:id') deletePlan(@Req() r: AuthRequest, @Param('id') id: string) {
    return this.finance.deletePlan(r.userId, id);
  }
  @Get('reports') reports(@Req() r: AuthRequest, @Query() query: unknown) {
    return this.finance.reports(r.userId, query);
  }
}
@Controller('api/health')
class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get() async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}
@Module({
  imports: [
    // With several app servers the attempt counters must be shared, so they live in Redis when REDIS_URL is set.
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ ttl: 60_000, limit: 600 }],
        storage: process.env.REDIS_URL ? new ThrottlerStorageRedisService(process.env.REDIS_URL) : undefined,
      }),
    }),
  ],
  controllers: [
    AuthController,
    AdminController,
    CrabAiController,
    BillingController,
    FinanceController,
    HealthController,
  ],
  providers: [
    Database,
    AuthService,
    AccountService,
    EmailAccountService,
    Mailer,
    GoogleAuth,
    CrabAiService,
    BillingService,
    PaidGuard,
    AdminService,
    AdminGuard,
    AuthGuard,
    FinanceService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
const turnstile = 'https://challenges.cloudflare.com';
export async function createApp(logging = true) {
  const app = await NestFactory.create(AppModule, { logger: logging ? ['error', 'warn', 'log'] : false });
  app.enableShutdownHooks();
  const server = app.getHttpAdapter().getInstance() as express.Express;
  server.disable('x-powered-by');
  // Behind the HTTPS proxy, rate limits must count the visitor's address, not the proxy's (TRUST_PROXY = number of proxy hops).
  const proxyHops = Number(process.env.TRUST_PROXY || 0);
  if (proxyHops > 0) server.set('trust proxy', proxyHops);
  server.set('json replacer', (_key: string, value: unknown) => (typeof value === 'bigint' ? Number(value) : value));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", turnstile],
          frameSrc: [turnstile],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          upgradeInsecureRequests: process.env.COOKIE_SECURE === 'true' ? [] : null,
        },
      },
    }),
  );
  app.use(cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store');
      // Mercado Pago's server calls the webhook directly; it is verified by signature and by reading the status back from the API.
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.path !== '/api/billing/webhook') {
        // Custom header plus no CORS prevents cross-site form/fetch CSRF, including login.
        if (req.headers['x-requested-with'] !== 'CrabFinance' || req.headers['sec-fetch-site'] === 'cross-site')
          return res.status(403).json({ message: 'Origem da requisição inválida.' });
      }
    }
    next();
  });
  const publicDir = resolve(process.env.WEB_ROOT || 'web-dist');
  if (existsSync(resolve(publicDir, 'index.html'))) {
    app.use(express.static(publicDir));
    server.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(resolve(publicDir, 'index.html')));
  }
  await app.init();
  return app;
}
