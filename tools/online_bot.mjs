// Testmotståndare för onlinespel: node tools/online_bot.mjs KOD  (går med och spelar svart, slår gärna)
import WebSocket from 'ws';
import { Chess } from 'chess.js';
const code = process.argv[2];
const ws = new WebSocket('ws://localhost:8241/ws');
const chess = new Chess();
let me = null;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
function think() {
  if (chess.turn() !== me || chess.isGameOver()) return;
  const moves = chess.moves({ verbose: true });
  const caps = moves.filter((m) => m.captured);
  const m = (caps.length ? caps : moves)[Math.floor(Math.random() * (caps.length || moves.length))];
  setTimeout(() => { log('svart spelar', m.san); ws.send(JSON.stringify({ t: 'move', from: m.from, to: m.to, ...(m.promotion ? { promotion: 'q' } : {}), ply: chess.history().length })); }, 1500);
}
ws.on('open', () => ws.send(JSON.stringify({ t: 'join', code, name: 'Testbot' })));
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.t !== 'pong') log('<-', m.t, m.san || m.status || m.reason || m.code || '');
  if (m.t === 'joined') me = m.color;
  if (m.t === 'start') think();
  if (m.t === 'move') { chess.move({ from: m.from, to: m.to, promotion: m.promotion }); think(); }
  if (m.t === 'over') { log('SLUT', m.result, m.reason); setTimeout(() => process.exit(0), 500); }
});
setTimeout(() => process.exit(0), 240000);
