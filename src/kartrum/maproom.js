// Kartrummet i spelet: brädet ur arenan, rummet runt det, ljuset och tiden på dygnet.
// Eftermiddag (t = 0) glider mot kväll (t = 1): solen sjunker genom fönstren och går ned, månen tar över och
// kandelabrarna tänds en i taget. Översiktsläget (overview.js) tänder en lampa över bordet och dämpar resten.
import * as THREE from 'three';
import { arenaMaterials } from '../materials.js';
import { tier } from '../quality.js';
import { buildRoom, buildEnv, mapBias, PALETTE, ROOM, WINDOWS, SILL, LINTEL } from './room.js';

const TABLE_X = -11; // brädet står på kartans östra del, så att Östersjön och Skandinavien ligger fria bredvid
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);

// Dagens och kvällens omgivning; värdena är provade i stilprovet (docs/stil/).
const DAY_ENV = { walls: 0xc8b490, floor: 0x5a3a20, table: 0x4a2c17, window: 0xfff0d8, windowGain: 5, candleGain: 0 };
const NIGHT_ENV = { walls: 0x2c3a48, floor: 0x24160b, table: 0x2e1a0d, window: 0x5a76a8, windowGain: 0.6, candleGain: 6 };
const SUN = { warm: new THREE.Color(0xffd2a0), low: new THREE.Color(0xff8a4a), moon: new THREE.Color(0x7d97c8) };
const SKY = [new THREE.Color(2.2, 2.2, 2.2), new THREE.Color(1.6, 1.05, 0.7), new THREE.Color(0.05, 0.08, 0.17)];
const HEMI = { day: [new THREE.Color(0xfff3df), new THREE.Color(0x4a321c), 0.3], night: [new THREE.Color(0x3a5a72), new THREE.Color(0x1a0f07), 0.2] };
const FOG = { day: [new THREE.Color(0xcdb894), 0.0018], night: [new THREE.Color(0x0c1820), 0.003] };
// kandelabern till höger står nära brädet: full styrka gav en prickrad av speglingar i rutornas fasade kanter
const CANDLE = { color: 0xffa64d, bases: [650, 320, 3250], key: 1200, keyPos: [14, 12, 21] };

/** Behåll bara trianglar inom ramen: arenans guld är ett enda nät där även fanstängernas beslag ingår. */
function clipToBoard(mesh, lim = 9.45, top = 1.0) {
  const g = mesh.geometry, pos = g.attributes.position, v = new THREE.Vector3();
  const ok = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    ok[i] = Math.abs(v.x) <= lim && Math.abs(v.z) <= lim && v.y <= top ? 1 : 0;
  }
  const src = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
  const keep = [];
  for (let i = 0; i < src.length; i += 3) if (ok[src[i]] && ok[src[i + 1]] && ok[src[i + 2]]) keep.push(src[i], src[i + 1], src[i + 2]);
  g.setIndex(keep);
  g.computeBoundingBox();
  g.computeBoundingSphere();
}

/** Brädet ur arenan: rutor, fogar, ram och inlägg. Pelare, terräng, glödfat och fanor släcks. Ger brädets undersida. */
function extractBoard(root) {
  const mats = arenaMaterials();
  const keep = new Set(['BoardWhite', 'BoardBlack', 'Frame', 'Dark', 'Trim']);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3(), c = new THREE.Vector3(), bounds = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material?.name;
    box.setFromObject(o).getCenter(c);
    if (keep.has(name) && Math.abs(c.x) < 11 && Math.abs(c.z) < 11 && box.max.y > 0.3) {
      o.material = mats[name] || o.material;
      // ramens guldinlägg mattare än i ruinen: blankt guld gjorde varje låga till en prickrad längs kanten
      if (name === 'Trim') o.material = Object.assign(o.material.clone(), { roughness: 0.55 });
      // mjukare lack på rutorna, så att lågor speglas som glöd och inte som skarpa prickar
      if (name === 'BoardWhite' || name === 'BoardBlack') o.material = Object.assign(o.material.clone(), { clearcoatRoughness: 0.26 });
      o.castShadow = o.receiveShadow = true;
      clipToBoard(o);
      bounds.union(box.setFromObject(o));
    } else {
      o.visible = false;
    }
  });
  return bounds.min.y;
}

export class MapRoom {
  /** Ladda kartan och bygg rummet runt arenans bräde. */
  static async create(world, arenaRoot) {
    const map = await new THREE.TextureLoader().loadAsync('/kartrum/karta.jpg');
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = world.renderer.capabilities.getMaxAnisotropy();
    return new MapRoom(world, arenaRoot, map);
  }

