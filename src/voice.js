// Röster och inspelade ljudeffekter (ElevenLabs), med syntljudet som reserv.
// public/audio/manifest.json listar vilka filer som finns; saknas en fil spelas syntversionen.
export class Voice {
  constructor(sound) {
    this.sound = sound;
    this.manifest = { voice: {}, herald: {}, sfx: {} };
    this.buffers = new Map();
    this.speaking = null;
    this.lastHerald = 0;
  }

  async load() {
    try {
      this.manifest = await fetch('audio/manifest.json').then((r) => (r.ok ? r.json() : this.manifest));
    } catch { /* inga inspelningar ännu */ }
  }

  /** Avkoda effekter och härolden i förväg; pjäsernas repliker avkodas när de först behövs
   *  (alla avkodade på en gång tar >100 MB minne, för mycket för en mobil). */
  async decodeAll() {
    const ctx = this.sound.ctx;
    if (!ctx) return;
    const urls = new Set();
    const walk = (o) => { for (const v of Object.values(o)) Array.isArray(v) ? v.forEach((u) => urls.add(u)) : typeof v === 'object' && walk(v); };
    walk(this.manifest.sfx);
    walk(this.manifest.herald);
    await Promise.all([...urls].map((u) => this.decode(u)));
    this.sound.bank = this;
  }

  decode(u) {
    if (this.buffers.has(u)) return Promise.resolve(this.buffers.get(u));
    if (!this.pending) this.pending = new Map();
    if (this.pending.has(u)) return this.pending.get(u);
    const p = fetch(u).then((r) => r.arrayBuffer()).then((b) => this.sound.ctx.decodeAudioData(b))
      .then((buf) => { this.buffers.set(u, buf); this.pending.delete(u); return buf; })
      .catch(() => { this.pending.delete(u); return null; });
    this.pending.set(u, p);
    return p;
  }

  pick(list) {
    if (!list || !list.length) return null;
    const avail = list.filter((u) => this.buffers.has(u));
    if (!avail.length) return null;
    // undvik att samma tagning kommer två gånger i rad
    let u;
    do { u = avail[Math.floor(Math.random() * avail.length)]; } while (avail.length > 1 && u === this.lastPick);
    this.lastPick = u;
    return this.buffers.get(u);
  }

  playBuffer(buf, { gain = 1, pan = 0, rate = 1, wet = 0.2, loop = false, fade = 0, voice = false } = {}) {
    const s = this.sound;
    if (!s.ok || !buf) return null;
    const src = s.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.loop = loop;
    // röster går förbi bädden och duckar den så länge de hörs
    if (voice) s.duck(buf.duration / rate);
    const out = s.out(fade ? 0 : gain, wet, pan, voice);
    if (fade) out.gain.linearRampToValueAtTime(gain, s.ctx.currentTime + fade);
    src.connect(out);
    src.start();
    return src;
  }

  /** Inspelad effekt om den finns. Returnerar true om något spelades. */
  sfx(name, opts = {}) {
    const buf = this.pick(this.manifest.sfx[name]);
    if (!buf) return false;
    this.playBuffer(buf, { rate: opts.rate ?? 0.94 + Math.random() * 0.12, ...opts });
    return true;
  }

  loop(name, gain, fade = 0) {
    const buf = this.pick(this.manifest.sfx[name]);
    return buf ? this.playBuffer(buf, { gain, loop: true, wet: 0, rate: 1, fade }) : null;
  }

  /** Pjäsens replik (select, move, retreat, attack, hit, maimed, death, kill, annoyed, bored, check, bull).
   *  Svarta pjäser låter något mörkare. Returnerar replikens längd i sekunder (0 om den inte är avkodad än). */
  piece(piece, kind) {
    if (this.sound.hushed) return 0;
    const set = this.manifest.voice[piece.name] || {};
    const lines = set[kind] || (kind === 'retreat' ? set.move : null) || ((kind === 'move' || kind === 'retreat' || kind === 'annoyed') ? set.select : null);
    if (!lines?.length || !this.sound.ok) return 0;
    let u;
    do { u = lines[Math.floor(Math.random() * lines.length)]; } while (lines.length > 1 && u === this.lastLine);
    this.lastLine = u;
    const rate = piece.color === 'b' ? 0.92 : 1.0;
    const go = (buf) => {
      if (!buf) return;
      if ((kind === 'select' || kind === 'move') && this.speaking) try { this.speaking.stop(); } catch { /* redan slut */ }
      this.speaking = this.playBuffer(buf, { gain: kind === 'death' ? 0.9 : 0.8, rate, wet: 0.18, voice: true });
    };
    const buf = this.buffers.get(u);
    if (buf) { go(buf); return buf.duration / rate; }
    this.decode(u).then(go);
    return 2.6; // okänd längd: en rimlig gissning för väntan (granaten)
  }

  /** En namngiven röst utanför pjäserna (taunter, karolin). Returnerar längden i sekunder (gissning om ej avkodad). */
  say(who, kind, { gain = 0.9, rate = 1, wet = 0.2 } = {}) {
    const lines = this.manifest.voice[who]?.[kind];
    if (!lines?.length || !this.sound.ok || this.sound.hushed) return 0;
    const u = lines[Math.floor(Math.random() * lines.length)];
    const go = (buf) => buf && this.playBuffer(buf, { gain, rate, wet, voice: true });
    const buf = this.buffers.get(u);
    if (buf) { go(buf); return buf.duration / rate; }
    this.decode(u).then(go);
    return 2.2;
  }

  herald(key) {
    const buf = this.pick(this.manifest.herald[key]);
    if (!buf || this.sound.hushed) return;
    const now = performance.now();
    if (now - this.lastHerald < 700) return;
    this.lastHerald = now;
    this.playBuffer(buf, { gain: 0.95, wet: 0.35, rate: 1, voice: true });
  }
}
