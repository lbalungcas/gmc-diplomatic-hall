"""
Validates public/models/diplomatic_hall.glb against the things that were actually broken.

Run:  python scripts/check_glb.py [path-to.glb]

Exits non-zero if a regression slips back in — in particular a primitive without UVs, which is
what made the hall carpet and the foyer marble render as flat colour for the whole of v10.
"""

import json
import os
import struct
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'public', 'models', 'diplomatic_hall.glb')

BUDGET_MB = 5.0


def load(path):
    data = open(path, 'rb').read()
    magic, _, length = struct.unpack('<III', data[:12])
    assert magic == 0x46546C67, 'not a GLB'
    off, chunks = 12, []
    while off < length:
        clen, ctype = struct.unpack('<II', data[off:off + 8])
        chunks.append((ctype, data[off + 8:off + 8 + clen]))
        off += 8 + clen
    return json.loads(chunks[0][1].decode('utf-8')), len(data)


def main():
    j, nbytes = load(PATH)
    fails, notes = [], []

    size_mb = nbytes / 1048576.0
    print(f'{os.path.relpath(PATH, ROOT)}  {size_mb:.2f} MB')
    if size_mb > BUDGET_MB:
        fails.append(f'over the {BUDGET_MB:.0f} MB budget ({size_mb:.2f} MB)')

    meshes = j.get('meshes', [])
    prims = [(m.get('name', '?'), p) for m in meshes for p in m['primitives']]
    tris = sum(j['accessors'][p['indices']]['count'] // 3 for _, p in prims if 'indices' in p)
    verts = sum(j['accessors'][p['attributes']['POSITION']]['count'] for _, p in prims)

    print(f"nodes {len(j.get('nodes', []))}  meshes {len(meshes)}  primitives {len(prims)}  "
          f"materials {len(j.get('materials', []))}  images {len(j.get('images', []))}")
    print(f'triangles {tris}  vertices {verts}')

    # --- the headline regression guard -------------------------------------------------------
    no_uv = [name for name, p in prims if 'TEXCOORD_0' not in p['attributes']]
    if no_uv:
        fails.append(f'{len(no_uv)} primitive(s) with no TEXCOORD_0: {sorted(set(no_uv))[:6]}')
    else:
        print(f'UVs        all {len(prims)} primitives carry TEXCOORD_0')

    # --- textures ----------------------------------------------------------------------------
    mimes = Counter(i.get('mimeType', '?') for i in j.get('images', []))
    print(f'image mime {dict(mimes)}')
    non_webp = [i.get('name') for i in j.get('images', []) if i.get('mimeType') != 'image/webp']
    if non_webp:
        fails.append(f'{len(non_webp)} image(s) not WebP: {non_webp[:5]}')

    img_bytes = sum(j['bufferViews'][i['bufferView']]['byteLength']
                    for i in j.get('images', []) if 'bufferView' in i)
    print(f'image data {img_bytes / 1048576.0:.2f} MB  '
          f'geometry+rest {(nbytes - img_bytes) / 1048576.0:.2f} MB')

    # --- material coverage -------------------------------------------------------------------
    mats = j.get('materials', [])
    with_orm = sum(1 for m in mats if 'metallicRoughnessTexture' in m.get('pbrMetallicRoughness', {}))
    with_ao = sum(1 for m in mats if 'occlusionTexture' in m)
    with_nrm = sum(1 for m in mats if 'normalTexture' in m)
    print(f'materials  {with_nrm} with normal, {with_orm} with metallicRoughness, {with_ao} with occlusion')
    if with_ao == 0:
        notes.append('no occlusionTexture exported — the ORM red channel is not reaching glTF')

    dup_families = Counter()
    for m in mats:
        name = m.get('name', '')
        head, _, tail = name.rpartition('.')
        if head and tail.isdigit():
            dup_families[head] += 1
    if dup_families:
        notes.append(f'material families still duplicated: {dict(dup_families)}')

    # Materials with no primitive referencing them are dead weight.
    used = {p['material'] for _, p in prims if 'material' in p}
    unused = [m.get('name') for i, m in enumerate(mats) if i not in used]
    if unused:
        notes.append(f'{len(unused)} material(s) referenced by no primitive: {unused[:5]}')

    # --- compression -------------------------------------------------------------------------
    ext = j.get('extensionsUsed', [])
    print(f'extensions {ext}')
    if 'EXT_meshopt_compression' not in ext:
        notes.append('EXT_meshopt_compression absent — geometry is uncompressed')

    print()
    for n in notes:
        print(f'NOTE  {n}')
    for f in fails:
        print(f'FAIL  {f}')
    if not fails:
        print('PASS  all hard checks green')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
