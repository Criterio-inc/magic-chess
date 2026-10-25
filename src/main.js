// Saecula: Kartbordet: start, laddning och koppling mellan delarna.
import { World } from './world.js';
import { Board } from './board.js';
import { PieceLibrary } from './pieces.js';
import { setBoardFloor } from './materials.js';
import { FX } from './fx.js';
import { Sound } from './audio.js';
import { Voice } from './voice.js';
import { Engine } from './engine.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { tier } from './quality.js';
import { Online } from './online.js';
import { setupOnlineExtras } from './online-extras.js';
import { Title } from './title.js';
import { Overview } from './kartrum/overview.js';

const ui = new UI();
const world = new World(document.getElementById('view'));
const sound = new Sound();
const voice = new Voice(sound);
const engine = new Engine();
const analyst = new Engine(); // egen motor för dragbedömningen, så att den aldrig stör motståndarens tänkande

const steps = ['sky', 'arena', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
let done = 0;
const LABELS = { sky: 'Breder ut kartan…', arena: 'Lägger fram brädet…', pawn: 'Väcker bönderna…', knight: 'Rustar ryttarna…',
  bishop: 'Välsignar löparna…', rook: 'Murar tornen…', queen: 'Krönar drottningarna…', king: 'Kallar på kungarna…' };
const progress = (k) => { done++; ui.progress(done / (steps.length + 1), LABELS[steps[Math.min(done, steps.length - 1)]]); };

async function boot() {
  ui.progress(0.02, 'Breder ut kartan…');
  const meta = await world.load(progress);
  const board = new Board(world, meta);
  const lib = new PieceLibrary();
  await lib.load(progress);
  lib.loadMinis(); // småstatyer till kyrkogården laddas i bakgrunden
  lib.loadExtras(); // älgen, fältherrens hand och trumpojken
  await voice.load();
  await engine.ready;
  ui.progress(1, null);
  const fx = new FX(world);
  fx.setGround(meta.tileTop);
  setBoardFloor(meta.tileTop, meta.boardHalf); // pjäsernas golvspärr och mantlarna
  const game = new Game({ world, board, lib, fx, sound, engine, analyst, ui, voice });
  const online = (game.online = new Online());
  const extras = setupOnlineExtras({ online, game, ui, voice, world, sound }); // rematch, åskådare, glåpord
  // kvällen: syrsor och uggla när solen gått ned, härolden noterar mörkret en gång per parti
  let night = null, nightSaid = false, owlT = 0;
  world.onTime = (t) => {
    if (t > 0.62 && !night && sound.bank) night = sound.bank.loop('crickets', 0.22, 8);
    if (t > 0.65 && !nightSaid && game.settings.mode !== 'watch' && game.chess.history().length > 0) { nightSaid = true; voice.herald('nightfall'); }
    if (t < 0.5) nightSaid = false;
  };
  world.addUpdater((dt) => {
    if (world.tod > 0.62 && sound.bank && (owlT += dt) > 40 + Math.random() * 40) { owlT = 0; sound.bank.sfx('owl', { gain: 0.35, pan: Math.random() * 2 - 1 }); }
  });
  const overview = new Overview(world, game); // kartbordet uppifrån, som kopparstick (M eller ⌖)
  ui.on('overview', () => overview.toggle());
  window.addEventListener('keydown', (e) => { if (e.key === 'm' && !e.target.closest?.('input, textarea')) overview.toggle(); });
  window.BC = { world, game, fx, board, lib, engine, voice, overview }; // för felsökning i konsolen

  // Bakgrundsparti medan titelskärmen visas: vit och svart står uppställda, kameran kretsar.
  game.syncFromBoard();
  world.controls.target.set(0, 1, 0);
  const title = new Title(world);
  world.start();
  title.start();
  // kompilera shaders innan spelaren ser något
  world.renderer.compile(world.scene, world.camera);

  // Titelmusiken startar vid första interaktionen (webbläsare spärrar ljud dessförinnan)
  sound.playMusic('/audio/music/title.mp3', 0.55, 3);
  const firstGesture = () => { sound.unlock(); window.removeEventListener('pointerdown', firstGesture); window.removeEventListener('keydown', firstGesture); };
  window.addEventListener('pointerdown', firstGesture);
  window.addEventListener('keydown', firstGesture);

  const joinParam = new URLSearchParams(location.search).get('join');
  const watchParam = new URLSearchParams(location.search).get('watch'); // åskådarlänk
  ui.ready(async () => {
    sound.unlock();
    // dånande entré: vit blixt, åska, titelbilderna slutar och kameran svänger in över arenan
    const flash = document.getElementById('flash');
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    title.stop();
    world.shake = 0.25;
    await voice.decodeAll();
    sound.bank?.sfx('thunder', { gain: 0.9, rate: 1 });
    sound.startLoops();
    game.director.toHome('w', 2.4).then(() => {
      if (!game.settings.started) { world.controls.autoRotate = true; world.controls.autoRotateSpeed = 0.22; }
    });
    if (joinParam) {
      // inbjudningslänk: gå direkt in i rummet
      history.replaceState(null, '', location.pathname);
      online.forget();
      online.join(joinParam);
      ui.toast('Ansluter…');
    } else if (watchParam) {
      extras.watch(watchParam);
    } else if (online.session?.started) {
      online.connect(); // återanslut till pågående onlineparti
      ui.toast('Återansluter…');
    } else {
      ui.showContinue(Game.loadLocal());
      ui.show('menu');
    }
  });
  ui.on('continue', () => {
    const saved = Game.loadLocal();
    if (!saved) return;
    world.controls.autoRotate = false;
    game.settings.started = true;
    if (online.active) online.leave();
    sound.setMusic(0, 3.5);
    ui.hide('menu');
    game.resume(saved);
  });
  ui.on('menu', () => {
    sound.setMusic(0.4, 2);
    // mitt i ett lokalt parti finns inget att "fortsätta" — det pågår redan
    ui.showContinue(game.settings.mode === 'online' || game.chess.isGameOver() ? Game.loadLocal() : null);
  });

  ui.on('start', (s) => {
    world.controls.autoRotate = false;
    game.settings.started = true;
    if (online.active) online.leave();
    sound.setMusic(0, 3.5);
    game.newGame(s);
  });

  // ---------------------------------------------------------------- online
  const applySettings = (s) => { game.settings.battles = s.battles; game.settings.pace = s.pace; };
  ui.on('onlineCreate', (s) => { applySettings(s); online.forget(); online.create(s.color); ui.onlineMsg('Skapar ditt kartrum…'); });
  ui.on('onlineJoin', (s) => { applySettings(s); online.forget(); online.join(s.code); ui.onlineMsg('Ansluter…'); });
  ui.on('onlineCancel', () => { online.leave(); ui.hide('invite'); ui.show('menu'); });
  ui.on('offerDraw', () => { online.offerDraw(); ui.toast('Remi erbjuden'); });
  let resignArmed = 0;
  ui.on('resign', () => {
    if (performance.now() - resignArmed < 3000) { online.resign(); resignArmed = 0; return; }
    resignArmed = performance.now();
    ui.toast('Tryck ⚐ igen för att ge upp', true);
  });
  ui.on('rematch', () => extras.requestRematch());
  const ERR = { 'no-such-room': 'No arena with that code.', 'room-full': 'Det kartrummet har redan två spelare.',
    'bad-token': 'Din plats har gått ut.', 'rate-limited': 'Lugn i stormen, för många försök.', 'bad-request': 'Något gick fel.' };
  online
    .on('created', (m) => {
      ui.onlineMsg('');
      ui.showInvite(m.code, online.inviteLink(m.code));
      sound.setMusic(0.3, 2);
    })
    .on('joined', (m) => {
      ui.onlineMsg('');
      const started = online.session?.started || m.state.moves.length > 0 || m.state.over;
      if (started) { ui.hide('menu'); ui.hide('invite'); game.startOnline(m.state, m.color, { fanfare: false }); }
    })
    .on('start', (m) => {
      world.controls.autoRotate = false;
      game.settings.started = true;
      // spelare får sin färg av servern (den byts vid rematch); åskådare har ingen
      const color = online.watching ? null : m.color || online.session?.color;
      if (!online.watching) online.save({ started: true, color });
      ui.hide('invite'); ui.hide('menu'); ui.hide('over');
      sound.setMusic(0, 3);
      game.startOnline(m.state, color);
    })
    .on('move', (m) => game.remoteMove(m))
    .on('reject', (m) => { ui.toast('Draget nekades', true); game.startOnline(m.state, game.myColor, { fanfare: false }); })
    .on('opponent', (m) => {
      if (m.name) game.opponentName = m.name;
      const t = { joined: 'Din motståndare har kommit', disconnected: 'Din motståndare tappade anslutningen', reconnected: 'Din motståndare är tillbaka', left: 'Din motståndare gick' }[m.status];
      if (m.status === 'joined') ui.inviteStatus('Motståndare hittad!');
      else if (t) ui.toast(t, m.status !== 'reconnected');
    })
    .on('draw-offer', (m) => { if (m.by !== game.myColor) ui.askDraw().then((a) => online.answerDraw(a)); })
    .on('draw-declined', () => ui.toast('Remi avböjd'))
    .on('over', (m) => game.endOnline(m.result, m.reason))
    .on('error', (m) => {
      ui.onlineMsg(ERR[m.code] || m.message);
      if (m.code === 'no-such-room' || m.code === 'room-full' || m.code === 'bad-token') { ui.hide('invite'); ui.show('menu'); ui.toast(ERR[m.code] || 'Fel', true); }
    })
    .on('connection', (c) => { if (game.settings.mode === 'online' && !c.online) ui.status('Anslutningen bröts, återansluter…'); });
  ui.on('menuClose', () => sound.setMusic(0, 2));
  ui.on('undo', () => game.undo());
  ui.on('flip', () => {
    if (game.director.busy) return;
    game.director.toHome(game.director.side === 'w' ? 'b' : 'w', 1.6);
  });
  ui.on('battles', (v) => { game.settings.battles = v; });
  ui.on('photo', (on) => game.photo(on));
  ui.on('photoSave', () => game.photoSave());
  ui.on('photoFreeze', () => game.photoFreeze());
  ui.on('replay', () => game.replay());
  ui.on('hint', () => game.hint());
  ui.on('skip', () => game.skipBattle());
  // vriden telefon / ändrat fönster: lägg om översiktsbilden när inget drag pågår
  let lastAspect = world.camera.aspect;
  window.addEventListener('resize', () => {
    const a = world.camera.aspect;
    if ((a < 1.15) !== (lastAspect < 1.15) && !game.busy && world.controls.enabled && !world.controls.autoRotate) game.director.toHome(game.director.side, 0.8);
    lastAspect = a;
  });
  // datorer har gott om minne: avkoda alla repliker i bakgrunden så att de spelas utan fördröjning
  if (tier.name === 'high') setTimeout(() => {
    const all = Object.values(voice.manifest.voice).flatMap((k) => Object.values(k).flat());
    (async () => { for (const u of all) await voice.decode(u); })();
  }, 4000);
  ui.on('sound', (on) => sound.setEnabled(on));
}

boot().catch((e) => {
  console.error(e);
  ui.progress(1, 'Något gick fel: ' + e.message);
});
