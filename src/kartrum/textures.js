// Kodgjorda texturer för kartrummet: trä med plankor och ådring, puts, fanduk och matta. Ritas en gång på canvas.
// Bruset är periodiskt i x (och y för putsen) så att texturerna kan upprepas utan synliga skarvar.
import * as THREE from 'three';

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function hasher(seed) {
  return (ix, iy) => {
    let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
}

/** Värdebrus på ett gitter; px/py > 0 gör det periodiskt med så många celler. */
function valueNoise(seed, px = 0, py = 0) {
  const hash = hasher(seed);
  const wx = (i) => (px ? ((i % px) + px) % px : i);
  const wy = (i) => (py ? ((i % py) + py) % py : i);
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(wx(ix), wy(iy)), b = hash(wx(ix + 1), wy(iy));
    const c = hash(wx(ix), wy(iy + 1)), d = hash(wx(ix + 1), wy(iy + 1));
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function texture(c, repeat = [1, 1]) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

/** Plankor som löper längs u. dark/light är ådringens två toner; joints ger skarvar i varje planka (golv). */
export function woodTexture({ dark, light, planks = 8, joints = 0, seed = 1, size = 1024, repeat } = {}) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const wobble = valueNoise(seed, 4), fiber = valueNoise(seed + 7, 64), blotch = valueNoise(seed + 13, 8);
  const hash = hasher(seed + 3);
  const D = rgb(dark), L = rgb(light);
  const ph = size / planks, period = joints ? size / joints : 0;
  for (let y = 0; y < size; y++) {
    const p = Math.floor(y / ph), yp = (y % ph) / ph;
    const tint = 0.84 + hash(p, 0) * 0.28;
    const off = Math.floor(hash(p, 1) * 64), jOff = hash(p, 2) * size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const ring = 0.5 + 0.5 * Math.sin((yp * 7 + wobble(u * 4 + off, y * 0.025) * 7) * Math.PI);
      const k = Math.pow(ring, 1.8) * 0.72 + fiber(u * 64 + off, y * 0.7) * 0.28;
      let s = tint * (0.93 + 0.12 * blotch(u * 8 + p * 3, y * 0.008));
      if (yp < 0.01 || yp > 0.99) s *= 0.42; // fog mellan plankorna
      if (period && (x + jOff) % period < 2) s *= 0.5;
      const i = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) img.data[i + ch] = Math.min(255, (D[ch] + (L[ch] - D[ch]) * k) * s);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return texture(c, repeat);
}

/** Kalkputs: en grundton med mjuk fläckighet. Upprepas utan skarv åt båda håll. */
export function plasterTexture({ color, seed = 5, size = 512 } = {}) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const big = valueNoise(seed, 6, 6), small = valueNoise(seed + 11, 48, 48);
  const C = rgb(color);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const s = 0.93 + 0.07 * big(u * 6, v * 6) + 0.035 * small(u * 48, v * 48);
      const i = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) img.data[i + ch] = Math.min(255, C[ch] * s);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return texture(c);
}

function crown(g, cx, cy, s) {
  g.beginPath();
  g.moveTo(cx - 60 * s, cy + 30 * s);
  g.lineTo(cx - 66 * s, cy - 30 * s);
  g.lineTo(cx - 33 * s, cy);
  g.lineTo(cx, cy - 46 * s);
  g.lineTo(cx + 33 * s, cy);
  g.lineTo(cx + 66 * s, cy - 30 * s);
  g.lineTo(cx + 60 * s, cy + 30 * s);
  g.closePath();
  g.fill();
  g.fillRect(cx - 62 * s, cy + 36 * s, 124 * s, 14 * s);
  for (const [x, y] of [[-66, -30], [0, -46], [66, -30]]) {
    g.beginPath();
    g.arc(cx + x * s, cy + (y - 9) * s, 8 * s, 0, Math.PI * 2);
    g.fill();
  }
}

/** Fanduk i husets färger: fält, dubbel bård och en krona. Nedre kanten klipps som en svalstjärt. */
export function bannerTexture({ field, border }) {
  const c = canvas(256, 512);
  const g = c.getContext('2d');
  g.fillStyle = field;
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(256, 0); g.lineTo(256, 512); g.lineTo(128, 430); g.lineTo(0, 512);
  g.closePath();
  g.fill();
  g.strokeStyle = border;
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(16, 16); g.lineTo(240, 16); g.lineTo(240, 478); g.lineTo(128, 410); g.lineTo(16, 478);
  g.closePath();
  g.stroke();
  g.fillStyle = border;
  crown(g, 128, 190, 1.05);
  for (const [x, y] of [[78, 300], [178, 300], [128, 336]]) {
    g.beginPath();
    g.arc(x, y, 9, 0, Math.PI * 2);
    g.fill();
  }
  const t = texture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Knuten matta: bård, fält, medaljong och hörnstycken, med ullens korn ovanpå. */
export function rugTexture({ field, border, gold, seed = 21 } = {}) {
  const W = 1024, H = 744;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = border;
  g.fillRect(0, 0, W, H);
  g.fillStyle = field;
  g.fillRect(74, 74, W - 148, H - 148);
  g.strokeStyle = gold;
  g.lineWidth = 5;
  g.strokeRect(30, 30, W - 60, H - 60);
  g.strokeRect(80, 80, W - 160, H - 160);
  // små ruter längs bården
  g.fillStyle = gold;
  const diamond = (x, y, r) => { g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill(); };
  for (let x = 70; x < W - 40; x += 46) { diamond(x, 52, 10); diamond(x, H - 52, 10); }
  for (let y = 98; y < H - 60; y += 46) { diamond(52, y, 10); diamond(W - 52, y, 10); }
  // medaljong och hörn
  g.fillStyle = border;
  diamond(W / 2, H / 2, 190);
  g.fillStyle = gold;
  diamond(W / 2, H / 2, 150);
  g.fillStyle = field;
  diamond(W / 2, H / 2, 128);
  g.fillStyle = gold;
  diamond(W / 2, H / 2, 40);
  for (const [x, y] of [[80, 80], [W - 80, 80], [80, H - 80], [W - 80, H - 80]]) diamond(x, y, 90);
  // ullens korn
  const img = g.getImageData(0, 0, W, H);
  const rnd = mulberry32(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const s = 0.86 + rnd() * 0.22;
    for (let ch = 0; ch < 3; ch++) img.data[i + ch] = Math.min(255, img.data[i + ch] * s);
  }
  g.putImageData(img, 0, 0);
  const t = texture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Himmel utanför fönstren: blå höjd, ljus horisont och en rad blånande kullar. Färgen multipliceras efter tiden. */
export function skyTexture() {
  const W = 512, H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#8fb0cc');
  sky.addColorStop(0.62, '#e9e4d4');
  sky.addColorStop(1, '#f2ead6');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  const hills = (base, amp, col, seed) => {
    const n = valueNoise(seed, 6);
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) g.lineTo(x, base - n((x / W) * 6, 0.5) * amp);
    g.lineTo(W, H);
    g.closePath();
    g.fill();
  };
  hills(H * 0.74, 60, '#9aa79a', 31);
  hills(H * 0.84, 46, '#6f7f68', 37);
  const t = texture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
