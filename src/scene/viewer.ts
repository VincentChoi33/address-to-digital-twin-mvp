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
  private backflowPlumes: THREE.InstancedMesh | null = null;
  private backflowPlumeMaterial: THREE.MeshBasicMaterial | null = null;
  private backflowDrainBases: Array<{ x: number; z: number; y: number; phase: number }> = [];
  private backflowVisualActive = false;
  private plumeMatrix = new THREE.Matrix4();
  private plumePosition = new THREE.Vector3();
  private plumeQuaternion = new THREE.Quaternion();
  private plumeScale = new THREE.Vector3();

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
    this.surface = new WaterSurface(
      DOMAIN_SIZE_M,
      this.solver.terrainTexture,
      this.solver.depthTexture,
      this.solver.fluxTexture,
      this.skyRig.envMap
    );
    this.projectGroup.add(this.surface.mesh);

    this.buildDrainMarkers(this.baked.drains, field);
    this.addOrientationGuides(field);
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
    this.backflowPlumes = null;
    this.backflowPlumeMaterial = null;
    this.backflowDrainBases = [];
    this.backflowVisualActive = false;
    this.cityPickInfo.clear();
  }

  private buildDrainMarkers(drains: DrainPoint[], field: Heightfield): void {
    if (drains.length === 0) return;
    const geometry = new THREE.CylinderGeometry(1.0, 1.0, 0.3, 10);
    const material = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.85 });
    const markers = new THREE.InstancedMesh(geometry, material, drains.length);
    const plumeGeometry = new THREE.CylinderGeometry(0.38, 1.25, 1, 12, 1, true);
    const plumeMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6b45,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const plumes = new THREE.InstancedMesh(plumeGeometry, plumeMaterial, drains.length);
    plumes.visible = false;
    const matrix = new THREE.Matrix4();
    drains.forEach((drain, index) => {
      const baseY = heightAt(field, drain.x, drain.z) + 0.12;
      matrix.makeTranslation(drain.x, baseY, drain.z);
      markers.setMatrixAt(index, matrix);
      markers.setColorAt(index, new THREE.Color(0x14181f));

      this.backflowDrainBases.push({
        x: drain.x,
        z: drain.z,
        y: baseY,
        phase: index * 1.618
      });
      this.plumePosition.set(drain.x, baseY, drain.z);
      this.plumeScale.set(0.01, 0.01, 0.01);
      this.plumeMatrix.compose(this.plumePosition, this.plumeQuaternion, this.plumeScale);
      plumes.setMatrixAt(index, this.plumeMatrix);
    });
    this.drainMarkers = markers;
    this.backflowPlumes = plumes;
    this.backflowPlumeMaterial = plumeMaterial;
    this.projectGroup.add(markers);
    this.projectGroup.add(plumes);
  }


  private addOrientationGuides(field: Heightfield): void {
    const group = new THREE.Group();
    group.name = "orientation-guides";
    group.userData.layer = "site";

    const originX = -58;
    const originZ = -18;
    const originY = heightAt(field, originX, originZ) + 3.2;
    const origin = new THREE.Vector3(originX, originY, originZ);

    const north = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), origin, 34, 0x64d2ff, 8, 4);
    const east = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origin, 30, 0xb7ff4a, 7, 3.5);
    north.name = "north-arrow-local-plus-z";
    east.name = "east-arrow-local-plus-x";
    group.add(north, east);
    group.add(this.makeGuideLabel("N +Z", 0x64d2ff, new THREE.Vector3(originX, originY + 10, originZ + 42)));
    group.add(this.makeGuideLabel("E +X", 0xb7ff4a, new THREE.Vector3(originX + 38, originY + 9, originZ)));
    this.projectGroup.add(group);
  }

  private makeGuideLabel(text: string, color: number, position: THREE.Vector3): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "rgba(4, 9, 17, 0.72)";
      context.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
      context.lineWidth = 3;
      context.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 18);
      context.fill();
      context.stroke();
      context.font = "900 28px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
      context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(34, 11, 1);
    sprite.renderOrder = 20;
    sprite.userData.layer = "site";
    return sprite;
  }

  /** Flip drain grates red while the network backflows. */
  setBackflowVisual(active: boolean): void {
    this.backflowVisualActive = active;
    if (!this.drainMarkers) return;
    const color = new THREE.Color(active ? 0xd6453a : 0x14181f);
    for (let i = 0; i < this.drainMarkers.count; i++) this.drainMarkers.setColorAt(i, color);
    if (this.drainMarkers.instanceColor) this.drainMarkers.instanceColor.needsUpdate = true;
    if (this.backflowPlumes) this.backflowPlumes.visible = active;
    if (this.backflowPlumeMaterial) this.backflowPlumeMaterial.opacity = active ? 0.38 : 0;
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
        this.surface.update(
          this.solver.depthTexture,
          this.solver.fluxTexture,
          this.camera,
          this.skyRig.sunDirection,
          this.elapsedS,
          this.solver.rainMmPerHour,
          this.solver.backflowMps
        );
        (this.surface.mesh.material as THREE.ShaderMaterial).uniforms.uEnvMap.value = this.skyRig.envMap;
      }
      this.updateBackflowPlumes();
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

  private updateBackflowPlumes(): void {
    if (!this.backflowPlumes || !this.backflowVisualActive || this.backflowDrainBases.length === 0) return;
    for (let index = 0; index < this.backflowDrainBases.length; index++) {
      const base = this.backflowDrainBases[index];
      const pulse = 0.5 + 0.5 * Math.sin(this.elapsedS * 7.4 + base.phase);
      const height = 1.8 + pulse * 5.4;
      const radius = 0.45 + (1 - pulse) * 0.55;
      this.plumePosition.set(base.x, base.y + height * 0.5, base.z);
      this.plumeScale.set(radius, height, radius);
      this.plumeMatrix.compose(this.plumePosition, this.plumeQuaternion, this.plumeScale);
      this.backflowPlumes.setMatrixAt(index, this.plumeMatrix);
    }
    this.backflowPlumes.instanceMatrix.needsUpdate = true;
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
      // The site/ground is the subject. Use a steeper oblique angle so the
      // first view reads like a real satellite/GIS board instead of a skyline
      // shot with too much empty sky.
      const lift = Math.max(DOMAIN_SIZE_M * 0.72, Math.min(tallest * 1.35, DOMAIN_SIZE_M * 0.9));
      const aim = Math.min(Math.max(tallest * 0.12, 3), 20);
      this.camera.position.set(DOMAIN_SIZE_M * 0.42, lift, DOMAIN_SIZE_M * 0.45);
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
    this.projectGroup.traverse((object) => {
      if (object.userData.layer === "building") object.visible = visible;
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
