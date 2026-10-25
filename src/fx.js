// Effekter: partiklar (gnistor, damm, eld, magi), krossade statyer, blixtljus.
import * as THREE from 'three';
import { rand } from './util.js';

function puffTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const img = g.createImageData(s, s);
  // mjuk rund puff med lite brus i kanten
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (x + 0.5) / s * 2 - 1, dy = (y + 0.5) / s * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const n = Math.sin(x * 0.31 + Math.sin(y * 0.17) * 3) * Math.cos(y * 0.27 + Math.sin(x * 0.11) * 2) * 0.5 + 0.5;
      const a = Math.max(0, 1 - r) ** 1.6 * (0.7 + 0.3 * n);
      const i = (y * s + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
}

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec2 iSizeRot;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vColor = iColor;
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iSizeRot.y), s = sin(iSizeRot.y);
  vec2 corner = (uv - 0.5) * iSizeRot.x;
  mvPosition.xy += vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  #include <fog_fragment>
}`;

class Particles {
  constructor(scene, max, blending, map) {
    this.max = max;
    this.list = [];
    const base = new THREE.PlaneGeometry(1, 1);
    const g = (this.geo = new THREE.InstancedBufferGeometry());
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.sr = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.pos);
    g.setAttribute('iColor', this.col);
    g.setAttribute('iSizeRot', this.sr);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: map } }]),
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending, fog: true,
    });
    mat.uniforms.map.value = map;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = blending === THREE.AdditiveBlending ? 3 : 2;
    scene.add(this.mesh);
  }

  /** p: {pos, vel, life, size:[a,b], color:[c0,c1] (THREE.Color), alpha:[a0,a1], gravity, drag, spin, intensity} */
  emit(p) {
    if (this.list.length >= this.max) this.list.shift();
    p.age = 0;
    p.rot = p.rot ?? Math.random() * Math.PI * 2;
    p.spin = p.spin ?? rand(-1, 1);
    p.gravity = p.gravity ?? 0;
    p.drag = p.drag ?? 0;
    p.intensity = p.intensity ?? 1;
    p.alpha = p.alpha ?? [1, 0];
    p.fadeIn = p.fadeIn ?? 0.08;
    this.list.push(p);
  }

  update(dt) {
    const L = this.list;
    let n = 0;
    const tmp = new THREE.Color();
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.age += dt;
      if (p.age >= p.life) { L.splice(i, 1); continue; }
    }
    for (const p of L) {
      const k = p.age / p.life;
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.floor !== undefined && p.pos.y < p.floor) { p.pos.y = p.floor; p.vel.y *= -0.35; p.vel.x *= 0.6; p.vel.z *= 0.6; }
      p.rot += p.spin * dt;
      const size = p.size[0] + (p.size[1] - p.size[0]) * k;
      tmp.copy(p.color[0]).lerp(p.color[1] ?? p.color[0], k);
      const fin = Math.min(1, p.age / p.fadeIn);
      const a = (p.alpha[0] + (p.alpha[1] - p.alpha[0]) * k) * fin;
      this.pos.setXYZ(n, p.pos.x, p.pos.y, p.pos.z);
      this.col.setXYZW(n, tmp.r * p.intensity, tmp.g * p.intensity, tmp.b * p.intensity, a);
      this.sr.setXY(n, size, p.rot);
      n++;
    }
    this.geo.instanceCount = n;
    if (n) {
      this.pos.needsUpdate = true;
      this.col.needsUpdate = true;
      this.sr.needsUpdate = true;
    }
  }
}

const C = (h) => new THREE.Color(h);

export class FX {
  constructor(world) {
    this.world = world;
    this.scene = world.scene;
    const puff = puffTexture();
    this.add = new Particles(this.scene, 3000, THREE.AdditiveBlending, puff);
    this.alpha = new Particles(this.scene, 1500, THREE.NormalBlending, puff);
    this.shards = [];
    // ljus finns alltid (styrka 0 när de vilar) så att shaderprogrammen aldrig behöver kompileras om
    this.flashes = [0, 1].map(() => {
      const l = new THREE.PointLight(0xffffff, 0, 14, 2);
      l.userData.goal = 0;
      this.scene.add(l);
      return l;
    });
    this.fires = [];
    world.addUpdater((dt, t) => this.update(dt, t));
  }

  setGround(y) { this.ground = y; }

  addBrazier(pos) {
    const light = new THREE.PointLight(0xff8a3a, 3, 16, 2);
    light.position.set(pos[0], pos[1] + 0.9, pos[2]);
    this.scene.add(light);
    this.fires.push({ p: new THREE.Vector3(...pos), light, acc: 0, seed: Math.random() * 10 });
  }

  update(dt, t) {
    for (const f of this.fires) {
      f.acc += dt * 46;
      while (f.acc > 1) {
        f.acc -= 1;
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.35;
        this.add.emit({
          pos: f.p.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.02, Math.sin(a) * r)),
          vel: new THREE.Vector3(rand(-0.15, 0.15), rand(0.9, 1.8), rand(-0.15, 0.15)),
          life: rand(0.5, 0.95), size: [rand(0.55, 0.8), 0.12], color: [C(0xffc46a), C(0xff3a0a)], alpha: [0.85, 0], intensity: 2.2, drag: 0.6,
        });
        if (Math.random() < 0.05) {
          this.add.emit({
            pos: f.p.clone().add(new THREE.Vector3(rand(-0.2, 0.2), 0.2, rand(-0.2, 0.2))),
            vel: new THREE.Vector3(rand(-0.4, 0.4), rand(1.5, 3), rand(-0.4, 0.4)), life: rand(1.2, 2.2), size: [0.05, 0.02],
            color: [C(0xffb050)], alpha: [1, 0], intensity: 4, drag: 0.3,
          });
        }
        if (Math.random() < 0.18) {
          this.alpha.emit({
            pos: f.p.clone().add(new THREE.Vector3(0, 0.9, 0)), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(0.6, 1), rand(-0.2, 0.2)),
            life: rand(2, 3.5), size: [0.6, 2.2], color: [C(0x2a2622), C(0x6a625a)], alpha: [0.18, 0], drag: 0.2, fadeIn: 0.4,
          });
        }
      }
      const boost = this.world.fireBoost ?? 1;
      f.light.intensity = (2.6 + Math.sin(t * 11 + f.seed) * 0.5 + Math.sin(t * 23 + f.seed * 2) * 0.35 + (Math.random() - 0.5) * 0.4) * boost;
      f.light.distance = 16 * Math.sqrt(boost);
    }
    for (const l of this.flashes) {
      l.intensity += (l.userData.goal - l.intensity) * Math.min(1, dt * 14);
      l.userData.goal *= Math.pow(0.004, dt);
    }
    this.add.update(dt);
    this.alpha.update(dt);
    this.updateShards(dt);
  }

  flash(pos, color = 0xffffff, power = 30) {
    const l = this.flashes.reduce((a, b) => (a.userData.goal < b.userData.goal ? a : b));
    l.position.copy(pos);
    l.color.set(color);
    l.userData.goal = power;
    l.intensity = power;
  }

  sparks(pos, dir, color = 0xffd9a0, n = 40) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(2, 7));
      if (dir) v.addScaledVector(dir, rand(1, 4));
      this.add.emit({ pos: pos.clone(), vel: v, life: rand(0.25, 0.7), size: [rand(0.05, 0.11), 0.01], color: [C(color), C(0xff6020)],
        alpha: [1, 0], intensity: 6, gravity: 9, drag: 1.2, floor: this.ground, fadeIn: 0.001 });
    }
    this.add.emit({ pos: pos.clone(), vel: new THREE.Vector3(), life: 0.18, size: [1.2, 2.4], color: [C(color)], alpha: [0.9, 0], intensity: 3, fadeIn: 0.001 });
    this.flash(pos, color, 24);
  }

  dust(pos, n = 26, spread = 1.4, color = 0xb9ab95) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(0.6, 2.4) * spread;
      this.alpha.emit({ pos: pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(0, 0.4), rand(-0.3, 0.3))),
        vel: new THREE.Vector3(Math.cos(a) * sp, rand(0.2, 1.2), Math.sin(a) * sp), life: rand(1.4, 2.8), size: [rand(0.6, 1.1), rand(2.2, 3.6)],
        color: [C(color), C(color).multiplyScalar(0.85)], alpha: [0.5, 0], drag: 1.6, fadeIn: 0.05 });
    }
  }

  shockwave(pos, color = 0xc9b9a0) {
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2;
      const sp = rand(5, 8);
      this.alpha.emit({ pos: pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.4, 0.15, Math.sin(a) * 0.4)),
        vel: new THREE.Vector3(Math.cos(a) * sp, rand(0.1, 0.7), Math.sin(a) * sp), life: rand(0.9, 1.5), size: [0.7, 2.6],
        color: [C(color)], alpha: [0.55, 0], drag: 3.2, fadeIn: 0.02 });
    }
    for (let i = 0; i < 26; i++) {
      this.add.emit({ pos: pos.clone().add(new THREE.Vector3(rand(-0.5, 0.5), 0.1, rand(-0.5, 0.5))),
        vel: new THREE.Vector3(rand(-3, 3), rand(3, 7), rand(-3, 3)), life: rand(0.6, 1.2), size: [0.09, 0.05], color: [C(0xd8cbb5)],
        alpha: [0.9, 0.2], intensity: 1, gravity: 14, floor: this.ground });
    }
  }

  holyBurst(pos, color = 0xffe7a8) {
    for (let i = 0; i < 90; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 5));
      this.add.emit({ pos: pos.clone(), vel: v, life: rand(0.6, 1.3), size: [rand(0.12, 0.25), 0.02], color: [C(color), C(0xffb040)],
        alpha: [1, 0], intensity: 5, drag: 2.2, fadeIn: 0.01 });
    }
    for (let i = 0; i < 18; i++) {
      this.add.emit({ pos: pos.clone().add(new THREE.Vector3(0, -1.2 + i * 0.25, 0)), vel: new THREE.Vector3(0, 2, 0), life: 0.6,
        size: [1.4, 0.4], color: [C(color)], alpha: [0.6, 0], intensity: 2.4, fadeIn: 0.01 });
    }
    this.flash(pos, color, 60);
  }

  /** Magiskt klot som flyger från a till b. Löses vid träff. */
  bolt(from, to, color = 0x8fd8ff, dur = 0.42) {
    return new Promise((resolve) => {
      const p = from.clone();
      let t = 0;
      const step = (dt) => {
        t += dt;
        const k = Math.min(1, t / dur);
        p.lerpVectors(from, to, k);
        p.y += Math.sin(k * Math.PI) * 0.6;
        for (let i = 0; i < 6; i++) {
          this.add.emit({ pos: p.clone().add(new THREE.Vector3(rand(-0.06, 0.06), rand(-0.06, 0.06), rand(-0.06, 0.06))),
            vel: new THREE.Vector3(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4)), life: rand(0.25, 0.5), size: [0.5, 0.05],
            color: [C(color), C(0x4060ff)], alpha: [0.9, 0], intensity: 4, fadeIn: 0.001 });
        }
        this.flashes[0].position.copy(p);
        this.flashes[0].color.set(color);
        this.flashes[0].userData.goal = 16;
        if (k >= 1) {
          this.world.updaters.delete(step);
          this.sparks(to, null, color, 70);
          this.holyBurst(to, color);
          resolve();
        }
      };
      this.world.addUpdater(step);
    });
  }

  /** Magi som samlas kring en punkt (drottningen laddar). */
  charge(getPos, color = 0x8fd8ff, dur = 0.8) {
    let t = 0;
    const tmp = new THREE.Vector3();
    const step = (dt) => {
      t += dt;
      getPos(tmp);
      for (let i = 0; i < 4; i++) {
        const off = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.5, 1.0));
        this.add.emit({ pos: tmp.clone().add(off), vel: off.clone().multiplyScalar(-2.2), life: 0.4, size: [0.03, 0.16],
          color: [C(color)], alpha: [0, 1], intensity: 5, fadeIn: 0.001 });
      }
      if (t > dur) this.world.updaters.delete(step);
    };
    this.world.addUpdater(step);
  }

  /** Blixt från himlen ner i en punkt: taggig ljusbana med förgreningar, blixtljus och skak. */
  lightning(to, color = 0xcfe3ff) {
    const from = to.clone().add(new THREE.Vector3(rand(-3, 3), 26, rand(-3, 3)));
    const bolts = [];
    const make = (a, b, depth, radius) => {
      const pts = [a.clone()];
      const n = 14;
      for (let i = 1; i < n; i++) {
        const p = a.clone().lerp(b, i / n);
        const j = (1 - Math.abs(i / n - 0.5) * 2) * a.distanceTo(b) * 0.06 + 0.15;
        p.add(new THREE.Vector3(rand(-j, j), rand(-j * 0.3, j * 0.3), rand(-j, j)));
        pts.push(p);
      }
      pts.push(b.clone());
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 48, radius, 5, false);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const m = new THREE.Mesh(geo, mat);
      this.scene.add(m);
      bolts.push(m);
      if (depth > 0) for (let k = 0; k < 2; k++) {
        const i = 4 + Math.floor(Math.random() * 7);
        const st = pts[i];
        make(st, st.clone().add(new THREE.Vector3(rand(-3, 3), -rand(2, 5), rand(-3, 3))), depth - 1, radius * 0.5);
      }
    };
    make(from, to, 2, 0.07);
    let t = 0;
    const step = (dt) => {
      t += dt;
      const on = t < 0.08 || (t > 0.13 && t < 0.24) || (t > 0.3 && t < 0.4);
      for (const b of bolts) { b.visible = on; b.material.opacity = Math.max(0, 1 - t / 0.5); }
      if (t > 0.5) {
        for (const b of bolts) { b.removeFromParent(); b.geometry.dispose(); b.material.dispose(); }
        this.world.updaters.delete(step);
      }
    };
    this.world.addUpdater(step);
    this.flash(to.clone().add(new THREE.Vector3(0, 2, 0)), color, 160);
    this.sparks(to, null, color, 80);
    this.world.shake = Math.max(this.world.shake, 0.45);
  }

  /** Ljuspelare från himlen (löparens dom). */
  beam(at, color = 0xffe7a8, dur = 1.1) {
    const geo = new THREE.CylinderGeometry(0.75, 0.9, 40, 24, 1, true);
    geo.translate(0, 20, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uA: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uA; varying vec2 vUv; void main(){ float f = (1.0 - vUv.y) * (0.6 + 0.4 * sin(vUv.x * 40.0 + vUv.y * 60.0)); gl_FragColor = vec4(uColor * 3.0, f * uA); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at).setY(this.ground);
    this.scene.add(m);
    let t = 0;
    const step = (dt) => {
      t += dt;
      const k = t / dur;
      mat.uniforms.uA.value = Math.sin(Math.min(1, k) * Math.PI) * 1.2;
      m.scale.set(1 - k * 0.5, 1, 1 - k * 0.5);
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.8;
        this.add.emit({ pos: at.clone().setY(this.ground + 0.1).add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)),
          vel: new THREE.Vector3(0, rand(2, 5), 0), life: rand(0.5, 1), size: [0.12, 0.02], color: [new THREE.Color(color)], alpha: [1, 0], intensity: 5 });
      }
      if (t > dur) { m.removeFromParent(); geo.dispose(); mat.dispose(); this.world.updaters.delete(step); }
    };
    this.world.addUpdater(step);
    this.flash(at.clone().add(new THREE.Vector3(0, 2, 0)), color, 90);
  }

  /** Partikelstråle från a till b under dur sekunder (frostkast). */
  stream(getFrom, to, color = 0xbfe9ff, dur = 0.7) {
    return new Promise((resolve) => {
      let t = 0;
      const from = new THREE.Vector3();
      const step = (dt) => {
        t += dt;
        getFrom(from);
        for (let i = 0; i < 10; i++) {
          const dir = to.clone().sub(from);
          const p = from.clone().addScaledVector(dir, Math.random() * Math.min(1, t / 0.25));
          this.add.emit({ pos: p.add(new THREE.Vector3(rand(-0.08, 0.08), rand(-0.08, 0.08), rand(-0.08, 0.08))),
            vel: dir.normalize().multiplyScalar(rand(1, 3)), life: rand(0.2, 0.45), size: [0.25, 0.04],
            color: [new THREE.Color(color), new THREE.Color(0x5a9cff)], alpha: [0.9, 0], intensity: 3, fadeIn: 0.001 });
        }
        if (t > dur) { this.world.updaters.delete(step); resolve(); }
      };
      this.world.addUpdater(step);
    });
  }

  /** Byt pjäsens material (is, förkolning). Skärvorna ärver det nya materialet. */
  restyle(piece, kind) {
    if (!this.styles) {
      this.styles = {
        ice: new THREE.MeshPhysicalMaterial({ color: 0xcfeeff, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02,
          emissive: 0x2a5d80, emissiveIntensity: 0.35, sheen: 1, sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide }),
        char: new THREE.MeshStandardMaterial({ color: 0x14100d, roughness: 1, emissive: 0x401204, emissiveIntensity: 0.6, side: THREE.DoubleSide }),
      };
    }
    const m = this.styles[kind];
    for (const mesh of piece.meshes) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(() => m) : m;
    const c = piece.chest(new THREE.Vector3());
    if (kind === 'ice') {
      for (let i = 0; i < 70; i++) {
        this.add.emit({ pos: c.clone().add(new THREE.Vector3(rand(-0.5, 0.5), rand(-1, 0.8), rand(-0.5, 0.5))), vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0, 0.6), rand(-0.3, 0.3)),
          life: rand(0.6, 1.4), size: [rand(0.08, 0.18), 0.02], color: [new THREE.Color(0xe6f7ff)], alpha: [1, 0], intensity: 3 });
      }
      this.flash(c, 0x9fdcff, 40);
    } else {
      for (let i = 0; i < 60; i++) {
        this.add.emit({ pos: c.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(-1, 0.8), rand(-0.4, 0.4))), vel: new THREE.Vector3(rand(-0.4, 0.4), rand(0.6, 2), rand(-0.4, 0.4)),
          life: rand(0.8, 1.6), size: [0.05, 0.02], color: [new THREE.Color(0xff8a3a)], alpha: [1, 0], intensity: 5, drag: 0.5 });
      }
      this.alpha.emit({ pos: c.clone(), vel: new THREE.Vector3(0, 0.6, 0), life: 2, size: [1, 3], color: [new THREE.Color(0x221c18)], alpha: [0.5, 0] });
    }
  }

  // ------------------------------------------------------------- krossad staty

  /** Krossar en pjäs i nuvarande pose. dir = riktning bort från angriparen.
   *  opts: power (fart), dust (mängd damm), bones (bara trianglar som sitter på dessa ben), keep (göm inte pjäsen) */
  shatter(piece, dir, opts = {}) {
    const power = opts.power ?? 1;
    const dustAmt = opts.dust ?? 1;
    const scene = this.scene;
    piece.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const world = [];
    const box = new THREE.Box3();
    const colors = [];
    for (const mesh of piece.meshes) {
      const pos = mesh.geometry.getAttribute('position');
      const ca = mesh.geometry.getAttribute('color');
      const carr = new Float32Array(pos.count * 4).fill(1);
      if (ca) for (let i = 0; i < pos.count; i++) { carr[i * 4] = ca.getX(i); carr[i * 4 + 1] = ca.getY(i); carr[i * 4 + 2] = ca.getZ(i); }
      colors.push(carr);
      const arr = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        mesh.getVertexPosition(i, v);
        v.applyMatrix4(mesh.matrixWorld);
        arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
        box.expandByPoint(v);
      }
      world.push(arr);
    }
    const K = opts.bones ? 10 : 34;
    // vilka ben räknas (för delkrossning): dominant ben per vertex ur skinIndex/skinWeight
    const boneOk = opts.bones ? piece.meshes.map((mesh) => {
      const si = mesh.geometry.getAttribute('skinIndex'), sw = mesh.geometry.getAttribute('skinWeight');
      const names = mesh.skeleton.bones.map((b) => b.name.replace(/[^A-Za-z0-9]/g, ''));
      const want = new Set(opts.bones.map((n) => n.replace(/[^A-Za-z0-9]/g, '')));
      const ok = new Uint8Array(si.count);
      for (let i = 0; i < si.count; i++) {
        let best = 0, bw = -1;
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
        ok[i] = want.has(names[best]) ? 1 : 0;
      }
      return ok;
    }) : null;
    const seeds = [];
    const size = box.getSize(new THREE.Vector3());
    for (let i = 0; i < K; i++) seeds.push(new THREE.Vector3(rand(box.min.x, box.max.x), rand(box.min.y, box.max.y), rand(box.min.z, box.max.z)));
    const center = box.getCenter(new THREE.Vector3());
    piece.meshes.forEach((mesh, mi) => {
      const geo = mesh.geometry;
      const idx = geo.index;
      const P = world[mi];
      const Cc = colors[mi];
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const groups = geo.groups.length ? geo.groups : [{ start: 0, count: idx ? idx.count : P.length / 3, materialIndex: 0 }];
      for (const grp of groups) {
        const buckets = new Map();
        for (let t = grp.start; t < grp.start + grp.count; t += 3) {
          const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
          if (boneOk && !(boneOk[mi][a] && boneOk[mi][b] && boneOk[mi][c])) continue;
          const cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
          let best = 0, bd = Infinity;
          for (let s = 0; s < K; s++) {
            const d = (seeds[s].x - cx) ** 2 + (seeds[s].y - cy) ** 2 + (seeds[s].z - cz) ** 2;
            if (d < bd) { bd = d; best = s; }
          }
          let list = buckets.get(best);
          if (!list) buckets.set(best, (list = { p: [], c: [] }));
          list.p.push(P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2], P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
          for (const vi of [a, b, c]) list.c.push(Cc[vi * 4], Cc[vi * 4 + 1], Cc[vi * 4 + 2], 1);
        }
        const mat = mats[grp.materialIndex] || mats[0];
        for (const [s, list] of buckets) {
          const arr = new Float32Array(list.p);
          const c = new THREE.Vector3();
          for (let i = 0; i < arr.length; i += 3) { c.x += arr[i]; c.y += arr[i + 1]; c.z += arr[i + 2]; }
          c.multiplyScalar(3 / arr.length);
          for (let i = 0; i < arr.length; i += 3) { arr[i] -= c.x; arr[i + 1] -= c.y; arr[i + 2] -= c.z; }
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
          g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(list.c), 4));
          g.computeVertexNormals();
          g.computeBoundingSphere();
          const m = new THREE.Mesh(g, mat);
          m.position.copy(c);
          m.castShadow = true;
          m.receiveShadow = true;
          scene.add(m);
          const out = c.clone().sub(center).setY(0).normalize();
          const vel = out.multiplyScalar(rand(0.8, 2.6) * power).addScaledVector(dir, rand(0.6, 2.2) * power);
          vel.y = rand(1.0, 3.6) * Math.sqrt(power);
          this.shards.push({ m, vel, ang: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)), r: g.boundingSphere.radius, age: 0, life: rand(3.2, 4.2) });
        }
      }
    });
    if (!opts.keep) piece.root.visible = false;
    const base = center.clone().setY(this.ground + 0.2);
    const dcol = opts.dustColor ?? (piece.color === 'w' ? 0xd9d2c4 : 0x6e6760);
    if (dustAmt > 0) {
      this.dust(base, Math.round(30 * dustAmt), 1.2 * Math.max(0.6, power), dcol);
      if (!opts.bones) this.shockwave(base, dcol);
    }
    for (let i = 0; i < (opts.bones ? 20 : 60); i++) {
      this.alpha.emit({ pos: center.clone().add(new THREE.Vector3(rand(-0.5, 0.5), rand(-0.6, 0.6), rand(-0.5, 0.5))),
        vel: new THREE.Vector3(rand(-3, 3), rand(1, 5), rand(-3, 3)).addScaledVector(dir, 1.5), life: rand(0.8, 1.6), size: [0.06, 0.04],
        color: [C(piece.color === 'w' ? 0xeee8dc : 0x1b1a1c)], alpha: [1, 1], gravity: 12, floor: this.ground + 0.03, fadeIn: 0.001 });
    }
  }

  updateShards(dt) {
    const g = this.ground;
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.age += dt;
      const m = s.m;
      s.vel.y -= 9.8 * dt;
      m.position.addScaledVector(s.vel, dt);
      m.rotation.x += s.ang.x * dt; m.rotation.y += s.ang.y * dt; m.rotation.z += s.ang.z * dt;
      const floor = g + s.r * 0.35;
      if (m.position.y < floor) {
        m.position.y = floor;
        if (s.vel.y < 0) s.vel.y *= -0.28;
        s.vel.x *= 0.55; s.vel.z *= 0.55;
        s.ang.multiplyScalar(0.5);
      }
      const sink = s.age - (s.life - 1.0);
      if (sink > 0) {
        m.scale.setScalar(Math.max(0.001, 1 - sink));
        m.position.y -= dt * 0.25;
      }
      if (s.age > s.life) {
        m.removeFromParent();
        m.geometry.dispose();
        this.shards.splice(i, 1);
      }
    }
  }
}
