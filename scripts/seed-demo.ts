// Fills an account with ~6 months of realistic data, like the Django app's "popular_demo" command.
//   npm run demo:seed -- <usuario>            only if the account has no transactions yet
//   npm run demo:seed -- <usuario> --limpar   erases the account's financial data first
import 'dotenv/config';
import { Database } from '../server/src/database';
import { createDefaults } from '../server/src/defaults';
import { addMonths, today } from '../server/src/domain';
import { FinanceService } from '../server/src/finance';

let seed = 42;
const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const between = (min: number, max: number) => Math.round((min + random() * (max - min)) * 100);
const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
const weekday = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay();
const nextDay = (date: string) => {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

async function main() {
  const [username, flag] = process.argv.slice(2);
  if (!username) throw new Error('Uso: npm run demo:seed -- <usuario> [--limpar]');
  const db = new Database();
  const finance = new FinanceService(db);
  try {
    const user = await db.user.findUnique({ where: { username: username.toLowerCase() } });
    if (!user) throw new Error(`Usuário "${username}" não existe. Crie com: npm run user:create -- ${username}`);
    const userId = user.id;
    if ((await db.transaction.count({ where: { userId } })) && flag !== '--limpar')
      throw new Error(`A conta "${user.username}" já tem lançamentos. Para apagar tudo e repopular, use --limpar.`);
    if (flag === '--limpar')
      await db.$transaction(async tx => {
        for (const model of [
          tx.transaction,
          tx.installmentPlan,
          tx.recurrence,
          tx.savingsBox,
          tx.card,
          tx.category,
          tx.paymentMethod,
          tx.incomeType,
        ] as { deleteMany: (a: object) => Promise<unknown> }[])
          await model.deleteMany({ where: { userId } });
        await tx.user.update({ where: { id: userId }, data: { balance: 0n } });
        await createDefaults(tx, userId);
      });

    const now = today(),
      start = addMonths(now.slice(0, 7) + '-01', -5, 1);
    const save = (resource: string, body: object) =>
      finance.saveResource(userId, resource, body) as Promise<{ id: string }>;
    const catalog = await finance.catalog(userId);
    const cat: Record<string, string> = Object.fromEntries(catalog.categories.map(c => [c.name, c.id]));
    cat.Assinaturas = (await save('categories', { name: 'Assinaturas', icon: '📺', color: '#ff6b6b' })).id;
    cat.Pets = (await save('categories', { name: 'Pets', icon: '🐶', color: '#c8a2ff' })).id;
    cat.Mercado = (await save('categories', { name: 'Mercado', icon: '🛒', color: '#7cffc4' })).id;
    const pay: Record<string, string> = Object.fromEntries(catalog.paymentMethods.map(m => [m.kind, m.id]));
    pay.vr = (await save('payment-methods', { name: 'Vale-refeição', kind: 'outro', icon: '🍽️' })).id;
    const nubank = (
      await save('cards', { name: 'Nubank', limit: 1200000, closingDay: 3, dueDay: 10, color: '#8a05be' })
    ).id;
    const inter = (await save('cards', { name: 'Inter', limit: 250000, closingDay: 25, dueDay: 5, color: '#ff7a00' }))
      .id;
    const c6 = (
      await save('cards', { name: 'C6 Débito', limit: null, closingDay: null, dueDay: null, color: '#9ca3af' })
    ).id;
    const type: Record<string, string> = Object.fromEntries(catalog.incomeTypes.map(t => [t.name, t.id]));
    type['Aluguel recebido'] = (
      await save('income-types', { name: 'Aluguel recebido', icon: '🏘️', color: '#ffb84f' })
    ).id;

    const add = (body: object) =>
      finance.createTransaction(userId, { kind: 'avista', description: '', ...body } as Parameters<
        FinanceService['createTransaction']
      >[1]);
    // Fixed entries since the start, generated month by month like in the app.
    const fixed = (t: 'income' | 'expense', value: number, description: string, day: number, extra: object = {}) =>
      add({ type: t, kind: 'fixo', value, description, date: addMonths(start, 0, day), ...extra });
    await add({ type: 'income', value: 1200000, description: 'Saldo inicial', date: start, incomeTypeId: type.Outros });
    await fixed('income', 680000, 'Salário', 5, { incomeTypeId: type['Salário'] });
    await fixed('income', 95000, 'Aluguel do apartamento', 10, { incomeTypeId: type['Aluguel recebido'] });
    await fixed('expense', 210000, 'Aluguel', 10, { categoryId: cat.Moradia, paymentMethodId: pay.boleto });
    await fixed('expense', 48000, 'Condomínio', 10, { categoryId: cat.Moradia, paymentMethodId: pay.boleto });
    await fixed('expense', 11990, 'Internet fibra', 15, {
      categoryId: cat.Moradia,
      paymentMethodId: pay.debito,
      cardId: c6,
    });
    await fixed('expense', 8990, 'Academia', 1, {
      categoryId: cat['Saúde'],
      paymentMethodId: pay.credito,
      cardId: nubank,
    });
    await fixed('expense', 5590, 'Netflix', 12, {
      categoryId: cat.Assinaturas,
      paymentMethodId: pay.credito,
      cardId: nubank,
    });
    await fixed('expense', 2190, 'Spotify', 18, {
      categoryId: cat.Assinaturas,
      paymentMethodId: pay.credito,
      cardId: inter,
    });
    await fixed('expense', 38900, 'Plano de saúde', 20, { categoryId: cat['Saúde'], paymentMethodId: pay.boleto });
    await fixed('expense', 15000, 'Curso de inglês', 8, {
      categoryId: cat['Educação'],
      paymentMethodId: pay.pix,
      endDate: addMonths(now, 4),
    });
    // A paused one, to see how it looks.
    const disney = await fixed('expense', 3990, 'Disney+ (cancelado)', 22, {
      categoryId: cat.Assinaturas,
      paymentMethodId: pay.credito,
      cardId: inter,
    });
    const rec = await db.recurrence.findUniqueOrThrow({ where: { id: disney.id } });
    await finance.updateRecurrence(userId, rec.id, {
      type: 'expense',
      value: 3990,
      description: rec.description,
      dayOfMonth: 22,
      startDate: rec.startDate,
      endDate: null,
      active: false,
      categoryId: cat.Assinaturas,
      paymentMethodId: pay.credito,
      cardId: inter,
      incomeTypeId: null,
    });

    const plan = (
      value: number,
      installments: number,
      description: string,
      date: string,
      category: string,
      cardId: string,
    ) =>
      add({
        type: 'expense',
        kind: 'parcelado',
        value,
        installments,
        description,
        date,
        categoryId: cat[category],
        paymentMethodId: pay.credito,
        cardId,
      });
    await plan(480000, 12, 'Notebook', addMonths(start, 1, 14), 'Educação', nubank);
    await plan(239900, 10, 'Celular', addMonths(now, -1, 7), 'Outros', nubank);
    await plan(150000, 3, 'Sofá', addMonths(start, 0, 20), 'Moradia', inter); // already paid off
    await plan(320000, 8, 'Passagens de férias', addMonths(now, 0, 2), 'Lazer', nubank);
    await plan(62000, 4, 'Pneus do carro', addMonths(now, -2, 25), 'Transporte', inter);

    // Day-to-day spending.
    const spend = (
      value: number,
      description: string,
      date: string,
      category: string,
      method: string,
      cardId?: string,
    ) =>
      add({
        type: 'expense',
        value,
        description,
        date,
        categoryId: cat[category],
        paymentMethodId: pay[method],
        cardId,
      });
    for (let day = start; day <= now; day = nextDay(day)) {
      const roll = random(),
        wd = weekday(day),
        dom = Number(day.slice(8));
      if (wd === 6) {
        const credit = random() < 0.5;
        await spend(
          between(180, 420),
          pick(['Mercado', 'Atacadão', 'Feira']),
          day,
          'Mercado',
          credit ? 'credito' : 'debito',
          credit ? nubank : c6,
        );
      }
      if (roll < 0.35) await spend(between(14, 45), pick(['Uber', '99', 'Ônibus/metrô']), day, 'Transporte', 'pix');
      if (wd >= 1 && wd <= 5 && roll > 0.45)
        await spend(between(22, 48), pick(['Almoço', 'Marmita', 'Lanche']), day, 'Alimentação', 'vr');
      if ((wd === 5 || wd === 6) && roll > 0.6)
        await spend(
          between(60, 220),
          pick(['Restaurante', 'Bar com amigos', 'Pizza', 'Cinema']),
          day,
          pick(['Alimentação', 'Lazer']),
          'credito',
          nubank,
        );
      if (dom === 6) {
        await spend(between(150, 260), 'Conta de luz', day, 'Moradia', 'pix');
        await spend(between(70, 110), 'Conta de água', day, 'Moradia', 'pix');
      }
      if (dom === 16) await spend(between(180, 280), 'Combustível', day, 'Transporte', 'credito', inter);
      if (dom === 21) await spend(between(120, 190), 'Ração e petshop', day, 'Pets', 'credito', nubank);
      if (dom === 27 && roll > 0.5) await spend(between(40, 160), 'Farmácia', day, 'Saúde', 'debito', c6);
    }

    // One-off income.
    for (const [monthsAgo, value, description] of [
      [4, 180000, 'Site para cliente'],
      [2, 95000, 'Landing page'],
      [0, 120000, 'Consultoria'],
    ] as const) {
      const date = addMonths(now, -monthsAgo, 18);
      await add({ type: 'income', value, description, date: date < now ? date : now, incomeTypeId: type.Freelance });
    }
    await add({
      type: 'income',
      value: 31245,
      description: 'Dividendos',
      date: addMonths(now, -1, 15),
      incomeTypeId: type.Investimentos,
    });
    await add({
      type: 'income',
      value: 30000,
      description: 'Presente de aniversário',
      date: addMonths(now, -3, 9),
      incomeTypeId: type.Presente,
    });

    // Savings boxes; the last one reaches its goal.
    for (const [name, icon, color, goal, deposits] of [
      ['Reserva de emergência', '🛟', '#4fd4ff', 2000000, [200000, 150000, 150000, 100000, 100000, 80000]],
      ['Viagem para o Nordeste', '🏖️', '#ffb84f', 600000, [50000, 70000, 60000, 80000]],
      ['Troca de celular', '📱', '#ff4fd4', 150000, [80000, 70000]],
    ] as const) {
      const box = await finance.saveBox(userId, { name, icon, color, goal });
      for (const value of deposits) await finance.moveBox(userId, box.id, { type: 'deposit', value });
    }

    const result = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const count = await db.transaction.count({ where: { userId } });
    console.log(
      `Conta "${result.username}" populada: ${count} lançamentos, saldo ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(result.balance) / 100)}.`,
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
