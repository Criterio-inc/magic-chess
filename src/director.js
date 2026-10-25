// Filmkameran: hemmabilden, flygningar med jobbtoken och bildval för duellerna.
import * as THREE from 'three';
import { tween, ease } from './util.js';

export class Director {
  constructor(world) {
    this.world = world;
    this.cam = world.camera;
    this.controls = world.controls;
    this.busy = false;
    this.side = 'w';
    this.job = 0;
  }

  /** Översiktsbild från en sida. På stående skärmar: brantare och vidare så att hela brädet får plats i bredd. */
  homePose(side) {
    if (this.world.overview?.active) return this.world.overview.pose(side, this.cam.aspect);
    const z = side === 'w' ? 1 : -1;
    const a = this.cam.aspect;
    if (a >= 1.15) return { pos: new THREE.Vector3(0, 18.5, 22.5 * z), target: new THREE.Vector3(0, 0.6, 1.2 * z), fov: 38 };
    const fov = a < 0.8 ? 50 : 44;
    const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * a);
    const dist = 10.8 / Math.tan(halfH);
    const el = THREE.MathUtils.degToRad(a < 0.8 ? 60 : 52);
    const target = new THREE.Vector3(0, 0.6, 1.0 * z);
    const pos = target.clone().add(new THREE.Vector3(0, Math.sin(el) * dist, Math.cos(el) * dist * z));
    return { pos, target, fov };
  }

  async toHome(side = this.side, dur = 1.6) {
    this.side = side;
    const h = this.homePose(side);
    this.stopDrift();
    document.body.classList.remove('battle');
    this.world.setFocus(null, 0);
    if (await this.fly(h.pos, h.target, dur, h.fov)) this.controls.enabled = true;
  }

  /** Flyg kameran. Varje flygning tar över kameran; en äldre flygning som blir avbruten
   *  slutar röra den och returnerar false (annars kan en sen hemflygning slita bort filmbilden). */
  async fly(pos, target, dur = 1.2, fov = null) {
    const job = ++this.job;
    this.controls.enabled = false;
    const p0 = this.cam.position.clone();
    const t0 = this.controls.target.clone();
    const f0 = this.cam.fov;
    const lift = Math.min(4, p0.distanceTo(pos) * 0.12);
    await tween(dur, (k) => {
      if (job !== this.job) return;
      this.cam.position.lerpVectors(p0, pos, k);
      this.cam.position.y += Math.sin(k * Math.PI) * lift;
      this.controls.target.lerpVectors(t0, target, k);
      if (fov) this.cam.fov = f0 + (fov - f0) * k;
      this.cam.updateProjectionMatrix();
      this.cam.lookAt(this.controls.target);
    }, ease.inOutSine);
    return job === this.job;
  }

  /** Hur skymd en kamerasträcka är av andra statyer (0 = fri sikt). */
  occlusion(pos, target, obs) {
    let pen = 0;
    const p = new THREE.Vector3();
    for (const o of obs) {
      for (let i = 1; i <= 12; i++) {
        p.lerpVectors(pos, target, i / 13);
        if (p.y > o.pos.y + o.h + 0.25) continue;
        const d = Math.hypot(p.x - o.pos.x, p.z - o.pos.z);
        if (d < 1.25) pen += (1.25 - d) * (i < 5 ? 3 : 1); // nära kameran är värst
      }
      const dc = Math.hypot(pos.x - o.pos.x, pos.z - o.pos.z);
      if (dc < 2.2 && pos.y < o.pos.y + o.h + 1.5) pen += (2.2 - dc) * 6;
    }
    return pen;
  }

  /** Välj den bild av duellen som skyms minst, helst en låg sidobild från samma sida som nu. */
  chooseShot(a, b) {
    const UP = new THREE.Vector3(0, 1, 0);
    const mid = a.clone().lerp(b, 0.5);
    const d = b.clone().sub(a).setY(0).normalize();
    const side = new THREE.Vector3(-d.z, 0, d.x);
    const target = mid.clone().add(new THREE.Vector3(0, 1.0, 0));
    const camSide = Math.sign(side.dot(this.cam.position.clone().sub(mid))) || 1;
    const portrait = this.cam.aspect < 0.95;
    const obs = (this.obstacles?.() || []).filter((o) => o.pos.distanceTo(a) > 0.7 && o.pos.distanceTo(b) > 0.7);
    // längre avstånd när kombattanterna står långt isär (drottningen kastar på 4 m)
    const k = Math.max(1, (a.distanceTo(b) + 2.2) / 4.2) * (portrait ? 1.2 : 1);
    const sunH = this.world.sunDir.clone().setY(0).normalize();
    let best = null;
    for (const sgn of [1, -1]) {
      for (const ang of portrait ? [0, -30, 30, -55, 55, -75, 75] : [0, -22, 22, -42, 42]) {
        for (const [dist, hgt] of [[7.2, 2.3], [7.6, 3.4], [7.0, 4.8], [8.4, 6.2]]) {
          const dir = side.clone().multiplyScalar(sgn).applyAxisAngle(UP, THREE.MathUtils.degToRad(ang));
          const pos = mid.clone().addScaledVector(dir, dist * k).addScaledVector(d, -1.2).add(new THREE.Vector3(0, hgt * Math.sqrt(k), 0));
          let score = this.occlusion(pos, target, obs);
          if (Math.hypot(pos.x, pos.z) > 16.5) score += 4; // utanför pelarringen
          // aldrig rakt mot den låga solen: bländning i det blanka brädet och statyerna blir siluetter
          const view = target.clone().sub(pos).setY(0).normalize();
          score += Math.max(0, view.dot(sunH) + 0.1) * 5;
          // stående skärm: kombattanterna ska stå i djupled, inte bredvid varandra
          if (portrait) score += (1 - Math.abs(view.dot(d))) * 1.6 - (Math.abs(ang) / 42) * 0.5;
          score += (Math.abs(ang) / 42) * 0.5 + (hgt - 2.3) * 0.22 + (sgn === camSide ? 0 : 0.6);
          // glidningen får inte heller köra in i någon
          let driftSign = 0, driftPen = Infinity;
          for (const ds of [1, -1]) {
            const end = target.clone().add(pos.clone().sub(target).applyAxisAngle(UP, 0.3 * ds).multiplyScalar(0.93));
            const pen = this.occlusion(end, target, obs);
            if (pen < driftPen) { driftPen = pen; driftSign = ds; }
          }
          if (driftPen > 0.3) driftSign = 0;
          if (!best || score < best.score) best = { score, pos, target, driftSign };
        }
      }
    }
    return best;
  }

  /** Ställ upp en sidobild av duellen och låt kameran glida långsamt under striden. */
  async battle(a, b, dur = 1.1) {
    this.saved = { pos: this.cam.position.clone(), target: this.controls.target.clone(), fov: this.cam.fov, aspect: this.cam.aspect };
    document.body.classList.add('battle');
    const { pos, target, driftSign, score } = this.chooseShot(a, b);
    if (window.BC_DEBUG) console.info('[BC] shot', JSON.stringify({ a: a.toArray(), b: b.toArray(), pos: pos.toArray().map((v) => +v.toFixed(2)), target: target.toArray().map((v) => +v.toFixed(2)), score: +score.toFixed(2), driftSign }));
    this.world.setFocus(target, 1);
    if (!(await this.fly(pos, target, dur, this.cam.aspect < 0.95 ? 42 : 30))) return;
    const start = pos.clone();
    const job = this.job;
    const look = target.clone();
    this.followObj = null;
    let t = 0;
    this.drift = this.world.addUpdater((dt) => {
      if (job !== this.job) return;
      t += dt;
      const ang = Math.min(t * 0.05, 0.3) * driftSign;
      const off = start.clone().sub(target).applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      this.cam.position.copy(target).add(off.multiplyScalar(1 - Math.min(t * 0.012, 0.07)));
      // följ en slungad pjäs med blicken
      const goal = this.followObj ? this.followObj.position.clone().add(new THREE.Vector3(0, 1, 0)) : target;
      look.lerp(goal, Math.min(1, dt * 6));
      this.cam.lookAt(look);
      this.world.dof.target.copy(look);
    });
  }

  /** Snabb inzoomning (dödsslag). */
  punch() {
    const f0 = this.cam.fov;
    tween(0.25, (k) => { this.cam.fov = f0 - 5 * k; this.cam.updateProjectionMatrix(); }, ease.out)
      .then(() => tween(0.9, (k) => { this.cam.fov = f0 - 5 * (1 - k); this.cam.updateProjectionMatrix(); }, ease.inOut));
  }

  stopDrift() {
    this.drift?.();
    this.drift = null;
  }

  async endBattle(dur = 1.3) {
    this.stopDrift();
    this.world.setFocus(null, 0);
    document.body.classList.remove('battle');
    // tillbaka till översikten för nuvarande skärmform (telefonen kan ha vridits under striden)
    const h = this.homePose(this.side);
    const s = this.saved && Math.abs((this.saved.aspect ?? 0) - this.cam.aspect) < 0.05 ? this.saved : h;
    if (await this.fly(s.pos, s.target, dur, s.fov ?? h.fov)) this.controls.enabled = true;
  }

  /** Närbild på en punkt (schackmatt), med samma skymningskoll som duellerna. */
  async closeUp(p) {
    this.stopDrift();
    document.body.classList.add('battle');
    const { pos, target } = this.chooseShot(p.clone().add(new THREE.Vector3(0.6, 0, 0)), p.clone().add(new THREE.Vector3(-0.6, 0, 0)));
    this.world.setFocus(target, 1);
    await this.fly(pos, target, 1.5, 30);
  }

  /** Efter partiet: tillbaka till översikten. */
  async release() {
    document.body.classList.remove('battle');
    this.world.setFocus(null, 0);
    await this.toHome(this.side, 1.8);
  }
}
