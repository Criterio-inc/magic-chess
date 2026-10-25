// Kontrollerar att de berömda partierna i src/legends.js är lagliga och slutar som de ska.
import { Chess } from 'chess.js';
import { LEGENDS, legendMoves } from '../src/legends.js';

let bad = 0;
for (const l of LEGENDS) {
  const c = new Chess();
  const mv = legendMoves(l);
  try {
    for (const m of mv) c.move(m);
  } catch (e) {
    bad++;
    console.log('FEL', l.id, 'vid drag', c.history().length + 1, e.message);
    continue;
  }
  const mate = mv[mv.length - 1].endsWith('#');
  const ok = !mate || c.isCheckmate();
  if (!ok) bad++;
  console.log(ok ? 'ok ' : 'FEL', l.id, `${mv.length} halvdrag`, mate ? (c.isCheckmate() ? 'matt' : 'INTE matt') : '');
}
process.exit(bad ? 1 : 0);
