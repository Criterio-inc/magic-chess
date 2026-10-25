// Rum och partier enligt PROTOCOL.md – ren logik utan sockets, så att den går att testa.
// En "klient" är vilket objekt som helst med send(obj); lobbyn sätter client.room och client.color
// (spelare) eller client.watching (åskådare).
import { randomInt, randomUUID } from 'node:crypto';
import { Chess } from 'chess.js';

export const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = new RegExp(`^[${ALPHABET}]{6}$`);
const SQUARE_RE = /^[a-h][1-8]$/;
const PROMOTIONS = ['q', 'r', 'b', 'n'];
const MAX_NAME = 24;
const MAX_WATCHERS = 50;
const TAUNT_BURST = 2; // så många glåpord i rad, sedan ett per tauntMs
// Glåporden som får skickas (texterna och rösterna finns i klienten, src/online-extras.js).
export const TAUNTS = ['dalkarl', 'kanslist', 'regler', 'marknad', 'riksdag', 'verkligen', 'beundran', 'skynda'];

const other = (c) => (c === 'w' ? 'b' : 'w');
const winner = (c) => (c === 'w' ? '1-0' : '0-1');

// Fel som skickas som { t: 'error', code, message }
class ProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const bad = (message) => new ProtocolError('bad-request', message);

// Namn: frivilligt, sträng, högst 24 tecken efter trim. Tomt blir null.
function parseName(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw bad('name måste vara en sträng');
  const name = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if ([...name].length > MAX_NAME) throw bad(`name får vara högst ${MAX_NAME} tecken`);
  return name || null;
}

// Kod: skiftlägesokänslig. Fel typ = bad-request, fel format = finns inte.
function parseCode(v) {
  if (typeof v !== 'string') throw bad('code måste vara en sträng');
  const code = v.trim().toUpperCase();
  if (!CODE_RE.test(code)) throw new ProtocolError('no-such-room', 'Rummet finns inte');
  return code;
}

export class Lobby {
  constructor({ abandonMs = 10 * 60_000, ttlMs = 24 * 3_600_000, tauntMs = 4000, now = Date.now } = {}) {
    this.abandonMs = abandonMs;
    this.ttlMs = ttlMs;
    this.tauntMs = tauntMs;
    this.now = now;
    this.rooms = new Map();
  }

  // Ett inkommande meddelande (redan JSON-tolkat). Kastar aldrig.
  handle(client, msg) {
    try {
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw bad('Meddelandet måste vara ett objekt');
      if (typeof msg.t !== 'string' || !Object.hasOwn(HANDLERS, msg.t)) throw bad('Okänd meddelandetyp');
      HANDLERS[msg.t].call(this, client, msg);
    } catch (err) {
      if (!(err instanceof ProtocolError)) {
        console.error('[rooms] oväntat fel:', err);
        err = bad('Internt fel');
      }
      client.send({ t: 'error', code: err.code, message: err.message });
    }
  }

  // Anslutningen tappades (inte samma sak som leave).
  disconnect(client) {
    this._unwatch(client);
    const room = client.room;
    if (!room) return;
    const seat = room.seats[client.color];
    client.room = client.color = null;
    if (seat?.client !== client) return;
    seat.client = null;
    seat.goneAt = this.now();
    this._send(room, other(seat.color), { t: 'opponent', status: 'disconnected' });
  }

