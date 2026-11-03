"""
The Youth Innovation Marketplace set, built procedurally inside the venue .blend.

Imported by scripts/build_venue.py (runs under Blender). Everything is placed from
src/data/hallLayout.json, the same file src/main.js reads for interaction and collision, so the
baked geometry and the runtime can never disagree about where a booth or the stage is.

  reshape_hall()        stretch the hall north and lift the ceiling
  build_stage()         platform, side steps, LED wall frame, lighting truss, set furniture, speakers
  build_seating()       two upholstered audience benches, ten seats each
  build_lobby()         the lobby outside the hall, from the floor plan: floor, ceiling, walls,
                        entrance doors, the restroom-block door and the pillar
  build_grid()          24 booths in two back-to-back islands, after the booth-style reference
  build_foyer()         partners wall, event arch returns, deal-corner cocktail tables, curved photo
                        wall + Youth Media Hub set, standees
  build_hall_features() photo booth and the safeguarding area

Coordinates: the layout is in three.js metres (x, z with y up); Blender is (x, y = -z, z up).
Angles in the layout are measured in the three.js x/z plane, so a direction at angle t is
(cos t, -sin t) in Blender.
"""

import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, 'src', 'data', 'hallLayout.json'), encoding='utf-8') as _fh:
    LAYOUT = json.load(_fh)


def srgb(r, g, b):
    """sRGB 0-255 -> linear 0-1, which is what Principled's Base Color expects."""
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b))


