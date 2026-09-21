"""Rebuild the Captain asset and diagnostic poses with Blender --factory-startup."""
from pathlib import Path
import math
import bpy
from mathutils import Vector, Quaternion

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'references/Meshy_AI_Captain_of_Tomorrow_0921090505_texture.glb'
OUTPUT = ROOT / 'assets/striker.glb'
CAPTURES = ROOT / '.captures'
HEIGHT = 1.85
TRI_BUDGET = 24500
BASE_SIZE = 1536
MAP_SIZE = 1024
JPEG_QUALITY = 82
MERGE_DISTANCE = 0.00001
# Metres after floor alignment. Measured against source surface cross sections:
# knee bulge .50-.55, ankle narrowing .15, sleeve shoulder 1.48,
# elbow narrowing 1.15, wrist narrowing .91; hip inside shorts at .94.
JOINTS = {
    'hips': (0, .035, .94), 'spine': (0, .035, 1.10),
    'chest': (0, .04, 1.32), 'neck': (0, .04, 1.55),
    'head': (0, .025, 1.64), 'crown': (0, .025, 1.82),
    'shoulder': (.105, .045, 1.48), 'upperarm': (.205, .045, 1.46),
    'forearm': (.253, .005, 1.16), 'hand': (.282, -.025, .915),
    'fingers': (.294, -.045, .815), 'thigh': (.115, .035, .94),
    'shin': (.164, -.035, .525), 'foot': (.225, .025, .15),
    'toe': (.233, -.105, .055), 'toe_end': (.233, -.175, .045),
}
RENDER_SIZE = (640, 900)
CAMERA_SCALE = 2.65
ARMPIT_HEIGHT = 1.34
ARM_CLEANUP_MIN_HEIGHT = .80
CROSS_REGION_LIMIT = .15
ROOT_TAIL_HEIGHT = .12
FALLBACK_DISTANCE_FLOOR = .015
FALLBACK_DISTANCE_POWER = 4
FALLBACK_SMOOTH_PASSES = 3
FALLBACK_SMOOTH_FACTOR = .5
CAMERA_TARGET = (0, 0, 1.05)
POSES = {
    'rest': {},
    'arms-up': {'upperarm_L': ('Y', -165), 'upperarm_R': ('Y', 165),
                'forearm_L': ('X', -12), 'forearm_R': ('X', -12)},
    'kick': {'thigh_R': ('X', -70), 'shin_R': ('X', 5), 'shin_L': ('X', 18)},
    'run': {'thigh_L': ('X', -45), 'shin_L': ('X', 60),
            'thigh_R': ('X', 30), 'shin_R': ('X', 65),
            'upperarm_L': ('X', 30), 'upperarm_R': ('X', -40),
            'forearm_L': ('X', -65), 'forearm_R': ('X', -65)},
    'twist': {'chest': ('Z', 35), 'head': ('Z', 40)},
}


