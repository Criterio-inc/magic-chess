"""Extramodeller i samma marmorstil som pjäserna: älgen, fältherrens hand och trumpojken.

Körs: blender -b -P blender/extras.py -- [--only elk,hand,drummer] [--preview DIR]
Ut (råa exporter): build/models/elk.glb, hand.glb, drummer.glb + build/models/drummer.json
(tools/build_assets.sh komprimerar dem till public/models/ och gör *_lo.glb).

- elk:     En marmorälg som kliver in från kartan och stångar offret. Statisk, cirka 2,9 m hög med skovelhornen,
           tittar mot -Y, origo mitt mellan klövarna på marken. Material: Stone.
- hand:    Fältherrens hand som ett fragment av en marmorkoloss: höger hand med handflatan plant mot marken,
           4,6 m från handleden till långfingrets spets, fingrarna mot -Y och tummen mot +X. Avbruten vid
           handleden med en grov brottyta. Origo mitt under handen. Material: Stone.
- drummer: Trumpojken, 1,15 m, i lång uniformsrock och trekantig hatt, med en marschtrumma framför magen och en
           trumstock i varje hand (styvt bundna till hand.L/hand.R). Standardskelettet. Klipp: idle, walk, drum, bow.
           Material: Stone (hud: lagets marmor), Cloth (rocken), Felt (hatten), Sack (trumskinnen),
           Rope (bälten och sträng), Wood (trumman och stockarna). Spelet ger honom egna material i src/drummer.js.
"""
import bpy
import bmesh
import sys
import os
import math
import json
from mathutils import Vector, Matrix, Quaternion, noise

sys.path.insert(0, os.path.dirname(__file__))
import lib
from lib import lathe, ellipsoid, tube, join, orient, add_subsurf, add_solidify, smooth
import rig
import anatomy
from rig import merge, add
import pieces                      # main() körs bara när pieces.py är huvudskript
from pieces import bake_vertex_ao, sleeve, fold_robe, face_head, _leg_ik

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "build", "models")
FPS = rig.FPS
V = Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else True
    return default


# förhandsfärger (spelet byter material efter namn)
lib.MAT_COLORS.update({
    "Fur": ((0.93, 0.92, 0.9, 1), 0.0, 0.7),
    "Eye": ((0.9, 0.03, 0.02, 1), 0.0, 0.25),
    "Tooth": ((0.95, 0.93, 0.85, 1), 0.0, 0.3),
    "Sack": ((0.62, 0.5, 0.33, 1), 0.0, 0.95),
    "Rope": ((0.72, 0.62, 0.43, 1), 0.0, 0.9),
})


def blob(name, forms, tris, res, material, fluff=0.0, fluff_size=0.01):
    """Metabollformer -> mjuk, decimerad mesh med ett material (statiska modeller: inga vikter).
    fluff > 0 ger en lätt luddig, skulpterad pälsyta (brus längs normalen)."""
    # Blender klämmer metabollarnas upplösning till minst 0,005 m: små former byggs uppskalade och skalas ned
    k = max(1.0, 0.0055 / res)
    big = anatomy.Forms(forms.H * k)
    big.items = [(kind, c * k, tuple(x * k for x in r), bone, st, q, neg) for (kind, c, r, bone, st, q, neg) in forms.items]
    ob = anatomy.build_metaball("mb_" + name, big, res * k)
    ob.data.transform(Matrix.Scale(1.0 / k, 4))
    ob.name = name
    if fluff > 0:
        me = ob.data
        for v in me.vertices:
            p = v.co / fluff_size
            n = noise.fractal(p, 0.6, 2.2, 3, noise_basis="PERLIN_ORIGINAL")
            v.co += v.normal * n * fluff
    n0 = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if n0 > tris:
        dm = ob.modifiers.new("Dec", "DECIMATE")
        dm.decimate_type = "COLLAPSE"
        dm.ratio = tris / n0
        lib.apply_mods(ob)
    ob.data.materials.clear()
    ob.data.materials.append(lib.mat(material))
    for p in ob.data.polygons:
        p.material_index = 0
        p.use_smooth = True
    return ob


def ao_report(ob):
    """Medel-AO per material (vertexfärgens R) — dolda inre delar drar ned totalsnittet."""
    me = ob.data
    col = me.color_attributes.get("Col")
    if not col:
        return
    acc = {}
    for p in me.polygons:
        m = me.materials[p.material_index].name
        for vi in p.vertices:
            a = acc.setdefault(m, [0.0, 0])
            a[0] += col.data[vi].color[0]
            a[1] += 1
    print("  AO per material: " + ", ".join(f"{m} {s / n:.2f}" for m, (s, n) in sorted(acc.items())))


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def dims(ob):
    """Utbredning (x, y, z) i meter och lägsta z — för kontroll av mått och origo."""
    co = [v.co for v in ob.data.vertices]
    ext = [max(c[i] for c in co) - min(c[i] for c in co) for i in range(3)]
    return f"{ext[0]:.3f} x {ext[1]:.3f} x {ext[2]:.3f} m, zmin {min(c.z for c in co):.4f}"


def cone(name, a, b, r, material, seg=10):
    """Spetsig kon från a (bas, radie r) till b (spets)."""
    L = (V(b) - V(a)).length
    ob = lathe(name, [(r, 0.0), (r * 0.92, L * 0.3), (r * 0.6, L * 0.65), (r * 0.22, L * 0.9), (0.0, L)], seg=seg,
               material=material, cap_bottom=True, cap_top=False)
    orient(ob, a, b)
    return ob


