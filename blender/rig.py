"""Skelett, styv bindning, keyframe-animation och glTF-export.

Benkonventioner (roll 0, figuren tittar mot -Y):
  lodräta ben uppåt (hips/spine/chest/neck/head):
      +X = böj framåt, +Y = vrid åt vänster, +Z = luta åt höger
  hängande ben (armar, lår, smalben):
      +X = sving bakåt, -X = sving framåt/lyft framåt
      utåt (abduktion): vänster = -Z, höger = +Z
      armbåge böjs med -X, knä med +X
Positioner (loc) anges i världsled (x, y, z) och räknas om till hips lokala led.
"""
import bpy
import math
import json
from mathutils import Vector
from lib import link

FPS = 30

BONES = [
    # namn, parent, huvud-nyckel, svans-nyckel
    ("root", None, "origin", "rootTip"),
    ("hips", "root", "pelvis", "spine0"),
    ("spine", "hips", "spine0", "chest0"),
    ("chest", "spine", "chest0", "neck0"),
    ("neck", "chest", "neck0", "head0"),
    ("head", "neck", "head0", "headTop"),
]
for s in ("L", "R"):
    BONES += [
        (f"shoulder.{s}", "chest", f"clav0.{s}", f"shoulder.{s}"),
        (f"upperarm.{s}", f"shoulder.{s}", f"shoulder.{s}", f"elbow.{s}"),
        (f"forearm.{s}", f"upperarm.{s}", f"elbow.{s}", f"wrist.{s}"),
        (f"hand.{s}", f"forearm.{s}", f"wrist.{s}", f"handEnd.{s}"),
        (f"thigh.{s}", "hips", f"hip.{s}", f"knee.{s}"),
        (f"shin.{s}", f"thigh.{s}", f"knee.{s}", f"ankle.{s}"),
        (f"foot.{s}", f"shin.{s}", f"ankle.{s}", f"toe.{s}"),
        (f"prop.{s}", f"hand.{s}", f"grip.{s}", f"gripTip.{s}"),
    ]
BONE_NAMES = [b[0] for b in BONES]


def joints(H, sw=0.13, hw=0.06, chest_z=0.70, pelvis_z=0.53):
    """Ledpositioner för en figur med höjden H. sw/hw = axel-/höftbredd (andel av H)."""
    J = {
        "origin": (0, 0, 0),
        "rootTip": (0, 0, 0.08 * H),
        "pelvis": (0, 0, pelvis_z * H),
        "spine0": (0, 0, (pelvis_z + 0.07) * H),
        "chest0": (0, 0, chest_z * H),
        "neck0": (0, 0, 0.83 * H),
        "head0": (0, 0, 0.875 * H),
        "headTop": (0, 0, 1.0 * H),
    }
    for s, k in (("L", 1), ("R", -1)):
        J[f"clav0.{s}"] = (k * 0.03 * H, 0.0, 0.808 * H)
        J[f"shoulder.{s}"] = (k * sw * H, 0.0, 0.815 * H)
        J[f"elbow.{s}"] = (k * (sw + 0.012) * H, 0.006 * H, 0.635 * H)
        J[f"wrist.{s}"] = (k * (sw + 0.02) * H, -0.004 * H, 0.47 * H)
        J[f"handEnd.{s}"] = (k * (sw + 0.022) * H, -0.008 * H, 0.405 * H)
        J[f"grip.{s}"] = (k * (sw + 0.021) * H, -0.006 * H, 0.434 * H)
        J[f"gripTip.{s}"] = (k * (sw + 0.021) * H, -0.006 * H, 0.52 * H)
        J[f"hip.{s}"] = (k * hw * H, 0.0, (pelvis_z - 0.02) * H)
        J[f"knee.{s}"] = (k * hw * H, -0.006 * H, 0.28 * H)
        J[f"ankle.{s}"] = (k * hw * H, 0.008 * H, 0.055 * H)
        J[f"toe.{s}"] = (k * hw * H, -0.075 * H, 0.012 * H)
    return {k: Vector(v) for k, v in J.items()}