def hex_lin(h):
    h = h.lstrip('#')
    return srgb(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


# Material art direction for everything this module creates. build_venue.py merges these into
# its SOLIDS table, so they go through the same build_pbr() path as the rest of the venue.
MATERIALS = {
    'Mat_Booth_Oak':      dict(color=srgb(214, 178, 132), roughness=0.48, metallic=0.0),
    'Mat_Booth_Fabric':   dict(color=srgb(246, 244, 238), roughness=0.86, metallic=0.0),
    'Mat_Booth_Counter':  dict(color=srgb(248, 248, 246), roughness=0.32, metallic=0.0),
    'Mat_Booth_Kick':     dict(color=srgb(58, 62, 72), roughness=0.55, metallic=0.1),
    'Mat_Stool':          dict(color=srgb(30, 32, 38), roughness=0.45, metallic=0.35),
    'Mat_Lamp_Glow':      dict(color=srgb(255, 240, 210), roughness=0.4, metallic=0.0,
                               emit_color=srgb(255, 232, 190), emit_strength=6.0),
    'Mat_Planter':        dict(color=srgb(240, 236, 228), roughness=0.4, metallic=0.0),
    'Mat_Soil':           dict(color=srgb(62, 46, 34), roughness=0.95, metallic=0.0),
    'Mat_Plant_Leaf':     dict(color=srgb(58, 140, 70), roughness=0.55, metallic=0.0, double_sided=True),
    'Mat_Plant_Leaf_Lt':  dict(color=srgb(110, 182, 80), roughness=0.55, metallic=0.0, double_sided=True),
    'Mat_Stage_Skirt':    dict(color=srgb(48, 45, 42), roughness=0.9, metallic=0.0),
    'Mat_Stage_Glow':     dict(color=srgb(255, 214, 120), roughness=0.4, metallic=0.0,
                               emit_color=srgb(255, 200, 90), emit_strength=3.0),
    'Mat_LED_Frame':      dict(color=srgb(16, 18, 24), roughness=0.5, metallic=0.4),
    'Mat_Truss':          dict(color=srgb(196, 200, 208), roughness=0.3, metallic=0.9),
    'Mat_Rug':            dict(color=srgb(44, 46, 52), roughness=0.98, metallic=0.0),
    'Mat_Armchair':       dict(color=srgb(226, 220, 208), roughness=0.85, metallic=0.0,
                               detail=('booth_fabric_normal', 'booth_fabric_orm', 9.0), normal_strength=0.6),
    'Mat_Lounge_Orange':  dict(color=srgb(206, 102, 40), roughness=0.75, metallic=0.0,
                               detail=('booth_fabric_normal', 'booth_fabric_orm', 9.0), normal_strength=0.6),
    'Mat_Wood_Dark':      dict(color=srgb(132, 88, 56), roughness=0.5, metallic=0.0),
    'Mat_Table_White':    dict(color=srgb(244, 242, 236), roughness=0.3, metallic=0.0),
    'Mat_Mic':            dict(color=srgb(40, 42, 48), roughness=0.35, metallic=0.7),
    'Mat_Speaker':        dict(color=srgb(22, 23, 27), roughness=0.7, metallic=0.05),
    'Mat_Speaker_Grill':  dict(color=srgb(48, 50, 56), roughness=0.9, metallic=0.0),
    'Mat_Seat_Fabric':    dict(color=srgb(46, 58, 92), roughness=0.94, metallic=0.0,
                               detail=('booth_fabric_normal', 'booth_fabric_orm', 9.0), normal_strength=0.7),
    'Mat_Seat_Shell':     dict(color=srgb(28, 30, 36), roughness=0.5, metallic=0.05),
    'Mat_Seat_Frame':     dict(color=srgb(206, 210, 216), roughness=0.22, metallic=0.95),
    'Mat_Seat_Glide':     dict(color=srgb(18, 18, 20), roughness=0.6, metallic=0.0),
    'Mat_Door_Teal':      dict(color=srgb(28, 132, 146), roughness=0.45, metallic=0.05),
    'Mat_Door_Glass':     dict(color=srgb(184, 220, 232), roughness=0.08, metallic=0.2),
    'Mat_Exit_Sign':      dict(color=srgb(40, 200, 96), roughness=0.4, metallic=0.0,
                               emit_color=srgb(40, 220, 100), emit_strength=4.0),
    # Open-booth grid
    'Mat_Booth_Floor':    dict(color=srgb(196, 194, 188), roughness=0.95, metallic=0.0,
                               detail=('booth_fabric_normal', 'booth_fabric_orm', 6.0), normal_strength=0.5),
    'Mat_Booth_Line':     dict(color=srgb(138, 140, 146), roughness=0.9, metallic=0.0),
    'Mat_Booth_Alu':      dict(color=srgb(200, 204, 210), roughness=0.3, metallic=0.9),
    'Mat_Sign_Frame':     dict(color=srgb(30, 36, 52), roughness=0.45, metallic=0.3),
    # Foyer and hall features
    'Mat_Spandex':        dict(color=srgb(244, 243, 240), roughness=0.7, metallic=0.0),
    'Mat_Photo_Wall':     dict(color=srgb(246, 244, 238), roughness=0.7, metallic=0.0),
    'Mat_Stanchion':      dict(color=srgb(214, 218, 224), roughness=0.18, metallic=1.0),
    'Mat_Belt':           dict(color=srgb(27, 45, 92), roughness=0.6, metallic=0.0),
    'Mat_PhotoBooth':     dict(color=srgb(240, 238, 232), roughness=0.4, metallic=0.0),
    'Mat_Curtain':        dict(color=srgb(176, 30, 44), roughness=0.9, metallic=0.0,
                               detail=('booth_fabric_normal', 'booth_fabric_orm', 9.0), normal_strength=0.6),
    'Mat_Screen_Glow':    dict(color=srgb(120, 180, 255), roughness=0.3, metallic=0.0,
                               emit_color=srgb(120, 190, 255), emit_strength=2.0),
    # Booth-style reference: blue backwall returns, black draped tables, black chairs, easels.
    'Mat_Booth_Edge':     dict(color=srgb(0, 80, 160), roughness=0.5, metallic=0.05),
    'Mat_Table_Cloth':    dict(color=srgb(18, 18, 20), roughness=0.92, metallic=0.0,
                               detail=('booth_fabric_normal', 'booth_fabric_orm', 8.0), normal_strength=0.6),
    'Mat_Chair_Black':    dict(color=srgb(22, 22, 25), roughness=0.55, metallic=0.1),
    'Mat_Foam':           dict(color=srgb(245, 245, 242), roughness=0.6, metallic=0.0),
    # Stage design: charcoal deck, artificial grass, navy lectern; event arch navy.
    'Mat_Stage_Deck':     dict(color=srgb(62, 59, 55), roughness=0.8, metallic=0.0),
    'Mat_Grass':          dict(color=srgb(74, 118, 46), roughness=0.95, metallic=0.0,
                               detail=('booth_fabric_normal', 'booth_fabric_orm', 20.0), normal_strength=1.2),
    'Mat_Lectern_Navy':   dict(color=srgb(30, 52, 98), roughness=0.5, metallic=0.1),
    'Mat_Arch_Navy':      dict(color=srgb(28, 52, 97), roughness=0.6, metallic=0.0),
}

# One material per booth-row colour zone, from the layout.
for _row, _zone in LAYOUT['grid']['zones'].items():
    MATERIALS[f'Mat_Zone_{_row}'] = dict(color=hex_lin(_zone['color']), roughness=0.55, metallic=0.0)

STAGE_WOOD = 'Mat_Stage_Wood'   # existing textured material, reused for the platform deck


def mat(name):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
    return m


def B(x, z3, y_up=0.0):
    """three.js (x, z) + height -> Blender Vector."""
    return Vector((x, -z3, y_up))


def frame(x, z3, angle_deg, y_up=0.0):
    """Matrix placing a local frame at (x, z3) whose +X points along the layout angle."""
    return Matrix.Translation(B(x, z3, y_up)) @ Matrix.Rotation(-math.radians(angle_deg), 4, 'Z')


# =============================================================================================
# Mesh builder: accumulates parts per object into one bmesh with material slots, so a cluster
# is a handful of objects rather than hundreds of tiny ones.
# =============================================================================================
class Builder:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def _slot(self, mat_name):
        if mat_name not in self.mats:
            self.mats.append(mat_name)
        return self.mats.index(mat_name)

    def _tag(self, verts, mat_name):
        idx = self._slot(mat_name)
        faces = {f for v in verts for f in v.link_faces}
        for f in faces:
            f.material_index = idx

    def box(self, mat_name, lo, hi, m=Matrix(), bevel=0.0, segments=2):
        """Axis-aligned box from local corner `lo` to `hi`, then transformed by `m`.

        `bevel` rounds every edge by that many metres — what turns a block into a cushion.
        """
        lo, hi = Vector(lo), Vector(hi)
        size = hi - lo
        centre = (lo + hi) / 2
        mm = m @ Matrix.Translation(centre) @ Matrix.Diagonal((size.x, size.y, size.z, 1.0))
        res = bmesh.ops.create_cube(self.bm, size=1.0, matrix=mm)
        verts = res['verts']
        # Tag first: bevel replaces the corner verts, and its new faces take the material of
        # the faces they were cut from.
        self._tag(verts, mat_name)
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            bmesh.ops.bevel(self.bm, geom=edges + list(verts), offset=bevel, segments=segments,
                            affect='EDGES', profile=0.5, clamp_overlap=True)

    def curved_slab(self, mat_name, width, height, thick, radius, m=Matrix(), cols=10):
        """A slab bent round a vertical axis `radius` in front of it, so it wraps toward the
        sitter (a chair back). Local frame: centred on x, front face at y=0 in the middle facing
        -Y, bottom at z=0."""
        half = width / 2 / radius
        rings = []
        for depth in (0.0, thick):
            r = radius + depth
            for zc in (0.0, height):
                row = []
                for i in range(cols + 1):
                    a = -half + 2 * half * i / cols
                    row.append(self.bm.verts.new(m @ Vector((math.sin(a) * r, math.cos(a) * r - radius, zc))))
                rings.append(row)
        fb, ft, bb, bt = rings     # front-bottom, front-top, back-bottom, back-top
        made = []
        for i in range(cols):
            made.append(self.bm.faces.new((fb[i], fb[i + 1], ft[i + 1], ft[i])))   # front
            made.append(self.bm.faces.new((bb[i + 1], bb[i], bt[i], bt[i + 1])))   # back
            made.append(self.bm.faces.new((ft[i], ft[i + 1], bt[i + 1], bt[i])))   # top
            made.append(self.bm.faces.new((fb[i + 1], fb[i], bb[i], bb[i + 1])))   # bottom
        made.append(self.bm.faces.new((fb[0], ft[0], bt[0], bb[0])))
        made.append(self.bm.faces.new((ft[-1], fb[-1], bb[-1], bt[-1])))
        idx = self._slot(mat_name)
        for f in made:
            f.material_index = idx

    def cyl(self, mat_name, r1, r2, depth, m=Matrix(), segments=16):
        """Cylinder/cone along local +Z, base at z=0."""
        mm = m @ Matrix.Translation((0, 0, depth / 2))
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=segments,
                                    radius1=r1, radius2=r2, depth=depth, matrix=mm)
        self._tag(res['verts'], mat_name)

    def rod(self, mat_name, a, b, r, segments=8):
        """Cylinder between two world points."""
        a, b = Vector(a), Vector(b)
        d = b - a
        if d.length < 1e-6:
            return
        rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        self.cyl(mat_name, r, r, d.length, Matrix.Translation(a) @ rot, segments)

    def torus(self, mat_name, major, minor, m=Matrix(), seg=16, ring=6):
        verts = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            for j in range(ring):
                b = 2 * math.pi * j / ring
                r = major + minor * math.cos(b)
                verts.append(self.bm.verts.new(m @ Vector((r * math.cos(a), r * math.sin(a), minor * math.sin(b)))))
        made = []
        for i in range(seg):
            for j in range(ring):
                a = verts[i * ring + j]
                b_ = verts[((i + 1) % seg) * ring + j]
                c = verts[((i + 1) % seg) * ring + (j + 1) % ring]
                d = verts[i * ring + (j + 1) % ring]
                made.append(self.bm.faces.new((a, b_, c, d)))
        idx = self._slot(mat_name)
        for f in made:
            f.material_index = idx

    def quad_strip(self, mat_name, pts_left, pts_right):
        """A ribbon between two point lists (used for leaves)."""
        vl = [self.bm.verts.new(p) for p in pts_left]
        vr = [self.bm.verts.new(p) for p in pts_right]
        idx = self._slot(mat_name)
        for i in range(len(vl) - 1):
            f = self.bm.faces.new((vl[i], vr[i], vr[i + 1], vl[i + 1]))
            f.material_index = idx

    def to_object(self):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(me)
        self.bm.free()
        for n in self.mats:
            me.materials.append(mat(n))
        obj = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(obj)
        # Every primitive needs UVs (check_glb.py fails the build otherwise). A 1 m world box
        # projection is right for the plain-colour parts; textured slots are re-projected later.
        me.uv_layers.new(name='UVMap')
        uv = me.uv_layers.active
        for p in me.polygons:
            n = p.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for li, vi in zip(p.loop_indices, p.vertices):
                co = me.vertices[vi].co
                uv.data[li].uv = (co.y, co.z) if ax == 0 else (co.x, co.z) if ax == 1 else (co.x, co.y)
        return obj


