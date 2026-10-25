"""Genererar pjäsernas och härolden repliker via elevenlabs-dialogue-skillens generate_dialogue.py.

En mp3 per replik. Skillens cache (build/voice/.segments) gör att oförändrade repliker aldrig
debiteras igen; ändra bara en rad i tools/voice_lines.json så görs bara den om.
Kör: zsh -c 'source ~/.zprofile; python3 tools/gen_voice.py [--dry]'
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL = os.path.expanduser("~/Projekt/claude-code-demo-creator/skills/elevenlabs-dialogue/scripts/generate_dialogue.py")
BUILD = os.path.join(ROOT, "build", "voice")
OUT = os.path.join(ROOT, "public", "audio", "voice")
dry = "--dry" in sys.argv

spec = json.load(open(os.path.join(ROOT, "tools", "voice_lines.json")))
os.makedirs(os.path.join(BUILD, "json"), exist_ok=True)
os.makedirs(OUT, exist_ok=True)
total_chars = 0
jobs = []
for who, kinds in spec["lines"].items():
    voice = spec["voices"][who]
    for kind, lines in kinds.items():
        for i, text in enumerate(lines):
            # filnamnet bär en hash av text+röst: ändrad replik = ny fil, gamla ligger kvar orörda
            h = hashlib.sha1(f"{voice}|{text}".encode()).hexdigest()[:8]
            name = f"{who}_{kind}_{i}_{h}"
            jobs.append((name, voice, text))
            total_chars += len(text)

print(f"{len(jobs)} repliker, {total_chars} tecken")
for name, voice, text in jobs:
    dst = os.path.join(OUT, name + ".mp3")
    if os.path.exists(dst):
        continue
    if dry:
        print("  skulle generera", name, "|", text)
        continue
    jp = os.path.join(BUILD, "json", name + ".json")
    json.dump([{"text": text, "voice_id": voice}], open(jp, "w"))
    mp3 = os.path.join(BUILD, name + ".mp3")
    r = subprocess.run([sys.executable, SKILL, "--input", jp, "--output", mp3, "--output-format", "mp3_44100_128"],
                       capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(mp3):
        print("  FEL", name, r.stderr[-400:])
        continue
    shutil.copy(mp3, dst)
    print("  ok", name)
