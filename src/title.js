// Titelsekvensen: filmiska bilder av statyerna bakom loggan, med svarta övertoningar mellan klippen,
// och glöd som driver uppåt över skärmen.
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Varje bild: kamerans start/slut och blickpunktens start/slut under bildens längd (s).
const SHOTS = [
  { dur: 7, from: V(-9.5, 2.1, 3.9), to: V(4.5, 2.15, 3.8), look0: V(-6.5, 2.0, 5), look1: V(7, 2.0, 5) },           // de vita böndernas ansikten
  { dur: 6.5, from: V(-11, 0.9, 8.6), to: V(-10.2, 3.4, 7.8), look0: V(-7, 1.2, 7), look1: V(-7, 2.6, 7) },          // upp längs tornet
  { dur: 6.5, from: V(-3.4, 1.5, -5.4), to: V(-3.9, 1.3, -5.7), look0: V(-5, 2.9, -7), look1: V(-5, 2.7, -7) },      // hästhjälmen mot himlen
  { dur: 7, from: V(10.5, 2.0, -9.5), to: V(8.0, 2.3, -11.5), look0: V(1, 1.6, -7), look1: V(-1, 1.6, -7) },         // svarta linjen i motljus
  { dur: 9, from: V(-18, 6, 16), to: V(14, 13, 19), look0: V(0, 0.8, 0), look1: V(0, 0.8, 0) },                       // hög kranbild över arenan
];

export class Title {
  constructor(world) {
    this.world = world;
    this.fade = document.getElementById('cut');
    this.running = false;
  }

  start() {
    this.running = true;
    const w = this.world;
    w.controls.enabled = false;
    w.controls.autoRotate = false;
    this.camFov = w.camera.fov;
    w.camera.fov = 32;
    w.camera.updateProjectionMatrix();
    this.i = 0;
    this.t = 0;
    this.off = w.addUpdater((dt) => this.update(dt));
    this.embers();
  }

  update(dt) {
    if (!this.running) return;
    const shot = SHOTS[this.i % SHOTS.length];
    this.t += dt;
    const k = Math.min(1, this.t / shot.dur);
    const e = k * k * (3 - 2 * k) * 0.85 + k * 0.15; // mjuk men aldrig stillastående
    const cam = this.world.camera;
    cam.position.lerpVectors(shot.from, shot.to, e);
    const look = shot.look0.clone().lerp(shot.look1, e);
    cam.lookAt(look);
    this.world.setFocus(look, 0.85);
    // svart övertoning sista/första halvsekunden
    const edge = Math.min(this.t, shot.dur - this.t);
    if (this.fade) this.fade.style.opacity = String(Math.max(0, 1 - edge / 0.55));
    if (this.t >= shot.dur) { this.i++; this.t = 0; }
  }

  /** Avsluta sekvensen och lämna tillbaka kameran. */
  stop() {
    if (!this.running) return;
    this.running = false;
    this.off?.();
    this.world.setFocus(null, 0);
    this.world.camera.fov = this.camFov;
    this.world.camera.updateProjectionMatrix();
    if (this.fade) this.fade.style.opacity = '0';
    cancelAnimationFrame(this.emberRaf);
    document.getElementById('embers')?.remove();
  }

  /** Glöd som stiger från nederkanten (2D-canvas ovanpå 3D-bilden, under loggan). */
  embers() {
    const c = document.getElementById('embers');
    if (!c) return;
    const g = c.getContext('2d');
    const parts = [];
    const resize = () => { c.width = innerWidth * Math.min(devicePixelRatio, 2); c.height = innerHeight * Math.min(devicePixelRatio, 2); };
    resize();
    addEventListener('resize', resize);
    const spawn = () => parts.push({ x: Math.random() * c.width, y: c.height + 10, vx: (Math.random() - 0.5) * 0.4, vy: -(0.6 + Math.random() * 1.6),
      r: 0.6 + Math.random() * 2.2, life: 0, max: 280 + Math.random() * 260, ph: Math.random() * 6 });
    const step = () => {
      g.clearRect(0, 0, c.width, c.height);
      if (parts.length < 110) for (let i = 0; i < 2; i++) spawn();
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life++;
        p.ph += 0.03;
        p.x += p.vx + Math.sin(p.ph) * 0.35;
        p.y += p.vy;
        const a = Math.min(1, p.life / 30) * (1 - p.life / p.max);
        if (a <= 0 || p.y < -20) { parts.splice(i, 1); continue; }
        const s = p.r * Math.min(devicePixelRatio, 2);
        const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 4);
        grd.addColorStop(0, `rgba(255,214,140,${a})`);
        grd.addColorStop(0.35, `rgba(255,120,40,${a * 0.6})`);
        grd.addColorStop(1, 'rgba(255,60,10,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(p.x, p.y, s * 4, 0, Math.PI * 2);
        g.fill();
      }
      this.emberRaf = requestAnimationFrame(step);
    };
    step();
  }
}
