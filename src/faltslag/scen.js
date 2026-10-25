// Klä kartrummet för ett fältslag: fälttågskartan med slagnålen, rikenas fanor på väggen, mantlarna i riksfärgerna och
// slagets väder. Utan kort klär det av rummet igen (vanligt parti).
import * as THREE from 'three';
import { FULL_VIEW, sheetPos } from '../kartrum/atlas.js';
import { bannerTexture, pennantTexture } from '../kartrum/textures.js';

const MAKE = { banner: bannerTexture, pennant: pennantTexture };
const cache = new Map();
/** Fanduken målas en gång per rike och form. */
function flag(kind, [field, border]) {
  const key = `${kind}${field}${border}`;
  if (!cache.has(key)) cache.set(key, MAKE[kind]({ field, border }));
  return cache.get(key);
}

const _hsl = {};
/** Manteln något mörkare än riksfärgen (tyget skimrar), skimret ljusare. */
function capeColors([field], cloth) {
  const c = new THREE.Color(field);
  c.getHSL(_hsl);
  cloth.color.setHSL(_hsl.h, Math.min(1, _hsl.s * 1.1), _hsl.l * 0.62);
  cloth.sheenColor.setHSL(_hsl.h, _hsl.s, Math.min(0.85, _hsl.l * 1.6));
}

export function applyBattle(world, lib, card) {
  const mr = world.room, r = mr.room;
  const sides = card ? [card.white, card.black] : null;
  // första gången: kom ihåg vardagens fanor och mantlar
  const home = (applyBattle.home ||= {
    banners: r.banners.map((m) => m.map),
    capes: ['w', 'b'].map((c) => lib.mats[c].Cloth && [lib.mats[c].Cloth.color.clone(), lib.mats[c].Cloth.sheenColor.clone()]),
  });

  r.setMapView(card ? card.view : FULL_VIEW);
  const pin = r.battlePin;
  pin.group.visible = !!card;
  if (card) {
    const [x, z] = sheetPos(card.view, ...card.site);
    pin.group.position.set(x, 0, z);
    pin.flags.forEach((m, i) => { m.map = flag('pennant', sides[i].colors); m.needsUpdate = true; });
  }
  r.banners.forEach((m, i) => { m.map = sides ? flag('banner', sides[i].colors) : home.banners[i]; m.needsUpdate = true; });
  ['w', 'b'].forEach((c, i) => {
    const cloth = lib.mats[c].Cloth;
    if (!cloth) return;
    if (sides) capeColors(sides[i].colors, cloth);
    else { cloth.color.copy(home.capes[i][0]); cloth.sheenColor.copy(home.capes[i][1]); }
  });
  mr.setWeather(card?.weather || 'clear');
}
