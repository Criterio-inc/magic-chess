# Saecula: Kartbordet (fork av Marble & Mayhem, repo: battlechess)

Schack där varje slag är en duell: levande marmorstatyer på kartbordet i Saeculas kartrum, three.js (WebGL) + Stockfish 19.
Grunden är Anders Bjarbys Marble & Mayhem (`upstream` = fltman/marble-mayhem); eget arbete på grenen `saecula`.
Regeln för allt innehåll: inspiration ja, inlånat nej. Inga citat, karaktärer, namn eller inarbetade rop ur film, tv eller spel.
Status och beslut i `docs/SPELBYGGET.md` (gitignorerad, Pärs spelbygget-skill läser den först).

## Kör

```bash
npm install
npm run dev            # http://localhost:8240 (och http://<lan-ip>:8240 för telefonen)
npm run server         # onlineservern (WebSocket :8241, Vite proxar /ws dit)
npm run test:server    # 26 steg mot servern
npm run build          # dist/ (statisk, base './')
npm run smoke          # röktest i riktig Chrome mot ett preview-bygge (se nedan)
npm run check:legends  # legendpartierna är lagliga och slutar i matt
node tools/shots.mjs   # bilder av titel, dag, skymning, kväll och översikt till docs/stil/spel/, med bildfrekvens
```

`?quality=low|high` tvingar kvalitetsnivå (annars: mobil = low). `node tools/online_bot.mjs KOD` är en testmotståndare online.
`tools/deploy.sh` driftsätter Anders original på hans server och ska inte köras härifrån.

Felsökning i konsolen: `window.BC` (world, game, fx, board, lib, engine, voice, overview), `BC_DEBUG = true` loggar drag, motor,
kamerabilder, strider och onlinetrafik. `BC.world.timeScale = 0.2` ger slowmotion (0 fryser). `BC.world.setTimeOfDay(1, true)` hoppar
till kvällen. `BC.game.chor.force = { death: 'freeze', maim: true }` tvingar fram ett utfall;
`BC.game.chor.chooseMove = () => ({ clip: 'attack2', reach: 4.6, fx: 'bull', deaths: ['launch'] })` en attack.
Varje slumphändelse kan tvingas: `BC.game.chor.handChance = 1`, `.elkChance = 1`, `.danceChance = 1`, `.karolinChance = 1`.

## Kartrummet (src/kartrum/)

- `room.js` bygger rummet runt brädet i kod: ekbord med Saeculas karta (`public/kartrum/karta.jpg`, en nedskalad kopia av
  `~/Projects/saecula/public/map2/base.jpg`), vägg med två spröjsade fönster, bokhylla med instansierade böcker, glob, kandelabrar,
  fanor, matta, nålar på riktiga städer och en målad himmel utanför fönstren. Skala K = 30 enheter per meter: en ruta (2) blir knappt
  7 cm. Bordet är förskjutet `tableX = -11` så att brädet står på kartans östra del och Östersjön ligger fri.
- `textures.js` ritar trä, puts, fanduk, matta och himmel på canvas med periodiskt brus (upprepas utan skarv).
- `maproom.js` plockar brädet ur `arena.glb` (rutor, fogar, ram och inlägg; resten släcks) och styr ljuset efter spelets tid
  (`timeForPly`, cirka 90 halvdrag): solen sjunker genom fönstren och går ned vid 0,68, månen tar över, lågorna tänds en i taget från
  0,42, och ett varmt nyckelljus utanför bild framför vit hindrar att pjäserna blir silhuetter. Omgivningsljuset är två PMREM ur en
  förenklad rumsscen (dag och kväll) som byts vid 0,6. Inga HDR-himlar laddas längre.
- `overview.js` är översiktsläget (⌖ eller M): kartbordet uppifrån som kopparstick (sepia, korn, konturer kring pjäserna, lampa
  över bordet). Medan det är på returnerar `Director.homePose` översiktsbilden, så regissörens egna flygningar sköter kameran.
  Kopparsticket tonas bort under dueller.

## Tillgångskedjan

Allt 3D modelleras i Blender med Python (headless, Blender 5.2, `/Applications/Blender.app`, installerad med Homebrew):

