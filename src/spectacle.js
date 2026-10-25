// De särskilda händelserna under ett slag och vid matt. Metoderna kopplas in i Choreographer (battle.js).
import * as THREE from 'three';
import { tween, wait, ease, rand } from './util.js';
import { ensureBakeColor } from './pieces.js';

export const SpectacleMethods = {
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
  },

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
  },

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
  },

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
  },

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
  },

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
  },
};
