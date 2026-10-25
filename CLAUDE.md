# Marble & Mayhem (repo: battlechess)

Schack där varje slag är en duell: levande marmorstatyer i en solbelyst ruin, three.js (WebGL) + Stockfish 19.

## Kör

```bash
npm install
npm run dev            # http://localhost:8240 (och http://<lan-ip>:8240 för telefonen)
npm run server         # onlineservern (WebSocket :8241, Vite proxar /ws dit)
npm run test:server    # 19 steg mot servern
npm run build          # dist/ (statisk, base './')
```

`?quality=low|high` tvingar kvalitetsnivå (annars: mobil = low). `node tools/online_bot.mjs KOD` är en testmotståndare online.

Felsökning i konsolen: `window.BC` (world, game, fx, board, lib, engine, voice), `BC_DEBUG = true` loggar drag, motor, kamerabilder,
strider och onlinetrafik. `BC.world.timeScale = 0.2` ger slowmotion (0 fryser). `BC.game.chor.force = { death: 'freeze', fleshwound: true }`
tvingar fram ett utfall; `BC.game.chor.chooseMove = () => ({ clip: 'attack2', reach: 4.6, fx: 'grenade', deaths: ['launch'] })` en attack.

## Tillgångskedjan

Allt 3D modelleras i Blender med Python (headless, Blender 5.2):

```bash
tools/fetch_assets.sh              # Poly Haven CC0: texturer + HDRI -> assets/src (gitignorerat)
python3 tools/make_marble.py       # sömlös marmor (periodiskt FFT-brus) -> public/tex/marble_*
tools/build_assets.sh              # Blender: pjäser + arena + extras -> build/models -> meshopt -> public/models
tools/build_assets.sh --skip-blender   # bara komprimering + texturer
blender -b -P blender/pieces.py -- --only rook --preview /tmp/prev   # en pjäs + poskontroll som PNG
blender -b -P blender/extras.py -- --only patsy --preview /tmp/prev  # kaninen, foten, Patsy (rabbit,foot,patsy)
```

- `blender/lib.py` – primitiver (lathe med veck/båge, limb, tube, prism, blade), modifierare, `uv_box`.
- `blender/rig.py` – gemensamt skelett, styv bindning, poser/animation (NLA-spår = glTF-animationer), export.
  Benkonventioner står överst i filen. Vapen pekar rakt upp ur handen och riktas med `prop`-benet via `rig.aim()`.
- `blender/anatomy.py` – skulpterade kroppar: muskler/ansikte/nävar som metabollar (mjuk sammansmältning, negativa former gräver
  fåror), konverteras, decimeras och får mjuka vikter överförda från ett styvt lager av samma former. Storlekar = verkliga radier
  (Blenders fält s·(1-(d/R)²)³ ⇒ yta vid R·√(1-(t/s)^⅓)). Låg styvhet (≈2,5) = former som smälter in.
- `blender/pieces.py` – de sex statyerna + animationer (idle, walk, attack, attack2, hit, death, victory, silly). `bake_vertex_ao` bakar
  AO (Cycles) + krökning i vertexfärgen (R = AO, G = krökning) som `materials.withBake` läser. `--hero DIR` ger närbilder i HDRI-ljus.
  Träfftider (`events`), gånghastighet och `sillySpeed` skrivs till `public/models/pieces.json`; spelet läser dem.
  `silly` = Ministry of Silly Walks (`silly_keys`): stödfoten låst med IK, så pjäsen ska flyttas i exakt `sillySpeed`.
- `blender/extras.py` – Mördarkaninen (`rabbit.glb`, statisk, 0,34 m), jättefoten som kolossfragment (`foot.glb`, statisk, 4,2 m,
  origo mitt under sulan) och Patsy (`patsy.glb`, standardskelettet: idle, walk, clap, bow; kokosnötterna styvt på hand.L/R och
  kanterna möts exakt i klappögonblicken). Klapptider, gånghastighet och längder i `public/models/patsy.json`.
- `blender/arena.py` – bräde (rutstorlek 2 m, vit mot +Z i three), estrad, pelarring, terräng, glödfat, fanor.
- `tools/optimize.mjs` – gltf-transform. Kör aldrig `gltf-transform optimize` direkt (se fällor).

## Ljud (ElevenLabs)

- Repliker: `tools/voice_lines.json` -> `tools/gen_voice.py`, som kör elevenlabs-dialogue-skillens `generate_dialogue.py`
  (en mp3 per replik, cache i `build/voice/.segments`). Rösterna står i JSON-filen.
- Effekter: `tools/gen_sfx.py` (skillen saknar SFX). Filnamn = hash av prompt, befintliga filer genereras aldrig om.
- Därefter `python3 tools/make_audio_manifest.py` -> `public/audio/manifest.json`.
- Nyckeln ligger i `~/.zprofile` utan `export`: kör `zsh -c 'source ~/.zprofile; export ELEVENLABS_API_KEY; python3 …'`.
- ElevenLabs kostar riktiga pengar: generera inte om utan att fråga. Saknas en fil spelas syntljudet i `src/audio.js`.

## Strider (src/battle.js)

