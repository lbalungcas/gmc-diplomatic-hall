"""
Builds public/models/diplomatic_hall.glb from the authoring .blend.

Run:  "D:\\Lancee_File\\blender.exe" -b diplomatic_hall_v10_textured.blend --python scripts/build_venue.py
  or: python scripts/build_venue.py            (finds Blender and re-invokes itself)

Replaces the old scripts/refine_scene.py. Beyond re-applying the regenerated PBR maps it fixes
the reasons the venue rendered as flat colour, all confirmed by inspecting the shipped GLB:

  * `Hall_Floor` and `Corridor_Floor` carried **no UV layer at all**, so the carpet and the
    marble each sampled a single texel across the two largest surfaces in the building.
  * Every other architectural surface was cube-unwrapped into a narrow band of UV space. The
    booth backwalls got 0.25 x 0.25 of their 1024px graphic for a 1.86 x 1.85 m panel — about
    256 texels across — which is why twenty exhibitor stands read as coloured blocks.
  * `Media_Hub` had all of its UVs collapsed onto a single point.

It also strips geometry the runtime never shows, shares mesh data between repeated props, and
merges static architecture so the hall costs a few dozen draw calls instead of several hundred.
"""

import math
import os
import subprocess
import sys

# ---------------------------------------------------------------------------------------------
# Allow `python scripts/build_venue.py` to work by re-invoking under Blender.
# ---------------------------------------------------------------------------------------------
try:
    import bpy
except ImportError:
    ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    BLENDER = next((p for p in (
        r'D:\Lancee_File\blender.exe',
        r'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe',
        r'C:\Program Files\Blender Foundation\Blender\blender.exe',
    ) if os.path.exists(p)), None)
    if not BLENDER:
        raise SystemExit('Blender not found — run this with `blender -b <blend> --python %s`' % __file__)
    src = os.path.join(ROOT, 'diplomatic_hall_v10_textured.blend')
    raise SystemExit(subprocess.call([BLENDER, '-b', src, '--python', os.path.abspath(__file__)]))

import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(bpy.data.filepath or __file__)))
if not os.path.isdir(os.path.join(ROOT, 'textures')):
    ROOT = r'C:\Users\Lawrence-S\Downloads\Game'
TEX = os.path.join(ROOT, 'textures')
OUT = os.path.join(ROOT, 'public', 'models', 'diplomatic_hall.glb')

# The walkable envelope, mirroring WORLD_BOUNDS in src/main.js (three.js z = -blender y).
# Anything comfortably outside it can never be seen, so it is dropped.
ENVELOPE = dict(min_x=0.0, max_x=28.0, min_y=0.0, max_y=26.0)

# Meshes the runtime hides and rebuilds procedurally — HIDE_NODE_RE in src/main.js, plus the
# organizer stands that src/modules/organizers.js replaces.
HIDDEN_AT_RUNTIME = ('Welcome_Desk', 'Commitment_Wall', 'Table_C_Dressed',
                     'TableSkirt', 'TableTop', 'BackdropPanel_3', 'Panel_4')

log = []


def say(msg):
    print(msg)
    log.append(msg)


# =============================================================================================
# Material construction
# =============================================================================================
_loaded_images = {}


def image(name):
    """Load a texture from `textures/`, never from the .blend.

    The authoring file has the whole v10 texture set *packed inside it* under the same
    filenames. `bpy.data.images.get('carpet_hall.png')` therefore returns the stale packed copy
    and the regenerated art on disk is silently ignored — which is exactly what happened on the
    first build: the GLB shipped the old 1024px carpet while the new 2048px one sat unused in
    the repo. Always go to disk, and key the cache on the resolved path.
    """
    path = os.path.join(TEX, name if name.endswith('.png') else name + '.png')
    if path in _loaded_images:
        return _loaded_images[path]
    if not os.path.exists(path):
        say(f'    !! missing texture {os.path.basename(path)}')
        _loaded_images[path] = None
        return None
    img = bpy.data.images.load(path, check_existing=False)
    img.name = 'tex_' + os.path.splitext(os.path.basename(path))[0]
    _loaded_images[path] = img
    return img


