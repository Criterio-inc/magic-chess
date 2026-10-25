// Kontrollera fältslagens kort (src/faltslag/slag.json): formatet, uppställningen, att slagplatsen syns bredvid brädet,
// att stadsnålarna hamnar rätt och att härolden har sina repliker. Körs med `npm run check:slag`.
import fs from 'node:fs';
import { Chess } from 'chess.js';
import { readSlagkort } from '../src/faltslag/slagkort.js';
import { atlasUV, sheetPos, pinVisible, campaignView, FULL_VIEW } from '../src/kartrum/atlas.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url)));
const cards = read('../src/faltslag/slag.json');
const lines = read('./voice_lines.json').lines.herald;
let bad = 0;
const fail = (msg) => { bad++; console.log(`  FEL  ${msg}`); };

// projektionen mot kända platser i karta.jpg (uppmätta i bilden: Rigabuktens innersta del, Finska vikens slut)
const near = (a, b, tol = 0.01) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;
if (!near(atlasUV(24.1, 56.95), [0.506, 0.279])) fail('projektionen: Riga hamnar fel');
if (!near(atlasUV(28.19, 59.38), [0.532, 0.232])) fail('projektionen: Narva hamnar fel');
if (JSON.stringify(campaignView(...atlasUV(12.37, 51.4))) !== JSON.stringify(FULL_VIEW)) fail('Breitenfeld borde rymmas på hela kartan');

for (const raw of cards) {
  let c;
  try { c = readSlagkort(raw); } catch (e) { fail(`${raw.id}: ${e.message}`); continue; }
  const chess = new Chess(c.fen || undefined);
  const [x, z] = sheetPos(c.view, ...c.site);
  const count = (color) => chess.board().flat().filter((p) => p && p.color === color).length;
  console.log(`${c.id.padEnd(12)} ${c.year}  ${c.white.commander} mot ${c.black.commander}  Stockfish ${c.strength}`
    + `  pjäser ${count('w')}/${count('b')}  karta s=${c.view.s.toFixed(2)}  nål (${x.toFixed(1)}, ${z.toFixed(1)})`);
  if (!pinVisible(x, z, 2)) fail(`${c.id}: slagnålen hamnar under brädet eller på kartans kant`);
  if (chess.turn() !== 'w') fail(`${c.id}: vit ska dra först`);
  if (chess.isGameOver()) fail(`${c.id}: partiet är slut innan det börjat`);
  for (const k of [`slag_${c.id}`, `slag_${c.id}_seger`, `slag_${c.id}_forlust`]) if (!lines[k]?.length) fail(`${c.id}: härolden saknar ${k}`);
}
console.log(bad ? `\n${bad} fel` : '\nAlla slagkort är giltiga.');
process.exit(bad ? 1 : 0);
