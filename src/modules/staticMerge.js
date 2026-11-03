/**
 * Merge a static prop's meshes by material: one draw call per material instead of one per part.
 *
 * The procedural props (registration desk, organizer stands) are built from dozens of small
 * meshes that never move relative to each other. On a tablet GPU each draw call costs far more
 * than its few triangles, so merging the parts that share a material is a large, free win.
 *
 * Call it right after the prop is built and positioned, and after anything that needs the
 * individual parts (collision boxes) has read them. Parts flagged `userData.keepSeparate`
 * (animated parts, meshes a loader resizes later) and mirrored parts (negative scale would flip
 * their winding) are left alone.
 *
 * Untextured materials are grouped by their parameters rather than by identity: the props
 * create a fresh material per part, so identical-looking parts would otherwise never merge.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function mergeStaticByMaterial(group) {
  group.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const shared = new Map();      // parameter signature -> the material that stands for it
  const keyOf = (m) => {
    const textured = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'aoMap']
      .some((k) => m[k]);
    if (textured || !m.isMeshStandardMaterial) return m;
    const sig = [m.type, m.color.getHexString(), m.emissive.getHexString(), m.emissiveIntensity,
      m.roughness, m.metalness, m.transparent, m.opacity, m.side, m.flatShading, m.depthWrite].join('|');
    if (!shared.has(sig)) shared.set(sig, m);
    return shared.get(sig);
  };
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material)) return;
    if (o.userData.keepSeparate) return;
    if (o.matrixWorld.determinant() < 0) return;
    const key = keyOf(o.material);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  });

  const rel = new THREE.Matrix4();
  let before = 0, after = 0;
  for (const [material, meshes] of buckets) {
    before += meshes.length;
    if (meshes.length < 2) { after += meshes.length; continue; }
    const geos = meshes.map((m) => {
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      // mergeGeometries needs identical attribute sets: keep position / normal / uv only.
      for (const name of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      }
      g.morphAttributes = {};
      rel.multiplyMatrices(toLocal, m.matrixWorld);
      g.applyMatrix4(rel);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) { after += meshes.length; continue; }
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `${group.name}_merged`;
    mesh.castShadow = meshes.some((m) => m.castShadow);
    mesh.receiveShadow = meshes.some((m) => m.receiveShadow);
    for (const m of meshes) m.removeFromParent();
    group.add(mesh);
    after += 1;
  }
  // Drop the now-empty sub-groups so traversal stays cheap.
  const empty = [];
  group.traverse((o) => { if (o !== group && !o.isMesh && o.children.length === 0 && o.type === 'Group') empty.push(o); });
  empty.forEach((o) => o.removeFromParent());
  return { before, after };
}
