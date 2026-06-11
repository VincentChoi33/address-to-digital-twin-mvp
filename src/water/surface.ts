import * as THREE from "three";
import { SIM_N } from "./solver";

// The showpiece: a continuous water surface displaced by the solver's depth
// texture. Depth-based absorption, fresnel environment reflection, sun glint,
// animated micro-ripples, and foam at wet/dry edges — no blue boxes.

const WATER_VERTEX = /* glsl */ `
  uniform sampler2D uTerrain; // R ground+buildings
  uniform sampler2D uWater;   // R depth
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vDepth;

  void main() {
    vUv = uv;
    vec4 terrain = texture2D(uTerrain, uv);
    float depth = texture2D(uWater, uv).r;
    // no water sheet on rooftops (terrain B = building mask)
    vDepth = depth * (1.0 - step(0.5, terrain.b));
    vec3 displaced = vec3(position.x, terrain.r + vDepth, position.z);
    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D uTerrain;
  uniform sampler2D uWater;
  uniform samplerCube uEnvMap;
  uniform vec3 uSunDirection;
  uniform vec3 uCameraPosition;
  uniform float uTexel;
  uniform float uTime;
  uniform float uDomain;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vDepth;

  float surfaceHeight(vec2 uv) {
    return texture2D(uTerrain, uv).r + texture2D(uWater, uv).r;
  }

  // cheap animated micro-ripple normal
  vec3 rippleNormal(vec2 p, float t) {
    float a = sin(p.x * 2.1 + t * 1.7) * cos(p.y * 1.7 - t * 1.3);
    float b = sin(p.x * 3.7 - t * 2.3 + 1.7) * cos(p.y * 2.9 + t * 1.9);
    return normalize(vec3((a + b) * 0.06, 1.0, (a - b) * 0.06));
  }

  void main() {
    if (vDepth < 0.012) discard;

    // macro normal from the simulated surface gradient
    float hL = surfaceHeight(vUv - vec2(uTexel, 0.0));
    float hR = surfaceHeight(vUv + vec2(uTexel, 0.0));
    float hD = surfaceHeight(vUv - vec2(0.0, uTexel));
    float hU = surfaceHeight(vUv + vec2(0.0, uTexel));
    float cell = uDomain * uTexel;
    vec3 macro = normalize(vec3(hL - hR, 2.0 * cell, hD - hU));
    vec3 normal = normalize(macro + rippleNormal(vWorld.xz * 0.9, uTime) * vec3(1.0, 0.0, 1.0) * 0.55);

    vec3 view = normalize(uCameraPosition - vWorld);

    // depth-based absorption: shallow teal → deep navy
    vec3 shallow = vec3(0.18, 0.45, 0.49);
    vec3 deep = vec3(0.015, 0.07, 0.16);
    float absorb = 1.0 - exp(-vDepth * 2.6);
    vec3 base = mix(shallow, deep, absorb);

    // muddy storm tint as it deepens (urban runoff isn't pool water)
    base = mix(base, vec3(0.16, 0.13, 0.085), clamp(vDepth * 0.25, 0.0, 0.35));

    // fresnel environment reflection
    float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 5.0);
    fresnel = mix(0.04, 1.0, fresnel);
    vec3 reflected = reflect(-view, normal);
    reflected.y = abs(reflected.y);
    vec3 env = textureCube(uEnvMap, reflected).rgb;
    vec3 color = mix(base, env, fresnel * 0.82);

    // sun glint
    vec3 halfway = normalize(view + uSunDirection);
    float glint = pow(max(dot(normal, halfway), 0.0), 220.0);
    color += vec3(1.0, 0.96, 0.85) * glint * 1.6;

    // foam at wet/dry edges and steep gradients
    float edgeFoam = 1.0 - smoothstep(0.012, 0.05, vDepth);
    float slopeFoam = smoothstep(0.18, 0.5, length(vec2(hL - hR, hD - hU)) / cell);
    float foamNoise = sin(vWorld.x * 7.0 + uTime * 2.0) * sin(vWorld.z * 6.3 - uTime * 1.6);
    float foam = clamp(max(edgeFoam, slopeFoam) * (0.55 + 0.45 * foamNoise), 0.0, 1.0);
    color = mix(color, vec3(0.88, 0.92, 0.93), foam * 0.5);

    float alpha = mix(0.62, 0.94, absorb);
    alpha = max(alpha, fresnel * 0.9);
    gl_FragColor = vec4(color, alpha * smoothstep(0.012, 0.035, vDepth));
  }
`;

export class WaterSurface {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(
    domainM: number,
    terrainTexture: THREE.Texture,
    depthTexture: THREE.Texture,
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
        uEnvMap: { value: envMap },
        uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
        uCameraPosition: { value: new THREE.Vector3() },
        uTexel: { value: 1 / SIM_N },
        uTime: { value: 0 },
        uDomain: { value: domainM }
      }
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  update(depthTexture: THREE.Texture, camera: THREE.Camera, sunDirection: THREE.Vector3, timeS: number): void {
    this.material.uniforms.uWater.value = depthTexture;
    this.material.uniforms.uCameraPosition.value.copy(
      (camera as THREE.PerspectiveCamera).getWorldPosition(new THREE.Vector3())
    );
    this.material.uniforms.uSunDirection.value.copy(sunDirection);
    this.material.uniforms.uTime.value = timeS;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
