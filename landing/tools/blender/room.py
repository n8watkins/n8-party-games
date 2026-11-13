# Builds the party room (the bar) by script and renders the landing page's action scenes with Cycles.
#
#   landing/tools/blender/run.sh <shot> [width] [samples]
#     shot     hero, hook, charge, absorb, harden, fade, toss, count, join, walk, score, or piece-pawn|robot|slime|ghost
#     width    picture width in pixels (480 for a test; the default is the shot's own size)
#     samples  Cycles samples (16 for a test, 128 for the real picture)
#
# The same room also renders the live party room's backdrop (lobby/public/baked): the shots named
# plate-<pass>, taken from the live room's own camera with the frames on the wall left empty.
#   plate-base    the room with no game lamp on
#   plate-lamp<i> only what lamp i adds (everything else is switched off), to be added on top
#   plate-env     the room all round from where the pieces stand, for their reflections
#   plate-juke    the jukebox alone on a clear picture, with its shadow
#   plate-all     base and every lamp in one picture, to look at (not shipped)
# A fourth argument "x0,y0,x1,y1" (fractions of the frame, from the top left) renders only that
# part, so a large plate can be made in tiles that each stay under ten minutes.
#
# The room's measures, the pieces' shapes and the seat colours are the lobby concept scene's
# (landing/tools/scene/scene.js), so these pictures and that scene show the same room.
# The lettered things on the wall and the box fronts are pictures made by
# `node landing/tools/render.mjs tex` (in tex/).
#
# Coordinates: the room uses x along the wall, y up, z toward the viewer. Blender is z up, so a
# room point (x, y, z) is the Blender point (x, -z, y). Helpers below take room coordinates.
import bpy, bmesh, sys, os, json, math, time, functools, random, re
print = functools.partial(print, flush=True)
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
OUT, HERE, SHOT = args[0], args[1], args[2]
WIDTH = int(args[3]) if len(args) > 3 and args[3] != "-" else 0
SAMPLES = int(args[4]) if len(args) > 4 else 128
TILE = [float(v) for v in args[5].split(",")] if len(args) > 5 else None
TEX = os.path.join(HERE, "tex")
SIZES = json.load(open(os.path.join(TEX, "sizes.json")))
T0 = time.time()

ROOM = dict(w=14.2, h=6.8, z_back=-2.5, z_front=14.0)
WALK_Z = 0.6
POOL_X = [-3.9, -1.3, 1.3, 3.9]
POOL_R = 0.95
LAMP_Y = 5.25
END_X = 6.05
CH = 0.78
BOX_W, BOX_H, BOX_D, BOX_Y = 1.75, 2.45, 0.3, 3.83
GAMES = ["cork", "who", "flood", "wind"]
WALL_X = POOL_X

# ------------------------------------------------------------------ the live room's plate
# The live room's numbers (lobby/shared/world.js and lobby/public/look3d/space.js): the picture
# is 1920 x 1080 world units, one unit is 1 / U metres on the back wall, and the camera stands
# at CAM looking straight at the wall. The plate is that same picture with a margin all round.
PLATE = re.match(r"plate(\d?)-(.+)$", SHOT)
PASS = PLATE.group(2) if PLATE else ""
U = 125.55
CAM = (0.0, 4.2, 17.5)
PLATE_RECT = dict(x0=-320, y0=-180, x1=2240, y1=1260)   # world units: 2560 x 1440
ONLY_LAMP = int(PASS[4:]) if PASS.startswith("lamp") else None
wall_x = lambda xw: (xw - 960) / U
wall_y = lambda yw: 6.25 - yw / U
JUKE_X = wall_x(1722)
if PLATE:
    N = int(PLATE.group(1) or 5)
    slot = (1580 - 296) / N
    centres = [296 + slot * (i + 0.5) for i in range(N)]
    WALK = (CAM[2] - WALK_Z) / (CAM[2] + 2.5)
    WALL_X = [wall_x(c) for c in centres]
    POOL_X = [x * WALK for x in WALL_X]
    POOL_R = (min(118, slot * 0.4) + 12) * WALK / U - 0.04
    BOX_W = min(1.75, (slot - 36 + 8) / U - 2 * (0.07 + 0.05))
    BOX_H = BOX_W * 1.4
    BOX_Y = wall_y(150) - BOX_H / 2
    END_X = -wall_x(181)
    GAMES = [f"game {i}" for i in range(N)]
SEAT = ["#c8382c", "#2f6f8f", "#d9a02a", "#3f7a4a"]
WARM = (1.0, 0.78, 0.52)

