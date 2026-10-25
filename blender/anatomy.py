"""Skulpterad anatomi med metabollar.

Kroppen beskrivs som former (ellipsoider, kedjor av bollar, negativa former som gräver fåror).
Formerna blir en metaboll-familj per grupp (bål, arm, ben) som smälter ihop mjukt — muskler med
naturliga övergångar i stället för skyltdockans klot — konverteras till mesh, decimeras och får
mjuka vikter överförda från ett styvt "skelettlager" byggt av samma former.

Storlekar anges som verkliga radier: Blenders fält är s·(1-(d/R)²)³ med tröskeln t, så ytan
hamnar på d = R·√(1-(t/s)^(1/3)). Hög styvhet (s) = skarpare form, låg = mer sammansmältning.
"""
import bpy
import math
import numpy as np
from mathutils import Vector, Matrix, Quaternion

import lib
from lib import apply_mods
import rig

V = Vector
THRESH = 0.6


def ratio(s):
    return math.sqrt(1 - (THRESH / s) ** (1 / 3))


def mid(a, b, t=0.5):
    return a.lerp(b, t)


def look(d, up=V((0, 0, 1))):
    """Kvaternion som vrider +Z mot riktningen d."""
    return V((0, 0, 1)).rotation_difference(V(d).normalized())


class Forms:
    """Samlar formbeskrivningar för en grupp."""

    def __init__(self, H):
        self.H = H
        self.items = []

    def ell(self, c, r, bone, s=3.0, q=None, neg=False):
        self.items.append(("ell", V(c), tuple(r), bone, s, q, neg))

    def ball(self, c, r, bone, s=3.0, neg=False):
        self.ell(c, (r, r, r), bone, s, None, neg)

    def chain(self, pts, radii, bone, s=3.0, neg=False, step=0.45):
        """Rör av bollar längs en polylinje (radie per punkt)."""
        pts = [V(p) for p in pts]
        if isinstance(radii, (int, float)):
            radii = [radii] * len(pts)
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            ra, rb = radii[i], radii[i + 1]
            L = (b - a).length
            n = max(1, int(L / (min(ra, rb) * step)))
            for j in range(n + (1 if i == len(pts) - 2 else 0)):
                t = j / n
                self.ball(a.lerp(b, t), ra + (rb - ra) * t, bone, s, neg)

    def oriented(self, a, b, r_side, r_front, bone, s=3.0, offset=(0, 0, 0)):
        """Ellipsoid längs segmentet a→b (muskelbuk)."""
        a, b = V(a), V(b)
        c = mid(a, b) + V(offset)
        L = (b - a).length / 2
        self.ell(c, (r_side, r_front, L), bone, s, look(b - a))


def build_metaball(name, forms, res):
    mb = bpy.data.metaballs.new(name)
    mb.resolution = res
    mb.render_resolution = res
    mb.threshold = THRESH
    ob = bpy.data.objects.new(name, mb)
    lib.link(ob)
    for (kind, c, r, bone, s, q, neg) in forms.items:
        el = mb.elements.new(type="ELLIPSOID")
        el.co = c
        el.radius = 1.0 / ratio(s)
        el.size_x, el.size_y, el.size_z = r
        el.stiffness = s
        el.use_negative = neg
        if q is not None:
            el.rotation = q
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target="MESH")
    return bpy.context.view_layer.objects.active


