// Röktest: bygger spelet, startar `vite preview` (ingen HMR som laddar om mitt i) och spelar igenom alla
// händelser i en riktig Chrome: varje mattfinish, fältherrens hand, älgen, karolinen, lemlästning, bannbullan,
// alla dödssätt, trumpojken, hovdansen, repris, hoppa över, tips, veteraner, legendparti, sammanfattning, ångra, fotoläge,
// kvällens kandelabrar och översiktsläget i kartrummet, talkanalen (en röst åt gången) och fältslagen.
// Felar vid konsolfel, sidfel eller ett påstående som inte håller. Bilder hamnar i build/smoke/.
//
//   node tools/smoke.mjs                 # bygg + kör (huvudlöst)
//   node tools/smoke.mjs --no-build      # kör mot förra bygget
//   node tools/smoke.mjs --headed        # se det hända
//   node tools/smoke.mjs --only hand,elk
import { spawn, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const only = args.find((a) => a.startsWith('--only'))?.split('=')[1] ?? (args.includes('--only') ? args[args.indexOf('--only') + 1] : null);
const PORT = 8250;
const OUT = 'build/smoke';
const DIST = 'build/smoke-dist';
mkdirSync(OUT, { recursive: true });

if (!flag('--no-build')) {
  console.log('bygger…');
  execSync(`npx vite build --outDir ${DIST} --emptyOutDir`, { stdio: 'ignore' });
}
const server = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* redan stängd */ } };
process.on('exit', stop);
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({ channel: 'chrome', headless: !flag('--headed'), args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const finishers = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND/.test(t)) errors.push(`console: ${t}`);
  const f = t.match(/\[BC\] finisher (\w+)/);
  if (f) finishers.push(f[1]);
});

await page.goto(`http://localhost:${PORT}/?quality=low`);
await page.waitForFunction(() => window.BC && !document.getElementById('begin').disabled, null, { timeout: 120000 });
await page.evaluate(() => {
  window.BC_DEBUG = true;
  try { localStorage.clear(); } catch { /* privat läge */ }
  document.getElementById('begin').click();
});
await page.waitForTimeout(2500);

// hjälpare i sidan
await page.evaluate(() => {
  const g = BC.game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 60000) => { const t0 = performance.now(); while (!fn()) { if (performance.now() - t0 > ms) throw new Error('tidsgräns'); await sleep(50); } };
  window.S = {
    sleep, until,
    /** Nytt tvåspelarparti (valfritt från en FEN), kameran stilla, världen i fyrdubbel fart. */
    async fresh(fen, extra = {}) {
      document.getElementById('over').classList.add('hidden');
      await g.newGame({ mode: 'hotseat', elo: 1800, battles: 'cinematic', pace: 2.4, slag: null, ...extra });
      g.director.toHome = async () => {};
      if (fen) { g.chess.load(fen); g.syncFromBoard(); }
      Object.assign(g.chor, { handChance: 0, elkChance: 0, danceChance: 0, karolinChance: 0, force: null });
      delete g.chor.chooseMove;
      BC.world.timeScale = 4;
    },
    async play(from, to, promotion) { await g.play({ from, to, promotion }); await until(() => !g.playing); },
    async over() { await until(() => !document.getElementById('over').classList.contains('hidden'), 90000); },
    /** Frys världen `sec` (världs)sekunder efter att `obj[name]` anropats. */
    freezeAfter(obj, name, sec) {
      const orig = obj[name].bind(obj);
      return new Promise((res) => {
        obj[name] = (...a) => {
          obj[name] = orig;
          const p = orig(...a);
          let t = 0;
          const off = BC.world.addUpdater((dt) => { t += dt; if (t > sec) { BC.world.timeScale = 0; off(); res(); } });
          return p;
        };
      });
    },
    resume() { BC.world.timeScale = 4; },
    look(pos, target) { const c = BC.world.camera; c.position.set(...pos); BC.world.controls.target.set(...target); c.lookAt(...target); },
    /** Vanliga översiktsbilden från vit sida (toHome är avstängd i testerna). */
    home() { const h = BC.game.director.homePose('w'); S.look(h.pos.toArray(), h.target.toArray()); BC.world.camera.fov = h.fov; BC.world.camera.updateProjectionMatrix(); },
  };
});

