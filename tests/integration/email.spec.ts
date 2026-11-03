import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../server/src/app';
import { tokenHash } from '../../server/src/auth';
import { Database } from '../../server/src/database';
import { Mailer, type Email } from '../../server/src/mail';
import { testDatabase } from '../database';

// Sign-up confirmation, "forgot my password" and password change, with the outgoing e-mails captured.
describe('e-mails da conta', () => {
  let database: Awaited<ReturnType<typeof testDatabase>>;
  let app: INestApplication;
  let db: Database;
  let sent: Email[];

  beforeAll(async () => {
    database = await testDatabase();
    process.env.DATABASE_URL = database.url;
    process.env.APP_URL = 'https://crab.test';
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    app = await createApp(false);
    db = app.get(Database);
  });
  beforeEach(() => {
    sent = [];
    jest.spyOn(app.get(Mailer), 'send').mockImplementation(async email => {
      sent.push(email);
      return true;
    });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  const http = (cookie = '') => ({
    get: (path: string) =>
      request(app.getHttpServer())
        .get('/api' + path)
        .set('Cookie', cookie),
    post: (path: string) =>
      request(app.getHttpServer())
        .post('/api' + path)
        .set('Cookie', cookie)
        .set('X-Requested-With', 'CrabFinance'),
  });
  const cookieOf = (response: request.Response) =>
    ([] as string[])
      .concat(response.headers['set-cookie'] ?? [])
      .find(c => c.startsWith('session='))!
      .split(';')[0];
  const linkIn = (email: Email, pattern: RegExp) => email.text.match(pattern)![0];
  async function register(name = 'Maria Silva') {
    const username = 'u' + randomUUID().slice(0, 8);
    const email = username + '@example.com';
    const response = await http()
      .post('/auth/register')
      .send({ username, name, email, password: 'senha-original-1' })
      .expect(201);
    return { username, email, cookie: cookieOf(response) };
  }

  it('cadastro com senha manda boas-vindas com link de confirmação, que vale uma vez', async () => {
    const account = await register();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: account.email, subject: 'Confirme seu e-mail no CRAB FINANCE' });
    expect(sent[0].text).toContain('Olá, Maria! Bem-vindo');
    expect((await http(account.cookie).get('/auth/me').expect(200)).body).toMatchObject({ emailVerified: false });

    const link = linkIn(sent[0], /https:\/\/crab\.test\/api\/auth\/verify-email\?token=[a-f0-9]{64}/);
    const path = link.replace('https://crab.test/api', '');
    expect((await http().get(path).expect(302)).headers.location).toBe('/?email=confirmado');
    expect((await http(account.cookie).get('/auth/me').expect(200)).body).toMatchObject({ emailVerified: true });
    expect((await http().get(path).expect(302)).headers.location).toBe('/?erro=link');
    expect((await http().get('/auth/verify-email?token=abc').expect(302)).headers.location).toBe('/?erro=link');
  });

  it('reenvio do link respeita o intervalo e invalida o link anterior', async () => {
    const account = await register();
    const first = linkIn(sent[0], /\/auth\/verify-email\?token=[a-f0-9]{64}/);
    await http(account.cookie).post('/auth/verify-email/resend').expect(429);
    const user = await db.user.findUniqueOrThrow({ where: { username: account.username } });
    await db.emailToken.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 3 * 60_000) },
    });
    await http(account.cookie).post('/auth/verify-email/resend').expect(201);
    expect(sent).toHaveLength(2);
    const second = linkIn(sent[1], /\/auth\/verify-email\?token=[a-f0-9]{64}/);
    expect((await http().get(first).expect(302)).headers.location).toBe('/?erro=link');
    expect((await http().get(second).expect(302)).headers.location).toBe('/?email=confirmado');
    await http(account.cookie).post('/auth/verify-email/resend').expect(400);
  });

  it('esqueci a senha: não revela e-mails, troca a senha uma vez, encerra sessões e avisa', async () => {
    const account = await register();
    sent = [];
    await http().post('/auth/password/forgot').send({ email: 'ninguem@example.com' }).expect(201);
    expect(sent).toHaveLength(0);
    await http().post('/auth/password/forgot').send({ email: account.email.toUpperCase() }).expect(201);
    await http().post('/auth/password/forgot').send({ email: account.email }).expect(201);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Redefinir sua senha do CRAB FINANCE');
    // The token travels in the URL fragment, so it is never sent to a server or in the Referer header.
    const token = linkIn(sent[0], /https:\/\/crab\.test\/#\/redefinir-senha\?token=[a-f0-9]{64}/).split('token=')[1];

    await http().post('/auth/password/reset').send({ token, password: 'curta' }).expect(400);
    await http()
      .post('/auth/password/reset')
      .send({ token: 'f'.repeat(64), password: 'senha-nova-123' })
      .expect(400);
    const reset = await http().post('/auth/password/reset').send({ token, password: 'senha-nova-123' }).expect(201);
    expect(sent.at(-1)!.subject).toBe('Sua senha do CRAB FINANCE foi alterada');
    await http(account.cookie).get('/auth/me').expect(401);
    expect((await http(cookieOf(reset)).get('/auth/me').expect(200)).body).toMatchObject({ emailVerified: true });
    await http().post('/auth/password/reset').send({ token, password: 'outra-senha-123' }).expect(400);
    await http().post('/auth/login').send({ username: account.username, password: 'senha-original-1' }).expect(401);
    // The login field also accepts the e-mail.
    await http().post('/auth/login').send({ username: account.email, password: 'senha-nova-123' }).expect(201);
  });

  it('link de senha expira em 1 hora', async () => {
    const account = await register();
    await http().post('/auth/password/forgot').send({ email: account.email }).expect(201);
    const token = linkIn(sent.at(-1)!, /token=[a-f0-9]{64}/).slice(6);
    await db.emailToken.updateMany({ where: { kind: 'reset' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await http().post('/auth/password/reset').send({ token, password: 'senha-nova-123' }).expect(400);
  });

  it('conta só com Google recebe aviso em vez de link de senha e pode criar uma senha', async () => {
    const googleId = 'g-' + randomUUID();
    const email = googleId + '@example.com';
    const user = await db.user.create({
      data: { googleId, username: 'google:' + googleId, name: 'Ana Google', email, emailVerifiedAt: new Date() },
    });
    await http().post('/auth/password/forgot').send({ email }).expect(201);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Sua conta do CRAB FINANCE usa o Google');
    expect(sent[0].text).not.toContain('token=');

    const token = 'a'.repeat(64);
    await db.session.create({
      data: { userId: user.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 60_000) },
    });
    const cookie = 'session=' + token;
    await http(cookie).post('/auth/password').send({ password: 'senha-do-google-1' }).expect(201);
    await http().post('/auth/login').send({ username: email, password: 'senha-do-google-1' }).expect(201);
  });

  it('trocar a senha exige a atual, mantém esta sessão, encerra as outras e avisa por e-mail', async () => {
    const account = await register();
    const other = cookieOf(
      await http().post('/auth/login').send({ username: account.username, password: 'senha-original-1' }).expect(201),
    );
    sent = [];
    await http(account.cookie)
      .post('/auth/password')
      .send({ current: 'errada', password: 'senha-nova-123' })
      .expect(401);
    await http(account.cookie)
      .post('/auth/password')
      .send({ current: 'senha-original-1', password: 'curta' })
      .expect(400);
    await http(account.cookie)
      .post('/auth/password')
      .send({ current: 'senha-original-1', password: 'senha-nova-123' })
      .expect(201);
    await http(account.cookie).get('/auth/me').expect(200);
    await http(other).get('/auth/me').expect(401);
    expect(sent.map(e => e.subject)).toEqual(['Sua senha do CRAB FINANCE foi alterada']);
  });

  it('com e-mails ligados, assinar exige e-mail confirmado', async () => {
    const account = await register();
    Object.assign(process.env, { SMTP_URL: 'smtp://localhost:2525', MERCADOPAGO_ACCESS_TOKEN: 'TEST-x' });
    try {
      const r = await http(account.cookie).post('/billing/checkout').send({ plan: 'anual' }).expect(400);
      expect(r.body.message).toContain('Confirme seu e-mail');
    } finally {
      delete process.env.SMTP_URL;
      delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    }
  });
});
