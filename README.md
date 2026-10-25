# Marble & Mayhem

Chess where every capture is a duel. The pieces are living marble statues — white Carrara with gold, black
Nero Marquina with silver — standing on a polished board in a sunlit ruined colonnade. When one piece takes
another, the camera cuts to a cinematic side shot, the attacker strikes (spear, sword, crozier, fists of stone,
arcane bolt) and the victim topples and shatters.

- **Engine:** Stockfish 19 (lite NNUE, WebAssembly, in a Web Worker), adjustable from ~1320 Elo to full strength.
- **Modes:** play White, play Black, two players on one screen, watch Stockfish play itself, or challenge a friend online
  with a six-letter invite code (or link). Your last local game is saved and can be continued.
- **Battles:** every piece has several attacks and its victims die in different ways — toppled, crumbled, launched, frozen
  solid, smitten by lightning — plus a Holy Hand Grenade, knights on coconut-powered imaginary horses, flesh wounds, and a
  Mortal-Kombat-style finish on checkmate. ~175 voiced lines full of game and Monty Python references.
- **Mobile:** lighter models and textures, dynamic resolution, portrait-aware cameras, touch controls, installable as an app.
- **Rendering:** three.js WebGL, HDRI sky with a matched sun and 4K shadows, triplanar marble, N8AO ambient
  occlusion, bloom, depth of field in battles, AgX tone mapping, SMAA.
- **Assets:** every model and animation is built procedurally in Blender (Python, headless): six rigged statue
  types with idle/walk/attack/hit/death/victory, plus the arena. Voices and sound effects by ElevenLabs.

```bash
npm install
npm run dev      # http://localhost:8240
npm run server   # online play (WebSocket on :8241)
```

See `CLAUDE.md` for the asset pipeline.

## Credits and licences

- Stockfish.js (`public/engine/`) — GPL-3.0, https://github.com/nmrugg/stockfish.js
- Textures and HDRI — Poly Haven, CC0
- Title music — generated with Suno; voices and sound effects — ElevenLabs
- three.js, postprocessing, n8ao, chess.js — MIT / BSD
