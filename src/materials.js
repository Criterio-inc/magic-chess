// Material för pjäser och arena. Pjäserna saknar UV:er: marmorn läggs triplanart i
// vilopositionens objektrum (texturen sitter fast i statyn när den rör sig), och ådrorna
// ger bump via skärmrymdsderivator (perturbNormalArb) — inga tangenter behövs för skinning.
import * as THREE from 'three';
import { tier } from './quality.js';

const loader = new THREE.TextureLoader();
let maxAniso = 8;
const texCache = new Map();

export function setAnisotropy(renderer) {
  maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
}

export function tex(url, { srgb = false, repeat = 1 } = {}) {
  url = url.replace('tex/', 'tex/' + tier.tex); // mobil: halv upplösning
  const key = url + srgb;
  let t = texCache.get(key);
  if (!t) {
    t = loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texCache.set(key, t);
  }
  if (repeat !== 1) {
    const c = t.clone();
    c.repeat.set(repeat, repeat);
    c.needsUpdate = true;
    return c;
  }
  return t;
}

const TRI_VERT_PARS = /* glsl */ `
varying vec3 vTriPos;
varying vec3 vTriNrm;
`;
const TRI_FRAG_PARS = /* glsl */ `
uniform sampler2D triAlbedo;
uniform sampler2D triData;
uniform float triScale;
uniform vec3 triTint;
uniform float triBump;
uniform float triRough;
varying vec3 vTriPos;
varying vec3 vTriNrm;
vec3 triPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surf_pos));
  vec3 sy = normalize(dFdy(surf_pos));
  vec3 r1 = cross(sy, surf_norm);
  vec3 r2 = cross(surf_norm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surf_norm - grad);
}
`;

/** Marmor för pjäser (triplanar). opts: albedo, data, tint, scale, roughness, clearcoat */
export function triplanarMarble({ albedo, data, tint = 0xffffff, scale = 0.9, roughness = 0.25, clearcoat = 0.4,
  clearcoatRoughness = 0.12, bump = 0.012, sheen = 0 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness, metalness: 0, clearcoat, clearcoatRoughness, sheen,
    sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffe9d2),
    side: THREE.DoubleSide, // krossade statyer visar insidan
  });
  const uniforms = {
    triAlbedo: { value: albedo }, triData: { value: data }, triScale: { value: scale },
    triTint: { value: new THREE.Color(tint) }, triBump: { value: bump }, triRough: { value: roughness },
  };
  m.userData.tri = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + TRI_VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTriPos = position;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTriNrm = objectNormal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TRI_FRAG_PARS)
      .replace('#include <clipping_planes_fragment>', /* glsl */ `
        #include <clipping_planes_fragment>
        vec3 tn = normalize(vTriNrm);
        vec3 tw = pow(abs(tn), vec3(6.0)); tw /= (tw.x + tw.y + tw.z);
        vec3 tp = vTriPos * triScale;
        vec3 triCol = texture2D(triAlbedo, tp.zy).rgb * tw.x + texture2D(triAlbedo, tp.xz + 0.37).rgb * tw.y + texture2D(triAlbedo, tp.xy + 0.71).rgb * tw.z;
        vec3 triDat = texture2D(triData, tp.zy).rgb * tw.x + texture2D(triData, tp.xz + 0.37).rgb * tw.y + texture2D(triData, tp.xy + 0.71).rgb * tw.z;
      `)
      .replace('#include <map_fragment>', 'diffuseColor.rgb *= triCol * triTint;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(triRough * triDat.g / 0.2, 0.04, 1.0);')
      .replace('#include <normal_fragment_maps>', /* glsl */ `
        #include <normal_fragment_maps>
        normal = triPerturb(-vViewPosition, normal, vec2(dFdx(triDat.r), dFdy(triDat.r)) * triBump * 60.0, faceDirection);
      `);
  };
  m.customProgramCacheKey = () => 'triMarble';
  return m;
}