# =============================================================================================
# 1. Hall reshape
# =============================================================================================
def reshape_hall(say):
    hall = LAYOUT['hall']
    y_from = -hall['stretchFromZ']           # Blender y threshold
    dy = hall['stretchBy']
    z_from = hall['ceilingFrom']
    dz = hall['ceilingBy']

    moved = 0
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        me = o.data
        if me.users > 1:
            o.data = me = me.copy()
        mw = o.matrix_world
        inv = mw.inverted()
        touched = False
        for v in me.vertices:
            w = mw @ v.co
            nw = w.copy()
            if w.y > y_from:
                nw.y += dy
            if w.z > z_from:
                nw.z += dz
            if nw != w:
                v.co = inv @ nw
                touched = True
        if touched:
            me.update()
            moved += 1
    say(f'  stretched hall north by {dy} m beyond z={hall["stretchFromZ"]} and lifted the ceiling by '
        f'{dz} m ({moved} objects reshaped)')


def remove_legacy(say):
    """Objects the marketplace set replaces or that can never be seen.

    - the old 20-booth rows, banquet chairs and stage/podium (rebuilt here);
    - Media_Hub, superseded by the curved photo wall + Youth Media Hub set in build_foyer();
    - the black-plastic Cube.* / Cylinder.* props of the old organizer stands, which stand
      just *outside* the foyer's east wall. They were invisible there, but widening the foyer
      would carry them along with the wall, so they go before reshape_hall() runs.
    """
    gone = 0
    for o in list(bpy.data.objects):
        if o.type != 'MESH':
            continue
        stale_prop = (o.name.startswith(('Cube.', 'Cylinder.'))
                      and min((o.matrix_world @ v.co).x for v in o.data.vertices) > 27.0)
        # The narrow corridor foyer is replaced by the lobby built from the floor plan.
        # W_Right_1 is the stretch of hall wall between the two foyer doorways, right behind the
        # event arch: it goes so the arch is one walk-through opening (DOORWAYS 'arch'), and the
        # two door mats with it.
        old_foyer = (o.name.startswith(('W_CorrEast', 'W_CorrSouth', 'DoorMark'))
                     or o.name in ('Corridor_Floor', 'W_CorrNorth', 'W_Right_1', 'EX_R1', 'EX_R2'))
        if (o.name.startswith(('Booth_', 'Banquet_Chair')) or o.name in ('Stage', 'Podium', 'Media_Hub')
                or stale_prop or old_foyer):
            bpy.data.objects.remove(o, do_unlink=True)
            gone += 1
    # The ceiling is one object over hall and foyer: drop its foyer faces (east of the hall wall).
    ceil = bpy.data.objects.get('Venue_Ceiling')
    if ceil:
        bm = bmesh.new()
        bm.from_mesh(ceil.data)
        mw = ceil.matrix_world
        doomed = [f for f in bm.faces if min((mw @ v.co).x for v in f.verts) > 19.3]
        bmesh.ops.delete(bm, geom=doomed, context='FACES')
        bm.to_mesh(ceil.data)
        bm.free()
    say(f'  removed {gone} legacy objects (booth rows, banquet chairs, old stage + podium, media hub, '
        f'the corridor foyer shell, props behind its east wall)')


# =============================================================================================
# 2. Stage — as the client's stage design
# =============================================================================================
def build_stage(say):
    """Charcoal deck, LED wall flanked by two logo banners, and the set from the stage design:
    navy lectern, white armchair, plant, four orange chairs on an artificial-grass runner.

    The LED content, the banner prints and the keynote stream are laid on by the runtime
    (src/main.js createStageSet / src/modules/venueSignage.js); this builds the hardware.
    """
    st = LAYOUT['stage']
    led = LAYOUT['led']
    bn = LAYOUT['stageBanners']
    ss = LAYOUT['stageSet']
    h = st['height']
    x0, x1 = st['x0'], st['x1']
    y0, y1 = -st['zFront'], -st['zBack']       # Blender y: front < back

    b = Builder('Stage_Platform')
    b.box('Mat_Stage_Skirt', (x0, y0, 0.0), (x1, y1, h - 0.03))
    b.box('Mat_Stage_Deck', (x0 - 0.02, y0 - 0.02, h - 0.03), (x1 + 0.02, y1, h))
    # Side steps (two risers each) so presenters can walk up from the wings.
    for side in (-1, 1):
        xe = x0 if side < 0 else x1
        for k, (w, top) in enumerate(((0.6, h / 3), (0.3, 2 * h / 3))):
            xa, xb = (xe - w, xe) if side < 0 else (xe, xe + w)
            b.box('Mat_Stage_Skirt', (xa, 25.2, 0.0), (xb, 26.3, top - 0.03))
            b.box('Mat_Stage_Deck', (xa, 25.2, top - 0.03), (xb, 26.3, top))
    # Artificial-grass runner across the set.
    g = ss['grass']
    b.box('Mat_Grass', (g['x0'], -g['z1'], h), (g['x1'], -g['z0'], h + 0.02))
    b.to_object()

    # LED wall cabinet and the two banner frames; the runtime prints their faces.
    lf = Builder('Stage_LED_Frame')
    lw, lh, lb = led['width'], led['height'], led['bottom']
    cx = led['cx']
    face_y = -led['z'] + 0.03
    lf.box('Mat_LED_Frame', (cx - lw / 2 - 0.06, face_y, lb - 0.06), (cx + lw / 2 + 0.06, face_y + 0.18, lb + lh + 0.06))
    for lx in (cx - lw / 2 + 0.6, cx + lw / 2 - 0.6):
        lf.box('Mat_LED_Frame', (lx - 0.06, face_y + 0.02, h), (lx + 0.06, face_y + 0.16, lb - 0.06))
    for s in (-1, 1):
        bx = cx + s * (lw / 2 + bn['gap'] + bn['width'] / 2)
        lf.box('Mat_Sign_Frame', (bx - bn['width'] / 2 - 0.02, face_y - 0.02, bn['bottom']),
               (bx + bn['width'] / 2 + 0.02, face_y + 0.06, bn['bottom'] + bn['height'] + 0.02))
    lf.to_object()

    f = Builder('Stage_Furniture')

    def at(x, z3, yaw=0.0):
        return Matrix.Translation(B(x, z3, h)) @ Matrix.Rotation(yaw, 4, 'Z')

    # Lectern: navy column on a brushed base with a white logo panel across the top.
    m = at(ss['lectern'][0], ss['lectern'][1], math.radians(-10))
    f.box('Mat_Booth_Alu', (-0.32, -0.26, 0.0), (0.32, 0.26, 0.06), m)
    f.box('Mat_Lectern_Navy', (-0.22, -0.16, 0.06), (0.22, 0.16, 1.05), m)
    top = m @ Matrix.Translation((0, -0.02, 1.08)) @ Matrix.Rotation(math.radians(-15), 4, 'X')
    f.box('Mat_Lectern_Navy', (-0.36, -0.24, -0.04), (0.36, 0.24, 0.02), top)
    f.box('Mat_Table_White', (-0.36, -0.245, -0.11), (0.36, -0.235, 0.0), top)
    p0 = m @ Vector((0.16, 0.1, 1.1))
    p1 = m @ Vector((0.1, -0.14, 1.42))
    f.rod('Mat_Mic', p0, p1, 0.008, 6)
    f.cyl('Mat_Mic', 0.022, 0.016, 0.07, Matrix.Translation(p1), 10)

    # White wing armchair on tapered wooden legs.
    m = at(ss['armchair'][0], ss['armchair'][1], math.radians(-12))
    f.box('Mat_Armchair', (-0.38, -0.36, 0.22), (0.38, 0.36, 0.46), m, bevel=0.03, segments=2)
    f.box('Mat_Armchair', (-0.38, 0.2, 0.46), (0.38, 0.38, 1.0), m, bevel=0.03, segments=2)
    for s in (-1, 1):
        f.box('Mat_Armchair', (s * 0.38 - 0.08, -0.36, 0.46), (s * 0.38 + 0.08, 0.38, 0.68), m, bevel=0.02, segments=2)
        for fy in (-0.3, 0.3):
            f.rod('Mat_Wood_Dark', m @ Vector((s * 0.32, fy, 0.0)), m @ Vector((s * 0.3, fy * 0.95, 0.22)), 0.02, 8)

    plant(f, Matrix.Translation(B(ss['plant'][0], ss['plant'][1], h)), scale=1.4, seed=11)

    # Four orange shell chairs facing the audience.
    for (cxx, czz) in ss['chairs']:
        m = at(cxx, czz)
        f.box('Mat_Lounge_Orange', (-0.25, -0.25, 0.44), (0.25, 0.23, 0.52), m, bevel=0.03, segments=2)
        back = m @ Matrix.Translation((0, 0.22, 0.48))
        f.curved_slab('Mat_Lounge_Orange', 0.52, 0.42, 0.05, 0.42, back @ Matrix.Rotation(math.pi, 4, 'Z'))
        for sx in (-1, 1):
            for sy in (-1, 1):
                f.rod('Mat_Wood_Dark', m @ Vector((sx * 0.21, sy * 0.2, 0.0)), m @ Vector((sx * 0.18, sy * 0.17, 0.44)), 0.014, 6)
    f.to_object()

    say(f'  stage {x1 - x0:.1f} x {y1 - y0:.1f} m, charcoal deck + grass runner, LED wall {lw} x {lh} m '
        f'with two {bn["width"]} x {bn["height"]} m banners, lectern, armchair, plant, 4 chairs')