```bash
blender -b -P blender/pieces.py -- [--only rook] [--preview DIR]          # de sex pjäserna (cirka 20 s för alla)
blender -b -P blender/extras.py -- [--only elk,hand,drummer] [--preview DIR]
tools/build_assets.sh --skip-blender   # komprimering till public/models (+ *_lo.glb); se skriptet för texturerna
```

- `blender/lib.py`, `rig.py`, `anatomy.py`: Anders primitiver, skelett och metabollkroppar (oförändrade).
- `blender/pieces.py` – de sex statyerna + animationer (idle, walk, attack, attack2, hit, death, victory, silly). Klippet `silly` är
  hovdansen, ett hoppsasteg med högt böjt knä (`silly_keys`); stödfoten är låst med IK, så pjäsen flyttas i exakt `sillySpeed`.
  Springaren marscherar (ingen låtsasgalopp). Träfftider, gånghastighet och `sillySpeed` skrivs till `public/models/pieces.json`.
- `blender/extras.py` – älgen (`elk.glb`, statisk, cirka 2,6 m), fältherrens hand (`hand.glb`, kolossfragment 4,6 m, handflatan
  plant, brott vid handleden) och trumpojken (`drummer.glb`, standardskelettet: idle, walk, drum, bow; trumman binds vid bröstet och
  stockarna placeras i den lösta slagposen så att spetsarna träffar skinnet; slagtider i `public/models/drummer.json`).
- `blender/arena.py` – Anders arena; i spelet används bara brädet ur den.
- `tools/optimize.mjs` – gltf-transform. Kör aldrig `gltf-transform optimize` direkt (se fällor).

## Ljud (ElevenLabs)

- Repliker: `tools/voice_lines.json` (svenska, eleven_v3 läser tonangivelser i hakparentes som regi). Rösterna är svenska röster ur
  ElevenLabs bibliotek, samma som Cold Tide använder. Effekterna står i `tools/gen_sfx.py`.
- Generering: `ELEVENLABS_API_KEY="$(security find-generic-password -s latresan-elevenlabs -w)" node tools/gen_audio.mjs`
  (nyckeln i nyckelringen, aldrig i filer). Filnamnen är en hash av röst och text, så befintliga filer genereras aldrig om.
- Därefter `python3 tools/make_audio_manifest.py` -> `public/audio/manifest.json`.
- ElevenLabs kostar riktiga pengar: generera inte om utan att fråga. Saknas en fil spelas syntljudet i `src/audio.js`.
- Kontroll utan att lyssna: ElevenLabs taligenkänning (`/v1/speech-to-text`, scribe_v1) säger språk och text.

## Strider (src/battle.js, src/spectacle.js)

`MOVES` per pjäs: klipp, räckvidd, träffeffekt och möjliga dödssätt (topple, crumble, launch, freeze, smite). Tvåhuggsattacker kan
slå av en arm (`maim`: delkrossning av armbenens trianglar + `hideBones`). Löparens tredje attack är bannbullan (`papalBull`).
Dödsslag = slowmotion + inzoomning; övriga hugg = träffstopp. Härolden ropar egna utrop (firstCasualty, twoAtOnce, rampage, revenge,
quip, enPassant, chapter, bongcloud, dejaVu); schackmatt = nådastöten → riket har fallit → seger utan skråma.
Repliker per pjäs: select, move, retreat, attack, hit, maimed, death, kill, annoyed (≥4 klick), bored (lång betänketid),
check (kungen), bull (löparen).

## Fler finesser

- **Karolinen** (`spectacle.karolin`, ~3 % av närstrider i filmläge, aldrig kungen): armarna huggs av en i taget medan han anmäler
  varje hugg till krigskollegium och kräver kvitto, och han faller mitt i en klagoskrift. Röst: `karolin`.
- **Älgen** tar ~4 % av offren (filmläge), **fältherrens hand** 25 % av matterna, och **trumpojken** följer springaren.
  8 % av vanliga drag blir hovdans. Extramodellerna laddas valfritt: saknas en fil hoppas händelsen över.
