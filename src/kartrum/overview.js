// Översiktsläget (C i stilprovet): kameran över kartbordet, kopparstick i efterbehandlingen och en lampa över bordet.
// Medan översikten är på är den filmkamerans hem (battle.js homePose), så hemflygningar efter varje drag landar här.
// Under en duell tonas kopparsticket bort och kommer tillbaka när kameran flugit hem igen.
import * as THREE from 'three';

const lerp = THREE.MathUtils.lerp;
// world.js setupPost är utgångsläget; ENGRAVED är kopparsticket fullt uppvridet
const NORMAL = { saturation: 0.08, contrast: 0.06, darkness: 0.55, offset: 0.28, bloom: 0.9 };
const ENGRAVED = { saturation: -0.45, contrast: 0.28, darkness: 0.9, offset: 0.18, bloom: 0.15, sepia: 0.7, noise: 0.2, edge: 2.4 };

export class Overview {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.active = false;
    this.k = 0;
    this.refresh = 0;
    world.overview = this;
    world.addUpdater((dt) => this.update(dt));
  }

  /** Kameran över kartbordet från den sida som spelar, så långt bort att brädet och Europa bredvid ryms i bredd. */
  pose(side, aspect) {
    const z = side === 'b' ? -1 : 1;
    const fov = aspect < 1 ? 50 : 40;
    const halfW = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect);
    const dist = 28 / Math.tan(halfW);
    const el = THREE.MathUtils.degToRad(60);
    const target = new THREE.Vector3(-9, 0, -1.5 * z);
    const pos = target.clone().add(new THREE.Vector3(0, Math.sin(el) * dist, Math.cos(el) * dist * z));
    return { pos, target, fov };
  }

  toggle() { this.set(!this.active); }

  set(on) {
    if (on === this.active) return;
    this.active = on;
    const c = this.world.controls;
    if (on) {
      this.savedMax = c.maxDistance;
      c.maxDistance = 90;
    } else if (this.savedMax) {
      c.maxDistance = this.savedMax;
    }
    document.body.classList.toggle('overview', on);
    this.game.director.toHome(this.game.director.side, on ? 1.8 : 1.4);
  }

  update(dt) {
    const goal = this.active && !this.game.inBattle ? 1 : 0;
    if (goal === this.k) return;
    this.k += (goal - this.k) * Math.min(1, dt * 2.5);
    if (Math.abs(goal - this.k) < 0.002) this.k = goal;
    // konturerna följer pjäserna: nya (förvandlade) bönder och slagna som försvinner
    if ((this.refresh -= dt) < 0 && this.k > 0) {
      this.refresh = 0.5;
      this.world.outline.selection.set([...this.game.all].flatMap((p) => p.meshes));
    }
    if (this.k === 0) this.world.outline.selection.clear();
    this.apply();
  }

  apply() {
    const w = this.world, k = this.k;
    w.grade.saturation = lerp(NORMAL.saturation, ENGRAVED.saturation, k);
    w.bc.contrast = lerp(NORMAL.contrast, ENGRAVED.contrast, k);
    w.vignette.darkness = lerp(NORMAL.darkness, ENGRAVED.darkness, k);
    w.vignette.offset = lerp(NORMAL.offset, ENGRAVED.offset, k);
    w.bloom.intensity = lerp(NORMAL.bloom, ENGRAVED.bloom, k);
    w.sepia.blendMode.opacity.value = ENGRAVED.sepia * k;
    w.noise.blendMode.opacity.value = ENGRAVED.noise * k;
    w.outline.edgeStrength = ENGRAVED.edge * k;
    w.room.overview = k;
    w.room.applyTime(w.tod);
  }
}
