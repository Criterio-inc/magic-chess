// Starttest för online-servern: startar index.js på en slumpad port och spelar igenom
// protokollet (PROTOCOL.md) med ws-klienter (spelare och åskådare). Avslutas med kod 1 vid första fel.
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
const TAUNT_MS = 400; // kort påfyllning av glåpordshinken så att testet går fort
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- server ----

async function startServer() {
  const proc = spawn(process.execPath, [join(HERE, 'index.js')], {
    env: { ...process.env, PORT: '0', DATA_FILE, ABANDON_MS: String(ABANDON_MS), TAUNT_MS: String(TAUNT_MS) },
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

// Båda skickar rematch och får start (med sin nya, bytta färg); returnerar state.
async function rematch() {
  const alice = colorOf('Alice');
  A.send({ t: 'rematch' });
  assert.equal((await B.next('rematch')).by, alice);
  B.send({ t: 'rematch' });
  const [sa, sb] = [await A.next('start'), await B.next('start')];
  assert.deepEqual(sa.state, sb.state);
  assert.equal(sa.color, alice === 'w' ? 'b' : 'w');
  assert.equal(sb.color, alice);
  current = sa.state;
  return sa.state;
}

// Alla klienterna i listan får samma meddelande av typen t; returnerar det.
async function all(clients, t) {
  const got = [];
  for (const c of clients) got.push(await c.next(t));
  for (const m of got.slice(1)) assert.deepEqual(m, got[0]);
  return got[0];
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
  assert.deepEqual(sa.state, sb.state);
  assert.equal(sa.color, 'w');
  assert.equal(sb.color, 'b');
  assert.equal(sa.state.fen, START_FEN);
  assert.equal(sa.state.watchers, 0);
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

// ---- åskådare, glåpord och rematch med publik (ett eget rum: Wilma mot Quentin) ----

let P, Q, S, S2, codeP, tokP;

step('watch: åskådaren får ställningen och följer dragen; alla ser antalet', async () => {
  P = await connect(srv.port);
  Q = await connect(srv.port);
  create(P, { color: 'w', name: 'Wilma' });
  ({ code: codeP, token: tokP } = await P.next('created'));
  Q.send({ t: 'join', code: codeP, name: 'Quentin' });
  await Q.next('joined');
  await P.next('opponent');
  await P.next('start');
  await Q.next('start');
  P.send({ t: 'move', from: 'e2', to: 'e4', ply: 0 });
  await all([P, Q], 'move');

  S = await connect(srv.port);
  S.send({ t: 'watch', code: codeP.toLowerCase() });
  const w = await S.next('watching');
  assert.equal(w.code, codeP);
  assert.ok(!('token' in w) && !('color' in w), 'åskådare får varken token eller färg');
  assert.deepEqual(w.state.moves, [{ from: 'e2', to: 'e4', san: 'e4' }]);
  assert.equal(w.state.ply, 1);
  assert.equal(w.state.turn, 'b');
  assert.deepEqual(w.state.white, { name: 'Wilma', online: true });
  assert.deepEqual(w.state.black, { name: 'Quentin', online: true });
  assert.equal(w.state.watchers, 1);
  assert.deepEqual(await all([P, Q, S], 'watchers'), { t: 'watchers', n: 1 });
  Q.send({ t: 'move', from: 'e7', to: 'e5', ply: 1 });
  const m = await all([P, Q, S], 'move');
  assert.equal(m.san, 'e5');
  assert.equal(m.by, 'b');
});

step('åskådaren kan inte dra (reject spectator), ge upp, erbjuda remi, be om rematch eller ta en plats', async () => {
  S.send({ t: 'move', from: 'g1', to: 'f3', ply: 2 });
  const r = await S.next('reject');
  assert.equal(r.reason, 'spectator');
  assert.equal(r.state.ply, 2);
  for (const t of ['resign', 'draw-offer', 'rematch']) {
    S.send({ t });
    assert.equal((await S.next('error')).code, 'spectator', t);
  }
  S.send({ t: 'draw-answer', accept: true });
  assert.equal((await S.next('error')).code, 'spectator');
  S.send({ t: 'join', code: codeP }); // åskådare upptar ingen plats – rummet är fullt ändå
  assert.equal((await S.next('error')).code, 'room-full');
  S.send({ t: 'rejoin', code: codeP, token: 'gissad' });
  assert.equal((await S.next('error')).code, 'bad-token');
  await P.quiet();
  await Q.quiet();
  // partiet är orört och åskådaren tittar fortfarande
  P.send({ t: 'move', from: 'g1', to: 'f3', ply: 2 });
  assert.equal((await all([P, Q, S], 'move')).san, 'Nf3');
});

step('watch: okänd kod → no-such-room, fel typ → bad-request, eget rum → bad-request', async () => {
  const D = await connect(srv.port);
  D.send({ t: 'watch', code: codeP === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ' });
  assert.equal((await D.next('error')).code, 'no-such-room');
  D.send({ t: 'watch', code: 5 });
  assert.equal((await D.next('error')).code, 'bad-request');
  P.send({ t: 'watch', code: codeP });
  assert.equal((await P.next('error')).code, 'bad-request');
  await D.close();
  await Q.quiet();
});

step(`glåpord: ekas till alla med by; okänt id → bad-request; skur på 2, sedan 1 per ${TAUNT_MS} ms`, async () => {
  P.send({ t: 'taunt', id: 'dalkarl' });
  assert.deepEqual(await all([P, Q, S], 'taunt'), { t: 'taunt', id: 'dalkarl', by: 'w' });
  for (const id of ['nope', 'toString', 42, undefined]) {
    P.send({ t: 'taunt', id });
    assert.equal((await P.next('error')).code, 'bad-request', String(id));
  }
  S.send({ t: 'taunt', id: 'riksdag' });
  assert.equal((await S.next('error')).code, 'spectator');
  P.send({ t: 'taunt', id: 'riksdag' }); // andra i skuren
  assert.equal((await all([P, Q, S], 'taunt')).id, 'riksdag');
  P.send({ t: 'taunt', id: 'skynda' }); // hinken är tom
  assert.equal((await P.next('error')).code, 'rate-limited');
  await Q.quiet();
  await S.quiet();
  Q.send({ t: 'taunt', id: 'kanslist' }); // motståndaren har en egen hink
  assert.deepEqual(await all([P, Q, S], 'taunt'), { t: 'taunt', id: 'kanslist', by: 'b' });
  await sleep(TAUNT_MS + 60);
  P.send({ t: 'taunt', id: 'marknad' }); // påfylld
  assert.equal((await all([P, Q, S], 'taunt')).id, 'marknad');
});

step('fler åskådare räknas; den som lämnar eller tappar anslutningen räknas bort', async () => {
  S2 = await connect(srv.port);
  S2.send({ t: 'watch', code: codeP });
  assert.equal((await S2.next('watching')).state.watchers, 2);
  assert.deepEqual(await all([P, Q, S, S2], 'watchers'), { t: 'watchers', n: 2 });
  await S2.close();
  assert.deepEqual(await all([P, Q, S], 'watchers'), { t: 'watchers', n: 1 });
  const S3 = await connect(srv.port);
  S3.send({ t: 'watch', code: codeP });
  await S3.next('watching');
  await all([P, Q, S, S3], 'watchers');
  S3.send({ t: 'leave' });
  assert.deepEqual(await all([P, Q, S], 'watchers'), { t: 'watchers', n: 1 });
  await S3.quiet();
  await S3.close();
});

step('rematch med åskådare: båda måste be, färgerna byts, samma rum och tokens', async () => {
  P.send({ t: 'rematch' }); // partiet pågår: ignoreras
  await Q.quiet();
  await S.quiet();
  P.send({ t: 'resign' });
  assert.deepEqual(await all([P, Q, S], 'over'), { t: 'over', result: '0-1', reason: 'resign' });
  P.send({ t: 'rematch' });
  assert.deepEqual(await all([Q, S], 'rematch'), { t: 'rematch', by: 'w' });
  P.send({ t: 'rematch' }); // dubblett: ignoreras
  await P.quiet();
  await Q.quiet();
  await S.quiet();
  // en ny åskådare får veta att vit vill spela igen
  S2 = await connect(srv.port);
  S2.send({ t: 'watch', code: codeP });
  assert.deepEqual((await S2.next('watching')).state.over, { result: '0-1', reason: 'resign' });
  await all([P, Q, S, S2], 'watchers');
  assert.deepEqual(await S2.next('rematch'), { t: 'rematch', by: 'w' });

  Q.send({ t: 'rematch' });
  const [sp, sq, ss, ss2] = [await P.next('start'), await Q.next('start'), await S.next('start'), await S2.next('start')];
  assert.equal(sp.color, 'b');
  assert.equal(sq.color, 'w');
  assert.ok(!('color' in ss) && !('color' in ss2), 'åskådare får ingen färg');
  for (const m of [sq, ss, ss2]) assert.deepEqual(m.state, sp.state);
  assert.equal(sp.state.fen, START_FEN);
  assert.equal(sp.state.ply, 0);
  assert.equal(sp.state.over, null);
  assert.equal(sp.state.watchers, 2);
  assert.deepEqual(sp.state.white, { name: 'Quentin', online: true });
  assert.deepEqual(sp.state.black, { name: 'Wilma', online: true });
  P.send({ t: 'move', from: 'e2', to: 'e4', ply: 0 }); // Wilma är svart nu
  assert.equal((await P.next('reject')).reason, 'not-your-turn');
  Q.send({ t: 'move', from: 'd2', to: 'd4', ply: 0 });
  assert.equal((await all([P, Q, S, S2], 'move')).by, 'w');

  // samma token gäller efter rematchen, nu för svart
  await P.close();
  assert.deepEqual(await Q.next('opponent'), { t: 'opponent', status: 'disconnected' });
  P = await connect(srv.port);
  P.send({ t: 'rejoin', code: codeP, token: tokP });
  const j = await P.next('joined');
  assert.equal(j.color, 'b');
  assert.equal(j.token, tokP);
  assert.equal(j.state.watchers, 2);
  assert.deepEqual(j.state.moves.map((m) => m.san), ['d4']);
  assert.deepEqual(await Q.next('opponent'), { t: 'opponent', status: 'reconnected', name: 'Wilma' });
  await S.quiet();
});

step('båda spelarna lämnar → åskådarna får over och sedan no-such-room', async () => {
  P.send({ t: 'leave' }); // Wilma (svart) lämnar mitt i partiet
  assert.deepEqual(await all([Q, S, S2], 'over'), { t: 'over', result: '1-0', reason: 'abandoned' });
  assert.deepEqual(await Q.next('opponent'), { t: 'opponent', status: 'left' });
  Q.send({ t: 'leave' });
  for (const s of [S, S2]) assert.equal((await s.next('error')).code, 'no-such-room');
  await Q.quiet();
  S.send({ t: 'watch', code: codeP });
  assert.equal((await S.next('error')).code, 'no-such-room');
  for (const c of [P, Q, S, S2]) await c.close();
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
