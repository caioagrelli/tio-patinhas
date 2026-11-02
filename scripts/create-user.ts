// Creates a password account from the terminal: npm run user:create -- <usuario> [nome] [senha]
// Without a password, a random one is generated and printed.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../server/src/auth';
import { createDefaults } from '../server/src/defaults';
import { credentials } from '../shared/schemas';
async function main() {
  const [username, name, given] = process.argv.slice(2);
  const password = given || randomBytes(9).toString('base64url');
  const input = credentials.safeParse({ username, password });
  if (!input.success)
    throw new Error(
      'Uso: npm run user:create -- <usuario> [nome] [senha]. Usuário com 3 a 60 caracteres (letras, números, _ . @ + -) e senha com pelo menos 10.',
    );
  const db = new PrismaClient();
  try {
    const login = input.data.username.toLowerCase();
    if (await db.user.findUnique({ where: { username: login } })) throw new Error(`O usuário "${login}" já existe.`);
    const passwordHash = await hashPassword(password);
    await db.$transaction(async tx => {
      const user = await tx.user.create({ data: { username: login, name: name || input.data.username, passwordHash } });
      await createDefaults(tx, user.id);
    });
    console.log(`Conta criada.\n  Usuário: ${login}\n  Senha:   ${password}`);
  } finally {
    await db.$disconnect();
  }
}
main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
