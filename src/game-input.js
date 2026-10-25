// Klick och tryck på brädet: välja pjäs, dra, avbryta, hoppa över en duell och tips. Kopplas in i Game (game.js).
import * as THREE from 'three';

export const InputMethods = {
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
  },

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
  },

  // ------------------------------------------------------------------ hoppa över en duell, tips

  /** Duellflaggan styr om ett tryck snabbspolar och om "Skip"-knappen syns. Slutar duellen slutar spolningen. */
  setInBattle(on) {
    this.inBattle = on;
    document.body.classList.toggle('inbattle', on);
    if (!on) this.endSkip();
  },

  skipBattle() {
    if (!this.inBattle || this.world.fast > 1) return;
    this.world.fast = 8;
    this.sound.hush?.(true);
    document.body.classList.add('skipping');
  },

  endSkip() {
    if (this.world.fast === 1) return;
    this.world.fast = 1;
    this.sound.hush?.(false);
    document.body.classList.remove('skipping');
  },

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
  },
};