def build_armature(name, J):
    arm_data = bpy.data.armatures.new(name + "_rig")
    arm = bpy.data.objects.new(name + "_rig", arm_data)
    link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for (bn, parent, h, t) in BONES:
        eb = arm_data.edit_bones.new(bn)
        eb.head = J[h]
        eb.tail = J[t]
        eb.roll = 0.0
        if parent:
            eb.parent = arm_data.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
    return arm


def bind(part, bone):
    """Styv bindning: alla vertexar i delen följer ett ben."""
    vg = part.vertex_groups.new(name=bone)
    vg.add(list(range(len(part.data.vertices))), 1.0, "REPLACE")
    return part


def skin(mesh_obj, arm):
    mesh_obj.parent = arm
    m = mesh_obj.modifiers.new("Armature", "ARMATURE")
    m.object = arm
    # glTF-exportören vill att alla ben finns som grupper
    for bn in BONE_NAMES:
        if bn not in mesh_obj.vertex_groups:
            mesh_obj.vertex_groups.new(name=bn)


# ---------------------------------------------------------------- poser

def merge(*poses):
    """Senare poser skriver över tidigare (per ben)."""
    out = {}
    for p in poses:
        out.update(p)
    return out


def add(base, delta):
    """Lägg ihop rotationer per ben (för lager som andning ovanpå en hållning)."""
    out = dict(base)
    for k, v in delta.items():
        b = out.get(k, (0, 0, 0))
        out[k] = tuple(b[i] + v[i] for i in range(3))
    return out


def mirror_pose(p):
    """Spegla en pose vänster<->höger (Y- och Z-rotation byter tecken)."""
    out = {}
    for k, v in p.items():
        if k == "loc":
            out[k] = (-v[0], v[1], v[2])
            continue
        nk = k.replace(".L", ".TMP").replace(".R", ".L").replace(".TMP", ".R")
        out[nk] = (v[0], -v[1], -v[2])
    return out


def aim(pose, side, tilt, yaw=0.0, roll=0.0):
    """Rikta vapnet i handen (prop-benet) mot en världsvinkel i sagittalplanet.

    tilt 0 = rakt upp, 90 = rakt fram, 180 = rakt ned, -90 = rakt bak.
    Kompenserar för armkedjans X-rotationer (gäller exakt när armen rör sig framåt/bakåt).
    """
    s = sum(pose.get(f"{b}.{side}", (0, 0, 0))[0] for b in ("upperarm", "forearm", "hand"))
    out = dict(pose)
    out[f"prop.{side}"] = (tilt - s, yaw, roll)
    return out


def apply_pose(arm, pose):
    for pb in arm.pose.bones:
        r = pose.get(pb.name, (0, 0, 0))
        pb.rotation_euler = tuple(math.radians(a) for a in r)
        pb.location = (0, 0, 0)
    lx, ly, lz = pose.get("loc", (0, 0, 0))
    arm.pose.bones["hips"].location = (lx, lz, -ly)  # världsled -> hips lokala led
    rx, ry, rz = pose.get("rootloc", (0, 0, 0))
    arm.pose.bones["root"].location = (rx, rz, -ry)


def key_pose(arm, frame, pose):
    apply_pose(arm, pose)
    for pb in arm.pose.bones:
        pb.keyframe_insert("rotation_euler", frame=frame)
        if pb.name in ("hips", "root"):
            pb.keyframe_insert("location", frame=frame)


def make_action(arm, name, keys):
    """keys = [(frame, pose), ...]. Lägger handlingen som NLA-spår (glTF-animation)."""
    ad = arm.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ad.action = act
    for f, pose in keys:
        key_pose(arm, f, pose)
    ad.action = None
    track = ad.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, int(keys[0][0]), act)
    strip.name = name
    track.mute = False
    apply_pose(arm, {})
    return act


def export_glb(path, objs, animations=True):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.context.scene.render.fps = FPS
    bpy.ops.export_scene.gltf(
        filepath=path,
        use_selection=True,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_animations=animations,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_skins=True,
        export_all_influences=False,
        export_def_bones=False,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=True,
        export_extras=True,
        export_vertex_color="ACTIVE",
    )


def write_events(path, events):
    with open(path, "w") as f:
        json.dump(events, f, indent=1)
