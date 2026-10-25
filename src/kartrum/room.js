// Kartrummet: bordet med Saeculas karta, vägg med spröjsade fönster, bokhylla, glob, kandelabrar och fanor.
// Byggt i kod, som arenan i blender/arena.py. Ljuset och tiden på dygnet sköts av maproom.js. Skala: K spelenheter per meter.
import * as THREE from 'three';
import { woodTexture, plasterTexture, bannerTexture, rugTexture, skyTexture, mulberry32 } from './textures.js';
import { MAP_W, MAP_H, FULL_VIEW, atlasUV, sheetPos, pinVisible } from './atlas.js';

export const K = 30; // en ruta (2 enheter) blir knappt 7 cm: ett halvmetersbräde på ett stort kartbord
export const ROOM = { W: 6.4 * K, D: 5.2 * K, H: 3.5 * K };
export const TABLE = { w: 1.9 * K, d: 1.35 * K, thick: 0.07 * K, h: 0.78 * K };
export const SILL = 0.85 * K, LINTEL = 2.75 * K;
const WALL_T = 0.32 * K;
// fönstren sitter i vänsterväggen (x = -W/2): z är mitten, w bredden
export const WINDOWS = [{ z: -26, w: 1.3 * K }, { z: 28, w: 1.3 * K }];
// Ljus puts och ek (stilprovets A); Saeculas mörkblått och guld bärs av fanorna och mattans bård.
export const PALETTE = {
  plaster: '#e2d5ba', ceiling: '#cfc0a2', mullion: '#e9e1cd',
  table: ['#3d2312', '#7d4f2c'], floor: ['#4a2d16', '#8f5f36'], panel: ['#43280f', '#7a5030'],
  trim: 0xb48a4a,
  banner: { field: '#1d3a4c', border: '#c4aa73' },
  rug: { field: '#6b1e19', border: '#1d3346', gold: '#c49a4a' },
};
function add(parent, geo, mat, { x = 0, y = 0, z = 0, cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
}

/**
 * Läs texturen en aning mjukare (bias i mipnivåer). Kartans graverade streck och träets fibrer är finare än skärmen
 * när bordet ses snett på avstånd och gnistrade då så fort kameran eller ljuset rörde sig. Nära håll förblir skarpt,
 * eftersom nivå 0 är golvet för förskjutningen.
 */
function softMip(mat, bias) {
  const uniform = typeof bias === 'number' ? { value: bias } : bias;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMipBias = uniform;
    shader.fragmentShader = 'uniform float uMipBias;\n' + shader.fragmentShader.replace('#include <map_fragment>',
      THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'texture2D( map, vMapUv, uMipBias )'));
  };
  mat.customProgramCacheKey = () => 'softmip';
  return mat;
}

/** Kartans förskjutning: 0,9 vid brädet där den ses snett, nära noll i översikten där kameran tittar rakt ner. */
export const mapBias = { value: 0.9 };

const lathe = (profile, seg = 32) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);

/** Cylinder mellan två punkter (passarens ben, stänger). */
function rod(parent, a, b, r, mat, opts) {
  const len = a.distanceTo(b);
  const m = add(parent, new THREE.CylinderGeometry(r, r, len, 8), mat, opts);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

function materials(pal) {
  const wood = (cols, opts) => woodTexture({ dark: cols[0], light: cols[1], ...opts });
  const tableTex = wood(pal.table, { planks: 7, seed: 3 });
  const floorTex = wood(pal.floor, { planks: 8, joints: 3, seed: 9, repeat: [ROOM.W / 90, ROOM.D / 40] });
  const panelTex = wood(pal.panel, { planks: 4, seed: 4, size: 512, repeat: [6, 1] });
  const plaster = plasterTexture({ color: pal.plaster });
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    table: softMip(std({ map: tableTex, roughness: 0.4 }), 0.6),
    tableDark: softMip(std({ map: tableTex, color: 0x8f8078, roughness: 0.55 }), 0.6),
    floor: softMip(std({ map: floorTex, roughness: 0.5 }), 0.6),
    panel: softMip(std({ map: panelTex, roughness: 0.6 }), 0.6),
    plaster: (u, v) => {
      const t = plaster.clone();
      t.repeat.set(u, v);
      t.needsUpdate = true;
      return std({ map: t, roughness: 0.95 });
    },
    ceiling: std({ color: pal.ceiling, roughness: 1 }),
    mullion: std({ color: pal.mullion, roughness: 0.6 }),
    trim: std({ color: pal.trim, metalness: 1, roughness: 0.32 }),
    brass: std({ color: 0xc9a25e, metalness: 1, roughness: 0.28 }),
    wax: std({ color: 0xf2e8d2, roughness: 0.55 }),
    wick: std({ color: 0x1a1410, roughness: 1 }),
    parchment: std({ color: 0xe6d3a8, roughness: 0.85 }),
    flame: std({ color: 0x000000, emissive: 0xffb257, emissiveIntensity: 16 }),
    books: std({ roughness: 0.68 }),
  };
}

