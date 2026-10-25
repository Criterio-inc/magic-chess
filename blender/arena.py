"""Arenan: schackbrädet på en trappad estrad, omgiven av en ruinerad pelargång i gräs.

Körs: blender -b -P blender/arena.py -- [--preview FIL]
Ut: public/models/arena.glb + public/models/arena.json

Koordinater: Blender X -> three X, Blender Y -> three -Z, Blender Z -> three Y.
Vita sidan (rad 1) ligger mot -Y i Blender = +Z i three.
UV:er är i meter; spelet sätter texturens repeat per material.
"""
import bpy
import sys
import os
import math
import json
import random
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(__file__))
import lib
from lib import lathe, ellipsoid, box, torus, tube, prism, add_bevel, add_subsurf, add_rock, smooth, transform, uv_box, apply_mods

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "models")
RAW = os.path.join(ROOT, "build", "models")
os.makedirs(RAW, exist_ok=True)
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

S = 2.0            # rutans storlek (m)
HALF = 4 * S       # halva brädet
STEP_H = 0.18
DAIS_TOP = 3 * STEP_H
TILE_TOP = 0.74
FRAME_W = 1.4
rnd = random.Random(11)

lib.reset()
objs = []


def keep(o, uv=None):
    if uv is not None:
        uv_box(o, uv)
    objs.append(o)
    return o


# ---------------------------------------------------------------- brädet
for f in range(8):
    for r in range(8):
        light = (f + r) % 2 == 1
        cx, cy = (f - 3.5) * S, (r - 3.5) * S
        h = 0.2 + rnd.uniform(-0.003, 0.003)
        t = box(f"tile_{'abcdefgh'[f]}{r + 1}", (cx, cy, TILE_TOP - h / 2), (S - 0.035, S - 0.035, h),
                material="BoardWhite" if light else "BoardBlack", bevel=0.012, segments=3)
        transform(t, rot=(rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), 0), pivot=(cx, cy, TILE_TOP))
        # varje platta får ett eget utsnitt ur marmorn
        uv_box(t, 1.0, offset=(rnd.uniform(0, 8), rnd.uniform(0, 8)), rot=rnd.choice([0, math.pi / 2]) + rnd.uniform(-0.3, 0.3))
        objs.append(t)

# fog under plattorna (mörk)
keep(box("grout", (0, 0, TILE_TOP - 0.12), (2 * HALF, 2 * HALF, 0.2), material="Dark"))

# ram med förgylld list och koordinater
FO = HALF + FRAME_W
frame_z0 = DAIS_TOP
frame_top = TILE_TOP + 0.03
for i, (cx, cy, sx, sy) in enumerate([(0, -(HALF + FRAME_W / 2), 2 * FO, FRAME_W), (0, HALF + FRAME_W / 2, 2 * FO, FRAME_W),
                                      (-(HALF + FRAME_W / 2), 0, FRAME_W, 2 * HALF), (HALF + FRAME_W / 2, 0, FRAME_W, 2 * HALF)]):
    fr = box(f"frame{i}", (cx, cy, (frame_z0 + frame_top) / 2), (sx, sy, frame_top - frame_z0), material="Frame", bevel=0.03, segments=3)
    keep(fr, 1.0)
for k, d in enumerate((HALF + 0.12, FO - 0.14)):
    pts = [(-d, -d, frame_top), (d, -d, frame_top), (d, d, frame_top), (-d, d, frame_top), (-d, -d, frame_top)]
    keep(tube(f"inlay{k}", pts, 0.035, material="Trim", seg=8, cap=False))
# hörnrosetter
for (sx, sy) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
    c = (sx * (HALF + FRAME_W / 2), sy * (HALF + FRAME_W / 2), frame_top)
    keep(lathe(f"rosette{sx}{sy}", [(0.0, frame_top + 0.06), (0.18, frame_top + 0.05), (0.32, frame_top + 0.015), (0.36, frame_top),
                                     (0.0, frame_top)], seg=8, material="Trim", center=(c[0], c[1], 0), phase=math.pi / 8))