  // Körs regelbundet: övergivna partier avgörs, gamla rum städas.
  tick() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      if (room.started && !room.over) {
        for (const c of ['w', 'b']) {
          const seat = room.seats[c];
          // Bara om motståndaren är kvar – det är den som vinner.
          if (!seat.client && seat.goneAt !== null && now - seat.goneAt >= this.abandonMs
              && room.seats[other(c)].client) {
            this._finish(room, winner(other(c)), 'abandoned');
            break;
          }
        }
      }
      const online = ['w', 'b'].some((c) => room.seats[c]?.client);
      if (!online && now - room.lastActive >= this.ttlMs) this._close(room);
    }
  }

  state(room) {
    const info = (s) => ({ name: s?.name ?? null, online: !!s?.client });
    return {
      fen: room.chess.fen(),
      moves: room.moves.slice(),
      white: info(room.seats.w),
      black: info(room.seats.b),
      turn: room.chess.turn(),
      over: room.over,
      ply: room.moves.length,
      watchers: room.watchers.size,
    };
  }

  // Det som skrivs till rooms.json. Anslutningar sparas inte.
  toJSON() {
    return [...this.rooms.values()].map((r) => ({
      code: r.code,
      seats: Object.fromEntries(['w', 'b'].map((c) => {
        const s = r.seats[c];
        return [c, s && { token: s.token, name: s.name, left: s.left }];
      })),
      moves: r.moves.map(({ from, to, promotion }) => (promotion ? { from, to, promotion } : { from, to })),
      started: r.started,
      over: r.over,
      drawOffer: r.drawOffer,
      rematch: [...r.rematch],
      lastActive: r.lastActive,
    }));
  }

  // Läser tillbaka toJSON(). Alla är frånkopplade efter en omstart; klockan för att överge
  // börjar om nu. Trasiga rum hoppas över.
  load(list) {
    if (!Array.isArray(list)) return 0;
    const now = this.now();
    for (const r of list) {
      try {
        if (!CODE_RE.test(r.code) || this.rooms.has(r.code)) continue;
        const room = this._newRoom(r.code);
        for (const c of ['w', 'b']) {
          const s = r.seats?.[c];
          if (s) room.seats[c] = { color: c, token: s.token ?? null, name: s.name ?? null, left: !!s.left, client: null, goneAt: now };
        }
        for (const m of r.moves ?? []) this._play(room, m);
        room.started = !!r.started;
        if (room.started && !(room.seats.w && room.seats.b)) continue; // pågående parti utan två platser
        room.over = r.over ?? null;
        room.drawOffer = r.drawOffer ?? null;
        room.rematch = new Set(r.rematch ?? []);
        room.lastActive = r.lastActive ?? now;
        this.rooms.set(room.code, room);
      } catch {
        // ogiltigt rum i filen – strunta i det
      }
    }
    return this.rooms.size;
  }

  // ---- internt (understreck = används bara här och av HANDLERS) ----

  _newRoom(code) {
    return {
      code,
      seats: { w: null, b: null },
      chess: new Chess(),
      moves: [],
      started: false,
      over: null,
      drawOffer: null,
      rematch: new Set(),
      watchers: new Set(), // åskådarnas anslutningar (sparas inte)
      lastActive: this.now(),
    };
  }

  _newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  _seat(color, name) {
    return { color, token: randomUUID(), name, left: false, client: null, goneAt: null };
  }

  // Sätter anslutningen på platsen. Satt den någon annanstans räknas det som bortkoppling där.
  _attach(client, room, seat) {
    this._unwatch(client);
    if (client.room && client.room.seats[client.color] !== seat) this.disconnect(client);
    seat.client = client;
    seat.goneAt = null;
    client.room = room;
    client.color = seat.color;
  }

  // Nytt parti (första gången eller rematch). Klockan för att överge börjar om för den som är borta.
  // Spelarna får sin färg i meddelandet (den byts vid rematch), åskådarna bara ställningen.
  _start(room) {
    room.started = true;
    for (const c of ['w', 'b']) {
      const s = room.seats[c];
      if (!s.client) s.goneAt = this.now();
    }
    const state = this.state(room);
    for (const c of ['w', 'b']) this._send(room, c, { t: 'start', state, color: c });
    this._toWatchers(room, { t: 'start', state });
  }

  // Rummet och platsen som anslutningen sitter på, annars bad-request (spectator för åskådare).
  _mine(client) {
    if (client.watching) throw new ProtocolError('spectator', 'Åskådare kan bara titta');
    const room = client.room;
    if (!room || room.seats[client.color]?.client !== client) throw bad('Du är inte med i något rum');
    room.lastActive = this.now();
    return { room, color: client.color };
  }

  _send(room, color, msg) {
    room.seats[color]?.client?.send(msg);
  }

  _toWatchers(room, msg) {
    for (const w of room.watchers) w.send(msg);
  }

  // Till alla i rummet: båda spelarna och åskådarna.
  _broadcast(room, msg) {
    this._send(room, 'w', msg);
    this._send(room, 'b', msg);
    this._toWatchers(room, msg);
  }

  // Antalet åskådare har ändrats.
  _watchersChanged(room) {
    this._broadcast(room, { t: 'watchers', n: room.watchers.size });
  }

  // Åskådaren slutar titta (tar en plats, tittar på ett annat rum, lämnar eller tappar anslutningen).
  _unwatch(client) {
    const room = client.watching;
    if (!room) return;
    client.watching = null;
    if (room.watchers.delete(client)) this._watchersChanged(room);
  }

  // Rummet försvinner; åskådarna får veta det.
  _close(room) {
    this.rooms.delete(room.code);
    for (const w of room.watchers) {
      w.watching = null;
      w.send({ t: 'error', code: 'no-such-room', message: 'Rummet har stängts' });
    }
    room.watchers.clear();
  }

  // Glåpord: hink med TAUNT_BURST polletter som fylls på med en per tauntMs. Hinken följer platsen.
  _mayTaunt(seat) {
    const now = this.now();
    const b = (seat.taunt ??= { tokens: TAUNT_BURST, at: now });
    b.tokens = Math.min(TAUNT_BURST, b.tokens + (now - b.at) / this.tauntMs);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  _reject(client, room, reason) {
    client.send({ t: 'reject', reason, state: this.state(room) });
  }

  _play(room, { from, to, promotion }) {
    const m = room.chess.move(promotion ? { from, to, promotion } : { from, to }); // kastar om olagligt
    const move = { from: m.from, to: m.to, san: m.san };
    if (m.promotion) move.promotion = m.promotion;
    room.moves.push(move);
    return move;
  }

  _finish(room, result, reason) {
    room.over = { result, reason };
    room.drawOffer = null;
    room.rematch.clear();
    this._broadcast(room, { t: 'over', result, reason });
  }

  // Slutet avgörs efter varje drag.
  _checkEnd(room) {
    const c = room.chess;
    if (c.isCheckmate()) return this._finish(room, winner(other(c.turn())), 'checkmate');
    const draw = c.isStalemate() ? 'stalemate'
      : c.isInsufficientMaterial() ? 'insufficient'
      : c.isThreefoldRepetition() ? 'repetition'
      : c.isDrawByFiftyMoves() ? 'fifty'
      : null;
    if (draw) this._finish(room, '1/2-1/2', draw);
  }

  _playing(room) {
    return room.started && !room.over;
  }
}