function windowWall(g, F, M) {
  const { D, H, W } = ROOM;
  const s = new THREE.Shape();
  s.moveTo(-D / 2, 0); s.lineTo(D / 2, 0); s.lineTo(D / 2, H); s.lineTo(-D / 2, H); s.lineTo(-D / 2, 0);
  for (const w of WINDOWS) {
    const u0 = -w.z - w.w / 2, u1 = -w.z + w.w / 2; // väggens u löper mot -z
    const h = new THREE.Path();
    h.moveTo(u0, SILL); h.lineTo(u1, SILL); h.lineTo(u1, LINTEL); h.lineTo(u0, LINTEL); h.lineTo(u0, SILL);
    s.holes.push(h);
  }
  const wall = add(g, new THREE.ExtrudeGeometry(s, { depth: WALL_T, bevelEnabled: false }), M.plaster(1 / 70, 1 / 70));
  wall.rotation.y = Math.PI / 2;
  wall.position.set(-W / 2 - WALL_T, F, 0);
  // spröjs: två poster, fem tvärslåar (den fjärde grövre, som en tvärpost) mitt i väggens tjocklek
  const xm = -W / 2 - WALL_T / 2, hgt = LINTEL - SILL;
  for (const w of WINDOWS) {
    for (let i = 1; i < 3; i++) add(g, new THREE.BoxGeometry(1.4, hgt, 0.9), M.mullion, { x: xm, y: F + SILL + hgt / 2, z: w.z - w.w / 2 + (w.w * i) / 3 });
    for (let i = 1; i < 6; i++) add(g, new THREE.BoxGeometry(1.4, i === 4 ? 1.8 : 0.9, w.w), M.mullion, { x: xm, y: F + SILL + (hgt * i) / 6, z: w.z });
    add(g, new THREE.BoxGeometry(WALL_T + 3, 1.2, w.w + 4), M.mullion, { x: -W / 2 - WALL_T / 2 + 1.5, y: F + SILL - 0.6, z: w.z });
  }
}

function walls(g, F, M) {
  const { W, D, H } = ROOM;
  const x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;
  const floor = add(g, new THREE.PlaneGeometry(W, D), M.floor, { y: F, cast: false });
  floor.rotation.x = -Math.PI / 2;
  const ceil = add(g, new THREE.PlaneGeometry(W, D), M.ceiling, { y: F + H, cast: false });
  ceil.rotation.x = Math.PI / 2;
  const tile = 70; // putsens mönster upprepas var 70:e enhet
  const plane = (w, x, z, ry) => {
    const m = add(g, new THREE.PlaneGeometry(w, H), M.plaster(w / tile, H / tile), { x, y: F + H / 2, z, cast: false });
    m.rotation.y = ry;
  };
  plane(W, 0, z0, 0);
  plane(D, x1, 0, -Math.PI / 2);
  plane(W, 0, z1, Math.PI);
  windowWall(g, F, M);
  // bröstpanel med list, taklist och takbjälkar
  const WH = 0.95 * K;
  add(g, new THREE.BoxGeometry(W, WH, 0.8), M.panel, { y: F + WH / 2, z: z0 + 0.4 });
  add(g, new THREE.BoxGeometry(W, WH, 0.8), M.panel, { y: F + WH / 2, z: z1 - 0.4 });
  add(g, new THREE.BoxGeometry(0.8, WH, D), M.panel, { x: x1 - 0.4, y: F + WH / 2 });
  add(g, new THREE.BoxGeometry(0.8, SILL, D), M.panel, { x: x0 + 0.4, y: F + SILL / 2 });
  add(g, new THREE.BoxGeometry(W, 1, 1.6), M.trim, { y: F + WH, z: z0 + 0.8 });
  add(g, new THREE.BoxGeometry(1.6, 1, D), M.trim, { x: x1 - 0.8, y: F + WH });
  add(g, new THREE.BoxGeometry(W, 2.4, 2.4), M.trim, { y: F + H - 1.2, z: z0 + 1.2, cast: false });
  add(g, new THREE.BoxGeometry(2.4, 2.4, D), M.trim, { x: x1 - 1.2, y: F + H - 1.2, cast: false });
  add(g, new THREE.BoxGeometry(2.4, 2.4, D), M.trim, { x: x0 + 1.2, y: F + H - 1.2, cast: false });
  for (let i = -2; i <= 2; i++) add(g, new THREE.BoxGeometry(W, 4.5, 3.2), M.tableDark, { y: F + H - 2.25, z: i * 30, cast: false });
}

