"""Rebuild the Captain asset and diagnostic poses with Blender --factory-startup."""
from pathlib import Path
import math
import json
import numpy as np
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


# Seconds, bone rotations in the proven POSES axes. Hip motion is in metres.
READY = {'thigh_L': ('X', -8), 'thigh_R': ('X', -8),
         'shin_L': ('X', 12), 'shin_R': ('X', 12),
         'upperarm_L': ('Y', -8), 'upperarm_R': ('Y', 8),
         'forearm_L': ('X', -15), 'forearm_R': ('X', -15),
         'spine': ('X', 3)}
CLIPS = {
    'idle': {'duration': 2.0, 'loop': True, 'keys': [
        (0, READY), (.5, dict(READY, chest=('X', 1), hips=('Z', 1))),
        (1, dict(READY, chest=('X', 2))),
        (1.5, dict(READY, chest=('X', 1), hips=('Z', -1))), (2, READY)]},
    # Toe trajectories relative to the hips, metres. Stance is constant-speed;
    # the airborne return is a Hermite arc with matching lift-off/landing velocity.
    'walk': {'duration': 1.1, 'loop': True, 'gait': {
        'stance': .56, 'front': .36, 'back': -.424, 'hips': .81,
        'bob': .035, 'lift': .12, 'heel': -15, 'push': 40}},
    'run': {'duration': .64, 'loop': True, 'gait': {
        'stance': .17, 'front': .50, 'back': -.556, 'hips': .72,
        'bob': .045, 'lift': .15, 'heel': -8, 'push': 55, 'return_blend': .1}},
    'kick': {'duration': 1.0, 'loop': False, 'keys': [
        (0, READY),
        (.16, dict(READY, thigh_R=('X', 40), shin_R=('X', 100),
                   foot_R=('X', 18), spine=('X', 8),
                   upperarm_L=(('X', -20), ('Y', -60)), upperarm_R=('X', 25))),
        (.28, dict(READY, thigh_R=('X', -20), shin_R=('X', 3),
                   foot_R=('X', 33), spine=('X', 12),
                   upperarm_L=('Y', -55), upperarm_R=('X', -30))),
        (.55, dict(READY, thigh_R=('X', -70), shin_R=('X', 0),
                   foot_R=('X', 10), spine=('X', -7),
                   upperarm_L=(('X', 30), ('Y', -35)), upperarm_R=('X', -40))),
        (.78, dict(READY, thigh_R=('X', -25), shin_R=('X', 40))), (1, READY)]},
}
FPS = 100  # Exact contact/cycle endpoints; dense sampling preserves planted soles.