# =============================================================================================
# 3. Audience seating — two backless upholstered benches
# =============================================================================================
def wbox(b, mat_name, x0, x1, za, zb, y0, y1, bevel=0.0, segments=2):
    """Box from three.js world extents: x span, z span (either order), height span."""
    b.box(mat_name, (min(x0, x1), min(-za, -zb), y0), (max(x0, x1), max(-za, -zb), y1),
          bevel=bevel, segments=segments)


def build_seating(say):
    s = LAYOUT['seating']
    b = Builder('Seat_Benches')
    n = 0
    for z3 in s['rows']:
        for blk in s['blocks']:
            x0 = blk['x0'] - s['pitch'] / 2
            x1 = blk['x0'] + (blk['count'] - 1) * s['pitch'] + s['pitch'] / 2
            # Padded seat on a dark shell, on three brushed-steel plate legs.
            wbox(b, 'Mat_Seat_Shell', x0 + 0.02, x1 - 0.02, z3 - 0.21, z3 + 0.21, 0.33, 0.37, bevel=0.01, segments=1)
            wbox(b, 'Mat_Seat_Fabric', x0, x1, z3 - 0.23, z3 + 0.23, 0.36, 0.46, bevel=0.035, segments=3)
            for xl in (x0 + 0.18, (x0 + x1) / 2, x1 - 0.18):
                wbox(b, 'Mat_Seat_Frame', xl - 0.015, xl + 0.015, z3 - 0.19, z3 + 0.19, 0.02, 0.33)
                wbox(b, 'Mat_Seat_Glide', xl - 0.02, xl + 0.02, z3 - 0.2, z3 + 0.2, 0.0, 0.02)
            n += blk['count']
    b.to_object()
    say(f'  {n} bench seats on {len(s["blocks"]) * len(s["rows"])} upholstered benches')



