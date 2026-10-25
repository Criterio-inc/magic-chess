// Fältslagen: historiska slag som parti vid kartbordet (korten i src/faltslag/). Kopplas in i Game (game.js).
// Ett fältslag är ett vanligt parti mot Stockfish (mode white/black) med settings.slag satt: uppställningen, styrkan,
// fältherrarnas namn, fanorna, mantlarna, kartan och vädret kommer från kortet.
import { Chess } from 'chess.js';
import { slagById } from './faltslag/slag.js';
import { applyBattle } from './faltslag/scen.js';

export const BattleMethods = {
  /** Slagkortet för det pågående partiet, eller null (även online och i legenderna). */
  battleCard() {
    const s = this.settings;
    return s.slag && (s.mode === 'white' || s.mode === 'black') ? slagById(s.slag) : null;
  },

  /** Ny ställning från partiets början: slagets uppställning, annars den vanliga. */
  freshChess() {
    const fen = this.battleCard()?.fen;
    return fen ? new Chess(fen) : new Chess();
  },

  /** Vit/Svart, eller fältherrens namn i ett fältslag. */
  sideName(color) {
    const card = this.battleCard();
    if (card) return card[color === 'w' ? 'white' : 'black'].commander;
    return color === 'w' ? 'Vit' : 'Svart';
  },

  /** Klä rummet för slaget, eller av det inför ett vanligt parti. */
  dressRoom() {
    applyBattle(this.world, this.lib, this.battleCard());
  },

  /** Titelkortets innehåll (samma kort som legenderna). */
  battleTitle(card) {
    return {
      title: card.name,
      where: [card.place.region, card.year].filter(Boolean).join(', '),
      white: card.white.commander,
      black: card.black.commander,
      note: card.note,
    };
  },

  /** Härolden läser slagets egen replik om den finns (Saeculas egna kort har ingen), annars den vanliga. */
  battleHerald(card, suffix = '') {
    const key = `slag_${card.id}${suffix}`;
    return this.voice?.manifest?.herald?.[key] ? key : null;
  },

  /** Slutrutans text och häroldens efterord. winner: 'w', 'b' eller null vid remi. */
  battleOutro(card, winner) {
    const mine = card.player;
    const line = winner && this.battleHerald(card, winner === mine ? '_seger' : '_forlust');
    if (line) setTimeout(() => this.voice?.herald(line), 2600);
    return `${card.name}, ${card.year}. ${card.history}`.trim();
  },
};