def gltf_output_group():
    """The node group the glTF exporter reads ambient occlusion out of.

    glTF has no Principled input for AO, so the exporter looks for a group literally named
    'glTF Material Output' and takes its 'Occlusion' socket. Without this the red channel of
    every ORM map would be exported as nothing.
    """
    name = 'glTF Material Output'
    grp = bpy.data.node_groups.get(name)
    if grp:
        return grp
    grp = bpy.data.node_groups.new(name, 'ShaderNodeTree')
    grp.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    grp.nodes.new('NodeGroupInput').location = (-200, 0)
    return grp


def build_pbr(mat, base=None, normal=None, orm=None, emission=None,
              color=None, roughness=None, metallic=None, emit_strength=1.0,
              normal_strength=1.0, detail=None, tint=None):
    """Rebuild `mat` as a clean Principled setup from a base/normal/ORM texture set.

    `detail` names a second, finely-tiled normal+ORM pair layered under a large unique base
    colour — the booth backwalls use it so every stand shares one fabric weave instead of
    baking the weave into twenty separate 1024px graphics.
    """
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    links = nt.links

    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.location = (700, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (380, 0)
    links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    if color is not None:
        bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    if roughness is not None:
        bsdf.inputs['Roughness'].default_value = roughness
    if metallic is not None:
        bsdf.inputs['Metallic'].default_value = metallic

    def tex(img_name, y, non_color, uv_scale=None):
        img = image(img_name)
        if img is None:
            return None
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image = img
        node.location = (-360, y)
        if non_color:
            node.image.colorspace_settings.name = 'Non-Color'
        if uv_scale:
            coord = nt.nodes.new('ShaderNodeTexCoord')
            coord.location = (-900, y)
            mapping = nt.nodes.new('ShaderNodeMapping')
            mapping.location = (-680, y)
            mapping.inputs['Scale'].default_value = (uv_scale, uv_scale, 1.0)
            links.new(coord.outputs['UV'], mapping.inputs['Vector'])
            links.new(mapping.outputs['Vector'], node.inputs['Vector'])
        return node

    if base:
        n = tex(base, 320, False)
        if n:
            src = n.outputs['Color']
            if tint:
                # Multiply the shared map by a constant so one texture can dress several
                # surfaces — the stage oak also becomes the booth counters, several shades
                # darker, instead of shipping a second near-identical wood map.
                mix = nt.nodes.new('ShaderNodeMix')
                mix.data_type = 'RGBA'
                mix.blend_type = 'MULTIPLY'
                mix.location = (-150, 320)
                mix.inputs['Factor'].default_value = 1.0
                links.new(src, mix.inputs[6])
                mix.inputs[7].default_value = (*tint, 1.0)
                src = mix.outputs[2]
            links.new(src, bsdf.inputs['Base Color'])

    # Detail maps replace the plain ones when present; the base colour stays unique per object.
    nrm_name, orm_name, nrm_scale = normal, orm, None
    if detail:
        nrm_name, orm_name, nrm_scale = detail[0], detail[1], detail[2]

    if orm_name:
        n = tex(orm_name, -40, True, nrm_scale)
        if n:
            sep = nt.nodes.new('ShaderNodeSeparateColor')
            sep.location = (-90, -40)
            links.new(n.outputs['Color'], sep.inputs['Color'])
            links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
            links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])

            grp = nt.nodes.new('ShaderNodeGroup')
            grp.node_tree = gltf_output_group()
            grp.location = (380, -420)
            links.new(sep.outputs['Red'], grp.inputs['Occlusion'])

    if nrm_name:
        n = tex(nrm_name, -360, True, nrm_scale)
        if n:
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nm.location = (-90, -360)
            nm.inputs['Strength'].default_value = normal_strength
            links.new(n.outputs['Color'], nm.inputs['Color'])
            links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])

    if emission:
        n = tex(emission, 600, False)
        if n:
            links.new(n.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emit_strength
    else:
        bsdf.inputs['Emission Strength'].default_value = 0.0

    return mat


# ---------------------------------------------------------------------------------------------
# Material table.
#
# `tile` is metres per texture repeat and drives the world-space UV projection, so texel
# density is consistent everywhere instead of depending on how each object happened to be
# unwrapped. `uv` is 'world' for tiling architecture and 'face' for artwork that maps once
# onto a panel.
# ---------------------------------------------------------------------------------------------
SURFACES = {
    'Mat_Hall_Carpet':    dict(uv='world', tile=4.0, base='carpet_hall', normal='carpet_hall_normal',
                               orm='carpet_hall_orm', normal_strength=1.0),
    'Mat_Corridor_Tile':  dict(uv='world', tile=3.0, base='corridor_tile', normal='corridor_tile_normal',
                               orm='corridor_tile_orm', normal_strength=0.8),
    'Mat_Acoustic_Wall':  dict(uv='world', tile=2.0, base='wall_panel', normal='wall_panel_normal',
                               orm='wall_panel_orm', normal_strength=1.0),
    # The stage reads under a 2.2-intensity spot, so the oak needs to start darker than it
    # would elsewhere or the highlight clips to white.
    'Mat_Stage_Wood':     dict(uv='world', tile=1.1, base='wood_stage', normal='wood_stage_normal',
                               orm='wood_stage_orm', normal_strength=0.9,
                               tint=(0.58, 0.47, 0.36)),
    'Mat_Ceiling':        dict(uv='world', tile=2.4, base='ceiling_tiles', normal='ceiling_tiles_normal',
                               orm='ceiling_tiles_orm', emission='ceiling_tiles_emission',
                               emit_strength=1.0, normal_strength=0.8,
                               tint=(0.50, 0.50, 0.52)),
    # Tiled, not face-mapped: this material covers the full width of the back wall, so a
    # one-shot layout would scale with the wall instead of with the room.
    'Mat_Stage_Backdrop': dict(uv='world', tile=3.0, base='stage_backdrop',
                               roughness=0.62, metallic=0.0),
    'Mat_Media_Hub':      dict(uv='face', base='media_hub', roughness=0.45, metallic=0.0),
    'Mat_Table_Linen':    dict(uv='world', tile=1.2, base='table_linen', normal='table_linen_normal',
                               orm='table_linen_orm'),
}

# Booth part materials. The backwall graphic is unique per stand; everything else is shared.
BOOTH_PARTS = {
    'B_Frame':   dict(uv='world', tile=0.6, base='metal_brushed', normal='metal_brushed_normal',
                      orm='metal_brushed_orm', normal_strength=0.6,
                      tint=(0.62, 0.64, 0.68)),
    # A 1.0 m repeat put a single ~23 cm plank across most of the counter face, which read as
    # stacked cardboard rather than joinery. 0.35 m gives a believable board width at this size.
    # Counter fronts are a veneered panel, not a plank floor: at any plank scale the staggered
    # end joints read as stacked bricks. A large repeat keeps the grain without the joinery,
    # and the tint takes the stage oak down to a dark walnut.
    'B_Counter': dict(uv='world', tile=2.6, base='wood_stage', normal='wood_stage_normal',
                      orm='wood_stage_orm', normal_strength=0.35,
                      tint=(0.30, 0.21, 0.14)),
    'B_Panel':   dict(uv='world', tile=1.5, color=(0.055, 0.065, 0.085), roughness=0.62, metallic=0.0),
    'B_Stool':   dict(color=(0.045, 0.055, 0.075), roughness=0.55, metallic=0.15),
    'B_Light':   dict(color=(1.0, 0.97, 0.90), emission=None, roughness=0.35, metallic=0.0),
}

# Solid materials worth re-tuning: the venue's props, chairs and trim.
SOLIDS = {
    'Frame_Champagne':  dict(color=(0.74, 0.63, 0.44), roughness=0.28, metallic=0.95),
    'Upholstery_Cream': dict(color=(0.80, 0.76, 0.69), roughness=0.82, metallic=0.0),
    'Glide':            dict(color=(0.07, 0.07, 0.08), roughness=0.45, metallic=0.70),
    'Alu_Frame':        dict(color=(0.76, 0.78, 0.81), roughness=0.34, metallic=0.92),
    'Chrome':           dict(color=(0.88, 0.90, 0.93), roughness=0.14, metallic=1.0),
    'Base_Plate':       dict(color=(0.17, 0.18, 0.20), roughness=0.50, metallic=0.55),
    'Counter_Top':      dict(color=(0.62, 0.58, 0.52), roughness=0.34, metallic=0.05),
    'Matte_Black':      dict(color=(0.035, 0.038, 0.045), roughness=0.66, metallic=0.05),
    'BlackPlastic':     dict(color=(0.030, 0.032, 0.038), roughness=0.48, metallic=0.10),
    'BlackCloth':       dict(color=(0.028, 0.030, 0.035), roughness=0.92, metallic=0.0),
    'PanelMat_4':       dict(color=(0.09, 0.11, 0.15), roughness=0.55, metallic=0.05),
    'LED_Panel':        dict(color=(0.85, 0.92, 1.0), roughness=0.25, metallic=0.0),
    'Fire':             dict(color=(0.75, 0.10, 0.12), roughness=0.55, metallic=0.0),
    'Ledge_Wood':       dict(color=(0.30, 0.20, 0.13), roughness=0.45, metallic=0.02),
    'Stair':            dict(color=(0.14, 0.13, 0.12), roughness=0.70, metallic=0.02),
    'Text':             dict(color=(0.92, 0.94, 0.97), roughness=0.45, metallic=0.0),
}


# =============================================================================================
# UV projection
# =============================================================================================
def box_project(obj, tile, slot=None):
    """World-space box projection at a fixed metres-per-repeat.

    Each face is projected along its dominant world axis, so a wall, a floor and a step all end
    up with the same texel density no matter how the mesh was built. This is what replaces the
    per-material Mapping-node scale the old pipeline relied on, and what gives the two floors a
    UV layer for the first time.
    """
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active
    mw = obj.matrix_world
    inv = 1.0 / max(1e-6, tile)

    for p in me.polygons:
        if slot is not None and p.material_index != slot:
            continue
        n = (mw.to_3x3() @ p.normal).normalized()
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li, vi in zip(p.loop_indices, p.vertices):
            co = mw @ me.vertices[vi].co
            if ax == 2:      # floor / ceiling -> project X,Y
                u, v = co.x, co.y
            elif ax == 0:    # wall facing X    -> project Y,Z
                u, v = co.y, co.z
            else:            # wall facing Y    -> project X,Z
                u, v = co.x, co.z
            uv.data[li].uv = (u * inv, v * inv)


def face_project(obj, slot, up=Vector((0, 0, 1)), min_area=0.25):
    """Map each large face of `slot` onto the full 0..1 square.

    Artwork panels were cube-unwrapped, which handed each face a 0.25-wide band of the image.
    Projecting per face onto the whole square is what restores full resolution.

    Handedness matters: the horizontal axis is `up x normal`. A viewer standing in front of the
    face looks along -normal, and for a right-handed basis their right is `forward x up`, which
    with forward = -normal is `up x normal`. Taking `normal x up` instead points the U axis the
    other way and renders every word on the backwall mirror-reversed.
    """
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active
    mw = obj.matrix_world
    done = 0

    for p in me.polygons:
        if p.material_index != slot or p.area < min_area:
            continue
        n = (mw.to_3x3() @ p.normal).normalized()
        right = up.cross(n)
        if right.length < 1e-4:            # face is horizontal; fall back to world X
            right = Vector((1, 0, 0))
            vert = right.cross(n)
        else:
            right.normalize()
            vert = up
        pts = [(mw @ me.vertices[vi].co) for vi in p.vertices]
        us = [pt.dot(right) for pt in pts]
        vs = [pt.dot(vert) for pt in pts]
        du = max(us) - min(us) or 1.0
        dv = max(vs) - min(vs) or 1.0
        for li, u, v in zip(p.loop_indices, us, vs):
            uv.data[li].uv = ((u - min(us)) / du, (v - min(vs)) / dv)
        done += 1
    return done


def slot_index(obj, predicate):
    for i, m in enumerate(obj.data.materials):
        if m and predicate(m.name):
            return i
    return None


# =============================================================================================
# Pipeline steps
# =============================================================================================
def step_prune():
    """Drop cameras, empties, plan annotations and every mesh the runtime never renders."""
    removed_objs = removed_polys = 0

    for o in list(bpy.data.objects):
        if o.type in ('CAMERA', 'EMPTY', 'LIGHT'):
            bpy.data.objects.remove(o, do_unlink=True)

    # The blend carries eighteen FONT objects — "DIPLOMATIC MAIN HALL", "STAGE + PODIUM",
    # "5,063 sq ft / 470 m2", door and EXIT markers — laid flat 6 cm above the floor. They are
    # floor-plan annotations from the architectural drawing, not signage: at 0.85 m letter
    # height they sprawl across the carpet. main.js already hides two of them by name
    # (HIDE_NODE_RE covers T_Desk), which only ever worked because the floor was too dark and
    # untextured to show the rest. Wayfinding is the HUD's job, so drop them all.
    labels = [o for o in bpy.data.objects if o.type == 'FONT']
    for o in labels:
        bpy.data.objects.remove(o, do_unlink=True)
    say(f'  removed {len(labels)} floor-plan text annotations')

    for o in list(bpy.data.objects):
        if o.type != 'MESH':
            continue
        why = None
        if any(o.name.startswith(h) for h in HIDDEN_AT_RUNTIME):
            why = 'hidden at runtime'
        else:
            pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
            if (min(p.x for p in pts) > ENVELOPE['max_x'] or max(p.x for p in pts) < ENVELOPE['min_x']
                    or min(p.y for p in pts) > ENVELOPE['max_y'] or max(p.y for p in pts) < ENVELOPE['min_y']):
                why = 'outside the walkable envelope'
        if why:
            removed_polys += len(o.data.polygons)
            bpy.data.objects.remove(o, do_unlink=True)
            removed_objs += 1

    say(f'  pruned {removed_objs} objects / {removed_polys} polys ({", ".join(HIDDEN_AT_RUNTIME[:3])}, ...)')

    # The booth video screens are replaced by a live video panel, so their faces are dead
    # geometry carrying a dead 37 KB texture each.
    killed = 0
    for o in bpy.data.objects:
        if o.type != 'MESH' or not o.name.startswith('Booth_'):
            continue
        si = slot_index(o, lambda n: n.endswith('_Screen'))
        if si is None:
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        faces = [f for f in bm.faces if f.material_index == si]
        killed += len(faces)
        bmesh.ops.delete(bm, geom=faces, context='FACES')
        bm.to_mesh(o.data)
        bm.free()
    say(f'  deleted {killed} booth screen faces (replaced by video panels at runtime)')


def step_dedupe_materials():
    """Collapse the `.001`-`.099` material families onto one shared material each."""
    merged = 0
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        for slot in o.material_slots:
            m = slot.material
            if not m:
                continue
            head, _, tail = m.name.rpartition('.')
            if head and tail.isdigit():
                root = bpy.data.materials.get(head)
                if root and root is not m:
                    slot.material = root
                    merged += 1
    before = len(bpy.data.materials)
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)
    say(f'  merged {merged} material slots; {before} materials -> {len(bpy.data.materials)}')


