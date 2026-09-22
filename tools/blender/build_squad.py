"""Prepare the supplied Meshy biped and clips for the shared squad asset.

Run with Blender --background --factory-startup --python tools/blender/build_squad.py.
No downloaded packages or texture generation required.
"""
from pathlib import Path
import json
import math
import sys
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
CELEBRATIONS = {'celebrate_backflip': 'Backflip', 'celebrate_backflip_hooks': 'Backflip_and_Hooks',
                'celebrate_dance': 'All_Night_Dance', 'celebrate_heart': 'Big_Heart_Gesture'}
NEW_CELEBRATIONS = {'celebrate_victory': ('Victory_Cheer', 'victory'),
                    'celebrate_jump': ('happy_jump_m', 'jump'),
                    'celebrate_cheer': ('Motivational_Cheer', 'cheer')}
CELEBRATIONS.update({name: value[0] for name, value in NEW_CELEBRATIONS.items()})
SOURCES.update(CELEBRATIONS)
REACTIONS = {'react_stomp': 'Angry_Ground_Stomp', 'react_shout': 'Shouting_Angrily',
             'react_confused': 'Confused_Scratch', 'react_walk_sad': '01a0c45c-030d-7043-885d-08f599aadbcf'}
SOURCES.update(REACTIONS)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.render.fps = FPS
samples = {}
source_report = {}
base_rig = base_mesh = None
for name, source in SOURCES.items():
    before = set(bpy.data.objects)
    directory = ROOT / 'references/Meshy_AI_Captain_of_Tomorrow_biped' if name in CELEBRATIONS else SOURCE
    if name in REACTIONS:
        directory = ROOT / 'references'
    if name in NEW_CELEBRATIONS:
        path = ROOT / 'references/celebrations' / (NEW_CELEBRATIONS[name][1] + '.glb')
    else:
        path = ROOT / 'references/walksad.glb' if name == 'react_walk_sad' else next(directory.glob('*_Animation_' + source + '_withSkin.glb'))
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = set(bpy.data.objects) - before
    rig = next(o for o in imported if o.type == 'ARMATURE')
    mesh = next(o for o in imported if o.type == 'MESH' and o.find_armature() == rig)
    if '--export-rig-source' in sys.argv:
        # Supply a true rest-pose mesh; the original textured download is posed.
        rig.data.pose_position = 'REST'
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action='DESELECT')
        mesh.select_set(True)
        bpy.context.view_layer.objects.active = mesh
        bpy.ops.object.convert(target='MESH')
        decimate = mesh.modifiers.new('Rig upload budget', 'DECIMATE')
        decimate.ratio = min(1, 30000 / len(mesh.data.polygons))
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        for image in bpy.data.images:
            if image.size[0] > 512:
                image.scale(512, 512)
        bpy.ops.export_scene.gltf(filepath=str(ROOT / 'references/celebrations/rig-source.glb'),
                                 export_format='GLB', use_selection=True, export_animations=False)
        sys.exit(0)
    # Each file also contains a two-frame .001 setup action. Never use that
    # helper in place of the named performance.
    action = next(a for a in bpy.data.actions if a.name == source or ('|' + source + '|') in a.name)
    rig.animation_data.action = action
    rig.animation_data.action_slot = action.slots[0]
    start, end = action.frame_range
    frames = []
    headings = []
    if name in NEW_CELEBRATIONS:
        # Meshy's current API uses a different skeleton from the supplied
        # Mixamo biped. Transfer world-space rotation deltas from bind pose,
        # retaining the original player's bone lengths, mesh and skin weights.
        mapping = {'Spine1': 'Spine01', 'Spine2': 'Spine02', 'Neck': 'neck'}
        target_world = base_rig.matrix_world.copy()
        source_world = rig.matrix_world.copy()
        ordered = sorted(base_rig.pose.bones, key=lambda b: len(b.parent_recursive))
        for frame in range(round(start), round(end) + 1):
            bpy.context.scene.frame_set(frame)
            for bone in ordered:
                short_name = bone.name.removeprefix('mixamorig:')
                source_bone = rig.pose.bones.get(mapping.get(short_name, short_name))
                if source_bone is None:
                    bone.matrix_basis.identity()
                    continue
                rest = source_world @ source_bone.bone.matrix_local
                posed = source_world @ source_bone.matrix
                rotation = posed.to_quaternion() @ rest.to_quaternion().inverted()
                rotation = target_world.to_quaternion().inverted() @ rotation @ (target_world @ bone.bone.matrix_local).to_quaternion()
                if bone.parent:
                    relative = bone.parent.bone.matrix_local.inverted() @ bone.bone.matrix_local
                    position = (bone.parent.matrix @ relative).translation
                else:
                    delta = posed.translation - rest.translation
                    position = bone.bone.matrix_local.translation + target_world.inverted().to_3x3() @ delta
                bone.matrix = Matrix.LocRotScale(position, rotation, Vector((1, 1, 1)))
                bpy.context.view_layer.update()
            frames.append({b.name: b.matrix_basis.copy() for b in base_rig.pose.bones})
        # The library clips include long neutral bookends. Keep the complete
        # gesture/jump and landing, with short transition handles, at native speed.
        trim_start, trim_end = round(.5 * FPS), round(7.0 * FPS)
        samples[name] = frames[trim_start:trim_end + 1]
        source_report[name] = {'file': source, 'sourceDuration': (end - start) / FPS,
                              'sourceFrames': len(frames), 'retargeted': True,
                              'trimStart': .5, 'trimEnd': 7.0}
        for o in imported:
            bpy.data.objects.remove(o, do_unlink=True)
        continue
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
# Weld split UV seams before simplification so facial islands stay connected.
bm = bmesh.new()
bm.from_mesh(mesh.data)
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bm.to_mesh(mesh.data)
bm.free()
decimate = mesh.modifiers.new('Shared squad triangle budget', 'DECIMATE')
decimate.ratio = min(1, 24000 / len(mesh.data.polygons))
bpy.ops.object.modifier_apply(modifier=decimate.name)
# Cut the garment hems before assigning regions, avoiding stair-step colour
# boundaries across large simplified triangles.
bm = bmesh.new()
bm.from_mesh(mesh.data)
# Remove small scan-like spikes without flattening the nose, lips or ears.
head_vertices = [v for v in bm.verts if v.co.z > 1.43 and abs(v.co.x) < .14]
for _ in range(3):
    bmesh.ops.smooth_vert(bm, verts=head_vertices, factor=.22,
                          use_axis_x=True, use_axis_y=True, use_axis_z=True)
