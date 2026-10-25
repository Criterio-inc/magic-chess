// Onlinetillägg: rematch, åskådare och glåpord (server/PROTOCOL.md). Bygger sina egna knappar och
// lyssnar på onlinehändelser via online.listen, så att main.js hanterare aldrig ersätts.
import * as THREE from 'three';
import './online-extras.css';

/** Glåporden (id:na måste stämma med TAUNTS i server/rooms.js; rösterna ligger under voice.taunter). */
export const TAUNTS = {
  fart: 'I fart in your general direction!',
  hamster: 'Your mother was a hamster…',
  goaway: 'Now go away, or I shall taunt you a second time!',
  ni: 'Ni!',
  really: 'That was your move? Really?',
  wellplayed: 'Well played. I mean it. Mostly.',
  expect: 'Nobody expects my next move!',
  hurry: 'Any century now would be lovely.',
};
const TAUNT_BURST = 2; // samma hink som servern: två i rad, sedan ett per 4 s
const TAUNT_MS = 4000;
const BUBBLE_S = 3.2;
const BOARD_END = ['checkmate', 'stalemate', 'repetition', 'insufficient', 'fifty']; // visas när draget har spelats klart

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, parent = null) => {
  const e = Object.assign(document.createElement(tag), props);
  if (parent) parent.appendChild(e);
  return e;
};
const sideName = (c) => (c === 'w' ? 'White' : 'Black');

