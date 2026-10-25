// Röster och inspelade ljudeffekter (ElevenLabs), med syntljudet som reserv.
// public/audio/manifest.json listar vilka filer som finns; saknas en fil spelas syntversionen.
//
// Talkanalen: bara en röst hörs åt gången. En replik som kommer medan någon annan talar får vänta på sin tur och stryks
// om den hunnit bli inaktuell. Småprat (välja, flytta, peta, uttråkad) tystnar när något annat kommer, och ett dödsskrik
// eller en avhuggen arm avbryter stridsropet. Härolden och karolinen väntar in den som talar i stället för att avbryta.
const CHATTER = 0, FIGHT = 1, CRY = 1.5, HERALD = 2, STORY = 3;
const KIND = { select: CHATTER, move: CHATTER, retreat: CHATTER, annoyed: CHATTER, bored: CHATTER, march: CHATTER,
  death: CRY, maimed: CRY, bull: STORY }; // bannbullan är ett nummer: biskopen väntar in sin tur
// så länge (s) en replik får vänta på sin tur innan den stryks
const PATIENCE = { [CHATTER]: 0, [FIGHT]: 1.0, [CRY]: 0.8, [HERALD]: 3.5, [STORY]: 6 };
const GAP = 0.12; // andningspaus mellan två repliker
export class Voice {
  constructor(sound) {
    this.sound = sound;
    this.manifest = { voice: {}, herald: {}, sfx: {} };
    this.buffers = new Map();
    this.lines = []; // talkanalen: { src, prio, start, end } i ljudklockans tid
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

  playBuffer(buf, { gain = 1, pan = 0, rate = 1, wet = 0.2, loop = false, fade = 0, voice = false, delay = 0 } = {}) {
    const s = this.sound;
    if (!s.ok || !buf) return null;
    const src = s.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.loop = loop;
    // röster går förbi bädden och duckar den så länge de hörs
    if (voice) s.duck(delay + buf.duration / rate);
    const out = s.out(fade ? 0 : gain, wet, pan, voice);
    if (fade) out.gain.linearRampToValueAtTime(gain, s.ctx.currentTime + fade);
    src.connect(out);
    src.start(s.ctx.currentTime + delay);
    return src;
  }

  /** Spela en replik i talkanalen (se överst). Ger tiden i sekunder tills repliken är slut, eller 0 om den ströks. */
  speak(buf, prio, opts) {
    const now = this.sound.ctx.currentTime;
    this.lines = this.lines.filter((l) => l.end > now);
    const cut = (l) => l.prio === CHATTER || (prio === CRY && l.prio === FIGHT);
    for (const l of this.lines) if (cut(l)) try { l.src.stop(); } catch { /* inte startad eller redan slut */ }
    this.lines = this.lines.filter((l) => !cut(l));
    if (this.lines.length && prio === CHATTER) return 0; // småprat väntar aldrig
    // härolden staplar inte: står ett utrop redan i kö stryks nästa
    if (prio === HERALD && this.lines.some((l) => l.prio === HERALD && l.start > now)) return 0;
    const delay = this.lines.length ? Math.max(...this.lines.map((l) => l.end)) + GAP - now : 0;
    if (delay > PATIENCE[prio]) return 0;
    const src = this.playBuffer(buf, { ...opts, voice: true, delay });
    if (!src) return 0;
    const end = now + delay + buf.duration / (opts.rate || 1);
    this.lines.push({ src, prio, start: now + delay, end });
    return end - now;
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
    const go = (buf) => (buf ? this.speak(buf, KIND[kind] ?? FIGHT, { gain: kind === 'death' ? 0.9 : 0.8, rate, wet: 0.18 }) : 0);
    const buf = this.buffers.get(u);
    if (buf) return go(buf);
    this.decode(u).then(go);
    return 2.6; // okänd längd: en rimlig gissning för väntan (granaten)
  }

  /** En namngiven röst utanför pjäserna (taunter, karolin). Returnerar längden i sekunder (gissning om ej avkodad). */
  say(who, kind, { gain = 0.9, rate = 1, wet = 0.2 } = {}) {
    const lines = this.manifest.voice[who]?.[kind];
    if (!lines?.length || !this.sound.ok || this.sound.hushed) return 0;
    const u = lines[Math.floor(Math.random() * lines.length)];
    const go = (buf) => (buf ? this.speak(buf, STORY, { gain, rate, wet }) : 0);
    const buf = this.buffers.get(u);
    if (buf) return go(buf);
    this.decode(u).then(go);
    return 2.2;
  }

  herald(key) {
    const buf = this.pick(this.manifest.herald[key]);
    if (!buf || this.sound.hushed) return;
    this.speak(buf, HERALD, { gain: 0.95, wet: 0.35, rate: 1 });
  }
}
