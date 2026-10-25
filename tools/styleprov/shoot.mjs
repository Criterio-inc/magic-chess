// Stilprovets bilder i riktig Chrome (playwright-core, som npm run smoke). Kräver att npm run dev kör.
//   node tools/styleprov/shoot.mjs                 # alla tre stilarna
//   node tools/styleprov/shoot.mjs --only A,C      # ett urval
//   node tools/styleprov/shoot.mjs --url http://localhost:8240
//   node tools/styleprov/shoot.mjs --only A --q cam=-14,34,6,-14,0,-1,45 --name topp   # felsökning
// Bilderna hamnar i docs/stil/ (gitignorerat arbetsmaterial). Felar vid konsolfel.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const base = opt('--url', 'http://localhost:8240');
const styles = opt('--only', 'A,B,C').split(',');
const extra = opt('--q', ''), name = opt('--name', '');
const out = 'docs/stil';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
for (const s of styles) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const t0 = Date.now();
  await page.goto(`${base}/styleprov.html?stil=${s}&shot=1${extra ? '&' + extra : ''}`);
  await page.waitForFunction(() => window.SP?.ready === true || window.SP?.error, null, { timeout: 300000 });
  const err = await page.evaluate(() => window.SP.error);
  if (err) errors.push(err);
  const file = `${out}/stil-${s}${name ? '-' + name : ''}.png`;
  await page.screenshot({ path: file });
  console.log(`${s}: ${file} (${((Date.now() - t0) / 1000).toFixed(1)} s)${errors.length ? '  FEL: ' + errors.join(' | ') : ''}`);
  if (errors.length) failed = true;
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