function bookshelf(g, F, M) {
  const z0 = -ROOM.D / 2, xa = -62, xb = 62, h = 2.45 * K, d = 0.34 * K, n = 6;
  const zc = z0 + d / 2 + 0.8;
  for (const x of [xa, -21, 21, xb]) add(g, new THREE.BoxGeometry(1.8, h, d), M.panel, { x, y: F + h / 2, z: zc });
  add(g, new THREE.BoxGeometry(xb - xa + 6, 2.6, d + 2), M.panel, { y: F + h + 1.3, z: zc + 1 });
  add(g, new THREE.BoxGeometry(xb - xa, h, 0.6), M.panel, { y: F + h / 2, z: z0 + 1.1 });
  const gap = (h - 4) / n, books = [], rnd = mulberry32(17);
  for (let i = 0; i <= n; i++) {
    const y = F + 2 + i * gap;
    add(g, new THREE.BoxGeometry(xb - xa, 1.0, d), M.panel, { y, z: zc });
    if (i === n) break;
    for (const [a, b] of [[xa, -21], [-21, 21], [21, xb]]) {
      let x = a + 1.4;
      while (x < b - 2.5) {
        if (rnd() < 0.04) { x += 3 + rnd() * 4; continue; } // en lucka då och då
        const t = 0.9 + rnd() * 1.4, bh = gap * (0.62 + rnd() * 0.3), bd = d * (0.72 + rnd() * 0.12);
        books.push([x + t / 2, y + 0.5 + bh / 2, zc + d / 2 - bd / 2 - 0.4, t, bh, bd]);
        x += t + 0.05;
      }
    }
  }
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.books, books.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const leather = ['#5b1f1a', '#2f3f2a', '#1f3446', '#6b4a1e', '#3b2416', '#7a5a2c', '#4a1c2c', '#273a33', '#8a6a3a', '#2a2420'];
  books.forEach(([x, y, z, sx, sy, sz], i) => {
    inst.setMatrixAt(i, m4.compose(p.set(x, y, z), q, s.set(sx, sy, sz)));
    inst.setColorAt(i, col.set(leather[Math.floor(rnd() * leather.length)]).multiplyScalar(0.8 + rnd() * 0.4));
  });
  inst.castShadow = inst.receiveShadow = true;
  g.add(inst);
}

function table(g, T, F, M) {
  add(g, new THREE.BoxGeometry(TABLE.w, TABLE.thick, TABLE.d), M.table, { y: T - TABLE.thick / 2 });
  add(g, new THREE.BoxGeometry(TABLE.w - 7, 3.2, TABLE.d - 7), M.tableDark, { y: T - TABLE.thick - 1.6 });
  const legH = TABLE.h - TABLE.thick - 0.01;
  const prof = [[0, 0], [1.5, 0], [1.5, 1.2], [1.0, 2], [0.95, 5], [1.45, 7.2], [0.95, 9.4], [0.8, 12.5], [1.35, 15], [0.95, 16.6], [1.35, 18], [1.35, legH], [0, legH]];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add(g, lathe(prof), M.tableDark, { x: sx * (TABLE.w / 2 - 5), y: F, z: sz * (TABLE.d / 2 - 5) });
  }
}

