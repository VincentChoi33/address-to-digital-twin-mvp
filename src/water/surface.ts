import * as THREE from "three";
import { SIM_N } from "./solver";

// The showpiece: a continuous water surface displaced by the solver's depth
// and flux textures. Depth, velocity, rain and drain-backflow all affect the
// final look: current streaks follow real pipe-model flow, fast water foams,
// cloudbursts throw procedural splash rings, and saturated drain cells boil.

const WATER_VERTEX = /* glsl */ `
  uniform sampler2D uTerrain; // R ground+buildings, G drain rate, B building mask
  uniform sampler2D uWater;   // R depth
  uniform sampler2D uFlux;    // RGBA = L R T B outflow
  uniform float uTime;
  uniform float uRainIntensity;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vDepth;
  varying float vFlowSpeed;

  void main() {
    vUv = uv;
    vec4 terrain = texture2D(uTerrain, uv);
    float depth = texture2D(uWater, uv).r;
    vec4 flux = texture2D(uFlux, uv);
    vec2 flow = vec2(flux.y - flux.x, flux.z - flux.w);
    float flowSpeed = length(flow);

    // no water sheet on rooftops (terrain B = building mask)
    vDepth = depth * (1.0 - step(0.5, terrain.b));
    vFlowSpeed = flowSpeed;

    float activeWater = smoothstep(0.02, 0.18, vDepth);
    float stormChop = 0.35 + uRainIntensity * 0.9 + clamp(flowSpeed * 14.0, 0.0, 1.35);
    float waveA = sin(position.x * 0.37 + position.z * 0.19 + uTime * 3.8);
    float waveB = sin(position.x * -0.23 + position.z * 0.44 + uTime * 5.1);
    float chop = (waveA + waveB) * 0.018 * activeWater * stormChop;

    vec3 displaced = vec3(position.x, terrain.r + vDepth + chop, position.z);
    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D uTerrain;
  uniform sampler2D uWater;
  uniform sampler2D uFlux;
  uniform samplerCube uEnvMap;
  uniform vec3 uSunDirection;
  uniform vec3 uCameraPosition;
  uniform float uTexel;
  uniform float uTime;
  uniform float uDomain;
  uniform float uRainIntensity;
  uniform float uBackflowIntensity;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vDepth;
  varying float vFlowSpeed;

  float surfaceHeight(vec2 uv) {
    return texture2D(uTerrain, uv).r + texture2D(uWater, uv).r;
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // cheap animated micro-ripple normal
  vec3 rippleNormal(vec2 p, float t, float storm) {
    float a = sin(p.x * 2.1 + t * 1.7) * cos(p.y * 1.7 - t * 1.3);
    float b = sin(p.x * 3.7 - t * 2.3 + 1.7) * cos(p.y * 2.9 + t * 1.9);
    return normalize(vec3((a + b) * (0.045 + storm * 0.045), 1.0, (a - b) * (0.045 + storm * 0.045)));
  }

  float splashRings(vec2 p, float depthWeight) {
    vec2 grid = floor(p * 0.58);
    vec2 local = fract(p * 0.58) - 0.5;
    float seed = hash21(grid);
    float phase = fract(uTime * (1.25 + uRainIntensity * 1.35) + seed);
    float radius = phase * 0.46;
    float ring = 1.0 - smoothstep(0.0, 0.028, abs(length(local) - radius));
    float life = 1.0 - smoothstep(0.55, 1.0, phase);
    float sparse = step(0.42, seed);
    return ring * life * sparse * uRainIntensity * depthWeight;
  }

  void main() {
    if (vDepth < 0.012) discard;

    // macro normal from the simulated surface gradient
    float hL = surfaceHeight(vUv - vec2(uTexel, 0.0));
    float hR = surfaceHeight(vUv + vec2(uTexel, 0.0));
    float hD = surfaceHeight(vUv - vec2(0.0, uTexel));
    float hU = surfaceHeight(vUv + vec2(0.0, uTexel));
    float cell = uDomain * uTexel;

    vec4 flux = texture2D(uFlux, vUv);
    vec2 flow = vec2(flux.y - flux.x, flux.z - flux.w);
    float flowSpeed = max(vFlowSpeed, length(flow));
    vec2 flowDir = normalize(flow + vec2(0.00001));
    float flowEnergy = smoothstep(0.01, 0.11, flowSpeed);

    vec3 macro = normalize(vec3(hL - hR, 2.0 * cell, hD - hU));
    vec3 flowLean = vec3(-flowDir.x, 0.0, -flowDir.y) * flowEnergy * smoothstep(0.04, 0.34, vDepth) * 0.38;
    vec3 normal = normalize(macro + rippleNormal(vWorld.xz * 0.9 + flow * 70.0, uTime, uRainIntensity) * vec3(1.0, 0.0, 1.0) * 0.55 + flowLean);

    vec3 view = normalize(uCameraPosition - vWorld);

    // depth-based absorption: shallow teal → deep navy
    vec3 shallow = vec3(0.16, 0.50, 0.54);
    vec3 mid = vec3(0.045, 0.22, 0.32);
    vec3 deep = vec3(0.012, 0.045, 0.12);
    float absorb = 1.0 - exp(-vDepth * 2.85);
    vec3 base = mix(shallow, mid, smoothstep(0.02, 0.35, vDepth));
    base = mix(base, deep, smoothstep(0.32, 0.92, vDepth));

    // muddy storm tint as it deepens (urban runoff isn't pool water)
    base = mix(base, vec3(0.18, 0.13, 0.075), clamp(vDepth * 0.24 + uRainIntensity * 0.12, 0.0, 0.42));

    // decision-grade visual warning: deep water gets amber/red undertone.
    float hazard = smoothstep(0.34, 0.72, vDepth);
    vec3 hazardColor = mix(vec3(0.95, 0.46, 0.12), vec3(0.74, 0.06, 0.035), smoothstep(0.55, 1.05, vDepth));
    base = mix(base, hazardColor, hazard * 0.34);

    // fresnel environment reflection
    float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 5.0);
    fresnel = mix(0.04, 1.0, fresnel);
    vec3 reflected = reflect(-view, normal);
    reflected.y = abs(reflected.y);
    vec3 env = textureCube(uEnvMap, reflected).rgb;
    vec3 color = mix(base, env, fresnel * 0.78);

    // sun glint + storm glint
    vec3 halfway = normalize(view + uSunDirection);
    float glint = pow(max(dot(normal, halfway), 0.0), 180.0);
    color += vec3(1.0, 0.96, 0.82) * glint * (1.2 + uRainIntensity * 0.9);

    // Velocity-aligned streaks: lines run with actual solver flux, not fake UV scroll.
    vec2 tangent = vec2(-flowDir.y, flowDir.x);
    float along = dot(vWorld.xz, flowDir);
    float across = dot(vWorld.xz, tangent);
    float streakWave = sin(along * 1.15 - uTime * (4.2 + flowSpeed * 90.0) + sin(across * 0.75) * 1.4);
    float streak = pow(max(0.0, streakWave * 0.5 + 0.5), 7.0) * flowEnergy * smoothstep(0.05, 0.32, vDepth);
    color += vec3(0.22, 0.86, 1.0) * streak * 0.28;

    // Foam at wet/dry edges, steep gradients, fast flow and drain boil.
    float depthWeight = smoothstep(0.05, 0.3, vDepth);
    float edgeFoam = (1.0 - smoothstep(0.015, 0.06, vDepth)) * 0.5;
    float slopeFoam = smoothstep(0.22, 0.6, length(vec2(hL - hR, hD - hU)) / cell) * depthWeight;
    float flowFoam = smoothstep(0.035, 0.16, flowSpeed) * depthWeight;
    float foamNoise = sin(vWorld.x * 7.0 + uTime * 2.2) * sin(vWorld.z * 6.3 - uTime * 1.8);

    float drainRate = texture2D(uTerrain, vUv).g;
    float drainMask = smoothstep(0.004, 0.035, drainRate);
    float boilPulse = 0.5 + 0.5 * sin(uTime * 9.0 + hash21(floor(vWorld.xz * 0.3)) * 6.2831);
    float backflowBoil = drainMask * uBackflowIntensity * (0.45 + 0.55 * boilPulse);

    float splash = splashRings(vWorld.xz, depthWeight);
    float foam = clamp(max(max(edgeFoam, slopeFoam), flowFoam * 0.62) * (0.58 + 0.42 * foamNoise) + backflowBoil + splash * 0.7, 0.0, 1.0);
    color = mix(color, vec3(0.88, 0.94, 0.95), foam * 0.54);
    color = mix(color, vec3(1.0, 0.22, 0.12), backflowBoil * 0.45);
    color += vec3(0.72, 0.95, 1.0) * splash * 0.42;

    float thin = smoothstep(0.015, 0.09, vDepth);
    float alpha = mix(0.56, 0.95, absorb);
    alpha = max(alpha, fresnel * 0.84 * depthWeight);
    alpha = max(alpha, (streak + foam * 0.4 + splash * 0.4) * 0.7);
    gl_FragColor = vec4(color, alpha * thin);
  }
`;

