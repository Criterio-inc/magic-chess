// Berömda partier som spelas upp som film, med strider och härold. Dragen är kontrollerade mot chess.js
// (tools/check_legends.mjs): alla är lagliga och de som slutar med matt slutar med matt.
export const LEGENDS = [
  {
    id: 'legal',
    title: "Légal's Mate",
    where: 'Café de la Régence, Paris, 1750',
    white: 'Kermeur Sire de Légal',
    black: 'Saint Brie',
    moves: 'e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5 Bxd1 Bxf7+ Ke7 Nd5#',
  },
  {
    id: 'immortal',
    title: 'The Immortal Game',
    where: 'London, 1851',
    white: 'Adolf Anderssen',
    black: 'Lionel Kieseritzky',
    moves: 'e4 e5 f4 exf4 Bc4 Qh4+ Kf1 b5 Bxb5 Nf6 Nf3 Qh6 d3 Nh5 Nh4 Qg5 Nf5 c6 g4 Nf6 Rg1 cxb5 h4 Qg6 h5 Qg5 Qf3 Ng8 '
      + 'Bxf4 Qf6 Nc3 Bc5 Nd5 Qxb2 Bd6 Bxg1 e5 Qxa1+ Ke2 Na6 Nxg7+ Kd8 Qf6+ Nxf6 Be7#',
  },
  {
    id: 'evergreen',
    title: 'The Evergreen Game',
    where: 'Berlin, 1852',
    white: 'Adolf Anderssen',
    black: 'Jean Dufresne',
    moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O d3 Qb3 Qf6 e5 Qg6 Re1 Nge7 Ba3 b5 Qxb5 Rb8 Qa4 Bb6 '
      + 'Nbd2 Bb7 Ne4 Qf5 Bxd3 Qh5 Nf6+ gxf6 exf6 Rg8 Rad1 Qxf3 Rxe7+ Nxe7 Qxd7+ Kxd7 Bf5+ Ke8 Bd7+ Kf8 Bxe7#',
  },
  {
    id: 'opera',
    title: 'The Opera Game',
    where: 'Paris Opera, 1858',
    white: 'Paul Morphy',
    black: 'Duke of Brunswick & Count Isouard',
    moves: 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 '
      + 'Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#',
  },
];

export const legendById = (id) => LEGENDS.find((l) => l.id === id) || LEGENDS[0];
export const legendMoves = (l) => l.moves.split(/\s+/).filter(Boolean);
