import * as THREE from "three";

// GPU shallow-water solver — virtual pipe model (Mei et al. 2007), the
// scheme behind most interactive flood/erosion demos. State lives in
// half-float textures and is integrated entirely on the GPU:
//   flux pass:  per-cell outflow pipes to 4 neighbours from head difference
//   depth pass: divergence of flux + rainfall − drain intake (+ backflow)
// Rainfall is demo-amplified (RAIN_AMPLIFIER) so a cloudburst floods the
// scene in seconds; the conversion lives in exactly one constant.

export const SIM_N = 256;
export const RAIN_AMPLIFIER = 200; // 시연용 가속: 1mm/h를 200mm/h 체감으로

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FLUX_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTerrain; // R ground+buildings, G drain rate
  uniform sampler2D uWater;   // R depth
  uniform sampler2D uFlux;    // RGBA = L R T B outflow
  uniform float uDt;
  uniform float uDx;
  uniform float uTexel;

  float head(vec2 uv) {
    return texture2D(uTerrain, uv).r + texture2D(uWater, uv).r;
  }

  void main() {
    float d = texture2D(uWater, vUv).r;
    vec4 flux = texture2D(uFlux, vUv);
    float h = head(vUv);

    vec2 left = vUv - vec2(uTexel, 0.0);
    vec2 right = vUv + vec2(uTexel, 0.0);
    vec2 top = vUv + vec2(0.0, uTexel);
    vec2 bottom = vUv - vec2(0.0, uTexel);

    float k = uDt * 9.81 * uDx * 0.6; // dt * g * pipe section / length (lumped)
    vec4 next = flux * 0.998 + k * vec4(
      h - head(left),
      h - head(right),
      h - head(top),
      h - head(bottom)
    );
    next = max(next, vec4(0.0));

    // never drain more volume than the cell holds
    float total = next.x + next.y + next.z + next.w;
    float volume = d * uDx * uDx;
    float scale = total > 0.0 ? min(1.0, volume / (total * uDt + 1e-6)) : 0.0;
    gl_FragColor = next * scale;
  }
`;

const DEPTH_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTerrain;
  uniform sampler2D uWater;   // R depth, G absorbed accum
  uniform sampler2D uFlux;
  uniform float uDt;
  uniform float uDx;
  uniform float uTexel;
  uniform float uRain;        // m/s (already amplified)
  uniform float uDrainScale;  // 0 when network is full
  uniform float uBackflow;    // m/s re-emerging at drains when saturated
  uniform float uEdgeDrain;

  void main() {
    vec4 state = texture2D(uWater, vUv);
    float d = state.r;
    vec4 flux = texture2D(uFlux, vUv);

    // inflow: neighbours' flux pointed at me (their L/R/T/B order = -x +x +y -y)
    float inflow =
      texture2D(uFlux, vUv - vec2(uTexel, 0.0)).y +
      texture2D(uFlux, vUv + vec2(uTexel, 0.0)).x +
      texture2D(uFlux, vUv + vec2(0.0, uTexel)).w +
      texture2D(uFlux, vUv - vec2(0.0, uTexel)).z;
    float outflow = flux.x + flux.y + flux.z + flux.w;

    d += uDt * (inflow - outflow) / (uDx * uDx);
    // buildings (terrain B channel) drain their roofs internally — no direct rain
    float buildingMask = texture2D(uTerrain, vUv).b;
    d += uRain * uDt * (1.0 - buildingMask);

    float drainRate = texture2D(uTerrain, vUv).g;
    float absorbed = min(d, drainRate * uDrainScale * uDt);
    d -= absorbed;
    d += (drainRate > 0.0 ? 1.0 : 0.0) * uBackflow * uDt;

    // open boundary: the domain edge sheds water (counts as runoff leaving)
    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    if (edge < uTexel * 2.0) d *= max(0.0, 1.0 - uEdgeDrain * uDt);

    gl_FragColor = vec4(max(d, 0.0), state.g + absorbed, 0.0, 1.0);
  }
`;