# ======================================================================= BROTTYTOR

def cut_fracture(ob, p0, nrm, band=0.03):
    """Kapa modellen i planet (p0, nrm), fyll hålet med koncentriska ringar och lägg en viktgrupp 'break'
    som är 1 på brottytan och avtar en bit ned längs sidan (så blir kanten ojämn utan söm)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=p0, plane_no=nrm, clear_outer=True)
    cut = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    capf = bmesh.ops.holes_fill(bm, edges=cut, sides=0)["faces"]
    f = max(capf, key=lambda f: len(f.verts))
    loop = list(f.verts)
    c = sum((v.co for v in loop), V()) / len(loop)
    bmesh.ops.delete(bm, geom=[f], context="FACES_ONLY")
    rings, K = [loop], 8
    for k in range(1, K):
        rings.append([bm.verts.new(c + (v.co - c) * (1 - k / K)) for v in loop])
    cv = bm.verts.new(c)
    n = len(loop)
    for k in range(K - 1):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    for i in range(n):
        bm.faces.new((rings[-1][i], rings[-1][(i + 1) % n], cv))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    vg = ob.vertex_groups.new(name="break")
    for v in me.vertices:
        h = (v.co - p0).dot(nrm)
        if h > -band:
            vg.add([v.index], min(1.0, (1 + h / band)) ** 1.6 if h < -1e-6 else 1.0, "REPLACE")


def roughen_fracture(ob, strength=0.3, size=0.8):
    """Grov brottsten på brottzonen (lib.add_rock, bara längs brottplanets normal)."""
    lib.add_rock(ob, strength=strength, size=size, levels=1, seed=7)
    ob.modifiers.remove(ob.modifiers["Sub"])
    for mname in ("Rock", "Rock2"):
        m = ob.modifiers[mname]
        m.vertex_group = "break"
        m.direction = "Z"
    lib.apply_mods(ob)
    ob.vertex_groups.clear()


# ======================================================================= ÄLGEN

def build_elk():
    """Stor älgtjur i marmor: hög manke, lång mule med hängande överläpp, skägg, långa smala ben och breda
    skovelhorn med taggar. Står stilla med huvudet något sänkt, som inför en stångning."""
    F = anatomy.Forms(2.9)
    b = "root"
    # bål: hög manke framtill, smalare bakdel
    F.ell((0, 0.12, 1.45), (0.36, 0.92, 0.42), b, 2.3)                        # kropp
    F.ell((0, -0.46, 1.74), (0.33, 0.46, 0.4), b, 2.3)                        # manke
    F.ell((0, -0.66, 1.36), (0.31, 0.34, 0.42), b, 2.4)                       # bringa
    F.ell((0, 0.82, 1.47), (0.31, 0.34, 0.36), b, 2.4)                        # länd och kors
    F.ell((0, 0.1, 1.13), (0.32, 0.72, 0.26), b, 2.5)                         # buk
    # hals och huvud, lätt sänkt framåt
    F.chain([(0, -0.78, 1.78), (0, -1.06, 1.9), (0, -1.2, 1.94)], [0.27, 0.22, 0.19], b, 2.5)
    tilt = Quaternion(V((1, 0, 0)), math.radians(-22))
    F.ell((0, -1.36, 1.88), (0.16, 0.3, 0.17), b, 2.6, q=tilt)                 # skalle
    F.ell((0, -1.62, 1.74), (0.14, 0.2, 0.14), b, 2.6, q=tilt)                 # mule
    F.ell((0, -1.76, 1.68), (0.125, 0.1, 0.12), b, 2.8)                        # hängande överläpp
    F.ell((0, -1.7, 1.6), (0.08, 0.08, 0.05), b, 3.0)                          # underkäke
    for k in (1, -1):
        F.ell((k * 0.07, -1.82, 1.7), (0.02, 0.02, 0.02), b, 3.2, neg=True)  # näsborrar
        F.ell((k * 0.12, -1.36, 1.98), (0.03, 0.035, 0.025), b, 3.0)         # ögonvalv
        F.oriented((k * 0.12, -1.24, 2.04), (k * 0.33, -1.14, 2.2), 0.06, 0.03, b, 3.0)   # öron
    F.chain([(0, -1.3, 1.72), (0, -1.28, 1.52), (0, -1.26, 1.38)], [0.05, 0.035, 0.018], b, 2.8)   # skägget
    # ben: framben raka, bakben med hasen bakåt; klövar
    for k in (1, -1):
        x = k * 0.2
        F.chain([(x, -0.62, 1.25), (x * 0.98, -0.6, 0.72), (x * 0.95, -0.62, 0.14)], [0.12, 0.07, 0.05], b, 2.6)
        F.chain([(x * 1.05, 0.72, 1.3), (x, 0.96, 0.68), (x * 0.95, 0.84, 0.14)], [0.15, 0.07, 0.05], b, 2.6)
        F.ell((x, 0.92, 0.66), (0.06, 0.08, 0.06), b, 3.0)                    # hasen
        for y in (-0.64, 0.82):
            F.ell((x * 0.95, y - 0.02, 0.07), (0.07, 0.1, 0.07), b, 3.0)      # klöv
    F.ell((0, 1.14, 1.55), (0.06, 0.08, 0.1), b, 3.0)                          # svans
    body = blob("elk_body", F, 16000, 0.012, "Stone")
    parts = [body]
    # skovelhorn: en stam ut åt sidan, en bred skovel och taggar längs dess övre kant
    for k in (1, -1):
        root_ = V((k * 0.14, -1.24, 2.06))
        beam = V((k * 0.44, -1.18, 2.2))
        parts.append(tube(f"beam{k}", [root_, beam], [0.055, 0.045], material="Stone", seg=12))
        pc = V((k * 0.74, -1.12, 2.36))
        q = Quaternion(V((0, 1, 0)), -k * math.radians(28)) @ Quaternion(V((1, 0, 0)), math.radians(-12))
        palm = ellipsoid(f"palm{k}", (0, 0, 0), (0.34, 0.13, 0.04), material="Stone", seg=24, rings=12)
        palm.data.transform(Matrix.Translation(pc) @ q.to_matrix().to_4x4())
        parts.append(palm)
        for i in range(6):
            t = i / 5
            base = pc + q @ V((k * (-0.26 + 0.52 * t), 0.0, 0.02 + 0.03 * math.sin(t * math.pi)))
            up = (q @ V((k * 0.12 * (t - 0.3), -0.02, 1.0))).normalized()
            parts.append(cone(f"tine{k}_{i}", base, base + up * (0.16 + 0.06 * math.sin(t * math.pi)), 0.035, "Stone", seg=10))
    ob = join(parts, "elk")
    me = ob.data
    zmin = min(v.co.z for v in me.vertices)
    me.transform(Matrix.Translation((0, 0, -zmin)))
    for v in me.vertices:              # klövarna står plant på marken
        if v.co.z < 0.004:
            v.co.z = 0.0
    smooth(ob, 50)
    return ob, max(v.co.z for v in me.vertices)


# ======================================================================= HANDEN

HAND_LEN = 4.6


def build_hand():
    """Höger hand med handflatan plant mot marken i människostorlek, skalas sedan upp till en koloss.
    Fingrarna mot -Y, tummen utspärrad mot +X. Avbruten strax ovanför handleden."""
    F = anatomy.Forms(1.0)
    b = "root"
    F.ell((0.004, 0.004, 0.02), (0.043, 0.052, 0.017), b, 2.4)               # handflata
    F.ell((0.002, 0.012, 0.028), (0.038, 0.044, 0.012), b, 2.5)              # handrygg, lätt välvd
    F.ell((-0.03, 0.01, 0.016), (0.014, 0.045, 0.014), b, 2.6)               # lillfingerranden
    F.ell((0.036, 0.022, 0.018), (0.022, 0.03, 0.017), b, 2.4)               # tumvalken
    F.chain([(0, 0.05, 0.022), (0, 0.09, 0.03), (0, 0.17, 0.042)], [0.03, 0.028, 0.032], b, 2.4)   # handled och underarm
    for (x0, x1) in ((0.028, 0.03), (0.01, 0.01), (-0.01, -0.011), (-0.026, -0.029)):
        F.chain([(x0 * 0.7, 0.04, 0.03), (x1, -0.04, 0.03)], 0.003, b, 3.5)   # senor på handryggen
    fingers = [  # (knoge, mellanled, ytterled, spets), radier: pek-, lång-, ring- och lillfinger
        ((0.029, -0.045, 0.024), (0.033, -0.075, 0.019), (0.035, -0.097, 0.014), (0.036, -0.115, 0.009), (0.0098, 0.009, 0.0082, 0.0075)),
        ((0.009, -0.049, 0.025), (0.01, -0.083, 0.02), (0.01, -0.108, 0.015), (0.01, -0.128, 0.0095), (0.0102, 0.0094, 0.0086, 0.0078)),
        ((-0.01, -0.047, 0.024), (-0.012, -0.078, 0.019), (-0.013, -0.1, 0.014), (-0.014, -0.119, 0.009), (0.0096, 0.0089, 0.0081, 0.0074)),
        ((-0.027, -0.04, 0.022), (-0.031, -0.063, 0.017), (-0.033, -0.08, 0.013), (-0.034, -0.095, 0.0085), (0.0085, 0.0079, 0.0072, 0.0066)),
    ]
    for (k1, k2, k3, tp, rr) in fingers:
        F.chain([k1, k2, k3, tp], list(rr), b, 3.0)
        F.ball(V(k1) + V((0, 0.003, 0.004)), rr[0] * 1.05, b, 3.2)            # knoge
        F.ball(V(tp) + V((0, 0.002, -0.002)), rr[3] * 1.05, b, 3.2)           # fingertopp
    thumb = [(0.03, 0.025, 0.017), (0.052, -0.004, 0.014), (0.066, -0.028, 0.012), (0.074, -0.045, 0.01)]
    F.chain(thumb, [0.015, 0.012, 0.0105, 0.0095], b, 2.9)                   # tummen, utspärrad
    for i in range(3):  # skåror mellan fingrarna
        m = (V(fingers[i][1]) + V(fingers[i + 1][1])) / 2
        F.ell(m + V((0, 0.012, 0.006)), (0.0022, 0.018, 0.01), b, 3.5, neg=True)
    stone = blob("hand_stone", F, 30000, 0.0011, "Stone")
    for v in stone.data.vertices:      # handflatan och fingrarna plant mot marken
        if v.co.z < 0.0:
            v.co.z = 0.0
    nails = []
    tips = [(f[2], f[3], f[4][3]) for f in fingers] + [(thumb[2], thumb[3], 0.0095)]
    for i, (k3, tp, r) in enumerate(tips):
        d = (V(tp) - V(k3)).normalized()
        c = V(tp) + V((0, 0.0, r * 0.85)) - d * r * 0.3
        nl = ellipsoid(f"nail{i}", (0, 0, 0), (r * 0.75, r * 1.0, r * 0.22), seg=16, rings=8)
        q = V((0, -1, 0)).rotation_difference(d)
        nl.data.transform(Matrix.Translation(c) @ q.to_matrix().to_4x4())
        nails.append(nl)
    ob = join([stone] + nails, "hand")
    cut_fracture(ob, V((0, 0.12, 0.03)), V((0.0, 1.0, 0.25)).normalized())
    me = ob.data
    # upp till kolossformat; origo mitt under handen
    s = HAND_LEN / (max(v.co.y for v in me.vertices) - min(v.co.y for v in me.vertices))
    me.transform(Matrix.Scale(s, 4))
    flat = [v.co for v in me.vertices if v.co.z < 1e-4]
    cx = (min(c.x for c in flat) + max(c.x for c in flat)) / 2
    cy = (min(c.y for c in flat) + max(c.y for c in flat)) / 2
    me.transform(Matrix.Translation((-cx, -cy, 0)))
    roughen_fracture(ob)
    smooth(ob, 35)
    return ob, 1.6

# ======================================================================= TRUMPOJKEN

DRUMMER_H = 1.15
BEAT_N = 15                        # 0,5 s
BEAT_HITS = (4, 11)                # bildrutor då en stock träffar skinnet: vänster, sedan höger


def nelder_mead(f, x0, step, iters=400, tol=1e-10):
    """Enkel simplexminimering (ingen scipy i Blender)."""
    n = len(x0)
    pts = [list(x0)] + [[x0[j] + (step[j] if j == i else 0.0) for j in range(n)] for i in range(n)]
    vals = [f(p) for p in pts]
    for _ in range(iters):
        order = sorted(range(n + 1), key=lambda i: vals[i])
        pts, vals = [pts[i] for i in order], [vals[i] for i in order]
        if vals[-1] - vals[0] < tol:
            break
        c = [sum(p[j] for p in pts[:-1]) / n for j in range(n)]
        xr = [c[j] + (c[j] - pts[-1][j]) for j in range(n)]
        fr = f(xr)
        if fr < vals[0]:
            xe = [c[j] + 2 * (c[j] - pts[-1][j]) for j in range(n)]
            fe = f(xe)
            pts[-1], vals[-1] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < vals[-2]:
            pts[-1], vals[-1] = xr, fr
        else:
            xc = [c[j] + 0.5 * (pts[-1][j] - c[j]) for j in range(n)]
            fc = f(xc)
            if fc < vals[-1]:
                pts[-1], vals[-1] = xc, fc
            else:
                for i in range(1, n + 1):
                    pts[i] = [pts[0][j] + 0.5 * (pts[i][j] - pts[0][j]) for j in range(n)]
                    vals[i] = f(pts[i])
    i = min(range(n + 1), key=lambda i: vals[i])
    return pts[i], vals[i]


def bone_xform(arm, bone):
    """Benets deformation (vila -> aktuell pose) i armaturens led."""
    pb = arm.pose.bones[bone]
    return pb.matrix @ pb.bone.matrix_local.inverted()


def skirt_weights(ob, J, H, z_top, z_hem):
    """Kjolen följer låren nedtill (mjuka vikter: hips -> thigh.L/R) så att knäna inte sticker igenom."""
    groups = {n: ob.vertex_groups.new(name=n) for n in ("hips", "thigh.L", "thigh.R")}
    for v in ob.data.vertices:
        t = min(1.0, max(0.0, (z_top - v.co.z) / (z_top - z_hem)))
        side = min(1.0, max(0.0, 0.5 + v.co.x / (0.07 * H)))
        side = side * side * (3 - 2 * side)
        wt = 0.85 * t ** 0.8
        groups["hips"].add([v.index], 1 - wt, "REPLACE")
        if wt * side > 1e-3:
            groups["thigh.L"].add([v.index], wt * side, "REPLACE")
        if wt * (1 - side) > 1e-3:
            groups["thigh.R"].add([v.index], wt * (1 - side), "REPLACE")


def tricorne(J, H):
    """Trekantig hatt: låg kulle och ett brett brätte som är uppvikt på tre sidor, med ett hörn rakt fram."""
    hc = face_head(J, H)
    top = hc + V((0, 0.006 * H, 0.062 * H))
    crown = lathe("hatcrown", [(0.062 * H, top.z - 0.004 * H), (0.064 * H, top.z + 0.018 * H), (0.058 * H, top.z + 0.034 * H),
                               (0.04 * H, top.z + 0.046 * H), (0.0, top.z + 0.05 * H)],
                  seg=36, material="Felt", sy=1.08, center=(top.x, top.y, 0), cap_bottom=False)
    bm = bmesh.new()
    n, r0, r1 = 72, 0.058 * H, 0.118 * H
    inner, outer = [], []
    for i in range(n):
        a = i / n * math.tau
        up = 0.5 - 0.5 * math.cos(3 * (a + math.pi / 2))   # 0 i hörnen (rakt fram och snett bakåt), uppvikt mellan dem
        ca, sa = math.cos(a), math.sin(a)
        inner.append(bm.verts.new(top + V((r0 * ca, r0 * sa * 1.08, 0.002 * H))))
        outer.append(bm.verts.new(top + V((r1 * ca, r1 * sa * 1.08, 0.004 * H + 0.05 * H * up))))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((inner[i], inner[j], outer[j], outer[i]))
    brim = lib._obj_from_bm("hatbrim", bm, "Felt")
    add_solidify(brim, 0.006 * H, offset=0)
    add_subsurf(brim, 1)
    return [(crown, "head"), (brim, "head")]


def drum_parts(center, R, h):
    """Marschtrumma med lodrät axel: träskal, skinn upptill och nedtill, ringar och en sicksackad sträng."""
    c = V(center)
    out = [lathe("drumshell", [(R, c.z - h / 2), (R * 1.01, c.z), (R, c.z + h / 2)], seg=40, material="Wood",
                 center=(c.x, c.y, 0), cap_bottom=False, cap_top=False)]
    for s, z in (("top", c.z + h / 2), ("bot", c.z - h / 2)):
        out.append(lathe(f"drumhead{s}", [(0.0, z), (R * 0.98, z)], seg=40, material="Sack", center=(c.x, c.y, 0),
                         cap_bottom=False, cap_top=False))
        out.append(lib.torus(f"drumhoop{s}", (c.x, c.y, z), R * 1.02, R * 0.06, material="Wood", seg=40))
    pts = []
    for i in range(17):
        a = i / 16 * math.tau
        z = c.z + (h / 2 - R * 0.06) * (1 if i % 2 == 0 else -1)
        pts.append(V((c.x + R * 1.03 * math.cos(a), c.y + R * 1.03 * math.sin(a), z)))
    out.append(tube("drumcord", pts, R * 0.025, material="Rope", seg=6))
    return out


def drumstick(name, butt, tip, H):
    parts = [tube(name, [butt, tip], [0.0075 * H, 0.0055 * H], material="Wood", seg=8),
             ellipsoid(name + "bead", tip, (0.0095 * H, 0.0095 * H, 0.0095 * H), material="Wood", seg=10, rings=6)]
    return join(parts, name)


def build_drummer():
    H = DRUMMER_H
    J = rig.joints(H, sw=0.125, hw=0.058)
    parts = []
    # syns: ansikte, händer och underben (resten av den skulpterade kroppen göms av rocken)
    T = anatomy.Forms(H)
    anatomy.torso(T, J, 0.92)
    anatomy.neck(T, J)
    anatomy.head(T, J, face=True)
    parts.append((anatomy.sculpt("body_torso", T, 7000, res=0.0017 * H), None))
    for s_ in ("L", "R"):
        A_ = anatomy.Forms(H)
        anatomy.arm(A_, J, s_, 0.95, "open")
        parts.append((anatomy.sculpt(f"body_arm{s_}", A_, 2400), None))
        L_ = anatomy.Forms(H)                       # bara underben: låren göms av rockskörtet
        anatomy.leg(L_, J, s_, 1.0, "bare")
        L_.items = [it for it in L_.items if it[3] != f"thigh.{s_}"]
        parts.append((anatomy.sculpt(f"body_leg{s_}", L_, 2200), None))
    parts += tricorne(J, H)
    # lång uniformsrock: överdel på chest, skört på hips/lår, bälte, ärmar med uppslag
    zs = J["spine0"].z
    top = pieces.torso_shell("coat", J, H, width=1.08, depth=0.82, keel=0.0, material="Cloth",
                             fold=(9, 0.03, J["neck0"].z, zs), z_bottom=zs - 0.05 * H)
    parts.append((top, "chest"))
    z_hem = 0.27 * H
    sk = fold_robe("coatskirt", zs + 0.03 * H, z_hem, 0.1 * H, 0.15 * H, H, folds=10, amp=0.06, material="Cloth", flare=0.8)
    skirt_weights(sk, J, H, zs + 0.03 * H, z_hem)
    parts.append((sk, None))
    parts.append((lib.torus("belt", J["spine0"] + V((0, 0, 0.004 * H)), 0.09 * H, 0.008 * H, material="Rope", seg=40, sy=0.82), "spine"))
    for s_ in ("L", "R"):
        sh, e, w = J[f"shoulder.{s_}"], J[f"elbow.{s_}"], J[f"wrist.{s_}"]
        parts.append((sleeve(f"dsleeveU.{s_}", sh + V((0, 0, 0.012 * H)), e, [(0.0, 0.0), (0.03 * H, 0.07), (0.04 * H, 0.22), (0.037 * H, 1.0)],
                             material="Cloth", seg=20), f"upperarm.{s_}"))
        parts.append((sleeve(f"dsleeveF.{s_}", e + V((0, 0, 0.01 * H)), w + V((0, 0, 0.012 * H)),
                             [(0.037 * H, 0), (0.038 * H, 0.6), (0.049 * H, 0.78), (0.049 * H, 1.0)], material="Cloth", seg=22),
                      f"forearm.{s_}"))
    # bandolär över höger axel ned mot vänster höft, där trumman hänger
    parts.append((tube("baldric", [V((-0.07 * H, 0.06 * H, 0.86 * H)), V((-0.09 * H, -0.02 * H, 0.84 * H)),
                                   V((-0.05 * H, -0.085 * H, 0.75 * H)), V((0.04 * H, -0.08 * H, 0.64 * H)),
                                   V((0.08 * H, -0.05 * H, 0.6 * H))], 0.009 * H, material="Rope", seg=8), "chest"))
    return J, H, parts


def drummer_rig(J, H, parts):
    """Riggar trumpojken, löser slagposen och placerar trumman och stockarna så att spetsarna träffar skinnet.
    Trumman binds vid bröstet: händerna sitter också på bröstets kedja, så de möts på samma ställe i varje hållning."""
    arm = rig.build_armature("drummer", J)
    R = 0.046 * H
    g = (J["wrist.L"] + J["handEnd.L"]) / 2 - V((0, 0, 0.004 * H))
    palm = g + V((-0.013 * H, -0.004 * H, 0.0))          # handflatan vetter medialt (-X) i vila
    target = V((0.0, -0.2 * H, 0.66 * H))                 # framför magen
    pole_x = 0.92 * R

    def pose_of(v):
        return {"upperarm.L": (v[0], v[1], v[2]), "forearm.L": (v[3], v[4], 0.0)}

    def err(v):
        rig.apply_pose(arm, pose_of(v))
        bpy.context.view_layer.update()
        M = bone_xform(arm, "hand.L")
        p = M @ palm
        n = (M.to_3x3() @ V((-1, 0, 0))).normalized()
        lim = sum(max(0.0, abs(x) - 95) ** 2 for x in v) * 1e-3
        return (300 * ((p.x - pole_x) ** 2 + (p.y - target.y) ** 2 + (p.z - target.z) ** 2)
                + 0.08 * (n - V((-1, 0, 0))).length_squared + lim + 2e-6 * sum(x * x for x in v))

    best = None
    for x0 in ([-15, 25, 0, -90, 0], [-30, 35, 5, -80, 10], [-5, 15, 8, -100, -10], [-25, 45, 0, -70, 0]):
        x, fv = nelder_mead(err, x0, [10, 12, 8, 12, 12], iters=1200)
        x, fv = nelder_mead(err, x, [3, 4, 3, 4, 4], iters=1200)
        if best is None or fv < best[1]:
            best = (x, fv)
    hitL = pose_of(best[0])
    hit = merge(hitL, rig.mirror_pose(hitL))
    rig.apply_pose(arm, hitL)
    bpy.context.view_layer.update()
    M = bone_xform(arm, "hand.L")
    p = M @ palm
    print(f"  slagpose: {[round(a, 1) for a in best[0]]}  handflata {tuple(round(c, 3) for c in p)}  fel {best[1]:.2e}")
    # trumman i vila (= slagposen relativt bröstet): skinnet en bit under och framför händerna
    head_z = p.z - 0.11 * H
    drum_c = V((0.0, p.y - 0.05 * H, head_z - 0.055 * H))
    drum = drum_parts(drum_c, 0.1 * H, 0.11 * H)
    # vänster stock i slagposen: spetsen på skinnet strax vänster om mitten, greppet i handflatan, skaftet bakåt;
    # sedan tillbaka till vilan med handens invers, så träffar spetsen skinnet i varje slag
    tip = V((0.025 * H, drum_c.y - 0.01 * H, head_z + 0.008 * H))
    butt = p + (p - tip).normalized() * 0.12 * H
    stickL = drumstick("stick.L", butt, tip, H)
    stickL.data.transform(M.inverted())
    tip_rest = M.inverted() @ tip
    stickR = lib.mirror_x(stickL, "stick.R")
    if "Wood" not in [m.name for m in stickR.data.materials]:
        stickR.data.materials.append(lib.mat("Wood"))
    rig.apply_pose(arm, {})
    objs = []
    for (o, bone) in parts + [(stickL, "hand.L"), (stickR, "hand.R")] + [(o, "chest") for o in drum]:
        if bone is not None:
            rig.bind(o, bone)
        objs.append(o)
    mesh = join(objs, "drummer")
    smooth(mesh, 50)
    # stockarna och trumman bakas på avstånd: i vilan hänger händerna mot rocken
    me = mesh.data
    wi = [i for i, m in enumerate(me.materials) if m.name in ("Wood", "Sack")]
    wood = {v for p_ in me.polygons if p_.material_index in wi for v in p_.vertices}
    for i in wood:
        me.vertices[i].co.z += 20.0
    bake_vertex_ao(mesh, H)
    for i in wood:
        me.vertices[i].co.z -= 20.0
    rig.skin(mesh, arm)
    mesh["tipL"] = list(tip_rest)
    mesh["headC"] = list(drum_c + V((0, 0, 0.055 * H)))
    ao_report(mesh)
    return arm, mesh, hit, R


def trot_pose(stance, phi, legs, stride=0.36, ds=0.42, bounce=0.06, lift=0.14, base_drop=0.03):
    """Studsande småjogg med fotlåsning (IK): stödfoten glider bakåt i jämn takt, svävfas mellan stegen.
    phi = fas i cykeln (två steg). Returnerar posen (ben, höftens höjd, lite bålrörelse)."""
    l1, l2 = legs[:2]
    Lg = l1 + l2
    a = stride * Lg / 2
    foot_len = 0.14 * Lg
    base = stance.get("loc", (0, 0, 0))
    u = (2 * phi) % 1.0
    drop = Lg * (base_drop + bounce * 0.5 * (1 + math.cos(math.tau * (u - ds))))   # lägst mitt i stödfasen
    p = dict(stance)
    for s_, off in (("L", 0.0), ("R", 0.5)):
        psi = (phi - off) % 1.0
        if psi < ds:
            t = psi / ds
            fwd, up = a - 2 * a * t, 0.0
            roll = 28 * max(0.0, (t - 0.7) / 0.3) ** 1.5 if t > 0.15 else -10 * (1 - t / 0.15)
        else:
            t = (psi - ds) / (1 - ds)
            e = 0.5 - 0.5 * math.cos(math.pi * t)
            fwd = -a + 2 * a * e
            up = lift * Lg * math.sin(math.pi * t) ** 1.3
            roll = 28 * (1 - t) ** 2 - 10 * t ** 2
        down = Lg + base[2] - drop - up - foot_len * math.sin(math.radians(max(0.0, roll)))
        t1, t2 = _leg_ik(l1, l2, fwd, down, legs[2:4])
        for bone, ang in ((f"thigh.{s_}", t1), (f"shin.{s_}", t2), (f"foot.{s_}", roll - t1 - t2)):
            bb = stance.get(bone, (0, 0, 0))
            p[bone] = (ang, bb[1], bb[2])
    w = math.sin(math.tau * phi)
    p = add(p, {"hips": (0, -7 * w, 0), "chest": (0, 6 * w, 0), "head": (0, 0, 0)})
    p["loc"] = (base[0] - 0.012 * Lg * w, base[1], base[2] - drop)
    return p


def trot_speed(legs, stride=0.36, ds=0.42, n=BEAT_N):
    return round(stride * (legs[0] + legs[1]) / (ds * n / FPS), 3)


def drummer_clips(arm, J, H, hit):
    legs = pieces.leg_lengths(J)
    # rak marschhållning; armarna i slagposen (relativt bröstet) = stockarna på skinnet
    stance = merge(hit, {"spine": (5, 0, 0), "chest": (8, 0, 0), "neck": (-4, 0, 0), "head": (-8, 0, 0),
                         "thigh.L": (-4, 0, -3), "thigh.R": (-4, 0, 3), "shin.L": (8, 0, 0), "shin.R": (8, 0, 0),
                         "foot.L": (-4, 0, 0), "foot.R": (-4, 0, 0), "loc": (0, 0, -0.006 * H)})
    # mellan slagen lyfts stocken: underarmen böjs mer så att handen och spetsen stiger
    liftL = {"upperarm.L": (hit["upperarm.L"][0] - 6, hit["upperarm.L"][1], hit["upperarm.L"][2]),
             "forearm.L": (hit["forearm.L"][0] - 26, hit["forearm.L"][1], 0.0)}
    lifted = merge(hit, liftL, rig.mirror_pose(liftL))
    A = {}
    look = lambda y, x=0: add(stance, {"head": (x, y, 0), "neck": (0, y * 0.5, 0)})
    breath = add(stance, {"chest": (-2, 0, 0), "spine": (-1, 0, 0), "head": (1.5, 0, 0)})
    A["idle"] = [(0, stance), (22, breath), (40, look(18, -4)), (55, look(18, -4)), (68, look(-14, 2)), (80, breath), (90, stance)]
    # walk: marschsteg med stockarna lyfta över trumman
    A["walk"] = []
    for f in range(BEAT_N + 1):
        phi = (f % BEAT_N) / BEAT_N
        A["walk"].append((f, trot_pose(merge(stance, {k: v for k, v in lifted.items() if "arm" in k or "hand" in k}), phi, legs,
                                       bounce=0.035, lift=0.1)))
    # drum: samma marsch, vänster stock slår vid BEAT_HITS[0] och höger vid BEAT_HITS[1] (exakt slagposen)
    A["drum"] = []
    for f in range(BEAT_N + 1):
        ff = f % BEAT_N
        arms = {}
        for s_, h in (("L", BEAT_HITS[0]), ("R", BEAT_HITS[1])):
            d = min(abs(ff - h), BEAT_N - abs(ff - h))
            sep = min(1.0, d / 3.0) ** 0.75
            for bname in (f"upperarm.{s_}", f"forearm.{s_}", f"hand.{s_}"):
                h0, a0 = hit.get(bname, (0, 0, 0)), lifted.get(bname, (0, 0, 0))
                arms[bname] = tuple(h0[i] + (a0[i] - h0[i]) * sep for i in range(3))
        A["drum"].append((f, trot_pose(merge(stance, arms), ff / BEAT_N, legs, bounce=0.035, lift=0.1)))
    # bow: bugning med stockarna i ena handen, slutar upprätt
    flourish = merge(stance, {"upperarm.R": (-20, 0, 60), "forearm.R": (-30, 0, 0), "chest": (-6, 0, 0), "head": (-14, 0, 0)})
    bowp = merge(stance, {"spine": (24, 0, 0), "chest": (30, 0, 0), "neck": (8, 0, 0), "head": (6, 0, 0),
                          "upperarm.R": (-70, 0, 18), "forearm.R": (-80, 0, 0),
                          "thigh.L": (-18, 0, -3), "thigh.R": (-2, 0, 3), "shin.L": (24, 0, 0), "shin.R": (8, 0, 0),
                          "foot.L": (-6, 0, 0), "foot.R": (-6, 0, 0), "loc": (0, 0.04 * H, -0.03 * H)})
    A["bow"] = [(0, stance), (9, flourish), (20, bowp), (30, add(bowp, {"chest": (4, 0, 0), "head": (6, 0, 0)})), (45, stance)]
    return A, stance, trot_speed(legs, n=BEAT_N)


def build_and_export_drummer(prev):
    J, H, parts = build_drummer()
    arm, mesh, hit, R = drummer_rig(J, H, parts)
    A, stance, speed = drummer_clips(arm, J, H, hit)
    print(f"[drummer] tris={tri_count(mesh)}")
    # kontroll: stockspetsens avstånd till skinnets plan i slagögonblicken (ska vara nära noll)
    tipL, headC = V(mesh["tipL"]), V(mesh["headC"])
    for fr, s_ in ((BEAT_HITS[0], "L"), (BEAT_HITS[1], "R"), (0, "L"), (8, "R")):
        rig.apply_pose(arm, dict(A["drum"])[fr])
        bpy.context.view_layer.update()
        Mh, Mc = bone_xform(arm, f"hand.{s_}"), bone_xform(arm, "chest")
        tp = Mh @ (tipL if s_ == "L" else V((-tipL.x, tipL.y, tipL.z)))
        hc, n = Mc @ headC, (Mc.to_3x3() @ V((0, 0, 1))).normalized()
        print(f"  drum f{fr} {s_}: spetsen {(tp - hc).dot(n) * 1000:+.1f} mm över skinnet")
    if prev:
        os.makedirs(prev, exist_ok=True)
        preview_drummer(arm, A, prev)
    for aname, keys in A.items():
        rig.make_action(arm, aname, keys)
    rig.export_glb(os.path.join(RAW, "drummer.glb"), [arm, mesh])
    meta = {"height": DRUMMER_H, "walkSpeed": speed,
            "events": {"drum": [h / FPS for h in BEAT_HITS]},
            "durations": {a: k[-1][0] / FPS for a, k in A.items()}}
    with open(os.path.join(RAW, "drummer.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"  drummer.json: {meta}")


def preview_drummer(arm, A, outdir):
    lib.preview_setup(target=(0, 0, 0.6), dist=3.3, elev=10, azim=-30)
    lib.box("prevground", (0, 0, -0.01), (100, 100, 0.02), material="Plinth")
    shots = [("rest", None, None, -30), ("idle", "idle", 40, -30), ("walk", "walk", 4, -60),
             ("drum_L", "drum", BEAT_HITS[0], -30), ("drum_R", "drum", BEAT_HITS[1], -90), ("bow", "bow", 20, -60),
             ("back", "idle", 0, 150)]
    for label, act, frame, az in shots:
        rig.apply_pose(arm, dict(A[act])[frame] if act else {})
        bpy.context.view_layer.update()
        lib.set_cam((0, 0, 0.6), 3.3, 10, az)
        lib.render(os.path.join(outdir, f"drummer_{label}.png"))
    lib.set_cam((0, -0.15, 0.62), 1.3, 14, -25)
    rig.apply_pose(arm, dict(A["drum"])[BEAT_HITS[0]])
    bpy.context.view_layer.update()
    lib.render(os.path.join(outdir, "drummer_drum_close.png"))
    rig.apply_pose(arm, {})


# ======================================================================= förhandsbilder

def preview_static(name, outdir, target, dist, shots, lens=60, res=(800, 800)):
    lib.preview_setup(target=target, dist=dist, elev=12, azim=-30, lens=lens, res=res)
    try:
        bpy.context.scene.eevee.use_shadows = True
    except AttributeError:
        pass
    ground = lib.box("prevground", (0, 0, -0.005 * dist), (dist * 60, dist * 60, 0.01 * dist), material="Plinth")
    files = []
    for label, el, az in shots:
        lib.set_cam(target, dist, el, az)
        p = os.path.join(outdir, f"{name}_{label}.png")
        lib.render(p)
        files.append(p)
    return files                       # marken exporteras inte (export_glb tar bara de valda objekten)


def main():
    only = arg("--only")
    names = only.split(",") if only else ["elk", "hand", "drummer"]
    prev = arg("--preview")
    os.makedirs(RAW, exist_ok=True)
    for name in names:
        lib.reset()
        if name == "elk":
            ob, H = build_elk()
            bake_vertex_ao(ob, H)
            print(f"[elk] tris={tri_count(ob)} storlek={dims(ob)}")
            if prev:
                os.makedirs(prev, exist_ok=True)
                preview_static("elk", prev, (0, 0, 1.4), 8.0,
                               [("front34", 8, -32), ("side", 4, -90), ("front", 4, 0), ("back", 14, 150)])
            rig.export_glb(os.path.join(RAW, "elk.glb"), [ob], animations=False)
        elif name == "hand":
            ob, H = build_hand()
            bake_vertex_ao(ob, H)
            print(f"[hand] tris={tri_count(ob)} storlek={dims(ob)}")
            if prev:
                os.makedirs(prev, exist_ok=True)
                preview_static("hand", prev, (0, 0, 0.6), 11.0,
                               [("front34", 18, -40), ("side", 6, -90), ("top", 70, -20), ("back", 20, 140)])
            rig.export_glb(os.path.join(RAW, "hand.glb"), [ob], animations=False)
        elif name == "drummer":
            build_and_export_drummer(prev)


if __name__ == "__main__":
    main()
