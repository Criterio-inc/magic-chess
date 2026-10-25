// Partiets gång: regler (chess.js), Stockfish, mänskliga drag och animering av varje drag.
import * as THREE from 'three';
import { Chess } from 'chess.js';
import { Choreographer, Director } from './battle.js';
import { GLYPH } from './pieces.js';
import { tick, wait, tween, ease } from './util.js';
import { setVeteran } from './veteran.js';
import { legendById, legendMoves } from './legends.js';

const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
// vinstchans (%) ur centibönder, som Lichess räknar träffsäkerhet
const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, cp)))) - 1);

export class Game {
  constructor({ world, board, lib, fx, sound, engine, analyst, ui, voice }) {
    Object.assign(this, { world, board, lib, fx, sound, engine, analyst, ui, voice });
    this.notes = new Map();
    this.settings = { mode: 'white', elo: 1800, battles: 'cinematic', pace: 1.7 };
    this.director = new Director(world);
    this.director.obstacles = () => [...this.all].filter((p) => p.root.visible)
      .map((p) => ({ pos: p.root.position, h: p.meta.height }));
    this.chor = new Choreographer({ world, board, fx, sound, director: this.director, settings: this.settings, lib, voice });
    this.chess = new Chess();
    this.pieces = new Map();
    this.all = new Set();
    this.busy = false;
    this.selected = null;
    this.token = 0;
    world.addUpdater((dt) => {
      tick(dt);
      for (const p of this.all) p.update(dt);
    });
    this.bindInput();
  }

  // ------------------------------------------------------------------ uppställning

  spawn(type, color, square) {
    const p = this.lib.create(type, color);
    p.square = square;
    this.board.toWorld(square, p.root.position);
    p.root.rotation.y = p.homeAngle();
    this.world.scene.add(p.root);
    this.pieces.set(square, p);
    this.all.add(p);
    const origDispose = p.dispose.bind(p);
    p.dispose = () => { p.wreathOff?.(); origDispose(); this.all.delete(p); };
    return p;
  }

  /** Tillfällig skådespelare (repris): finns i scenen och uppdateras, men står inte i pjäslistan. */
  spawnTemp(type, color, square) {
    const p = this.lib.create(type, color);
    p.square = square;
    this.board.toWorld(square, p.root.position);
    p.root.rotation.y = p.homeAngle();
    this.world.scene.add(p.root);
    this.all.add(p);
    const orig = p.dispose.bind(p);
    p.dispose = () => { orig(); this.all.delete(p); };
    return p;
  }

  clearPieces() {
    for (const p of [...this.all]) p.dispose();
    this.pieces.clear();
  }

  syncFromBoard() {
    this.clearPieces();
    const { id, kills } = this.recountKills();
    for (const row of this.chess.board()) for (const c of row) {
      if (!c) continue;
      const p = this.spawn(c.type, c.color, c.square);
      p.uid = id.get(c.square) || c.square;
      p.kills = kills.get(p.uid) || 0;
      setVeteran(p, p.kills, { fx: this.fx, world: this.world });
    }
    this.graveyardRebuild();
  }

  /** Följ varje pjäs genom historiken (identitet = startrutan) och räkna hur många den har slagit. */
  recountKills() {
    const hist = this.chess.history({ verbose: true });
    const start = hist.length ? new Chess() : this.chess;
    const id = new Map();
    for (const row of start.board()) for (const c of row) if (c) id.set(c.square, c.square);
    const kills = new Map();
    for (const m of hist) {
      const who = id.get(m.from);
      if (m.captured) {
        id.delete(m.flags.includes('e') ? m.to[0] + m.from[1] : m.to);
        kills.set(who, (kills.get(who) || 0) + 1);
      }
      id.delete(m.from);
      id.set(m.to, who);
      if (m.flags.includes('k') || m.flags.includes('q')) {
        const r = m.color === 'w' ? '1' : '8';
        const [rf, rt] = m.flags.includes('k') ? ['h' + r, 'f' + r] : ['a' + r, 'd' + r];
        id.set(rt, id.get(rf));
        id.delete(rf);
      }
    }
    return { id, kills };
  }

  // ------------------------------------------------------------------ kyrkogården vid brädkanten

  /** En slagen pjäs blir en liten staty på ramen, på den slagande sidans högra sida. */
  graveyardAdd(type, color, animate = true) {
    if (!this.lib.minis) return;
    const by = color === 'w' ? 'b' : 'w';
    this.grave ||= { w: [], b: [] };
    const list = this.grave[by];
    const i = list.length;
    const mini = this.lib.createMini(type, color);
    const x = by === 'w' ? 8.72 : -8.72;
    const z = by === 'w' ? 6.9 - i * 0.92 : -6.9 + i * 0.92;
    const s = type === 'r' ? 0.26 : 0.32;
    mini.position.set(x, this.world.meta.frameTop, z);
    mini.rotation.y = by === 'w' ? -Math.PI / 2 : Math.PI / 2;
    this.world.scene.add(mini);
    list.push(mini);
    if (!animate) { mini.scale.setScalar(s); return; }
    mini.scale.setScalar(0.001);
    this.fx.dust(mini.position.clone().setY(mini.position.y + 0.1), 6, 0.3);
    tween(0.6, (k) => mini.scale.setScalar(Math.max(0.001, s * k)), ease.out);
  }

