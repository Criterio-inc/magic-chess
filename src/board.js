// Rutor <-> världskoordinater, markeringar på brädet och klick.
import * as THREE from 'three';

const FILES = 'abcdefgh';

export class Board {
  constructor(world, meta) {
    this.world = world;
    this.S = meta.squareSize;
    this.top = meta.tileTop;
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.top);
    this.marks = new THREE.Group();
    world.scene.add(this.marks);
    this.markPool = [];
    this.time = { value: 0 };
    world.addUpdater((dt, t) => { this.time.value = t; });
    this.hover = this.makeMark('hover');
    this.hover.visible = false;
  }

  /** 'e4' -> Vector3 (rutans mitt på plattornas ovansida). Vit (rad 1) ligger mot +Z. */
  toWorld(sq, out = new THREE.Vector3()) {
    const f = FILES.indexOf(sq[0]);
    const r = parseInt(sq[1], 10) - 1;
    return out.set((f - 3.5) * this.S, this.top, (3.5 - r) * this.S);
  }

  fromWorld(p) {
    const f = Math.floor(p.x / this.S + 4);
    const r = Math.floor(-p.z / this.S + 4);
    if (f < 0 || f > 7 || r < 0 || r > 7) return null;
    return FILES[f] + (r + 1);
  }

  /** Ruta under muspekaren. Brädet först: står det en pjäs på rutan under pekaren vinner den.
   *  Pjäsernas träffcylindrar används bara när pekaren är över en tom ruta (t.ex. på en hög pjäs
   *  huvud) — annars skulle bakre radens höga pjäser skymma bönderna framför. */
  pick(ndc, camera, pieces, occupied = () => false) {
    this.raycaster.setFromCamera(ndc, camera);
    const p = new THREE.Vector3();
    const square = this.raycaster.ray.intersectPlane(this.plane, p) ? this.fromWorld(p) : null;
    if (square && occupied(square)) return { square };
    const hits = this.raycaster.intersectObjects(pieces.filter((x) => x.root.visible).map((x) => x.hit), false);
    if (hits.length) return { square: hits[0].object.userData.piece.square };
    return square ? { square } : null;
  }

  makeMark(kind) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uColor: { value: new THREE.Color() }, uKind: { value: 0 }, uAlpha: { value: 1 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; uniform float uKind; uniform float uAlpha;
        varying vec2 vUv;
        float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
        void main(){
          vec2 p = vUv - 0.5;
          float a = 0.0;
          if (uKind < 0.5) {            // lagligt drag: glödande punkt
            float d = length(p);
            a = smoothstep(0.13, 0.08, d) * 0.9 + smoothstep(0.3, 0.0, d) * 0.25;
            a *= 0.75 + 0.25 * sin(uTime * 3.0);
          } else if (uKind < 1.5) {     // slag: ring runt rutan
            float d = abs(sdBox(p, vec2(0.42), 0.08));
            a = smoothstep(0.035, 0.0, d) + smoothstep(0.12, 0.0, d) * 0.4;
            a *= 0.8 + 0.2 * sin(uTime * 5.0);
          } else if (uKind < 2.5) {     // vald / senaste drag: fylld mjuk ruta
            float d = sdBox(p, vec2(0.46), 0.06);
            a = smoothstep(0.02, -0.04, d) * 0.32 + smoothstep(0.015, 0.0, abs(d)) * 0.6;
          } else {                      // schack: pulserande röd glöd
            float d = length(p);
            a = smoothstep(0.55, 0.0, d) * (0.6 + 0.4 * sin(uTime * 6.0));
          }
          gl_FragColor = vec4(uColor * 2.2, a * uAlpha);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(this.S, this.S), mat);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 1;
    this.marks.add(m);
    return m;
  }

  /** marks: [{square, kind: 'move'|'capture'|'select'|'last'|'check', color}] */
  setMarks(list) {
    const kinds = { move: 0, capture: 1, select: 2, last: 2, check: 3, hover: 2 };
    const colors = { move: 0xffd27a, capture: 0xff6a4a, select: 0xffe2a0, last: 0x9fc4ff, check: 0xff2a1a, hover: 0xffffff };
    while (this.markPool.length < list.length) this.markPool.push(this.makeMark());
    this.markPool.forEach((m, i) => {
      const it = list[i];
      m.visible = !!it;
      if (!it) return;
      this.toWorld(it.square, m.position);
      m.position.y += 0.012 + i * 0.0005;
      m.material.uniforms.uKind.value = kinds[it.kind];
      m.material.uniforms.uColor.value.set(it.color ?? colors[it.kind]);
      m.material.uniforms.uAlpha.value = it.kind === 'last' ? 0.45 : 1;
    });
  }

  /** Glödande pil över brädet (tipset): tonar in, pulserar och tonar ut efter `sec` sekunder. */
  showArrow(from, to, { color = 0xffc861, sec = 4.5 } = {}) {
    this.arrow?.userData.kill();
    const a = this.toWorld(from), b = this.toWorld(to);
    const len = a.distanceTo(b);
    const w = 0.22 * this.S, head = 0.42 * this.S, hw = 0.38 * this.S;
    const s = new THREE.Shape();
    const L = len - head;
    s.moveTo(-w / 2, 0.2 * this.S); s.lineTo(w / 2, 0.2 * this.S); s.lineTo(w / 2, L); s.lineTo(hw, L);
    s.lineTo(0, len); s.lineTo(-hw, L); s.lineTo(-w / 2, L); s.closePath();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s), mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(b.x - a.x, -(b.z - a.z));
    m.position.copy(a).setY(this.top + 0.03);
    m.renderOrder = 2;
    this.world.scene.add(m);
    this.arrow = m;
    let t = 0;
    const off = this.world.addUpdater((dt) => {
      t += dt;
      const fade = Math.min(1, t / 0.3, Math.max(0, (sec - t) / 0.6));
      mat.opacity = fade * (0.8 + 0.2 * Math.sin(t * 5));
      if (t >= sec) m.userData.kill();
    });
    m.userData.kill = () => { off(); m.removeFromParent(); m.geometry.dispose(); mat.dispose(); if (this.arrow === m) this.arrow = null; };
  }

  setHover(square) {
    this.hover.visible = !!square;
    if (!square) return;
    this.toWorld(square, this.hover.position);
    this.hover.position.y += 0.011;
    this.hover.material.uniforms.uKind.value = 2;
    this.hover.material.uniforms.uColor.value.set(0xffffff);
    this.hover.material.uniforms.uAlpha.value = 0.22;
  }
}