export class WaterSurface {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(
    domainM: number,
    terrainTexture: THREE.Texture,
    depthTexture: THREE.Texture,
    fluxTexture: THREE.Texture,
    envMap: THREE.CubeTexture | THREE.Texture
  ) {
    const geometry = new THREE.PlaneGeometry(domainM, domainM, SIM_N - 1, SIM_N - 1);
    geometry.rotateX(-Math.PI / 2);
    // PlaneGeometry uv v runs 1→0 from -z to +z after rotation; solver texture
    // v matches world +z (north up). Rewrite uv from world coords directly.
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    const uvs = geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      uvs.setXY(i, positions.getX(i) / domainM + 0.5, positions.getZ(i) / domainM + 0.5);
    }
    uvs.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTerrain: { value: terrainTexture },
        uWater: { value: depthTexture },
        uFlux: { value: fluxTexture },
        uEnvMap: { value: envMap },
        uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
        uCameraPosition: { value: new THREE.Vector3() },
        uTexel: { value: 1 / SIM_N },
        uTime: { value: 0 },
        uDomain: { value: domainM },
        uRainIntensity: { value: 0 },
        uBackflowIntensity: { value: 0 }
      }
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  update(
    depthTexture: THREE.Texture,
    fluxTexture: THREE.Texture,
    camera: THREE.Camera,
    sunDirection: THREE.Vector3,
    timeS: number,
    rainMmPerHour: number,
    backflowMps: number
  ): void {
    this.material.uniforms.uWater.value = depthTexture;
    this.material.uniforms.uFlux.value = fluxTexture;
    this.material.uniforms.uCameraPosition.value.copy(
      (camera as THREE.PerspectiveCamera).getWorldPosition(new THREE.Vector3())
    );
    this.material.uniforms.uSunDirection.value.copy(sunDirection);
    this.material.uniforms.uTime.value = timeS;
    this.material.uniforms.uRainIntensity.value = Math.min(1, Math.max(0, rainMmPerHour / 150));
    this.material.uniforms.uBackflowIntensity.value = Math.min(1, Math.max(0, backflowMps / 0.014));
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
