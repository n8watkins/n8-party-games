# Builds the static set of the Cork & Bell stall and bakes its light with Cycles.
#
#   tools/blender/run.sh build_set.py <size> <samples> [what]
#     size     albedo atlas edge in pixels (512 for a test, 4096 for the real bake);
#              the lit light map is half that, the dusk light map a quarter
#     samples  Cycles samples for the light bakes
#     what     comma list of: glb, albedo, lit, dusk, env   (default: all)
#
# Outputs (in tools/blender/out): set.glb, set_albedo.jpg, set_lit.jpg, set_dusk.jpg, env.hdr
# The game multiplies albedo by light: lit = bulbs + dusk sky, dusk = sky only. Both light maps
# are stored divided by LIGHT_RANGE so bright pools near the bulbs keep their shape.
#
# Coordinates: the game uses x right, y up, z towards the player. Blender is z up, so a game
# point (x, y, z) is the Blender point (x, -z, y). Helpers below take game coordinates.
import bpy, bmesh, sys, os, json, math, time, functools
print = functools.partial(print, flush=True)
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
OUT, HERE = args[0], args[1]
SIZE = int(args[2]) if len(args) > 2 else 512
SAMPLES = int(args[3]) if len(args) > 3 else 16
WHAT = set((args[4] if len(args) > 4 else "glb,albedo,lit,dusk,env").split(","))
LIGHT_RANGE = 4.0
L = json.load(open(os.path.join(HERE, "layout.json")))
FONT_DIR = os.path.join(HERE, "..", "fonts")
T0 = time.time()

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
# CPU on purpose: on this machine the AMD HIP runtime (amdhip64.dll) crashed or ran away with
# memory during light bakes, so the GPU is not used for Cycles.
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.cycles.max_bounces = 5
scene.cycles.diffuse_bounces = 3
scene.cycles.sample_clamp_indirect = 6.0
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"


def G(x, y, z):
    """Game point -> Blender point."""
    return Vector((x, -z, y))


# ------------------------------------------------------------------ materials