def weight_source(name, forms):
    """Styvt lager av samma former (bara positiva) med ett ben per form, för viktöverföring."""
    objs = []
    for i, (kind, c, r, bone, s, q, neg) in enumerate(forms.items):
        if neg:
            continue
        o = lib.ellipsoid(f"{name}_w{i}", (0, 0, 0), r, seg=10, rings=6)
        M = Matrix.Translation(c) @ (q.to_matrix().to_4x4() if q is not None else Matrix.Identity(4))
        o.data.transform(M)
        rig.bind(o, bone)
        objs.append(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def sculpt(name, forms, target_tris, res=None, material="Stone", smooth_iter=4):
    """Formerna -> mjuk, decimerad, viktad mesh."""
    H = forms.H
    res = res or 0.0026 * H
    ob = build_metaball("mb_" + name, forms, res)
    ob.name = name
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris > target_tris:
        dm = ob.modifiers.new("Dec", "DECIMATE")
        dm.decimate_type = "COLLAPSE"
        dm.ratio = target_tris / tris
        apply_mods(ob)
    ob.data.materials.clear()
    ob.data.materials.append(lib.mat(material))
    for p in ob.data.polygons:
        p.material_index = 0
        p.use_smooth = True
    src = weight_source(name, forms)
    for vg in src.vertex_groups:
        ob.vertex_groups.new(name=vg.name)
    dt = ob.modifiers.new("Weights", "DATA_TRANSFER")
    dt.object = src
    dt.use_vert_data = True
    dt.data_types_verts = {"VGROUP_WEIGHTS"}
    dt.vert_mapping = "POLYINTERP_NEAREST"
    dt.layers_vgroup_select_src = "ALL"
    dt.layers_vgroup_select_dst = "NAME"
    apply_mods(ob)
    bpy.data.objects.remove(src)
    smooth_weights(ob, iterations=smooth_iter, factor=0.5)
    return ob


def smooth_weights(ob, iterations=4, factor=0.5):
    """Laplace-utjämning av alla viktgrupper över meshens kanter, sedan normalisering.
    (bpy.ops.object.vertex_group_smooth kräver viktmålningsläge och går inte headless.)"""
    me = ob.data
    n = len(me.vertices)
    groups = list(ob.vertex_groups)
    if len(groups) < 2 or n == 0:
        return
    W = np.zeros((n, len(groups)), dtype=np.float32)
    gi = {g.index: i for i, g in enumerate(groups)}
    for v in me.vertices:
        for g in v.groups:
            if g.group in gi:
                W[v.index, gi[g.group]] = g.weight
    e = np.zeros(len(me.edges) * 2, dtype=np.int32)
    me.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    deg = np.bincount(e.ravel(), minlength=n).astype(np.float32)
    deg[deg == 0] = 1
    for _ in range(iterations):
        acc = np.zeros_like(W)
        np.add.at(acc, e[:, 0], W[e[:, 1]])
        np.add.at(acc, e[:, 1], W[e[:, 0]])
        W = W * (1 - factor) + (acc / deg[:, None]) * factor
    W[W < 0.01] = 0
    W /= np.maximum(W.sum(1, keepdims=True), 1e-6)
    for i, g in enumerate(groups):
        g.remove(list(range(n)))
        for vi in np.nonzero(W[:, i])[0]:
            g.add([int(vi)], float(W[vi, i]), "REPLACE")


# ======================================================================= formbibliotek

def head(F, J, face=True, female=False):
    """Huvud i klassisk statystil. Dragen ligger mestadels inne i huvudets massa och buktar bara
    lite ut — så smälter de ihop som huggen sten i stället för att se påklistrade ut."""
    H = F.H
    hc = J["head0"] + V((0, -0.004 * H, 0.062 * H))
    w = 0.92 if female else 1.0
    F.ell(hc + V((0, 0.008 * H, 0.012 * H)), (0.046 * H * w, 0.053 * H, 0.057 * H), "head", 2.5)
    F.ell(hc + V((0, -0.016 * H, -0.026 * H)), (0.037 * H * w, 0.036 * H, 0.035 * H), "head", 2.5)  # ansiktsmassa
    F.ell(hc + V((0, -0.002 * H, -0.044 * H)), (0.031 * H * w, 0.029 * H, 0.015 * H), "head", 2.6)  # käkvinkel
    if not face:
        return hc
    F.ball(hc + V((0, -0.036 * H, -0.05 * H)), 0.0135 * H * w, "head", 2.8)  # haka
    F.ell(hc + V((0, -0.03 * H, 0.019 * H)), (0.036 * H * w, 0.02 * H, 0.014 * H), "head", 2.6)  # mjuk pannbåge
    for k in (1, -1):
        F.ell(hc + V((k * 0.028 * H * w, -0.03 * H, -0.004 * H)), (0.015 * H, 0.012 * H, 0.01 * H), "head", 2.7)  # kindben
        eye = hc + V((k * 0.0185 * H * w, -0.043 * H, 0.005 * H))
        F.ell(eye + V((0, -0.0075 * H, 0.001 * H)), (0.0115 * H, 0.0068 * H, 0.0078 * H), "head", 2.7, neg=True)  # grund ögongrop
        F.ell(eye, (0.0086 * H, 0.0068 * H, 0.0062 * H), "head", 3)  # ögonglob
        F.chain([eye + V((-k * 0.0092 * H, -0.0015 * H, 0.0015 * H)), eye + V((0, -0.0058 * H, 0.0052 * H)),
                 eye + V((k * 0.0092 * H, -0.001 * H, 0.0022 * H))], 0.0029 * H, "head", 3)  # övre lock
        F.chain([eye + V((-k * 0.008 * H, -0.0015 * H, -0.003 * H)), eye + V((0, -0.0052 * H, -0.0048 * H)),
                 eye + V((k * 0.008 * H, -0.001 * H, -0.0025 * H))], 0.0022 * H, "head", 3)  # undre lock
        ear = hc + V((k * 0.046 * H * w, 0.006 * H, -0.002 * H))
        F.ell(ear, (0.006 * H, 0.012 * H, 0.018 * H), "head", 3)
        F.ball(hc + V((k * 0.0072 * H, -0.0535 * H, -0.0145 * H)), 0.0054 * H, "head", 3)  # näsvinge
    F.chain([hc + V((0, -0.044 * H, 0.02 * H)), hc + V((0, -0.053 * H, -0.002 * H)), hc + V((0, -0.0565 * H, -0.0125 * H))],
            [0.0056 * H, 0.0062 * H, 0.0074 * H], "head", 2.9)  # grekisk näsa i linje med pannan
    F.ell(hc + V((0, -0.0485 * H, -0.0255 * H)), (0.0125 * H, 0.0058 * H, 0.0042 * H), "head", 3)  # överläpp
    F.ell(hc + V((0, -0.047 * H, -0.0335 * H)), (0.0105 * H, 0.006 * H, 0.0048 * H), "head", 3)  # underläpp
    F.ell(hc + V((0, -0.0515 * H, -0.0297 * H)), (0.0115 * H, 0.0035 * H, 0.0014 * H), "head", 3, neg=True)  # munlinje
    return hc


def neck(F, J):
    H = F.H
    hc = J["head0"] + V((0, -0.004 * H, 0.062 * H))
    F.chain([J["neck0"] - V((0, -0.004 * H, 0.03 * H)), J["head0"] + V((0, 0.006 * H, 0.03 * H))], [0.031 * H, 0.027 * H], "neck", 2.5)
    for k in (1, -1):
        F.chain([hc + V((k * 0.03 * H, 0.012 * H, -0.03 * H)), J["neck0"] + V((k * 0.014 * H, -0.018 * H, 0.0)),
                 J["neck0"] + V((k * 0.006 * H, -0.024 * H, -0.022 * H))], 0.0075 * H, "neck", 2.8)


def torso(F, J, bulk=1.0, female=False, deltoids=True):
    H, b = F.H, bulk
    pel, sp, ch = J["pelvis"], J["spine0"], J["chest0"]
    F.ell(pel + V((0, 0.004 * H, 0.01 * H)), (0.083 * H * b, 0.057 * H * b, 0.062 * H), "hips", 2.5)
    for k in (1, -1):
        F.ell(pel + V((k * 0.034 * H * b, 0.03 * H * b, -0.012 * H)), (0.04 * H * b, 0.034 * H * b, 0.046 * H), "hips", 2.6)
    F.ell(sp + V((0, 0.002 * H, 0.05 * H)), (0.07 * H * b, 0.05 * H * b, 0.074 * H), "spine", 2.5)
    F.ell(ch + V((0, 0.006 * H, 0.056 * H)), (0.097 * H * b, 0.063 * H * b, 0.088 * H), "chest", 2.5)
    for k in (1, -1):
        F.ell(sp + V((k * 0.052 * H * b, -0.004 * H, 0.034 * H)), (0.026 * H * b, 0.036 * H * b, 0.05 * H), "spine", 2.6)  # sneda bukmuskler
        F.ell(ch + V((k * 0.064 * H * b, 0.024 * H, 0.03 * H)), (0.032 * H * b, 0.034 * H * b, 0.072 * H), "chest", 2.6)  # latissimus
        F.ell(V((k * 0.05 * H * b, 0.014 * H, 0.796 * H)), (0.05 * H * b, 0.03 * H, 0.026 * H), "chest", 2.6)  # trapezius
        F.chain([V((k * 0.012 * H, -0.028 * H * b, 0.804 * H)), V((k * 0.068 * H * b, -0.018 * H * b, 0.81 * H))], 0.0065 * H, "chest", 2.8)  # nyckelben
        if female:
            F.ell(ch + V((k * 0.035 * H, -0.04 * H, 0.058 * H)), (0.034 * H, 0.028 * H, 0.031 * H), "chest", 2.6)
        else:
            F.ell(ch + V((k * 0.042 * H * b, -0.04 * H * b, 0.072 * H)), (0.052 * H * b, 0.022 * H * b, 0.036 * H), "chest", 2.6,
                  q=Quaternion(V((0, 1, 0)), k * 0.22))  # bröstmuskel
        if deltoids:
            sh, el = J["shoulder." + ("L" if k > 0 else "R")], J["elbow." + ("L" if k > 0 else "R")]
            F.oriented(sh + V((k * 0.002 * H, 0, 0.012 * H)), mid(sh, el, 0.45), 0.034 * H * b, 0.039 * H * b,
                       "upperarm." + ("L" if k > 0 else "R"), 2.6)  # deltoid: i bålen så att axeln smälter in
    if not female:
        # magmusklernas fåror: linea alba och tre tvärgående linjer
        F.chain([sp + V((0, -0.05 * H * b, 0.0)), ch + V((0, -0.058 * H * b, 0.03 * H))], 0.004 * H, "spine", 3, neg=True)
        for row in range(3):
            z = sp.z + (0.022 + 0.032 * row) * H
            F.ell(V((0, -0.05 * H * b, z)), (0.026 * H, 0.0045 * H, 0.0026 * H), "spine", 3, neg=True)
        F.chain([ch + V((0, -0.062 * H * b, 0.04 * H)), ch + V((0, -0.06 * H * b, 0.1 * H))], 0.0045 * H, "chest", 3, neg=True)  # bröstbensfåra


def arm(F, J, s, bulk=1.0, hand="fist"):
    H, b = F.H, bulk
    k = 1 if s == "L" else -1
    sh, el, wr, he = J[f"shoulder.{s}"], J[f"elbow.{s}"], J[f"wrist.{s}"], J[f"handEnd.{s}"]
    ua, fa, hb = f"upperarm.{s}", f"forearm.{s}", f"hand.{s}"
    F.chain([sh - V((0, 0, 0.02 * H)), el], [0.031 * H * b, 0.025 * H * b], ua, 2.5)
    F.oriented(mid(sh, el, 0.3), mid(sh, el, 0.88), 0.025 * H * b, 0.024 * H * b, ua, 2.6, offset=(0, -0.01 * H, 0))  # biceps
    F.oriented(mid(sh, el, 0.15), mid(sh, el, 0.78), 0.026 * H * b, 0.024 * H * b, ua, 2.6, offset=(0, 0.01 * H, 0))  # triceps
    F.ball(el + V((0, 0.01 * H, 0)), 0.016 * H, fa, 2.8)
    F.chain([el, wr], [0.025 * H * b, 0.018 * H * b], fa, 2.5)
    F.oriented(el, mid(el, wr, 0.55), 0.024 * H * b, 0.024 * H * b, fa, 2.6, offset=(k * 0.007 * H, -0.004 * H, 0))  # armbågsböjare
    F.oriented(mid(el, wr, 0.05), mid(el, wr, 0.6), 0.019 * H * b, 0.019 * H * b, fa, 2.6, offset=(-k * 0.006 * H, 0.003 * H, 0))  # flexorer
    F.ell(wr, (0.019 * H, 0.015 * H, 0.013 * H), fa, 2.8)
    g = mid(wr, he) - V((0, 0, 0.004 * H))
    if hand == "fist":
        F.ell(g + V((k * 0.004 * H, 0.002 * H, 0.004 * H)), (0.02 * H, 0.026 * H, 0.032 * H), hb, 2.6)
        for i in range(4):
            z = g.z + (0.02 - 0.0125 * i) * H
            F.chain([V((g.x + k * 0.012 * H, g.y + 0.012 * H, z)), V((g.x + k * 0.018 * H, g.y - 0.006 * H, z)),
                     V((g.x + k * 0.005 * H, g.y - 0.021 * H, z)), V((g.x - k * 0.01 * H, g.y - 0.014 * H, z))],
                    0.0074 * H, hb, 3)
        F.chain([V((g.x - k * 0.007 * H, g.y + 0.004 * H, g.z + 0.028 * H)), V((g.x - k * 0.013 * H, g.y - 0.013 * H, g.z + 0.022 * H)),
                 V((g.x - k * 0.004 * H, g.y - 0.022 * H, g.z + 0.014 * H)), V((g.x + k * 0.007 * H, g.y - 0.023 * H, g.z + 0.014 * H))],
                [0.0092 * H, 0.0084 * H, 0.0076 * H, 0.007 * H], hb, 3)
    else:
        F.ell(g + V((0, 0, 0.006 * H)), (0.012 * H, 0.023 * H, 0.027 * H), hb, 3.5)
        for i in range(4):
            y = g.y + (-0.016 + 0.0105 * i) * H
            base = V((g.x, y, g.z - 0.018 * H))
            F.chain([base, base + V((k * 0.002 * H, -0.002 * H, -(0.036 - 0.005 * abs(i - 1.5)) * H))], [0.0058 * H, 0.0046 * H], hb, 5)
        F.chain([g + V((0, -0.021 * H, 0.004 * H)), g + V((-k * 0.004 * H, -0.037 * H, -0.012 * H))], [0.007 * H, 0.0058 * H], hb, 5)


def leg(F, J, s, bulk=1.0, foot="bare"):
    H, b = F.H, bulk
    k = 1 if s == "L" else -1
    hp, kn, an, to = J[f"hip.{s}"], J[f"knee.{s}"], J[f"ankle.{s}"], J[f"toe.{s}"]
    th, sh, ft = f"thigh.{s}", f"shin.{s}", f"foot.{s}"
    F.chain([hp, kn], [0.05 * H * b, 0.031 * H * b], th, 2.5)
    F.oriented(mid(hp, kn, 0.1), mid(hp, kn, 0.85), 0.044 * H * b, 0.033 * H * b, th, 2.6, offset=(0, -0.012 * H, 0))  # lårets framsida
    F.ell(mid(hp, kn, 0.82) + V((-k * 0.016 * H, -0.012 * H, 0)), (0.021 * H, 0.019 * H, 0.03 * H), th, 2.7)  # vastus medialis
    F.oriented(mid(hp, kn, 0.05), mid(hp, kn, 0.6), 0.03 * H * b, 0.028 * H * b, th, 2.6, offset=(-k * 0.016 * H, 0, 0))  # adduktorer
    F.oriented(mid(hp, kn, 0.1), mid(hp, kn, 0.85), 0.034 * H * b, 0.026 * H * b, th, 2.6, offset=(0, 0.012 * H, 0))  # baksida
    F.ell(kn + V((0, -0.024 * H, 0.004 * H)), (0.015 * H, 0.011 * H, 0.017 * H), sh, 3)  # knäskål
    F.chain([kn, an], [0.03 * H * b, 0.02 * H * b], sh, 2.5)
    for kk in (1, -1):
        F.oriented(mid(kn, an, 0.05), mid(kn, an, 0.55), 0.021 * H * b, 0.023 * H * b, sh, 2.6, offset=(kk * 0.008 * H, 0.013 * H, 0))  # vad
        F.ball(an + V((kk * 0.016 * H, 0.004 * H, 0.004 * H)), 0.0085 * H, sh, 3)  # fotknölar
    if foot == "bare":
        F.ball(V((an.x, an.y + 0.012 * H, 0.022 * H)), 0.02 * H, ft, 2.6)
        F.ell(V((an.x, (an.y + to.y) / 2, 0.02 * H)), (0.023 * H, 0.048 * H, 0.017 * H), ft, 2.6)
        F.ell(V((an.x + k * 0.004 * H, to.y + 0.02 * H, 0.014 * H)), (0.027 * H, 0.016 * H, 0.013 * H), ft, 2.6)
        for i in range(5):
            x = an.x + k * (0.017 - 0.0085 * i) * H
            r = 0.0082 * H if i == 0 else 0.0058 * H
            F.ell(V((x, to.y + (0.004 + 0.004 * i) * H, 0.008 * H)), (r, r * 1.35, r), ft, 3)


def body(J, H, parts=None, *, bulk=1.0, female=False, face=True, arms=True, legs=True, hands=("fist", "fist"),
         feet="bare", head_on=True, budgets=(12000, 2800, 2800)):
    """Bygger skulpterade kroppsgrupper och returnerar meshobjekt med viktgrupper."""
    out = []
    T = Forms(H)
    torso(T, J, bulk, female)
    neck(T, J)
    if head_on:
        head(T, J, face=face, female=female)
    out.append(sculpt("body_torso", T, budgets[0], res=0.0017 * H))
    if arms:
        for s, hnd in zip(("L", "R"), hands):
            A = Forms(H)
            arm(A, J, s, bulk, hnd)
            out.append(sculpt(f"body_arm{s}", A, budgets[1]))
    if legs:
        for s in ("L", "R"):
            L = Forms(H)
            leg(L, J, s, bulk, feet)
            out.append(sculpt(f"body_leg{s}", L, budgets[2]))
    return out