def text_mesh(name, body, loc, size, rot_z=0.0):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = 0.012
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.bevel_depth = 0.004
    ob = bpy.data.objects.new(name, cu)
    lib.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    o = bpy.data.objects.new(name, me)
    lib.link(o)
    me.transform(Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rot_z, 4, "Z"))
    me.materials.clear()
    me.materials.append(lib.mat("Trim"))
    return o


for f in range(8):
    x = (f - 3.5) * S
    keep(text_mesh(f"file_{f}", "ABCDEFGH"[f], (x, -(HALF + FRAME_W * 0.55), frame_top + 0.005), 0.55))
    keep(text_mesh(f"fileB_{f}", "ABCDEFGH"[f], (x, HALF + FRAME_W * 0.55, frame_top + 0.005), 0.55, math.pi))
for r in range(8):
    y = (r - 3.5) * S
    keep(text_mesh(f"rank_{r}", str(r + 1), (-(HALF + FRAME_W * 0.5), y, frame_top + 0.005), 0.55))
    keep(text_mesh(f"rankB_{r}", str(r + 1), (HALF + FRAME_W * 0.5, y, frame_top + 0.005), 0.55, math.pi))

# ---------------------------------------------------------------- estrad
for i in range(3):
    w = 2 * FO + 1.6 + (2 - i) * 1.1
    st = box(f"step{i}", (0, 0, STEP_H * (i + 0.5)), (w, w, STEP_H), material="Plinth", bevel=0.025, segments=2)
    keep(st, 1.0)

# ---------------------------------------------------------------- mark: stenlagd plats + gräs med kullar
plaza = lathe("plaza", [(0.0, -0.02), (27.0, -0.02), (27.4, -0.1)], seg=96, material="Ground", cap_bottom=False, cap_top=False)
keep(plaza, 1.0)

N = 140
R_OUT = 420.0
bm_verts = []
terrain = bpy.data.meshes.new("terrain")
verts, faces = [], []
for j in range(N + 1):
    for i in range(N + 1):
        # polärt rutnät: tätt nära platsen, glest långt bort
        a = 2 * math.pi * i / N
        t = j / N
        r = 26.5 + (R_OUT - 26.5) * (t ** 2.2)
        x, y = math.cos(a) * r, math.sin(a) * r
        far = min(1.0, max(0.0, (r - 45) / 260))
        hills = (math.sin(a * 3 + 1.3) * 0.5 + math.sin(a * 7 + 0.2) * 0.25 + math.sin(a * 13 + 2.0) * 0.12 + 0.6) * 38 * far ** 1.4
        near = (math.sin(x * 0.21) * math.cos(y * 0.17) + math.sin(x * 0.07 + y * 0.11)) * 0.35 * min(1, (r - 26.5) / 10)
        z = -0.1 + hills + near
        verts.append((x, y, z))
for j in range(N):
    for i in range(N):
        a = j * (N + 1) + i
        faces.append((a, a + N + 1, a + N + 2, a + 1))  # moturs sett uppifrån: normalerna pekar upp
terrain.from_pydata(verts, [], faces)
terrain.materials.append(lib.mat("Grass"))
tob = bpy.data.objects.new("terrain", terrain)
lib.link(tob)
uv_box(tob, 1.0)
for p in terrain.polygons:
    p.use_smooth = True
objs.append(tob)

