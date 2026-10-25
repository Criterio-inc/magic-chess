// Stilprov för Saecula: Kartbordet (spår A i docs/SPELBYGGET.md). styleprov.html?stil=A|B|C, &shot=1 för skärmbilder.
// Rör inte spelets kod: brädet plockas ur arena.glb och pjäserna laddas med spelets egna klasser.
// Felsökning: window.SP (scene, camera, lights, pieces, setCam). SP.ready blir sant när bilden har satt sig.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset,
  VignetteEffect, DepthOfFieldEffect, BrightnessContrastEffect, HueSaturationEffect, SepiaEffect, NoiseEffect,
  OutlineEffect, BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { Chess } from 'chess.js';
import { gltfLoader } from '../world.js';
import { arenaMaterials, setAnisotropy } from '../materials.js';
import { PieceLibrary } from '../pieces.js';
import { buildRoom, buildEnv, ROOM, WINDOWS, SILL, LINTEL } from './room.js';
import { STYLES } from './styles.js';

const params = new URLSearchParams(location.search);
const key = (params.get('stil') || 'A').toUpperCase();
const S = STYLES[key] || STYLES.A;
const shot = params.has('shot');
// italienskt parti efter några drag: pjäserna står utspridda som mitt i ett slag
const FEN = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5';

const SP = (window.SP = { ready: false, style: key });

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
setAnisotropy(renderer);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(S.camera.fov, window.innerWidth / window.innerHeight, 0.3, 3000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

function setCam(pos, target, fov = camera.fov) {
  camera.position.set(...pos);
  controls.target.set(...target);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  controls.update();
}
const camParam = params.get('cam')?.split(',').map(Number);
if (camParam?.length >= 6) setCam(camParam.slice(0, 3), camParam.slice(3, 6), camParam[6] || S.camera.fov);
else setCam(S.camera.pos, S.camera.target, S.camera.fov);
Object.assign(SP, { scene, camera, renderer, controls, setCam });

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

/** Brädet ur arenan: rutor, fogar, ram och inlägg. Pelare, terräng, glödfat och fanor släcks. */
async function loadBoard() {
  const [gltf, meta] = await Promise.all([
    gltfLoader.loadAsync('/models/arena.glb'),
    fetch('/models/arena.json').then((r) => r.json()),
  ]);
  const mats = arenaMaterials();
  const keep = new Set(['BoardWhite', 'BoardBlack', 'Frame', 'Dark', 'Trim']);
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3(), c = new THREE.Vector3(), bounds = new THREE.Box3();
  const kept = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material?.name;
    box.setFromObject(o).getCenter(c);
    if (keep.has(name) && Math.abs(c.x) < 11 && Math.abs(c.z) < 11 && box.max.y > 0.3) {
      o.material = mats[name] || o.material;
      o.castShadow = o.receiveShadow = true;
      clipToBoard(o);
      bounds.union(box.setFromObject(o));
      kept.push(`${o.name}:${name}`);
    } else {
      o.visible = false;
    }
  });
  scene.add(root);
  SP.board = { kept, bounds };
  return { meta, T: bounds.min.y };
}

async function loadPieces(meta) {
  const lib = new PieceLibrary();
  await lib.load();
  const pieces = [];
  new Chess(FEN).board().forEach((row, i) => row.forEach((sq, f) => {
    if (!sq) return;
    const p = lib.create(sq.type, sq.color);
    p.root.position.set((f - 3.5) * meta.squareSize, meta.tileTop, (3.5 - (7 - i)) * meta.squareSize);
    p.root.rotation.y = p.homeAngle();
    scene.add(p.root);
    pieces.push(p);
  }));
  return pieces;
}

/** Solen som en avlägsen spotlight vars kon precis rymmer fönstren: inget ljus läcker förbi väggen. */
function windowSun(sun, F) {
  const d = new THREE.Vector3(...sun.dir).normalize();
  const target = new THREE.Vector3(-ROOM.W / 2, F + (SILL + LINTEL) / 2, 0);
  const dist = 1600;
  const L = new THREE.SpotLight(sun.color, sun.intensity, 0, 0.1, 0.12, 0);
  L.position.copy(target).addScaledVector(d, dist);
  L.target.position.copy(target);
  const axis = target.clone().sub(L.position).normalize();
  let ang = 0;
  for (const w of WINDOWS) for (const dz of [-w.w / 2, w.w / 2]) for (const y of [SILL, LINTEL]) {
    ang = Math.max(ang, axis.angleTo(new THREE.Vector3(-ROOM.W / 2, F + y, w.z + dz).sub(L.position).normalize()));
  }
  L.angle = ang * 1.12;
  L.castShadow = true;
  L.shadow.mapSize.set(4096, 4096);
  L.shadow.camera.near = dist - 260;
  L.shadow.camera.far = dist + 300;
  L.shadow.bias = -0.00008;
  L.shadow.normalBias = 0.05;
  L.shadow.radius = 2;
  scene.add(L, L.target);
  return L;
}

function overhead(o, T) {
  const L = new THREE.SpotLight(o.color, o.intensity, 0, THREE.MathUtils.degToRad(o.angle), o.penumbra, 0);
  L.position.set(o.pos[0], T + o.pos[1], o.pos[2]);
  L.target.position.set(0, T, 0);
  L.castShadow = true;
  L.shadow.mapSize.set(4096, 4096);
  L.shadow.camera.near = 20;
  L.shadow.camera.far = 220;
  L.shadow.bias = -0.0002;
  L.shadow.normalBias = 0.04;
  L.shadow.radius = 5;
  scene.add(L, L.target);
  return L;
}

