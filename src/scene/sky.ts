import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";

export interface SkyRig {
  sky: Sky;
  sunLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  sunDirection: THREE.Vector3;
  envMap: THREE.CubeTexture;
  setMode: (mode: "day" | "storm") => void;
  mode: "day" | "storm";
  dispose: () => void;
}

/**
 * Physical sky + sun + cube-captured environment map. The cube texture drives
 * both PBR reflections (scene.environment) and the raw water shader's
 * textureCube lookups — PMREM output wouldn't work for the latter.
 */
export function createSkyRig(renderer: THREE.WebGLRenderer, scene: THREE.Scene): SkyRig {
  const sky = new Sky();
  sky.scale.setScalar(4000);
  scene.add(sky);

  const sunDirection = new THREE.Vector3(0.4, 0.7, 0.3).normalize();
  const sunLight = new THREE.DirectionalLight(0xfff2dd, 2.4);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  const shadowCam = sunLight.shadow.camera;
  shadowCam.left = -260;
  shadowCam.right = 260;
  shadowCam.top = 260;
  shadowCam.bottom = -260;
  shadowCam.far = 1500;
  sunLight.shadow.bias = -0.0004;
  scene.add(sunLight);

  const hemiLight = new THREE.HemisphereLight(0xcfe4ff, 0x303a33, 0.5);
  scene.add(hemiLight);

  // sky-only scene re-rendered into a cube map on mode changes
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(4000);
  envScene.add(envSky);
  const cubeTarget = new THREE.WebGLCubeRenderTarget(256, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCamera = new THREE.CubeCamera(1, 5000, cubeTarget);

  const apply = (elevationDeg: number, azimuthDeg: number, turbidity: number, rayleigh: number, exposure: number) => {
    const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
    const theta = THREE.MathUtils.degToRad(azimuthDeg);
    sunDirection.setFromSphericalCoords(1, phi, theta);
    for (const target of [sky, envSky]) {
      const uniforms = target.material.uniforms;
      uniforms.turbidity.value = turbidity;
      uniforms.rayleigh.value = rayleigh;
      uniforms.mieCoefficient.value = 0.004;
      uniforms.mieDirectionalG.value = 0.8;
      uniforms.sunPosition.value.copy(sunDirection);
    }
    sunLight.position.copy(sunDirection).multiplyScalar(700);
    renderer.toneMappingExposure = exposure;
    cubeCamera.update(renderer, envScene);
    scene.environment = cubeTarget.texture;
    rig.envMap = cubeTarget.texture;
  };

  const rig: SkyRig = {
    sky,
    sunLight,
    hemiLight,
    sunDirection,
    envMap: cubeTarget.texture,
    mode: "day",
    setMode: (mode) => {
      rig.mode = mode;
      if (mode === "day") {
        sunLight.intensity = 2.4;
        hemiLight.intensity = 0.5;
        apply(38, 155, 4, 2.2, 0.6);
      } else {
        sunLight.intensity = 1.5;
        hemiLight.intensity = 0.45;
        apply(30, 195, 8, 1.6, 0.58);
      }
    },
    dispose: () => {
      cubeTarget.dispose();
    }
  };
  rig.setMode("day");
  return rig;
}