# ---------------------------------------------------------------- ruinerad pelargång
COL_R = 18.5
NCOL = 20
heights = []
for i in range(NCOL):
    a = 2 * math.pi * (i + 0.5) / NCOL
    cx, cy = math.cos(a) * COL_R, math.sin(a) * COL_R
    if abs(math.sin(a)) > 0.8:  # fri sikt för kamerorna bakom vit och svart
        heights.append(None)
        continue
    broken = rnd.random() < 0.35
    hgt = 6.2 if not broken else rnd.uniform(1.4, 4.2)
    heights.append((a, cx, cy, broken, hgt))
    rr = 0.5
    base = lathe(f"colbase{i}", [(0.78, 0.0), (0.78, 0.18), (0.68, 0.22), (0.62, 0.3), (0.66, 0.36), (0.58, 0.42), (0.0, 0.42)],
                 seg=32, material="Column", center=(cx, cy, 0))
    keep(base, 1.0)
    keep(box(f"colplinth{i}", (cx, cy, -0.05), (1.7, 1.7, 0.25), material="Column", bevel=0.03), 1.0)
    top = hgt
    shaft = lathe(f"colshaft{i}", [(rr * 1.0, 0.4), (rr * 0.97, top * 0.35), (rr * 0.86, top - 0.02), (rr * 0.86, top)], seg=72,
                  material="Column", center=(cx, cy, 0), fold=(20, 0.05, 0.0, 0.5), cap_top=True)
    keep(shaft, 1.0)
    if broken:
        stump = lathe(f"colbreak{i}", [(rr * 0.9, top - 0.05), (rr * 0.82, top + 0.15), (0.2, top + 0.3), (0.0, top + 0.2)], seg=16,
                      material="Column", center=(cx, cy, 0))
        add_rock(stump, 0.12, 0.25, levels=2, seed=100 + i)
        keep(stump, 1.0)
        # nedfallna trummor i gräset
        for k in range(rnd.randint(1, 3)):
            d = rnd.uniform(1.8, 4.5)
            ang = a + rnd.uniform(-0.6, 0.6)
            px, py = cx + math.cos(ang) * d, cy + math.sin(ang) * d
            L = rnd.uniform(0.8, 1.6)
            drum = lathe(f"drum{i}_{k}", [(rr * 0.9, -L / 2), (rr * 0.9, L / 2)], seg=40, material="Column",
                         fold=(20, 0.05, -100.0, -99.0))
            transform(drum, rot=(90, 0, math.degrees(rnd.uniform(0, math.tau))))
            transform(drum, loc=(px, py, rr * 0.85))
            add_rock(drum, 0.03, 0.2, levels=1, seed=200 + i * 3 + k)
            keep(drum, 1.0)
    else:
        cap = lathe(f"colcap{i}", [(rr * 0.86, top), (rr * 0.95, top + 0.12), (rr * 1.25, top + 0.32), (rr * 1.3, top + 0.36)], seg=32,
                    material="Column", center=(cx, cy, 0), cap_bottom=False)
        keep(cap, 1.0)
        ab = box(f"colabacus{i}", (cx, cy, top + 0.46), (1.45, 1.45, 0.22), material="Column", bevel=0.02)
        transform(ab, rot=(0, 0, math.degrees(a)), pivot=(cx, cy, top))
        keep(ab, 1.0)

# arkitravbalkar mellan intakta grannar
for i in range(NCOL):
    if heights[i] is None or heights[(i + 1) % NCOL] is None:
        continue
    a0, x0, y0, b0, h0 = heights[i]
    a1, x1, y1, b1, h1 = heights[(i + 1) % NCOL]
    if not b0 and not b1 and rnd.random() < 0.8:
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        L = math.hypot(x1 - x0, y1 - y0) + 1.3
        beam = box(f"beam{i}", (mx, my, h0 + 0.86), (L, 1.2, 0.58), material="Column", bevel=0.03)
        transform(beam, rot=(0, 0, math.degrees(math.atan2(y1 - y0, x1 - x0))), pivot=(mx, my, h0 + 0.86))
        add_rock(beam, 0.03, 0.4, levels=1, seed=300 + i)
        keep(beam, 1.0)

# låg ruinmur bakom pelarna
for i in range(28):
    if rnd.random() < 0.3:
        continue
    a = 2 * math.pi * i / 28
    if abs(math.sin(a)) > 0.9:
        continue
    r = 23.5
    cx, cy = math.cos(a) * r, math.sin(a) * r
    h = rnd.uniform(0.6, 2.4)
    w = box(f"wall{i}", (cx, cy, h / 2 - 0.1), (5.0, 0.9, h + 0.2), material="Wall", bevel=0.04)
    transform(w, rot=(0, 0, math.degrees(a) + 90), pivot=(cx, cy, 0))
    add_rock(w, 0.08, 0.6, levels=2, seed=400 + i)
    keep(w, 1.0)

