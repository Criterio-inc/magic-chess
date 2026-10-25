"""Extramodeller ur Monty Python and the Holy Grail, i samma marmorstil som pjäserna.

Körs: blender -b -P blender/extras.py -- [--only rabbit,foot,patsy] [--preview DIR]
Ut (råa exporter): build/models/rabbit.glb, foot.glb, patsy.glb + build/models/patsy.json
(tools/build_assets.sh komprimerar dem till public/models/ och gör *_lo.glb).

- rabbit: Mördarkaninen från Caerbannog. Statisk, 0,34 m, sitter upp på bakbenen, tittar mot -Y.
  Material: Fur (vit), Eye (röd, lyser i spelet), Dark (nos), Tooth (huggtänder).
- foot:   Den jättelika foten som ett fragment av en marmorkoloss, 4,2 m lång, tårna mot -Y, sulan plan
  vid z = 0, origo mitt under sulan. Avbruten strax ovanför fotleden med en grov brottyta. Material: Stone.
- patsy:  Kung Arthurs väpnare, 1,15 m, hukande i kåpa och luva med säck på ryggen och en kokosnötshalva i
  varje hand (styvt bundna till hand.L/hand.R). Standardskelettet. Klipp: idle, walk, clap, bow.
  Material: Stone (hud: lagets marmor), Cloth (kåpa och luva: ofärgad säckväv i spelet), Sack (säcken),
  Rope (rep, rem och knut), Wood (kokosnötterna). Spelet ger honom egna material i src/patsy.js.
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


def mat_setup():
    m = lib.mat("Eye")
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Emission Color"].default_value = (1.0, 0.05, 0.02, 1)
    b.inputs["Emission Strength"].default_value = 2.5


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


# ======================================================================= MÖRDARKANINEN

def build_rabbit():
    """Söt, fluffig vit kanin som sitter upp på bakbenen med tassarna framför bröstet — och röda ögon,
    rynkad panna och två vassa huggtänder."""
    F = anatomy.Forms(0.34)
    b = "root"
    for k in (1, -1):
        F.ell((k * 0.043, 0.032, 0.056), (0.04, 0.058, 0.05), b, 2.4)            # lår (hopvikta bakben)
        F.ell((k * 0.05, 0.05, 0.035), (0.026, 0.04, 0.03), b, 2.6)              # hasor
        F.ell((k * 0.042, -0.022, 0.013), (0.019, 0.05, 0.013), b, 2.8)          # långa bakfötter
        F.ell((k * 0.042, -0.066, 0.012), (0.016, 0.015, 0.011), b, 3.0)         # tår
    F.ell((0, 0.04, 0.068), (0.062, 0.058, 0.058), b, 2.4)                        # rumpa
    F.ell((0, 0.014, 0.128), (0.05, 0.05, 0.072), b, 2.4)                         # kropp, upprätt päronform
    F.ell((0, -0.016, 0.118), (0.044, 0.04, 0.058), b, 2.5)                       # mage
    F.ell((0, -0.026, 0.168), (0.034, 0.028, 0.03), b, 2.6)                       # bröstpäls
    # framben och tassar, upplyfta framför bröstet
    for k in (1, -1):
        F.chain([(k * 0.028, -0.028, 0.168), (k * 0.026, -0.05, 0.14), (k * 0.02, -0.062, 0.122)], [0.013, 0.011, 0.01], b, 2.8)
        F.ell((k * 0.019, -0.066, 0.114), (0.011, 0.013, 0.011), b, 3.0)
    # huvud
    hc = V((0, -0.022, 0.232))
    head0 = len(F.items)
    F.ell(hc, (0.041, 0.046, 0.039), b, 2.5)
    F.ell(hc + V((0, 0.022, 0.008)), (0.037, 0.038, 0.035), b, 2.5)              # bakhuvud
    F.ell(hc + V((0, -0.036, -0.012)), (0.025, 0.024, 0.021), b, 2.6)            # nosparti
    for k in (1, -1):
        F.ell(hc + V((k * 0.014, -0.049, -0.017)), (0.0145, 0.013, 0.013), b, 2.9)   # morrhårsdynor
        F.ell(hc + V((k * 0.03, -0.01, -0.014)), (0.021, 0.022, 0.021), b, 2.6)      # runda kinder
        F.ell(hc + V((k * 0.042, 0.0, -0.022)), (0.008, 0.01, 0.012), b, 3.2)        # kindtofs
        # rynkad panna: en vulst över ögat som lutar ned mot mitten (det elaka)
        F.ell(hc + V((k * 0.02, -0.036, 0.018)), (0.016, 0.008, 0.006), b, 3.2,
              q=Quaternion(V((0, 1, 0)), k * 0.42))
        F.ell(hc + V((k * 0.029, -0.031, 0.004)), (0.013, 0.008, 0.012), b, 3.0, neg=True)  # ögonhåla
    F.ell(hc + V((0, -0.062, -0.03)), (0.0018, 0.008, 0.008), b, 3.5, neg=True)  # klyvd överläpp
    F.ell(hc + V((0, -0.044, -0.036)), (0.012, 0.012, 0.006), b, 3.0)            # haka
    # öron: långa, lätt utåtböjda, med urholkad insida framåt
    for k in (1, -1):
        base = hc + V((k * 0.017, 0.014, 0.028))
        mid_ = base + V((k * 0.012, 0.006, 0.055))
        tip = base + V((k * 0.026, 0.02, 0.106))
        F.oriented(base, mid_, 0.0115, 0.0075, b, 3.0)
        F.oriented(base + (mid_ - base) * 0.5, mid_ + (tip - mid_) * 0.5, 0.015, 0.0068, b, 3.0)
        F.oriented(mid_, tip, 0.0125, 0.006, b, 3.0)
        F.oriented(base + (mid_ - base) * 0.7 + V((0, -0.006, 0)), mid_ + (tip - mid_) * 0.7 + V((0, -0.006, 0)),
                   0.0085, 0.004, b, 3.5)
        F.items[-1] = F.items[-1][:6] + (True,)                                   # (negativ: örats insida)
    # stort, sött huvud: skala huvudformerna kring hc
    HS = 1.16
    for i in range(head0, len(F.items)):
        kind, c, r, bone, st, q, neg = F.items[i]
        F.items[i] = (kind, hc + (c - hc) * HS, tuple(x * HS for x in r), bone, st, q, neg)
    # bomullssvans
    F.ball((0, 0.098, 0.05), 0.02, b, 2.8)
    for i in range(7):
        a = i / 7 * math.tau
        F.ball((0.012 * math.cos(a), 0.104 + 0.004 * math.sin(a * 2), 0.05 + 0.012 * math.sin(a)), 0.009, b, 3.2)
    fur = blob("rabbit_fur", F, 12000, 0.0021, "Fur", fluff=0.0008, fluff_size=0.0075)

    parts = [fur]
    for k in (1, -1):
        ec = hc + V((k * 0.0275, -0.033, 0.003)) * HS
        parts.append(ellipsoid(f"eye{k}", ec, (0.0105 * HS, 0.0105 * HS, 0.0118 * HS), material="Eye", seg=16, rings=10))
        # liten vass huggtand under överläppen, pekar ned och lite framåt
        a = hc + V((k * 0.0056, -0.0585, -0.031)) * HS
        parts.append(cone(f"fang{k}", a, a + V((0.0, -0.0025, -0.0135)), 0.0032, "Tooth", seg=10))
    parts.append(ellipsoid("nose", hc + V((0, -0.0605, -0.009)) * HS, (0.0072 * HS, 0.0045 * HS, 0.0052 * HS), material="Dark", seg=12, rings=8))
    ob = join(parts, "rabbit")
    # origo mitt mellan fötterna på marken, sedan exakt 0,34 m hög
    me = ob.data
    zmin = min(v.co.z for v in me.vertices)
    feet = [v.co for v in me.vertices if v.co.z < zmin + 0.004]
    cy = (min(c.y for c in feet) + max(c.y for c in feet)) / 2
    me.transform(Matrix.Translation((0, -cy, -zmin)))
    for v in me.vertices:              # sitter plant på marken
        if v.co.z < 0.0025:
            v.co.z = 0.0
    hgt = max(v.co.z for v in me.vertices)
    me.transform(Matrix.Scale(0.34 / hgt, 4))
    smooth(ob, 60)
    return ob, 0.34


# ======================================================================= FOTEN

FOOT_LEN = 4.2


def build_foot():
    """Höger fot i klassiska grekiska proportioner (andra tån längst) i människostorlek, skalas sedan upp
    till en koloss. Stortån åt +X (medialt), tårna mot -Y."""
    F = anatomy.Forms(1.0)
    b = "root"
    # häl: hälbenets runda bakdel sticker ut bakom hälsenan
    F.ell((0.0, 0.094, 0.031), (0.03, 0.035, 0.032), b, 2.4)
    F.ell((0.0, 0.106, 0.048), (0.02, 0.018, 0.026), b, 2.6)
    # underbenets stump (smalast strax ovanför fotleden), hälsena och skenbenets kant; kapas vid brottet
    F.chain([(0, 0.102, 0.06), (0, 0.094, 0.12), (0, 0.088, 0.27)], [0.012, 0.0115, 0.017], b, 2.3)
    F.ell((0.002, 0.071, 0.13), (0.029, 0.031, 0.06), b, 2.4)
    F.ell((0.003, 0.068, 0.23), (0.037, 0.037, 0.075), b, 2.4)
    F.chain([(0.007, 0.046, 0.1), (0.009, 0.042, 0.27)], [0.012, 0.015], b, 2.8)
    F.ell((0.003, 0.06, 0.074), (0.033, 0.032, 0.03), b, 2.4)                     # språngben
    # fotknölar: den inre högre och längre fram; mjuka, inte kulor
    F.ell((0.021, 0.066, 0.086), (0.0065, 0.011, 0.013), b, 2.2)
    F.ell((-0.023, 0.078, 0.071), (0.0065, 0.011, 0.012), b, 2.2)
    # mellanfot: en massa från häl till trampdyna, fotryggen högst på insidan
    F.ell((-0.002, 0.022, 0.028), (0.036, 0.075, 0.03), b, 2.4)
    F.ell((0.008, 0.034, 0.052), (0.03, 0.05, 0.028), b, 2.4)
    F.ell((0.004, -0.03, 0.028), (0.04, 0.038, 0.022), b, 2.4)
    F.ell((-0.026, 0.03, 0.011), (0.015, 0.062, 0.013), b, 2.3)                   # yttre fotranden mot marken
    # sträcksenor på fotryggen
    for (x0, x1) in ((0.026, 0.03), (0.01, 0.007), (-0.006, -0.01), (-0.018, -0.024)):
        F.chain([(x0 * 0.6, 0.05, 0.074), (x1, -0.058, 0.033)], 0.003, b, 3.5)
    # fotbollen och stortåns trampdyna
    F.ell((0.004, -0.058, 0.016), (0.045, 0.026, 0.018), b, 2.5)
    F.ell((0.028, -0.062, 0.018), (0.02, 0.022, 0.018), b, 2.7)
    # fotvalvet: urgröpt underifrån, bara på insidan
    F.ell((0.037, 0.025, -0.004), (0.016, 0.046, 0.016), b, 2.8, neg=True)
    toes = [  # (rot, knoge, spets), radier — grekisk fot: andra tån längst
        ((0.03, -0.074, 0.021), (0.032, -0.1, 0.017), (0.033, -0.121, 0.0135), (0.0135, 0.0125, 0.0115)),
        ((0.008, -0.081, 0.017), (0.008, -0.105, 0.0135), (0.007, -0.129, 0.0095), (0.0086, 0.008, 0.0072)),
        ((-0.008, -0.079, 0.0145), (-0.009, -0.1, 0.012), (-0.01, -0.121, 0.0088), (0.0081, 0.0076, 0.0069)),
        ((-0.022, -0.074, 0.0125), (-0.024, -0.093, 0.0105), (-0.026, -0.11, 0.0082), (0.0076, 0.0071, 0.0064)),
        ((-0.035, -0.066, 0.0115), (-0.038, -0.083, 0.0098), (-0.041, -0.097, 0.0078), (0.0071, 0.0066, 0.006)),
    ]
    for (r0, k1, tp, rr) in toes:
        F.chain([r0, k1, tp], list(rr), b, 3.0)
        F.ball(V(tp) + V((0, 0.002, -0.002)), rr[2] * 1.05, b, 3.2)              # tåns trampdyna
        F.ball(V(k1) + V((0, 0.0, 0.002)), rr[1] * 1.02, b, 3.4)                 # knoge
    for i in range(4):  # skåror mellan tåspetsarna
        a, c = toes[i][2], toes[i + 1][2]
        m = (V(a) + V(c)) / 2
        F.ell(m + V((0, -0.004, 0.004)), (0.0022, 0.014, 0.012), b, 3.5, neg=True)
    stone = blob("foot_stone", F, 30000, 0.0011, "Stone")
    me = stone.data
    # plan sula: allt under marken pressas upp till z = 0
    for v in me.vertices:
        if v.co.z < 0.0:
            v.co.z = 0.0
    # tånaglar
    nails = []
    for i, (r0, k1, tp, rr) in enumerate(toes):
        d = (V(tp) - V(k1)).normalized()
        c = V(tp) + V((0, 0.0, rr[2] * 0.9)) - d * rr[2] * 0.2
        nl = ellipsoid(f"nail{i}", (0, 0, 0), (rr[2] * 0.8, rr[2] * 0.95, rr[2] * 0.24), seg=16, rings=8)
        q = V((0, -1, 0)).rotation_difference(d)
        nl.data.transform(Matrix.Translation(c) @ q.to_matrix().to_4x4())
        nails.append(nl)
    ob = join([stone] + nails, "foot")
    me = ob.data
    # brottet: snett plan strax ovanför fotleden, allt ovanför tas bort och hålet fylls med koncentriska ringar
    p0, nrm = V((0, 0.07, 0.185)), V((0.0, 0.18, 1.0)).normalized()
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
    rings, K = [loop], 8                    # tvärsnittet är stjärnformat kring mitten: skala mot den
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
    # brottzonen: 1 på brottytan, avtagande en bit ned längs sidan (så blir kanten ojämn utan söm)
    band = 0.03
    vg = ob.vertex_groups.new(name="break")
    for v in me.vertices:
        h = (v.co - p0).dot(nrm)
        if h > -band:
            vg.add([v.index], min(1.0, (1 + h / band)) ** 1.6 if h < -1e-6 else 1.0, "REPLACE")
    # upp till kolossformat; origo mitt under sulan
    s = FOOT_LEN / (max(v.co.y for v in me.vertices) - min(v.co.y for v in me.vertices))
    me.transform(Matrix.Scale(s, 4))
    sole = [v.co for v in me.vertices if v.co.z < 1e-4]
    cx = (min(c.x for c in sole) + max(c.x for c in sole)) / 2
    cy = (min(c.y for c in sole) + max(c.y for c in sole)) / 2
    me.transform(Matrix.Translation((-cx, -cy, 0)))
    # grov brottsten: lib.add_rock på brottzonen (bara längs brottplanets normal, ingen utbuktning)
    lib.add_rock(ob, strength=0.3, size=0.8, levels=1, seed=7)
    ob.modifiers.remove(ob.modifiers["Sub"])
    for mname in ("Rock", "Rock2"):
        m = ob.modifiers[mname]
        m.vertex_group = "break"
        m.direction = "Z"
    lib.apply_mods(ob)
    ob.vertex_groups.clear()
    smooth(ob, 35)
    return ob, 3.4


# ======================================================================= PATSY

PATSY_H = 1.15
CLAP_N = 15                        # 0,5 s
CLAP_HITS = (4, 11)                # bildrutor då kokosnötterna slår ihop (två per cykel)


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


def coconut_shell(name, R, material="Wood"):
    """Halv kokosnöt: skål med öppningen mot +Z, kanten i z = 0 och polen i z = -0,92·R, lite fibrig."""
    t = 0.09 * R
    prof = []
    for i in range(9):                  # utsidan, polen -> kanten
        a = math.pi / 2 * i / 8
        prof.append((R * math.sin(a), -0.92 * R * math.cos(a)))
    prof.append((R - t * 0.5, 0.004 * R))
    for i in range(8, -1, -1):          # insidan, kanten -> polen
        a = math.pi / 2 * i / 8
        prof.append(((R - t) * math.sin(a), -0.92 * (R - t) * math.cos(a) + 0.002 * R))
    ob = lathe(name, prof, seg=28, material=material, cap_bottom=False, cap_top=False)
    for v in ob.data.vertices:          # fibrer: grunda fåror längs nöten
        if v.co.z < -0.02 * R:
            a = math.atan2(v.co.y, v.co.x)
            r = math.hypot(v.co.x, v.co.y)
            if r > (R - t) * 0.999 * math.sin(math.acos(min(1.0, -v.co.z / (0.92 * R)))) - 1e-6:
                v.co.x *= 1 + 0.025 * math.sin(a * 9)
                v.co.y *= 1 + 0.025 * math.sin(a * 9)
    return ob


def hood(J, H):
    """Luva med ansiktsöppning, spetsig strut i nacken och en krage över axlarna."""
    hc = face_head(J, H)
    c = hc + V((0, 0.01 * H, 0.012 * H))
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=1.0)
    bmesh.ops.scale(bm, vec=(0.068 * H, 0.074 * H, 0.083 * H), verts=bm.verts)
    # ansiktsöppningen: bort med ytorna som vetter framåt i en oval
    kill = []
    for f in bm.faces:
        d = f.calc_center_median()
        dn = V((d.x / 0.068, d.y / 0.074, d.z / 0.083)).normalized()
        if dn.y < -0.42 and -0.75 < dn.z < 0.62 and abs(dn.x) < 0.78:
            kill.append(f)
        elif dn.z < -0.55:              # halsen
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.translate(bm, vec=c, verts=bm.verts)
    hd = lib._obj_from_bm("hood", bm, "Cloth")
    for v in hd.data.vertices:          # lite slokande, tygaktigt
        v.co.z -= 0.006 * H * max(0.0, (v.co.y - c.y) / (0.074 * H))
    add_solidify(hd, 0.007 * H, offset=1)
    add_subsurf(hd, 1)
    out = [(hd, "head")]
    # strut (liripipe) från luvans topp ned längs ryggen
    out.append((tube("liripipe", [c + V((0, 0.045 * H, 0.055 * H)), c + V((0, 0.08 * H, 0.01 * H)), c + V((0, 0.088 * H, -0.05 * H)),
                                   c + V((0.006 * H, 0.084 * H, -0.1 * H))], [0.026 * H, 0.016 * H, 0.009 * H, 0.004 * H],
                      material="Cloth", seg=12), "head"))
    # krage (gugel) över axlarna, med veck
    zn = J["neck0"].z
    col = lathe("cowl", [(0.05 * H, zn + 0.04 * H), (0.08 * H, zn + 0.024 * H), (0.125 * H, zn + 0.008 * H), (0.155 * H, zn - 0.018 * H),
                         (0.166 * H, zn - 0.05 * H), (0.167 * H, zn - 0.085 * H), (0.16 * H, zn - 0.112 * H)], seg=56, material="Cloth",
                sy=0.76, center=(0, 0.012 * H, 0), fold=(11, 0.035, zn + 0.01 * H, zn - 0.115 * H), cap_bottom=False, cap_top=False)
    for v in col.data.vertices:        # ojämn kant
        if v.co.z < zn - 0.09 * H:
            a = math.atan2(v.co.y, v.co.x)
            v.co.z += 0.01 * H * math.sin(a * 7 + 1.3)
    add_solidify(col, 0.008 * H, offset=1)
    out.append((col, "chest"))
    return out


def sack(J, H):
    """Stor knölig säck på ryggen, hopknuten upptill, med en rem över vänster axel."""
    F = anatomy.Forms(H)
    b = "chest"
    c = V((0, 0.155 * H, 0.59 * H))     # lågt på ryggen: när han hukar får säcken inte sticka upp över axlarna
    F.ell(c, (0.095 * H, 0.08 * H, 0.135 * H), b, 2.4)
    for (dx, dy, dz, r) in ((0.04, 0.02, -0.07, 0.06), (-0.045, 0.015, -0.05, 0.056), (0.025, 0.035, 0.05, 0.05),
                            (-0.03, 0.03, 0.04, 0.05), (0.0, 0.05, -0.02, 0.062), (0.0, 0.005, -0.1, 0.068)):
        F.ball(c + V((dx * H, dy * H, dz * H)), r * H, b, 2.4)               # knölar av innehållet
    top = c + V((0, 0.0, 0.155 * H))
    F.chain([c + V((0, 0, 0.11 * H)), top], [0.045 * H, 0.02 * H], b, 2.8)   # strypt hals
    for i in range(5):                                                        # tygvippa ovanför knuten
        a = i / 5 * math.tau
        F.ell(top + V((0.014 * H * math.cos(a), 0.014 * H * math.sin(a), 0.03 * H)), (0.012 * H, 0.012 * H, 0.025 * H), b, 3.0,
              q=Quaternion(V((-math.sin(a), math.cos(a), 0)), 0.5))
    sk = blob("sack", F, 4500, 0.004 * H, "Sack")
    out = [(sk, "chest")]
    out.append((lib.torus("sacktie", top + V((0, 0, 0.005 * H)), 0.024 * H, 0.006 * H, material="Rope", seg=16), "chest"))
    # rem: från säckens hals över vänster axel och snett ned över bröstet till bältet på höger sida
    out.append((tube("strap", [top + V((0.01 * H, -0.02 * H, -0.01 * H)), V((0.07 * H, 0.06 * H, 0.86 * H)), V((0.09 * H, -0.02 * H, 0.84 * H)),
                               V((0.05 * H, -0.085 * H, 0.75 * H)), V((-0.04 * H, -0.08 * H, 0.64 * H)), V((-0.08 * H, -0.05 * H, 0.6 * H))],
                      0.009 * H, material="Rope", seg=8), "chest"))
    return out


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


def build_patsy():
    H = PATSY_H
    J = rig.joints(H, sw=0.125, hw=0.058)
    parts = []
    # syns: ansikte, händer och bara fötter (resten av den skulpterade kroppen göms av kåpan)
    T = anatomy.Forms(H)
    anatomy.torso(T, J, 0.92)
    anatomy.neck(T, J)
    anatomy.head(T, J, face=True)
    parts.append((anatomy.sculpt("body_torso", T, 7000, res=0.0017 * H), None))
    for s_ in ("L", "R"):
        A_ = anatomy.Forms(H)
        anatomy.arm(A_, J, s_, 0.95, "open")
        parts.append((anatomy.sculpt(f"body_arm{s_}", A_, 2400), None))
        L_ = anatomy.Forms(H)                       # bara underben och bara fötter: låren göms av kjolen
        anatomy.leg(L_, J, s_, 1.0, "bare")
        L_.items = [it for it in L_.items if it[3] != f"thigh.{s_}"]
        parts.append((anatomy.sculpt(f"body_leg{s_}", L_, 2200), None))
    hc = face_head(J, H)
    parts.append((ellipsoid("patsynose", hc + V((0, -0.058 * H, -0.014 * H)), (0.011 * H, 0.011 * H, 0.012 * H), seg=14, rings=10), "head"))
    for k in (1, -1):                   # buskiga ögonbryn under luvan
        parts.append((ellipsoid(f"pbrow{k}", hc + V((k * 0.02 * H, -0.047 * H, 0.017 * H)), (0.014 * H, 0.006 * H, 0.0045 * H), seg=12, rings=6), "head"))
    parts += hood(J, H)
    # kåpa: överdel på chest, kjol på hips/lår, repbälte, vida ärmar
    zs = J["spine0"].z
    top = pieces.torso_shell("tunic", J, H, width=1.08, depth=0.82, keel=0.0, material="Cloth",
                             fold=(9, 0.04, J["neck0"].z, zs), z_bottom=zs - 0.05 * H)
    parts.append((top, "chest"))
    z_hem = 0.21 * H
    sk = fold_robe("skirt", zs + 0.03 * H, z_hem, 0.1 * H, 0.165 * H, H, folds=12, amp=0.09, material="Cloth", flare=1.0)
    for v in sk.data.vertices:          # ojämn, trasig fåll
        if v.co.z < z_hem + 0.03 * H:
            a = math.atan2(v.co.y, v.co.x)
            v.co.z += 0.012 * H * (math.sin(a * 5 + 0.7) * 0.6 + math.sin(a * 11) * 0.4)
    skirt_weights(sk, J, H, zs + 0.03 * H, z_hem)
    parts.append((sk, None))
    parts.append((lib.torus("rope", J["spine0"] + V((0, 0, 0.004 * H)), 0.09 * H, 0.009 * H, material="Rope", seg=40, sy=0.82), "spine"))
    parts.append((tube("ropeend", [V((0.05 * H, -0.075 * H, zs)), V((0.06 * H, -0.085 * H, zs - 0.08 * H)), V((0.055 * H, -0.09 * H, zs - 0.15 * H))],
                       0.007 * H, material="Rope", seg=8), "hips"))
    for s_ in ("L", "R"):
        sh, e, w = J[f"shoulder.{s_}"], J[f"elbow.{s_}"], J[f"wrist.{s_}"]
        parts.append((sleeve(f"psleeveU.{s_}", sh + V((0, 0, 0.012 * H)), e, [(0.0, 0.0), (0.03 * H, 0.07), (0.043 * H, 0.22), (0.04 * H, 1.0)],
                             material="Cloth", seg=20), f"upperarm.{s_}"))
        parts.append((sleeve(f"psleeveF.{s_}", e + V((0, 0, 0.01 * H)), w + V((0, 0, 0.012 * H)),
                             [(0.04 * H, 0), (0.045 * H, 0.6), (0.054 * H, 1.0), (0.05 * H, 1.0)], material="Cloth", seg=22,
                             fold=(7, 0.1, 0.2, 1.0)), f"forearm.{s_}"))
    parts += sack(J, H)
    return J, H, parts


def patsy_rig(J, H, parts):
    """Riggar Patsy, löser klapp-posen och fäster kokosnötterna så att kanterna möts exakt i den."""
    arm = rig.build_armature("patsy", J)
    R = 0.046 * H
    g = (J["wrist.L"] + J["handEnd.L"]) / 2 - V((0, 0, 0.004 * H))
    palm = g + V((-0.013 * H, -0.004 * H, 0.0))          # handflatan vetter medialt (-X) i vila
    target = V((0.0, -0.2 * H, 0.66 * H))                 # framför bröstet
    pole_x = 0.92 * R

    def pose_of(v):
        # handen roteras inte: den mjukt viktade skulpterade handen följer handbenet bara delvis vid handleden
        return {"upperarm.L": (v[0], v[1], v[2]), "forearm.L": (v[3], v[4], 0.0)}

    def err(v):
        rig.apply_pose(arm, pose_of(v))
        bpy.context.view_layer.update()
        M = bone_xform(arm, "hand.L")
        p = M @ palm
        n = (M.to_3x3() @ V((-1, 0, 0))).normalized()
        lim = sum(max(0.0, abs(x) - 95) ** 2 for x in v) * 1e-3          # inga vridna ledgångar
        # handflatans läge är målet; dess riktning bara ungefär (skålen placeras ändå exakt mot x = 0)
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
    print(f"  klapp-pose: {[round(a, 1) for a in best[0]]}  handflata {tuple(round(c, 3) for c in p)}  fel {best[1]:.2e}")
    # kokosnötshalvan placeras i klapp-posen med kanten exakt i x = 0 (öppningen mot -X), polen mot handflatan,
    # och förs sedan tillbaka till vilopositionen med handens invers: då möts kanterna exakt i varje klapp
    shellL = coconut_shell("coconut.L", R)
    place = Matrix.Translation(V((0.0, p.y, p.z))) @ V((0, 0, 1)).rotation_difference(V((-1, 0, 0))).to_matrix().to_4x4()
    shellL.data.transform(M.inverted() @ place)
    rim_rest = M.inverted() @ V((0.0, p.y, p.z))
    rim_n_rest = (M.inverted().to_3x3() @ V((-1, 0, 0))).normalized()
    shellR = lib.mirror_x(shellL, "coconut.R")
    shellR.data.materials.append(lib.mat("Wood"))
    rig.apply_pose(arm, {})
    objs = []
    for (o, bone) in parts + [(shellL, "hand.L"), (shellR, "hand.R")]:
        if bone is not None:
            rig.bind(o, bone)
        objs.append(o)
    mesh = join(objs, "patsy")
    smooth(mesh, 50)
    # kokosnötterna bakas på avstånd: i vilan hänger de mot kjolen, men i spelet hålls de framför bröstet
    me = mesh.data
    wi = [i for i, m in enumerate(me.materials) if m.name == "Wood"]
    wood = {v for p in me.polygons if p.material_index in wi for v in p.vertices}
    for i in wood:
        me.vertices[i].co.z += 20.0
    bake_vertex_ao(mesh, H)
    for i in wood:
        me.vertices[i].co.z -= 20.0
    rig.skin(mesh, arm)
    mesh["rimL"], mesh["rimLn"] = list(rim_rest), list(rim_n_rest)
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


def trot_speed(legs, stride=0.36, ds=0.42, n=CLAP_N):
    return round(stride * (legs[0] + legs[1]) / (ds * n / FPS), 3)


def patsy_clips(arm, J, H, hit):
    legs = pieces.leg_lengths(J)
    # hukande grundhållning; armarna i klapp-posen (relativt bröstet) = kokosnötterna mot varandra
    stance = merge(hit, {"spine": (18, 0, 0), "chest": (24, 0, 0), "neck": (-12, 0, 0), "head": (-26, 0, 0),
                         "thigh.L": (-12, 0, -3), "thigh.R": (-12, 0, 3), "shin.L": (24, 0, 0), "shin.R": (24, 0, 0),
                         "foot.L": (-12, 0, 0), "foot.R": (-12, 0, 0), "loc": (0, 0, -0.02 * H)})
    apartL = {"upperarm.L": (hit["upperarm.L"][0] + 5, hit["upperarm.L"][1], hit["upperarm.L"][2] - 18),
              "forearm.L": (hit["forearm.L"][0] + 6, hit["forearm.L"][1] - 16, 0.0)}
    apart = merge(hit, apartL, rig.mirror_pose(apartL))
    A = {}
    # idle: står och väntar med kokosnötterna ihop, andas, tittar sig omkring (armarna rör sig inte mot bröstet)
    look = lambda y, x=0: add(stance, {"head": (x, y, 0), "neck": (0, y * 0.5, 0)})
    breath = add(stance, {"chest": (-2, 0, 0), "spine": (-1, 0, 0), "head": (1.5, 0, 0)})
    A["idle"] = [(0, stance), (22, breath), (40, look(18, -4)), (55, look(18, -4)), (68, look(-14, 2)), (80, breath), (90, stance)]
    # walk: studsande jogg, kokosnötterna isär framför sig och lite gungande
    A["walk"] = []
    for f in range(CLAP_N + 1):
        phi = (f % CLAP_N) / CLAP_N
        sw = math.sin(math.tau * phi)
        arms = add(apart, {"upperarm.L": (-8 * sw, 0, 0), "upperarm.R": (8 * sw, 0, 0)})
        A["walk"].append((f, trot_pose(merge(stance, {k: v for k, v in arms.items() if "arm" in k or "hand" in k}), phi, legs)))
    # clap: samma jogg, kokosnötterna slås ihop två gånger per cykel (exakt klapp-posen vid CLAP_HITS)
    A["clap"] = []
    for f in range(CLAP_N + 1):
        ff = f % CLAP_N
        d = min(min(abs(ff - h), CLAP_N - abs(ff - h)) for h in CLAP_HITS)
        gap = 3.5
        sep = min(1.0, d / gap) ** 0.75
        arms = {}
        for bname in ("upperarm.L", "forearm.L", "hand.L", "upperarm.R", "forearm.R", "hand.R"):
            h0, a0 = hit.get(bname, (0, 0, 0)), apart.get(bname, (0, 0, 0))
            arms[bname] = tuple(h0[i] + (a0[i] - h0[i]) * sep for i in range(3))
        A["clap"].append((f, trot_pose(merge(stance, arms), ff / CLAP_N, legs)))
    # bow: djup bugning med en svepande gest, slutar upprätt
    flourish = merge(stance, {"upperarm.L": (-20, 0, -60), "forearm.L": (-30, 0, 0), "upperarm.R": (-20, 0, 60), "forearm.R": (-30, 0, 0),
                              "chest": (-6, 0, 0), "spine": (-2, 0, 0), "head": (-22, 0, 0)})
    bowp = merge(stance, {"spine": (28, 0, 0), "chest": (36, 0, 0), "neck": (8, 0, 0), "head": (6, 0, 0),
                          "upperarm.L": (30, 0, -38), "forearm.L": (-20, 0, 0), "upperarm.R": (-75, 0, 18), "forearm.R": (-80, 0, 0),
                          "thigh.L": (-22, 0, -3), "thigh.R": (-2, 0, 3), "shin.L": (30, 0, 0), "shin.R": (10, 0, 0),
                          "foot.L": (-8, 0, 0), "foot.R": (-8, 0, 0), "loc": (0, 0.05 * H, -0.04 * H)})
    A["bow"] = [(0, stance), (9, flourish), (20, bowp), (30, add(bowp, {"chest": (4, 0, 0), "head": (6, 0, 0)})), (45, stance)]
    return A, stance, trot_speed(legs)


def build_and_export_patsy(prev):
    J, H, parts = build_patsy()
    arm, mesh, hit, R = patsy_rig(J, H, parts)
    A, stance, speed = patsy_clips(arm, J, H, hit)
    tris = tri_count(mesh)
    print(f"[patsy] tris={tris}")
    # kontroll: kokosnötternas kantcentrum och öppningsnormaler i klappögonblicken (ska sammanfalla)
    rimL, nL = mesh["rimL"], V(mesh["rimLn"])
    rimL = V(rimL)
    rimR, nR = V((-rimL.x, rimL.y, rimL.z)), V((-nL.x, nL.y, nL.z))
    for fr in CLAP_HITS + (0, 8):
        rig.apply_pose(arm, dict(A["clap"])[fr])
        bpy.context.view_layer.update()
        ML, MR = bone_xform(arm, "hand.L"), bone_xform(arm, "hand.R")
        cL, cR = ML @ rimL, MR @ rimR
        a = math.degrees((ML.to_3x3() @ nL).angle(-(MR.to_3x3() @ nR)))
        print(f"  clap f{fr}: kantavstånd {(cL - cR).length * 1000:.2f} mm, vinkel {a:.2f} grader")
    if prev:
        os.makedirs(prev, exist_ok=True)
        preview_patsy(arm, A, prev)
    for aname, keys in A.items():
        rig.make_action(arm, aname, keys)
    rig.export_glb(os.path.join(RAW, "patsy.glb"), [arm, mesh])
    meta = {"height": PATSY_H, "walkSpeed": speed,
            "events": {"clap": [h / FPS for h in CLAP_HITS]},
            "durations": {a: k[-1][0] / FPS for a, k in A.items()}}
    with open(os.path.join(RAW, "patsy.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"  patsy.json: {meta}")


def preview_patsy(arm, A, outdir):
    lib.preview_setup(target=(0, 0, 0.6), dist=3.3, elev=10, azim=-30)
    lib.box("prevground", (0, 0, -0.01), (100, 100, 0.02), material="Plinth")
    shots = [("rest", None, None, -30), ("idle", "idle", 40, -30), ("walk", "walk", 4, -60),
             ("clap_hit", "clap", CLAP_HITS[0], -30), ("clap_side", "clap", CLAP_HITS[1], -90), ("clap_open", "clap", 8, -30),
             ("bow", "bow", 20, -60), ("back", "idle", 0, 150), ("idle_side", "idle", 0, -90)]
    for label, act, frame, az in shots:
        rig.apply_pose(arm, dict(A[act])[frame] if act else {})
        bpy.context.view_layer.update()
        lib.set_cam((0, 0, 0.6), 3.3, 10, az)
        lib.render(os.path.join(outdir, f"patsy_{label}.png"))
    lib.set_cam((0, -0.15, 0.72), 1.3, 6, -25)
    rig.apply_pose(arm, dict(A["clap"])[CLAP_HITS[0]])
    bpy.context.view_layer.update()
    lib.render(os.path.join(outdir, "patsy_clap_close.png"))
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
    names = only.split(",") if only else ["rabbit", "foot", "patsy"]
    prev = arg("--preview")
    os.makedirs(RAW, exist_ok=True)
    for name in names:
        lib.reset()
        mat_setup()
        if name == "rabbit":
            ob, H = build_rabbit()
            bake_vertex_ao(ob, H)
            print(f"[rabbit] tris={tri_count(ob)} storlek={dims(ob)}")
            if prev:
                os.makedirs(prev, exist_ok=True)
                preview_static("rabbit", prev, (0, 0, 0.17), 1.05,
                               [("front34", 8, -32), ("side", 4, -90), ("front", 2, 0), ("back", 14, 150)])
            rig.export_glb(os.path.join(RAW, "rabbit.glb"), [ob], animations=False)
        elif name == "foot":
            ob, H = build_foot()
            bake_vertex_ao(ob, H)
            print(f"[foot] tris={tri_count(ob)} storlek={dims(ob)}")
            if prev:
                os.makedirs(prev, exist_ok=True)
                preview_static("foot", prev, (0, 0, 1.1), 11.0,
                               [("front34", 14, -40), ("side", 6, -90), ("top", 60, -20), ("back", 20, 140)])
                lib.set_cam((0.1, -1.4, 0.3), 3.2, 18, -20)
                lib.render(os.path.join(prev, "foot_toes.png"))
            rig.export_glb(os.path.join(RAW, "foot.glb"), [ob], animations=False)
        elif name == "patsy":
            build_and_export_patsy(prev)


if __name__ == "__main__":
    main()
