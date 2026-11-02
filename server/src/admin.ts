import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { z } from 'zod';
import { isPlan, type PlanId } from '../../shared/plans';
import type { AuthRequest } from './auth';
import { accessOf, billingEnabled, mercadoPago } from './billing';
import { Database } from './database';

/** Only accounts marked as administrators reach the admin API. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(Database) private readonly db: Database) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const user = await this.db.user.findUnique({ where: { id: req.userId }, select: { isAdmin: true } });
    if (!user?.isAdmin) throw new ForbiddenException('Acesso restrito a administradores.');
    return true;
  }
}

// Revenue counts only payments confirmed by Mercado Pago (orders, first subscription charge, renewals).
const SALES = ['order', 'subscription', 'renewal'];
const userInput = z
  .object({
    plan: z.string().refine(isPlan).nullable().optional(),
    planExpiresAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    active: z.boolean().optional(),
  })
  .strict();
const adjustInput = z
  .object({
    days: z
      .number()
      .int()
      .min(-3650)
      .max(3650)
      .refine(d => d !== 0),
  })
  .strict();
const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

@Injectable()
export class AdminService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async overview() {
    const users = await this.db.user.findMany({
      select: { id: true, createdAt: true, plan: true, planExpiresAt: true, active: true },
    });
    const sales = await this.db.payment.findMany({
      where: { kind: { in: SALES }, appliedAt: { not: null } },
      include: { user: { select: { id: true, name: true, username: true } } },
      orderBy: { appliedAt: 'desc' },
    });
    const month = startOfMonth();
    const sum = (list: { amount: bigint }[]) => list.reduce((s, p) => s + p.amount, 0n);
    const accesses = users.map(u => accessOf(u));
    const monthSales = sales.filter(p => p.appliedAt! >= month);
    return {
      users: {
        total: users.length,
        teste: accesses.filter(a => a.status === 'teste').length,
        pago: accesses.filter(a => a.status === 'pago').length,
        expirado: accesses.filter(a => a.status === 'expirado').length,
        inactive: users.filter(u => !u.active).length,
        newThisMonth: users.filter(u => u.createdAt >= month).length,
      },
      revenue: {
        total: sum(sales),
        month: sum(monthSales),
        salesTotal: sales.length,
        salesMonth: monthSales.length,
        pendingCheckouts: await this.db.payment.count({
          where: {
            appliedAt: null,
            kind: { in: ['order', 'subscription'] },
            status: { notIn: ['cancelled', 'rejected', 'expired'] },
          },
        }),
      },
      plans: (['mensal', 'anual', 'vitalicio'] as PlanId[]).map(plan => {
        const ofPlan = sales.filter(p => p.plan === plan);
        return {
          plan,
          active: accesses.filter(a => a.status === 'pago' && a.plan === plan).length,
          sales: ofPlan.length,
          revenue: sum(ofPlan),
        };
      }),
      recent: sales
        .slice(0, 15)
        .map(p => ({ id: p.id, plan: p.plan, kind: p.kind, amount: p.amount, appliedAt: p.appliedAt, user: p.user })),
    };
  }

  async users(query: { q?: unknown; status?: unknown }) {
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 80) : '';
    const rows = await this.db.user.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { username: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {},
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        createdAt: true,
        plan: true,
        planExpiresAt: true,
        active: true,
        isAdmin: true,
        googleId: true,
        _count: { select: { transactions: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const list = rows.map(({ _count, googleId, ...u }) => ({
      ...u,
      google: Boolean(googleId),
      transactions: _count.transactions,
      access: accessOf(u),
    }));
    return typeof query.status === 'string' && query.status ? list.filter(u => u.access.status === query.status) : list;
  }

  async user(id: string) {
    const user = await this.db.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        createdAt: true,
        plan: true,
        planExpiresAt: true,
        active: true,
        isAdmin: true,
        balance: true,
        _count: { select: { transactions: true, boxes: true } },
        payments: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    const subscription = user.payments.find(p => p.kind === 'subscription' && p.status === 'authorized');
    return { ...user, access: accessOf(user), hasSubscription: Boolean(subscription) };
  }

  /** Sets plan, expiry and the account's active flag by hand. */
  async update(adminId: string, id: string, body: unknown) {
    const input = userInput.safeParse(body);
    if (!input.success) throw new BadRequestException('Dados inválidos.');
    const { plan, planExpiresAt, active } = input.data;
    if (active === false && id === adminId) throw new BadRequestException('Você não pode desativar a própria conta.');
    const data: { plan?: string | null; planExpiresAt?: Date | null; active?: boolean } = {};
    if (plan !== undefined) {
      if (plan === null || plan === 'vitalicio') Object.assign(data, { plan, planExpiresAt: null });
      else {
        if (!planExpiresAt) throw new BadRequestException('Informe até quando vale o plano.');
        Object.assign(data, { plan, planExpiresAt: new Date(planExpiresAt + 'T23:59:59') });
      }
    }
    if (active !== undefined) data.active = active;
    await this.db.user.update({ where: { id }, data }).catch(() => {
      throw new NotFoundException('Usuário não encontrado.');
    });
    if (active === false) await this.db.session.deleteMany({ where: { userId: id } });
    return this.user(id);
  }

  /** Adds or removes days from a monthly or annual plan; going into the past ends access. */
  async adjust(id: string, body: unknown) {
    const input = adjustInput.safeParse(body);
    if (!input.success) throw new BadRequestException('Informe um número de dias válido.');
    const user = await this.db.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    if (!user.plan || user.plan === 'vitalicio')
      throw new BadRequestException(
        user.plan ? 'O plano vitalício não tem validade.' : 'Defina um plano antes de ajustar a validade.',
      );
    const now = new Date(),
      base = user.planExpiresAt && user.planExpiresAt > now ? user.planExpiresAt : now;
    await this.db.user.update({
      where: { id },
      data: { planExpiresAt: new Date(base.getTime() + input.data.days * 86_400_000) },
    });
    return this.user(id);
  }

  /** Ends paid access now; the account goes back to its trial if still within the first month. */
  async endAccess(id: string) {
    await this.db.user.update({ where: { id }, data: { planExpiresAt: new Date() } }).catch(() => {
      throw new NotFoundException('Usuário não encontrado.');
    });
    const user = await this.db.user.findUniqueOrThrow({ where: { id } });
    if (user.plan === 'vitalicio')
      await this.db.user.update({ where: { id }, data: { plan: null, planExpiresAt: null } });
    return this.user(id);
  }

  /** Stops the monthly subscription at Mercado Pago (no more charges); access lasts until the paid period ends. */
  async cancelSubscription(id: string) {
    const subscription = await this.db.payment.findFirst({
      where: { userId: id, kind: 'subscription', status: 'authorized' },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription?.providerId) throw new BadRequestException('Esse usuário não tem assinatura mensal ativa.');
    if (billingEnabled())
      await mercadoPago('/preapproval/' + subscription.providerId, { method: 'PUT', body: { status: 'cancelled' } });
    await this.db.payment.update({ where: { id: subscription.id }, data: { status: 'cancelled' } });
    return this.user(id);
  }
}
