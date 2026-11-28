import { buildGlbFixture } from '../../../packages/db/src/glb-fixture';
/** A closed, pickable cube. The generic DB fixture consists of disconnected small triangles. */
export function solidCubeFixture() {
  const buffer = buildGlbFixture(12);
  const jsonLength = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const binary = 20 + jsonLength + 8;
  const vertices = [
    [-0.5, -0.5, -0.5],
    [0.5, -0.5, -0.5],
    [0.5, 0.5, -0.5],
    [-0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5],
    [0.5, -0.5, 0.5],
    [0.5, 0.5, 0.5],
    [-0.5, 0.5, 0.5],
  ];
  const faces = [
    [4, 5, 6, 4, 6, 7],
    [1, 0, 3, 1, 3, 2],
    [5, 1, 2, 5, 2, 6],
    [0, 4, 7, 0, 7, 3],
    [7, 6, 2, 7, 2, 3],
    [0, 1, 5, 0, 5, 4],
  ];
  const normals = [
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
  ];
  let corner = 0;
  for (const [face, indices] of faces.entries())
    for (const index of indices) {
      for (let axis = 0; axis < 3; axis++) {
        buffer.writeFloatLE(
          vertices[index]![axis]!,
          binary + gltf.bufferViews[0].byteOffset + (corner * 3 + axis) * 4,
        );
        buffer.writeFloatLE(
          normals[face]![axis]!,
          binary + gltf.bufferViews[1].byteOffset + (corner * 3 + axis) * 4,
        );
      }
      corner++;
    }
  return buffer;
}
