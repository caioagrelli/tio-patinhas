import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { secure, verifyPassword } from './auth';
import { billingEnabled, mercadoPago } from './billing';
import { Database } from './database';

const deleteInput = z.object({ confirmation: z.string(), password: z.string().max(128).optional() }).strict();

/** Account self-service required by the LGPD: the person can erase their account and data at any time. */
@Injectable()
export class AccountService {
  constructor(@Inject(Database) private readonly db: Database) {}

  /**
   * Deletes the account and, by cascade, all of its financial data, sessions and Crab AI chats.
   * Payments and AI usage stay without the person (see the Payment and AiUsage models) for bookkeeping.
   */
  async delete(userId: string, body: unknown, res: Response) {
    const input = deleteInput.safeParse(body);
    if (!input.success || input.data.confirmation.trim().toUpperCase() !== 'EXCLUIR')
      throw new BadRequestException('Digite EXCLUIR para confirmar.');
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.isAdmin) throw new BadRequestException('Administradores não podem excluir a própria conta por aqui.');
    // Accounts with a password confirm it again; Google-only accounts confirm by typing EXCLUIR.
    if (user.passwordHash && !(await verifyPassword(input.data.password ?? '', user.passwordHash)))
      throw new UnauthorizedException('Senha incorreta.');

    // Stop future charges first: if Mercado Pago refuses, nothing is deleted and the person can try again.
    const subscriptions = await this.db.payment.findMany({
      where: { userId, kind: 'subscription', status: 'authorized', providerId: { not: null } },
    });
    for (const subscription of subscriptions) {
      if (billingEnabled())
        await mercadoPago('/preapproval/' + subscription.providerId, { method: 'PUT', body: { status: 'cancelled' } });
      await this.db.payment.update({ where: { id: subscription.id }, data: { status: 'cancelled' } });
    }

    await this.db.user.delete({ where: { id: userId } });
    res.clearCookie('session', { path: '/', httpOnly: true, secure: secure(), sameSite: 'strict' });
    return { ok: true };
  }
}
