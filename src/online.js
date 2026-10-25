// Onlinespel mot servern (server/PROTOCOL.md). Servern är auktoritativ; klienten skickar drag och
// spelar upp de drag servern bekräftar. Sessionen {code, token} sparas så att en omladdning återansluter.
// Åskådare (watch) har ingen session: bara koden, i minnet.
const KEY = 'bc.online';

export class Online {
  constructor() {
    this.handlers = {};
    this.listeners = {};
    this.ws = null;
    this.queue = [];
    this.retry = 0;
    this.session = load();
    this.watching = null; // koden för rummet vi tittar på som åskådare
  }

  /** En hanterare per händelse (main.js); en ny ersätter den gamla. */
  on(ev, fn) { this.handlers[ev] = fn; return this; }
  /** Extra lyssnare (online-extras.js) som körs efter hanteraren och aldrig ersätter något. */
  listen(ev, fn) { (this.listeners[ev] ||= []).push(fn); return this; }
  emit(ev, msg) {
    this.handlers[ev]?.(msg);
    for (const fn of this.listeners[ev] || []) fn(msg);
  }

  get active() { return !!this.session || !!this.watching; }

  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    // felsökning: sessionStorage 'bc.ws' pekar just den här fliken mot en annan server (överlever omladdning)
    let url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    try { url = sessionStorage.getItem('bc.ws') || url; } catch { /* privat läge */ }
    const ws = (this.ws = new WebSocket(url));
    ws.onopen = () => {
      this.retry = 0;
      this.emit('connection', { online: true });
      if (this.watching) this.send({ t: 'watch', code: this.watching });
      else if (this.session) this.send({ t: 'rejoin', code: this.session.code, token: this.session.token }, true);
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
      clearInterval(this.pinger);
      this.pinger = setInterval(() => this.send({ t: 'ping' }), 20000);
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (window.BC_DEBUG && m.t !== 'pong') console.info('[BC] online <-', JSON.stringify(m).slice(0, 200));
      if (m.t === 'created' || m.t === 'joined') this.save({ code: m.code, token: m.token, color: m.color });
      if (m.t === 'error' && (m.code === 'bad-token' || m.code === 'no-such-room') && this.session && this.rejoining) this.forget();
      // rummet finns inte (längre): sluta titta och sluta återansluta
      if (m.t === 'error' && (m.code === 'no-such-room' || m.code === 'room-full') && this.watching) {
        m.wasWatching = this.watching;
        this.setWatching(null);
        this.wanted = false;
      }
      this.rejoining = false;
      this.emit(m.t, m);
    };
    ws.onclose = () => {
      clearInterval(this.pinger);
      this.emit('connection', { online: false });
      if (!this.session && !this.wanted) return;
      // återanslut med växande paus (1, 2, 4 … 15 s)
      const wait = Math.min(15000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
  }

  send(msg, rejoin = false) {
    if (window.BC_DEBUG && msg.t !== 'ping') console.info('[BC] online ->', JSON.stringify(msg));
    if (rejoin) this.rejoining = true;
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
    else { this.queue.push(msg); this.connect(); }
  }

  /** Be om serverns ställning igen (svaret kommer som 'joined', för åskådare som 'watching'). */
  resync() {
    if (this.watching) this.send({ t: 'watch', code: this.watching });
    else if (this.session) this.send({ t: 'rejoin', code: this.session.code, token: this.session.token }, true);
  }

  create(color, name) { this.setWatching(null); this.wanted = true; this.send({ t: 'create', color, ...(name ? { name } : {}) }); }
  join(code, name) { this.setWatching(null); this.wanted = true; this.send({ t: 'join', code: code.trim().toUpperCase(), ...(name ? { name } : {}) }); }

  /** Titta på ett rum som åskådare. Den sparade spelarsessionen lämnas orörd i localStorage
   *  (en annan flik kan spela i rummet), men används inte här: en rejoin skulle ta över platsen. */
  watch(code) {
    this.wanted = true;
    this.session = null;
    this.setWatching(code.trim().toUpperCase());
    if (this.ws?.readyState === 1) this.send({ t: 'watch', code: this.watching });
    else this.connect(); // onopen skickar watch
  }

  setWatching(code) {
    this.watching = code || null;
    document.body.classList.toggle('spectating', !!this.watching);
    // åskådarläget står i adressen (?watch=KOD), så att en omladdning – även Vites – fortsätter titta
    const u = new URL(location.href);
    if (this.watching) u.searchParams.set('watch', this.watching);
    else u.searchParams.delete('watch');
    if (u.href !== location.href) history.replaceState(null, '', u);
  }

  taunt(id) { this.send({ t: 'taunt', id }); }
  move(m, ply) { this.send({ t: 'move', from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}), ply }); }
  resign() { this.send({ t: 'resign' }); }
  offerDraw() { this.send({ t: 'draw-offer' }); }
  answerDraw(accept) { this.send({ t: 'draw-answer', accept }); }
  rematch() { this.send({ t: 'rematch' }); }

  leave() {
    if (this.watching) { // åskådare: rör inte flikarnas sparade session
      if (this.ws?.readyState === 1) this.send({ t: 'leave' });
      this.setWatching(null);
    }
    else {
      if (this.session) this.send({ t: 'leave' });
      this.forget();
    }
    this.wanted = false;
  }

  save(s) {
    this.session = { ...this.session, ...s };
    try { localStorage.setItem(KEY, JSON.stringify(this.session)); } catch { /* privat läge */ }
  }

  forget() {
    this.session = null;
    try { localStorage.removeItem(KEY); } catch { /* privat läge */ }
  }

  inviteLink(code, kind = 'join') {
    const u = new URL(location.href);
    u.search = `?${kind}=${code}`;
    u.hash = '';
    return u.toString();
  }
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