# ------------------------------------------------------------------ the shots
# Every pose is written down here. A player: seat (colour), skin, x, and optionally y, z, face
# (turn, radians), lean, squash, mode (slime: soft|hard), fade (ghost), hook (chain length),
# shock (wide eyes), blur (metres moved along x while the shutter is open).
# levels: how bright each of the four lamps is. gold: the box whose frame is lit.
PIECE_CAM = dict(cam=(1.05, 0.62, 4.6), look=(0.0, 0.5, 0.6), lens=85, fstop=4.0, size=(900, 900))
SHOTS = {
    # The room in full swing: the robot hooks the pawn out of Cork & Bell's light while the slime
    # sits tight in it and the ghost drifts over to Who Am I?
    "hero": dict(
        levels=[1.25, 0.75, 0, 0], size=(2000, 1000),
        cam=(-0.2, 1.5, 15.0), look=(-0.2, 2.72, -2.5), lens=38, fstop=5.6, focus=(-2.5, 0.6, 0.6),
        players=[
            dict(seat=2, skin="slime", x=-4.7, face=0.6),
            dict(seat=0, skin="pawn", x=-3.7, z=0.75, face=0.9, lean=-0.34, shock=True, blur=0.1),
            dict(seat=1, skin="robot", x=-1.4, face=-1.45, hook=1.7, lean=0.05),
            dict(seat=3, skin="ghost", x=0.25, y=0.34, face=-0.75, lean=0.12),
        ]),
    "hook": dict(
        levels=[0.9, 0.9, 0, 0], size=(1600, 1000),
        cam=(-2.2, 0.95, 7.4), look=(-3.0, 1.12, 0.6), lens=50, fstop=2.8, focus=(-3.0, 0.6, 0.6),
        players=[
            dict(seat=1, skin="robot", x=-4.25, face=1.45, hook=1.9),
            dict(seat=0, skin="pawn", x=-2.3, z=0.6, face=-0.6, lean=0.32, shock=True, blur=-0.12),
        ]),
    "charge": dict(
        levels=[0.3, 1.0, 0, 0], size=(1600, 1000),
        cam=(-1.5, 0.9, 7.2), look=(-0.7, 1.15, 0.6), lens=50, fstop=2.8, focus=(-0.8, 0.6, 0.6),
        players=[
            dict(seat=0, skin="pawn", x=-1.45, face=0.75, lean=-0.36, squash=0.95, blur=0.28),
            dict(seat=1, skin="robot", x=0.05, face=-0.5, lean=-0.75, y=0.62, shock=True),
        ], sparks=(-0.55, 0.75, 0.6)),
    "absorb": dict(
        levels=[0.3, 1.0, 0, 0], size=(1600, 1000),
        cam=(-1.3, 0.9, 7.2), look=(-2.0, 1.05, 0.6), lens=50, fstop=2.8, focus=(-1.6, 0.5, 0.7),
        players=[
            dict(seat=2, skin="slime", x=-1.3, z=0.75, face=-0.6, squash=0.8, mode="soft"),
            dict(seat=1, skin="robot", x=-2.75, y=0.3, face=1.45, lean=-0.32, hook=1.05, shock=True, blur=0.12),
        ]),
    "harden": dict(
        levels=[0.3, 1.0, 0, 0], size=(1600, 1000),
        cam=(-1.5, 0.9, 7.2), look=(-1.9, 1.15, 0.6), lens=50, fstop=2.8, focus=(-1.5, 0.5, 0.6),
        players=[
            dict(seat=2, skin="slime", x=-1.3, face=-0.5, mode="hard"),
            dict(seat=0, skin="pawn", x=-2.6, y=0.62, face=0.6, lean=0.8, shock=True),
        ], sparks=(-1.78, 0.5, 0.6)),
    "fade": dict(
        levels=[0.3, 1.0, 0, 0], size=(1600, 1000),
        cam=(-1.6, 0.9, 7.2), look=(-1.2, 1.1, 0.6), lens=50, fstop=2.8, focus=(-1.2, 0.5, 0.6),
        players=[
            dict(seat=3, skin="ghost", x=-1.45, y=0.24, face=-0.25, fade=True),
            dict(seat=0, skin="pawn", x=-1.02, z=0.75, face=0.75, lean=-0.36, squash=0.95, shock=True, blur=0.34),
        ]),
    # A tie: the coin is in the air between the two tied lights and everybody watches it.
    "toss": dict(
        levels=[0.8, 0.8, 0, 0], size=(1600, 1000),
        cam=(-2.6, 1.15, 8.6), look=(-2.6, 1.95, 0.0), lens=42, fstop=4.0, focus=(-2.6, 2.2, 0.6),
        coin=(-2.6, 2.55, 0.6),
        players=[
            dict(seat=0, skin="pawn", x=-4.35, face=0.75, lean=0.06, look_up=True),
            dict(seat=3, skin="pawn", x=-3.55, face=0.6, look_up=True),
            dict(seat=1, skin="pawn", x=-1.65, face=-0.6, look_up=True),
            dict(seat=2, skin="pawn", x=-0.85, face=-0.75, lean=-0.06, y=0.18, squash=1.05, look_up=True),
        ]),
    # Everyone in one light: the box's frame turns gold and the count runs.
    "count": dict(
        levels=[1.6, 0.0, 0, 0], gold=0, size=(1600, 1000),
        cam=(-3.9, 1.05, 9.8), look=(-3.9, 2.35, 0.0), lens=40, fstop=4.0, focus=(-3.9, 0.6, 0.6),
        players=[
            dict(seat=2, skin="pawn", x=-4.55, face=0.5),
            dict(seat=3, skin="pawn", x=-4.1, z=0.2, face=0.15, y=0.26, squash=1.06),
            dict(seat=0, skin="pawn", x=-3.6, z=0.95, face=-0.2),
            dict(seat=1, skin="pawn", x=-3.2, z=0.3, face=-0.55),
        ]),
    # The way in: the sign with the code at the end of the room, and somebody who just read it.
    "join": dict(
        levels=[0.9, 0.6, 0, 0], size=(1600, 1000),
        cam=(-5.0, 1.1, 9.0), look=(-5.3, 2.0, 0.0), lens=45, fstop=4.0, focus=(-5.6, 1.5, -0.6),
        players=[
            dict(seat=1, skin="pawn", x=-6.15, z=-0.6, face=0.5, look_up=True),
            dict(seat=0, skin="pawn", x=-4.2, z=0.5, face=-0.8, y=0.22, squash=1.05),
        ]),
    # Arriving: the door at the end of the room is open and the party walks in toward the lights.
    "walk": dict(
        levels=[0.9, 0.9, 0, 0], door_open=True, size=(1600, 1000),
        cam=(-4.3, 1.0, 8.0), look=(-4.5, 1.75, 0.0), lens=45, fstop=3.2, focus=(-4.6, 0.6, 0.6),
        players=[
            dict(seat=3, skin="pawn", x=-6.0, z=-1.75, face=0.7),
            dict(seat=2, skin="pawn", x=-5.3, z=-0.5, face=0.9, lean=-0.07, y=0.05),
            dict(seat=1, skin="pawn", x=-4.3, z=0.5, face=1.1, lean=-0.1, y=0.2, squash=1.05),
            dict(seat=0, skin="pawn", x=-3.0, z=0.7, face=-0.5),
        ]),
    # Back from a game: the winner wears the crown and everyone reads the night's score.
    "score": dict(
        levels=[0, 0, 0, 0], wash=(4.6, 0.6), size=(1600, 1000),
        cam=(4.7, 1.1, 9.2), look=(5.0, 1.85, 0.0), lens=45, fstop=3.2, focus=(5.0, 0.6, 0.6),
        players=[
            dict(seat=2, skin="pawn", x=3.9, face=0.55, crown=True, y=0.24, squash=1.05, look_up=True),
            dict(seat=0, skin="pawn", x=5.0, z=0.9, face=0.5, look_up=True),
            dict(seat=3, skin="pawn", x=5.75, z=0.2, face=0.1, look_up=True),
            dict(seat=1, skin="pawn", x=2.85, z=0.3, face=0.9, lean=-0.06, look_up=True),
        ]),
}
# One piece alone on a clear picture, for the page to stand in its own light.
for i, kind in enumerate(["pawn", "robot", "slime", "ghost"]):
    SHOTS[f"piece-{kind}"] = dict(PIECE_CAM, levels=[0, 0, 0, 0], alone=True, focus=(0, 0.5, 0.6),
                                  players=[dict(seat=i, skin=kind, x=0, face=0.3, y=0.16 if kind == "ghost" else 0)])
if PLATE:
    wm = (PLATE_RECT["x1"] - PLATE_RECT["x0"]) / U
    mid_y = wall_y((PLATE_RECT["y0"] + PLATE_RECT["y1"]) / 2)
    on = 1.0 if PASS == "all" else 0.0
    SHOTS[SHOT] = dict(
        levels=[1.0 if (i == ONLY_LAMP or PASS in ("all", "env")) else 0.0 for i in range(N)],
        size=(1024, 512) if PASS == "env" else (3840, 2160) if PASS in ("base", "juke") else (1920, 1080),
        cam=CAM, look=(0.0, mid_y, -2.5), lens=36 * (CAM[2] + 2.5) / wm, fstop=64, focus=(0, 0, 0), players=[])
S = SHOTS[SHOT]

# ------------------------------------------------------------------ set-up
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
# CPU on purpose: Cork & Bell's notes say the AMD GPU runtime crashed during Cycles on this machine.
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.02
scene.cycles.max_bounces = 6
scene.cycles.diffuse_bounces = 3
scene.cycles.glossy_bounces = 4
scene.cycles.transmission_bounces = 6
scene.cycles.volume_bounces = 0
scene.cycles.caustics_reflective = False
scene.cycles.caustics_refractive = False
scene.cycles.sample_clamp_indirect = 8.0
scene.cycles.use_denoising = True
scene.render.threads_mode = "FIXED"
scene.render.threads = 6          # leave the owner's PC two cores
W0, H0 = S["size"]
W = WIDTH or W0
scene.render.resolution_x = W
scene.render.resolution_y = round(W * H0 / W0)
scene.render.resolution_percentage = 100
scene.render.film_transparent = bool(S.get("alone"))
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA" if S.get("alone") else "RGB"
scene.render.image_settings.compression = 60
if PLATE and PASS != "all":
    # The live room adds the passes together itself, so they are saved plain: no film curve, no
    # look. A lamp's pass is saved darker than it is (LAMP_STOPS) so its brightest floor is not cut off.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    LAMP_STOPS = -1.5
    if ONLY_LAMP is not None:
        scene.view_settings.exposure = LAMP_STOPS
else:
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Punchy"
    except Exception as e:
        print("look not set:", e)
if PASS == "juke":
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
random.seed(7)


def G(x, y, z):
    """Room point -> Blender point."""
    return Vector((x, -z, y))


