import { execFileSync } from 'node:child_process';
import { testDatabase } from './database';
async function main() {
  if (process.env.PLAYWRIGHT_BASE_URL) {
    execFileSync('npx', ['playwright', 'test', ...process.argv.slice(2)], { stdio: 'inherit' });
    return;
  }
  const database = await testDatabase();
  try {
    execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
    execFileSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: database.url },
    });
  } finally {
    await database.close();
  }
}
main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
