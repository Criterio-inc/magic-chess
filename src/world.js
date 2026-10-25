// Renderare, himmel/ljus, efterbehandling och arenan.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect,
  VignetteEffect, DepthOfFieldEffect, SMAAPreset, BrightnessContrastEffect, HueSaturationEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { arenaMaterials, setAnisotropy } from './materials.js';
import { tier } from './quality.js';

export const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

// Solen läggs från vänster och lite framifrån sett från vit: statyerna får form och långa skuggor.
const SUN_AZIMUTH = THREE.MathUtils.degToRad(155);

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance' }));
    this.dpr = Math.min(window.devicePixelRatio, tier.dprMax);
    r.setPixelRatio(this.dpr);
    r.setSize(window.innerWidth, window.innerHeight, false);
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    setAnisotropy(r);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 2500);
    this.camera.position.set(0, 17, 21);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.8, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 46;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(82);
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.6;

    this.clock = new THREE.Clock();
    this.updaters = new Set();
    this.shake = 0;
    this.tierName = tier.name;
    this.timeScale = 1; // felsökning: BC.world.timeScale = 0.2 för slowmotion
    this.slow = 1;      // filmisk slowmotion/träffstopp (se slowmo, hitstop)
    this.slowUntil = 0;
    this.tmp = new THREE.Vector3();
    window.addEventListener('resize', () => this.resize());
  }

  async load(onProgress) {
    const steps = [];
    const hdr = new HDRLoader().loadAsync('/hdri/' + tier.sky).then((t) => { onProgress?.('sky'); return t; });
    const arena = gltfLoader.loadAsync(`/models/arena${tier.lod}.glb`).then((g) => { onProgress?.('arena'); return g; });
    const meta = fetch('/models/arena.json').then((r) => r.json());
    const [sky, gltf, arenaMeta] = await Promise.all([hdr, arena, meta, ...steps]);
    this.meta = arenaMeta;
    this.setupSky(sky);
    this.setupArena(gltf.scene);
    this.setupPost();
    return arenaMeta;
  }

  /** Hitta solen (ljusaste pixeln) och horisontens färg i en HDR. */
  analyseSky(sky) {
    const { data, width, height } = sky.image;
    const half = data instanceof Uint16Array;
    const val = (i) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
    let best = -1, bx = 0, by = 0;
    const horizon = new THREE.Color(0, 0, 0);
    let hn = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        const l = val(i) * 0.2126 + val(i + 1) * 0.7152 + val(i + 2) * 0.0722;
        if (l > best) { best = l; bx = x; by = y; }
        if (Math.abs(y - height / 2) < height * 0.03) {
          horizon.r += Math.min(val(i), 4); horizon.g += Math.min(val(i + 1), 4); horizon.b += Math.min(val(i + 2), 4); hn++;
        }
      }
    }
    horizon.multiplyScalar(1 / hn);
    const v = sky.flipY ? 1 - (by + 0.5) / height : (by + 0.5) / height;
    return { az: ((bx + 0.5) / width - 0.5) * 2 * Math.PI, el: (v - 0.5) * Math.PI, horizon };
  }

  setupSky(sky) {
    sky.mapping = THREE.EquirectangularReflectionMapping;
    const { az, el, horizon } = this.analyseSky(sky);

    // Vrid himlen så att solen hamnar i önskad riktning
    const rot = SUN_AZIMUTH - az;
    this.scene.background = sky;
    this.scene.environment = sky;
    this.scene.backgroundRotation.set(0, -rot, 0);
    this.scene.environmentRotation.set(0, -rot, 0);
    this.scene.backgroundIntensity = 0.9;
    this.scene.environmentIntensity = 0.42;
    const sunAz = az + rot;
    const elev = Math.max(el, THREE.MathUtils.degToRad(14)); // låg men inte nedgången
    this.sunDir = new THREE.Vector3(Math.cos(sunAz) * Math.cos(elev), Math.sin(elev), Math.sin(sunAz) * Math.cos(elev)).normalize();
    // Vridningen sker kring Y; three tolkar backgroundRotation åt andra hållet, därav minustecknet ovan.
    const sun = (this.sun = new THREE.DirectionalLight(0xffd9a8, 5.2));
    sun.position.copy(this.sunDir).multiplyScalar(60);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(tier.shadow, tier.shadow);
    const sc = sun.shadow.camera;
    sc.left = -27; sc.right = 27; sc.top = 27; sc.bottom = -27; sc.near = 5; sc.far = 140;
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 2.5;
    sc.updateProjectionMatrix();
    this.scene.add(sun, sun.target);
    this.horizon = horizon;
    const fogCol = horizon.clone().multiplyScalar(0.62);
    this.scene.fog = new THREE.FogExp2(fogCol, 0.0019);
    this.daySky = sky;
    this.day = { el: elev, fog: fogCol.clone(), rot: -rot };
    this.tod = 0;
    this.todGoal = 0;
    this.fireBoost = 1;
    this.addUpdater((dt) => this.updateTime(dt));
  }

  // ---------------------------------------------------------------- tiden går: gyllene timme -> skymning

  /** t: 0 = eftermiddag, 1 = skymning. snap = hoppa direkt (nytt parti, fortsättning). */
  setTimeOfDay(t, snap = false) {
    this.todGoal = THREE.MathUtils.clamp(t, 0, 1);
    if (snap) { this.tod = this.todGoal; this.applyTime(this.tod); }
  }

  updateTime(dt) {
    if (Math.abs(this.todGoal - this.tod) < 0.0005) return;
    this.tod += (this.todGoal - this.tod) * Math.min(1, dt * 0.35);
    this.applyTime(this.tod);
  }

  applyTime(t) {
    const L = THREE.MathUtils.lerp;
    const el = THREE.MathUtils.degToRad(L(THREE.MathUtils.radToDeg(this.day.el), 3.5, t));
    this.sunDir.set(Math.cos(SUN_AZIMUTH) * Math.cos(el), Math.sin(el), Math.sin(SUN_AZIMUTH) * Math.cos(el)).normalize();
    this.sun.position.copy(this.sunDir).multiplyScalar(60);
    this.sun.color.set(0xffd9a8).lerp(new THREE.Color(0xff7a40), Math.min(1, t * 1.15));
    this.sun.intensity = L(5.2, 1.5, Math.pow(t, 1.15));
    this.scene.fog.color.copy(this.day.fog).lerp(new THREE.Color(0x2e2530), t * 0.9);
    this.fireBoost = L(1, 2.6, t);
    // byt till skymningshimlen (med solen vriden till samma riktning) när kvällen är långt gången
    const dusk = t > 0.6;
    if (dusk && !this.duskSky && !this.duskLoading) this.loadDusk();
    const useDusk = dusk && this.duskSky;
    const sky = useDusk ? this.duskSky : this.daySky;
    if (this.scene.background !== sky) {
      this.scene.background = sky;
      this.scene.environment = sky;
      const r = useDusk ? this.dusk.rot : this.day.rot;
      this.scene.backgroundRotation.set(0, r, 0);
      this.scene.environmentRotation.set(0, r, 0);
    }
    if (useDusk) {
      const k = (t - 0.6) / 0.4;
      this.scene.backgroundIntensity = L(0.75, 0.45, k);
      this.scene.environmentIntensity = L(0.5, 0.3, k);
    } else {
      this.scene.backgroundIntensity = L(0.9, 0.42, t / 0.6);
      this.scene.environmentIntensity = L(0.42, 0.2, t / 0.6);
    }
    this.onTime?.(t);
  }

  async loadDusk() {
    this.duskLoading = true;
    try {
      const tex = await new HDRLoader().loadAsync('/hdri/' + (tier.name === 'low' ? 'dusk_m.hdr' : 'dusk.hdr'));
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const { az } = this.analyseSky(tex);
      this.dusk = { rot: -(SUN_AZIMUTH - az) };
      this.duskSky = tex;
      this.applyTime(this.tod);
    } catch { /* ingen skymningshimmel: dagshimlen dämpas bara */ }
  }

  setupArena(root) {
    const mats = arenaMaterials();
    this.arenaMats = mats;
    this.banners = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const name = o.material?.name;
      if (o.name.startsWith('banner_')) {
        o.material = bannerMaterial(o.name.includes('_w') ? 'w' : 'b');
        // fanorna på vänster sida ses från baksidan: spegla bilden så att texten läses rätt från brädet
        if (o.name.endsWith('0')) { o.material.map.repeat.x = -1; o.material.map.offset.x = 1; o.material.map.wrapS = THREE.RepeatWrapping; }
        // positionerna är kvantiserade: vågen räknas i nodens skala
        o.material.userData.uniforms.uScale.value = 1 / o.scale.x;
        o.castShadow = true;
        this.banners.push(o);
        return;
      }
      if (mats[name]) o.material = mats[name];
      const isTerrain = name === 'Grass';
      o.castShadow = !isTerrain && name !== 'Ground';
      o.receiveShadow = true;
    });
    this.scene.add(root);
    this.arena = root;
    this.updaters.add((dt, t) => {
      for (const b of this.banners) b.material.userData.uniforms && (b.material.userData.uniforms.uTime.value = t);
    });
  }

  setupPost() {
    const r = this.renderer;
    const w = window.innerWidth, h = window.innerHeight;
    const composer = (this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 }));
    composer.addPass(new RenderPass(this.scene, this.camera));
    const ao = (this.ao = new N8AOPostPass(this.scene, this.camera, w, h));
    ao.configuration.aoRadius = 1.6;
    ao.configuration.distanceFalloff = 1.0;
    ao.configuration.intensity = 2.6;
    ao.configuration.color = new THREE.Color(0x0b0806);
    ao.setQualityMode(tier.ao);
    ao.configuration.halfRes = tier.aoHalf;
    composer.addPass(ao);
    this.dof = new DepthOfFieldEffect(this.camera, { focusDistance: 20, focusRange: 7, bokehScale: 0, resolutionScale: 0.5 });
    this.dof.target = new THREE.Vector3();
    this.dofPass = new EffectPass(this.camera, this.dof);
    composer.addPass(this.dofPass);
    this.bloom = new BloomEffect({ intensity: 0.9, luminanceThreshold: 1.0, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 });
    this.vignette = new VignetteEffect({ offset: 0.28, darkness: 0.55 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const grade = new HueSaturationEffect({ saturation: 0.08 });
    const bc = new BrightnessContrastEffect({ contrast: 0.06 });
    composer.addPass(new EffectPass(this.camera, this.bloom, tone, grade, bc, this.vignette));
    composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset[tier.smaa] })));
    this.dofAmount = 0;
    this.dofGoal = 0;
  }

  setFocus(point, amount = 1) {
    if (point) this.dof.target.copy(point);
    this.dofGoal = amount;
  }

  /** Dynamisk upplösning: sänk pixeltätheten när bildtiden blir lång, höj när det finns marginal. */
  adaptResolution(now) {
    const a = (this.frameStats ||= { t0: now, n: 0, last: now });
    a.n++;
    if (now - a.t0 < 1500) return;
    const ms = (now - a.t0) / a.n;
    a.t0 = now; a.n = 0;
    if (document.hidden) return;
    let d = this.dpr;
    if (ms > 24 && d > tier.dprMin) d = Math.max(tier.dprMin, d - 0.25);
    else if (ms < 13 && d < Math.min(window.devicePixelRatio, tier.dprMax)) d = Math.min(tier.dprMax, d + 0.25);
    if (d !== this.dpr) {
      this.dpr = d;
      this.renderer.setPixelRatio(d);
      this.resize();
    }
  }

  /** Rendera en bild och returnera den som PNG-blob (måste läsas i samma uppgift som renderingen). */
  capture() {
    return new Promise((resolve) => {
      this.composer.render(0);
      this.canvas.toBlob((b) => resolve(b), 'image/png');
    });
  }

  /** Slowmotion i realtid: factor 0.25 under sec sekunder, sedan mjukt tillbaka. */
  slowmo(factor = 0.25, sec = 0.8) {
    this.slow = factor;
    this.slowUntil = performance.now() + sec * 1000;
  }

  /** Kort träffstopp som ger tyngd åt ett hugg. */
  hitstop(sec = 0.07) {
    if (this.slow < 0.5) return;
    this.slow = 0.03;
    this.slowUntil = performance.now() + sec * 1000;
  }

  addUpdater(fn) { this.updaters.add(fn); return () => this.updaters.delete(fn); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
  }

  start() {
    const loop = () => {
      const now = performance.now();
      if (now > this.slowUntil) this.slow += (1 - this.slow) * 0.12;
      const dt = Math.min(this.clock.getDelta(), 1 / 20) * this.timeScale * this.slow;
      const t = this.clock.elapsedTime;
      for (const fn of this.updaters) fn(dt, t);
      if (this.controls.enabled) this.controls.update();
      // skakning och skärpedjup
      // skak som tillfällig förskjutning. Förra bildens förskjutning tas bara bort om ingen annan har
      // flyttat kameran sedan dess (filmkameran sätter positionen själv varje bild).
      this.shakeOff ||= new THREE.Vector3();
      this.shakeAt ||= new THREE.Vector3(Infinity, 0, 0);
      if (this.camera.position.distanceToSquared(this.shakeAt) < 1e-12) this.camera.position.sub(this.shakeOff);
      this.shakeOff.set(0, 0, 0);
      if (this.shake > 0.001) {
        this.shakeOff.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, 0);
        this.camera.position.add(this.shakeOff);
        this.shake *= Math.pow(0.02, dt);
      }
      this.shakeAt.copy(this.camera.position);
      this.dofAmount += (this.dofGoal - this.dofAmount) * Math.min(1, dt * 3);
      this.dof.bokehScale = this.dofAmount * 3.2;
      this.dofPass.enabled = (tier.dof || this.photoDof) && this.dofAmount > 0.02;
      this.adaptResolution(now);
      this.composer.render(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

/** Fanduk med lagfärg och vapen, som böljar i vinden i vertexshadern. */
function bannerMaterial(side) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  const base = side === 'w' ? '#1d3a8a' : '#7c0f18';
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, base); grad.addColorStop(0.5, side === 'w' ? '#2a4fae' : '#9b1822'); grad.addColorStop(1, base);
  g.fillStyle = grad; g.fillRect(0, 0, 256, 512);
  g.strokeStyle = '#e3b765'; g.lineWidth = 10; g.strokeRect(14, 14, 228, 484);
  g.lineWidth = 3; g.strokeRect(28, 28, 200, 456);
  g.fillStyle = '#f0c46a';
  g.font = '170px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 10;
  g.fillText(side === 'w' ? '♔' : '♚', 128, 220);
  g.font = 'bold 34px Georgia'; g.fillText(side === 'w' ? 'ALBA' : 'NOX', 128, 390);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.flipY = false; // glTF-UV:er har origo uppe till vänster
  const m = new THREE.MeshPhysicalMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.8, sheen: 1, sheenRoughness: 0.5,
    sheenColor: new THREE.Color(side === 'w' ? 0x9fb8ff : 0xff9a8a) });
  const uniforms = { uTime: { value: 0 }, uPhase: { value: side === 'w' ? 0 : 1.7 }, uScale: { value: 1 } };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uPhase;\nuniform float uScale;')
      .replace('#include <beginnormal_vertex>', /* glsl */ `
        float hang = 1.0 - uv.y;                 // 0 vid stången, 1 nertill
        float ph = uv.y * 5.0 - uTime * 2.3 + uPhase + uv.x * 1.3;
        float amp = 0.18 * hang + 0.04;
        float wave = sin(ph) * amp + sin(ph * 2.1 + 1.0) * amp * 0.3;
        float dwave = (cos(ph) * amp * 5.0 + cos(ph * 2.1 + 1.0) * amp * 0.63) ;
        vec3 objectNormal = normalize(vec3(normal.x, normal.y - dwave * 0.3, normal.z));
      `)
      .replace('#include <begin_vertex>', /* glsl */ `
        vec3 transformed = vec3(position);
        transformed.x += wave * uScale;           // duken hänger i YZ-planet (normal längs X)
        transformed.z += sin(ph * 0.7) * 0.05 * hang * uScale;
      `);
  };
  m.customProgramCacheKey = () => 'banner' + side;
  return m;
}