def lin(c):
    """sRGB 0-1 -> linear."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb(hex_, mul=1.0):
    h = hex_.lstrip("#")
    return tuple(lin(int(h[i:i + 2], 16) / 255) * mul for i in (0, 2, 4)) + (1.0,)


# ------------------------------------------------------------------ materials
def principled(name, color, rough=0.5, metal=0.0, coat=0.0, coat_rough=0.1, emit=None, emit_strength=0.0,
               sss=0.0, alpha=1.0, transmission=0.0, ior=1.45):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = color
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = coat_rough
    b.inputs["IOR"].default_value = ior
    if emit:
        b.inputs["Emission Color"].default_value = emit
        b.inputs["Emission Strength"].default_value = emit_strength
    if sss:
        b.inputs["Subsurface Weight"].default_value = sss
        b.inputs["Subsurface Radius"].default_value = (0.3, 0.15, 0.1)
        b.inputs["Subsurface Scale"].default_value = 0.12
    if transmission:
        b.inputs["Transmission Weight"].default_value = transmission
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
    return m


def emission(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = color
    e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs[0], nt.nodes["Material Output"].inputs[0])
    return m


def picture(name, file, glow=1.0, rough=0.5, alpha=False, dim=1.0):
    """A printed surface: the picture as colour and as a little light of its own."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(os.path.join(TEX, file))
    tex.extension = "EXTEND"
    shade = nt.nodes.new("ShaderNodeMix"); shade.data_type = "RGBA"; shade.blend_type = "MULTIPLY"; shade.inputs["Factor"].default_value = 1.0
    shade.inputs["B"].default_value = (dim, dim, dim, 1)
    nt.links.new(tex.outputs["Color"], shade.inputs["A"])
    nt.links.new(shade.outputs["Result"], b.inputs["Base Color"])
    nt.links.new(shade.outputs["Result"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = glow
    b.inputs["Roughness"].default_value = rough
    b.inputs["Coat Weight"].default_value = 0.25
    if alpha:
        nt.links.new(tex.outputs["Alpha"], b.inputs["Alpha"])
    return m


def boards(name, base, dark, board=0.3, along="X", rough=0.55, coat=0.0, grain=1.0):
    """Wood boards: grooves every `board` metres along one axis, each board its own shade."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    co = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(co.outputs["Object"], sep.inputs[0])
    div = nt.nodes.new("ShaderNodeMath"); div.operation = "DIVIDE"; div.inputs[1].default_value = board
    nt.links.new(sep.outputs[along], div.inputs[0])
    fr = nt.nodes.new("ShaderNodeMath"); fr.operation = "FRACT"
    nt.links.new(div.outputs[0], fr.inputs[0])
    fl = nt.nodes.new("ShaderNodeMath"); fl.operation = "FLOOR"
    nt.links.new(div.outputs[0], fl.inputs[0])
    shade = nt.nodes.new("ShaderNodeTexWhiteNoise"); shade.noise_dimensions = "1D"
    nt.links.new(fl.outputs[0], shade.inputs["W"])
    # Grain: noise stretched along the board.
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (60, 60, 2.2) if along == "X" else (2.2, 60, 60)
    nt.links.new(co.outputs["Object"], mp.inputs[0])
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 1.0; nz.inputs["Detail"].default_value = 6
    nt.links.new(mp.outputs[0], nz.inputs["Vector"])
    mixc = nt.nodes.new("ShaderNodeMix"); mixc.data_type = "RGBA"
    mixc.inputs["A"].default_value = dark; mixc.inputs["B"].default_value = base
    f = nt.nodes.new("ShaderNodeMath"); f.operation = "MULTIPLY_ADD"; f.inputs[1].default_value = 0.55; f.inputs[2].default_value = 0.2
    nt.links.new(shade.outputs["Value"], f.inputs[0])
    f2 = nt.nodes.new("ShaderNodeMath"); f2.operation = "MULTIPLY_ADD"; f2.inputs[1].default_value = 0.5 * grain
    nt.links.new(nz.outputs["Fac"], f2.inputs[0]); nt.links.new(f.outputs[0], f2.inputs[2])
    nt.links.new(f2.outputs[0], mixc.inputs["Factor"])
    # The groove between two boards: darker, and pressed in.
    gr = nt.nodes.new("ShaderNodeMath"); gr.operation = "LESS_THAN"; gr.inputs[1].default_value = 0.035
    nt.links.new(fr.outputs[0], gr.inputs[0])
    mixg = nt.nodes.new("ShaderNodeMix"); mixg.data_type = "RGBA"
    mixg.inputs["B"].default_value = (dark[0] * 0.25, dark[1] * 0.25, dark[2] * 0.25, 1)
    nt.links.new(mixc.outputs["Result"], mixg.inputs["A"]); nt.links.new(gr.outputs[0], mixg.inputs["Factor"])
    nt.links.new(mixg.outputs["Result"], b.inputs["Base Color"])
    h = nt.nodes.new("ShaderNodeMath"); h.operation = "MULTIPLY_ADD"; h.inputs[1].default_value = 0.25 * grain
    inv = nt.nodes.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0
    nt.links.new(gr.outputs[0], inv.inputs[1])
    nt.links.new(nz.outputs["Fac"], h.inputs[0]); nt.links.new(inv.outputs[0], h.inputs[2])
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.5; bump.inputs["Distance"].default_value = 0.01
    nt.links.new(h.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs[0], b.inputs["Normal"])
    rr = nt.nodes.new("ShaderNodeMath"); rr.operation = "MULTIPLY_ADD"; rr.inputs[1].default_value = 0.25; rr.inputs[2].default_value = rough - 0.12
    nt.links.new(nz.outputs["Fac"], rr.inputs[0]); nt.links.new(rr.outputs[0], b.inputs["Roughness"])
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.18
    return m


def planks(name):
    """The floor: long planks laid along the room, polished enough to hold the lamps."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    co = nt.nodes.new("ShaderNodeTexCoord")
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.offset = 0.37; br.squash = 1.0
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = 1.9
    br.inputs["Row Height"].default_value = 0.2
    br.inputs["Mortar Size"].default_value = 0.004
    br.inputs["Mortar Smooth"].default_value = 0.4
    br.inputs["Bias"].default_value = 0.0
    br.inputs["Color1"].default_value = rgb("#a9683a")
    br.inputs["Color2"].default_value = rgb("#7a4726")
    br.inputs["Mortar"].default_value = rgb("#140a05")
    nt.links.new(co.outputs["Object"], br.inputs["Vector"])
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (2.5, 55, 55)
    nt.links.new(co.outputs["Object"], mp.inputs[0])
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 1.0; nz.inputs["Detail"].default_value = 7
    nt.links.new(mp.outputs[0], nz.inputs["Vector"])
    mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs["Factor"].default_value = 0.55
    grain = nt.nodes.new("ShaderNodeValToRGB")
    grain.color_ramp.elements[0].position = 0.3; grain.color_ramp.elements[0].color = (0.45, 0.45, 0.45, 1)
    grain.color_ramp.elements[1].position = 0.75; grain.color_ramp.elements[1].color = (1.25, 1.25, 1.25, 1)
    nt.links.new(nz.outputs["Fac"], grain.inputs[0])
    nt.links.new(br.outputs["Color"], mul.inputs["A"]); nt.links.new(grain.outputs["Color"], mul.inputs["B"])
    nt.links.new(mul.outputs["Result"], b.inputs["Base Color"])
    # Wear: a larger, softer noise that dulls the polish in patches.
    wear = nt.nodes.new("ShaderNodeTexNoise"); wear.inputs["Scale"].default_value = 1.3; wear.inputs["Detail"].default_value = 3
    nt.links.new(co.outputs["Object"], wear.inputs["Vector"])
    rr = nt.nodes.new("ShaderNodeMath"); rr.operation = "MULTIPLY_ADD"; rr.inputs[1].default_value = 0.3; rr.inputs[2].default_value = 0.16
    nt.links.new(wear.outputs["Fac"], rr.inputs[0]); nt.links.new(rr.outputs[0], b.inputs["Roughness"])
    h = nt.nodes.new("ShaderNodeMath"); h.operation = "MULTIPLY_ADD"; h.inputs[1].default_value = 0.12
    one = nt.nodes.new("ShaderNodeMath"); one.operation = "SUBTRACT"; one.inputs[0].default_value = 1.0
    nt.links.new(br.outputs["Fac"], one.inputs[1])
    nt.links.new(nz.outputs["Fac"], h.inputs[0]); nt.links.new(one.outputs[0], h.inputs[2])
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.35; bump.inputs["Distance"].default_value = 0.006
    nt.links.new(h.outputs[0], bump.inputs["Height"]); nt.links.new(bump.outputs[0], b.inputs["Normal"])
    b.inputs["Coat Weight"].default_value = 0.5
    b.inputs["Coat Roughness"].default_value = 0.12
    return m


# ------------------------------------------------------------------ shapes
def finish(obj, mat, smooth=True, parent=None):
    if mat:
        obj.data.materials.append(mat)
    if smooth and hasattr(obj.data, "polygons"):
        for p in obj.data.polygons:
            p.use_smooth = True
    if parent:
        obj.parent = parent
    return obj


def box(name, c, size, mat, bevel=0.006, parent=None, segments=3):
    """A box centred on room point c, size (along x, up y, deep z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=G(*c))
    o = bpy.context.object
    o.name = name
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = o.modifiers.new("bevel", "BEVEL")
        mod.width = bevel; mod.segments = segments; mod.limit_method = "ANGLE"
    return finish(o, mat, smooth=bool(bevel), parent=parent)


def ball(name, c, r, mat, scale=(1, 1, 1), parent=None, rot=(0, 0, 0)):
    """A sphere at room point c, radius r, scaled (x, y up, z)."""
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=40, ring_count=20, location=G(*c))
    o = bpy.context.object
    o.name = name
    o.scale = (scale[0], scale[2], scale[1])
    o.rotation_euler = rot
    return finish(o, mat, parent=parent)


def rod(name, a, b, r, mat, parent=None, verts=20):
    """A cylinder from room point a to room point b."""
    A, B = G(*a), G(*b)
    d = B - A
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, vertices=verts, location=(A + B) / 2)
    o = bpy.context.object
    o.name = name
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return finish(o, mat, parent=parent)


def lathe(name, profile, at, mat, steps=64, subsurf=2, flat=False, parent=None):
    """Spins a profile of (radius, height) points about the upright axis."""
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
    if subsurf and not flat:
        mod = o.modifiers.new("smooth", "SUBSURF"); mod.levels = subsurf; mod.render_levels = subsurf
    return finish(o, mat, smooth=not flat, parent=parent)


def torus(name, c, R, r, mat, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=28, minor_segments=10, location=G(*c), rotation=rot)
    o = bpy.context.object
    o.name = name
    return finish(o, mat, parent=parent)


def plane(name, c, w, h, mat, facing="front", parent=None):
    """An upright plane centred on room point c, w wide and h tall, facing the viewer."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=G(*c), rotation=(math.pi / 2, 0, 0) if facing == "front" else (0, 0, 0))
    o = bpy.context.object
    o.name = name
    o.scale = (w, h, 1)
    return finish(o, mat, smooth=False, parent=parent)


def empty(name, at=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    e.location = G(*at) if parent is None else Vector((at[0], -at[2], at[1]))
    e.parent = parent
    return e


def spot(name, at, to, watts, size_deg, blend=0.25, radius=0.06, color=WARM):
    d = bpy.data.lights.new(name, "SPOT")
    d.energy = watts; d.spot_size = math.radians(size_deg); d.spot_blend = blend
    d.shadow_soft_size = radius; d.color = color
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location = G(*at)
    o.rotation_euler = (G(*to) - G(*at)).to_track_quat("-Z", "Y").to_euler()
    return o


def area(name, at, to, watts, size, color=(1, 1, 1), size_y=None):
    d = bpy.data.lights.new(name, "AREA")
    d.energy = watts; d.size = size; d.color = color
    if size_y:
        d.shape = "RECTANGLE"; d.size_y = size_y
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location = G(*at)
    o.rotation_euler = (G(*to) - G(*at)).to_track_quat("-Z", "Y").to_euler()
    return o


def point(name, at, watts, color=WARM, radius=0.1):
    d = bpy.data.lights.new(name, "POINT")
    d.energy = watts; d.color = color; d.shadow_soft_size = radius
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location = G(*at)
    return o


# ------------------------------------------------------------------ the room
levels = S["levels"]
ALONE = bool(S.get("alone"))
if not ALONE:
    wall = boards("wall", rgb("#5a3524"), rgb("#2c1810"), board=0.3, along="X", rough=0.62)
    dado = boards("dado", rgb("#1f5a4c"), rgb("#123a31"), board=0.3, along="X", rough=0.42, coat=0.35, grain=0.5)
    floor_m = planks("floor")
    brass = principled("brass", rgb("#c9963f"), rough=0.28, metal=1.0)
    frame_m = boards("frame", rgb("#5c3722"), rgb("#3a2114"), board=5, along="Z", rough=0.45, coat=0.4, grain=0.6)
    dark_m = principled("dark", rgb("#120a07"), rough=0.6)
    zb = ROOM["z_back"]
    hw = ROOM["w"] / 2
    box("back wall", (0, ROOM["h"] / 2, zb - 0.1), (ROOM["w"] + 0.4, ROOM["h"], 0.2), wall, bevel=0)
    for s in (-1, 1):
        box("side wall", (s * (hw + 0.1), ROOM["h"] / 2, (ROOM["z_front"] + zb) / 2), (0.2, ROOM["h"], ROOM["z_front"] - zb), boards("side", rgb("#4a2b1c"), rgb("#241309"), board=0.3, along="Y", rough=0.65), bevel=0)
        box("side dado", (s * (hw - 0.012), 0.625, (ROOM["z_front"] + zb) / 2), (0.024, 1.25, ROOM["z_front"] - zb), boards("sided", rgb("#1f5a4c"), rgb("#123a31"), board=0.3, along="Y", rough=0.42, coat=0.35, grain=0.5), bevel=0)
        box("side rail", (s * (hw - 0.03), 1.275, (ROOM["z_front"] + zb) / 2), (0.05, 0.05, ROOM["z_front"] - zb), brass, bevel=0.01)
    box("ceiling", (0, ROOM["h"] + 0.1, (ROOM["z_front"] + zb) / 2), (ROOM["w"] + 0.4, 0.2, ROOM["z_front"] - zb), dark_m, bevel=0)
    box("floor", (0, -0.1, (ROOM["z_front"] + zb) / 2), (ROOM["w"] + 0.4, 0.2, ROOM["z_front"] - zb), floor_m, bevel=0)
    box("dado", (0, 0.625, zb + 0.012), (ROOM["w"], 1.25, 0.024), dado, bevel=0)
    box("dado rail", (0, 1.275, zb + 0.03), (ROOM["w"], 0.05, 0.06), brass, bevel=0.012)
    box("skirting", (0, 0.07, zb + 0.03), (ROOM["w"], 0.14, 0.045), frame_m, bevel=0.01)
    # A picture rail high on the wall, where the string of bulbs hangs.
    box("picture rail", (0, 5.98, zb + 0.03), (ROOM["w"], 0.07, 0.06), frame_m, bevel=0.012)

    # The four boxes in their frames, each with its sign under it.
    for i, game in enumerate(GAMES):
        x = WALL_X[i]
        on = levels[i] > 0
        gold = S.get("gold") == i
        bar = 0.07 if PLATE else 0.09
        nw, nh, nd = BOX_W + 0.1, BOX_H + 0.1, 0.4 if PLATE else 0.34
        fm = emission("gold frame", (1.0, 0.62, 0.2, 1), 9.0) if gold else frame_m
        for (w, h, dx, dy) in [(bar, nh + bar * 2, -nw / 2 - bar / 2, 0), (bar, nh + bar * 2, nw / 2 + bar / 2, 0), (nw, bar, 0, nh / 2 + bar / 2), (nw, bar, 0, -nh / 2 - bar / 2)]:
            box("frame", (x + dx, BOX_Y + dy, zb + nd / 2), (w, h, nd), fm, bevel=0.012)
        plane("niche", (x, BOX_Y, zb + 0.004), nw, nh, dark_m)
        if PLATE:
            continue   # the poster and its sign are drawn live, in this empty frame
        art = picture(f"art {game}", f"box-{game}.png", glow=(2.2 if gold else 1.5) if on else 0.5, rough=0.4, dim=1.0 if on else 0.3)
        side = principled(f"side {game}", rgb({"cork": "#4a0e0c", "who": "#cfc4b2", "flood": "#10224f", "wind": "#8a6540"}[game]), rough=0.6)
        b = box(f"box {game}", (x, BOX_Y, zb + 0.05 + BOX_D / 2), (BOX_W, BOX_H, BOX_D), side, bevel=0.008)
        plane(f"front {game}", (x, BOX_Y, zb + 0.05 + BOX_D + 0.002), BOX_W - 0.012, BOX_H - 0.012, art)
        if on:
            # A picture light: the lit boxes glow onto the wall around them.
            area(f"box light {game}", (x, BOX_Y + 0.3, zb + 2.2), (x, BOX_Y, zb), 55 * (2.0 if gold else 1.0), 1.6, color=WARM)
            if gold:
                point("gold glow", (x, BOX_Y, zb + 0.6), 260, color=(1.0, 0.62, 0.25), radius=0.6)
        sz = SIZES[f"sign-{i}"]
        top = BOX_Y - nh / 2 - 0.16
        plane(f"sign {game}", (x, top - sz["h"] / 2, zb + 0.03), sz["w"], sz["h"], picture(f"sign {game}", f"sign-{i}.png", glow=1.1 if on else 0.45, alpha=True))

    # Left end: the door and the join sign. Right end: tonight's chalkboard and the shelf.
    door_m = principled("door", rgb("#2a6a5a"), rough=0.4, coat=0.4)
    if S.get("door_open"):
        # Open toward the room, with the hallway's light behind it.
        th = 1.2
        d = box("door", (-END_X - 0.5 + 0.5 * math.cos(th), 1.1, zb + 0.04 + 0.5 * math.sin(th)), (1.0, 2.2, 0.06), door_m, bevel=0.01)
        d.rotation_euler = (0, 0, -th)
        plane("hallway", (-END_X, 1.1, zb + 0.005), 1.0, 2.2, emission("hallway", (1.0, 0.7, 0.36, 1), 7.0))
        point("hallway light", (-END_X, 1.3, zb + 0.7), 420, radius=0.3)
    else:
        box("door", (-END_X, 1.1, zb + 0.04), (1.0, 2.2, 0.06), door_m, bevel=0.01)
    for (w, h, dx, dy) in [(0.09, 2.29, -0.545, 1.145), (0.09, 2.29, 0.545, 1.145), (1.18, 0.09, 0, 2.245)]:
        box("door frame", (-END_X + dx, dy, zb + 0.06), (w, h, 0.12), frame_m, bevel=0.01)
    if not S.get("door_open"):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.14, depth=0.02, vertices=48, location=G(-END_X, 1.6, zb + 0.08), rotation=(math.pi / 2, 0, 0))
        finish(bpy.context.object, emission("porthole", (1.0, 0.72, 0.36, 1), 14.0))
        torus("porthole ring", (-END_X, 1.6, zb + 0.085), 0.155, 0.028, brass, rot=(math.pi / 2, 0, 0))
        ball("knob", (-END_X + 0.36, 1.05, zb + 0.11), 0.045, brass)
        point("porthole light", (-END_X, 1.6, zb + 0.5), 18, radius=0.15)
    js = SIZES["join"]
    if not PLATE:
      plane("join sign", (-END_X, 5.12 - js["h"] / 2, zb + 0.03), js["w"], js["h"], picture("join", "join.png", glow=1.2, alpha=True))
    bs = SIZES["board"]
    if not PLATE:
      plane("chalkboard", (END_X, 5.12 - bs["h"] / 2, zb + 0.03), bs["w"], bs["h"], picture("board", "board.png", glow=0.9, alpha=True))
    area("board light", (END_X, 4.2, zb + 2.4), (END_X, 3.8, zb), 60, 1.8, color=WARM)
    area("join light", (-END_X, 4.2, zb + 2.4), (-END_X, 3.8, zb), 60, 1.8, color=WARM)
    if not PLATE:
        box("shelf", (END_X, 1.15, zb + 0.25), (1.5, 0.07, 0.5), frame_m, bevel=0.01)
        for dx in (-0.55, 0.55):
            box("bracket", (END_X + dx, 0.97, zb + 0.2), (0.05, 0.3, 0.4), frame_m, bevel=0.008)
        fs = 0.42
        fox = box("fox box", (END_X - 0.05, 1.185 + BOX_H * fs / 2, zb + 0.25), (BOX_W * fs, BOX_H * fs, BOX_D * fs), principled("side fox", rgb("#143d27"), rough=0.6), bevel=0.004)
        ff = plane("fox front", (END_X - 0.05, 1.185 + BOX_H * fs / 2, zb + 0.25 + BOX_D * fs / 2 + 0.002), BOX_W * fs - 0.01, BOX_H * fs - 0.01, picture("art fox", "box-fox.png", glow=0.5, rough=0.4))
        for o in (fox, ff):
            o.select_set(True)
        ts = SIZES["shelf-tag"]
        plane("shelf tag", (END_X, 0.75 - ts["h"] / 2, zb + 0.03), ts["w"], ts["h"], picture("shelf tag", "shelf-tag.png", glow=0.7, alpha=True))

    # The lamps: an enamel shade on a cord, a bulb, and the light it throws down as a pool.
    shade_m = principled("shade", rgb("#8a2a1e"), rough=0.3, metal=0.2, coat=0.8)
    shade_in = principled("shade inside", rgb("#f3e3c2"), rough=0.5)
    cord_m = principled("cord", rgb("#0c0705"), rough=0.7)
    for i, x in enumerate(POOL_X):
        lv = levels[i]
        lathe(f"shade {i}", [(0.07, 0.34), (0.1, 0.3), (0.33, 0.06), (0.385, 0.0), (0.375, -0.012), (0.32, 0.045), (0.09, 0.285), (0.06, 0.33)], (x, LAMP_Y, WALK_Z), shade_m, subsurf=1)
        rod(f"cap {i}", (x, LAMP_Y + 0.32, WALK_Z), (x, LAMP_Y + 0.46, WALK_Z), 0.06, brass)
        rod(f"cord {i}", (x, LAMP_Y + 0.46, WALK_Z), (x, ROOM["h"], WALK_Z), 0.014, cord_m, verts=8)
        ball(f"bulb {i}", (x, LAMP_Y + 0.1, WALK_Z), 0.085, emission(f"bulb {i}", WARM + (1,), 60.0 * lv if lv else 0.15))
        if lv:
            spot(f"lamp {i}", (x, LAMP_Y + 0.02, WALK_Z), (x, 0, WALK_Z), 16000 * lv, 2 * math.degrees(math.atan((POOL_R + 0.04) / LAMP_Y)), blend=0.2, radius=0.07)

    # A string of small bulbs along the picture rail.
    n = 29
    pts = []
    for k in range(n):
        t = k / (n - 1)
        x = (t - 0.5) * (ROOM["w"] - 0.5)
        sag = ((t * 4) % 1 - 0.5) ** 2 * 1.25
        pts.append((x, 5.66 + sag, zb + 0.45))
    bulb_m = emission("string bulb", (1.0, 0.72, 0.4, 1), 22.0)
    for a, b_ in zip(pts, pts[1:]):
        rod("string", a, b_, 0.006, cord_m, verts=6)
    for p in pts:
        ball("string bulb", (p[0], p[1] - 0.06, p[2]), 0.05, bulb_m)

    # The air: a little haze, so each lamp's light shows as a cone.
    bpy.ops.mesh.primitive_cube_add(size=1, location=G(0, ROOM["h"] / 2, 1.5))
    haze = bpy.context.object
    haze.name = "haze"
    haze.scale = (ROOM["w"], 8.0, ROOM["h"])
    hm = bpy.data.materials.new("haze")
    hm.use_nodes = True
    hnt = hm.node_tree
    hnt.nodes.remove(hnt.nodes["Principled BSDF"])
    vol = hnt.nodes.new("ShaderNodeVolumeScatter")
    vol.inputs["Density"].default_value = 0.026
    vol.inputs["Anisotropy"].default_value = 0.25
    hnt.links.new(vol.outputs[0], hnt.nodes["Material Output"].inputs["Volume"])
    haze.data.materials.append(hm)
    if PLATE and PASS in ("base", "juke"):
        haze.hide_render = True

    # The room's own dim light: a warm wash from the front, so nothing in it is black.
    area("fill", (-2.5, 5.4, 9.0), (0, 2.2, -1.0), 240, 9.0, color=(1.0, 0.84, 0.68), size_y=4.0)
    area("rim", (5.5, 4.5, -1.2), (0, 0.6, 1.2), 260, 3.0, color=(0.62, 0.74, 1.0))
    # A low, soft light from the front for the pieces' faces, wherever they stand.
    area("faces", (0, 1.4, 8.0), (0, 0.6, 0.6), 520, 10.0, color=(1.0, 0.86, 0.7), size_y=1.5)

world = bpy.data.worlds.new("world")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.03, 0.02, 0.015, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35 if not ALONE else 0.0
scene.world = world

# ------------------------------------------------------------------ the pieces
eye_m = principled("eye", (0.004, 0.005, 0.012, 1), rough=0.12, coat=1.0)
white_m = emission("white", (1, 1, 1, 1), 2.5)
steel = principled("steel", rgb("#b9c0cc"), rough=0.3, metal=1.0)
gunmetal = principled("gunmetal", rgb("#262a33"), rough=0.42, metal=0.7)


def eyes(parent, r, y, spread=0.33, size=1.0, shock=False, visor=False, up=False):
    yy = y + (0.035 if up else 0)
    for s in (-1, 1):
        a = s * spread
        at = lambda rr, h: (math.sin(a) * rr, h, math.cos(a) * rr)
        if visor:
            ball("eye", (s * 0.085, y, r), 1.0, emission("visor eye", (0.5, 0.9, 1.0, 1), 9.0), scale=(0.045 * size, (0.075 if shock else 0.055) * size, 0.015), parent=parent)
            continue
        if shock:
            ball("eye white", at(r, y), 1.0, white_m, scale=(0.062 * size, 0.078 * size, 0.022), parent=parent, rot=(0, 0, a))
            ball("pupil", at(r + 0.018, y), 1.0, eye_m, scale=(0.024 * size, 0.028 * size, 0.012), parent=parent, rot=(0, 0, a))
            continue
        ball("eye", at(r, yy), 1.0, eye_m, scale=(0.036 * size, 0.054 * size, 0.022), parent=parent, rot=(0, 0, a))
        ball("glint", at(r + 0.016, yy + 0.022 * size), 1.0, white_m, scale=(0.011 * size, 0.013 * size, 0.008), parent=parent)


def toy(name, hex_, **kw):
    """Painted, lacquered wood or vinyl in a seat colour."""
    c = rgb(hex_)
    return principled(name, c, rough=kw.get("rough", 0.3), coat=kw.get("coat", 0.8), coat_rough=0.08, sss=kw.get("sss", 0.12),
                      emit=c, emit_strength=kw.get("glow", 0.06), metal=kw.get("metal", 0.0))


def streak_material():
    m = bpy.data.materials.new("streak")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    e = nt.nodes.new("ShaderNodeEmission"); e.inputs["Color"].default_value = (1.0, 0.9, 0.75, 1); e.inputs["Strength"].default_value = 1.6
    t = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader"); mix.inputs[0].default_value = 0.22
    nt.links.new(t.outputs[0], mix.inputs[1]); nt.links.new(e.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], nt.nodes["Material Output"].inputs[0])
    return m


STREAK = streak_material()


def make_piece(p):
    kind = p["skin"]
    hex_ = SEAT[p["seat"]]
    tilt = empty(f"{kind} tilt", (p["x"], p.get("y", 0), p.get("z", WALK_Z)))
    sq = p.get("squash", 1.0)
    tilt.scale = (CH / math.sqrt(sq), CH / math.sqrt(sq), CH * sq)
    tilt.rotation_euler = (0, -p.get("lean", 0), 0)
    turn = empty(f"{kind} turn", parent=tilt)
    turn.rotation_euler = (0, 0, p.get("face", 0))
    if kind == "pawn":
        m = toy("pawn", hex_)
        lathe("pawn body", [(0, 0), (0.29, 0), (0.325, 0.03), (0.33, 0.08), (0.3, 0.13), (0.235, 0.24), (0.185, 0.4), (0.15, 0.56), (0.145, 0.61), (0.2, 0.645), (0.205, 0.68), (0.15, 0.715), (0, 0.72)], (0, 0, 0), m, parent=turn, subsurf=2)
        ball("pawn head", (0, 0.9, 0), 0.215, m, parent=turn)
        eyes(turn, 0.205, 0.925, shock=p.get("shock"), size=0.9 if p.get("shock") else 1.0, up=p.get("look_up"))
    elif kind == "slime":
        prof = lambda n: [(0.43 * math.cos(i / n * math.pi / 2) ** 0.62 + 0.05 * (1 - i / n) ** 6, 0.7 * math.sin(i / n * math.pi / 2)) for i in range(n + 1)] + [(0, 0.7)]
        c = rgb(hex_)
        if p.get("mode") == "hard":
            hard = principled("slime hard", (c[0] * 1.3 + 0.1, c[1] * 1.3 + 0.1, c[2] * 0.9 + 0.1, 1), rough=0.2, metal=0.9, coat=1.0, emit=c, emit_strength=0.15)
            lathe("slime", prof(4), (0, 0, 0), hard, steps=9, flat=True, parent=turn)
            eyes(turn, 0.38, 0.34, spread=0.36, size=1.5, shock=p.get("shock"))
        else:
            soft = p.get("mode") == "soft"
            jelly = principled("slime", (c[0] * 1.5, c[1] * 1.5, c[2] * 0.9, 1), rough=0.06, coat=1.0, coat_rough=0.03, transmission=0.72, ior=1.34,
                               emit=c, emit_strength=0.9 if soft else 0.5, sss=0.25)
            lathe("slime", [(0, 0)] + prof(24), (0, 0, 0), jelly, parent=turn, subsurf=1)
            for (X, Z, R) in [(0.47, 0.16, 0.07), (-0.44, 0.24, 0.05)]:
                ball("drip", (X, R * 0.3, Z), 1.0, jelly, scale=(R, R * 0.6, R), parent=turn)
            eyes(turn, 0.412, 0.34, spread=0.36, size=1.5, shock=p.get("shock"))
            if soft:
                point("slime glow", (p["x"], 0.4, p.get("z", WALK_Z)), 26, color=(1.0, 0.8, 0.3), radius=0.3)
    elif kind == "robot":
        m = toy("robot", hex_, rough=0.34, coat=0.6, metal=0.25)
        box("robot base", (0, 0.08, 0), (0.56, 0.16, 0.42), gunmetal, bevel=0.06, parent=turn, segments=5)
        box("robot body", (0, 0.36, 0), (0.5, 0.42, 0.38), m, bevel=0.085, parent=turn, segments=6)
        rod("robot neck", (0, 0.55, 0), (0, 0.65, 0), 0.07, steel, parent=turn)
        box("robot head", (0, 0.8, 0), (0.48, 0.34, 0.38), m, bevel=0.095, parent=turn, segments=6)
        box("robot visor", (0, 0.81, 0.175), (0.38, 0.19, 0.06), principled("visor", (0.003, 0.004, 0.01, 1), rough=0.08, coat=1.0), bevel=0.028, parent=turn, segments=4)
        rod("robot mast", (0, 0.97, 0), (0, 1.17, 0), 0.014, steel, parent=turn, verts=8)
        ball("robot tip", (0, 1.19, 0), 0.055, emission("tip", (1.0, 0.72, 0.3, 1), 30.0), parent=turn)
        bpy.ops.mesh.primitive_cylinder_add(radius=0.07, depth=0.01, vertices=32, location=(0, -0.194, 0.38), rotation=(math.pi / 2, 0, 0))
        finish(bpy.context.object, emission("chest", (1, 1, 1, 1), 3.0), parent=turn)
        for s in (-1, 1):
            ball("shoulder", (s * 0.29, 0.44, 0), 0.075, gunmetal, parent=turn)
            rod("arm", (s * 0.31, 0.42, 0), (s * 0.31, 0.18, 0), 0.04, gunmetal, parent=turn, verts=12)
            ball("hand", (s * 0.31, 0.16, 0), 0.06, steel, parent=turn)
        if p.get("hook"):
            # The hook: a chain fired from the chest, ending in an open claw.
            L = p["hook"]
            hy = 0.4
            rod("muzzle", (0, hy, 0.16), (0, hy, 0.3), 0.08, gunmetal, parent=turn)
            z, k = 0.34, 0
            while z < L - 0.02:
                torus("link", (0, hy, z), 0.038, 0.012, steel, rot=(math.pi / 2, 0, 0) if k % 2 else (math.pi / 2, math.pi / 2, 0), parent=turn)
                z += 0.078; k += 1
            gold = principled("claw", rgb("#f2c14e"), rough=0.22, metal=1.0, emit=rgb("#f2c14e"), emit_strength=0.25)
            for sgn in (-1, 1):
                # Two curved fingers, open.
                prev = (0, hy, L)
                for j in range(1, 7):
                    a = j / 6 * 1.9
                    cur = (0, hy + sgn * 0.15 * math.sin(a), L + 0.15 * (1 - math.cos(a)) + 0.02 * j)
                    rod("claw", prev, cur, 0.03 - j * 0.0025, gold, parent=turn, verts=10)
                    ball("claw joint", cur, 0.03 - j * 0.0025, gold, parent=turn)
                    prev = cur
            ball("claw hub", (0, hy, L), 0.05, gold, parent=turn)
        eyes(turn, 0.207, 0.81, visor=True, shock=p.get("shock"))
        turn.scale = (1.13, 1.13, 1.13)
    elif kind == "ghost":
        c = rgb(hex_)
        pale = tuple(c[i] * 0.3 + 0.7 for i in range(3)) + (1,)
        fade = p.get("fade")
        m = principled("ghost", pale, rough=0.55, sss=0.6, coat=0.1, emit=pale, emit_strength=0.9 if fade else 0.35, alpha=0.1 if fade else 1.0)
        lathe("ghost", [(0, 0.06), (0.26, 0.04), (0.33, 0.1), (0.335, 0.2), (0.33, 0.5), (0.3, 0.72), (0.24, 0.88), (0.15, 0.98), (0, 1.02)], (0, 0, 0), m, parent=turn, subsurf=2)
        for k in range(7):
            a = k / 7 * math.tau
            ball("ghost hem", (math.sin(a) * 0.235, 0.02, math.cos(a) * 0.235), 0.115, m, parent=turn)
        for s in (-1, 1):
            ball("ghost hand", (s * 0.37, 0.5, 0.12), 1.0, m, scale=(0.1, 0.075, 0.09), parent=turn, rot=(0, -s * 0.5, 0))
        eyes(turn, 0.318, 0.68, spread=0.36, size=1.45)
        ball("ghost mouth", (0, 0.5, 0.336), 1.0, eye_m, scale=(0.05, 0.065, 0.02), parent=turn)
        if fade:
            point("ghost glow", (p["x"], 0.7, p.get("z", WALK_Z) + 0.2), 14, color=(0.75, 1.0, 0.85), radius=0.35)
    if p.get("crown"):
        gold = principled("crown", rgb("#f2c14e"), rough=0.2, metal=1.0, emit=rgb("#f2c14e"), emit_strength=0.3)
        lathe("crown band", [(0.13, 1.085), (0.15, 1.175), (0.135, 1.175), (0.115, 1.085)], (0, 0, 0), gold, parent=turn, subsurf=0)
        for k in range(6):
            a = k / 6 * math.tau
            bpy.ops.mesh.primitive_cone_add(radius1=0.045, radius2=0, depth=0.12, vertices=16, location=(math.sin(a) * 0.143, -math.cos(a) * 0.143, 1.225))
            finish(bpy.context.object, gold, parent=turn)
            ball("crown pearl", (math.sin(a) * 0.143, 1.29, math.cos(a) * 0.143), 0.018, gold, parent=turn)
    if p.get("blur"):
        # Moving fast: a few soft streaks of light trail behind it, the way a painter would show speed.
        d = -1 if p["blur"] > 0 else 1
        far = abs(p["blur"]) * 4
        for (h, start, length, r) in [(0.78, 0.34, far * 0.7, 0.012), (0.56, 0.4, far * 1.1, 0.017), (0.34, 0.42, far * 0.85, 0.012), (0.13, 0.4, far * 0.5, 0.009)]:
            c = (p["x"] + d * (start + length / 2), p.get("y", 0) + h * CH, p.get("z", WALK_Z))
            ball("streak", c, 1.0, STREAK, scale=(length / 2, r, r))
    return tilt


for p in S["players"]:
    make_piece(p)

if PASS == "juke":
    # The jukebox under the Tonight board, alone: the room is kept only to catch its shadow and
    # to be seen in its chrome. The live room stands this picture in the plate and rocks it.
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.name == "floor":
            o.is_shadow_catcher = True
        elif o.type == "MESH":
            o.visible_camera = False
    wood = boards("juke wood", rgb("#7a4424"), rgb("#4a2814"), board=4, along="Z", rough=0.35, coat=0.7, grain=0.7)
    dark = principled("juke dark", rgb("#120a07"), rough=0.5)
    chrome = principled("juke chrome", rgb("#d8c9a8"), rough=0.18, metal=1.0)
    glass = principled("juke tube", (0.8, 0.8, 0.8, 1), rough=0.25, coat=1.0, sss=0.3)
    jz = -2.5 + 0.3
    jg = empty("jukebox", (JUKE_X, 0, jz))
    box("juke body", (0, 0.55, 0), (1.05, 1.1, 0.5), wood, bevel=0.03, parent=jg)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.525, depth=0.5, vertices=64, location=(0, 0, 1.1), rotation=(math.pi / 2, 0, 0))
    top = finish(bpy.context.object, wood, parent=jg)
    mod = top.modifiers.new("bevel", "BEVEL"); mod.width = 0.03; mod.segments = 3; mod.limit_method = "ANGLE"
    box("juke foot", (0, 0.05, 0.01), (1.11, 0.1, 0.54), dark, bevel=0.02, parent=jg)
    # The window with the record in it, and the grille under it.
    bpy.ops.mesh.primitive_cylinder_add(radius=0.36, depth=0.04, vertices=64, location=(0, -0.245, 1.12), rotation=(math.pi / 2, 0, 0))
    finish(bpy.context.object, dark, parent=jg)
    box("juke window", (0, 0.94, 0.245), (0.72, 0.4, 0.04), dark, bevel=0.02, parent=jg)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.2, depth=0.02, vertices=64, location=(0, -0.275, 1.12), rotation=(math.pi / 2, 0, 0))
    finish(bpy.context.object, principled("record", (0.004, 0.004, 0.005, 1), rough=0.22, coat=1.0), parent=jg)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.065, depth=0.024, vertices=32, location=(0, -0.28, 1.12), rotation=(math.pi / 2, 0, 0))
    finish(bpy.context.object, principled("label", rgb("#d8402a"), rough=0.4, emit=rgb("#d8402a"), emit_strength=0.6), parent=jg)
    box("juke grille", (0, 0.4, 0.25), (0.7, 0.56, 0.03), dark, bevel=0.01, parent=jg)
    for k in range(11):
        box("juke slat", (-0.3 + k * 0.06, 0.4, 0.27), (0.024, 0.5, 0.02), chrome, bevel=0.006, parent=jg)
    for (w, h, dx, dy) in [(0.76, 0.03, 0, 0.695), (0.76, 0.03, 0, 0.105), (0.03, 0.62, -0.365, 0.4), (0.03, 0.62, 0.365, 0.4)]:
        box("juke trim", (dx, dy, 0.265), (w, h, 0.03), chrome, bevel=0.008, parent=jg)
    # The tubes of light: clear here, and coloured live by the room.
    for sgn in (-1, 1):
        rod("juke tube", (sgn * 0.44, 0.13, 0.26), (sgn * 0.44, 1.12, 0.26), 0.045, glass, parent=jg)
        ball("juke tube foot", (sgn * 0.44, 0.13, 0.26), 0.055, chrome, parent=jg)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.44, minor_radius=0.045, major_segments=48, minor_segments=12, location=(0, -0.26, 1.12), rotation=(math.pi / 2, 0, 0))
    arch = finish(bpy.context.object, glass, parent=jg)
    bpy.ops.object.mode_set(mode="EDIT")
    bm_ = bmesh.from_edit_mesh(arch.data)
    bmesh.ops.delete(bm_, geom=[v for v in bm_.verts if v.co.y < -0.002], context="VERTS")
    bmesh.update_edit_mesh(arch.data)
    bpy.ops.object.mode_set(mode="OBJECT")
    point("juke glow", (JUKE_X, 1.15, jz + 0.9), 30, color=(1.0, 0.75, 0.45), radius=0.3)

