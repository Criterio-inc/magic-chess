// Röster och ljudeffekter med ElevenLabs, direkt med fetch (inga Python-paket behövs).
//   ELEVENLABS_API_KEY=… node tools/gen_audio.mjs [--voices] [--sfx] [--dry] [--limit N]
// Filnamnen är desamma som tools/make_audio_manifest.py räknar fram (hash av röst+text, eller av
// prompt+längd+loop+index), så en befintlig fil genereras aldrig om. Kör sedan make_audio_manifest.py.
// Rösterna görs med eleven_v3, som läser tonangivelser i hakparentes ([shouting]) som regi.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const doVoices = args.includes('--voices') || !args.includes('--sfx');
const doSfx = args.includes('--sfx') || !args.includes('--voices');
const key = process.env.ELEVENLABS_API_KEY;
if (!dry && !key) throw new Error('ELEVENLABS_API_KEY saknas');
const API = 'https://api.elevenlabs.io/v1';
const headers = { 'xi-api-key': key, 'content-type': 'application/json' };
const sha8 = (s) => createHash('sha1').update(s).digest('hex').slice(0, 8);

/** Fel som gäller hela kontot (nyckel, krediter) stoppar allt; övriga hoppar över just den filen. */
async function call(url, body) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (res.ok) return Buffer.from(await res.arrayBuffer());
  const err = (await res.text()).slice(0, 240);
  if (res.status === 401 || res.status === 402 || /quota|credit|payment/i.test(err)) throw new Error(`ElevenLabs ${res.status}: ${err}`);
  console.warn(`  hoppar över (${res.status}): ${err}`);
  return null;
}

const jobs = [];
if (doVoices) {
  const spec = JSON.parse(readFileSync('tools/voice_lines.json', 'utf8'));
  for (const [who, kinds] of Object.entries(spec.lines)) {
    const voice = spec.voices[who];
    for (const [kind, lines] of Object.entries(kinds)) {
      lines.forEach((text, i) => jobs.push({
        file: `public/audio/voice/${who}_${kind}_${i}_${sha8(`${voice}|${text}`)}.mp3`, chars: text.length, label: `${who}.${kind}`,
        run: () => call(`${API}/text-to-speech/${voice}?output_format=mp3_44100_128`, { text, model_id: 'eleven_v3' }),
      }));
    }
  }
}
if (doSfx) {
  // effektlistan och filnamnen kommer direkt från gen_sfx.py, så att Python och Node räknar likadant
  const list = JSON.parse(execFileSync('python3', ['-c',
    'import sys, json; sys.path.insert(0, "tools"); import gen_sfx; print(json.dumps([[k, p, d, l, gen_sfx.fname(k, p, d, l, i)] for (k, p, d, l, n) in gen_sfx.SFX for i in range(n)]))'],
  { encoding: 'utf8' }));
  for (const [k, prompt, dur, loop, name] of list) {
    jobs.push({ file: `public/audio/sfx/${name}`, chars: 0, label: `sfx.${k}`,
      run: () => call(`${API}/sound-generation?output_format=mp3_44100_128`, { text: prompt, duration_seconds: dur, loop }) });
  }
}

const todo = jobs.filter((j) => !existsSync(j.file)).slice(0, limit);
console.log(`${jobs.length} filer totalt, ${todo.length} att göra (${todo.reduce((n, j) => n + j.chars, 0)} tecken röst)`);
mkdirSync('public/audio/voice', { recursive: true });
let made = 0;
for (const j of todo) {
  if (dry) { console.log('  skulle göra', j.label, j.file); continue; }
  const buf = await j.run();
  if (!buf) continue;
  writeFileSync(j.file, buf);
  made++;
  console.log(`  ok ${j.label} (${(buf.length / 1024).toFixed(0)} KB)`);
}
console.log(`klart: ${made} nya filer`);