// Ett handtag per meddelandetyp; `this` är lobbyn.
const HANDLERS = {
  create(client, msg) {
    const color = msg.color ?? 'random';
    if (!['w', 'b', 'random'].includes(color)) throw bad("color måste vara 'w', 'b' eller 'random'");
    const name = parseName(msg.name);
    const c = color === 'random' ? (randomInt(2) ? 'w' : 'b') : color;
    const room = this._newRoom(this._newCode());
    const seat = this._seat(c, name);
    room.seats[c] = seat;
    this.rooms.set(room.code, room);
    this._attach(client, room, seat);
    client.send({ t: 'created', code: room.code, token: seat.token, color: c });
  },

  join(client, msg) {
    const code = parseCode(msg.code);
    const name = parseName(msg.name);
    const room = this.rooms.get(code);
    if (!room) throw new ProtocolError('no-such-room', 'Rummet finns inte');
    if (client.room === room) throw bad('Du är redan med i rummet');
    const c = !room.seats.w ? 'w' : !room.seats.b ? 'b' : null;
    if (!c) throw new ProtocolError('room-full', 'Rummet är fullt');
    const seat = this._seat(c, name);
    room.seats[c] = seat;
    room.lastActive = this.now();
    this._attach(client, room, seat);
    client.send({ t: 'joined', code, token: seat.token, color: c, state: this.state(room) });
    this._send(room, other(c), { t: 'opponent', status: 'joined', name });
    this._start(room);
  },

  rejoin(client, msg) {
    const code = parseCode(msg.code);
    if (typeof msg.token !== 'string') throw bad('token måste vara en sträng');
    const room = this.rooms.get(code);
    if (!room) throw new ProtocolError('no-such-room', 'Rummet finns inte');
    const seat = ['w', 'b'].map((c) => room.seats[c]).find((s) => s?.token && s.token === msg.token);
    if (!seat) throw new ProtocolError('bad-token', 'Okänd token för det här rummet');
    const wasOnline = !!seat.client;
    // En äldre anslutning (t.ex. en annan flik) tappar platsen utan meddelande.
    const old = seat.client;
    if (old && old !== client) {
      old.room = old.color = null;
      seat.client = null;
    }
    this._attach(client, room, seat);
    room.lastActive = this.now();
    const c = seat.color;
    client.send({ t: 'joined', code, token: seat.token, color: c, state: this.state(room) });
    if (!wasOnline) this._send(room, other(c), { t: 'opponent', status: 'reconnected', name: seat.name });
    // Väntande erbjudanden syns inte i state – skicka dem igen.
    if (room.drawOffer === other(c)) client.send({ t: 'draw-offer', by: other(c) });
    if (room.rematch.has(other(c))) client.send({ t: 'rematch', by: other(c) });
  },

  move(client, msg) {
    if (client.watching) return this._reject(client, client.watching, 'spectator');
    const { room, color } = this._mine(client);
    const { from, to, promotion, ply } = msg;
    if (typeof from !== 'string' || !SQUARE_RE.test(from)) throw bad('from måste vara en ruta, t.ex. e2');
    if (typeof to !== 'string' || !SQUARE_RE.test(to)) throw bad('to måste vara en ruta, t.ex. e4');
    if (promotion !== undefined && promotion !== null && !PROMOTIONS.includes(promotion)) {
      throw bad("promotion måste vara 'q', 'r', 'b' eller 'n'");
    }
    if (!Number.isInteger(ply) || ply < 0) throw bad('ply måste vara ett heltal ≥ 0');

    if (!room.started) return this._reject(client, room, 'not-started');
    if (room.over) return this._reject(client, room, 'over');
    if (ply !== room.moves.length) return this._reject(client, room, 'ply');
    if (room.chess.turn() !== color) return this._reject(client, room, 'not-your-turn');
    let move;
    try {
      move = this._play(room, { from, to, promotion: promotion ?? undefined });
    } catch {
      return this._reject(client, room, 'illegal');
    }
    // Ett drag av den som fick ett remierbjudande avböjer det.
    if (room.drawOffer === other(color)) {
      room.drawOffer = null;
      this._send(room, other(color), { t: 'draw-declined' });
    }
    this._broadcast(room, { t: 'move', ...move, ply, fen: room.chess.fen(), by: color });
    this._checkEnd(room);
  },

  resign(client) {
    const { room, color } = this._mine(client);
    if (this._playing(room)) this._finish(room, winner(other(color)), 'resign');
  },

  'draw-offer'(client) {
    const { room, color } = this._mine(client);
    if (!this._playing(room) || room.drawOffer === color) return;
    // Båda har erbjudit remi = överens.
    if (room.drawOffer === other(color)) return this._finish(room, '1/2-1/2', 'draw-agreed');
    room.drawOffer = color;
    this._send(room, other(color), { t: 'draw-offer', by: color });
  },

  'draw-answer'(client, msg) {
    const { room, color } = this._mine(client);
    if (typeof msg.accept !== 'boolean') throw bad('accept måste vara true eller false');
    if (!this._playing(room) || room.drawOffer !== other(color)) return; // inget att svara på
    if (msg.accept) return this._finish(room, '1/2-1/2', 'draw-agreed');
    room.drawOffer = null;
    this._send(room, other(color), { t: 'draw-declined' });
  },

  rematch(client) {
    const { room, color } = this._mine(client);
    const opp = room.seats[other(color)];
    if (!room.over || !opp || opp.left || room.rematch.has(color)) return;
    room.rematch.add(color);
    if (room.rematch.size < 2) {
      this._send(room, other(color), { t: 'rematch', by: color });
      this._toWatchers(room, { t: 'rematch', by: color });
      return;
    }
    // Nytt parti, färgerna byts.
    [room.seats.w, room.seats.b] = [room.seats.b, room.seats.w];
    for (const c of ['w', 'b']) {
      const s = room.seats[c];
      s.color = c;
      if (s.client) s.client.color = c;
    }
    room.chess = new Chess();
    room.moves = [];
    room.over = null;
    room.drawOffer = null;
    room.rematch.clear();
    this._start(room);
  },

  leave(client) {
    if (client.watching) return this._unwatch(client);
    const { room, color } = this._mine(client);
    const seat = room.seats[color];
    seat.client = null;
    seat.token = null; // kan inte återansluta
    seat.left = true;
    client.room = client.color = null;
    const opp = room.seats[other(color)];
    if (!opp || opp.left) return this._close(room);
    if (this._playing(room)) this._finish(room, winner(other(color)), 'abandoned');
    room.rematch.clear();
    this._send(room, other(color), { t: 'opponent', status: 'left' });
  },

  // Titta på ett rum som åskådare: ingen plats, ingen token, inga drag.
  watch(client, msg) {
    const code = parseCode(msg.code);
    const room = this.rooms.get(code);
    if (!room) throw new ProtocolError('no-such-room', 'Rummet finns inte');
    if (client.room === room) throw bad('Du spelar redan i rummet');
    if (client.watching === room) return client.send({ t: 'watching', code, state: this.state(room) }); // synka igen
    if (room.watchers.size >= MAX_WATCHERS) throw new ProtocolError('room-full', 'För många åskådare');
    if (client.room) this.disconnect(client); // lämnar sin plats som vid en tappad anslutning
    this._unwatch(client);
    room.watchers.add(client);
    client.watching = room;
    client.send({ t: 'watching', code, state: this.state(room) });
    this._watchersChanged(room);
    // väntande rematch-önskemål syns inte i state
    for (const c of room.rematch) client.send({ t: 'rematch', by: c });
  },

  // Glåpord till motståndaren och åskådarna (och ett eko till avsändaren).
  taunt(client, msg) {
    const { room, color } = this._mine(client);
    if (typeof msg.id !== 'string' || !TAUNTS.includes(msg.id)) throw bad('Okänt glåpord');
    if (!this._mayTaunt(room.seats[color])) throw new ProtocolError('rate-limited', 'Lugn i stormen – ett glåpord i taget');
    this._broadcast(room, { t: 'taunt', id: msg.id, by: color });
  },

  ping(client) {
    client.send({ t: 'pong' });
  },
};
