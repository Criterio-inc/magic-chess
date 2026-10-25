// Mantlar som rör sig. Mantelbärarna (pieces.json: cape = [längd1, längd2]) har två fjäderben under chest,
// cape.1 -> cape.2 (three: cape1/cape2), som simuleras som en kort positionsbaserad kedja (verlet-släkt) i
// världsrummet: benens animerade vila drar kedjan tillbaka, luftmotstånd gör att manteln släpar efter i gången,
// trögheten svänger ut den i vändningar och fall, och den hålls bakom kroppen (ett plan i höftens rum) och över
// brädet. Anropas från Piece.update efter mixern, så att fx.shatter (som läser benen) ser den simulerade posen.
import * as THREE from 'three';
import { boardFloor } from './materials.js';

const STEP = 1 / 120;        // fast deltasteg (s); utdata interpoleras mellan stegen (mjukt även i slowmotion)
const MAX_STEPS = 10;        // dt är redan klämt till 1/20 s i världsloopen
const STIFF = 28;            // fjäder mot den animerade vilan (1/s²): högre = styvare, mer marmor
const DAMP = 5;              // dämpning av rörelsen relativt vilan (1/s)
const DRAG = 1.1;            // luftmotstånd mot världen (1/s): manteln släpar ~DRAG/STIFF·fart efter i gången
const GRAV = 9.81;           // bara skillnaden mot vilans tyngdriktning i bröstets rum verkar (se gEff)
const MARGIN = [0.03, 0.08]; // så långt (m) får partikeln komma framför sitt viloläge mot kroppen
const FLOOR_PAD = 0.02;      // m över brädet (mindre om benspetsen redan står lägre i vila)
const JUMP = 1.0;            // m förflyttning mellan två bilder utöver normal fart = teleporterad: nollställ
const ITER = 2;              // varv av villkor per steg

const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _w1 = new THREE.Matrix4(), _w2 = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qd = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _ho = new THREE.Vector3(), _back = new THREE.Vector3(), _g = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0);
const _s = new THREE.Vector3(), _p = new THREE.Vector3();

const boneKey = (o) => o.name.replace(/[^A-Za-z0-9]/g, ''); // GLTFLoader: 'cape.1' -> 'cape1'

export class CapeSim {
  /** Simulering för en pjäs med mantel, annars null (pjäser utan mantel har benen men viktar inget på dem). */
  static for(piece) {
    if (!piece.meta?.cape) return null;
    const found = {};
    piece.model.traverse((o) => { if (o.isBone) found[boneKey(o)] = o; });
    if (!found.cape1 || !found.cape2 || !found.chest || !found.hips) return null;
    return new CapeSim(piece, found);
  }

  constructor(piece, b) {
    this.piece = piece;
    this.c1 = b.cape1; this.c2 = b.cape2; this.chest = b.chest; this.hips = b.hips;
    // vilotransformer (bindpose): klippen ändrar inte mantelbenen, så vilan läses en gång
    this.r1 = { p: b.cape1.position.clone(), q: b.cape1.quaternion.clone(), s: b.cape1.scale.clone() };
    this.r2 = { p: b.cape2.position.clone(), q: b.cape2.quaternion.clone(), s: b.cape2.scale.clone() };
    this.tail1 = b.cape2.position.clone();                        // cape2:s huvud i cape1:s rum
    this.tail2 = new THREE.Vector3(0, piece.meta.cape[1], 0);     // Blenders ben pekar längs lokal +Y
    this.A = new THREE.Vector3(); this.T = [new THREE.Vector3(), new THREE.Vector3()];
    this.lastA = new THREE.Vector3(); this.lastT = [new THREE.Vector3(), new THREE.Vector3()];
    this.x = [new THREE.Vector3(), new THREE.Vector3()];
    this.v = [new THREE.Vector3(), new THREE.Vector3()];
    this.prev = [new THREE.Vector3(), new THREE.Vector3()];       // läget före senaste steget (interpolation)
    this.vT = [new THREE.Vector3(), new THREE.Vector3()];
    this.out = [new THREE.Vector3(), new THREE.Vector3()];
    this.ready = false;
    this.acc = 0;

    // viloläget (pjäsen står upprätt, modellens origo vid fötterna): djup bakom höften, höjd över golvet
    const model = piece.model;
    model.updateMatrixWorld(true);
    this.targets();
    const hm = this.hips.matrixWorld;
    _ho.setFromMatrixPosition(hm);
    _back.set(0, 0, -1).transformDirection(model.matrixWorld);    // modellen tittar mot +Z: ryggen mot -Z
    this.backL = _back.clone().transformDirection(_m1.copy(hm).invert()); // ryggriktningen i höftens rum
    this.restScale = _s.setFromMatrixColumn(hm, 0).length();
    this.restDepth = this.T.map((t) => _a.subVectors(t, _ho).dot(_back));
    const base = _a.setFromMatrixPosition(model.matrixWorld).y;
    this.padFloor = this.T.map((t) => Math.max(0, Math.min(FLOOR_PAD, (t.y - base) * 0.5)));
    // tyngdriktningen i bröstets rum i vila: vilan är redan i jämvikt, så bara avvikelsen från den drar i manteln
    this.chest.getWorldQuaternion(_q);
    this.gLocal = _down.clone().applyQuaternion(_q.invert());
  }

