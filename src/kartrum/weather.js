// Slagets väder i kartrummet. Rummet tar upp vädret i ljuset (maproom.applyTime: dis, grå himmel, svagare sol) och här
// finns det som syns över brädet: snön som blåser in i fiendens ansikten vid Narva och morgondimman över kartan vid Lützen.
import * as THREE from 'three';
import { TABLE_X } from './atlas.js';

/** haze = extra dis i rummet, grey = hur grå himlen blir, sun = solens andel. */
export const WEATHER = {
  clear: { haze: 0, grey: 0, sun: 1 },
  fog: { haze: 0.0045, grey: 0.85, sun: 0.45 },
  snow: { haze: 0.0012, grey: 0.7, sun: 0.6 },
};

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** Mjuka dimbankar som upprepas utan skarv (varje bank ritas även på motsatt kant). */
function mistTexture(seed = 7) {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let a = seed;
  const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) {
    const x = rnd() * S, y = rnd() * S, r = 30 + rnd() * 60, o = 0.08 + rnd() * 0.12;
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
      const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      grad.addColorStop(0, `rgba(255,255,255,${o})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Kanterna tonas ut, så att dimman inte slutar i en rak kant. */
function fadeTexture() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, S * 0.22, S / 2, S / 2, S * 0.5);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

// snön driver från vits sida (+z) mot svarts, i en låda över brädet
const BOX = { x: 15, z: 15, h: 13 };
const WIND = new THREE.Vector3(1.2, -2.6, -6.5);

export class WeatherFx {
  /** top = brädets ovansida, T = kartans höjd. */
  constructor(scene, T, top) {
    this.scene = scene;
    this.T = T;
    this.top = top;
    this.kind = 'clear';
  }

  set(kind) {
    this.kind = WEATHER[kind] ? kind : 'clear';
    if (this.kind === 'snow') this.snow ||= this.makeSnow();
    if (this.kind === 'fog') this.mist ||= this.makeMist();
    if (this.snow) this.snow.visible = this.kind === 'snow';
    if (this.mist) this.mist.visible = this.kind === 'fog';
  }

  makeSnow() {
    const N = 700, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos.set([(Math.random() * 2 - 1) * BOX.x, this.top + Math.random() * BOX.h, (Math.random() * 2 - 1) * BOX.z], i * 3);
      seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.userData.seed = seed;
    const mat = new THREE.PointsMaterial({ size: 0.17, map: dotTexture(), transparent: true, depthWrite: false, opacity: 0.9 });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    this.scene.add(pts);
    return pts;
  }

  makeMist() {
    // ett lager tätt över kartan runt brädet och ett tunnare som pjäserna vadar i
    const group = new THREE.Group();
    const tex = mistTexture(), alphaMap = fadeTexture();
    const layers = [
      { x: TABLE_X, y: this.T + 0.35, w: 56, d: 39, opacity: 0.8, repeat: 2.5 }, // över kartan, under brädets kant
      { x: 0, y: this.top + 0.25, w: 30, d: 30, opacity: 0.3, repeat: 1.2 },    // kring pjäsernas fötter
    ];
    for (const { x, y, w, d, opacity, repeat } of layers) {
      const t = tex.clone();
      t.needsUpdate = true;
      t.repeat.set(repeat, repeat * d / w);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
        new THREE.MeshBasicMaterial({ map: t, alphaMap, transparent: true, opacity, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, 0);
      m.renderOrder = 2;
      group.add(m);
    }
    group.visible = false;
    this.scene.add(group);
    return group;
  }

  /** dt i sekunder; light = hur ljust rummet är (0–1), så att snö och dimma inte lyser i kvällsmörkret. */
  update(dt, light) {
    if (this.kind === 'snow' && this.snow) {
      const p = this.snow.geometry.attributes.position, seed = this.snow.geometry.userData.seed, a = p.array;
      const t = performance.now() / 1000;
      for (let i = 0; i < p.count; i++) {
        const s = seed[i], j = i * 3;
        a[j] += (WIND.x + Math.sin(t * 1.3 + s) * 1.4) * dt;
        a[j + 1] += WIND.y * (0.7 + (s % 1) * 0.6) * dt;
        a[j + 2] += (WIND.z + Math.cos(t * 0.9 + s) * 1.2) * dt;
        if (a[j + 1] < this.top) a[j + 1] += BOX.h;
        if (a[j + 2] < -BOX.z) a[j + 2] += 2 * BOX.z;
        if (a[j] > BOX.x) a[j] -= 2 * BOX.x;
        else if (a[j] < -BOX.x) a[j] += 2 * BOX.x;
      }
      p.needsUpdate = true;
      this.snow.material.color.setScalar(0.35 + 0.65 * light);
    }
    if (this.kind === 'fog' && this.mist) {
      this.mist.children.forEach((m, i) => {
        m.material.map.offset.x += dt * (i ? 0.004 : 0.0025);
        m.material.map.offset.y += dt * (i ? -0.0015 : 0.001);
        m.material.color.setScalar(0.25 + 0.65 * light);
      });
    }
  }
}
