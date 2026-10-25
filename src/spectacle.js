// De särskilda händelserna under ett slag och vid matt. Metoderna kopplas in i Choreographer (battle.js).
// Alla hör till Saeculas epok: karolinen som anmäler varje hugg, älgen, bannbullan och fältherrens hand.
import * as THREE from 'three';
import { tween, wait, ease, rand } from './util.js';
import { ensureBakeColor } from './pieces.js';

export const SpectacleMethods = {
  /** Karolinen: offret vägrar falla utan tillstånd. Armarna huggs av en i taget medan han anmäler varje hugg
   *  till krigskollegium och kräver kvitto, och han faller till sist mitt i en klagoskrift. */
  async karolin(att, vic, vpos, away, mv, hitT) {
    const say = (k) => wait(Math.min(2.4, this.voice?.say('karolin', k, { gain: 1 }) || 1.3));
    const pan = this.pan(vpos);
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
    const arm = (side) => [[`upperarm.${side}`, `forearm.${side}`, `hand.${side}`, `prop.${side}`], [`upperarm.${side}`]];

    att.idle(0.2);
    await say('halt');
    await wait(0.3);
    await strike(...arm('L'));
    vic.play('hit', { timeScale: 0.8 }).then(() => vic.idle(0.2));
    await wait(0.5);
    await say('report');
    await strike(...arm('R'));
    vic.play('hit', { timeScale: 0.8 }).then(() => vic.idle(0.2));
    await wait(0.5);
    await say('protest');
    await wait(0.3);
    await say('receipt');
    await wait(0.4);
    // sista hugget, mitt i klagoskriften
    this.voice?.say('karolin', 'complaint', { gain: 1 });
    await wait(0.7);
    await new Promise((resolve) => {
      att.play(mv.clip, { timeScale: 1, events: [[hitT, () => {
        this.fx.sparks(vic.chest(new THREE.Vector3()), away, 0xffd9a0, 50);
        this.sound.clang(pan);
        this.world.slowmo(0.3, 0.7);
        this.director.punch();
        this.die(vic, 'crumble', away).then(resolve);
      }]] });
    });
  },

  /** Älgen: en marmorälg kliver in bortifrån kartan, stångar offret av brädet och lufsar iväg. */
  async elk(att, vic, vpos, away) {
    const e = this.makeElk();
    const side = Math.random() < 0.5 ? 1 : -1;
    const startP = vpos.clone().add(new THREE.Vector3(side * 7, 0, (Math.random() - 0.5) * 3)).setY(this.board.top);
    const near = vpos.clone().addScaledVector(new THREE.Vector3(side, 0, 0), 1.9).setY(this.board.top);
    e.position.copy(startP);
    this.world.scene.add(e);
    this.director.followObj = e;
    await this.trot(e, startP, near, 4);
    this.director.followObj = null;
    e.lookAt(vpos.x, e.position.y, vpos.z);
    att.play('hit', { timeScale: 0.7 });
    this.voice?.herald('elk');
    // lågt, bredvid älgen: den stora djurkroppen i förgrunden, offret bakom
    const out = near.clone().sub(vpos).setY(0).normalize();
    const toCam = this.world.camera.position.clone().sub(near).setY(0).normalize();
    const look = near.clone().lerp(vpos, 0.5).setY(this.board.top + 1.2);
    this.director.stopDrift();
    this.world.setFocus(near.clone().setY(this.board.top + 1), 1);
    this.director.fly(near.clone().addScaledVector(out, 3.4).addScaledVector(toCam, 2).setY(this.board.top + 1.1), look, 0.6, 42);
    await wait(1.1);
    // stångningen: huvudet sänks, ett kort ryck framåt, offret lyfter
    this.sound.bank?.sfx('elk_bellow', { pan: this.pan(vpos), rate: 1 });
    const p0 = e.position.clone(), hit = p0.clone().lerp(vpos.clone().setY(this.board.top), 0.45);
    await tween(0.22, (k) => { e.position.lerpVectors(p0, hit, k); e.rotation.x = -0.25 * Math.sin(k * Math.PI); }, ease.in);
    this.world.hitstop(0.1);
    this.world.shake = Math.max(this.world.shake, 0.25);
    vic.onDeathCry?.();
    this.world.slowmo(0.3, 0.8);
    const dying = this.die(vic, 'launch', vpos.clone().sub(p0).setY(0).normalize());
    await tween(0.35, (k) => { e.position.lerpVectors(hit, p0, k); e.rotation.x = 0; }, ease.out);
    await wait(0.4);
    this.voice?.herald('elkLeaves');
    const exit = near.clone().add(new THREE.Vector3(side * 8, 0, 2));
    this.trot(e, e.position.clone(), exit, 4).then(() => e.removeFromParent());
    await dying;
  },

  makeElk() {
    const e = this.lib.extras.elk.scene.clone(true);
    const stone = this.lib.mats.w.Stone;
    e.traverse((o) => {
      if (!o.isMesh) return;
      ensureBakeColor(o);
      o.material = o.material.name === 'Stone' ? stone : o.material;
      o.castShadow = true;
    });
    return e;
  },

  /** Tunga kliv från a till b i n steg, med en lätt gungning. */
  async trot(obj, a, b, n) {
    for (let i = 0; i < n; i++) {
      const p0 = a.clone().lerp(b, i / n), p1 = a.clone().lerp(b, (i + 1) / n);
      obj.lookAt(p1.x, obj.position.y, p1.z);
      this.sound.bank?.sfx('elk_step', { gain: 0.6, pan: this.pan(p1) });
      await tween(0.42, (k) => {
        obj.position.lerpVectors(p0, p1, k);
        obj.position.y = p0.y + Math.sin(k * Math.PI) * 0.12;
        obj.rotation.z = Math.sin(k * Math.PI * 2) * 0.03;
      }, ease.linear);
    }
    obj.rotation.z = 0;
  },

  /** Bannbullan: biskopen kastar en sigillförsedd rulle som brister i himmelskt ljus. */
  async papalBull(att, vic, vpos) {
    if (!this.bullMesh) {
      const g = new THREE.Group();
      const paper = new THREE.MeshStandardMaterial({ color: 0xeadcb6, roughness: 0.85 });
      const wood = new THREE.MeshStandardMaterial({ color: 0x5a3318, roughness: 0.6 });
      const wax = new THREE.MeshPhysicalMaterial({ color: 0x9c1414, roughness: 0.35, clearcoat: 0.6 });
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.3, 20), paper);
      roll.rotation.z = Math.PI / 2;
      g.add(roll);
      for (const s of [-1, 1]) {
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), wood);
        knob.position.x = s * 0.17;
        g.add(knob);
      }
      const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.018, 20), wax);
      seal.position.set(0, -0.02, 0.06);
      seal.rotation.x = Math.PI / 2;
      const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.006), wax);
      ribbon.position.set(0, -0.09, 0.055);
      g.add(seal, ribbon);
      g.scale.setScalar(1.6);
      for (const m of g.children) m.castShadow = true;
      this.bullMesh = g;
    }
    const g = this.bullMesh;
    this.world.scene.add(g);
    const from = att.propTip(new THREE.Vector3(), 0.1);
    const to = vic.chest(new THREE.Vector3());
    this.sound.whoosh(this.pan(from));
    await tween(0.85, (k) => {
      g.position.lerpVectors(from, to, k);
      g.position.y += Math.sin(k * Math.PI) * 2.2;
      g.rotation.set(k * 2, k * 9, k * 3);
    }, ease.linear);
    g.removeFromParent();
    this.sound.bank?.sfx('bull_burst', { pan: this.pan(vpos), rate: 1 }) || this.sound.boom(this.pan(vpos));
    this.fx.holyBurst(to, 0xfff2c0);
    this.fx.beam(vpos, 0xfff2c0, 0.8);
    this.fx.shockwave(vpos.clone().setY(this.board.top + 0.05), 0xfff0d0);
    this.fx.flash(to, 0xffffff, 220);
    this.world.shake = 0.5;
  },

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
  },

  /** Schackmatt: den pjäs som gav matt ger kungen nådastöten, eller så slår fältherrens hand ned.
   *  Utan känd mattsättare: blixt från himlen. */
  async checkmate(king, winners, onFall, checker = null) {
    const kp = king.position.clone();
    const cinematic = this.settings.battles === 'cinematic';
    if (cinematic) await this.director.closeUp(kp);
    king.play('hit', { timeScale: 0.5 });
    await wait(0.9);
    const away = new THREE.Vector3(0, 0, king.color === 'w' ? 1 : -1);
    let kind = 'lightning';
    if (this.lib?.extras?.hand && Math.random() < (this.handChance ?? 0.25)) kind = 'hand';
    else if (checker) kind = { q: 'freeze', b: 'bull', r: 'leap', n: 'leap', p: 'charge' }[checker.type] || 'lightning';
    if (window.BC_DEBUG) console.info('[BC] finisher', kind, checker?.name);
    const fall = () => {
      this.sound.bank?.sfx('gong', { rate: 1 });
      onFall?.();
    };
    if (kind === 'hand') {
      this.voice?.herald('hand');
      // backa och titta uppåt: handen ska synas komma
      if (cinematic) {
        const cam = this.world.camera.position.clone();
        const dir = cam.clone().sub(kp).setY(0).normalize();
        await this.director.fly(kp.clone().addScaledVector(dir, 14).setY(kp.y + 3), kp.clone().setY(kp.y + 3.4), 1.4, 50);
      } else await wait(1.6);
      await this.giantHand(king, away);
    } else if (kind === 'freeze' || kind === 'bull' || kind === 'leap' || kind === 'charge') {
      await this.finisherByPiece(kind, checker, king, away);
    } else {
      this.fx.lightning(king.chest(new THREE.Vector3()));
      this.sound.bank?.sfx('thunder', { rate: 1 }) || this.sound.thud(0, 1.5);
      this.world.slowmo(0.25, 1.0);
      await this.die(king, 'smite', away);
    }
    this.sound.shatter(0);
    this.world.shake = Math.max(this.world.shake, 0.3);
    fall();
    for (const w of winners) setTimeout(() => w.play('victory').then(() => w.idle()), rand(200, 900));
    await wait(1.6);
  },

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
    } else if (kind === 'bull') {
      const d = att.onBull?.() || 0;
      await wait(Math.min(3.4, d * 0.8));
      att.play('attack2');
      await wait(0.9);
      await this.papalBull(att, king, kp);
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
  },

  /** Fältherren har tröttnat: en jättelik marmorhand slår ned ur höjden, som när man rensar ett kartbord. */
  async giantHand(king, away) {
    const hand = this.lib.extras.hand.scene.clone(true);
    const stone = this.lib.mats.w.Stone;
    hand.traverse((o) => { if (o.isMesh) { ensureBakeColor(o); o.material = o.material.name === 'Stone' ? stone : o.material; o.castShadow = true; o.frustumCulled = false; } });
    const kp = king.position.clone();
    // fingrarna pekar bort från kameran, som när man själv lägger handen på bordet
    hand.rotation.y = Math.atan2(kp.x - this.world.camera.position.x, kp.z - this.world.camera.position.z);
    hand.position.set(kp.x, 18, kp.z);
    this.world.scene.add(hand);
    await tween(0.7, (k) => { hand.position.y = THREE.MathUtils.lerp(18, kp.y, k * k); }, ease.linear);
    this.sound.bank?.sfx('hand_slam', { rate: 1 }) || this.sound.thud(0, 1.6);
    this.world.hitstop(0.12);
    this.world.shake = 0.8;
    this.fx.shockwave(kp.clone().setY(this.board.top + 0.05));
    this.fx.dust(kp.clone().setY(this.board.top + 0.2), 40, 2.4);
    await this.die(king, 'squash', away);
    await wait(1.0);
    await tween(1.1, (k) => { hand.position.y = THREE.MathUtils.lerp(kp.y, 40, k * k); }, ease.linear);
    hand.removeFromParent();
  },
};
