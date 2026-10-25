# Battlechess online — protokoll (kontrakt mellan server och klient)

WebSocket på `/ws` (dev: Vite proxar `/ws` → `ws://localhost:8241`). Alla meddelanden är JSON med fältet `t`.
Servern är auktoritativ: den äger partiet (chess.js) och godkänner varje drag.

## Begrepp
- **code**: inbjudningskod, 6 tecken ur `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (inga förväxlingsbara tecken), t.ex. `K7QX2M`.
  Skiftlägesokänslig vid join och watch. Länkar: `https://<värd>/?join=K7QX2M` (spela), `https://<värd>/?watch=K7QX2M` (titta).
- **token**: hemlig sträng per spelare och rum (crypto.randomUUID). Klienten sparar `{code, token}` i localStorage
  och använder den för att återansluta.
- **color**: `'w'` eller `'b'`.
- **åskådare**: en anslutning som tittar på ett rum med `watch`. Ingen plats, ingen token, inga drag; kan bli hur många
  som helst (högst 50 per rum). Åskådare återansluter genom att skicka `watch` igen.
- **taunt-id**: `fart`, `hamster`, `goaway`, `ni`, `really`, `wellplayed`, `expect`, `hurry` (listan står i `rooms.js`;
  texterna och rösterna finns i klienten, `src/online-extras.js` och `voice.taunter` i ljudmanifestet).

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
| `rematch` | – | vill spela igen när partiet är slut (båda måste skicka; färgerna byts; samma rum och tokens) |
| `watch` | `code` | titta på rummet som åskådare (svar: `watching`); skickas igen för att synka |
| `taunt` | `id` | glåpord ur listan ovan (bara spelare; högst 2 i rad, sedan 1 per 4 s) |
| `leave` | – | lämna rummet för gott (åskådare: sluta titta) |
| `ping` | – | håll vid liv (klienten skickar var 20:e s) |

## Server → klient
| t | fält | betydelse |
|---|---|---|
| `created` | `code`, `token`, `color` | rummet finns; väntar på motståndare |
| `joined` | `code`, `token`, `color`, `state` | du är med (även svar på `rejoin`) |
| `opponent` | `status`: `'joined'\|'left'\|'disconnected'\|'reconnected'`, `name?` | motståndarens närvaro |
| `start` | `state`, `color?` | båda är på plats, partiet börjar (även efter rematch). Spelare får sin färg i `color` (den byts vid rematch); åskådare får ingen `color` |
| `move` | `from`, `to`, `promotion?`, `san`, `ply`, `fen`, `by` | godkänt drag (skickas till BÅDA, även avsändaren, och till åskådarna) |
| `reject` | `reason`, `state` | draget godkändes inte; klienten synkar till `state`. `reason`: `'not-started'\|'over'\|'ply'\|'not-your-turn'\|'illegal'\|'spectator'` |
| `draw-offer` | `by` | motståndaren erbjuder remi |
| `draw-declined` | – | |
| `over` | `result`: `'1-0'\|'0-1'\|'1/2-1/2'`, `reason`: `'checkmate'\|'stalemate'\|'repetition'\|'insufficient'\|'fifty'\|'resign'\|'draw-agreed'\|'abandoned'` | partiet är slut (även till åskådarna) |
| `rematch` | `by` | `by` vill spela igen (till motståndaren och åskådarna; skickas igen vid `rejoin`/`watch` om det väntar) |
| `watching` | `code`, `state` | du tittar som åskådare; därefter kommer `start`, `move`, `over`, `rematch`, `taunt` och `watchers` |
| `watchers` | `n` | antalet åskådare har ändrats (till spelarna och åskådarna) |
| `taunt` | `id`, `by` | glåpord från spelaren `by` (till alla i rummet, även avsändaren) |
| `error` | `code`: `'no-such-room'\|'room-full'\|'bad-token'\|'bad-request'\|'rate-limited'\|'spectator'`, `message` | `spectator` = åskådare försökte göra något som bara spelare får; `no-such-room` till åskådare = rummet har stängts |
| `pong` | – | |

`state` = `{ fen, moves: [{from,to,promotion?,san}], white: {name, online}, black: {name, online}, turn, over: null | {result, reason}, ply, watchers }`.

## Regler på servern
- Ett rum har två platser. Den som skapar får vald/slumpad färg; den som går med får den andra.
- Drag godkänns bara om rummet har två spelare, partiet pågår, det är avsändarens tur, `ply` stämmer och chess.js godkänner.
  Ett drag från en åskådare får `reject` med `spectator`; övriga spelarmeddelanden (`resign`, `draw-*`, `rematch`, `taunt`)
  från en åskådare ger `error` `spectator`.
- Rematch: bara när partiet är slut och motståndaren inte har lämnat. Den första får `rematch` hos de andra; när båda har
  bett byter platserna färg (tokens följer med) och alla får `start`. Ett nytt `over` eller `leave` nollar önskemålen.
- Åskådare: `watch` ger `watching` med aktuell ställning och därefter samma `start`/`move`/`over`/`rematch`/`taunt` som spelarna.
  Den som tar en plats (`create`/`join`/`rejoin`), tittar på ett annat rum, skickar `leave` eller tappar anslutningen räknas bort.
  När rummet försvinner (båda har lämnat eller städats) får åskådarna `error` `no-such-room`.
- Glåpord: id:t måste finnas i listan (annars `bad-request`). Varje plats har en hink med 2 polletter som fylls på med en
  per 4 s (`TAUNT_MS`); tom hink ger `error` `rate-limited` till avsändaren och inget relä.
- Slutet avgörs på servern efter varje drag (matt, patt, trefaldig upprepning, otillräckligt material, 50-dragsregeln).
- Bortkoppling: motståndaren får `opponent/disconnected`. Återansluter man inom 10 min fortsätter partiet.
  Efter 10 min utan återanslutning: `over` med `abandoned` (den som är kvar vinner).
- Rum städas 24 h efter senaste aktivitet. Rum sparas i minnet (och skrivs till `server/data/rooms.json` var 30:e s
  och vid avstängning, så att en omstart inte tappar pågående partier).
- Hastighetsbegränsning: max 20 meddelanden/s per anslutning, max 10 rum skapade per IP och minut.
- Inga konton. Namn är frivilliga och visas för motståndaren och åskådarna.
