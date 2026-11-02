import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
export async function testDatabase() {
  // Always create an isolated schema, even when using a supplied test server.
  const container = process.env.TEST_DATABASE_URL ? null : await new PostgreSqlContainer('postgres:17-alpine').start();
  const base = process.env.TEST_DATABASE_URL || container!.getConnectionUri();
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  const url = new URL(base);
  url.searchParams.set('schema', schema);
  const databaseUrl = url.toString();
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  return {
    db,
    url: databaseUrl,
    async close() {
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.$disconnect();
      await container?.stop();
    },
  };
}