# =============================================================================================
# 3b. Lobby — the area outside the hall, from the floor plan
# =============================================================================================
def build_lobby(say):
    """The foyer and the pre-function lobby east of the hall, from the Marriott plan.

    Floor and ceiling over the whole outline; walls along every outline edge but the last (the
    hall's own east wall); then the walls inside it: the curved wall between the foyer and the
    lobby, the short wall with the closed door by the restroom block, and the entrance door line
    with its glass doors held open. Exterior doors on the vestibule, closed doors at the end of
    the two corridor stubs, elevator doors on the east wall, and the pillars.
    """
    L = LAYOUT['lobby']
    ceil = L['ceilingHeight']
    pts = L['outline']

    for name, mat_name, y, flip in (('Lobby_Floor', 'Mat_Corridor_Tile', 0.0, False),
                                    ('Lobby_Ceiling', 'Mat_Ceiling', ceil, True)):
        b = Builder(name)
        verts = [b.bm.verts.new(B(x, z, y)) for x, z in pts]
        face = b.bm.faces.new(verts[::-1] if flip else verts)
        face.material_index = b._slot(mat_name)
        me = b.to_object()
        # Builder recalculates normals outward; a lone polygon has no inside, so set it explicitly.
        for p in me.data.polygons:
            want_up = not flip
            if (p.normal.z > 0) != want_up:
                p.flip()
        me.data.update()

    walls = Builder('W_Lobby')
    dr = Builder('Door_Lobby')
    t = 0.2
    ext = L['exteriorDoors']
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):      # the closing edge is the hall's east wall
        if az == bz:
            x0, x1 = min(ax, bx) - t / 2, max(ax, bx) + t / 2
            if az == ext['z']:
                # Vestibule south wall with the exterior doors (closed glass) cut into it.
                xs = [x0] + [v for sp in ext['spans'] for v in sp] + [x1]
                for i in range(0, len(xs), 2):
                    wbox(walls, 'Mat_Acoustic_Wall', xs[i], xs[i + 1], az - t / 2, az + t / 2, 0.0, ceil)
                for (d0, d1) in ext['spans']:
                    wbox(walls, 'Mat_Acoustic_Wall', d0, d1, az - t / 2, az + t / 2, 2.4, ceil)
                    mid = (d0 + d1) / 2
                    wbox(dr, 'Mat_LED_Frame', d0, d1, az - 0.06, az + 0.06, 2.34, 2.4)
                    for s0, s1 in ((d0 + 0.02, mid - 0.01), (mid + 0.01, d1 - 0.02)):
                        wbox(dr, 'Mat_Door_Glass', s0, s1, az - 0.03, az + 0.03, 0.0, 2.34)
                        wbox(dr, 'Mat_Truss', s0 + 0.08, s1 - 0.08, az - 0.08, az - 0.05, 0.98, 1.03)
                continue
            wbox(walls, 'Mat_Acoustic_Wall', x0, x1, az - t / 2, az + t / 2, 0.0, ceil)
        else:
            wbox(walls, 'Mat_Acoustic_Wall', ax - t / 2, ax + t / 2, min(az, bz) - t / 2, max(az, bz) + t / 2, 0.0, ceil)

    # Curved wall: full height between the foyer (convex face, radius r) and the lobby.
    cw = L['curvedWall']
    arc_wall(walls, 'Mat_Acoustic_Wall', cw['cx'], cw['cz'], cw['r'] - cw['thickness'], cw['r'],
             cw['a0'], cw['a1'], 0.0, ceil, seg=48)
    # Skirting along both faces so the wall meets the floor like the others.
    arc_wall(walls, 'Mat_LED_Frame', cw['cx'], cw['cz'], cw['r'] - cw['thickness'] - 0.015, cw['r'] + 0.015,
             cw['a0'], cw['a1'], 0.0, 0.1, seg=48)

    # Closed-door wall between the curved wall's top and the restroom block, door on both faces.
    cd = L['closedDoorWall']
    hx = cd['thickness'] / 2
    wbox(walls, 'Mat_Acoustic_Wall', cd['x'] - hx, cd['x'] + hx, cd['z0'], cd['z1'], 0.0, ceil)
    d = cd['door']
    for s in (-1, 1):
        fx = cd['x'] + s * hx
        wbox(dr, 'Mat_Door_Teal', min(fx, fx + s * 0.04), max(fx, fx + s * 0.04), d['z0'], d['z1'], 0.0, 2.3)
        wbox(dr, 'Mat_LED_Frame', min(fx, fx + s * 0.05), max(fx, fx + s * 0.05), d['z0'] - 0.05, d['z1'] + 0.05, 2.3, 2.38)
        wbox(dr, 'Mat_Truss', min(fx, fx + s * 0.08), max(fx, fx + s * 0.08), (d['z0'] + d['z1']) / 2 - 0.35,
             (d['z0'] + d['z1']) / 2 + 0.35, 0.98, 1.03)

    # Entrance door line: wall stubs and posts, a transom above 2.4 m, glass doors held open
    # against the posts (swung into the foyer).
    en = L['entrance']
    z = en['z']
    posts = en['posts']
    wbox(walls, 'Mat_Acoustic_Wall', en['x0'], posts[0], z - t / 2, z + t / 2, 0.0, ceil)
    wbox(walls, 'Mat_Acoustic_Wall', posts[-1], en['x1'], z - t / 2, z + t / 2, 0.0, ceil)
    for p in posts[1:-1]:
        wbox(walls, 'Mat_LED_Frame', p - 0.1, p + 0.1, z - t / 2, z + t / 2, 0.0, 2.4)
    wbox(walls, 'Mat_Acoustic_Wall', posts[0], posts[-1], z - t / 2, z + t / 2, 2.4, ceil)
    for d0, d1 in zip(posts, posts[1:]):
        a0, a1 = d0 + (0.1 if d0 != posts[0] else 0.0), d1 - (0.1 if d1 != posts[-1] else 0.0)
        leaf = (a1 - a0) / 2 - 0.02
        wbox(dr, 'Mat_LED_Frame', a0, a1, z - 0.06, z + 0.06, 2.34, 2.4)
        for hinge, s in ((a0, 1), (a1, -1)):
            xa, xb = sorted((hinge + s * 0.03, hinge + s * 0.09))
            wbox(dr, 'Mat_Door_Glass', xa, xb, z - 0.1 - leaf, z - 0.1, 0.0, 2.32)
            wbox(dr, 'Mat_Truss', xa - 0.02, xb + 0.02, z - 0.1 - leaf * 0.75, z - 0.1 - leaf * 0.25, 0.98, 1.03)

    # Closed double doors at the end of the corridor stubs.
    for c in L['corridorDoors']:
        w = c['x1'] - c['x0']
        mid = (c['x0'] + c['x1']) / 2
        for s0, s1 in ((mid - min(0.9, w / 2 - 0.2), mid - 0.01), (mid + 0.01, mid + min(0.9, w / 2 - 0.2))):
            wbox(dr, 'Mat_Door_Teal', s0, s1, c['z'] + t / 2, c['z'] + t / 2 + 0.04, 0.0, 2.3)
        wbox(dr, 'Mat_LED_Frame', mid - min(0.95, w / 2 - 0.15), mid + min(0.95, w / 2 - 0.15),
             c['z'] + t / 2, c['z'] + t / 2 + 0.05, 2.3, 2.38)

    # Elevator doors on the east wall: brushed steel pairs in a frame, with a call panel.
    el = L['elevators']
    ex = el['x'] - t / 2
    for ez in el['z']:
        w2 = el['width'] / 2
        wbox(dr, 'Mat_LED_Frame', ex - 0.06, ex, ez - w2 - 0.12, ez + w2 + 0.12, 0.0, el['height'] + 0.12)
        wbox(dr, 'Mat_Booth_Alu', ex - 0.09, ex - 0.06, ez - w2, ez - 0.005, 0.0, el['height'])
        wbox(dr, 'Mat_Booth_Alu', ex - 0.09, ex - 0.06, ez + 0.005, ez + w2, 0.0, el['height'])
        wbox(dr, 'Mat_Screen_Glow', ex - 0.03, ex, ez + w2 + 0.25, ez + w2 + 0.37, 1.05, 1.25)

    for p in L['pillars']:
        wbox(walls, 'Mat_Acoustic_Wall', p['x'] - p['size'] / 2, p['x'] + p['size'] / 2,
             p['z'] - p['size'] / 2, p['z'] + p['size'] / 2, 0.0, ceil)
    walls.to_object()
    dr.to_object()
    say(f'  lobby: {len(pts)}-sided outline, curved wall r {cw["r"]} m, {len(posts) - 1} entrance doors, '
        f'closed door, {len(el["z"])} elevators, {len(L["pillars"])} pillars, {ceil} m ceiling')


# =============================================================================================
# 4. Booths — the booth-style reference
# =============================================================================================
def plant(b, m, scale=1.0, seed=0):
    """Planter with a fan of curved blade leaves."""
    import random
    rnd = random.Random(seed)
    r = 0.14 * scale
    b.cyl('Mat_Planter', r * 0.8, r, 0.32 * scale, m, 16)
    b.cyl('Mat_Soil', r * 0.94, r * 0.94, 0.005, m @ Matrix.Translation((0, 0, 0.31 * scale)), 16)
    base_z = 0.3 * scale
    leaves = 16
    for i in range(leaves):
        a = 2 * math.pi * i / leaves + rnd.uniform(-0.15, 0.15)
        length = rnd.uniform(0.45, 0.75) * scale
        tilt = rnd.uniform(0.15, 0.75)          # 0 = upright
        width = rnd.uniform(0.05, 0.075) * scale
        dirv = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-math.sin(a), math.cos(a), 0))
        left, right = [], []
        steps = 5
        for k in range(steps + 1):
            t = k / steps
            # Rises, then arcs outward and droops at the tip.
            out = math.sin(tilt) * length * t + 0.15 * length * t * t
            up = math.cos(tilt) * length * t - 0.25 * length * t * t * tilt
            c = Vector((0, 0, base_z)) + dirv * out + Vector((0, 0, up))
            w = width * math.sin(math.pi * min(1.0, t * 1.15 + 0.08))
            left.append(m @ (c + side * w))
            right.append(m @ (c - side * w))
        b.quad_strip('Mat_Plant_Leaf' if i % 3 else 'Mat_Plant_Leaf_Lt', left, right)


def chair_black(b, m):
    """Plain black conference chair; the sitter faces local -Y."""
    b.box('Mat_Chair_Black', (-0.22, -0.22, 0.42), (0.22, 0.2, 0.47), m, bevel=0.015, segments=2)
    back = m @ Matrix.Translation((0, 0.19, 0.47)) @ Matrix.Rotation(math.radians(-8), 4, 'X')
    b.box('Mat_Chair_Black', (-0.21, -0.02, 0.02), (0.21, 0.02, 0.42), back, bevel=0.012, segments=2)
    for sx in (-0.19, 0.19):
        for sy in (-0.19, 0.17):
            b.rod('Mat_Chair_Black', m @ Vector((sx, sy, 0.0)), m @ Vector((sx, sy, 0.42)), 0.012, 6)


