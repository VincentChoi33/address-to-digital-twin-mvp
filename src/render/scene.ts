import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  BOARD_HALF_M,
  CELL_SIZE_M,
  GRID_SIZE,
  type SimCell,
  type SimState
} from "../sim/hydrology";
import type { TwinProject } from "../types/twin";
import { loadBasemapMosaic, type BasemapMode, type BasemapMosaic } from "./basemap";

export class WebGLUnavailableError extends Error {
  constructor() {
    super("WebGL context could not be created");
    this.name = "WebGLUnavailableError";
  }
}

export interface SceneCallbacks {
  onCellPick: (cell: SimCell | null) => void;
}

const COLORS = {
  grass: new THREE.Color("#2e4434"),
  road: new THREE.Color("#3a3f4a"),
  building: new THREE.Color("#7d8597"),
  target: new THREE.Color("#19b6a4"),
  water: new THREE.Color("#2f9dde"),
  overflow: new THREE.Color("#e04a3f")
};

const MIN_VISIBLE_WATER = 0.004;

export class SceneRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private host: HTMLElement;
  private callbacks: SceneCallbacks;

  private groundMesh!: THREE.InstancedMesh;
  private buildingMesh!: THREE.InstancedMesh;
  private waterMesh!: THREE.InstancedMesh;
  private buildingMaterial!: THREE.MeshStandardMaterial;
  private infraGroup = new THREE.Group();
  private massingGroup = new THREE.Group();
  private highlight: THREE.LineSegments;

  private hemiLight: THREE.HemisphereLight;
  private sunLight: THREE.DirectionalLight;

  private sim: SimState | null = null;
  private twin: TwinProject | null = null;
  private mosaic: BasemapMosaic | null = null;
  private mosaicData: ImageData | null = null;
  private satelliteVisible = false;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private animationId = 0;
  private lastTime = 0;
  private onTick: ((dtMs: number) => void) | null = null;
  private resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(host: HTMLElement, callbacks: SceneCallbacks) {
    this.host = host;
    this.callbacks = callbacks;

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      throw new WebGLUnavailableError();
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2.05;
    this.controls.maxDistance = 420;
    this.setView("orbit");

    this.hemiLight = new THREE.HemisphereLight(0xbcd4ff, 0x18202c, 0.85);
    this.scene.add(this.hemiLight);
    this.sunLight = new THREE.DirectionalLight(0xfff2dd, 1.6);
    this.sunLight.position.set(90, 140, 60);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -110;
    this.sunLight.shadow.camera.right = 110;
    this.sunLight.shadow.camera.top = 110;
    this.sunLight.shadow.camera.bottom = -110;
    this.scene.add(this.sunLight);

    const highlightGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(CELL_SIZE_M, 1, CELL_SIZE_M));
    this.highlight = new THREE.LineSegments(
      highlightGeometry,
      new THREE.LineBasicMaterial({ color: 0xffe066 })
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.scene.add(this.infraGroup);
    this.scene.add(this.massingGroup);
    this.applyTheme("dark");

    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("click", this.handleClick);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  // ---------------------------------------------------------------- project

  async loadProject(
    twin: TwinProject,
    sim: SimState,
    basemapMode: BasemapMode,
    customTileUrl?: string
  ): Promise<void> {
    this.twin = twin;
    this.sim = sim;
    this.buildBoardMeshes();
    this.buildInfraMarkers();
    this.buildMassingOverlay();

    this.mosaic = null;
    this.mosaicData = null;
    this.refreshGroundColors();
    if (basemapMode !== "procedural") {
      const mosaic = await loadBasemapMosaic(basemapMode, twin.center, customTileUrl);
      if (this.disposed || this.twin !== twin) return;
      this.mosaic = mosaic;
      this.mosaicData = mosaic
        ? mosaic.canvas.getContext("2d")?.getImageData(0, 0, mosaic.canvas.width, mosaic.canvas.height) ?? null
        : null;
      this.refreshGroundColors();
    }
  }

  private disposeInstanced(mesh: THREE.InstancedMesh | undefined): void {
    if (!mesh) return;
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  private buildBoardMeshes(): void {
    if (!this.sim) return;
    this.disposeInstanced(this.groundMesh);
    this.disposeInstanced(this.buildingMesh);
    this.disposeInstanced(this.waterMesh);

    const count = GRID_SIZE * GRID_SIZE;
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    unitBox.translate(0, 0.5, 0); // origin at the bottom so scale.y grows upward

    this.groundMesh = new THREE.InstancedMesh(
      unitBox.clone(),
      new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }),
      count
    );
    this.groundMesh.receiveShadow = true;

    this.buildingMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 });
    this.buildingMesh = new THREE.InstancedMesh(unitBox.clone(), this.buildingMaterial, count);
    this.buildingMesh.castShadow = true;
    this.buildingMesh.receiveShadow = true;

    this.waterMesh = new THREE.InstancedMesh(
      unitBox.clone(),
      new THREE.MeshStandardMaterial({
        color: COLORS.water,
        transparent: true,
        opacity: 0.72,
        roughness: 0.15,
        metalness: 0.1
      }),
      count
    );

    const matrix = new THREE.Matrix4();
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const index = x * GRID_SIZE + z;
        matrix.identity();
        this.waterMesh.setMatrixAt(index, matrix.makeScale(0.0001, 0.0001, 0.0001));
        this.waterMesh.setColorAt(index, COLORS.water);
        this.refreshCellInstance(x, z);
      }
    }
    this.scene.add(this.groundMesh);
    this.scene.add(this.buildingMesh);
    this.scene.add(this.waterMesh);
  }

  private cellWorldX(x: number): number {
    return (x + 0.5) * CELL_SIZE_M - BOARD_HALF_M;
  }

  /** Sync ground + building instance transforms for one cell (terrain/tool edits). */
  refreshCellInstance(x: number, z: number): void {
    if (!this.sim) return;
    const cell = this.sim.cells[x][z];
    const index = x * GRID_SIZE + z;
    const worldX = this.cellWorldX(x);
    const worldZ = this.cellWorldX(z);
    const matrix = new THREE.Matrix4();

    const groundHeight = Math.max(0.2, cell.elevation + 0.6);
    matrix.makeScale(CELL_SIZE_M * 0.98, groundHeight, CELL_SIZE_M * 0.98);
    matrix.setPosition(worldX, -0.6, worldZ);
    this.groundMesh.setMatrixAt(index, matrix);

    if (cell.type === "building") {
      matrix.makeScale(CELL_SIZE_M * 0.82, cell.buildingHeight, CELL_SIZE_M * 0.82);
      matrix.setPosition(worldX, cell.elevation, worldZ);
      this.buildingMesh.setColorAt(index, cell.isTarget ? COLORS.target : COLORS.building);
    } else {
      matrix.makeScale(0.0001, 0.0001, 0.0001);
    }
    this.buildingMesh.setMatrixAt(index, matrix);

    this.groundMesh.instanceMatrix.needsUpdate = true;
    this.buildingMesh.instanceMatrix.needsUpdate = true;
    if (this.buildingMesh.instanceColor) this.buildingMesh.instanceColor.needsUpdate = true;
    this.refreshGroundColor(x, z);
  }

  private sampleMosaic(worldX: number, worldZ: number): THREE.Color | null {
    if (!this.mosaic || !this.mosaicData) return null;
    const px = Math.round(this.mosaic.centerPx + worldX * this.mosaic.pxPerMeter);
    const py = Math.round(this.mosaic.centerPy - worldZ * this.mosaic.pxPerMeter);
    if (px < 0 || py < 0 || px >= this.mosaicData.width || py >= this.mosaicData.height) return null;
    const offset = (py * this.mosaicData.width + px) * 4;
    return new THREE.Color(
      this.mosaicData.data[offset] / 255,
      this.mosaicData.data[offset + 1] / 255,
      this.mosaicData.data[offset + 2] / 255
    );
  }

  private refreshGroundColor(x: number, z: number): void {
    if (!this.sim) return;
    const cell = this.sim.cells[x][z];
    const index = x * GRID_SIZE + z;
    const typeColor = cell.type === "road" ? COLORS.road : COLORS.grass;
    let color = typeColor;
    if (this.satelliteVisible) {
      const sampled = this.sampleMosaic(this.cellWorldX(x), this.cellWorldX(z));
      if (sampled) color = sampled.lerp(typeColor, cell.type === "road" ? 0.35 : 0.15);
    }
    this.groundMesh.setColorAt(index, color);
    if (this.groundMesh.instanceColor) this.groundMesh.instanceColor.needsUpdate = true;
  }

  private refreshGroundColors(): void {
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) this.refreshGroundColor(x, z);
    }
  }

  buildInfraMarkers(): void {
    if (!this.sim) return;
    this.infraGroup.clear();
    const sewerGeometry = new THREE.CylinderGeometry(0.9, 0.9, 0.18, 12);
    const sewerMaterial = new THREE.MeshStandardMaterial({ color: 0x11161d, roughness: 0.8 });
    const outfallMaterial = new THREE.MeshStandardMaterial({ color: 0x0fb37f, roughness: 0.5 });
    const entranceMaterial = new THREE.MeshStandardMaterial({ color: 0xf2b13d, roughness: 0.5 });
    const entranceGeometry = new THREE.ConeGeometry(1.3, 2.6, 4);

    for (const column of this.sim.cells) {
      for (const cell of column) {
        const worldX = this.cellWorldX(cell.x);
        const worldZ = this.cellWorldX(cell.z);
        if (cell.hasSewer) {
          const grate = new THREE.Mesh(sewerGeometry, cell.hasOutfall ? outfallMaterial : sewerMaterial);
          grate.position.set(worldX + 1.6, cell.elevation + 0.1, worldZ + 1.6);
          this.infraGroup.add(grate);
        }
        if (cell.isUndergroundEntrance) {
          const cone = new THREE.Mesh(entranceGeometry, entranceMaterial);
          cone.position.set(worldX - 1.4, cell.elevation + 1.3, worldZ - 1.4);
          this.infraGroup.add(cone);
        }
      }
    }
  }

  private buildMassingOverlay(): void {
    if (!this.twin) return;
    this.massingGroup.clear();

    const parcelPoints = this.twin.parcel.boundary.map(
      (point) => new THREE.Vector3(point.x, 0.35, point.z)
    );
    const parcelLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(parcelPoints),
      new THREE.LineBasicMaterial({ color: 0xffd166 })
    );
    this.massingGroup.add(parcelLine);

    for (const road of this.twin.roads) {
      const points = road.centerline.map((point) => new THREE.Vector3(point.x, 0.3, point.z));
      this.massingGroup.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: 0x8d99ae })
        )
      );
    }

    const target = this.twin.buildings.find((building) => building.role === "target");
    if (target) {
      const outline = target.footprint.map((point) => new THREE.Vector3(point.x, 0.4, point.z));
      this.massingGroup.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(outline),
          new THREE.LineBasicMaterial({ color: 0x19b6a4 })
        )
      );
    }
  }

  // ---------------------------------------------------------------- water

  private syncWater(): void {
    if (!this.sim) return;
    const matrix = new THREE.Matrix4();
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const cell = this.sim.cells[x][z];
        const index = x * GRID_SIZE + z;
        if (cell.water > MIN_VISIBLE_WATER && cell.type !== "building") {
          const depth = Math.min(cell.water, 6);
          matrix.makeScale(CELL_SIZE_M, depth, CELL_SIZE_M);
          matrix.setPosition(this.cellWorldX(x), cell.elevation, this.cellWorldX(z));
          this.waterMesh.setColorAt(index, cell.overflowing ? COLORS.overflow : COLORS.water);
        } else {
          matrix.makeScale(0.0001, 0.0001, 0.0001);
        }
        this.waterMesh.setMatrixAt(index, matrix);
      }
    }
    this.waterMesh.instanceMatrix.needsUpdate = true;
    if (this.waterMesh.instanceColor) this.waterMesh.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- loop

  start(onTick: (dtMs: number) => void): void {
    this.onTick = onTick;
    this.lastTime = performance.now();
    const loop = (time: number) => {
      if (this.disposed) return;
      const dt = Math.min(time - this.lastTime, 100);
      this.lastTime = time;
      this.onTick?.(dt);
      this.syncWater();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.animationId = requestAnimationFrame(loop);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- controls

  setView(view: "orbit" | "top"): void {
    if (view === "top") {
      this.camera.position.set(0, 175, 0.01);
    } else {
      this.camera.position.set(72, 78, 96);
    }
    this.camera.lookAt(0, 0, 0);
    if (this.controls) {
      this.controls.target.set(0, 2, 0);
      this.controls.update();
    }
  }

  setXray(active: boolean): void {
    if (!this.buildingMaterial) return;
    this.buildingMaterial.transparent = active;
    this.buildingMaterial.opacity = active ? 0.3 : 1;
    this.buildingMaterial.needsUpdate = true;
  }

  setShadow(active: boolean): void {
    this.renderer.shadowMap.enabled = active;
    this.sunLight.castShadow = active;
  }

  setMassingVisible(visible: boolean): void {
    this.massingGroup.visible = visible;
  }

  setSatelliteVisible(visible: boolean): void {
    this.satelliteVisible = visible;
    this.refreshGroundColors();
  }

  applyTheme(theme: "light" | "dark"): void {
    const isLight = theme === "light";
    this.scene.background = new THREE.Color(isLight ? "#cfe0ef" : "#070b12");
    this.scene.fog = new THREE.Fog(isLight ? 0xcfe0ef : 0x070b12, 220, 520);
    this.hemiLight.intensity = isLight ? 1.15 : 0.85;
    this.sunLight.intensity = isLight ? 2.2 : 1.6;
  }

  // ---------------------------------------------------------------- picking

  private pickCell(event: PointerEvent | MouseEvent): SimCell | null {
    if (!this.sim) return null;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([this.groundMesh, this.buildingMesh, this.waterMesh]);
    const hit = hits.find((candidate) => candidate.instanceId !== undefined);
    if (!hit || hit.instanceId === undefined) return null;
    const x = Math.floor(hit.instanceId / GRID_SIZE);
    const z = hit.instanceId % GRID_SIZE;
    return this.sim.cells[x]?.[z] ?? null;
  }

  private handlePointerMove = (event: PointerEvent): void => {
    const cell = this.pickCell(event);
    if (!cell) {
      this.highlight.visible = false;
      return;
    }
    this.highlight.visible = true;
    this.highlight.position.set(this.cellWorldX(cell.x), cell.elevation + 0.4, this.cellWorldX(cell.z));
  };

  private handleClick = (event: MouseEvent): void => {
    this.callbacks.onCellPick(this.pickCell(event));
  };

  // ---------------------------------------------------------------- misc

  private resize(): void {
    const width = this.host.clientWidth || 1;
    const height = this.host.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationId);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.removeEventListener("click", this.handleClick);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
