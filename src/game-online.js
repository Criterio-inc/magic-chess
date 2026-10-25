// Onlinepartiet: serverns ställning, motståndarens drag och slutet. Kopplas in i Game (game.js).
import { Chess } from 'chess.js';

export const OnlineMethods = {
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
  },

  /** Ett drag från servern. Egna drag har redan spelats (servern ekar dem). */
  remoteMove(msg) {
    if (msg.by === this.myColor) return;
    this.remoteQueue ||= [];
    const expected = this.chess.history().length + this.remoteQueue.length;
    if (msg.ply < expected) return;          // redan känt
    if (msg.ply > expected) { this.online?.resync(); return; } // missat drag: hämta serverns ställning
    this.remoteQueue.push({ from: msg.from, to: msg.to, promotion: msg.promotion, remote: true });
    if (!this.playing) this.play(this.remoteQueue.shift());
  },

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
  },
};
