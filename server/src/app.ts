import 'reflect-metadata';
import { Body, Controller, Delete, Get, Inject, Module, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { APP_GUARD } from '@nestjs/core';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
@Controller('api/auth')
class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(Database) private readonly db: Database) {}
  @Post('register') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) { return this.auth.register(parse(registration, body), res); }
  @Post('login') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) { return this.auth.login(parse(loginInput, body), res); }
  @Post('logout') logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.auth.logout(req, res); }
  @Get('me') @UseGuards(AuthGuard)
  me(@Req() req: AuthRequest) { return this.db.user.findUniqueOrThrow({ where: { id: req.userId }, select: { id: true, username: true, name: true } }); }
}
@Controller('api') @UseGuards(AuthGuard)
class FinanceController {
  constructor(@Inject(FinanceService) private readonly finance: FinanceService) {}
  @Get('dashboard') dashboard(@Req() r: AuthRequest) { return this.finance.dashboard(r.userId); }
  @Get('catalog') catalog(@Req() r: AuthRequest) { return this.finance.catalog(r.userId); }
  @Post('settings/:resource') saveResource(@Req() r: AuthRequest, @Param('resource') resource: string, @Body() body: unknown) { return this.finance.saveResource(r.userId, resource, body); }
  @Patch('settings/:resource/:id') updateResource(@Req() r: AuthRequest, @Param('resource') resource: string, @Param('id') id: string, @Body() body: unknown) { return this.finance.saveResource(r.userId, resource, body, id); }
  @Delete('settings/:resource/:id') deleteResource(@Req() r: AuthRequest, @Param('resource') resource: string, @Param('id') id: string) { return this.finance.deleteResource(r.userId, resource, id); }
  @Get('transactions') transactions(@Req() r: AuthRequest, @Query() query: unknown) { return this.finance.transactions(r.userId, query); }
  @Post('transactions') createTransaction(@Req() r: AuthRequest, @Body() body: unknown) { return this.finance.createTransaction(r.userId, parse(transactionInput, body)); }
  @Patch('transactions/:id') updateTransaction(@Req() r: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.finance.updateTransaction(r.userId, id, parse(transactionInput, body)); }
  @Delete('transactions/:id') deleteTransaction(@Req() r: AuthRequest, @Param('id') id: string) { return this.finance.deleteTransaction(r.userId, id); }
  @Get('boxes') boxes(@Req() r: AuthRequest) { return this.finance.boxes(r.userId); }
  @Post('boxes') createBox(@Req() r: AuthRequest, @Body() body: unknown) { return this.finance.saveBox(r.userId, body); }
  @Patch('boxes/:id') updateBox(@Req() r: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.finance.saveBox(r.userId, body, id); }
  @Post('boxes/:id/movements') moveBox(@Req() r: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.finance.moveBox(r.userId, id, body); }
  @Post('boxes/:id/dismiss') dismissBox(@Req() r: AuthRequest, @Param('id') id: string) { return this.finance.dismissBox(r.userId, id); }
  @Delete('boxes/:id') deleteBox(@Req() r: AuthRequest, @Param('id') id: string) { return this.finance.deleteBox(r.userId, id); }
  @Get('recurrences') recurrences(@Req() r: AuthRequest) { return this.finance.recurrences(r.userId); }
  @Patch('recurrences/:id') updateRecurrence(@Req() r: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.finance.updateRecurrence(r.userId, id, body); }
  @Delete('recurrences/:id') deleteRecurrence(@Req() r: AuthRequest, @Param('id') id: string) { return this.finance.deleteRecurrence(r.userId, id); }
  @Get('plans') plans(@Req() r: AuthRequest) { return this.finance.plans(r.userId); }
  @Patch('plans/:id') updatePlan(@Req() r: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.finance.updatePlan(r.userId, id, body); }
  @Delete('plans/:id') deletePlan(@Req() r: AuthRequest, @Param('id') id: string) { return this.finance.deletePlan(r.userId, id); }
  @Get('reports') reports(@Req() r: AuthRequest, @Query() query: unknown) { return this.finance.reports(r.userId, query); }
}
@Controller('api/health')
class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get() async health() { await this.db.$queryRaw`SELECT 1`; return { status: 'ok' }; }
}
@Module({ imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }])], controllers: [AuthController, FinanceController, HealthController], providers: [Database, AuthService, AuthGuard, FinanceService, { provide: APP_GUARD, useClass: ThrottlerGuard }] })
export class AppModule {}
export async function createApp(logging = true) {
  const app = await NestFactory.create(AppModule, { logger: logging ? ['error', 'warn', 'log'] : false });
  app.enableShutdownHooks();
  const server = app.getHttpAdapter().getInstance() as express.Express;
  server.disable('x-powered-by');
  server.set('json replacer', (_key: string, value: unknown) => typeof value === 'bigint' ? Number(value) : value);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], upgradeInsecureRequests: process.env.COOKIE_SECURE === 'true' ? [] : null } } }));
  app.use(cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        // Custom header plus no CORS prevents cross-site form/fetch CSRF, including login.
        if (req.headers['x-requested-with'] !== 'TioPatinhas' || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ message: 'Origem da requisição inválida.' });
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