  graveyardRebuild() {
    for (const side of ['w', 'b']) for (const m of this.grave?.[side] || []) m.removeFromParent();
    this.grave = { w: [], b: [] };
    for (const m of this.chess.history({ verbose: true })) if (m.captured) this.graveyardAdd(m.captured, m.color === 'w' ? 'b' : 'w', false);
  }

  humanColor() {
    const m = this.settings.mode;
    if (m === 'online') return this.myColor;
    if (m === 'legend') return null;
    return m === 'white' ? 'w' : m === 'black' ? 'b' : m === 'hotseat' ? this.chess.turn() : null;
  }

  isHumanTurn() {
    const m = this.settings.mode;
    if (m === 'watch' || m === 'legend') return false;
    if (m === 'hotseat') return true;
    if (m === 'online' && this.onlineOver) return false;
    return this.chess.turn() === this.humanColor();
  }

  async newGame(settings) {
    if (window.BC_DEBUG) console.info('[BC] newGame', JSON.stringify(settings), new Error().stack.split('\n')[2]?.trim());
    Object.assign(this.settings, settings);
    const token = ++this.token;
    this.playing = false;
    this.ui.setOnline(false);
    this.onlineOver = null;
    this.remoteQueue = [];
    this.chess = new Chess();
    this.selected = null;
    this.stats = { captures: 0, lost: { w: 0, b: 0 }, lastCapturer: null, streakPiece: null, streak: 0 };
    this.moveAcc = [];
    this.syncFromBoard();
    this.board.setMarks([]);
    this.ui.reset();
    this.saveLocal();
    this.primeAnalysis();
    this.world.setTimeOfDay(this.timeForPly(), true);
    this.chor.lastBattle = null;
    this.engine.newGame();
    await this.engine.setStrength(this.settings.elo >= 3190 ? null : this.settings.elo);
    const side = this.settings.mode === 'black' ? 'b' : 'w';
    await this.director.toHome(side, 2.2);
    if (token !== this.token) return; // ett nyare parti har startats under tiden
    this.voice?.herald('begin');
    if (this.settings.mode === 'legend') {
      this.ui.legendCard(legendById(this.settings.legend));
      await wait(3.2);
      if (token !== this.token) return;
    } else this.ui.toast('To battle!');
    this.nextTurn();
  }

  // ------------------------------------------------------------------ turordning

