// Renderare, efterbehandling och tiden på dygnet. Rummet runt brädet och dess ljus finns i src/kartrum/.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect,
  VignetteEffect, DepthOfFieldEffect, SMAAPreset, BrightnessContrastEffect, HueSaturationEffect,
  SepiaEffect, NoiseEffect, OutlineEffect, BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { setAnisotropy } from './materials.js';
import { tier } from './quality.js';
import { MapRoom } from './kartrum/maproom.js';

export const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

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
    this.fast = 1;      // snabbspolning när spelaren hoppar över en duell
    this.slow = 1;      // filmisk slowmotion/träffstopp (se slowmo, hitstop)
    this.slowUntil = 0;
    this.tmp = new THREE.Vector3();
    window.addEventListener('resize', () => this.resize());
  }

  async load(onProgress) {
    const [gltf, meta] = await Promise.all([
      gltfLoader.loadAsync(`models/arena${tier.lod}.glb`).then((g) => { onProgress?.('arena'); return g; }),
      fetch('models/arena.json').then((r) => r.json()),
    ]);
    this.meta = meta;
    this.room = await MapRoom.create(this, gltf.scene);
    onProgress?.('sky');
    this.arena = this.room.arena;
    this.sunDir = this.room.sunDir;
    this.tod = 0;
    this.todGoal = 0;
    this.fireBoost = 1;
    this.addUpdater((dt, t) => { this.updateTime(dt); this.room.update(dt, t); });
    this.setupPost();
    this.applyTime(0);
    return meta;
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

  /** Kartrummet sköter ljuset; main.js lyssnar via onTime (syrsor, uggla, härolden). */
  applyTime(t) {
    this.room.applyTime(t);
    this.fireBoost = this.room.fireBoost;
    this.onTime?.(t);
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
    this.grade = new HueSaturationEffect({ saturation: 0.08 });
    this.bc = new BrightnessContrastEffect({ contrast: 0.06 });
    // översiktslägets kopparstick (src/kartrum/overview.js): avstängt tills översikten vrider upp det
    this.sepia = new SepiaEffect();
    this.sepia.blendMode.opacity.value = 0; // intensity: 0 i konstruktorn tolkas som full styrka
    this.outline = new OutlineEffect(this.scene, this.camera, {
      blendFunction: BlendFunction.ALPHA, edgeStrength: 0, visibleEdgeColor: 0x2b1a0c, hiddenEdgeColor: 0x2b1a0c, blur: false, xRay: false,
    });
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT });
    this.noise.blendMode.opacity.value = 0;
    composer.addPass(new EffectPass(this.camera, this.bloom, tone, this.grade, this.bc, this.sepia, this.outline, this.noise, this.vignette));
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
      const dt = Math.min(this.clock.getDelta(), 1 / 20) * this.timeScale * (this.fast > 1 ? 1 : this.slow) * this.fast;
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