def step_uvs():
    """Give every surface a sane UV layout. This is the fix that matters most."""
    fixed = []
    for o in bpy.data.objects:
        if o.type != 'MESH' or not o.data.materials:
            continue
        for si, mat in enumerate(o.data.materials):
            if not mat:
                continue
            name = mat.name
            cfg = SURFACES.get(name) or BOOTH_PARTS.get(name)

            if name.startswith('Mat_Booth_') and name.endswith('_Graphic'):
                n = face_project(o, si)
                fixed.append((o.name, name, f'face x{n}'))
            elif cfg and cfg.get('uv') == 'face':
                n = face_project(o, si)
                fixed.append((o.name, name, f'face x{n}'))
            elif cfg and cfg.get('uv') == 'world':
                box_project(o, cfg['tile'], slot=si)
                fixed.append((o.name, name, f"world @{cfg['tile']}m"))

    by_mat = {}
    for _, mat, how in fixed:
        by_mat.setdefault((mat, how.split(' x')[0]), 0)
        by_mat[(mat, how.split(' x')[0])] += 1
    for (mat, how), n in sorted(by_mat.items()):
        say(f'    {mat:<26} {how:<14} on {n} object(s)')
    say(f'  re-projected UVs for {len(fixed)} object/material pairs')


def step_materials():
    """Rebuild every material we have art direction for."""
    built = 0
    for mat in bpy.data.materials:
        name = mat.name
        if name.startswith('Mat_Booth_') and name.endswith('_Graphic'):
            idx = name.split('_')[2]
            build_pbr(mat, base=f'booth_{idx}_graphic', roughness=0.62,
                      detail=('booth_fabric_normal', 'booth_fabric_orm', 12.0),
                      normal_strength=0.5)
            built += 1
            continue
        cfg = SURFACES.get(name) or BOOTH_PARTS.get(name) or SOLIDS.get(name)
        if cfg is None:
            continue
        kwargs = {k: v for k, v in cfg.items() if k not in ('uv', 'tile')}
        build_pbr(mat, **kwargs)
        built += 1
    say(f'  rebuilt {built} materials')


