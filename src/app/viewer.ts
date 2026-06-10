import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { BuildingFeature, LocalPoint, RoadHint, TwinProject, HydrologyCell, HydrologyState } from "../types/twin";

export const GRID_SIZE = 24;
export const CELL_WIDTH = 6.0; // 144m board width
export const PIPE_DEPTH = 5.0;

export interface HydrologyCallbacks {
  onLog: (text: string, type: "info" | "success" | "warn" | "danger") => void;
  onApiStatusUpdate: (key: "geocode" | "osm" | "dem" | "tile", status: "gray" | "green" | "yellow" | "red") => void;
  onStatsUpdate: (stats: {
    totalSurfaceWater: number;
    totalPipeWater: number;
    subwayWater: number;
    totalOutflowVolume: number;
    overflowCount: number;
  }) => void;
  onGaugesUpdate: (drainPercent: number, pressurePercent: number, speedMS: number) => void;
  onCellInspect: (cell: HydrologyCell | null) => void;
}

class SoundSynth {
  private ctx: AudioContext | null = null;
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }
  playClick() {
    this.init(); if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.frequency.setValueAtTime(700, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1300, this.ctx.currentTime + 0.03);
    gain.gain.setValueAtTime(0.03, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.03);
    osc.start(); osc.stop(this.ctx.currentTime + 0.03);
  }
  playDraw() {
    this.init(); if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = "triangle";
    osc.frequency.setValueAtTime(400, this.ctx.currentTime);
    osc.frequency.setValueAtTime(550, this.ctx.currentTime + 0.06);
    gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
    osc.start(); osc.stop(this.ctx.currentTime + 0.1);
  }
  playDelete() {
    this.init(); if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(80, this.ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);
    osc.start(); osc.stop(this.ctx.currentTime + 0.12);
  }
  playOverflow() {
    this.init(); if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(320, this.ctx.currentTime);
    osc.frequency.setValueAtTime(260, this.ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);
    osc.start(); osc.stop(this.ctx.currentTime + 0.25);
  }
  playWarning() {
    this.init(); if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(130, this.ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.4);
    osc.start(); osc.stop(this.ctx.currentTime + 0.4);
  }
  playSuction() {
    this.init(); if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 0.4;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1200, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(70, this.ctx.currentTime + 0.4);
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.4);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start();
  }
  playThunder() {
    this.init(); if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2.0;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(220, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(20, this.ctx.currentTime + 1.8);
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.35, this.ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.8);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start();
  }
}

class FlowStreak {
  public mesh: THREE.Mesh;
  public life = 0;
  private x = 0;
  private z = 0;
  private vx = 0;
  private vz = 0;
  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.4, 4),
      new THREE.MeshBasicMaterial({ color: 0x5ce1e6, transparent: true, opacity: 0.0 })
    );
    this.mesh.rotation.x = Math.PI / 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  spawn(x: number, z: number, vx: number, vz: number, elev: number) {
    this.x = x * CELL_WIDTH + CELL_WIDTH / 2 + (Math.random() - 0.5) * (CELL_WIDTH * 0.4);
    this.z = z * CELL_WIDTH + CELL_WIDTH / 2 + (Math.random() - 0.5) * (CELL_WIDTH * 0.4);
    this.mesh.position.set(this.x, elev + 0.12, this.z);
    
    const angle = Math.atan2(vx, vz);
    this.mesh.rotation.y = angle;
    this.vx = vx;
    this.vz = vz;
    this.life = 1.0;
    this.mesh.visible = true;
  }
  update(dt: number) {
    if (this.life <= 0) {
      this.mesh.visible = false;
      return;
    }
    const speed = 10.0;
    this.x += this.vx * speed * dt;
    this.z += this.vz * speed * dt;
    this.mesh.position.x = this.x;
    this.mesh.position.z = this.z;
    this.life -= dt * 1.8;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = this.life * 0.75;
    if (this.life <= 0) this.mesh.visible = false;
  }
}

type BasemapMode = "procedural" | "vworld" | "arcgis" | "custom";

interface LabelHandle {
  element: HTMLDivElement;
  position: THREE.Vector3;
}

export interface TwinViewerOptions {
  host: HTMLElement;
  twin: TwinProject;
  basemapMode: BasemapMode;
  customTileUrl?: string;
  callbacks?: HydrologyCallbacks;
}

export class TwinViewer {
  public readonly scene = new THREE.Scene();
  private readonly clock = new THREE.Clock();
  private readonly perspectiveCamera: THREE.PerspectiveCamera;
  private readonly topCamera: THREE.OrthographicCamera;
  private camera: THREE.Camera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  
  // Roots
  private readonly groundRoot = new THREE.Group();
  private readonly gridGroup = new THREE.Group();
  private readonly waterGroup = new THREE.Group();
  private readonly outfallParticleGroup = new THREE.Group();
  private readonly overflowBubbleGroup = new THREE.Group();
  private readonly rippleGroup = new THREE.Group();
  private readonly satelliteRoot = new THREE.Group();
  
  private readonly labels: LabelHandle[] = [];
  private readonly resizeObserver: ResizeObserver;
  private twin: TwinProject;
  private animationFrame = 0;
  
  // Hydrology States
  public readonly hydrologyState: HydrologyState;
  private readonly sound = new SoundSynth();
  private readonly flowStreaks: FlowStreak[] = [];
  private rainSystem?: THREE.LineSegments;
  private selectionOutline?: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private maxPipeCapacity = 2.0;
  
  // DEM Terrain Meshes
  private terrainMesh?: THREE.Mesh;
  private terrainGeo?: THREE.PlaneGeometry;
  private terrainTexture?: THREE.CanvasTexture;
  private satelliteTileCache: { [key: string]: { img: HTMLImageElement; loaded: boolean; failed: boolean; sourceIndex: number } } = {};
  private satelliteTilesLoading = false;
  
  // Materials Cache
  private readonly materialCache: { [key: string]: THREE.Material } = {};
  
  // Ambient & Sun
  private ambientLight!: THREE.AmbientLight;
  private sunLight!: THREE.DirectionalLight;
  private fillLight!: THREE.DirectionalLight;
  
  // Lightning
  private lightningActive = false;
  private lightningState = 0;
  private lightningTimer = 8.0;
  
