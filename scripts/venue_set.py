"""
The Youth Innovation Marketplace set, built procedurally inside the venue .blend.

Imported by scripts/build_venue.py (runs under Blender). Everything is placed from
src/data/hallLayout.json, the same file src/main.js reads for interaction and collision, so the
baked geometry and the runtime can never disagree about where a booth or the stage is.

  reshape_hall()   stretch the hall north and lift the ceiling, keeping the floor plan
  build_stage()    platform, side steps, LED wall frame, lighting truss, set furniture, speakers
  build_seating()  two audience blocks of light stacking chairs
  build_clusters() eight 3-booth clusters (3-2-3): partition panels, counters, stools, clip spots, plants

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
    'Mat_Stage_Skirt':    dict(color=srgb(24, 38, 82), roughness=0.92, metallic=0.0),
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
}

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
    say(f'  stretched hall north by {dy} m beyond z={hall["stretchFromZ"]} and lifted the '
        f'ceiling by {dz} m ({moved} objects reshaped)')


def remove_legacy(say):
    """The old 20-booth rows, the banquet chairs and the old stage/podium are rebuilt here."""
    gone = 0
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and (o.name.startswith(('Booth_', 'Banquet_Chair'))
                                 or o.name in ('Stage', 'Podium')):
            bpy.data.objects.remove(o, do_unlink=True)
            gone += 1
    say(f'  removed {gone} legacy objects (20-booth rows, banquet chairs, old stage + podium)')


# =============================================================================================
# 2. Stage
# =============================================================================================
def build_stage(say):
    st = LAYOUT['stage']
    led = LAYOUT['led']
    h = st['height']
    x0, x1 = st['x0'], st['x1']
    y0, y1 = -st['zFront'], -st['zBack']       # Blender y: front < back

    b = Builder('Stage_Platform')
    # Deck and skirt: the top face is wood, the sides navy fabric.
    b.box('Mat_Stage_Skirt', (x0, y0, 0.0), (x1, y1, h - 0.04))
    b.box(STAGE_WOOD, (x0 - 0.02, y0 - 0.02, h - 0.04), (x1 + 0.02, y1, h))
    # Warm LED strip under the front nosing — reads as a lit stage edge from the audience.
    b.box('Mat_Stage_Glow', (x0, y0 - 0.025, h - 0.075), (x1, y0 - 0.005, h - 0.055))
    # Side steps (two risers each) so presenters can walk up from the wings.
    for side in (-1, 1):
        xe = x0 if side < 0 else x1
        for k, (w, top) in enumerate(((0.6, h / 3), (0.3, 2 * h / 3))):
            xa, xb = (xe - w, xe) if side < 0 else (xe, xe + w)
            b.box('Mat_Stage_Skirt', (xa, 25.2, 0.0), (xb, 26.3, top - 0.03))
            b.box(STAGE_WOOD, (xa, 25.2, top - 0.03), (xb, 26.3, top))
    b.to_object()

    # LED wall frame: the runtime lays the video/idle slide on its front face.
    lf = Builder('Stage_LED_Frame')
    lw, lh, lb = led['width'], led['height'], led['bottom']
    cx = led['cx']
    face_y = -led['z'] + 0.03            # frame face just behind the runtime LED plane
    lf.box('Mat_LED_Frame', (cx - lw / 2 - 0.15, face_y, lb - 0.15), (cx + lw / 2 + 0.15, face_y + 0.18, lb + lh + 0.15))
    # Ground-support legs down to the deck.
    for lx in (cx - lw / 2 + 0.6, cx + lw / 2 - 0.6):
        lf.box('Mat_LED_Frame', (lx - 0.06, face_y + 0.02, h), (lx + 0.06, face_y + 0.16, lb - 0.15))
    lf.to_object()

    # Lighting truss across the stage front, hung from the ceiling, with six can lights.
    t = Builder('Stage_Truss')
    tz0, tz1 = 6.15, 6.45
    ty0, ty1 = y0 + 0.25, y0 + 0.55
    tx0, tx1 = x0 - 0.2, x1 + 0.2
    chords = [(ty0, tz0), (ty1, tz0), (ty0, tz1), (ty1, tz1)]
    for (cy, cz) in chords:
        t.rod('Mat_Truss', (tx0, cy, cz), (tx1, cy, cz), 0.028)
    n = int((tx1 - tx0) / 0.5)
    for i in range(n):
        xa = tx0 + i * (tx1 - tx0) / n
        xb = tx0 + (i + 1) * (tx1 - tx0) / n
        t.rod('Mat_Truss', (xa, ty0, tz0), (xb, ty0, tz1), 0.012, 6)
        t.rod('Mat_Truss', (xa, ty1, tz1), (xb, ty1, tz0), 0.012, 6)
        t.rod('Mat_Truss', (xa, ty0, tz0), (xb, ty1, tz0), 0.012, 6)
    ceil = LAYOUT['hall']['ceilingHeight']
    for xh in (tx0 + 0.4, (tx0 + tx1) / 2, tx1 - 0.4):
        t.rod('Mat_Truss', (xh, (ty0 + ty1) / 2, tz1), (xh, (ty0 + ty1) / 2, ceil), 0.006, 4)
    for i in range(6):
        lx = x0 + 0.9 + i * (x1 - x0 - 1.8) / 5
        base = Vector((lx, (ty0 + ty1) / 2, tz0 - 0.02))
        aim = Vector((cx + (lx - cx) * 0.5, (y0 + y1) / 2, h + 1.0))
        d = (aim - base).normalized()
        head = base + d * 0.12 + Vector((0, 0, -0.12))
        t.rod('Mat_LED_Frame', base, head, 0.015, 6)
        rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        t.cyl('Mat_LED_Frame', 0.09, 0.075, 0.26, Matrix.Translation(head - d * 0.13) @ rot, 14)
        t.cyl('Mat_Lamp_Glow', 0.07, 0.07, 0.005, Matrix.Translation(head + d * 0.13) @ rot, 14)
    t.to_object()

    # Set furniture, after the stage design: lectern, white armchair, three orange lounge
    # chairs, coffee table, two side tables and a dark rug.
    f = Builder('Stage_Furniture')
    def at(x, z3, yaw=0.0):
        return Matrix.Translation(B(x, z3, h)) @ Matrix.Rotation(yaw, 4, 'Z')

    # Rug
    f.box('Mat_Rug', (-2.6, -1.4, 0.0), (2.6, 1.4, 0.012), at(10.3, -26.7))

    # Lectern (stage left, angled to the audience)
    m = at(5.35, -25.7, math.radians(-12))
    f.box('Mat_Wood_Dark', (-0.3, -0.24, 0.0), (0.3, 0.24, 0.05), m)
    f.box(STAGE_WOOD, (-0.27, -0.2, 0.05), (0.27, 0.2, 1.05), m)
    f.box('Mat_Wood_Dark', (-0.3, -0.22, 1.02), (0.3, 0.22, 1.05), m)
    top = m @ Matrix.Translation((0, 0.02, 1.08)) @ Matrix.Rotation(math.radians(-18), 4, 'X')
    f.box(STAGE_WOOD, (-0.32, -0.26, -0.03), (0.32, 0.26, 0.02), top)
    p0 = m @ Vector((0.18, 0.12, 1.1))
    p1 = m @ Vector((0.12, -0.12, 1.42))
    f.rod('Mat_Mic', p0, p1, 0.008, 6)
    f.cyl('Mat_Mic', 0.022, 0.016, 0.07, Matrix.Translation(p1), 10)

    # White armchair + tree-stump side table
    m = at(7.25, -26.7, math.radians(-8))
    f.box('Mat_Armchair', (-0.38, -0.36, 0.08), (0.38, 0.36, 0.42), m)
    f.box('Mat_Armchair', (-0.38, 0.2, 0.42), (0.38, 0.38, 0.92), m)
    for s in (-1, 1):
        f.box('Mat_Armchair', (s * 0.38 - 0.08, -0.36, 0.42), (s * 0.38 + 0.08, 0.38, 0.62), m)
        for fy in (-0.3, 0.3):
            f.cyl('Mat_Wood_Dark', 0.025, 0.02, 0.08, m @ Matrix.Translation((s * 0.32, fy, 0)), 8)
    f.cyl('Mat_Wood_Dark', 0.2, 0.22, 0.46, at(6.45, -26.5), 18)
    f.cyl('Mat_Soil', 0.17, 0.17, 0.005, at(6.45, -26.5) @ Matrix.Translation((0, 0, 0.46)), 18)

    # Round coffee table
    m = at(8.55, -26.35)
    f.cyl('Mat_Table_White', 0.32, 0.32, 0.03, m @ Matrix.Translation((0, 0, 0.44)), 24)
    for k in range(3):
        a = k * 2 * math.pi / 3
        f.rod('Mat_Wood_Dark', m @ Vector((0.2 * math.cos(a), 0.2 * math.sin(a), 0.0)),
              m @ Vector((0.08 * math.cos(a), 0.08 * math.sin(a), 0.44)), 0.015, 6)

    # Three orange lounge chairs facing the audience
    for lx in (9.85, 11.15, 12.45):
        m = at(lx, -27.0)
        f.box('Mat_Lounge_Orange', (-0.29, -0.27, 0.40), (0.29, 0.27, 0.48), m)
        back = m @ Matrix.Translation((0, 0.25, 0.46)) @ Matrix.Rotation(math.radians(-12), 4, 'X')
        f.box('Mat_Lounge_Orange', (-0.29, -0.04, 0.0), (0.29, 0.04, 0.58), back)
        for sx in (-1, 1):
            for sy in (-1, 1):
                f.rod('Mat_Wood_Dark', m @ Vector((sx * 0.3, sy * 0.28, 0.0)),
                      m @ Vector((sx * 0.22, sy * 0.2, 0.41)), 0.018, 6)

    # Carved wood sculpture side table, stage right
    m = at(13.85, -26.6)
    f.cyl('Mat_Wood_Dark', 0.2, 0.1, 0.25, m, 16)
    f.cyl('Mat_Wood_Dark', 0.1, 0.2, 0.25, m @ Matrix.Translation((0, 0, 0.25)), 16)
    f.cyl('Mat_Table_White', 0.12, 0.12, 0.015, m @ Matrix.Translation((0, 0, 0.5)), 16)
    f.to_object()

    # Floor speaker stacks either side of the stage, behind the side steps.
    sp = Builder('Stage_Speakers')
    for sx in (x0 - 0.65, x1 + 0.65):
        m = Matrix.Translation(B(sx, -27.3, 0.0))
        sp.box('Mat_Speaker', (-0.28, -0.26, 0.0), (0.28, 0.26, 1.7), m)
        sp.box('Mat_Speaker_Grill', (-0.24, -0.265, 0.1), (0.24, -0.255, 1.6), m)
    sp.to_object()

    # Big plants at the stage-front corners soften the set.
    pl = Builder('Stage_Plants')
    for (px, pz) in ((x0 - 0.5, -24.45), (x1 + 0.5, -24.45)):
        plant(pl, Matrix.Translation(B(px, pz, 0.0)), scale=1.6, seed=int(px * 10))
    pl.to_object()

    say(f'  stage {x1 - x0:.1f} x {y1 - y0:.1f} m at {h} m, LED wall frame {lw} x {lh} m, '
        f'truss + 6 can lights, lectern, armchair, 3 lounge chairs, tables, rug, speakers')


# =============================================================================================
# 3. Audience seating
# =============================================================================================
def chair(b, m):
    """Upholstered conference chair on a chrome sled frame (~300 faces).

    Local frame: the sitter faces -Y, so +Y is the back; the caller rotates it to face the
    stage. Padded seat with rounded edges, a curved upholstered backrest on a dark shell, and
    a continuous tube sled on each side with floor glides.
    """
    # Seat: dark shell under a rounded fabric cushion.
    b.box('Mat_Seat_Shell', (-0.235, -0.225, 0.395), (0.235, 0.215, 0.415), m, bevel=0.008, segments=1)
    b.box('Mat_Seat_Fabric', (-0.23, -0.235, 0.41), (0.23, 0.21, 0.475), m, bevel=0.028, segments=3)

    # Back: curved fabric pad on a curved shell, reclined ~10 degrees.
    back = m @ Matrix.Translation((0, 0.2, 0.5)) @ Matrix.Rotation(math.radians(-10), 4, 'X')
    b.curved_slab('Mat_Seat_Shell', 0.46, 0.42, 0.018, 0.55, back @ Matrix.Translation((0, 0.03, 0.0)))
    b.curved_slab('Mat_Seat_Fabric', 0.43, 0.39, 0.04, 0.55, back @ Matrix.Translation((0, -0.01, 0.015)))

    # Sled frame: floor runner, front leg, seat rail, rear leg rising into the back.
    r = 0.011
    for sx in (-0.215, 0.215):
        p = lambda x, y, z: m @ Vector((x, y, z))
        b.rod('Mat_Seat_Frame', p(sx, -0.24, 0.012), p(sx, 0.22, 0.012), r)
        b.rod('Mat_Seat_Frame', p(sx, -0.24, 0.012), p(sx, -0.2, 0.395), r)
        b.rod('Mat_Seat_Frame', p(sx, -0.2, 0.395), p(sx, 0.2, 0.395), r)
        b.rod('Mat_Seat_Frame', p(sx, 0.22, 0.012), p(sx, 0.255, 0.85), r)
        for gy in (-0.23, 0.21):
            b.box('Mat_Seat_Glide', (sx - 0.014, gy - 0.02, 0.0), (sx + 0.014, gy + 0.02, 0.006), m)
    b.rod('Mat_Seat_Frame', m @ Vector((-0.215, -0.2, 0.395)), m @ Vector((0.215, -0.2, 0.395)), r)
    b.rod('Mat_Seat_Frame', m @ Vector((-0.215, 0.2, 0.395)), m @ Vector((0.215, 0.2, 0.395)), r)


def build_seating(say):
    s = LAYOUT['seating']
    b = Builder('Seat_Audience')
    n = 0
    # Chairs face the stage (-z in three.js = +y in Blender), so the back sits at -y.
    face = Matrix.Rotation(math.pi, 4, 'Z')
    for z3 in s['rows']:
        for blk in s['blocks']:
            for k in range(blk['count']):
                x = blk['x0'] + k * s['pitch']
                chair(b, Matrix.Translation(B(x, z3, 0.0)) @ face)
                n += 1
    b.to_object()
    say(f'  {n} audience chairs in {len(s["blocks"])} blocks x {len(s["rows"])} rows')


# =============================================================================================
# 4. Booth clusters
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


def build_clusters(say):
    c = LAYOUT['clusters']
    L = c['panelLength']
    H = c['panelHeight']
    g = c['graphic']
    ctr = c['counter']

    for idx, cl in enumerate(c['list']):
        b = Builder(f'Booth_Cluster_{cl["id"]}')
        cx, cz = cl['x'], cl['z']

        # Hub post where the three panels meet.
        b.cyl('Mat_Booth_Oak', 0.045, 0.045, H + 0.04, Matrix.Translation(B(cx, cz, 0.0)), 16)

        for pa in c['panelAngles']:
            m = frame(cx, cz, pa)
            # White fabric core between the frame members; the runtime prints the booth
            # graphics onto both faces of it.
            b.box('Mat_Booth_Fabric', (g['r0'], -0.015, g['y0']), (g['r1'], 0.015, g['y1']), m)
            # Light-oak frame: outer upright, top rail, kick rail.
            b.box('Mat_Booth_Oak', (g['r1'], -0.03, 0.0), (L, 0.03, H), m)
            b.box('Mat_Booth_Oak', (g['r0'], -0.03, g['y1']), (g['r1'], 0.03, H), m)
            b.box('Mat_Booth_Oak', (g['r0'], -0.03, 0.0), (g['r1'], 0.03, g['y0']), m)
            # Stabiliser foot at the free end.
            b.box('Mat_Booth_Oak', (L - 0.1, -0.2, 0.0), (L + 0.02, 0.2, 0.025), m)

        for bi, ba in enumerate(c['bayAngles']):
            m = frame(cx, cz, ba)
            # Counter at the mouth of the bay: white body on a dark recessed kick, oak top.
            b.box('Mat_Booth_Kick', (ctr['r0'] + 0.03, -ctr['halfWidth'] + 0.03, 0.0),
                  (ctr['r1'] - 0.03, ctr['halfWidth'] - 0.03, 0.07), m)
            b.box('Mat_Booth_Counter', (ctr['r0'], -ctr['halfWidth'], 0.07),
                  (ctr['r1'], ctr['halfWidth'], ctr['height'] - 0.03), m)
            b.box('Mat_Booth_Oak', (ctr['r0'] - 0.02, -ctr['halfWidth'] - 0.02, ctr['height'] - 0.03),
                  (ctr['r1'] + 0.02, ctr['halfWidth'] + 0.02, ctr['height']), m)

            # Bar stool beside the counter (always on the bay's +Y side).
            sm = m @ Matrix.Translation((0.98, 0.66, 0.0))
            b.cyl('Mat_Stool', 0.17, 0.17, 0.05, sm @ Matrix.Translation((0, 0, 0.7)), 16)
            b.box('Mat_Stool', (-0.15, 0.12, 0.75), (0.15, 0.16, 1.02), sm)
            for k in range(4):
                a = math.pi / 4 + k * math.pi / 2
                b.rod('Mat_Stool', sm @ Vector((0.17 * math.cos(a), 0.17 * math.sin(a), 0.0)),
                      sm @ Vector((0.11 * math.cos(a), 0.11 * math.sin(a), 0.7)), 0.012, 6)
            b.torus('Mat_Stool', 0.145, 0.008, sm @ Matrix.Translation((0, 0, 0.3)), 16, 5)

            # Clip spotlight on the top of the bay's +60deg panel end, aimed at the graphics.
            pa = math.radians(ba + 60)
            end = B(cx + math.cos(pa) * (L - 0.04), cz + math.sin(pa) * (L - 0.04), H)
            bay_dir = B(math.cos(math.radians(ba)), math.sin(math.radians(ba)))
            head = end + bay_dir * 0.16 + Vector((0, 0, 0.12))
            target = B(cx + math.cos(math.radians(ba)) * 0.35,
                       cz + math.sin(math.radians(ba)) * 0.35, 1.35)
            d = (target - head).normalized()
            b.box('Mat_Stool', (-0.03, -0.04, -0.03), (0.03, 0.04, 0.03), Matrix.Translation(end))
            b.rod('Mat_Stool', end, head, 0.008, 6)
            rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
            b.cyl('Mat_Stool', 0.05, 0.042, 0.14, Matrix.Translation(head - d * 0.07) @ rot, 12)
            b.cyl('Mat_Lamp_Glow', 0.04, 0.04, 0.004, Matrix.Translation(head + d * 0.07) @ rot, 12)

            # Plant tucked into the bay corner by the hub.
            plant(b, m @ Matrix.Translation((0.24, 0.0, 0.0)), scale=0.85, seed=idx * 3 + bi)

        b.to_object()
    say(f'  {len(c["list"])} clusters x 3 booths = {len(c["list"]) * 3} booths '
        f'(1.0 x {H} m panels, counters, stools, clip spots, plants)')


# =============================================================================================
# 5. Doorways
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
    ('x', 19.35, 7.18, 8.68, -1, 'open'),      # EX_R1, hall <-> foyer
    ('x', 19.35, 11.58, 13.08, -1, 'open'),    # EX_R2, hall <-> foyer
    ('y', 0.0, 19.75, 20.80, +1, 'exit'),      # foyer doors on the south wall
    ('y', 0.0, 21.20, 22.25, +1, 'exit'),
    ('y', 0.0, 22.65, 23.70, +1, 'exit'),
    ('y', 0.0, 24.10, 25.15, +1, 'exit'),
]


def build_doors(say):
    ceil = LAYOUT['hall']['ceilingHeight']
    lintels = Builder('W_Lintels')
    doors = Builder('Door_Leaves')
    for i, (axis, w, a, b, inside, kind) in enumerate(DOORWAYS):
        top = 2.6 if kind == 'open' else 2.4
        def box(bld, mat_name, s0, s1, t0, t1, z0, z1):
            # s along the wall, t across it (thickness), z up
            if axis == 'y':
                bld.box(mat_name, (s0, w + t0, z0), (s1, w + t1, z1))
            else:
                bld.box(mat_name, (w + t0, s0, z0), (w + t1, s1, z1))
        box(lintels, 'Mat_Acoustic_Wall', a, b, -0.1, 0.1, top, ceil)
        if kind == 'open':
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
    build_clusters(say)