/**
 * Bakad ambient occlusion + krökning ur vertexfärgen (Blender: R = AO, G = krökning, 0,5 = plan).
 * AO dämpar bara indirekt ljus (himmel, reflexer, lack) — solen skuggas av skuggkartan — plus lite smuts
 * i skrevor; konvexa kanter ljusnar som sliten, polerad sten/metall.
 */
export function withBake(m, { dirt = 0.4, edge = 0.5, ao = 1.0 } = {}) {
  m.vertexColors = true;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  const uniforms = { uBakeDirt: { value: dirt }, uBakeEdge: { value: edge }, uBakeAO: { value: ao } };
  m.userData.bake = uniforms;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBakeDirt;\nuniform float uBakeEdge;\nuniform float uBakeAO;')
      .replace('#include <color_fragment>', /* glsl */ `
        float bakeAO = vColor.r;
        float bakeEdge = vColor.g - 0.5;
        diffuseColor.rgb *= mix(1.0, bakeAO, uBakeDirt);
        diffuseColor.rgb *= 1.0 + clamp(bakeEdge, -0.3, 0.5) * uBakeEdge;
      `)
      .replace('#include <aomap_fragment>', /* glsl */ `
        {
          float ambientOcclusion = mix(1.0, bakeAO, uBakeAO);
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #if defined( USE_CLEARCOAT )
            clearcoatSpecularIndirect *= ambientOcclusion;
          #endif
          #if defined( USE_SHEEN )
            sheenSpecularIndirect *= ambientOcclusion;
          #endif
          float dotNVb = saturate( dot( geometryNormal, geometryViewDir ) );
          reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNVb, ambientOcclusion, material.roughness );
        }
      `);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|bake';
  return m;
}

/** Brädets ovansida (arena.json tileTop) och halva bredden; main.js sätter dem när arenan laddats.
 *  Delade uniform-objekt: pjäsernas golvspärr och mantelsimuleringen (capes.js) läser samma värden. */
export const boardFloor = { uFloorY: { value: 0.74 }, uFloorHalf: { value: 8.0 } };
export function setBoardFloor(top, half = 8) {
  boardFloor.uFloorY.value = top;
  boardFloor.uFloorHalf.value = half;
}

const FLOOR_VERT = /* glsl */ `
#ifdef USE_SKINNING
  {
    // golvspärr: inom brädet går ingen skinnad vertex under brädets ovansida (dräktfållar bundna till hips
    // sjunker annars genom golvet när dumma gången sänker höften). Utanför brädet (kyrkogården, slungade
    // pjäser) gäller ingen spärr.
    vec4 bfW = modelMatrix * vec4(transformed, 1.0);
    if (abs(bfW.x) < uFloorHalf && abs(bfW.z) < uFloorHalf && bfW.y < uFloorY)
      transformed += inverse(mat3(modelMatrix)) * vec3(0.0, uFloorY - bfW.y, 0.0);
  }
#endif
#include <project_vertex>`;

/** Golvspärr för skinnade pjäsmaterial (efter skinningen, före projektionen). Kedjas efter withBake m.fl. */
export function withFloor(m) {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, boardFloor);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFloorY;\nuniform float uFloorHalf;')
      .replace('#include <project_vertex>', FLOOR_VERT);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|floor';
  return m;
}

// ------------------------------------------------------------- trumpojkens kostym (procedurell, utan UV:er)