export function setupOnlineExtras({ online, game, ui, voice, world, sound }) {
  // ------------------------------------------------------------ knappar och rutor

  // "Watch" bredvid "Join" i onlinemenyn
  const watchBtn = el('button', { id: 'online-watch', className: 'btn ghost', textContent: 'Watch', title: 'Watch this arena as a spectator' });
  $('online-join')?.after(watchBtn);
  watchBtn.addEventListener('click', () => {
    const code = $('join-code').value.trim().toUpperCase();
    if (code.length !== 6) { ui.onlineMsg('The code has six characters.'); return; }
    const s = ui.readSettings();
    game.settings.battles = s.battles;
    game.settings.pace = s.pace;
    watch(code);
  });

  // åskådarräknaren under statusraden
  const hud = $('hud');
  const watchersEl = el('div', { id: 'watchers', className: 'hidden' }, hud);
  const setWatchers = (n) => {
    n = Number(n) || 0;
    watchersEl.textContent = `👁 ${n} watching`;
    watchersEl.classList.toggle('hidden', n <= 0);
  };

  // glåpordsknappen i verktygsraden och menyn som fälls upp ovanför den
  const tauntBtn = el('button', { id: 'btn-taunt', className: 'icon online-only', textContent: '❝', title: 'Taunt your opponent' });
  ($('btn-resign') || $('toolbar').lastElementChild).after(tauntBtn);
  const menu = el('div', { id: 'taunt-menu', className: 'hidden' }, document.body);
  for (const [id, text] of Object.entries(TAUNTS)) {
    const b = el('button', { textContent: text }, menu);
    b.dataset.id = id;
  }
  const closeMenu = () => menu.classList.add('hidden');
  const openMenu = () => {
    refreshTauntCool();
    menu.classList.remove('hidden');
    // placera menyn ovanför knappen, inom fönstret
    const r = tauntBtn.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    menu.style.bottom = `${innerHeight - r.top + 8}px`;
  };
  tauntBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('hidden')) openMenu(); else closeMenu();
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    closeMenu();
    sendTaunt(b.dataset.id);
  });
  window.addEventListener('pointerdown', (e) => {
    if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target !== tauntBtn) closeMenu();
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  // rematchraden i slutrutan
  const rematchBtn = $('over-rematch');
  const note = el('p', { id: 'over-rematch-note', className: 'small hidden' });
  rematchBtn?.closest('.row')?.before(note);

  // ------------------------------------------------------------ glåpord

  // klientens egen hink (samma regler som servern), så att knappen inte lovar mer än servern tillåter
  const bucket = { tokens: TAUNT_BURST, at: performance.now() };
  const fill = () => {
    const now = performance.now();
    bucket.tokens = Math.min(TAUNT_BURST, bucket.tokens + (now - bucket.at) / TAUNT_MS);
    bucket.at = now;
  };
  let coolTimer = 0;
  function refreshTauntCool() {
    fill();
    const cool = bucket.tokens < 1;
    tauntBtn.classList.toggle('cool', cool);
    for (const b of menu.children) b.disabled = cool;
    clearTimeout(coolTimer);
    if (cool) coolTimer = setTimeout(refreshTauntCool, (1 - bucket.tokens) * TAUNT_MS + 30);
  }

  function sendTaunt(id) {
    if (!TAUNTS[id] || online.watching || game.settings.mode !== 'online') return;
    fill();
    if (bucket.tokens < 1) { ui.toast('Catch your breath first', true); refreshTauntCool(); return; }
    bucket.tokens -= 1;
    online.taunt(id); // servern ekar tillbaka; då hörs och syns det även här
    refreshTauntCool();
  }

  // en pratbubbla per sida, förankrad över kungen (eller vid skärmkanten om den inte syns)
  const bubbles = {};
  const tmp = new THREE.Vector3();
  function bubble(by, text, secs = BUBBLE_S) {
    bubbles[by]?.remove();
    const b = el('div', { className: `taunt-bubble side-${by}`, textContent: text }, document.body);
    bubbles[by] = b;
    const t0 = performance.now();
    const own = by === (game.myColor || 'w'); // egen sida (eller vit för åskådare) står närmast kameran
    const step = () => {
      if (!b.isConnected) return;
      const k = (performance.now() - t0) / 1000 / secs;
      if (k >= 1) { b.remove(); if (bubbles[by] === b) delete bubbles[by]; return; }
      const W = innerWidth, H = innerHeight;
      const bw = b.offsetWidth, bh = b.offsetHeight;
      let x = W / 2, y = own ? H * 0.72 : H * 0.2, anchored = false;
      const sq = game.findKing?.(by);
      const king = sq && game.pieces.get(sq);
      if (king?.root.visible) {
        tmp.copy(king.root.position);
        tmp.y += (king.meta?.height || 2) + 0.5;
        tmp.project(world.camera);
        if (tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1) {
          x = (tmp.x + 1) / 2 * W;
          y = (1 - tmp.y) / 2 * H;
          anchored = true;
        }
      }
      // bubblans spets pekar på punkten; håll hela bubblan inom fönstret
      const left = Math.max(8, Math.min(W - bw - 8, x - bw / 2));
      const top = Math.max(8, Math.min(H - bh - 70, y - bh - 14));
      b.style.transform = `translate(${left}px, ${top}px) scale(${0.85 + Math.min(1, k * 12) * 0.15})`;
      b.style.setProperty('--tail', `${Math.max(14, Math.min(bw - 14, x - left))}px`);
      b.classList.toggle('free', !anchored);
      b.style.opacity = String(Math.min(1, k * 14, (1 - k) * 6));
      requestAnimationFrame(step);
    };
    step();
  }

  online.listen('taunt', (m) => {
    const text = TAUNTS[m.id];
    if (!text) return;
    const mine = !online.watching && m.by === game.myColor;
    const secs = voice?.say('taunter', m.id, { gain: mine ? 0.5 : 0.9 }) || 0; // avsändaren hör sig själv lite svagare
    bubble(m.by, text, Math.min(6, Math.max(BUBBLE_S, secs + 0.5))); // bubblan står kvar medan repliken hörs
  });
  online.listen('error', (m) => {
    if (m.code === 'rate-limited' && game.settings.mode === 'online') ui.toast('Easy there — one taunt at a time', true);
  });

  // glåporden avkodas i förväg när ett onlineparti börjar (de är korta)
  const primeTaunts = () => {
    if (!voice?.sound?.ctx) return;
    for (const u of Object.values(voice.manifest?.voice?.taunter || {}).flat()) voice.decode(u);
  };

  // ------------------------------------------------------------ rematch

  const rm = { mine: false, theirs: false, gone: false, dismissed: false };
  function refreshRematch() {
    if (!rematchBtn) return;
    const accept = rm.theirs && !rm.mine && !rm.gone;
    rematchBtn.disabled = rm.mine || rm.gone;
    rematchBtn.textContent = rm.mine ? 'Waiting…' : accept ? 'Accept rematch' : 'Rematch';
    rematchBtn.classList.toggle('gold', accept);
    rematchBtn.classList.toggle('ghost', !accept);
    const text = rm.gone ? 'Your opponent has left the arena.'
      : rm.mine && rm.theirs ? 'To battle again!'
      : rm.mine ? 'Rematch requested — waiting for your opponent.'
      : rm.theirs ? 'Opponent wants a rematch!' : '';
    note.textContent = text;
    note.classList.toggle('hidden', !text);
  }
  const resetRematch = () => { Object.assign(rm, { mine: false, theirs: false, gone: false, dismissed: false }); refreshRematch(); };
  $('over-review')?.addEventListener('click', () => { rm.dismissed = true; });
  $('over-new')?.addEventListener('click', () => { rm.dismissed = false; });

  function requestRematch() {
    if (!game.onlineOver || online.watching || rm.mine || rm.gone) return;
    rm.mine = true;
    online.rematch();
    refreshRematch();
    ui.toast(rm.theirs ? 'Rematch accepted' : 'Rematch requested');
  }

  function onRematch(m) {
    if (online.watching) { ui.toast(`${sideName(m.by)} wants a rematch`); return; }
    if (m.by === game.myColor) return;
    rm.theirs = true;
    refreshRematch();
    ui.toast('Opponent wants a rematch');
    // slutrutan stängd med "Look around": visa den igen så att det går att svara
    if (rm.dismissed && game.onlineOver && !game.playing && $('menu').classList.contains('hidden')) {
      rm.dismissed = false;
      ui.show('over');
    }
  }
  online.listen('rematch', onRematch);
  online.listen('opponent', (m) => { if (m.status === 'left') { rm.gone = true; refreshRematch(); } });
  online.listen('over', () => resetRematch());

  // ------------------------------------------------------------ åskådare

  let watchedOk = false;
  function watch(code) {
    watchedOk = false;
    ui.onlineMsg('Finding the arena…');
    online.watch(code);
  }

  /** Efter återanslutning eller watch till ett avgjort parti: visa slutrutan (utan härold och fanfar).
   *  Matt, patt m.m. visar game.js själv när ställningen byggts upp. */
  const showSettled = (over) => {
    if (over && !BOARD_END.includes(over.reason)) game.endOnline(over.result, over.reason, { quiet: true });
  };

  online.listen('watching', (m) => {
    watchedOk = true;
    ui.onlineMsg('');
    ui.hide('menu');
    ui.hide('invite');
    ui.hide('over');
    closeMenu();
    world.controls.autoRotate = false;
    game.settings.started = true;
    sound?.setMusic(0, 3);
    game.startOnline(m.state, null, { fanfare: false });
    setWatchers(m.state.watchers);
    primeTaunts();
    showSettled(m.state.over);
    ui.toast(`Watching ${m.code}`);
  });
  online.listen('error', (m) => {
    if (!m.wasWatching) return;
    if (game.settings.mode === 'online') ui.setOnline(false); // inga spelarknappar när rummet är borta
    if (m.code === 'room-full') ui.toast('Too many spectators already', true);
    else if (m.code === 'no-such-room' && watchedOk) ui.toast('The arena has closed', true);
    watchedOk = false;
  });

  // ------------------------------------------------------------ gemensamt för alla onlinepartier

  online.listen('watchers', (m) => setWatchers(m.n));
  online.listen('created', () => { setWatchers(0); resetRematch(); });
  online.listen('joined', (m) => {
    setWatchers(m.state.watchers);
    resetRematch();
    primeTaunts();
    if (m.state.over) showSettled(m.state.over);
  });
  online.listen('start', (m) => {
    setWatchers(m.state.watchers);
    resetRematch();
    closeMenu();
    primeTaunts();
  });

  return { requestRematch, watch };
}