/**
 * Kartan ligger på bordet med lätt uppböjda kortändar; norr (Skandinavien) bort från vit. Bladet har en egen kopia av
 * texturen, så att ett fältslag kan visa sin fälttågskarta (ett utsnitt, se atlas.js) medan globen behåller hela.
 */
function mapSheet(g, T, mapTex) {
  const w = MAP_W, h = MAP_H;
  const geo = new THREE.PlaneGeometry(w, h, 120, 6);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = Math.abs(p.getX(i)) - (w / 2 - 3.5);
    if (a > 0) p.setY(i, a * a * 0.06);
  }
  geo.computeVertexNormals();
  const tex = mapTex.clone();
  tex.needsUpdate = true;
  // papperet något mörkare än bilden: annars bränner solfläcken ut kartan helt
  add(g, geo, softMip(new THREE.MeshStandardMaterial({ map: tex, color: 0xd2c6b0, roughness: 0.9 }), mapBias), { y: T + 0.015, cast: false });
  return tex;
}

/** En mässingsnål med en liten fana. */
function pinOn(g, T, M, { height = 1.5, flag = [0.95, 0.58], material }) {
  const pin = new THREE.Group();
  pin.position.y = T;
  add(pin, new THREE.CylinderGeometry(0.05, 0.05, height, 6), M.brass, { y: height / 2 });
  add(pin, new THREE.SphereGeometry(0.13, 10, 8), M.brass, { y: height });
  add(pin, new THREE.PlaneGeometry(...flag), material, { x: flag[0] / 2 + 0.03, y: height - flag[1] / 2 - 0.01 });
  g.add(pin);
  return pin;
}

/** Slagnålen: två nålar med de stridande rikenas fanor, lutade mot varandra. Fanorna målas av faltslag/scen.js. */
function battlePin(g, T, M) {
  const group = new THREE.Group();
  group.visible = false;
  g.add(group);
  const flags = [-1, 1].map((s) => {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide, alphaTest: 0.5 });
    const pin = pinOn(group, T, M, { height: 2.6, flag: [1.5, 0.95], material });
    pin.rotation.set(0, 0, -s * 0.3);
    pin.scale.x = s; // fanan vajar utåt från korset, med stången på rätt sida
    return material;
  });
  return { group, flags };
}

function tableProps(g, T, M) {
  // nålar med små fanor på riktiga städer, som på en fälttågskarta; platsen räknas med Saeculas projektion
  const cities = [
    [18.07, 59.33, '#2a4f78'], // Stockholm
    [12.57, 55.68, '#a3322b'], // Köpenhamn
    [2.35, 48.86, '#33508a'], // Paris
    [16.37, 48.21, '#c49a3a'], // Wien
    [12.5, 41.9, '#e6dcc4'], // Rom
    [-3.7, 40.42, '#8c2b25'], // Madrid
  ];
  const pins = cities.map(([lon, lat, c], i) => {
    const pin = pinOn(g, T, M, { material: new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide }) });
    pin.userData.uv = atlasUV(lon, lat);
    pin.rotation.y = 1.1 - i * 0.37;
    return pin;
  });
  // en ihoprullad karta vid bordskanten och en passare på kartan
  const scroll = add(g, new THREE.CylinderGeometry(0.85, 0.85, 12, 20), M.parchment, { x: -19, y: T + 0.85, z: 19.2 });
  scroll.rotation.set(0, 0.12, Math.PI / 2);
  const V = (x, y, z) => new THREE.Vector3(x, T + y, z);
  rod(g, V(-15, 1.9, 13.2), V(-16.1, 0.05, 14.3), 0.07, M.brass);
  rod(g, V(-15, 1.9, 13.2), V(-13.6, 0.05, 12.3), 0.07, M.brass);
  add(g, new THREE.SphereGeometry(0.16, 12, 10), M.brass, { x: -15, y: T + 1.95, z: 13.2 });
  return pins;
}

