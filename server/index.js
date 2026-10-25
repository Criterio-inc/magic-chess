// Battlechess online: WebSocket på /ws och GET /health. Protokollet står i PROTOCOL.md,
// spellogiken i rooms.js – här finns bara sockets, hastighetsbegränsning och lagring.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Lobby } from './rooms.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8241);
const DATA_FILE = process.env.DATA_FILE ?? join(HERE, 'data', 'rooms.json');
const ABANDON_MS = Number(process.env.ABANDON_MS ?? 10 * 60_000);
const TRUST_PROXY = !!process.env.TRUST_PROXY; // läs klientens IP ur X-Forwarded-For (bakom nginx o.d.)
const SAVE_MS = 30_000;
const TICK_MS = Math.min(1000, Math.max(50, ABANDON_MS / 4));
const HEARTBEAT_MS = 30_000;
const MSG_PER_SEC = 20;
const CREATES_PER_MIN = 10;

const lobby = new Lobby({ abandonMs: ABANDON_MS });

// ---- lagring ----

function loadRooms() {
  try {
    const n = lobby.load(JSON.parse(readFileSync(DATA_FILE, 'utf8')));
    console.log(`Läste ${n} rum från ${DATA_FILE}`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Kunde inte läsa rummen:', err.message);
  }
}

// Skriv till en temporärfil och byt namn, så att en krasch mitt i aldrig lämnar en halv fil.
function saveRooms() {
  try {
    mkdirSync(dirname(DATA_FILE), { recursive: true });
    writeFileSync(`${DATA_FILE}.tmp`, JSON.stringify(lobby));
    renameSync(`${DATA_FILE}.tmp`, DATA_FILE);
  } catch (err) {
    console.error('Kunde inte spara rummen:', err.message);
  }
}

// ---- högst 10 nya rum per IP och minut ----

const creates = new Map(); // ip -> tidsstämplar inom senaste minuten

function mayCreate(ip) {
  const now = Date.now();
  const recent = (creates.get(ip) ?? []).filter((t) => now - t < 60_000);
  const ok = recent.length < CREATES_PER_MIN;
  if (ok) recent.push(now);
  creates.set(ip, recent);
  return ok;
}

function pruneCreates() {
  const now = Date.now();
  for (const [ip, list] of creates) if (list.every((t) => now - t >= 60_000)) creates.delete(ip);
}

// ---- HTTP + WebSocket ----

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url.split('?')[0] === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws, req) => {
  const forwarded = TRUST_PROXY && req.headers['x-forwarded-for']?.split(',')[0].trim();
  const ip = forwarded || req.socket.remoteAddress;
  const client = {
    room: null,
    color: null,
    send(msg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  const error = (code, message) => client.send({ t: 'error', code, message });
  let windowStart = 0;
  let count = 0;

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data, isBinary) => {
    ws.isAlive = true;
    // Högst 20 meddelanden per sekund; resten kastas (ett felmeddelande per sekund).
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      count = 0;
    }
    if (++count > MSG_PER_SEC) {
      if (count === MSG_PER_SEC + 1) error('rate-limited', 'För många meddelanden');
      return;
    }
    let msg;
    try {
      if (isBinary) throw new Error();
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return error('bad-request', 'Ogiltig JSON');
    }
    if (msg?.t === 'create' && !mayCreate(ip)) return error('rate-limited', 'För många nya rum, vänta en stund');
    lobby.handle(client, msg);
  });

  ws.on('close', () => lobby.disconnect(client));
  ws.on('error', () => {}); // 'close' kommer efteråt
});

// Döda anslutningar (t.ex. en laptop som somnat) upptäcks med ws-ping; webbläsaren svarar själv.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

const ticker = setInterval(() => {
  lobby.tick();
  pruneCreates();
}, TICK_MS);

const saver = setInterval(saveRooms, SAVE_MS);

// ---- start och avstängning ----

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: sparar rummen och stänger`);
  clearInterval(heartbeat);
  clearInterval(ticker);
  clearInterval(saver);
  saveRooms(); // först, innan anslutningarna stängs och spelarna markeras som borta
  for (const ws of wss.clients) ws.close(1001, 'Servern startar om');
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.on('error', (err) => {
  console.error('Servern kunde inte starta:', err.message);
  process.exit(1);
});

loadRooms();
server.listen(PORT, () => {
  console.log(`Battlechess-server på http://localhost:${server.address().port} (WebSocket: /ws)`);
});