def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = [n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"][0]
    bsdf = nt.nodes.new("ShaderNodeBsdfDiffuse")
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    return m, nt, bsdf


def N(nt, kind, **props):
    n = nt.nodes.new(kind)
    for k, v in props.items():
        setattr(n, k, v)
    return n


def link(nt, a, b):
    nt.links.new(a, b)


def mix(nt, fac, a, b, blend="MIX"):
    n = N(nt, "ShaderNodeMix", data_type="RGBA", blend_type=blend)
    for sock, val in ((n.inputs[0], fac), (n.inputs[6], a), (n.inputs[7], b)):
        if hasattr(val, "links"):
            link(nt, val, sock)
        elif isinstance(val, (int, float)):
            sock.default_value = val
        else:
            sock.default_value = (*val, 1.0)
    return n.outputs[2]


def math_node(nt, op, a, b=None, c=None):
    n = N(nt, "ShaderNodeMath", operation=op)
    for sock, val in zip(n.inputs, (a, b, c)):
        if val is None:
            continue
        if hasattr(val, "links"):
            link(nt, val, sock)
        else:
            sock.default_value = val
    return n.outputs[0]


def ramp(nt, fac, stops, constant=False):
    n = N(nt, "ShaderNodeValToRGB")
    cr = n.color_ramp
    cr.interpolation = "CONSTANT" if constant else "LINEAR"
    while len(cr.elements) < len(stops):
        cr.elements.new(0.5)
    for el, (pos, col) in zip(cr.elements, stops):
        el.position = pos
        el.color = (*col, 1.0) if len(col) == 3 else col
    link(nt, fac, n.inputs[0])
    return n.outputs[0]


def coords(nt, scale=(1, 1, 1)):
    tc = N(nt, "ShaderNodeTexCoord")
    mp = N(nt, "ShaderNodeMapping")
    mp.inputs["Scale"].default_value = scale
    link(nt, tc.outputs["Object"], mp.inputs[0])
    return mp.outputs[0], tc.outputs["Object"]


def noise(nt, vec, scale, detail=4.0, rough=0.55):
    n = N(nt, "ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    link(nt, vec, n.inputs["Vector"])
    return n.outputs["Fac"]


def cork_marks(nt, obj, amount, hot=None):
    """Where corks have struck: pale rings the size of a cork's end, smudges and specks, each of
    its own size and strength. They gather in loose patches, and thickly around the `hot` places
    (game points with a radius); away from those a board carries only a few."""
    where = noise(nt, obj, 2.6, 3.0, 0.6)
    density = ramp(nt, where, [(0.56 - amount * 0.2, (0, 0, 0)), (0.84 - amount * 0.2, (1, 1, 1))])
    if hot:
        heat = None
        for x, y, z, r in hot:
            d = N(nt, "ShaderNodeVectorMath", operation="DISTANCE")
            link(nt, obj, d.inputs[0])
            d.inputs[1].default_value = G(x, y, z)
            h = ramp(nt, d.outputs["Value"], [(r * 0.25, (1, 1, 1)), (r, (0, 0, 0))])
            heat = h if heat is None else math_node(nt, "MAXIMUM", heat, h)
        patchy = math_node(nt, "MULTIPLY_ADD", where, 0.9, 0.45)
        density = math_node(nt, "ADD", math_node(nt, "MULTIPLY", density, 0.22), math_node(nt, "MULTIPLY", heat, patchy))
    marks = None
    # (cells per metre, smallest and largest mark as a part of a cell, a ring?, strength, share of cells marked)
    for scale, lo, hi, ring, strength, share in ((11.0, 0.1, 0.17, True, 0.9, 0.5), (23.0, 0.12, 0.34, False, 0.75, 0.7), (47.0, 0.15, 0.4, False, 0.55, 0.4)):
        v = N(nt, "ShaderNodeTexVoronoi", feature="F1")
        v.inputs["Scale"].default_value = scale
        link(nt, obj, v.inputs["Vector"])
        rnd = N(nt, "ShaderNodeSeparateXYZ")
        link(nt, v.outputs["Color"], rnd.inputs[0])
        u = math_node(nt, "DIVIDE", v.outputs["Distance"], math_node(nt, "MULTIPLY_ADD", rnd.outputs[0], hi - lo, lo))
        m = ramp(nt, u, [(0.6, (1, 1, 1)), (1.0, (0, 0, 0))])
        if ring:
            m = math_node(nt, "SUBTRACT", m, math_node(nt, "MULTIPLY", ramp(nt, u, [(0.3, (1, 1, 1)), (0.62, (0, 0, 0))]), 0.7))
        keep = math_node(nt, "LESS_THAN", rnd.outputs[1], math_node(nt, "MULTIPLY", density, share))
        m = math_node(nt, "MULTIPLY", math_node(nt, "MULTIPLY", m, keep), math_node(nt, "MULTIPLY_ADD", rnd.outputs[2], 0.5 * strength, 0.5 * strength))
        marks = m if marks is None else math_node(nt, "MAXIMUM", marks, m)
    return marks


def paint(name, base, under=(0.42, 0.3, 0.2), chip=0.5, grain=(1, 1, 9), scuff=0.0, plank=None,
          stripes=None, bump=0.25, dents=0.0, dirt=0.35, hot=None):
    """Hand-painted wood (or canvas): brush strokes along `grain`, chips down to the wood,
    pale scuffs where corks have struck, plank joints, optional stripes.
    grain is the Blender-space stretch: strokes run along the axis with the SMALL scale.
    plank = (axis index in Blender space, width). stripes = (axis index, width, second colour).
    hot = [(x, y, z, radius)] in game coordinates: where the corks mostly land (see cork_marks)."""
    m, nt, bsdf = new_mat(name)
    stretched, obj = coords(nt, grain)
    sep = N(nt, "ShaderNodeSeparateXYZ")
    link(nt, obj, sep.inputs[0])
    strokes = noise(nt, stretched, 46.0, 5.0, 0.6)
    broad = noise(nt, obj, 2.3, 3.0, 0.5)
    col = base
    if stripes:
        axis, width, second = stripes
        f = math_node(nt, "FRACT", math_node(nt, "DIVIDE", sep.outputs[axis], width * 2))
        wob = math_node(nt, "MULTIPLY", math_node(nt, "SUBTRACT", noise(nt, obj, 14.0, 2.0), 0.5), 0.02)
        f = math_node(nt, "ADD", f, wob)
        col = mix(nt, ramp(nt, f, [(0.0, (0, 0, 0)), (0.5, (1, 1, 1))], constant=True), base, second)
    # Brush strokes: the paint is a little thicker and darker in streaks.
    col = mix(nt, ramp(nt, strokes, [(0.3, (0.78, 0.78, 0.78)), (0.72, (1.08, 1.08, 1.08))]), (0, 0, 0), col, "MULTIPLY") if False else col
    streak = N(nt, "ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    streak.inputs[0].default_value = 1.0
    if hasattr(col, "links"):
        link(nt, col, streak.inputs[6])
    else:
        streak.inputs[6].default_value = (*col, 1.0)
    link(nt, ramp(nt, strokes, [(0.28, (0.74, 0.74, 0.76)), (0.75, (1.0, 1.0, 1.0))]), streak.inputs[7])
    col = streak.outputs[2]
    # Grime: darker in broad soft patches.
    col = mix(nt, math_node(nt, "MULTIPLY", ramp(nt, broad, [(0.35, (0, 0, 0)), (0.75, (1, 1, 1))]), dirt), col, (0.1, 0.075, 0.06))
    height = strokes
    if plank:
        axis, width = plank
        f = math_node(nt, "FRACT", math_node(nt, "DIVIDE", sep.outputs[axis], width))
        edge = math_node(nt, "MINIMUM", f, math_node(nt, "SUBTRACT", 1.0, f))
        groove = ramp(nt, edge, [(0.0, (0, 0, 0)), (0.035, (1, 1, 1))])
        col = mix(nt, groove, (0.03, 0.022, 0.018), col)
        height = math_node(nt, "ADD", math_node(nt, "MULTIPLY", strokes, 0.35), groove)
    if chip > 0:
        chips = noise(nt, obj, 7.5, 9.0, 0.72)
        fine = noise(nt, obj, 38.0, 4.0, 0.6)
        mask = math_node(nt, "ADD", chips, math_node(nt, "MULTIPLY", fine, 0.22))
        t = 0.83 - chip * 0.12
        chipped = ramp(nt, mask, [(t, (0, 0, 0)), (t + 0.012, (1, 1, 1))])
        wood = mix(nt, strokes, tuple(c * 0.7 for c in under), under)
        col = mix(nt, chipped, col, wood)
        height = math_node(nt, "SUBTRACT", height, math_node(nt, "MULTIPLY", chipped, 0.6))
    if scuff > 0:
        col = mix(nt, math_node(nt, "MULTIPLY", cork_marks(nt, obj, scuff, hot), 0.8), col, (0.62, 0.52, 0.4))
    if dents > 0:
        v = N(nt, "ShaderNodeTexVoronoi", feature="SMOOTH_F1")
        v.inputs["Scale"].default_value = 9.0
        v.inputs["Smoothness"].default_value = 0.6
        link(nt, obj, v.inputs["Vector"])
        height = math_node(nt, "ADD", height, math_node(nt, "MULTIPLY", ramp(nt, v.outputs["Distance"], [(0.0, (0, 0, 0)), (0.3, (1, 1, 1))]), dents * 4.0))
    b = N(nt, "ShaderNodeBump")
    b.inputs["Strength"].default_value = bump
    b.inputs["Distance"].default_value = 0.004
    link(nt, height, b.inputs["Height"])
    link(nt, b.outputs[0], bsdf.inputs["Normal"])
    link(nt, col, bsdf.inputs["Color"])
    return m


def flat(name, colour):
    m, nt, bsdf = new_mat(name)
    _, obj = coords(nt)
    n = noise(nt, obj, 60.0, 3.0)
    link(nt, mix(nt, n, tuple(c * 0.8 for c in colour), colour), bsdf.inputs["Color"])
    return m


CREAM = (0.78, 0.66, 0.44)
OXBLOOD = (0.36, 0.05, 0.035)
GREEN = (0.035, 0.12, 0.085)
NAVY = (0.03, 0.055, 0.13)
GOLD = (0.72, 0.5, 0.14)
RED = (0.55, 0.07, 0.045)

M = {
    "back": paint("back", GREEN, chip=0.75, grain=(9, 1, 1), scuff=0.4, plank=(0, 0.1563), dents=1.0, bump=0.5,
                  hot=[(L["BELL"]["x"], L["BELL"]["y"], L["BACK"]["z"], 0.5)] + [(p["px"], p["py"] - p["len"], L["BACK"]["z"], 0.42) for p in L["PENDULUMS"]]),
    "pediment": paint("pediment", OXBLOOD, chip=0.45, grain=(1, 1, 9), scuff=0.2, bump=0.3),
    "riser": paint("riser", CREAM, under=(0.3, 0.2, 0.13), chip=0.7, grain=(1, 9, 9), scuff=0.3, bump=0.3),
    "tread": paint("tread", (0.2, 0.035, 0.03), chip=0.95, grain=(1, 9, 9), scuff=0.45, plank=(1, 0.125), bump=0.4),
    "wall": paint("wall", NAVY, chip=0.6, grain=(9, 9, 1), scuff=0.3, plank=(1, 0.14), bump=0.4),
    "canvas": paint("canvas", (0.74, 0.6, 0.4), chip=0, grain=(30, 30, 30), stripes=(1, 0.11, (0.5, 0.06, 0.045)), bump=0.08, dirt=0.5),
    "valance": paint("valance", (0.74, 0.6, 0.4), chip=0, grain=(30, 30, 30), stripes=(0, 0.09, (0.5, 0.06, 0.045)), bump=0.08, dirt=0.5),
    "counter": paint("counter", RED, under=(0.5, 0.36, 0.22), chip=1.25, grain=(1, 12, 12), scuff=0.4, plank=(1, 0.19), bump=0.45),
    "rail": paint("rail", (0.16, 0.1, 0.06), chip=0.3, grain=(1, 9, 9), bump=0.3),
    "gold": paint("gold", GOLD, under=(0.5, 0.1, 0.06), chip=0.55, grain=(3, 3, 3), bump=0.1, dirt=0.25),
    "cream": paint("creamp", CREAM, chip=0.4, grain=(3, 3, 9), bump=0.2),
    "red": paint("redp", RED, chip=0.5, grain=(3, 3, 9), bump=0.2),
    "green": paint("greenp", (0.05, 0.2, 0.13), chip=0.5, grain=(3, 3, 9), bump=0.2),
    "blue": paint("bluep", (0.05, 0.13, 0.3), chip=0.5, grain=(3, 3, 9), bump=0.2),
    "black": flat("black", (0.012, 0.012, 0.014)),
    "slate": paint("slate", (0.03, 0.035, 0.04), under=(0.2, 0.2, 0.2), chip=0.3, grain=(4, 4, 4), bump=0.05, dirt=0.1),
    "floor": paint("floor", (0.2, 0.15, 0.1), chip=0.4, grain=(1, 9, 1), plank=(0, 0.16), bump=0.5),
    "iron": flat("iron", (0.02, 0.02, 0.022)),
}

# ------------------------------------------------------------------ geometry

parts = []


def finish(obj, mat, smooth=False):
    obj.data.materials.append(M[mat] if isinstance(mat, str) else mat)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    parts.append(obj)
    return obj


def mesh_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def box(name, x0, x1, y0, y1, z0, z1, mat, bevel=0.004):
    """A box given in game coordinates (y up, z towards the player)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
    for v in bm.verts:
        v.co = G(cx + v.co.x * abs(x1 - x0), cy + v.co.z * abs(y1 - y0), cz - v.co.y * abs(z1 - z0))
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES", profile=0.5)
    return finish(mesh_obj(name, bm), mat)


def outline(name, pts, z, depth, mat):
    """A flat shape in the x-y plane (game coordinates), extruded `depth` towards the player from z."""
    bm = bmesh.new()
    vs = [bm.verts.new(G(x, y, z)) for x, y in pts]
    face = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co += G(0, 0, depth)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return finish(mesh_obj(name, bm), mat)


def lathe(name, profile, at, mat, steps=28):
    """A turned shape: profile is [(radius, height)], spun about the vertical axis at game point `at`."""
    bm = bmesh.new()
    rings = []
    for r, h in profile:
        rings.append([bm.verts.new(G(at[0] + r * math.cos(a), at[1] + h, at[2] + r * math.sin(a)))
                      for a in (i * 2 * math.pi / steps for i in range(steps))])
    for a, b in zip(rings, rings[1:]):
        for i in range(steps):
            j = (i + 1) % steps
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return finish(mesh_obj(name, bm), mat, smooth=True)


FONTS = {}


def font(file):
    if file not in FONTS:
        FONTS[file] = bpy.data.fonts.load(os.path.join(FONT_DIR, file))
    return FONTS[file]


def text(body, x, y, z, size, mat, face="AbrilFatface-Regular.ttf", facing="front", shadow=None, spacing=1.0, depth=0.0012):
    """Sign-writer lettering: flat paint a hair proud of the board, with an optional drop shade.
    facing: front (towards the player), left (on the right wall, facing -x), right (on the left wall)."""
    made = []
    for layer, (dx, dy, dz, material) in enumerate(([(0.0, 0.0, 0.0, mat)] + ([(shadow[0], shadow[1], -0.0006, shadow[2])] if shadow else []))):
        cu = bpy.data.curves.new(body, "FONT")
        cu.body = body
        cu.font = font(face)
        cu.size = size
        cu.align_x = "CENTER"
        cu.align_y = "CENTER"
        cu.space_character = spacing
        cu.extrude = depth / 2
        ob = bpy.data.objects.new(body + str(layer), cu)
        scene.collection.objects.link(ob)
        if facing == "front":
            ob.rotation_euler = (math.pi / 2, 0, 0)
            ob.location = G(x + dx, y + dy, z + dz)
        elif facing == "left":
            ob.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
            ob.location = G(x + dz, y + dy, z + dx)
        else:
            ob.rotation_euler = (math.pi / 2, 0, math.pi / 2)
            ob.location = G(x - dz, y + dy, z - dx)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.ops.object.convert(target="MESH")
        made.append(finish(bpy.context.object, material))
    return made


def text_width(body, size, face):
    """How wide a line of lettering comes out, in metres."""
    cu = bpy.data.curves.new("measure", "FONT")
    cu.body = body
    cu.font = font(face)
    cu.size = size
    ob = bpy.data.objects.new("measure", cu)
    scene.collection.objects.link(ob)
    me = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    xs = [v.co.x for v in me.vertices]
    w = max(xs) - min(xs)
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    return w


def arc_text(body, cx, cy, rx, ry, z, mat, span=0.7, max_size=0.1, face="PlayfairDisplay-Black.ttf", shadow=None, gap=0.07):
    """Lettering set letter by letter along the top of an ellipse (centre cx, cy), as a sign-writer
    arches a name over a pediment. It is sized to fill `span` of the half ellipse."""
    hh = text_width("HH", 1.0, face)
    units = [text_width("H" + ch + "H", 1.0, face) - hh + gap for ch in body]
    pts = [(cx - rx * math.cos(k * math.pi / 400), cy + ry * math.sin(k * math.pi / 400)) for k in range(401)]
    run = [0.0]
    for a, b in zip(pts, pts[1:]):
        run.append(run[-1] + math.dist(a, b))
    size = min(max_size, span * run[-1] / sum(units))
    print("ARC TEXT", body, "size", round(size, 4), "length", round(size * sum(units), 3), "of", round(run[-1], 3))
    s = run[-1] / 2 - size * sum(units) / 2
    k = 0
    for ch, unit in zip(body, units):
        mid = s + size * unit / 2
        s += size * unit
        if ch == " ":
            continue
        while run[k + 1] < mid:
            k += 1
        f = (mid - run[k]) / (run[k + 1] - run[k])
        px = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f
        py = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f
        turn = math.atan2(pts[k + 1][1] - pts[k][1], pts[k + 1][0] - pts[k][0])
        for layer, (dx, dy, dz, material) in enumerate(([(0.0, 0.0, 0.0, mat)] + ([(shadow[0], shadow[1], -0.0006, shadow[2])] if shadow else []))):
            cu = bpy.data.curves.new(ch, "FONT")
            cu.body = ch
            cu.font = font(face)
            cu.size = size
            cu.align_x = "CENTER"
            cu.align_y = "CENTER"
            cu.extrude = 0.0006
            cu.resolution_u = 5
            ob = bpy.data.objects.new(ch + str(layer), cu)
            scene.collection.objects.link(ob)
            ob.matrix_world = Matrix.Translation(G(px + dx, py + dy, z + dz)) @ Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Rotation(turn, 4, "Z")
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.select_all(action="DESELECT")
            ob.select_set(True)
            bpy.ops.object.convert(target="MESH")
            finish(bpy.context.object, material)


W = L["HALF_W"]
steps_ = L["STEPS"]
back = L["BACK"]
counter = L["COUNTER"]

# Floor and counter.
box("floor", -1.3, 1.3, -0.04, 0.0, -0.3, -1.42, "floor", bevel=0)
box("counter_top", -1.36, 1.36, counter["top"] - 0.05, counter["top"], counter["zFront"], counter["zBack"], "counter", bevel=0.008)
box("counter_front", -1.3, 1.3, 0.0, counter["top"] - 0.05, counter["zFront"] - 0.03, counter["zFront"] - 0.06, "wall")
box("counter_lip", -1.36, 1.36, counter["top"], counter["top"] + 0.012, counter["zBack"] + 0.03, counter["zBack"], "gold", bevel=0.003)
tray = L["TRAY"]
tx0, tx1, tz0, tz1 = tray["x"] - tray["w"] / 2, tray["x"] + tray["w"] / 2, tray["z"] + tray["d"] / 2, tray["z"] - tray["d"] / 2
ty = counter["top"]
box("tray_floor", tx0, tx1, ty, ty + 0.006, tz0, tz1, "rail", bevel=0.001)
for nm, a in (("l", (tx0 - 0.012, tx0, tz0 + 0.012, tz1 - 0.012)), ("r", (tx1, tx1 + 0.012, tz0 + 0.012, tz1 - 0.012)),
              ("f", (tx0, tx1, tz0 + 0.012, tz0)), ("b", (tx0, tx1, tz1, tz1 - 0.012))):
    box("tray_" + nm, a[0], a[1], ty, ty + 0.04, a[2], a[3], "green", bevel=0.003)

# The three steps: treads the corks land on, risers with painted panels.
values = ["10", "25", "50"]
SL = L["STEP_LEFT"]
box("gutter_floor", -1.3, SL, -0.04, 0.0, -1.42, -2.82, "floor", bevel=0)
for i, s in enumerate(steps_):
    prev_top = 0.0 if i == 0 else steps_[i - 1]["top"]
    # The steps stop short of the left wall: the drive runs in the gap, in plain view.
    box(f"tread{i}", SL, W, s["top"] - 0.03, s["top"], s["zFront"] + 0.012, s["zBack"], "tread", bevel=0.005)
    box(f"riser{i}", SL, W, prev_top - 0.02 if i else 0.0, s["top"] - 0.03, s["zFront"], s["zFront"] - 0.02, "riser", bevel=0)
    box(f"stepside{i}", SL, SL + 0.02, 0.0, s["top"] - 0.03, s["zFront"] - 0.02, s["zBack"], "wall", bevel=0)
    zf = s["zFront"] + 0.0015
    top, bot = s["top"] - 0.05, max(prev_top, 0.5) + 0.03
    h = top - bot
    # Gold lines top and bottom, a red band between, and the row's value in roundels.
    box(f"line_t{i}", SL + 0.04, W - 0.04, top - 0.012, top, zf + 0.001, zf, "gold", bevel=0)
    box(f"line_b{i}", SL + 0.04, W - 0.04, bot, bot + 0.012, zf + 0.001, zf, "gold", bevel=0)
    box(f"band{i}", SL + 0.04, W - 0.04, bot + 0.035, top - 0.035, zf + 0.0006, zf, ["red", "blue", "green"][i], bevel=0)
    for sx in (-0.84, -0.5, 0.56, 0.98) if i == 0 else (-0.56, 0.06, 0.68):
        rad = min(h * 0.44, 0.1)
        ring = [(sx + math.cos(a) * rad, (top + bot) / 2 + math.sin(a) * rad) for a in (k * 2 * math.pi / 40 for k in range(40))]
        outline(f"roundel{i}", ring, zf + 0.0008, 0.0008, "cream")
        ring2 = [(sx + math.cos(a) * rad * 1.1, (top + bot) / 2 + math.sin(a) * rad * 1.1) for a in (k * 2 * math.pi / 40 for k in range(40))]
        outline(f"roundel_edge{i}", ring2, zf + 0.0004, 0.0006, "gold")
        text(values[i], sx, (top + bot) / 2 - rad * 0.04, zf + 0.0026, rad * 1.02, "black" if i != 2 else "red")
    if i == 0:
        text("TEN  A  POT", 0.03, (top + bot) / 2, zf + 0.0026, 0.07, "gold", face="PlayfairDisplay-BlackItalic.ttf", shadow=(0.006, -0.006, "black"), spacing=1.1)
    # The slot the mid row's chain runs in.
box("chain_slot", -L["CHAIN"]["span"] / 2 - 0.05, L["CHAIN"]["span"] / 2 + 0.05, steps_[1]["top"] - 0.001, steps_[1]["top"] + 0.0015, L["CHAIN"]["z"] + 0.016, L["CHAIN"]["z"] - 0.016, "black", bevel=0)

# Back board with its arched pediment.
bz = back["z"]
box("back", -W, W, steps_[2]["top"] - 0.05, back["top"], bz, bz - 0.04, "back", bevel=0)
arch = [(-W, back["top"] - 0.001), (W, back["top"] - 0.001), (W, back["top"] + 0.1), (back["archHalfW"] + 0.14, back["top"] + 0.1)]
for k in range(33):
    a = k * math.pi / 32
    arch.append((math.cos(a) * (back["archHalfW"] + 0.08), back["top"] + 0.1 + math.sin(a) * (back["archH"] + 0.02)))
arch += [(-back["archHalfW"] - 0.14, back["top"] + 0.1), (-W, back["top"] + 0.1)]
outline("pediment", arch, bz - 0.04, 0.05, "pediment")
box("cornice", -W - 0.03, W + 0.03, back["top"] - 0.03, back["top"] + 0.02, bz + 0.035, bz - 0.04, "gold", bevel=0.006)
# Gold frame lines on the back board.
for nm, a in (("t", (-W + 0.14, W - 0.14, 2.085, 2.097)), ("b", (-W + 0.14, W - 0.14, 1.69, 1.702)),
              ("l", (-W + 0.14, -W + 0.152, 1.69, 2.097)), ("r", (W - 0.152, W - 0.14, 1.69, 2.097))):
    box("frame_" + nm, a[0], a[1], a[2], a[3], bz + 0.0012, bz, "gold", bevel=0)
text("CORK", -0.6, 1.9, bz + 0.003, 0.25, "gold", shadow=(0.011, -0.011, "red"), spacing=1.06)
text("BELL", 0.6, 1.9, bz + 0.003, 0.25, "gold", shadow=(0.011, -0.011, "red"), spacing=1.06)
sw = L["SCORE_WINDOW"]
box("score_box", -sw["w"] / 2 - 0.035, sw["w"] / 2 + 0.035, sw["y"] - sw["h"] / 2 - 0.03, sw["y"] + sw["h"] / 2 + 0.03, bz + 0.03, bz + 0.005, "gold", bevel=0.006)
box("score_hole", -sw["w"] / 2, sw["w"] / 2, sw["y"] - sw["h"] / 2, sw["y"] + sw["h"] / 2, bz + 0.0312, bz + 0.03, "black", bevel=0)
# The name is arched over the score window, big enough to read from the counter; the second
# line is lettered along the cornice below it.
arc_text("WREN & TOLLIVER'S", 0.0, back["top"] + 0.06, 0.5, 0.262, bz + 0.012, "gold", shadow=(0.005, -0.005, "black"))
text("TRAVELLING  GALLERY", 0.0, back["top"] - 0.006, bz + 0.0365, 0.038, "black", face="PlayfairDisplay-Black.ttf", spacing=1.4)
# The bell's bracket and the shutter lantern's box stand on the far step.
sh = L["SHUTTER"]
box("lantern_l", sh["x"] - 0.115, sh["x"] - 0.095, steps_[2]["top"], sh["y"] + 0.105, sh["z"] + 0.02, sh["z"] - 0.07, "red", bevel=0.003)
box("lantern_r", sh["x"] + 0.095, sh["x"] + 0.115, steps_[2]["top"], sh["y"] + 0.105, sh["z"] + 0.02, sh["z"] - 0.07, "red", bevel=0.003)
box("lantern_top", sh["x"] - 0.13, sh["x"] + 0.13, sh["y"] + 0.105, sh["y"] + 0.125, sh["z"] + 0.03, sh["z"] - 0.075, "gold", bevel=0.004)
box("lantern_back", sh["x"] - 0.095, sh["x"] + 0.095, steps_[2]["top"], sh["y"] + 0.105, sh["z"] - 0.06, sh["z"] - 0.07, "black", bevel=0)

# Side walls: painted boards below, laced striped canvas above.
for side in (-1, 1):
    x0, x1 = (W, W + 0.04) if side > 0 else (-W - 0.04, -W)
    box(f"wall{side}", x0, x1, 0.0, 1.3, 0.3, bz - 0.04, "wall", bevel=0)
    box(f"wallrail{side}", x0 - 0.012, x1 + 0.012, 1.3, 1.345, 0.3, bz - 0.04, "gold", bevel=0.005)
    box(f"canvas{side}", x0 + 0.012, x1 - 0.012, 1.345, 2.2, 0.3, bz - 0.04, "canvas", bevel=0)
    box(f"walltop{side}", x0 - 0.01, x1 + 0.01, 2.2, 2.25, 0.3, bz - 0.04, "rail", bevel=0.006)
    box(f"post{side}", x0 - 0.02, x1 + 0.02, 0.0, 2.34, bz + 0.03, bz - 0.06, "pediment", bevel=0.01)
    lathe(f"finial{side}", [(0.03, 0.0), (0.045, 0.02), (0.02, 0.05), (0.05, 0.1), (0.052, 0.13), (0.03, 0.17), (0.0, 0.18)], ((x0 + x1) / 2, 2.34, bz - 0.015), "gold")

# Prize shelf on the right wall, with turned and painted prizes.
ps = L["PRIZE_SHELF"]
box("prize_shelf", ps["x"] - 0.17, ps["x"], ps["y"] - 0.025, ps["y"], ps["z0"], ps["z1"], "rail", bevel=0.005)
box("prize_lip", ps["x"] - 0.176, ps["x"] - 0.166, ps["y"] - 0.035, ps["y"] + 0.012, ps["z0"], ps["z1"], "gold", bevel=0.003)
box("prize_bulb_rail", ps["x"] - 0.03, ps["x"], 1.875, 1.905, ps["z0"], ps["z1"], "rail", bevel=0.004)
prize_shapes = [
    ([(0.0, 0.0), (0.05, 0.0), (0.055, 0.02), (0.03, 0.06), (0.06, 0.13), (0.062, 0.17), (0.035, 0.22), (0.045, 0.25), (0.0, 0.25)], "blue"),
    ([(0.0, 0.0), (0.035, 0.0), (0.05, 0.05), (0.05, 0.12), (0.022, 0.17), (0.03, 0.2), (0.022, 0.24), (0.0, 0.245)], "cream"),
    ([(0.0, 0.0), (0.012, 0.0), (0.07, 0.07), (0.072, 0.09), (0.02, 0.13), (0.012, 0.2), (0.0, 0.2)], "red"),
    ([(0.0, 0.0), (0.045, 0.0), (0.045, 0.012), (0.012, 0.03), (0.012, 0.09), (0.06, 0.16), (0.064, 0.21), (0.056, 0.21), (0.0, 0.2)], "gold"),
    ([(0.0, 0.0), (0.04, 0.0), (0.066, 0.05), (0.07, 0.1), (0.045, 0.16), (0.0, 0.17)], "green"),
]
for i, (profile, colour) in enumerate(prize_shapes):
    lathe(f"prize{i}", profile, (ps["x"] - 0.09, ps["y"], -1.3 - i * 0.2), colour)

# The chalk board for the day's best scores, on the left wall.
cb = L["CHALK_BOARD"]
box("chalk_frame", -W, -W + 0.014, cb["y"] - cb["h"] / 2 - 0.03, cb["y"] + cb["h"] / 2 + 0.03, cb["z"] + cb["w"] / 2 + 0.03, cb["z"] - cb["w"] / 2 - 0.03, "gold", bevel=0.004)
box("chalk_slate", -W + 0.004, -W + 0.016, cb["y"] - cb["h"] / 2, cb["y"] + cb["h"] / 2, cb["z"] + cb["w"] / 2, cb["z"] - cb["w"] / 2, "slate", bevel=0)

# The awning: a beam, a scalloped valance, and the canvas rising towards the player.
vz = L["AWNING"]["z"]
ab = L["AWNING"]["beam"]  # the underside of the beam the valance hangs from
box("awning_beam", -1.6, 1.6, ab, ab + 0.08, vz + 0.03, vz - 0.03, "pediment", bevel=0.008)
val = [(-1.6, ab), (1.6, ab)]
n_scallop = 16
wsc = 3.2 / n_scallop
for k in range(n_scallop):
    cx = 1.6 - (k + 0.5) * wsc
    for j in range(13):
        a = -j * math.pi / 12
        val.append((cx + math.cos(a) * wsc / 2, ab - 0.2 + math.sin(a) * 0.085))
outline("valance", val, vz + 0.034, 0.004, "valance")
bm = bmesh.new()
quad = [bm.verts.new(G(*p)) for p in ((-1.7, ab + 0.07, vz), (1.7, ab + 0.07, vz), (1.7, ab + 0.78, 1.2), (-1.7, ab + 0.78, 1.2))]
bm.faces.new(quad)
bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=10, use_grid_fill=True)
for v in bm.verts:
    v.co.z -= 0.035 * math.sin((v.co.y + 0.95) * 2.4) ** 2
finish(mesh_obj("awning", bm), "valance")

# Bulb holders: turned black sockets with a gilt collar, one per bulb.
for group, pts in L["BULBS"].items():
    for i, (x, y, z) in enumerate(pts):
        if group == "border":
            box(f"sock_{group}{i}", x - 0.013, x + 0.013, y - 0.013, y + 0.013, z - 0.02, bz, "iron", bevel=0.003)
        elif group == "key":
            box(f"sock_{group}{i}", x - 0.012, x + 0.012, y + 0.03, ab - 0.18, z + 0.012, z - 0.012, "iron", bevel=0.003)
        elif group == "prize":
            box(f"sock_{group}{i}", x, x + 0.06, y - 0.012, y + 0.012, z + 0.012, z - 0.012, "iron", bevel=0.003)

print("GEOMETRY", len(parts), "parts", round(time.time() - T0, 1), "s")

# ------------------------------------------------------------------ join and unwrap

bpy.ops.object.select_all(action="DESELECT")
for ob in parts:
    ob.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
stall = bpy.context.object
stall.name = "set"
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bpy.ops.uv.select_all(action="SELECT")
bpy.ops.uv.pack_islands(margin=0.0016, rotate=True)
bpy.ops.object.mode_set(mode="OBJECT")
print("VERTS", len(stall.data.vertices), "POLYS", len(stall.data.polygons), "MATS", len(stall.data.materials))
tris = sum(len(p.vertices) - 2 for p in stall.data.polygons)
print("UNWRAPPED", tris, "triangles", round(time.time() - T0, 1), "s")

# ------------------------------------------------------------------ light

world = bpy.data.worlds.new("dusk")
scene.world = world
world.use_nodes = True
wn = world.node_tree
bg = wn.nodes["Background"]
tc = wn.nodes.new("ShaderNodeTexCoord")
sep = wn.nodes.new("ShaderNodeSeparateXYZ")
wn.links.new(tc.outputs["Generated"], sep.inputs[0])
cr = wn.nodes.new("ShaderNodeValToRGB")
# Blue dusk: a pale warm band low on the horizon rising to deep blue. Keep in step with sky.js.
SKY = [(0.0, (0.012, 0.016, 0.03)), (0.47, (0.03, 0.04, 0.075)), (0.5, (0.5, 0.3, 0.2)), (0.56, (0.2, 0.2, 0.33)), (0.68, (0.055, 0.1, 0.27)), (1.0, (0.012, 0.03, 0.12))]
while len(cr.color_ramp.elements) < len(SKY):
    cr.color_ramp.elements.new(0.5)
for el, (pos, col) in zip(cr.color_ramp.elements, SKY):
    el.position = pos
    el.color = (*col, 1.0)
mp = wn.nodes.new("ShaderNodeMath")
mp.operation = "MULTIPLY_ADD"
mp.inputs[1].default_value = 0.5
mp.inputs[2].default_value = 0.5
wn.links.new(sep.outputs[2], mp.inputs[0])
wn.links.new(mp.outputs[0], cr.inputs[0])
wn.links.new(cr.outputs[0], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 1.0

WARM = (1.0, 0.56, 0.24)
WATTS = {"border": 0.55, "key": 9.0, "festoon": 3.0, "prize": 0.5}
lamps = []
glows = []
glow_mat = bpy.data.materials.new("glow")
glow_mat.use_nodes = True
gn = glow_mat.node_tree
for n in list(gn.nodes):
    if n.type != "OUTPUT_MATERIAL":
        gn.nodes.remove(n)
em = gn.nodes.new("ShaderNodeEmission")
em.inputs["Color"].default_value = (*WARM, 1.0)
em.inputs["Strength"].default_value = 60.0
gn.links.new(em.outputs[0], [n for n in gn.nodes if n.type == "OUTPUT_MATERIAL"][0].inputs[0])
for group, pts in L["BULBS"].items():
    for i, (x, y, z) in enumerate(pts):
        ld = bpy.data.lights.new(f"{group}{i}", "POINT")
        ld.energy = WATTS[group]
        ld.color = WARM
        ld.shadow_soft_size = 0.024
        lo = bpy.data.objects.new(f"{group}{i}", ld)
        lo.location = G(x, y, z)
        scene.collection.objects.link(lo)
        lamps.append(lo)
        # A glowing ball for the environment picture only: it lights nothing.
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.024)
        for v in bm.verts:
            v.co += G(x, y, z)
        go = mesh_obj(f"glow_{group}{i}", bm)
        go.data.materials.append(glow_mat)
        go.visible_diffuse = False
        go.visible_shadow = False
        go.hide_render = True
        glows.append(go)


def set_bulbs(on):
    for lo in lamps:
        lo.hide_render = not on


# ------------------------------------------------------------------ baking

def bake_image(name, size):
    img = bpy.data.images.new(name, size, size, float_buffer=True, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    for mat in stall.data.materials:
        nt = mat.node_tree
        node = nt.nodes.get("BAKE") or nt.nodes.new("ShaderNodeTexImage")
        node.name = "BAKE"
        node.image = img
        nt.nodes.active = node
    return img


def save_jpg(img, file, scale=1.0, denoise=False, quality=92):
    """Runs the baked image through the compositor (scale, optional denoise) and writes a JPEG."""
    scene.use_nodes = True
    ct = scene.node_tree
    ct.nodes.clear()
    src = ct.nodes.new("CompositorNodeImage")
    src.image = img
    last = src.outputs[0]
    if denoise:
        dn = ct.nodes.new("CompositorNodeDenoise")
        dn.prefilter = "NONE"
        ct.links.new(last, dn.inputs[0])
        last = dn.outputs[0]
    if scale != 1.0:
        mx = ct.nodes.new("CompositorNodeMixRGB")
        mx.blend_type = "MULTIPLY"
        mx.inputs[0].default_value = 1.0
        mx.inputs[2].default_value = (scale, scale, scale, 1.0)
        ct.links.new(last, mx.inputs[1])
        last = mx.outputs[0]
    comp = ct.nodes.new("CompositorNodeComposite")
    ct.links.new(last, comp.inputs[0])
    scene.render.resolution_x = img.size[0]
    scene.render.resolution_y = img.size[1]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = quality
    scene.render.filepath = os.path.join(OUT, file)
    bpy.ops.render.render(write_still=True)
    scene.use_nodes = False
    print("SAVED", file, round(time.time() - T0, 1), "s")


cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

bpy.ops.object.select_all(action="DESELECT")
stall.select_set(True)
bpy.context.view_layer.objects.active = stall
scene.render.bake.margin = max(2, SIZE // 512)
scene.render.bake.use_clear = True

if "glb" in WHAT:
    path = os.path.join(OUT, "set.glb")
    keep = list(stall.data.materials)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format="GLB", export_materials="NONE",
                              export_normals=True, export_texcoords=True, export_apply=True, export_yup=True)
    print("SAVED set.glb", round(time.time() - T0, 1), "s")

if "albedo" in WHAT:
    img = bake_image("albedo", SIZE)
    scene.cycles.samples = 4
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"})
    save_jpg(img, "set_albedo.jpg", quality=93)

if "lit" in WHAT:
    img = bake_image("lit", max(256, SIZE // 2))
    scene.cycles.samples = SAMPLES
    set_bulbs(True)
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"})
    save_jpg(img, "set_lit.jpg", scale=1.0 / LIGHT_RANGE, denoise=True)

if "dusk" in WHAT:
    img = bake_image("dusk", max(256, SIZE // 4))
    scene.cycles.samples = SAMPLES
    set_bulbs(False)
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"})
    save_jpg(img, "set_dusk.jpg", scale=1.0 / LIGHT_RANGE * 4.0, denoise=True)

if "env" in WHAT:
    # What the moving things see around them: the lit stall and the dusk sky, as a panorama.
    set_bulbs(True)
    for go in glows:
        go.hide_render = False
    for mat in stall.data.materials:
        node = mat.node_tree.nodes.get("BAKE")
        if node:
            mat.node_tree.nodes.remove(node)
    cam_data.type = "PANO"
    cam_data.panorama_type = "EQUIRECTANGULAR"
    cam.location = G(0.0, 1.45, -1.9)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.use_nodes = False
    scene.cycles.samples = max(32, SAMPLES)
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 512
    scene.render.image_settings.file_format = "HDR"
    scene.render.filepath = os.path.join(OUT, "env.hdr")
    bpy.ops.render.render(write_still=True)
    print("SAVED env.hdr", round(time.time() - T0, 1), "s")

print("DONE", round(time.time() - T0, 1), "s")