function candelabra(g, x, y, z, M, s, flames) {
  const c = new THREE.Group();
  c.position.set(x, y, z);
  c.scale.setScalar(s);
  c.rotation.y = 0.6;
  g.add(c);
  const o = { cast: false };
  add(c, lathe([[0, 0], [2.3, 0], [2.3, 0.35], [1.7, 0.8], [0.7, 1.5], [0.42, 2.8], [0.75, 3.3], [0.38, 3.9], [0.38, 8.0], [0.7, 8.3], [0.3, 8.8], [0.3, 9.6], [0, 9.6]]), M.brass, o);
  const cup = lathe([[0, 0], [0.75, 0], [0.75, 0.15], [0.55, 0.3], [0.62, 0.9], [0.5, 0.9], [0.45, 0.32], [0, 0.32]], 20);
  const tops = [[0, 9.6]];
  for (const sx of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([[0, 6.2], [sx * 1.6, 5.9], [sx * 3.2, 6.8], [sx * 3.6, 8.0]].map(([px, py]) => new THREE.Vector3(px, py, 0)));
    add(c, new THREE.TubeGeometry(curve, 24, 0.22, 8), M.brass, o);
    tops.push([sx * 3.6, 8.0]);
  }
  const mine = [];
  for (const [tx, ty] of tops) {
    add(c, cup, M.brass, { x: tx, y: ty, cast: false });
    add(c, new THREE.CylinderGeometry(0.4, 0.43, 3.4, 16), M.wax, { x: tx, y: ty + 2.02, cast: false });
    add(c, new THREE.CylinderGeometry(0.035, 0.035, 0.4, 4), M.wick, { x: tx, y: ty + 3.9, cast: false });
    const f = add(c, new THREE.SphereGeometry(0.22, 12, 10), M.flame, { x: tx, y: ty + 4.35, cast: false, receive: false });
    f.scale.set(1, 2.3, 1);
    mine.push(f);
  }
  flames.push(mine);
}

function globe(g, x, F, z, M, mapTex) {
  const gl = new THREE.Group();
  gl.position.set(x, F, z);
  g.add(gl);
  add(gl, lathe([[0, 0], [5.5, 0], [5.5, 0.8], [4.2, 1.4], [1.4, 2.4], [0.9, 6], [1.3, 9], [0.8, 14], [1.2, 17.5], [2.6, 19], [0, 19]]), M.tableDark);
  const R = 8.5, cy = 19 + R + 1.2;
  const sphere = add(gl, new THREE.SphereGeometry(R, 48, 32), new THREE.MeshStandardMaterial({ map: mapTex, roughness: 0.5 }), { y: cy });
  sphere.rotation.z = 0.41;
  const mer = add(gl, new THREE.TorusGeometry(R + 0.5, 0.28, 8, 64), M.brass, { y: cy });
  mer.rotation.set(0, 0.6, 0.41);
  const hor = add(gl, new THREE.TorusGeometry(R + 1.4, 0.55, 8, 64), M.tableDark, { y: cy });
  hor.rotation.x = Math.PI / 2;
}

/** Två fanor på bortre väggen; i ett fältslag bär den vänstra vits rike och den högra svarts. Ger materialen. */
function banners(g, F, M, pal) {
  const z = -ROOM.D / 2 + 1.2, top = F + ROOM.H - 16;
  const map = bannerTexture(pal.banner);
  return [-80, 80].map((x) => {
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.5 });
    add(g, new THREE.PlaneGeometry(20, 40), mat, { x, y: top - 20, z, cast: false });
    const r = add(g, new THREE.CylinderGeometry(0.45, 0.45, 25, 10), M.brass, { x, y: top + 0.5, z: z + 0.4, cast: false });
    r.rotation.z = Math.PI / 2;
    for (const e of [-1, 1]) add(g, new THREE.SphereGeometry(0.9, 12, 10), M.brass, { x: x + e * 12.8, y: top + 0.5, z: z + 0.4, cast: false });
    return mat;
  });
}

/**
 * Bygg rummet runt brädet. T är brädets undersida (= bordsskivans ovansida).
 * Ger gruppen, golvets höjd F och kandelabrarnas lågor (en lista per kandelaber, för ljusen).
 */