# stenblock i gräset
for i in range(26):
    a = rnd.uniform(0, math.tau)
    r = rnd.uniform(25, 60)
    s = rnd.uniform(0.4, 1.6)
    b = ellipsoid(f"boulder{i}", (math.cos(a) * r, math.sin(a) * r, s * 0.2), (s * rnd.uniform(0.9, 1.6), s, s * rnd.uniform(0.6, 0.9)),
                  material="Rock", seg=12, rings=8)
    add_rock(b, 0.18 * s, 0.5 * s, levels=2, seed=500 + i)
    keep(b, 1.0)

# ---------------------------------------------------------------- glödfat i estradens hörn
braziers = []
for k, (sx, sy) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1))):
    d = FO + 0.8
    cx, cy = sx * d, sy * d
    z = DAIS_TOP
    keep(lathe(f"brazier{k}", [(0.42, z), (0.42, z + 0.1), (0.26, z + 0.16), (0.16, z + 0.3), (0.12, z + 0.95), (0.18, z + 1.02),
                                (0.24, z + 1.05), (0.5, z + 1.18), (0.62, z + 1.36), (0.58, z + 1.38), (0.45, z + 1.24), (0.0, z + 1.22)],
                     seg=40, material="Bronze", center=(cx, cy, 0)), 1.0)
    keep(torus(f"brazierrim{k}", (cx, cy, z + 1.37), 0.6, 0.035, material="Bronze", seg=40), 1.0)
    coals = ellipsoid(f"coals{k}", (cx, cy, z + 1.26), (0.48, 0.48, 0.1), material="Coal", seg=16, rings=8)
    add_rock(coals, 0.05, 0.08, levels=2, seed=600 + k)
    keep(coals, 1.0)
    braziers.append((cx, cy, z + 1.36))

# ---------------------------------------------------------------- fanor (animeras i spelet)
banners = []
for side, sy in (("w", -1), ("b", 1)):
    for k, sx in enumerate((-1, 1)):
        px, py = sx * (FO + 1.3), sy * 5.0
        z0 = DAIS_TOP
        # Duken hänger på stångens ena sida (mot brädets mittlinje), fäst i ringar längs stången och i en arm upptill:
        # kanten vid stången står still, så duken kan aldrig bölja genom stången.
        dy = -sy
        W, Hh, G = 1.9, 3.6, 0.1   # dukens bredd, höjd och glipan från stångens mitt
        top = z0 + 6.05
        keep(tube(f"pole_{side}{k}", [(px, py, z0), (px, py, z0 + 6.4)], [0.07, 0.055], material="Bronze", seg=12), 1.0)
        keep(ellipsoid(f"finial_{side}{k}", (px, py, z0 + 6.5), (0.13, 0.13, 0.16), material="Trim"), 1.0)
        arm_end = py + dy * (G + W + 0.08)
        keep(tube(f"crossbar_{side}{k}", [(px, py, top + 0.05), (px, arm_end, top + 0.05)], 0.04, material="Bronze", seg=8), 1.0)
        keep(ellipsoid(f"armtip_{side}{k}", (px, arm_end, top + 0.05), (0.06, 0.06, 0.06), material="Trim"), 1.0)
        for r in range(5):
            keep(torus(f"poler_{side}{k}_{r}", (px, py, top - 0.15 - r * (Hh - 0.5) / 4), 0.085, 0.016,
                       material="Bronze", seg=16, rseg=6), 1.0)
        # fanduken: tätt rutnät så vinden kan bölja den i vertexshadern (u = 0 vid stången, v = 0 upptill)
        me = bpy.data.meshes.new(f"banner_{side}{k}")
        cols, rows = 16, 24
        vs, fs, uvs = [], [], []
        for j in range(rows + 1):
            for i in range(cols + 1):
                u, v = i / cols, j / rows
                yb = -Hh * v
                if v > 0.999:  # svalstjärt
                    yb += (1 - abs(u - 0.5) * 2) * 0.45
                vs.append((px, py + dy * (G + W * u), top + yb))
        for j in range(rows):
            for i in range(cols):
                a = j * (cols + 1) + i
                fs.append((a, a + cols + 1, a + cols + 2, a + 1))
        me.from_pydata(vs, [], fs)
        me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index
                i, j = vi % (cols + 1), vi // (cols + 1)
                me.uv_layers.active.data[li].uv = (i / cols, 1 - j / rows)
            poly.use_smooth = True
        me.materials.append(lib.mat("Banner_" + side))
        bo = bpy.data.objects.new(f"banner_{side}{k}", me)
        lib.link(bo)
        objs.append(bo)
        banners.append({"name": f"banner_{side}{k}", "side": side})