def author_clips(rig, mesh):
    scene = bpy.context.scene
    scene.render.fps = FPS
    rig.animation_data_create()
    actions = {}
    report = {}
    metadata = {'clips': {}, 'kickFoot': {}}
    boot_indices = {side: [v.index for v in mesh.data.vertices
                          if v.co.z < .19 and v.co.x * sign > .08]
                    for side, sign in [('L', 1), ('R', -1)]}

    def soles():
        evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        return {side: min(evaluated.data.vertices[i].co.z for i in indices)
                for side, indices in boot_indices.items()}

    def instep(side):
        return (rig.pose.bones['foot_' + side].head + rig.pose.bones['toe_' + side].head) * .5

    def rotate(bone_name, angle):
        bone = rig.pose.bones[bone_name]
        bone.rotation_mode = 'QUATERNION'
        axis = bone.bone.matrix_local.to_quaternion().inverted() @ Vector((1, 0, 0))
        bone.rotation_quaternion = Quaternion(axis, math.radians(angle))

    def leg(side, angles, pitch):
        rotate('thigh_' + side, angles[0])
        rotate('shin_' + side, angles[1])
        rotate('foot_' + side, pitch - sum(angles))
        bpy.context.view_layer.update()

    def solve(side, forward, elevation, pitch, angles):
        # Two-angle IK preserves all bone lengths and skin data. Solve the live
        # joint positions, including the rig's non-vertical rest-bone axes.
        target = np.array([-forward, elevation])
        angles = np.array(angles, dtype=float)
        for iteration in range(16):
            leg(side, angles, pitch)
            point = rig.pose.bones['toe_' + side].head
            current = np.array([point.y, point.z])
            error = target - current
            if np.linalg.norm(error) < .00002:
                break
            jacobian = np.zeros((2, 2))
            for axis in range(2):
                trial = angles.copy()
                trial[axis] += .1
                leg(side, trial, pitch)
                point = rig.pose.bones['toe_' + side].head
                jacobian[:, axis] = (np.array([point.y, point.z]) - current) / .1
            delta = np.linalg.lstsq(jacobian, error, rcond=None)[0]
            angles += np.clip(delta, -12, 12)
            angles[1] = max(0, min(150, angles[1]))
        leg(side, angles, pitch)
        return angles

    def gait_keys(name, clip):
        gait = clip['gait']
        duration, stance = clip['duration'], gait['stance']
        speed = (gait['front'] - gait['back']) / stance
        thigh_angles = []
        knee_angles = []
        for frame in range(round(duration * FPS) + 1):
            time = frame / FPS
            for bone in rig.pose.bones:
                bone.rotation_mode = 'QUATERNION'
                bone.rotation_quaternion.identity()
                bone.location = (0, 0, 0)
            phase = (time / duration * 2) % 1
            height = gait['hips'] + gait['bob'] * math.sin(math.pi * phase) ** 2
            hips = rig.pose.bones['hips']
            hips.location = hips.bone.matrix_local.to_quaternion().inverted() @ Vector((0, 0, height - JOINTS['hips'][2]))
            rotate('spine', 10 if name == 'run' else 0)
            rotate('head', -10 if name == 'run' else 0)
            arm = math.cos(2 * math.pi * time / duration) * (40 if name == 'run' else 18)
            rotate('upperarm_L', arm)
            rotate('upperarm_R', -arm)
            rotate('forearm_L', -90 if name == 'run' else -20)
            rotate('forearm_R', -90 if name == 'run' else -20)
            if name == 'run':
                for bone_name, degrees in [('hips', -arm / 10), ('chest', arm / 5), ('head', -arm / 10)]:
                    bone = rig.pose.bones[bone_name]
                    axis = bone.bone.matrix_local.to_quaternion().inverted() @ Vector((0, 0, 1))
                    bone.rotation_quaternion @= Quaternion(axis, math.radians(degrees))
            for side, shift in [('L', 0), ('R', duration / 2)]:
                local = (time + shift) % duration
                if local < stance:
                    u = local / stance
                    forward = gait['front'] - speed * local
                    pitch = gait['heel'] + (gait['push'] - gait['heel']) * u ** 2
                    elevation = .06
                    lift = 0
                else:
                    u = (local - stance) / (duration - stance)
                    if name == 'run':
                        blend = gait['return_blend']
                        if u < blend:
                            v = u / blend
                            start, end = gait['back'], gait['back'] - .04
                            m0, m1 = -speed * (duration - stance) * blend, 0
                        elif u > 1 - blend:
                            v = (u - 1 + blend) / blend
                            start, end = gait['front'] + .04, gait['front']
                            m0, m1 = 0, -speed * (duration - stance) * blend
                        else:
                            v = (u - blend) / (1 - 2 * blend)
                            start, end = gait['back'] - .04, gait['front'] + .04
                            m0 = m1 = 0
                    else:
                        v = u
                        start, end = gait['back'], gait['front']
                        m0 = m1 = -min(.6, speed * (duration - stance))
                    forward = ((2*v**3 - 3*v**2 + 1) * start
                               + (v**3 - 2*v**2 + v) * m0
                               + (-2*v**3 + 3*v**2) * end
                               + (v**3 - v**2) * m1)
                    pitch = gait['push'] * (1-u) + gait['heel'] * u
                    lift = gait['lift'] * math.sin(math.pi * u) ** 1.3
                    elevation = .06 + lift
                # Positions are relative to the hip's forward coordinate.
                target = forward - JOINTS['hips'][1]
                angles = solve(side, target, elevation, pitch, (-25, 65))
                for correction in range(3):
                    floor = soles()[side]
                    elevation += (.012 if name == 'run' else .009) + lift - floor
                    angles = solve(side, target, elevation, pitch, angles)
                thigh_angles.append(float(angles[0]))
                knee_angles.append(float(angles[1]))
            for bone in rig.pose.bones:
                bone.keyframe_insert('rotation_quaternion', frame=frame, group=bone.name)
            hips.keyframe_insert('location', frame=frame, group='hips')
        print('GAIT_ANGLES', name, min(thigh_angles), max(thigh_angles), max(knee_angles))

    for name, clip in CLIPS.items():
        action = bpy.data.actions.new(name)
        actions[name] = action
        rig.animation_data.action = action
        keys = clip.get('keys', [])
        for time, pose in keys:
            frame = time * FPS
            for bone in rig.pose.bones:
                bone.rotation_mode = 'QUATERNION'
                bone.rotation_quaternion.identity()
                bone.location = (0, 0, 0)
                rotations = pose.get(bone.name, ())
                if rotations and isinstance(rotations[0], str):
                    rotations = (rotations,)
                for axis, degrees in rotations:
                    world = Vector({'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}[axis])
                    local = bone.bone.matrix_local.to_quaternion().inverted() @ world
                    bone.rotation_quaternion @= Quaternion(local, math.radians(degrees))
                bone.keyframe_insert('rotation_quaternion', frame=frame, group=bone.name)
        if 'gait' in clip:
            gait_keys(name, clip)
        # Preserve idle/kick grounding; gait IK already keys its hip trajectory.
        for frame in range(round(clip['duration'] * FPS) + 1):
            scene.frame_set(frame)
            hips = rig.pose.bones['hips']
            if 'gait' not in clip:
                hips.location = (0, 0, 0)
            bpy.context.view_layer.update()
            floor = min(soles().values())
            sway = (.008 if name == 'walk' else .004 if name == 'idle' else 0)
            height = .003 - floor
            if 'gait' not in clip:
                offset = Vector((sway * math.sin(2 * math.pi * frame / FPS / clip['duration']),
                                 0, height))
                hips.location = hips.bone.matrix_local.to_quaternion().inverted() @ offset
                hips.keyframe_insert('location', frame=frame, group='hips')
            bpy.context.view_layer.update()
        bag = action.layers[0].strips[0].channelbag(action.slots[0])
        height_curve = bag.fcurves.find('pose.bones["hips"].location', index=1)
        hip_heights = [key.co[1] for key in height_curve.keyframe_points]
        print('HIP_RANGE', name, max(hip_heights) - min(hip_heights))
        for slot in action.slots:
            for layer in action.layers:
                for strip in layer.strips:
                    bag = strip.channelbag(slot)
                    if bag:
                        for curve in bag.fcurves:
                            for key in curve.keyframe_points:
                                key.interpolation = 'BEZIER'
                                key.handle_left_type = key.handle_right_type = 'AUTO_CLAMPED'
                            if 'gait' in clip:
                                # Common Bezier timing across IK channels: independent
                                # automatic easing can straighten a knee below the floor.
                                points = curve.keyframe_points
                                for index, key in enumerate(points):
                                    key.handle_left_type = key.handle_right_type = 'FREE'
                                    for direction, neighbour in [('left', index - 1), ('right', index + 1)]:
                                        if 0 <= neighbour < len(points):
                                            delta = points[neighbour].co - key.co
                                            handle = key.co + Vector((delta.x / 3, delta.y * .95 / 3))
                                            setattr(key, 'handle_' + direction, handle)

        minimum = 1
        samples = []
        for sample in range(math.ceil(clip['duration'] * 240) + 1):
            time = min(sample / 240, clip['duration'])
            frame = time * FPS
            scene.frame_set(int(frame), subframe=frame % 1)
            samples.append((time, soles(), {s: rig.pose.bones['toe_' + s].head.copy() for s in ('L', 'R')}))
            floor_now = min(soles().values())
            if floor_now < minimum:
                minimum = floor_now
                min_time = time
        print('MIN_SOLE', name, minimum, min_time)
        assert minimum >= 0, (name, 'floor penetration', minimum)
        info = {'duration': clip['duration'], 'loop': clip['loop']}
        if name in ('walk', 'run'):
            windows = []
            for side in ('L', 'R'):
                window = []
                for time, heights, points in samples:
                    if heights[side] <= .02 and (not window or -points[side].y < window[-1][1] + .002):
                        window.append((time, -points[side].y))
                    else:
                        if len(window) >= 3:
                            windows.append(window)
                        window = []
                if len(window) >= 3:
                    windows.append(window)
            # Total backward stance travel / total contact time (metres per second).
            travel = sum(window[0][1] - window[-1][1] for window in windows)
            contact_time = sum(window[-1][0] - window[0][0] for window in windows)
            speed = travel / contact_time
            residuals = []
            for window in windows:
                t, z = np.array(window).T
                planted = z + speed * t
                residuals.extend(planted - planted.mean())
            info['speed'] = round(speed, 6)
            report[name] = {'speed': speed, 'slide_rms_m': float(np.sqrt(np.mean(np.square(residuals)))),
                            'slide_max_m': max(abs(v) for v in residuals),
                            'windows': [[w[0][0], w[-1][0]] for w in windows],
                            'flight': sum(min(h.values()) > .02 for _, h, _ in samples[:-1]) / (len(samples)-1)}
            measured = report[name]
            limits = (1.3, 1.5, .02, .04) if name == 'walk' else (5.8, 6.4, .04, .07)
            assert limits[0] <= speed <= limits[1], (name, measured)
            assert measured['slide_max_m'] < limits[2], (name, measured)
            assert max(hip_heights) - min(hip_heights) <= limits[3], name
            assert measured['flight'] == 0 if name == 'walk' else .30 <= measured['flight'] <= .45
        if name == 'kick':
            info['contact'] = .28
            scene.frame_set(round(.28 * FPS))
            point = instep('R')
            assert (Vector((point.x, point.z, -point.y)) - Vector((-.229, .138431, .289139))).length < .03
            print('KICK_ANKLE_DEGREES', math.degrees(rig.pose.bones['foot_R'].rotation_quaternion.angle))
            metadata['kickFoot'] = {'x': round(point.x, 6), 'y': round(point.z, 6), 'z': round(-point.y, 6)}
        metadata['clips'][name] = info
        action.use_fake_user = True
    print('ANIMATION_MEASUREMENTS', json.dumps(report))
    print('KICK_FOOT', metadata['kickFoot'])
    OUTPUT.with_suffix('.json').write_text(json.dumps(metadata, indent=2) + '\n')
    rig.animation_data.action = None
    for bone in rig.pose.bones:
        bone.rotation_quaternion.identity()
        bone.location = (0, 0, 0)
    bpy.context.view_layer.update()
    return actions


def filmstrips(rig, actions):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = 256
    scene.render.resolution_y = 320
    scene.render.resolution_percentage = 100
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.background_type = 'WORLD'
    scene.world.color = (.16, .17, .19)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.003))
    floor = bpy.context.object
    floor.color = (.23, .25, .27, 1)
    # Edge-on orthographic views need an explicit visible floor datum.
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -.008))
    bpy.context.object.scale = (20, 20, .012)
    camera_data = bpy.data.cameras.new('AnimationCamera')
    camera = bpy.data.objects.new('AnimationCamera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = 2.5
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=.22)
    ball = bpy.context.object
    ball.hide_render = True
    for name, action in actions.items():
        rig.animation_data.action = action
        for view in (['side', 'front'] if name == 'kick' else ['side']):
            camera.location = (5, 0, 1.05) if view == 'side' else (0, -5, 1.05)
            camera.rotation_euler = (Vector((0, 0, 1.05)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
            frames = []
            for i in range(8):
                t = CLIPS[name]['duration'] * i / 7
                scene.frame_set(int(t * FPS), subframe=t * FPS % 1)
                # Reload a temporary PNG: Workbench Render Result has no readable pixels in background mode.
                temp = CAPTURES / 'anim-frame.png'
                scene.render.filepath = str(temp)
                bpy.ops.render.render(write_still=True)
                loaded = bpy.data.images.load(str(temp), check_existing=False)
                frames.append(np.array(loaded.pixels[:], dtype=np.float32).reshape(320, 256, 4))
                bpy.data.images.remove(loaded)
            strip = bpy.data.images.new('Filmstrip', width=2048, height=320, alpha=True)
            strip.pixels.foreach_set(np.concatenate(frames, axis=1).ravel())
            strip.filepath_raw = str(CAPTURES / f'anim-{name}-{view}.png')
            strip.file_format = 'PNG'
            strip.save()
            bpy.data.images.remove(strip)
    rig.animation_data.action = actions['kick']
    scene.frame_set(round(.28 * FPS))
    point = (rig.pose.bones['foot_R'].head + rig.pose.bones['toe_R'].head) * .5
    # Grounded sphere with its rear surface touching the measured instep.
    dz = point.z - .22
    ball.location = (point.x, point.y - math.sqrt(max(0, .22 ** 2 - dz ** 2)), .22)
    ball.hide_render = False
    camera.location = (5, 0, 1.05)
    camera.rotation_euler = (Vector((0, 0, 1.05)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.resolution_x, scene.render.resolution_y = RENDER_SIZE
    scene.render.filepath = str(CAPTURES / 'anim-kick-contact.png')
    bpy.ops.render.render(write_still=True)
    (CAPTURES / 'anim-frame.png').unlink(missing_ok=True)


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
    actions = author_clips(rig, mesh)
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', use_selection=True,
        export_yup=True, export_animations=True, export_animation_mode='ACTIONS',
        export_force_sampling=True, export_frame_range=False, export_def_bones=True,
        export_image_format='JPEG', export_jpeg_quality=JPEG_QUALITY,
        export_all_influences=False)
    print('TRIANGLES', len(mesh.data.polygons), 'BYTES', OUTPUT.stat().st_size)
    print('JOINT_HEIGHTS', {n: JOINTS[n][2] for n in ['thigh', 'shin', 'foot', 'upperarm', 'forearm', 'hand']})
    filmstrips(rig, actions)


if __name__ == '__main__':
    main()
