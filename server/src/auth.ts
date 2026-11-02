import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { Database } from './database';
import { createDefaults } from './defaults';
export { createDefaults };
const scrypt = promisify(scryptCallback);
export type AuthRequest = Request & { userId: string };
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const secure = () => process.env.COOKIE_SECURE === 'true';
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const parts = hash.split('$');
    if (parts[0] === 'scrypt') {
      const key = (await scrypt(password, parts[1], 64)) as Buffer;
      const expected = Buffer.from(parts[2], 'hex');
      return key.length === expected.length && timingSafeEqual(key, expected);
    }
    return false;
  } catch {
    return false;
  }
}
@Injectable()
export class AuthService {
  constructor(@Inject(Database) private readonly db: Database) {}
  async register(input: { username: string; password: string; name?: string; email: string }, res: Response) {
    if (await this.db.user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' } } }))
      throw new BadRequestException('Este e-mail já está cadastrado.');
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await this.db.$transaction(async tx => {
        const user = await tx.user.create({
          data: {
            username: input.username.toLowerCase(),
            name: input.name || input.username,
            email: input.email,
            passwordHash,
          },
        });
        await createDefaults(tx, user.id);
        return user;
      });
      await this.session(user.id, res);
      return { id: user.id, username: user.username, name: user.name, createdAt: user.createdAt };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw new BadRequestException('Este usuário já existe.');
      throw err;
    }
  }
  async login(input: { username: string; password: string }, res: Response) {
    const user = await this.db.user.findUnique({ where: { username: input.username.toLowerCase() } });
    // Perform the same costly derivation for nonexistent usernames.
    const fallback = 'scrypt$00000000000000000000000000000000$' + '00'.repeat(64);
    const valid = await verifyPassword(input.password, user?.passwordHash ?? fallback);
    if (!user || !user.active || !valid) throw new UnauthorizedException('Usuário ou senha inválidos.');
    await this.session(user.id, res);
    return { id: user.id, username: user.username, name: user.name, createdAt: user.createdAt };
  }
  async session(userId: string, res: Response) {
    const token = randomBytes(32).toString('hex');
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    await this.db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await this.db.session.create({
      data: { userId, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + maxAge) },
    });
    res.cookie('session', token, { httpOnly: true, secure: secure(), sameSite: 'strict', maxAge, path: '/' });
  }
  async logout(req: Request, res: Response) {
    if (typeof req.cookies.session === 'string')
      await this.db.session.deleteMany({ where: { tokenHash: tokenHash(req.cookies.session) } });
    res.clearCookie('session', { path: '/', httpOnly: true, secure: secure(), sameSite: 'strict' });
    return { ok: true };
  }
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Database) private readonly db: Database) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token: unknown = req.cookies?.session;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException();
    const session = await this.db.session.findUnique({ where: { tokenHash: tokenHash(token) } });
    if (!session || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
    req.userId = session.userId;
    return true;
  }
}
