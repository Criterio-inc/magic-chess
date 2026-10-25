// Koreografi för drag och slag, och filmkameran som följer dem.
import * as THREE from 'three';
import { tween, wait, ease } from './util.js';
import { Patsy } from './patsy.js';
import { SpectacleMethods } from './spectacle.js';

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
}

// händelserna (Svarte riddaren, kaninen, granaten, mattfinisherna, foten) bor i spectacle.js
Object.assign(Choreographer.prototype, SpectacleMethods);