  constructor(world, arenaRoot, map) {
    const { scene, renderer } = world;
    this.scene = scene;
    const boardBottom = extractBoard(arenaRoot);
    scene.add(arenaRoot);
    this.arena = arenaRoot;
    this.room = buildRoom(boardBottom, PALETTE, map, { half: 9.4, lift: 0.7, tableX: TABLE_X });
    scene.add(this.room.group);
    scene.updateMatrixWorld(true);
    this.T = this.room.T;
    // filmkameran väljer sida efter ljuset (battle.js): riktningen mot fönstren
    this.sunDir = new THREE.Vector3(-1, 0.3, -0.25).normalize();
    this.fireBoost = 1;
    this.overview = 0;

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envDay = pmrem.fromScene(buildEnv(DAY_ENV, this.T, this.room.flames), 0.04, 0.1, 1000).texture;
    this.envNight = pmrem.fromScene(buildEnv(NIGHT_ENV, this.T, this.room.flames), 0.04, 0.1, 1000).texture;
    pmrem.dispose();
    scene.environment = this.envDay;
    scene.background = new THREE.Color(0x05080c);
    scene.fog = new THREE.FogExp2(FOG.day[0].clone(), FOG.day[1]);

    this.hemi = new THREE.HemisphereLight(HEMI.day[0], HEMI.day[1], HEMI.day[2]);
    scene.add(this.hemi);
    this.sun = this.windowLight();
    this.candles = this.candleLights();
    this.key = this.keyLight();
    this.lamp = this.overheadLamp();
  }

  /** Sol och måne: en avlägsen spotlight vars kon precis rymmer fönstren, så att inget ljus läcker förbi väggen. */
  windowLight() {
    const L = new THREE.SpotLight(SUN.warm, 3.2, 0, 0.1, 0.12, 0);
    L.castShadow = true;
    L.shadow.mapSize.set(tier.shadow, tier.shadow);
    L.shadow.bias = -0.00008;
    L.shadow.normalBias = 0.05;
    L.shadow.radius = 2;
    this.scene.add(L, L.target);
    // konen räknas en gång för sol och måne: en vinkel som ändras varje bildruta flyttar skuggornas rutnät och får
    // kanterna att krypa medan dygnet glider
    this.aimWindow(L, 0.12);
    const low = L.angle;
    this.aimWindow(L, 0.45);
    this.sunAngle = Math.max(low, L.angle);
    this.aimWindow(L, 0.3);
    return L;
  }

  /** Rikta fönsterljuset med höjden y (0,3 = eftermiddag, lägre = sjunkande sol, 0,45 = måne). */
  aimWindow(L, y) {
    const d = new THREE.Vector3(-1, y, -0.25).normalize();
    const target = new THREE.Vector3(-ROOM.W / 2, this.room.F + (SILL + LINTEL) / 2, 0);
    const dist = 1600;
    L.position.copy(target).addScaledVector(d, dist);
    L.target.position.copy(target);
    const axis = d.clone().negate();
    let ang = 0;
    for (const w of WINDOWS) for (const dz of [-w.w / 2, w.w / 2]) for (const h of [SILL, LINTEL]) {
      ang = Math.max(ang, axis.angleTo(new THREE.Vector3(-ROOM.W / 2, this.room.F + h, w.z + dz).sub(L.position).normalize()));
    }
    L.angle = this.sunAngle ?? ang * 1.12;
    L.shadow.camera.near = dist - 260;
    L.shadow.camera.far = dist + 300;
  }

  /** En punktljuskälla per kandelaber, utan skuggor (kubskuggor kostar sex renderingar var). */
  candleLights() {
    const q = new THREE.Vector3();
    return this.room.flames.map((group, i) => {
      const p = new THREE.Vector3();
      for (const f of group) p.add(f.getWorldPosition(q));
      p.divideScalar(group.length).y += 0.8;
      const L = new THREE.PointLight(CANDLE.color, 0, 0, 2);
      L.position.copy(p);
      L.userData.base = CANDLE.bases[i];
      L.userData.at = 0.42 + i * 0.06; // kandelabrarna tänds en i taget
      this.scene.add(L);
      return L;
    });
  }