const results = [];
async function scenario(name, fn) {
  if (only && !only.split(',').includes(name)) return;
  const e0 = errors.length;
  const t0 = Date.now();
  try {
    await fn();
    const errs = errors.slice(e0);
    results.push({ name, ok: !errs.length, ms: Date.now() - t0, note: errs[0] });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, note: e.message.split('\n')[0] });
    await page.evaluate(() => { BC.world.timeScale = 4; }).catch(() => {});
    await page.waitForFunction(() => !BC.game.playing, null, { timeout: 60000 }).catch(() => {});
  }
  const r = results[results.length - 1];
  console.log(`${r.ok ? 'ok  ' : 'FEL '} ${name.padEnd(14)} ${(r.ms / 1000).toFixed(1).padStart(5)} s${r.note ? '  ' + r.note : ''}`);
}
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const ev = (fn, arg) => page.evaluate(fn, arg);
const assert = (c, msg) => { if (!c) throw new Error(msg); };

// ---------------------------------------------------------------- mattfinisher per pjäs
const MATES = [
  { name: 'mate-queen', fen: null, moves: [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4']], mate: ['d8', 'h4'], kind: 'freeze' },
  { name: 'mate-bishop', fen: '6bk/7p/8/8/8/8/8/2B3K1 w - - 0 1', mate: ['c1', 'b2'], kind: 'bull' },
  { name: 'mate-rook', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', mate: ['a1', 'a8'], kind: 'leap' },
  { name: 'mate-knight', fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', mate: ['g5', 'f7'], kind: 'leap' },
  { name: 'mate-pawn', fen: '7k/5K1p/6P1/8/8/8/8/8 w - - 0 1', mate: ['g6', 'g7'], kind: 'charge' },
];
for (const m of MATES) {
  await scenario(m.name, async () => {
    await ev((fen) => S.fresh(fen), m.fen);
    for (const [a, b] of m.moves || []) await ev(([a, b]) => S.play(a, b), [a, b]);
    const n = finishers.length;
    await ev(([a, b]) => { BC.game.play({ from: a, to: b }); }, m.mate);
    await ev(() => S.over());
    assert(finishers[n] === m.kind, `finish ${finishers[n]} ≠ ${m.kind}`);
    const stats = await ev(() => document.getElementById('over-stats').textContent);
    if (m.name === 'mate-queen') { await shot('over-stats'); assert(/Vit|Svart/.test(stats), 'ingen sammanfattning'); }
  });
}

await scenario('hand', async () => {
  await ev(() => S.fresh());
  for (const [a, b] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4']]) await ev(([a, b]) => S.play(a, b), [a, b]);
  await ev(() => { BC.game.chor.handChance = 1; window.__f = S.freezeAfter(BC.game.chor, 'giantHand', 0.62); BC.game.play({ from: 'd8', to: 'h4' }); });
  await ev(() => window.__f);
  await shot('hand');
  await ev(() => S.resume());
  await ev(() => S.over());
  assert(finishers[finishers.length - 1] === 'hand', 'ingen hand');
});

// ---------------------------------------------------------------- slag
const capture = async (name, setup, shotAt, arg) => scenario(name, async () => {
  await ev(() => S.fresh());
  await ev(() => S.play('e2', 'e4'));
  await ev(() => S.play('d7', 'd5'));
  await ev(setup, arg);
  if (shotAt) await ev(([fn, sec]) => { window.__f = S.freezeAfter(BC.game.chor, fn, sec); }, shotAt);
  await ev(() => { window.__mv = S.play('e4', 'd5'); });
  if (shotAt) { await ev(() => window.__f); await shot(name); await ev(() => S.resume()); }
  await ev(() => window.__mv);
  const hist = await ev(() => BC.game.chess.history().join(' '));
  assert(hist === 'e4 d5 exd5', `historik ${hist}`);
});
await capture('elk', () => { BC.game.chor.elkChance = 1; window.__elk = 0; const o = BC.game.chor.elk.bind(BC.game.chor); BC.game.chor.elk = (...a) => { window.__elk++; return o(...a); }; }, ['elk', 2.3]);
await capture('karolin', () => { BC.game.chor.force = { karolin: true }; }, ['karolin', 8]);
await capture('maim', () => { BC.game.chor.force = { maim: true, death: 'topple' }; BC.game.chor.chooseMove = () => ({ clip: 'attack2', reach: 1.5, fx: 'sparks', first: 'bash', deaths: ['topple'], maim: true }); });
for (const d of ['topple', 'crumble', 'launch', 'freeze', 'smite']) await capture(`death-${d}`, (d) => { BC.game.chor.force = { death: d }; }, null, d);

await scenario('bull', async () => {
  await ev(() => S.fresh('4k3/8/8/8/8/3p4/8/4KB2 w - - 0 1'));
  await ev(() => { window.__g = 0; BC.game.chor.chooseMove = () => ({ clip: 'attack2', reach: 4.6, fx: 'bull', deaths: ['launch'] }); const o = BC.game.chor.papalBull.bind(BC.game.chor); BC.game.chor.papalBull = (...a) => { window.__g++; return o(...a); }; });
  await ev(() => S.play('f1', 'd3'));
  const r = await ev(() => ({ hist: BC.game.chess.history().join(' '), g: window.__g }));
  assert(r.hist === 'Bxd3' && r.g === 1, `bannbulla ${JSON.stringify(r)}`);
});

// ---------------------------------------------------------------- förflyttningar
await scenario('drummer-dance', async () => {
  await ev(() => S.fresh());
  await ev(() => { BC.game.chor.danceChance = 1; window.__walks = []; const P = Object.getPrototypeOf([...BC.game.pieces.values()][0]); if (!P.__smoke) { const w = P.walk; P.walk = function (...a) { window.__walks.push(a[2]?.clip || 'walk'); return w.apply(this, a); }; P.__smoke = 1; } });
  await ev(() => { window.__f = S.freezeAfter(BC.game.chor, 'move', 0.9); window.__mv = S.play('g1', 'f3'); });
  await ev(() => window.__f);
  const drummer = await ev(() => { let n = 0; BC.world.scene.traverse((o) => { if (o.name === 'drummer_rig') n++; }); return n; });
  await ev(() => S.resume()); await ev(() => window.__mv);
  await ev(() => S.play('e7', 'e5'));
  const walks = await ev(() => window.__walks);
  assert(drummer >= 1, 'ingen trumpojke');
  assert(walks.includes('silly'), `ingen hovdans (${walks})`);
});

// ---------------------------------------------------------------- funktioner
await scenario('skip', async () => {
  await ev(() => S.fresh());
  await ev(() => S.play('e2', 'e4'));
  await ev(() => S.play('d7', 'd5'));
  const r = await ev(async () => {
    BC.world.timeScale = 1;
    const t0 = performance.now();
    const p = S.play('e4', 'd5');
    await S.until(() => BC.game.inBattle);
    await S.sleep(600);
    BC.game.skipBattle();
    const fast = BC.world.fast;
    await p;
    return { fast, after: BC.world.fast, sec: (performance.now() - t0) / 1000 };
  });
  assert(r.fast === 8 && r.after === 1, `fart ${r.fast}/${r.after}`);
  assert(r.sec < 6, `duellen tog ${r.sec.toFixed(1)} s trots snabbspolning`);
});

await scenario('replay', async () => {
  await ev(() => S.fresh());
  for (const [a, b] of [['e2', 'e4'], ['d7', 'd5'], ['e4', 'd5']]) await ev(([a, b]) => S.play(a, b), [a, b]);
  await ev(async () => { await BC.game.replay(); });
  const n = await ev(() => BC.game.pieces.size);
  assert(n === 31, `pjäser efter repris ${n}`);
});

await scenario('veteran', async () => {
  // springaren tar två bönder och blir veteran
  await ev(() => S.fresh('4k3/8/3p4/1p6/3N4/8/P7/4K3 w - - 0 1'));
  await ev(() => S.play('d4', 'b5'));
  await ev(() => S.play('e8', 'f8'));
  await ev(() => S.play('b5', 'd6'));
  const v = await ev(() => { const n = BC.game.pieces.get('d6'); return { kills: n?.kills, level: n?.vetLevel, wreath: !!n?.wreath }; });
  assert(v.kills === 2 && v.level === 1 && v.wreath, `veteran ${JSON.stringify(v)}`);
  await ev(() => { const p = BC.game.pieces.get('d6').position; BC.world.timeScale = 0; S.look([p.x + 3, p.y + 2.8, p.z + 3], [p.x, p.y + 2.2, p.z]); });
  await page.waitForTimeout(300);
  await shot('veteran');
  // identiteten följer med genom ångra/omladdning
  await ev(() => { BC.world.timeScale = 4; BC.game.syncFromBoard(); });
  const v2 = await ev(() => BC.game.pieces.get('d6')?.kills);
  assert(v2 === 0 || v2 === 2, `kills efter sync ${v2}`);
});

await scenario('hint', async () => {
  await ev(() => S.fresh(null, { mode: 'white' }));
  await ev(() => S.until(() => !BC.game.busy));
  await ev(() => { S.home(); return BC.game.hint(); });
  const has = await ev(() => !!BC.game.board.arrow);
  await page.waitForTimeout(500);
  await shot('hint');
  assert(has, 'ingen pil');
});

await scenario('legend', async () => {
  await ev(async () => {
    document.getElementById('over').classList.add('hidden');
    BC.game.newGame({ mode: 'legend', legend: 'legal', battles: 'cinematic', pace: 2.4 });
    BC.game.director.toHome = async () => {};
    BC.world.timeScale = 4;
  });
  await page.waitForTimeout(900);
  await shot('legend-card');
  await ev(() => S.over());
  const t = await ev(() => document.getElementById('over-text').textContent);
  assert(/Légal/.test(t), `sluttext ${t}`);
});

await scenario('undo-photo', async () => {
  await ev(() => S.fresh(null, { mode: 'hotseat' }));
  for (const [a, b] of [['e2', 'e4'], ['e7', 'e5']]) await ev(([a, b]) => S.play(a, b), [a, b]);
  await ev(() => BC.game.undo());
  const h = await ev(() => BC.game.chess.history().length);
  assert(h === 1, `ångra lämnade ${h} drag`);
  await ev(() => { BC.game.photo(true); BC.game.photo(false); });
});

// ---------------------------------------------------------------- kartrummet (src/kartrum/)
await scenario('kvall', async () => {
  await ev(() => S.fresh());
  const lit = await ev(() => { BC.world.setTimeOfDay(1, true); return BC.world.room.room.flames.flat().filter((f) => f.visible).length; });
  assert(lit === 9, `${lit} av 9 lågor tändes på kvällen`);
  await ev(() => S.home());
  await page.waitForTimeout(400);
  await shot('kvall');
  const day = await ev(() => { BC.world.setTimeOfDay(0, true); return BC.world.room.room.flames.flat().filter((f) => f.visible).length; });
  assert(day === 0, `${day} lågor brann mitt på dagen`);
});

await scenario('oversikt', async () => {
  await ev(() => S.fresh());
  await ev(async () => { BC.overview.set(true); await S.until(() => BC.overview.k === 1, 8000); });
  const on = await ev(() => ({ sel: BC.world.outline.selection.size, sepia: BC.world.sepia.blendMode.opacity.value }));
  assert(on.sel > 0 && on.sepia > 0.6, `kopparsticket kom inte: ${JSON.stringify(on)}`);
  await ev(() => S.home()); // med översikten på är hemmabilden kartbordet uppifrån
  await page.waitForTimeout(400);
  await shot('oversikt');
  // en duell tonar bort kopparsticket men släpper inte översikten
  for (const [a, b] of [['e2', 'e4'], ['d7', 'd5']]) await ev(([a, b]) => S.play(a, b), [a, b]);
  const mid = await ev(async () => {
    const p = S.play('e4', 'd5');
    await S.until(() => BC.game.inBattle);
    await S.sleep(800);
    const k = BC.overview.k;
    await p;
    return k;
  });
  assert(mid < 0.5, `kopparsticket låg kvar under duellen (k = ${mid.toFixed(2)})`);
  assert(await ev(() => BC.overview.active), 'duellen släppte översikten');
  await ev(async () => { BC.overview.set(false); await S.until(() => BC.overview.k === 0, 8000); });
  const off = await ev(() => ({ sel: BC.world.outline.selection.size, sepia: BC.world.sepia.blendMode.opacity.value, max: BC.world.controls.maxDistance }));
  assert(off.sel === 0 && off.sepia === 0 && off.max === 46, `översikten städade inte efter sig: ${JSON.stringify(off)}`);
});

// ---------------------------------------------------------------- talkanalen (voice.js): en röst åt gången
await scenario('rostkanal', async () => {
  await ev(() => S.fresh());
  const r = await ev(async () => {
    const v = BC.voice, ctx = v.sound.ctx, log = [];
    await S.until(() => v.lines.every((l) => l.end <= ctx.currentTime), 15000); // härolden har sagt sitt om partiets början
    const p = [...BC.game.pieces.values()].find((x) => x.type === 'n');
    for (const u of [...v.manifest.voice[p.name].kill, ...v.manifest.voice.karolin.report]) await v.decode(u);
    const orig = v.playBuffer.bind(v);
    v.playBuffer = (buf, o = {}) => {
      const src = orig(buf, o);
      if (o.voice && src) { const t = ctx.currentTime + (o.delay || 0); log.push([t, t + buf.duration / (o.rate || 1)]); }
      return src;
    };
    // allt på en gång: härold, pjäs, härold igen och karolinen
    v.herald('firstCasualty'); v.piece(p, 'kill'); v.herald('check'); v.say('karolin', 'report');
    v.playBuffer = orig;
    log.sort((a, b) => a[0] - b[0]);
    let end = -1, overlap = 0;
    for (const [a, b] of log) { overlap += Math.max(0, end - a); end = Math.max(end, b); }
    return { n: log.length, overlap };
  });
  assert(r.n >= 3 && r.overlap < 0.01, `rösterna krockar: ${JSON.stringify(r)}`);
});

// ---------------------------------------------------------------- fältslagen (src/faltslag/)
await scenario('faltslag', async () => {
  const room = () => ev(() => {
    const g = BC.game, r = BC.world.room.room;
    const pieces = [...g.pieces.values()].map((p) => p.color + p.type).sort().join('');
    return { pieces, status: document.getElementById('status').textContent, weather: BC.world.room.weather, pin: r.battlePin.group.visible,
      s: g.battleCard()?.view.s, cape: g.lib.mats.w.Cloth.color.getHexString(), snow: !!BC.world.room.weatherFx.snow?.visible,
      card: document.querySelector('#legend-card .lc-title').textContent };
  });
  const cape0 = await ev(() => BC.game.lib.mats.w.Cloth.color.getHexString());
  await ev(() => S.fresh(null, { mode: 'white', slag: 'poltava', elo: 1320 }));
  let st = await room();
  assert(!st.pieces.includes('wr') && st.pieces.includes('br'), `Poltava: svenskarna ska sakna torn (${st.pieces})`);
  assert(/Karl XII/.test(st.status) && /Poltava/.test(st.card), `Poltava: ${st.status} / ${st.card}`);
  assert(st.pin && st.s < 1 && st.cape !== cape0 && st.weather === 'clear', `Poltava: rummet klädes inte ${JSON.stringify(st)}`);
  await ev(() => S.home());
  await page.waitForTimeout(400);
  await shot('faltslag-poltava');
  // slutet: slagets historia i slutrutan
  await ev(() => { BC.game.chess.load('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'); BC.game.syncFromBoard(); BC.game.play({ from: 'a1', to: 'a8' }); });
  await ev(() => S.over());
  const t = await ev(() => document.getElementById('over-text').textContent);
  assert(/Karl XII segrar/.test(t) && /Perevolotjna/.test(t), `sluttext ${t}`);
  await ev(() => S.fresh(null, { mode: 'white', slag: 'narva', elo: 1320 }));
  st = await room();
  assert(!st.pieces.includes('bq') && st.weather === 'snow' && st.snow, `Narva: ${JSON.stringify(st)}`);
  await ev(() => S.home());
  await page.waitForTimeout(600);
  await shot('faltslag-narva');
  // ett vanligt parti klär av rummet
  await ev(() => S.fresh(null, { mode: 'white' }));
  st = await room();
  assert(!st.pin && st.weather === 'clear' && !st.snow && st.cape === cape0 && /Vit/.test(st.status), `rummet klädes inte av: ${JSON.stringify(st)}`);
});

await browser.close();
stop();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} gick igenom${errors.length ? `, ${errors.length} fel i konsolen` : ''}. Bilder i ${OUT}/`);
for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ', e.slice(0, 300));
process.exit(bad.length ? 1 : 0);