  /** Nollställ (ny pjäs, flyttad utan att gå): manteln hänger i sin animerade vila. */
  reset() {
    this.targets();
    for (let i = 0; i < 2; i++) {
      this.x[i].copy(this.T[i]); this.prev[i].copy(this.T[i]); this.v[i].set(0, 0, 0);
      this.lastT[i].copy(this.T[i]); this.vT[i].set(0, 0, 0);
    }
    this.lastA.copy(this.A);
    this.acc = 0;
    this.ready = true;
  }

  /** Animerade (styva) lägen i världen: A = cape1:s fäste, T = benspetsarna. Uppdaterar kedjan upp till chest. */
  targets() {
    this.chest.updateWorldMatrix(true, false);
    _w1.multiplyMatrices(this.chest.matrixWorld, _m1.compose(this.r1.p, this.r1.q, this.r1.s));
    this.A.setFromMatrixPosition(_w1);
    this.T[0].copy(this.tail1).applyMatrix4(_w1);
    _w2.multiplyMatrices(_w1, _m2.compose(this.r2.p, this.r2.q, this.r2.s));
    this.T[1].copy(this.tail2).applyMatrix4(_w2);
  }

  update(dt) {
    dt *= this.piece.mixer.timeScale; // frysdöden stoppar mixern: manteln stelnar med den
    if (!this.ready) { this.reset(); this.apply(); return; }
    this.targets();
    const jump = this.A.distanceTo(this.lastA);
    if (jump > JUMP + 25 * dt) { this.reset(); this.apply(); return; }
    if (dt <= 0) {
      // fryst tid: inget steg, men följ med om fästet ändå flyttats (stabilt, ingen fart uppstår)
      _a.subVectors(this.A, this.lastA);
      for (let i = 0; i < 2; i++) { this.x[i].add(_a); this.prev[i].add(_a); this.lastT[i].copy(this.T[i]); }
      this.lastA.copy(this.A);
      this.apply(this.acc / STEP);
      return;
    }
    for (let i = 0; i < 2; i++) this.vT[i].subVectors(this.T[i], this.lastT[i]).divideScalar(dt);
    // tyngd: skillnaden mellan verklig tyngd och vilans tyngdriktning följd med bröstet (0 i upprätt vila)
    this.chest.matrixWorld.decompose(_p, _qp, _s);
    _g.copy(this.gLocal).applyQuaternion(_qp).sub(_down).multiplyScalar(-GRAV);
    // kroppens plan: ryggriktningen i höftens rum; skalan följer pjäsen (befordran växer, kaninen m.m.)
    const hm = this.hips.matrixWorld;
    _ho.setFromMatrixPosition(hm);
    _back.copy(this.backL).transformDirection(hm);
    const sc = _s.setFromMatrixColumn(hm, 0).length() / this.restScale;
    const floorY = boardFloor.uFloorY.value;
    const L1 = this.A.distanceTo(this.T[0]), L2 = this.T[0].distanceTo(this.T[1]);
    const t0 = this.acc;
    let n = Math.floor((this.acc + dt) / STEP);
    this.acc = this.acc + dt - n * STEP;
    if (n > MAX_STEPS) { n = MAX_STEPS; this.acc = 0; }
    for (let k = 0; k < n; k++) {
      // fäste och mål vid stegets sluttid, interpolerade inom bilden
      const f = Math.min(1, ((k + 1) * STEP - t0) / dt);
      const anchor = _a.lerpVectors(this.lastA, this.A, f);
      for (let i = 0; i < 2; i++) {
        const tgt = _b.lerpVectors(this.lastT[i], this.T[i], f);
        const v = this.v[i];
        // a = fjäder mot vilan + dämpning mot målets fart + luftmotstånd + tyngdskillnad
        _c.subVectors(tgt, this.x[i]).multiplyScalar(STIFF)
          .addScaledVector(_d.subVectors(this.vT[i], v), DAMP)
          .addScaledVector(v, -DRAG)
          .add(_g);
        v.addScaledVector(_c, STEP);
        this.prev[i].copy(this.x[i]);
        this.x[i].addScaledVector(v, STEP);
      }
      const x1 = this.x[0], x2 = this.x[1];
      for (let it = 0; it < ITER; it++) {
        // längder: fästet sitter fast, mellanleden och spetsen delar på rättningen
        _c.subVectors(x1, anchor); x1.copy(anchor).addScaledVector(_c, L1 / Math.max(1e-6, _c.length()));
        _c.subVectors(x2, x1);
        const e = (_c.length() - L2) / Math.max(1e-6, _c.length());
        x1.addScaledVector(_c, 0.3 * e); x2.addScaledVector(_c, -0.7 * e);
        for (let i = 0; i < 2; i++) {
          const x = this.x[i];
          // bakom kroppen: aldrig längre fram än vilan (eller den animerade posen, om den ligger längre fram)
          const tgt = _b.lerpVectors(this.lastT[i], this.T[i], f);
          const bound = Math.min(this.restDepth[i] * sc, _d.subVectors(tgt, _ho).dot(_back)) - MARGIN[i] * sc;
          const depth = _d.subVectors(x, _ho).dot(_back);
          if (depth < bound) x.addScaledVector(_back, bound - depth);
          const fy = floorY + this.padFloor[i] * sc;   // över brädet
          if (x.y < fy) x.y = fy;
        }
      }
      for (let i = 0; i < 2; i++) this.v[i].subVectors(this.x[i], this.prev[i]).divideScalar(STEP);
    }
    this.lastA.copy(this.A);
    for (let i = 0; i < 2; i++) this.lastT[i].copy(this.T[i]);
    this.apply(this.acc / STEP);
  }

