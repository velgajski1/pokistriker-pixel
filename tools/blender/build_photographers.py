"""Optimize Meshy photographer GLBs; retain originals in references/photographers."""
from pathlib import Path
import json
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
report = {}
for name, height in [('standing', 1.8), ('kneeling', 1.28)]:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / f'references/photographers/{name}.glb'))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    points = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    factor = height / (high.z - low.z)
    center = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
    for obj in meshes:
        # Bake normalized world coordinates into vertices (Blender Z-up).
        world = obj.matrix_world.copy()
        for vertex in obj.data.vertices:
            vertex.co = (world @ vertex.co - center) * factor
        obj.parent = None
        obj.matrix_world.identity()
        bpy.context.view_layer.objects.active = obj
        if len(obj.data.polygons) > 14000:
            mod = obj.modifiers.new('background-budget', 'DECIMATE')
            mod.ratio = 14000 / len(obj.data.polygons)
            bpy.ops.object.modifier_apply(modifier=mod.name)
    for image in bpy.data.images:
        if image.size[0] > 1024 or image.size[1] > 1024:
            ratio = 1024 / max(image.size)
            image.scale(round(image.size[0] * ratio), round(image.size[1] * ratio))
    out = ROOT / f'assets/photographer-{name}.glb'
    bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', export_image_format='JPEG',
                              export_jpeg_quality=85, export_animations=False, export_cameras=False,
                              export_lights=False)
    report[name] = {'height': height, 'faces': sum(len(o.data.polygons) for o in meshes),
                    'bytes': out.stat().st_size}
print(json.dumps(report, indent=2))
