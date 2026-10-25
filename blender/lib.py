"""Modelleringshjälp för Battlechess (Blender 5.2, körs headless).

Konventioner: meter, Z upp, figurerna tittar mot -Y (Blenders framvy).
glTF-exporten gör om till Y upp och +Z framåt i three.js.
Figurens vänstra sida = +X (".L"), högra = -X (".R").
"""
import bpy
import bmesh
import math
from mathutils import Vector, Matrix, Euler

TAU = math.tau


# ---------------------------------------------------------------- scen

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in (bpy.data.meshes, bpy.data.materials, bpy.data.objects, bpy.data.armatures, bpy.data.actions):
        for item in list(c):
            c.remove(item)


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


# ---------------------------------------------------------------- material

MAT_COLORS = {
    # Förhandsfärger för Blender-renderingar; spelet byter ut materialen efter namn.
    "Stone": ((0.85, 0.84, 0.81, 1), 0.0, 0.25),
    "Trim": ((0.95, 0.72, 0.32, 1), 1.0, 0.28),
    "Cloth": ((0.12, 0.22, 0.55, 1), 0.0, 0.85),
    "Steel": ((0.8, 0.8, 0.82, 1), 1.0, 0.18),
    "Wood": ((0.25, 0.14, 0.07, 1), 0.0, 0.6),
    "Gem": ((0.3, 0.6, 1.0, 1), 0.0, 0.1),
    "Dark": ((0.02, 0.02, 0.02, 1), 0.0, 0.9),
    "BoardWhite": ((0.85, 0.84, 0.81, 1), 0.0, 0.15),
    "BoardBlack": ((0.04, 0.04, 0.045, 1), 0.0, 0.12),
    "Plinth": ((0.45, 0.4, 0.35, 1), 0.0, 0.7),
    "Wall": ((0.5, 0.48, 0.45, 1), 0.0, 0.85),
    "Ground": ((0.3, 0.32, 0.18, 1), 0.0, 0.95),
    "Rock": ((0.4, 0.4, 0.37, 1), 0.0, 0.9),
}


