// Patsy, väpnaren: dyker upp bakom springaren, travar efter och slår ihop kokosnötterna i takt med sitt
// klappklipp. När springaren är framme bugar han (ibland: "It's only a model") och försvinner i ett dammoln.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { wait, tween, ease } from './util.js';
import { ensureBakeColor } from './pieces.js';

export class Patsy {
  constructor(chor, knight) {
    this.chor = chor;
    this.knight = knight;
    const src = chor.lib.extras.patsy;
    const meta = chor.lib.extras.patsyMeta || {};
    this.root = new THREE.Group();
    this.model = skeletonClone(src.scene);
    const mats = chor.lib.mats[knight.color];
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
    this.claps = meta.events?.clap || [0.12, 0.37];
    this.clipLen = this.actions.clap?.getClip().duration || 0.5;
    const k = knight.root;
    const back = new THREE.Vector3(Math.sin(k.rotation.y), 0, Math.cos(k.rotation.y)).multiplyScalar(-1.6);
    this.root.position.copy(k.position).add(back);
    this.root.rotation.y = k.rotation.y;
    this.lastT = 0;
    this.play('clap');
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
    // följ en punkt halvannan meter bakom springaren
    const k = this.knight.root;
    const fwd = new THREE.Vector3(Math.sin(k.rotation.y), 0, Math.cos(k.rotation.y));
    const goal = k.position.clone().addScaledVector(fwd, -1.5);
    const d = goal.sub(this.root.position).setY(0);
    if (d.length() > 0.05) {
      this.root.position.addScaledVector(d, Math.min(1, dt * 3));
      this.root.rotation.y = Math.atan2(d.x, d.z);
    }
    // kokosnötterna slår ihop på klippets händelsetider
    const a = this.actions.clap;
    if (a && this.cur === a) {
      const t = a.time % this.clipLen;
      const wrapped = t < this.lastT;
      for (const c of this.claps) {
        if ((!wrapped && this.lastT < c && t >= c) || (wrapped && (c > this.lastT || c <= t))) {
          this.chor.sound.bank?.sfx('coconut', { gain: 0.85, pan: this.chor.pan(this.root.position) });
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
    if (Math.random() < 0.3) this.chor.voice?.piece({ name: 'patsy', color: 'w' }, 'model');
    await wait(1.5);
    this.chor.fx.dust(this.root.position.clone().setY(this.chor.board.top + 0.2), 10, 0.5);
    await tween(0.3, (k) => this.root.scale.setScalar(Math.max(0.001, 1 - k)), ease.in);
    this.off();
    this.root.removeFromParent();
    this.mixer.stopAllAction();
  }
}