- **Dragbedömning:** en andra Stockfish (`analyst`) värderar varje ställning; ?? (≥2,5 bönder förlorat), ? (≥1,1) och !! (korrekt
  offer) visas som märke över pjäsen och i draglistan; härolden kommenterar.
- **Kyrkogård:** slagna pjäser står som små statyer på ramen, byggs om ur historiken.
- **Fotoläge** (◎), **repris** (⏮), **tips** (✧), **veteraner** (lagerkrans), **sammanfattning** (träffsäkerhet, värsta draget,
  främst i striden) och **legender** (Légal 1750, Det odödliga, Det eviggröna, Operapartiet) som i originalet.
- **Hoppa över duellen:** tryck på brädet, mellanslag/Esc eller "Hoppa över" medan en strid pågår.

## Röktest

`npm run smoke` bygger till `build/smoke-dist`, startar `vite preview` (port 8250, ingen HMR som laddar om mitt i) och kör Chrome
genom alla händelser: varje mattfinish, handen, älgen, karolinen, lemlästning, bannbullan, alla dödssätt, trumpojken med hovdans,
hoppa över, repris, veteran, tips, legendparti, ångra/fotoläge, kvällens lågor och översiktsläget. Felar vid konsolfel.
Bilder i `build/smoke/`. `--no-build`, `--headed`, `--only hand,elk`.

## Titelskärmen

Namn: **Saecula: Kartbordet**, som typografi (Cinzel och EB Garamond) i `index.html` och `src/style.css`, utan bild. Glansen löper
i bokstäverna. `src/title.js`: filmiska bilder bakom titeln, glöd som stiger; "Gå in i kartrummet" ger vit blixt och åska.
Titelmusiken `public/audio/music/title.mp3` är Anders Suno-låt och behöver bytas eller godkännas av honom före publicering.

## Mobil

`src/quality.js`: nivå 'low' laddar `*_lo.glb` (meshoptimizer-förenklade, 30 %), `public/tex/m/` (halv upplösning),
2K-skuggor, halv AO, inget skärpedjup. Dynamisk upplösning sänker/höjer pixeltätheten efter bildtiden. Stående skärm: brantare
översikt och filmkamera längs duellinjen. PWA-manifest + ikoner; iOS saknar elementhelskärm (tips om "Lägg till på hemskärmen").
Röster avkodas först när de behövs på mobil (alla på en gång > 100 MB).

## Online

`server/` (se `server/PROTOCOL.md`, auktoritativ chess.js, rum med 6-teckenskod, token för återanslutning, rum sparas i
`server/data/`). Klienten: `src/online.js` + `Game.startOnline/remoteMove/endOnline`. Inbjudningslänk `?join=KOD`.
Returmatch (båda ber, färgerna byts), åskådare (`?watch=KOD` eller "Watch" i menyn; max 50 per rum, kan aldrig dra) och glåpord
(❝ i verktygsfältet, 8 svenska glåpord med rösten `taunter`, 2 i rad sedan 1 per 4 s) ligger i `src/online-extras.js` + `.css`.
`online.listen(ev, fn)` lägger till lyssnare utan att ersätta main.js hanterare (`on` har en per händelse).
Testmotståndare: `node tools/online_bot.mjs KOD [--taunt] [--ask-rematch] [--no-rematch] [--url ws://…]`, stdin `t <id>`, `r`, `q`, `x`.
`sessionStorage['bc.ws']` pekar en flik mot en annan WebSocket-server (felsökning).

## Lokalt minne

`bc.lastGame` (senaste lokala partiet, "Continue" i menyn), `bc.settings` (menyvalen), `bc.online` (onlinesessionen).


## Kod

`src/main.js` startar; `world.js` (renderare, efterbehandling, tiden på dygnet), `kartrum/` (rummet, ljuset, översikten),
`materials.js` (triplanar marmor, golvspärr för skinnade pjäser, trumpojkens kostym), `pieces.js`, `capes.js` (mantelfysik),
`board.js`, `battle.js` (koreografi), `spectacle.js` (karolinen, älgen, bannbullan, matterna, handen), `director.js` (filmkameran),
`drummer.js`, `fx.js` (partiklar, krossade statyer), `game.js` (chess.js + Stockfish + turordning) med `game-online.js`,
`game-analysis.js`, `game-save.js`, `game-photo.js` och `game-input.js` inkopplade via Object.assign, `engine.js` (UCI i Web Worker),
`audio.js` (synt), `voice.js` (inspelningar), `ui.js`.