def mat(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    col, metal, rough = MAT_COLORS.get(name, ((0.8, 0.8, 0.8, 1), 0.0, 0.5))
    m.diffuse_color = col
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = col
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if name == "Gem":
        b.inputs["Emission Color"].default_value = col
        b.inputs["Emission Strength"].default_value = 3.0
    return m


# ---------------------------------------------------------------- mesh-primitiver

def _obj_from_bm(name, bm, material=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob)
    if material:
        me.materials.append(mat(material))
    return ob


def lathe(name, profile, seg=32, material="Stone", sx=1.0, sy=1.0, cap_bottom=True, cap_top=True,
          center=(0, 0, 0), phase=0.0, fold=None, arc=None):
    """Rotationskropp. profile = [(radie, z), ...] nerifrån och upp. sx/sy ger ellips.

    fold = (antal, amplitud, z_start, z_slut): veck vars djup växer från z_start till z_slut
           (draperade kläder; vecken får lite oregelbundenhet så de inte ser stansade ut).
    arc  = (a0, a1) i radianer: öppen yta i stället för hel rotation (mantlar).
    """
    bm = bmesh.new()
    rings = []
    closed = arc is None
    n_a = seg if closed else seg + 1
    for (r, z) in profile:
        ring = []
        for i in range(n_a):
            if closed:
                a = TAU * i / seg + phase
            else:
                a = arc[0] + (arc[1] - arc[0]) * i / seg
            rr = r
            if fold:
                n, amp, z0, z1 = fold
                t = min(1.0, max(0.0, (z - z0) / (z1 - z0)))
                wob = 0.35 * math.sin(a * 3.0 + 1.7) + 0.2 * math.sin(a * 7.0 + 0.4)
                rr = r * (1.0 + amp * (t ** 1.4) * (math.sin(n * a + wob) * 0.8 + 0.2 * math.sin(2 * n * a + 1.1)))
            ring.append(bm.verts.new((center[0] + math.cos(a) * rr * sx, center[1] + math.sin(a) * rr * sy, center[2] + z)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        for i in range(seg if closed else n_a - 1):
            j = (i + 1) % n_a
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if closed and cap_bottom and profile[0][0] > 1e-5:
        bm.faces.new(list(reversed(rings[0])))
    if closed and cap_top and profile[-1][0] > 1e-5:
        bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj_from_bm(name, bm, material)


def ellipsoid(name, center, radii, material="Stone", seg=24, rings=14):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    bmesh.ops.scale(bm, vec=radii, verts=bm.verts)
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    return _obj_from_bm(name, bm, material)


def box(name, center, size, material="Stone", bevel=0.0, segments=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    ob = _obj_from_bm(name, bm, material)
    if bevel > 0:
        add_bevel(ob, bevel, segments)
    return ob


def torus(name, center, R, r, material="Trim", seg=32, rseg=10, sx=1.0, sy=1.0):
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = TAU * i / seg
        ring = []
        for k in range(rseg):
            b = TAU * k / rseg
            rr = R + math.cos(b) * r
            ring.append(bm.verts.new((center[0] + math.cos(a) * rr * sx, center[1] + math.sin(a) * rr * sy,
                                      center[2] + math.sin(b) * r)))
        rings.append(ring)
    for i in range(seg):
        a, b2 = rings[i], rings[(i + 1) % seg]
        for k in range(rseg):
            l = (k + 1) % rseg
            bm.faces.new((a[k], b2[k], b2[l], a[l]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj_from_bm(name, bm, material)


def tube(name, points, radii, material="Trim", seg=12, cap=True):
    """Rör längs en polylinje med radie per punkt (paralleltransporterade ramar)."""
    pts = [Vector(p) for p in points]
    if isinstance(radii, (int, float)):
        radii = [radii] * len(pts)
    bm = bmesh.new()
    rings = []
    t_prev = (pts[1] - pts[0]).normalized()
    ref = Vector((0, 0, 1)) if abs(t_prev.z) < 0.9 else Vector((1, 0, 0))
    n = t_prev.cross(ref).normalized()
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = (pts[i + 1] - pts[i - 1]).normalized()
        # parallelltransport av normalen
        n = (n - t * n.dot(t)).normalized()
        b = t.cross(n)
        ring = []
        for k in range(seg):
            a = TAU * k / seg
            ring.append(bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * radii[i]))
        rings.append(ring)
    for i in range(len(rings) - 1):
        a, c = rings[i], rings[i + 1]
        for k in range(seg):
            l = (k + 1) % seg
            bm.faces.new((a[k], a[l], c[l], c[k]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj_from_bm(name, bm, material)


def limb(name, a, b, ra, rb, material="Stone", seg=16):
    """Avsmalnande kapsel mellan punkterna a och b."""
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    prof = []
    n = 5
    for i in range(n + 1):  # nedre halvklot
        t = -math.pi / 2 + (math.pi / 2) * i / n
        prof.append((ra * math.cos(t), ra * math.sin(t)))
    for i in range(1, n + 1):  # övre halvklot
        t = (math.pi / 2) * i / n
        prof.append((rb * math.cos(t), L + rb * math.sin(t)))
    prof[0] = (0.0, prof[0][1])
    prof[-1] = (0.0, prof[-1][1])
    ob = lathe(name, prof, seg=seg, material=material, cap_bottom=False, cap_top=False)
    orient(ob, a, b)
    return ob


def orient(ob, a, b):
    """Rikta ett objekt byggt längs +Z från origo så att det går från a till b."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    q = Vector((0, 0, 1)).rotation_difference(d)
    ob.data.transform(Matrix.Translation(a) @ q.to_matrix().to_4x4())


def prism(name, outline, thickness, material="Steel", axis="Y", center=(0, 0, 0), bevel=0.0, segments=2,
          taper=None):
    """Extruderad 2D-kontur. outline = [(u, v), ...] i planet vinkelrätt mot axis.

    axis='Y': u->X, v->Z, extruderas längs Y (platta som vetter framåt, t.ex. sköld).
    axis='X': u->Y, v->Z, extruderas längs X (t.ex. svärdsblad sett från sidan).
    axis='Z': u->X, v->Y, extruderas längs Z (liggande platta).
    taper: valfri funktion (u, v) -> skalfaktor för tjockleken (t.ex. eggslipning).
    """
    bm = bmesh.new()
    h = thickness / 2

    def P(u, v, w):
        if axis == "Y":
            return (center[0] + u, center[1] + w, center[2] + v)
        if axis == "X":
            return (center[0] + w, center[1] + u, center[2] + v)
        return (center[0] + u, center[1] + v, center[2] + w)

    front, back = [], []
    for (u, v) in outline:
        s = taper(u, v) if taper else 1.0
        front.append(bm.verts.new(P(u, v, -h * s)))
        back.append(bm.verts.new(P(u, v, h * s)))
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[j], front[i], back[i], back[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj_from_bm(name, bm, material)
    if bevel > 0:
        add_bevel(ob, bevel, segments)
    return ob


def blade(name, base, length, width, thick, material="Steel", direction=(0, 0, 1), flat_normal=(1, 0, 0),
          tip=0.18, fuller=True):
    """Svärdsblad med diamantformat tvärsnitt, från base längs direction."""
    d = Vector(direction).normalized()
    fn = Vector(flat_normal)
    fn = (fn - d * fn.dot(d)).normalized()  # bladets tjockleksriktning
    w = d.cross(fn).normalized()  # bredden
    base = Vector(base)
    bm = bmesh.new()
    sections = []
    steps = 10
    for i in range(steps + 1):
        t = i / steps
        L = t * length
        if t < 1 - tip:
            ww = width * (1 - 0.18 * t / (1 - tip))
        else:
            ww = width * 0.82 * max(0.0, 1 - (t - (1 - tip)) / tip) ** 0.9
        tt = thick * (ww / width) ** 0.7 * (0.6 if (fuller and 0.08 < t < 0.7) else 1.0)
        c = base + d * L
        ring = [c + w * ww / 2, c + fn * tt / 2, c - w * ww / 2, c - fn * tt / 2]
        sections.append([bm.verts.new(p) for p in ring])
    for i in range(steps):
        a, b = sections[i], sections[i + 1]
        for k in range(4):
            l = (k + 1) % 4
            bm.faces.new((a[k], a[l], b[l], b[k]))
    bm.faces.new(list(reversed(sections[0])))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj_from_bm(name, bm, material)


# ---------------------------------------------------------------- modifierare

def add_bevel(ob, width, segments=2, angle=0.6):
    m = ob.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = angle
    m.harden_normals = False
    return m


def add_subsurf(ob, levels=1):
    m = ob.modifiers.new("Sub", "SUBSURF")
    m.levels = levels
    m.render_levels = levels
    return m


def add_solidify(ob, thickness, offset=0.0):
    m = ob.modifiers.new("Solid", "SOLIDIFY")
    m.thickness = thickness
    m.offset = offset
    m.use_even_offset = True
    return m


def add_rock(ob, strength=0.03, size=0.06, levels=2, seed=0):
    """Huggen sten: subdivision + krackelerat brus (fasetter) + fint brus."""
    add_subsurf(ob, levels)
    tex = bpy.data.textures.new(f"rock{seed}", "CLOUDS")
    tex.noise_basis = "VORONOI_CRACKLE"
    tex.noise_scale = size
    tex.noise_depth = 1
    m = ob.modifiers.new("Rock", "DISPLACE")
    m.texture = tex
    m.strength = strength
    m.mid_level = 0.5
    m.texture_coords = "GLOBAL"
    tex2 = bpy.data.textures.new(f"rockn{seed}", "CLOUDS")
    tex2.noise_scale = size * 0.4
    tex2.noise_depth = 3
    m2 = ob.modifiers.new("Rock2", "DISPLACE")
    m2.texture = tex2
    m2.strength = strength * 0.35
    m2.texture_coords = "GLOBAL"
    return m


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def smooth(ob, angle_deg=40):
    me = ob.data
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(angle_deg))


def mirror_x(ob, name=None):
    """Kopia speglad i X (vänster <-> höger)."""
    me = ob.data.copy()
    me.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
    me.flip_normals()
    o2 = bpy.data.objects.new(name or ob.name + "_m", me)
    link(o2)
    return o2


def transform(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), pivot=(0, 0, 0)):
    """Baka in en transform i meshen (rot i grader, kring pivot)."""
    P = Matrix.Translation(Vector(pivot))
    R = Euler([math.radians(a) for a in rot], "XYZ").to_matrix().to_4x4()
    S = Matrix.Diagonal((*scale, 1))
    ob.data.transform(Matrix.Translation(Vector(loc)) @ P @ R @ S @ P.inverted())
    return ob


def join(objs, name):
    objs = [o for o in objs if o]
    for o in objs:
        apply_mods(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def uv_box(ob, scale=1.0, offset=(0.0, 0.0), rot=0.0):
    """Lådprojektion i meter (1 UV-enhet = 1/scale m). Spelet sätter texturens repeat."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    c, s_ = math.cos(rot), math.sin(rot)
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 2:
                u, v = co.x, co.y
            elif ax == 1:
                u, v = co.x, co.z
            else:
                u, v = co.y, co.z
            u, v = u * c - v * s_, u * s_ + v * c
            uv[li].uv = (u * scale + offset[0], v * scale + offset[1])


# ---------------------------------------------------------------- rendering för kontroll

def preview_setup(target=(0, 0, 0.9), dist=5.0, elev=12, azim=-30, lens=60, res=(640, 800), hdri=None):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("W")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    if hdri:
        env = world.node_tree.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(hdri)
        world.node_tree.links.new(env.outputs["Color"], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = 1.0
    else:
        bg.inputs["Color"].default_value = (0.35, 0.42, 0.55, 1)
        bg.inputs["Strength"].default_value = 0.6
        sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
        sun.data.energy = 4.0
        sun.data.angle = math.radians(3)
        sun.rotation_euler = Euler((math.radians(50), 0, math.radians(-35)))
        link(sun)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = lens
    link(cam)
    sc.camera = cam
    set_cam(target, dist, elev, azim)
    return cam


def set_cam(target, dist, elev, azim):
    cam = bpy.context.scene.camera
    t = Vector(target)
    e, a = math.radians(elev), math.radians(azim)
    cam.location = t + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