  /** Kvällens nyckelljus: ett ljus utanför bild framför vit, så att pjäserna inte blir silhuetter mot kandelabrarna. */
  keyLight() {
    const L = new THREE.SpotLight(CANDLE.color, 0, 0, THREE.MathUtils.degToRad(48), 1, 2);
    L.position.set(...CANDLE.keyPos);
    L.target.position.set(0, this.T, -1);
    L.castShadow = true;
    L.shadow.mapSize.set(tier.shadow / 2, tier.shadow / 2);
    L.shadow.camera.near = 4;
    L.shadow.camera.far = 90;
    L.shadow.bias = -0.0004;
    L.shadow.radius = 3;
    this.scene.add(L, L.target);
    return L;
  }

  /** Lampan över kartbordet i översiktsläget. */
  overheadLamp() {
    const L = new THREE.SpotLight(0xfff1dc, 0, 0, THREE.MathUtils.degToRad(24), 0.85, 0);
    L.position.set(TABLE_X - 5, this.T + 72, -12);
    L.target.position.set(TABLE_X + 2, this.T, 0);
    this.scene.add(L, L.target);
    return L;
  }

  /** t: 0 = eftermiddag, 1 = kväll. Översiktens styrka (this.overview) vägs in. */
  applyTime(t) {
    this.t = t;
    const k = this.overview;
    const dusk = smooth(0.3, 0.85, t);
    // solen sjunker och rodnar, går ned runt 0,68; månen stiger efter
    const sunK = 1 - smooth(0.5, 0.68, t), moonK = smooth(0.7, 0.92, t);
    if (sunK > 0) {
      this.aimWindow(this.sun, lerp(0.3, 0.12, smooth(0, 0.68, t)));
      this.sun.color.copy(SUN.warm).lerp(SUN.low, smooth(0.25, 0.65, t));
      this.sun.intensity = lerp(3.2, 1.6, smooth(0, 0.5, t)) * sunK;
    } else {
      this.aimWindow(this.sun, 0.45);
      this.sun.color.copy(SUN.moon);
      this.sun.intensity = 0.9 * moonK;
    }
    this.sun.intensity *= 1 - 0.55 * k;
    // kandelabrarna: varje låga tänds för sig, ljuset följer andelen tända lågor
    this.room.flames.forEach((group, i) => {
      let lit = 0;
      group.forEach((f, j) => {
        const at = this.candles[i].userData.at + j * 0.015;
        const s = smooth(at, at + 0.03, t);
        f.visible = s > 0.01;
        f.scale.set(s, 2.3 * s, s);
        f.userData.s = s;
        lit += s / group.length;
      });
      this.candles[i].userData.lit = lit;
    });
    this.key.intensity = CANDLE.key * smooth(0.45, 0.75, t);
    this.lamp.intensity = 2.6 * k;
    mapBias.value = lerp(0.9, 0.15, k); // skarp karta uppifrån, mjukare där den ses snett och annars gnistrar
    // omgivningen: rummets reflexer byts i skymningen, som originalets himlar
    this.scene.environment = t > 0.6 ? this.envNight : this.envDay;
    this.scene.environmentIntensity = lerp(0.45, 0.55, dusk) * (1 - 0.4 * k);
    this.hemi.color.copy(HEMI.day[0]).lerp(HEMI.night[0], dusk);
    this.hemi.groundColor.copy(HEMI.day[1]).lerp(HEMI.night[1], dusk);
    this.hemi.intensity = lerp(HEMI.day[2], HEMI.night[2], dusk) * (1 - 0.6 * k);
    this.scene.fog.color.copy(FOG.day[0]).lerp(FOG.night[0], dusk);
    this.scene.fog.density = lerp(FOG.day[1], FOG.night[1], dusk);
    const sky = this.room.outside.material.color;
    if (t < 0.55) sky.copy(SKY[0]).lerp(SKY[1], smooth(0.2, 0.55, t));
    else sky.copy(SKY[1]).lerp(SKY[2], smooth(0.55, 0.85, t));
    this.fireBoost = lerp(1, 2.6, t);
  }

  /** Lågorna fladdrar och kandelabrarnas ljus följer dem. */
  update(dt, time) {
    this.candles.forEach((L, i) => {
      const lit = L.userData.lit || 0;
      // lugnt fladder: ett helt bräde som pulserar snabbt upplevs som flimmer
      L.intensity = L.userData.base * lit * (0.96 + 0.04 * Math.sin(time * 7 + i) * Math.sin(time * 2.3 + i * 2));
    });
    for (const group of this.room.flames) {
      for (const f of group) {
        const s = f.userData.s || 0;
        if (s > 0.01) f.scale.y = 2.3 * s * (0.9 + 0.12 * Math.sin(time * 17 + f.id));
      }
    }
  }
}
