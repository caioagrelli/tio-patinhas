import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import { isPlan, planName, planPrice, type Access, type PlanId } from '../../shared/plans';
import type { AuthRequest } from './auth';
import { Database } from './database';
import { mailEnabled } from './mail';

const api = 'https://api.mercadopago.com';
export const billingEnabled = () => Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN && process.env.APP_URL);
const appUrl = (path: string) => new URL(path, process.env.APP_URL).toString();
const reais = (cents: number) => (cents / 100).toFixed(2);
const addMonths = (date: Date, months: number) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
};

/** Calls the Mercado Pago API; errors become a 503 with Mercado Pago's message in the server log. */
export async function mercadoPago<T>(
  path: string,
  init: { method?: string; body?: unknown; idempotency?: string } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(api + path, {
      method: init.method ?? 'GET',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        ...(init.idempotency ? { 'X-Idempotency-Key': init.idempotency } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ServiceUnavailableException('Não foi possível falar com o Mercado Pago. Tente novamente.');
  }
  const data = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) {
    console.error('Mercado Pago', init.method ?? 'GET', path, response.status, JSON.stringify(data));
    // Subscriptions must return to a public https address; localhost is refused.
    if (/back_url/i.test(data.message ?? ''))
      throw new BadRequestException(
        'A assinatura mensal só funciona com o site publicado num endereço https: o Mercado Pago não aceita voltar para localhost.',
      );
    // Test credentials only accept Mercado Pago test buyers as payers.
    if (/test users/i.test(data.message ?? ''))
      throw new BadRequestException('Modo de teste: use o e-mail de um comprador de teste do Mercado Pago.');
    if (/different site/i.test(data.message ?? ''))
      throw new BadRequestException(
        'Esse e-mail pertence a uma conta do Mercado Pago de outro país. Use outro e-mail.',
      );
    throw new ServiceUnavailableException('O Mercado Pago recusou a operação. Tente novamente em instantes.');
  }
  return data;
}

type User = { id: string; createdAt: Date; plan: string | null; planExpiresAt: Date | null };
/** Free trial of one month from account creation, then a paid plan is required. */
export function accessOf(user: User, now = new Date()): Access {
  const trialEnds = addMonths(user.createdAt, 1);
  const paid = isPlan(user.plan) && (user.planExpiresAt === null || user.planExpiresAt > now);
  const end = paid ? user.planExpiresAt : trialEnds;
  return {
    status: paid ? 'pago' : now < trialEnds ? 'teste' : 'expirado',
    plan: paid ? (user.plan as PlanId) : null,
    planExpiresAt: user.planExpiresAt?.toISOString() ?? null,
    trialEndsAt: trialEnds.toISOString(),
    daysLeft: end ? Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000)) : 0,
    canCancel: false,
  };
}

const checkoutInput = z
  .object({
    plan: z.string().refine(isPlan, 'Plano inválido.'),
    email: z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(254).optional(),
  })
  .strict();
type Order = { id: string; status: string; status_detail?: string; checkout_url?: string };
type Subscription = { id: string; status: string; init_point?: string };

