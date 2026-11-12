# A tiny job that proves the WSL -> Windows Blender round trip: GPU device, bake, file output.
import bpy, sys, os, time

out = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out, exist_ok=True)
t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
found = "NONE"
for kind in ("HIPRT", "HIP", "OPTIX", "CUDA", "ONEAPI"):
    try:
        prefs.compute_device_type = "HIP" if kind == "HIPRT" else kind
        prefs.get_devices()
        devs = [d for d in prefs.devices if d.type == prefs.compute_device_type]
        if devs:
            for d in prefs.devices:
                d.use = d.type == prefs.compute_device_type
            found = prefs.compute_device_type + ":" + ",".join(d.name for d in devs)
            break
    except Exception as e:
        print("device", kind, "failed", e)
scene.cycles.device = "GPU" if found != "NONE" else "CPU"
print("DEVICE", found)

bpy.ops.mesh.primitive_plane_add(size=2)
plane = bpy.context.object
bpy.ops.mesh.primitive_cube_add(size=0.5, location=(0, 0, 0.25))
bpy.ops.object.light_add(type="POINT", location=(1, -1, 2))
bpy.context.object.data.energy = 200
mat = bpy.data.materials.new("m")
mat.use_nodes = True
img = bpy.data.images.new("bake", 64, 64, float_buffer=True)
node = mat.node_tree.nodes.new("ShaderNodeTexImage")
node.image = img
mat.node_tree.nodes.active = node
plane.data.materials.append(mat)
bpy.ops.object.select_all(action="DESELECT")
plane.select_set(True)
bpy.context.view_layer.objects.active = plane
scene.cycles.samples = 16
bpy.ops.object.bake(type="COMBINED")
img.filepath_raw = os.path.join(out, "roundtrip.png")
img.file_format = "PNG"
img.save()
print("SAVED", img.filepath_raw, "in", round(time.time() - t0, 1), "s")
