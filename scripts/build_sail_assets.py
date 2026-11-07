"""
Builds public/models/sail_set.glb: the low-poly set for the sailing opening (/sail/).

Run:  "D:\\Lancee_File\\blender.exe" -b --python scripts/build_sail_assets.py

Modelled from the client's stage art (public/stage/boat_elephant.png, public/stage/lighthouse.png):

  Boat        hull with planks and a navy rim, mast, boom, flag          materials B_*
  BoatSail    main sail with its stripes and the cream jib, kept apart   materials S_*
              so each rival boat can wear its own sail colour
  Tutu        the blue elephant at the bow, trunk raised                 materials T_*
  Lighthouse  rock island, striped tower, gallery, lantern room, dome    materials L_*
  LanternGlow the lantern panes, kept apart because they light up        material  L_Glow

The runtime (src/sail/world.js) flattens each material's colour into vertex colours and merges,
so a whole fleet is one instanced draw call. Boat faces +Y here, which is -Z in three.js: the
direction of travel. Metres; a boat is about 3 m long.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'sail_set.glb')


def srgb(h):
    h = h.lstrip('#')
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(int(h[i:i + 2], 16)) for i in (0, 2, 4)) + (1.0,)


# Sampled from the stage art.
COLORS = {
    'B_Hull': '#D88B5C', 'B_Plank': '#96583A', 'B_Rim': '#1A56A0', 'B_Mast': '#1B3461', 'B_Flag': '#F6BC30',
    'S_Main': '#FFFFFF', 'S_Stripe': '#C9C9C9', 'S_Jib': '#FFF6E4',
    'T_Body': '#0569B4', 'T_Ear': '#25257E', 'T_White': '#FFFFFF', 'T_Eye': '#141C3C',
    'L_Rock': '#5C6072', 'L_RockLt': '#7C8094', 'L_White': '#F7F7FA', 'L_Red': '#D84035', 'L_Deck': '#A02822',
    'L_Port': '#1B2B5E', 'L_Glow': '#FFE27A',
}


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = srgb(COLORS[name])
    bsdf.inputs['Roughness'].default_value = 0.7
    return m


class Part:
    """A bmesh with one material slot per colour name."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.slots = []

    def slot(self, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        return self.slots.index(mat)

    def tag(self, verts, mat):
        i = self.slot(mat)
        faces = set()
        for v in verts:
            faces.update(v.link_faces)
        for f in faces:
            f.material_index = i

    def box(self, mat, lo, hi, m=Matrix()):
        size = [hi[i] - lo[i] for i in range(3)]
        c = [(hi[i] + lo[i]) / 2 for i in range(3)]
        mm = m @ Matrix.Translation(c) @ Matrix.Diagonal((*size, 1.0))
        self.tag(bmesh.ops.create_cube(self.bm, size=1.0, matrix=mm)['verts'], mat)

    def cyl(self, mat, r1, r2, h, m=Matrix(), seg=16, caps=True):
        mm = m @ Matrix.Translation((0, 0, h / 2))
        res = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r2,
                                    depth=h, matrix=mm)
        self.tag(res['verts'], mat)

    def sphere(self, mat, r, m=Matrix(), u=14, v=10):
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=u, v_segments=v, radius=r, matrix=m)
        self.tag(res['verts'], mat)

    def rings(self, mat, rings):
        """Skin between rings of equal length (lists of (x, y, z)); capped both ends."""
        vs = [[self.bm.verts.new(p) for p in ring] for ring in rings]
        n = len(rings[0])
        faces = []
        for a, b in zip(vs, vs[1:]):
            for i in range(n):
                faces.append(self.bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i])))
        faces.append(self.bm.faces.new(vs[0][::-1]))
        faces.append(self.bm.faces.new(vs[-1]))
        idx = self.slot(mat)
        for f in faces:
            f.material_index = idx

    def quad_strip(self, mat, left, right):
        """Double-sided sheet between two polylines (sails)."""
        idx = self.slot(mat)
        ls = [self.bm.verts.new(p) for p in left]
        rs = [self.bm.verts.new(p) for p in right]
        for i in range(len(ls) - 1):
            f = self.bm.faces.new((ls[i], rs[i], rs[i + 1], ls[i + 1]))
            f.material_index = idx

    def finish(self, smooth=False):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(me)
        self.bm.free()
        for s in self.slots:
            me.materials.append(material(s))
        if smooth:
            me.shade_smooth()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


MAIN_SWING = math.radians(52)     # the boom is out, as running before the wind
JIB_SWING = math.radians(-34)