if S.get("coin"):
    cx, cy, cz = S["coin"]
    gold = principled("coin", rgb("#f2c14e"), rough=0.2, metal=1.0, emit=rgb("#f2b030"), emit_strength=0.5)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.34, depth=0.07, vertices=72, location=G(cx, cy, cz), rotation=(math.radians(62), math.radians(14), math.radians(20)))
    coin = finish(bpy.context.object, gold)
    mod = coin.modifiers.new("bevel", "BEVEL"); mod.width = 0.016; mod.segments = 3
    torus("coin rim", (cx, cy, cz), 0.27, 0.012, gold, rot=coin.rotation_euler)
    point("coin glow", (cx, cy, cz + 0.8), 60, color=(1.0, 0.75, 0.3), radius=0.4)
    spot("coin spot", (cx, 6.2, cz + 2.5), (cx, cy, cz), 1800, 14, blend=0.6, radius=0.2)

if S.get("wash"):
    # No game lamp is on here (these boxes are not built yet), so the group gets a soft light of its own.
    wx, wz = S["wash"]
    spot("wash", (wx - 1.0, 6.2, wz + 3.5), (wx, 0.4, wz), 4200, 36, blend=0.8, radius=0.3)

if S.get("sparks"):
    sx, sy, sz_ = S["sparks"]
    sm = emission("spark", (1.0, 0.8, 0.4, 1), 60.0)
    for k in range(16):
        a = random.uniform(0, math.tau)
        d = random.uniform(0.12, 0.6)
        ball("spark", (sx + math.cos(a) * d, sy + math.sin(a) * d * 0.8, sz_ + random.uniform(-0.25, 0.25)), random.uniform(0.008, 0.022), sm)
    point("impact", (sx, sy, sz_ + 0.3), 30, color=(1.0, 0.8, 0.5), radius=0.2)

