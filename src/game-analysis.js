// Dragbedömningen med Stockfish och sammanfattningen efter partiet. Kopplas in i Game (game.js).
import { wait } from './util.js';

// vinstchans (%) ur centibönder, som Lichess räknar träffsäkerhet
const SV = { p: 'bonde', n: 'springare', b: 'löpare', r: 'torn', q: 'dam', k: 'kung' };
const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, cp)))) - 1);

export const AnalysisMethods = {
  /** Värdera utgångsställningen så att första draget har något att jämföras med. */
  primeAnalysis() {
    this.notes = new Map();
    this.animatedPly = this.chess.history().length - 1;
    const fen = this.chess.fen();
    this.evalPromise = this.analyst ? this.analyst.evaluate(fen, this.analysisMs()) : Promise.resolve({ cp: 0, best: null });
  },

  analysisMs() { return this.world.tierName === 'low' ? 140 : 260; },

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
  },

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
  },

  /** Tiden på dygnet följer partiets längd (cirka 90 halvdrag till skymning). */
  timeForPly(n = this.chess.history().length) { return Math.min(1, n / 90); },

  afterMove() {
    if (!this.moved) return;
    this.moved = false;
    this.world.setTimeOfDay(this.timeForPly());
    this.saveLocal();
    this.nextTurn();
  },

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
      const c = this.freshChess().get(mvp.uid);
      mvp = c ? { ...mvp, name: `${c.color === 'w' ? 'Vit' : 'Svart'} ${SV[c.type]}` } : null;
    }
    return { acc: { w: acc('w'), b: acc('b') }, blunder, mvp, moves: Math.ceil(this.chess.history().length / 2) };
  },
};
