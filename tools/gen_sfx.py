"""Ljudeffekter via ElevenLabs Sound Effects (elevenlabs-skillen saknar SFX-skript).

Filnamnen bär en hash av prompt+längd+loop: en befintlig fil genereras aldrig om (inga dubbla
debiteringar). Ändra en prompt så blir bara den nygenererad.
Kör: zsh -c 'source ~/.zprofile; python3 tools/gen_sfx.py [--dry]'
"""
import hashlib
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "audio", "sfx")
dry = "--dry" in sys.argv

# nyckel, prompt, sekunder, loop, antal varianter
SFX = [
    ("clang", "Sword striking polished marble armor, sharp metallic clang with bright ringing, close up, no music", 1.4, False, 3),
    ("whoosh", "Fast heavy sword swing whoosh through the air, close, no impact", 0.7, False, 2),
    ("shatter", "Marble statue toppling and shattering on a stone floor, heavy crack, stone chunks scattering and rolling, dusty", 3.0, False, 2),
    ("slam", "Massive stone golem fists slamming the ground, deep booming impact with rumble and falling pebbles", 2.2, False, 2),
    ("step", "Single armored footstep on polished marble floor in an open courtyard, close", 0.5, False, 3),
    ("step_golem", "Single very heavy stone golem footstep, deep thud with grinding gravel", 0.9, False, 2),
    ("magic_cast", "Sorceress casting an arcane energy bolt, rising magical whoosh with crackling sparkles", 1.6, False, 2),
    ("magic_impact", "Arcane energy bolt exploding on impact, bright magical blast with sparkling tail", 1.8, False, 2),
    ("holy", "Holy light smite, short angelic choir shimmer with a bright bell-like impact", 2.2, False, 2),
    ("sting_check", "Short tense orchestral sting, staccato low brass hit and timpani, medieval", 2.0, False, 1),
    ("fanfare_win", "Triumphant medieval brass fanfare with timpani roll, victorious, short", 5.0, False, 1),
    ("fanfare_lose", "Somber medieval brass and slow drum, defeat lament, short", 4.5, False, 1),
    ("promote", "Magical transformation, shimmering rising chimes and a soft whoosh of light", 2.5, False, 1),
    ("select", "Small marble chess piece lifted with a soft stone clink", 0.5, False, 2),
    ("coconut", "Two coconut halves clapped together imitating a single horse hoof step, clip-clop, dry and comedic, close", 0.5, False, 4),
    ("thunder", "Close lightning strike, sharp electric crack followed by a deep rolling thunder boom", 3.0, False, 2),
    ("ice_freeze", "Water instantly freezing into ice, crackling frost spreading over a statue", 1.5, False, 1),
    ("ice_shatter", "Ice statue shattering into crystalline shards, glassy tinkling debris", 2.2, False, 2),
    ("holy_beam", "Holy light beam descending from the sky, shimmering choir swell and radiant hum", 2.2, False, 1),
    ("punch", "Massive stone fist uppercut impact, heavy crunching punch with a whoosh", 1.0, False, 2),
    ("fatality", "Deep ominous gong hit with a dramatic low boom and reverb tail", 3.0, False, 1),
    ("crumble", "Stone statue crumbling into rubble and dust, gravel pouring down", 2.5, False, 2),
    ("arm_crack", "Marble arm snapping off a statue, sharp stone crack and chunks clattering", 1.2, False, 2),
    ("frost_ray", "Icy magical beam fired from hands, cold whoosh with crystalline sparkles", 1.5, False, 1),
    ("holy_grenade", "Angelic choir sings a short glorious hallelujah chord, then a huge holy explosion", 4.0, False, 1),
    ("rabbit_snarl", "Small rabbit letting out a vicious monstrous snarl and frenzied bite, comedic and fierce", 1.6, False, 1),
    ("rabbit_hop", "Single light soft hop of a small animal on stone, thump", 0.5, False, 2),
    ("foot_stomp", "Giant foot comically stomping down from the sky with a massive squash and a short raspberry noise", 2.6, False, 1),
    ("shutter", "Vintage camera shutter click with film advance", 0.6, False, 1),
    ("rewind", "VHS tape rewinding, fast whirring scrub sound", 1.2, False, 1),
    ("leap", "Huge heavy stone creature leaping through the air, deep powerful whoosh", 1.2, False, 1),
    ("owl", "Distant owl hooting twice at night", 2.5, False, 1),
    ("crickets", "Night ambience with soft crickets chirping in grass, calm, loopable", 14.0, True, 1),
    ("wind", "Gentle wind over ancient ruins on a warm late afternoon, distant birds, calm ambience", 22.0, True, 1),
    ("fire", "Crackling fire burning in an iron brazier, steady, close", 12.0, True, 1),
]


def fname(key, prompt, dur, loop, i):
    h = hashlib.sha1(f"{prompt}|{dur}|{loop}|{i}".encode()).hexdigest()[:8]
    return f"{key}_{i}_{h}.mp3"


def main():
    os.makedirs(OUT, exist_ok=True)
    todo = [(k, p, d, l, i) for (k, p, d, l, n) in SFX for i in range(n) if not os.path.exists(os.path.join(OUT, fname(k, p, d, l, i)))]
    secs = sum(d for (_, _, d, _, _) in todo)
    print(f"{len(todo)} effekter att generera, {secs:.1f} s ljud totalt")
    if dry or not todo:
        for t in todo:
            print("  ", t[0], t[4], f"{t[2]} s", "(loop)" if t[3] else "")
        return
    from elevenlabs.client import ElevenLabs
    key = os.getenv("ELEVENLABS_API_KEY")
    if not key:
        sys.exit("ELEVENLABS_API_KEY saknas i miljön")
    client = ElevenLabs(api_key=key)
    for (k, p, d, l, i) in todo:
        dst = os.path.join(OUT, fname(k, p, d, l, i))
        try:
            audio = client.text_to_sound_effects.convert(text=p, duration_seconds=d, prompt_influence=0.55, loop=l,
                                                         output_format="mp3_44100_128")
            data = b"".join(audio)
            with open(dst, "wb") as f:
                f.write(data)
            print("  ok", os.path.basename(dst), len(data) // 1024, "KB")
        except Exception as e:  # en misslyckad effekt ska inte stoppa resten
            print("  FEL", k, i, e)


if __name__ == "__main__":
    main()
