// Senaste lokala partiet sparas och kan fortsätta efter omladdning. Kopplas in i Game (game.js).
import { Chess } from 'chess.js';

export const SaveMethods = {
  /** Spara lokala partier (inte online: där är servern minnet) så att de kan fortsätta efter omladdning. */
  saveLocal(over = false) {
    if (this.settings.mode === 'online') return;
    const moves = this.chess.history({ verbose: true }).map((m) => ({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) }));
    const data = { v: 1, settings: { ...this.settings }, moves, over: over || this.chess.isGameOver(), savedAt: Date.now() };
    try { localStorage.setItem('bc.lastGame', JSON.stringify(data)); } catch { /* fullt eller privat läge */ }
  },

  /** Även Game.loadLocal() (main.js frågar innan något parti finns). */
  loadLocal() {
    try {
      const d = JSON.parse(localStorage.getItem('bc.lastGame'));
      return d && d.v === 1 && !d.over && d.moves?.length ? d : null;
    } catch { return null; }
  },

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
  },
};
