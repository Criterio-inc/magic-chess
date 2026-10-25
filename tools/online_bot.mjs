// Testmotståndare för onlinespel: node tools/online_bot.mjs KOD [flaggor]
// Går med i rummet och spelar (slår gärna). Godtar rematch när motståndaren ber om det.
//   --url ws://värd:port/ws   annan server (eller miljövariabeln BC_WS; standard ws://localhost:8241/ws)
//   --taunt                   hånar ibland: när partiet börjar och efter egna slag
//   --ask-rematch             ber själv om rematch när partiet är slut
//   --no-rematch              avslutar när partiet är slut i stället för att vänta på rematch
// Kommandon på stdin (för manuell provning): "t <id>" glåpord (t ensamt = slumpat), "r" rematch, "q" ge upp, "x" avsluta.
import WebSocket from 'ws';
import { Chess } from 'chess.js';

const TAUNTS = ['dalkarl', 'kanslist', 'regler', 'marknad', 'riksdag', 'verkligen', 'beundran', 'skynda'];
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const code = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--url');
if (!code) {
  console.log('Användning: node tools/online_bot.mjs KOD [--url ws://localhost:8241/ws] [--taunt] [--ask-rematch] [--no-rematch]');
  process.exit(1);
}
const url = opt('--url') || process.env.BC_WS || 'ws://localhost:8241/ws';
const ws = new WebSocket(url);
const chess = new Chess();
let me = null;
let over = false;
let idle;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const send = (m) => ws.send(JSON.stringify(m));
const randomTaunt = () => TAUNTS[Math.floor(Math.random() * TAUNTS.length)];
const taunt = (id = randomTaunt()) => { log('hånar:', id); send({ t: 'taunt', id }); };
// avsluta efter 10 min utan trafik
const touch = () => { clearTimeout(idle); idle = setTimeout(() => { log('ingen trafik på 10 min – avslutar'); process.exit(0); }, 600_000); };

function think() {
  if (over || chess.turn() !== me || chess.isGameOver()) return;
  const moves = chess.moves({ verbose: true });
  const caps = moves.filter((m) => m.captured);
  const m = (caps.length ? caps : moves)[Math.floor(Math.random() * (caps.length || moves.length))];
  const ply = chess.history().length;
  setTimeout(() => {
    if (over || chess.history().length !== ply) return;
    log(me === 'w' ? 'vit' : 'svart', 'spelar', m.san);
    send({ t: 'move', from: m.from, to: m.to, ...(m.promotion ? { promotion: 'q' } : {}), ply });
    if (m.captured && flag('--taunt') && Math.random() < 0.6) setTimeout(() => taunt(), 2500);
  }, 1500);
}

// ställningen från servern (start, joined) spelas upp från början
function load(state) {
  chess.reset();
  for (const mv of state.moves) chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
  over = !!state.over;
}

ws.on('open', () => { touch(); send({ t: 'join', code, name: 'Testbot' }); });
ws.on('message', (d) => {
  touch();
  const m = JSON.parse(d);
  if (m.t !== 'pong') log('<-', m.t, m.san || m.status || m.reason || m.code || m.id || m.by || (m.n ?? ''), m.message || '');
  if (m.t === 'joined') { me = m.color; load(m.state); }
  if (m.t === 'start') {
    if (m.color) me = m.color; // färgen byts vid rematch
    load(m.state);
    log('nytt parti – jag spelar', me === 'w' ? 'vit' : 'svart');
    if (flag('--taunt')) setTimeout(() => taunt(), 1200);
    think();
  }
  if (m.t === 'move') { chess.move({ from: m.from, to: m.to, promotion: m.promotion }); think(); }
  if (m.t === 'reject') { load(m.state); think(); }
  if (m.t === 'draw-offer') send({ t: 'draw-answer', accept: false });
  if (m.t === 'rematch' && m.by !== me && over && !flag('--no-rematch')) {
    log('motståndaren vill ha rematch – godtar');
    setTimeout(() => send({ t: 'rematch' }), 800);
  }
  if (m.t === 'over') {
    over = true;
    log('SLUT', m.result, m.reason);
    if (flag('--no-rematch')) setTimeout(() => process.exit(0), 500);
    else if (flag('--ask-rematch')) setTimeout(() => { log('ber om rematch'); send({ t: 'rematch' }); }, 1500);
    else log('väntar på rematch (skriv r för att be om en, x för att avsluta)');
  }
  if (m.t === 'opponent' && m.status === 'left') { log('motståndaren lämnade – avslutar'); setTimeout(() => process.exit(0), 300); }
});
ws.on('close', () => { log('anslutningen stängd'); process.exit(0); });
ws.on('error', (e) => { log('fel:', e.message); process.exit(1); });
setInterval(() => ws.readyState === 1 && send({ t: 'ping' }), 20_000);
touch();

// kommandon på stdin (stängd stdin, t.ex. i bakgrunden, gör ingenting)
process.stdin.setEncoding('utf8');
process.stdin.on('data', (s) => {
  for (const line of s.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const [cmd, arg] = line.split(/\s+/);
    if (cmd === 't') taunt(arg || undefined);
    else if (cmd === 'r') { log('ber om rematch'); send({ t: 'rematch' }); }
    else if (cmd === 'q') { log('ger upp'); send({ t: 'resign' }); }
    else if (cmd === 'x') process.exit(0);
    else log('okänt kommando:', line, '(t <id> | r | q | x)');
  }
});
process.stdin.on('error', () => {});