def easel(b, m, board_w, board_h, bottom, tilt):
    """Black tripod easel (as in the booth-style reference) holding a foam board; the board's printed face looks along local -Y.

    The runtime lays the team poster on the board using the same numbers.
    """
    tl = math.radians(tilt)
    top = bottom + board_h * math.cos(tl)
    lean = Matrix.Rotation(-tl, 4, 'X')
    # Front legs splay outward and run parallel to the leaning board, just behind it, so the
    # poster sits in front of them as on the reference; the back leg props them up.
    slope = math.tan(tl)
    behind = lambda z: 0.045 + (z - bottom) * slope          # local y of the legs at height z
    for s in (-1, 1):
        b.rod('Mat_Chair_Black', m @ Vector((s * 0.32, behind(0.0), 0.0)),
              m @ Vector((s * 0.06, behind(top + 0.12), top + 0.12)), 0.013, 6)
    b.rod('Mat_Chair_Black', m @ Vector((0.0, behind(top) + 0.45, 0.0)),
          m @ Vector((0.0, behind(top + 0.08) + 0.015, top + 0.08)), 0.013, 6)
    # Ledge the board rests on.
    ledge = m @ Matrix.Translation((0, 0.02, bottom)) @ lean
    b.box('Mat_Chair_Black', (-board_w / 2 - 0.04, -0.05, -0.03), (board_w / 2 + 0.04, 0.03, 0.0), ledge)
    # Foam board.
    b.box('Mat_Foam', (-board_w / 2, 0.0, 0.0), (board_w / 2, 0.006, board_h), ledge)


def build_grid(say):
    """Two islands of open booths after the client's booth-style reference.

    Each booth: a free-standing printed backwall with blue returns (backed onto its neighbour
    across the spine), a black draped table, two black chairs for the exhibitors, and an easel
    with the team poster on the visitor's left. The runtime prints the backwall and the poster.
    """
    G = LAYOUT['grid']
    S, n = G['booth'], G['cols']
    X0 = G['x0']
    X1 = X0 + n * S
    bw = G['backwall']
    tb = G['table']
    ch = G['chairs']
    ea = G['easel']
    total = 0

    for k, island in enumerate(G['islands']):
        b = Builder(f'Booth_Grid_{k + 1}')
        sz = island['spineZ']
        H = bw['height']

        # Taller end totems carry the row signs.
        for xe, sgn in ((X0, -1), (X1, 1)):
            wbox(b, 'Mat_Sign_Frame', xe, xe + sgn * 0.08, sz - 0.42, sz + 0.42, 0.0, H + 0.4)
            wbox(b, 'Mat_Booth_Edge', xe, xe + sgn * 0.09, sz - 0.44, sz + 0.44, H + 0.4, H + 0.44)

        for row in island['rows']:
            f = row['facing']
            zone = f'Mat_Zone_{row["row"]}'
            za, zb = sz, sz + f * S

            wbox(b, 'Mat_Booth_Floor', X0, X1, za, zb, 0.0, 0.03)
            wbox(b, zone, X0, X1, zb - f * 0.07, zb, 0.0, 0.034)
            for i in range(1, n):
                x = X0 + i * S
                wbox(b, 'Mat_Booth_Line', x - 0.012, x + 0.012, za + f * bw['d1'], zb - f * 0.07, 0.0, 0.032)

            for col in range(n):
                xw = X0 + col * S
                xc = xw + S / 2
                # Backwall box: blue shell, the print goes on its front face.
                wbox(b, 'Mat_Booth_Edge', xw + bw['u0'], xw + bw['u1'], sz + f * bw['d0'], sz + f * bw['d1'], 0.03, H)

                # Black draped table: cloth body to the floor, a slightly proud top.
                d0, d1 = tb['d'] - tb['depth'] / 2, tb['d'] + tb['depth'] / 2
                wbox(b, 'Mat_Table_Cloth', xc - tb['width'] / 2, xc + tb['width'] / 2, sz + f * d0, sz + f * d1,
                     0.03, tb['height'] - 0.02)
                wbox(b, 'Mat_Table_Cloth', xc - tb['width'] / 2 - 0.015, xc + tb['width'] / 2 + 0.015,
                     sz + f * (d0 - 0.015), sz + f * (d1 + 0.015), tb['height'] - 0.025, tb['height'], bevel=0.01, segments=1)

                # Two chairs between table and backwall, facing the aisle (local -Y = aisle).
                for off in ch['offsets']:
                    m = Matrix.Translation(B(xc + off, sz + f * ch['d'], 0.03)) @ \
                        Matrix.Rotation(0.0 if f > 0 else math.pi, 4, 'Z')
                    chair_black(b, m)

                # Easel on the visitor's left (viewer faces -f, so their left is -f in x),
                # turned slightly toward the middle of the aisle.
                ex = xc - f * ea['side']
                # A positive turn swings the board's face toward the booth's centre line for
                # both facings (the base rotation already flips with the row).
                turn = math.radians(ea['turn'])
                m = Matrix.Translation(B(ex, sz + f * ea['d'], 0.03)) @ \
                    Matrix.Rotation((0.0 if f > 0 else math.pi) + turn, 4, 'Z')
                easel(b, m, ea['boardW'], ea['boardH'], ea['bottom'], ea['tilt'])
                total += 1

        b.to_object()
    say(f'  {total} booths in {len(G["islands"])} islands ({S} m square): blue-edged backwalls, '
        f'black draped tables, 2 chairs each, poster easels')


# =============================================================================================
# 5. Lobby features and hall features
# =============================================================================================
def sign_frame(x, z3, yaw):
    """Matrix for a sign at (x, z3) with three.js rotation.y = yaw. Local X runs across the sign;
    local -Y is the face normal (the three.js +z of the sign); Z is up."""
    ex = Vector((math.cos(yaw), math.sin(yaw), 0.0))
    ey = Vector((-math.sin(yaw), math.cos(yaw), 0.0))
    p = B(x, z3, 0.0)
    return Matrix(((ex.x, ey.x, 0, p.x), (ex.y, ey.y, 0, p.y), (0, 0, 1, 0), (0, 0, 0, 1)))


def standee(b, s):
    """Foam-board standee on a two-post stand; the runtime prints both faces."""
    m = sign_frame(s['x'], s['z'], s['yaw'])
    w, h, y0 = s['w'], s['h'], s['bottom']
    b.box('Mat_Foam', (-w / 2 - 0.01, -0.012, y0 - 0.01), (w / 2 + 0.01, 0.012, y0 + h + 0.01), m)
    for sx in (-1, 1):
        px = sx * (w / 2 + 0.04)
        b.box('Mat_Booth_Alu', (px - 0.02, -0.02, 0.0), (px + 0.02, 0.02, y0 + h + 0.03), m)
        b.box('Mat_Sign_Frame', (px - 0.06, -0.24, 0.0), (px + 0.06, 0.24, 0.025), m)
    b.box('Mat_Booth_Alu', (-w / 2 - 0.06, -0.02, y0 - 0.05), (w / 2 + 0.06, 0.02, y0 - 0.01), m)


def arc_points(cx, cz, r, a0, a1, seg):
    return [(cx + math.cos(math.radians(a0 + (a1 - a0) * i / seg)) * r,
             cz + math.sin(math.radians(a0 + (a1 - a0) * i / seg)) * r) for i in range(seg + 1)]


