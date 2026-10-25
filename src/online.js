// Onlinespel mot servern (server/PROTOCOL.md). Servern är auktoritativ; klienten skickar drag och
// spelar upp de drag servern bekräftar. Sessionen {code, token} sparas så att en omladdning återansluter.
const KEY = 'bc.online';

export class Online {
  constructor() {
    this.handlers = {};
    this.ws = null;
    this.queue = [];
    this.retry = 0;
    this.session = load();
  }

  on(ev, fn) { this.handlers[ev] = fn; return this; }
  emit(ev, msg) { this.handlers[ev]?.(msg); }

  get active() { return !!this.session; }

  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = (this.ws = new WebSocket(url));
    ws.onopen = () => {
      this.retry = 0;
      this.emit('connection', { online: true });
      if (this.session) this.send({ t: 'rejoin', code: this.session.code, token: this.session.token }, true);
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

  /** Be om serverns ställning igen (svaret kommer som 'joined'). */
  resync() {
    if (this.session) this.send({ t: 'rejoin', code: this.session.code, token: this.session.token }, true);
  }

  create(color, name) { this.wanted = true; this.send({ t: 'create', color, ...(name ? { name } : {}) }); }
  join(code, name) { this.wanted = true; this.send({ t: 'join', code: code.trim().toUpperCase(), ...(name ? { name } : {}) }); }
  move(m, ply) { this.send({ t: 'move', from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}), ply }); }
  resign() { this.send({ t: 'resign' }); }
  offerDraw() { this.send({ t: 'draw-offer' }); }
  answerDraw(accept) { this.send({ t: 'draw-answer', accept }); }
  rematch() { this.send({ t: 'rematch' }); }

  leave() {
    if (this.session) this.send({ t: 'leave' });
    this.forget();
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

  inviteLink(code) {
    const u = new URL(location.href);
    u.search = `?join=${code}`;
    u.hash = '';
    return u.toString();
  }
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
