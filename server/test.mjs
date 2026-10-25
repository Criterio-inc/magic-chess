// Starttest för online-servern: startar index.js på en slumpad port och spelar igenom
// protokollet (PROTOCOL.md) med två ws-klienter. Avslutas med kod 1 vid första fel.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), 'battlechess-test-'));
const DATA_FILE = join(TMP, 'rooms.json');
const ABANDON_MS = 1500;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- server ----

async function startServer() {
  const proc = spawn(process.execPath, [join(HERE, 'index.js')], {
    env: { ...process.env, PORT: '0', DATA_FILE, ABANDON_MS: String(ABANDON_MS) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/localhost:(\d+)/);
      if (m) resolve(Number(m[1]));
    });
    proc.once('exit', (code) => reject(new Error(`servern avslutades med kod ${code}`)));
    setTimeout(() => reject(new Error('servern startade inte inom 5 s')), 5000);
  });
  return { proc, port };
}

// ---- klient med strikt ordnad inkorg ----

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const inbox = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d)));
    ws.once('error', reject);
    ws.once('open', () => resolve({
      ws,
      inbox,
      send: (msg) => ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)),
      // Nästa meddelande måste vara av typen t.
      async next(t, ms = 2000) {
        const deadline = Date.now() + ms;
        while (!inbox.length) {
          if (Date.now() > deadline) throw new Error(`väntade på '${t}' men fick inget`);
          await sleep(5);
        }
        const m = inbox.shift();
        assert.equal(m.t, t, `väntade på '${t}', fick ${JSON.stringify(m)}`);
        return m;
      },
      // Inget mer ska komma.
      async quiet(ms = 100) {
        await sleep(ms);
        assert.equal(inbox.length, 0, `oväntat: ${JSON.stringify(inbox)}`);
      },
      async close() {
        ws.close();
        await once(ws, 'close');
      },
    }));
  });
}

// ---- stegen ----

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

let srv, A, B, C, code, tokA, tokB;
let creates = 0; // varje skickat create räknas mot gränsen 10/min per IP
const create = (client, msg) => {
  creates++;
  client.send({ t: 'create', ...msg });
};

// Spela ett drag och kontrollera att båda får samma eko.
async function play(mover, from, to, ply, san) {
  mover.send({ t: 'move', from, to, ply });
  const echoes = [await A.next('move'), await B.next('move')];
  for (const m of echoes) {
    assert.equal(m.from, from);
    assert.equal(m.to, to);
    assert.equal(m.ply, ply);
    if (san) assert.equal(m.san, san);
    assert.ok(typeof m.fen === 'string' && ['w', 'b'].includes(m.by));
  }
  assert.deepEqual(echoes[0], echoes[1]);
  return echoes[0];
}

// Båda skickar rematch och får start; returnerar state.
async function rematch() {
  A.send({ t: 'rematch' });
  assert.equal((await B.next('rematch')).by, colorOf('Alice'));
  B.send({ t: 'rematch' });
  const [sa, sb] = [await A.next('start'), await B.next('start')];
  assert.deepEqual(sa, sb);
  current = sa.state;
  return sa.state;
}
let current; // senaste state, för att veta vem som har vilken färg
const colorOf = (name) => (current.white.name === name ? 'w' : 'b');

