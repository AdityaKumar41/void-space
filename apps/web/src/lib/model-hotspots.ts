import { Vector3 } from 'three';
/** Zero is the documented mesh-centre fallback for generated labels. Authored offsets use model space. */
export function hotspotAnchor(
  position: readonly [number, number, number],
  center: Vector3,
  span: number,
  part: { labelCenter: Vector3; worldOffset: Vector3 } | undefined,
  exploded: boolean,
) {
  const anchor =
    part && position.every((x) => x === 0)
      ? part.labelCenter.clone()
      : center.clone().add(new Vector3(...position).multiplyScalar(span));
  if (exploded && part) anchor.add(part.worldOffset);
  return anchor;
}
