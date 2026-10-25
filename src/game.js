// Partiets gång: regler (chess.js), Stockfish, mänskliga drag och animering av varje drag.
import { Chess } from 'chess.js';
import { Choreographer } from './battle.js';
import { Director } from './director.js';
import { GLYPH } from './pieces.js';
import { tick, wait, tween, ease } from './util.js';
import { setVeteran } from './veteran.js';
import { legendById, legendMoves } from './legends.js';
import { OnlineMethods } from './game-online.js';
import { AnalysisMethods } from './game-analysis.js';
import { SaveMethods } from './game-save.js';
import { PhotoMethods } from './game-photo.js';
import { InputMethods } from './game-input.js';


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
      if (mover.type === 'b' && Math.random() < 0.15) this.voice?.herald('chapter');  // domkapitlet har talat
      mover.onAttackCry = () => this.voice?.piece(mover, 'attack');
      mover.onBull = () => this.voice?.piece(mover, 'bull');
      victim.onDeathCry = () => this.voice?.piece(victim, 'death');
      victim.onMaim = () => this.voice?.piece(victim, 'maimed');
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
      this.voice?.herald(res.promotion === 'n' ? 'cavalry' : 'promote');
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

  /** Härolden och angriparen kommenterar slaget (Mortal Kombat-, Unreal- och Killer Instinct-blinkningar). */
  announceCapture(mover, victim, flags = '') {
    this.graveyardAdd(victim.type, victim.color);
    mover.kills = (mover.kills || 0) + 1;
    setVeteran(mover, mover.kills, { fx: this.fx, world: this.world });
    this.ui.canReplay(true);
    const st = this.stats;
    st.lost[victim.color]++;
    let said = false;
    if (flags.includes('e')) { this.voice?.herald('enPassant'); said = true; }
    else if (st.captures === 0) { this.voice?.herald('firstCasualty'); said = true; }
    else if (st.lastCapturer === victim && Math.random() < 0.6) { this.voice?.herald('revenge'); said = true; }
    if (st.streakPiece === mover) st.streak++; else { st.streakPiece = mover; st.streak = 1; }
    if (!said && st.streak === 2) { this.voice?.herald('twoAtOnce'); said = true; }
    else if (!said && st.streak >= 3) { this.voice?.herald('rampage'); said = true; }
    if (!said && Math.random() < 0.08) { this.voice?.herald('quip'); said = true; }
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
      this.ui.toast('Nådastöten!', true);
      this.voice?.herald('coupDeGrace');
      // vem gav matt? helst den som just drog, annars någon av angriparna
      const atk = this.chess.attackers(ksq, winner);
      const lastTo = this.lastMove?.[1];
      const checkerSq = atk.includes(lastTo) ? lastTo : atk[0];
      const checker = checkerSq ? this.pieces.get(checkerSq) : null;
      if (checker) checker.onBull = () => this.voice?.piece(checker, 'bull');
      this.setInBattle(true);
      if (king) await this.chor.checkmate(king, winners, () => {
        this.ui.toast('Riket har fallit', true);
        setTimeout(() => this.voice?.herald('realmFalls'), 500);
      }, checker);
      this.setInBattle(false);
      if (token !== this.token) return;
      this.board.setMarks([]);
      await wait(1.2);
      if (token !== this.token) return;
      const spotless = this.stats?.lost[winner] === 0;
      this.voice?.herald(spotless ? 'spotless' : winner === 'w' ? 'whiteWins' : 'blackWins');
      if (spotless) this.ui.toast('Seger utan en skråma');
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


  glyph(type, color) { return GLYPH[color][type]; }
}

// online, dragbedömning, sparande, repris och fotoläge samt inmatning bor i game-*.js
Object.assign(Game.prototype, OnlineMethods, AnalysisMethods, SaveMethods, PhotoMethods, InputMethods);
Game.loadLocal = SaveMethods.loadLocal;