  async nextTurn() {
    const token = this.token;
    this.updateStatus();
    if (this.chess.isGameOver()) return this.gameOver();
    if (this.settings.mode === 'online') {
      // motståndarens drag kommer från servern och spelas i tur och ordning
      if (this.remoteQueue?.length) return this.play(this.remoteQueue.shift());
      if (!this.isHumanTurn()) {
        this.busy = true;
        if (!this.onlineOver) this.ui.status(this.online?.watching ? `Watching ${this.online.watching}` : `Waiting for ${this.opponentName || 'your opponent'}…`);
        return;
      }
    }
    if (this.settings.mode === 'legend') {
      // berömt parti: nästa drag ur partiet efter en kort andningspaus
      this.busy = true;
      const san = legendMoves(legendById(this.settings.legend))[this.chess.history().length];
      if (!san) return;
      await wait(0.9);
      if (token !== this.token || this.playing) return;
      return this.play(san);
    }
    if (this.isHumanTurn()) {
      this.busy = false;
      this.armBored(token);
      if (this.settings.mode === 'hotseat') this.director.toHome(this.chess.turn(), 1.4);
      return;
    }
    if (this.thinking) return; // bara en sökning åt gången
    this.thinking = true;
    this.busy = true;
    if (window.BC_DEBUG) console.info('[BC] engine turn', this.chess.turn(), 'mode', this.settings.mode, 'token', token);
    this.ui.status(`${this.chess.turn() === 'w' ? 'White' : 'Black'} — Stockfish is thinking…`);
    const t0 = performance.now();
    const time = this.settings.mode === 'watch' ? 700 : this.engine.strong ? 1200 : 700;
    const fen = this.chess.fen();
    let uci;
    try {
      uci = await this.engine.bestMove(fen, time);
    } finally {
      this.thinking = false;
    }
    // svaret gäller bara ställningen det räknades fram för
    if (token !== this.token || this.chess.fen() !== fen) return;
    const spent = performance.now() - t0;
    if (spent < 500) await wait((500 - spent) / 1000);
    if (!uci) return this.gameOver();
    await this.play({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  }

  /** Efter en stunds tvekan muttrar en av spelarens pjäser. */
  armBored(token) {
    clearTimeout(this.boredTimer);
    const color = this.chess.turn();
    this.boredTimer = setTimeout(() => {
      if (token !== this.token || this.busy || this.chess.turn() !== color) return;
      const mine = [...this.all].filter((p) => p.color === color && p.root.visible);
      const p = mine[Math.floor(Math.random() * mine.length)];
      if (p) { this.voice?.piece(p, 'bored'); p.play('victory', { timeScale: 0.6 }).then(() => p.idle()); }
      this.armBored(token);
    }, 26000 + Math.random() * 18000);
  }

  updateStatus() {
    const turn = this.chess.turn() === 'w' ? 'White' : 'Black';
    const check = this.chess.inCheck();
    this.ui.status(check ? `${turn} is in check` : `${turn} to move`, check);
  }

  /** Utför ett drag och animerar det. */
  async play(m) {
    if (this.playing) return; // ett drag animeras redan
    this.playing = true;
    try {
      await this.playMove(m);
    } finally {
      this.playing = false;
      this.setInBattle(false);
    }
    this.afterMove();
  }

  async playMove(m) {
    clearTimeout(this.boredTimer);
    if (window.BC_DEBUG) console.info('[BC] play', JSON.stringify(m), 'mode', this.settings.mode, new Error().stack.split('\n')[2]?.trim());
    const token = this.token;
    this.busy = true;
    this.selected = null;
    this.board.setMarks([]);
    this.board.setHover(null);
    let res;
    this.moved = false;
    try {
      res = this.chess.move(m);
    } catch {
      this.busy = !this.isHumanTurn();
      return;
    }
    // onlineparti: egna drag skickas till servern (ply = halvdrag före draget)
    if (this.settings.mode === 'online' && !m.remote) this.online?.move(m, this.chess.history().length - 1);
    this.analyse(res, token);
    const mover = this.pieces.get(res.from);
    this.pieces.delete(res.from);
    const side = res.color === 'w' ? 'White' : 'Black';
    this.ui.status(res.captured ? `${side} attacks` : `${side} — ${res.san}`);
    const flags = res.flags;
    if (flags.includes('k') || flags.includes('q')) {
      const rank = res.color === 'w' ? '1' : '8';
      const [rf, rt] = flags.includes('k') ? ['h' + rank, 'f' + rank] : ['a' + rank, 'd' + rank];
      const rook = this.pieces.get(rf);
      this.pieces.delete(rf);
      this.voice?.piece(mover, 'select');
      await this.chor.castle(mover, rook, res.from, res.to, rf, rt);
      rook.square = rt;
      this.pieces.set(rt, rook);
    } else if (res.captured) {
      const vsq = flags.includes('e') ? res.to[0] + res.from[1] : res.to;
      const victim = this.pieces.get(vsq);
      this.pieces.delete(vsq);
      this.ui.captured(res.captured, victim.color);
      if (mover.type === 'b' && Math.random() < 0.15) this.voice?.herald('inquisition');  // ingen väntar sig den
      mover.onAttackCry = () => this.voice?.piece(mover, 'attack');
      mover.onGrenade = () => this.voice?.piece(mover, 'grenade');
      victim.onDeathCry = () => this.voice?.piece(victim, 'death');
      victim.onFleshwound = () => this.voice?.piece(victim, 'fleshwound');
      this.setInBattle(true);
      await this.chor.capture(mover, victim, res.from, res.to, vsq, { afterKill: () => this.announceCapture(mover, victim, flags) });
      this.setInBattle(false);
    } else {
      // bakåt = reträtt ("Run away!"), annars ibland en replik på väg
      const back = (res.color === 'w' ? -1 : 1) * (+res.to[1] - +res.from[1]) > 0;
      if (mover.type === 'k' && this.chess.history().length <= 8 && (res.from === 'e1' || res.from === 'e8')) this.voice?.herald('bongcloud');
      if (back && Math.random() < 0.45) this.voice?.piece(mover, 'retreat');
      else if (Math.random() < 0.3) this.voice?.piece(mover, 'move');
      await this.chor.move(mover, res.from, res.to);
    }
    if (token !== this.token) return;
    mover.square = res.to;
    this.pieces.set(res.to, mover);
    if (res.promotion) {
      this.voice?.herald(res.promotion === 'n' ? 'horse' : 'promote');
      const np = await this.chor.promote(mover, () => {
        const q = this.spawn(res.promotion, res.color, res.to);
        q.uid = mover.uid;
        q.kills = mover.kills || 0;
        setVeteran(q, q.kills, { fx: this.fx, world: this.world });
        return q;
      });
      setTimeout(() => this.voice?.piece(np, 'select'), 900);
    }
    this.ui.addMove(res.san, res.color);
    this.animatedPly = this.chess.history().length - 1;
    this.showNote(this.animatedPly);
    this.lastMove = [res.from, res.to];
    this.refreshMarks();
    if (this.chess.inCheck() && !this.chess.isCheckmate()) {
      this.sound.check();
      this.voice?.herald('check');
      this.ui.toast('Check', true);
      const king = this.pieces.get(this.findKing(this.chess.turn()));
      if (king && Math.random() < 0.6) setTimeout(() => this.voice?.piece(king, 'check'), 1300);
    }
    this.moved = true;
  }

  // ------------------------------------------------------------------ online

  /** Partiet börjar (eller återupptas) med serverns ställning. */
  async startOnline(state, color, { fanfare = true } = {}) {
    this.settings.mode = 'online';
    this.myColor = color;
    this.onlineOver = state.over || null;
    this.remoteQueue = [];
    const token = ++this.token;
    this.playing = false;
    this.thinking = false;
    this.chess = new Chess();
    for (const mv of state.moves) this.chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    this.stats = { captures: 0, lost: { w: 0, b: 0 }, lastCapturer: null, streakPiece: null, streak: 0 };
    const opp = color === 'w' ? state.black : state.white;
    this.opponentName = opp?.name || null;
    this.selected = null;
    this.moveAcc = [];
    this.syncFromBoard();
    this.ui.reset();
    this.ui.setOnline(true);
    this.ui.rebuildMoves(this.chess.history({ verbose: true }));
    const h = this.chess.history({ verbose: true });
    this.lastMove = h.length ? [h[h.length - 1].from, h[h.length - 1].to] : null;
    this.refreshMarks();
    this.primeAnalysis();
    this.world.setTimeOfDay(this.timeForPly(), true);
    await this.director.toHome(color || 'w', fanfare ? 2.2 : 0.8); // åskådare (color null) ser det från vit sida
    if (token !== this.token) return;
    if (fanfare) {
      this.voice?.herald('begin');
      this.ui.toast(!color ? 'To battle!' : color === 'w' ? 'You play White' : 'You play Black');
    }
    this.busy = false;
    this.nextTurn();
  }

  /** Ett drag från servern. Egna drag har redan spelats (servern ekar dem). */
  remoteMove(msg) {
    if (msg.by === this.myColor) return;
    this.remoteQueue ||= [];
    const expected = this.chess.history().length + this.remoteQueue.length;
    if (msg.ply < expected) return;          // redan känt
    if (msg.ply > expected) { this.online?.resync(); return; } // missat drag: hämta serverns ställning
    this.remoteQueue.push({ from: msg.from, to: msg.to, promotion: msg.promotion, remote: true });
    if (!this.playing) this.play(this.remoteQueue.shift());
  }

  /** Servern avslutade partiet. Matt/patt m.m. visas när draget har spelats klart; uppgivet, remi och övergivet direkt. */
  endOnline(result, reason, { quiet = false } = {}) {
    this.onlineOver = { result, reason };
    const local = ['checkmate', 'stalemate', 'repetition', 'insufficient', 'fifty'];
    if (local.includes(reason)) return;
    const winner = result === '1-0' ? 'w' : result === '0-1' ? 'b' : null;
    const me = winner === this.myColor;
    const watching = !this.myColor; // åskådare: berätta ur båda sidors perspektiv
    const loser = winner === 'w' ? 'Black' : 'White';
    const title = reason === 'draw-agreed' ? 'Draw' : watching ? `${winner === 'w' ? 'White' : 'Black'} wins` : me ? 'Victory' : 'Defeat';
    const text = reason === 'draw-agreed' ? 'Both sides agree to a draw.'
      : watching ? (reason === 'resign' ? `${loser} lays down the sword.` : `${loser} fled the arena.`)
      : reason === 'resign' ? (me ? 'Your opponent yields the field.' : 'You laid down your sword.')
      : (me ? 'Your opponent fled the arena.' : 'You left the arena.');
    if (!quiet) { // quiet = återansluten till ett redan avgjort parti
      this.voice?.herald(winner ? (winner === 'w' ? 'whiteWins' : 'blackWins') : 'draw');
      if (winner) this.sound.fanfare(me || watching);
    }
    this.ui.status(title);
    this.busy = true;
    const token = this.token;
    this.summary().then((st) => token === this.token && this.ui.gameOver(title, text, st));
  }

  // ------------------------------------------------------------------ dragbedömning (Stockfish)

  /** Värdera utgångsställningen så att första draget har något att jämföras med. */
  primeAnalysis() {
    this.notes = new Map();
    this.animatedPly = this.chess.history().length - 1;
    const fen = this.chess.fen();
    this.evalPromise = this.analyst ? this.analyst.evaluate(fen, this.analysisMs()) : Promise.resolve({ cp: 0, best: null });
  }

  analysisMs() { return this.world.tierName === 'low' ? 140 : 260; }

  /** Jämför värderingen före och efter draget: ?? = grov miss, ? = misstag, !! = korrekt offer. */
  analyse(res, token) {
    if (!this.analyst) return;
    const ply = this.chess.history().length - 1;
    const before = this.evalPromise || Promise.resolve({ cp: 0, best: null });
    const after = this.analyst.evaluate(this.chess.fen(), this.analysisMs());
    this.evalPromise = after;
    // material för offerbedömningen räknas på ställningen direkt efter draget
    const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    const opp = res.color === 'w' ? 'b' : 'w';
    const v = VAL[res.promotion || res.piece];
    const attackers = this.chess.attackers(res.to, opp).map((sq) => VAL[this.chess.get(sq)?.type] ?? 9);
    const defenders = this.chess.attackers(res.to, res.color).length;
    const sacrifice = v >= 3 && attackers.length > 0 && (defenders === 0 || Math.min(...attackers) < v) && (VAL[res.captured] || 0) < v - 1;
    this.lastAnalysis = Promise.all([before, after]).then(([b, a]) => {
      if (token !== this.token) return;
      const delta = -a.cp - b.cp; // ur den dragandes perspektiv
      // träffsäkerhet: hur mycket vinstchans draget kostade (Lichess-formeln)
      const loss = Math.max(0, winPct(b.cp) - winPct(-a.cp));
      (this.moveAcc ||= [])[ply] = { color: res.color, san: res.san, loss, acc: Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669)) };
      const uci = res.from + res.to + (res.promotion || '');
      let sym = null;
      if (delta <= -250 && b.cp > -700) sym = '??';
      else if (delta <= -110 && b.cp > -700) sym = '?';
      else if (sacrifice && b.best === uci && delta >= -40) sym = '!!';
      if (!sym) return;
      this.notes.set(ply, sym);
      if (this.animatedPly >= ply) this.showNote(ply);
    });
  }

