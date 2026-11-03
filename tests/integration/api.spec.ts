import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../../server/src/app';
import { createDefaults, hashPassword, tokenHash } from '../../server/src/auth';
import { FinanceService } from '../../server/src/finance';
import { CrabAiService } from '../../server/src/crab-ai';
import { Database } from '../../server/src/database';
import { Mailer } from '../../server/src/mail';
import { today, addMonths } from '../../server/src/domain';
import { testDatabase } from '../database';
import { createHmac } from 'node:crypto';

describe('API com PostgreSQL real', () => {
  let database: Awaited<ReturnType<typeof testDatabase>>;
  let app: INestApplication, db: Database;
  let userId: string, cookie: string;
  const actor = (session = cookie) => ({
    get: (path: string) =>
      request(app.getHttpServer())
        .get('/api' + path)
        .set('Cookie', session),
    post: (path: string) =>
      request(app.getHttpServer())
        .post('/api' + path)
        .set('Cookie', session)
        .set('X-Requested-With', 'CrabFinance'),
    patch: (path: string) =>
      request(app.getHttpServer())
        .patch('/api' + path)
        .set('Cookie', session)
        .set('X-Requested-With', 'CrabFinance'),
    delete: (path: string) =>
      request(app.getHttpServer())
        .delete('/api' + path)
        .set('Cookie', session)
        .set('X-Requested-With', 'CrabFinance'),
  });
  const entry = (value = 10000, type = 'income', date = today()) =>
    actor().post('/transactions').send({ type, value, date, description: 'Lançamento de teste' });
  const balance = async () => (await actor().get('/dashboard').expect(200)).body.user.balance as number;
  async function makeUser() {
    const token = randomBytes(32).toString('hex');
    const user = await db.$transaction(async tx => {
      const row = await tx.user.create({
        data: { username: randomUUID(), name: 'Teste', passwordHash: await hashPassword('senha-de-teste') },
      });
      await createDefaults(tx, row.id);
      await tx.session.create({
        data: { userId: row.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 60000) },
      });
      return row;
    });
    return { id: user.id, cookie: `session=${token}` };
  }
  beforeAll(async () => {
    database = await testDatabase();
    process.env.DATABASE_URL = database.url;
    app = await createApp(false);
    db = app.get(Database);
    // Prisma loads .env, which may enable Turnstile; its check is covered by unit tests.
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
  });
  beforeEach(async () => {
    const u = await makeUser();
    userId = u.id;
    cookie = u.cookie;
  });
  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  it('expõe health check e bloqueia usuários não autenticados', async () => {
    await actor('').get('/health').expect(200);
    await actor('').get('/dashboard').expect(401);
    await actor('').get('/boxes').expect(401);
  });
  describe('login com Google', () => {
    let env: NodeJS.ProcessEnv;
    let fetchSpy: jest.SpiedFunction<typeof fetch>;
    const idToken = (claims: Record<string, unknown>) =>
      ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
    async function start() {
      const response = await request(app.getHttpServer()).get('/api/auth/google').expect(302);
      const location = new URL(response.headers.location);
      const cookie = (response.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('google_oauth='))!;
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      return {
        state: location.searchParams.get('state')!,
        nonce: location.searchParams.get('nonce')!,
        cookie: cookie.split(';')[0],
        location,
      };
    }
    async function finish(flow: Awaited<ReturnType<typeof start>>, claims: Record<string, unknown> = {}) {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id_token: idToken({
              iss: 'https://accounts.google.com',
              aud: 'cliente-teste',
              exp: Date.now() / 1000 + 300,
              nonce: flow.nonce,
              sub: 'google-' + randomUUID(),
              email: 'pessoa@example.com',
              email_verified: true,
              name: 'Pessoa Google',
              ...claims,
            }),
          }),
        ),
      );
      return request(app.getHttpServer())
        .get(`/api/auth/google/callback?code=codigo&state=${flow.state}`)
        .set('Cookie', flow.cookie)
        .expect(302);
    }
    beforeEach(() => {
      env = { ...process.env };
      Object.assign(process.env, {
        GOOGLE_CLIENT_ID: 'cliente-teste',
        GOOGLE_CLIENT_SECRET: 'segredo',
        APP_URL: 'http://localhost:5173',
      });
      fetchSpy = jest.spyOn(global, 'fetch');
    });
    afterEach(() => {
      fetchSpy.mockRestore();
      process.env = { ...env };
    });
    it('redireciona ao Google com PKCE', async () => {
      const { location } = await start();
      expect(location.origin).toBe('https://accounts.google.com');
      expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/auth/google/callback');
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      expect(location.searchParams.get('scope')).toBe('openid email profile');
    });
    it('primeiro login cria carteira e cadastros padrão; segundo reaproveita a conta', async () => {
      const sub = 'google-' + randomUUID();
      const mail = jest.spyOn(app.get(Mailer), 'send').mockResolvedValue(true);
      const first = await finish(await start(), { sub });
      expect(first.headers.location).toBe('/');
      const session = (first.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('session='))!;
      expect(session).toContain('HttpOnly');
      expect(session).toContain('SameSite=Strict');
      const d = await actor(session.split(';')[0]).get('/dashboard').expect(200);
      expect(d.body.user.balance).toBe(0);
      expect(d.body.user.name).toBe('Pessoa Google');
      expect(d.body.user.passwordHash).toBeUndefined();
      const c = await actor(session.split(';')[0]).get('/catalog');
      expect(c.body.categories).toHaveLength(7);
      expect(c.body.paymentMethods).toHaveLength(6);
      expect(c.body.incomeTypes).toHaveLength(5);
      const tokenRequest = fetchSpy.mock.calls[0][1]!.body as URLSearchParams;
      expect(tokenRequest.get('code')).toBe('codigo');
      expect(tokenRequest.get('code_verifier')).toBeTruthy();
      await finish(await start(), { sub, email: 'novo@example.com' });
      expect(await db.user.count({ where: { googleId: sub } })).toBe(1);
      const google = await db.user.findUniqueOrThrow({ where: { googleId: sub } });
      expect(google.email).toBe('novo@example.com');
      // Google already verified the address: one welcome e-mail on the first login, no confirmation link.
      expect(google.emailVerifiedAt).not.toBeNull();
      expect(mail).toHaveBeenCalledTimes(1);
      expect(mail.mock.calls[0][0]).toMatchObject({ subject: expect.stringContaining('Bem-vindo') });
      expect(mail.mock.calls[0][0].text).not.toContain('verify-email');
      mail.mockRestore();
    });
    it('cadastro pelo Google pede o nome de usuário uma única vez', async () => {
      const sub = 'google-' + randomUUID();
      const mail = jest.spyOn(app.get(Mailer), 'send').mockResolvedValue(true);
      const first = await finish(await start(), { sub });
      mail.mockRestore();
      const session = (first.headers['set-cookie'] as unknown as string[])
        .find(c => c.startsWith('session='))!
        .split(';')[0];
      const me = actor(session);
      expect((await me.get('/auth/me').expect(200)).body).toMatchObject({ needsUsername: true });
      expect(
        (await me.post('/auth/username').send({ username: 'fulano@gmail.com' }).expect(400)).body.message,
      ).toContain('sem espaços nem @');
      await me.post('/auth/username').send({ username: 'ab' }).expect(400);
      const taken = 'ocupado' + randomUUID().slice(0, 6);
      await db.user.create({ data: { username: taken, name: 'Outro' } });
      expect(
        (await me.post('/auth/username').send({ username: taken.toUpperCase() }).expect(400)).body.message,
      ).toContain('já existe');
      const chosen = 'pessoa.google' + randomUUID().slice(0, 6);
      expect(
        (
          await me
            .post('/auth/username')
            .send({ username: ' ' + chosen.toUpperCase() + ' ' })
            .expect(201)
        ).body,
      ).toEqual({ username: chosen });
      expect((await me.get('/auth/me').expect(200)).body).toMatchObject({ username: chosen, needsUsername: false });
      await me
        .post('/auth/username')
        .send({ username: chosen + 'x' })
        .expect(400);
    });
    it('recusa state trocado, nonce errado, e-mail não verificado e cancelamento', async () => {
      const flow = await start();
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/auth/google/callback?code=c&state=outro')
            .set('Cookie', flow.cookie)
            .expect(302)
        ).headers.location,
      ).toBe('/?erro=sessao');
      expect(
        (await request(app.getHttpServer()).get(`/api/auth/google/callback?code=c&state=${flow.state}`).expect(302))
          .headers.location,
      ).toBe('/?erro=sessao');
      expect((await finish(await start(), { nonce: 'outro' })).headers.location).toBe('/?erro=google');
      expect((await finish(await start(), { aud: 'outro-cliente' })).headers.location).toBe('/?erro=google');
      expect((await finish(await start(), { email_verified: false })).headers.location).toBe('/?erro=email');
      const cancel = await start();
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/auth/google/callback?error=access_denied&state=${cancel.state}`)
            .set('Cookie', cancel.cookie)
            .expect(302)
        ).headers.location,
      ).toBe('/?erro=cancelado');
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
    it('fica indisponível sem configuração', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      expect((await request(app.getHttpServer()).get('/api/auth/google').expect(302)).headers.location).toBe(
        '/?erro=indisponivel',
      );
      expect((await actor('').get('/auth/config').expect(200)).body.google).toBe(false);
    });
  });
  it('cadastro cria carteira e cadastros padrão; sessão é HttpOnly', async () => {
    const username = 'cadastro-' + randomUUID();
    const response = await actor('')
      .post('/auth/register')
      .send({ username, name: 'Novo', email: username + '@example.com', password: 'senha-de-teste' })
      .expect(201);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict');
    const session = response.headers['set-cookie'][0].split(';')[0];
    const d = await actor(session).get('/dashboard').expect(200);
    expect(d.body.user.balance).toBe(0);
    expect(d.body.user.passwordHash).toBeUndefined();
    const c = await actor(session).get('/catalog');
    expect(c.body.categories).toHaveLength(7);
    expect(c.body.paymentMethods).toHaveLength(6);
    expect(c.body.incomeTypes).toHaveLength(5);
    await actor('')
      .post('/auth/register')
      .send({ username, email: 'outro-' + username + '@example.com', password: 'senha-de-teste' })
      .expect(400);
    expect(
      (
        await actor('')
          .post('/auth/register')
          .send({
            username: 'x' + randomUUID(),
            email: username.toUpperCase() + '@EXAMPLE.COM',
            password: 'senha-de-teste',
          })
          .expect(400)
      ).body.message,
    ).toBe('Este e-mail já está cadastrado.');
    // A username shaped like an e-mail could hijack that e-mail's login.
    await actor('')
      .post('/auth/register')
      .send({ username: 'alguem@example.com', email: 'x' + username + '@example.com', password: 'senha-de-teste' })
      .expect(400);
    await actor('')
      .post('/auth/register')
      .send({ username: 'x' + randomUUID(), password: 'senha-de-teste' })
      .expect(400);
    expect((await db.user.findUniqueOrThrow({ where: { username } })).email).toBe(username + '@example.com');
  });
  it('login valida credenciais e logout invalida a sessão', async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    await actor('').post('/auth/login').send({ username: user.username, password: 'senha-errada' }).expect(401);
    const login = await actor('')
      .post('/auth/login')
      .send({ username: user.username, password: 'senha-de-teste' })
      .expect(201);
    const session = login.headers['set-cookie'][0].split(';')[0];
    await actor(session).get('/auth/me').expect(200);
    await actor(session).post('/auth/logout').expect(201);
    await actor(session).get('/auth/me').expect(401);
  });
  it('conta criada pelo Google não entra por senha', async () => {
    const googleId = 'google-' + randomUUID();
    await db.user.create({ data: { googleId, username: 'google:' + googleId, name: 'Só Google' } });
    await actor('')
      .post('/auth/login')
      .send({ username: 'google:' + googleId, password: 'qualquer-coisa' })
      .expect(401);
  });
  it('sessão expirada não autentica', async () => {
    await db.session.updateMany({ where: { userId }, data: { expiresAt: new Date(0) } });
    await actor().get('/dashboard').expect(401);
  });
  it('bloqueia CSRF, incluindo formulário de login', async () => {
    await request(app.getHttpServer())
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({ type: 'income', value: 100, date: today() })
      .expect(403);
    await actor()
      .post('/transactions')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ type: 'income', value: 100, date: today() })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'teste', password: 'qualquer' })
      .expect(403);
  });
  it('cria, edita e exclui lançamentos revertendo seus efeitos', async () => {
    await entry(50000).expect(201);
    const expense = await entry(12000, 'expense').expect(201);
    expect(await balance()).toBe(38000);
    await actor()
      .patch('/transactions/' + expense.body.id)
      .send({ type: 'expense', value: 20000, date: today(), description: 'Editado' })
      .expect(200);
    expect(await balance()).toBe(30000);
    await actor()
      .delete('/transactions/' + expense.body.id)
      .expect(200);
    expect(await balance()).toBe(50000);
  });
  it('lançamento futuro não afeta saldo e é aplicado uma única vez', async () => {
    const future = addMonths(today(), 1);
    const result = await entry(12345, 'income', future).expect(201);
    expect(await balance()).toBe(0);
    await db.transaction.update({ where: { id: result.body.id }, data: { date: today() } });
    expect(await balance()).toBe(12345);
    expect(await balance()).toBe(12345);
  });
  it('mover a data de um lançamento realizado para o futuro reverte o saldo', async () => {
    const result = await entry(5000).expect(201);
    await actor()
      .patch('/transactions/' + result.body.id)
      .send({ type: 'income', value: 5000, date: addMonths(today(), 1) })
      .expect(200);
    expect(await balance()).toBe(0);
  });
  it('não perde atualizações com vinte entradas simultâneas', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => entry(1000)));
    expect(results.every(r => r.status === 201)).toBe(true);
    expect(await balance()).toBe(20000);
  });
  it('isola listagens, alterações e referências de outro usuário', async () => {
    const other = await makeUser(),
      otherActor = actor(other.cookie);
    const expense = await entry(5000).expect(201);
    expect((await otherActor.get('/transactions')).body).toHaveLength(0);
    await otherActor.delete('/transactions/' + expense.body.id).expect(404);
    await otherActor
      .patch('/transactions/' + expense.body.id)
      .send({ type: 'income', value: 100, date: today() })
      .expect(404);
    const category = await db.category.findFirstOrThrow({ where: { userId } });
    await otherActor
      .post('/transactions')
      .send({ type: 'expense', value: 100, date: today(), categoryId: category.id })
      .expect(404);
    expect(await balance()).toBe(5000);
  });
  it('rejeita valores inválidos, datas impossíveis e campos injetados', async () => {
    for (const bad of [{ value: -1 }, { value: 1.5 }, { date: '2026-02-30' }, { userId: 'outro' }, { applied: true }]) {
      await actor()
        .post('/transactions')
        .send({ type: 'income', value: 100, date: today(), ...bad })
        .expect(400);
    }
    expect(await balance()).toBe(0);
  });
  it('filtra lançamentos por período, categoria e tipo', async () => {
    const c = await db.category.findFirstOrThrow({ where: { userId } });
    await actor()
      .post('/transactions')
      .send({ type: 'expense', value: 1000, date: '2026-01-02', categoryId: c.id })
      .expect(201);
    await entry(2000, 'expense', '2026-02-02').expect(201);
    const result = await actor()
      .get(`/transactions?from=2026-01-01&to=2026-01-31&type=expense&categoryId=${c.id}`)
      .expect(200);
    expect(result.body).toHaveLength(1);
    expect(result.body[0].value).toBe(1000);
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
    const boxes = await actor().get('/boxes');
    expect(boxes.body[0].movements).toHaveLength(3);
    await actor()
      .delete('/boxes/' + box.body.id)
      .expect(200);
    expect(await balance()).toBe(100000);
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
    const results = await Promise.all(
      [1, 2].map(() => actor().post(`/boxes/${box.body.id}/movements`).send({ type: 'deposit', value: 8000 })),
    );
    expect(results.map(r => r.status).sort()).toEqual([201, 400]);
    expect(await balance()).toBe(2000);
    expect((await db.savingsBox.findUniqueOrThrow({ where: { id: box.body.id } })).amount).toBe(8000n);
  });
  it('não movimenta, edita, exclui ou dispensa cofrinho de outro', async () => {
    const box = await actor().post('/boxes').send({ name: 'Privado' });
    const other = actor((await makeUser()).cookie);
    expect((await other.get('/boxes')).body).toHaveLength(0);
    await other.post(`/boxes/${box.body.id}/movements`).send({ type: 'deposit', value: 100 }).expect(404);
    await other
      .patch('/boxes/' + box.body.id)
      .send({ name: 'Invadido' })
      .expect(404);
    await other.delete('/boxes/' + box.body.id).expect(404);
    await other.post(`/boxes/${box.body.id}/dismiss`).expect(404);
  });
  it('categorias padrão são imutáveis; excluir própria preserva lançamentos', async () => {
    const standard = await db.category.findFirstOrThrow({ where: { userId, isDefault: true } });
    await actor()
      .delete('/settings/categories/' + standard.id)
      .expect(400);
    await actor()
      .patch('/settings/categories/' + standard.id)
      .send({ name: 'Alterada' })
      .expect(400);
    const c = await actor().post('/settings/categories').send({ name: 'Hobbies' }).expect(201);
    const t = await actor()
      .post('/transactions')
      .send({ type: 'expense', value: 500, date: today(), categoryId: c.body.id });
    await actor()
      .delete('/settings/categories/' + c.body.id)
      .expect(200);
    expect((await db.transaction.findUniqueOrThrow({ where: { id: t.body.id } })).categoryId).toBeNull();
  });
  it('parcelas somam o total e só as vencidas são debitadas', async () => {
    const p = await actor()
      .post('/transactions')
      .send({ type: 'expense', kind: 'parcelado', value: 10000, installments: 3, date: today() })
      .expect(201);
    const rows = await db.transaction.findMany({ where: { planId: p.body.id }, orderBy: { installmentNumber: 'asc' } });
    expect(rows.map(r => r.value)).toEqual([3334n, 3333n, 3333n]);
    expect(await balance()).toBe(-3334);
    expect(rows[1].date).toBe(addMonths(today(), 1));
    await actor()
      .patch('/plans/' + p.body.id)
      .send({ description: 'Compra editada' })
      .expect(200);
    expect((await actor().get('/plans')).body[0].description).toBe('Compra editada');
    await actor()
      .delete('/plans/' + p.body.id)
      .expect(200);
    expect(await balance()).toBe(0);
    expect(await db.transaction.count({ where: { planId: p.body.id } })).toBe(0);
  });
  it('recorrência gera meses atrasados e não duplica nem recria exclusões', async () => {
    const start = addMonths(today(), -2);
    const r = await actor()
      .post('/transactions')
      .send({ type: 'expense', kind: 'fixo', value: 15000, date: start, description: 'Academia' })
      .expect(201);
    expect(await db.transaction.count({ where: { recurrenceId: r.body.id } })).toBe(3);
    expect(await balance()).toBe(-45000);
    await Promise.all(Array.from({ length: 5 }, () => actor().get('/dashboard').expect(200)));
    expect(await db.transaction.count({ where: { recurrenceId: r.body.id } })).toBe(3);
    const generated = await db.transaction.findFirstOrThrow({ where: { recurrenceId: r.body.id } });
    await actor()
      .delete('/transactions/' + generated.id)
      .expect(200);
    await actor().get('/dashboard');
    expect(await db.transaction.count({ where: { recurrenceId: r.body.id } })).toBe(2);
  });
  it('pausa recorrência e preserva histórico ao excluí-la', async () => {
    const r = await actor()
      .post('/transactions')
      .send({ type: 'income', kind: 'fixo', value: 5000, date: today(), description: 'Salário' });
    await actor()
      .patch('/recurrences/' + r.body.id)
      .send({
        type: 'income',
        value: 5000,
        description: 'Salário',
        dayOfMonth: Number(today().slice(8)),
        startDate: today(),
        endDate: null,
        active: false,
      })
      .expect(200);
    await app
      .get(FinanceService)
      .atomic(userId, tx => app.get(FinanceService).process(tx, userId, addMonths(today(), 2)), false);
    expect(await db.transaction.count({ where: { recurrenceId: r.body.id } })).toBe(1);
    await actor()
      .delete('/recurrences/' + r.body.id)
      .expect(200);
    expect(await balance()).toBe(5000);
    expect(await db.transaction.count({ where: { userId } })).toBe(1);
  });
  it('gera novos meses com data simulada e aplica previstos apenas uma vez', async () => {
    const r = await actor().post('/transactions').send({ type: 'income', kind: 'fixo', value: 5000, date: today() });
    const service = app.get(FinanceService);
    const future = addMonths(today(), 2);
    await service.atomic(userId, tx => service.process(tx, userId, future), false);
    await service.atomic(userId, tx => service.process(tx, userId, future), false);
    expect(await db.transaction.count({ where: { recurrenceId: r.body.id } })).toBe(3);
    expect(await balance()).toBe(15000);
  });
  it('cartão é obrigatório no crédito e referências de terceiros são bloqueadas', async () => {
    const credit = await db.paymentMethod.findFirstOrThrow({ where: { userId, kind: 'credito' } });
    await actor()
      .post('/transactions')
      .send({ type: 'expense', value: 100, date: today(), paymentMethodId: credit.id })
      .expect(400);
    const other = await makeUser();
    const card = await db.card.create({ data: { userId: other.id, name: 'Outro' } });
    await actor()
      .post('/transactions')
      .send({ type: 'expense', value: 100, date: today(), paymentMethodId: credit.id, cardId: card.id })
      .expect(404);
    expect(await balance()).toBe(0);
  });
  it('resumo do cartão inclui parcelas futuras no limite', async () => {
    const c = await actor().post('/settings/cards').send({ name: 'Meu cartão', limit: 100000 }).expect(201);
    const credit = await db.paymentMethod.findFirstOrThrow({ where: { userId, kind: 'credito' } });
    await actor()
      .post('/transactions')
      .send({
        type: 'expense',
        kind: 'parcelado',
        value: 60000,
        installments: 3,
        date: today(),
        cardId: c.body.id,
        paymentMethodId: credit.id,
      })
      .expect(201);
    const summary = (await actor().get('/dashboard')).body.cards[0];
    expect(summary.used).toBe(60000);
    expect(summary.available).toBe(40000);
    expect(summary.invoice).toBe(20000);
    await actor()
      .delete('/settings/cards/' + c.body.id)
      .expect(200);
    expect((await db.transaction.findFirstOrThrow({ where: { userId } })).cardId).toBeNull();
  });
  it('entrada usa tipo e descarta forma de pagamento e cartão', async () => {
    const type = await db.incomeType.findFirstOrThrow({ where: { userId } });
    const t = await actor()
      .post('/transactions')
      .send({
        type: 'income',
        value: 10000,
        date: today(),
        incomeTypeId: type.id,
        paymentMethodId: 'ignorado',
        cardId: 'ignorado',
      })
      .expect(201);
    expect(t.body.incomeTypeId).toBe(type.id);
    expect(t.body.paymentMethodId).toBeNull();
    expect(t.body.cardId).toBeNull();
  });
  it('cadastros próprios suportam edição e exclusão com isolamento', async () => {
    const own = await actor().post('/settings/income-types').send({ name: 'Bônus' }).expect(201);
    await actor()
      .patch('/settings/income-types/' + own.body.id)
      .send({ name: 'Bônus anual' })
      .expect(200);
    const other = actor((await makeUser()).cookie);
    await other
      .patch('/settings/income-types/' + own.body.id)
      .send({ name: 'Alterado' })
      .expect(404);
    await other.delete('/settings/income-types/' + own.body.id).expect(404);
    await actor()
      .delete('/settings/income-types/' + own.body.id)
      .expect(200);
    await actor().post('/settings/inexistente').send({ name: 'Inválido' }).expect(404);
  });
  it('relatórios agregam categorias e projeção inclui recorrências sem gravar futuros', async () => {
    const c = await db.category.findFirstOrThrow({ where: { userId } });
    await actor().post('/transactions').send({ type: 'expense', value: 2500, date: today(), categoryId: c.id });
    await actor()
      .post('/transactions')
      .send({ type: 'expense', kind: 'fixo', value: 1000, date: today(), categoryId: c.id });
    await entry(5000);
    const r = await actor().get('/reports').expect(200);
    expect(r.body).toMatchObject({ income: 5000, expense: 3500, fixed: 1000, net: 1500 });
    expect(r.body.byCategory[0].value).toBe(3500);
    const d = await actor().get('/dashboard');
    expect(d.body.projection[0].expense).toBe(1000);
    expect(await db.transaction.count({ where: { userId } })).toBe(3);
  });
  describe('páginas no formato do Django', () => {
    const methods = async () =>
      (await actor().get('/catalog')).body as {
        paymentMethods: { id: string; kind: string }[];
        categories: { id: string; name: string }[];
        incomeTypes: { id: string }[];
      };
    it('avisa limite estourado e saldo negativo; débito não exige cartão', async () => {
      const { paymentMethods } = await methods();
      const credit = paymentMethods.find(m => m.kind === 'credito')!,
        debit = paymentMethods.find(m => m.kind === 'debito')!;
      const card = (
        await actor()
          .post('/settings/cards')
          .send({ name: 'Teste', limit: 10000, closingDay: null, dueDay: null })
          .expect(201)
      ).body;
      const t = await actor()
        .post('/transactions')
        .send({ type: 'expense', value: 15000, date: today(), paymentMethodId: credit.id, cardId: card.id })
        .expect(201);
      expect(t.body.warnings).toEqual([
        'Atenção: o cartão "Teste" passou do limite em R$\u00a050,00.',
        'Atenção: seu saldo ficou negativo.',
      ]);
      const d = await actor()
        .post('/transactions')
        .send({ type: 'expense', value: 100, date: today(), paymentMethodId: debit.id })
        .expect(201);
      expect(d.body.cardId).toBeNull();
    });
    it('finanças traz resumo, dicas, projeção acumulada e próximos 30 dias', async () => {
      await entry(100000);
      await actor()
        .post('/transactions')
        .send({ type: 'income', kind: 'fixo', value: 200000, date: today(), description: 'Salário' })
        .expect(201);
      await actor()
        .post('/transactions')
        .send({ type: 'expense', kind: 'fixo', value: 150000, date: today(), description: 'Aluguel' })
        .expect(201);
      await actor()
        .post('/transactions')
        .send({ type: 'expense', kind: 'parcelado', value: 30000, installments: 3, date: today(), description: 'Fone' })
        .expect(201);
      const f = (await actor().get('/finance').expect(200)).body;
      expect(f.balance).toBe(100000 + 200000 - 150000 - 10000);
      expect(f.commitment).toBe(75);
      expect(f.tips.map((t: { text: string }) => t.text)).toContain(
        'Seus gastos fixos consomem 75% das suas entradas fixas. O recomendado é ficar abaixo de 50%.',
      );
      expect(f.activePlans[0]).toMatchObject({
        description: 'Fone',
        paid: 1,
        remaining: 20000,
        installmentValue: 10000,
      });
      expect(f.projection[0]).toMatchObject({
        income: 200000,
        expense: 160000,
        installments: 10000,
        fixed: 150000,
        balance: f.projectedBalance + 40000,
      });
      expect(f.projection[1].balance).toBe(f.projection[0].balance + 40000);
      expect(
        f.upcoming.some(
          (u: { description: string; installmentNumber: number }) =>
            u.description === 'Fone' && u.installmentNumber === 2,
        ),
      ).toBe(true);
      expect(await db.transaction.count({ where: { userId } })).toBe(6);
    });
    it('pausar ou excluir um fixo remove só os previstos', async () => {
      const day = Number(today().slice(8));
      if (day === Number(addMonths(today(), 0, 31).slice(8))) return; // last day of the month: no future day left this month
      const r = await actor()
        .post('/transactions')
        .send({
          type: 'expense',
          kind: 'fixo',
          value: 1000,
          date: addMonths(today(), 0, day + 1),
          description: 'Streaming',
        })
        .expect(201);
      expect(await db.transaction.count({ where: { recurrenceId: r.body.id, applied: false } })).toBe(1);
      await actor()
        .patch('/recurrences/' + r.body.id)
        .send({
          type: 'expense',
          value: 1000,
          description: 'Streaming',
          dayOfMonth: day + 1,
          startDate: r.body.startDate,
          endDate: null,
          active: false,
        })
        .expect(200);
      expect(await db.transaction.count({ where: { recurrenceId: r.body.id } })).toBe(0);
    });
    it('editar parcelamento aplica categoria, forma e cartão em todas as parcelas', async () => {
      const { paymentMethods, categories } = await methods();
      const credit = paymentMethods.find(m => m.kind === 'credito')!;
      const card = (
        await actor().post('/settings/cards').send({ name: 'Plano', limit: null, closingDay: 10, dueDay: 20 })
      ).body;
      const p = await actor()
        .post('/transactions')
        .send({ type: 'expense', kind: 'parcelado', value: 9000, installments: 3, date: today() })
        .expect(201);
      await actor()
        .patch('/plans/' + p.body.id)
        .send({ description: 'Sofá', categoryId: categories[0].id, paymentMethodId: credit.id, cardId: null })
        .expect(400);
      await actor()
        .patch('/plans/' + p.body.id)
        .send({ description: 'Sofá', categoryId: categories[0].id, paymentMethodId: credit.id, cardId: card.id })
        .expect(200);
      const rows = await db.transaction.findMany({ where: { planId: p.body.id } });
      expect(
        rows.every(r => r.description === 'Sofá' && r.categoryId === categories[0].id && r.cardId === card.id),
      ).toBe(true);
    });
    it('filtra por modalidade e tipo de entrada; detalhe é isolado por usuário', async () => {
      const { incomeTypes } = await methods();
      const t = await actor()
        .post('/transactions')
        .send({ type: 'income', value: 500, date: today(), incomeTypeId: incomeTypes[0].id })
        .expect(201);
      await actor().post('/transactions').send({ type: 'income', kind: 'fixo', value: 700, date: today() }).expect(201);
      expect((await actor().get('/transactions?type=income&kind=fixo')).body).toHaveLength(1);
      expect((await actor().get('/transactions?type=income&incomeTypeId=' + incomeTypes[0].id)).body).toHaveLength(1);
      expect(
        (
          await actor()
            .get('/transactions/' + t.body.id)
            .expect(200)
        ).body.incomeType.id,
      ).toBe(incomeTypes[0].id);
      await actor((await makeUser()).cookie)
        .get('/transactions/' + t.body.id)
        .expect(404);
    });
    it('relatórios agrupam por modalidade, forma, cartão e tipo de entrada', async () => {
      const { paymentMethods } = await methods();
      const pix = paymentMethods.find(m => m.kind === 'pix')!;
      await actor()
        .post('/transactions')
        .send({ type: 'expense', value: 3000, date: today(), paymentMethodId: pix.id });
      await actor()
        .post('/transactions')
        .send({ type: 'expense', kind: 'parcelado', value: 2000, installments: 2, date: today() });
      await entry(4000);
      const r = (await actor().get('/reports').expect(200)).body;
      expect(r.byKind.map((k: { name: string; count: number }) => [k.name, k.count])).toEqual([
        ['À vista', 1],
        ['Parcelado', 2],
      ]);
      expect(r.byPaymentMethod[0]).toMatchObject({ name: 'Pix', value: 3000, percent: 60 });
      expect(r.byIncomeType[0]).toMatchObject({ name: 'Sem tipo', value: 4000, percent: 100 });
      expect(r.evolution).toHaveLength(6);
      expect(r.evolution[5].income).toBe(4000);
    });
  });
  describe('pagamentos com Mercado Pago (simulado)', () => {
    let env: NodeJS.ProcessEnv;
    let fetchSpy: jest.SpiedFunction<typeof fetch>;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    beforeEach(() => {
      env = { ...process.env };
      Object.assign(process.env, { MERCADOPAGO_ACCESS_TOKEN: 'TEST-token', APP_URL: 'http://localhost:5173' });
      delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
      fetchSpy = jest.spyOn(global, 'fetch');
    });
    afterEach(() => {
      fetchSpy.mockRestore();
      process.env = { ...env };
    });
    async function buy(plan: string, orderStatus = 'processed') {
      fetchSpy.mockResolvedValueOnce(
        json({ id: 'ORD-' + plan + '-' + randomUUID(), status: 'created', checkout_url: 'https://mp.test/checkout' }),
      );
      const r = await actor().post('/billing/checkout').send({ plan, email: 'cliente@example.com' }).expect(201);
      expect(r.body.url).toBe('https://mp.test/checkout');
      const payment = await db.payment.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: 'desc' } });
      fetchSpy.mockResolvedValueOnce(
        json({ id: payment.providerId, status: orderStatus, status_detail: 'accredited' }),
      );
      const back = await request(app.getHttpServer())
        .get('/api/billing/retorno?ref=' + payment.reference)
        .expect(302);
      return { payment, back: back.headers.location as string };
    }
    it('anual cria o pedido certo e a volta ativa o plano uma única vez', async () => {
      const { payment, back } = await buy('anual');
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.mercadopago.com/v1/orders');
      const body = JSON.parse(String(init!.body));
      expect(body).toMatchObject({
        total_amount: '202.80',
        processing_mode: 'manual',
        payer: { email: 'cliente@example.com' },
        config: { payment_method: { max_installments: 12 } },
      });
      expect(body.config.online.success_url).toBe('http://localhost:5173/api/billing/retorno?ref=' + payment.reference);
      expect(back).toBe('http://localhost:5173/#/planos/resultado?status=aprovado&plano=anual');
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.plan).toBe('anual');
      const months = (user.planExpiresAt!.getTime() - Date.now()) / (30.4 * 86_400_000);
      expect(months).toBeGreaterThan(11.5);
      expect(months).toBeLessThan(12.5);
      fetchSpy.mockResolvedValueOnce(json({ id: payment.providerId, status: 'processed' }));
      await request(app.getHttpServer())
        .get('/api/billing/retorno?ref=' + payment.reference)
        .expect(302);
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).planExpiresAt).toEqual(user.planExpiresAt);
      expect((await actor().get('/billing/status')).body).toMatchObject({ status: 'pago', plan: 'anual' });
    });
    it('vitalício não expira; pedido não pago fica pendente', async () => {
      const pending = await buy('vitalicio', 'created');
      expect(pending.back).toContain('status=pendente');
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).plan).toBeNull();
      await buy('vitalicio');
      expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({
        plan: 'vitalicio',
        planExpiresAt: null,
      });
      await actor().post('/billing/checkout').send({ plan: 'anual', email: 'cliente@example.com' }).expect(400);
    });
    it('recibo vai sempre para o e-mail da conta', async () => {
      await db.user.update({ where: { id: userId }, data: { email: 'conta@example.com' } });
      fetchSpy.mockResolvedValueOnce(
        json({ id: 'ORD-email', status: 'created', checkout_url: 'https://mp.test/checkout' }),
      );
      await actor().post('/billing/checkout').send({ plan: 'anual', email: 'outro@example.com' }).expect(201);
      expect(JSON.parse(String(fetchSpy.mock.calls[0][1]!.body)).payer.email).toBe('conta@example.com');
      await db.user.update({ where: { id: userId }, data: { email: null } });
      await actor().post('/billing/checkout').send({ plan: 'anual' }).expect(400);
    });
    it('mensal cria assinatura com cobrança recorrente', async () => {
      fetchSpy.mockResolvedValueOnce(json({ id: 'PRE-1', status: 'pending', init_point: 'https://mp.test/assinar' }));
      expect(
        (await actor().post('/billing/checkout').send({ plan: 'mensal', email: 'cliente@example.com' }).expect(201))
          .body.url,
      ).toBe('https://mp.test/assinar');
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.mercadopago.com/preapproval');
      expect(JSON.parse(String(init!.body)).auto_recurring).toEqual({
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: 26.9,
        currency_id: 'BRL',
      });
    });
    it('webhook dispensa o cabeçalho de CSRF e exige assinatura válida quando há segredo', async () => {
      const { payment } = await buy('anual', 'created');
      process.env.MERCADOPAGO_WEBHOOK_SECRET = 'segredo-webhook';
      const hook = () =>
        request(app.getHttpServer())
          .post('/api/billing/webhook?data.id=' + payment.providerId + '&type=order')
          .set('x-request-id', 'req-1');
      await hook()
        .set('x-signature', 'ts=1,v1=errado')
        .send({ type: 'order', data: { id: payment.providerId } })
        .expect(401);
      const ts = String(Date.now()),
        manifest = `id:${payment.providerId!.toLowerCase()};request-id:req-1;ts:${ts};`;
      const v1 = createHmac('sha256', 'segredo-webhook').update(manifest).digest('hex');
      fetchSpy.mockResolvedValueOnce(json({ id: payment.providerId, status: 'processed' }));
      await hook()
        .set('x-signature', `ts=${ts},v1=${v1}`)
        .send({ type: 'order', data: { id: payment.providerId } })
        .expect(200);
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).plan).toBe('anual');
    });
    it('em produção o webhook sem segredo configurado é recusado', async () => {
      const { payment } = await buy('anual', 'created');
      delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
      fetchSpy.mockClear();
      const env = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await request(app.getHttpServer())
          .post('/api/billing/webhook')
          .send({ type: 'order', data: { id: payment.providerId } })
          .expect(401);
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = env;
      }
    });
    it('renovação mensal aprovada estende o plano uma única vez por cobrança', async () => {
      delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
      const until = new Date(Date.now() + 5 * 86_400_000);
      await db.user.update({ where: { id: userId }, data: { plan: 'mensal', planExpiresAt: until } });
      await db.payment.create({
        data: {
          userId,
          plan: 'mensal',
          kind: 'subscription',
          reference: 'mensal-ref',
          providerId: 'PRE-9',
          amount: 2690n,
          status: 'authorized',
        },
      });
      const charge = () =>
        json({ id: 77, preapproval_id: 'PRE-9', status: 'processed', payment: { status: 'approved' } });
      const hook = () =>
        request(app.getHttpServer())
          .post('/api/billing/webhook')
          .send({ type: 'subscription_authorized_payment', data: { id: '77' } })
          .expect(200);
      fetchSpy.mockResolvedValueOnce(charge());
      await hook();
      fetchSpy.mockResolvedValueOnce(charge());
      await hook();
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      const expected = new Date(until);
      expected.setMonth(expected.getMonth() + 1);
      expect(user.planExpiresAt!.getTime()).toBe(expected.getTime());
      expect(await db.payment.count({ where: { userId, kind: 'renewal' } })).toBe(1);
    });
    it('exclusão de conta (LGPD) pede confirmação e senha e protege admins', async () => {
      await actor().delete('/auth/account').send({ confirmation: 'sim', password: 'senha-de-teste' }).expect(400);
      expect(
        (await actor().delete('/auth/account').send({ confirmation: 'EXCLUIR', password: 'errada' }).expect(401)).body
          .message,
      ).toBe('Senha incorreta.');
      await db.user.update({ where: { id: userId }, data: { isAdmin: true } });
      await actor().delete('/auth/account').send({ confirmation: 'EXCLUIR', password: 'senha-de-teste' }).expect(400);
      expect(await db.user.count({ where: { id: userId } })).toBe(1);
      await request(app.getHttpServer())
        .delete('/api/auth/account')
        .set('X-Requested-With', 'CrabFinance')
        .send({ confirmation: 'EXCLUIR' })
        .expect(401);
    });
    it('exclusão de conta apaga os dados, cancela a assinatura e mantém as vendas anônimas', async () => {
      await entry(5000).expect(201);
      await db.aiUsage.create({
        data: {
          userId,
          model: 'm',
          rounds: 1,
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costMicroUsd: 10,
        },
      });
      await db.aiConversation.create({
        data: { userId, title: 'Oi', messages: { create: { role: 'user', content: 'Oi' } } },
      });
      const sale = await db.payment.create({
        data: {
          userId,
          plan: 'mensal',
          kind: 'subscription',
          reference: 'ref-' + randomUUID(),
          providerId: 'PRE-' + randomUUID(),
          amount: 2690n,
          status: 'authorized',
          appliedAt: new Date(),
        },
      });
      fetchSpy.mockResolvedValueOnce(json({ message: 'erro' }, 500));
      await actor().delete('/auth/account').send({ confirmation: 'excluir', password: 'senha-de-teste' }).expect(503);
      expect(await db.user.count({ where: { id: userId } })).toBe(1);
      fetchSpy.mockResolvedValueOnce(json({ id: sale.providerId, status: 'cancelled' }));
      const r = await actor()
        .delete('/auth/account')
        .send({ confirmation: 'excluir', password: 'senha-de-teste' })
        .expect(200);
      expect(String(r.headers['set-cookie'])).toContain('session=;');
      const [url, init] = fetchSpy.mock.calls.at(-1)!;
      expect(url).toBe('https://api.mercadopago.com/preapproval/' + sale.providerId);
      expect(init!.method).toBe('PUT');
      expect(await db.user.count({ where: { id: userId } })).toBe(0);
      expect(await db.transaction.count({ where: { userId } })).toBe(0);
      expect(await db.aiConversation.count({ where: { userId } })).toBe(0);
      expect(await db.session.count({ where: { userId } })).toBe(0);
      expect(await db.payment.findUniqueOrThrow({ where: { id: sale.id } })).toMatchObject({
        userId: null,
        status: 'cancelled',
      });
      expect(await db.aiUsage.count({ where: { userId: null, costMicroUsd: 10 } })).toBeGreaterThan(0);
      await actor().get('/auth/me').expect(401);
      const overview = await actor(
        (
          await (async () => {
            const a = await makeUser();
            await db.user.update({ where: { id: a.id }, data: { isAdmin: true } });
            return a;
          })()
        ).cookie,
      )
        .get('/admin/overview')
        .expect(200);
      expect(overview.body.recent.find((p: { id: string }) => p.id === sale.id).user).toBeNull();
      // Anonymous rows stay in the shared test database: remove them so other tests see clean revenue.
      await db.payment.delete({ where: { id: sale.id } });
      await db.aiUsage.deleteMany({ where: { userId: null } });
    });
    it('conta só com Google é excluída apenas com a confirmação', async () => {
      await db.user.update({ where: { id: userId }, data: { passwordHash: null, googleId: 'g-' + randomUUID() } });
      expect((await actor().get('/auth/me').expect(200)).body).toMatchObject({ hasPassword: false });
      expect((await actor().get('/auth/me').expect(200)).body.passwordHash).toBeUndefined();
      await actor().delete('/auth/account').send({ confirmation: 'EXCLUIR' }).expect(200);
      expect(await db.user.count({ where: { id: userId } })).toBe(0);
    });
    it('depois do teste grátis sem plano a API financeira responde 402', async () => {
      await db.user.update({ where: { id: userId }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
      expect((await actor().get('/dashboard').expect(402)).body.message).toContain('teste gratuito terminou');
      expect((await actor().get('/auth/me').expect(200)).body.access.status).toBe('expirado');
      await db.user.update({
        where: { id: userId },
        data: { plan: 'mensal', planExpiresAt: new Date(Date.now() + 86_400_000) },
      });
      await actor().get('/dashboard').expect(200);
    });
  });
  describe('painel do admin', () => {
    async function admin() {
      const a = await makeUser();
      await db.user.update({ where: { id: a.id }, data: { isAdmin: true } });
      return { ...a, actor: actor(a.cookie) };
    }
    it('bloqueia quem não é admin', async () => {
      await actor().get('/admin/overview').expect(403);
      await actor()
        .patch('/admin/users/' + userId)
        .send({ plan: 'vitalicio' })
        .expect(403);
      await actor('').get('/admin/users').expect(401);
    });
    it('métricas contam só vendas confirmadas e a busca encontra o usuário', async () => {
      const { actor: adm } = await admin();
      await db.payment.createMany({
        data: [
          {
            userId,
            plan: 'anual',
            kind: 'order',
            reference: 'r-' + randomUUID(),
            amount: 20280n,
            status: 'processed',
            appliedAt: new Date(),
          },
          {
            userId,
            plan: 'vitalicio',
            kind: 'order',
            reference: 'r-' + randomUUID(),
            amount: 26990n,
            status: 'created',
          },
        ],
      });
      const o = (await adm.get('/admin/overview').expect(200)).body;
      expect(o.revenue.total).toBeGreaterThanOrEqual(20280);
      expect(
        o.recent.some((r: { user: { id: string }; amount: number }) => r.user.id === userId && r.amount === 20280),
      ).toBe(true);
      expect(
        o.recent.some((r: { amount: number; user: { id: string } }) => r.user.id === userId && r.amount === 26990),
      ).toBe(false);
      const me = await db.user.findUniqueOrThrow({ where: { id: userId } });
      const found = (await adm.get('/admin/users?q=' + me.username.slice(0, 12)).expect(200)).body;
      expect(found.map((u: { id: string }) => u.id)).toContain(userId);
    });
    it('edita plano, ajusta validade, encerra acesso e desativa a conta', async () => {
      const { actor: adm, id: adminId } = await admin();
      await adm
        .patch('/admin/users/' + userId)
        .send({ plan: 'anual' })
        .expect(400);
      const until = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
      expect(
        (
          await adm
            .patch('/admin/users/' + userId)
            .send({ plan: 'anual', planExpiresAt: until })
            .expect(200)
        ).body.access,
      ).toMatchObject({ status: 'pago', plan: 'anual' });
      const before = (await db.user.findUniqueOrThrow({ where: { id: userId } })).planExpiresAt!.getTime();
      await adm.post(`/admin/users/${userId}/adjust`).send({ days: 30 }).expect(201);
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).planExpiresAt!.getTime() - before).toBe(
        30 * 86_400_000,
      );
      await adm.post(`/admin/users/${userId}/end-access`).expect(201);
      expect((await actor().get('/auth/me').expect(200)).body.access.status).toBe('teste');
      expect(
        (
          await adm
            .patch('/admin/users/' + userId)
            .send({ plan: 'vitalicio' })
            .expect(200)
        ).body,
      ).toMatchObject({ plan: 'vitalicio', planExpiresAt: null });
      await adm.post(`/admin/users/${userId}/adjust`).send({ days: 5 }).expect(400);
      await adm
        .patch('/admin/users/' + userId)
        .send({ active: false })
        .expect(200);
      await actor().get('/dashboard').expect(401);
      await adm
        .patch('/admin/users/' + adminId)
        .send({ active: false })
        .expect(400);
    });
    it('admin entra mesmo com o teste vencido', async () => {
      const a = await admin();
      await db.user.update({ where: { id: a.id }, data: { createdAt: new Date(Date.now() - 60 * 86_400_000) } });
      await a.actor.get('/dashboard').expect(200);
    });
  });
  describe('Crab AI', () => {
    let env: NodeJS.ProcessEnv;
    beforeEach(() => {
      env = { ...process.env };
    });
    afterEach(() => {
      process.env = { ...env };
      jest.restoreAllMocks();
    });
    it('ferramentas leem só os dados de quem pergunta', async () => {
      await entry(123456);
      const other = await makeUser();
      await actor(other.cookie)
        .post('/transactions')
        .send({ type: 'expense', value: 9999, date: today(), description: 'Segredo do outro' })
        .expect(201);
      const service = app.get(CrabAiService);
      const mine = await service.runTool(userId, 'lancamentos', {});
      expect(mine.content).toContain('R$\u00a01.234,56');
      expect(mine.content).not.toContain('Segredo do outro');
      expect((await service.runTool(userId, 'visao_geral', {})).content).toContain(
        '"saldo_disponivel":"R$\u00a01.234,56"',
      );
      expect((await service.runTool(userId, 'lancamentos', { limite: 9999 })).isError).toBe(true);
      expect((await service.runTool(userId, 'apagar_tudo', {})).isError).toBe(true);
    });
    it('sem chave da API responde que não está configurado', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect((await actor().get('/ai/status').expect(200)).body).toEqual({ enabled: false });
      await actor().post('/ai/chat').send({ message: 'Oi' }).expect(503);
    });
    it('executa as ferramentas pedidas e transmite a resposta', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      await entry(50000);
      const service = app.get(CrabAiService);
      const requests: { messages: { role: string; content: unknown }[] }[] = [];
      const usage = {
        input_tokens: 2000,
        output_tokens: 300,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 0,
      };
      const turns = [
        {
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'visao_geral', input: {} }],
          text: [] as string[],
          usage,
        },
        {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Seu saldo é **R$ 500,00**.' }],
          text: ['Seu saldo é ', '**R$ 500,00**.'],
          usage,
        },
      ];
      const fake = {
        beta: {
          messages: {
            stream: (params: { messages: { role: string; content: unknown }[] }) => {
              requests.push(JSON.parse(JSON.stringify(params)));
              const turn = turns[requests.length - 1];
              const handlers: ((t: string) => void)[] = [];
              return {
                on: (_e: string, fn: (t: string) => void) => {
                  handlers.push(fn);
                },
                finalMessage: async () => {
                  turn.text.forEach(t => handlers.forEach(h => h(t)));
                  return turn;
                },
              };
            },
          },
        },
      };
      jest.spyOn(service as unknown as { anthropic: () => unknown }, 'anthropic').mockReturnValue(fake);
      const r = await actor().post('/ai/chat').send({ message: 'Qual meu saldo?' }).expect(200);
      expect(r.headers['content-type']).toContain('text/event-stream');
      const events = String(r.text)
        .split('\n\n')
        .filter(Boolean)
        .map(e => JSON.parse(e.slice(6)));
      const conv = await db.aiConversation.findFirstOrThrow({ where: { userId } });
      expect(events).toEqual([
        { type: 'conversation', id: conv.id, title: 'Qual meu saldo?' },
        { type: 'tool', label: 'Olhando seu saldo e o resumo do mês' },
        { type: 'text', text: 'Seu saldo é ' },
        { type: 'text', text: '**R$ 500,00**.' },
        { type: 'done', messageId: expect.any(String) },
      ]);
      expect(
        (
          await actor()
            .get('/ai/conversations/' + conv.id)
            .expect(200)
        ).body.messages,
      ).toMatchObject([
        { role: 'user', content: 'Qual meu saldo?' },
        { role: 'assistant', content: 'Seu saldo é **R$ 500,00**.' },
      ]);
      const toolResult = (requests[1].messages.at(-1)!.content as { type: string; content: string }[])[0];
      expect(toolResult.type).toBe('tool_result');
      expect(toolResult.content).toContain('R$\u00a0500,00');
      await actor()
        .post('/ai/chat')
        .send({ messages: [{ role: 'user', content: 'formato antigo' }] })
        .expect(400);
      expect((requests[0] as unknown as { model: string; fallbacks?: unknown }).model).toBe('claude-haiku-5-5');
      expect((requests[0] as unknown as { fallbacks?: unknown }).fallbacks).toBeUndefined();
      // 2 rounds × (2000 in × $0.10 + 300 out × $0.50 + 1000 cache read × $0.01) per million tokens
      const row = await db.aiUsage.findFirstOrThrow({ where: { userId } });
      expect(row).toMatchObject({
        model: 'claude-haiku-5-5',
        rounds: 2,
        inputTokens: 4000,
        outputTokens: 600,
        cacheReadTokens: 2000,
        costMicroUsd: 720,
      });
      const u = (await actor().get('/ai/usage').expect(200)).body;
      expect(u).toMatchObject({ percent: 0.7, blocked: false, unlimited: false });
      expect(u).not.toHaveProperty('tokens');
    });
    it('conversas ficam salvas, usam o histórico e são só de quem criou', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      const service = app.get(CrabAiService);
      const sent: { messages: { role: string; content: unknown }[] }[] = [];
      const fake = {
        beta: {
          messages: {
            stream: (params: { messages: { role: string; content: unknown }[] }) => {
              sent.push(JSON.parse(JSON.stringify(params)));
              const handlers: ((t: string) => void)[] = [];
              return {
                on: (_e: string, fn: (t: string) => void) => {
                  handlers.push(fn);
                },
                finalMessage: async () => {
                  handlers.forEach(h => h('Resposta ' + sent.length));
                  return { stop_reason: 'end_turn', content: [], usage: { input_tokens: 10, output_tokens: 5 } };
                },
              };
            },
          },
        },
      };
      jest.spyOn(service as unknown as { anthropic: () => unknown }, 'anthropic').mockReturnValue(fake);
      await actor().post('/ai/chat').send({ message: 'Primeira pergunta' }).expect(200);
      const conv = await db.aiConversation.findFirstOrThrow({ where: { userId } });
      await actor().post('/ai/chat').send({ conversationId: conv.id, message: 'Segunda pergunta' }).expect(200);
      expect(sent[1].messages).toEqual([
        { role: 'user', content: 'Primeira pergunta' },
        { role: 'assistant', content: 'Resposta 1' },
        { role: 'user', content: 'Segunda pergunta' },
      ]);
      const list = (await actor().get('/ai/conversations').expect(200)).body;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: conv.id, title: 'Primeira pergunta' });
      const other = actor((await makeUser()).cookie);
      await other.get('/ai/conversations/' + conv.id).expect(404);
      await other.post('/ai/chat').send({ conversationId: conv.id, message: 'Invadindo' }).expect(400);
      await other.delete('/ai/conversations/' + conv.id).expect(404);
      expect((await other.get('/ai/conversations').expect(200)).body).toEqual([]);
      await actor()
        .delete('/ai/conversations/' + conv.id)
        .expect(200);
      expect(await db.aiMessage.count({ where: { conversationId: conv.id } })).toBe(0);
    });
    it('renomear, fixar, busca e artefatos respeitam o dono', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      const service = app.get(CrabAiService);
      const fake = {
        beta: {
          messages: {
            stream: () => {
              const handlers: ((t: string) => void)[] = [];
              return {
                on: (_e: string, fn: (t: string) => void) => {
                  handlers.push(fn);
                },
                finalMessage: async () => {
                  handlers.forEach(h => h('Guarde 10% do salário.'));
                  return { stop_reason: 'end_turn', content: [], usage: { input_tokens: 10, output_tokens: 5 } };
                },
              };
            },
          },
        },
      };
      jest.spyOn(service as unknown as { anthropic: () => unknown }, 'anthropic').mockReturnValue(fake);
      const r = await actor().post('/ai/chat').send({ message: 'Como economizar?' }).expect(200);
      const done = r.text
        .split('\n\n')
        .filter(Boolean)
        .map(e => JSON.parse(e.slice(6)))
        .find(e => e.type === 'done');
      const conv = await db.aiConversation.findFirstOrThrow({ where: { userId } });
      await actor()
        .patch('/ai/messages/' + done.messageId)
        .send({ saved: true })
        .expect(200);
      expect((await actor().get('/ai/artifacts').expect(200)).body).toMatchObject([
        { id: done.messageId, content: 'Guarde 10% do salário.', conversation: { id: conv.id } },
      ]);
      expect((await actor().get('/ai/search?q=salário').expect(200)).body).toMatchObject([
        { id: conv.id, excerpt: expect.stringContaining('salário') },
      ]);
      expect(
        (
          await actor()
            .patch('/ai/conversations/' + conv.id)
            .send({ title: 'Economia', pinned: true })
            .expect(200)
        ).body,
      ).toMatchObject({ id: conv.id, title: 'Economia', pinned: true });
      await actor()
        .patch('/ai/conversations/' + conv.id)
        .send({ title: '' })
        .expect(400);
      await actor()
        .patch('/ai/conversations/' + conv.id)
        .send({ archived: true })
        .expect(400);
      const other = actor((await makeUser()).cookie);
      await other
        .patch('/ai/conversations/' + conv.id)
        .send({ title: 'x' })
        .expect(404);
      await other
        .patch('/ai/messages/' + done.messageId)
        .send({ saved: false })
        .expect(404);
      expect((await other.get('/ai/search?q=salário').expect(200)).body).toEqual([]);
      expect((await other.get('/ai/artifacts').expect(200)).body).toEqual([]);
      await actor()
        .patch('/ai/messages/' + done.messageId)
        .send({ saved: false })
        .expect(200);
      expect((await actor().get('/ai/artifacts').expect(200)).body).toEqual([]);
    });
    it('franquia mensal bloqueia quem já usou tudo, exceto admins', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.CRAB_AI_MONTHLY_TOKENS = '1000';
      await db.aiUsage.create({
        data: {
          userId,
          model: 'claude-haiku-5-5',
          rounds: 1,
          inputTokens: 900,
          outputTokens: 200,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costMicroUsd: 190,
        },
      });
      expect((await actor().get('/ai/usage').expect(200)).body).toMatchObject({ percent: 100, blocked: true });
      expect((await actor().post('/ai/chat').send({ message: 'Oi' }).expect(429)).body.message).toContain(
        'Você usou todo o Crab AI deste mês',
      );
      await db.user.update({ where: { id: userId }, data: { isAdmin: true } });
      expect((await actor().get('/ai/usage').expect(200)).body).toMatchObject({ blocked: false, unlimited: true });
    });
  });
});