## Fällor (alla upplevda)

- Blenders glTF-export skriver bara UV:er som en textur använder: arenan får en dummybild, `optimize.mjs` tar bort den.
- gltf-transform `dedup` slår ihop material med samma egenskaper -> namnen försvinner. Använd `keepUniqueNames`.
- `meshopt()` kvantiserar alltid POSITION. Riggade pjäser måste behålla float-positioner (triplanarshadern läser vilopositionen).
- Kvantiserad arena: positioner är normerade med nodskala; vertexshaders som flyttar vertexar måste skala (fanorna, `uScale`).
- Terrängens ytor måste vara moturs sett uppifrån, annars backface-cullas hela marken.
- Kameraflygningar har jobb-token: en äldre flygning som avbryts får inte röra kameran (annars sliter en sen hemflygning
  bort filmbilden och slår på OrbitControls mitt i en duell).
- Klick: brädet först, pjäsernas träffcylindrar bara över tomma rutor (annars stjäl bakre raden klicken).
- Kör högst en Blender åt gången (16 GB).
- GLTFLoader sanerar nodnamn: benet `prop.R` heter `propR` i three. Jämför alltid utan punkter.
- `bpy.ops.object.vertex_group_smooth` går inte headless (kräver viktmålning) — `anatomy.smooth_weights` gör det i numpy.
- `ui.on(ev)` har en hanterare per händelse; en andra registrering ersätter den första.
- Blender klämmer metabollarnas upplösning till minst 0,005 m: små former (handen i människoskala innan den skalas upp) blir grova.
  `extras.blob` bygger dem uppskalade och skalar ned meshen.
- Dräkter är styvt bundna till hips: djupa knäböj sänker fållen genom golvet. `withFloor` (materials.js) klämmer skinnade
  vertexar till brädets ovansida inom brädet; skuggan klämms inte. Mantlarna simuleras (capes.js) men hänger i chest
  upptill, så kraftig bakåtlutning syns ändå (därför grundare `silly` för löparen/drottningen och mindre lutning).
- Bennamn jämförs utan punkter men MED siffror (`/[^A-Za-z0-9]/`): annars blir `cape.1` och `cape.2` samma nyckel.
- En pausad kameraflygning (`timeScale = 0`) skriver fortfarande kameran varje bild: kör `BC.game.director.job++` innan
  kameran placeras för hand. OrbitControls har minsta avstånd: `BC.world.controls.enabled = false` för närbilder.
- `await import('/src/x.js')` i konsolen ger en egen modulinstans (Vite lägger på `?t=`): att ändra dess exporter
  (t.ex. `boardFloor`) påverkar inte spelet. Gå via `BC` eller `renderer.properties.get(material).uniforms`.
- `pieces.py` importeras av `extras.py`; `main()` körs bara när filen är huvudskript.
- Arenans GLB är sammanslagen per material: `static_Trim` innehåller både ramens inlägg och fanstängernas beslag. `maproom.js`
  klipper per triangel (`clipToBoard`), inte per nät.
- Fönsterljuset är en avlägsen spotlight (decay 0) med en kon som precis rymmer fönstren; en DirectionalLight läcker ljus utanför
  skuggkamerans frustum. Konens vinkel räknas en gång, annars kryper skuggornas rutnät medan dygnet glider.
- Kartans graverade streck och träets fibrer gnistrar i sned vinkel: texturerna läses med mipförskjutning (`softMip` i room.js),
  kartans sjunker mot noll i översikten.
- `new SepiaEffect({ intensity: 0 })` ger full sepia; nolla `blendMode.opacity` i stället. OutlineEffect behöver BlendFunction.ALPHA.
- Appens dolda webbläsarpanel pausar requestAnimationFrame: ta bilder och mät bildfrekvens med `tools/shots.mjs` i riktig Chrome.
