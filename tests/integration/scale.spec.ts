import type { INestApplication } from '@nestjs/common';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { createApp } from '../../server/src/app';
import { testDatabase } from '../database';

// Several app servers behind a load balancer must share the attempt counters, otherwise each server multiplies the limit.
describe('vários servidores com Redis', () => {
  let database: Awaited<ReturnType<typeof testDatabase>>;
  let redis: StartedRedisContainer;
  let first: INestApplication, second: INestApplication;

  beforeAll(async () => {
    [database, redis] = await Promise.all([testDatabase(), new RedisContainer('redis:7-alpine').start()]);
    process.env.DATABASE_URL = database.url;
    process.env.REDIS_URL = redis.getConnectionUrl();
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    first = await createApp(false);
    second = await createApp(false);
  });
  afterAll(async () => {
    await first?.close();
    await second?.close();
    delete process.env.REDIS_URL;
    await redis?.stop();
    await database?.close();
  });

  const login = (app: INestApplication) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Requested-With', 'CrabFinance')
      .send({ username: 'ninguem', password: 'senha-errada' });

  it('o limite de tentativas de login vale para todos os servidores juntos', async () => {
    for (let i = 0; i < 5; i++) await login(first).expect(401);
    for (let i = 0; i < 5; i++) await login(second).expect(401);
    await login(first).expect(429);
    await login(second).expect(429);
  });
});
