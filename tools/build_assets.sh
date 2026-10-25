#!/usr/bin/env bash
# Hela tillgångskedjan: Blender (pjäser + arena + extras) -> meshopt-komprimering -> public/.
# Kör högst en Blender åt gången (16 GB-maskin).
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
mkdir -p build/models public/models public/tex public/hdri

if [ "${1:-}" != "--skip-blender" ]; then
  "$BLENDER" -b -P blender/pieces.py -- "$@" 2>&1 | grep -E "Error|Traceback|tris=" || true
  "$BLENDER" -b -P blender/arena.py 2>&1 | grep -E "Error|Traceback|ARENA" || true
  "$BLENDER" -b -P blender/extras.py 2>&1 | grep -E "Error|Traceback|tris=|klapp|clap f" || true
fi

for f in build/models/*.glb; do
  n=$(basename "$f")
  node tools/optimize.mjs "$f" "public/models/$n"
  # mobilversion: förenklad mesh
  case "$n" in arena.glb) r=0.6 ;; *) r=0.3 ;; esac
  node tools/optimize.mjs "$f" "public/models/${n%.glb}_lo.glb" --lod $r >/dev/null 2>&1
  printf "%-12s %6s KB -> %6s KB\n" "$n" $(( $(stat -f%z "$f") / 1024 )) $(( $(stat -f%z "public/models/$n") / 1024 ))
done
# Patsys metadata (gånghastighet, klapptider, klipplängder) skrivs av extras.py
if [ -f build/models/patsy.json ]; then cp build/models/patsy.json public/models/patsy.json; fi

# Poly Haven-texturer -> 1K/2K jpg i public/tex
tex() { # namn karta upplösning
  local src="assets/src/tex/${1}_${2}_2k.jpg" dst="public/tex/${1}_${2}.jpg"
  [ -f "$src" ] || { echo "saknas $src (kör tools/fetch_assets.sh)"; return; }
  [ -f "$dst" ] || magick "$src" -resize "${3}x${3}" -quality 88 "$dst"
}
for t in monastery_stone_floor castle_wall_slates mossy_rock leafy_grass grass_ground; do
  tex $t diff 2048; tex $t nor_gl 1024; tex $t rough 1024
done
H=assets/src/hdri/qwantani_late_afternoon_puresky_4k.hdr
[ -f public/hdri/sky.hdr ] || cp "$H" public/hdri/sky.hdr
[ -f public/hdri/sky_m.hdr ] || cp assets/src/hdri/qwantani_late_afternoon_puresky_2k.hdr public/hdri/sky_m.hdr
[ -f public/hdri/dusk.hdr ] || cp assets/src/hdri/qwantani_dusk_2_puresky_2k.hdr public/hdri/dusk.hdr
[ -f public/hdri/dusk_m.hdr ] || cp assets/src/hdri/qwantani_dusk_2_puresky_1k.hdr public/hdri/dusk_m.hdr
# mobiltexturer: halv upplösning
mkdir -p public/tex/m
for t in public/tex/*.jpg; do
  b=$(basename "$t"); [ -f "public/tex/m/$b" ] && [ "public/tex/m/$b" -nt "$t" ] && continue
  case "$b" in *_diff*|*_albedo*) sz=1024 ;; *) sz=512 ;; esac
  magick "$t" -resize "${sz}x${sz}>" -quality 85 "public/tex/m/$b"
done
du -sh public/models public/tex public/hdri