def main():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    mesh.name = 'Captain'
    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    coords = [v.co.copy() for v in mesh.data.vertices]
    floor = min(v.z for v in coords)
    scale = HEIGHT / (max(v.z for v in coords) - floor)
    center_x = (min(v.x for v in coords) + max(v.x for v in coords)) / 2
    for v in mesh.data.vertices:
        v.co = Vector(((v.co.x - center_x) * scale, v.co.y * scale, (v.co.z - floor) * scale))
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=MERGE_DISTANCE)
    bpy.ops.object.mode_set(mode='OBJECT')
    mesh.data.calc_loop_triangles()
    decimate = mesh.modifiers.new('Triangle budget', 'DECIMATE')
    decimate.ratio = TRI_BUDGET / len(mesh.data.loop_triangles)
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    triangulate = mesh.modifiers.new('Triangles', 'TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=triangulate.name)
    # Collapse can move the extremal surface by a fraction of a millimetre.
    floor = min(v.co.z for v in mesh.data.vertices)
    final_scale = HEIGHT / (max(v.co.z for v in mesh.data.vertices) - floor)
    for v in mesh.data.vertices:
        v.co.z = (v.co.z - floor) * final_scale
    for face in mesh.data.polygons:
        face.use_smooth = True

    armature = bpy.data.armatures.new('StrikerSkeleton')
    rig = bpy.data.objects.new('Striker', armature)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    mesh.select_set(False)
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')

    def bone(name, start, end, parent=None):
        b = armature.edit_bones.new(name)
        b.head, b.tail = start, end
        if parent:
            b.parent = armature.edit_bones[parent]
        b.use_deform = True
        return b

    bone('root', (0, 0, 0), (0, 0, ROOT_TAIL_HEIGHT))
    for name, end, parent in [('hips', 'spine', 'root'), ('spine', 'chest', 'hips'),
                              ('chest', 'neck', 'spine'), ('neck', 'head', 'chest'),
                              ('head', 'crown', 'neck')]:
        bone(name, JOINTS[name], JOINTS[end], parent)
    for side, sign in [('L', 1), ('R', -1)]:
        def point(name):
            x, y, z = JOINTS[name]
            return (sign * x, y, z)
        for name, end, parent in [
            ('shoulder', 'upperarm', 'chest'), ('upperarm', 'forearm', 'shoulder'),
            ('forearm', 'hand', 'upperarm'), ('hand', 'fingers', 'forearm'),
            ('thigh', 'shin', 'hips'), ('shin', 'foot', 'thigh'),
            ('foot', 'toe', 'shin'), ('toe', 'toe_end', 'foot')]:
            parent_name = parent if parent in ('chest', 'hips') else parent + '_' + side
            bone(name + '_' + side, point(name), point(end), parent_name)
    bpy.ops.object.mode_set(mode='OBJECT')
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = rig
    try:
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    except RuntimeError as error:
        print('HEAT_ERROR', error)
    unweighted = sum(not any(g.weight > 0 for g in v.groups) for v in mesh.data.vertices)
    print('HEAT_UNWEIGHTED', unweighted)
    method = 'bone heat'
    if unweighted:
        method = 'segment-distance fallback'
        mesh.vertex_groups.clear()
        deform = [b for b in armature.bones if b.name != 'root']
        for b in deform:
            mesh.vertex_groups.new(name=b.name)
        for v in mesh.data.vertices:
            candidates = []
            for b in deform:
                segment = b.tail_local - b.head_local
                t = max(0, min(1, (v.co - b.head_local).dot(segment) / segment.length_squared))
                distance = (v.co - b.head_local - segment * t).length
                candidates.append((distance, b.name))
            closest = sorted(candidates)[:4]
            weights = [(name, 1 / max(distance, FALLBACK_DISTANCE_FLOOR) ** FALLBACK_DISTANCE_POWER)
                       for distance, name in closest]
            total = sum(w for _, w in weights)
            for name, weight in weights:
                mesh.vertex_groups[name].add([v.index], weight / total, 'REPLACE')
        mesh.parent = rig
        if not any(m.type == 'ARMATURE' for m in mesh.modifiers):
            mesh.modifiers.new('Skin', 'ARMATURE').object = rig
        bpy.context.view_layer.objects.active = mesh
        bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=FALLBACK_SMOOTH_FACTOR,
                                           repeat=FALLBACK_SMOOTH_PASSES)
    # Heat follows surface connectivity; suppress small cross-region influences
    # without cutting a geometric plane through fingers or the shirt surface.
    cleaned = 0
    for v in mesh.data.vertices:
        if not ARM_CLEANUP_MIN_HEIGHT <= v.co.z < ARMPIT_HEIGHT:
            continue
        weights = [(g.group, g.weight) for g in v.groups]
        arm_weight = sum(w for i, w in weights if mesh.vertex_groups[i].name.startswith(
            ('shoulder_', 'upperarm_', 'forearm_', 'hand_')))
        if CROSS_REGION_LIMIT < arm_weight < 1 - CROSS_REGION_LIMIT:
            continue
        is_arm = arm_weight >= 1 - CROSS_REGION_LIMIT
        for index, weight in weights:
            name = mesh.vertex_groups[index].name
            arm_group = name.startswith(('shoulder_', 'upperarm_', 'forearm_', 'hand_'))
            if arm_group != is_arm:
                mesh.vertex_groups[index].remove([v.index])
                cleaned += 1
    print('BLEED_WEIGHTS_REMOVED', cleaned)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    print('WEIGHTING:', method, 'with arm/shirt cleanup; normalized, four influences maximum')

    for material in mesh.data.materials:
        for node in material.node_tree.nodes:
            if node.type != 'TEX_IMAGE' or not node.image:
                continue
            image = node.image
            base = any(link.to_socket.name == 'Base Color' for link in node.outputs['Color'].links)
            limit = BASE_SIZE if base else MAP_SIZE
            width, height = image.size
            if max(width, height) > limit:
                ratio = limit / max(width, height)
                image.scale(round(width * ratio), round(height * ratio))
            image.file_format = 'JPEG'
    OUTPUT.parent.mkdir(exist_ok=True)
    CAPTURES.mkdir(exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    rig.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', use_selection=True,
        export_yup=True, export_animations=False, export_def_bones=True,
        export_image_format='JPEG', export_jpeg_quality=JPEG_QUALITY,
        export_all_influences=False)
    print('TRIANGLES', len(mesh.data.polygons), 'BYTES', OUTPUT.stat().st_size)
    print('JOINT_HEIGHTS', {n: JOINTS[n][2] for n in ['thigh', 'shin', 'foot', 'upperarm', 'forearm', 'hand']})
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x, scene.render.resolution_y = RENDER_SIZE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'TEXTURE'
    shading.show_shadows = True
    shading.show_cavity = True
    shading.background_type = 'WORLD'
    scene.world.color = (.16, .17, .19)
    camera_data = bpy.data.cameras.new('DiagnosticCamera')
    camera = bpy.data.objects.new('DiagnosticCamera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = CAMERA_SCALE
    for pose_name, rotations in POSES.items():
        for b in rig.pose.bones:
            b.rotation_mode = 'QUATERNION'
            b.rotation_quaternion.identity()
        for name, (axis, degrees) in rotations.items():
            b = rig.pose.bones[name]
            world_axis = Vector({'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}[axis])
            local_axis = b.bone.matrix_local.to_quaternion().inverted() @ world_axis
            b.rotation_quaternion = Quaternion(local_axis, math.radians(degrees))
        bpy.context.view_layer.update()
        for view, location in [('front', (0, -5, 1.05)), ('side', (5, 0, 1.05))]:
            camera.location = location
            camera.rotation_euler = (Vector(CAMERA_TARGET) - camera.location).to_track_quat('-Z', 'Y').to_euler()
            scene.render.filepath = str(CAPTURES / f'rig-{pose_name}-{view}.png')
            bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()

