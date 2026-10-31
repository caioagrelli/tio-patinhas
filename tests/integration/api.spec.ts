import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../../server/src/app';
import { createDefaults, hashPassword, tokenHash } from '../../server/src/auth';
import { FinanceService } from '../../server/src/finance';
import { Database } from '../../server/src/database';
import { today, addMonths } from '../../server/src/domain';
import { testDatabase } from '../database';

describe('API com PostgreSQL real', () => {
  let database: Awaited<ReturnType<typeof testDatabase>>;
  let app: INestApplication, db: Database;
  let userId: string, cookie: string;
  const actor = (session = cookie) => ({
    get: (path: string) => request(app.getHttpServer()).get('/api' + path).set('Cookie', session),
    post: (path: string) => request(app.getHttpServer()).post('/api' + path).set('Cookie', session).set('X-Requested-With', 'TioPatinhas'),
    patch: (path: string) => request(app.getHttpServer()).patch('/api' + path).set('Cookie', session).set('X-Requested-With', 'TioPatinhas'),
    delete: (path: string) => request(app.getHttpServer()).delete('/api' + path).set('Cookie', session).set('X-Requested-With', 'TioPatinhas'),
  });
  const entry = (value = 10000, type = 'income', date = today()) => actor().post('/transactions').send({ type, value, date, description: 'Lançamento de teste' });
  const balance = async () => (await actor().get('/dashboard').expect(200)).body.user.balance as number;
  async function makeUser() {
    const token = randomBytes(32).toString('hex');
    const user = await db.$transaction(async tx => {
      const row = await tx.user.create({ data: { username: randomUUID(), name: 'Teste', passwordHash: await hashPassword('senha-de-teste') } });
      await createDefaults(tx, row.id);
      await tx.session.create({ data: { userId: row.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 60000) } });
      return row;
    });
    return { id: user.id, cookie: `session=${token}` };
  }
  beforeAll(async () => {
    database = await testDatabase(); process.env.DATABASE_URL = database.url;
    app = await createApp(false); db = app.get(Database);
  });
  beforeEach(async () => { const u = await makeUser(); userId = u.id; cookie = u.cookie; });
  afterAll(async () => { await app?.close(); await database?.close(); });

  it('expõe health check e bloqueia usuários não autenticados', async () => {
    await actor('').get('/health').expect(200);
    await actor('').get('/dashboard').expect(401);
    await actor('').get('/boxes').expect(401);
  });
  it('cadastro cria carteira e cadastros padrão; sessão é HttpOnly', async () => {
    const username = 'cadastro-' + randomUUID();
    const response = await actor('').post('/auth/register').send({ username, name: 'Novo', password: 'senha-de-teste' }).expect(201);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly'); expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict');
    const session = response.headers['set-cookie'][0].split(';')[0];
    const d = await actor(session).get('/dashboard').expect(200);
    expect(d.body.user.balance).toBe(0); expect(d.body.user.passwordHash).toBeUndefined();
    const c = await actor(session).get('/catalog'); expect(c.body.categories).toHaveLength(7); expect(c.body.paymentMethods).toHaveLength(6); expect(c.body.incomeTypes).toHaveLength(5);
    await actor('').post('/auth/register').send({ username, password: 'senha-de-teste' }).expect(400);
  });
  it('login valida credenciais e logout invalida a sessão', async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    await actor('').post('/auth/login').send({ username: user.username, password: 'senha-errada' }).expect(401);
    const login = await actor('').post('/auth/login').send({ username: user.username, password: 'senha-de-teste' }).expect(201);
    const session = login.headers['set-cookie'][0].split(';')[0];
    await actor(session).get('/auth/me').expect(200);
    await actor(session).post('/auth/logout').expect(201);
    await actor(session).get('/auth/me').expect(401);
  });
  it('sessão expirada não autentica', async () => {
    await db.session.updateMany({ where: { userId }, data: { expiresAt: new Date(0) } });
    await actor().get('/dashboard').expect(401);
  });
  it('bloqueia CSRF, incluindo formulário de login', async () => {
    await request(app.getHttpServer()).post('/api/transactions').set('Cookie', cookie).send({ type: 'income', value: 100, date: today() }).expect(403);
    await actor().post('/transactions').set('Sec-Fetch-Site', 'cross-site').send({ type: 'income', value: 100, date: today() }).expect(403);
    await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'teste', password: 'qualquer' }).expect(403);
  });
  it('cria, edita e exclui lançamentos revertendo seus efeitos', async () => {
    await entry(50000).expect(201);
    const expense = await entry(12000, 'expense').expect(201); expect(await balance()).toBe(38000);
    await actor().patch('/transactions/' + expense.body.id).send({ type: 'expense', value: 20000, date: today(), description: 'Editado' }).expect(200);
    expect(await balance()).toBe(30000);
    await actor().delete('/transactions/' + expense.body.id).expect(200); expect(await balance()).toBe(50000);
  });
  it('lançamento futuro não afeta saldo e é aplicado uma única vez', async () => {
    const future = addMonths(today(), 1);
    const result = await entry(12345, 'income', future).expect(201); expect(await balance()).toBe(0);
    await db.transaction.update({ where: { id: result.body.id }, data: { date: today() } });
    expect(await balance()).toBe(12345); expect(await balance()).toBe(12345);
  });
  it('mover a data de um lançamento realizado para o futuro reverte o saldo', async () => {
    const result = await entry(5000).expect(201);
    await actor().patch('/transactions/' + result.body.id).send({ type: 'income', value: 5000, date: addMonths(today(), 1) }).expect(200);
    expect(await balance()).toBe(0);
  });
  it('não perde atualizações com vinte entradas simultâneas', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => entry(1000)));
    expect(results.every(r => r.status === 201)).toBe(true); expect(await balance()).toBe(20000);
  });
  it('isola listagens, alterações e referências de outro usuário', async () => {
    const other = await makeUser(), otherActor = actor(other.cookie);
    const expense = await entry(5000).expect(201);
    expect((await otherActor.get('/transactions')).body).toHaveLength(0);
    await otherActor.delete('/transactions/' + expense.body.id).expect(404);
    await otherActor.patch('/transactions/' + expense.body.id).send({ type: 'income', value: 100, date: today() }).expect(404);
    const category = await db.category.findFirstOrThrow({ where: { userId } });
    await otherActor.post('/transactions').send({ type: 'expense', value: 100, date: today(), categoryId: category.id }).expect(404);
    expect(await balance()).toBe(5000);
  });
  it('rejeita valores inválidos, datas impossíveis e campos injetados', async () => {
    for (const bad of [{ value: -1 }, { value: 1.5 }, { date: '2026-02-30' }, { userId: 'outro' }, { applied: true }]) {
      await actor().post('/transactions').send({ type: 'income', value: 100, date: today(), ...bad }).expect(400);
    }
    expect(await balance()).toBe(0);
  });
  it('filtra lançamentos por período, categoria e tipo', async () => {
    const c = await db.category.findFirstOrThrow({ where: { userId } });
    await actor().post('/transactions').send({ type: 'expense', value: 1000, date: '2026-01-02', categoryId: c.id }).expect(201);
    await entry(2000, 'expense', '2026-02-02').expect(201);
    const result = await actor().get(`/transactions?from=2026-01-01&to=2026-01-31&type=expense&categoryId=${c.id}`).expect(200);
    expect(result.body).toHaveLength(1); expect(result.body[0].value).toBe(1000);
    await actor().get('/transactions?from=2026-02-01&to=2026-01-01').expect(400);
  });
  it('depósito e resgate conservam o patrimônio e registram histórico', async () => {
    await entry(100000);
    const box = await actor().post('/boxes').send({ name: 'Viagem', goal: 20000 }).expect(201);
    await actor().post(`/boxes/${box.body.id}/movements`).send({ type: 'deposit', value: 20000 }).expect(201);
    expect(await balance()).toBe(80000);
    expect((await actor().get('/dashboard')).body.alerts).toHaveLength(1);
    await actor().post(`/boxes/${box.body.id}/dismiss`).expect(201);
    expect((await actor().get('/dashboard')).body.alerts).toHaveLength(0);
    await actor().post(`/boxes/${box.body.id}/movements`).send({ type: 'withdraw', value: 5000 }).expect(201);
    expect(await balance()).toBe(85000);
    await actor().post(`/boxes/${box.body.id}/movements`).send({ type: 'deposit', value: 5000 }).expect(201);
    expect((await actor().get('/dashboard')).body.alerts).toHaveLength(1);
    const boxes = await actor().get('/boxes'); expect(boxes.body[0].movements).toHaveLength(3);
    await actor().delete('/boxes/' + box.body.id).expect(200); expect(await balance()).toBe(100000);
  });
  it('não permite saldo insuficiente e faz rollback completo', async () => {
    await entry(1000);
    const box = await actor().post('/boxes').send({ name: 'Reserva' });
    await actor().post(`/boxes/${box.body.id}/movements`).send({ type: 'deposit', value: 1001 }).expect(400);
    await actor().post(`/boxes/${box.body.id}/movements`).send({ type: 'withdraw', value: 1 }).expect(400);
    expect(await balance()).toBe(1000);
    expect(await db.savingsMovement.count({ where: { boxId: box.body.id } })).toBe(0);
  });
  it('dois depósitos concorrentes não conseguem gastar o mesmo saldo', async () => {
    await entry(10000);
    const box = await actor().post('/boxes').send({ name: 'Concorrência' });
    const results = await Promise.all([1,2].map(() => actor().post(`/boxes/${box.body.id}/movements`).send({ type: 'deposit', value: 8000 })));
    expect(results.map(r => r.status).sort()).toEqual([201,400]); expect(await balance()).toBe(2000);
    expect((await db.savingsBox.findUniqueOrThrow({ where: { id: box.body.id } })).amount).toBe(8000n);
  });
  it('não movimenta, edita, exclui ou dispensa cofrinho de outro', async () => {
    const box = await actor().post('/boxes').send({ name: 'Privado' }); const other = actor((await makeUser()).cookie);
    expect((await other.get('/boxes')).body).toHaveLength(0);
    await other.post(`/boxes/${box.body.id}/movements`).send({ type: 'deposit', value: 100 }).expect(404);
    await other.patch('/boxes/' + box.body.id).send({ name: 'Invadido' }).expect(404);
    await other.delete('/boxes/' + box.body.id).expect(404); await other.post(`/boxes/${box.body.id}/dismiss`).expect(404);
  });
  it('categorias padrão são imutáveis; excluir própria preserva lançamentos', async () => {
    const standard = await db.category.findFirstOrThrow({ where: { userId, isDefault: true } });
    await actor().delete('/settings/categories/' + standard.id).expect(400);
    await actor().patch('/settings/categories/' + standard.id).send({ name: 'Alterada' }).expect(400);
    const c = await actor().post('/settings/categories').send({ name: 'Hobbies' }).expect(201);
    const t = await actor().post('/transactions').send({ type: 'expense', value: 500, date: today(), categoryId: c.body.id });
    await actor().delete('/settings/categories/' + c.body.id).expect(200);
    expect((await db.transaction.findUniqueOrThrow({ where: { id: t.body.id } })).categoryId).toBeNull();
  });
  it('parcelas somam o total e só as vencidas são debitadas', async () => {
    const p = await actor().post('/transactions').send({ type: 'expense', kind: 'parcelado', value: 10000, installments: 3, date: today() }).expect(201);
    const rows = await db.transaction.findMany({ where: { planId: p.body.id }, orderBy: { installmentNumber: 'asc' } });
    expect(rows.map(r => r.value)).toEqual([3334n,3333n,3333n]); expect(await balance()).toBe(-3334);
    expect(rows[1].date).toBe(addMonths(today(), 1));
    await actor().patch('/plans/' + p.body.id).send({ description: 'Compra editada' }).expect(200);
    expect((await actor().get('/plans')).body[0].description).toBe('Compra editada');
    await actor().delete('/plans/' + p.body.id).expect(200); expect(await balance()).toBe(0);
    expect(await db.transaction.count({ where: { planId: p.body.id } })).toBe(0);
  });
  it('recorrência gera meses atrasados e não duplica nem recria exclusões', async () => {
    const start = addMonths(today(), -2);
    const r = await actor().post('/transactions').send({ type: 'expense', kind: 'fixo', value: 15000, date: start, description: 'Academia' }).expect(201);
    expect(await db.transaction.count({ where: { recurrenceId: r.body.id } })).toBe(3);
    expect(await balance()).toBe(-45000);
    await Promise.all(Array.from({ length: 5 }, () => actor().get('/dashboard').expect(200)));
    expect(await db.transaction.count({ where: { recurrenceId: r.body.id } })).toBe(3);
    const generated = await db.transaction.findFirstOrThrow({ where: { recurrenceId: r.body.id } });
    await actor().delete('/transactions/' + generated.id).expect(200);
    await actor().get('/dashboard'); expect(await db.transaction.count({ where: { recurrenceId: r.body.id } })).toBe(2);
  });
  it('pausa recorrência e preserva histórico ao excluí-la', async () => {
    const r = await actor().post('/transactions').send({ type: 'income', kind: 'fixo', value: 5000, date: today(), description: 'Salário' });
    await actor().patch('/recurrences/' + r.body.id).send({ type: 'income', value: 5000, description: 'Salário', dayOfMonth: Number(today().slice(8)), startDate: today(), endDate: null, active: false }).expect(200);
    await app.get(FinanceService).atomic(userId, tx => app.get(FinanceService).process(tx, userId, addMonths(today(), 2)), false);
    expect(await db.transaction.count({ where: { recurrenceId: r.body.id } })).toBe(1);
    await actor().delete('/recurrences/' + r.body.id).expect(200); expect(await balance()).toBe(5000);
    expect(await db.transaction.count({ where: { userId } })).toBe(1);
  });
  it('gera novos meses com data simulada e aplica previstos apenas uma vez', async () => {
    const r = await actor().post('/transactions').send({ type: 'income', kind: 'fixo', value: 5000, date: today() });
    const service = app.get(FinanceService); const future = addMonths(today(), 2);
    await service.atomic(userId, tx => service.process(tx, userId, future), false);
    await service.atomic(userId, tx => service.process(tx, userId, future), false);
    expect(await db.transaction.count({ where: { recurrenceId: r.body.id } })).toBe(3);
    expect(await balance()).toBe(15000);
  });
  it('cartão é obrigatório no crédito e referências de terceiros são bloqueadas', async () => {
    const credit = await db.paymentMethod.findFirstOrThrow({ where: { userId, kind: 'credito' } });
    await actor().post('/transactions').send({ type: 'expense', value: 100, date: today(), paymentMethodId: credit.id }).expect(400);
    const other = await makeUser(); const card = await db.card.create({ data: { userId: other.id, name: 'Outro' } });
    await actor().post('/transactions').send({ type: 'expense', value: 100, date: today(), paymentMethodId: credit.id, cardId: card.id }).expect(404);
    expect(await balance()).toBe(0);
  });
  it('resumo do cartão inclui parcelas futuras no limite', async () => {
    const c = await actor().post('/settings/cards').send({ name: 'Meu cartão', limit: 100000 }).expect(201);
    const credit = await db.paymentMethod.findFirstOrThrow({ where: { userId, kind: 'credito' } });
    await actor().post('/transactions').send({ type: 'expense', kind: 'parcelado', value: 60000, installments: 3, date: today(), cardId: c.body.id, paymentMethodId: credit.id }).expect(201);
    const summary = (await actor().get('/dashboard')).body.cards[0];
    expect(summary.used).toBe(60000); expect(summary.available).toBe(40000); expect(summary.invoice).toBe(20000);
    await actor().delete('/settings/cards/' + c.body.id).expect(200);
    expect((await db.transaction.findFirstOrThrow({ where: { userId } })).cardId).toBeNull();
  });
  it('entrada usa tipo e descarta forma de pagamento e cartão', async () => {
    const type = await db.incomeType.findFirstOrThrow({ where: { userId } });
    const t = await actor().post('/transactions').send({ type: 'income', value: 10000, date: today(), incomeTypeId: type.id, paymentMethodId: 'ignorado', cardId: 'ignorado' }).expect(201);
    expect(t.body.incomeTypeId).toBe(type.id); expect(t.body.paymentMethodId).toBeNull(); expect(t.body.cardId).toBeNull();
  });
  it('cadastros próprios suportam edição e exclusão com isolamento', async () => {
    const own = await actor().post('/settings/income-types').send({ name: 'Bônus' }).expect(201);
    await actor().patch('/settings/income-types/' + own.body.id).send({ name: 'Bônus anual' }).expect(200);
    const other = actor((await makeUser()).cookie);
    await other.patch('/settings/income-types/' + own.body.id).send({ name: 'Alterado' }).expect(404);
    await other.delete('/settings/income-types/' + own.body.id).expect(404);
    await actor().delete('/settings/income-types/' + own.body.id).expect(200);
    await actor().post('/settings/inexistente').send({ name: 'Inválido' }).expect(404);
  });
  it('relatórios agregam categorias e projeção inclui recorrências sem gravar futuros', async () => {
    const c = await db.category.findFirstOrThrow({ where: { userId } });
    await actor().post('/transactions').send({ type: 'expense', value: 2500, date: today(), categoryId: c.id });
    await actor().post('/transactions').send({ type: 'expense', kind: 'fixo', value: 1000, date: today(), categoryId: c.id });
    await entry(5000);
    const r = await actor().get('/reports').expect(200);
    expect(r.body).toMatchObject({ income: 5000, expense: 3500, fixed: 1000, net: 1500 }); expect(r.body.byCategory[0].value).toBe(3500);
    const d = await actor().get('/dashboard'); expect(d.body.projection[0].expense).toBe(1000);
    expect(await db.transaction.count({ where: { userId } })).toBe(3);
  });
});
