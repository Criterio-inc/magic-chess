"""Bygger de sex pjästyperna som levande marmorstatyer, riggar och animerar dem.

Körs: blender -b -P blender/pieces.py -- [--only pawn,knight] [--preview DIR] [--no-export]
Ut: public/models/<typ>.glb + public/models/pieces.json (träfftider, längder, gånghastighet).

Material (byts i spelet efter namn): Stone = lagets marmor, Trim = förgyllning,
Cloth = lagets tyg, Steel = blankt stål, Wood, Gem = lysande sten, Dark = skuggor/ögon.
Vapen modelleras pekande rakt upp ur handen och riktas med prop-benet (rig.aim).
"""
import bpy
import sys
import os
import math
import json
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(__file__))
import lib
from lib import (lathe, ellipsoid, box, torus, tube, limb, prism, blade, add_bevel, add_subsurf, add_solidify,
                 add_rock, smooth, transform, join, orient)
import rig
import anatomy
from rig import merge, add, aim

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "models")
RAW = os.path.join(ROOT, "build", "models")
FPS = rig.FPS

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else True
    return default


V = Vector


def mid(a, b, t=0.5):
    return a.lerp(b, t)


# ======================================================================= byggstenar

def sleeve(name, a, b, prof, material="Stone", seg=24, fold=None, sx=1.0, sy=1.0):
    """Rotationskropp längs segmentet a->b. prof = [(radie, t)] med t 0..1 längs segmentet."""
    a, b = V(a), V(b)
    L = (b - a).length
    p = [(r, t * L) for (r, t) in prof]
    f = None
    if fold:
        f = (fold[0], fold[1], fold[2] * L, fold[3] * L)
    ob = lathe(name, p, seg=seg, material=material, fold=f, sx=sx, sy=sy, cap_bottom=prof[0][0] > 0,
               cap_top=prof[-1][0] > 0)
    orient(ob, a, b)
    return ob


def fold_robe(name, z_top, z_bot, r_top, r_bot, H, folds=11, amp=0.07, material="Stone", sy=0.85, center=(0, 0, 0),
              seg=72, flare=1.3):
    prof = []
    n = 12
    for i in range(n + 1):
        t = i / n
        prof.append((r_top + (r_bot - r_top) * (t ** flare), z_top - (z_top - z_bot) * t))
    prof = list(reversed(prof))  # nerifrån och upp
    prof = [(prof[0][0] * 0.93, prof[0][1] + 0.014 * H)] + prof
    return lathe(name, prof, seg=seg, material=material, sy=sy, cap_bottom=False, cap_top=False, center=center,
                 fold=(folds, amp, z_top, z_bot))


def cape(name, J, H, z_top, z_bot, r_top, r_bot, spread=1.55, folds=9, amp=0.09, material="Cloth", yoff=0.012):
    """Mantel bakom ryggen (öppen båge kring +Y), med tjocklek."""
    prof = []
    n = 12
    for i in range(n + 1):
        t = i / n
        prof.append((r_top + (r_bot - r_top) * (t ** 0.8), z_top - (z_top - z_bot) * t))
    prof = list(reversed(prof))
    c = math.pi / 2
    ob = lathe(name, prof, seg=40, material=material, sy=0.75, cap_bottom=False, cap_top=False,
               center=(0, yoff * H, 0), fold=(folds, amp, z_top, z_bot), arc=(c - spread, c + spread))
    add_solidify(ob, 0.008 * H, offset=-1)
    return ob


def pteruges(name, J, H, z_top, length, r, n=14, mats=("Cloth", "Stone"), width=None, flare=0.25, sy=0.8):
    """Krans av hängande remsor kring höften (romersk rustning)."""
    out = []
    w = width or (2 * math.pi * r / n) * 0.82
    for i in range(n):
        a = 2 * math.pi * (i + 0.5) / n
        outline = [(-w / 2, 0), (w / 2, 0), (w / 2 * 0.92, -length), (0, -length - 0.012 * H), (-w / 2 * 0.92, -length)]
        p = prism(f"{name}{i}", outline, 0.008 * H, material=mats[i % len(mats)], axis="Y", bevel=0.0025)
        # luta ut, vrid runt, flytta ut
        transform(p, rot=(-math.degrees(flare) * 0.6, 0, 0))
        transform(p, loc=(0, -r, 0))
        transform(p, rot=(0, 0, math.degrees(a) - 90 + 180))
        p.data.transform(Matrix.Diagonal((1, sy, 1, 1)))
        transform(p, loc=(0, 0, z_top))
        out.append(p)
    return out


def cop(name, center, facing, H, size=1.0, material="Trim", wing=True, k=1):
    """Ledskydd (knä/armbåge): skålad plåt med vulst + solfjäderformad sidovinge, i stället för ett klot.
    facing = riktningen skålen vetter mot (t.ex. (0,-1,0) för knät framåt)."""
    r = 0.03 * H * size
    out = []
    cup = lathe(name, [(0.0, r * 0.62), (r * 0.5, r * 0.56), (r * 0.82, r * 0.38), (r, r * 0.1), (r * 1.02, 0.0),
                       (r * 0.96, -r * 0.04), (r * 0.8, r * 0.26), (r * 0.45, r * 0.44), (0.0, r * 0.5)], seg=28, material=material)
    rim = torus(name + "rim", (0, 0, r * 0.06), r * 0.98, r * 0.09, material=material, seg=28, rseg=8)
    parts_ = [cup, rim]
    if wing:
        fan = []
        n = 7
        for i in range(n + 1):
            a = -1.0 + 2.0 * i / n
            fan.append((math.sin(a) * r * 1.25, math.cos(a) * r * 0.95))
        fan = [(0, 0)] + fan
        w = prism(name + "wing", fan, r * 0.12, material=material, axis="Y", bevel=r * 0.03)
        transform(w, rot=(0, 90, 0))           # vingen står i ett plan längs leden
        transform(w, loc=(k * r * 0.62, 0, 0))
        parts_.append(w)
    q = Vector((0, 0, 1)).rotation_difference(Vector(facing).normalized())
    for o in parts_:
        add_subsurf(o, 1)
        o.data.transform(Matrix.Translation(Vector(center)) @ q.to_matrix().to_4x4())
        out.append(o)
    return out


def sabatons(J, H, parts, material="Trim"):
    """Ledade fotplåtar: bågar över vristen som blir mindre mot tårna, och en tåhätta."""
    for s in ("L", "R"):
        a, t = J[f"ankle.{s}"], J[f"toe.{s}"]
        for i in range(4):
            y = a.y - 0.01 * H - i * 0.024 * H
            r = (0.034 - 0.0035 * i) * H
            lame = lathe(f"sab.{s}{i}", [(r, -0.014 * H), (r * 1.02, 0.0), (r, 0.014 * H)], seg=20, material=material,
                         arc=(0.15, math.pi - 0.15), cap_bottom=False, cap_top=False)
            add_solidify(lame, 0.004 * H)
            transform(lame, rot=(90, 0, 0))
            transform(lame, loc=(a.x, y, 0.012 * H), scale=(1.0, 1.0, 0.82))
            parts.append((lame, f"foot.{s}"))
        parts.append((ellipsoid(f"toecap.{s}", Vector((a.x, t.y + 0.012 * H, 0.022 * H)), (0.026 * H, 0.03 * H, 0.02 * H),
                                material=material), f"foot.{s}"))


def gauntlets(J, H, parts, material="Trim"):
    for s, k in (("L", 1), ("R", -1)):
        w, he = J[f"wrist.{s}"], J[f"handEnd.{s}"]
        cuff = sleeve(f"gcuff.{s}", w - Vector((0, 0, 0.008 * H)), w + Vector((0, 0, 0.055 * H)),
                      [(0.024 * H, 0), (0.03 * H, 0.45), (0.038 * H, 1.0), (0.036 * H, 1.0)], material=material, seg=20)
        add_solidify(cuff, 0.003 * H)
        parts.append((cuff, f"forearm.{s}"))
        g = mid(w, he)
        plate = ellipsoid(f"gplate.{s}", g + Vector((k * 0.014 * H, -0.002 * H, 0.002 * H)), (0.01 * H, 0.025 * H, 0.03 * H), material=material)
        parts.append((plate, f"hand.{s}"))
        for i in range(3):  # knogskenor
            z = g.z + (0.016 - 0.013 * i) * H
            parts.append((tube(f"gknuck.{s}{i}", [Vector((g.x + k * 0.016 * H, g.y + 0.01 * H, z)), Vector((g.x + k * 0.021 * H, g.y - 0.008 * H, z)),
                                                  Vector((g.x + k * 0.008 * H, g.y - 0.022 * H, z))], 0.0045 * H, material=material, seg=8), f"hand.{s}"))


def greaves(J, H, parts, material="Trim", knee="Trim"):
    for s, kk in (("L", 1), ("R", -1)):
        k, a = J[f"knee.{s}"], J[f"ankle.{s}"]
        g = sleeve(f"greave.{s}", a + V((0, 0, 0.02 * H)), k - V((0, 0, 0.01 * H)),
                   [(0.034 * H, 0), (0.037 * H, 0.15), (0.046 * H, 0.55), (0.043 * H, 0.88), (0.04 * H, 1.0)],
                   material=material, seg=24, sy=1.0)
        add_subsurf(g, 1)
        parts.append((g, f"shin.{s}"))
        parts.append((tube(f"greaveridge.{s}", [a + V((0, -0.036 * H, 0.03 * H)), mid(a, k, 0.55) + V((0, -0.047 * H, 0)),
                                                k + V((0, -0.04 * H, -0.02 * H))], 0.0045 * H, material="Trim", seg=8), f"shin.{s}"))
        for o in cop(f"poleyn.{s}", k + V((0, -0.03 * H, 0.004 * H)), (0, -1, 0.15), H, 1.05, knee, k=kk):
            parts.append((o, f"shin.{s}"))


def vambraces(J, H, parts, material="Trim", sides=("L", "R")):
    for s in sides:
        e, w = J[f"elbow.{s}"], J[f"wrist.{s}"]
        v = sleeve(f"vamb.{s}", mid(e, w, 0.3), w - V((0, 0, -0.012 * H)),
                   [(0.033 * H, 0), (0.035 * H, 0.2), (0.031 * H, 0.85), (0.033 * H, 1.0)], material=material, seg=20)
        add_subsurf(v, 1)
        parts.append((v, f"forearm.{s}"))
        parts.append((torus(f"cuff.{s}", (0, 0, 0), 0.03 * H, 0.006 * H, material="Trim", seg=20), f"forearm.{s}"))
        orient(parts[-1][0], w + V((0, 0, 0.018 * H)), w + V((0, 0, 0.06 * H)))


def sandals(J, H, parts):
    for s in ("L", "R"):
        a = J[f"ankle.{s}"]
        for dz in (0.012, 0.035):
            t = torus(f"strap.{s}{dz}", (a.x, a.y, a.z + dz * H), 0.03 * H, 0.0045 * H, material="Trim", seg=20)
            parts.append((t, f"shin.{s}"))


def pauldron(name, J, H, s, layers=3, size=1.0, material="Trim", bone=None):
    """Lagrade axelskydd."""
    k = 1 if s == "L" else -1
    sh = J[f"shoulder.{s}"]
    out = []
    for i in range(layers):
        r = (0.062 - 0.008 * i) * H * size
        zc = sh.z - 0.004 * H - i * 0.024 * H * size
        pa = lathe(f"{name}{i}", [(0.0, r * 0.95), (r * 0.55, r * 0.85), (r * 0.9, r * 0.45), (r, 0.0), (r * 0.98, -r * 0.18),
                                   (r * 0.9, -r * 0.05), (r * 0.6, r * 0.5), (0.0, r * 0.7)],
                   seg=28, material=material, center=(sh.x + k * (0.012 + 0.01 * i) * H, sh.y, zc), sy=1.05)
        transform(pa, rot=(0, k * (25 + 12 * i), 0), pivot=(sh.x, sh.y, zc))
        add_subsurf(pa, 1)
        out.append((pa, bone or f"upperarm.{s}"))
    return out


def torso_shell(name, J, H, width=1.0, depth=0.74, keel=0.018, material="Stone", fold=None, z_bottom=None, flare=0.0):
    """Formad överkropp (harnesk, livstycke, tunika) i stället för en ballong.
    Smal midja, bred bröstkorg, rundad mot halsen och en köl (mittrygg) framtill."""
    zb = z_bottom if z_bottom is not None else J["spine0"].z - 0.01 * H
    zc = J["chest0"].z
    zn = J["neck0"].z
    prof = [(0.083 * H * width * (1 + flare), zb), (0.084 * H * width, J["spine0"].z + 0.02 * H), (0.094 * H * width, zc - 0.005 * H),
            (0.106 * H * width, zc + 0.04 * H), (0.1 * H * width, zc + 0.075 * H), (0.084 * H * width, zc + 0.1 * H),
            (0.064 * H * width, zn - 0.012 * H), (0.047 * H * width, zn - 0.002 * H), (0.04 * H * width, zn + 0.004 * H)]
    ob = lathe(name, prof, seg=40, material=material, sy=depth, cap_bottom=False, cap_top=False, fold=fold, center=(0, 0.004 * H, 0))
    if keel:
        for v in ob.data.vertices:
            if v.co.y < 0:
                r = math.hypot(v.co.x, v.co.y) or 1.0
                frontness = max(0.0, -v.co.y / r) ** 8
                zt = min(1.0, max(0.0, (v.co.z - zb) / (zn - zb)))
                v.co.y -= keel * H / 0.018 * 0.018 * frontness * math.sin(zt * math.pi) * 0.9
    add_solidify(ob, 0.006 * H, offset=1)
    add_subsurf(ob, 1)
    return ob


