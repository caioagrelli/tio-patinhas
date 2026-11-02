// Changes an account's password from the terminal: npm run user:password -- <usuario> <nova-senha>
// Ends the account's open sessions. Short passwords are accepted here (local use) with a warning.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../server/src/auth';
async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) throw new Error('Uso: npm run user:password -- <usuario> <nova-senha>');
  const db = new PrismaClient();
  try {
    const user = await db.user
      .update({ where: { username: username.toLowerCase() }, data: { passwordHash: await hashPassword(password) } })
      .catch(() => null);
    if (!user) throw new Error(`Usuário "${username}" não existe.`);
    await db.session.deleteMany({ where: { userId: user.id } });
    console.log(`Senha de "${user.username}" alterada. Sessões abertas foram encerradas.`);
    if (password.length < 10)
      console.warn('Aviso: senha curta. Use só em desenvolvimento, nunca num servidor publicado.');
  } finally {
    await db.$disconnect();
  }
}
main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