function candleLights(room) {
  const out = [];
  room.flames.forEach((group, i) => {
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    for (const f of group) p.add(f.getWorldPosition(q));
    p.divideScalar(group.length).y += 0.8;
    const gain = i < 2 ? 1 : S.candles.floorGain ?? 3;
    const L = new THREE.PointLight(S.candles.color, S.candles.intensity * gain, 0, 2);
    L.position.copy(p);
    L.castShadow = i < 2; // kandelabrarna på bordet kastar skuggor, golvkandelabern bara lyser
    L.shadow.mapSize.set(1024, 1024);
    L.shadow.camera.near = 0.5;
    L.shadow.camera.far = 400;
    L.shadow.bias = -0.002;
    L.shadow.normalBias = 0.03;
    L.shadow.radius = 3;
    L.userData.base = L.intensity;
    scene.add(L);
    out.push(L);
  });
  const fill = S.candles.fill;
  if (fill) {
    const L = new THREE.PointLight(S.candles.color, fill.intensity, 0, 2);
    L.position.set(...fill.pos);
    L.castShadow = true;
    L.shadow.mapSize.set(1024, 1024);
    L.shadow.bias = -0.002;
    L.shadow.radius = 3;
    L.userData.base = L.intensity;
    scene.add(L);
    out.push(L);
  }
  return out;
}

function setupPost(pieces) {
  const w = window.innerWidth, h = window.innerHeight, P = S.post;
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  const ao = new N8AOPostPass(scene, camera, w, h);
  ao.configuration.aoRadius = 2.2;
  ao.configuration.distanceFalloff = 1.0;
  ao.configuration.intensity = P.ao;
  ao.configuration.color = new THREE.Color(0x0b0806);
  ao.setQualityMode('Medium');
  composer.addPass(ao);
  if (P.dof) {
    // skärpedjupet gör pjäserna till figurer på ett bord: skarpt brädet, mjukt rummet
    const dof = new DepthOfFieldEffect(camera, { focusDistance: 20, focusRange: 14, bokehScale: P.dof, resolutionScale: 0.5 });
    dof.target = new THREE.Vector3(-1, 1.5, -2);
    composer.addPass(new EffectPass(camera, dof));
  }
  const fx = [
    new BloomEffect({ intensity: P.bloom, luminanceThreshold: 1.0, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 }),
    new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
    new HueSaturationEffect({ saturation: P.saturation }),
    new BrightnessContrastEffect({ contrast: P.contrast }),
  ];
  if (P.sepia) fx.push(new SepiaEffect({ intensity: P.sepia }));
  if (P.outline) {
    const o = new OutlineEffect(scene, camera, { blendFunction: BlendFunction.ALPHA, edgeStrength: 2.4, visibleEdgeColor: 0x2b1a0c, hiddenEdgeColor: 0x2b1a0c, blur: false, xRay: false });
    o.selection.set(pieces.flatMap((p) => p.meshes));
    fx.push(o);
  }
  if (P.noise) {
    const n = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT });
    n.blendMode.opacity.value = P.noise;
    fx.push(n);
  }
  fx.push(new VignetteEffect({ offset: P.vignetteOffset ?? 0.28, darkness: P.vignette }));
  composer.addPass(new EffectPass(camera, ...fx));
  composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
  return composer;
}

function caption() {
  document.getElementById('t').textContent = S.title;
  document.getElementById('n').textContent = S.note;
  for (const a of document.querySelectorAll('#nav a')) a.toggleAttribute('aria-current', a.dataset.s === key);
  document.body.classList.toggle('shot', shot);
}

async function main() {
  caption();
  const mapTex = new THREE.TextureLoader().loadAsync('/styleprov/karta.jpg').then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  });
  const sky = new HDRLoader().loadAsync('/hdri/' + S.sky.file);
  const { meta, T } = await loadBoard();
  const [pieces, map, skyTex] = await Promise.all([loadPieces(meta), mapTex, sky]);

  const room = buildRoom(T, S.palette, map, { half: 9.4, lift: 0.7, tableX: -11 });
  scene.add(room.group);
  scene.updateMatrixWorld(true);
  for (const f of room.flames.flat()) f.visible = !!S.candles;

  skyTex.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = skyTex;
  scene.backgroundIntensity = S.sky.intensity;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(buildEnv(S.env, room.T, room.flames), 0.04, 0.1, 1000).texture;
  scene.environmentIntensity = S.env.intensity;
  scene.add(new THREE.HemisphereLight(S.hemi[0], S.hemi[1], S.hemi[2]));
  if (S.fog) scene.fog = new THREE.FogExp2(S.fog[0], S.fog[1]);
  const lights = { sun: S.sun && windowSun(S.sun, room.F), over: S.overhead && overhead(S.overhead, room.T), candles: S.candles ? candleLights(room) : [] };

  const composer = setupPost(pieces);
  Object.assign(SP, { pieces, lights, room, T, composer });
  console.info('stilprov', key, 'T =', T.toFixed(3), 'bräde:', SP.board.kept.join(', '));

  // storleken följer duken varje bild: en panel som startar dold har bredd noll tills den visas
  let size = [0, 0];
  const fit = () => {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    if (!w || !h || (w === size[0] && h === size[1])) return;
    size = [w, h];
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
  };
  let last = performance.now(), frames = 0;
  const readyAt = shot ? 14 : 40;
  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const p of pieces) p.update(dt);
    for (const L of lights.candles) L.intensity = L.userData.base * (0.93 + 0.07 * Math.sin(now * 0.011 + L.id) * Math.sin(now * 0.0037 + L.id * 2));
    fit();
    controls.update();
    composer.render(dt);
    if (++frames === readyAt) SP.ready = true;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

main().catch((e) => {
  console.error(e);
  SP.error = String(e);
});