for o in objs:
    if o.modifiers:
        apply_mods(o)

for o in objs:
    if o.type == "MESH" and not o.name.startswith(("terrain", "banner_", "plaza")):
        smooth(o, 35)

if "--preview" in argv:
    p = argv[argv.index("--preview") + 1]
    lib.preview_setup(target=(0, 0, 1.0), dist=42, elev=28, azim=-25, lens=35, res=(1280, 720))
    bpy.context.scene.camera.data.clip_end = 2000
    lib.render(p)

# Blenders glTF-export skriver bara UV:er som en textur använder: koppla en dummybild till varje
# material (tools/optimize.mjs tar bort bilderna igen men behåller TEXCOORD_0).
dummy = bpy.data.images.new("uvkeep", 4, 4)
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    nt = m.node_tree
    tx = nt.nodes.new("ShaderNodeTexImage")
    tx.image = dummy
    bsdf = nt.nodes.get("Principled BSDF")
    nt.links.new(tx.outputs["Color"], bsdf.inputs["Base Color"])

# glTF: banor och ram som egna noder (spelet hittar dem på namn), resten slås ihop per material
banner_objs = [o for o in objs if o.name.startswith("banner_")]
tiles = [o for o in objs if o.name.startswith("tile_")]
bpy.ops.object.select_all(action="DESELECT")
static = [o for o in objs if not o.name.startswith(("banner_", "tile_"))]
by_mat = {}
for o in static:
    m = o.data.materials[0].name if o.data.materials else "None"
    by_mat.setdefault(m, []).append(o)
merged = []
for m, group in by_mat.items():
    if len(group) == 1:
        group[0].name = f"static_{m}"
        merged.append(group[0])
        continue
    bpy.ops.object.select_all(action="DESELECT")
    for o in group:
        o.select_set(True)
    bpy.context.view_layer.objects.active = group[0]
    bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active
    j.name = f"static_{m}"
    merged.append(j)
# plattorna slås ihop per färg (spelet behöver inte enskilda plattor för klick: rutorna räknas ur koordinater)
tile_groups = {col: [o for o in tiles if o.data.materials[0].name == col] for col in ("BoardWhite", "BoardBlack")}
for col, g in tile_groups.items():
    bpy.ops.object.select_all(action="DESELECT")
    for o in g:
        o.select_set(True)
    bpy.context.view_layer.objects.active = g[0]
    bpy.ops.object.join()
    bpy.context.view_layer.objects.active.name = f"tiles_{col}"
    merged.append(bpy.context.view_layer.objects.active)
final = merged + banner_objs
bpy.ops.object.select_all(action="DESELECT")
for o in final:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(RAW, "arena.glb"), use_selection=True, export_format="GLB", export_yup=True,
                          export_apply=True, export_animations=False, export_materials="EXPORT", export_normals=True,
                          export_texcoords=True, export_image_format="JPEG")


def to_three(x, y, z):
    return [round(x, 3), round(z, 3), round(-y, 3)]


meta = {
    "squareSize": S, "tileTop": TILE_TOP, "boardHalf": HALF, "frameTop": frame_top, "daisTop": DAIS_TOP,
    "braziers": [to_three(*b) for b in braziers], "banners": banners, "columnRadius": COL_R,
}
with open(os.path.join(OUT, "arena.json"), "w") as f:
    json.dump(meta, f, indent=1)
print("ARENA OK", len(objs), "objekt ->", len(final), "noder")