const REST_VERT_PARS = /* glsl */ `
varying vec3 vRestPos;
varying vec3 vRestNrm;
`;
const PROC_FRAG_PARS = /* glsl */ `
varying vec3 vRestPos;
varying vec3 vRestNrm;
float bcHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bcNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bcHash(i), bcHash(i + vec3(1, 0, 0)), f.x), mix(bcHash(i + vec3(0, 1, 0)), bcHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(bcHash(i + vec3(0, 0, 1)), bcHash(i + vec3(1, 0, 1)), f.x), mix(bcHash(i + vec3(0, 1, 1)), bcHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// tvåskaftsväv: varp och inslag byter plats i varannan ruta. x = höjd (0..1, glest i hörnen), y = trådens ton
vec2 bcWeave(vec2 uv) {
  vec2 c = floor(uv), f = fract(uv) - 0.5;
  float px = cos(3.14159 * f.x), py = cos(3.14159 * f.y);
  bool warp = mod(c.x + c.y, 2.0) < 1.0;
  float h = warp ? px * (0.6 + 0.4 * py) : py * (0.6 + 0.4 * px);
  float tone = warp ? bcHash(vec3(c.x, 1.3, 0.7)) : bcHash(vec3(2.9, c.y, 5.1));   // ojämnt spunna trådar
  return vec2(h, tone);
}
vec3 bcPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surf_pos)), sy = normalize(dFdy(surf_pos));
  vec3 r1 = cross(sy, surf_norm), r2 = cross(surf_norm, sx);
  float det = dot(sx, r1) * faceDir;
  return normalize(abs(det) * surf_norm - sign(det) * (dHdxy.x * r1 + dHdxy.y * r2));
}
`;

