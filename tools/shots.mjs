// Bilder ur spelet i riktig Chrome (playwright-core, som npm run smoke). Kräver att npm run dev kör.
//   node tools/shots.mjs                        # titel, dag, skymning, kväll, översikt dag och kväll
//   node tools/shots.mjs --only dag,kvall       # ett urval
// Bilderna hamnar i docs/stil/spel/ (gitignorerat). Mäter också bildfrekvensen per läge och felar vid konsolfel.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const base = opt('--url', 'http://localhost:8240');
const only = opt('--only', '');
const out = 'docs/stil/spel';
mkdirSync(out, { recursive: true });

// tid på dygnet, översikt av/på, och om kameran ska stå i vits hemmabild
const SHOTS = {
  titel: null,
  dag: { tod: 0 },
  skymning: { tod: 0.55 },
  kvall: { tod: 1 },
  'oversikt-dag': { tod: 0, overview: true },
  'oversikt-kvall': { tod: 1, overview: true },
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base);
await page.waitForFunction(() => window.BC?.world?.composer && !document.getElementById('begin').disabled, null, { timeout: 120000 });
await page.waitForTimeout(2500);

const fps = () => page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(Math.round((n * 1000) / (performance.now() - t0))); };
  requestAnimationFrame(f);
}));

let started = false;
let failed = false;
for (const [name, s] of Object.entries(SHOTS)) {
  if (only && !only.split(',').includes(name)) continue;
  const e0 = errors.length;
  if (s && !started) {
    // nytt tvåspelarparti utan titelskärm; kameran i vits hemmabild
    await page.click('#begin');
    await page.waitForSelector('#menu:not(.hidden)', { timeout: 30000 }); // menyn kommer efter entréns blixt
    await page.evaluate(async () => {
      document.getElementById('menu').classList.add('hidden');
      await BC.game.newGame({ mode: 'hotseat', elo: 1800, battles: 'cinematic', pace: 2.4 });
      BC.game.chess.load('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5');
      BC.game.syncFromBoard();
    });
    started = true;
    await page.waitForTimeout(2500);
  }
  if (s) {
    await page.evaluate(async ({ tod, overview }) => {
      BC.world.setTimeOfDay(tod, true);
      const ov = BC.overview;
      if (ov && !!overview !== ov.active) ov.toggle();
      if (!overview) await BC.game.director.toHome('w', 0.01);
    }, s);
    await page.waitForTimeout(s.overview ? 3500 : 1500);
  }
  const f = await fps();
  await page.screenshot({ path: `${out}/${name}.png` });
  const errs = errors.slice(e0);
  console.log(`${errs.length ? 'FEL ' : 'ok  '} ${name.padEnd(15)} ${String(f).padStart(3)} bilder/s${errs.length ? '  ' + errs[0] : ''}`);
  if (errs.length) failed = true;
}
await browser.close();
process.exit(failed ? 1 : 0);