export function buildRoom(boardBottom, pal, mapTex, { half = 9.4, lift = 0.7, tableX = 0 } = {}) {
  const g = new THREE.Group();
  const T = boardBottom - lift; // brädet vilar på en låg trälåda ovanpå kartan
  const F = T - TABLE.h;
  const M = materials(pal);
  // Lådans ovansida slutar strax under ramens underkant (0,02 över brädets lägsta punkt), och mässingslisten är ett
  // band på lådans sidor. Två ytor på samma höjd tävlar om pixlarna och flimrar så fort kameran rör sig.
  const top = boardBottom + 0.018;
  add(g, new THREE.BoxGeometry(2 * half + 0.5, top - T, 2 * half + 0.5), M.tableDark, { y: (T + top) / 2 });
  add(g, new THREE.BoxGeometry(2 * half + 0.62, 0.14, 2 * half + 0.62), M.brass, { y: top - 0.15 });
  walls(g, F, M);
  bookshelf(g, F, M);
  // bordet med kartan skjuts i sidled: brädet står på kartans östra del och Östersjön ligger fri bredvid
  const tg = new THREE.Group();
  tg.position.x = tableX;
  g.add(tg);
  table(tg, T, F, M);
  const sheet = mapSheet(tg, T, mapTex);
  const pins = tableProps(tg, T, M);
  const battle = battlePin(tg, T, M);
  /** Visa ett utsnitt av kartan (FULL_VIEW = hela). Nålarna följer med; de som hamnar under brädet göms. */
  const setMapView = (view = FULL_VIEW) => {
    sheet.repeat.set(view.s, view.s);
    sheet.offset.set(view.u0, 1 - view.v0 - view.s); // bildens v går nedåt, texturens uppåt
    for (const p of pins) {
      const [x, z] = sheetPos(view, ...p.userData.uv);
      p.position.set(x, T, z);
      p.visible = pinVisible(x, z);
    }
  };
  setMapView();
  const rug = add(g, new THREE.PlaneGeometry(2.7 * K, 1.95 * K), new THREE.MeshStandardMaterial({ map: rugTexture(pal.rug), roughness: 0.95 }), { y: F + 0.06, cast: false });
  rug.rotation.x = -Math.PI / 2;
  const flames = [];
  candelabra(tg, -26.2, T, -17, M, 0.75, flames); // på bordets bakre hörn, utanför kartan
  candelabra(tg, 26.2, T, -17, M, 0.75, flames);
  candelabra(g, 74, F, -62, M, 4.4, flames);
  globe(g, -58, F, -60, M, mapTex);
  const bannerMats = banners(g, F, M, pal);
  // himlen och kullarna utanför fönstren: obelyst, färgen sätts efter tiden på dygnet
  const outside = add(g, new THREE.PlaneGeometry(260, 190), new THREE.MeshBasicMaterial({ map: skyTexture(), fog: false }), { x: -ROOM.W / 2 - 70, y: F + 80, cast: false, receive: false });
  outside.rotation.y = Math.PI / 2;
  return { group: g, T, F, flames, outside, setMapView, battlePin: battle, banners: bannerMats };
}

/**
 * Ett förenklat rum för omgivningsljuset (PMREM): väggar, golv, bord och lysande fönster och lågor.
 * Allt flyttas så att ögat (T + 1,5) hamnar i origo, där PMREM-kameran står.
 */
export function buildEnv(env, T, flames) {
  const s = new THREE.Scene();
  const { W, D, H } = ROOM;
  const eye = T + 1.5, F = T - TABLE.h - eye;
  const basic = (c, gain = 1, side = THREE.FrontSide) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(gain), side });
  const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), basic(env.walls, 1, THREE.BackSide));
  box.position.y = F + H / 2;
  s.add(box);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), basic(env.floor));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = F + 0.5;
  s.add(floor);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.w, TABLE.d), basic(env.table));
  top.rotation.x = -Math.PI / 2;
  top.position.y = -1.5 - 0.05;
  s.add(top);
  for (const w of WINDOWS) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w.w, LINTEL - SILL), basic(env.window, env.windowGain));
    pane.rotation.y = Math.PI / 2;
    pane.position.set(-W / 2 + 0.5, F + (SILL + LINTEL) / 2, w.z);
    s.add(pane);
  }
  if (env.candleGain) {
    const p = new THREE.Vector3();
    for (const f of flames.flat()) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), basic(0xffb257, env.candleGain));
      f.getWorldPosition(p);
      m.position.set(p.x, p.y - eye, p.z);
      s.add(m);
    }
  }
  return s;
}
