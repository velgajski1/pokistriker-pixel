"""Prepare the supplied soccer ball for runtime; keep the reference untouched."""
from pathlib import Path
import bpy
import bmesh

ROOT = Path(__file__).resolve().parents[2]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'references/Meshy_AI_soccer_ball_3d_0921124402_image-to-3d-texture.glb'))
for obj in list(bpy.context.scene.objects):
    if obj.type != 'MESH':
        continue
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    # Weld duplicated seam vertices before simplifying so panel edges stay closed.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.0001)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    modifier = obj.modifiers.new('Runtime detail', 'DECIMATE')
    modifier.ratio = min(1, 6000 / len(obj.data.polygons))
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    print('BALL triangles', len(obj.data.polygons))
for image in bpy.data.images:
    if image.size[0] > 1024 or image.size[1] > 1024:
        ratio = 1024 / max(image.size)
        image.scale(round(image.size[0] * ratio), round(image.size[1] * ratio))
        image.pack()
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'assets/ball.glb'), export_format='GLB',
                         export_animations=False, export_materials='EXPORT', export_yup=True)
