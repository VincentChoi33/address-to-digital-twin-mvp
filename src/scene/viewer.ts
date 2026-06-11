import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadBasemapMosaic, type BasemapMode } from "../render/basemap";
import type { TwinProject } from "../types/twin";
import { bakeDomain, type BakedDomain, type DrainPoint } from "../water/bake";
import { SIM_N, WaterSolver, type WaterStats } from "../water/solver";
import { WaterSurface } from "../water/surface";
import { buildCityGroup, type BuildingPickInfo } from "./buildings";
import { RainEffect } from "./rain";
import { createSkyRig, type SkyRig } from "./sky";
import { DOMAIN_SIZE_M, buildTerrainMesh, heightAt, loadHeightfield, type Heightfield } from "./terrain";

export class WebGLUnavailableError extends Error {
  constructor() {
    super("WebGL context could not be created");
    this.name = "WebGLUnavailableError";
  }
}

export interface PickResult {
  worldX: number;
  worldZ: number;
  groundM: number;
  depthM: number;
  building?: BuildingPickInfo;
}

export interface ViewerCallbacks {
  onPick: (pick: PickResult | null) => void;
}

export class CityViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private host: HTMLElement;
  private callbacks: ViewerCallbacks;
  private skyRig: SkyRig;
  private rain: RainEffect;

  private projectGroup = new THREE.Group();
  private terrainMesh: THREE.Mesh | null = null;
  private cityPickInfo = new Map<THREE.Object3D, BuildingPickInfo>();
  private drainMarkers: THREE.InstancedMesh | null = null;

  solver: WaterSolver | null = null;
  surface: WaterSurface | null = null;
  baked: BakedDomain | null = null;
  field: Heightfield | null = null;
  private twin: TwinProject | null = null;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private animationId = 0;
  private lastTime = 0;
  private elapsedS = 0;
  private onTick: ((dtMs: number) => void) | null = null;
  private resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(host: HTMLElement, callbacks: ViewerCallbacks) {
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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.5, 6000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2.08;
    this.controls.maxDistance = 1500;
    this.setView("orbit");

    this.skyRig = createSkyRig(this.renderer, this.scene);
    this.rain = new RainEffect(DOMAIN_SIZE_M * 1.1);
    this.scene.add(this.rain.object);
    this.scene.add(this.projectGroup);

    this.renderer.domElement.addEventListener("click", this.handleClick);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  // ---------------------------------------------------------------- project

  async loadProject(twin: TwinProject, basemapMode: BasemapMode, customTileUrl?: string): Promise<void> {
    this.twin = twin;

    const [field, mosaic] = await Promise.all([
      loadHeightfield(twin.center),
      loadBasemapMosaic(basemapMode, twin.center, customTileUrl, DOMAIN_SIZE_M / 2 + 40)
    ]);
    if (this.disposed || this.twin !== twin) return;
    this.field = field;

    this.clearProject();

    this.terrainMesh = buildTerrainMesh(field, mosaic, this.renderer.capabilities.getMaxAnisotropy());
    this.projectGroup.add(this.terrainMesh);

    const city = buildCityGroup(twin, field);
    this.cityPickInfo = city.pickInfo;
    this.projectGroup.add(city.group);

    this.baked = bakeDomain(twin, field, DOMAIN_SIZE_M);
    this.solver = new WaterSolver(
      this.renderer,
      this.baked.solidHeight,
      this.baked.drainRate,
      this.baked.buildingMask,
      DOMAIN_SIZE_M
    );
    this.surface = new WaterSurface(DOMAIN_SIZE_M, this.solver.terrainTexture, this.solver.depthTexture, this.skyRig.envMap);
    this.projectGroup.add(this.surface.mesh);

    this.buildDrainMarkers(this.baked.drains, field);
    this.setView("orbit");
  }

  private clearProject(): void {
    this.projectGroup.clear();
    this.surface?.dispose();
    this.surface = null;
    this.solver?.dispose();
    this.solver = null;
    this.terrainMesh = null;
    this.drainMarkers = null;
    this.cityPickInfo.clear();
  }

  private buildDrainMarkers(drains: DrainPoint[], field: Heightfield): void {
    if (drains.length === 0) return;
    const geometry = new THREE.CylinderGeometry(1.0, 1.0, 0.3, 10);
    const material = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.85 });
    const markers = new THREE.InstancedMesh(geometry, material, drains.length);
    const matrix = new THREE.Matrix4();
    drains.forEach((drain, index) => {
      matrix.makeTranslation(drain.x, heightAt(field, drain.x, drain.z) + 0.12, drain.z);
      markers.setMatrixAt(index, matrix);
      markers.setColorAt(index, new THREE.Color(0x14181f));
    });
    this.drainMarkers = markers;
    this.projectGroup.add(markers);
  }

  /** Flip drain grates red while the network backflows. */
  setBackflowVisual(active: boolean): void {
    if (!this.drainMarkers) return;
    const color = new THREE.Color(active ? 0xd6453a : 0x14181f);
    for (let i = 0; i < this.drainMarkers.count; i++) this.drainMarkers.setColorAt(i, color);
    if (this.drainMarkers.instanceColor) this.drainMarkers.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- loop

  start(onTick: (dtMs: number) => void): void {
    this.onTick = onTick;
    this.lastTime = performance.now();
    const loop = (time: number) => {
      if (this.disposed) return;
      const dt = Math.min(time - this.lastTime, 100);
      this.lastTime = time;
      this.elapsedS += dt / 1000;

      this.onTick?.(dt);
      this.rain.update(dt);
      if (this.solver) this.solver.step(dt);
      if (this.surface && this.solver) {
        this.surface.update(this.solver.depthTexture, this.camera, this.skyRig.sunDirection, this.elapsedS);
        (this.surface.mesh.material as THREE.ShaderMaterial).uniforms.uEnvMap.value = this.skyRig.envMap;
      }
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.animationId = requestAnimationFrame(loop);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  readStats(): WaterStats | null {
    return this.solver ? this.solver.readStats() : null;
  }

  setRain(mmPerHour: number): void {
    if (this.solver) this.solver.rainMmPerHour = mmPerHour;
    this.rain.setIntensity(mmPerHour);
    const wantStorm = mmPerHour > 50;
    if ((this.skyRig.mode === "storm") !== wantStorm) this.skyRig.setMode(wantStorm ? "storm" : "day");
  }

  // ---------------------------------------------------------------- controls

  setView(view: "orbit" | "top"): void {
    // frame the whole domain even when a skyscraper dominates the center
    const tallest = this.twin
      ? this.twin.buildings.reduce((max, b) => Math.max(max, b.height_m), 0)
      : 0;
    if (view === "top") {
      this.camera.position.set(0, Math.max(DOMAIN_SIZE_M * 1.15, tallest * 2.2), 0.01);
      this.camera.lookAt(0, 0, 0);
      this.controls.target.set(0, 0, 0);
    } else {
      // ground (the flood) is the subject — clamp so supertalls can't tilt
      // the camera into the sky
      const lift = Math.max(DOMAIN_SIZE_M * 0.42, Math.min(tallest * 1.1, DOMAIN_SIZE_M * 0.62));
      const aim = Math.min(tallest * 0.2, 32);
      this.camera.position.set(DOMAIN_SIZE_M * 0.5, lift, DOMAIN_SIZE_M * 0.68);
      this.camera.lookAt(0, aim, 0);
      this.controls.target.set(0, aim, 0);
    }
    this.controls.update();
  }

  setShadow(active: boolean): void {
    this.renderer.shadowMap.enabled = active;
    this.skyRig.sunLight.castShadow = active;
  }

  setBuildingsVisible(visible: boolean): void {
    for (const mesh of this.cityPickInfo.keys()) {
      mesh.visible = visible;
    }
    this.projectGroup.traverse((object) => {
      if (object instanceof THREE.LineSegments && object !== this.rain.object) object.visible = visible;
    });
  }

  // ---------------------------------------------------------------- picking

  private handleClick = (event: MouseEvent): void => {
    if (!this.field) return;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const targets: THREE.Object3D[] = [...this.cityPickInfo.keys()];
    if (this.terrainMesh) targets.push(this.terrainMesh);
    if (this.surface) targets.push(this.surface.mesh);
    const hits = this.raycaster.intersectObjects(targets, false);
    const hit = hits[0];
    if (!hit) {
      this.callbacks.onPick(null);
      return;
    }
    const worldX = hit.point.x;
    const worldZ = hit.point.z;
    this.callbacks.onPick({
      worldX,
      worldZ,
      groundM: heightAt(this.field, worldX, worldZ),
      depthM: this.depthAt(worldX, worldZ),
      building: this.cityPickInfo.get(hit.object)
    });
  };

  /** Approximate depth at a world point from the latest stats readback grid. */
  depthAt(worldX: number, worldZ: number): number {
    const stats = this.solver?.stats;
    if (!stats) return 0;
    const grid = 64;
    const col = Math.min(grid - 1, Math.max(0, Math.floor((worldX / DOMAIN_SIZE_M + 0.5) * grid)));
    const row = Math.min(grid - 1, Math.max(0, Math.floor((worldZ / DOMAIN_SIZE_M + 0.5) * grid)));
    return stats.depthGrid[row * grid + col];
  }

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
    this.renderer.domElement.removeEventListener("click", this.handleClick);
    this.clearProject();
    this.rain.dispose();
    this.skyRig.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export { DOMAIN_SIZE_M, SIM_N };
