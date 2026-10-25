# Saecula: Kartbordet

Schack där varje slag blir en duell. Brädet står på kartbordet i Saeculas kartrum, med Europa utbrett runt
pjäserna, spröjsade fönster, bokhyllor och en glob. Pjäserna är levande marmorstatyer som slåss när de tar
varandra. Partiet börjar en eftermiddag och glider mot kväll: solen sjunker genom fönstren, månen tar över och
kandelabrarna tänds en i taget. Med översiktsläget (M) ser man kartbordet uppifrån som ett kopparstick.

Under dueller kan det hända saker. En karolin vägrar falla utan tillstånd och anmäler varje hugg till
krigskollegium. En älg kliver in från kartan. Biskopen kastar en bannbulla, en trumpojke marscherar efter
springaren, och ibland tröttnar fältherren och slår ned med handen. Rösterna är svenska.

## Fältslagen

Läget Fältslag spelar slag ur Saeculas epok mot Stockfish: Narva 1700, Breitenfeld 1631, Lützen 1632 och Poltava 1709.
Kungarna heter som fältherrarna, mantlar och fanor bär riksfärgerna, och kartan visar fälttåget med en nål på slagplatsen.
Uppställningen följer historien: vid Narva saknar ryssarna dam eftersom tsaren lämnade lägret dagen före, och vid Poltava
saknar svenskarna torn eftersom kanonerna blev kvar i trossen. Snön yr vid Narva och dimman ligger tät vid Lützen.
Slagen är vanliga JSON-kort (`src/faltslag/slag.json`) som Saecula kan skriva egna av.

## Bygger på Marble & Mayhem

Spelet är en vidareutveckling av Anders Bjarbys [Marble & Mayhem](https://github.com/fltman/marble-mayhem),
och det mesta av maskineriet är hans: Stockfish i en Web Worker, Blender-kedjan som bygger alla figurer i kod,
filmkameran, onlinespelet, röktestet och den genomtänkta strukturen. Kartrummet, de nya figurerna, rösterna,
humorn, fältslagen och översättningen är egna. Originalets lån ur Monty Python, Mortal Kombat och andra spel är borttagna.

## Kör

```bash
npm install
npm run dev            # http://localhost:8240
npm run server         # onlinespelet (WebSocket :8241)
npm run smoke          # spelar igenom varje händelse i riktig Chrome
npm run release        # notariserad Mac-app som dmg på Skrivbordet
node tools/shots.mjs   # bilder av dag, skymning, kväll och översikt till docs/stil/spel/
```

Figurerna byggs i Blender 5.2 (`blender/`), rösterna och effekterna med ElevenLabs (`tools/gen_audio.mjs`).
Se `CLAUDE.md` för hela tillgångskedjan.

## Krediter och licenser

- Grunden: Marble & Mayhem av Anders Bjarby.
- Stockfish.js (`public/engine/`), GPL-3.0, licenstexten i `public/engine/Copying.txt`.
- Kartan ur Saecula, byggd på Natural Earth (allmän egendom) och höjddata från Terrain Tiles (Mapzen/AWS).
- Svenska röster, ljudeffekter och titelmusik: ElevenLabs.
- Typsnitten Cinzel och EB Garamond: SIL Open Font License.
- three.js, postprocessing, n8ao och chess.js: MIT och BSD.
