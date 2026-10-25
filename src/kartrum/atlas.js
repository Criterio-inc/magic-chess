// Kartbladet på bordet är Saeculas atlaskarta (public/kartrum/karta.jpg, nedskalad ur ~/Projects/saecula/public/map2/base.jpg).
// Här finns projektionen från längd och bredd till bilden, och var på bordet en plats hamnar. Ingen three: röktestets
// och slagkortens kontroller (tools/check_slag.mjs) läser samma uträkning i Node.

// Saeculas Albers-projektion (src/sim/albers.ts) och atlasens rutnät (public/map2/atlas-meta.json)
const R = 6371.0088, RAD = Math.PI / 180;
const ALBERS = { standard: [32, 60], center: [20, 46] };
const GRID = { x0: -3920, y0: -2990, cell: 2.00927734375, width: 4096, height: 3096 };

const n = (Math.sin(ALBERS.standard[0] * RAD) + Math.sin(ALBERS.standard[1] * RAD)) / 2;
const c = Math.cos(ALBERS.standard[0] * RAD) ** 2 + 2 * n * Math.sin(ALBERS.standard[0] * RAD);
const rho0 = (R * Math.sqrt(c - 2 * n * Math.sin(ALBERS.center[1] * RAD))) / n;

/** Längd och bredd (grader) till plats i kartbilden: u österut, v nedåt, båda 0–1. */
export function atlasUV(lon, lat) {
  const rho = (R * Math.sqrt(c - 2 * n * Math.sin(lat * RAD))) / n;
  const th = n * (lon - ALBERS.center[0]) * RAD;
  const x = rho * Math.sin(th), y = -(rho0 - rho * Math.cos(th));
  return [(x - GRID.x0) / (GRID.cell * GRID.width), (y - GRID.y0) / (GRID.cell * GRID.height)];
}

// Bladets storlek i spelenheter och bordets förskjutning: brädet står på kartans östra del.
export const MAP_W = 48, MAP_H = MAP_W * GRID.height / GRID.width;
export const TABLE_X = -11;
const BOARD_HALF = 9.65;   // brädets låda, sett i bordets koordinater kring x = -TABLE_X
const CURL = MAP_W / 2 - 3.5; // där kortändarna börjar böja sig uppåt

/** Hela kartan, som när inget fältslag pågår. */
export const FULL_VIEW = { u0: 0, v0: 0, s: 1 };

/** Plats i kartbilden till bordets koordinater (x, z) när bladet visar utsnittet view. */
export function sheetPos(view, u, v) {
  return [((u - view.u0) / view.s - 0.5) * MAP_W, ((v - view.v0) / view.s - 0.5) * MAP_H];
}

/** Syns en nål på (x, z)? Inte under brädet och inte på de uppböjda kortändarna. */
export function pinVisible(x, z, margin = 1.2) {
  if (Math.abs(x) > CURL || Math.abs(z) > MAP_H / 2 - 1) return false;
  return !(Math.abs(x + TABLE_X) < BOARD_HALF + margin && Math.abs(z) < BOARD_HALF + margin);
}

// Där slagnålen helst står, som andel av bladet: strax väster om brädet, ungefär i höjd med dess mitt.
const GOOD_U = [0.40, 0.48], GOOD_V = [0.30, 0.62], IDEAL = [0.46, 0.45];

function fit(p, s, [lo, hi], ideal) {
  const a = Math.max(0, p - hi * s), b = Math.min(1 - s, p - lo * s);
  if (a > b + 1e-9) return null;
  return Math.min(b, Math.max(a, p - ideal * s));
}

/**
 * Fälttågskartan: det största utsnittet (s = andel av bildens bredd) där slagplatsen hamnar bredvid brädet.
 * Ett slag mitt i Europa får hela kartan; Poltava och Narva ligger annars under brädet och får en inzoomad karta.
 */
export function campaignView(u, v) {
  for (let i = 100; i >= 50; i--) {
    const s = i / 100;
    const u0 = fit(u, s, GOOD_U, IDEAL[0]), v0 = fit(v, s, GOOD_V, IDEAL[1]);
    if (u0 != null && v0 != null) return { u0, v0, s };
  }
  return null;
}
