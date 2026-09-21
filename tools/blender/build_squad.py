"""Prepare the supplied Meshy biped and clips for the shared squad asset.

Run with Blender --background --factory-startup --python tools/blender/build_squad.py.
No downloaded packages or texture generation required.
"""
from pathlib import Path
import json
import math
import bpy
import bmesh
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'references/Meshy_AI_Captain_of_Tomorrow_biped (1)/Meshy_AI_Captain_of_Tomorrow_biped'
FPS = 24
SCALE = 1.85 / 1.7
SOURCES = {'walk': 'Walking', 'run': 'Running', 'kick': 'Kick_a_Soccer_Ball',
           'quick_walk': 'Quick_Walk', 'run_alt': 'Run_03',
           'turn_idle_left': 'Idle_Turn_Left', 'turn_idle_right': 'Idle_Turn_Right',
           'turn_walk_left': 'Walk_Turn_Left', 'turn_walk_right': 'Walk_Turn_Right',
           'dive_left': '01a0c35d-1cd2-72af-bf7d-3d8732d52731',
           'dive_right': '01a0c35e-c157-7267-a5a0-278b419c0134',
           'keeper_idle': '01a0c3d7-6ce5-725a-a34e-52a339057158',
           'alert': 'Alert', 'slide_left': 'slide_light', 'slide_right': 'slide_right'}