def build_boat():
    p = Part('Boat')
    # Hull: a boat-shaped section lofted along its length, wide at the rim, narrow at the keel,
    # pointed at the bow (+Y). The art's flared trapezoid, in 3D.
    stations = [(-1.45, 0.60), (-1.2, 0.72), (-0.5, 0.82), (0.3, 0.78), (0.95, 0.52), (1.4, 0.2), (1.62, 0.02)]
    def section(y, half, z_top=0.62, z_keel=0.0):
        return [(-half, y, z_top), (-half * 0.72, y, z_top * 0.45), (-half * 0.42, y, z_keel + 0.02),
                (half * 0.42, y, z_keel + 0.02), (half * 0.72, y, z_top * 0.45), (half, y, z_top)]
    p.rings('B_Hull', [section(y, h) for y, h in stations])
    # Plank lines: thin raised strips along each side, following the hull.
    for z, f in ((0.5, 0.97), (0.36, 0.86), (0.22, 0.74)):
        for s in (-1, 1):
            for (y0, h0), (y1, h1) in zip(stations[:-1], stations[1:]):
                x0, x1 = s * (h0 * f + 0.012), s * (h1 * f + 0.012)
                a, b = (x0, y0, z), (x1, y1, z)
                d = 0.022
                p.quad_strip('B_Plank', [(a[0], a[1], z - d), (a[0], a[1], z + d)], [(b[0], b[1], z - d), (b[0], b[1], z + d)])
    # Navy-blue rim round the top, slightly proud of the hull, and a deck.
    rim_o = [(s * (h + 0.05), y, 0.62) for s, sts in ((-1, stations), (1, stations[::-1])) for y, h in sts]
    rim_i = [(x * 0.9, y, z) for x, y, z in rim_o]
    top = [(x, y, 0.72) for x, y, z in rim_o]
    p.rings('B_Rim', [rim_o, top])
    deck = [p.bm.verts.new((x, y, 0.66)) for x, y, z in rim_i]
    f = p.bm.faces.new(deck)
    f.material_index = p.slot('B_Hull')
    # Mast, boom, flag: as drawn, a tall navy mast just ahead of midships.
    mast = Matrix.Translation((0, 0.25, 0.66))
    p.cyl('B_Mast', 0.055, 0.04, 3.4, mast, seg=8)
    swing = Matrix.Translation((0, 0.25, 0)) @ Matrix.Rotation(MAIN_SWING, 4, 'Z') @ Matrix.Translation((0, -0.25, 0))
    p.box('B_Mast', (-0.035, -1.35, 1.12), (0.035, 0.25, 1.19), swing)
    p.cyl('B_Mast', 0.05, 0.05, 0.04, Matrix.Translation((0, 0.25, 4.06)), seg=8)
    flag = [p.bm.verts.new(v) for v in ((0, 0.25, 4.04), (0, 0.25, 3.72), (0, -0.42, 3.88))]
    fl = p.bm.faces.new(flag)
    fl.material_index = p.slot('B_Flag')
    boat = p.finish()

    # Sails: main (white, tinted per boat at runtime) behind the mast with darker stripes, and
    # the cream jib ahead of it. Slight belly so they catch the light.
    s = Part('BoatSail')
    def belly(t):
        return 0.16 * math.sin(math.pi * t)
    n = 8
    mast_y, foot_y = 0.2, -1.3
    z0, z1 = 1.2, 3.95
    rot = Matrix.Translation((0, 0.25, 0)) @ Matrix.Rotation(MAIN_SWING, 4, 'Z') @ Matrix.Translation((0, -0.25, 0))
    out = lambda v: tuple(rot @ Vector(v))
    left = [out((belly(i / n) * 0.2, mast_y, z0 + (z1 - z0) * i / n)) for i in range(n + 1)]
    right = [out((belly(i / n), foot_y + (mast_y - foot_y) * (i / n), z0 + (z1 - z0) * i / n)) for i in range(n + 1)]
    s.quad_strip('S_Main', left, right)
    for i in (1, 3, 5, 7):
        t0, t1 = (i - 0.09) / n, (i + 0.09) / n
        z_a, z_b = z0 + (z1 - z0) * t0, z0 + (z1 - z0) * t1
        for off in (0.012, -0.012):
            s.quad_strip('S_Stripe',
                         [out((belly(t0) * 0.2 + off, mast_y, z_a)), out((belly(t1) * 0.2 + off, mast_y, z_b))],
                         [out((belly(t0) + off, foot_y + (mast_y - foot_y) * t0, z_a)), out((belly(t1) + off, foot_y + (mast_y - foot_y) * t1, z_b))])
    jrot = Matrix.Translation((0, 0.32, 0)) @ Matrix.Rotation(JIB_SWING, 4, 'Z') @ Matrix.Translation((0, -0.32, 0))
    jout = lambda v: tuple(jrot @ Vector(v))
    jib_l = [jout((0.0, 0.32, 0.9 + 2.95 * i / 6)) for i in range(7)]
    jib_r = [jout((-0.1 * math.sin(math.pi * i / 6), 1.45 - 1.13 * i / 6, 0.9 + 2.95 * i / 6)) for i in range(7)]
    s.quad_strip('S_Jib', jib_l, jib_r)
    sail = s.finish()
    return boat, sail