# Replace the source's bulky sculpted fringe with a clean scalp foundation.
# Blend through the forehead so hair and skin retain exactly matching seams.
for v in head_vertices:
    t = max(0, min(1, (v.co.z - 1.575) / .045))
    t = t * t * (3 - 2 * t)
    direction = Vector((v.co.x / .093, (v.co.y - .005) / .10, (v.co.z - 1.575) / .105))
    direction.normalize()
    target = Vector((direction.x * .093, .005 + direction.y * .10, 1.575 + direction.z * .105))
    v.co = v.co.lerp(target, t)
for height in (.12, .44, .63, .88, 1.43, 1.465):
    bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                          plane_co=(0, 0, height), plane_no=(0, 0, 1), dist=.00001)
for side in (-1, 1):
    # Raised sides of a small crew-neck opening; keep the trapezius in cloth.
    bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                          plane_co=(0, 0, 1.43), plane_no=(-side * .6, 0, 1), dist=.00001)
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
    # A close crew neck at the base of the neck keeps the upper chest and
    # trapezius covered. The cut above makes a clean sewn edge, not triangles.
    elif (z > min(1.465, 1.43 + abs(x) * .6) and abs(x) < .14) or (abs(x) > .36 and z > 1.10):
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

# Discard imported split normals after reshaping; keeping them makes the old
# fringe appear embossed on the smooth scalp, especially on bald players.
mesh.data.normals_split_custom_set([(0, 0, 0)] * len(mesh.data.loops))

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

# Keep the sad steps and lowered gaze, but remove the source's braced,
# raised-shoulder silhouette. Borrow relaxed articulation from normal walking
# without scaling bones or changing the player's physique.
relaxed_upper = {'Spine': .35, 'Spine1': .45, 'Spine2': .65, 'Neck': .65, 'Head': .35,
                 'LeftShoulder': .85, 'RightShoulder': .85,
                 'LeftArm': .65, 'RightArm': .65, 'LeftForeArm': .45, 'RightForeArm': .45}
walk = samples['walk']
for i, frame in enumerate(samples['react_walk_sad']):
    phase = (i * .75) % (len(walk) - 1)
    first = int(phase)
    fraction = phase - first
    for name, weight in relaxed_upper.items():
        key = 'mixamorig:' + name
        loc, rot, scale = frame[key].decompose()
        walk_loc, walk_rot, walk_scale = walk[first][key].decompose()
        next_loc, next_rot, next_scale = walk[first + 1][key].decompose()
        frame[key] = Matrix.LocRotScale(walk_loc.lerp(next_loc, fraction),
            rot.slerp(walk_rot.slerp(next_rot, fraction), weight), walk_scale.lerp(next_scale, fraction))
    for bone in rig.pose.bones:
        bone.matrix_basis = frame[bone.name]
    bpy.context.view_layer.update()
    for side, sign in (('Left', 1), ('Right', -1)):
        bone = rig.pose.bones['mixamorig:' + side + 'Shoulder']
        origin = bone.head.copy()
        rotation = Matrix.Rotation(math.radians(8) * sign, 4, 'Y')
        bone.matrix = Matrix.Translation(origin) @ rotation @ Matrix.Translation(-origin) @ bone.matrix
        bpy.context.view_layer.update()
        frame[bone.name] = bone.matrix_basis.copy()

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
