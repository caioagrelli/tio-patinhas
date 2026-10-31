import 'dotenv/config';
import { createApp } from './app';
async function main() {
  const app = await createApp();
  await app.listen(Number(process.env.PORT || 3000), '0.0.0.0');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