SHARP_ANGLE = math.radians(40.0)


def step_shading():
    """Smooth-shade curved geometry. The whole venue shipped flat-shaded, so every stool leg,
    pole and bevel was visibly faceted.

    Smoothing alone would smear the corners of boxy parts, so each edge is marked sharp when
    the angle between its two faces exceeds `SHARP_ANGLE`. That keeps a chair's tube legs round
    while its seat panel keeps its crisp edges. Objects of a dozen faces or fewer are plain
    boxes and are left alone.
    """
    smoothed = sharp_edges = 0
    for o in bpy.data.objects:
        if o.type != 'MESH' or len(o.data.polygons) <= 12:
            continue
        me = o.data
        if any(p.use_smooth for p in me.polygons):
            continue
        for p in me.polygons:
            p.use_smooth = True

        bm = bmesh.new()
        bm.from_mesh(me)
        for e in bm.edges:
            if len(e.link_faces) == 2:
                e.smooth = e.calc_face_angle(0.0) < SHARP_ANGLE
            else:
                e.smooth = False
            if not e.smooth:
                sharp_edges += 1
        bm.to_mesh(me)
        bm.free()
        smoothed += 1
    say(f'  smooth-shaded {smoothed} objects, {sharp_edges} edges kept sharp above '
        f'{math.degrees(SHARP_ANGLE):.0f} deg')


