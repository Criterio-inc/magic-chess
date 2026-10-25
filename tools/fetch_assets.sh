#!/usr/bin/env bash
# Hämtar CC0-material och HDRI från Poly Haven till assets/src (gitignorerat).
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=assets/src; mkdir -p "$SRC/tex" "$SRC/hdri"
RES=${RES:-2k}
TEX="marble_01 monastery_stone_floor castle_wall_slates mossy_rock grass_ground_ leafy_grass rock_face_02"
for t in $TEX; do
  t=${t%_}
  json=$(curl -sf "https://api.polyhaven.com/files/$t") || { echo "saknas: $t"; continue; }
  for map in Diffuse nor_gl Rough AO Displacement; do
    url=$(echo "$json" | python3 -c "import json,sys;d=json.load(sys.stdin);m=d.get('$map');print(m['$RES']['jpg']['url'] if m and '$RES' in m and 'jpg' in m['$RES'] else '')")
    [ -n "$url" ] || continue
    out="$SRC/tex/$(basename "$url")"
    [ -f "$out" ] || curl -sfL "$url" -o "$out"
  done
  echo "ok $t"
done
H=qwantani_late_afternoon_puresky
[ -f "$SRC/hdri/${H}_2k.hdr" ] || curl -sfL "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/${H}_2k.hdr" -o "$SRC/hdri/${H}_2k.hdr"
[ -f "$SRC/hdri/${H}_4k.hdr" ] || curl -sfL "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/${H}_4k.hdr" -o "$SRC/hdri/${H}_4k.hdr"
D=qwantani_dusk_2_puresky
for r in 2k 1k; do [ -f "$SRC/hdri/${D}_$r.hdr" ] || curl -sfL "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/$r/${D}_$r.hdr" -o "$SRC/hdri/${D}_$r.hdr"; done
ls -la "$SRC/tex" "$SRC/hdri"
