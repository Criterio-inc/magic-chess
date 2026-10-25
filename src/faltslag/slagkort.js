// Slagkortet: ett historiskt slag som parti vid kartbordet. Formatet är vanlig JSON, så att Saecula kan skriva egna kort
// ur en kampanj (rikena, året, fältherrarna, riksfärgerna och vem som har övertaget) och brädet spela dem. Ingen three här:
// tools/check_slag.mjs läser korten i Node.
//
// {
//   "format": "saecula-slagkort/1",
//   "id": "poltava",                      a–z, 0–9 och bindestreck; härolden har repliker som heter slag_<id>
//   "name": "Slaget vid Poltava",
//   "year": 1709,
//   "place": { "name": "Poltava", "region": "Ukraina", "lon": 34.55, "lat": 49.63 },
//   "white": { "realm": "sweden", "realmName": "Sverige", "commander": "Karl XII", "colors": ["#3c6db8", "#e2b33c"] },
//   "black": { "realm": "muscovy", "realmName": "Ryssland", "commander": "Peter den store", "colors": ["#2f7353", "#a8312a"] },
//   "player": "w",                        sidan människan spelar; Stockfish tar den andra
//   "strength": 1320,                     Stockfish-styrka 1320–3190 (Saecula räknar fram den ur övertaget)
//   "fen": "…",                           valfri uppställning, till exempel en armé utan sina kanoner
//   "weather": "clear",                   clear, fog eller snow (utanför fönstren och i rummet)
//   "note": "…",                          en rad om läget på titelkortet
//   "outcome": "b",                       vem som vann i verkligheten
//   "history": "…",                       hur det gick, i slutrutan
//   "difficulty": "Nästan omöjlig",       i menyn
//   "view": { "u0": 0.23, "v0": 0.05, "s": 0.77 }   valfritt kartutsnitt, annars räknas fälttågskartan fram
// }
//
// realm är Saeculas land-id (data/countries.json). colors[0] är fältet i fanan och manteln, colors[1] bården.
import { validateFen } from 'chess.js';
import { atlasUV, campaignView } from '../kartrum/atlas.js';

export const FORMAT = 'saecula-slagkort/1';
const HEX = /^#[0-9a-f]{6}$/i;
const WEATHER = ['clear', 'fog', 'snow'];

function side(s, which) {
  if (!s || typeof s.commander !== 'string' || !s.commander.trim()) throw new Error(`${which}: fältherre saknas`);
  const colors = Array.isArray(s.colors) ? s.colors : [];
  if (colors.length < 2 || !colors.every((c) => HEX.test(c))) throw new Error(`${which}: colors ska vara två färger som #rrggbb`);
  return { realm: s.realm || null, realmName: s.realmName || s.realm || '', commander: s.commander.trim(), colors: colors.slice(0, 2) };
}

/** Läs och kontrollera ett slagkort. Ger ett komplett kort med kartplats och kartutsnitt, eller kastar ett fel på svenska. */
export function readSlagkort(raw) {
  if (!raw || raw.format !== FORMAT) throw new Error(`okänt format (väntade ${FORMAT})`);
  if (!/^[a-z0-9-]+$/.test(raw.id || '')) throw new Error('id ska vara gemena bokstäver, siffror och bindestreck');
  const p = raw.place || {};
  if (!(Math.abs(p.lon) <= 180 && Math.abs(p.lat) <= 90)) throw new Error(`${raw.id}: platsen saknar lon och lat`);
  const fen = raw.fen || null;
  if (fen) {
    const ok = validateFen(fen);
    if (!ok.ok) throw new Error(`${raw.id}: ogiltig uppställning (${ok.error})`);
  }
  const player = raw.player === 'b' ? 'b' : 'w';
  const site = atlasUV(p.lon, p.lat);
  const view = raw.view || campaignView(...site);
  if (!view) throw new Error(`${raw.id}: platsen går inte att visa bredvid brädet`);
  return {
    id: raw.id,
    name: raw.name || raw.id,
    year: raw.year ?? null,
    place: { name: p.name || raw.name, region: p.region || '', lon: p.lon, lat: p.lat },
    white: side(raw.white, 'white'),
    black: side(raw.black, 'black'),
    player,
    strength: Math.min(3190, Math.max(1320, Math.round(raw.strength || 1320))),
    fen,
    weather: WEATHER.includes(raw.weather) ? raw.weather : 'clear',
    note: raw.note || '',
    outcome: raw.outcome === 'w' || raw.outcome === 'b' ? raw.outcome : null,
    history: raw.history || '',
    difficulty: raw.difficulty || '',
    site,
    view,
  };
}
