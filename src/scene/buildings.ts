import * as THREE from "three";
import type { BuildingFeature, TwinProject } from "../types/twin";
import { heightAt, type Heightfield } from "./terrain";

export interface BuildingPickInfo {
  name: string;
  heightM: number;
  floors?: number;
  sourceType: string;
  isTarget: boolean;
}

/**
 * Extrude the twin's real (WFS/OSM) footprints into PBR massing sitting on
 * the DEM. Returns a group plus a mesh→info map for picking.
 */
export function buildCityGroup(
  twin: TwinProject,
  field: Heightfield
): { group: THREE.Group; pickInfo: Map<THREE.Object3D, BuildingPickInfo> } {
  const group = new THREE.Group();
  const pickInfo = new Map<THREE.Object3D, BuildingPickInfo>();

  const targetMaterial = new THREE.MeshStandardMaterial({
    color: 0x14b8a6,
    roughness: 0.35,
    metalness: 0.25,
    emissive: 0x0b4a44,
    emissiveIntensity: 0.1
  });
  const officialMaterial = new THREE.MeshStandardMaterial({ color: 0xb9c0cc, roughness: 0.62, metalness: 0.08 });
  const fallbackMaterial = new THREE.MeshStandardMaterial({ color: 0x8e96a3, roughness: 0.8, metalness: 0.02 });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x10131a, transparent: true, opacity: 0.35 });

  for (const building of twin.buildings) {
    const mesh = extrudeBuilding(building, field, building.role === "target" ? targetMaterial : building.source_type === "official" ? officialMaterial : fallbackMaterial);
    if (!mesh) continue;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), edgeMaterial);
    edges.position.copy(mesh.position);
    edges.rotation.copy(mesh.rotation);
    group.add(edges);

    pickInfo.set(mesh, {
      name: building.name,
      heightM: building.height_m,
      floors: building.floors_estimate,
      sourceType: building.source_type,
      isTarget: building.role === "target"
    });
  }
  return { group, pickInfo };
}

/**
 * WFS/OSM rings arrive with closing duplicates, occasional repeated vertices,
 * and either winding — all of which can blow up earcut into folded geometry.
 * Sanitize before extruding.
 */
function cleanRing(points: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> | null {
  const ring: Array<{ x: number; z: number }> = [];
  for (const point of points) {
    const previous = ring[ring.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.z - previous.z) < 0.05) continue;
    ring.push(point);
  }
  while (ring.length > 1 && Math.hypot(ring[0].x - ring[ring.length - 1].x, ring[0].z - ring[ring.length - 1].z) < 0.05) {
    ring.pop();
  }
  if (ring.length < 3) return null;

  let signedArea = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    signedArea += a.x * b.z - b.x * a.z;
  }
  if (Math.abs(signedArea / 2) < 4) return null; // degenerate sliver
  if (signedArea > 0) ring.reverse(); // CCW in shape space (y = -z)
  return ring;
}

function extrudeBuilding(
  building: BuildingFeature,
  field: Heightfield,
  material: THREE.Material
): THREE.Mesh | null {
  const points = cleanRing(building.footprint ?? []);
  if (!points) return null;

  // Shape lives in XY with y = -localZ, so rotateX(-90°) lands exactly on
  // world XZ (z = localZ) without a winding-flipping negative scale.
  const shape = new THREE.Shape();
  shape.moveTo(points[0].x, -points[0].z);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i].x, -points[i].z);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(3, building.height_m),
    bevelEnabled: false
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();

  // Base: lowest terrain under the footprint, slightly embedded
  let base = Infinity;
  for (const point of points) base = Math.min(base, heightAt(field, point.x, point.z));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = base - 0.6;
  return mesh;
}
