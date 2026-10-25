// Små tidsverktyg: allt drivs av världens uppdateringsloop (inte setTimeout) så att
// animationer, effekter och kamera håller takten även när bildfrekvensen varierar.
const tasks = new Set();

export function tick(dt) {
  for (const t of [...tasks]) t(dt);
}

export const ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

/** tween(sekunder, (k) => {...}, easing) -> Promise */
export function tween(dur, fn, e = ease.inOut) {
  return new Promise((resolve) => {
    let t = 0;
    if (dur <= 0) { fn(1); resolve(); return; }
    const step = (dt) => {
      t = Math.min(dur, t + dt);
      fn(e(t / dur));
      if (t >= dur) { tasks.delete(step); resolve(); }
    };
    tasks.add(step);
    fn(0);
  });
}

export function wait(sec) {
  return tween(sec, () => {}, ease.linear);
}

/** Kortaste vinkeln från a till b */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function lerp(a, b, k) { return a + (b - a) * k; }
export const rand = (a, b) => a + Math.random() * (b - a);
