// HUD och menyer.
import { GLYPH } from './pieces.js';
import { LEGENDS } from './legends.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.handlers = {};
    this.moveCount = 0;
    $('legend').innerHTML = LEGENDS.map((l, i) => `<button data-v="${l.id}"${i ? '' : ' class="on"'}>${l.title.replace(/^The /, '')}<small>${l.where.split(', ').pop()}</small></button>`).join('');
    this.setupSeg('legend');
    this.setupSeg('mode');
    this.setupSeg('battles');
    this.setupSeg('pace');
    this.setupSeg('ocolor');
    const elo = $('elo');
    const label = () => {
      const v = +elo.value;
      $('elo-label').textContent = v >= 3190 ? 'Full engine' : String(v);
    };
    elo.addEventListener('input', label);
    label();
    $('mode').addEventListener('click', () => {
      const m = this.seg('mode');
      $('strength-field').style.opacity = m === 'hotseat' ? 0.35 : 1;
      $('strength-field').classList.toggle('hidden', m === 'online' || m === 'legend');
      $('legend-field').classList.toggle('hidden', m !== 'legend');
      $('online-field').classList.toggle('hidden', m !== 'online');
      $('start').classList.toggle('hidden', m === 'online');
    });
    $('online-create').addEventListener('click', () => this.emit('onlineCreate', { color: this.seg('ocolor'), ...this.readSettings() }));
    $('online-join').addEventListener('click', () => {
      const code = $('join-code').value.trim().toUpperCase();
      if (code.length !== 6) { this.onlineMsg('The code has six characters.'); return; }
      this.emit('onlineJoin', { code, ...this.readSettings() });
    });
    $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('online-join').click(); });
    $('invite-cancel').addEventListener('click', () => this.emit('onlineCancel'));
    $('invite-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(this.inviteLink); $('invite-copy').textContent = 'Copied!'; } catch { $('invite-copy').textContent = 'Copy failed'; }
      setTimeout(() => { $('invite-copy').textContent = 'Copy link'; }, 1600);
    });
    $('invite-share').addEventListener('click', () => {
      const data = { title: 'Marble & Mayhem', text: `Duel me in Marble & Mayhem! Code: ${this.inviteCode}`, url: this.inviteLink };
      if (navigator.share) navigator.share(data).catch(() => {});
      else $('invite-copy').click();
    });
    $('btn-draw').addEventListener('click', () => this.emit('offerDraw'));
    $('btn-photo').addEventListener('click', () => this.emit('photo', true));
    $('ph-exit').addEventListener('click', () => this.emit('photo', false));
    $('ph-save').addEventListener('click', () => this.emit('photoSave'));
    $('ph-freeze').addEventListener('click', () => this.emit('photoFreeze'));
    $('btn-replay').addEventListener('click', () => this.emit('replay'));
    $('btn-hint').addEventListener('click', () => this.emit('hint'));
    $('btn-skip').addEventListener('click', () => this.emit('skip'));
    $('btn-resign').addEventListener('click', () => this.emit('resign'));
    $('over-rematch').addEventListener('click', () => this.emit('rematch'));
    $('start').addEventListener('click', () => this.emit('start', this.readSettings()));
    $('continue').addEventListener('click', () => this.emit('continue'));
    this.restoreSettings();
    for (const id of ['mode', 'battles', 'pace', 'ocolor', 'legend']) $(id).addEventListener('click', () => this.storeSettings());
    $('elo').addEventListener('change', () => this.storeSettings());
    $('menu-close').addEventListener('click', () => this.hide('menu'));
    $('btn-menu').addEventListener('click', () => { $('menu-close').classList.remove('hidden'); this.show('menu'); this.emit('menu'); });
    $('btn-undo').addEventListener('click', () => this.emit('undo'));
    $('btn-flip').addEventListener('click', () => this.emit('flip'));
    $('btn-moves').addEventListener('click', () => document.body.classList.toggle('show-moves'));
    $('menu-close').addEventListener('click', () => this.emit('menuClose'));
    // iPhone-Safari saknar helskärm för element: tipsa om "Lägg till på hemskärmen"
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    if (ios && !navigator.standalone && !matchMedia('(display-mode: fullscreen)').matches) $('ios-tip').classList.remove('hidden');
    $('btn-battle').addEventListener('click', () => {
      const b = $('btn-battle');
      b.classList.toggle('off');
      this.emit('battles', b.classList.contains('off') ? 'quick' : 'cinematic');
    });
    $('btn-sound').addEventListener('click', () => {
      const b = $('btn-sound');
      b.classList.toggle('off');
      this.emit('sound', !b.classList.contains('off'));
    });
    $('over-new').addEventListener('click', () => { this.hide('over'); $('menu-close').classList.add('hidden'); this.show('menu'); this.emit('menu'); });
    $('over-review').addEventListener('click', () => this.hide('over'));
  }

  on(ev, fn) { this.handlers[ev] = fn; }
  emit(ev, arg) { this.handlers[ev]?.(arg); }
  show(id) { $(id).classList.remove('hidden'); }
  hide(id) { $(id).classList.add('hidden'); }

  setupSeg(id) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      for (const x of $(id).children) x.classList.toggle('on', x === b);
    });
  }

  seg(id) { return [...$(id).children].find((b) => b.classList.contains('on')).dataset.v; }

  /** Bedömningsmärke (!!, ??, ?) som svävar över en pjäs en stund. getPos -> Vector3 eller null. */
  badge(sym, getPos, camera) {
    const el = document.createElement('div');
    el.className = 'note ' + (sym === '!!' ? 'brilliant' : sym === '??' ? 'blunder' : 'mistake');
    el.textContent = sym;
    document.body.appendChild(el);
    const t0 = performance.now();
    const step = () => {
      const k = (performance.now() - t0) / 3200;
      const p = getPos();
      if (k >= 1 || !p) { el.remove(); return; }
      p.project(camera);
      el.style.transform = `translate(${(p.x + 1) / 2 * innerWidth}px, ${(1 - p.y) / 2 * innerHeight}px) translate(-50%, -100%) scale(${0.8 + Math.min(1, k * 8) * 0.2})`;
      el.style.opacity = String(Math.min(1, k * 10, (1 - k) * 5));
      requestAnimationFrame(step);
    };
    step();
  }

  /** Lägg till !!/??/? efter draget i draglistan. */
  annotateMove(ply, sym) {
    const li = $('moves').children[Math.floor(ply / 2)];
    const span = li?.children[ply % 2];
    if (!span || span.dataset.note) return;
    span.dataset.note = sym;
    const b = document.createElement('b');
    b.className = 'mnote ' + (sym === '!!' ? 'brilliant' : sym === '??' ? 'blunder' : 'mistake');
    b.textContent = sym;
    span.appendChild(b);
  }

  /** Menyvalen minns mellan besök. */
  storeSettings() {
    const s = { mode: this.seg('mode'), elo: +$('elo').value, battles: this.seg('battles'), pace: this.seg('pace'), ocolor: this.seg('ocolor'), legend: this.seg('legend') };
    try { localStorage.setItem('bc.settings', JSON.stringify(s)); } catch { /* privat läge */ }
  }

  restoreSettings() {
    let s;
    try { s = JSON.parse(localStorage.getItem('bc.settings')); } catch { return; }
    if (!s) return;
    const set = (id, v) => { for (const b of $(id).children) b.classList.toggle('on', b.dataset.v === String(v)); };
    if (s.mode) set('mode', s.mode);
    if (s.battles) set('battles', s.battles);
    if (s.pace) set('pace', s.pace);
    if (s.ocolor) set('ocolor', s.ocolor);
    if (s.legend) set('legend', s.legend);
    if (s.elo) { $('elo').value = s.elo; $('elo').dispatchEvent(new Event('input')); }
    $('mode').dispatchEvent(new Event('click'));
  }

  /** Visa "Fortsätt" om ett lokalt parti finns sparat. */
  showContinue(saved) {
    const has = !!saved;
    $('continue').classList.toggle('hidden', !has);
    $('continue-info').classList.toggle('hidden', !has);
    if (!has) return;
    const n = Math.ceil(saved.moves.length / 2);
    const m = saved.settings.mode;
    const legend = m === 'legend' && LEGENDS.find((l) => l.id === saved.settings.legend);
    const who = legend ? legend.title : m === 'hotseat' ? 'Two players' : m === 'watch' ? 'Stockfish vs Stockfish'
      : `You are ${m === 'white' ? 'White' : 'Black'} vs Stockfish ${saved.settings.elo >= 3190 ? '(full)' : saved.settings.elo}`;
    $('continue-info').textContent = `Saved game: move ${n} · ${who}`;
  }

  onlineMsg(text) { $('online-msg').textContent = text || ''; }

  showInvite(code, link) {
    this.inviteCode = code;
    this.inviteLink = link;
    $('invite-code').textContent = code;
    $('invite-status').textContent = 'Waiting for your opponent';
    $('invite-status').classList.add('waiting');
    $('invite-share').textContent = navigator.share ? 'Share' : 'Copy';
    this.hide('menu');
    this.show('invite');
  }

  inviteStatus(text, waiting = false) {
    $('invite-status').textContent = text;
    $('invite-status').classList.toggle('waiting', waiting);
  }

  askDraw() {
    this.show('drawoffer');
    return new Promise((resolve) => {
      const done = (v) => { this.hide('drawoffer'); $('draw-accept').onclick = $('draw-decline').onclick = null; resolve(v); };
      $('draw-accept').onclick = () => done(true);
      $('draw-decline').onclick = () => done(false);
    });
  }

  setOnline(on) { document.body.classList.toggle('online', on); }

  setPhoto(on) { document.body.classList.toggle('photo', on); $('photobar').classList.toggle('hidden', !on); }
  setFrozen(on) { $('ph-freeze').textContent = on ? '▶' : '❚❚'; }
  setReplay(on) { document.body.classList.toggle('replay', on); $('replay-tag').classList.toggle('hidden', !on); }
  canReplay(on) { $('btn-replay').classList.toggle('hidden', !on); }

  readSettings() {
    const battles = this.seg('battles');
    $('btn-battle').classList.toggle('off', battles === 'quick');
    return { mode: this.seg('mode'), elo: +$('elo').value, battles, pace: +this.seg('pace'), legend: this.seg('legend') };
  }

  progress(frac, label) {
    $('progress-bar').style.width = `${Math.round(frac * 100)}%`;
    if (label) $('progress-label').textContent = label;
  }

  ready(onBegin) {
    const b = $('begin');
    b.disabled = false;
    $('progress-label').textContent = 'The pieces await.';
    b.addEventListener('click', () => {
      $('title').classList.add('fade');
      setTimeout(() => $('title').classList.add('hidden'), 1300);
      onBegin();
    }, { once: true });
  }

  reset() {
    this.canReplay(false);
    $('moves').innerHTML = '';
    $('cap-white').textContent = '';
    $('cap-black').textContent = '';
    this.show('hud');
    this.hide('menu');
    this.hide('over');
  }

  status(text, check = false) {
    const s = $('status');
    s.textContent = text;
    s.classList.toggle('check', check);
  }

  addMove(san, color) {
    const list = $('moves');
    for (const el of list.querySelectorAll('.last')) el.classList.remove('last');
    let li = list.lastElementChild;
    if (color === 'w' || !li) {
      li = document.createElement('li');
      li.innerHTML = '<span></span><span></span>';
      list.appendChild(li);
    }
    const span = li.children[color === 'w' ? 0 : 1];
    span.textContent = san;
    span.classList.add('last');
    list.scrollTop = list.scrollHeight;
  }

  rebuildMoves(history) {
    $('moves').innerHTML = '';
    $('cap-white').textContent = '';
    $('cap-black').textContent = '';
    for (const m of history) {
      this.addMove(m.san, m.color);
      if (m.captured) this.captured(m.captured, m.color === 'w' ? 'b' : 'w');
    }
  }

  /** En slagen pjäs av färgen `color` hamnar hos motståndarens rad. */
  captured(type, color) {
    $(color === 'w' ? 'cap-white' : 'cap-black').textContent += GLYPH[color][type];
  }

  toast(text, red = false) {
    const t = $('toast');
    t.textContent = text;
    t.classList.toggle('red', red);
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  }

  askPromotion(color) {
    this.show('promo');
    const row = document.querySelector('#promo .promo-row');
    for (const b of row.children) b.firstChild.textContent = GLYPH[color][b.dataset.p];
    return new Promise((resolve) => {
      const h = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        row.removeEventListener('click', h);
        this.hide('promo');
        resolve(b.dataset.p);
      };
      row.addEventListener('click', h);
    });
  }

  gameOver(title, text, st = null) {
    $('over-title').textContent = title;
    $('over-text').textContent = text;
    const box = $('over-stats');
    box.innerHTML = '';
    if (st) {
      const row = (k, v) => { const d = document.createElement('div'); d.className = 'st-row'; d.innerHTML = `<span></span><b></b>`; d.children[0].textContent = k; d.children[1].textContent = v; box.appendChild(d); };
      if (st.acc.w != null || st.acc.b != null) {
        const a = document.createElement('div');
        a.className = 'st-acc';
        for (const c of ['w', 'b']) {
          const v = st.acc[c];
          a.insertAdjacentHTML('beforeend', `<div><span>${c === 'w' ? 'White' : 'Black'}</span><b>${v == null ? '–' : v + '%'}</b><i style="--v:${v ?? 0}"></i></div>`);
        }
        box.appendChild(a);
      }
      if (st.blunder) row('Worst move', st.blunder.label);
      if (st.mvp) row('MVP', `${st.mvp.name} · ${st.mvp.kills} ${st.mvp.kills === 1 ? 'kill' : 'kills'}`);
    }
    this.show('over');
  }

  /** Titelkort för ett berömt parti: namn, plats och år, spelarna. */
  legendCard(l) {
    const c = $('legend-card');
    c.querySelector('.lc-title').textContent = l.title;
    c.querySelector('.lc-where').textContent = l.where;
    c.querySelector('.lc-players').textContent = `${l.white}  vs  ${l.black}`;
    c.classList.remove('hidden', 'go');
    void c.offsetWidth;
    c.classList.add('go');
    clearTimeout(this.legendTimer);
    this.legendTimer = setTimeout(() => c.classList.add('hidden'), 5200);
  }
}
