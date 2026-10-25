// Trumpojken: dyker upp bakom springaren, marscherar efter och slår på trumman i takt med sitt trumklipp.
// När springaren är framme bugar han (ibland med en replik) och försvinner i ett dammoln.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { wait, tween, ease, angleDelta } from './util.js';
import { ensureBakeColor } from './pieces.js';
import { sackcloth, fibreShell, withBake, withFloor } from './materials.js';

const FOLLOW = 0.75;      // m bakom springarens mittpunkt: tätt i hälarna (manteln hänger ~0,35 m bakom honom)
const CAPE_GAP = 0.34;    // m mellan mantelfållen och trumpojkens mittpunkt (händerna och kjolen når ~0,2 m framåt)
const FOLLOW_MAX = 0.95;  // i full galopp släpar manteln efter: då lite längre bak, aldrig mer än så här
const FOLLOW_RATE = 10;   // 1/s inställning mot målpunkten; springarens egen fart läggs på direkt (ingen eftersläpning)
const CLEAR = 0.62;       // m minsta avstånd till springaren: vänder han tvärt går trumpojken runt, inte igenom

/** Trumpojkens egen kostym (samma för båda lagen): bara huden är lagets marmor. Byggs en gång per bibliotek. */
function costume(lib, color) {
  lib.drummerCostume ||= {
    Cloth: withFloor(withBake(sackcloth({ color: 0x24405a, cell: 0.004, contrast: 0.22 }), { dirt: 0.4, edge: 0.35 })), // blå uniformsrock
    Sack: withFloor(withBake(sackcloth({ color: 0xb59569, cell: 0.008, contrast: 0.36, mottle: 0.22 }), { dirt: 0.5, edge: 0.3 })),
    Rope: withFloor(withBake(sackcloth({ color: 0xc8ad7c, cell: 0.003, contrast: 0.45, sheen: 0.2 }), { dirt: 0.4, edge: 0.45 })),
    Felt: withFloor(withBake(sackcloth({ color: 0x1d1b1f, cell: 0.003, contrast: 0.18, mottle: 0.1 }), { dirt: 0.3, edge: 0.4 })), // trekantig hatt
    Wood: withFloor(withBake(fibreShell({ color: 0x7a3c1c, sheenColor: 0xc9853f, fiber: 40, bump: 0.25 }), { dirt: 0.25, edge: 0.35 })), // trumman och stockarna
  };
  return { ...lib.mats[color], ...lib.drummerCostume };
}

export class Drummer {
  constructor(chor, knight) {
    this.chor = chor;
    this.knight = knight;
    const src = chor.lib.extras.drummer;
    const meta = chor.lib.extras.drummerMeta || {};
    this.root = new THREE.Group();
    this.model = skeletonClone(src.scene);
    const mats = costume(chor.lib, knight.color);
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      ensureBakeColor(o);
      const swap = (m) => mats[m.name] || m;
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
      o.castShadow = true;
      o.frustumCulled = false;
    });
    this.root.add(this.model);
    chor.world.scene.add(this.root);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const c of src.animations) this.actions[c.name] = this.mixer.clipAction(c);
    this.beats = meta.events?.drum || [0.13, 0.37];
    this.clipLen = this.actions.drum?.getClip().duration || 0.5;
    const k = knight.root;
    const back = new THREE.Vector3(Math.sin(k.rotation.y), 0, Math.cos(k.rotation.y)).multiplyScalar(-FOLLOW);
    this.root.position.copy(k.position).add(back);
    this.root.rotation.y = k.rotation.y;
    this.lastK = k.position.clone();
    this.lastT = 0;
    this.play('drum');
    this.off = chor.world.addUpdater((dt) => this.update(dt));
    chor.fx.dust(this.root.position.clone().setY(chor.board.top + 0.1), 6, 0.4);
  }

  play(name, loop = true) {
    const a = this.actions[name];
    if (!a) return;
    if (this.cur && this.cur !== a) this.cur.fadeOut(0.2);
    a.reset().fadeIn(0.2).play();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.clampWhenFinished = !loop;
    a.timeScale = loop ? this.chor.settings.pace : 1;
    this.cur = a;
  }

  update(dt) {
    this.mixer.update(dt);
    if (this.finishing) return;
    // följ tätt i springarens hälar: hans förflyttning läggs på direkt, resten ställs in mot en punkt bakom honom
    const k = this.knight.root;
    if (dt > 0) {
      const p = this.root.position;
      const before = p.clone();
      p.x += k.position.x - this.lastK.x;
      p.z += k.position.z - this.lastK.z;
      const fwd = new THREE.Vector3(Math.sin(k.rotation.y), 0, Math.cos(k.rotation.y));
      // avståndet mäts mot mantelns fåll (simulerad, src/capes.js) så att han inte går in i den när den svänger
      const cape = this.knight.cape;
      const hem = cape?.ready ? -cape.x[1].clone().sub(k.position).dot(fwd) : 0.3;
      const follow = THREE.MathUtils.clamp(hem + CAPE_GAP, FOLLOW, FOLLOW_MAX);
      const d = k.position.clone().addScaledVector(fwd, -follow).sub(p).setY(0);
      p.addScaledVector(d, Math.min(1, dt * FOLLOW_RATE));
      const off = p.clone().sub(k.position).setY(0);
      if (off.lengthSq() < 1e-8) off.copy(fwd).negate();
      if (off.length() < CLEAR) p.copy(k.position).addScaledVector(off.normalize(), CLEAR).setY(before.y);
      // vänd mot rörelsen när han travar, annars åt samma håll som springaren
      const mv = p.clone().sub(before).setY(0);
      const want = mv.length() > 0.6 * dt ? Math.atan2(mv.x, mv.z) : k.rotation.y;
      this.root.rotation.y += angleDelta(this.root.rotation.y, want) * Math.min(1, dt * 12);
    }
    this.lastK.copy(k.position);
    // trumslagen på klippets händelsetider
    const a = this.actions.drum;
    if (a && this.cur === a) {
      const t = a.time % this.clipLen;
      const wrapped = t < this.lastT;
      for (const c of this.beats) {
        if ((!wrapped && this.lastT < c && t >= c) || (wrapped && (c > this.lastT || c <= t))) {
          this.chor.sound.bank?.sfx('drum', { gain: 0.85, pan: this.chor.pan(this.root.position) });
        }
      }
      this.lastT = t;
    }
  }

  async finish() {
    if (this.finishing) return;
    this.finishing = true;
    const cam = this.chor.world.camera.position;
    this.root.rotation.y = Math.atan2(cam.x - this.root.position.x, cam.z - this.root.position.z);
    this.play('bow', false);
    if (Math.random() < 0.3) this.chor.voice?.piece({ name: 'drummer', color: 'w' }, 'march');
    await wait(1.5);
    this.chor.fx.dust(this.root.position.clone().setY(this.chor.board.top + 0.2), 10, 0.5);
    await tween(0.3, (k) => this.root.scale.setScalar(Math.max(0.001, 1 - k)), ease.in);
    this.off();
    this.root.removeFromParent();
    this.mixer.stopAllAction();
  }
}
