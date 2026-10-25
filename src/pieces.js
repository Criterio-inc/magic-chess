// Pjäsmodeller: laddning, kloning med lagmaterial, animationstillstånd och förflyttning.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { gltfLoader } from './world.js';
import { teamMaterials } from './materials.js';
import { tier } from './quality.js';
import { tween, angleDelta, ease } from './util.js';

export const TYPES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const GLYPH = { w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' }, b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' } };

/** Material med bakad AO läser vertexfärgen; saknas den blir ytan svart. Lägg då till en neutral (AO 1, plan kant). */
export function ensureBakeColor(mesh) {
  const g = mesh.geometry;
  if (g.getAttribute('color')) return;
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { c[i * 4] = 1; c[i * 4 + 1] = 0.5; c[i * 4 + 3] = 1; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 4));
}

export class PieceLibrary {
  async load(onProgress) {
    this.meta = await fetch('/models/pieces.json').then((r) => r.json());
    this.mats = teamMaterials();
    this.models = {};
    await Promise.all(Object.values(TYPES).map(async (name) => {
      const g = await gltfLoader.loadAsync(`/models/${name}${tier.lod}.glb`);
      this.models[name] = g;
      onProgress?.(name);
    }));
  }

  create(type, color) {
    const name = TYPES[type];
    return new Piece(this, name, type, color);
  }

  /** Kaninen, jättefoten och Patsy (valfria: saknas en fil hoppas den händelsen över). */
  async loadExtras() {
    this.extras = {};
    await Promise.all(['rabbit', 'foot', 'patsy'].map(async (n) => {
      try { this.extras[n] = await gltfLoader.loadAsync(`/models/${n}${tier.lod}.glb`); } catch { /* saknas */ }
    }));
    try { this.extras.patsyMeta = await fetch('/models/patsy.json').then((r) => (r.ok ? r.json() : null)); } catch { /* saknas */ }
  }

  /** Små statyer till kyrkogården vid brädkanten: förenklade modeller, stillastående pose. */
  async loadMinis() {
    if (this.minis) return;
    this.minis = {};
    await Promise.all(Object.values(TYPES).map(async (name) => {
      this.minis[name] = tier.lod ? this.models[name] : await gltfLoader.loadAsync(`/models/${name}_lo.glb`);
    }));
  }

  createMini(type, color) {
    const name = TYPES[type];
    const src = this.minis?.[name] || this.models[name];
    const root = new THREE.Group();
    const model = skeletonClone(src.scene);
    const mats = this.mats[color];
    model.traverse((o) => {
      if (!o.isMesh) return;
      const swap = (m) => mats[m.name] || m;
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    });
    root.add(model);
    // ställ statyn i vilopose en gång; ingen animation därefter
    const clip = src.animations.find((c) => c.name === 'victory') || src.animations.find((c) => c.name === 'idle');
    if (clip) {
      const mixer = new THREE.AnimationMixer(model);
      const a = mixer.clipAction(clip);
      a.play();
      a.time = clip.duration * 0.45;
      mixer.update(0);
    }
    return root;
  }
}