def build_tutu():
    """Tutu at the bow, as in the art: a round blue body, big dark ear, smile, raised trunk."""
    t = Part('Tutu')
    # Sits on the foredeck, looking ahead (+Y) and slightly to starboard.
    root = Matrix.Translation((0.0, 0.62, 0.72))
    body = root @ Matrix.Translation((0, -0.18, 0.46)) @ Matrix.Diagonal((0.48, 0.58, 0.52, 1))
    t.sphere('T_Body', 1.0, body, 12, 8)
    head_c = Vector((0, 0.22, 0.86))
    head = root @ Matrix.Translation(head_c) @ Matrix.Diagonal((0.42, 0.4, 0.4, 1))
    t.sphere('T_Body', 1.0, head, 12, 8)
    # Ears: flattened discs in the art's darker colour, with a body-coloured rim behind.
    for sx in (-1, 1):
        ear = root @ Matrix.Translation((sx * 0.46, 0.1, 0.92)) @ Matrix.Rotation(sx * 0.35, 4, 'Z')
        t.sphere('T_Body', 1.0, ear @ Matrix.Diagonal((0.05, 0.3, 0.36, 1)), 8, 5)
        t.sphere('T_Ear', 1.0, ear @ Matrix.Translation((sx * 0.012, 0.02, 0)) @ Matrix.Diagonal((0.05, 0.23, 0.28, 1)), 8, 5)
    # Trunk: a tube curling down and up, raised toward the sail as in the art.
    path = [(0, 0.58, 0.80), (0, 0.78, 0.62), (0.03, 0.98, 0.56), (0.06, 1.14, 0.68), (0.08, 1.22, 0.92), (0.09, 1.24, 1.14)]
    radii = [0.13, 0.115, 0.1, 0.09, 0.08, 0.07]
    rings = []
    seg = 6
    for i, c in enumerate(path):
        a = Vector(path[max(i - 1, 0)])
        b = Vector(path[min(i + 1, len(path) - 1)])
        d = (b - a).normalized()
        side = Vector((1, 0, 0))
        up = d.cross(side).normalized()
        side = up.cross(d).normalized()
        ring = []
        for k in range(seg):
            ang = 2 * math.pi * k / seg
            v = (root @ Vector(c)) + (side * math.cos(ang) + up * math.sin(ang)) * radii[i]
            ring.append(tuple(v))
        rings.append(ring)
    t.rings('T_Body', rings)
    # Tusks, eyes (little dark smiles in the art, dots at this size).
    for sx in (-1, 1):
        tusk = root @ Matrix.Translation((sx * 0.17, 0.56, 0.68)) @ Matrix.Rotation(math.radians(-70), 4, 'X')
        t.cyl('T_White', 0.042, 0.016, 0.2, tusk, seg=6)
        t.sphere('T_Eye', 0.034, root @ Matrix.Translation((sx * 0.17, 0.585, 0.98)), 6, 4)
    # Back legs just showing over the rim are hidden by the hull; a stubby tail.
    t.cyl('T_Body', 0.03, 0.012, 0.3, root @ Matrix.Translation((0, -0.72, 0.5)) @ Matrix.Rotation(math.radians(-115), 4, 'X'), seg=6)
    return t.finish(smooth=True)