def face_head(J, H):
    return J["head0"] + V((0, -0.004 * H, 0.062 * H))


# ======================================================================= kropp

def body(J, H, parts, bulk=1.0, legs=True, arms=True, head=True, face=True, feet=True, torso=True):
    """Grundkropp av marmor. parts fylls med (objekt, ben)."""
    b = bulk
    P = parts.append
    if torso:
        P((ellipsoid("pelvis", J["pelvis"] + V((0, 0, 0.01 * H)), (0.085 * H * b, 0.06 * H * b, 0.06 * H)), "hips"))
        P((ellipsoid("abdomen", J["spine0"] + V((0, 0, 0.05 * H)), (0.077 * H * b, 0.056 * H * b, 0.07 * H)), "spine"))
        P((ellipsoid("chest", J["chest0"] + V((0, 0.004 * H, 0.055 * H)), (0.105 * H * b, 0.068 * H * b, 0.088 * H)), "chest"))
    P((limb("neck", J["neck0"] - V((0, 0, 0.02 * H)), J["head0"] + V((0, 0, 0.02 * H)), 0.03 * H, 0.028 * H), "neck"))
    if head:
        hc = face_head(J, H)
        P((ellipsoid("head", hc, (0.05 * H, 0.058 * H, 0.068 * H)), "head"))
        if face:
            P((limb("nose", hc + V((0, -0.056 * H, 0.014 * H)), hc + V((0, -0.065 * H, -0.012 * H)), 0.006 * H, 0.009 * H), "head"))
            brow = tube("brow", [hc + V((-0.036 * H, -0.046 * H, 0.017 * H)), hc + V((0, -0.057 * H, 0.021 * H)),
                                 hc + V((0.036 * H, -0.046 * H, 0.017 * H))], 0.0065 * H, material="Stone", seg=8)
            P((brow, "head"))
            P((ellipsoid("chin", hc + V((0, -0.043 * H, -0.05 * H)), (0.022 * H, 0.016 * H, 0.016 * H)), "head"))
            P((ellipsoid("lips", hc + V((0, -0.054 * H, -0.03 * H)), (0.013 * H, 0.006 * H, 0.004 * H)), "head"))
            for k in (1, -1):
                P((ellipsoid("cheek", hc + V((k * 0.026 * H, -0.04 * H, -0.012 * H)), (0.018 * H, 0.014 * H, 0.016 * H)), "head"))
                P((ellipsoid("ear", hc + V((k * 0.05 * H, 0.004 * H, 0.0)), (0.008 * H, 0.014 * H, 0.02 * H)), "head"))
                P((ellipsoid("eye", hc + V((k * 0.019 * H, -0.049 * H, 0.004 * H)), (0.0095 * H, 0.004 * H, 0.0058 * H),
                             material="Dark", seg=12, rings=8), "head"))
    if arms:
        for s in ("L", "R"):
            P((limb(f"uarm.{s}", J[f"shoulder.{s}"], J[f"elbow.{s}"], 0.038 * H * b, 0.03 * H * b), f"upperarm.{s}"))
            P((ellipsoid(f"delt.{s}", J[f"shoulder.{s}"] + V((0, 0, -0.01 * H)), (0.046 * H * b, 0.046 * H * b, 0.05 * H)), f"upperarm.{s}"))
            P((limb(f"farm.{s}", J[f"elbow.{s}"], J[f"wrist.{s}"], 0.031 * H * b, 0.024 * H * b), f"forearm.{s}"))
            P((ellipsoid(f"fist.{s}", mid(J[f"wrist.{s}"], J[f"handEnd.{s}"]) - V((0, 0, 0.004 * H)),
                         (0.024 * H * b, 0.029 * H * b, 0.036 * H)), f"hand.{s}"))
            P((limb(f"thumb.{s}", mid(J[f"wrist.{s}"], J[f"handEnd.{s}"]) + V((0, -0.022 * H, 0.012 * H)),
                    mid(J[f"wrist.{s}"], J[f"handEnd.{s}"]) + V((0, -0.026 * H, -0.012 * H)), 0.009 * H, 0.008 * H), f"hand.{s}"))
    if legs:
        for s in ("L", "R"):
            P((limb(f"thigh.{s}", J[f"hip.{s}"], J[f"knee.{s}"], 0.05 * H * b, 0.037 * H * b), f"thigh.{s}"))
            P((limb(f"shin.{s}", J[f"knee.{s}"], J[f"ankle.{s}"], 0.037 * H * b, 0.027 * H * b), f"shin.{s}"))
    if feet:
        for s in ("L", "R"):
            a, t = J[f"ankle.{s}"], J[f"toe.{s}"]
            f = box(f"boot.{s}", V((a.x, (a.y + t.y) / 2 - 0.006 * H, 0.03 * H)), (0.056 * H * b, 0.13 * H, 0.06 * H))
            add_subsurf(f, 2)
            P((f, f"foot.{s}"))


def statue(J, H, parts, **kw):
    """Skulpterad, mjukt viktad kropp (anatomy.py). Delarna läggs till som förviktade (ben=None)."""
    for o in anatomy.body(J, H, **kw):
        parts.append((o, None))


def finish(name, J, H, parts):
    arm = rig.build_armature(name, J)
    objs = []
    for (o, bone) in parts:
        if bone is not None:
            rig.bind(o, bone)
        objs.append(o)
    mesh = join(objs, name)
    smooth(mesh, 50)
    bake_vertex_ao(mesh, H)
    rig.skin(mesh, arm)
    return arm, mesh