export class Piece {
  constructor(lib, name, type, color) {
    this.lib = lib;
    this.name = name;
    this.type = type;
    this.color = color;
    this.meta = lib.meta[name];
    const src = lib.models[name];
    this.root = new THREE.Group();
    this.root.name = `${color}${type}`;
    this.model = skeletonClone(src.scene);
    const mats = lib.mats[color];
    this.meshes = [];
    this.model.traverse((o) => {
      if (o.isMesh) {
        const swap = (m) => mats[m.name] || m;
        o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        this.meshes.push(o);
      }
      // GLTFLoader sanerar nodnamn ('prop.R' -> 'propR'); jämför utan punkter
      const bn = o.isBone ? o.name.replace(/[^A-Za-z]/g, '') : '';
      if (bn === 'propR') this.propR = o;
      if (bn === 'chest') this.chestBone = o;
      if (o.isBone) (this.bones ||= {})[bn] = o;
    });
    this.root.add(this.model);
    // osynlig träffcylinder för klick (billigare och stabilare än att träffa den skinnade meshen)
    const h = this.meta.height;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, h, 10), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = h / 2;
    hit.userData.piece = this;
    this.hit = hit;
    this.root.add(hit);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of src.animations) {
      const a = this.mixer.clipAction(clip);
      this.actions[clip.name] = a;
    }
    this.current = null;
    this.listeners = [];
    this.mixer.addEventListener('finished', (e) => {
      for (const l of [...this.listeners]) if (l.action === e.action) { this.listeners.splice(this.listeners.indexOf(l), 1); l.resolve(); }
    });
    this.timers = [];
    this.play('idle', { loop: true, fade: 0 });
    // idle i otakt så att statyerna inte andas i kör
    this.actions.idle.time = Math.random() * this.actions.idle.getClip().duration;
  }

  get position() { return this.root.position; }

  /** Spela en klipp. Ickeloopande klipp ger ett löfte som löses när klippet är slut. */
  play(name, { loop = false, fade = 0.18, timeScale = 1, events = null, clamp = false } = {}) {
    const a = this.actions[name];
    if (!a) return Promise.resolve();
    const prev = this.current;
    a.reset();
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.timeScale = timeScale;
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.clampWhenFinished = clamp || !loop;
    if (prev && prev !== a && fade > 0) a.crossFadeFrom(prev, fade, false);
    else if (prev && prev !== a) prev.stop();
    a.play();
    this.current = a;
    this.timers = [];
    if (events) {
      for (const [t, fn] of events) this.timers.push({ action: a, t, fn, done: false });
    }
    if (loop) return Promise.resolve();
    return new Promise((resolve) => this.listeners.push({ action: a, resolve }));
  }

  /** Göm ben (och allt under dem), t.ex. en avslagen arm. Gäller efter varje animationsuppdatering. */
  hideBones(names) {
    this.hidden = (this.hidden || []).concat(names.map((n) => this.bones?.[n.replace(/[^A-Za-z]/g, '')]).filter(Boolean));
  }

  update(dt) {
    this.mixer.update(dt);
    if (this.hidden) for (const b of this.hidden) b.scale.setScalar(0.0001);
    for (const tm of this.timers) {
      if (!tm.done && tm.action === this.current && tm.action.time >= tm.t) { tm.done = true; tm.fn(); }
    }
  }

  idle(fade = 0.3) {
    return this.play('idle', { loop: true, fade });
  }

  /** Vänd mot en vinkel (radianer, kring Y). */
  async face(angle, dur = 0.35) {
    const from = this.root.rotation.y;
    const d = angleDelta(from, angle);
    if (Math.abs(d) < 0.02) return;
    await tween(Math.min(0.7, dur * (0.4 + Math.abs(d) / Math.PI)), (k) => { this.root.rotation.y = from + d * k; }, ease.inOut);
  }

  faceTowards(p, dur) {
    const dx = p.x - this.root.position.x, dz = p.z - this.root.position.z;
    return this.face(Math.atan2(dx, dz), dur);
  }

  /** Gå längs punkter (Vector3, y ignoreras) med gångcykeln. */
  async walk(points, pace = 1.7, { clip = 'walk', speed: base } = {}) {
    if (!this.actions[clip]) clip = 'walk';
    const speed = (clip === 'walk' ? this.meta.walkSpeed : base || this.meta.walkSpeed) * pace;
    this.play(clip, { loop: true, fade: 0.22, timeScale: pace });
    for (const p of points) {
      const start = this.root.position.clone();
      const end = new THREE.Vector3(p.x, start.y, p.z);
      const dist = start.distanceTo(end);
      if (dist < 0.01) continue;
      const turn = this.faceTowards(end, 0.3);
      await turn;
      await tween(dist / speed, (k) => this.root.position.lerpVectors(start, end, k), (t) => t);
    }
    this.idle(0.3);
  }

  homeAngle() { return this.color === 'w' ? Math.PI : 0; }

  /** Världsposition för spetsen på vapnet i höger hand (drottningens klot, m.m.). */
  propTip(out, along = 0.35) {
    if (!this.propR) return this.root.getWorldPosition(out).add(new THREE.Vector3(0, this.meta.height * 0.6, 0));
    this.propR.updateWorldMatrix(true, false);
    const m = this.propR.matrixWorld;
    out.setFromMatrixPosition(m);
    const up = new THREE.Vector3().setFromMatrixColumn(m, 1).normalize();
    return out.addScaledVector(up, along * this.meta.height);
  }

  chest(out) {
    this.root.getWorldPosition(out);
    out.y += this.meta.height * 0.62;
    return out;
  }

  dispose() {
    this.root.removeFromParent();
    this.mixer.stopAllAction();
    this.hit.geometry.dispose();
  }
}
