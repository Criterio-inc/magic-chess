// Repris av senaste striden och fotoläget. Kopplas in i Game (game.js).
import * as THREE from 'three';
import { wait } from './util.js';

export const PhotoMethods = {
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
  },

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
  },

  photoFreeze() {
    this.world.timeScale = this.world.timeScale === 0 ? 1 : 0;
    this.ui.setFrozen(this.world.timeScale === 0);
  },

  /** Tryck i fotoläget: ställ skärpan där. */
  photoFocus(n) {
    const hit = this.board.pick(n, this.world.camera, [...this.all], (sq) => !!this.chess.get(sq));
    const p = hit?.square ? this.board.toWorld(hit.square).setY(this.board.top + 1.0) : null;
    if (p) this.world.setFocus(p, 1);
  },

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
  },
};
