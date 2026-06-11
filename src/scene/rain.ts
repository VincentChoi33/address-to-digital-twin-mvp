import * as THREE from "three";

// Streak-style rain: instanced line segments falling over the domain.
// Intensity scales visible count via draw range.

const MAX_STREAKS = 2400;

export class RainEffect {
  readonly object: THREE.LineSegments;
  private velocities: Float32Array;
  private positions: Float32Array;
  private spanM: number;
  private intensity = 0; // 0..1

  constructor(spanM: number) {
    this.spanM = spanM;
    this.positions = new Float32Array(MAX_STREAKS * 2 * 3);
    this.velocities = new Float32Array(MAX_STREAKS);
    for (let i = 0; i < MAX_STREAKS; i++) this.respawn(i, true);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xa8c4dd,
      transparent: true,
      opacity: 0.32,
      depthWrite: false
    });
    this.object = new THREE.LineSegments(geometry, material);
    this.object.frustumCulled = false;
    this.object.visible = false;
  }

  private respawn(index: number, randomHeight = false): void {
    const x = (Math.random() - 0.5) * this.spanM;
    const z = (Math.random() - 0.5) * this.spanM;
    const y = randomHeight ? Math.random() * 220 : 200 + Math.random() * 40;
    const length = 2.4 + Math.random() * 2.2;
    const offset = index * 6;
    this.positions[offset] = x;
    this.positions[offset + 1] = y;
    this.positions[offset + 2] = z;
    this.positions[offset + 3] = x + 0.6; // slight wind shear
    this.positions[offset + 4] = y - length;
    this.positions[offset + 5] = z;
    this.velocities[index] = 75 + Math.random() * 45;
  }

  setIntensity(rainMmPerHour: number): void {
    this.intensity = Math.min(1, rainMmPerHour / 150);
    this.object.visible = this.intensity > 0.01;
    const geometry = this.object.geometry;
    geometry.setDrawRange(0, Math.floor(MAX_STREAKS * this.intensity) * 2);
    (this.object.material as THREE.LineBasicMaterial).opacity = 0.18 + 0.22 * this.intensity;
  }

  update(dtMs: number): void {
    if (!this.object.visible) return;
    const dt = Math.min(dtMs, 60) / 1000;
    const active = Math.floor(MAX_STREAKS * this.intensity);
    for (let i = 0; i < active; i++) {
      const offset = i * 6;
      const fall = this.velocities[i] * dt;
      this.positions[offset + 1] -= fall;
      this.positions[offset + 4] -= fall;
      if (this.positions[offset + 4] < -2) this.respawn(i);
    }
    (this.object.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}