`MOVES` per pjäs: klipp, räckvidd, träffeffekt och möjliga dödssätt (topple, crumble, launch, freeze, smite). Tvåhuggsattacker kan slå
av en arm (`fleshwound`: delkrossning av armbenens trianglar + `hideBones`). Löparens tredje attack är den heliga handgranaten.
Dödsslag = slowmotion + inzoomning; övriga hugg = träffstopp. Härolden: First blood, Double kill, Killing spree, Combo breaker,
Toasty, Holy hell (en passant), Spanska inkvisitionen, Bongcloud, Horse, Déjà vu; schackmatt = Finish him → blixt → Fatality → Flawless.
Springaren galopperar på låtsashäst med kokosnötsljud. Repliker per pjäs: select, move, retreat, attack, hit, fleshwound, death,
kill, annoyed (≥4 klick), bored (lång betänketid), check (kungen), grenade (löparen).

## Fler finesser

- **Dragbedömning:** en andra Stockfish (`analyst`) värderar varje ställning; ?? (≥2,5 bönder förlorat), ? (≥1,1) och !! (korrekt
  offer = motorns bästa drag som lämnar en pjäs hängande) visas som märke över pjäsen och i draglistan; härolden kommenterar.
- **Kyrkogård:** slagna pjäser står som små statyer (förenklade modeller, fryst pose) på ramen, byggs om ur historiken.
- **Tid på dygnet:** följer partiets längd (≈90 halvdrag → skymning): solen sjunker, himlen byts till skymnings-HDRI med solen
  vriden till samma riktning, glödfaten lyser starkare, syrsor och uggla.
- **Fotoläge** (◎): fri kamera med panorering, tryck = skärpa, frys tid, spara PNG (mobil: dela). **Repris** (⏮) av senaste striden.
- **Schackmatt:** mattsättaren gör finishen (drottning fryser, löpare granat, torn/springare språng + attack2, bonde rusning),
  annars blixt; 25 % jättefoten ("And now for something completely different"). Mördarkaninen tar ~4 % av offren (filmläge).
  Patsy följer springaren och slår kokosnötterna; 8 % av vanliga drag blir en dum gång (Ministry of Silly Walks).
- Extramodeller i `blender/extras.py` (kanin, fot, Patsy) laddas valfritt: saknas en fil hoppas händelsen över.

## Titelskärmen

Namn: **Marble & Mayhem**. Loggan (`public/logo.webp`) är gjord med gemini-imagegen-skillen på grön bakgrund och nyckad med numpy
(grön → alfa, avspillning, eldiga kanter tillbaka mot orange). `src/title.js`: filmiska bilder bakom loggan med svarta övertoningar,
glöd som stiger, brevlådeband; "Enter the arena" ger vit blixt + åska.

## Mobil

`src/quality.js`: nivå 'low' laddar `*_lo.glb` (meshoptimizer-förenklade, 30 %), `public/tex/m/` (halv upplösning), `sky_m.hdr`,
2K-skuggor, halv AO, inget skärpedjup. Dynamisk upplösning sänker/höjer pixeltätheten efter bildtiden. Stående skärm: brantare
översikt och filmkamera längs duellinjen. PWA-manifest + ikoner; iOS saknar elementhelskärm (tips om "Lägg till på hemskärmen").
Röster avkodas först när de behövs på mobil (alla på en gång > 100 MB).

## Online

`server/` (se `server/PROTOCOL.md`, auktoritativ chess.js, rum med 6-teckenskod, token för återanslutning, rum sparas i
`server/data/`). Klienten: `src/online.js` + `Game.startOnline/remoteMove/endOnline`. Inbjudningslänk `?join=KOD`.

## Lokalt minne

`bc.lastGame` (senaste lokala partiet, "Continue" i menyn), `bc.settings` (menyvalen), `bc.online` (onlinesessionen).

Felsökning av de nya händelserna: `BC.game.chor.footChance = 1`, `.rabbitChance = 1`, `.sillyChance = 1`.

## Musik

`public/audio/music/title.mp3` — Suno ("Battlechess Title Theme", gillad version 48b8de43), nedladdad via Sunos webbgränssnitt.
Spelas på titel/meny, tonas ut när striden börjar.

## Kod

`src/main.js` startar; `world.js` (renderare, HDRI-sol, efterbehandling, arena), `materials.js` (triplanar marmor),
`pieces.js`, `board.js`, `battle.js` (koreografi + filmkamera), `fx.js` (partiklar, krossade statyer), `game.js`
(chess.js + Stockfish + inmatning), `engine.js` (UCI i Web Worker), `audio.js` (synt), `voice.js` (inspelningar), `ui.js`.

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
- Blender klämmer metabollarnas upplösning till minst 0,005 m: små former (kaninen, foten i människoskala) blir grova.
  `extras.blob` bygger dem uppskalade och skalar ned meshen.
- Mantlar och dräkter är styvt bundna till chest/hips: djupa knäböj sänker fållen genom golvet och bakåtlutning svänger
  långa mantlar framåt (därför grundare `silly` för löparen/drottningen och mindre lutning för mantelbärarna).
- `pieces.py` importeras av `extras.py`; `main()` körs bara när filen är huvudskript.