def build_lighthouse():
    """The art's lighthouse: rock island, white tower with red bands and navy portholes, a deep red
    gallery, a red lantern room with glowing panes, dome and finial. Base at z = 0; about 24 m."""
    p = Part('Lighthouse')
    # Rock island: a lumpy cone, flat-shaded facets in two greys.
    seg = 12
    rings = []
    for (r, z, jit) in ((13.0, -1.5, 1.2), (11.0, 0.5, 1.5), (7.4, 1.9, 1.0), (4.9, 2.5, 0.4)):
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            rr = r + jit * math.sin(a * 3 + r) * 0.8 + jit * 0.5 * math.cos(a * 5)
            ring.append((rr * math.cos(a), rr * math.sin(a), z + jit * 0.25 * math.sin(a * 4)))
        rings.append(ring)
    p.rings('L_Rock', rings)
    for k, (x, y, sz) in enumerate(((7.4, -5.6, 1.5), (-6.8, -6.2, 1.2), (-9.2, 1.2, 1.6), (8.8, 3.4, 1.1), (1.0, -9.6, 1.3))):
        p.sphere('L_RockLt', 1.0, Matrix.Translation((x, y, 0.9)) @ Matrix.Diagonal((sz * 1.5, sz * 1.2, sz, 1)), 6, 4)
    # Tower: tapered, in stacked white and red bands, as drawn.
    z = 2.3
    H = 18.0
    r0, r1 = 3.5, 2.25
    def radius(zz):
        return r0 + (r1 - r0) * (zz - 2.3) / H
    bands = [('L_White', 0.2), ('L_Red', 0.11), ('L_White', 0.25), ('L_Red', 0.11), ('L_White', 0.33)]
    for mat, frac in bands:
        h = H * frac
        p.cyl(mat, radius(z), radius(z + h), h, Matrix.Translation((0, 0, z)), seg=24, caps=False)
        z += h
    top = z
    # Portholes up the tower facing the fleet (-Y in Blender is +z in three.js... the fleet sails
    # toward +Y, so they look down -Y) and a red door.
    for zz in (5.8, 11.0, 16.8):
        r = radius(zz)
        for ang in (-90, 180, 0):
            a = math.radians(ang)
            m = Matrix.Translation((r * math.cos(a), r * math.sin(a), zz)) @ Matrix.Rotation(a + math.pi / 2, 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'X')
            p.cyl('L_Port', 0.42, 0.42, 0.06, m, seg=12)
    p.box('L_Red', (-0.85, -radius(2.5) - 0.12, 2.3), (0.85, -radius(2.5) + 0.2, 4.6))
    p.cyl('L_Red', 0.85, 0.85, 0.32, Matrix.Translation((0, -radius(4.6) + 0.04, 4.6)) @ Matrix.Rotation(math.pi / 2, 4, 'X') @ Matrix.Translation((0, 0, -0.16)), seg=12)
    # Gallery.
    p.cyl('L_Deck', 2.55, 3.3, 0.5, Matrix.Translation((0, 0, top)), seg=24)
    p.cyl('L_Deck', 3.3, 3.3, 0.35, Matrix.Translation((0, 0, top + 0.5)), seg=24)
    # Lantern room: red frame posts around glowing panes (a separate object), then the dome.
    room_z = top + 0.85
    room_h = 2.8
    for k in range(8):
        a = 2 * math.pi * k / 8 + math.pi / 8
        m = Matrix.Translation((2.05 * math.cos(a), 2.05 * math.sin(a), room_z))
        p.cyl('L_Red', 0.13, 0.13, room_h, m, seg=6, caps=False)
    p.cyl('L_Deck', 2.2, 2.2, 0.16, Matrix.Translation((0, 0, room_z + room_h)), seg=20)
    dome_z = room_z + room_h + 0.16
    prof = [(2.4, 0.0), (2.3, 0.45), (1.95, 1.0), (1.4, 1.5), (0.7, 1.85), (0.18, 2.0)]
    rings = []
    for r, dz in prof:
        rings.append([(r * math.cos(2 * math.pi * k / 20), r * math.sin(2 * math.pi * k / 20), dome_z + dz) for k in range(20)])
    p.rings('L_Red', rings)
    p.cyl('L_Deck', 0.09, 0.09, 0.9, Matrix.Translation((0, 0, dome_z + 1.95)), seg=6)
    p.sphere('L_Deck', 0.26, Matrix.Translation((0, 0, dome_z + 2.95)), 10, 8)
    house = p.finish()

    g = Part('LanternGlow')
    g.cyl('L_Glow', 2.0, 2.0, room_h, Matrix.Translation((0, 0, room_z)), seg=16, caps=True)
    glow = g.finish()
    print(f'lantern centre z = {room_z + room_h / 2:.2f}, top of dome z = {dome_z + 3.2:.2f}')
    return house, glow


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_boat()
    build_tutu()
    build_lighthouse()
    from io_scene_gltf2.io.exp import meshopt as gltf_meshopt
    gltf_meshopt.EXP_FILTER_BITS = 16
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_tangents=False,
        export_texcoords=False,
        export_meshopt_compression_enable=True,
    )
    print('wrote', OUT, os.path.getsize(OUT))


if __name__ == '__main__':
    main()
    sys.exit(0)
