// Koreografi för drag och slag, och filmkameran som följer dem.
import * as THREE from 'three';
import { tween, wait, ease, rand } from './util.js';
import { Patsy } from './patsy.js';
import { ensureBakeColor } from './pieces.js';

// Attackvarianter per pjäs: klipp, hur nära angriparen går (m), träffeffekt och möjliga dödssätt.
// fleshwound = tvåhuggsattack där första hugget kan slå av en arm ("'Tis but a scratch!").
export const MOVES = {
  pawn: [
    { clip: 'attack', reach: 2.05, fx: 'sparks', deaths: ['topple', 'topple', 'crumble'] },
    { clip: 'attack2', reach: 1.5, fx: 'sparks', first: 'bash', deaths: ['topple', 'launch'], fleshwound: true },
  ],
  knight: [
    { clip: 'attack', reach: 1.55, fx: 'sparks', deaths: ['topple', 'crumble'], fleshwound: true },
    { clip: 'attack2', reach: 1.6, fx: 'sparks', deaths: ['launch', 'topple'] },
  ],
  bishop: [
    { clip: 'attack', reach: 1.7, fx: 'holy', deaths: ['topple', 'crumble'] },
    { clip: 'attack2', reach: 4.2, fx: 'beam', deaths: ['smite'] },
    { clip: 'attack2', reach: 4.6, fx: 'grenade', deaths: ['launch'], weight: 0.8 },
  ],
  rook: [
    { clip: 'attack', reach: 1.75, fx: 'slam', deaths: ['crumble', 'topple'] },
    { clip: 'attack2', reach: 1.6, fx: 'uppercut', deaths: ['launch'] },
  ],
  queen: [
    { clip: 'attack', reach: 4.2, fx: 'bolt', deaths: ['topple', 'smite'] },
    { clip: 'attack2', reach: 4.0, fx: 'frost', deaths: ['freeze'] },
  ],
  king: [
    { clip: 'attack', reach: 1.65, fx: 'sparks', deaths: ['topple', 'crumble'] },
    { clip: 'attack2', reach: 4.0, fx: 'lightning', deaths: ['smite'] },
  ],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

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

/** Punkt längs en polylinje på ett visst avstånd från starten. */
function along(points, len) {
  let left = len;
  for (let i = 0; i < points.length - 1; i++) {
    const seg = points[i].distanceTo(points[i + 1]);
    if (left <= seg) return { point: points[i].clone().lerp(points[i + 1], seg ? left / seg : 0), index: i };
    left -= seg;
  }
  return { point: points[points.length - 1].clone(), index: points.length - 2 };
}

function pathLength(points) {
  let L = 0;
  for (let i = 0; i < points.length - 1; i++) L += points[i].distanceTo(points[i + 1]);
  return L;
}

export class Choreographer {
  constructor({ world, board, fx, sound, director, settings, lib, voice }) {
    Object.assign(this, { world, board, fx, sound, director, settings, lib, voice });
  }

  pan(p) {
    const v = p.clone().project(this.world.camera);
    return THREE.MathUtils.clamp(v.x, -1, 1) * 0.7;
  }

  /** Väg för ett drag: springaren går i L, alla andra rakt. */
  path(piece, from, to) {
    const a = this.board.toWorld(from), b = this.board.toWorld(to);
    if (piece.type !== 'n') return [a, b];
    const df = Math.abs(to.charCodeAt(0) - from.charCodeAt(0)), dr = Math.abs(+to[1] - +from[1]);
    // längre benet först
    const mid = df > dr ? this.board.toWorld(to[0] + from[1]) : this.board.toWorld(from[0] + to[1]);
    return [a, mid, b];
  }

  async move(piece, from, to) {
    const pts = this.path(piece, from, to).slice(1);
    // Ministry of Silly Walks: ibland går en pjäs som John Cleese
    const silly = piece.actions.silly && piece.meta.sillySpeed && piece.type !== 'n' && Math.random() < (this.sillyChance ?? 0.08);
    if (silly && Math.random() < 0.6) this.voice?.herald('silly');
    const steps = this.footsteps(piece);
    await piece.walk(pts, this.settings.pace, silly ? { clip: 'silly', speed: piece.meta.sillySpeed } : {});
    steps();
    await piece.face(piece.homeAngle());
  }

  footsteps(piece) {
    // springaren får sällskap av Patsy och hans kokosnötter
    if (piece.type === 'n' && this.lib?.extras?.patsy) {
      const patsy = new Patsy(this, piece);
      return () => patsy.finish();
    }
    const heavy = piece.type === 'r' ? 1.6 : piece.type === 'q' || piece.type === 'b' ? 0.6 : 1;
    const interval = (piece.actions.walk.getClip().duration / 2) / this.settings.pace;
    let acc = interval * 0.5;
    return this.world.addUpdater((dt) => {
      if (piece.current !== piece.actions.walk && piece.current !== piece.actions.silly) return;
      acc += dt;
      if (acc > interval) {
        acc -= interval;
        // springaren rider på en låtsashäst: kokosnötter i stället för steg
        if (piece.type === 'n' && this.sound.bank?.sfx('coconut', { pan: this.pan(piece.position), gain: 0.8 })) return;
        this.sound.step(heavy, this.pan(piece.position));
        if (piece.type === 'r') { this.world.shake = Math.max(this.world.shake, 0.04); this.fx.dust(piece.position.clone().setY(this.board.top + 0.05), 4, 0.5); }
      }
    });
  }

  async castle(king, rook, kFrom, kTo, rFrom, rTo) {
    const back = king.color === 'w' ? 1.15 : -1.15;
    const stopK = this.footsteps(king);
    await king.walk([this.board.toWorld(kTo)], this.settings.pace);
    stopK();
    const a = this.board.toWorld(rFrom), b = this.board.toWorld(rTo);
    const stopR = this.footsteps(rook);
    await rook.walk([a.clone().setZ(a.z + back), b.clone().setZ(b.z + back), b], this.settings.pace);
    stopR();
    await Promise.all([king.face(king.homeAngle()), rook.face(rook.homeAngle())]);
  }

  /** Välj attackvariant (inte samma som pjästypen använde senast, om det finns fler). */
  chooseMove(att) {
    const list = MOVES[att.name];
    this.lastMove ||= {};
    let pool = list.filter((m, i) => i !== this.lastMove[att.name] || list.length === 1);
    const total = pool.reduce((a, m) => a + (m.weight ?? 1), 0);
    let r = Math.random() * total, mv = pool[0];
    for (const m of pool) { r -= m.weight ?? 1; if (r <= 0) { mv = m; break; } }
    this.lastMove[att.name] = list.indexOf(mv);
    return mv;
  }

  /** Slag: angriparen går fram, duellen spelas, offret dör på ett av flera sätt, angriparen intar rutan. */
  async capture(att, vic, from, to, victimSquare, hooks = {}) {
    const cinematic = this.settings.battles === 'cinematic';
    const pace = this.settings.pace;
    const mv = hooks.move || this.chooseMove(att);
    const path = this.path(att, from, to);
    const vpos = this.board.toWorld(victimSquare);
    if (victimSquare !== to) path[path.length - 1] = vpos.clone(); // en passant
    const total = pathLength(path);
    const strikeLen = Math.max(0, total - mv.reach);
    const { point: strike, index } = along(path, strikeLen);
    const approach = [...path.slice(1, index + 1), strike];
    const force = this.force || {}; // felsökning: BC.game.chor.force = { death: 'freeze', fleshwound: true }
    const death = force.death || hooks.death || pick(mv.deaths);
    if (window.BC_DEBUG) console.info('[BC] battle', att.name, mv.clip, mv.fx, '->', death);

    if (cinematic) await this.director.battle(strike, vpos);
    vic.faceTowards(strike, 0.5);
    if (strikeLen > 0.05) {
      const stop = this.footsteps(att);
      await att.walk(approach, pace);
      stop();
    }
    await att.faceTowards(vpos, 0.3);
    vic.faceTowards(att.position, 0.3);

    const ts = cinematic ? 1 : 1.5;
    const impacts = att.meta.events[mv.clip] || att.meta.events.attack;
    let resolveDeath;
    const deathDone = new Promise((r) => (resolveDeath = r));
    const away = vpos.clone().sub(att.position).setY(0).normalize();
    const hitPoint = () => vic.chest(new THREE.Vector3());
    const col = (w, b) => (att.color === 'w' ? w : b);
    const fleshwound = force.fleshwound ?? (mv.fleshwound && impacts.length > 1 && vic.type !== 'r' && Math.random() < 0.55);
    // repris: allt som behövs för att spela upp samma strid igen
    this.lastBattle = { att: { type: att.type, color: att.color }, vic: { type: vic.type, color: vic.color }, from, to, victimSquare, move: mv, death, fleshwound };

    // ---------- dödssätt
    const kill = () => {
      vic.onDeathCry?.();
      hooks.onKill?.();
      if (cinematic) { this.world.slowmo(0.28, 0.85); this.director.punch(); }
      this.die(vic, death, away, { cinematic }).then(resolveDeath);
    };

    // ---------- träffar
    const hurt = (i) => {
      if (fleshwound && i === 0) {
        // armen åker av, men "det är bara ett köttsår"
        const side = Math.random() < 0.5 ? 'L' : 'R';
        const bones = [`upperarm.${side}`, `forearm.${side}`, `hand.${side}`, `prop.${side}`];
        this.fx.shatter(vic, away, { bones, keep: true, power: 0.9, dust: 0.3 });
        vic.hideBones([`upperarm.${side}`]);
        this.sound.bank?.sfx('arm_crack', { pan: this.pan(vpos) });
        vic.play('hit', { timeScale: 0.9 }).then(() => vic.current === vic.actions.hit && vic.idle(0.2));
        setTimeout(() => vic.onFleshwound?.(), 350);
        return;
      }
      if (cinematic) this.world.hitstop(0.07);
      vic.play('hit', { timeScale: 1.1 }).then(() => vic.current === vic.actions.hit && vic.idle(0.2));
    };
    const meleeFx = (kind, last) => {
      const p = hitPoint(), pan = this.pan(p);
      switch (kind) {
        case 'slam':
          this.fx.shockwave(vpos.clone().setY(this.board.top + 0.05));
          this.fx.dust(vpos.clone().setY(this.board.top + 0.1), 20);
          this.sound.thud(pan, 1.3);
          this.world.shake = 0.35;
          break;
        case 'uppercut':
          this.fx.sparks(p, new THREE.Vector3(0, 1, 0), 0xffe0b0, 40);
          this.fx.dust(vpos.clone().setY(this.board.top + 0.1), 14);
          this.sound.bank?.sfx('punch', { pan }) || this.sound.thud(pan, 1.2);
          this.world.shake = 0.3;
          break;
        case 'holy':
          this.fx.holyBurst(p, col(0xffe7a8, 0xff7a4a));
          this.sound.chime();
          this.sound.thud(pan, 0.6);
          break;
        case 'bash':
          this.fx.dust(p.clone().setY(this.board.top + 0.2), 8, 0.6);
          this.sound.thud(pan, 0.8);
          this.sound.clang(pan);
          break;
        default:
          this.fx.sparks(p, away, 0xffd9a0, 46);
          this.sound.clang(pan);
      }
      if (last) kill(); else hurt(0);
    };
    const tipColor = col(0x8fd8ff, 0xff5a3a);
    const evList = [];
    impacts.forEach((t, i) => {
      const last = i === impacts.length - 1;
      const kind = i === 0 && mv.first ? mv.first : mv.fx;
      switch (kind) {
        case 'bolt':
          evList.push([t, () => {
            const from = att.propTip(new THREE.Vector3());
            this.sound.magic(this.pan(from));
            this.fx.bolt(from, hitPoint(), tipColor).then(() => { this.sound.boom(this.pan(vpos)); last ? kill() : hurt(i); });
          }]);
          break;
        case 'frost':
          evList.push([t - 0.1, () => {
            this.sound.bank?.sfx('frost_ray', { pan: this.pan(vpos) }) || this.sound.magic(this.pan(vpos));
            this.fx.stream((o) => att.propTip(o, 0.05), hitPoint(), 0xbfe9ff, 0.6).then(() => (last ? kill() : hurt(i)));
          }]);
          break;
        case 'beam':
          evList.push([t, () => {
            this.fx.beam(vpos, col(0xffe7a8, 0xffb070));
            this.sound.bank?.sfx('holy_beam', { pan: this.pan(vpos) }) || this.sound.chime();
            wait(0.35).then(() => (last ? kill() : hurt(i)));
          }]);
          break;
        case 'lightning':
          evList.push([t, () => {
            this.fx.lightning(hitPoint());
            this.sound.bank?.sfx('thunder', { pan: this.pan(vpos), rate: 1 }) || this.sound.thud(this.pan(vpos), 1.4);
            last ? kill() : hurt(i);
          }]);
          break;
        case 'grenade':
          evList.push([t, () => this.holyHandGrenade(att, vic, vpos).then(() => (last ? kill() : hurt(i)))]);
          break;
        default:
          evList.push([Math.max(0, t - 0.14), () => this.sound.whoosh(this.pan(att.position))]);
          evList.push([t, () => meleeFx(kind, last)]);
      }
    });
    if (mv.fx === 'bolt') this.fx.charge((o) => att.propTip(o), tipColor, impacts[0] * 0.9);
    if (mv.fx === 'grenade') {
      const d = att.onGrenade?.() || 0;  // "One... two... five!" "Three, sir!"
      await wait(Math.min(3.4, d * 0.8));
    } else att.onAttackCry?.();

    let atk;
    const melee = ['sparks', 'holy', 'slam', 'uppercut'].includes(mv.fx);
    if (cinematic && melee && vic.type !== 'k' && (force.blackKnight || (!this.force && Math.random() < (this.blackKnightChance ?? 0.03)))) {
      // "None shall pass": offret blir Svarte riddaren och vägrar ge sig, lem för lem
      this.lastBattle.blackKnight = true;
      atk = this.blackKnight(att, vic, vpos, away, mv, impacts[0]).then(resolveDeath);
    } else if (cinematic && !this.force && this.lib?.extras?.rabbit && Math.random() < (this.rabbitChance ?? 0.04)) {
      // "That's no ordinary rabbit!" — kaninen tar offret i stället
      atk = this.killerRabbit(att, vic, vpos, away).then(resolveDeath);
    } else {
      atk = att.play(mv.clip, { timeScale: ts, events: evList });
    }
    await Promise.all([atk, deathDone]);
    vic.dispose();
    att.idle(0.25);
    await wait(cinematic ? 0.35 : 0.05);
    hooks.afterKill?.();
    const dest = this.board.toWorld(to);
    if (att.position.distanceTo(dest) > 0.05) {
      const rest = [...path.slice(index + 1)];
      if (victimSquare !== to) rest[rest.length - 1] = dest;
      if (!rest.length || rest[rest.length - 1].distanceTo(dest) > 0.01) rest.push(dest);
      const stop = this.footsteps(att);
      await att.walk(rest, pace);
      stop();
    }
    const home = att.face(att.homeAngle());
    if (cinematic) await Promise.all([home, this.director.endBattle()]);
    else await home;
  }

  /** Offret dör på ett av flera sätt. Löses när statyn har krossats. */
  die(vic, death, away, { cinematic = true } = {}) {
    const vpos = vic.root.position.clone();
    const pan = this.pan(vpos);
    return new Promise((resolve) => {
      const done = () => { this.world.shake = Math.max(this.world.shake, 0.12); resolve(); };
      switch (death) {
        case 'launch': {
          // slungas upp och bakåt, snurrar och krossas när den slår i marken
          this.sound.whoosh(pan);
          const p0 = vic.root.position.clone(), r0 = vic.root.rotation.clone();
          const dist = 1.8 + Math.random() * 1.4, up = 3.2 + Math.random() * 1.6;
          const spinX = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 3), spinY = (Math.random() - 0.5) * 4;
          this.director.followObj = vic.root;
          vic.play('hit', { timeScale: 0.6 });
          tween(1.1, (k) => {
            vic.root.position.copy(p0).addScaledVector(away, dist * k);
            vic.root.position.y = p0.y + Math.sin(k * Math.PI) * up * (1 - k * 0.35);
            vic.root.rotation.set(r0.x + spinX * k, r0.y + spinY * k, r0.z);
          }, ease.linear).then(() => {
            vic.root.position.y = p0.y;
            this.director.followObj = null;
            this.fx.shatter(vic, away, { power: 1.3, dust: 1.4 });
            this.sound.shatter(pan);
            this.sound.thud(pan, 1);
            done();
          });
          break;
        }
        case 'crumble': {
          vic.play('hit', { timeScale: 0.5 });
          const p0 = vic.root.position.clone();
          tween(0.55, (k) => { vic.root.position.set(p0.x + (Math.random() - 0.5) * 0.06 * k, p0.y, p0.z + (Math.random() - 0.5) * 0.06 * k); }, ease.linear).then(() => {
            vic.root.position.copy(p0);
            this.fx.shatter(vic, away, { power: 0.32, dust: 2.2 });
            this.sound.bank?.sfx('crumble', { pan }) || this.sound.shatter(pan);
            done();
          });
          break;
        }
        case 'freeze': {
          this.fx.restyle(vic, 'ice');
          vic.mixer.timeScale = 0;
          this.sound.bank?.sfx('ice_freeze', { pan });
          wait(0.85).then(() => {
            vic.mixer.timeScale = 1;
            this.fx.shatter(vic, away, { power: 0.9, dust: 0.4, dustColor: 0xdff4ff });
            this.sound.bank?.sfx('ice_shatter', { pan }) || this.sound.shatter(pan);
            done();
          });
          break;
        }
        case 'smite': {
          this.fx.restyle(vic, 'char');
          vic.play('hit', { timeScale: 0.4 });
          wait(0.7).then(() => {
            this.fx.shatter(vic, away, { power: 0.45, dust: 1.6, dustColor: 0x2b2420 });
            this.sound.bank?.sfx('crumble', { pan }) || this.sound.shatter(pan);
            done();
          });
          break;
        }
        case 'squash': {
          // jättefoten: platt som en pannkaka, sedan grus
          tween(0.08, (k) => vic.root.scale.set(1 + k * 0.4, 1 - k * 0.8, 1 + k * 0.4), ease.out).then(() => {
            this.fx.shatter(vic, away, { power: 0.7, dust: 2.6 });
            done();
          });
          break;
        }
        default: {
          const dt = vic.meta.events.death[0];
          vic.play('death', { timeScale: cinematic ? 1 : 1.6, events: [[dt, () => {
            this.fx.shatter(vic, away);
            this.sound.shatter(pan);
            done();
          }]] });
        }
      }
    });
  }

  /** Svarte riddaren: armarna och benen huggs av en i taget medan offret hävdar att det bara är en skråma.
   *  Till sist står bålen på marken, erbjuder remi och krossas med ett sista hugg. */
  async blackKnight(att, vic, vpos, away, mv, hitT) {
    const say = (k) => wait(Math.min(2.2, this.voice?.say('blackknight', k, { gain: 1 }) || 1.2));
    const pan = this.pan(vpos);
    const H = vic.meta.height;
    let hops = null;
    const strike = (bones, hide) => new Promise((resolve) => {
      att.play(mv.clip, { timeScale: 0.9, events: [
        [Math.max(0, hitT - 0.14), () => this.sound.whoosh(this.pan(att.position))],
        [hitT, () => {
          this.fx.sparks(vic.chest(new THREE.Vector3()), away, 0xffd9a0, 40);
          this.sound.clang(pan);
          this.fx.shatter(vic, away, { bones, keep: true, power: 0.8, dust: 0.3 });
          vic.hideBones(hide);
          this.sound.bank?.sfx('arm_crack', { pan });
          this.world.hitstop(0.08);
          resolve();
        }],
      ] }).then(() => att.idle(0.25));
    });
    const limb = (side, part) => part === 'arm'
      ? [[`upperarm.${side}`, `forearm.${side}`, `hand.${side}`, `prop.${side}`], [`upperarm.${side}`]]
      : [[`thigh.${side}`, `shin.${side}`, `foot.${side}`], [`thigh.${side}`]];

    att.idle(0.2);
    await say('nonepass');
    await wait(0.3);
    // vänster arm
    await strike(...limb('L', 'arm'));
    vic.play('hit', { timeScale: 0.8 }).then(() => vic.idle(0.2));
    await wait(0.5);
    await say('scratch');
    // höger arm
    await strike(...limb('R', 'arm'));
    vic.play('hit', { timeScale: 0.8 }).then(() => vic.idle(0.2));
    await wait(0.5);
    await say('flesh');
    // ett ben: offret hoppar trotsigt på det andra
    await strike(...limb('L', 'leg'));
    const y0 = vic.root.position.y;
    let hopping = true;
    hops = (async () => {
      while (hopping) {
        await tween(0.32, (k) => { vic.root.position.y = y0 + Math.sin(k * Math.PI) * 0.16 * H / 2; vic.root.rotation.z = Math.sin(k * Math.PI) * 0.06; }, ease.linear);
        this.sound.step(0.9, pan);
      }
    })();
    await say('invincible');
    await wait(0.4);
    // det andra benet: bålen sjunker ner på marken
    await strike(...limb('R', 'leg'));
    hopping = false;
    await hops;
    const drop = 0.47 * H;
    this.fx.dust(vpos.clone().setY(this.board.top + 0.1), 14, 0.8);
    await tween(0.28, (k) => { vic.root.position.y = y0 - drop * k; vic.root.rotation.z = 0; }, ease.in);
    this.sound.thud(pan, 1.1);
    this.world.shake = Math.max(this.world.shake, 0.15);
    await wait(0.6);
    await say('draw');
    await wait(0.4);
    // sista hugget, medan bålen hotar att bita benen av angriparen
    this.voice?.say('blackknight', 'bite', { gain: 1 });
    await wait(0.6);
    await new Promise((resolve) => {
      att.play(mv.clip, { timeScale: 1, events: [[hitT, () => {
        this.fx.sparks(vic.chest(new THREE.Vector3()), away, 0xffd9a0, 50);
        this.sound.clang(pan);
        this.world.slowmo(0.3, 0.7);
        this.director.punch();
        this.die(vic, 'crumble', away).then(resolve);
      }]] });
    });
  }

  /** Mördarkaninen från Caerbannog hoppar in, biter huvudet av offret och skuttar iväg. */
  async killerRabbit(att, vic, vpos, away) {
    const r = this.makeRabbit();
    const side = Math.random() < 0.5 ? 1 : -1;
    const startP = vpos.clone().add(new THREE.Vector3(side * 5.5, 0, (Math.random() - 0.5) * 3)).setY(this.board.top);
    const near = vpos.clone().addScaledVector(new THREE.Vector3(side, 0, 0), 1.3).setY(this.board.top);
    r.position.copy(startP);
    this.world.scene.add(r);
    this.director.followObj = r;
    await this.hops(r, startP, near, 5);
    this.director.followObj = null;
    r.lookAt(vpos.x, r.position.y, vpos.z);
    att.play('hit', { timeScale: 0.7 });
    this.voice?.herald('rabbit');
    // lågt, bakom kaninen: den lilla vita saken i förgrunden, offret bakom
    const out = near.clone().sub(vpos).setY(0).normalize();
    const toCam = this.world.camera.position.clone().sub(near).setY(0).normalize();
    const look = near.clone().lerp(vpos, 0.45).setY(this.board.top + 0.6);
    this.director.stopDrift();
    this.world.setFocus(near.clone().setY(this.board.top + 0.3), 1);
    this.director.fly(near.clone().addScaledVector(out, 2.6).addScaledVector(toCam, 1.2).setY(this.board.top + 0.5), look, 0.6, 40);
    await wait(1.1);
    // språnget mot halsen
    const head = vic.chest(new THREE.Vector3()).add(new THREE.Vector3(0, vic.meta.height * 0.3, 0));
    this.sound.bank?.sfx('rabbit_snarl', { pan: this.pan(vpos), rate: 1 });
    const p0 = r.position.clone();
    await tween(0.28, (k) => { r.position.lerpVectors(p0, head, k); r.position.y += Math.sin(k * Math.PI) * 0.5; }, ease.in);
    this.world.hitstop(0.1);
    this.fx.shatter(vic, away, { bones: ['head', 'neck'], keep: true, power: 1.2, dust: 0.4 });
    vic.hideBones(['neck']);
    vic.onDeathCry?.();
    this.world.slowmo(0.3, 0.8);
    await tween(0.35, (k) => { r.position.lerpVectors(head, near, k); r.position.y = THREE.MathUtils.lerp(head.y, this.board.top, k) + Math.sin(k * Math.PI) * 0.4; }, ease.out);
    const dying = this.die(vic, 'topple', away);
    await wait(0.5);
    this.voice?.herald('runAway');
    const exit = near.clone().add(new THREE.Vector3(side * 7, 0, 2));
    this.hops(r, r.position.clone(), exit, 6).then(() => r.removeFromParent());
    await dying;
  }

  makeRabbit() {
    const src = this.lib.extras.rabbit;
    const r = src.scene.clone(true);
    const mats = {
      Fur: new THREE.MeshPhysicalMaterial({ color: 0xf4f1ec, roughness: 0.85, sheen: 1, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.6 }),
      Eye: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a0a, emissiveIntensity: 4 }),
      Tooth: new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.3 }),
      Dark: new THREE.MeshStandardMaterial({ color: 0x1a0d0d, roughness: 0.8 }),
    };
    r.traverse((o) => { if (o.isMesh) { o.material = mats[o.material.name] || o.material; o.castShadow = true; } });
    r.scale.setScalar(1.25);
    return r;
  }

  /** Skutt från a till b i n hopp, med tryck och sträckning. */
  async hops(obj, a, b, n) {
    for (let i = 0; i < n; i++) {
      const p0 = a.clone().lerp(b, i / n), p1 = a.clone().lerp(b, (i + 1) / n);
      obj.lookAt(p1.x, obj.position.y, p1.z);
      this.sound.bank?.sfx('rabbit_hop', { gain: 0.5, pan: this.pan(p1) });
      await tween(0.3, (k) => {
        obj.position.lerpVectors(p0, p1, k);
        obj.position.y = p0.y + Math.sin(k * Math.PI) * 0.45;
        const sq = 1 + Math.sin(k * Math.PI) * 0.18;
        obj.scale.set(1.25 / Math.sqrt(sq), 1.25 * sq, 1.25 / Math.sqrt(sq));
      }, ease.linear);
    }
    obj.scale.setScalar(1.25);
  }

  /** Den heliga handgranaten från Antiochia: guldklot med kors i en båge, sedan himmelsk explosion. */
  async holyHandGrenade(att, vic, vpos) {
    if (!this.grenadeMesh) {
      const g = new THREE.Group();
      const gold = new THREE.MeshPhysicalMaterial({ color: 0xf2c25a, metalness: 1, roughness: 0.22, clearcoat: 0.5 });
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16), gold));
      g.scale.setScalar(1.6);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 8, 32), gold);
      band.rotation.x = Math.PI / 2;
      g.add(band);
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), gold);
      v.position.y = 0.17;
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.03), gold);
      h.position.y = 0.19;
      g.add(v, h);
      for (const m of g.children) m.castShadow = true;
      this.grenadeMesh = g;
    }
    const g = this.grenadeMesh;
    this.world.scene.add(g);
    const from = att.propTip(new THREE.Vector3(), 0.1);
    const to = vic.chest(new THREE.Vector3());
    this.sound.whoosh(this.pan(from));
    await tween(0.85, (k) => {
      g.position.lerpVectors(from, to, k);
      g.position.y += Math.sin(k * Math.PI) * 2.2;
      g.rotation.set(k * 9, k * 4, 0);
    }, ease.linear);
    g.removeFromParent();
    this.sound.bank?.sfx('holy_grenade', { pan: this.pan(vpos), rate: 1 }) || this.sound.boom(this.pan(vpos));
    this.fx.holyBurst(to, 0xfff2c0);
    this.fx.beam(vpos, 0xfff2c0, 0.8);
    this.fx.shockwave(vpos.clone().setY(this.board.top + 0.05), 0xfff0d0);
    this.fx.flash(to, 0xffffff, 220);
    this.world.shake = 0.5;
  }

  /** Bonden förvandlas i ett ljussken. */
  async promote(oldPiece, makeNew) {
    const p = oldPiece.position.clone();
    this.fx.holyBurst(p.clone().add(new THREE.Vector3(0, 1, 0)), oldPiece.color === 'w' ? 0xbfe6ff : 0xffa070);
    if (!this.sound.bank?.sfx('promote', { gain: 0.9, rate: 1 })) this.sound.magic(this.pan(p));
    await tween(0.35, (k) => oldPiece.root.scale.setScalar(1 - k * 0.6), ease.in);
    oldPiece.dispose();
    const np = makeNew();
    np.root.scale.setScalar(0.4);
    this.fx.flash(p.clone().add(new THREE.Vector3(0, 1.4, 0)), 0xffffff, 60);
    this.sound.chime();
    await tween(0.6, (k) => np.root.scale.setScalar(0.4 + 0.6 * k), ease.out);
    np.play('victory').then(() => np.idle());
    return np;
  }

  /** Schackmatt: "Finish him!" — den pjäs som gav matt utför finishen, eller så kommer jättefoten.
   *  Utan känd mattsättare: blixt från himlen. */
  async checkmate(king, winners, onFatality, checker = null) {
    const kp = king.position.clone();
    const cinematic = this.settings.battles === 'cinematic';
    if (cinematic) await this.director.closeUp(kp);
    king.play('hit', { timeScale: 0.5 });
    await wait(0.9);
    const away = new THREE.Vector3(0, 0, king.color === 'w' ? 1 : -1);
    let kind = 'lightning';
    if (this.lib?.extras?.foot && Math.random() < (this.footChance ?? 0.25)) kind = 'foot';
    else if (checker) kind = { q: 'freeze', b: 'grenade', r: 'leap', n: 'leap', p: 'charge' }[checker.type] || 'lightning';
    if (window.BC_DEBUG) console.info('[BC] finisher', kind, checker?.name);
    const fatality = () => {
      this.sound.bank?.sfx('fatality', { rate: 1 });
      onFatality?.();
    };
    if (kind === 'foot') {
      this.voice?.herald('foot');
      // backa och titta upp mot himlen: foten ska synas komma
      if (cinematic) {
        const cam = this.world.camera.position.clone();
        const dir = cam.clone().sub(kp).setY(0).normalize();
        await this.director.fly(kp.clone().addScaledVector(dir, 14).setY(kp.y + 3), kp.clone().setY(kp.y + 3.4), 1.4, 50);
      } else await wait(1.6);
      await this.giantFoot(king, away);
    } else if (kind === 'freeze' || kind === 'grenade' || kind === 'leap' || kind === 'charge') {
      await this.finisherByPiece(kind, checker, king, away);
    } else {
      this.fx.lightning(king.chest(new THREE.Vector3()));
      this.sound.bank?.sfx('thunder', { rate: 1 }) || this.sound.thud(0, 1.5);
      this.world.slowmo(0.25, 1.0);
      await this.die(king, 'smite', away);
    }
    this.sound.shatter(0);
    this.world.shake = Math.max(this.world.shake, 0.3);
    fatality();
    for (const w of winners) setTimeout(() => w.play('victory').then(() => w.idle()), rand(200, 900));
    await wait(1.6);
  }

  async finisherByPiece(kind, att, king, away) {
    const kp = king.position.clone();
    const home = att.position.clone();
    await att.faceTowards(kp, 0.4);
    if (kind === 'freeze') {
      att.play('attack2', { timeScale: 1 });
      await wait(0.9);
      this.sound.bank?.sfx('frost_ray', { rate: 1 });
      await this.fx.stream((o) => att.propTip(o, 0.05), king.chest(new THREE.Vector3()), 0xbfe9ff, 0.7);
      this.world.slowmo(0.3, 1);
      await this.die(king, 'freeze', away);
    } else if (kind === 'grenade') {
      const d = att.onGrenade?.() || 0;
      await wait(Math.min(3.4, d * 0.8));
      att.play('attack2');
      await wait(0.9);
      await this.holyHandGrenade(att, king, kp);
      this.world.slowmo(0.3, 1);
      await this.die(king, 'launch', away);
    } else {
      // språng (torn/springare) eller rusning (bonde) fram till kungen, sedan pjäsens attack2
      const dir = kp.clone().sub(home).setY(0).normalize();
      const spot = kp.clone().addScaledVector(dir, -1.6);
      if (kind === 'leap') {
        this.sound.bank?.sfx('leap', { rate: 1 }) || this.sound.whoosh(0);
        const up = att.type === 'r' ? 5 : 3.5;
        await tween(1.0, (k) => { att.root.position.lerpVectors(home, spot, k); att.root.position.y = home.y + Math.sin(k * Math.PI) * up; }, ease.inOut);
        this.fx.shockwave(spot.clone().setY(this.board.top + 0.05));
        this.world.shake = 0.4;
      } else {
        await att.walk([spot], this.settings.pace * 1.4);
      }
      await att.faceTowards(kp, 0.2);
      const clip = att.actions.attack2 ? 'attack2' : 'attack';
      const t = att.meta.events[clip]?.[att.meta.events[clip].length - 1] ?? 0.9;
      att.play(clip);
      await wait(t);
      this.fx.sparks(king.chest(new THREE.Vector3()), dir, 0xffd9a0, 60);
      this.sound.clang(0);
      this.world.slowmo(0.28, 1);
      await this.die(king, att.type === 'r' || att.type === 'n' ? 'launch' : 'topple', dir);
      await wait(0.5);
      att.idle();
      if (kind === 'leap') await tween(0.9, (k) => { att.root.position.lerpVectors(spot, home, k); att.root.position.y = home.y + Math.sin(k * Math.PI) * 3; }, ease.inOut);
      else await att.walk([home], this.settings.pace * 1.4);
      await att.face(att.homeAngle());
    }
  }

  /** "And now for something completely different": en jättelik marmorfot trampar ned från himlen. */
  async giantFoot(king, away) {
    const src = this.lib.extras.foot;
    const foot = src.scene.clone(true);
    const stone = this.lib.mats.w.Stone;
    foot.traverse((o) => { if (o.isMesh) { ensureBakeColor(o); o.material = o.material.name === 'Stone' ? stone : o.material; o.castShadow = true; o.frustumCulled = false; } });
    const kp = king.position.clone();
    // i profil, som i Monty Python: tårna pekar åt sidan sett från kameran
    foot.rotation.y = Math.atan2(this.world.camera.position.x - kp.x, this.world.camera.position.z - kp.z) + Math.PI / 2;
    foot.scale.setScalar(1.4);
    foot.position.set(kp.x, 18, kp.z);
    this.world.scene.add(foot);
    await tween(0.75, (k) => { foot.position.y = THREE.MathUtils.lerp(18, kp.y, k * k); }, ease.linear);
    this.sound.bank?.sfx('foot_stomp', { rate: 1 }) || this.sound.thud(0, 1.6);
    this.world.hitstop(0.12);
    this.world.shake = 0.8;
    this.fx.shockwave(kp.clone().setY(this.board.top + 0.05));
    this.fx.dust(kp.clone().setY(this.board.top + 0.2), 40, 2.4);
    await this.die(king, 'squash', away);
    await wait(1.0);
    await tween(1.1, (k) => { foot.position.y = THREE.MathUtils.lerp(kp.y, 40, k * k); }, ease.linear);
    foot.removeFromParent();
  }
}
