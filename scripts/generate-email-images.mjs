// Generates the images used in the e-mails (web/public/email/*.png) from the site's own look:
// dark background with particles, the pixel crab and "CRAB FINANCE_". Run: node scripts/generate-email-images.mjs
// Needs Chrome/Chromium (PLAYWRIGHT_CHROME_PATH or the system one).
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const chrome = [process.env.PLAYWRIGHT_CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(
  p => p && existsSync(p),
);
const logo = 'data:image/png;base64,' + readFileSync('web/public/logo.png').toString('base64');

// Same seed every run, so regenerating does not change the images without reason.
const page = `<!doctype html><html><body style="margin:0;background:#08090d">
<canvas id="c"></canvas><script>
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const logo = new Image(); logo.src = ${JSON.stringify(logo)};
// Square "pixel" particles in a few fixed shades, like the pixel crab; few colors keep the PNG small.
const shades = ['#2a2c30', '#45474c', '#6b6d72', '#a3a5a8'];
function stars(ctx, w, h, count, scale) {
  for (let i = 0; i < count; i++) {
    const x = Math.round(rnd() * w), y = Math.round(rnd() * h), size = (rnd() < 0.8 ? 2 : 3) * scale;
    ctx.fillStyle = rnd() < 0.08 ? '#9c3a12' : shades[Math.floor(rnd() * shades.length)];
    ctx.fillRect(x, y, size, size);
  }
}
window.draw = async (kind) => {
  await logo.decode();
  const c = document.getElementById('c'), ctx = c.getContext('2d');
  if (kind === 'header') {
    // 600x180 shown, drawn at 2x for sharp screens.
    c.width = 1200; c.height = 360; ctx.fillStyle = '#08090d'; ctx.fillRect(0, 0, c.width, c.height);
    stars(ctx, c.width, c.height, 170, 2);
    ctx.imageSmoothingEnabled = false;
    const lh = 150, lw = lh * logo.width / logo.height;
    ctx.drawImage(logo, 80, (c.height - lh) / 2, lw, lh);
    ctx.font = '700 64px ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace';
    ctx.textBaseline = 'middle'; ctx.letterSpacing = '6px';
    const x = 80 + lw + 36, y = c.height / 2 + 4;
    ctx.fillStyle = '#ededed'; ctx.fillText('CRAB FINANCE', x, y);
    ctx.fillStyle = '#f64301'; ctx.fillText('_', x + ctx.measureText('CRAB FINANCE').width + 4, y);
  } else {
    // Tile for the page background behind the card.
    c.width = 400; c.height = 400; ctx.fillStyle = '#08090d'; ctx.fillRect(0, 0, c.width, c.height);
    stars(ctx, c.width, c.height, 55, 1);
  }
  return c.toDataURL('image/png');
};
</script></body></html>`;

const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
const tab = await browser.newPage();
await tab.setContent(page);
const { writeFileSync } = await import('node:fs');
for (const [kind, file] of [
  ['header', 'web/public/email/header.png'],
  ['stars', 'web/public/email/stars.png'],
]) {
  const url = await tab.evaluate(k => globalThis.draw(k), kind);
  writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log('gerado:', file);
}
await browser.close();
