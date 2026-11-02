// Grants or removes access to the admin panel: npm run user:admin -- <usuario> [--remover]
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
async function main() {
  const [username, flag] = process.argv.slice(2);
  if (!username) throw new Error('Uso: npm run user:admin -- <usuario> [--remover]');
  const db = new PrismaClient();
  try {
    const isAdmin = flag !== '--remover';
    const user = await db.user
      .update({ where: { username: username.toLowerCase() }, data: { isAdmin } })
      .catch(() => null);
    if (!user) throw new Error(`Usuário "${username}" não existe.`);
    console.log(isAdmin ? `"${user.username}" agora é administrador.` : `"${user.username}" não é mais administrador.`);
  } finally {
    await db.$disconnect();
  }
}
main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