def step_instances():
    """Share one mesh datablock between identical props so the GLB stores them once."""
    import hashlib

    groups = {}
    for o in bpy.data.objects:
        if o.type != 'MESH' or not o.data.polygons:
            continue
        h = hashlib.md5()
        for v in o.data.vertices:
            h.update(b'%.4f%.4f%.4f' % (v.co.x, v.co.y, v.co.z))
        mats = tuple(m.name if m else '' for m in o.data.materials)
        groups.setdefault((h.hexdigest(), len(o.data.polygons), mats), []).append(o)

    shared = saved = 0
    for objs in groups.values():
        if len(objs) < 2:
            continue
        master = objs[0].data
        for o in objs[1:]:
            if o.data is master:
                continue
            saved += len(o.data.polygons)
            o.data = master
            shared += 1
    say(f'  linked {shared} objects onto shared mesh data ({saved} duplicate polys no longer stored)')


def step_join_static():
    """Merge static architecture into one object per material family.

    Each object is at least one draw call. The hall shipped 439 of them at the entrance, mostly
    single-quad wall segments that all wear the same material; merging those into one mesh is
    the single biggest frame-time win available and costs nothing visually.

    Booths are merged too, which collapses 20 stands x 7 slots into one mesh whose shared parts
    (frame, counter, stool, light, panel) become one primitive each. Nothing in src/main.js
    addresses these by node name — the booth interaction uses the BOOTH_POSITIONS table and
    mounts its own TVs in world space — so merging is safe.
    """
    FAMILIES = [
        ('Venue_Walls',  lambda o: o.name.startswith(('W_', 'Step_', 'EX_', 'DoorMark'))),
        ('Venue_Stage',  lambda o: o.name in ('Stage', 'Podium', 'Stair_Landing', 'Stair_Rail')),
        ('Venue_Booths', lambda o: o.name.startswith('Booth_')),
    ]
    for new_name, pred in FAMILIES:
        members = [o for o in bpy.data.objects if o.type == 'MESH' and pred(o)]
        if len(members) < 2:
            continue
        # Joining needs independent mesh data, otherwise linked copies collapse onto each other.
        for o in members:
            if o.data.users > 1:
                o.data = o.data.copy()
        bpy.ops.object.select_all(action='DESELECT')
        for o in members:
            o.select_set(True)
        bpy.context.view_layer.objects.active = members[0]
        bpy.ops.object.join()
        merged = bpy.context.view_layer.objects.active
        merged.name = new_name
        say(f'    {new_name:<14} <- {len(members)} objects, {len(merged.data.materials)} material slots')


