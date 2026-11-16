# The Star Lounge, built by script and rendered with Cycles as layers the page puts back together
# with depth: an observation deck whose whole back wall is glass.
#
#   lobby/tools/blender/run.sh <pass> [width] [samples]
#
#   shell        the room itself from the live room's camera, glass left clear. One render gives
#                every light on its own (Cycles light groups), so the page can turn each one up
#                and down: base, lamp0..lamp4 (each with the glow of the screen under it),
#                strips (the lines of light in the deck and under the bench), holo (the chart table).
#   cards        the things that stand apart from the walls, alone on a clear picture from the
#                same camera: the five lamps and the chart table. The page hangs each at its own depth.
#   env          the room all round from where the pieces stand, for their shine.
#   tex-planet   the planet's surface, unwrapped (the page wraps it on a turning ball)
#   tex-moon     the moon's surface, unwrapped
#   tex-sky      the far sky: gas clouds, unwrapped all round
#   sprite-<x>   one thing that passes the window, alone on a clear picture:
#                liner, rocket, saucer, rock0, rock1, rock2
#   pack         no render: turns the saved passes into the pictures the page loads (out/pack/)
#
# The passes are saved as plain light (OpenEXR, no film curve); the page adds them and gives the
# sum the same film curve as the live pieces, as the bar's plate does (landing/tools/blender/room.py).
#
# Coordinates: x along the wall, y up, z toward the viewer. Blender is z up, so a room point
# (x, y, z) is the Blender point (x, -z, y). Everything here is made in this file: no outside
# models or textures.
import bpy, bmesh, sys, os, json, math, time, functools, random
print = functools.partial(print, flush=True)
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
OUT, HERE, PASS = args[0], args[1], args[2]
WIDTH = int(args[3]) if len(args) > 3 and args[3] != "-" else 0
SAMPLES = int(args[4]) if len(args) > 4 else 96
T0 = time.time()
CFG = json.load(open(os.path.join(HERE, "star-lounge.json")))

# ------------------------------------------------------------------ the live room's numbers
# (lobby/shared/world.js and lobby/public/look3d/space.js)
ROOM = dict(w=14.2, h=6.8, z_back=-2.5, z_front=16.0)
U = 125.55
CAM = (0.0, 4.2, 17.5)
WALK_Z = 0.6
LAMP_Y = 5.25
RECT = CFG["rect"]
N = CFG["boxes"]
wall_x = lambda xw: (xw - 960) / U
wall_y = lambda yw: 6.25 - yw / U
slot_w = (1580 - 296) / N
WALK = (CAM[2] - WALK_Z) / (CAM[2] - ROOM["z_back"])
WALL_X = [wall_x(296 + slot_w * (i + 0.5)) for i in range(N)]
POOL_X = [x * WALK for x in WALL_X]
POOL_R = (min(118, slot_w * 0.4) + 12) * WALK / U - 0.04
BOX_W = min(1.75, (slot_w - 36 + 8) / U - 2 * (0.07 + 0.05))
BOX_H = BOX_W * 1.4
BOX_Y = wall_y(150) - BOX_H / 2
GAPS = [WALL_X[0] - slot_w / U / 2 + k * slot_w / U for k in range(N + 1)]
DOOR_X = wall_x(181)
BOARD_X = wall_x(1722)
ZB = ROOM["z_back"]
HW = ROOM["w"] / 2
SILL = 0.48          # the top of the bench under the window
HEAD = 5.9           # the underside of the beam over the window
GROUPS = ["base"] + [f"lamp{i}" for i in range(N)] + ["strips", "holo"]
LAMP_COL = tuple(CFG["lampColour"])
ACCENT = tuple(CFG["accent"])


def G(x, y, z):
    return Vector((x, -z, y))


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb(hex_, mul=1.0):
    h = hex_.lstrip("#")
    return tuple(lin(int(h[i:i + 2], 16) / 255) * mul for i in (0, 2, 4)) + (1.0,)


# ------------------------------------------------------------------ set-up
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"          # the AMD GPU runtime crashed during Cycles on this machine (Cork & Bell's notes)
scene.cycles.samples = SAMPLES
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.015
scene.cycles.max_bounces = 6
scene.cycles.diffuse_bounces = 3
scene.cycles.glossy_bounces = 4
scene.cycles.transmission_bounces = 4
scene.cycles.transparent_max_bounces = 8
scene.cycles.volume_bounces = 0
scene.cycles.caustics_reflective = False
scene.cycles.caustics_refractive = False
scene.cycles.sample_clamp_indirect = 6.0
scene.cycles.use_denoising = False   # each light is denoised on its own, below
scene.render.threads_mode = "FIXED"
scene.render.threads = 6             # leave the owner's PC two cores
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
random.seed(11)
view_layer = scene.view_layers[0]