def bake_vertex_ao(mesh, H):
    """Ambient occlusion (Cycles) + krökning i vertexfärgen: R = AO, G = krökning (0,5 = plan, högre = konvex kant).
    Spelets material läser dem för smuts i skrevor och slitna, ljusa kanter."""
    import numpy as np
    sc = bpy.context.scene
    prev = sc.render.engine
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 48
    sc.cycles.device = "CPU"
    if sc.world is None:
        sc.world = bpy.data.worlds.new("bakeworld")
    sc.world.light_settings.distance = 0.12 * H
    me = mesh.data
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    col = me.color_attributes.new("Col", "BYTE_COLOR", "POINT")
    me.color_attributes.active_color = col
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
    n = len(me.vertices)
    rgba = np.zeros(n * 4, dtype=np.float32)
    col.data.foreach_get("color", rgba)
    ao = rgba.reshape(-1, 4)[:, 0].copy()
    # krökning: hur långt grannarnas medelpunkt ligger bakom/framför vertexen längs normalen
    co = np.zeros(n * 3, dtype=np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    nr = np.zeros(n * 3, dtype=np.float32); me.vertices.foreach_get("normal", nr); nr = nr.reshape(-1, 3)
    e = np.zeros(len(me.edges) * 2, dtype=np.int32); me.edges.foreach_get("vertices", e); e = e.reshape(-1, 2)
    acc = np.zeros_like(co); deg = np.bincount(e.ravel(), minlength=n).astype(np.float32)[:, None]
    np.add.at(acc, e[:, 0], co[e[:, 1]]); np.add.at(acc, e[:, 1], co[e[:, 0]])
    lap = acc / np.maximum(deg, 1) - co
    elen = np.linalg.norm(co[e[:, 0]] - co[e[:, 1]], axis=1)
    avg = np.zeros(n, dtype=np.float32); np.add.at(avg, e[:, 0], elen); np.add.at(avg, e[:, 1], elen)
    avg = avg / np.maximum(deg[:, 0], 1)
    curv = -(lap * nr).sum(1) / np.maximum(avg, 1e-5)  # konvex > 0
    # lätt utjämning så att kanten blir ett band och inte brus
    for _ in range(2):
        a2 = np.zeros(n, dtype=np.float32); np.add.at(a2, e[:, 0], curv[e[:, 1]]); np.add.at(a2, e[:, 1], curv[e[:, 0]])
        curv = 0.5 * curv + 0.5 * a2 / np.maximum(deg[:, 0], 1)
    g = np.clip(0.5 + curv * 1.6, 0, 1)
    out = np.stack([ao, g, np.zeros(n), np.ones(n)], 1).astype(np.float32).ravel()
    col.data.foreach_set("color", out)
    sc.render.engine = prev
    print(f"  AO medel {ao.mean():.2f}, kant {g.mean():.2f}")


# ======================================================================= gemensamma animationer

def breathe(stance, amt=1.0):
    a = add(stance, {"chest": (-1.4 * amt, 0, 0), "spine": (-0.6 * amt, 0, 0), "head": (1.2 * amt, 0, 0),
                     "upperarm.L": (0, 0, -1.5 * amt), "upperarm.R": (0, 0, 1.5 * amt)})
    l = stance.get("loc", (0, 0, 0))
    a["loc"] = (l[0], l[1], l[2] + 0.005 * amt)
    return a


def idle_keys(stance, n=90, amt=1.0):
    mid_ = breathe(stance, amt)
    look = add(stance, {"head": (0, 6, 0), "neck": (0, 3, 0)})
    return [(0, stance), (n // 3, mid_), (n // 2, look), (5 * n // 6, breathe(look, amt * 0.6)), (n, stance)]


def walk_keys(stance, n=30, swing=24, arm_swing=16, bob=0.025, knee=40, lock_arms=(), robe=False, sway=0.0):
    """Gångcykel med två steg; 8 nycklar så att kurvorna blir runda."""
    s = 0.55 if robe else 1.0
    base_loc = stance.get("loc", (0, 0, 0))
    keys = []
    steps = 8
    for i in range(steps + 1):
        ph = i / steps
        f = round(ph * n)
        a = math.sin(ph * math.tau)  # +1: vänster ben bakåt
        kl = max(0.0, math.sin(ph * math.tau - 0.9))   # knäböj under svingfasen
        kr = max(0.0, math.sin(ph * math.tau - 0.9 + math.pi))
        p = add(stance, {
            "thigh.L": (swing * s * a, 0, 0), "thigh.R": (-swing * s * a, 0, 0),
            "shin.L": (knee * s * kl, 0, 0), "shin.R": (knee * s * kr, 0, 0),
            "foot.L": (-10 * s * a + 6 * kl, 0, 0), "foot.R": (10 * s * a + 6 * kr, 0, 0),
            "spine": (2, 4 * a, -sway * a), "chest": (1, 5 * a, sway * 0.5 * a), "hips": (0, -6 * a, sway * a),
            "head": (0, -4 * a, 0),
        })
        if "upperarm.L" not in lock_arms:
            p = add(p, {"upperarm.L": (-arm_swing * a, 0, 0), "forearm.L": (-8 - 7 * a, 0, 0)})
        if "upperarm.R" not in lock_arms:
            p = add(p, {"upperarm.R": (arm_swing * a, 0, 0), "forearm.R": (-8 + 7 * a, 0, 0)})
        # lägst vid fotisättning (fas 0 och 0,5), högst när benen passerar varandra
        p["loc"] = (base_loc[0] + sway * 0.004 * a, base_loc[1], base_loc[2] + bob * (abs(math.sin(ph * math.tau)) - 0.6) * -1 + bob * 0.0)
        p["loc"] = (p["loc"][0], p["loc"][1], base_loc[2] - bob * abs(math.sin(ph * math.tau)) + bob * 0.5)
        keys.append((f, p))
    return keys


# ---------------------------------------------------------------- dumma gången (Ministry of Silly Walks)

def leg_lengths(J, s="L"):
    """(lår, smalben) i meter + benens vilovinklar framåt i radianer (skelettets knä är lite böjt i vila),
    för silly_keys fot-IK."""
    hp, kn, an = J[f"hip.{s}"], J[f"knee.{s}"], J[f"ankle.{s}"]
    return ((hp - kn).length, (kn - an).length,
            math.atan2(-(kn.y - hp.y), hp.z - kn.z), math.atan2(-(an.y - kn.y), kn.z - an.z))


def _leg_ik(l1, l2, fwd, down, rest=(0.0, 0.0)):
    """Plan tvåleds-IK i sagittalplanet: (lår, smalben) i grader för en fotled fwd framför och down under
    höften, med knät framåt. rest = benens vilovinklar framåt. Når benet inte fram blir det rakt."""
    D = max(1e-4, min(math.hypot(fwd, down), (l1 + l2) * 0.9995))
    beta = math.atan2(fwd, down)
    g = math.acos(max(-1.0, min(1.0, (l1 * l1 + D * D - l2 * l2) / (2 * l1 * D))))
    k = math.acos(max(-1.0, min(1.0, (l1 * l1 + l2 * l2 - D * D) / (2 * l1 * l2))))
    T = beta + g                      # lårets riktning framåt
    S = T - (math.pi - k)             # smalbenets riktning framåt
    t1 = rest[0] - T                  # -X = framåt; benet pekar redan rest[0] framåt i vila
    return math.degrees(t1), math.degrees(rest[1] - S - t1)


def _loop_spline(pts, x):
    """Periodisk kubisk Hermite-kurva (Catmull-Rom-tangenter) genom [(x, värde), ...], x stigande i [0, 1)."""
    n = len(pts)
    x %= 1.0

    def X(i):
        return pts[i % n][0] + (i // n)

    def Y(i):
        return pts[i % n][1]

    i = -1
    for k in range(n):
        if pts[k][0] <= x:
            i = k
    m = lambda j: (Y(j + 1) - Y(j - 1)) / (X(j + 1) - X(j - 1))
    h = X(i + 1) - X(i)
    t = (x - X(i)) / h
    t2, t3 = t * t, t * t * t
    return ((2 * t3 - 3 * t2 + 1) * Y(i) + (t3 - 2 * t2 + t) * h * m(i)
            + (-2 * t3 + 3 * t2) * Y(i + 1) + (t3 - t2) * h * m(i + 1))


# Tider i benets egen cykel (andel av hel cykel; n=36 ger hela bildrutor): tån lämnar marken vid 0,
# knät upp, sparken i topp (häng en stund), benet faller rakt, hälen i marken; därefter stödfas.
SW_KNEE, SW_KICK, SW_HOLD, SW_DESC, SW_STRIKE = 3 / 36, 7 / 36, 9 / 36, 12 / 36, 15 / 36


def silly_keys(stance, n=36, legs=(0.37, 0.36), stride=0.5, dip=0.31, kick=95, lean=1.0, arm_swing=34, staff=(), foot=0.14):
    """John Cleeses gång: ena benet sparkas rakt och högt framåt (lår ≈ -kick, smalben ≈ 0) medan bålen lutar
    bakåt och stödbenet sjunker ned i ett djupt knäböj; armarna pendlar stela och kroppen guppar kraftigt.
    En cykel = vänster spark + höger spark. legs = leg_lengths(J): (lår, smalben) i meter + vilovinklar; stride = steglängd och dip = djupet
    i knäböjet, båda som andel av benlängden. Stödfoten står still i marken (IK) när pjäsen flyttas med
    silly_speed(...). Första och sista nyckeln är identiska.
    staff = sidor vars hand bär en stav som når marken (spjut, kräkla): den armen pendlar inte utan lyfts
    framåt i varje knäböj och staven hålls lodrät, annars borrar dess nedre ände ned i marken.
    foot = fotled -> trampdyna som andel av benlängden (tårullningen lyfter fotleden så mycket)."""
    l1, l2 = legs[:2]
    rest = tuple(legs[2:4]) if len(legs) >= 4 else (0.0, 0.0)
    Lg = l1 + l2
    r = stride * Lg                       # steglängd per halv cykel
    base = stance.get("loc", (0, 0, 0))
    # kroppens sänkning per halv cykel (u): hög när stödbenet passerar under, djupast under sparken
    drop_pts = [(0.0, 0.045), (2 / 36 * 2, 0.012), (SW_KICK * 2, dip), (SW_HOLD * 2, dip * 0.97),
                (SW_DESC * 2, dip * 0.55), (SW_STRIKE * 2, 0.09)]
    # sparkens styrka (bålens bakåtlutning, höftvridning, armarna ut)
    kick_pts = [(0.0, 0.12), (2 / 36 * 2, 0.3), (SW_KICK * 2, 1.0), (SW_HOLD * 2, 1.0), (SW_DESC * 2, 0.6),
                (SW_STRIKE * 2, 0.15)]
    foot_len = foot * Lg                  # fotled -> trampdyna, för tårullningen

    def drop(phi):
        return _loop_spline(drop_pts, (2 * phi) % 1.0) * Lg

    def stance_leg(psi, phi):
        """Stödben: foten glider bakåt relativt höften i jämn takt (= står still i världen)."""
        fwd = 2 * r * (SW_KICK + 0.5 - psi)
        frac = (psi - SW_STRIKE) / (1 - SW_STRIKE)
        roll = 35 * max(0.0, (frac - 0.72) / 0.28) ** 1.5          # hälen lyfter före tåavskjutet
        if frac < 0.12:
            roll = -12 * (1 - frac / 0.12)                          # hälen först, tårna upp
        raise_ = foot_len * math.sin(math.radians(max(0.0, roll)))
        down = Lg + base[2] - drop(phi) - raise_
        t1, t2 = _leg_ik(l1, l2, fwd, down, rest)
        return t1, t2, roll - t1 - t2

    def leg(psi, phi_of):
        """(lår, smalben, fot) i benets egen fas psi; svingfasen är en mjuk kurva genom stödfasens IK."""
        if psi >= SW_STRIKE - 1e-9:
            return stance_leg(psi, phi_of(psi))
        ctrl = {round(f / n, 6): stance_leg(f / n, phi_of(f / n)) for f in range(int(math.ceil(SW_STRIKE * n - 1e-6)), n)}
        ctrl[round(SW_STRIKE, 6)] = stance_leg(SW_STRIKE, phi_of(SW_STRIKE))
        ctrl.update({0.0: stance_leg(1.0 - 1e-9, phi_of(1.0)), SW_KNEE: (-50.0, 75.0, 10.0), SW_KICK: (-kick, 0.0, 20.0),
                     SW_HOLD: (-kick + 6, 2.0, 15.0), SW_DESC: (-55.0, 4.0, 0.0)})
        xs = sorted(ctrl)
        return tuple(_loop_spline([(x, ctrl[x][j]) for x in xs], psi) for j in range(3))

    keys = []
    for f in range(n + 1):
        if f == n:
            keys.append((n, dict(keys[0][1])))
            break
        phi = f / n
        side = 1 if phi < 0.5 else -1     # +1: vänster ben sparkar
        u = (2 * phi) % 1.0
        kk = _loop_spline(kick_pts, u)
        p = dict(stance)
        for s, off in (("L", 0.0), ("R", 0.5)):
            psi = (phi - off) % 1.0
            t1, t2, t3 = leg(psi, lambda q, off=off: (q + off) % 1.0)
            for bone, ang in ((f"thigh.{s}", t1), (f"shin.{s}", t2), (f"foot.{s}", t3)):
                b = stance.get(bone, (0, 0, 0))
                p[bone] = (ang, b[1], b[2])
        a = math.tanh(2.2 * math.cos(math.tau * (phi - SW_KICK))) / math.tanh(2.2)   # stel pendel, +1 = vänster spark
        lb = 32 * lean * kk - 5 * (1 - kk)                                          # bakåtlutning
        swing = {"L": arm_swing * a, "R": -arm_swing * a}
        for s in staff:
            swing[s] = -(dip / 0.31) * 26 * kk          # stavarmen höjs när kroppen sjunker
        p = add(p, {
            "spine": (-0.42 * lb, 0, 0), "chest": (-0.58 * lb, side * 5 * kk, 0), "neck": (0.25 * lb, 0, 0),
            "head": (0.5 * lb, side * 2 * kk, 0), "hips": (0, -side * 7 * kk, 0),
            "upperarm.L": (swing["L"], 0, -9 * kk), "upperarm.R": (swing["R"], 0, 9 * kk),
        })
        # vapnen följer armens sving till hälften men inte bålens lutning; stavar hålls lodräta
        for s in ("L", "R"):
            if f"prop.{s}" in stance:
                chain = ("hips", "spine", "chest", f"shoulder.{s}", f"upperarm.{s}", f"forearm.{s}", f"hand.{s}")
                d_torso = sum(p.get(b, (0, 0, 0))[0] - stance.get(b, (0, 0, 0))[0] for b in chain[:4])
                d_arm = sum(p.get(b, (0, 0, 0))[0] - stance.get(b, (0, 0, 0))[0] for b in chain[4:])
                pr = stance[f"prop.{s}"]
                p[f"prop.{s}"] = (pr[0] - d_torso - (1.0 if s in staff else 0.5) * d_arm, pr[1], pr[2])
        p["loc"] = (base[0] - 0.035 * Lg * math.sin(math.tau * phi), base[1], base[2] - drop(phi))
        keys.append((f, p))
    return keys


def silly_speed(legs, stride=0.5, n=36):
    """Pjäsens hastighet (m/s vid timeScale 1) som får stödfoten i silly_keys att stå still: 2 steg per cykel."""
    return round(2 * stride * (legs[0] + legs[1]) / (n / FPS), 3)


def silly(stance, J, n=36, **kw):
    """silly_keys + matchande hastighet för pjäsens metadata."""
    legs = leg_lengths(J)
    return silly_keys(stance, n=n, legs=legs, **kw), silly_speed(legs, kw.get("stride", 0.5), n)


def hit_keys(stance, n=22, k=1.0):
    return [
        (0, stance),
        (4, add(stance, {"spine": (-10 * k, 0, 0), "chest": (-14 * k, 8 * k, 0), "head": (-18 * k, 0, 6 * k),
                         "upperarm.L": (-10 * k, 0, -16 * k), "upperarm.R": (-10 * k, 0, 16 * k),
                         "loc": (0, 0.07 * k, -0.012)})),
        (12, add(stance, {"spine": (-4 * k, 0, 0), "chest": (-4 * k, 2 * k, 0), "head": (-5 * k, 0, 2 * k),
                          "loc": (0, 0.03 * k, 0)})),
        (n, stance),
    ]


def death_keys(stance, n=40):
    """Statydöd: vacklar bakåt och störtar omkull som en stenstod. Krossas vid nedslaget (sista nyckeln)."""
    stag = add(stance, {"spine": (-12, 0, 0), "chest": (-16, -8, 0), "head": (-20, 10, 0),
                        "upperarm.L": (-25, 0, -30), "upperarm.R": (-15, 0, 30), "loc": (0, 0.1, 0)})
    tilt1 = merge(add(stag, {"shin.L": (12, 0, 0), "shin.R": (8, 0, 0)}), {"root": (-12, 0, 4)})
    tilt2 = merge(tilt1, {"root": (-48, 0, 6)})
    down = merge(tilt1, {"root": (-86, 0, 8)})
    return [(0, stance), (7, stag), (17, tilt1), (28, tilt2), (35, down), (n, down)]


def walk_speed(H, swing, n, robe=False):
    leg = 0.48 * H
    step = 2 * leg * math.sin(math.radians(swing * (0.55 if robe else 1.0)))
    if robe:
        step = max(step, 0.3 * H)
    return round(2 * step / (n / FPS), 3)


# ======================================================================= BONDE: spjutbärare

def build_pawn():
    H = 1.6
    J = rig.joints(H, sw=0.13, hw=0.058)
    parts = []
    statue(J, H, parts)
    hc = face_head(J, H)
    hz = hc.z + 0.014 * H
    helm = lathe("helm", [(0.0, hz + 0.108 * H), (0.03 * H, hz + 0.105 * H), (0.05 * H, hz + 0.093 * H),
                          (0.062 * H, hz + 0.068 * H), (0.066 * H, hz + 0.038 * H), (0.067 * H, hz + 0.012 * H),
                          (0.098 * H, hz - 0.003 * H), (0.114 * H, hz - 0.014 * H), (0.112 * H, hz - 0.02 * H),
                          (0.095 * H, hz - 0.012 * H), (0.064 * H, hz + 0.002 * H), (0.0, hz + 0.002 * H)],
                 seg=48, material="Stone", center=(hc.x, hc.y, 0), sy=1.08)
    add_subsurf(helm, 1)
    parts.append((helm, "head"))
    parts.append((torus("helmband", (hc.x, hc.y, hz + 0.02 * H), 0.067 * H, 0.008 * H, sy=1.08), "head"))
    parts.append((torus("helmbrim", (hc.x, hc.y, hz - 0.016 * H), 0.113 * H, 0.005 * H, sy=1.08, seg=48), "head"))
    ridge = tube("helmridge", [(hc.x, hc.y + k * 0.068 * H * 1.08 * math.cos(t), hz + 0.012 * H + 0.096 * H * math.sin(t))
                               for t in [i / 12 * math.pi for i in range(13)] for k in [1]], 0.006 * H, material="Trim", seg=8)
    parts.append((ridge, "head"))
    # kyrass med sniden bröstkorg
    # hoplitens nakna, skulpterade bål syns (ingen harnesk)
    parts.append((torus("belt", J["spine0"], 0.076 * H, 0.013 * H, sy=0.78, material="Trim"), "spine"))
    parts.append((ellipsoid("buckle", J["spine0"] + V((0, -0.06 * H, 0.0)), (0.02 * H, 0.009 * H, 0.017 * H), material="Trim"), "spine"))
    for p in pteruges("pter", J, H, J["spine0"].z - 0.01 * H, 0.15 * H, 0.074 * H, n=16):
        parts.append((p, "hips"))
    for s in ("L", "R"):
        parts += pauldron(f"paul.{s}", J, H, s, layers=2, size=0.9)
    greaves(J, H, parts, material="Stone")
    vambraces(J, H, parts, material="Stone")
    sandals(J, H, parts)
    # rund sköld på vänster underarm (normal utåt +X) med solemblem
    e, w = J["elbow.L"], J["wrist.L"]
    c = mid(e, w, 0.45) + V((0.045 * H, 0, 0))
    R = 0.15 * H
    shp = []
    shp.append(lathe("shield", [(0.0, -0.012 * H), (R * 0.98, -0.012 * H), (R, -0.004 * H), (R * 0.97, 0.008 * H),
                                (R * 0.6, 0.016 * H), (0.0, 0.02 * H)], seg=56, material="Stone"))
    shp.append(torus("shieldrim", (0, 0, 0.002 * H), R, 0.012 * H, seg=56, material="Trim"))
    shp.append(torus("shieldring", (0, 0, 0.016 * H), R * 0.62, 0.006 * H, seg=48, material="Trim"))
    shp.append(ellipsoid("boss", (0, 0, 0.018 * H), (0.035 * H, 0.035 * H, 0.025 * H), material="Trim"))
    for i in range(12):
        ray = prism(f"ray{i}", [(-0.012 * H, 0), (0.012 * H, 0), (0, 0.05 * H)], 0.006 * H, material="Trim", axis="Z",
                    center=(0, 0.04 * H, 0.019 * H))
        transform(ray, rot=(0, 0, i * 30))
        shp.append(ray)
    for o in shp:
        transform(o, rot=(0, 90, 0))
        transform(o, loc=tuple(c))
        parts.append((o, "forearm.L"))
    # spjut i höger hand: skaft genom näven, ned mot marken
    g = J["grip.R"]
    parts.append((tube("spear", [(g.x, g.y, 0.03 * H), (g.x, g.y, 1.22 * H)], [0.011 * H, 0.01 * H], material="Wood", seg=10), "prop.R"))
    parts.append((tube("ferrule", [(g.x, g.y, 1.2 * H), (g.x, g.y, 1.24 * H)], 0.014 * H, material="Trim", seg=12), "prop.R"))
    parts.append((tube("butt", [(g.x, g.y, 0.015 * H), (g.x, g.y, 0.05 * H)], [0.008 * H, 0.013 * H], material="Trim", seg=12), "prop.R"))
    parts.append((blade("spearhead", (g.x, g.y, 1.235 * H), 0.17 * H, 0.05 * H, 0.014 * H, material="Steel",
                        direction=(0, 0, 1), flat_normal=(0, 1, 0), tip=0.55, fuller=False), "prop.R"))
    arm, mesh = finish("pawn", J, H, parts)

    stance = {"upperarm.L": (-18, 0, -12), "forearm.L": (-62, 55, 0),
              "upperarm.R": (-6, 0, 4), "forearm.R": (-8, 0, 0),
              "thigh.L": (-4, 0, -3), "thigh.R": (3, 0, 3), "shin.L": (6, 0, 0), "shin.R": (3, 0, 0)}
    stance = aim(stance, "R", 0)
    A = {}
    A["idle"] = idle_keys(stance)
    A["walk"] = walk_keys(stance, n=30, lock_arms=("upperarm.L", "upperarm.R"))
    guard = merge(stance, {"upperarm.R": (20, 0, 18), "forearm.R": (-50, 0, 0), "hand.R": (0, 0, 0),
                           "chest": (0, -14, 0), "spine": (4, -8, 0), "thigh.L": (-22, 0, -4), "shin.L": (18, 0, 0),
                           "thigh.R": (14, 0, 4), "shin.R": (10, 0, 0), "loc": (0, 0, -0.03)})
    guard = aim(guard, "R", 84)
    wind = aim(add(guard, {"upperarm.R": (28, 0, 0), "forearm.R": (-20, 0, 0), "chest": (-4, -12, 0), "loc": (0, 0.08, 0)}), "R", 86)
    thrust = merge(add(guard, {"upperarm.R": (-62, 0, -10), "forearm.R": (42, 0, 0), "chest": (10, 22, 0), "spine": (6, 10, 0),
                               "loc": (0, -0.26, -0.04)}), {"thigh.L": (-42, 0, -4), "shin.L": (38, 0, 0), "thigh.R": (22, 0, 4)})
    thrust = aim(thrust, "R", 92)
    A["attack"] = [(0, stance), (10, guard), (20, wind), (26, thrust), (34, thrust), (46, guard), (60, stance)]
    A["hit"] = hit_keys(stance)
    A["death"] = death_keys(stance)
    vic = aim(merge(stance, {"upperarm.R": (-160, 0, 8), "forearm.R": (-8, 0, 0), "head": (-12, 0, 0), "chest": (-6, 0, 0)}), "R", 0)
    A["victory"] = [(0, stance), (14, vic), (28, aim(add(vic, {"upperarm.R": (12, 0, 0)}), "R", 0)), (42, vic), (60, stance)]
    bwind = merge(stance, {"upperarm.L": (-10, 0, -34), "forearm.L": (-40, 30, 0), "chest": (0, 26, 0), "spine": (2, 10, 0),
                           "thigh.L": (-18, 0, -4), "shin.L": (14, 0, 0), "loc": (0, 0.04, -0.03)})
    bash = merge(stance, {"upperarm.L": (-72, 0, -4), "forearm.L": (-18, 62, 0), "chest": (6, -22, 0), "spine": (4, -8, 0),
                          "thigh.L": (-34, 0, -4), "shin.L": (30, 0, 0), "thigh.R": (18, 0, 4), "loc": (0, -0.2, -0.05)})
    lift = aim(merge(bash, {"upperarm.R": (-165, 0, 14), "forearm.R": (-25, 0, 0), "chest": (-10, -6, 0), "spine": (-4, 0, 0),
                            "loc": (0, -0.12, 0.0)}), "R", 175)
    stab = aim(merge(bash, {"upperarm.R": (-92, 0, -4), "forearm.R": (-8, 0, 0), "chest": (26, 6, 0), "spine": (12, 0, 0),
                            "upperarm.L": (-40, 0, -20), "loc": (0, -0.28, -0.14)}), "R", 158)
    A["attack2"] = [(0, stance), (8, bwind), (14, bash), (20, bash), (27, lift), (33, stab), (44, stab), (60, stance)]
    ev = {"attack": [26], "attack2": [14, 33], "death": [35]}
    A["silly"], silly_v = silly(stance, J, stride=0.5, staff=("R",))
    return arm, mesh, A, ev, {"height": H, "walkSpeed": walk_speed(H, 24, 30), "sillySpeed": silly_v}


# ======================================================================= SPRINGARE: riddare med hästhjälm

def horse_crest(H, base):
    c = 0.17 * H
    o = [(0.36, 0.0), (-0.28, 0.0), (-0.26, 0.3), (-0.48, 0.48), (-0.7, 0.52), (-0.8, 0.6), (-0.8, 0.7),
         (-0.68, 0.8), (-0.42, 0.95), (-0.22, 1.1), (-0.14, 1.3), (-0.04, 1.16), (0.14, 1.1), (0.32, 0.86),
         (0.42, 0.5), (0.4, 0.2)]
    o = [(u * c, v * c) for (u, v) in o]
    head = prism("crest", o, 0.2 * c, material="Stone", axis="X", center=tuple(base), bevel=0.012 * c, segments=3)
    add_subsurf(head, 1)
    mane = []
    pts = [(0.12, 1.12), (0.3, 0.92), (0.4, 0.62), (0.42, 0.3), (0.38, 0.05)]
    for i, (u, v) in enumerate(pts):
        fin = prism(f"mane{i}", [(-0.06 * c, -0.02 * c), (0.07 * c, 0.0), (0.0, 0.16 * c)], 0.08 * c, material="Trim", axis="X",
                    center=(base.x, base.y + u * c, base.z + v * c), bevel=0.004 * c)
        ang = math.degrees(math.atan2(pts[min(i + 1, 4)][1] - pts[max(i - 1, 0)][1], pts[min(i + 1, 4)][0] - pts[max(i - 1, 0)][0]))
        transform(fin, rot=(-(ang + 90) * 0.6, 0, 0), pivot=(base.x, base.y + u * c, base.z + v * c))
        mane.append(fin)
    eyes = [ellipsoid(f"heye{k}", (base.x + k * 0.1 * c, base.y - 0.5 * c, base.z + 0.8 * c), (0.03 * c, 0.05 * c, 0.035 * c),
                      material="Dark", seg=10, rings=6) for k in (1, -1)]
    nost = [ellipsoid(f"hnos{k}", (base.x + k * 0.06 * c, base.y - 0.79 * c, base.z + 0.63 * c), (0.025 * c, 0.02 * c, 0.03 * c),
                      material="Dark", seg=8, rings=6) for k in (1, -1)]
    return [head] + mane + eyes + nost


def kite_shield(H, c, emblem="cross"):
    o = [(-0.115, 0.15), (-0.06, 0.17), (0.0, 0.175), (0.06, 0.17), (0.115, 0.15), (0.12, 0.05), (0.1, -0.08),
         (0.06, -0.2), (0.0, -0.31), (-0.06, -0.2), (-0.1, -0.08), (-0.12, 0.05)]
    o = [(u * H, v * H) for (u, v) in o]
    face = prism("kite", o, 0.016 * H, material="Stone", axis="X", bevel=0.004 * H)
    rim = prism("kiterim", [(u * 1.06, v * 1.05 - 0.004 * H) for (u, v) in o], 0.01 * H, material="Trim", axis="X",
                center=(-0.006 * H, 0, 0), bevel=0.003 * H)
    out = [face, rim]
    if emblem == "cross":
        out.append(prism("kitecross_v", [(-0.014 * H, 0.14 * H), (0.014 * H, 0.14 * H), (0.014 * H, -0.24 * H), (-0.014 * H, -0.24 * H)],
                         0.008 * H, material="Trim", axis="X", center=(0.011 * H, 0, 0), bevel=0.003 * H))
        out.append(prism("kitecross_h", [(-0.09 * H, 0.06 * H), (0.09 * H, 0.06 * H), (0.09 * H, 0.032 * H), (-0.09 * H, 0.032 * H)],
                         0.008 * H, material="Trim", axis="X", center=(0.011 * H, 0, 0), bevel=0.003 * H))
    # svag välvning
    for ob in out:
        for v in ob.data.vertices:
            v.co.x -= (v.co.y / (0.12 * H)) ** 2 * 0.02 * H
        transform(ob, loc=tuple(c))
    return out


def sword(H, g, length=0.5, width=0.05, guard=0.12, name="sword"):
    out = [
        tube(f"{name}grip", [(g.x, g.y, g.z - 0.05 * H), (g.x, g.y, g.z + 0.05 * H)], 0.012 * H, material="Wood", seg=10),
        ellipsoid(f"{name}pommel", (g.x, g.y, g.z - 0.06 * H), (0.019 * H, 0.019 * H, 0.022 * H), material="Trim"),
        tube(f"{name}guard", [(g.x, g.y - guard / 2 * H, g.z + 0.062 * H), (g.x, g.y - guard * 0.25 * H, g.z + 0.058 * H),
                             (g.x, g.y + guard * 0.25 * H, g.z + 0.058 * H), (g.x, g.y + guard / 2 * H, g.z + 0.062 * H)],
             0.009 * H, material="Trim", seg=10),
        ellipsoid(f"{name}gem", (g.x, g.y, g.z + 0.06 * H), (0.013 * H, 0.012 * H, 0.013 * H), material="Gem", seg=12, rings=8),
        blade(f"{name}blade", (g.x, g.y, g.z + 0.065 * H), length * H, width * H, 0.012 * H, material="Steel",
              direction=(0, 0, 1), flat_normal=(1, 0, 0), tip=0.16),
    ]
    return out


def build_knight():
    H = 1.85
    J = rig.joints(H, sw=0.135, hw=0.06)
    parts = []
    statue(J, H, parts, face=False)
    hc = face_head(J, H)
    # stor tunnhjälm
    hz0, hz1 = hc.z - 0.075 * H, hc.z + 0.085 * H
    helm = lathe("greathelm", [(0.0, hz0 + 0.004 * H), (0.058 * H, hz0), (0.064 * H, hz0 + 0.04 * H), (0.067 * H, hc.z),
                               (0.066 * H, hc.z + 0.05 * H), (0.058 * H, hz1 - 0.008 * H), (0.04 * H, hz1), (0.0, hz1 + 0.004 * H)],
                 seg=40, material="Stone", center=(hc.x, hc.y, 0), sy=1.12)
    add_subsurf(helm, 1)
    parts.append((helm, "head"))
    parts.append((box("visor", (hc.x, hc.y - 0.072 * H, hc.z + 0.012 * H), (0.1 * H, 0.03 * H, 0.012 * H), material="Dark", bevel=0.002), "head"))
    parts.append((tube("helmcross", [(hc.x, hc.y - 0.071 * H, hz0 + 0.01 * H), (hc.x, hc.y - 0.077 * H, hc.z), (hc.x, hc.y - 0.071 * H, hc.z + 0.05 * H),
                                     (hc.x, hc.y - 0.05 * H, hz1 - 0.004 * H)], 0.008 * H, material="Trim", seg=8), "head"))
    parts.append((torus("helmband", (hc.x, hc.y, hc.z + 0.03 * H), 0.067 * H, 0.006 * H, sy=1.12, material="Trim"), "head"))
    for k in (1, -1):
        for i in range(4):
            parts.append((ellipsoid(f"breath{k}{i}", (hc.x + k * 0.03 * H, hc.y - 0.072 * H + 0.006 * H * abs(k), hc.z - 0.025 * H - i * 0.011 * H),
                                    (0.005 * H, 0.004 * H, 0.003 * H), material="Dark", seg=8, rings=6), "head"))
    for o in horse_crest(H, V((hc.x, hc.y + 0.01 * H, hz1 - 0.008 * H))):
        parts.append((o, "head"))
    # plåtrustning
    parts.append((torso_shell("breastplate", J, H, width=1.12, depth=0.78, keel=0.02), "chest"))
    parts.append((tube("ridge", [J["chest0"] + V((0, -0.082 * H, -0.01 * H)), J["chest0"] + V((0, -0.087 * H, 0.05 * H)),
                                 J["chest0"] + V((0, -0.07 * H, 0.11 * H))], 0.006 * H, material="Trim", seg=8), "chest"))
    parts.append((torus("gorget", J["neck0"] - V((0, 0, 0.005 * H)), 0.048 * H, 0.012 * H, sy=0.9, material="Trim"), "chest"))
    for i in range(3):  # fauld: staplade band över höften
        z = J["spine0"].z - 0.005 * H - i * 0.026 * H
        f = lathe(f"fauld{i}", [(0.08 * H + i * 0.006 * H, z - 0.02 * H), (0.083 * H + i * 0.006 * H, z - 0.016 * H),
                                (0.078 * H + i * 0.006 * H, z + 0.01 * H)], seg=40, sy=0.8, material="Stone" if i % 2 else "Trim",
                  cap_bottom=False, cap_top=False)
        add_solidify(f, 0.004 * H)
        parts.append((f, "spine" if i == 0 else "hips"))
    for s, k in (("L", 1), ("R", -1)):
        hp = J[f"hip.{s}"]
        tas = prism(f"tasset.{s}", [(-0.045 * H, 0), (0.045 * H, 0), (0.04 * H, -0.11 * H), (-0.04 * H, -0.11 * H)], 0.008 * H,
                    material="Stone", axis="Y", center=(hp.x + k * 0.01 * H, hp.y - 0.06 * H, J["pelvis"].z - 0.03 * H), bevel=0.003 * H)
        transform(tas, rot=(-10, 0, k * 12), pivot=(hp.x, hp.y - 0.06 * H, J["pelvis"].z - 0.03 * H))
        parts.append((tas, f"thigh.{s}"))
        parts += pauldron(f"paul.{s}", J, H, s, layers=3, size=0.82)
        e = J[f"elbow.{s}"]
        for o in cop(f"couter.{s}", e + V((0, 0.024 * H, 0)), (0, 1, -0.1), H, 0.9, "Trim", k=k):
            parts.append((o, f"forearm.{s}"))
    greaves(J, H, parts, material="Stone")
    vambraces(J, H, parts, material="Stone")
    sabatons(J, H, parts, material="Stone")
    gauntlets(J, H, parts, material="Stone")
    parts.append((cape("cape", J, H, J["neck0"].z - 0.03 * H, 0.16 * H, 0.1 * H, 0.21 * H, spread=1.25, folds=8), "chest"))
    for o in kite_shield(H, mid(J["elbow.L"], J["wrist.L"], 0.45) + V((0.05 * H, 0, 0.02 * H))):
        parts.append((o, "forearm.L"))
    for o in sword(H, J["grip.R"], length=0.5):
        parts.append((o, "prop.R"))
    arm, mesh = finish("knight", J, H, parts)

    stance = {"upperarm.L": (-20, 0, -14), "forearm.L": (-60, 55, 0),
              "upperarm.R": (-10, 0, 8), "forearm.R": (-40, 0, 0),
              "thigh.L": (-5, 0, -4), "thigh.R": (4, 0, 4), "shin.L": (7, 0, 0), "shin.R": (4, 0, 0), "chest": (0, -4, 0)}
    stance = aim(stance, "R", 35)
    # gången: ett studsande låtsasgalopp med tyglarna i handen (kokosnötterna kommer från spelet)
    reins = aim(merge(stance, {"upperarm.R": (-38, 0, 4), "forearm.R": (-62, 0, 0)}), "R", 60)
    A = {"idle": idle_keys(stance), "walk": walk_keys(reins, n=22, swing=26, knee=58, bob=0.075, lock_arms=("upperarm.L", "upperarm.R"))}
    # tvåhuggskombination: hugg uppifrån, sedan bakhandshugg
    ready = merge(stance, {"thigh.L": (-24, 0, -4), "shin.L": (20, 0, 0), "thigh.R": (16, 0, 4), "shin.R": (12, 0, 0), "loc": (0, 0, -0.04)})
    wind1 = aim(merge(ready, {"upperarm.R": (-150, 0, 30), "forearm.R": (-40, 0, 0), "chest": (-8, -20, 0), "spine": (-4, -10, 0)}), "R", -70)
    cut1 = aim(merge(ready, {"upperarm.R": (-60, 0, -14), "forearm.R": (-10, 0, 0), "chest": (14, 18, 0), "spine": (8, 10, 0),
                             "loc": (0, -0.22, -0.08), "thigh.L": (-44, 0, -4), "shin.L": (40, 0, 0)}), "R", 140)
    wind2 = aim(merge(cut1, {"upperarm.R": (-100, 0, -60), "forearm.R": (-60, 0, 0), "chest": (6, 34, 0), "spine": (4, 16, 0)}), "R", 40, yaw=-60)
    cut2 = aim(merge(cut1, {"upperarm.R": (-90, 0, 60), "forearm.R": (-10, 0, 0), "chest": (6, -30, 0), "spine": (4, -14, 0)}), "R", 90, yaw=60)
    A["attack"] = [(0, stance), (10, ready), (20, wind1), (27, cut1), (36, cut1), (46, wind2), (53, cut2), (62, cut2), (76, stance)]
    A["hit"] = hit_keys(stance)
    A["death"] = death_keys(stance)
    vic = aim(merge(stance, {"upperarm.R": (-165, 0, 6), "forearm.R": (-5, 0, 0), "head": (-14, 0, 0), "chest": (-8, 0, 0)}), "R", 0)
    A["victory"] = [(0, stance), (16, vic), (32, aim(add(vic, {"upperarm.R": (10, 0, 0)}), "R", 0)), (46, vic), (64, stance)]
    swind = aim(merge(ready, {"upperarm.R": (-80, 0, 70), "forearm.R": (-30, 0, 0), "chest": (0, 34, 0), "spine": (0, 14, 0)}), "R", 90, yaw=70)
    sout = aim(merge(ready, {"upperarm.R": (-88, 0, 30), "forearm.R": (-6, 0, 0), "chest": (4, -10, 0)}), "R", 90, yaw=10)
    sstrike = aim(merge(ready, {"upperarm.R": (-88, 0, -40), "forearm.R": (-6, 0, 0), "chest": (8, -34, 0), "spine": (4, -14, 0),
                                "loc": (0, -0.2, -0.06)}), "R", 92, yaw=-40)
    A["attack2"] = [(0, stance), (9, swind), (13, merge(sout, {"root": (0, -100, 0)})), (18, merge(sout, {"root": (0, -210, 0)})),
                    (22, merge(sout, {"root": (0, -300, 0)})), (26, merge(sstrike, {"root": (0, -360, 0)})),
                    (36, merge(sstrike, {"root": (0, -360, 0)})), (52, merge(stance, {"root": (0, -360, 0)}))]
    ev = {"attack": [27, 53], "attack2": [26], "death": [35]}
    A["silly"], silly_v = silly(stance, J, stride=0.6, lean=0.6)   # manteln är styvt bunden till chest: luta mindre
    return arm, mesh, A, ev, {"height": H, "walkSpeed": walk_speed(H, 26, 22), "sillySpeed": silly_v}


# ======================================================================= LÖPARE: biskop med kräkla

def crozier(H, g):
    top = V((g.x, g.y, g.z + 0.66 * H))
    out = [tube("crozshaft", [(g.x, g.y, g.z - 0.4 * H), (g.x, g.y, top.z)], [0.011 * H, 0.01 * H], material="Trim", seg=10)]
    out.append(ellipsoid("crozknob", (g.x, g.y, top.z - 0.01 * H), (0.024 * H, 0.024 * H, 0.03 * H), material="Trim"))
    R0 = 0.075 * H
    C = top + V((0, -R0, 0.02 * H))
    pts, rad = [], []
    steps = 34
    tmax = 2.25 * math.pi
    for i in range(steps + 1):
        t = tmax * i / steps
        R = R0 * (1 - 0.6 * t / tmax)
        pts.append(C + V((0, R * math.cos(t), R * math.sin(t))))
        rad.append(0.011 * H * (1 - 0.35 * t / tmax))
    out.append(tube("crook", [top] + pts, [0.011 * H] + rad, material="Trim", seg=10))
    out.append(ellipsoid("crookgem", (C.x, C.y, C.z), (0.02 * H, 0.02 * H, 0.02 * H), material="Gem", seg=12, rings=8))
    return out


def build_bishop():
    H = 1.85
    J = rig.joints(H, sw=0.125, hw=0.055)
    parts = []
    statue(J, H, parts)
    hc = face_head(J, H)
    # fotsid dräkt + korkåpa
    parts.append((fold_robe("robe", J["spine0"].z + 0.02 * H, 0.0, 0.08 * H, 0.15 * H, H, folds=13, amp=0.08), "hips"))
    parts.append((torso_shell("robetop", J, H, width=1.06, depth=0.8, keel=0.0, fold=(9, 0.035, J["neck0"].z, J["spine0"].z)), "chest"))
    parts.append((cape("cope", J, H, J["neck0"].z - 0.01 * H, 0.32 * H, 0.1 * H, 0.17 * H, spread=1.9, folds=10, amp=0.06,
                       material="Cloth", yoff=0.0), "chest"))
    # stola fram
    for k in (1, -1):
        st = tube(f"stole{k}", [J["neck0"] + V((k * 0.03 * H, -0.04 * H, -0.01 * H)), J["chest0"] + V((k * 0.045 * H, -0.08 * H, 0.03 * H)),
                                J["spine0"] + V((k * 0.05 * H, -0.072 * H, 0.0)), V((k * 0.055 * H, -0.105 * H, 0.32 * H)),
                                V((k * 0.06 * H, -0.13 * H, 0.2 * H))], 0.012 * H, material="Trim", seg=8)
        transform(st, scale=(1, 0.6, 1))
        parts.append((st, "chest"))
    parts.append((torus("cincture", J["spine0"] + V((0, 0, 0.01 * H)), 0.082 * H, 0.01 * H, sy=0.8, material="Trim"), "spine"))
    # vida ärmar
    for s in ("L", "R"):
        sh, e, w = J[f"shoulder.{s}"], J[f"elbow.{s}"], J[f"wrist.{s}"]
        parts.append((sleeve(f"sleeveU.{s}", sh + V((0, 0, 0.02 * H)), e, [(0.043 * H, 0), (0.038 * H, 1.0)], seg=20), f"upperarm.{s}"))
        parts.append((sleeve(f"sleeveF.{s}", e - V((0, 0, -0.01 * H)), w - V((0, 0, 0.01 * H)),
                             [(0.04 * H, 0), (0.05 * H, 0.6), (0.068 * H, 1.0), (0.062 * H, 1.0)], seg=24, fold=(7, 0.12, 0.2, 1.0)), f"forearm.{s}"))
    # mitra
    mz = hc.z + 0.03 * H
    mitre = lathe("mitre", [(0.056 * H, mz), (0.062 * H, mz + 0.05 * H), (0.06 * H, mz + 0.1 * H), (0.048 * H, mz + 0.15 * H),
                            (0.028 * H, mz + 0.19 * H), (0.0, mz + 0.215 * H)], seg=40, sx=1.0, sy=0.88, center=(hc.x, hc.y, 0))
    add_subsurf(mitre, 1)
    parts.append((mitre, "head"))
    parts.append((torus("mitreband", (hc.x, hc.y, mz + 0.012 * H), 0.058 * H, 0.009 * H, sy=0.88, material="Trim"), "head"))
    for k in (1, -1):
        band = tube(f"mitrev{k}", [(hc.x, hc.y + k * 0.051 * H, mz + 0.01 * H), (hc.x, hc.y + k * 0.054 * H, mz + 0.06 * H),
                                   (hc.x, hc.y + k * 0.05 * H, mz + 0.11 * H), (hc.x, hc.y + k * 0.036 * H, mz + 0.16 * H),
                                   (hc.x, hc.y + k * 0.012 * H, mz + 0.205 * H)], 0.007 * H, material="Trim", seg=8)
        parts.append((band, "head"))
    cr = hc + V((0, -0.058 * H, 0.15 * H))
    parts.append((prism("mitrecross_v", [(-0.006 * H, -0.035 * H), (0.006 * H, -0.035 * H), (0.006 * H, 0.035 * H), (-0.006 * H, 0.035 * H)],
                        0.006 * H, material="Trim", axis="Y", center=tuple(cr), bevel=0.002 * H), "head"))
    parts.append((prism("mitrecross_h", [(-0.022 * H, 0.004 * H), (0.022 * H, 0.004 * H), (0.022 * H, 0.016 * H), (-0.022 * H, 0.016 * H)],
                        0.006 * H, material="Trim", axis="Y", center=tuple(cr), bevel=0.002 * H), "head"))
    for k in (1, -1):  # band i nacken
        parts.append((prism(f"lappet{k}", [(-0.012 * H, 0), (0.012 * H, 0), (0.012 * H, -0.12 * H), (0, -0.13 * H), (-0.012 * H, -0.12 * H)],
                            0.005 * H, material="Cloth", axis="Y", center=(hc.x + k * 0.025 * H, hc.y + 0.056 * H, mz + 0.01 * H), bevel=0.002), "head"))
    for o in crozier(H, J["grip.R"]):
        parts.append((o, "prop.R"))
    arm, mesh = finish("bishop", J, H, parts)

    stance = {"upperarm.R": (-14, 0, 6), "forearm.R": (-50, 0, 0), "upperarm.L": (-30, 0, -6), "forearm.L": (-70, 20, 0),
              "chest": (2, 0, 0), "head": (4, 0, 0)}
    stance = aim(stance, "R", 0)
    A = {"idle": idle_keys(stance, amt=0.8), "walk": walk_keys(stance, n=34, robe=True, lock_arms=("upperarm.R",), arm_swing=6, bob=0.015)}
    lift = aim(merge(stance, {"upperarm.R": (-160, 0, 12), "forearm.R": (-20, 0, 0), "upperarm.L": (-150, 0, -14), "forearm.L": (-30, 0, 0),
                              "chest": (-12, 0, 0), "head": (-14, 0, 0), "loc": (0, 0.04, 0.02)}), "R", -40)
    smash = aim(merge(stance, {"upperarm.R": (-75, 0, -8), "forearm.R": (-10, 0, 0), "upperarm.L": (-60, 0, -10), "forearm.L": (-20, 0, 0),
                               "chest": (22, 0, 0), "spine": (10, 0, 0), "head": (6, 0, 0), "loc": (0, -0.18, -0.06)}), "R", 140)
    A["attack"] = [(0, stance), (14, lift), (30, add(lift, {"chest": (-4, 0, 0)})), (37, smash), (48, smash), (64, stance)]
    A["hit"] = hit_keys(stance)
    A["death"] = death_keys(stance)
    vic = aim(merge(stance, {"upperarm.R": (-150, 0, 10), "forearm.R": (-10, 0, 0), "upperarm.L": (-100, 0, -40), "head": (-16, 0, 0)}), "R", 0)
    A["victory"] = [(0, stance), (18, vic), (40, vic), (60, stance)]
    point = aim(merge(stance, {"upperarm.R": (-112, 0, -2), "forearm.R": (-6, 0, 0), "upperarm.L": (-70, 0, -40), "forearm.L": (-30, 0, 0),
                               "chest": (-4, 0, 0), "head": (-6, 0, 0), "loc": (0, -0.05, 0.01)}), "R", 70)
    A["attack2"] = [(0, stance), (14, lift), (22, add(lift, {"chest": (-4, 0, 0)})), (28, point), (46, point), (62, stance)]
    ev = {"attack": [37], "attack2": [28], "death": [35]}
    # benen sparkar ut genom dräkten; grundare knäböj, annars sjunker fållen (bunden till hips) genom golvet
    A["silly"], silly_v = silly(stance, J, stride=0.4, dip=0.18, lean=0.6, staff=("R",))
    return arm, mesh, A, ev, {"height": H, "walkSpeed": walk_speed(H, 24, 34, robe=True), "sillySpeed": silly_v}


# ======================================================================= TORN: stengolem

def build_rook():
    H = 2.3
    J = rig.joints(H, sw=0.19, hw=0.075, chest_z=0.66, pelvis_z=0.47)
    # kortare, grövre armar som hänger lägre
    for s, k in (("L", 1), ("R", -1)):
        J[f"elbow.{s}"] = V((k * 0.215 * H, 0.0, 0.58 * H))
        J[f"wrist.{s}"] = V((k * 0.225 * H, -0.02 * H, 0.4 * H))
        J[f"handEnd.{s}"] = V((k * 0.228 * H, -0.025 * H, 0.32 * H))
        J[f"grip.{s}"] = V((k * 0.226 * H, -0.022 * H, 0.36 * H))
        J[f"gripTip.{s}"] = V((k * 0.226 * H, -0.022 * H, 0.45 * H))
        J[f"shoulder.{s}"] = V((k * 0.19 * H, 0.0, 0.8 * H))
        J[f"clav0.{s}"] = V((k * 0.05 * H, 0.0, 0.79 * H))
    parts = []

    def masonry(z0, z1, r0, r1, rows):
        prof = [(r0 * 0.96, z0)]
        for i in range(rows):
            za = z0 + (z1 - z0) * i / rows
            zb = z0 + (z1 - z0) * (i + 1) / rows
            ra = r0 + (r1 - r0) * i / rows
            rb = r0 + (r1 - r0) * (i + 1) / rows
            prof += [(ra * 0.975, za + 0.002 * H), (ra, za + 0.008 * H), (rb, zb - 0.008 * H), (rb * 0.975, zb - 0.002 * H)]
        prof.append((r1 * 0.96, z1))
        return prof

    import random
    rnd = random.Random(4)
    parts.append((lathe("towercore", [(0.13 * H, J["pelvis"].z - 0.03 * H), (0.17 * H, 0.88 * H)], seg=24, sy=0.85, material="Stone"), "chest"))
    rows = 9
    z0, z1 = J["pelvis"].z - 0.03 * H, 0.88 * H
    for r in range(rows):
        za, zb = z0 + (z1 - z0) * r / rows, z0 + (z1 - z0) * (r + 1) / rows
        rad = 0.15 * H + (0.2 - 0.15) * H * (r / (rows - 1)) ** 1.3
        n = 11
        for i in range(n):
            a = 2 * math.pi * (i + 0.5 * (r % 2)) / n + rnd.uniform(-0.03, 0.03)
            w = 2 * math.pi * rad / n * 0.93
            rr = rad + rnd.uniform(-0.004, 0.006) * H
            c = (math.cos(a) * rr, math.sin(a) * rr * 0.85, (za + zb) / 2)
            bl = box(f"block{r}_{i}", c, (w, 0.05 * H, (zb - za) * 0.9), bevel=0.007 * H, segments=2)
            transform(bl, rot=(rnd.uniform(-2, 2), rnd.uniform(-2, 2), math.degrees(a) + 90 + rnd.uniform(-3, 3)), pivot=c)
            parts.append((bl, "spine" if (za + zb) / 2 < J["chest0"].z else "chest"))
    # utkragning och tinnar
    parts.append((lathe("corbel", [(0.19 * H, 0.86 * H), (0.225 * H, 0.89 * H), (0.225 * H, 0.905 * H), (0.0, 0.905 * H)], seg=32, sy=0.85), "chest"))
    for i in range(8):
        a = 2 * math.pi * (i + 0.5) / 8
        m = box(f"merlon{i}", (math.cos(a) * 0.2 * H, math.sin(a) * 0.2 * H * 0.85, 0.94 * H), (0.075 * H, 0.05 * H, 0.08 * H), bevel=0.006 * H)
        transform(m, rot=(0, 0, math.degrees(a) + 90), pivot=(math.cos(a) * 0.2 * H, math.sin(a) * 0.2 * H * 0.85, 0.94 * H))
        add_rock(m, 0.006 * H, 0.04, levels=1, seed=10 + i)
        parts.append((m, "chest"))
    # glödande skottgluggar och kärna
    for k, z in ((0, 0.78), (-1, 0.7), (1, 0.7)):
        parts.append((box(f"slit{k}", (k * 0.07 * H, -0.17 * H * 0.85 + abs(k) * 0.012 * H, z * H), (0.018 * H, 0.03 * H, 0.07 * H),
                          material="Gem", bevel=0.004 * H), "chest"))
    # huvud: liten sten med ögonspringa inne i tinnarna
    hb = box("rockhead", (0, -0.01 * H, 0.975 * H), (0.13 * H, 0.12 * H, 0.1 * H), bevel=0.02 * H, segments=3)
    add_rock(hb, 0.006 * H, 0.06, levels=1, seed=30)
    parts.append((hb, "head"))
    parts.append((box("rockeyes", (0, -0.07 * H, 0.98 * H), (0.09 * H, 0.012 * H, 0.014 * H), material="Gem", bevel=0.003 * H), "head"))
    # baner framtill
    ban = [(-0.07 * H, 0), (0.07 * H, 0), (0.07 * H, -0.24 * H), (0, -0.2 * H), (-0.07 * H, -0.24 * H)]
    parts.append((prism("banner", ban, 0.008 * H, material="Cloth", axis="Y", center=(0, -0.178 * H, 0.6 * H), bevel=0.002), "spine"))
    parts.append((tube("bannerbar", [(-0.08 * H, -0.18 * H, 0.6 * H), (0.08 * H, -0.18 * H, 0.6 * H)], 0.007 * H, material="Trim", seg=8), "spine"))
    # klippblocksarmar
    for s, k in (("L", 1), ("R", -1)):
        sh, e, w = J[f"shoulder.{s}"], J[f"elbow.{s}"], J[f"wrist.{s}"]
        b1 = ellipsoid(f"shoulderrock.{s}", sh + V((k * 0.01 * H, 0, 0.01 * H)), (0.08 * H, 0.075 * H, 0.07 * H), seg=14, rings=10)
        add_rock(b1, 0.012 * H, 0.05, seed=40 + k)
        parts.append((b1, f"upperarm.{s}"))
        b2 = limb(f"urock.{s}", sh, e, 0.06 * H, 0.052 * H, seg=12)
        add_rock(b2, 0.012 * H, 0.05, seed=42 + k)
        parts.append((b2, f"upperarm.{s}"))
        b3 = limb(f"frock.{s}", e, w, 0.058 * H, 0.07 * H, seg=12)
        add_rock(b3, 0.012 * H, 0.05, seed=44 + k)
        parts.append((b3, f"forearm.{s}"))
        f = ellipsoid(f"fistrock.{s}", J[f"grip.{s}"], (0.07 * H, 0.072 * H, 0.075 * H), seg=14, rings=10)
        add_rock(f, 0.012 * H, 0.05, seed=46 + k)
        parts.append((f, f"hand.{s}"))
        parts.append((torus(f"armband.{s}", (0, 0, 0), 0.06 * H, 0.01 * H, material="Trim", seg=24), f"forearm.{s}"))
        orient(parts[-1][0], mid(e, w, 0.25), mid(e, w, 0.25) + (w - e).normalized() * 0.1)
    # pelarben
    for s in ("L", "R"):
        hp, kn, an, to = J[f"hip.{s}"], J[f"knee.{s}"], J[f"ankle.{s}"], J[f"toe.{s}"]
        t = limb(f"lthigh.{s}", hp, kn, 0.075 * H, 0.065 * H, seg=12)
        add_rock(t, 0.012 * H, 0.05, seed=50 if s == "L" else 51)
        parts.append((t, f"thigh.{s}"))
        sh_ = lathe(f"lshin.{s}", masonry(0.0, (kn - an).length, 0.06 * H, 0.068 * H, 2), seg=16)
        orient(sh_, an, kn)
        add_rock(sh_, 0.006 * H, 0.05, levels=1, seed=52 if s == "L" else 53)
        parts.append((sh_, f"shin.{s}"))
        ft = box(f"lfoot.{s}", V((an.x, (an.y + to.y) / 2 - 0.01 * H, 0.03 * H)), (0.1 * H, 0.15 * H, 0.06 * H), bevel=0.012 * H, segments=2)
        add_rock(ft, 0.008 * H, 0.05, levels=1, seed=54 if s == "L" else 55)
        parts.append((ft, f"foot.{s}"))
    parts.append((ellipsoid("pelvisrock", J["pelvis"], (0.13 * H, 0.1 * H, 0.07 * H), seg=16, rings=10), "hips"))
    arm, mesh = finish("rook", J, H, parts)

    stance = {"upperarm.L": (-8, 0, -6), "upperarm.R": (-8, 0, 6), "forearm.L": (-18, 0, 0), "forearm.R": (-18, 0, 0),
              "thigh.L": (-3, 0, -5), "thigh.R": (3, 0, 5), "shin.L": (8, 0, 0), "shin.R": (6, 0, 0), "chest": (6, 0, 0), "head": (-6, 0, 0),
              "loc": (0, 0, -0.03)}
    A = {"idle": idle_keys(stance, n=100, amt=1.4), "walk": walk_keys(stance, n=42, swing=18, knee=30, arm_swing=10, bob=0.05, sway=6)}
    raise_ = merge(stance, {"upperarm.L": (-170, 0, 10), "upperarm.R": (-170, 0, -10), "forearm.L": (-30, 0, 0), "forearm.R": (-30, 0, 0),
                            "chest": (-14, 0, 0), "spine": (-8, 0, 0), "head": (-10, 0, 0), "loc": (0, 0.06, 0.04)})
    slam = merge(stance, {"upperarm.L": (-70, 0, 6), "upperarm.R": (-70, 0, -6), "forearm.L": (-10, 0, 0), "forearm.R": (-10, 0, 0),
                          "chest": (24, 0, 0), "spine": (16, 0, 0), "head": (-14, 0, 0), "thigh.L": (-30, 0, -6), "thigh.R": (-30, 0, 6),
                          "shin.L": (40, 0, 0), "shin.R": (40, 0, 0), "loc": (0, -0.2, -0.16)})
    A["attack"] = [(0, stance), (18, raise_), (30, add(raise_, {"chest": (-4, 0, 0)})), (37, slam), (52, slam), (72, stance)]
    A["hit"] = hit_keys(stance, k=0.6)
    A["death"] = death_keys(stance, n=44)
    vic = merge(stance, {"upperarm.L": (-150, 0, -30), "upperarm.R": (-150, 0, 30), "forearm.L": (-20, 0, 0), "forearm.R": (-20, 0, 0), "head": (-14, 0, 0)})
    A["victory"] = [(0, stance), (20, vic), (34, add(vic, {"chest": (-6, 0, 0)})), (48, vic), (70, stance)]
    crouch = merge(stance, {"upperarm.R": (24, 0, 22), "forearm.R": (-95, 0, 0), "upperarm.L": (-30, 0, -10), "forearm.L": (-60, 0, 0),
                            "chest": (14, 26, 0), "spine": (10, 10, 0), "thigh.L": (-34, 0, -6), "thigh.R": (-20, 0, 6),
                            "shin.L": (48, 0, 0), "shin.R": (40, 0, 0), "loc": (0, 0.05, -0.16)})
    upper = merge(stance, {"upperarm.R": (-160, 0, 8), "forearm.R": (-42, 0, 0), "upperarm.L": (-10, 0, -20), "forearm.L": (-40, 0, 0),
                           "chest": (-16, -28, 0), "spine": (-8, -12, 0), "thigh.L": (-28, 0, -6), "shin.L": (20, 0, 0),
                           "loc": (0, -0.18, 0.08)})
    A["attack2"] = [(0, stance), (14, crouch), (20, upper), (30, upper), (52, stance)]
    ev = {"attack": [37], "attack2": [20], "death": [35]}
    A["silly"], silly_v = silly(stance, J, stride=0.36, dip=0.27, arm_swing=26, foot=0.26)   # långa stenfötter
    return arm, mesh, A, ev, {"height": H, "walkSpeed": walk_speed(H, 18, 42), "sillySpeed": silly_v}


# ======================================================================= DROTTNING: trollkvinna

def coronet(H, c, r, n=10, h=0.03, arches=False, cross=False, name="crown"):
    out = [lathe(name + "band", [(r, c.z), (r * 1.04, c.z + 0.006 * H), (r * 1.04, c.z + h * 0.5 * H), (r * 1.0, c.z + h * 0.6 * H),
                                 (r * 0.96, c.z + h * 0.6 * H), (r * 0.96, c.z)], seg=48, material="Trim", center=(c.x, c.y, 0), sy=1.05,
                 cap_bottom=False, cap_top=False)]
    for i in range(n):
        a = 2 * math.pi * i / n
        px, py = c.x + math.cos(a) * r * 1.0, c.y + math.sin(a) * r * 1.05
        pt = prism(f"{name}pt{i}", [(-0.012 * H, 0), (0.012 * H, 0), (0.0, h * H)], 0.006 * H, material="Trim", axis="Y", bevel=0.0015 * H)
        transform(pt, rot=(0, 0, math.degrees(a) + 90))
        transform(pt, loc=(px, py, c.z + h * 0.45 * H))
        out.append(pt)
        out.append(ellipsoid(f"{name}orb{i}", (px, py, c.z + h * 1.45 * H), (0.006 * H,) * 3, material="Trim", seg=10, rings=6))
        if i % 2 == 0:
            out.append(ellipsoid(f"{name}gem{i}", (c.x + math.cos(a) * r * 1.05, c.y + math.sin(a) * r * 1.1, c.z + h * 0.3 * H),
                                 (0.006 * H, 0.006 * H, 0.008 * H), material="Gem", seg=10, rings=6))
    if arches:
        for ang in (0, 90):
            a = math.radians(ang)
            pts = []
            for i in range(13):
                t = math.pi * i / 12
                pts.append((c.x + math.cos(a) * r * math.cos(t), c.y + math.sin(a) * r * 1.05 * math.cos(t), c.z + h * 0.5 * H + math.sin(t) * 0.065 * H))
            out.append(tube(f"{name}arch{ang}", pts, 0.006 * H, material="Trim", seg=8))
        out.append(ellipsoid(f"{name}cap", (c.x, c.y, c.z + 0.03 * H), (r * 0.92, r * 0.95, 0.06 * H), material="Cloth"))
        top = c.z + h * 0.5 * H + 0.065 * H
        out.append(ellipsoid(f"{name}globus", (c.x, c.y, top + 0.012 * H), (0.014 * H,) * 3, material="Trim"))
    if cross:
        top = c.z + h * 0.5 * H + 0.065 * H + 0.025 * H
        out.append(box(f"{name}crossv", (c.x, c.y, top + 0.025 * H), (0.009 * H, 0.009 * H, 0.05 * H), material="Trim", bevel=0.002 * H))
        out.append(box(f"{name}crossh", (c.x, c.y, top + 0.032 * H), (0.032 * H, 0.009 * H, 0.009 * H), material="Trim", bevel=0.002 * H))
    return out


def build_queen():
    H = 1.9
    J = rig.joints(H, sw=0.118, hw=0.05)
    parts = []
    statue(J, H, parts, bulk=0.9, female=True, hands=("open", "fist"))
    hc = face_head(J, H)
    parts.append((fold_robe("gown", J["spine0"].z + 0.01 * H, 0.0, 0.07 * H, 0.17 * H, H, folds=15, amp=0.07, flare=1.8), "hips"))
    parts.append((torso_shell("bodice", J, H, width=0.86, depth=0.82, keel=0.008, z_bottom=J["spine0"].z - 0.02 * H), "chest"))
    parts.append((torus("girdle", J["spine0"] + V((0, 0, 0.012 * H)), 0.07 * H, 0.009 * H, sy=0.8, material="Trim"), "spine"))
    parts.append((tube("girdlechain", [J["spine0"] + V((0, -0.06 * H, 0.012 * H)), V((0, -0.1 * H, 0.38 * H)), V((0, -0.135 * H, 0.22 * H))],
                       0.006 * H, material="Trim", seg=8), "hips"))
    # Medicikrage: solfjäder bakom nacken
    col = lathe("collar", [(0.05 * H, J["neck0"].z - 0.02 * H), (0.08 * H, J["neck0"].z + 0.03 * H), (0.1 * H, J["neck0"].z + 0.09 * H),
                           (0.098 * H, J["neck0"].z + 0.1 * H)], seg=40, material="Trim", arc=(0.35, math.pi - 0.35),
                center=(0, 0.015 * H, 0), fold=(12, 0.08, J["neck0"].z, J["neck0"].z + 0.1 * H), cap_bottom=False, cap_top=False)
    add_solidify(col, 0.004 * H)
    parts.append((col, "chest"))
    parts.append((cape("cape", J, H, J["neck0"].z - 0.03 * H, 0.0, 0.09 * H, 0.24 * H, spread=1.3, folds=11, amp=0.07), "chest"))
    # puffärmar
    for s in ("L", "R"):
        sh, e, w = J[f"shoulder.{s}"], J[f"elbow.{s}"], J[f"wrist.{s}"]
        p = sleeve(f"puff.{s}", sh + V((0, 0, 0.03 * H)), mid(sh, e, 0.6),
                   [(0.03 * H, 0), (0.046 * H, 0.25), (0.05 * H, 0.55), (0.04 * H, 0.85), (0.03 * H, 1.0)], seg=28, fold=(10, 0.1, 0.0, 0.6))
        add_subsurf(p, 1)
        parts.append((p, f"upperarm.{s}"))
        parts.append((sleeve(f"qsleeve.{s}", mid(e, w, 0.4), w + V((0, 0, -0.012 * H)), [(0.03 * H, 0), (0.05 * H, 1.0), (0.047 * H, 1.0)],
                             seg=24, fold=(8, 0.14, 0.3, 1.0)), f"forearm.{s}"))
    # hår och diadem
    parts.append((ellipsoid("hair", hc + V((0, 0.012 * H, 0.012 * H)), (0.056 * H, 0.06 * H, 0.072 * H)), "head"))
    parts.append((ellipsoid("bun", hc + V((0, 0.05 * H, -0.01 * H)), (0.034 * H, 0.028 * H, 0.032 * H)), "head"))
    braid = tube("braid", [hc + V((0, 0.06 * H, -0.03 * H)), hc + V((0, 0.07 * H, -0.09 * H)), J["chest0"] + V((0, 0.085 * H, 0.06 * H)),
                           J["chest0"] + V((0, 0.08 * H, -0.02 * H))], [0.02 * H, 0.018 * H, 0.016 * H, 0.008 * H], material="Stone", seg=10)
    parts.append((braid, "head"))
    for o in coronet(H, hc + V((0, 0, 0.042 * H)), 0.054 * H, n=10, h=0.035, name="coronet"):
        parts.append((o, "head"))
    # spira med lysande klot
    g = J["grip.R"]
    sc = [tube("sceptre", [(g.x, g.y, g.z - 0.12 * H), (g.x, g.y, g.z + 0.3 * H)], [0.01 * H, 0.009 * H], material="Trim", seg=10),
          ellipsoid("sceptrecup", (g.x, g.y, g.z + 0.31 * H), (0.022 * H, 0.022 * H, 0.014 * H), material="Trim"),
          ellipsoid("sceptreorb", (g.x, g.y, g.z + 0.345 * H), (0.03 * H,) * 3, material="Gem"),
          ellipsoid("sceptreend", (g.x, g.y, g.z - 0.125 * H), (0.014 * H,) * 3, material="Trim")]
    for i in range(4):
        a = math.pi / 2 * i
        pts = [(g.x + math.cos(a) * 0.033 * H * math.sin(t), g.y + math.sin(a) * 0.033 * H * math.sin(t), g.z + 0.315 * H + 0.06 * H * (t / math.pi))
               for t in [math.pi * j / 8 for j in range(9)]]
        sc.append(tube(f"cage{i}", pts, 0.004 * H, material="Trim", seg=6))
    for o in sc:
        parts.append((o, "prop.R"))
    arm, mesh = finish("queen", J, H, parts)

    stance = {"upperarm.R": (-12, 0, 8), "forearm.R": (-55, 0, 0), "upperarm.L": (-8, 0, -8), "forearm.L": (-40, -30, 0),
              "head": (2, 0, 0), "thigh.L": (-3, 0, 0), "thigh.R": (3, 0, 0)}
    stance = aim(stance, "R", 10)
    A = {"idle": idle_keys(stance, amt=0.8), "walk": walk_keys(stance, n=32, robe=True, lock_arms=("upperarm.R",), arm_swing=8, bob=0.012)}
    gather = aim(merge(stance, {"upperarm.R": (-140, 0, 30), "forearm.R": (-40, 0, 0), "upperarm.L": (-80, 0, -30), "forearm.L": (-60, 0, 0),
                                "chest": (-10, -18, 0), "head": (-10, 0, 0), "loc": (0, 0.05, 0.02)}), "R", -10)
    cast = aim(merge(stance, {"upperarm.R": (-88, 0, -4), "forearm.R": (-4, 0, 0), "upperarm.L": (-30, 0, -40), "forearm.L": (-30, 0, 0),
                              "chest": (10, 16, 0), "spine": (4, 8, 0), "head": (4, -8, 0), "loc": (0, -0.12, -0.02)}), "R", 92)
    A["attack"] = [(0, stance), (16, gather), (30, add(gather, {"chest": (-4, -4, 0)})), (36, cast), (52, cast), (68, stance)]
    A["hit"] = hit_keys(stance)
    A["death"] = death_keys(stance)
    vic = aim(merge(stance, {"upperarm.R": (-160, 0, 10), "forearm.R": (-10, 0, 0), "upperarm.L": (-40, 0, -50), "head": (-12, 0, 0)}), "R", 0)
    A["victory"] = [(0, stance), (18, vic), (40, vic), (60, stance)]
    fgather = aim(merge(stance, {"upperarm.R": (-55, 0, 32), "forearm.R": (-105, 0, 0), "upperarm.L": (-55, 0, -32), "forearm.L": (-105, 0, 0),
                                 "chest": (-8, 0, 0), "head": (6, 0, 0), "loc": (0, 0.04, 0)}), "R", 30)
    fcast = aim(merge(stance, {"upperarm.R": (-86, 0, 8), "forearm.R": (-4, 0, 0), "upperarm.L": (-86, 0, -8), "forearm.L": (-4, 0, 0),
                               "chest": (12, 0, 0), "spine": (5, 0, 0), "head": (-4, 0, 0), "loc": (0, -0.12, -0.03)}), "R", 92)
    A["attack2"] = [(0, stance), (14, fgather), (24, add(fgather, {"chest": (-4, 0, 0)})), (30, fcast), (52, fcast), (66, stance)]
    ev = {"attack": [36], "attack2": [30], "death": [35]}
    # som löparen: benen sparkar ut genom klänningen; golvlång mantel (styv på chest) svänger fram om bålen lutar mycket
    A["silly"], silly_v = silly(stance, J, stride=0.4, dip=0.18, lean=0.35)
    return arm, mesh, A, ev, {"height": H, "walkSpeed": walk_speed(H, 24, 32, robe=True), "sillySpeed": silly_v}


# ======================================================================= KUNG

def build_king():
    H = 1.95
    J = rig.joints(H, sw=0.138, hw=0.06)
    parts = []
    statue(J, H, parts, bulk=1.05)
    hc = face_head(J, H)
    # skägg och mustasch
    chin = hc + V((0, -0.035 * H, -0.045 * H))
    beard = lathe("beard", [(0.0, -0.12 * H), (0.02 * H, -0.11 * H), (0.038 * H, -0.075 * H), (0.048 * H, -0.03 * H), (0.05 * H, 0.0),
                            (0.045 * H, 0.03 * H), (0.0, 0.035 * H)], seg=32, sy=0.62, center=(chin.x, chin.y, chin.z),
                  fold=(10, 0.12, 0.03 * H + chin.z, -0.12 * H + chin.z))
    add_subsurf(beard, 1)
    parts.append((beard, "head"))
    for k in (1, -1):
        parts.append((tube(f"stache{k}", [hc + V((0, -0.058 * H, -0.022 * H)), hc + V((k * 0.02 * H, -0.056 * H, -0.028 * H)),
                                          hc + V((k * 0.036 * H, -0.048 * H, -0.04 * H))], [0.007 * H, 0.008 * H, 0.004 * H], material="Stone", seg=8), "head"))
    parts.append((ellipsoid("kinghair", hc + V((0, 0.014 * H, 0.008 * H)), (0.054 * H, 0.056 * H, 0.068 * H)), "head"))
    for o in coronet(H, hc + V((0, 0, 0.04 * H)), 0.056 * H, n=8, h=0.04, arches=True, cross=True, name="crown"):
        parts.append((o, "head"))
    # tunika till knäna, bälte, hermelinkantad mantel
    parts.append((torso_shell("tunictop", J, H, width=1.1, depth=0.78, keel=0.006, fold=(8, 0.025, J["neck0"].z, J["spine0"].z)), "chest"))
    parts.append((fold_robe("tunic", J["spine0"].z + 0.01 * H, 0.27 * H, 0.085 * H, 0.12 * H, H, folds=12, amp=0.06, flare=1.2), "hips"))
    parts.append((torus("kbelt", J["spine0"], 0.084 * H, 0.013 * H, sy=0.8, material="Trim"), "spine"))
    parts.append((ellipsoid("kbuckle", J["spine0"] + V((0, -0.068 * H, 0)), (0.024 * H, 0.01 * H, 0.02 * H), material="Gem"), "spine"))
    parts.append((cape("kcape", J, H, J["neck0"].z - 0.02 * H, 0.01 * H, 0.11 * H, 0.26 * H, spread=1.45, folds=10, amp=0.08), "chest"))
    ermine = torus("ermine", J["neck0"] - V((0, -0.008 * H, 0.03 * H)), 0.09 * H, 0.03 * H, material="Stone", seg=36, rseg=12, sy=0.8)
    add_subsurf(ermine, 1)
    parts.append((ermine, "chest"))
    for i in range(10):
        a = math.pi * 0.15 + math.pi * 0.7 * i / 9
        parts.append((ellipsoid(f"ermspot{i}", (math.cos(a) * 0.09 * H, math.sin(a) * 0.072 * H + 0.008 * H, J["neck0"].z - 0.03 * H + 0.027 * H),
                                (0.006 * H, 0.006 * H, 0.008 * H), material="Dark", seg=8, rings=6), "chest"))
    for s in ("L", "R"):
        parts += pauldron(f"kpaul.{s}", J, H, s, layers=2, size=1.0)
    greaves(J, H, parts, material="Trim", knee="Trim")
    vambraces(J, H, parts, material="Trim")
    sabatons(J, H, parts, material="Trim")
    for o in sword(H, J["grip.R"], length=0.58, width=0.058, guard=0.16, name="greatsword"):
        parts.append((o, "prop.R"))
    # riksäpple i vänster hand
    gl = J["grip.L"]
    parts.append((ellipsoid("orb", gl + V((0, -0.02 * H, 0.0)), (0.032 * H,) * 3, material="Trim"), "hand.L"))
    parts.append((box("orbcross", gl + V((0, -0.02 * H, 0.045 * H)), (0.008 * H, 0.008 * H, 0.03 * H), material="Trim"), "hand.L"))
    arm, mesh = finish("king", J, H, parts)

    stance = {"upperarm.R": (-10, 0, 10), "forearm.R": (-45, 0, 0), "upperarm.L": (-12, 0, -8), "forearm.L": (-70, 0, 0),
              "chest": (-3, 0, 0), "head": (-3, 0, 0), "thigh.L": (-5, 0, -4), "thigh.R": (4, 0, 4)}
    stance = aim(stance, "R", 20)
    A = {"idle": idle_keys(stance, amt=0.9), "walk": walk_keys(stance, n=32, lock_arms=("upperarm.R", "upperarm.L"), swing=20, bob=0.02)}
    wind = aim(merge(stance, {"upperarm.R": (-140, 0, 50), "forearm.R": (-60, 0, 0), "chest": (-6, -30, 0), "spine": (-4, -14, 0),
                              "thigh.L": (-20, 0, -4), "shin.L": (16, 0, 0), "loc": (0, 0.04, -0.03)}), "R", -60, yaw=30)
    slash = aim(merge(stance, {"upperarm.R": (-70, 0, -30), "forearm.R": (-8, 0, 0), "chest": (12, 30, 0), "spine": (8, 14, 0),
                               "thigh.L": (-40, 0, -4), "shin.L": (36, 0, 0), "thigh.R": (18, 0, 4), "loc": (0, -0.22, -0.07)}), "R", 130, yaw=-30)
    A["attack"] = [(0, stance), (16, wind), (28, add(wind, {"chest": (-4, -4, 0)})), (34, slash), (46, slash), (66, stance)]
    A["hit"] = hit_keys(stance)
    A["death"] = death_keys(stance)
    vic = aim(merge(stance, {"upperarm.R": (-165, 0, 6), "forearm.R": (-5, 0, 0), "upperarm.L": (-60, 0, -20), "head": (-14, 0, 0)}), "R", 0)
    A["victory"] = [(0, stance), (18, vic), (40, vic), (64, stance)]
    decree = aim(merge(stance, {"upperarm.R": (-96, 0, -4), "forearm.R": (-4, 0, 0), "chest": (4, 6, 0), "head": (-4, 0, 0),
                                "upperarm.L": (-30, 0, -24), "loc": (0, -0.06, 0)}), "R", 92)
    A["attack2"] = [(0, stance), (16, vic), (26, add(vic, {"chest": (-5, 0, 0)})), (32, decree), (50, decree), (66, stance)]
    ev = {"attack": [34], "attack2": [32], "death": [35]}
    A["silly"], silly_v = silly(stance, J, stride=0.45, dip=0.26, lean=0.35)   # golvlång mantel: luta mindre
    return arm, mesh, A, ev, {"height": H, "walkSpeed": walk_speed(H, 20, 32), "sillySpeed": silly_v}


BUILDERS = {"pawn": build_pawn, "knight": build_knight, "bishop": build_bishop, "rook": build_rook,
            "queen": build_queen, "king": build_king}


def preview(arm, acts, name, outdir):
    lib.preview_setup(target=(0, 0, 0.95), dist=5.2, elev=10, azim=-35)
    shots = [("rest", None, None), ("idle", "idle", 0)]
    for a in ("walk", "attack", "attack2", "death", "victory"):
        keys = acts[a]
        if a in ("attack", "attack2"):
            fr = [k[0] for k in keys]
            shots.append((f"{a}_wind", a, fr[2]))
            shots.append((f"{a}_hit", a, fr[3]))
        elif a == "walk":
            shots.append((a, a, keys[2][0]))
        else:
            shots.append((a, a, keys[len(keys) // 2][0]))
    files = []
    for (label, act, frame) in shots:
        rig.apply_pose(arm, dict(acts[act])[frame] if act else {})
        bpy.context.view_layer.update()
        p = os.path.join(outdir, f"{name}_{label}.png")
        lib.render(p)
        files.append(p)
    if "silly" in acts:
        # dumma gången från sidan: vänster spark, uppgången, höger spark
        n = acts["silly"][-1][0]
        for label, frame, az in (("silly_kickL", round(SW_KICK * n), -80), ("silly_up", round(n / 18), -80),
                                 ("silly_kickR", round((SW_KICK + 0.5) * n), -80), ("silly_kick34", round(SW_KICK * n), -35)):
            lib.set_cam((0, 0, 0.95), 5.2, 10, az)
            rig.apply_pose(arm, dict(acts["silly"])[frame])
            bpy.context.view_layer.update()
            p = os.path.join(outdir, f"{name}_{label}.png")
            lib.render(p)
            files.append(p)
        lib.set_cam((0, 0, 0.95), 5.2, 10, -35)
    rig.apply_pose(arm, {})
    return files


def hero(name, outdir):
    """Närbilder i HDRI-ljus med bakad AO på stenen — för att bedöma detaljer, inte rörelser."""
    hdri = os.path.join(ROOT, "assets", "src", "hdri", "qwantani_late_afternoon_puresky_2k.hdr")
    lib.preview_setup(target=(0, 0, 1.0), dist=2.4, elev=6, azim=-28, lens=70, res=(1000, 1250), hdri=hdri)
    sc = bpy.context.scene
    sun = bpy.data.objects.new("HSun", bpy.data.lights.new("HSun", "SUN"))
    sun.data.energy = 3.5
    sun.data.angle = math.radians(2)
    sun.rotation_euler = (math.radians(62), 0, math.radians(-50))
    lib.link(sun)
    sc.eevee.use_shadows = True
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        nt = m.node_tree
        b = nt.nodes.get("Principled BSDF")
        if not b:
            continue
        at = nt.nodes.new("ShaderNodeVertexColor")
        at.layer_name = "Col"
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 0.85
        col = b.inputs["Base Color"].default_value[:]
        mul.inputs[6].default_value = col
        nt.links.new(at.outputs["Color"], sep.inputs["Color"])
        comb = nt.nodes.new("ShaderNodeCombineColor")
        for ch in ("Red", "Green", "Blue"):
            nt.links.new(sep.outputs["Red"], comb.inputs[ch])
        nt.links.new(comb.outputs["Color"], mul.inputs[7])
        nt.links.new(mul.outputs[2], b.inputs["Base Color"])
    H = BUILDERS_META.get(name, 1.8)
    shots = [("hero_full", (0, 0, H * 0.52), H * 1.55, 6, -28), ("hero_bust", (0, 0, H * 0.8), H * 0.55, 4, -24),
             ("hero_back", (0, 0, H * 0.6), H * 1.1, 10, 150)]
    for label, tgt, dist, el, az in shots:
        lib.set_cam(tgt, dist, el, az)
        lib.render(os.path.join(outdir, f"{name}_{label}.png"))


BUILDERS_META = {"pawn": 1.6, "knight": 1.85, "bishop": 1.85, "rook": 2.3, "queen": 1.9, "king": 1.95}


def main():
    only = arg("--only")
    names = only.split(",") if only else list(BUILDERS)
    prev = arg("--preview")
    meta_path = os.path.join(OUT, "pieces.json")
    allmeta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    os.makedirs(OUT, exist_ok=True)
    for name in names:
        lib.reset()
        arm, mesh, acts, events, meta = BUILDERS[name]()
        tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
        print(f"[{name}] tris={tris}")
        if prev:
            os.makedirs(prev, exist_ok=True)
            preview(arm, acts, name, prev)
        if arg("--hero"):
            os.makedirs(arg("--hero"), exist_ok=True)
            rig.apply_pose(arm, dict(acts["idle"])[0])
            bpy.context.view_layer.update()
            hero(name, arg("--hero"))
            rig.apply_pose(arm, {})
        for aname, keys in acts.items():
            rig.make_action(arm, aname, keys)
        allmeta[name] = {"height": meta["height"], "walkSpeed": meta["walkSpeed"], "sillySpeed": meta["sillySpeed"], "tris": tris,
                         "events": {k: [f / FPS for f in v] for k, v in events.items()},
                         "durations": {a: k[-1][0] / FPS for a, k in acts.items()}}
        if not arg("--no-export"):
            os.makedirs(RAW, exist_ok=True)
            rig.export_glb(os.path.join(RAW, f"{name}.glb"), [arm, mesh])
    with open(meta_path, "w") as f:
        json.dump(allmeta, f, indent=1)


if __name__ == "__main__":   # extras.py importerar bake_vertex_ao härifrån
    main()
