// Syntetiserat ljud (Web Audio): steg på sten, klang av stål, krossad marmor, magi, vind och eld.
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  unlock() {
    // iOS: tystknappen stänger annars av Web Audio
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* äldre webbläsare */ }
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    // tegelvägg sist: granaten, foten och åskan får inte slå i taket
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.002;
    limit.release.value = 0.15;
    this.master.connect(comp).connect(limit).connect(ctx.destination);
    // allt utom röster går genom "bädden", som duckar när någon talar
    this.bed = ctx.createGain();
    this.bed.connect(this.master);
    // gemensamt rum: kort efterklang från en syntetisk impulsrespons
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(2.2, 2.8);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.22;
    this.verb.connect(this.verbGain).connect(this.master);
    this.noiseBuf = this.makeNoise(2);
    // musiken går förbi efterklangen och har egen nivå
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.bed);
    this.ambience();
    if (this.pendingMusic) this.playMusic(this.pendingMusic);
  }

  /** Spela en slinga (titelmusiken). Kan anropas före unlock; startar då vid första klicket. */
  async playMusic(url, level = 0.5, fade = 2.5) {
    if (!this.ctx) { this.pendingMusic = url; return; }
    if (!this.musicBuf || this.musicUrl !== url) {
      this.musicUrl = url;
      try {
        const data = await fetch(url).then((r) => r.arrayBuffer());
        this.musicBuf = await this.ctx.decodeAudioData(data);
      } catch { return; }
    }
    if (!this.musicSrc) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.musicBuf;
      src.loop = true;
      src.connect(this.musicGain);
      src.start();
      this.musicSrc = src;
    }
    this.setMusic(level, fade);
  }

  setMusic(level, fade = 2) {
    if (!this.musicGain) return;
    const g = this.musicGain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(level, t + fade);
  }

  setEnabled(on) {
    this.enabled = on;
    this.applyMaster();
  }

  applyMaster() {
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? (this.hushed ? 0.12 : 0.8) : 0, this.ctx.currentTime, 0.08);
  }

  /** Snabbspolning: nästan tyst så att åttafaldig fart inte blir ett kakofoniskt mischmasch. */
  hush(on) {
    this.hushed = on;
    this.applyMaster();
  }

  /** Sänk musik och effekter medan en röst talar (sek), och lyft dem mjukt igen efteråt. */
  duck(sec) {
    if (!this.bed) return;
    const t = this.ctx.currentTime;
    const until = Math.max(this.duckUntil || 0, t + sec);
    this.duckUntil = until;
    const g = this.bed.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.5, t, 0.05);
    g.setTargetAtTime(1, until, 0.25);
  }

  makeNoise(sec) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  impulse(sec, decay) {
    const sr = this.ctx.sampleRate;
    const b = this.ctx.createBuffer(2, sr * sec, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay);
    }
    return b;
  }

  out(gain = 1, wet = 0.3, pan = 0, voice = false) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(voice ? this.master : this.bed);
    if (wet > 0) {
      const w = this.ctx.createGain();
      w.gain.value = wet;
      g.connect(w).connect(this.verb);
    }
    return g;
  }

  noise(dest, t, dur, { type = 'lowpass', f0 = 800, f1 = f0, q = 1, gain = 1, attack = 0.002 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  tone(dest, t, freq, dur, { type = 'sine', gain = 0.3, attack = 0.002, f1 = freq } = {}) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (f1 !== freq) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  get ok() { return this.ctx && this.enabled; }

  step(heavy = 1, pan = 0) {
    if (!this.ok) return;
    if (this.bank?.sfx(heavy > 1.3 ? 'step_golem' : 'step', { pan, gain: 0.45 * Math.min(heavy, 1.2) })) return;
    const t = this.ctx.currentTime, d = this.out(0.35 * heavy, 0.15, pan);
    this.noise(d, t, 0.09 + 0.06 * heavy, { f0: 500 * (1.4 - heavy * 0.4), f1: 120, gain: 0.9 });
    this.tone(d, t, 70 + Math.random() * 20, 0.12 * heavy, { gain: 0.5 * heavy, f1: 40 });
  }

  clang(pan = 0) {
    if (!this.ok) return;
    if (this.bank?.sfx('clang', { pan, gain: 0.9 })) return;
    const t = this.ctx.currentTime, d = this.out(0.5, 0.45, pan);
    this.noise(d, t, 0.06, { type: 'highpass', f0: 3000, gain: 0.9 });
    const base = 520 + Math.random() * 160;
    for (const [m, g, dur] of [[1, 0.3, 1.2], [2.76, 0.18, 0.9], [5.4, 0.12, 0.6], [8.93, 0.08, 0.4], [1.51, 0.12, 1.0]]) {
      this.tone(d, t, base * m, dur, { gain: g });
    }
  }

  whoosh(pan = 0) {
    if (!this.ok) return;
    if (this.bank?.sfx('whoosh', { pan, gain: 0.7 })) return;
    const t = this.ctx.currentTime, d = this.out(0.45, 0.1, pan);
    this.noise(d, t, 0.35, { type: 'bandpass', f0: 400, f1: 2400, q: 2.5, gain: 0.8, attack: 0.15 });
  }

  thud(pan = 0, big = 1) {
    if (!this.ok) return;
    if (this.bank?.sfx('slam', { pan, gain: big })) return;
    const t = this.ctx.currentTime, d = this.out(0.9 * big, 0.4, pan);
    this.tone(d, t, 90, 0.6 * big, { gain: 0.9, f1: 32 });
    this.noise(d, t, 0.5 * big, { f0: 900, f1: 80, gain: 0.9 });
  }

  shatter(pan = 0) {
    if (!this.ok) return;
    if (this.bank?.sfx('shatter', { pan, gain: 1 })) return;
    const t = this.ctx.currentTime, d = this.out(0.8, 0.45, pan);
    this.noise(d, t, 0.7, { f0: 2500, f1: 200, gain: 0.9 });
    this.tone(d, t, 110, 0.5, { gain: 0.6, f1: 40 });
    // småbitar som studsar
    for (let i = 0; i < 26; i++) {
      const tt = t + 0.04 + Math.random() * 1.1 * Math.random();
      this.noise(d, tt, 0.03 + Math.random() * 0.04, { type: 'bandpass', f0: 2000 + Math.random() * 4000, q: 4, gain: 0.25 + Math.random() * 0.35 });
    }
  }

  magic(pan = 0) {
    if (!this.ok) return;
    if (this.bank?.sfx('magic_cast', { pan, gain: 0.8 })) return;
    const t = this.ctx.currentTime, d = this.out(0.35, 0.6, pan);
    for (let i = 0; i < 5; i++) this.tone(d, t + i * 0.04, 600 * (1 + i * 0.5), 0.9, { type: 'triangle', gain: 0.12, f1: 1800 * (1 + i * 0.3) });
    this.noise(d, t, 0.8, { type: 'bandpass', f0: 1500, f1: 6000, q: 3, gain: 0.25, attack: 0.3 });
  }

  boom(pan = 0) {
    if (!this.ok) return;
    if (this.bank?.sfx('magic_impact', { pan, gain: 0.9 })) return;
    const t = this.ctx.currentTime, d = this.out(0.7, 0.6, pan);
    this.tone(d, t, 220, 0.9, { type: 'sawtooth', gain: 0.15, f1: 60 });
    this.noise(d, t, 1.0, { f0: 4000, f1: 300, gain: 0.7 });
    for (const f of [880, 1320, 1760]) this.tone(d, t, f, 1.4, { gain: 0.06 });
  }

  chime() {
    if (!this.ok) return;
    if (this.bank?.sfx('holy', { gain: 0.8 })) return;
    const t = this.ctx.currentTime, d = this.out(0.3, 0.6);
    [784, 988, 1175].forEach((f, i) => this.tone(d, t + i * 0.09, f, 1.2, { gain: 0.14, type: 'triangle' }));
  }

  check() {
    if (!this.ok) return;
    if (this.bank?.sfx('sting_check', { gain: 0.7, rate: 1 })) return;
    const t = this.ctx.currentTime, d = this.out(0.35, 0.5);
    [440, 415].forEach((f, i) => this.tone(d, t + i * 0.18, f, 0.6, { gain: 0.18, type: 'square' }));
  }

  fanfare(win = true) {
    if (!this.ok) return;
    if (this.bank?.sfx(win ? 'fanfare_win' : 'fanfare_lose', { gain: 0.8, rate: 1 })) return;
    const t = this.ctx.currentTime, d = this.out(0.35, 0.6);
    const notes = win ? [523, 659, 784, 1047] : [392, 349, 311, 262];
    notes.forEach((f, i) => { this.tone(d, t + i * 0.22, f, 0.9, { type: 'sawtooth', gain: 0.07 }); this.tone(d, t + i * 0.22, f / 2, 0.9, { gain: 0.12 }); });
  }

  /** Byt syntvinden mot inspelade slingor när banken är avkodad. */
  startLoops() {
    if (!this.bank || this.sampleLoops) return;
    const wind = this.bank.loop('wind', 0.35);
    const fire = this.bank.loop('fire', 0.12);
    if (wind || fire) {
      this.sampleLoops = [wind, fire];
      if (wind) { this.synthWindLfo.disconnect(); this.synthWind.gain.setTargetAtTime(0, this.ctx.currentTime, 1.5); }
    }
  }

  ambience() {
    // vind: brus genom ett långsamt svepande bandpass
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.makeNoise(4);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 400;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 220;
    lfo.connect(lg).connect(f.frequency);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.13;
    const lg2 = ctx.createGain();
    lg2.gain.value = 0.025;
    lfo2.connect(lg2).connect(g.gain);
    this.synthWindLfo = lg2;
    src.connect(f).connect(g).connect(this.bed);
    src.start(); lfo.start(); lfo2.start();
    this.synthWind = g;
    // eldsprak från glödfaten
    const crackle = () => {
      if (this.enabled && !this.sampleLoops) {
        const t = ctx.currentTime, d = this.out(0.05, 0.1, Math.random() * 2 - 1);
        this.noise(d, t, 0.02 + Math.random() * 0.03, { type: 'highpass', f0: 1500 + Math.random() * 3000, gain: 0.6 });
      }
      setTimeout(crackle, 60 + Math.random() * 400);
    };
    crackle();
  }
}