if ALONE:
    # A piece on its own: a key light from above like the room's lamp, a soft fill and a rim, and
    # a floor that only catches the shadow.
    bpy.ops.mesh.primitive_plane_add(size=6, location=G(0, 0, WALK_Z))
    catcher = bpy.context.object
    catcher.is_shadow_catcher = True
    spot("key", (0.3, LAMP_Y, WALK_Z + 0.6), (0, 0.3, WALK_Z), 5200, 30, blend=0.5, radius=0.25)
    area("fill", (-2.5, 2.0, 5.0), (0, 0.5, WALK_Z), 420, 4.0, color=(1.0, 0.86, 0.72))
    area("rim", (2.4, 2.2, -2.0), (0, 0.6, WALK_Z), 330, 2.0, color=(0.62, 0.74, 1.0))

# ------------------------------------------------------------------ the camera
cam_d = bpy.data.cameras.new("camera")
cam = bpy.data.objects.new("camera", cam_d)
bpy.context.collection.objects.link(cam)
scene.camera = cam
cam.location = G(*S["cam"])
# Looks level and slides the frame up, the way a building is photographed: the walls stay upright.
look = S["look"]
level = (look[0], S["cam"][1], look[2])
cam.rotation_euler = (G(*level) - G(*S["cam"])).to_track_quat("-Z", "Y").to_euler()
cam_d.lens = S["lens"]
cam_d.sensor_width = 36
dist = (G(*level) - G(*S["cam"])).length
aspect = scene.render.resolution_x / scene.render.resolution_y
cam_d.shift_y = (look[1] - S["cam"][1]) / dist * cam_d.lens / cam_d.sensor_width * (aspect if aspect < 1 else 1) / (1 if aspect >= 1 else aspect)
cam_d.dof.use_dof = True
cam_d.dof.focus_distance = (G(*S["focus"]) - G(*S["cam"])).length
cam_d.dof.aperture_fstop = S["fstop"]
cam_d.clip_end = 80

