"""Skriver public/audio/manifest.json utifrån filerna i public/audio/{voice,sfx}.

Bara filer som motsvarar nuvarande repliker/promptar tas med (gamla tagningar ligger kvar på disk).
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUD = os.path.join(ROOT, "public", "audio")

spec = json.load(open(os.path.join(ROOT, "tools", "voice_lines.json")))
man = {"voice": {}, "herald": {}, "sfx": {}}
for who, kinds in spec["lines"].items():
    voice = spec["voices"][who]
    for kind, lines in kinds.items():
        for i, text in enumerate(lines):
            h = hashlib.sha1(f"{voice}|{text}".encode()).hexdigest()[:8]
            name = f"{who}_{kind}_{i}_{h}.mp3"
            if not os.path.exists(os.path.join(AUD, "voice", name)):
                continue
            url = f"/audio/voice/{name}"
            if who == "herald":
                man["herald"].setdefault(kind, []).append(url)
            else:
                man["voice"].setdefault(who, {}).setdefault(kind, []).append(url)

import gen_sfx

for (k, p, d, l, n) in gen_sfx.SFX:
    for i in range(n):
        f = gen_sfx.fname(k, p, d, l, i)
        if os.path.exists(os.path.join(AUD, "sfx", f)):
            man["sfx"].setdefault(k, []).append(f"/audio/sfx/{f}")

with open(os.path.join(AUD, "manifest.json"), "w") as fp:
    json.dump(man, fp, indent=1)
n_v = sum(len(v) for k in man["voice"].values() for v in k.values()) + sum(len(v) for v in man["herald"].values())
print(f"manifest: {n_v} repliker, {sum(len(v) for v in man['sfx'].values())} effekter")
