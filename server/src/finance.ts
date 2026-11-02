import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import {
  boxInput,
  cardInput,
  categoryInput,
  filterInput,
  incomeTypeInput,
  movementInput,
  paymentInput,
  planInput,
  recurrenceInput,
  TransactionInput,
} from '../../shared/schemas';
import { Database } from './database';
import { addMonths, effect, splitInstallments, statementPeriod, today } from './domain';
type Tx = Prisma.TransactionClient;
type References = {
  type: string;
  categoryId?: string | null;
  incomeTypeId?: string | null;
  paymentMethodId?: string | null;
  cardId?: string | null;
};
export const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new BadRequestException(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
};
const owned = async <T>(value: Promise<T | null>): Promise<T> => {
  const row = await value;
  if (!row) throw new NotFoundException('Registro não encontrado.');
  return row;
};
export type Resource = 'categories' | 'payment-methods' | 'cards' | 'income-types';
const money = (cents: bigint) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents) / 100);
const percent = (part: bigint, total: bigint) => (total ? Math.round((Number(part) * 1000) / Number(total)) / 10 : 0);
const pct = (value: number) => String(value).replace('.', ',') + '%';
const monthEnd = (date: string) => addMonths(date.slice(0, 7) + '-01', 0, 31);
const palette = ['#f64301', '#4fd4ff', '#ff4fd4', '#ffb84f', '#4fff88', '#a04fff', '#ff6b6b', '#a0a0a0'];
type Grouped = { name: string; icon: string; color: string; value: bigint; count: number; percent: number };
// Groups rows by a related record (category, payment method, card...), largest total first.
function group<T extends { value: bigint }>(
  rows: T[],
  key: (row: T) => { id: string | null; name?: string | null; icon?: string | null; color?: string | null },
  empty: string,
  icon: string,
): Grouped[] {
  const buckets = new Map<string, Grouped>();
  for (const row of rows) {
    const k = key(row),
      id = k.id ?? '';
    const bucket = buckets.get(id) ?? {
      name: k.name || empty,
      icon: k.icon || icon,
      color: k.color || '',
      value: 0n,
      count: 0,
      percent: 0,
    };
    bucket.value += row.value;
    bucket.count++;
    buckets.set(id, bucket);
  }
  const total = rows.reduce((sum, r) => sum + r.value, 0n);
  return [...buckets.values()]
    .sort((a, b) => Number(b.value - a.value))
    .map((b, i) => ({ ...b, color: b.color || palette[i % palette.length], percent: percent(b.value, total) }));
}
type RecurrenceRow = {
  id: string;
  type: string;
  value: bigint;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  lastGenerated: string | null;
};
// Occurrence date of a recurrence in a month, or null when it is outside its active range or already generated.
function pendingOccurrence(rec: RecurrenceRow, month: string) {
  if (rec.lastGenerated && rec.lastGenerated >= month) return null;
  const date = addMonths(month, 0, rec.dayOfMonth);
  return date >= rec.startDate && (!rec.endDate || date <= rec.endDate) ? date : null;
}
@Injectable()
export class FinanceService {
  constructor(@Inject(Database) private readonly db: Database) {}
  // A database row lock serializes all financial writes per user, across instances.
  async atomic<T>(userId: string, fn: (tx: Tx) => Promise<T>, process = true): Promise<T> {
    return this.db.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        if (process) await this.process(tx, userId);
        return fn(tx);
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
  }
  async refs(tx: Tx, userId: string, input: References) {
    const categoryId = input.categoryId || null;
    if (categoryId) await owned(tx.category.findFirst({ where: { id: categoryId, userId } }));
    let incomeTypeId = input.incomeTypeId || null;
    let paymentMethodId = input.paymentMethodId || null;
    let cardId = input.cardId || null;
    if (input.type === 'income') {
      paymentMethodId = null;
      cardId = null;
    } else {
      incomeTypeId = null;
    }
    if (incomeTypeId) await owned(tx.incomeType.findFirst({ where: { id: incomeTypeId, userId } }));
    if (paymentMethodId) {
      const method = await owned(tx.paymentMethod.findFirst({ where: { id: paymentMethodId, userId } }));
      if (['credito', 'debito'].includes(method.kind)) {
        // As in the Django app: credit requires the card, debit asks for it optionally.
        if (!cardId && method.kind === 'credito')
          throw new BadRequestException('Escolha qual cartão de crédito foi usado.');
        if (cardId) await owned(tx.card.findFirst({ where: { id: cardId, userId } }));
      } else cardId = null;
    } else cardId = null;
    return { categoryId, incomeTypeId, paymentMethodId, cardId };
  }
  async process(tx: Tx, userId: string, now = today()) {
    for (const rec of await tx.recurrence.findMany({ where: { userId, active: true } })) {
      let month = rec.lastGenerated ? addMonths(rec.lastGenerated, 1, 1) : rec.startDate.slice(0, 7) + '-01';
      const until = now.slice(0, 7) + '-01';
      while (month <= until) {
        const date = addMonths(month, 0, rec.dayOfMonth);
        if (date >= rec.startDate && (!rec.endDate || date <= rec.endDate)) {
          await tx.transaction.create({
            data: {
              userId,
              type: rec.type,
              kind: 'fixo',
              value: rec.value,
              description: rec.description,
              categoryId: rec.categoryId,
              incomeTypeId: rec.incomeTypeId,
              paymentMethodId: rec.paymentMethodId,
              cardId: rec.cardId,
              recurrenceId: rec.id,
              date,
              applied: false,
            },
          });
        }
        await tx.recurrence.update({ where: { id: rec.id }, data: { lastGenerated: month } });
        month = addMonths(month, 1, 1);
      }
    }
    const pending = await tx.transaction.findMany({ where: { userId, applied: false, date: { lte: now } } });
    if (pending.length) {
      const delta = pending.reduce((sum, t) => sum + effect({ ...t, applied: true }), 0n);
      await tx.user.update({ where: { id: userId }, data: { balance: { increment: delta } } });
      await tx.transaction.updateMany({ where: { id: { in: pending.map(t => t.id) } }, data: { applied: true } });
    }
  }
  // Messages shown after saving, like the Django app: card over its limit and negative balance.
  async warnings(tx: Tx, userId: string, cardId: string | null) {
    const warnings: string[] = [];
    if (cardId) {
      const card = await tx.card.findUniqueOrThrow({ where: { id: cardId } });
      if (card.limit !== null) {
        const { from } = statementPeriod(card.closingDay, today());
        const used = await tx.transaction.aggregate({
          _sum: { value: true },
          where: { cardId, type: 'expense', date: { gte: from }, paymentMethod: { kind: 'credito' } },
        });
        const over = (used._sum.value ?? 0n) - card.limit;
        if (over > 0n) warnings.push(`Atenção: o cartão "${card.name}" passou do limite em ${money(over)}.`);
      }
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.balance < 0n) warnings.push('Atenção: seu saldo ficou negativo.');
    return warnings;
  }
  async createTransaction(userId: string, input: TransactionInput) {
    const row = await this.atomic(userId, async tx => {
      const refs = await this.refs(tx, userId, input);
      const common = { userId, type: input.type, description: input.description, ...refs };
      if (input.kind === 'fixo') {
        const rec = await tx.recurrence.create({
          data: {
            ...common,
            value: BigInt(input.value),
            dayOfMonth: Number(input.date.slice(8)),
            startDate: input.date,
            endDate: input.endDate,
          },
        });
        await this.process(tx, userId);
        return rec;
      }
      if (input.kind === 'parcelado') {
        const plan = await tx.installmentPlan.create({
          data: {
            userId,
            description: input.description,
            totalValue: BigInt(input.value),
            installments: input.installments!,
            firstDate: input.date,
            categoryId: refs.categoryId,
            paymentMethodId: refs.paymentMethodId,
            cardId: refs.cardId,
          },
        });
        const values = splitInstallments(plan.totalValue, plan.installments);
        await tx.transaction.createMany({
          data: values.map((value, i) => ({
            ...common,
            kind: 'parcelado',
            value,
            date: addMonths(input.date, i),
            planId: plan.id,
            installmentNumber: i + 1,
            applied: false,
          })),
        });
        await this.process(tx, userId);
        return plan;
      }
      const row = await tx.transaction.create({
        data: { ...common, value: BigInt(input.value), date: input.date, applied: input.date <= today() },
      });
      await tx.user.update({ where: { id: userId }, data: { balance: { increment: effect(row) } } });
      return row;
    });
    return { ...row, warnings: await this.atomic(userId, tx => this.warnings(tx, userId, row.cardId ?? null), false) };
  }
  async updateTransaction(userId: string, id: string, input: TransactionInput) {
    if (input.kind !== 'avista') throw new BadRequestException('Edite recorrências e planos nas suas seções.');
    return this.atomic(userId, async tx => {
      const previous = await owned(tx.transaction.findFirst({ where: { id, userId } }));
      const refs = await this.refs(tx, userId, input);
      const row = await tx.transaction.update({
        where: { id },
        data: {
          type: input.type,
          value: BigInt(input.value),
          description: input.description,
          date: input.date,
          applied: input.date <= today(),
          ...refs,
        },
      });
      await tx.user.update({ where: { id: userId }, data: { balance: { increment: effect(row) - effect(previous) } } });
      return { ...row, warnings: await this.warnings(tx, userId, row.cardId) };
    });
  }
  async deleteTransaction(userId: string, id: string) {
    return this.atomic(userId, async tx => {
      const row = await owned(tx.transaction.findFirst({ where: { id, userId } }));
      await tx.transaction.delete({ where: { id } });
      await tx.user.update({ where: { id: userId }, data: { balance: { decrement: effect(row) } } });
      return { ok: true };
    });
  }
  async transactions(userId: string, query: unknown) {
    const filter = parse(filterInput, query);
    return this.atomic(userId, tx =>
      tx.transaction.findMany({
        where: {
          userId,
          type: filter.type,
          categoryId: filter.categoryId,
          incomeTypeId: filter.incomeTypeId,
          kind: filter.kind,
          date: { gte: filter.from, lte: filter.to },
        },
        include: { category: true, incomeType: true, paymentMethod: true, card: true, plan: true },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
    );
  }
  async transaction(userId: string, id: string) {
    return this.atomic(userId, tx =>
      owned(
        tx.transaction.findFirst({
          where: { id, userId },
          include: { category: true, incomeType: true, paymentMethod: true, card: true, plan: true, recurrence: true },
        }),
      ),
    );
  }
  async catalog(userId: string) {
    return this.atomic(userId, async tx => ({
      categories: await tx.category.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
      paymentMethods: await tx.paymentMethod.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
      cards: await tx.card.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
      incomeTypes: await tx.incomeType.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
    }));
  }
  async saveResource(userId: string, resource: string, body: unknown, id?: string) {
    return this.atomic(userId, async tx => {
      switch (resource) {
        case 'categories': {
          const data = parse(categoryInput, body);
          if (!id) return tx.category.create({ data: { ...data, userId } });
          const row = await owned(tx.category.findFirst({ where: { id, userId } }));
          if (row.isDefault) throw new BadRequestException('Categorias padrão não podem ser alteradas.');
          return tx.category.update({ where: { id }, data });
        }
        case 'payment-methods': {
          const data = parse(paymentInput, body);
          if (!id) return tx.paymentMethod.create({ data: { ...data, userId } });
          await owned(tx.paymentMethod.findFirst({ where: { id, userId } }));
          const old = await tx.paymentMethod.findUniqueOrThrow({ where: { id } });
          if (old.kind !== data.kind)
            throw new BadRequestException('Para mudar o tipo, crie outra forma de pagamento.');
          return tx.paymentMethod.update({ where: { id }, data });
        }
        case 'cards': {
          const data = parse(cardInput, body);
          if (!id) return tx.card.create({ data: { ...data, userId } });
          await owned(tx.card.findFirst({ where: { id, userId } }));
          return tx.card.update({ where: { id }, data });
        }
        case 'income-types': {
          const data = parse(incomeTypeInput, body);
          if (!id) return tx.incomeType.create({ data: { ...data, userId } });
          await owned(tx.incomeType.findFirst({ where: { id, userId } }));
          return tx.incomeType.update({ where: { id }, data });
        }
        default:
          throw new NotFoundException();
      }
    });
  }
  async deleteResource(userId: string, resource: string, id: string) {
    return this.atomic(userId, async tx => {
      switch (resource) {
        case 'categories': {
          const row = await owned(tx.category.findFirst({ where: { id, userId } }));
          if (row.isDefault) throw new BadRequestException('Categoria padrão não pode ser excluída.');
          await tx.category.delete({ where: { id } });
          break;
        }
        case 'payment-methods':
          await owned(tx.paymentMethod.findFirst({ where: { id, userId } }));
          await tx.paymentMethod.delete({ where: { id } });
          break;
        case 'cards':
          await owned(tx.card.findFirst({ where: { id, userId } }));
          await tx.card.delete({ where: { id } });
          break;
        case 'income-types':
          await owned(tx.incomeType.findFirst({ where: { id, userId } }));
          await tx.incomeType.delete({ where: { id } });
          break;
        default:
          throw new NotFoundException();
      }
      return { ok: true };
    });
  }
  async boxes(userId: string) {
    return this.atomic(userId, tx =>
      tx.savingsBox.findMany({
        where: { userId },
        include: { movements: { orderBy: { createdAt: 'desc' }, take: 50 } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }
  async saveBox(userId: string, body: unknown, id?: string) {
    const data = parse(boxInput, body);
    return this.atomic(userId, async tx => {
      if (!id) return tx.savingsBox.create({ data: { ...data, userId } });
      await owned(tx.savingsBox.findFirst({ where: { id, userId } }));
      return tx.savingsBox.update({ where: { id }, data: { ...data, goalAlertDismissed: false } });
    });
  }
  async moveBox(userId: string, id: string, body: unknown) {
    const data = parse(movementInput, body);
    return this.atomic(userId, async tx => {
      const box = await owned(tx.savingsBox.findFirst({ where: { id, userId } }));
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const value = BigInt(data.value);
      if (data.type === 'deposit' && user.balance < value)
        throw new BadRequestException('Saldo insuficiente para esse depósito.');
      if (data.type === 'withdraw' && box.amount < value)
        throw new BadRequestException('O cofrinho não tem esse valor guardado.');
      const delta = data.type === 'deposit' ? value : -value;
      await tx.user.update({ where: { id: userId }, data: { balance: { decrement: delta } } });
      const amount = box.amount + delta;
      const row = await tx.savingsBox.update({
        where: { id },
        data: { amount, goalAlertDismissed: box.goal && amount < box.goal ? false : box.goalAlertDismissed },
      });
      await tx.savingsMovement.create({ data: { boxId: id, ...data, value } });
      return row;
    });
  }
  async deleteBox(userId: string, id: string) {
    return this.atomic(userId, async tx => {
      const box = await owned(tx.savingsBox.findFirst({ where: { id, userId } }));
      await tx.user.update({ where: { id: userId }, data: { balance: { increment: box.amount } } });
      await tx.savingsBox.delete({ where: { id } });
      return { ok: true };
    });
  }
  async dismissBox(userId: string, id: string) {
    return this.atomic(userId, async tx => {
      await owned(tx.savingsBox.findFirst({ where: { id, userId } }));
      return tx.savingsBox.update({ where: { id }, data: { goalAlertDismissed: true } });
    });
  }
  async recurrences(userId: string) {
    return this.atomic(userId, tx =>
      tx.recurrence.findMany({
        where: { userId },
        include: { category: true, incomeType: true, paymentMethod: true, card: true },
        orderBy: [{ dayOfMonth: 'asc' }, { description: 'asc' }],
      }),
    );
  }
  async updateRecurrence(userId: string, id: string, body: unknown) {
    const input = parse(recurrenceInput, body);
    return this.atomic(userId, async tx => {
      const previous = await owned(tx.recurrence.findFirst({ where: { id, userId } }));
      if (input.startDate !== previous.startDate)
        throw new BadRequestException('O início de uma recorrência existente não pode mudar.');
      const refs = await this.refs(tx, userId, input);
      // Changes apply to future months; existing transactions keep their history.
      const row = await tx.recurrence.update({
        where: { id },
        data: { ...input, value: BigInt(input.value), ...refs },
      });
      // Paused: drop this recurrence's forecasts that have not happened yet.
      if (!row.active) await tx.transaction.deleteMany({ where: { recurrenceId: id, applied: false } });
      await this.process(tx, userId);
      return row;
    });
  }
  async deleteRecurrence(userId: string, id: string) {
    return this.atomic(userId, async tx => {
      await owned(tx.recurrence.findFirst({ where: { id, userId } }));
      // Months already applied stay in the history; forecasts go away with the recurrence.
      await tx.transaction.deleteMany({ where: { recurrenceId: id, applied: false } });
      await tx.recurrence.delete({ where: { id } });
      return { ok: true };
    });
  }
  async plans(userId: string) {
    return this.atomic(userId, tx =>
      tx.installmentPlan.findMany({
        where: { userId },
        include: {
          category: true,
          paymentMethod: true,
          card: true,
          transactions: { orderBy: { installmentNumber: 'asc' } },
        },
        orderBy: { firstDate: 'desc' },
      }),
    );
  }
  async updatePlan(userId: string, id: string, body: unknown) {
    const input = parse(planInput, body);
    return this.atomic(userId, async tx => {
      await owned(tx.installmentPlan.findFirst({ where: { id, userId } }));
      const { categoryId, paymentMethodId, cardId } = await this.refs(tx, userId, { type: 'expense', ...input });
      const data = { description: input.description, categoryId, paymentMethodId, cardId };
      await tx.transaction.updateMany({ where: { planId: id, userId }, data });
      return tx.installmentPlan.update({ where: { id }, data });
    });
  }
  async deletePlan(userId: string, id: string) {
    return this.atomic(userId, async tx => {
      await owned(tx.installmentPlan.findFirst({ where: { id, userId } }));
      const rows = await tx.transaction.findMany({ where: { userId, planId: id } });
      await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: rows.reduce((s, t) => s + effect(t), 0n) } },
      });
      await tx.installmentPlan.delete({ where: { id } });
      return { ok: true };
    });
  }
  async reports(userId: string, query: unknown) {
    const filter = parse(filterInput, query);
    return this.atomic(userId, async tx => {
      const include = { category: true, incomeType: true, paymentMethod: true, card: true } as const;
      const rows = await tx.transaction.findMany({
        where: { userId, date: { gte: filter.from, lte: filter.to } },
        include,
      });
      const expenses = rows.filter(r => r.type === 'expense'),
        incomes = rows.filter(r => r.type === 'income');
      const sum = (list: { value: bigint }[]) => list.reduce((s, r) => s + r.value, 0n);
      const income = sum(incomes),
        expense = sum(expenses);
      const kinds: Record<string, [string, string]> = {
        avista: ['À vista', '#4fd4ff'],
        parcelado: ['Parcelado', '#ffb84f'],
        fixo: ['Fixo', '#ff4fd4'],
      };
      // Monthly evolution: the 6 months ending at the period's end (or the current month).
      const reference = (filter.to ?? today()).slice(0, 7) + '-01';
      const months = Array.from({ length: 6 }, (_, i) => addMonths(reference, i - 5, 1));
      const recent = await tx.transaction.findMany({
        where: { userId, date: { gte: months[0], lte: monthEnd(reference) } },
        select: { type: true, value: true, date: true },
      });
      const fixed = await tx.recurrence.findMany({
        where: { userId, active: true, type: 'expense' },
        include: { category: true, card: true },
        orderBy: [{ dayOfMonth: 'asc' }, { description: 'asc' }],
      });
      return {
        income,
        expense,
        net: income - expense,
        fixed: sum(expenses.filter(r => r.kind === 'fixo')),
        installments: sum(expenses.filter(r => r.kind === 'parcelado')),
        forecastExpense: sum(expenses.filter(r => !r.applied)),
        byCategory: group(expenses, r => ({ id: r.categoryId, ...r.category }), 'Sem categoria', '❔'),
        byKind: group(
          expenses,
          r => ({ id: r.kind, name: kinds[r.kind]?.[0], color: kinds[r.kind]?.[1], icon: '' }),
          'Outro',
          '',
        ),
        byPaymentMethod: group(
          expenses,
          r => ({ id: r.paymentMethodId, name: r.paymentMethod?.name, icon: r.paymentMethod?.icon, color: null }),
          'Não informada',
          '💳',
        ),
        byCard: group(
          expenses.filter(r => r.cardId),
          r => ({ id: r.cardId, name: r.card?.name, color: r.card?.color, icon: null }),
          'Cartão',
          '💳',
        ),
        byIncomeType: group(incomes, r => ({ id: r.incomeTypeId, ...r.incomeType }), 'Sem tipo', '💵'),
        evolution: months.map(month => {
          const inMonth = recent.filter(r => r.date.startsWith(month.slice(0, 7)));
          return {
            month,
            income: sum(inMonth.filter(r => r.type === 'income')),
            expense: sum(inMonth.filter(r => r.type === 'expense')),
          };
        }),
        fixedExpenses: fixed,
        fixedMonthly: sum(fixed),
      };
    });
  }
  cardSummary(
    card: { id: string; limit: bigint | null; closingDay: number | null; dueDay: number | null },
    rows: {
      cardId: string | null;
      type: string;
      value: bigint;
      date: string;
      paymentMethod?: { kind: string } | null;
    }[],
    now: string,
  ) {
    const { from, to } = statementPeriod(card.closingDay, now);
    const credit = rows.filter(
      t => t.cardId === card.id && t.type === 'expense' && t.paymentMethod?.kind === 'credito' && t.date >= from,
    );
    const used = credit.reduce((s, t) => s + t.value, 0n);
    const invoice = credit.filter(t => t.date <= to).reduce((s, t) => s + t.value, 0n);
    return {
      used,
      invoice,
      from,
      to,
      available: card.limit === null ? null : card.limit - used,
      percent: card.limit ? Math.min(100, Math.round((Number(used) * 1000) / Number(card.limit)) / 10) : null,
      dueDate: card.dueDay ? addMonths(to, card.dueDay > Number(to.slice(8)) ? 0 : 1, card.dueDay) : null,
    };
  }
  async cards(userId: string) {
    return this.atomic(userId, async tx => {
      const rows = await tx.transaction.findMany({
        where: { userId, cardId: { not: null } },
        include: { paymentMethod: true },
      });
      return (await tx.card.findMany({ where: { userId }, orderBy: { name: 'asc' } })).map(card => ({
        ...card,
        ...this.cardSummary(card, rows, today()),
      }));
    });
  }
  /** Data for the "Finanças" page: month commitments, cards, projection, recurrences, installment plans and tips. */
  async finance(userId: string) {
    return this.atomic(userId, async tx => {
      const now = today(),
        monthStart = now.slice(0, 7) + '-01',
        end = monthEnd(now);
      const { balance } = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const rows = await tx.transaction.findMany({
        where: { userId },
        include: { category: true, incomeType: true, paymentMethod: true, card: true, plan: true },
        orderBy: { date: 'asc' },
      });
      const sum = (list: { value: bigint }[]) => list.reduce((s, r) => s + r.value, 0n);
      const month = rows.filter(r => r.date >= monthStart && r.date <= end);
      const incomeMonth = sum(month.filter(r => r.type === 'income')),
        expenseMonth = sum(month.filter(r => r.type === 'expense'));
      const toReceive = sum(month.filter(r => r.type === 'income' && !r.applied)),
        toPay = sum(month.filter(r => r.type === 'expense' && !r.applied));
      const projectedBalance = balance + toReceive - toPay;
      const recurrences = await tx.recurrence.findMany({
        where: { userId },
        include: { category: true, incomeType: true, paymentMethod: true, card: true },
        orderBy: [{ dayOfMonth: 'asc' }, { description: 'asc' }],
      });
      const fixedExpenses = recurrences.filter(r => r.type === 'expense'),
        fixedIncomes = recurrences.filter(r => r.type === 'income');
      const fixedExpenseTotal = sum(fixedExpenses.filter(r => r.active)),
        fixedIncomeTotal = sum(fixedIncomes.filter(r => r.active));
      const commitment = fixedIncomeTotal ? percent(fixedExpenseTotal, fixedIncomeTotal) : null;
      const plans = (
        await tx.installmentPlan.findMany({
          where: { userId },
          include: { category: true, card: true, transactions: { orderBy: { installmentNumber: 'asc' } } },
        })
      )
        .map(({ transactions, ...plan }) => ({
          ...plan,
          paid: transactions.filter(t => t.applied).length,
          remaining: sum(transactions.filter(t => !t.applied)),
          installmentValue: transactions.at(-1)?.value ?? 0n,
          last: transactions.reduce((m, t) => (t.date > m ? t.date : m), plan.firstDate),
        }))
        .sort((a, b) => a.last.localeCompare(b.last));
      const cards = (await tx.card.findMany({ where: { userId }, orderBy: { name: 'asc' } })).map(card => ({
        ...card,
        ...this.cardSummary(card, rows, now),
      }));
      // Next 6 months: existing transactions (installments, generated recurrences) plus recurrences not generated yet.
      let running = projectedBalance;
      const active = recurrences.filter(r => r.active);
      const projection = Array.from({ length: 6 }, (_, i) => {
        const start = addMonths(monthStart, i + 1, 1),
          inMonth = rows.filter(r => r.date >= start && r.date <= monthEnd(start));
        let income = sum(inMonth.filter(r => r.type === 'income')),
          expense = sum(inMonth.filter(r => r.type === 'expense'));
        const installments = sum(inMonth.filter(r => r.kind === 'parcelado'));
        let fixed = sum(inMonth.filter(r => r.type === 'expense' && r.kind === 'fixo'));
        for (const rec of active) {
          if (!pendingOccurrence(rec, start)) continue;
          if (rec.type === 'income') income += rec.value;
          else {
            expense += rec.value;
            fixed += rec.value;
          }
        }
        running += income - expense;
        return { month: start, income, expense, installments, fixed, balance: running };
      });
      // Next 30 days: forecasts already recorded plus recurrence occurrences not generated yet.
      const limit = new Date(now + 'T12:00:00Z');
      limit.setUTCDate(limit.getUTCDate() + 30);
      const until = limit.toISOString().slice(0, 10);
      const upcoming: {
        id: string;
        type: string;
        kind: string;
        value: bigint;
        description: string;
        date: string;
        installmentNumber: number | null;
        installments: number | null;
        card: string | null;
      }[] = rows
        .filter(r => !r.applied && r.date <= until)
        .map(r => ({
          id: r.id,
          type: r.type,
          kind: r.kind,
          value: r.value,
          description: r.description,
          date: r.date,
          installmentNumber: r.installmentNumber,
          installments: r.plan?.installments ?? null,
          card: r.card?.name ?? null,
        }));
      for (const rec of active)
        for (let m = monthStart; m <= until; m = addMonths(m, 1, 1)) {
          const date = pendingOccurrence(rec, m);
          if (date && date <= until)
            upcoming.push({
              id: `${rec.id}:${date}`,
              type: rec.type,
              kind: 'fixo',
              value: rec.value,
              description: rec.description,
              date,
              installmentNumber: null,
              installments: null,
              card: rec.card?.name ?? null,
            });
        }
      upcoming.sort((a, b) => a.date.localeCompare(b.date));
      const average =
        sum(rows.filter(r => r.type === 'expense' && r.date >= addMonths(monthStart, -3, 1) && r.date < monthStart)) /
        3n;
      const tips: { level: 'alerta' | 'info' | 'ok'; text: string }[] = [];
      if (projectedBalance < 0n)
        tips.push({
          level: 'alerta',
          text: `Pelo previsto, seu saldo deve fechar o mês negativo (${money(projectedBalance)}).`,
        });
      if (commitment !== null && commitment > 50)
        tips.push({
          level: 'alerta',
          text: `Seus gastos fixos consomem ${pct(commitment)} das suas entradas fixas. O recomendado é ficar abaixo de 50%.`,
        });
      for (const c of cards) {
        if (c.available !== null && c.available < 0n)
          tips.push({
            level: 'alerta',
            text: `O cartão "${c.name}" passou do limite em ${money(-c.available)} (contando as parcelas futuras).`,
          });
        else if (c.percent !== null && c.percent >= 80)
          tips.push({
            level: 'alerta',
            text: `O cartão "${c.name}" está com ${pct(c.percent)} do limite comprometido.`,
          });
      }
      if (average && expenseMonth * 10n > average * 12n)
        tips.push({
          level: 'info',
          text: `Seus gastos deste mês estão ${Math.round((Number(expenseMonth) / Number(average) - 1) * 100)}% acima da média dos últimos 3 meses.`,
        });
      if (!fixedIncomes.length)
        tips.push({
          level: 'info',
          text: 'Cadastre suas entradas fixas (ex: salário) para ver o quanto da renda está comprometida.',
        });
      if (!tips.length) tips.push({ level: 'ok', text: 'Tudo em dia! Nenhum alerta para este mês.' });
      return {
        today: now,
        balance,
        incomeMonth,
        expenseMonth,
        toReceive,
        toPay,
        projectedBalance,
        tips,
        cards,
        projection,
        fixedExpenses,
        fixedIncomes,
        fixedExpenseTotal,
        fixedIncomeTotal,
        commitment,
        activePlans: plans.filter(p => p.remaining > 0n),
        settledPlans: plans.filter(p => p.remaining === 0n),
        remainingInstallments: sum(plans.map(p => ({ value: p.remaining }))),
        upcoming: upcoming.slice(0, 20),
      };
    });
  }
  async dashboard(userId: string) {
    return this.atomic(userId, async tx => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, username: true, name: true, balance: true },
      });
      const now = today();
      const month = now.slice(0, 7);
      const rows = await tx.transaction.findMany({
        where: { userId },
        include: { paymentMethod: true, category: true, incomeType: true, plan: { select: { installments: true } } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      });
      const boxes = await tx.savingsBox.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
      const recurrences = await tx.recurrence.findMany({ where: { userId, active: true } });
      const projection = Array.from({ length: 6 }, (_, i) => {
        const date = addMonths(month + '-01', i + 1);
        let income = 0n,
          expense = 0n;
        for (const t of rows.filter(t => t.date.slice(0, 7) === date.slice(0, 7))) {
          if (t.type === 'income') income += t.value;
          else expense += t.value;
        }
        for (const r of recurrences) {
          if (!pendingOccurrence(r, date)) continue;
          if (r.type === 'income') income += r.value;
          else expense += r.value;
        }
        return { month: date, income, expense, net: income - expense };
      });
      const cards = (await tx.card.findMany({ where: { userId } })).map(card => ({
        ...card,
        ...this.cardSummary(card, rows, now),
      }));
      const current = rows.filter(t => t.date.startsWith(month) && t.applied);
      const income = current.filter(t => t.type === 'income').reduce((s, t) => s + t.value, 0n);
      const expense = current.filter(t => t.type === 'expense').reduce((s, t) => s + t.value, 0n);
      const toPay = rows
        .filter(t => t.type === 'expense' && !t.applied && t.date <= monthEnd(now))
        .reduce((s, t) => s + t.value, 0n);
      return {
        user,
        income,
        expense,
        toPay,
        saved: boxes.reduce((s, b) => s + b.amount, 0n),
        boxes: boxes.slice(0, 8),
        alerts: boxes.filter(b => b.goal && b.amount >= b.goal && !b.goalAlertDismissed),
        projection,
        cards,
        recent: rows.filter(t => t.applied).slice(0, 8),
        upcoming: rows
          .filter(t => !t.applied)
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 12),
      };
    });
  }
}