# ------------------------------------------------------------------ the finish: a soft bloom on the lights
scene.use_nodes = True
ct = scene.node_tree
for n_ in list(ct.nodes):
    ct.nodes.remove(n_)
rl = ct.nodes.new("CompositorNodeRLayers")
glare = ct.nodes.new("CompositorNodeGlare")
glare.glare_type = "FOG_GLOW"
glare.quality = "HIGH"
glare.threshold = 1.6
glare.size = 8
glare.mix = -0.72
comp = ct.nodes.new("CompositorNodeComposite")
if ALONE or (PLATE and PASS != "all"):
    ct.links.new(rl.outputs["Image"], comp.inputs["Image"])
else:
    ct.links.new(rl.outputs["Image"], glare.inputs["Image"])
    ct.links.new(glare.outputs["Image"], comp.inputs["Image"])

if ONLY_LAMP is not None:
    for light in bpy.data.lights:
        if light.name != f"lamp {ONLY_LAMP}":
            light.energy = 0
    for m in bpy.data.materials:
        e = m.node_tree.nodes.get("Emission") if m.use_nodes else None
        if e and m.name != f"bulb {ONLY_LAMP}":
            e.inputs["Strength"].default_value = 0
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0

if PASS == "env":
    # All round, from where the pieces stand: the picture is turned so its middle looks along the room (+x).
    cam.location = G(0, 0.9, WALK_Z)
    cam.rotation_euler = (G(1, 0.9, WALK_Z) - G(0, 0.9, WALK_Z)).to_track_quat("-Z", "Y").to_euler()
    cam_d.type = "PANO"
    cam_d.panorama_type = "EQUIRECTANGULAR"
    cam_d.shift_y = 0
if PLATE:
    cam_d.dof.use_dof = False
if PASS == "juke" and not TILE:
    # Only the part of the frame the jukebox and its shadow are in.
    TILE = [(1560 - PLATE_RECT["x0"]) / 2560, (500 - PLATE_RECT["y0"]) / 1440, (1900 - PLATE_RECT["x0"]) / 2560, (860 - PLATE_RECT["y0"]) / 1440]
if TILE:
    scene.render.use_border = True
    scene.render.use_crop_to_border = True
    scene.render.border_min_x, scene.render.border_max_x = TILE[0], TILE[2]
    scene.render.border_min_y, scene.render.border_max_y = 1 - TILE[3], 1 - TILE[1]

scene.render.filepath = os.path.join(OUT, f"{SHOT}{'-' + '_'.join(str(round(v * 1000)) for v in TILE) if TILE and PASS != 'juke' else ''}.png")
print(f"built in {time.time() - T0:.1f} s, rendering {scene.render.resolution_x} x {scene.render.resolution_y} at {SAMPLES} samples")
bpy.ops.render.render(write_still=True)
print(f"saved {SHOT}.png after {time.time() - T0:.1f} s")