  showNote(ply) {
    const sym = this.notes.get(ply);
    if (!sym || this.shownNote === ply) return;
    this.shownNote = ply;
    const mv = this.chess.history({ verbose: true })[ply];
    const piece = mv && this.pieces.get(mv.to);
    this.ui.annotateMove(ply, sym);
    if (piece) this.ui.badge(sym, () => piece.root.visible ? piece.root.position.clone().setY(piece.root.position.y + piece.meta.height + 0.45) : null, this.world.camera);
    if (sym === '??') setTimeout(() => this.voice?.herald('blunder'), 900);
    else if (sym === '!!') setTimeout(() => this.voice?.herald('brilliant'), 900);
  }

  /** Tiden på dygnet följer partiets längd (cirka 90 halvdrag till skymning). */
  timeForPly(n = this.chess.history().length) { return Math.min(1, n / 90); }

  afterMove() {
    if (!this.moved) return;
    this.moved = false;
    this.world.setTimeOfDay(this.timeForPly());
    this.saveLocal();
    this.nextTurn();
  }

  // ------------------------------------------------------------------ senaste partiet sparas lokalt

  /** Spara lokala partier (inte online: där är servern minnet) så att de kan fortsätta efter omladdning. */
  saveLocal(over = false) {
    if (this.settings.mode === 'online') return;
    const moves = this.chess.history({ verbose: true }).map((m) => ({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) }));
    const data = { v: 1, settings: { ...this.settings }, moves, over: over || this.chess.isGameOver(), savedAt: Date.now() };
    try { localStorage.setItem('bc.lastGame', JSON.stringify(data)); } catch { /* fullt eller privat läge */ }
  }

  static loadLocal() {
    try {
      const d = JSON.parse(localStorage.getItem('bc.lastGame'));
      return d && d.v === 1 && !d.over && d.moves?.length ? d : null;
    } catch { return null; }
  }

  /** Fortsätt ett sparat parti: spela upp dragen utan animation och ta vid där det slutade. */
  async resume(saved) {
    Object.assign(this.settings, saved.settings);
    const token = ++this.token;
    this.playing = false;
    this.thinking = false;
    this.ui.setOnline(false);
    this.onlineOver = null;
    this.remoteQueue = [];
    this.chess = new Chess();
    for (const m of saved.moves) {
      try { this.chess.move(m); } catch { break; }
    }
    this.stats = { captures: 0, lost: { w: 0, b: 0 }, lastCapturer: null, streakPiece: null, streak: 0 };
    for (const m of this.chess.history({ verbose: true })) if (m.captured) { this.stats.captures++; this.stats.lost[m.color === 'w' ? 'b' : 'w']++; }
    this.selected = null;
    this.moveAcc = [];
    this.syncFromBoard();
    this.ui.reset();
    this.ui.rebuildMoves(this.chess.history({ verbose: true }));
    const h = this.chess.history({ verbose: true });
    this.lastMove = h.length ? [h[h.length - 1].from, h[h.length - 1].to] : null;
    this.refreshMarks();
    this.primeAnalysis();
    this.world.setTimeOfDay(this.timeForPly(), true);
    this.engine.newGame();
    await this.engine.setStrength(this.settings.elo >= 3190 ? null : this.settings.elo);
    const side = this.settings.mode === 'black' ? 'b' : this.settings.mode === 'hotseat' ? this.chess.turn() : 'w';
    await this.director.toHome(side, 1.8);
    if (token !== this.token) return;
    this.ui.toast('The battle resumes');
    this.busy = false;
    this.nextTurn();
  }

  /** Härolden och angriparen kommenterar slaget (Mortal Kombat-, Unreal- och Killer Instinct-blinkningar). */
  announceCapture(mover, victim, flags = '') {
    this.graveyardAdd(victim.type, victim.color);
    mover.kills = (mover.kills || 0) + 1;
    setVeteran(mover, mover.kills, { fx: this.fx, world: this.world });
    this.ui.canReplay(true);
    const st = this.stats;
    st.lost[victim.color]++;
    let said = false;
    if (flags.includes('e')) { this.voice?.herald('enPassant'); said = true; }  // "Holy hell!"
    else if (st.captures === 0) { this.voice?.herald('firstBlood'); said = true; }
    else if (st.lastCapturer === victim && Math.random() < 0.6) { this.voice?.herald('comboBreaker'); said = true; }
    if (st.streakPiece === mover) st.streak++; else { st.streakPiece = mover; st.streak = 1; }
    if (!said && st.streak === 2) { this.voice?.herald('doubleKill'); said = true; }
    else if (!said && st.streak >= 3) { this.voice?.herald('killingSpree'); said = true; }
    if (!said && Math.random() < 0.08) { this.voice?.herald('toasty'); said = true; }
    if (!said && Math.random() < 0.55) setTimeout(() => this.voice?.piece(mover, 'kill'), 250);
    st.captures++;
    st.lastCapturer = mover;
  }

  refreshMarks(extra = []) {
    const marks = [];
    if (this.lastMove) marks.push({ square: this.lastMove[0], kind: 'last' }, { square: this.lastMove[1], kind: 'last' });
    if (this.chess.inCheck()) {
      const k = this.findKing(this.chess.turn());
      if (k) marks.push({ square: k, kind: 'check' });
    }
    this.board.setMarks([...marks, ...extra]);
  }

  findKing(color) {
    for (const row of this.chess.board()) for (const c of row) if (c && c.type === 'k' && c.color === color) return c.square;
    return null;
  }

  async gameOver() {
    this.busy = true;
    const token = this.token; // ett nytt parti mitt i slutsekvensen ska inte få det gamla slutkortet
    const c = this.chess;
    let title, text, winner = null;
    if (c.isCheckmate()) {
      winner = c.turn() === 'w' ? 'b' : 'w';
      title = 'Checkmate';
      text = `${winner === 'w' ? 'White' : 'Black'} is victorious.`;
      const ksq = this.findKing(c.turn());
      const king = this.pieces.get(ksq);
      const winners = [...this.pieces.values()].filter((p) => p.color === winner);
      this.ui.toast('Finish him!', true);
      this.voice?.herald('finishHim');
      // vem gav matt? helst den som just drog, annars någon av angriparna
      const atk = this.chess.attackers(ksq, winner);
      const lastTo = this.lastMove?.[1];
      const checkerSq = atk.includes(lastTo) ? lastTo : atk[0];
      const checker = checkerSq ? this.pieces.get(checkerSq) : null;
      if (checker) checker.onGrenade = () => this.voice?.piece(checker, 'grenade');
      this.setInBattle(true);
      if (king) await this.chor.checkmate(king, winners, () => {
        this.ui.toast('Fatality', true);
        setTimeout(() => this.voice?.herald('fatality'), 500);
      }, checker);
      this.setInBattle(false);
      if (token !== this.token) return;
      this.board.setMarks([]);
      await wait(1.2);
      if (token !== this.token) return;
      const flawless = this.stats?.lost[winner] === 0;
      this.voice?.herald(flawless ? 'flawless' : winner === 'w' ? 'whiteWins' : 'blackWins');
      if (flawless) this.ui.toast('Flawless victory');
      const human = this.settings.mode === 'white' ? 'w' : this.settings.mode === 'black' ? 'b' : null;
      this.sound.fanfare(!human || human === winner);
      if (this.settings.mode === 'legend') {
        const l = legendById(this.settings.legend);
        text = `${winner === 'w' ? l.white : l.black} wins. ${l.title}, ${l.where}.`;
      }
    } else {
      title = 'Draw';
      text = c.isStalemate() ? 'Stalemate — no legal move remains.' : c.isThreefoldRepetition() ? 'Threefold repetition.'
        : c.isInsufficientMaterial() ? 'Insufficient material.' : 'The fifty-move rule.';
      this.voice?.herald(c.isStalemate() ? 'stalemate' : c.isThreefoldRepetition() ? 'dejaVu' : 'draw');
      this.ui.toast(c.isStalemate() ? 'Stalemate' : 'Draw');
    }
    this.ui.status(title);
    this.saveLocal(true);
    await wait(1.2);
    if (token !== this.token) return;
    this.director.release();
    const st = await this.summary();
    if (token !== this.token) return;
    this.ui.gameOver(title, text, st);
  }

  /** Efter partiet: träffsäkerhet per sida, värsta missen och veckans MVP (flest slag). */
  async summary() {
    await Promise.race([this.lastAnalysis, wait(2)]);
    const acc = (c) => {
      const l = (this.moveAcc || []).filter((m) => m && m.color === c);
      return l.length ? Math.round(l.reduce((a, m) => a + m.acc, 0) / l.length) : null;
    };
    let blunder = null;
    (this.moveAcc || []).forEach((m, ply) => {
      if (m && m.loss >= 20 && (!blunder || m.loss > blunder.loss)) blunder = { ...m, ply };
    });
    if (blunder) {
      const n = Math.floor(blunder.ply / 2) + 1;
      blunder.label = `${n}${blunder.color === 'w' ? '.' : '…'} ${blunder.san}${this.notes.get(blunder.ply) || ''}`;
    }
    const { kills } = this.recountKills();
    let mvp = null;
    for (const [uid, k] of kills) if (!mvp || k > mvp.kills) mvp = { uid, kills: k };
    if (mvp) {
      const c = new Chess().get(mvp.uid);
      mvp = c ? { ...mvp, name: `${c.color === 'w' ? 'White' : 'Black'} ${NAMES[c.type]}` } : null;
    }
    return { acc: { w: acc('w'), b: acc('b') }, blunder, mvp, moves: Math.ceil(this.chess.history().length / 2) };
  }

  // ------------------------------------------------------------------ hoppa över en duell, tips

  /** Duellflaggan styr om ett tryck snabbspolar och om "Skip"-knappen syns. Slutar duellen slutar spolningen. */
  setInBattle(on) {
    this.inBattle = on;
    document.body.classList.toggle('inbattle', on);
    if (!on) this.endSkip();
  }

  skipBattle() {
    if (!this.inBattle || this.world.fast > 1) return;
    this.world.fast = 8;
    this.sound.hush?.(true);
    document.body.classList.add('skipping');
  }

  endSkip() {
    if (this.world.fast === 1) return;
    this.world.fast = 1;
    this.sound.hush?.(false);
    document.body.classList.remove('skipping');
  }

  /** Visa analysmotorns bästa drag som en glödande pil (inte online). */
  async hint() {
    if (this.settings.mode === 'online' || this.busy || !this.isHumanTurn() || !this.analyst || this.hinting) return;
    this.hinting = true;
    const fen = this.chess.fen();
    try {
      const { best } = await this.analyst.evaluate(fen, 700);
      if (!best || this.chess.fen() !== fen) return;
      this.board.showArrow(best.slice(0, 2), best.slice(2, 4));
      this.sound.bank?.sfx('select', { gain: 0.5 });
    } finally {
      this.hinting = false;
    }
  }

  async undo() {
    if (this.settings.mode === 'online') return;
    if (this.busy && !this.chess.isGameOver()) return;
    if (!this.chess.history().length) return;
    this.token++;
    const plies = this.settings.mode === 'white' || this.settings.mode === 'black'
      ? (this.chess.turn() === this.humanColor() ? 2 : 1) : 1;
    this.playing = false;
    this.thinking = false;
    for (let i = 0; i < plies; i++) this.chess.undo();
    if (this.moveAcc) this.moveAcc.length = Math.min(this.moveAcc.length, this.chess.history().length);
    this.syncFromBoard();
    this.ui.rebuildMoves(this.chess.history({ verbose: true }));
    const h = this.chess.history({ verbose: true });
    this.lastMove = h.length ? [h[h.length - 1].from, h[h.length - 1].to] : null;
    this.refreshMarks();
    this.busy = false;
    this.saveLocal();
    this.primeAnalysis();
    this.world.setTimeOfDay(this.timeForPly());
    this.nextTurn();
  }

  // ------------------------------------------------------------------ repris och fotoläge

  /** Spela upp senaste striden igen med samma attack och samma död. */
  async replay() {
    const lb = this.chor.lastBattle;
    if (!lb || this.playing || this.photoMode || (this.busy && !this.chess.isGameOver())) return;
    this.playing = true;
    this.busy = true;
    clearTimeout(this.boredTimer);
    this.board.setMarks([]);
    this.ui.setReplay(true);
    this.voice?.herald('replay');
    this.sound.bank?.sfx('rewind', { gain: 0.6, rate: 1 });
    await wait(0.6);
    const real = this.pieces.get(lb.to);
    if (real) real.root.visible = false;
    const att = this.spawnTemp(lb.att.type, lb.att.color, lb.from);
    const vic = this.spawnTemp(lb.vic.type, lb.vic.color, lb.victimSquare);
    att.onAttackCry = () => this.voice?.piece(att, 'attack');
    att.onGrenade = () => this.voice?.piece(att, 'grenade');
    vic.onDeathCry = () => this.voice?.piece(vic, 'death');
    vic.onFleshwound = () => this.voice?.piece(vic, 'fleshwound');
    this.chor.force = { death: lb.death, fleshwound: lb.fleshwound, blackKnight: lb.blackKnight };
    this.setInBattle(true);
    try {
      await this.chor.capture(att, vic, lb.from, lb.to, lb.victimSquare, { move: lb.move });
    } finally {
      this.chor.force = null;
      this.setInBattle(false);
      att.dispose();
      if (real) real.root.visible = true;
      this.ui.setReplay(false);
      this.playing = false;
      this.busy = false;
      this.refreshMarks();
    }
    this.nextTurn();
  }

  photo(on) {
    const c = this.world.controls;
    if (on === this.photoMode) return;
    this.photoMode = on;
    this.ui.setPhoto(on);
    if (on) {
      this.photoSaved = { min: c.minDistance, max: c.maxDistance, pan: c.enablePan, polar: c.maxPolarAngle };
      c.enabled = true;
      c.enablePan = true;
      c.minDistance = 1.2;
      c.maxDistance = 70;
      c.maxPolarAngle = THREE.MathUtils.degToRad(89);
      this.world.photoDof = true;
      this.world.setFocus(c.target.clone(), 0.9);
    } else {
      Object.assign(c, { minDistance: this.photoSaved.min, maxDistance: this.photoSaved.max, enablePan: this.photoSaved.pan, maxPolarAngle: this.photoSaved.polar });
      this.world.photoDof = false;
      this.world.setFocus(null, 0);
      this.world.timeScale = 1;
      this.ui.setFrozen(false);
      this.director.toHome(this.director.side, 1.2);
    }
  }

  photoFreeze() {
    this.world.timeScale = this.world.timeScale === 0 ? 1 : 0;
    this.ui.setFrozen(this.world.timeScale === 0);
  }

  /** Tryck i fotoläget: ställ skärpan där. */
  photoFocus(n) {
    const hit = this.board.pick(n, this.world.camera, [...this.all], (sq) => !!this.chess.get(sq));
    const p = hit?.square ? this.board.toWorld(hit.square).setY(this.board.top + 1.0) : null;
    if (p) this.world.setFocus(p, 1);
  }

  async photoSave() {
    this.sound.bank?.sfx('shutter', { gain: 0.7, rate: 1 });
    const flash = document.getElementById('flash');
    const blob = await this.world.capture();
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    if (!blob) return;
    const name = `marble-and-mayhem-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] }) && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
      navigator.share({ files: [file], title: 'Marble & Mayhem' }).catch(() => {});
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ------------------------------------------------------------------ inmatning

  bindInput() {
    const el = this.world.canvas;
    let down = null;
    const ndc = (e) => new THREE.Vector2((e.clientX / el.clientWidth) * 2 - 1, -(e.clientY / el.clientHeight) * 2 + 1);
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('keydown', (e) => {
      if (!this.inBattle || (e.key !== ' ' && e.key !== 'Escape')) return;
      e.preventDefault();
      this.skipBattle();
    });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > (e.pointerType === 'touch' ? 14 : 6)) return; // det var en kameradragning
      this.click(ndc(e));
    });
    el.addEventListener('pointermove', (e) => {
      if (this.busy || !this.isHumanTurn() || e.buttons) return;
      const hit = this.board.pick(ndc(e), this.world.camera, [...this.all], (sq) => !!this.chess.get(sq));
      const sq = hit?.square;
      const own = sq && this.chess.get(sq)?.color === this.chess.turn();
      const target = this.selected && this.legal?.some((m) => m.to === sq);
      this.board.setHover(own || target ? sq : null);
      el.style.cursor = own || target ? 'pointer' : 'default';
    });
  }

  click(n) {
    if (this.photoMode) return this.photoFocus(n);
    if (this.inBattle) return this.skipBattle();
    if (this.busy || !this.isHumanTurn()) return;
    const hit = this.board.pick(n, this.world.camera, [...this.all], (sq) => !!this.chess.get(sq));
    if (!hit?.square) return;
    const sq = hit.square;
    const pc = this.chess.get(sq);
    if (this.selected) {
      const moves = this.legal.filter((m) => m.to === sq);
      if (moves.length) {
        if (moves.some((m) => m.promotion)) {
          this.ui.askPromotion(this.chess.turn()).then((p) => this.play({ from: this.selected, to: sq, promotion: p }));
        } else this.play({ from: this.selected, to: sq });
        return;
      }
    }
    if (pc && pc.color === this.chess.turn()) {
      const now = performance.now();
      this.pokes = this.pokeSq === sq && now - this.pokeT < 2500 ? (this.pokes || 0) + 1 : 1;
      this.pokeSq = sq;
      this.pokeT = now;
      this.selected = sq;
      this.legal = this.chess.moves({ square: sq, verbose: true });
      const piece = this.pieces.get(sq);
      if (piece) this.voice?.piece(piece, this.pokes >= 4 ? 'annoyed' : 'select');
      if (this.pokes >= 4) this.pokes = 0;
      if (!this.voice?.sfx('select', { gain: 0.5 })) this.sound.step(0.4);
      this.refreshMarks([
        { square: sq, kind: 'select' },
        ...this.legal.map((m) => ({ square: m.to, kind: m.captured ? 'capture' : 'move' })),
      ]);
    } else {
      this.selected = null;
      this.refreshMarks();
    }
  }

  glyph(type, color) { return GLYPH[color][type]; }
}