def arc_wall(b, mat_name, cx, cz, r0, r1, a0, a1, y0, y1, seg=24):
    """Closed curved wall between radii r0 < r1, as quads (three.js arc, Blender verts)."""
    bm = b.bm
    rings = []
    for r in (r0, r1):
        for y in (y0, y1):
            rings.append([bm.verts.new(B(x, z, y)) for x, z in arc_points(cx, cz, r, a0, a1, seg)])
    ib, it, ob, ot = rings
    idx = b._slot(mat_name)
    faces = []
    for i in range(seg):
        faces.append(bm.faces.new((ib[i], ib[i + 1], it[i + 1], it[i])))
        faces.append(bm.faces.new((ob[i + 1], ob[i], ot[i], ot[i + 1])))
        faces.append(bm.faces.new((it[i], it[i + 1], ot[i + 1], ot[i])))
        faces.append(bm.faces.new((ib[i + 1], ib[i], ob[i], ob[i + 1])))
    faces.append(bm.faces.new((ib[0], it[0], ot[0], ob[0])))
    faces.append(bm.faces.new((it[-1], ib[-1], ob[-1], ot[-1])))
    for f in faces:
        f.material_index = idx


def armchair(b, m):
    b.box('Mat_Armchair', (-0.38, -0.36, 0.08), (0.38, 0.36, 0.42), m, bevel=0.03, segments=2)
    b.box('Mat_Armchair', (-0.38, 0.2, 0.42), (0.38, 0.38, 0.92), m, bevel=0.03, segments=2)
    for s in (-1, 1):
        b.box('Mat_Armchair', (s * 0.38 - 0.08, -0.36, 0.42), (s * 0.38 + 0.08, 0.38, 0.62), m, bevel=0.02, segments=2)
        for fy in (-0.3, 0.3):
            b.cyl('Mat_Wood_Dark', 0.025, 0.02, 0.08, m @ Matrix.Translation((s * 0.32, fy, 0)), 8)


def facing(x, z3, tx, tz):
    """Matrix at (x, z3) whose local -Y (a chair's front) points at (tx, tz)."""
    d = B(tx, tz) - B(x, z3)
    yaw = math.atan2(d.y, d.x) + math.pi / 2
    return Matrix.Translation(B(x, z3, 0.0)) @ Matrix.Rotation(yaw, 4, 'Z')


def build_foyer(say):
    F = LAYOUT['foyer']
    b = Builder('Foyer_Set')

    # Partners photo wall on the restroom block: backing board and feet; the runtime prints it.
    pw = F['partnersWall']
    m = sign_frame(pw['x'], pw['z'], pw['yaw'])
    w, h, y0 = pw['width'], pw['height'], pw['bottom']
    b.box('Mat_Sign_Frame', (-w / 2 - 0.08, -0.03, y0 - 0.08), (w / 2 + 0.08, 0.05, y0 + h + 0.08), m)
    b.box('Mat_Booth_Alu', (-w / 2 - 0.1, -0.06, y0 + h + 0.08), (w / 2 + 0.1, 0.06, y0 + h + 0.13), m)

    # Event arch: the printed front and back faces are alpha-cut planes laid on by the runtime;
    # this is the depth between them — the pillar and beam returns in the arch's navy.
    ea = F['eventArch']
    ax, dz = ea['x'], ea['depth'] / 2 - 0.01
    # Seen from the lobby (facing -x) the artwork's left pillar is at +z (south).
    pn, ps = ea['pillarNorth'], ea['pillarSouth']
    wbox(b, 'Mat_Arch_Navy', ax - dz, ax + dz, ea['z0'] + 0.01, ea['z0'] + pn - 0.01, 0.0, ea['beamTop'] - 0.02)
    wbox(b, 'Mat_Arch_Navy', ax - dz, ax + dz, ea['z1'] - ps + 0.01, ea['z1'] - 0.01, 0.0, ea['beamTop'] - 0.02)
    wbox(b, 'Mat_Arch_Navy', ax - dz, ax + dz, ea['z0'] + 0.01, ea['z1'] - 0.01, ea['openingTop'], ea['beamTop'] - 0.02)

    # Deal corner: high cocktail tables in white stretch covers.
    dc = F['dealCorner']
    for (tx, tz) in dc['tables']:
        mm = Matrix.Translation(B(tx, tz, 0.0))
        b.cyl('Mat_Spandex', 0.3, 0.07, 0.62, mm, 24)
        b.cyl('Mat_Spandex', 0.07, dc['tableRadius'] - 0.01, 0.46, mm @ Matrix.Translation((0, 0, 0.62)), 24)
        b.cyl('Mat_Table_White', dc['tableRadius'], dc['tableRadius'], 0.03, mm @ Matrix.Translation((0, 0, 1.08)), 28)

    # Youth Media Hub against the curved wall's outside (lobby) face: rug, two interview armchairs
    # with their backs to the wall, side table, ring light and a camera on a tripod facing them.
    # The runtime prints the backdrop on the wall behind them.
    mh = F['mediaHub']
    hx, hz = mh['x'], mh['z']
    wbox(b, 'Mat_Rug', hx - 1.4, hx + 1.4, hz - 1.1, hz + 1.1, 0.0, 0.012)
    armchair(b, facing(hx - 0.3, hz - 0.75, hx + 0.6, hz))
    armchair(b, facing(hx - 0.3, hz + 0.75, hx + 0.6, hz))
    b.cyl('Mat_Wood_Dark', 0.2, 0.22, 0.46, Matrix.Translation(B(hx - 0.85, hz, 0.0)), 18)
    lx, lz = hx + 1.1, hz - 1.15          # ring light beside the camera, clear of the backdrop title
    b.rod('Mat_Stool', B(lx, lz, 0.0), B(lx, lz, 1.55), 0.015, 8)
    for k in range(3):
        a = k * 2 * math.pi / 3
        b.rod('Mat_Stool', B(lx, lz, 0.45), B(lx + 0.3 * math.cos(a), lz + 0.3 * math.sin(a), 0.0), 0.01, 6)
    ring = Matrix.Translation(B(lx, lz, 1.72)) @ Matrix.Rotation(math.pi / 2, 4, 'Y')
    b.torus('Mat_Lamp_Glow', 0.2, 0.02, ring, 24, 6)
    tx, tz = hx + 0.9, hz + 0.6
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.3
        b.rod('Mat_Stool', B(tx, tz, 1.3), B(tx + 0.32 * math.cos(a), tz + 0.32 * math.sin(a), 0.0), 0.01, 6)
    b.box('Mat_Speaker', (-0.12, -0.08, 0.0), (0.12, 0.08, 0.14), facing(tx, tz, hx - 0.3, hz) @ Matrix.Translation((0, 0, 1.3)))

    # Plants either side of the media hub backdrop.
    cw = LAYOUT['lobby']['curvedWall']
    ri = cw['r'] - cw['thickness']
    hub_a = math.degrees(math.atan2(hz - cw['cz'], hx - cw['cx']))
    half = math.degrees((mh['backdropWidth'] / 2 + 0.35) / ri)
    for (ppx, ppz) in arc_points(cw['cx'], cw['cz'], ri - 0.45, hub_a - half, hub_a + half, 1):
        plant(b, Matrix.Translation(B(ppx, ppz, 0.0)), scale=1.3, seed=int(abs(ppz) * 10))

    # Area standees (registration, deal corner, media hub, booth entrance, safeguarding).
    for s in LAYOUT['signs']:
        standee(b, s)

    b.to_object()
    say(f'  lobby set: partners wall, event arch returns, {len(dc["tables"])} cocktail tables, '
        f'Youth Media Hub set, {len(LAYOUT["signs"])} standees')