# ------------------------------------------------------------------ materials
def principled(name, color, rough=0.5, metal=0.0, coat=0.0, coat_rough=0.1, emit=None, emit_strength=0.0, sheen=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = color
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = coat_rough
    if sheen:
        b.inputs["Sheen Weight"].default_value = sheen
    if emit:
        b.inputs["Emission Color"].default_value = emit
        b.inputs["Emission Strength"].default_value = emit_strength
    return m


def emission(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = tuple(color)[:3] + (1,)
    e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs[0], nt.nodes["Material Output"].inputs[0])
    return m


def deck_material():
    """The deck: dark plates with fine seams, polished unevenly so it holds the window and the lamps."""
    m = bpy.data.materials.new("deck")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    co = nt.nodes.new("ShaderNodeTexCoord")
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.offset = 0.5
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = 2.4
    br.inputs["Row Height"].default_value = 1.2
    br.inputs["Mortar Size"].default_value = 0.007
    br.inputs["Mortar Smooth"].default_value = 0.3
    br.inputs["Bias"].default_value = 0.0
    br.inputs["Color1"].default_value = rgb("#22305a")
    br.inputs["Color2"].default_value = rgb("#1b274c")
    br.inputs["Mortar"].default_value = rgb("#05070f")
    nt.links.new(co.outputs["Object"], br.inputs["Vector"])
    nt.links.new(br.outputs["Color"], b.inputs["Base Color"])
    wear = nt.nodes.new("ShaderNodeTexNoise")
    wear.inputs["Scale"].default_value = 0.9
    wear.inputs["Detail"].default_value = 5
    nt.links.new(co.outputs["Object"], wear.inputs["Vector"])
    fine = nt.nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 60
    fine.inputs["Detail"].default_value = 2
    nt.links.new(co.outputs["Object"], fine.inputs["Vector"])
    rr = nt.nodes.new("ShaderNodeMath"); rr.operation = "MULTIPLY_ADD"; rr.inputs[1].default_value = 0.22; rr.inputs[2].default_value = 0.1
    nt.links.new(wear.outputs["Fac"], rr.inputs[0])
    rr2 = nt.nodes.new("ShaderNodeMath"); rr2.operation = "MULTIPLY_ADD"; rr2.inputs[1].default_value = 0.08
    nt.links.new(fine.outputs["Fac"], rr2.inputs[0]); nt.links.new(rr.outputs[0], rr2.inputs[2])
    nt.links.new(rr2.outputs[0], b.inputs["Roughness"])
    one = nt.nodes.new("ShaderNodeMath"); one.operation = "SUBTRACT"; one.inputs[0].default_value = 1.0
    nt.links.new(br.outputs["Fac"], one.inputs[1])
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.4; bump.inputs["Distance"].default_value = 0.004
    nt.links.new(one.outputs[0], bump.inputs["Height"]); nt.links.new(bump.outputs[0], b.inputs["Normal"])
    b.inputs["Coat Weight"].default_value = 0.7
    b.inputs["Coat Roughness"].default_value = 0.07
    return m


def glass_material():
    """Clear to the camera (the page shows the universe through it) but it still holds a faint picture of the room."""
    m = bpy.data.materials.new("glass")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    clear = nt.nodes.new("ShaderNodeBsdfTransparent")
    shine = nt.nodes.new("ShaderNodeBsdfGlossy"); shine.inputs["Roughness"].default_value = 0.03
    fr = nt.nodes.new("ShaderNodeFresnel"); fr.inputs["IOR"].default_value = 1.5
    k = nt.nodes.new("ShaderNodeMath"); k.operation = "MULTIPLY"; k.inputs[1].default_value = 1.0; k.use_clamp = True
    nt.links.new(fr.outputs[0], k.inputs[0])
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(k.outputs[0], mix.inputs["Fac"]); nt.links.new(clear.outputs[0], mix.inputs[1]); nt.links.new(shine.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    return m


def bands(nt, vec):
    """A gas giant's colour for a direction from its middle: belts by latitude, torn by turbulence."""
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(vec, sep.inputs[0])
    warp = nt.nodes.new("ShaderNodeTexNoise"); warp.inputs["Scale"].default_value = 2.6; warp.inputs["Detail"].default_value = 7; warp.inputs["Roughness"].default_value = 0.62
    stretch = nt.nodes.new("ShaderNodeMapping"); stretch.inputs["Scale"].default_value = (1.0, 1.0, 3.4)
    nt.links.new(vec, stretch.inputs[0]); nt.links.new(stretch.outputs[0], warp.inputs["Vector"])
    swirl = nt.nodes.new("ShaderNodeTexNoise"); swirl.inputs["Scale"].default_value = 9.0; swirl.inputs["Detail"].default_value = 6; swirl.inputs["Distortion"].default_value = 1.2
    stretch2 = nt.nodes.new("ShaderNodeMapping"); stretch2.inputs["Scale"].default_value = (1.0, 1.0, 5.0)
    nt.links.new(vec, stretch2.inputs[0]); nt.links.new(stretch2.outputs[0], swirl.inputs["Vector"])
    lat = nt.nodes.new("ShaderNodeMath"); lat.operation = "MULTIPLY_ADD"; lat.inputs[1].default_value = 0.34
    nt.links.new(warp.outputs["Fac"], lat.inputs[0]); nt.links.new(sep.outputs["Z"], lat.inputs[2])
    lat2 = nt.nodes.new("ShaderNodeMath"); lat2.operation = "MULTIPLY_ADD"; lat2.inputs[1].default_value = 0.07
    nt.links.new(swirl.outputs["Fac"], lat2.inputs[0]); nt.links.new(lat.outputs[0], lat2.inputs[2])
    belt = nt.nodes.new("ShaderNodeTexNoise"); belt.noise_dimensions = "1D"; belt.inputs["Scale"].default_value = 7.5; belt.inputs["Detail"].default_value = 4; belt.inputs["Roughness"].default_value = 0.55
    nt.links.new(lat2.outputs[0], belt.inputs["W"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].position = 0.26; els[0].color = rgb("#5a2414")
    els[1].position = 0.78; els[1].color = rgb("#fff0d2")
    for pos, hex_ in [(0.36, "#b4552a"), (0.44, "#e59a58"), (0.5, "#f6d7a0"), (0.56, "#d98248"), (0.63, "#f2c58a"), (0.7, "#c9683a")]:
        e = els.new(pos); e.color = rgb(hex_)
    nt.links.new(belt.outputs["Fac"], ramp.inputs[0])
    # The poles go cooler and paler.
    pole = nt.nodes.new("ShaderNodeMath"); pole.operation = "ABSOLUTE"
    nt.links.new(sep.outputs["Z"], pole.inputs[0])
    pr = nt.nodes.new("ShaderNodeMapRange"); pr.inputs["From Min"].default_value = 0.72; pr.inputs["From Max"].default_value = 0.98
    nt.links.new(pole.outputs[0], pr.inputs["Value"])
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
    mix.inputs["B"].default_value = rgb("#9db7c9")
    nt.links.new(pr.outputs["Result"], mix.inputs["Factor"]); nt.links.new(ramp.outputs["Color"], mix.inputs["A"])
    return mix.outputs["Result"]


# ------------------------------------------------------------------ shapes
def finish(obj, mat, smooth=True, group=None):
    if mat:
        obj.data.materials.append(mat)
    if smooth and hasattr(obj.data, "polygons"):
        for p in obj.data.polygons:
            p.use_smooth = True
    if group:
        obj.lightgroup = group
    return obj


def box(name, c, size, mat, bevel=0.006, segments=3, group=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=G(*c))
    o = bpy.context.object
    o.name = name
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = o.modifiers.new("bevel", "BEVEL")
        mod.width = bevel; mod.segments = segments; mod.limit_method = "ANGLE"
    return finish(o, mat, smooth=bool(bevel), group=group)


def ball(name, c, r, mat, scale=(1, 1, 1), group=None, segments=40):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=segments, ring_count=segments // 2, location=G(*c))
    o = bpy.context.object
    o.name = name
    o.scale = (scale[0], scale[2], scale[1])
    return finish(o, mat, group=group)


def rod(name, a, b, r, mat, verts=16, group=None):
    A, B = G(*a), G(*b)
    d = B - A
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, vertices=verts, location=(A + B) / 2)
    o = bpy.context.object
    o.name = name
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return finish(o, mat, group=group)


def lathe(name, profile, at, mat, steps=64, subsurf=1, group=None, axis="up"):
    """Spins a profile of (radius, height) points about the upright axis (or about the room's x, lying down)."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, y)) for r, y in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.tau, steps=steps, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location = G(*at)
    if axis == "x":
        o.rotation_euler = (0, math.pi / 2, 0)
    if subsurf:
        mod = o.modifiers.new("smooth", "SUBSURF"); mod.levels = subsurf; mod.render_levels = subsurf
    return finish(o, mat, group=group)


def prism(name, pts, thick, mat, bevel=0.012):
    """A flat plate cut to the outline `pts` (room x, y), `thick` deep, standing in the plane z = 0."""
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((x, thick / 2, y)) for x, y in pts])
    bmesh.ops.extrude_face_region(bm, geom=[face])
    # The extrusion's new face lies on the old one: push the old one back.
    for v in face.verts:
        v.co.y = -thick / 2
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    if bevel:
        mod = o.modifiers.new("bevel", "BEVEL")
        mod.width = bevel; mod.segments = 2; mod.limit_method = "ANGLE"
    return finish(o, mat, smooth=False)


def torus(name, c, R, r, mat, rot=(0, 0, 0), group=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=48, minor_segments=12, location=G(*c), rotation=rot)
    o = bpy.context.object
    o.name = name
    return finish(o, mat, group=group)


def disc(name, c, r, mat, facing="down", group=None):
    rot = {"down": (math.pi, 0, 0), "up": (0, 0, 0), "front": (math.pi / 2, 0, 0)}[facing]
    bpy.ops.mesh.primitive_circle_add(radius=r, vertices=48, fill_type="NGON", location=G(*c), rotation=rot)
    o = bpy.context.object
    o.name = name
    return finish(o, mat, smooth=False, group=group)


def plane(name, c, w, h, mat, group=None):
    """An upright plane facing the viewer."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=G(*c), rotation=(math.pi / 2, 0, 0))
    o = bpy.context.object
    o.name = name
    o.scale = (w, h, 1)
    return finish(o, mat, smooth=False, group=group)


def light(kind, name, at, to, watts, group, color=(1, 1, 1), **kw):
    d = bpy.data.lights.new(name, kind)
    d.energy = watts; d.color = color
    if kind == "SPOT":
        d.spot_size = math.radians(kw["size_deg"]); d.spot_blend = kw.get("blend", 0.25); d.shadow_soft_size = kw.get("radius", 0.06)
    elif kind == "AREA":
        d.size = kw["size"]
        if kw.get("size_y"):
            d.shape = "RECTANGLE"; d.size_y = kw["size_y"]
    else:
        d.shadow_soft_size = kw.get("radius", 0.1)
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location = G(*at)
    if to:
        o.rotation_euler = (G(*to) - G(*at)).to_track_quat("-Z", "Y").to_euler()
    o.lightgroup = group
    # A light is not a thing in the room: it is not seen, and the glass and the deck do not hold a picture of it.
    o.visible_camera = False
    o.visible_glossy = bool(kw.get("mirrored"))
    return o


def world_of(strength=0.0, color=(0, 0, 0)):
    w = bpy.data.worlds.new("world")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = tuple(color) + (1,)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = strength
    scene.world = w
    return w


def camera_at(at, look, lens, shift_y=0.0, ortho=None):
    cd = bpy.data.cameras.new("camera")
    c = bpy.data.objects.new("camera", cd)
    bpy.context.collection.objects.link(c)
    scene.camera = c
    c.location = G(*at)
    c.rotation_euler = (G(*look) - G(*at)).to_track_quat("-Z", "Y").to_euler()
    cd.lens = lens; cd.sensor_width = 36; cd.shift_y = shift_y; cd.clip_end = 400
    if ortho:
        cd.type = "ORTHO"; cd.ortho_scale = ortho
    return c


def save_exrs(prefix, groups, extra=()):
    """One denoised picture per light, and the picture's coverage, saved as plain light."""
    scene.use_nodes = True
    ct = scene.node_tree
    for n_ in list(ct.nodes):
        ct.nodes.remove(n_)
    rl = ct.nodes.new("CompositorNodeRLayers")
    comp = ct.nodes.new("CompositorNodeComposite")
    ct.links.new(rl.outputs["Image"], comp.inputs["Image"])
    fo = ct.nodes.new("CompositorNodeOutputFile")
    fo.base_path = OUT
    fo.format.file_format = "OPEN_EXR"; fo.format.color_depth = "16"; fo.format.color_mode = "RGBA"; fo.format.exr_codec = "ZIP"
    fo.file_slots.clear()
    for g in groups:
        fo.file_slots.new(f"{prefix}-{g}-")
        dn = ct.nodes.new("CompositorNodeDenoise")
        ct.links.new(rl.outputs[f"Combined_{g}"], dn.inputs["Image"])
        ct.links.new(rl.outputs["Denoising Normal"], dn.inputs["Normal"])
        ct.links.new(rl.outputs["Denoising Albedo"], dn.inputs["Albedo"])
        ct.links.new(dn.outputs[0], fo.inputs[-1])
    fo.file_slots.new(f"{prefix}-alpha-")
    ct.links.new(rl.outputs["Alpha"], fo.inputs[-1])


def render(name, w, h):
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = os.path.join(OUT, name + ".png")
    print(f"built in {time.time() - T0:.1f} s, rendering {name} at {w} x {h}, {SAMPLES} samples")
    bpy.ops.render.render(write_still=True)
    print(f"saved {name} after {time.time() - T0:.1f} s")


# ================================================================== the room
def build_room(lamp_level=1.0):
    for g in GROUPS:
        view_layer.lightgroups.add(name=g)
    view_layer.cycles.denoising_store_passes = True
    world = world_of(0.02, (0.25, 0.35, 0.6))
    world.lightgroup = "base"

    deck = deck_material()
    panel = principled("panel", rgb("#cfd6e2"), rough=0.38, coat=0.35, coat_rough=0.2)
    panel_dark = principled("panel dark", rgb("#2a3348"), rough=0.45, coat=0.2)
    wall_m = principled("side wall", rgb("#56627c"), rough=0.5, coat=0.15)
    hull = principled("hull", rgb("#0e1424"), rough=0.5)
    trim = principled("trim", rgb("#aab6cc"), rough=0.24, metal=1.0)
    gun = principled("gunmetal", rgb("#1c2233"), rough=0.36, metal=0.8, coat=0.3)
    cushion = principled("cushion", rgb("#d9772a"), rough=0.62, sheen=0.4)
    cushion2 = principled("cushion teal", rgb("#1f8f8a"), rough=0.62, sheen=0.4)
    glass = glass_material()
    cool = (0.78, 0.9, 1.0)
    warm = (1.0, 0.86, 0.68)
    zf = ROOM["z_front"]
    zmid, zlen = (zf + ZB) / 2, zf - ZB
    shell, cards = [], {}

    def S(o):
        shell.append(o)
        return o

    # ---- floor, ceiling, side walls
    S(box("floor", (0, -0.1, zmid), (ROOM["w"] + 0.4, 0.2, zlen), deck, bevel=0))
    S(box("ceiling", (0, ROOM["h"] + 0.1, zmid), (ROOM["w"] + 0.4, 0.2, zlen), hull, bevel=0))
    for s in (-1, 1):
        S(box("side wall", (s * (HW + 0.1), ROOM["h"] / 2, zmid), (0.2, ROOM["h"], zlen), wall_m, bevel=0))
        S(box("side dado", (s * (HW - 0.03), 0.6, zmid), (0.06, 1.2, zlen), panel_dark, bevel=0.01))
        S(box("side line", (s * (HW - 0.065), 1.24, zmid), (0.02, 0.05, zlen), emission("side line", ACCENT, 7.0), bevel=0, group="strips"))
        for pz in (-0.9, 2.1, 5.1, 8.1, 11.1):
            S(box("pilaster", (s * (HW - 0.09), ROOM["h"] / 2, pz), (0.18, ROOM["h"], 0.34), panel, bevel=0.03))
            S(box("pilaster light", (s * (HW - 0.185), 3.6, pz), (0.012, 4.2, 0.05), emission("pilaster light", cool, 2.2), bevel=0, group="base"))
    # Beams across the ceiling, each with a bar of light under it: the room's own soft light.
    for bz in (-0.6, 2.4, 5.4, 8.4):
        S(box("beam", (0, ROOM["h"] - 0.14, bz), (ROOM["w"], 0.28, 0.4), gun, bevel=0.02))
        S(box("beam light", (0, ROOM["h"] - 0.285, bz), (ROOM["w"] - 1.0, 0.012, 0.14), emission("beam light", warm, 5.0), bevel=0, group="base"))
    # Lines of light let into the deck, running the length of the room.
    line = emission("deck line", ACCENT, 9.0)
    for lz in (-0.75, 2.0):
        S(box("deck line", (0, 0.003, lz), (ROOM["w"], 0.008, 0.045), line, bevel=0, group="strips"))

    # ---- the window wall: a bench with cushions, ribs, a beam over the top, and the glass
    S(box("bench", (0, SILL / 2 + 0.03, ZB + 0.33), (ROOM["w"], SILL - 0.06, 0.66), panel, bevel=0.03))
    S(box("bench foot", (0, 0.03, ZB + 0.3), (ROOM["w"], 0.06, 0.56), hull, bevel=0))
    S(box("bench cove", (0, 0.045, ZB + 0.585), (ROOM["w"] - 0.3, 0.02, 0.012), emission("cove", ACCENT, 12.0), bevel=0, group="strips"))
    S(box("bench lip", (0, SILL + 0.012, ZB + 0.33), (ROOM["w"], 0.024, 0.7), trim, bevel=0.008))
    ribs = [-HW + 0.09] + GAPS + [HW - 0.09]
    for a, b_ in zip(ribs, ribs[1:]):
        w = b_ - a
        if w < 0.9:
            continue
        mid = (a + b_) / 2
        # Seat cushions between the ribs (not behind the door).
        if abs(mid - DOOR_X) > 0.9:
            k = round((mid - WALL_X[0]) / (slot_w / U))
            S(box("cushion", (mid, SILL + 0.085, ZB + 0.36), (w - 0.34, 0.13, 0.5), cushion if k % 2 == 0 else cushion2, bevel=0.045, segments=5))
        # Vents in the bench front.
        for vy in (0.16, 0.22, 0.28):
            S(box("vent", (mid, vy, ZB + 0.662), (min(0.9, w - 0.6), 0.022, 0.01), hull, bevel=0))
    for gx in ribs:
        S(box("rib", (gx, (SILL + HEAD) / 2, ZB + 0.13), (0.15, HEAD - SILL, 0.3), panel, bevel=0.035))
        S(box("rib light", (gx, (SILL + HEAD) / 2 + 0.1, ZB + 0.283), (0.022, HEAD - SILL - 1.4, 0.008), emission("rib light", cool, 4.0), bevel=0, group="base"))
        S(box("rib foot", (gx, SILL + 0.14, ZB + 0.16), (0.24, 0.28, 0.36), gun, bevel=0.03))
    S(box("head", (0, (HEAD + ROOM["h"]) / 2, ZB + 0.32), (ROOM["w"], ROOM["h"] - HEAD, 0.64), panel, bevel=0.03))
    S(box("head line", (0, HEAD - 0.004, ZB + 0.5), (ROOM["w"] - 0.6, 0.008, 0.07), emission("head line", warm, 9.0), bevel=0, group="base"))
    S(box("head trim", (0, HEAD + 0.05, ZB + 0.645), (ROOM["w"], 0.035, 0.012), trim, bevel=0))
    g_ = S(box("glass", (0, (SILL + HEAD) / 2, ZB + 0.01), (ROOM["w"] + 0.4, HEAD - SILL, 0.004), glass, bevel=0))
    g_.visible_shadow = False

    # ---- the game screens: a dark frame for each, hung from the beam; the page puts the poster in it
    screen = principled("screen", (0.004, 0.005, 0.008, 1), rough=0.12, coat=1.0)
    for i, x in enumerate(WALL_X):
        bar, nd = 0.07, 0.4
        nw, nh = BOX_W + 0.1, BOX_H + 0.1
        for (w, h, dx, dy) in [(bar, nh + bar * 2, -nw / 2 - bar / 2, 0), (bar, nh + bar * 2, nw / 2 + bar / 2, 0), (nw, bar, 0, nh / 2 + bar / 2), (nw, bar, 0, -nh / 2 - bar / 2)]:
            S(box("frame", (x + dx, BOX_Y + dy, ZB + 0.04 + nd / 2), (w, h, nd), gun, bevel=0.014))
        S(box("frame back", (x, BOX_Y, ZB + 0.06), (nw, nh, 0.04), gun, bevel=0))
        S(plane("niche", (x, BOX_Y, ZB + 0.09), nw, nh, screen))
        for dx in (-0.55, 0.55):
            S(rod("hanger", (x + dx, BOX_Y + nh / 2 + bar, ZB + 0.22), (x + dx, HEAD, ZB + 0.22), 0.016, trim))
        # What the lit screen gives the room: it is in its lamp's picture, and the camera does not see it.
        glow = plane(f"screen glow {i}", (x, BOX_Y, ZB + 0.4), BOX_W, BOX_H, emission(f"screen glow {i}", (0.95, 0.97, 1.0), 2.2), group=f"lamp{i}")
        glow.visible_camera = False

    # ---- left end: the airlock under the join sign
    S(box("airlock", (DOOR_X, 1.3, ZB + 0.36), (1.56, 2.6, 0.72), panel, bevel=0.07, segments=5))
    S(box("airlock door", (DOOR_X, 1.16, ZB + 0.725), (1.0, 2.2, 0.03), principled("door", rgb("#2a3b6e"), rough=0.3, metal=0.6, coat=0.4), bevel=0.012))
    S(box("airlock seam", (DOOR_X, 1.16, ZB + 0.742), (0.012, 2.2, 0.004), hull, bevel=0))
    for dx in (-0.56, 0.56):
        S(box("airlock jamb", (DOOR_X + dx, 1.16, ZB + 0.735), (0.07, 2.3, 0.05), gun, bevel=0.01))
    S(box("airlock lintel", (DOOR_X, 2.3, ZB + 0.735), (1.19, 0.07, 0.05), gun, bevel=0.01))
    S(disc("porthole", (DOOR_X, 1.62, ZB + 0.745), 0.15, emission("porthole", (1.0, 0.7, 0.34), 10.0), facing="front", group="base"))
    S(torus("porthole ring", (DOOR_X, 1.62, ZB + 0.75), 0.165, 0.03, trim, rot=(math.pi / 2, 0, 0)))
    S(box("airlock lamp", (DOOR_X, 2.44, ZB + 0.725), (0.34, 0.035, 0.012), emission("airlock lamp", (0.3, 1.0, 0.55), 9.0), bevel=0, group="base"))
    light("POINT", "porthole light", (DOOR_X, 1.62, ZB + 1.15), None, 14, "base", color=(1.0, 0.7, 0.34), radius=0.15)

    # ---- right end: the chart table under the Tonight board (it stands apart: a card)
    hx, hz = CFG["holo"]["x"], CFG["holo"]["z"]
    table = []
    table.append(lathe("table", [(0.0, 0.0), (0.46, 0.0), (0.48, 0.03), (0.44, 0.07), (0.2, 0.13), (0.15, 0.3), (0.15, 0.62), (0.2, 0.74), (0.5, 0.86), (0.56, 0.9), (0.56, 0.97), (0.5, 0.99), (0.0, 0.99)], (hx, 0, hz), panel, subsurf=1))
    table.append(torus("table band", (hx, 0.935, hz), 0.565, 0.014, trim))
    table.append(disc("table top", (hx, 0.992, hz), 0.48, principled("table glass", (0.01, 0.015, 0.03, 1), rough=0.08, coat=1.0), facing="up"))
    table.append(torus("table ring", (hx, 0.995, hz), 0.4, 0.016, emission("table ring", ACCENT, 26.0), group="holo"))
    table.append(torus("table ring 2", (hx, 0.995, hz), 0.16, 0.01, emission("table ring 2", ACCENT, 20.0), group="holo"))
    table.append(torus("table foot ring", (hx, 0.075, hz), 0.455, 0.012, emission("table foot ring", ACCENT, 8.0), group="holo"))
    light("POINT", "holo light", (hx, CFG["holo"]["y"], hz), None, 55, "holo", color=ACCENT, radius=CFG["holo"]["r"] * 0.8)
    cards["table"] = table

    # ---- the lamps over the pools: a shallow dish on a rod, lit from inside (each stands apart: a card)
    dish = principled("dish", rgb("#e6ecf5"), rough=0.3, coat=0.6)
    for i, x in enumerate(POOL_X):
        parts = []
        parts.append(lathe(f"dish {i}", [(0.03, 0.2), (0.06, 0.18), (0.11, 0.1), (0.34, 0.035), (0.4, 0.0), (0.392, -0.014), (0.33, 0.01), (0.1, 0.07), (0.03, 0.09)], (x, LAMP_Y, WALK_Z), dish, subsurf=1))
        parts.append(torus(f"dish rim {i}", (x, LAMP_Y - 0.004, WALK_Z), 0.397, 0.011, trim))
        parts.append(rod(f"stem {i}", (x, LAMP_Y + 0.18, WALK_Z), (x, ROOM["h"], WALK_Z), 0.014, trim))
        parts.append(rod(f"collar {i}", (x, LAMP_Y + 0.17, WALK_Z), (x, LAMP_Y + 0.3, WALK_Z), 0.034, gun))
        parts.append(disc(f"bulb {i}", (x, LAMP_Y + 0.012, WALK_Z), 0.3, emission(f"bulb {i}", LAMP_COL, 30.0 * lamp_level), group=f"lamp{i}"))
        if lamp_level:
            light("SPOT", f"lamp {i}", (x, LAMP_Y, WALK_Z), (x, 0, WALK_Z), 15000 * lamp_level, f"lamp{i}", color=LAMP_COL,
                  size_deg=2 * math.degrees(math.atan((POOL_R + 0.04) / LAMP_Y)), blend=0.34, radius=0.07)
        cards[f"lamp{i}"] = parts

    # ---- the room's own light, and what comes in through the glass
    light("AREA", "fill", (-2.0, 5.6, 10.0), (0, 2.0, -1.0), 300, "base", color=(0.74, 0.84, 1.0), size=9.0, size_y=4.0)
    light("AREA", "faces", (0, 1.5, 8.5), (0, 0.6, 0.6), 420, "base", color=(0.86, 0.9, 1.0), size=10.0, size_y=1.5)
    light("AREA", "planet shine", (2.5, 1.0, ZB - 1.6), (1.5, 2.2, 6.0), 2600, "base", color=(1.0, 0.72, 0.46), size=9.0, size_y=4.5)

    # ---- outside, for the deck's reflection only (the page draws the real one): the planet, lit by a far sun
    p = CFG["planet"]
    pm = bpy.data.materials.new("planet")
    pm.use_nodes = True
    nt = pm.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    co = nt.nodes.new("ShaderNodeTexCoord")
    nrm = nt.nodes.new("ShaderNodeVectorMath"); nrm.operation = "NORMALIZE"
    nt.links.new(co.outputs["Object"], nrm.inputs[0])
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    dot = nt.nodes.new("ShaderNodeVectorMath"); dot.operation = "DOT_PRODUCT"
    sun = Vector(G(*CFG["sun"])).normalized()
    dot.inputs[1].default_value = sun
    nt.links.new(geo.outputs["Normal"], dot.inputs[0])
    lit = nt.nodes.new("ShaderNodeMapRange"); lit.inputs["From Min"].default_value = -0.08; lit.inputs["From Max"].default_value = 0.6; lit.inputs["To Max"].default_value = 3.0
    nt.links.new(dot.outputs["Value"], lit.inputs["Value"])
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(bands(nt, nrm.outputs[0]), em.inputs["Color"]); nt.links.new(lit.outputs["Result"], em.inputs["Strength"])
    nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    planet = ball("planet", tuple(p["centre"]), p["radius"], pm, segments=96, group="base")
    axis = Vector(G(*p["axis"])).normalized()
    planet.rotation_euler = Vector((0, 0, 1)).rotation_difference(axis).to_euler()
    planet.visible_camera = False
    planet.visible_shadow = False
    planet.visible_diffuse = False
    return shell, cards


def plate_camera():
    wm = (RECT["x1"] - RECT["x0"]) / U
    mid_y = wall_y((RECT["y0"] + RECT["y1"]) / 2)
    dist = CAM[2] - ZB
    lens = 36 * dist / wm
    return camera_at(CAM, (0.0, CAM[1], ZB), lens, shift_y=(mid_y - CAM[1]) / dist * lens / 36)


if PASS in ("shell", "cards"):
    shell, cards = build_room()
    plate_camera()
    W = WIDTH or (RECT["x1"] - RECT["x0"])
    H = round(W * (RECT["y1"] - RECT["y0"]) / (RECT["x1"] - RECT["x0"]))
    card_objs = [o for parts in cards.values() for o in parts]
    if PASS == "shell":
        for o in card_objs:
            o.visible_camera = False
        save_exrs("shell", GROUPS)
    else:
        for o in shell:
            o.visible_camera = False
        # Where each card is in the picture, so the page can cut it out and hang it at its own depth.
        cam = scene.camera
        from bpy_extras.object_utils import world_to_camera_view
        bpy.context.view_layer.update()
        scene.render.resolution_x, scene.render.resolution_y = W, H
        deps = bpy.context.evaluated_depsgraph_get()
        rects = {}
        for name, parts in cards.items():
            xs, ys = [], []
            for o in parts:
                ev = o.evaluated_get(deps)
                me = ev.to_mesh()
                for v in me.vertices:
                    c = world_to_camera_view(scene, cam, ev.matrix_world @ v.co)
                    xs.append(c.x); ys.append(1 - c.y)
                ev.to_mesh_clear()
            span = lambda lo, hi, n: (max(0.0, lo - 0.012), min(1.0, hi + 0.012))
            (x0, x1), (y0, y1) = span(min(xs), max(xs), W), span(min(ys), max(ys), H)
            rects[name] = dict(x0=x0, y0=y0, x1=x1, y1=y1)
        json.dump(rects, open(os.path.join(OUT, "cards.json"), "w"), indent=1)
        save_exrs("cards", GROUPS)
    render(PASS, W, H)

elif PASS == "env":
    shell, cards = build_room(lamp_level=0.45)
    scene.render.film_transparent = False
    for o in bpy.data.objects:
        if o.name == "planet":
            o.visible_camera = True
    w = scene.world.node_tree
    w.nodes["Background"].inputs["Strength"].default_value = 0.05
    c = camera_at((0, 0.9, WALK_Z), (1, 0.9, WALK_Z), 36)
    c.data.type = "PANO"
    c.data.panorama_type = "EQUIRECTANGULAR"
    scene.cycles.use_denoising = True
    scene.render.image_settings.color_mode = "RGB"
    render("env", WIDTH or 1024, (WIDTH or 1024) // 2)

elif PASS.startswith("tex-"):
    # A surface unwrapped all round: the world is painted with it and a camera at the middle looks every way at once.
    world = world_of(1.0)
    nt = world.node_tree
    co = nt.nodes.new("ShaderNodeTexCoord")
    vec = co.outputs["Generated"]
    bg = nt.nodes["Background"]
    if PASS == "tex-planet":
        nt.links.new(bands(nt, vec), bg.inputs["Color"])
    elif PASS == "tex-moon":
        big = nt.nodes.new("ShaderNodeTexNoise"); big.inputs["Scale"].default_value = 2.2; big.inputs["Detail"].default_value = 8; big.inputs["Roughness"].default_value = 0.6
        nt.links.new(vec, big.inputs["Vector"])
        pits = nt.nodes.new("ShaderNodeTexVoronoi"); pits.inputs["Scale"].default_value = 9.0
        nt.links.new(vec, pits.inputs["Vector"])
        pr = nt.nodes.new("ShaderNodeMapRange"); pr.inputs["From Min"].default_value = 0.0; pr.inputs["From Max"].default_value = 0.35; pr.inputs["To Min"].default_value = 0.55; pr.inputs["To Max"].default_value = 1.0
        nt.links.new(pits.outputs["Distance"], pr.inputs["Value"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.3; ramp.color_ramp.elements[0].color = rgb("#4c5568")
        ramp.color_ramp.elements[1].position = 0.75; ramp.color_ramp.elements[1].color = rgb("#c9d2e2")
        nt.links.new(big.outputs["Fac"], ramp.inputs[0])
        mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs["Factor"].default_value = 1.0
        nt.links.new(ramp.outputs["Color"], mul.inputs["A"]); nt.links.new(pr.outputs["Result"], mul.inputs["B"])
        nt.links.new(mul.outputs["Result"], bg.inputs["Color"])
    else:
        # Gas clouds: two tangled noises, one for where there is cloud and one for its colour.
        a = nt.nodes.new("ShaderNodeTexNoise"); a.inputs["Scale"].default_value = 1.7; a.inputs["Detail"].default_value = 9; a.inputs["Roughness"].default_value = 0.62; a.inputs["Distortion"].default_value = 1.6
        nt.links.new(vec, a.inputs["Vector"])
        dens = nt.nodes.new("ShaderNodeMapRange"); dens.inputs["From Min"].default_value = 0.5; dens.inputs["From Max"].default_value = 0.82; dens.interpolation_type = "SMOOTHSTEP"
        nt.links.new(a.outputs["Fac"], dens.inputs["Value"])
        off = nt.nodes.new("ShaderNodeMapping"); off.inputs["Location"].default_value = (3.1, 1.7, 5.3)
        nt.links.new(vec, off.inputs[0])
        c_ = nt.nodes.new("ShaderNodeTexNoise"); c_.inputs["Scale"].default_value = 1.1; c_.inputs["Detail"].default_value = 4; c_.inputs["Distortion"].default_value = 0.8
        nt.links.new(off.outputs[0], c_.inputs["Vector"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        els = ramp.color_ramp.elements
        els[0].position = 0.3; els[0].color = rgb("#1b2a8a")
        els[1].position = 0.72; els[1].color = rgb("#c2327a")
        for pos, hex_ in [(0.44, "#3a6fd0"), (0.52, "#2aa6a0"), (0.6, "#7a3fc0")]:
            e = els.new(pos); e.color = rgb(hex_)
        nt.links.new(c_.outputs["Fac"], ramp.inputs[0])
        mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs["Factor"].default_value = 1.0
        nt.links.new(ramp.outputs["Color"], mul.inputs["A"]); nt.links.new(dens.outputs["Result"], mul.inputs["B"])
        deep = nt.nodes.new("ShaderNodeMix"); deep.data_type = "RGBA"; deep.blend_type = "ADD"; deep.inputs["Factor"].default_value = 1.0
        deep.inputs["B"].default_value = rgb("#02030a")
        nt.links.new(mul.outputs["Result"], deep.inputs["A"])
        nt.links.new(deep.outputs["Result"], bg.inputs["Color"])
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGB"
    c = camera_at((0, 0, 0), (1, 0, 0), 36)
    c.data.type = "PANO"
    c.data.panorama_type = "EQUIRECTANGULAR"
    scene.cycles.samples = SAMPLES = 8
    scene.cycles.use_adaptive_sampling = False
    w_ = WIDTH or (2048 if PASS != "tex-moon" else 512)
    render(PASS, w_, w_ // 2)

elif PASS.startswith("sprite-"):
    # Something that passes the window, seen from the side, lit by the same sun as the planet.
    kind = PASS[7:]
    world_of(0.12, (0.25, 0.32, 0.55))
    sun_d = bpy.data.lights.new("sun", "SUN"); sun_d.energy = 2.4; sun_d.angle = math.radians(3); sun_d.color = (1.0, 0.95, 0.88)
    so = bpy.data.objects.new("sun", sun_d); bpy.context.collection.objects.link(so)
    so.rotation_euler = (G(0, 0, 0) - G(*CFG["sun"])).to_track_quat("-Z", "Y").to_euler()
    # The planet's own light, from below and to the right.
    light("AREA", "planet glow", (6, -7, -4), (0, 0, 0), 2600, "", color=(1.0, 0.66, 0.4), size=12)
    white = principled("white", rgb("#e9edf4"), rough=0.35, coat=0.5)
    red = principled("red", rgb("#d8352a"), rough=0.3, coat=0.8)
    dark = principled("dark", rgb("#1d2333"), rough=0.4, metal=0.7)
    steel = principled("steel", rgb("#aab6cc"), rough=0.26, metal=1.0)
    window_m = emission("window", (1.0, 0.82, 0.5), 2.6)
    size = (512, 200)
    span = 5.0
    if kind == "liner":
        # A long passenger ship, heading left: rows of lit windows, a bridge, two engine pods.
        lathe("hull", [(0.0, -2.2), (0.16, -2.15), (0.36, -1.8), (0.46, -1.0), (0.48, 0.6), (0.44, 1.5), (0.34, 1.95), (0.3, 2.0), (0.0, 2.0)], (0, 0, 0), white, axis="x", subsurf=2).rotation_euler = (0, -math.pi / 2, 0)
        box("spine", (0.3, 0.44, 0), (2.6, 0.16, 0.34), dark, bevel=0.05)
        box("bridge", (-0.9, 0.5, 0), (0.7, 0.22, 0.5), white, bevel=0.08, segments=4)
        box("bridge glass", (-1.02, 0.52, 0.2), (0.4, 0.07, 0.14), emission("bridge glass", (0.5, 0.9, 1.0), 7.0), bevel=0.01)
        for row, y in enumerate((0.14, -0.06)):
            for k in range(15):
                if (k + row) % 5 == 4:
                    continue
                box("window", (-1.45 + k * 0.2, y, 0.47 - abs(y) * 0.14), (0.085, 0.05, 0.03), window_m, bevel=0)
        box("stripe", (0.05, -0.24, 0.4), (3.2, 0.05, 0.14), red, bevel=0.01)
        for s in (-1, 1):
            lathe("pod", [(0.0, -0.55), (0.13, -0.5), (0.19, -0.1), (0.19, 0.4), (0.15, 0.55), (0.0, 0.55)], (1.55, -0.12, s * 0.62), dark, axis="x", subsurf=1).rotation_euler = (0, -math.pi / 2, 0)
            box("pylon", (1.5, -0.1, s * 0.45), (0.5, 0.06, 0.3), steel, bevel=0.02)
        prism("fin", [(1.25, 0.4), (1.95, 0.4), (2.12, 0.92), (1.82, 0.92)], 0.05, red)
        size, span = (640, 256), 5.2
    elif kind == "rocket":
        # A storybook rocket, heading right: red nose and fins, a round window.
        lathe("body", [(0.0, -0.9), (0.2, -0.86), (0.3, -0.5), (0.33, 0.1), (0.28, 0.6), (0.12, 1.0), (0.0, 1.12)], (0, 0, 0), white, axis="x", subsurf=2)
        lathe("nose", [(0.285, 0.58), (0.2, 0.84), (0.12, 1.0), (0.0, 1.125), (0.0, 0.58)], (0, 0, 0), red, axis="x", subsurf=1).scale = (1.012, 1.012, 1.012)
        lathe("nozzle", [(0.0, -1.04), (0.2, -1.04), (0.15, -0.86), (0.0, -0.86)], (0, 0, 0), dark, axis="x", subsurf=0)
        for a in (0, 120, 240):
            prism("fin", [(-0.46, 0.27), (-0.86, 0.27), (-1.08, 0.66), (-0.82, 0.66)], 0.05, red).rotation_euler = (math.radians(a), 0, 0)
        torus("porthole", (0.15, 0.05, 0.325), 0.1, 0.022, steel, rot=(math.pi / 2, 0, 0))
        disc("porthole glass", (0.15, 0.05, 0.325), 0.095, emission("porthole glass", (0.5, 0.9, 1.0), 5.0), facing="front")
        box("band", (-0.3, 0, 0), (0.07, 0.66, 0.66), red, bevel=0.02)
        size, span = (384, 192), 2.9
    elif kind == "saucer":
        lathe("disc", [(0.0, -0.13), (0.4, -0.12), (0.95, -0.02), (1.0, 0.02), (0.95, 0.06), (0.45, 0.16), (0.0, 0.17)], (0, 0, 0), steel, subsurf=2)
        lathe("dome", [(0.42, 0.14), (0.4, 0.26), (0.3, 0.4), (0.15, 0.48), (0.0, 0.5)], (0, 0, 0), principled("dome", rgb("#7fe3d0"), rough=0.08, coat=1.0, emit=(0.3, 1.0, 0.8, 1), emit_strength=1.2), subsurf=2)
        for k in range(12):
            a = k / 12 * math.tau
            ball("lamp", (0.78 * math.cos(a), -0.055, 0.78 * math.sin(a)), 0.05, emission(f"lamp{k % 3}", [(1.0, 0.4, 0.3), (1.0, 0.85, 0.3), (0.4, 0.9, 1.0)][k % 3], 12.0), segments=16)
        disc("belly", (0, -0.132, 0), 0.3, emission("belly", (0.5, 1.0, 0.8), 6.0), facing="down")
        size, span = (384, 192), 2.4
    else:
        # A rock: a ball pushed about by noise, cratered by more noise.
        seed = int(kind[-1])
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=0.8, location=(0, 0, 0))
        o = bpy.context.object
        o.scale = [(1.3, 0.85, 0.9), (0.9, 1.0, 1.15), (1.15, 0.7, 1.0)][seed]
        for sc, st in ((1.1, 0.5), (0.35, 0.16), (0.12, 0.05)):
            tex = bpy.data.textures.new(f"n{sc}", "CLOUDS"); tex.noise_scale = sc
            mod = o.modifiers.new("d", "DISPLACE"); mod.texture = tex; mod.strength = st; mod.texture_coords = "GLOBAL"
            e = bpy.data.objects.new("off", None); e.location = (seed * 3.7, seed * 1.3, 0)
        finish(o, principled("rock", rgb(["#7d7468", "#6a6e78", "#8a7a66"][seed]), rough=0.9))
        o.rotation_euler = (seed * 1.1, seed * 2.3, seed * 0.7)
        size, span = (256, 256), 2.6
    camera_at((0, 0, 30), (0, 0, 0), 50, ortho=span)
    scene.cycles.use_denoising = True
    render(PASS, WIDTH or size[0], round((WIDTH or size[0]) * size[1] / size[0]))

elif PASS == "pack":
    # ---------------------------------------------------------------- the passes, made into pictures
    import numpy as np
    pack = os.path.join(OUT, "pack")
    os.makedirs(pack, exist_ok=True)

    def load(name):
        img = bpy.data.images.load(os.path.join(OUT, name))
        w, h = img.size
        a = np.empty(w * h * 4, np.float32)
        img.pixels.foreach_get(a)
        bpy.data.images.remove(img)
        return a.reshape(h, w, 4)[::-1]      # top row first

    def srgb(x):
        x = np.clip(x, 0, 1)
        return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)

    def save(name, a):
        """a: top row first, values 0..1 as they should be stored (h, w, 3 or 4)."""
        h, w, ch = a.shape
        if ch == 3:
            a = np.concatenate([a, np.ones((h, w, 1), np.float32)], axis=2)
        img = bpy.data.images.new(name, w, h, alpha=True)
        img.alpha_mode = "STRAIGHT"
        img.pixels.foreach_set(np.ascontiguousarray(a[::-1], np.float32).ravel())
        img.filepath_raw = os.path.join(pack, name + ".png")
        img.file_format = "PNG"
        img.save()
        bpy.data.images.remove(img)

    def half(a, times=1):
        for _ in range(times):
            h, w = a.shape[0] // 2 * 2, a.shape[1] // 2 * 2
            a = a[:h, :w].reshape(h // 2, 2, w // 2, 2, -1).mean(axis=(1, 3))
        return a

    info = dict(rect=RECT, boxes=N, exposure=1.0, lights={}, cards={})
    EXPOSURE = 1.0
    alpha = load("shell-alpha-0001.exr")[..., :1]
    base = load("shell-base-0001.exr")[..., :3] * EXPOSURE
    H, W = base.shape[:2]
    # Where the glass is, the base holds only what the glass holds of the room (its reflection, on black);
    # how much of the universe shows through each point is kept beside the lights, below.
    save("base", srgb(base))
    # Every other light, at half size, side by side in one picture; each is stored as bright as it will go and its gain says how much to give back.
    names = [f"lamp{i}" for i in range(N)] + ["strips", "holo"]
    tiles = []
    for nme in names:
        a = half(load(f"shell-{nme}-0001.exr")[..., :3] * EXPOSURE)
        peak = max(1e-4, float(np.percentile(a.max(axis=2), 99.9)))
        gain = peak / 0.92
        tiles.append(srgb(a / gain))
        info["lights"][nme] = dict(tile=len(tiles) - 1, gain=round(gain, 4))
    info["glassTile"] = len(tiles)
    tiles.append(srgb(np.repeat(half(1.0 - alpha), 3, axis=2)))
    th, tw = tiles[0].shape[:2]
    while len(tiles) % 2:
        tiles.append(np.zeros_like(tiles[0]))
    rows = [np.concatenate(tiles[i:i + 2], axis=1) for i in range(0, len(tiles), 2)]
    save("lights", np.concatenate(rows, axis=0))
    info["lightsGrid"] = dict(cols=2, rows=len(rows), w=tw, h=th)
    # The cards: each cut from the picture it was taken in, lit by the room (the page adds what its own lamp does).
    rects = json.load(open(os.path.join(OUT, "cards.json")))
    ca = load("cards-alpha-0001.exr")[..., :1]
    cb = load("cards-base-0001.exr")[..., :3] + load("cards-strips-0001.exr")[..., :3]
    cH, cW = cb.shape[:2]
    # One picture holds them all: the top row is each card in the room's light, the row under it is
    # what the card's own light adds (a lamp's bulb, the chart's glow), for the page to turn up and down.
    crops, x_at, row_h = [], 0, 0
    for nme, r in rects.items():
        x0, x1 = int(r["x0"] * cW), int(math.ceil(r["x1"] * cW))
        y0, y1 = int(r["y0"] * cH), int(math.ceil(r["y1"] * cH))
        a_ = ca[y0:y1, x0:x1]
        own = load(f"cards-{'holo' if nme == 'table' else nme}-0001.exr")[y0:y1, x0:x1, :3] * EXPOSURE
        gain = max(1e-4, float(np.percentile(own.max(axis=2), 99.5))) / 0.92
        crops.append((x_at, np.concatenate([srgb(cb[y0:y1, x0:x1] * EXPOSURE / np.maximum(a_, 1e-3)), a_], axis=2),
                      np.concatenate([srgb(own / gain), a_], axis=2)))
        entry = dict(x0=RECT["x0"] + x0 / cW * (RECT["x1"] - RECT["x0"]), x1=RECT["x0"] + x1 / cW * (RECT["x1"] - RECT["x0"]),
                     y0=RECT["y0"] + y0 / cH * (RECT["y1"] - RECT["y0"]), y1=RECT["y0"] + y1 / cH * (RECT["y1"] - RECT["y0"]),
                     at=[x_at, 0, x1 - x0, y1 - y0], ownGain=round(gain, 4))
        if nme == "table":
            entry.update(z=CFG["holo"]["z"])
        else:
            entry.update(z=WALK_Z, x=POOL_X[int(nme[4:])], lamp=int(nme[4:]))
        info["cards"][nme] = entry
        x_at += x1 - x0 + 2
        row_h = max(row_h, y1 - y0)
    sheet = np.zeros((row_h * 2 + 2, x_at, 4), np.float32)
    for x_at, lit, own in crops:
        h_, w_ = lit.shape[:2]
        sheet[:h_, x_at:x_at + w_] = lit
        sheet[row_h + 2:row_h + 2 + h_, x_at:x_at + w_] = own
    save("cards", sheet)
    info["cardsSheet"] = dict(w=sheet.shape[1], h=sheet.shape[0], ownRow=row_h + 2)
    info["layout"] = dict(wallX=WALL_X, poolX=POOL_X, poolR=POOL_R, boxW=BOX_W, boxH=BOX_H, boxY=BOX_Y, lampY=LAMP_Y, sill=SILL, head=HEAD, doorX=DOOR_X, boardX=BOARD_X)
    json.dump(info, open(os.path.join(pack, "plate.json"), "w"), indent=1)
    # One picture to look at: every light on, over a plain night sky.
    look = base.copy()
    for nme in names:
        a = load(f"shell-{nme}-0001.exr")[..., :3]
        look += a * (0.8 if nme.startswith("lamp") and nme in ("lamp0", "lamp2") else 0.15 if nme.startswith("lamp") else 1.0)
    sky = np.array([0.01, 0.015, 0.05], np.float32)
    save("look", srgb(look + sky * (1 - alpha)))
    print(f"packed after {time.time() - T0:.1f} s")
else:
    raise SystemExit(f"no pass named {PASS}")