// stats encode: average a 4x4 block of sim texels into one RGBA8 texel
const STATS_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uWater;
  uniform float uTexel;

  void main() {
    float sumD = 0.0;
    float flooded = 0.0;
    float maxD = 0.0;
    float sumA = 0.0;
    for (int y = 0; y < 4; y++) {
      for (int x = 0; x < 4; x++) {
        vec2 offset = (vec2(float(x), float(y)) - 1.5) * uTexel;
        vec4 s = texture2D(uWater, vUv + offset);
        sumD += s.r;
        sumA += s.g;
        maxD = max(maxD, s.r);
        flooded += step(0.1, s.r);
      }
    }
    gl_FragColor = vec4(
      clamp(sumD / 16.0 / 2.55, 0.0, 1.0),   // mean depth, 1 unit = 2.55m
      flooded / 16.0,                          // flooded fraction (>10cm)
      clamp(sumA / 16.0 / 2.55, 0.0, 1.0),    // mean absorbed, 1 unit = 2.55m
      clamp(maxD / 2.55, 0.0, 1.0)
    );
  }
`;

export interface WaterStats {
  volumeM3: number;
  floodedAreaM2: number;
  maxDepthM: number;
  absorbedM3: number;
  /** 64x64 mean-depth grid for CPU-side inspection (row-major, v-up) */
  depthGrid: Float32Array;
}

export class WaterSolver {
  readonly terrainTexture: THREE.DataTexture;
  private renderer: THREE.WebGLRenderer;
  private domainM: number;
  private water: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private flux: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private statsTarget: THREE.WebGLRenderTarget;
  private waterIndex = 0;
  private fluxIndex = 0;

  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private fluxMaterial: THREE.ShaderMaterial;
  private depthMaterial: THREE.ShaderMaterial;
  private statsMaterial: THREE.ShaderMaterial;

  rainMmPerHour = 0;
  drainScale = 1;
  backflowMps = 0;
  private statsBuffer = new Uint8Array(64 * 64 * 4);
  private lastStats: WaterStats = {
    volumeM3: 0,
    floodedAreaM2: 0,
    maxDepthM: 0,
    absorbedM3: 0,
    depthGrid: new Float32Array(64 * 64)
  };

  constructor(
    renderer: THREE.WebGLRenderer,
    solidHeight: Float32Array, // N*N ground+buildings (meters)
    drainRate: Float32Array, // N*N drain intake (m/s)
    buildingMask: Float32Array, // N*N 1=building
    domainM: number
  ) {
    this.renderer = renderer;
    this.domainM = domainM;

    const terrainData = new Float32Array(SIM_N * SIM_N * 4);
    for (let i = 0; i < SIM_N * SIM_N; i++) {
      terrainData[i * 4] = solidHeight[i];
      terrainData[i * 4 + 1] = drainRate[i];
      terrainData[i * 4 + 2] = buildingMask[i];
    }
    this.terrainTexture = new THREE.DataTexture(terrainData, SIM_N, SIM_N, THREE.RGBAFormat, THREE.FloatType);
    this.terrainTexture.needsUpdate = true;

    const makeTarget = () =>
      new THREE.WebGLRenderTarget(SIM_N, SIM_N, {
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false
      });
    this.water = [makeTarget(), makeTarget()];
    this.flux = [makeTarget(), makeTarget()];
    this.statsTarget = new THREE.WebGLRenderTarget(64, 64, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false
    });

    const texel = 1 / SIM_N;
    const dx = domainM / SIM_N;
    this.fluxMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FLUX_FRAGMENT,
      uniforms: {
        uTerrain: { value: this.terrainTexture },
        uTexel: { value: texel },
        uDx: { value: dx },
        uWater: { value: null },
        uFlux: { value: null },
        uDt: { value: 0 }
      }
    });
    this.depthMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: DEPTH_FRAGMENT,
      uniforms: {
        uTerrain: { value: this.terrainTexture },
        uTexel: { value: texel },
        uDx: { value: dx },
        uWater: { value: null },
        uFlux: { value: null },
        uDt: { value: 0 },
        uRain: { value: 0 },
        uDrainScale: { value: 1 },
        uBackflow: { value: 0 },
        uEdgeDrain: { value: 0.6 }
      }
    });
    this.statsMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: STATS_FRAGMENT,
      uniforms: { uWater: { value: null }, uTexel: { value: texel } }
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fluxMaterial);
    this.quadScene.add(this.quad);
    this.reset();
  }

  get depthTexture(): THREE.Texture {
    return this.water[this.waterIndex].texture;
  }

  reset(): void {
    for (const target of [...this.water, ...this.flux]) {
      this.renderer.setRenderTarget(target);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear();
    }
    this.renderer.setRenderTarget(null);
    this.lastStats = { ...this.lastStats, volumeM3: 0, floodedAreaM2: 0, maxDepthM: 0, absorbedM3: 0 };
  }

  private runPass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
    this.renderer.setRenderTarget(null);
  }

  /** Advance simulation; call once per frame. */
  step(dtMs: number): void {
    const substeps = 2;
    const dt = Math.min(dtMs / 1000, 0.05) / substeps * 2.2; // sim runs ~2.2x wall clock
    const rainMps = (this.rainMmPerHour / 1000 / 3600) * RAIN_AMPLIFIER;

    for (let i = 0; i < substeps; i++) {
      const waterIn = this.water[this.waterIndex];
      const fluxIn = this.flux[this.fluxIndex];
      const fluxOut = this.flux[1 - this.fluxIndex];
      this.fluxMaterial.uniforms.uWater.value = waterIn.texture;
      this.fluxMaterial.uniforms.uFlux.value = fluxIn.texture;
      this.fluxMaterial.uniforms.uDt.value = dt;
      this.runPass(this.fluxMaterial, fluxOut);
      this.fluxIndex = 1 - this.fluxIndex;

      const waterOut = this.water[1 - this.waterIndex];
      this.depthMaterial.uniforms.uWater.value = waterIn.texture;
      this.depthMaterial.uniforms.uFlux.value = fluxOut.texture;
      this.depthMaterial.uniforms.uDt.value = dt;
      this.depthMaterial.uniforms.uRain.value = rainMps;
      this.depthMaterial.uniforms.uDrainScale.value = this.drainScale;
      this.depthMaterial.uniforms.uBackflow.value = this.backflowMps;
      this.runPass(this.depthMaterial, waterOut);
      this.waterIndex = 1 - this.waterIndex;
    }
  }

  /** GPU→CPU stats readback. Call sparingly (every ~500ms). */
  readStats(): WaterStats {
    this.statsMaterial.uniforms.uWater.value = this.depthTexture;
    this.runPass(this.statsMaterial, this.statsTarget);
    this.renderer.readRenderTargetPixels(this.statsTarget, 0, 0, 64, 64, this.statsBuffer);

    const cellArea = (this.domainM / SIM_N) ** 2;
    const blockArea = cellArea * 16;
    let volume = 0;
    let flooded = 0;
    let absorbed = 0;
    let maxDepth = 0;
    for (let i = 0; i < 64 * 64; i++) {
      const meanDepth = (this.statsBuffer[i * 4] / 255) * 2.55;
      const floodedFraction = this.statsBuffer[i * 4 + 1] / 255;
      const meanAbsorbed = (this.statsBuffer[i * 4 + 2] / 255) * 2.55;
      const blockMax = (this.statsBuffer[i * 4 + 3] / 255) * 2.55;
      volume += meanDepth * blockArea;
      flooded += floodedFraction * blockArea;
      absorbed += meanAbsorbed * blockArea;
      if (blockMax > maxDepth) maxDepth = blockMax;
      this.lastStats.depthGrid[i] = meanDepth;
    }
    this.lastStats = {
      volumeM3: volume,
      floodedAreaM2: flooded,
      maxDepthM: maxDepth,
      absorbedM3: absorbed,
      depthGrid: this.lastStats.depthGrid
    };
    return this.lastStats;
  }

  get stats(): WaterStats {
    return this.lastStats;
  }

  dispose(): void {
    for (const target of [...this.water, ...this.flux, this.statsTarget]) target.dispose();
    this.terrainTexture.dispose();
    this.quad.geometry.dispose();
    this.fluxMaterial.dispose();
    this.depthMaterial.dispose();
    this.statsMaterial.dispose();
  }
}