step('GET /health svarar 200 ok', async () => {
  const res = await fetch(`http://localhost:${srv.port}/health`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
  assert.equal((await fetch(`http://localhost:${srv.port}/nope`)).status, 404);
});

step('create → join (gemener i koden) → start', async () => {
  A = await connect(srv.port);
  create(A, { color: 'w', name: 'Alice' });
  const c = await A.next('created');
  assert.match(c.code, CODE_RE);
  assert.equal(c.color, 'w');
  assert.equal(typeof c.token, 'string');
  ({ code, token: tokA } = c);

  B = await connect(srv.port);
  B.send({ t: 'join', code: code.toLowerCase(), name: 'Bob' });
  const j = await B.next('joined');
  assert.equal(j.code, code);
  assert.equal(j.color, 'b');
  assert.notEqual(j.token, tokA);
  tokB = j.token;
  assert.deepEqual(j.state.white, { name: 'Alice', online: true });
  assert.deepEqual(j.state.black, { name: 'Bob', online: true });

  assert.deepEqual(await A.next('opponent'), { t: 'opponent', status: 'joined', name: 'Bob' });
  const [sa, sb] = [await A.next('start'), await B.next('start')];
  assert.deepEqual(sa, sb);
  assert.equal(sa.state.fen, START_FEN);
  assert.deepEqual(sa.state.moves, []);
  assert.equal(sa.state.turn, 'w');
  assert.equal(sa.state.ply, 0);
  assert.equal(sa.state.over, null);
  current = sa.state;
});

step('fullt rum → room-full, okänd kod → no-such-room', async () => {
  C = await connect(srv.port);
  C.send({ t: 'join', code });
  assert.equal((await C.next('error')).code, 'room-full');
  C.send({ t: 'join', code: code === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ' });
  assert.equal((await C.next('error')).code, 'no-such-room');
  C.send({ t: 'join', code: 'abc' });
  assert.equal((await C.next('error')).code, 'no-such-room');
});

step('trasig indata → bad-request, servern lever', async () => {
  const bads = [
    'inte json',
    '[1,2]',
    { t: 'nope' },
    { t: 'toString' },
    { t: 'join', code: 42 },
    { t: 'move', from: 'e2', to: 'e4', ply: 0 }, // inte med i något rum
    { t: 'rejoin', code, token: 7 },
  ];
  for (const b of bads) {
    C.send(b);
    assert.equal((await C.next('error')).code, 'bad-request', JSON.stringify(b));
  }
  create(C, { color: 'x' });
  assert.equal((await C.next('error')).code, 'bad-request');
  create(C, { color: 'w', name: 'x'.repeat(25) });
  assert.equal((await C.next('error')).code, 'bad-request');
  for (const m of [
    { from: 'z9', to: 'e4', ply: 0 },
    { from: 'e2', to: 'e4', ply: '0' },
    { from: 'e2', to: 'e4', ply: -1 },
    { from: 'e2', to: 'e4', ply: 0, promotion: 'k' },
    { from: ['e2'], to: 'e4', ply: 0 },
  ]) {
    A.send({ t: 'move', ...m });
    assert.equal((await A.next('error')).code, 'bad-request', JSON.stringify(m));
  }
  await B.quiet();
});

step('drag i fel tur → reject not-your-turn + state', async () => {
  B.send({ t: 'move', from: 'e7', to: 'e5', ply: 0 });
  const r = await B.next('reject');
  assert.equal(r.reason, 'not-your-turn');
  assert.equal(r.state.fen, START_FEN);
  assert.equal(r.state.ply, 0);
  await A.quiet();
});

step('olagligt drag → reject illegal + state', async () => {
  A.send({ t: 'move', from: 'e2', to: 'e5', ply: 0 });
  const r = await A.next('reject');
  assert.equal(r.reason, 'illegal');
  assert.equal(r.state.ply, 0);
  await B.quiet();
});

step('lagligt drag ekas till båda', async () => {
  const m = await play(A, 'e2', 'e4', 0, 'e4');
  assert.equal(m.by, 'w');
  assert.ok(!('promotion' in m));
  // chess.js skriver bara en passant-rutan när slaget faktiskt är möjligt
  assert.equal(m.fen, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
});

step('dubblett (samma ply igen) → reject ply', async () => {
  A.send({ t: 'move', from: 'e2', to: 'e4', ply: 0 });
  const r = await A.next('reject');
  assert.equal(r.reason, 'ply');
  assert.equal(r.state.ply, 1);
  assert.deepEqual(r.state.moves, [{ from: 'e2', to: 'e4', san: 'e4' }]);
  await B.quiet();
});

step('Scholar\'s mate → over 1-0 checkmate', async () => {
  await play(B, 'e7', 'e5', 1, 'e5');
  await play(A, 'f1', 'c4', 2, 'Bc4');
  await play(B, 'b8', 'c6', 3, 'Nc6');
  await play(A, 'd1', 'h5', 4, 'Qh5');
  await play(B, 'g8', 'f6', 5, 'Nf6');
  await play(A, 'h5', 'f7', 6, 'Qxf7#');
  for (const p of [A, B]) assert.deepEqual(await p.next('over'), { t: 'over', result: '1-0', reason: 'checkmate' });
  B.send({ t: 'move', from: 'a7', to: 'a6', ply: 7 });
  const r = await B.next('reject');
  assert.equal(r.reason, 'over');
  assert.deepEqual(r.state.over, { result: '1-0', reason: 'checkmate' });
});

step('rematch byter färger', async () => {
  const s = await rematch();
  assert.deepEqual(s.white, { name: 'Bob', online: true });
  assert.deepEqual(s.black, { name: 'Alice', online: true });
  assert.equal(s.fen, START_FEN);
  assert.equal(s.ply, 0);
  assert.equal(s.over, null);
  A.send({ t: 'move', from: 'e2', to: 'e4', ply: 0 }); // Alice är svart nu
  assert.equal((await A.next('reject')).reason, 'not-your-turn');
  assert.equal((await play(B, 'e2', 'e4', 0)).by, 'w');
});

step('resign → over', async () => {
  A.send({ t: 'resign' }); // Alice (svart) ger upp
  for (const p of [A, B]) assert.deepEqual(await p.next('over'), { t: 'over', result: '1-0', reason: 'resign' });
});

step('remi: erbjud, avböj, erbjud, acceptera', async () => {
  await rematch();
  assert.equal(colorOf('Alice'), 'w');
  A.send({ t: 'draw-offer' });
  assert.deepEqual(await B.next('draw-offer'), { t: 'draw-offer', by: 'w' });
  await A.quiet();
  B.send({ t: 'draw-answer', accept: 'ja' });
  assert.equal((await B.next('error')).code, 'bad-request');
  B.send({ t: 'draw-answer', accept: false });
  assert.deepEqual(await A.next('draw-declined'), { t: 'draw-declined' });
  A.send({ t: 'draw-offer' });
  await B.next('draw-offer');
  B.send({ t: 'draw-answer', accept: true });
  for (const p of [A, B]) assert.deepEqual(await p.next('over'), { t: 'over', result: '1/2-1/2', reason: 'draw-agreed' });
});

step('bortkoppling + rejoin med token återställer partiet', async () => {
  await rematch();
  const bob = colorOf('Bob');
  assert.equal(bob, 'w');
  await play(B, 'e2', 'e4', 0);
  await B.close();
  assert.deepEqual(await A.next('opponent'), { t: 'opponent', status: 'disconnected' });

  B = await connect(srv.port);
  B.send({ t: 'rejoin', code: code.toLowerCase(), token: tokB });
  const j = await B.next('joined');
  assert.equal(j.code, code);
  assert.equal(j.token, tokB);
  assert.equal(j.color, bob);
  assert.equal(j.state.ply, 1);
  assert.deepEqual(j.state.moves, [{ from: 'e2', to: 'e4', san: 'e4' }]);
  assert.equal(j.state.turn, 'b');
  assert.equal(j.state.white.online && j.state.black.online, true);
  assert.deepEqual(await A.next('opponent'), { t: 'opponent', status: 'reconnected', name: 'Bob' });
  await play(A, 'e7', 'e5', 1, 'e5');
});

step('fel token → bad-token', async () => {
  C.send({ t: 'rejoin', code, token: 'fel-token' });
  assert.equal((await C.next('error')).code, 'bad-token');
  C.send({ t: 'rejoin', code: code === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ', token: tokA });
  assert.equal((await C.next('error')).code, 'no-such-room');
});

step('max 20 meddelanden/s per anslutning → rate-limited', async () => {
  const D = await connect(srv.port);
  for (let i = 0; i < 30; i++) D.send({ t: 'ping' });
  await sleep(300);
  const types = D.inbox.map((m) => (m.t === 'error' ? m.code : m.t));
  assert.equal(types.filter((t) => t === 'pong').length, 20);
  assert.equal(types.filter((t) => t === 'rate-limited').length, 1);
  await D.close();
});

step('leave mitt i partiet → over abandoned + opponent left; tomt rum försvinner', async () => {
  const G = await connect(srv.port);
  const H = await connect(srv.port);
  create(G, { color: 'b' });
  const c = await G.next('created');
  H.send({ t: 'join', code: c.code });
  assert.equal((await H.next('joined')).color, 'w');
  await G.next('opponent');
  await G.next('start');
  await H.next('start');
  G.send({ t: 'leave' });
  assert.deepEqual(await H.next('over'), { t: 'over', result: '1-0', reason: 'abandoned' });
  assert.deepEqual(await H.next('opponent'), { t: 'opponent', status: 'left' });
  await G.quiet();
  G.send({ t: 'rejoin', code: c.code, token: c.token });
  assert.equal((await G.next('error')).code, 'bad-token');

  create(G, { color: 'random' });
  const lone = await G.next('created');
  assert.ok(['w', 'b'].includes(lone.color));
  G.send({ t: 'leave' });
  await sleep(50);
  H.send({ t: 'join', code: lone.code });
  assert.equal((await H.next('error')).code, 'no-such-room');
  await G.close();
  await H.close();
});

step(`övergivet parti efter ABANDON_MS (${ABANDON_MS} ms) → over abandoned`, async () => {
  const E = await connect(srv.port);
  const F = await connect(srv.port);
  create(E, { color: 'w', name: 'Eva' });
  const c = await E.next('created');
  F.send({ t: 'join', code: c.code });
  await F.next('joined');
  await E.next('opponent');
  await E.next('start');
  await F.next('start');
  const t0 = Date.now();
  await F.close();
  assert.deepEqual(await E.next('opponent'), { t: 'opponent', status: 'disconnected' });
  assert.deepEqual(await E.next('over', ABANDON_MS + 2000), { t: 'over', result: '1-0', reason: 'abandoned' });
  assert.ok(Date.now() - t0 >= ABANDON_MS - 50, 'för tidigt');
  await E.close();
});

step('max 10 nya rum per IP och minut → rate-limited', async () => {
  const G = await connect(srv.port);
  while (creates < 10) {
    create(G, { color: 'w' });
    await G.next('created');
  }
  create(G, { color: 'w' });
  assert.equal((await G.next('error')).code, 'rate-limited');
  await G.close();
});

step('omstart (SIGTERM) sparar rummen; rejoin efteråt återställer partiet', async () => {
  srv.proc.kill('SIGTERM');
  const [exitCode] = await once(srv.proc, 'exit');
  assert.equal(exitCode, 0);
  const saved = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  assert.ok(saved.some((r) => r.code === code));

  srv = await startServer();
  A = await connect(srv.port);
  A.send({ t: 'rejoin', code, token: tokA });
  const j = await A.next('joined');
  assert.equal(j.color, 'b');
  assert.deepEqual(j.state.moves.map((m) => m.san), ['e4', 'e5']);
  assert.equal(j.state.turn, 'w');
  assert.deepEqual(j.state.black, { name: 'Alice', online: true });
  assert.deepEqual(j.state.white, { name: 'Bob', online: false });
  await A.close();
});

// ---- kör ----

let failed = false;
try {
  srv = await startServer();
  for (const { name, fn } of steps) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (err) {
      console.log(`FEL  ${name}\n     ${err.message.split('\n').join('\n     ')}`);
      failed = true;
      break;
    }
  }
} catch (err) {
  console.log(`FEL  ${err.message}`);
  failed = true;
} finally {
  srv?.proc.kill('SIGKILL');
  rmSync(TMP, { recursive: true, force: true });
}
console.log(failed ? '\nTestet misslyckades.' : `\nAlla ${steps.length} steg gick igenom.`);
process.exit(failed ? 1 : 0);
