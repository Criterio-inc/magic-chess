// Veteraner: en pjäs som har slagit två motståndare bär en lagerkrans av guld som svävar över huvudet;
// efter tre slag glöder kransen och kastar av sig gnistor då och då.
import * as THREE from 'three';

let gold, glow, leafGeo, ringGeo;

function materials() {
  gold ||= new THREE.MeshStandardMaterial({ color: 0xd8a944, metalness: 1, roughness: 0.28, emissive: 0x2a1800 });
  glow ||= new THREE.MeshStandardMaterial({ color: 0xffd36a, metalness: 1, roughness: 0.22, emissive: 0xb07a18, emissiveIntensity: 1.6 });
  leafGeo ||= new THREE.SphereGeometry(1, 8, 6).scale(0.5, 0.16, 1);
  ringGeo ||= new THREE.TorusGeometry(1, 0.085, 8, 48);
}

/** Lagerkrans med radien r: en tunn ring och två grenar av blad som möts framtill. */
function wreath(r, mat) {
  materials();
  const outer = new THREE.Group();
  const g = new THREE.Group(); // inre grupp som snurrar sakta
  outer.add(g);
  const ring = new THREE.Mesh(ringGeo, mat);
  ring.scale.setScalar(r);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const n = 9;
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const a = side * (0.18 + (i / (n - 1)) * 2.55) + Math.PI; // från baksidan och runt mot fronten
      for (const out of [-1, 1]) {
        const leaf = new THREE.Mesh(leafGeo, mat);
        leaf.scale.setScalar(r * 0.34 * (1 - i * 0.035));
        leaf.position.set(Math.sin(a) * r * (1 + out * 0.12), out * r * 0.06, Math.cos(a) * r * (1 + out * 0.12));
        // bladen pekar längs ringen, lite utåt/inåt i par
        leaf.rotation.set(out * 0.5, a + side * Math.PI / 2 + out * 0.35, 0);
        g.add(leaf);
      }
    }
  }
  return outer;
}

/** Sätt veteranstatus efter antal slag (0–1 inget, 2 krans, 3+ glödande krans). */
export function setVeteran(piece, kills, { fx, world } = {}) {
  const level = kills >= 3 ? 2 : kills >= 2 ? 1 : 0;
  if ((piece.vetLevel || 0) === level) return;
  piece.vetLevel = level;
  if (piece.wreath) { piece.wreath.removeFromParent(); piece.wreathOff?.(); piece.wreath = null; }
  const head = piece.bones?.head;
  if (!level || !head) return;
  materials();
  // svävar strax ovanför statyns högsta punkt (hjälm, mitra, krona) och följer huvudet
  piece.topY ??= topOf(piece);
  const w = wreath(piece.meta.height * 0.095, level === 2 ? glow : gold);
  piece.root.updateMatrixWorld(true);
  const target = piece.root.localToWorld(new THREE.Vector3(0, piece.topY + 0.12, 0));
  head.add(w);
  w.position.copy(head.worldToLocal(target));
  // ringen ska ligga vågrätt i vila: motverka huvudbenets rotation i vilopose
  const q = new THREE.Quaternion();
  head.getWorldQuaternion(q);
  const rootQ = piece.root.getWorldQuaternion(new THREE.Quaternion());
  w.quaternion.copy(q.invert().multiply(rootQ));
  piece.wreath = w;
  let t = Math.random() * 6, spark = 0;
  piece.wreathOff = world?.addUpdater((dt) => {
    t += dt;
    w.children[0].rotation.y = t * 0.6;
    if (level === 2 && fx && (spark -= dt) <= 0 && piece.root.visible) {
      spark = 0.8 + Math.random() * 1.4;
      fx.sparks(w.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, 1, 0), 0xffd36a, 4);
    }
  });
  if (fx) fx.sparks(target, new THREE.Vector3(0, 1, 0), 0xffd36a, 24);
}

/** Statyns högsta punkt i vila (rotens led), från meshernas begränsningslådor. */
function topOf(piece) {
  let top = piece.meta.height;
  const box = new THREE.Box3();
  piece.model.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    top = Math.max(top, box.max.y - piece.root.position.y);
  });
  return Math.min(top, piece.meta.height * 1.25);
}
