import * as THREE from "three";
import type { BuildingFeature, LocalPoint, RoadHint, TwinProject } from "../types/twin";
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
  const targetOutlineMaterial = new THREE.LineBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.95 });
  const targetHaloMaterial = new THREE.MeshBasicMaterial({
    color: 0x2dd4bf,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  for (const building of twin.buildings) {
    const points = cleanRing(building.footprint ?? []);
    if (!points) continue;
    const mesh = extrudeBuildingFromPoints(
      building,
      points,
      field,
      building.role === "target" ? targetMaterial : building.source_type === "official" ? officialMaterial : fallbackMaterial
    );
    if (!mesh) continue;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.layer = "building";
    group.add(mesh);

    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), edgeMaterial);
    edges.position.copy(mesh.position);
    edges.rotation.copy(mesh.rotation);
    edges.userData.layer = "building";
    group.add(edges);

    if (building.role === "target") {
      const roofY = mesh.position.y + Math.max(3, building.height_m) + 0.28;
      const roofLine = makeLineLoop(points, () => roofY, targetOutlineMaterial);
      roofLine.userData.layer = "building";
      group.add(roofLine);
      addSegmentRibbons(group, points, field, targetHaloMaterial, 1.2, 0.62, true, "building");
    }

    pickInfo.set(mesh, {
      name: building.name,
      heightM: building.height_m,
      floors: building.floors_estimate,
      sourceType: building.source_type,
      isTarget: building.role === "target"
    });
  }
  addRoadRibbons(group, twin.roads, field);
  addParcelBoundary(group, twin.parcel.boundary, field);
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

function extrudeBuildingFromPoints(
  building: BuildingFeature,
  points: Array<{ x: number; z: number }>,
  field: Heightfield,
  material: THREE.Material
): THREE.Mesh | null {
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

function makeLineLoop(
  points: Array<{ x: number; z: number }>,
  yAt: (point: { x: number; z: number }) => number,
  material: THREE.Material
): THREE.LineLoop {
  const geometry = new THREE.BufferGeometry().setFromPoints(
    points.map((point) => new THREE.Vector3(point.x, yAt(point), point.z))
  );
  return new THREE.LineLoop(geometry, material);
}

function addRoadRibbons(group: THREE.Group, roads: RoadHint[], field: Heightfield): void {
  if (roads.length === 0) return;
  const roadGroup = new THREE.Group();
  roadGroup.name = "official-road-ribbons";
  const roadMaterial = new THREE.MeshBasicMaterial({
    color: 0x26384a,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
  const centerlineMaterial = new THREE.LineBasicMaterial({
    color: 0xdbeafe,
    transparent: true,
    opacity: 0.36
  });

  for (const road of roads) {
    if (road.centerline.length < 2) continue;
    const width = Math.max(3.5, Math.min(14, road.width_m || 5));
    addPolylineRibbons(roadGroup, road.centerline, field, roadMaterial, width, 0.18, false, "site");
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        road.centerline.map((point) => new THREE.Vector3(point.x, heightAt(field, point.x, point.z) + 0.36, point.z))
      ),
      centerlineMaterial
    );
    line.userData.layer = "site";
    roadGroup.add(line);
  }
  group.add(roadGroup);
}

function addParcelBoundary(group: THREE.Group, boundary: LocalPoint[], field: Heightfield): void {
  const points = cleanRing(boundary ?? []);
  if (!points) return;
  const parcelGroup = new THREE.Group();
  parcelGroup.name = "official-parcel-boundary";
  const parcelRibbonMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc857,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const parcelLineMaterial = new THREE.LineBasicMaterial({
    color: 0xfff3bf,
    transparent: true,
    opacity: 0.98
  });
  addSegmentRibbons(parcelGroup, points, field, parcelRibbonMaterial, 0.78, 0.82, true, "site");
  const line = makeLineLoop(points, (point) => heightAt(field, point.x, point.z) + 1.12, parcelLineMaterial);
  line.userData.layer = "site";
  parcelGroup.add(line);
  group.add(parcelGroup);
}

function addSegmentRibbons(
  group: THREE.Group,
  points: Array<{ x: number; z: number }>,
  field: Heightfield,
  material: THREE.Material,
  width: number,
  yOffset: number,
  closed: boolean,
  layer: "building" | "site"
): void {
  const count = closed ? points.length : points.length - 1;
  for (let index = 0; index < count; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    addRibbonSegment(group, a, b, field, material, width, yOffset, layer);
  }
}

function addPolylineRibbons(
  group: THREE.Group,
  points: LocalPoint[],
  field: Heightfield,
  material: THREE.Material,
  width: number,
  yOffset: number,
  closed: boolean,
  layer: "building" | "site"
): void {
  const count = closed ? points.length : points.length - 1;
  for (let index = 0; index < count; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    addRibbonSegment(group, a, b, field, material, width, yOffset, layer);
  }
}

function addRibbonSegment(
  group: THREE.Group,
  a: { x: number; z: number },
  b: { x: number; z: number },
  field: Heightfield,
  material: THREE.Material,
  width: number,
  yOffset: number,
  layer: "building" | "site"
): void {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.1) return;
  const geometry = new THREE.PlaneGeometry(width, length);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.z = -Math.atan2(dx, dz);
  const midX = (a.x + b.x) / 2;
  const midZ = (a.z + b.z) / 2;
  mesh.position.set(midX, heightAt(field, midX, midZ) + yOffset, midZ);
  mesh.receiveShadow = false;
  mesh.renderOrder = layer === "site" ? 3 : 4;
  mesh.userData.layer = layer;
  group.add(mesh);
}
