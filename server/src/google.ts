import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Request, Response } from 'express';
import { AuthService, secure } from './auth';
import { createDefaults } from './defaults';
import { Database } from './database';
import { EmailAccountService } from './email-account';
const authorizeUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenUrl = 'https://oauth2.googleapis.com/token';
const stateCookie = 'google_oauth';
const cookiePath = '/api/auth/google';
export const googleEnabled = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_URL);
const redirectUri = () => new URL('/api/auth/google/callback', process.env.APP_URL).toString();
const random = (bytes: number) => randomBytes(bytes).toString('base64url');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Codes are shown to the user by the login page; see loginErrors in web/src/main.tsx.
export class GoogleLoginError extends Error {
  constructor(readonly code: 'sessao' | 'cancelado' | 'google' | 'email' | 'inativo') {
    super(code);
  }
}
type Claims = {
  iss?: string;
  aud?: string;
  exp?: number;
  nonce?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
};
@Injectable()
export class GoogleAuth {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(EmailAccountService) private readonly emailAccount: EmailAccountService,
  ) {}
  /** Starts the authorization code flow with PKCE; state, verifier and nonce live in a short HttpOnly cookie. */
  start(res: Response): string {
    const state = random(32),
      verifier = random(32),
      nonce = random(16);
    // Lax, not Strict: the callback arrives as a top-level navigation from accounts.google.com.
    res.cookie(stateCookie, [state, verifier, nonce].join('.'), {
      httpOnly: true,
      secure: secure(),
      sameSite: 'lax',
      maxAge: 10 * 60_000,
      path: cookiePath,
    });
    const url = new URL(authorizeUrl);
    url.search = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }
  async callback(req: Request, res: Response) {
    const saved: unknown = req.cookies?.[stateCookie];
    res.clearCookie(stateCookie, { httpOnly: true, secure: secure(), sameSite: 'lax', path: cookiePath });
    if (req.query.error) throw new GoogleLoginError('cancelado');
    const [state, verifier, nonce] = typeof saved === 'string' ? saved.split('.') : [];
    const { code, state: returned } = req.query;
    if (
      !state ||
      !verifier ||
      !nonce ||
      typeof returned !== 'string' ||
      !same(returned, state) ||
      typeof code !== 'string' ||
      !code
    )
      throw new GoogleLoginError('sessao');
    const claims = await this.exchange(code, verifier);
    // The ID token comes straight from Google's token endpoint over TLS, so its claims are checked without a signature check (OIDC Core 3.1.3.7).
    if (
      !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss ?? '') ||
      claims.aud !== process.env.GOOGLE_CLIENT_ID ||
      !claims.exp ||
      claims.exp * 1000 < Date.now() ||
      claims.nonce !== nonce ||
      !claims.sub
    )
      throw new GoogleLoginError('google');
    if (claims.email_verified !== true || !claims.email) throw new GoogleLoginError('email');
    const user = await this.findOrCreate(claims.sub, claims.email, claims.name);
    if (!user.active) throw new GoogleLoginError('inativo');
    await this.auth.session(user.id, res);
  }
  private async exchange(code: string, verifier: string): Promise<Claims> {
    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({
          code,
          code_verifier: verifier,
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: redirectUri(),
          grant_type: 'authorization_code',
        }),
      });
      const { id_token } = (await response.json()) as { id_token?: string };
      if (!response.ok || typeof id_token !== 'string') throw new Error('token');
      return JSON.parse(Buffer.from(id_token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Claims;
    } catch {
      throw new GoogleLoginError('google');
    }
  }
  private async findOrCreate(googleId: string, email: string, name?: string) {
    const existing = await this.db.user.findUnique({ where: { googleId } });
    // Google only returns verified addresses (checked in callback), so the e-mail counts as confirmed.
    if (existing)
      return existing.email === email && existing.emailVerifiedAt
        ? existing
        : this.db.user.update({ where: { id: existing.id }, data: { email, emailVerifiedAt: new Date() } });
    try {
      const user = await this.db.$transaction(async tx => {
        const row = await tx.user.create({
          data: {
            googleId,
            email,
            emailVerifiedAt: new Date(),
            username: 'google:' + googleId,
            name: name?.trim().slice(0, 80) || email.split('@')[0],
          },
        });
        await createDefaults(tx, row.id);
        return row;
      });
      await this.emailAccount.welcomeGoogle({ name: user.name, email });
      return user;
    } catch {
      // Two simultaneous first logins: the other request created the account.
      return this.db.user.findUniqueOrThrow({ where: { googleId } });
    }
  }
}