GAITS = ('walk', 'quick_walk', 'run', 'run_alt')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.render.fps = FPS
samples = {}
source_report = {}
base_rig = base_mesh = None
for name, source in SOURCES.items():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(next(SOURCE.glob('*_Animation_' + source + '_withSkin.glb'))))
    imported = set(bpy.data.objects) - before
    rig = next(o for o in imported if o.type == 'ARMATURE')
    mesh = next(o for o in imported if o.type == 'MESH' and o.find_armature() == rig)
    # Each file also contains a two-frame .001 setup action. Never use that
    # helper in place of the named performance.
    action = next(a for a in bpy.data.actions if a.name == source)
    rig.animation_data.action = action
    rig.animation_data.action_slot = action.slots[0]
    start, end = action.frame_range
    frames = []
    headings = []
    for frame in range(round(start), round(end) + 1):
        bpy.context.scene.frame_set(frame)
        hips = rig.pose.bones['mixamorig:Hips']
        matrix = hips.matrix.copy()
        direction = matrix.to_quaternion() @ Vector((0, 0, 1))
        heading = math.atan2(direction.x, -direction.y)
        headings.append(heading)
        matrix.translation.x = hips.bone.head_local.x
        matrix.translation.y = hips.bone.head_local.y
        if name.startswith('turn_'):
            # Gameplay owns facing; retain the stepping pose, remove clip yaw.
            translation = matrix.translation.copy()
            matrix = Matrix.Rotation(-heading, 4, 'Z') @ matrix
            matrix.translation = translation
        hips.matrix = matrix
        frames.append({b.name: b.matrix_basis.copy() for b in rig.pose.bones})
    source_report[name] = {'file': source, 'sourceDuration': (end - start) / FPS,
                           'sourceFrames': len(frames)}
    if name == 'quick_walk':
        # This source contains three repetitions. Find its shortest repeated
        # cycle so it shares a one-stride phase with Walking and Running.
        def error(period):
            return sum((frames[i]['mixamorig:LeftUpLeg'].to_quaternion().rotation_difference(
                frames[i + period]['mixamorig:LeftUpLeg'].to_quaternion()).angle) ** 2
                for i in range(len(frames) - period)) / (len(frames) - period)
        period = min(range(12, len(frames) // 2), key=error)
        frames = frames[:period + 1]
        source_report[name]['cycleFrames'] = period
    if name == 'keeper_idle':
        # The preparation ends more upright than it starts. Ease back into
        # the crouch over the final half-second instead of snapping at wrap.
        for i in range(len(frames) - 12, len(frames)):
            t = (i - (len(frames) - 12)) / 11
            weight = t * t * (3 - 2 * t)
            for bone in frames[i]:
                loc, rot, scale = frames[i][bone].decompose()
                first_loc, first_rot, first_scale = frames[0][bone].decompose()
                frames[i][bone] = Matrix.LocRotScale(loc.lerp(first_loc, weight),
                    rot.slerp(first_rot, weight), scale.lerp(first_scale, weight))
    if name in GAITS or name in ('keeper_idle', 'alert'):
        frames[-1] = frames[0]
    samples[name] = frames
    if base_rig is None:
        base_rig, base_mesh = rig, mesh
        rig.animation_data_clear()
        for o in imported - {rig, mesh}:
            bpy.data.objects.remove(o, do_unlink=True)
    else:
        for o in imported:
            bpy.data.objects.remove(o, do_unlink=True)

rig, mesh = base_rig, base_mesh
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
rig.data.pose_position = 'REST'
bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
decimate = mesh.modifiers.new('Shared squad triangle budget', 'DECIMATE')
decimate.ratio = min(1, 24000 / len(mesh.data.polygons))
bpy.ops.object.modifier_apply(modifier=decimate.name)
# Cut the garment hems before assigning regions, avoiding stair-step colour
# boundaries across large simplified triangles.
bm = bmesh.new()
bm.from_mesh(mesh.data)
for height in (.12, .44, .63, .88):
    bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                          plane_co=(0, 0, height), plane_no=(0, 0, 1), dist=.00001)
bm.to_mesh(mesh.data)
bm.free()

# The supplied biped has a normal map but no base-colour map. Define garment
# regions on the unposed mesh so colour follows the skinning, never world Y.
mesh.data.materials.clear()
colours = {'skin': (.55, .32, .19, 1), 'hair': (.035, .018, .01, 1),
           'kit': (.03, .16, .8, 1), 'shorts': (.8, .85, .9, 1),
           'socks': (.03, .16, .8, 1), 'boots': (.012, .016, .02, 1),
           'gloves': (.55, .32, .19, 1)}
for name, colour in colours.items():
    material = bpy.data.materials.new(name)
    material.diffuse_color = colour
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = colour
    shader.inputs['Roughness'].default_value = .78
    mesh.data.materials.append(material)
names = list(colours)
for polygon in mesh.data.polygons:
    p = sum((mesh.data.vertices[i].co for i in polygon.vertices), Vector()) / len(polygon.vertices)
    x, y, z = p
    if z > 1.625 or (z > 1.51 and y > .055):
        region = 'hair'
    elif abs(x) > .69 and z > 1.10:
        region = 'gloves'
    elif (z > 1.405 and abs(x) < .14) or (abs(x) > .36 and z > 1.10):
        region = 'skin'
    elif z > .88:
        region = 'kit'
    elif z > .63:
        region = 'shorts'
    elif z > .44:
        region = 'skin'
    elif z > .12:
        region = 'socks'
    else:
        region = 'boots'
    polygon.material_index = names.index(region)
    polygon.use_smooth = True

rig.data.pose_position = 'POSE'
rig.animation_data_create()
# Relax the kick's braced shoulders for standing. Rotate each clavicle about
# its chest attachment in armature space, dropping the shoulder and letting
# the arm hang closer to the body without stretching the neck or the mesh.
for bone in rig.pose.bones:
    bone.matrix_basis = samples['kick'][0][bone.name]
bpy.context.view_layer.update()
for side, sign in (('Left', 1), ('Right', -1)):
    bone = rig.pose.bones['mixamorig:' + side + 'Shoulder']
    origin = bone.head.copy()
    rotation = Matrix.Rotation(math.radians(14) * sign, 4, 'Y')
    bone.matrix = Matrix.Translation(origin) @ rotation @ Matrix.Translation(-origin) @ bone.matrix
    bpy.context.view_layer.update()
idle = {bone.name: bone.matrix_basis.copy() for bone in rig.pose.bones}
samples['idle'] = [dict(idle) for _ in range(49)]
for i, frame in enumerate(samples['idle']):
    frame['mixamorig:Spine2'] = frame['mixamorig:Spine2'] @ Matrix.Rotation(math.sin(i / 48 * math.tau) * .012, 4, 'X')

# The supplied kick strikes on the forward swing near 0.5 s. Its foot passes
# above a ground ball, so lower only the kicking leg through contact with CCD
# IK. Keep the planted leg, body and the original follow-through untouched.
for i, frame in enumerate(samples['kick']):
    for bone in rig.pose.bones:
        bone.matrix_basis = frame[bone.name]
    bpy.context.view_layer.update()
    foot = rig.pose.bones['mixamorig:RightFoot']
    toe = rig.pose.bones['mixamorig:RightToeBase']
    target = (foot.head + toe.head) * .5
    weight = math.exp(-((i / FPS - .5) / .075) ** 2)
    target.z -= (.249 - .11) / SCALE * weight
    for iteration in range(24):
        for name in ('mixamorig:RightLeg', 'mixamorig:RightUpLeg'):
            bone = rig.pose.bones[name]
            origin = bone.head.copy()
            point = (foot.head + toe.head) * .5
            rotation = (point - origin).rotation_difference(target - origin)
            bone.matrix = Matrix.Translation(origin) @ rotation.to_matrix().to_4x4() @ Matrix.Translation(-origin) @ bone.matrix
            bpy.context.view_layer.update()
    samples['kick'][i] = {b.name: b.matrix_basis.copy() for b in rig.pose.bones}
metadata = {'clips': {}, 'kickFoot': {}, 'source': SOURCE.name, 'audit': source_report}
actions = {}
for name, frames in samples.items():
    action = bpy.data.actions.new(name)
    rig.animation_data.action = action
    for i, frame in enumerate(frames):
        for bone in rig.pose.bones:
            bone.matrix_basis = frame[bone.name]
            bone.rotation_mode = 'QUATERNION'
            bone.keyframe_insert('location', frame=i)
            bone.keyframe_insert('rotation_quaternion', frame=i)
            bone.keyframe_insert('scale', frame=i)
    actions[name] = action
    metadata['clips'][name] = {'duration': (len(frames) - 1) / FPS}
    if name in GAITS:
        # Estimate stride speed from the rearward travel of the planted toe.
        toes = []
        for i in range(len(frames)):
            bpy.context.scene.frame_set(i)
            toes.append(rig.pose.bones['mixamorig:LeftToeBase'].head.copy())
        speeds = [(toes[i].y - toes[i - 1].y) * FPS * SCALE for i in range(1, len(toes))
                  if toes[i].z < .12 and toes[i - 1].z < .12 and toes[i].y > toes[i - 1].y]
        metadata['clips'][name]['speed'] = sorted(speeds)[len(speeds) // 2] if speeds else (1.4 if name == 'walk' else 4.5)
    if name == 'kick':
        # Contact must be on the forward swing, never the returning foot.
        best = None
        previous = None
        for i in range(1, len(frames) - 1):
            bpy.context.scene.frame_set(i)
            foot = (rig.pose.bones['mixamorig:RightFoot'].head + rig.pose.bones['mixamorig:RightToeBase'].head) * .5
            forward = previous.y - foot.y if previous is not None else 0
            if foot.z < .18 and forward > 0 and (best is None or forward > best[2]):
                best = (i, foot.copy(), forward)
            previous = foot.copy()
        i, foot, forward = best
        metadata['clips'][name]['contact'] = i / FPS
        metadata['kickFoot'] = {'x': foot.x * SCALE, 'y': foot.z * SCALE, 'z': -foot.y * SCALE}

rig.animation_data.action = None
for name, action in actions.items():
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 0, action)
    strip.action_slot = action.slots[0]
    track.mute = True
for bone in rig.pose.bones:
    bone.matrix_basis.identity()
wrapper = bpy.data.objects.new('CaptainScale', None)
bpy.context.collection.objects.link(wrapper)
rig.parent = wrapper
wrapper.scale = (SCALE,) * 3
bpy.ops.object.select_all(action='DESELECT')
for obj in (wrapper, rig, mesh):
    obj.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'assets/squad.glb'), export_format='GLB',
                         use_selection=True, export_animations=True,
                         export_animation_mode='NLA_TRACKS', export_force_sampling=True,
                         export_materials='EXPORT', export_yup=True)
(ROOT / 'assets/squad.json').write_text(json.dumps(metadata, indent=2) + '\n')
print('SQUAD', json.dumps(metadata), 'polygons', len(mesh.data.polygons))