  // Hydrology Materials
  private readonly mats = {
    glassCyan: new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, roughness: 0.05, transparent: true, opacity: 0.35, transmission: 0.5 }),
    sewer: new THREE.MeshStandardMaterial({ color: 0x27272a, metalness: 0.9, roughness: 0.5 }),
    pipe: new THREE.MeshStandardMaterial({ color: 0x3f3f46, metalness: 0.8, roughness: 0.4 }),
    outfall: new THREE.MeshStandardMaterial({ color: 0xa1a1aa, metalness: 0.7, roughness: 0.3 }),
    subwayExitMetal: new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.2 }),
    water: new THREE.MeshPhysicalMaterial({ color: 0x0ea5e9, roughness: 0.1, transparent: true, opacity: 0.7, transmission: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.1 }),
    pipeWater: new THREE.MeshStandardMaterial({ color: 0x00d4ff, roughness: 0.1, emissive: 0x0088cc, emissiveIntensity: 0.4 }),
    particleWater: new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.85 }),
    bubbleWater: new THREE.MeshBasicMaterial({ color: 0xdbeafe, transparent: true, opacity: 0.6 }),
    outline: new THREE.MeshBasicMaterial({ color: 0x00ffe0, wireframe: true }),
    rain: new THREE.LineBasicMaterial({ color: 0xcffafe, transparent: true, opacity: 0.45 })
  };

  constructor(private readonly options: TwinViewerOptions) {
    this.twin = options.twin;
    this.scene.background = new THREE.Color(0x030611);
    this.scene.fog = new THREE.FogExp2(0x030611, 0.0035);

    // Camera
    const width = Math.max(1, options.host.clientWidth);
    const height = Math.max(1, options.host.clientHeight);
    this.perspectiveCamera = new THREE.PerspectiveCamera(38, width / height, 0.1, 2000);
    this.perspectiveCamera.position.set(160, 160, 200);
    this.topCamera = new THREE.OrthographicCamera(-120, 120, 120, -120, 0.1, 2200);
    this.topCamera.up.set(0, 0, -1);
    this.camera = this.perspectiveCamera;

    // WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, canvas: options.host.querySelector("canvas") || undefined });
    if (!options.host.querySelector("canvas")) {
      this.renderer.setSize(width, height);
      options.host.appendChild(this.renderer.domElement);
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI * 0.45;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 500;
    this.controls.target.set(GRID_SIZE * CELL_WIDTH / 2, 0, GRID_SIZE * CELL_WIDTH / 2);

    // Initialize Hydrology State
    this.hydrologyState = {
      selectedTool: "inspect",
      selectedCell: null,
      viewMode: "surface",
      rainIntensity: 0,
      grid: [],
      elapsedTime: 0,
      scenario: "normal",
      theme: "dark",
      totalSurfaceWater: 0,
      totalPipeWater: 0,
      subwayWater: 0,
      totalOutflowVolume: 0,
      overflowCount: 0,
      subwayWarningTriggered: false
    };

    // Lights
    this.addLighting();

    // Scene Groups
    this.scene.add(this.groundRoot, this.satelliteRoot, this.gridGroup, this.waterGroup, this.outfallParticleGroup, this.overflowBubbleGroup, this.rippleGroup);

    // Cursor Selection Outline
    const outlineGeo = new THREE.BoxGeometry(CELL_WIDTH + 0.05, 0.8, CELL_WIDTH + 0.05);
    this.selectionOutline = new THREE.Mesh(outlineGeo, this.mats.outline);
    this.selectionOutline.visible = false;
    this.scene.add(this.selectionOutline);

    // Particles & Streaks
    this.initFlowStreaksPool();
    this.initRainSystem();

    // Init Grid Data
    this.initGridData();

    // Build Continuous Terrain and 3D Assets
    this.createTerrainTexture();
    this.buildContinuousTerrain();
    this.buildGridMeshes();

    // Reconnect sub-pipes
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        if (this.hydrologyState.grid[x][z].hasPipe) {
          this.rebuildPipeMesh(x, z);
        }
      }
    }

    // Set controls target
    this.controls.target.set(GRID_SIZE * CELL_WIDTH / 2, 0, GRID_SIZE * CELL_WIDTH / 2);
    this.controls.update();

    // Resize Observer & Events
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(options.host);
    options.host.addEventListener("pointermove", (e) => this.handleCellHover(e));
    options.host.addEventListener("click", () => this.handleCellClick());

    this.animate();
  }

  private addLighting(): void {
    this.ambientLight = new THREE.AmbientLight(0xe0f2fe, 0.65);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 0.9);
    this.sunLight.position.set(-60, 220, -30);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.left = -100;
    this.sunLight.shadow.camera.right = 100;
    this.sunLight.shadow.camera.top = 100;
    this.sunLight.shadow.camera.bottom = -100;
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight(0x0ea5e9, 0.45);
    this.fillLight.position.set(80, -60, 80);
    this.scene.add(this.fillLight);
  }

  setOrbitView(): void {
    this.camera = this.perspectiveCamera;
    this.controls.object = this.perspectiveCamera;
    this.controls.enableRotate = true;
    this.controls.maxPolarAngle = Math.PI * 0.45;
    this.perspectiveCamera.fov = 38;
    this.perspectiveCamera.updateProjectionMatrix();
    this.controls.update();
  }

  setTopView(): void {
    this.camera = this.topCamera;
    this.controls.object = this.topCamera;
    this.controls.enableRotate = false;
    this.topCamera.left = -90;
    this.topCamera.right = 90;
    this.topCamera.top = 90;
    this.topCamera.bottom = -90;
    this.topCamera.position.set(GRID_SIZE * CELL_WIDTH / 2, 800, GRID_SIZE * CELL_WIDTH / 2);
    this.topCamera.lookAt(GRID_SIZE * CELL_WIDTH / 2, 0, GRID_SIZE * CELL_WIDTH / 2);
    this.topCamera.updateProjectionMatrix();
    this.controls.target.set(GRID_SIZE * CELL_WIDTH / 2, 0, GRID_SIZE * CELL_WIDTH / 2);
    this.controls.update();
  }

  setSatelliteVisible(visible: boolean): void {
    this.hydrologyState.viewMode = visible ? "surface" : "contour";
    this.applyGISColors();
  }

  setMassVisible(visible: boolean): void {
    this.gridGroup.traverse((child) => {
      if (child instanceof THREE.Mesh && child.name.includes("building")) {
        child.visible = visible;
      }
    });
  }

  setXray(active: boolean): void {
    this.hydrologyState.viewMode = active ? "xray" : "surface";
    this.applyGISColors();
  }

  setShadow(active: boolean): void {
    this.renderer.shadowMap.enabled = active;
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = active;
        obj.receiveShadow = active;
      }
    });
  }

  setTargetOffset(x: number, z: number): void {
    // Simply shift the dynamic overlay roots
    this.gridGroup.position.set(x, 0, z);
    this.waterGroup.position.set(x, 0, z);
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }

  // ==========================================
  // Grid Data Initialization (Gangnam Centroid Defaults)
  // ==========================================
  private initGridData() {
    this.hydrologyState.grid = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      this.hydrologyState.grid[x] = [];
      for (let z = 0; z < GRID_SIZE; z++) {
        let type: "grass" | "road" | "building" = "grass";
        let elevX = x < 11.5 ? (11.5 - x) * 0.35 : (x - 11.5) * 0.3;
        let elevZ = z < 11.5 ? (11.5 - z) * 0.22 : (z - 11.5) * 0.15;
        let elevation = 0.5 + Math.max(elevX, elevZ);

        if (x === 11 || x === 12 || z === 11 || z === 12) {
          type = "road";
        } else {
          elevation += Math.sin(x * 1.2) * Math.cos(z * 1.2) * 0.15;
        }

        this.hydrologyState.grid[x][z] = {
          x, z,
          type,
          elevation: parseFloat(elevation.toFixed(2)),
          buildingHeight: 0,
          isTarget: false,
          isLandmark: false,
          name: "",
          hasSewer: false,
          hasPipe: false,
          hasOutfall: false,
          isSubwayExit: null,
          water: 0.0,
          pipeWater: 0.0
        };
      }
    }

    // Set Default Gangnam Landmarks Procedurally
    const exits = [
      { id: 1, x: 13, z: 14, label: "1번 출구" },
      { id: 2, x: 15, z: 13, label: "2번 출구" },
      { id: 3, x: 15, z: 10, label: "3번 출구" },
      { id: 4, x: 13, z: 9,  label: "4번 출구" },
      { id: 5, x: 10, z: 9,  label: "5번 출구" },
      { id: 6, x: 8,  z: 10, label: "6번 출구" },
      { id: 7, x: 8,  z: 13, label: "7번 출구" },
      { id: 8, x: 10, z: 14, label: "8번 출구" }
    ];
    exits.forEach(ex => {
      const cell = this.hydrologyState.grid[ex.x][ex.z];
      cell.type = "grass";
      cell.isSubwayExit = ex.id;
      cell.name = `강남역 지하철 출입구 (${ex.label})`;
    });

    // GT Tower
    const gt = this.hydrologyState.grid[9][8];
    gt.type = "building";
    gt.isTarget = true;
    gt.isLandmark = true;
    gt.buildingHeight = 52;
    gt.name = "GT 타워 (서초동 1317-23)";

    // Samsung Town
    const ssB = this.hydrologyState.grid[9][15];
    ssB.type = "building";
    ssB.isLandmark = true;
    ssB.buildingHeight = 55;
    ssB.name = "삼성타운 B동 (물산)";

    const ssC = this.hydrologyState.grid[9][16];
    ssC.type = "building";
    ssC.isLandmark = true;
    ssC.buildingHeight = 48;
    ssC.name = "삼성타운 C동 (생명)";

    // Meritz Tower
    const meritz = this.hydrologyState.grid[14][13];
    meritz.type = "building";
    meritz.isLandmark = true;
    meritz.buildingHeight = 50;
    meritz.name = "메리츠 타워 (역삼동 825-2)";

    // Standard highrises context
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const cell = this.hydrologyState.grid[x][z];
        if (cell.type === "grass" && !cell.isSubwayExit && !cell.isLandmark) {
          if ((x % 3 === 0 && z % 3 === 0 && x !== 12 && z !== 12) || (x === 3 && z === 15) || (x === 18 && z === 5)) {
            cell.type = "building";
            cell.buildingHeight = 15 + Math.floor(Math.sin(x * 1.5 + z) * 18);
            cell.name = "일반 오피스 빌딩";
          }
        }
      }
    }

    // Sewer Pipe networks along roads
    for (let i = 0; i < GRID_SIZE; i++) {
      this.hydrologyState.grid[11][i].hasPipe = true;
      this.hydrologyState.grid[12][i].hasPipe = true;
      this.hydrologyState.grid[i][11].hasPipe = true;
      this.hydrologyState.grid[i][12].hasPipe = true;
    }

    // Inlets/Sewers
    const drains = [
      {x:11, z:11}, {x:11, z:12}, {x:12, z:11}, {x:12, z:12},
      {x:11, z:8},  {x:12, z:8},  {x:11, z:15}, {x:12, z:15}
    ];
    drains.forEach(p => {
      this.hydrologyState.grid[p.x][p.z].hasSewer = true;
    });

    // Outfall South edge
    this.hydrologyState.grid[11][23].hasOutfall = true;
  }

  // ==========================================
  // Dynamic Geocoding Address Loader
  // ==========================================
  async loadProject(twin: TwinProject): Promise<void> {
    this.twin = twin;
    this.log("ℹ️ 새 디지털 트윈 로드 중...", "info");
    
    // 1. Dry up and clean grid
    this.dryUpGrid();
    this.updateApiStatus("geocode", "yellow");
    this.updateApiStatus("dem", "yellow");
    this.updateApiStatus("osm", "yellow");
    this.updateApiStatus("tile", "yellow");

    const centerLat = twin.center.lat;
    const centerLon = twin.center.lon;
    
    // GPS projecting parameters
    const meterPerDegLat = 111320;
    const meterPerDegLon = 111320 * Math.cos(centerLat * Math.PI / 180);
    const halfWidth = (GRID_SIZE * CELL_WIDTH) / 2;

    this.log(`📍 위치 설정: ${twin.addresses.building_name_candidate || twin.addresses.parcel_address} (${centerLat.toFixed(5)}, ${centerLon.toFixed(5)})`, "success");
    this.updateApiStatus("geocode", "green");

    // 2. Fetch Elevations via Open-Meteo DEM API
    let elevations: number[] = [];
    try {
      const coords: { lat: number; lon: number }[] = [];
      for (let x = 0; x < GRID_SIZE; x++) {
        for (let z = 0; z < GRID_SIZE; z++) {
          const localX = x * CELL_WIDTH + CELL_WIDTH / 2;
          const localZ = z * CELL_WIDTH + CELL_WIDTH / 2;
          const cLon = centerLon + (localX - halfWidth) / meterPerDegLon;
          const cLat = centerLat - (localZ - halfWidth) / meterPerDegLat;
          coords.push({ lat: cLat, lon: cLon });
        }
      }

      // Sequential batches to avoid 429 rate limit and 400 Bad Request (URL too long)
      const batchSize = 40;
      for (let i = 0; i < coords.length; i += batchSize) {
        const batch = coords.slice(i, i + batchSize);
        const lats = batch.map(c => c.lat.toFixed(6)).join(",");
        const lons = batch.map(c => c.lon.toFixed(6)).join(",");
        const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("DEM API response error");
        const data = await res.json();
        elevations = elevations.concat(data.elevation as number[]);
        
        // 80ms throttle to respect API rate limits
        if (i + batchSize < coords.length) {
          await new Promise(resolve => setTimeout(resolve, 80));
        }
      }
      this.updateApiStatus("dem", "green");
      this.log("⛰️ DEM 지형 고도 동기화 완료.", "success");
    } catch (e) {
      this.log("⚠️ 고도 API 호출 실패. 절차적 저지대 분지를 생성합니다.", "warn");
      this.updateApiStatus("dem", "red");
      // procedural elevations
      for (let x = 0; x < GRID_SIZE; x++) {
        for (let z = 0; z < GRID_SIZE; z++) {
          let elevX = x < 11.5 ? (11.5 - x) * 0.35 : (x - 11.5) * 0.3;
          let elevZ = z < 11.5 ? (11.5 - z) * 0.22 : (z - 11.5) * 0.15;
          elevations.push(0.5 + Math.max(elevX, elevZ));
        }
      }
    }

    // Set Elevations baseline
    let minElev = Math.min(...elevations);
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const cell = this.hydrologyState.grid[x][z];
        cell.elevation = parseFloat((elevations[z * GRID_SIZE + x] - minElev + 0.5).toFixed(2));
        cell.type = "grass";
        cell.buildingHeight = 0;
        cell.isTarget = false;
        cell.isLandmark = false;
        cell.name = "";
        cell.hasSewer = false;
        cell.hasPipe = false;
        cell.hasOutfall = false;
        cell.isSubwayExit = null;
        cell.water = 0;
        cell.pipeWater = 0;
      }
    }

    // 3. Ingest WFS / OSM Buildings & Roads from twin
    let subwayCount = 0;

    // Building features ingestion
    twin.buildings.forEach((building, idx) => {
      // Find overlap grid cells
      const bHeight = building.height_m || 20;
      const points = building.footprint;
      if (points.length < 3) return;

      // Simple bounding box checks mapping coordinates
      let xs = points.map(p => p.x);
      let zs = points.map(p => p.z);
      let minX = Math.min(...xs);
      let maxX = Math.max(...xs);
      let minZ = Math.min(...zs);
      let maxZ = Math.max(...zs);

      // Translate local meters (relative to center) to 144m board coordinate
      // In Vite MVP: localPoints are relative to anchor point
      for (let x = 0; x < GRID_SIZE; x++) {
        for (let z = 0; z < GRID_SIZE; z++) {
          const wX = (x - GRID_SIZE/2) * CELL_WIDTH;
          const wZ = (z - GRID_SIZE/2) * CELL_WIDTH;
          if (wX >= minX && wX <= maxX && wZ >= minZ && wZ <= maxZ) {
            const cell = this.hydrologyState.grid[x][z];
            cell.type = "building";
            cell.buildingHeight = bHeight;
            cell.name = building.name || "인근 건물";
            cell.isTarget = building.role === "target";
          }
        }
      }
    });

    // Highway roads ingestion
    twin.roads.forEach(road => {
      road.centerline.forEach((pt, idx) => {
        // Map roads based on centerline coordinates
        const xIdx = Math.floor((pt.x + halfWidth) / CELL_WIDTH);
        const zIdx = Math.floor((pt.z + halfWidth) / CELL_WIDTH);
        if (xIdx >= 0 && xIdx < GRID_SIZE && zIdx >= 0 && zIdx < GRID_SIZE) {
          const cell = this.hydrologyState.grid[xIdx][zIdx];
          if (cell.type !== "building") {
            cell.type = "road";
            cell.name = road.name || "도로";
          }
        }
      });
    });

    // Make sure we have pipes and sewers on roads
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const cell = this.hydrologyState.grid[x][z];
        if (cell.type === "road") {
          cell.hasPipe = true;
          if ((x + z) % 4 === 0) {
            cell.hasSewer = true;
          }
        }
      }
    }

    // Place at least two subway entrances near the center
    let placed = 0;
    for (let x = 3; x < GRID_SIZE - 3 && placed < 2; x++) {
      for (let z = 3; z < GRID_SIZE - 3 && placed < 2; z++) {
        if (this.hydrologyState.grid[x][z].type === "road" && this.hydrologyState.grid[x-1][z].type === "grass") {
          const cell = this.hydrologyState.grid[x-1][z];
          cell.isSubwayExit = 999 + placed;
          cell.name = `지하철 출입구 (${placed + 1}번)`;
          subwayCount++;
          placed++;
        }
      }
    }

    // Outfall lowest boundary pipe cell
    let outfallCell = this.hydrologyState.grid[11][GRID_SIZE-1];
    outfallCell.hasOutfall = true;
    outfallCell.hasPipe = true;

    this.updateApiStatus("osm", "green");
    this.log("🏢 OSM 건물 및 도로망 구조화 입사 완료.", "success");

    // 4. Update the 3D meshes terrain
    if (this.terrainGeo) {
      const pos = this.terrainGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const gx = i % GRID_SIZE;
        const gz = Math.floor(i / GRID_SIZE);
        pos.setZ(i, this.hydrologyState.grid[gx][gz].elevation);
      }
      pos.needsUpdate = true;
      this.terrainGeo.computeVertexNormals();
    }

    // Rebuild imagery
    this.createTerrainTexture();
    if (this.terrainMesh && this.terrainTexture) {
      const mat = this.terrainMesh.material as THREE.MeshStandardMaterial;
      mat.map = this.terrainTexture;
      mat.needsUpdate = true;
    }

    // Rebuild assets
    this.buildGridMeshes();

    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        if (this.hydrologyState.grid[x][z].hasPipe) {
          this.rebuildPipeMesh(x, z);
        }
      }
    }

    this.applyGISColors();
    this.log("✅ 3D 수문 지형 모델 구축 동기화 완료!", "success");
    
    // Clear warnings
    if (this.options.callbacks) {
      this.options.callbacks.onCellInspect(null);
    }
  }

  // ==========================================
  // Three.js Continuous DEM Terrain Modeling
  // ==========================================
  private buildContinuousTerrain() {
    const width = GRID_SIZE * CELL_WIDTH;
    const segments = GRID_SIZE - 1;
    this.terrainGeo = new THREE.PlaneGeometry(width, width, segments, segments);

    const pos = this.terrainGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const gx = i % GRID_SIZE;
      const gz = Math.floor(i / GRID_SIZE);
      pos.setZ(i, this.hydrologyState.grid[gx][gz].elevation);
    }
    this.terrainGeo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      map: this.terrainTexture,
      roughness: 0.85,
      metalness: 0.05
    });

    this.terrainMesh = new THREE.Mesh(this.terrainGeo, mat);
    this.terrainMesh.rotation.x = -Math.PI / 2;
    this.terrainMesh.position.set(width / 2, 0, width / 2);
    this.terrainMesh.receiveShadow = true;
    this.groundRoot.add(this.terrainMesh);
  }

  private updateContinuousTerrainVertex(x: number, z: number) {
    if (!this.terrainMesh || !this.terrainGeo) return;
    const pos = this.terrainGeo.attributes.position;
    const index = z * GRID_SIZE + x;
    pos.setZ(index, this.hydrologyState.grid[x][z].elevation);
    pos.needsUpdate = true;
    this.terrainGeo.computeVertexNormals();
  }

  private createTerrainTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    this.terrainTexture = new THREE.CanvasTexture(canvas);
    this.terrainTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    // Fallback vector drawing
    this.drawTerrainTextureWithTiles(ctx, canvas);

    // Dynamic tile loading
    this.loadSatelliteTiles(canvas, ctx);
  }

  private drawGridLines(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const spacing = width / GRID_SIZE;
    ctx.strokeStyle = "rgba(94, 234, 212, 0.25)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= GRID_SIZE; i++) {
      ctx.beginPath(); ctx.moveTo(i * spacing, 0); ctx.lineTo(i * spacing, height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * spacing); ctx.lineTo(width, i * spacing); ctx.stroke();
    }
  }

  private drawTerrainTextureWithTiles(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const width = canvas.width;
    const height = canvas.height;
    const spacing = width / GRID_SIZE;

    // procedural fallback
    ctx.fillStyle = "#142216";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#0f1a11";
    for (let i = 0; i < 400; i++) {
      let rx = Math.random() * width;
      let ry = Math.random() * height;
      ctx.fillRect(rx, ry, 6, 6);
    }

    ctx.fillStyle = "#1e222b";
    ctx.fillRect(10 * spacing, 0, 4 * spacing, height);
    ctx.fillRect(0, 10 * spacing, width, 4 * spacing);

    this.drawGridLines(ctx, width, height);
  }

  private loadSatelliteTiles(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    if (this.satelliteTilesLoading) return;
    this.satelliteTilesLoading = true;

    // Load ESRI world imagery center
    const lat = this.twin.center.lat;
    const lon = this.twin.center.lon;
    
    const tileZoom = 18;
    const centerTx = Math.floor((lon + 180) / 360 * Math.pow(2, tileZoom));
    const rad = lat * Math.PI / 180;
    const centerTy = Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, tileZoom));

    const totalTiles = 9; // 3x3 tiles
    let loaded = 0;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const tx = centerTx + dx;
        const ty = centerTy + dy;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          loaded++;
          
          const w = canvas.width / 3;
          const h = canvas.height / 3;
          
          // Calculate fractional tile offset to align coordinates to canvas center
          const fx = (lon + 180) / 360 * Math.pow(2, tileZoom);
          const rad = lat * Math.PI / 180;
          const fy = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, tileZoom);
          
          const shiftX = w * (0.5 - (fx - centerTx));
          const shiftY = h * (0.5 - (fy - centerTy));
          
          const px = (dx + 1) * w + shiftX;
          const py = (dy + 1) * h + shiftY;
          ctx.drawImage(img, px, py, w, h);
          
          if (loaded === totalTiles) {
            this.drawGridLines(ctx, canvas.width, canvas.height);
            if (this.terrainTexture) this.terrainTexture.needsUpdate = true;
            this.updateApiStatus("tile", "green");
            this.log("🟢 위성 지도 타일 및 격자망 실시간 투사 완료.", "success");
          } else {
            if (this.terrainTexture) this.terrainTexture.needsUpdate = true;
          }
        };
        img.onerror = () => {
          loaded++;
          if (loaded === totalTiles) {
            this.drawGridLines(ctx, canvas.width, canvas.height);
            if (this.terrainTexture) this.terrainTexture.needsUpdate = true;
            this.updateApiStatus("tile", "yellow");
            this.log("⚠️ 일부 위성 사진 로드 실패. 대체 격자망을 투사합니다.", "warn");
          }
        };
        img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tileZoom}/${ty}/${tx}`;
      }
    }
  }

  // ==========================================
  // 3D Grid Meshing (Massings & Subsurface)
  // ==========================================
  private buildGridMeshes() {
    while (this.gridGroup.children.length > 0) this.gridGroup.remove(this.gridGroup.children[0]);
    while (this.waterGroup.children.length > 0) this.waterGroup.remove(this.waterGroup.children[0]);

    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const cell = this.hydrologyState.grid[x][z];
        const group = new THREE.Group();

        const gX = x * CELL_WIDTH + CELL_WIDTH / 2;
        const gZ = z * CELL_WIDTH + CELL_WIDTH / 2;
        group.position.set(gX, 0, gZ);
        group.userData = { cellX: x, cellZ: z };

        cell.group = group;
        this.gridGroup.add(group);

        this.updateCellVisual(x, z);

        // Water surface mesh
        const waterMesh = new THREE.Mesh(new THREE.BoxGeometry(CELL_WIDTH - 0.05, 1, CELL_WIDTH - 0.05), this.mats.water);
        waterMesh.position.set(gX, cell.elevation, gZ);
        waterMesh.visible = false;
        this.waterGroup.add(waterMesh);
        cell.waterMesh = waterMesh;
      }
    }
  }

  private updateCellVisual(x: number, z: number) {
    const cell = this.hydrologyState.grid[x][z];
    const group = cell.group;
    if (!group) return;

    while (group.children.length > 0) {
      const mesh = group.children[0] as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      group.remove(mesh);
    }

    const gY = cell.elevation;

    // Building Mesh
    if (cell.type === "building") {
      const buildH = cell.buildingHeight || 15;
      const buildMat = this.getFacadeMaterial(cell.isTarget ? "gt" : "office", buildH);
      
      const bMesh = new THREE.Mesh(new THREE.BoxGeometry(CELL_WIDTH * 0.85, buildH, CELL_WIDTH * 0.85), buildMat);
      bMesh.position.y = gY + buildH / 2;
      bMesh.castShadow = true;
      bMesh.receiveShadow = true;
      bMesh.name = "building";
      group.add(bMesh);
      cell.buildingMesh = bMesh;

      if (cell.isTarget) {
        // Red flashing alert signal beacon
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
        beacon.position.set(0, gY + buildH + 0.15, 0);
        beacon.name = "beacon";
        group.add(beacon);
      }
    }

    // Subway Exit Canopy Mesh
    if (cell.isSubwayExit) {
      const subGroup = new THREE.Group();
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(CELL_WIDTH * 0.6, 1.2, CELL_WIDTH * 0.4), this.mats.glassCyan);
      canopy.position.set(0, gY + 0.6, 0);
      subGroup.add(canopy);

      const frameL = new THREE.Mesh(new THREE.BoxGeometry(CELL_WIDTH * 0.62, 1.25, 0.05), this.mats.subwayExitMetal);
      frameL.position.set(0, gY + 0.6, -CELL_WIDTH * 0.2);
      subGroup.add(frameL);

      const frameR = new THREE.Mesh(new THREE.BoxGeometry(CELL_WIDTH * 0.62, 1.25, 0.05), this.mats.subwayExitMetal);
      frameR.position.set(0, gY + 0.6, CELL_WIDTH * 0.2);
      subGroup.add(frameR);

      // Pole sign
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.5, 4), this.mats.subwayExitMetal);
      pole.position.set(0.5, gY + 1.25, 0.5);
      subGroup.add(pole);

      group.add(subGroup);
      cell.subwayMesh = subGroup;
    }

    // Sewer Grate
    if (cell.hasSewer) {
      const sMesh = new THREE.Mesh(new THREE.BoxGeometry(CELL_WIDTH * 0.5, 0.06, CELL_WIDTH * 0.5), this.mats.sewer);
      sMesh.position.y = gY + 0.03;
      group.add(sMesh);
      cell.sewerMesh = sMesh;
    }

    // Sidewalk Foliage Details
    if (cell.type === "grass" && !cell.isSubwayExit && !cell.isLandmark && cell.buildingHeight === 0) {
      if ((x % 3 === 1 && z % 3 === 1) || (x % 3 === 2 && z % 3 === 2)) {
        // Trunk
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.2, 5), new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.95 }));
        trunk.position.y = gY + 0.6;
        trunk.castShadow = true;
        group.add(trunk);
        // Foliage
        const fMesh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 5), new THREE.MeshStandardMaterial({ color: 0x155e27, roughness: 0.8 }));
        fMesh.position.y = gY + 1.35;
        fMesh.castShadow = true;
        group.add(fMesh);
      }
    }

    // Subsurface Outfall Tunnel
    if (cell.hasOutfall) {
      const outfallGroup = new THREE.Group();
      outfallGroup.position.y = gY - PIPE_DEPTH;
      const portal = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 3, 12), this.mats.outfall);
      portal.rotation.x = Math.PI / 2;
      outfallGroup.add(portal);

      const led = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffaa00 }));
      led.position.set(0, 1.2, 1.1);
      outfallGroup.add(led);

      group.add(outfallGroup);
      cell.outfallMesh = outfallGroup;
    }

    // Pipe Visuals
    if (cell.hasPipe) {
      this.rebuildPipeMesh(x, z);
    }
  }

  private rebuildPipeMesh(x: number, z: number) {
    const cell = this.hydrologyState.grid[x][z];
    const group = cell.group;
    if (!group) return;

    if (cell.pipeMesh) {
      group.remove(cell.pipeMesh);
      cell.pipeMesh = null;
    }

    const pGroup = new THREE.Group();
    pGroup.position.y = cell.elevation - PIPE_DEPTH;

    // Hub sphere
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 12), this.mats.pipe);
    pGroup.add(hub);

    const dirs = [
      { dx: 1, dz: 0, rotY: Math.PI / 2, lengthX: CELL_WIDTH },
      { dx: -1, dz: 0, rotY: -Math.PI / 2, lengthX: CELL_WIDTH },
      { dx: 0, dz: 1, rotY: 0, lengthX: CELL_WIDTH },
      { dx: 0, dz: -1, rotY: Math.PI, lengthX: CELL_WIDTH }
    ];

    dirs.forEach(({ dx, dz, rotY, lengthX }) => {
      const nx = x + dx;
      const nz = z + dz;
      if (nx >= 0 && nx < GRID_SIZE && nz >= 0 && nz < GRID_SIZE) {
        const neighbor = this.hydrologyState.grid[nx][nz];
        if (neighbor.hasPipe || neighbor.hasOutfall) {
          const deltaElev = neighbor.elevation - cell.elevation;
          const tubeLength = Math.hypot(lengthX, deltaElev);

          const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, tubeLength / 2, 8), this.mats.pipe);
          tube.position.set(dx * lengthX / 4, deltaElev / 4, dz * lengthX / 4);
          tube.rotation.x = Math.PI / 2;
          tube.rotation.y = rotY;
          tube.rotation.z = Math.atan2(deltaElev, lengthX);
          pGroup.add(tube);

          const wTube = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, tubeLength / 2, 8), this.mats.pipeWater);
          wTube.position.copy(tube.position);
          wTube.rotation.copy(tube.rotation);
          wTube.name = `flow_${dx}_${dz}`;
          wTube.visible = false;
          pGroup.add(wTube);
        }
      }
    });

    group.add(pGroup);
    cell.pipeMesh = pGroup;
  }

  private updateNeighborPipes(x: number, z: number) {
    const dirs = [[1,0], [-1,0], [0,1], [0,-1]];
    dirs.forEach(([dx, dz]) => {
      const nx = x + dx;
      const nz = z + dz;
      if (nx >= 0 && nx < GRID_SIZE && nz >= 0 && nz < GRID_SIZE) {
        if (this.hydrologyState.grid[nx][nz].hasPipe) {
          this.rebuildPipeMesh(nx, nz);
        }
      }
    });
  }

  private getFacadeMaterial(type: string, buildH: number): THREE.Material {
    const cacheKey = `${type}_${buildH}`;
    if (this.materialCache[cacheKey]) return this.materialCache[cacheKey];

    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) return this.mats.subwayExitMetal;

    if (type === "gt") {
      ctx.fillStyle = "#051829";
      ctx.fillRect(0, 0, 128, 256);
      ctx.strokeStyle = "#06b6d4";
      ctx.lineWidth = 2.0;
      for (let x = 4; x < 128; x += 16) {
        ctx.beginPath();
        for (let y = 0; y < 256; y++) {
          let wave = Math.sin(y * 0.04) * 6;
          if (y === 0) ctx.moveTo(x + wave, y);
          else ctx.lineTo(x + wave, y);
        }
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = "#334155";
      ctx.fillRect(0, 0, 128, 256);
      ctx.fillStyle = "#1e293b";
      for (let x = 8; x < 128; x += 16) {
        for (let y = 12; y < 256; y += 20) {
          ctx.fillRect(x, y, 10, 12);
        }
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.5, Math.ceil(buildH / 6));

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.2,
      metalness: 0.7,
      emissive: type === "gt" ? 0x06b6d4 : 0x000000,
      emissiveIntensity: 0.1
    });

    this.materialCache[cacheKey] = material;
    return material;
  }

  // ==========================================
  // Rain particles & splash triggers
  // ==========================================
  private initRainSystem() {
    const count = 2000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      positions[i] = Math.random() * (GRID_SIZE * CELL_WIDTH);
      positions[i + 1] = Math.random() * 180 + 20;
      positions[i + 2] = Math.random() * (GRID_SIZE * CELL_WIDTH);
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.rainSystem = new THREE.LineSegments(geometry, this.mats.rain);
    this.rainSystem.visible = false;
    this.scene.add(this.rainSystem);
  }

  private updateRainSystem(dt: number) {
    if (!this.rainSystem) return;

    this.mats.rain.opacity = (this.hydrologyState.rainIntensity / 150) * 0.45;
    if (this.hydrologyState.rainIntensity === 0) {
      this.rainSystem.visible = false;
      return;
    }

    this.rainSystem.visible = true;
    const posArr = this.rainSystem.geometry.attributes.position.array as Float32Array;
    for (let i = 1; i < posArr.length; i += 3) {
      posArr[i] -= (60.0 + this.hydrologyState.rainIntensity * 1.5) * dt;
      posArr[i - 1] += -6.0 * dt; // slant wind direction
      
      if (posArr[i] < 0) {
        const rx = posArr[i - 1];
        const rz = posArr[i + 1];
        this.spawnRipple(rx, rz);

        posArr[i] = Math.random() * 180 + 20;
        posArr[i - 1] = Math.random() * (GRID_SIZE * CELL_WIDTH);
        posArr[i + 1] = Math.random() * (GRID_SIZE * CELL_WIDTH);
      }
    }
    this.rainSystem.geometry.attributes.position.needsUpdate = true;
  }

  private spawnRipple(rx: number, rz: number) {
    const gx = Math.floor(rx / CELL_WIDTH);
    const gz = Math.floor(rz / CELL_WIDTH);
    if (gx < 0 || gx >= GRID_SIZE || gz < 0 || gz >= GRID_SIZE) return;

    const elev = this.hydrologyState.grid[gx][gz].elevation;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.25, 8), this.mats.rain);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(rx, elev + 0.08, rz);
    this.rippleGroup.add(ring);

    ring.userData = {
      scaleSpeed: 3.0,
      maxScale: 2.8,
      opacity: 0.8,
      fadeSpeed: 2.5
    };
  }

  private updateRipples(dt: number) {
    for (let i = this.rippleGroup.children.length - 1; i >= 0; i--) {
      const ring = this.rippleGroup.children[i] as THREE.Mesh;
      const data = ring.userData;
      ring.scale.addScalar(data.scaleSpeed * dt);
      data.opacity -= data.fadeSpeed * dt;
      (ring.material as THREE.LineBasicMaterial).opacity = data.opacity;

      if (data.opacity <= 0 || ring.scale.x >= data.maxScale) {
        ring.geometry.dispose();
        this.rippleGroup.remove(ring);
      }
    }
  }

  private spawnDischargeParticles(x: number, z: number) {
    const cell = this.hydrologyState.grid[x][z];
    const gX = x * CELL_WIDTH + CELL_WIDTH / 2;
    const gZ = z * CELL_WIDTH + CELL_WIDTH / 2;
    const gY = cell.elevation - PIPE_DEPTH;

    for (let i = 0; i < 3; i++) {
      const size = 0.2 + Math.random() * 0.3;
      const p = new THREE.Mesh(new THREE.SphereGeometry(size, 4, 4), this.mats.particleWater);
      p.position.set(gX, gY, gZ);
      p.userData = {
        vx: (Math.random() - 0.5) * 8,
        vy: -1 - Math.random() * 8,
        vz: 7 + Math.random() * 12,
        life: 1.0,
        fadeSpeed: 2.0 + Math.random() * 2.0
      };
      this.outfallParticleGroup.add(p);
    }
  }

  private updateDischargeParticles(dt: number) {
    for (let i = this.outfallParticleGroup.children.length - 1; i >= 0; i--) {
      const p = this.outfallParticleGroup.children[i] as THREE.Mesh;
      const data = p.userData;
      data.vy -= 9.8 * dt;
      p.position.x += data.vx * dt;
      p.position.y += data.vy * dt;
      p.position.z += data.vz * dt;

      data.life -= data.fadeSpeed * dt;
      (p.material as THREE.MeshBasicMaterial).opacity = data.life;

      if (data.life <= 0 || p.position.y < -40) {
        p.geometry.dispose();
        this.outfallParticleGroup.remove(p);
      }
    }
  }

  private spawnSewerBubble(x: number, z: number) {
    const cell = this.hydrologyState.grid[x][z];
    const gX = x * CELL_WIDTH + CELL_WIDTH / 2;
    const gZ = z * CELL_WIDTH + CELL_WIDTH / 2;
    const gY = cell.elevation + 0.08;

    const size = 0.12 + Math.random() * 0.3;
    const p = new THREE.Mesh(new THREE.SphereGeometry(size, 6, 6), this.mats.bubbleWater);
    p.position.set(
      gX + (Math.random() - 0.5) * (CELL_WIDTH * 0.4),
      gY,
      gZ + (Math.random() - 0.5) * (CELL_WIDTH * 0.4)
    );
    p.userData = {
      vy: 1.0 + Math.random() * 3.0,
      vx: (Math.random() - 0.5) * 1.0,
      vz: (Math.random() - 0.5) * 1.0,
      life: 1.0,
      fadeSpeed: 1.5
    };
    this.overflowBubbleGroup.add(p);
  }

  private updateSewerBubbles(dt: number) {
    for (let i = this.overflowBubbleGroup.children.length - 1; i >= 0; i--) {
      const p = this.overflowBubbleGroup.children[i] as THREE.Mesh;
      const data = p.userData;
      p.position.x += data.vx * dt;
      p.position.y += data.vy * dt;
      p.position.z += data.vz * dt;

      p.scale.addScalar(dt * 0.5);
      data.life -= data.fadeSpeed * dt;
      (p.material as THREE.MeshBasicMaterial).opacity = data.life;

      if (data.life <= 0) {
        p.geometry.dispose();
        this.overflowBubbleGroup.remove(p);
      }
    }
  }

  private initFlowStreaksPool() {
    for (let i = 0; i < 150; i++) {
      this.flowStreaks.push(new FlowStreak(this.scene));
    }
  }

  private trySpawnFlowStreak(x: number, z: number, vx: number, vz: number, elev: number) {
    const streak = this.flowStreaks.find(f => f.life <= 0);
    if (streak) {
      streak.spawn(x, z, vx, vz, elev);
    }
  }

  // ==========================================
  // Dual-Layer Hydrology Simulation Core ticking
  // ==========================================
  public updateHydrology(dt: number) {
    this.hydrologyState.elapsedTime += dt;

    // 1. Rain Inflow
    if (this.hydrologyState.rainIntensity > 0) {
      const rainPerSec = (this.hydrologyState.rainIntensity / 1000) / 3600;
      const gain = rainPerSec * dt * 4500; // Warp speed warp factor
      
      for (let x = 0; x < GRID_SIZE; x++) {
        for (let z = 0; z < GRID_SIZE; z++) {
          const cell = this.hydrologyState.grid[x][z];
          if (cell.type === "road") {
            cell.water += gain;
          } else if (cell.type === "grass") {
            const absorption = 0.03 * dt;
            cell.water = Math.max(0, cell.water + gain - absorption);
          }
        }
      }
    }

    // 2. Surface runoff gravity routing
    let surfaceBuffer: number[][] = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      surfaceBuffer[x] = [];
      for (let z = 0; z < GRID_SIZE; z++) {
        surfaceBuffer[x][z] = this.hydrologyState.grid[x][z].water;
      }
    }

    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const runoffRate = 0.38;

    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const cell = this.hydrologyState.grid[x][z];
        if (cell.type === "building" || cell.water <= 0.003) continue;

        const headSelf = cell.elevation + cell.water;
        let downhillTributaries = [];
        let totalHeadDiff = 0;

        for (const [dx, dz] of dirs) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx >= 0 && nx < GRID_SIZE && nz >= 0 && nz < GRID_SIZE) {
            const neighbor = this.hydrologyState.grid[nx][nz];
            if (neighbor.type === "building") continue;

            const headNeigh = neighbor.elevation + neighbor.water;
            if (headSelf > headNeigh) {
              const diff = headSelf - headNeigh;
              downhillTributaries.push({ n: neighbor, diff, dx, dz });
              totalHeadDiff += diff;
            }
          }
        }

        if (downhillTributaries.length > 0) {
          const flowOut = Math.min(cell.water, cell.water * runoffRate * dt);
          downhillTributaries.forEach(({ n, diff, dx, dz }) => {
            const ratio = diff / totalHeadDiff;
            const share = flowOut * ratio;
            surfaceBuffer[x][z] -= share;
            surfaceBuffer[n.x][n.z] += share;

            if (Math.random() < 0.06 && cell.water > 0.05) {
              this.trySpawnFlowStreak(x, z, dx, dz, cell.elevation + cell.water);
            }
          });
        }
      }
    }

    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        this.hydrologyState.grid[x][z].water = Math.max(0, surfaceBuffer[x][z]);
      }
    }

    // 3. Subway Inundation Routing
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const cell = this.hydrologyState.grid[x][z];
        if (cell.isSubwayExit && cell.water > 0.05) {
          const inflowSpeed = 0.55 * dt;
          const drainAmt = Math.min(cell.water - 0.05, inflowSpeed);
          cell.water -= drainAmt;

          const m3volume = drainAmt * (CELL_WIDTH * CELL_WIDTH);
          this.hydrologyState.subwayWater += m3volume;

          if (!this.hydrologyState.subwayWarningTriggered && this.hydrologyState.subwayWater > 15) {
            this.hydrologyState.subwayWarningTriggered = true;
            this.log("🚨 긴급 재난 경보: 강남역 지하철 역사 내부 우수 유출 침수 감지!", "danger");
            this.sound.playWarning();
          }

          if (this.hydrologyState.subwayWater > 50 && Math.random() < 0.015) {
            this.sound.playWarning();
          }
        }
      }
    }

    // 4. Subsurface pipe network logic
    let pipeBuffer: number[][] = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      pipeBuffer[x] = [];
      for (let z = 0; z < GRID_SIZE; z++) {
        pipeBuffer[x][z] = this.hydrologyState.grid[x][z].pipeWater;
      }
    }

    const pipeFlowRate = 0.58;
    let manholeOverflowCount = 0;

    let metricDrainTotal = 0;
    let metricVelocityTotal = 0;
    let metricPressureTotal = 0;
    let metricActivePipes = 0;

    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const cell = this.hydrologyState.grid[x][z];

        if (cell.hasSewer && cell.hasPipe && cell.water > 0.01) {
          const headroom = this.maxPipeCapacity - cell.pipeWater;
          if (headroom > 0) {
            const drain = Math.min(cell.water, Math.min(headroom, 0.55 * dt));
            cell.water -= drain;
            pipeBuffer[x][z] += drain;
            metricDrainTotal += drain;
          }
        }

        if (cell.hasPipe && cell.pipeWater > 0.001) {
          metricActivePipes++;
          metricPressureTotal += (cell.pipeWater / this.maxPipeCapacity);
          const headSelf = (cell.elevation - PIPE_DEPTH) + cell.pipeWater;

          let outTributaries = [];
          let totalHeadDiff = 0;

          for (const [dx, dz] of dirs) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx >= 0 && nx < GRID_SIZE && nz >= 0 && nz < GRID_SIZE) {
              const neighbor = this.hydrologyState.grid[nx][nz];
              if (neighbor.hasPipe || neighbor.hasOutfall) {
                const headNeigh = (neighbor.elevation - PIPE_DEPTH) + neighbor.pipeWater;
                if (headSelf > headNeigh) {
                  const diff = headSelf - headNeigh;
                  outTributaries.push({ n: neighbor, diff });
                  totalHeadDiff += diff;
                }
              }
            }
          }

          if (outTributaries.length > 0) {
            const discharge = Math.min(cell.pipeWater, cell.pipeWater * pipeFlowRate * dt);
            outTributaries.forEach(({ n, diff }) => {
              const share = discharge * (diff / totalHeadDiff);
              pipeBuffer[x][z] -= share;

              if (n.hasOutfall) {
                this.hydrologyState.totalOutflowVolume += share * (CELL_WIDTH * CELL_WIDTH);
                metricVelocityTotal += (share / dt);
                this.spawnDischargeParticles(n.x, n.z);
              } else {
                pipeBuffer[n.x][n.z] += share;
              }
            });
          }
        }
      }
    }

    // Apply backflows
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const cell = this.hydrologyState.grid[x][z];
        let val = Math.max(0, pipeBuffer[x][z]);

        if (val > this.maxPipeCapacity) {
          const excess = val - this.maxPipeCapacity;
          val = this.maxPipeCapacity;
          cell.water += excess;
          manholeOverflowCount++;
          this.spawnSewerBubble(x, z);

          if (Math.random() < 0.008) {
            this.log(`🚨 하수역류: [${x}, ${z}] 지하 배수관 부하 과포화로 하류역출 발생!`, "danger");
            this.sound.playOverflow();
          }
        }
        cell.pipeWater = val;
      }
    }

    this.hydrologyState.overflowCount = manholeOverflowCount;

    // Recalculate stats sums
    let surfaceSum = 0;
    let pipeSum = 0;
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        surfaceSum += this.hydrologyState.grid[x][z].water;
        pipeSum += this.hydrologyState.grid[x][z].pipeWater;
      }
    }
    this.hydrologyState.totalSurfaceWater = surfaceSum * (CELL_WIDTH * CELL_WIDTH);
    this.hydrologyState.totalPipeWater = pipeSum * (CELL_WIDTH * CELL_WIDTH);

    // Callbacks to UI
    if (this.options.callbacks) {
      this.options.callbacks.onStatsUpdate({
        totalSurfaceWater: this.hydrologyState.totalSurfaceWater,
        totalPipeWater: this.hydrologyState.totalPipeWater,
        subwayWater: this.hydrologyState.subwayWater,
        totalOutflowVolume: this.hydrologyState.totalOutflowVolume,
        overflowCount: this.hydrologyState.overflowCount
      });

      const drainPercent = Math.min(100, Math.floor((metricDrainTotal / dt / 1.5) * 100));
      const pressurePercent = Math.min(100, Math.floor((metricPressureTotal / (metricActivePipes || 1)) * 100));
      const speedMS = metricVelocityTotal * 4.5;
      this.options.callbacks.onGaugesUpdate(drainPercent, pressurePercent, speedMS);
    }

    // Weather Effects
    this.updateRainSystem(dt);
    this.tickLightningSystem(dt);

    // Particles & Streaks
    this.flowStreaks.forEach(p => p.update(dt));
    this.updateDischargeParticles(dt);
    this.updateSewerBubbles(dt);
    this.updateRipples(dt);

    // Water surface visualizations
    const time = this.clock.getElapsedTime();
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const cell = this.hydrologyState.grid[x][z];
        const sMesh = cell.waterMesh;
        if (cell.water > 0.01 && sMesh) {
          sMesh.visible = true;
          const wave = Math.sin(time * 2.2 + x * 0.6 + z * 0.6) * 0.02;
          const scaleVal = (cell.water + wave) * 12; // Visual amplification
          sMesh.scale.set(1, Math.max(0.1, scaleVal), 1);
          sMesh.position.y = cell.elevation + scaleVal / 2;
          
          if (cell.water > 0.5) {
            sMesh.material.color.setHex(0x0a417a); // Deep blue
          } else {
            sMesh.material.color.setHex(0x0ea5e9); // Light cyan
          }
        } else if (sMesh) {
          sMesh.visible = false;
        }

        // Subsurface pipes core water scale
        const pMesh = cell.pipeMesh;
        if (pMesh) {
          const ratio = cell.pipeWater / this.maxPipeCapacity;
          pMesh.children.forEach((child: THREE.Object3D) => {
            if (child.name.startsWith("flow_")) {
              if (cell.pipeWater > 0.02) {
                child.visible = true;
                child.scale.set(ratio, 1, ratio);
              } else {
                child.visible = false;
              }
            }
          });
        }
      }
    }
  }

  private tickLightningSystem(dt: number) {
    if (this.hydrologyState.rainIntensity < 80) {
      this.lightningActive = false;
      return;
    }

    this.lightningTimer -= dt;
    if (this.lightningTimer <= 0) {
      this.lightningActive = true;
      this.lightningState = 0.9;
      this.lightningTimer = 6.0 + Math.random() * 12.0;
      this.sound.playThunder();
      this.log("⚡ 뇌우 발생: 강남대로 인근 낙뢰 충격 파장 관측!", "warn");
    }

    if (this.lightningActive) {
      this.lightningState -= dt * 3.5;
      let flashOpacity = this.lightningState;
      if (this.lightningState < 0.4 && this.lightningState > 0.2) {
        flashOpacity = 0.85; // Second strike flicker
      }
      if (this.lightningState <= 0) {
        this.lightningActive = false;
        flashOpacity = 0;
      }

      // Briefly boost lights
      if (this.ambientLight) {
        this.ambientLight.intensity = 0.35 + flashOpacity * 2.8;
      }
    }
  }

  // ==========================================
  // Editor Interactive Tools Actions
  // ==========================================
  executeTool(x: number, z: number) {
    const cell = this.hydrologyState.grid[x][z];
    const tool = this.hydrologyState.selectedTool;

    if (tool === "inspect") {
      this.hydrologyState.selectedCell = { x, z };
      this.sound.playClick();
      if (this.options.callbacks) {
        this.options.callbacks.onCellInspect(cell);
      }
      return;
    }

    this.sound.playDraw();

    if (tool === "road") {
      cell.type = "road";
      cell.isLandmark = false;
      cell.isTarget = false;
      cell.name = "";
      cell.buildingHeight = 0;
      this.updateCellVisual(x, z);
      this.log(`🛣️ [${x}, ${z}] 지상 도로 포장 완료.`, "info");
    } 
    
    else if (tool === "building") {
      cell.type = "building";
      cell.isLandmark = false;
      cell.isTarget = false;
      cell.name = "신규 건축물";
      cell.hasSewer = false;
      cell.buildingHeight = 15 + Math.floor(Math.random() * 20);
      this.updateCellVisual(x, z);
      this.log(`🏢 [${x}, ${z}] 오피스 빌딩 신축 배치 완료.`, "info");
    } 
    
    else if (tool === "sewer") {
      if (cell.type !== "road") {
        this.sound.playWarning();
        this.log("❌ 배치 오류: 빗물받이는 아스팔트 도로 위에만 설치할 수 있습니다.", "warn");
        return;
      }
      cell.hasSewer = true;
      this.updateCellVisual(x, z);
      this.log(`🕳️ [${x}, ${z}] 지상 우수유입 빗물받이 설치 완료.`, "success");
    } 
    
    else if (tool === "pipe") {
      cell.hasPipe = true;
      this.updateCellVisual(x, z);
      this.updateNeighborPipes(x, z);
      this.log(`⚙️ [${x}, ${z}] 지하 관거 연결관 가설 완료.`, "success");
    } 
    
    else if (tool === "outfall") {
      cell.hasOutfall = true;
      cell.hasPipe = true;
      this.updateCellVisual(x, z);
      this.updateNeighborPipes(x, z);
      this.log(`🌊 [${x}, ${z}] 방류 토구 종단 터미널 가설 완료.`, "success");
    } 
    
    else if (tool === "raise") {
      cell.elevation = parseFloat((cell.elevation + 0.4).toFixed(1));
      this.updateCellVisual(x, z);
      this.updateNeighborPipes(x, z);
      this.updateContinuousTerrainVertex(x, z);
      this.applyGISColors();
      if (cell.waterMesh) cell.waterMesh.position.y = cell.elevation;
      this.log(`🔺 [${x}, ${z}] 표고 고도 보정 (+0.4m). 현재 고도: ${cell.elevation}m`, "info");
    } 
    
    else if (tool === "lower") {
      cell.elevation = parseFloat(Math.max(0.5, cell.elevation - 0.4).toFixed(1));
      this.updateCellVisual(x, z);
      this.updateNeighborPipes(x, z);
      this.updateContinuousTerrainVertex(x, z);
      this.applyGISColors();
      if (cell.waterMesh) cell.waterMesh.position.y = cell.elevation;
      this.log(`🔻 [${x}, ${z}] 표고 고도 보정 (-0.4m). 현재 고도: ${cell.elevation}m`, "info");
    } 
    
    else if (tool === "eraser") {
      this.sound.playDelete();
      cell.type = "grass";
      cell.isLandmark = false;
      cell.isTarget = false;
      cell.name = "";
      cell.hasSewer = false;
      cell.hasPipe = false;
      cell.hasOutfall = false;
      cell.water = 0;
      cell.pipeWater = 0;
      this.updateCellVisual(x, z);
      this.updateNeighborPipes(x, z);
      this.log(`🧹 [${x}, ${z}] 격자 구조물 소거 완료.`, "warn");
    }

    if (this.options.callbacks) {
      this.options.callbacks.onCellInspect(cell);
    }
  }

  dryUpGrid() {
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const cell = this.hydrologyState.grid[x][z];
        cell.water = 0;
        cell.pipeWater = 0;
      }
    }
    this.hydrologyState.totalSurfaceWater = 0;
    this.hydrologyState.totalPipeWater = 0;
    this.hydrologyState.subwayWater = 0;
    this.hydrologyState.totalOutflowVolume = 0;
    this.hydrologyState.overflowCount = 0;
    this.hydrologyState.subwayWarningTriggered = false;

    this.sound.playSuction();
    this.updateWaterVisuals();
    this.log("🧹 도시 지표 건조(Dry Grid) 완료. 잔류 유량이 전부 제거되었습니다.", "success");
  }

  private updateWaterVisuals() {
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const cell = this.hydrologyState.grid[x][z];
        if (cell.waterMesh) cell.waterMesh.visible = false;
      }
    }
  }

  // ==========================================
  // Scenarios presets
  // ==========================================
  loadScenario(scenName: "normal" | "2022" | "expand" | "tunnel") {
    this.hydrologyState.scenario = scenName;
    this.sound.playClick();

    if (scenName === "normal") {
      this.hydrologyState.rainIntensity = 0;
      this.maxPipeCapacity = 2.0;
      this.log("🌦️ 기상 모니터링: 맑음 모드로 전환되었습니다.", "info");
    } 
    
    else if (scenName === "2022") {
      this.hydrologyState.rainIntensity = 140;
      this.maxPipeCapacity = 2.0;
      this.log("🚨 2022년 강남역 대폭우 침수 시나리오 가동 시작.", "danger");
    } 
    
    else if (scenName === "expand") {
      this.hydrologyState.rainIntensity = 100;
      this.maxPipeCapacity = 4.0; // Capacity doubled
      this.log("🔧 행정 개선: 지하 하수관거 관경 용량이 2배(4.0)로 확장 조치되었습니다.", "success");
    } 
    
    else if (scenName === "tunnel") {
      this.hydrologyState.rainIntensity = 140;
      this.maxPipeCapacity = 2.0;
      // Procedural tunnel installation along central road
      for (let z = 0; z < GRID_SIZE; z++) {
        this.hydrologyState.grid[11][z].hasPipe = true;
        this.rebuildPipeMesh(11, z);
      }
      this.log("⚙️ 방재 터널 가설: 대심도 배수터널이 완공 가동됩니다. 유수가 하단 방류구로 강제 배출됩니다.", "success");
    }
  }

  // ==========================================
  // UI GIS Views colors projection
  // ==========================================
  applyGISColors() {
    if (!this.terrainMesh || !this.terrainGeo) return;
    const pos = this.terrainGeo.attributes.position;
    const mode = this.hydrologyState.viewMode;

    const mat = this.terrainMesh.material as THREE.MeshStandardMaterial;
    if (mode === "surface") {
      mat.map = this.terrainTexture || null;
      mat.vertexColors = false;
      mat.transparent = false;
      mat.opacity = 1.0;
      mat.needsUpdate = true;
      this.setBuildingsTransparency(false, 1.0);
    } 
    
    else if (mode === "contour") {
      mat.map = null;
      mat.vertexColors = true;
      mat.transparent = false;
      mat.opacity = 1.0;
      mat.needsUpdate = true;

      const colors = [];
      for (let i = 0; i < pos.count; i++) {
        const gx = i % GRID_SIZE;
        const gz = Math.floor(i / GRID_SIZE);
        const elev = this.hydrologyState.grid[gx][gz].elevation;
        
        let r = 0, g = 0, b = 0;
        if (elev < 1.3) {
          let t = Math.max(0, (elev - 0.5) / 0.8);
          r = 0.0; g = 0.65 + t * 0.3; b = 0.85 - t * 0.75;
        } else if (elev < 2.6) {
          let t = (elev - 1.3) / 1.3;
          r = t * 0.85; g = 0.95 - t * 0.15; b = 0.1;
        } else {
          let t = Math.min(1.0, (elev - 2.6) / 2.0);
          r = 0.85 + t * 0.15; g = 0.80 - t * 0.75; b = 0.0;
        }

        // contour stripes overlay
        if (Math.abs(elev % 0.4) < 0.04) {
          r *= 0.25; g *= 0.25; b *= 0.25;
        }
        colors.push(r, g, b);
      }
      this.terrainGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      this.terrainGeo.attributes.color.needsUpdate = true;
      this.setBuildingsTransparency(false, 0.9);
    } 
    
    else if (mode === "risk") {
      mat.map = null;
      mat.vertexColors = true;
      mat.transparent = false;
      mat.opacity = 1.0;
      mat.needsUpdate = true;

      const colors = [];
      for (let i = 0; i < pos.count; i++) {
        const gx = i % GRID_SIZE;
        const gz = Math.floor(i / GRID_SIZE);
        const cell = this.hydrologyState.grid[gx][gz];
        
        let left = gx > 0 ? this.hydrologyState.grid[gx-1][gz].elevation : cell.elevation;
        let right = gx < GRID_SIZE-1 ? this.hydrologyState.grid[gx+1][gz].elevation : cell.elevation;
        let top = gz > 0 ? this.hydrologyState.grid[gx][gz-1].elevation : cell.elevation;
        let bottom = gz < GRID_SIZE-1 ? this.hydrologyState.grid[gx][gz+1].elevation : cell.elevation;
        
        let slope = Math.max(Math.abs(left - right), Math.abs(top - bottom));
        let flatness = 1.0 - Math.min(1.0, slope * 2.2);
        let elevationInverted = 1.0 - Math.min(1.0, (cell.elevation - 0.5) / 3.0);
        
        let riskVal = flatness * elevationInverted;
        if (cell.type === "road") riskVal *= 1.15;
        riskVal = Math.min(1.0, Math.max(0.0, riskVal));

        let r = riskVal;
        let g = 0.7 - riskVal * 0.6;
        let b = 0.8 - riskVal * 0.8;
        colors.push(r, g, b);
      }
      this.terrainGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      this.terrainGeo.attributes.color.needsUpdate = true;
      this.setBuildingsTransparency(false, 0.85);
    } 
    
    else if (mode === "xray") {
      mat.map = this.terrainTexture || null;
      mat.vertexColors = false;
      mat.transparent = true;
      mat.opacity = 0.12;
      mat.needsUpdate = true;
      this.setBuildingsTransparency(true, 0.06);
    }
  }

  private setBuildingsTransparency(transparent: boolean, opacity: number) {
    Object.values(this.materialCache).forEach(mat => {
      mat.transparent = transparent;
      mat.opacity = transparent ? opacity : 1.0;
      mat.needsUpdate = true;
    });
  }

  applyTheme(theme: "light" | "dark") {
    this.hydrologyState.theme = theme;
    const isLight = theme === "light";
    if (isLight) {
      this.scene.background = new THREE.Color(0xbfe2ff);
      this.scene.fog = new THREE.FogExp2(0xbfe2ff, 0.0035);
      this.ambientLight.color.setHex(0xffffff);
      this.ambientLight.intensity = 0.95;
      this.sunLight.color.setHex(0xffffff);
      this.sunLight.intensity = 1.45;
    } else {
      this.scene.background = new THREE.Color(0x030611);
      this.scene.fog = new THREE.FogExp2(0x030611, 0.0035);
      this.ambientLight.color.setHex(0xe0f2fe);
      this.ambientLight.intensity = 0.65;
      this.sunLight.color.setHex(0xffffff);
      this.sunLight.intensity = 0.9;
    }
  }

  // ==========================================
  // Mouse Raycasting Coordinates Checks
  // ==========================================
  private handleCellHover(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.gridGroup.children, true);

    if (intersects.length > 0) {
      let hit: THREE.Object3D | null = intersects[0].object;
      while (hit && hit.userData.cellX === undefined && hit.parent) {
        hit = hit.parent;
      }

      if (hit && hit.userData.cellX !== undefined) {
        const x = hit.userData.cellX;
        const z = hit.userData.cellZ;
        const cell = this.hydrologyState.grid[x][z];

        if (this.selectionOutline) {
          this.selectionOutline.visible = true;
          this.selectionOutline.position.set(x * CELL_WIDTH + CELL_WIDTH / 2, cell.elevation + 0.25, z * CELL_WIDTH + CELL_WIDTH / 2);
        }

        if (this.hydrologyState.selectedTool === "inspect" && this.options.callbacks) {
          this.options.callbacks.onCellInspect(cell);
        }
        return;
      }
    }
    if (this.selectionOutline) this.selectionOutline.visible = false;
  }

  private handleCellClick() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.gridGroup.children, true);

    if (intersects.length > 0) {
      let hit: THREE.Object3D | null = intersects[0].object;
      while (hit && hit.userData.cellX === undefined && hit.parent) {
        hit = hit.parent;
      }

      if (hit && hit.userData.cellX !== undefined) {
        const x = hit.userData.cellX;
        const z = hit.userData.cellZ;
        this.executeTool(x, z);
      }
    }
  }

  private resize(): void {
    const width = Math.max(1, this.options.host.clientWidth);
    const height = Math.max(1, this.options.host.clientHeight);
    this.perspectiveCamera.aspect = width / height;
    this.perspectiveCamera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private animate = (): void => {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.updateHydrology(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };

  private log(text: string, type: "info" | "success" | "warn" | "danger" = "info") {
    if (this.options.callbacks) {
      this.options.callbacks.onLog(text, type);
    }
  }

  private updateApiStatus(key: "geocode" | "osm" | "dem" | "tile", status: "gray" | "green" | "yellow" | "red") {
    if (this.options.callbacks) {
      this.options.callbacks.onApiStatusUpdate(key, status);
    }
  }
}

