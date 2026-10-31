import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { boxInput, cardInput, categoryInput, filterInput, incomeTypeInput, movementInput, paymentInput, recurrenceInput, TransactionInput } from '../../shared/schemas';
import { Database } from './database';
import { addMonths, effect, splitInstallments, statementPeriod, today } from './domain';
type Tx = Prisma.TransactionClient;
type References = { type: string; categoryId?: string | null; incomeTypeId?: string | null; paymentMethodId?: string | null; cardId?: string | null };
export const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
};
const owned = async <T>(value: Promise<T | null>): Promise<T> => {
  const row = await value;
  if (!row) throw new NotFoundException('Registro não encontrado.');
  return row;
};
export type Resource = 'categories' | 'payment-methods' | 'cards' | 'income-types';
@Injectable()
export class FinanceService {
  constructor(@Inject(Database) private readonly db: Database) {}
  // A database row lock serializes all financial writes per user, across instances.
  async atomic<T>(userId: string, fn: (tx: Tx) => Promise<T>, process = true): Promise<T> {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      if (process) await this.process(tx, userId);
      return fn(tx);
    }, { maxWait: 15_000, timeout: 30_000 });
  }
  async refs(tx: Tx, userId: string, input: References) {
    const categoryId = input.categoryId || null;
    if (categoryId) await owned(tx.category.findFirst({ where: { id: categoryId, userId } }));
    let incomeTypeId = input.incomeTypeId || null;
    let paymentMethodId = input.paymentMethodId || null;
    let cardId = input.cardId || null;
    if (input.type === 'income') { paymentMethodId = null; cardId = null; }
    else { incomeTypeId = null; }
    if (incomeTypeId) await owned(tx.incomeType.findFirst({ where: { id: incomeTypeId, userId } }));
    if (paymentMethodId) {
      const method = await owned(tx.paymentMethod.findFirst({ where: { id: paymentMethodId, userId } }));
      if (['credito', 'debito'].includes(method.kind)) {
        if (!cardId) throw new BadRequestException('Selecione um cartão.');
        await owned(tx.card.findFirst({ where: { id: cardId, userId } }));
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
          await tx.transaction.create({ data: { userId, type: rec.type, kind: 'fixo', value: rec.value, description: rec.description,
            categoryId: rec.categoryId, incomeTypeId: rec.incomeTypeId, paymentMethodId: rec.paymentMethodId, cardId: rec.cardId,
            recurrenceId: rec.id, date, applied: false } });
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
  async createTransaction(userId: string, input: TransactionInput) {
    return this.atomic(userId, async tx => {
      const refs = await this.refs(tx, userId, input);
      const common = { userId, type: input.type, description: input.description, ...refs };
      if (input.kind === 'fixo') {
        const rec = await tx.recurrence.create({ data: { ...common, value: BigInt(input.value), dayOfMonth: Number(input.date.slice(8)), startDate: input.date, endDate: input.endDate } });
        await this.process(tx, userId);
        return rec;
      }
      if (input.kind === 'parcelado') {
        const plan = await tx.installmentPlan.create({ data: { userId, description: input.description, totalValue: BigInt(input.value), installments: input.installments!, firstDate: input.date, categoryId: refs.categoryId, paymentMethodId: refs.paymentMethodId, cardId: refs.cardId } });
        const values = splitInstallments(plan.totalValue, plan.installments);
        await tx.transaction.createMany({ data: values.map((value, i) => ({ ...common, kind: 'parcelado', value, date: addMonths(input.date, i), planId: plan.id, installmentNumber: i + 1, applied: false })) });
        await this.process(tx, userId);
        return plan;
      }
      const row = await tx.transaction.create({ data: { ...common, value: BigInt(input.value), date: input.date, applied: input.date <= today() } });
      await tx.user.update({ where: { id: userId }, data: { balance: { increment: effect(row) } } });
      return row;
    });
  }
  async updateTransaction(userId: string, id: string, input: TransactionInput) {
    if (input.kind !== 'avista') throw new BadRequestException('Edite recorrências e planos nas suas seções.');
    return this.atomic(userId, async tx => {
      const previous = await owned(tx.transaction.findFirst({ where: { id, userId } }));
      const refs = await this.refs(tx, userId, input);
      const row = await tx.transaction.update({ where: { id }, data: { type: input.type, value: BigInt(input.value), description: input.description, date: input.date, applied: input.date <= today(), ...refs } });
      await tx.user.update({ where: { id: userId }, data: { balance: { increment: effect(row) - effect(previous) } } });
      return row;
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
    return this.atomic(userId, tx => tx.transaction.findMany({ where: { userId, type: filter.type, categoryId: filter.categoryId,
      date: { gte: filter.from, lte: filter.to } }, include: { category: true, incomeType: true, paymentMethod: true, card: true, plan: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }));
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
          if (old.kind !== data.kind) throw new BadRequestException('Para mudar o tipo, crie outra forma de pagamento.');
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
        default: throw new NotFoundException();
      }
    });
  }
  async deleteResource(userId: string, resource: string, id: string) {
    return this.atomic(userId, async tx => {
      switch (resource) {
        case 'categories': {
          const row = await owned(tx.category.findFirst({ where: { id, userId } }));
          if (row.isDefault) throw new BadRequestException('Categoria padrão não pode ser excluída.');
          await tx.category.delete({ where: { id } }); break;
        }
        case 'payment-methods': await owned(tx.paymentMethod.findFirst({ where: { id, userId } })); await tx.paymentMethod.delete({ where: { id } }); break;
        case 'cards': await owned(tx.card.findFirst({ where: { id, userId } })); await tx.card.delete({ where: { id } }); break;
        case 'income-types': await owned(tx.incomeType.findFirst({ where: { id, userId } })); await tx.incomeType.delete({ where: { id } }); break;
        default: throw new NotFoundException();
      }
      return { ok: true };
    });
  }
  async boxes(userId: string) {
    return this.atomic(userId, tx => tx.savingsBox.findMany({ where: { userId }, include: { movements: { orderBy: { createdAt: 'desc' }, take: 50 } }, orderBy: { createdAt: 'desc' } }));
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
      if (data.type === 'deposit' ? user.balance < value : box.amount < value) throw new BadRequestException('Saldo insuficiente.');
      const delta = data.type === 'deposit' ? value : -value;
      await tx.user.update({ where: { id: userId }, data: { balance: { decrement: delta } } });
      const amount = box.amount + delta;
      const row = await tx.savingsBox.update({ where: { id }, data: { amount, goalAlertDismissed: box.goal && amount < box.goal ? false : box.goalAlertDismissed } });
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
  async recurrences(userId: string) { return this.atomic(userId, tx => tx.recurrence.findMany({ where: { userId }, orderBy: { dayOfMonth: 'asc' } })); }
  async updateRecurrence(userId: string, id: string, body: unknown) {
    const input = parse(recurrenceInput, body);
    return this.atomic(userId, async tx => {
      const previous = await owned(tx.recurrence.findFirst({ where: { id, userId } }));
      if (input.startDate !== previous.startDate) throw new BadRequestException('O início de uma recorrência existente não pode mudar.');
      const refs = await this.refs(tx, userId, input);
      // Changes apply to future months; existing transactions keep their history.
      const row = await tx.recurrence.update({ where: { id }, data: { ...input, value: BigInt(input.value), ...refs } });
      await this.process(tx, userId);
      return row;
    });
  }
  async deleteRecurrence(userId: string, id: string) {
    return this.atomic(userId, async tx => {
      await owned(tx.recurrence.findFirst({ where: { id, userId } }));
      await tx.recurrence.delete({ where: { id } });
      return { ok: true };
    });
  }
  async plans(userId: string) { return this.atomic(userId, tx => tx.installmentPlan.findMany({ where: { userId }, include: { transactions: { orderBy: { installmentNumber: 'asc' } } } })); }
  async updatePlan(userId: string, id: string, body: unknown) {
    const data = parse(z.object({ description: z.string().trim().max(255) }).strict(), body);
    return this.atomic(userId, async tx => {
      await owned(tx.installmentPlan.findFirst({ where: { id, userId } }));
      await tx.transaction.updateMany({ where: { planId: id, userId }, data });
      return tx.installmentPlan.update({ where: { id }, data });
    });
  }
  async deletePlan(userId: string, id: string) {
    return this.atomic(userId, async tx => {
      await owned(tx.installmentPlan.findFirst({ where: { id, userId } }));
      const rows = await tx.transaction.findMany({ where: { userId, planId: id } });
      await tx.user.update({ where: { id: userId }, data: { balance: { decrement: rows.reduce((s, t) => s + effect(t), 0n) } } });
      await tx.installmentPlan.delete({ where: { id } });
      return { ok: true };
    });
  }
  async reports(userId: string, query: unknown) {
    const filter = parse(filterInput, query);
    return this.atomic(userId, async tx => {
      const rows = await tx.transaction.findMany({ where: { userId, type: filter.type, categoryId: filter.categoryId, date: { gte: filter.from, lte: filter.to } }, include: { category: true } });
      let income = 0n, expense = 0n, fixed = 0n, installments = 0n;
      const byCategory = new Map<string, { name: string; color: string; value: bigint }>();
      for (const row of rows) {
        if (row.type === 'income') income += row.value;
        else {
          expense += row.value;
          if (row.kind === 'fixo') fixed += row.value;
          if (row.kind === 'parcelado') installments += row.value;
          const key = row.categoryId || 'none';
          const bucket = byCategory.get(key) || { name: row.category?.name || 'Sem categoria', color: row.category?.color || '#999999', value: 0n };
          bucket.value += row.value; byCategory.set(key, bucket);
        }
      }
      return { income, expense, fixed, installments, net: income - expense, byCategory: [...byCategory.values()].sort((a, b) => Number(b.value - a.value)) };
    });
  }
  async dashboard(userId: string) {
    return this.atomic(userId, async tx => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, username: true, name: true, balance: true } });
      const now = today();
      const month = now.slice(0, 7);
      const rows = await tx.transaction.findMany({ where: { userId }, include: { paymentMethod: true, category: true, plan: { select: { installments: true } } }, orderBy: { date: 'desc' } });
      const boxes = await tx.savingsBox.findMany({ where: { userId } });
      const recurrences = await tx.recurrence.findMany({ where: { userId, active: true } });
      const projection = Array.from({ length: 6 }, (_, i) => {
        const date = addMonths(month + '-01', i + 1);
        let income = 0n, expense = 0n;
        for (const t of rows.filter(t => t.date.slice(0, 7) === date.slice(0, 7))) {
          if (t.type === 'income') income += t.value; else expense += t.value;
        }
        for (const r of recurrences) {
          const occurrence = addMonths(date, 0, r.dayOfMonth);
          if ((!r.lastGenerated || r.lastGenerated < date) && occurrence >= r.startDate && (!r.endDate || occurrence <= r.endDate)) {
            if (r.type === 'income') income += r.value; else expense += r.value;
          }
        }
        return { month: date, income, expense, net: income - expense };
      });
      const cards = [];
      for (const card of await tx.card.findMany({ where: { userId } })) {
        const { from, to } = statementPeriod(card.closingDay, now);
        const credit = rows.filter(t => t.cardId === card.id && t.type === 'expense' && t.paymentMethod?.kind === 'credito' && t.date >= from);
        const used = credit.reduce((s, t) => s + t.value, 0n);
        const invoice = credit.filter(t => t.date <= to).reduce((s, t) => s + t.value, 0n);
        cards.push({ ...card, used, invoice, available: card.limit === null ? null : card.limit - used, from, to,
          dueDate: card.dueDay ? addMonths(to, card.dueDay > Number(to.slice(8)) ? 0 : 1, card.dueDay) : null });
      }
      const current = rows.filter(t => t.date.startsWith(month) && t.applied);
      const income = current.filter(t => t.type === 'income').reduce((s, t) => s + t.value, 0n);
      const expense = current.filter(t => t.type === 'expense').reduce((s, t) => s + t.value, 0n);
      return { user, income, expense, saved: boxes.reduce((s, b) => s + b.amount, 0n),
        alerts: boxes.filter(b => b.goal && b.amount >= b.goal && !b.goalAlertDismissed), projection, cards,
        recent: rows.slice(0, 8), upcoming: rows.filter(t => !t.applied).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12) };
    });
  }
}
