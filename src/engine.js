// Stockfish 19 (WASM, en tråd) i en Web Worker via UCI.
export class Engine {
  constructor(url = '/engine/stockfish-19-lite-single.js') {
    this.worker = new Worker(url);
    this.waiters = [];
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      if (this.infoListener && line.startsWith('info')) this.infoListener(line);
      for (const w of [...this.waiters]) {
        if (w.test(line)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(line);
        }
      }
    };
    this.ready = this.init();
  }

  send(cmd) { this.worker.postMessage(cmd); }

  waitFor(re) {
    return new Promise((resolve) => this.waiters.push({ test: (l) => re.test(l), resolve }));
  }

  async init() {
    const ok = this.waitFor(/^uciok/);
    this.send('uci');
    await ok;
    this.send('setoption name Hash value 32');
    await this.isReady();
  }

  async isReady() {
    const r = this.waitFor(/^readyok/);
    this.send('isready');
    await r;
  }

  /** elo 1320..3190 begränsar styrkan; null = full styrka. */
  async setStrength(elo) {
    await this.ready;
    if (elo == null || elo >= 3190) {
      this.send('setoption name UCI_LimitStrength value false');
    } else {
      this.send('setoption name UCI_LimitStrength value true');
      this.send(`setoption name UCI_Elo value ${Math.max(1320, Math.round(elo))}`);
    }
    this.strong = elo == null || elo >= 3190;
    await this.isReady();
  }

  newGame() {
    this.send('ucinewgame');
  }

  /** Värdera en ställning: centibönder ur draget-partens perspektiv (matt räknas om till ±10000) och bästa drag.
   *  Anropen köas, så en analysmotor kan få många förfrågningar utan att de krockar. */
  evaluate(fen, movetime = 250) {
    this.chain = (this.chain || Promise.resolve()).then(async () => {
      await this.ready;
      let cp = 0;
      this.infoListener = (l) => {
        const m = l.match(/score (cp|mate) (-?\d+)/);
        if (!m) return;
        const v = +m[2];
        cp = m[1] === 'cp' ? v : v > 0 ? 10000 - v * 100 : -10000 - v * 100;
      };
      const done = this.waitFor(/^bestmove/);
      this.send(`position fen ${fen}`);
      this.send(`go movetime ${movetime}`);
      const line = await done;
      this.infoListener = null;
      const best = line.split(/\s+/)[1];
      return { cp, best: best && best !== '(none)' ? best : null };
    }).catch(() => ({ cp: 0, best: null }));
    return this.chain;
  }

  /** Bästa draget i UCI-format (t.ex. 'e2e4', 'e7e8q'). */
  async bestMove(fen, movetime = 900) {
    await this.ready;
    this.send('stop');
    await this.isReady();
    const done = this.waitFor(/^bestmove/);
    this.send(`position fen ${fen}`);
    this.send(`go movetime ${movetime}`);
    const line = await done;
    const m = line.split(/\s+/)[1];
    return m && m !== '(none)' ? m : null;
  }
}
