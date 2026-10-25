# Battlechess online — protokoll (kontrakt mellan server och klient)

WebSocket på `/ws` (dev: Vite proxar `/ws` → `ws://localhost:8241`). Alla meddelanden är JSON med fältet `t`.
Servern är auktoritativ: den äger partiet (chess.js) och godkänner varje drag.

## Begrepp
- **code**: inbjudningskod, 6 tecken ur `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (inga förväxlingsbara tecken), t.ex. `K7QX2M`.
  Skiftlägesokänslig vid join. Länk: `https://<värd>/?join=K7QX2M`.
- **token**: hemlig sträng per spelare och rum (crypto.randomUUID). Klienten sparar `{code, token}` i localStorage
  och använder den för att återansluta.
- **color**: `'w'` eller `'b'`.

## Klient → server
| t | fält | betydelse |
|---|---|---|
| `create` | `color`: `'w'\|'b'\|'random'`, `name?` (≤24 tecken) | skapa rum |
| `join` | `code`, `name?` | gå med i rum (andra platsen) |
| `rejoin` | `code`, `token` | återanslut efter tappad förbindelse/omladdning |
| `move` | `from`, `to`, `promotion?`, `ply` | drag; `ply` = antal halvdrag före draget (skydd mot dubbletter) |
| `resign` | – | ge upp |
| `draw-offer` | – | erbjud remi |
| `draw-answer` | `accept`: bool | svara på remierbjudande |
| `rematch` | – | vill spela igen (båda måste skicka; färgerna byts) |
| `leave` | – | lämna rummet för gott |
| `ping` | – | håll vid liv (klienten skickar var 20:e s) |

## Server → klient
| t | fält | betydelse |
|---|---|---|
| `created` | `code`, `token`, `color` | rummet finns; väntar på motståndare |
| `joined` | `code`, `token`, `color`, `state` | du är med (även svar på `rejoin`) |
| `opponent` | `status`: `'joined'\|'left'\|'disconnected'\|'reconnected'`, `name?` | motståndarens närvaro |
| `start` | `state` | båda är på plats, partiet börjar (även efter rematch) |
| `move` | `from`, `to`, `promotion?`, `san`, `ply`, `fen`, `by` | godkänt drag (skickas till BÅDA, även avsändaren) |
| `reject` | `reason`, `state` | draget godkändes inte; klienten synkar till `state` |
| `draw-offer` | `by` | motståndaren erbjuder remi |
| `draw-declined` | – | |
| `over` | `result`: `'1-0'\|'0-1'\|'1/2-1/2'`, `reason`: `'checkmate'\|'stalemate'\|'repetition'\|'insufficient'\|'fifty'\|'resign'\|'draw-agreed'\|'abandoned'` | partiet är slut |
| `rematch` | `by` | motståndaren vill spela igen |
| `error` | `code`: `'no-such-room'\|'room-full'\|'bad-token'\|'bad-request'\|'rate-limited'`, `message` | |
| `pong` | – | |

`state` = `{ fen, moves: [{from,to,promotion?,san}], white: {name, online}, black: {name, online}, turn, over: null | {result, reason}, ply }`.

## Regler på servern
- Ett rum har två platser. Den som skapar får vald/slumpad färg; den som går med får den andra.
- Drag godkänns bara om rummet har två spelare, partiet pågår, det är avsändarens tur, `ply` stämmer och chess.js godkänner.
- Slutet avgörs på servern efter varje drag (matt, patt, trefaldig upprepning, otillräckligt material, 50-dragsregeln).
- Bortkoppling: motståndaren får `opponent/disconnected`. Återansluter man inom 10 min fortsätter partiet.
  Efter 10 min utan återanslutning: `over` med `abandoned` (den som är kvar vinner).
- Rum städas 24 h efter senaste aktivitet. Rum sparas i minnet (och skrivs till `server/data/rooms.json` var 30:e s
  och vid avstängning, så att en omstart inte tappar pågående partier).
- Hastighetsbegränsning: max 20 meddelanden/s per anslutning, max 10 rum skapade per IP och minut.
- Inga konton. Namn är frivilliga och visas bara för motståndaren.