/** Gemensam stomme: vilopositionen (skinnade meshar) som varying, så att mönstret sitter fast i tyget. */
function restSpace(m, key, uniforms, fragSetup, colorLine, bumpExpr) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + REST_VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRestPos = position;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvRestNrm = objectNormal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + Object.keys(uniforms).map((k) => `uniform float ${k};`).join('\n') + PROC_FRAG_PARS)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + fragSetup)
      .replace('#include <map_fragment>', colorLine)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = bcPerturb(-vViewPosition, normal, ${bumpExpr}, faceDirection);`);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

/** Ofärgad säckväv: grov tvåskaftsväv (cell = trådavstånd i m) och fläckig ton; väven tonas bort på
 *  avstånd (ingen moaré) så att bara den bruna tonen syns i översikten. */
export function sackcloth({ color = 0x7a5b3b, cell = 0.0055, contrast = 0.3, mottle = 0.16, bump = 0.7, roughness = 0.95,
  sheen = 0.35, sheenColor = 0xd9c29c } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, sheen, sheenRoughness: 0.6,
    sheenColor: new THREE.Color(sheenColor), side: THREE.DoubleSide });
  return restSpace(m, 'sackcloth', { uCell: { value: 1 / cell }, uContrast: { value: contrast }, uMottle: { value: mottle },
    uWBump: { value: bump } }, /* glsl */ `
      vec3 wn = pow(abs(normalize(vRestNrm)), vec3(4.0)); wn /= (wn.x + wn.y + wn.z);
      vec3 wp = vRestPos * uCell;
      // trådarna slingrar lite (handvävt, inte rutmönster)
      wp += (vec3(bcNoise(vRestPos * 31.0), bcNoise(vRestPos * 31.0 + 5.0), bcNoise(vRestPos * 31.0 + 9.0)) - 0.5) * 1.2;
      vec2 wv = bcWeave(wp.zy) * wn.x + bcWeave(wp.xz) * wn.y + bcWeave(wp.xy) * wn.z;
      float wh = wv.x;
      float wf = 1.0 - smoothstep(0.3, 0.7, length(fwidth(wp)));
      float mot = bcNoise(vRestPos * 23.0) * 0.6 + bcNoise(vRestPos * 71.0) * 0.4;
    `, 'diffuseColor.rgb *= (1.0 + ((wh - 0.6) * uContrast + (wv.y - 0.5) * 0.22) * wf) * (1.0 + (mot - 0.5) * uMottle * 2.0);',
  'vec2(dFdx(wh), dFdy(wh)) * wf * uWBump');
}

/** Kokosnötsskal: mörkbrunt med fibrer längs vilans x (skålarnas axel ungefär, så att de löper pol till pol)
 *  och sheen som ger ett luddigt, hårigt ljus i kanten. */
export function fibreShell({ color = 0x5a381f, sheenColor = 0xd8b27f, fiber = 170, bump = 0.6 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.8, metalness: 0, sheen: 1, sheenRoughness: 0.5,
    sheenColor: new THREE.Color(sheenColor), side: THREE.DoubleSide });
  return restSpace(m, 'fibre', { uFiber: { value: fiber }, uFBump: { value: bump } }, /* glsl */ `
      vec3 cq = vRestPos * vec3(uFiber * 0.06, uFiber, uFiber);
      float fib = bcNoise(cq) * 0.65 + bcNoise(cq * vec3(2.3, 2.1, 2.1) + 7.0) * 0.35;
      fib = mix(0.5, fib, 1.0 - smoothstep(0.5, 1.2, length(fwidth(cq))));
    `, 'diffuseColor.rgb *= mix(0.4, 1.6, fib);', 'vec2(dFdx(fib), dFdy(fib)) * uFBump');
}

/** Färgat skimrande tyg */
export function cloth(color, sheenColor) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.78, metalness: 0, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(sheenColor),
    side: THREE.DoubleSide,
  });
}

export function metal(color, roughness = 0.28) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness, clearcoat: 0.15, clearcoatRoughness: 0.2, side: THREE.DoubleSide });
}

export function gem(color, intensity = 4) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color).multiplyScalar(0.3), emissive: color, emissiveIntensity: intensity,
    roughness: 0.08, metalness: 0, clearcoat: 1,
  });
}

/** Lagens materialuppsättningar. Namnen motsvarar Blender-materialen. */
export function teamMaterials() {
  const wA = tex('tex/marble_white_albedo.jpg', { srgb: true });
  const wD = tex('tex/marble_white_data.jpg');
  const bA = tex('tex/marble_black_albedo.jpg', { srgb: true });
  const bD = tex('tex/marble_black_data.jpg');
  const shared = {
    Steel: withBake(metal(0xd2d5db, 0.16), { dirt: 0.5, edge: 0.6 }),
    Wood: withBake(new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.58 }), { dirt: 0.3, edge: 0.3 }),
    Dark: withBake(new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 }), { dirt: 0, edge: 0 }),
  };
  const sets = {
    w: {
      Stone: withBake(triplanarMarble({ albedo: wA, data: wD, tint: 0xffffff, roughness: 0.3, clearcoat: 0.28, sheen: 0.35 }),
        { dirt: 0.28, edge: 0.25, ao: 0.85 }),
      Trim: withBake(metal(0xf0bf5a, 0.26), { dirt: 0.6, edge: 0.7 }),
      Cloth: withBake(cloth(0x1d3a8a, 0x8fb2ff), { dirt: 0.5, edge: 0.4 }),
      Gem: gem(0x7fd2ff, 5),
      ...shared,
    },
    b: {
      Stone: withBake(triplanarMarble({ albedo: bA, data: bD, tint: 0xffffff, roughness: 0.24, clearcoat: 0.45, clearcoatRoughness: 0.1, sheen: 0.2 }),
        { dirt: 0.35, edge: 2.2 }),
      Trim: withBake(metal(0xb9c0cc, 0.22), { dirt: 0.6, edge: 0.7 }),
      Cloth: withBake(cloth(0x7c0f18, 0xff8a7a), { dirt: 0.5, edge: 0.4 }),
      Gem: gem(0xff4b2b, 5),
      ...shared,
    },
  };
  // alla pjäsmaterial får golvspärren (de delade bara en gång)
  for (const m of new Set([...Object.values(sets.w), ...Object.values(sets.b)])) withFloor(m);
  return sets;
}

/** Arenans material, nycklade på Blender-namn. UV:er är i meter. */
export function arenaMaterials() {
  const wA = tex('tex/marble_white_albedo.jpg', { srgb: true, repeat: 0.42 });
  const wD = tex('tex/marble_white_data.jpg', { repeat: 0.42 });
  const wN = tex('tex/marble_white_normal.jpg', { repeat: 0.42 });
  const bA = tex('tex/marble_black_albedo.jpg', { srgb: true, repeat: 0.42 });
  const bD = tex('tex/marble_black_data.jpg', { repeat: 0.42 });
  const bN = tex('tex/marble_black_normal.jpg', { repeat: 0.42 });
  const set = (name, r, srgbRepeat) => ({
    map: tex(`tex/${name}_diff.jpg`, { srgb: true, repeat: r }),
    normalMap: tex(`tex/${name}_nor_gl.jpg`, { repeat: r }),
    roughnessMap: tex(`tex/${name}_rough.jpg`, { repeat: r }),
  });
  const ground = set('monastery_stone_floor', 1 / 3.2);
  const wall = set('castle_wall_slates', 1 / 2.5);
  const rock = set('mossy_rock', 1 / 2.0);
  const grass = set('grass_ground', 1 / 3.5);
  const leafy = tex('tex/leafy_grass_diff.jpg', { srgb: true });
  const tA = tex('tex/marble_white_albedo.jpg', { srgb: true, repeat: 0.3 });
  return {
    BoardWhite: new THREE.MeshPhysicalMaterial({ map: wA, roughnessMap: wD, normalMap: wN, normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: 1.15, color: 0xfffbf3, clearcoat: 0.35, clearcoatRoughness: 0.14 }),
    BoardBlack: new THREE.MeshPhysicalMaterial({ map: bA, roughnessMap: bD, normalMap: bN, normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: 1.1, color: 0xffffff, clearcoat: 0.55, clearcoatRoughness: 0.1 }),
    Frame: new THREE.MeshPhysicalMaterial({ map: tA, color: 0xb8a98f, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.3 }),
    Trim: metal(0xe8b65a, 0.3),
    Bronze: metal(0x8a5a33, 0.45),
    Plinth: new THREE.MeshStandardMaterial({ map: tex('tex/marble_white_albedo.jpg', { srgb: true, repeat: 0.2 }), color: 0xa59a88, roughness: 0.75,
      normalMap: tex('tex/monastery_stone_floor_nor_gl.jpg', { repeat: 0.25 }), normalScale: new THREE.Vector2(0.25, 0.25) }),
    Column: new THREE.MeshStandardMaterial({ map: tex('tex/marble_white_albedo.jpg', { srgb: true, repeat: 0.25 }), color: 0xd9cfbf, roughness: 0.62,
      normalMap: wall.normalMap, normalScale: new THREE.Vector2(0.15, 0.15) }),
    Ground: new THREE.MeshStandardMaterial({ ...ground, roughness: 1 }),
    Wall: new THREE.MeshStandardMaterial({ ...wall, roughness: 1 }),
    Rock: new THREE.MeshStandardMaterial({ ...rock, roughness: 1 }),
    Grass: grassMaterial(grass, leafy),
    Coal: new THREE.MeshStandardMaterial({ color: 0x1a0d08, emissive: 0xff5a14, emissiveIntensity: 1.6, roughness: 0.9,
      emissiveMap: tex('tex/marble_black_albedo.jpg', { srgb: true, repeat: 2 }) }),
    Dark: new THREE.MeshStandardMaterial({ color: 0x0b0908, roughness: 1 }),
  };
}

/** Gräs som blandar två skalor av samma textur så att upprepningen inte syns, plus makrovariation. */
function grassMaterial(set, second) {
  const m = new THREE.MeshStandardMaterial({ ...set, roughness: 1, color: 0xa8b888 });
  const noise = tex('tex/marble_white_data.jpg');
  m.onBeforeCompile = (sh) => {
    sh.uniforms.macroNoise = { value: noise };
    sh.uniforms.secondMap = { value: second };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform sampler2D macroNoise;\nuniform sampler2D secondMap;')
      .replace('#include <map_fragment>', /* glsl */ `
        vec4 g1 = texture2D(map, vMapUv);
        vec4 g2 = texture2D(secondMap, vWPos.xz * 0.21 + 0.3);
        float mn = texture2D(macroNoise, vWPos.xz * 0.004).r;
        float mn2 = texture2D(macroNoise, vWPos.xz * 0.019 + 0.5).r;
        vec3 g = mix(g1.rgb, g2.rgb, smoothstep(0.35, 0.75, mn2) * 0.6);
        g *= mix(vec3(0.72, 0.82, 0.55), vec3(1.05, 1.08, 0.8), smoothstep(0.2, 0.8, mn));
        diffuseColor.rgb *= g;
      `);
  };
  m.customProgramCacheKey = () => 'grassMix';
  return m;
}