  /** Vrid benen så att de pekar mot (interpolerade) partiklarna. alpha = andel av nästa steg som gått. */
  apply(alpha = 1) {
    for (let i = 0; i < 2; i++) this.out[i].lerpVectors(this.prev[i], this.x[i], alpha);
    // cape1: minsta vridning från vilans riktning (fäste -> T0) till simuleringens (fäste -> partikel)
    this.chest.matrixWorld.decompose(_p, _qp, _s);   // targets() har just uppdaterat kedjan
    _a.subVectors(this.T[0], this.A).normalize();
    _b.subVectors(this.out[0], this.A).normalize();
    _qd.setFromUnitVectors(_a, _b);
    _qw.multiplyQuaternions(_qp, this.r1.q).premultiply(_qd);          // cape1 i världen
    this.c1.quaternion.copy(_qp.invert()).multiply(_qw);
    // cape2: vilan räknas om ovanpå den nya cape1
    _w1.multiplyMatrices(this.chest.matrixWorld, _m1.compose(this.r1.p, this.c1.quaternion, this.r1.s));
    _p.copy(this.tail1).applyMatrix4(_w1);                             // cape2:s huvud
    _w2.multiplyMatrices(_w1, _m2.compose(this.r2.p, this.r2.q, this.r2.s));
    _a.copy(this.tail2).applyMatrix4(_w2).sub(_p).normalize();
    _b.subVectors(this.out[1], _p).normalize();
    _qd.setFromUnitVectors(_a, _b);
    _q.multiplyQuaternions(_qw, this.r2.q).premultiply(_qd);           // cape2 i världen
    this.c2.quaternion.copy(_qw.invert()).multiply(_q);
  }
}
