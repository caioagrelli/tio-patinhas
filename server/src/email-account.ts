import { BadRequestException, HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hashPassword, tokenHash, verifyPassword } from './auth';
import { Database } from './database';
import { emails, Mailer } from './mail';

type Kind = 'verify' | 'reset';
const LIFETIME: Record<Kind, number> = { verify: 48 * 3_600_000, reset: 3_600_000 };
/** Minimum time between two e-mails of the same kind to one account, so nobody can flood an inbox. */
const COOLDOWN = 2 * 60_000;
const password = z.string().min(10, 'Use pelo menos 10 caracteres.').max(128);
const forgotInput = z
  .object({ email: z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(254) })
  .strict();
const resetInput = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password }).strict();
const changeInput = z.object({ current: z.string().max(128).optional(), password }).strict();
const appUrl = (path: string) => new URL(path, process.env.APP_URL || 'http://localhost:5173').toString();
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** E-mail confirmation, password reset and password change. */
@Injectable()
export class EmailAccountService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Mailer) private readonly mailer: Mailer,
  ) {}

  /** Creates a single-use link token; only its hash is stored. Older unused tokens of the same kind stop working. */
  private async issue(userId: string, kind: Kind) {
    const token = randomBytes(32).toString('hex');
    await this.db.emailToken.updateMany({ where: { userId, kind, usedAt: null }, data: { usedAt: new Date() } });
    await this.db.emailToken.create({
      data: { userId, kind, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + LIFETIME[kind]) },
    });
    return token;
  }
  private async recentlySent(userId: string, kind: Kind) {
    const last = await this.db.emailToken.findFirst({ where: { userId, kind }, orderBy: { createdAt: 'desc' } });
    return Boolean(last && Date.now() - last.createdAt.getTime() < COOLDOWN);
  }
  /** Finds a valid token and marks it used in the same step, so a link works only once even with two clicks. */
  private async consume(token: string, kind: Kind) {
    const row = await this.db.emailToken.findUnique({ where: { tokenHash: tokenHash(token) } });
    if (!row || row.kind !== kind || row.usedAt || row.expiresAt <= new Date()) return null;
    const { count } = await this.db.emailToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count ? row.userId : null;
  }

  /** Sign-up with a password: welcome message with the confirmation link. */
  async welcome(user: { id: string; name: string; email: string }) {
    const token = await this.issue(user.id, 'verify');
    await this.mailer.send({
      to: user.email,
      ...emails.welcomeConfirm(firstName(user.name), appUrl('/api/auth/verify-email?token=' + token)),
    });
  }
  /** First Google sign-in: Google already verified the address, so it is only a welcome. */
  async welcomeGoogle(user: { name: string; email: string }) {
    await this.mailer.send({ to: user.email, ...emails.welcomeGoogle(firstName(user.name)) });
  }

  async resendConfirmation(userId: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.email) throw new BadRequestException('Sua conta não tem e-mail cadastrado.');
    if (user.emailVerifiedAt) throw new BadRequestException('Seu e-mail já está confirmado.');
    if (await this.recentlySent(userId, 'verify'))
      throw new HttpException('Acabamos de enviar um e-mail. Espere 2 minutos para pedir outro.', 429);
    const token = await this.issue(userId, 'verify');
    await this.mailer.send({
      to: user.email,
      ...emails.confirm(firstName(user.name), appUrl('/api/auth/verify-email?token=' + token)),
    });
    return { ok: true };
  }

  /** Link from the e-mail. Returns where to send the browser. */
  async confirm(token: unknown) {
    const userId =
      typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? await this.consume(token, 'verify') : null;
    if (!userId) return '/?erro=link';
    await this.db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    return '/?email=confirmado';
  }

  /** Always answers the same way, so the form cannot be used to find out which e-mails have accounts. */
  async forgot(body: unknown) {
    const input = forgotInput.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.issues[0].message);
    const user = await this.db.user.findFirst({
      where: { email: { equals: input.data.email, mode: 'insensitive' }, active: true },
    });
    if (user?.email && !(await this.recentlySent(user.id, 'reset'))) {
      if (user.passwordHash) {
        const token = await this.issue(user.id, 'reset');
        // The token goes in the URL fragment (#), which browsers never send to servers or in the Referer header.
        await this.mailer.send({
          to: user.email,
          ...emails.reset(firstName(user.name), appUrl('/#/redefinir-senha?token=' + token)),
        });
      } else {
        // Google-only accounts have no password to reset; recording the request keeps the same cooldown.
        await this.issue(user.id, 'reset');
        await this.mailer.send({ to: user.email, ...emails.resetGoogle(firstName(user.name)) });
      }
    }
    return { ok: true };
  }

  /** New password from the e-mail link. Ends every session; the caller starts a new one. */
  async reset(body: unknown) {
    const input = resetInput.safeParse(body);
    if (!input.success)
      throw new BadRequestException(
        input.error.issues.find(i => i.path[0] === 'password')?.message ?? 'Link inválido.',
      );
    const userId = await this.consume(input.data.token, 'reset');
    if (!userId)
      throw new BadRequestException('Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".');
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.active) throw new UnauthorizedException('Esta conta está desativada.');
    await this.db.$transaction([
      // Opening the link proves the inbox belongs to the person.
      this.db.user.update({
        where: { id: userId },
        data: {
          passwordHash: await hashPassword(input.data.password),
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      }),
      this.db.session.deleteMany({ where: { userId } }),
    ]);
    if (user.email) await this.mailer.send({ to: user.email, ...emails.passwordChanged(firstName(user.name)) });
    return userId;
  }

  /** Changes (or, for Google-only accounts, creates) the password; other sessions are closed. */
  async change(userId: string, currentSession: string, body: unknown) {
    const input = changeInput.safeParse(body);
    if (!input.success)
      throw new BadRequestException(
        input.error.issues.find(i => i.path[0] === 'password')?.message ?? 'Dados inválidos.',
      );
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.passwordHash && !(await verifyPassword(input.data.current ?? '', user.passwordHash)))
      throw new UnauthorizedException('Senha atual incorreta.');
    await this.db.$transaction([
      this.db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(input.data.password) } }),
      this.db.session.deleteMany({ where: { userId, NOT: { tokenHash: tokenHash(currentSession) } } }),
    ]);
    if (user.email) await this.mailer.send({ to: user.email, ...emails.passwordChanged(firstName(user.name)) });
    return { ok: true };
  }
}