@Injectable()
export class BillingService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async access(userId: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const access = accessOf(user);
    const subscription = await this.db.payment.findFirst({
      where: { userId, kind: 'subscription', status: 'authorized' },
    });
    return { ...access, canCancel: access.plan === 'mensal' && Boolean(subscription) };
  }

  /** Starts a checkout: an order for the annual and lifetime plans, a subscription for the monthly one. Returns the URL to pay. */
  async checkout(userId: string, body: unknown) {
    if (!billingEnabled()) throw new ServiceUnavailableException('Pagamentos ainda não configurados neste servidor.');
    const parsed = checkoutInput.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    const plan = parsed.data.plan as PlanId;
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    // The receipt always goes to the account's e-mail; accounts without one save the informed e-mail first.
    const email = user.email ?? parsed.data.email;
    if (!email) throw new BadRequestException('Informe o e-mail da conta para receber o recibo.');
    if (user.plan === 'vitalicio') throw new BadRequestException('Sua conta já tem o plano vitalício.');
    // The receipt goes to the account's e-mail: when e-mails are on, it must be confirmed first.
    if (mailEnabled() && user.email && !user.emailVerifiedAt)
      throw new BadRequestException('Confirme seu e-mail antes de assinar: o recibo vai para ele.');
    const reference = `${plan}-${randomUUID()}`,
      amount = planPrice[plan],
      title = `CRAB FINANCE - Plano ${planName[plan]}`;
    const back = appUrl('/api/billing/retorno?ref=' + reference);
    if (!user.email) await this.db.user.update({ where: { id: userId }, data: { email } });
    if (plan === 'mensal') {
      const sub = await mercadoPago<Subscription>('/preapproval', {
        method: 'POST',
        body: {
          reason: title,
          external_reference: reference,
          payer_email: email,
          back_url: back,
          status: 'pending',
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: amount / 100,
            currency_id: 'BRL',
          },
        },
      });
      await this.db.payment.create({
        data: {
          userId,
          plan,
          kind: 'subscription',
          reference,
          providerId: sub.id,
          amount: BigInt(amount),
          status: sub.status,
        },
      });
      return { url: sub.init_point };
    }
    const order = await mercadoPago<Order>('/v1/orders', {
      method: 'POST',
      idempotency: reference,
      body: {
        type: 'online',
        processing_mode: 'manual',
        total_amount: reais(amount),
        external_reference: reference,
        description: title,
        payer: { email },
        config: {
          online: { success_url: back, failure_url: back, pending_url: back, auto_return: 'approved' },
          payment_method: { max_installments: 12 },
        },
        items: [{ title, quantity: 1, unit_price: reais(amount), external_code: plan }],
      },
    });
    await this.db.payment.create({
      data: {
        userId,
        plan,
        kind: 'order',
        reference,
        providerId: order.id,
        amount: BigInt(amount),
        status: order.status,
      },
    });
    return { url: order.checkout_url };
  }

  /** Reads the payment's real status from Mercado Pago (never from the redirect or notification body) and applies the plan once. */
  async sync(paymentId: string) {
    const payment = await this.db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (!payment.providerId) return payment;
    let status: string, paid: boolean;
    if (payment.kind === 'subscription') {
      ({ status } = await mercadoPago<Subscription>('/preapproval/' + payment.providerId));
      paid = status === 'authorized';
    } else {
      const order = await mercadoPago<Order>('/v1/orders/' + payment.providerId);
      status = order.status;
      paid = order.status === 'processed';
    }
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${payment.id} FOR UPDATE`;
      const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      // A payment of a deleted account only records its status: there is nobody to give the plan to.
      if (!paid || current.appliedAt || !payment.userId)
        return tx.payment.update({ where: { id: payment.id }, data: { status } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: payment.userId } });
      if (user.plan !== 'vitalicio') {
        const now = new Date(),
          from = user.planExpiresAt && user.planExpiresAt > now ? user.planExpiresAt : now;
        const data =
          payment.plan === 'vitalicio'
            ? { plan: 'vitalicio', planExpiresAt: null }
            : { plan: payment.plan, planExpiresAt: addMonths(from, payment.plan === 'anual' ? 12 : 1) };
        await tx.user.update({ where: { id: user.id }, data });
      }
      return tx.payment.update({ where: { id: payment.id }, data: { status, appliedAt: new Date() } });
    });
  }

  /** Where Mercado Pago sends the buyer back; confirms the payment and opens the result page. */
  async returned(reference: unknown) {
    const payment = typeof reference === 'string' ? await this.db.payment.findUnique({ where: { reference } }) : null;
    if (!payment) return appUrl('/#/planos/resultado?status=erro');
    const synced = await this.sync(payment.id).catch(() => payment);
    const status = synced.appliedAt
      ? 'aprovado'
      : ['rejected', 'cancelled', 'canceled', 'failed', 'expired'].includes(synced.status)
        ? 'recusado'
        : 'pendente';
    return appUrl(`/#/planos/resultado?status=${status}&plano=${payment.plan}`);
  }

  /** Validates Mercado Pago's x-signature (HMAC-SHA256 over id, request id and timestamp) when a webhook secret is configured. */
  verifySignature(req: Request) {
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    // Without a secret only development accepts notifications; payments are still confirmed by reading them back from the API.
    if (!secret) return process.env.NODE_ENV !== 'production';
    const header = String(req.headers['x-signature'] ?? ''),
      requestId = String(req.headers['x-request-id'] ?? '');
    const parts = Object.fromEntries(header.split(',').map(p => p.trim().split('=') as [string, string]));
    const id = String(req.query['data.id'] ?? (req.body as { data?: { id?: string } })?.data?.id ?? '').toLowerCase();
    if (!parts.ts || !parts.v1) return false;
    const manifest = (id ? `id:${id};` : '') + (requestId ? `request-id:${requestId};` : '') + `ts:${parts.ts};`;
    const expected = createHmac('sha256', secret).update(manifest).digest('hex');
    return expected.length === parts.v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  }

  /** Mercado Pago notifications: orders, subscriptions and monthly renewals. Unknown or foreign ids are ignored. */
  async webhook(req: Request) {
    if (!billingEnabled()) return { ok: true };
    if (!this.verifySignature(req)) throw new HttpException('Assinatura inválida.', 401);
    const body = (req.body ?? {}) as { type?: string; data?: { id?: string } };
    const type = String(body.type ?? req.query.type ?? req.query.topic ?? ''),
      id = String(body.data?.id ?? req.query['data.id'] ?? req.query.id ?? '');
    if (!id) return { ok: true };
    if (type === 'order' || type === 'subscription_preapproval') {
      const payment = await this.db.payment.findUnique({ where: { providerId: id } });
      if (payment) await this.sync(payment.id);
    } else if (type === 'subscription_authorized_payment') {
      const charge = await mercadoPago<{
        id: number;
        preapproval_id: string;
        status: string;
        payment?: { status?: string };
      }>('/authorized_payments/' + id);
      const subscription = await this.db.payment.findUnique({ where: { providerId: charge.preapproval_id } });
      if (subscription?.userId && charge.payment?.status === 'approved')
        await this.renew(subscription.userId, `renovacao-${charge.id}`);
    }
    return { ok: true };
  }

  /** A monthly charge was approved: extend the plan by one month, once per charge. */
  private async renew(userId: string, reference: string) {
    await this.db.$transaction(async tx => {
      if (await tx.payment.findUnique({ where: { reference } })) return;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.plan === 'vitalicio') return;
      const now = new Date(),
        from = user.planExpiresAt && user.planExpiresAt > now ? user.planExpiresAt : now;
      await tx.user.update({ where: { id: userId }, data: { plan: 'mensal', planExpiresAt: addMonths(from, 1) } });
      await tx.payment.create({
        data: {
          userId,
          plan: 'mensal',
          kind: 'renewal',
          reference,
          amount: BigInt(planPrice.mensal),
          status: 'approved',
          appliedAt: now,
        },
      });
    });
  }

  /** Cancels the monthly subscription; the plan stays active until the period already paid ends. */
  async cancel(userId: string) {
    const subscription = await this.db.payment.findFirst({
      where: { userId, kind: 'subscription', status: 'authorized' },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription?.providerId) throw new BadRequestException('Não há assinatura mensal ativa para cancelar.');
    await mercadoPago('/preapproval/' + subscription.providerId, { method: 'PUT', body: { status: 'cancelled' } });
    await this.db.payment.update({ where: { id: subscription.id }, data: { status: 'cancelled' } });
    return this.access(userId);
  }
}

/** Blocks the finance API after the free trial when there is no paid plan (HTTP 402). */
@Injectable()
export class PaidGuard implements CanActivate {
  constructor(@Inject(Database) private readonly db: Database) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const user = await this.db.user.findUniqueOrThrow({ where: { id: req.userId } });
    if (!user.isAdmin && accessOf(user).status === 'expirado')
      throw new HttpException('Seu teste gratuito terminou. Escolha um plano para continuar.', 402);
    return true;
  }
}