def step_export():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        use_selection=False,
        export_apply=True,
        export_yup=True,

        # The runtime deletes every light and camera the GLB carries (see loadHallModel in
        # src/main.js) and lights the hall itself, so shipping them is pure weight.
        export_cameras=False,
        export_lights=False,

        export_materials='EXPORT',
        export_image_format='WEBP',
        export_image_quality=85,
        export_unused_images=False,
        export_unused_textures=False,

        # Tangents are deliberately omitted: at 16 bytes a vertex they cost more than the whole
        # texture budget saves, and three.js derives them from screen-space derivatives, which
        # is accurate enough for box-projected UVs with no mirroring.
        export_tangents=False,

        # meshopt over Draco: the decoder is a ~25 KB wasm module rather than ~200 KB, and it
        # decodes an order of magnitude faster, which matters on the phones this is shown on.
        # src/main.js wires it up with GLTFLoader.setMeshoptDecoder().
        export_meshopt_compression_enable=True,

        export_gpu_instances=True,
    )


def main():
    say('=== Diplomatic Hall venue build ===')
    say(f'source : {bpy.data.filepath}')
    say(f'output : {OUT}')

    # Drop every image the .blend carries, so nothing can silently fall back to a packed
    # v10 texture instead of the regenerated art in textures/.
    packed = len(bpy.data.images)
    for img in list(bpy.data.images):
        bpy.data.images.remove(img, do_unlink=True)
    say(f'purged {packed} textures packed in the .blend; all art is read from textures/')

    before_objs = len([o for o in bpy.data.objects if o.type == 'MESH'])
    before_polys = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    say(f'start  : {before_objs} meshes, {before_polys} polys, {len(bpy.data.materials)} materials')

    say('\n[1/7] prune')
    step_prune()
    say('\n[2/7] dedupe materials')
    step_dedupe_materials()
    say('\n[3/7] UV projection')
    step_uvs()
    say('\n[4/7] materials')
    step_materials()
    say('\n[5/7] shading')
    step_shading()
    say('\n[6/7] instancing + merge')
    step_instances()
    step_join_static()

    after_objs = len([o for o in bpy.data.objects if o.type == 'MESH'])
    after_polys = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    say(f'\nend    : {after_objs} meshes, {after_polys} polys, {len(bpy.data.materials)} materials')

    say('\n[7/7] export')
    step_export()
    size = os.path.getsize(OUT) / 1048576.0
    say(f'wrote {OUT}  ({size:.2f} MB)')


if __name__ == '__main__':
    main()