def build_hall_features(say):
    hf = LAYOUT['hallFeatures']
    b = Builder('HallSet_Features')

    # Photo booth against the south wall, open to the north with a half-drawn curtain.
    pb = hf['photoBooth']
    x0, x1 = pb['x'] - pb['width'] / 2, pb['x'] + pb['width'] / 2
    zf, zb = pb['z'] - pb['depth'] / 2, pb['z'] + pb['depth'] / 2     # front (north), back
    h = pb['height']
    t = 0.06
    wbox(b, 'Mat_PhotoBooth', x0, x1, zb - t, zb, 0.0, h)                     # back
    wbox(b, 'Mat_PhotoBooth', x0, x0 + t, zf, zb, 0.0, h)                     # sides
    wbox(b, 'Mat_PhotoBooth', x1 - t, x1, zf, zb, 0.0, h)
    wbox(b, 'Mat_PhotoBooth', x0, x1, zf, zb, h - t, h)                       # roof
    wbox(b, 'Mat_PhotoBooth', x0, x0 + 0.45, zf, zf + t, 0.0, h)              # front pillars
    wbox(b, 'Mat_PhotoBooth', x1 - 0.45, x1, zf, zf + t, 0.0, h)
    wbox(b, 'Mat_Sign_Frame', x0 + 0.45, x1 - 0.45, zf, zf + t, h - 0.42, h)  # header (printed live)
    wbox(b, 'Mat_Curtain', x0 + 0.45, x0 + 0.95, zf + 0.07, zf + 0.12, 0.05, h - 0.42)
    wbox(b, 'Mat_Booth_Kick', x0 + 0.1, x1 - 0.1, zf + 0.1, zb - t, 0.0, 0.03)
    # Camera kiosk on the back wall with a glowing screen, and a bench.
    kx = pb['x']
    wbox(b, 'Mat_Speaker', kx - 0.25, kx + 0.25, zb - t - 0.25, zb - t, 1.1, 1.7)
    wbox(b, 'Mat_Screen_Glow', kx - 0.2, kx + 0.2, zb - t - 0.255, zb - t - 0.25, 1.15, 1.55)
    wbox(b, 'Mat_Seat_Fabric', x0 + 0.5, x1 - 0.5, zf + 0.5, zf + 0.9, 0.4, 0.48, bevel=0.02)
    wbox(b, 'Mat_Seat_Shell', x0 + 0.55, x1 - 0.55, zf + 0.52, zf + 0.88, 0.0, 0.4)

    # Safeguarding area: chrome stanchions with navy belts, L-shaped, with a 1.2 m entry gap.
    sg = hf['safeguarding']
    posts = []
    xs = [sg['x0'] + i * (sg['x1'] - sg['x0']) / 4 for i in range(5)]
    for x in xs:
        posts.append((x, sg['z0']))
    zs = [sg['z0'] + i * (sg['z1'] - sg['z0']) / 2 for i in range(1, 3)]
    for z in zs:
        posts.append((sg['x0'], z))
    for (px, pz) in posts:
        mm = Matrix.Translation(B(px, pz, 0.0))
        b.cyl('Mat_Stanchion', 0.17, 0.17, 0.02, mm, 20)
        b.cyl('Mat_Stanchion', 0.025, 0.025, 0.95, mm, 12)
        b.cyl('Mat_Stanchion', 0.035, 0.03, 0.04, mm @ Matrix.Translation((0, 0, 0.95)), 12)
    belts = [(xs[i], sg['z0'], xs[i + 1], sg['z0']) for i in range(len(xs) - 1) if i != 2]
    chain = [(sg['x0'], sg['z0'])] + [(sg['x0'], z) for z in zs]
    belts += [(chain[i][0], chain[i][1], chain[i + 1][0], chain[i + 1][1]) for i in range(len(chain) - 1)]
    for (ax, az, bx, bz) in belts:
        if ax == bx:
            wbox(b, 'Mat_Belt', ax - 0.01, ax + 0.01, az, bz, 0.84, 0.9)
        else:
            wbox(b, 'Mat_Belt', ax, bx, az - 0.01, az + 0.01, 0.84, 0.9)
    # Two soft chairs and a plant inside — a quiet place to talk.
    cx, cz = (sg['x0'] + sg['x1']) / 2 + 0.4, (sg['z0'] + sg['z1']) / 2
    armchair(b, facing(cx - 0.65, cz, cx + 0.65, cz))
    armchair(b, facing(cx + 0.65, cz, cx - 0.65, cz))
    plant(b, Matrix.Translation(B(sg['x1'] - 0.3, sg['z1'] - 0.35, 0.0)), scale=1.1, seed=7)

    b.to_object()
    say('  hall features: photo booth (EDUCO), safeguarding area with stanchions and seating')


# =============================================================================================
# 6. Doorways
# =============================================================================================
# Wall openings in the authoring .blend run floor to ceiling. At 3.5 m that read as a doorway;
# with the ceiling at 7 m they become 7 m slots onto the black void outside, so each one gets a
# lintel up to the ceiling and — where it leads outside — a pair of doors with an EXIT sign.
# (axis, wall coordinate, span start, span end, interior side, kind)
DOORWAYS = [
    ('y', 0.0, 2.13, 3.63, +1, 'exit'),        # EX_B1, south wall
    ('y', 0.0, 8.83, 10.33, +1, 'entrance'),   # EX_B2, main entrance
    ('x', 0.0, 2.21, 3.71, +1, 'exit'),        # EX_L1, west wall
    ('x', 0.0, 18.47, 19.97, +1, 'exit'),      # EX_L2, west wall
    ('x', 19.35, 7.18, 13.08, -1, 'arch'),     # EX_R1 + EX_R2 merged behind the event arch
]


def build_doors(say):
    ceil = LAYOUT['hall']['ceilingHeight']
    lintels = Builder('W_Lintels')
    doors = Builder('Door_Leaves')
    for i, (axis, w, a, b, inside, kind) in enumerate(DOORWAYS):
        # The arch opening's lintel sits behind the arch beam, so the opening reads as the arch's.
        top = {'open': 2.6, 'arch': LAYOUT['foyer']['eventArch']['openingTop']}.get(kind, 2.4)
        def box(bld, mat_name, s0, s1, t0, t1, z0, z1):
            # s along the wall, t across it (thickness), z up
            if axis == 'y':
                bld.box(mat_name, (s0, w + t0, z0), (s1, w + t1, z1))
            else:
                bld.box(mat_name, (w + t0, s0, z0), (w + t1, s1, z1))
        box(lintels, 'Mat_Acoustic_Wall', a, b, -0.1, 0.1, top, ceil)
        if kind in ('open', 'arch'):
            continue
        leaf = 'Mat_Door_Glass' if kind == 'entrance' else 'Mat_Door_Teal'
        mid = (a + b) / 2
        box(doors, 'Mat_LED_Frame', a, b, -0.06, 0.06, top - 0.06, top)
        for s0, s1 in ((a + 0.02, mid - 0.01), (mid + 0.01, b - 0.02)):
            box(doors, leaf, s0, s1, -0.03, 0.03, 0.0, top - 0.06)
            # Push bar on the hall side.
            t = inside * 0.05
            box(doors, 'Mat_Truss', s0 + 0.08, s1 - 0.08, min(t, t + inside * 0.03), max(t, t + inside * 0.03), 0.98, 1.03)
        if kind == 'exit':
            t = inside * 0.12
            box(doors, 'Mat_Exit_Sign', mid - 0.17, mid + 0.17, min(0.1 * inside, t), max(0.1 * inside, t), top + 0.12, top + 0.26)
    lintels.to_object()
    doors.to_object()
    say(f'  closed {len(DOORWAYS)} doorways above door height; '
        f'{sum(1 for d in DOORWAYS if d[5] != "open")} sets of doors with push bars / EXIT signs')


def build_all(say):
    remove_legacy(say)
    reshape_hall(say)
    build_doors(say)
    build_stage(say)
    build_seating(say)
    build_lobby(say)
    build_grid(say)
    build_foyer(say)
    build_hall_features(say)
