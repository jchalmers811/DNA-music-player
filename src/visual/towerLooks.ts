import * as THREE from 'three';
import { hideInstances, makeInstanced, markDirty, setSphere } from './sceneUtils';

/**
 * Swappable looks for the 3D tower scene. Each list maps an id to how that
 * option is built, so adding a look means adding one entry here (the
 * prototypes in /prototypes have more to port: cartoon, glass, hologram,
 * cloud, prism, aurora ribosomes; sparks, comet trails, fireflies blocks).
 */

const unitSphere = new THREE.SphereGeometry(1, 24, 16);

// ---------- Ribosome looks ----------

/** One subunit, built at unit size; the scene places, turns and scales it. */
export interface RibosomeSubunit {
  object: THREE.Object3D;
  /** Called every frame. `pulse` is 0..1, how strongly the current note sounds. */
  tick?: (timeSec: number, pulse: number) => void;
}

export interface RibosomeLook {
  name: string;
  build(small: boolean): RibosomeSubunit;
}

/** A see-through shell that glows at its rim (brightest where you look across its surface). */
function rimMaterial(color: number, strength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, strength: { value: strength } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color; uniform float strength;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = pow(f, 2.2) * strength;
        gl_FragColor = vec4(color * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export const RIBOSOME_LOOKS = {
  simple: {
    name: 'Simple',
    build: (small: boolean) => {
      const color = small ? 0xfde4b8 : 0xfcd9a0;
      const mesh = new THREE.Mesh(
        unitSphere,
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.6, transparent: true, opacity: 0.38, depthWrite: false }),
      );
      mesh.renderOrder = 2;
      return { object: mesh };
    },
  },
  ghost: {
    name: 'Ghost',
    // A pale glowing shell that keeps sending out fading echoes of itself, like ripples.
    build: (small: boolean) => {
      const group = new THREE.Group();
      const core = new THREE.Mesh(unitSphere, rimMaterial(small ? 0xe0f2fe : 0xede9fe, 1.2));
      group.add(core);
      const echoes = [0, 1, 2].map(() => {
        const m = new THREE.Mesh(unitSphere, rimMaterial(0xc7d2fe, 0.6));
        group.add(m);
        return m;
      });
      return {
        object: group,
        tick: (timeSec, pulse) => {
          (core.material as THREE.ShaderMaterial).uniforms.strength.value = 1.2 * (1 + 0.6 * pulse);
          echoes.forEach((m, k) => {
            const phase = (timeSec * 0.45 + k / 3) % 1;
            m.scale.setScalar(1 + phase * 0.5);
            (m.material as THREE.ShaderMaterial).uniforms.strength.value = 0.7 * (1 - phase) * (1 - phase);
          });
        },
      };
    },
  },
  prism: {
    name: 'Prism',
    // An iridescent shell whose colours run through the rainbow with the viewing angle, drifting slowly over time.
    build: () => {
      const material = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, strength: { value: 0.8 } },
        vertexShader: `
          varying vec3 vN; varying vec3 vV;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform float time; uniform float strength;
          varying vec3 vN; varying vec3 vV;
          void main() {
            float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
            vec3 c = 0.55 + 0.45 * cos(6.2831 * (f * 1.3 + time * 0.08 + vec3(0.0, 0.33, 0.67)));
            float a = (pow(f, 1.4) * 0.95 + 0.06) * strength;
            gl_FragColor = vec4(c * a, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      return {
        object: new THREE.Mesh(unitSphere, material),
        tick: (timeSec, pulse) => {
          material.uniforms.time.value = timeSec;
          material.uniforms.strength.value = 0.8 * (1 + 0.5 * pulse);
        },
      };
    },
  },
} satisfies Record<string, RibosomeLook>;

export type RibosomeLookId = keyof typeof RIBOSOME_LOOKS;

// ---------- Building-block effects ----------

/** What a block effect gets to work with. */
export interface BlockContext {
  parent: THREE.Object3D;
  /** Where blocks are drawn in and used up. */
  target: THREE.Vector3;
  bottom: number;
  top: number;
  radius: number;
  /** 0..1 dimming at a height (the dark ceiling). */
  dimAt: (y: number) => number;
}

export interface BlockEffectInstance {
  update(dt: number, timeSec: number): void;
  dispose(): void;
}

export interface BlockEffect {
  name: string;
  create(ctx: BlockContext): BlockEffectInstance | null;
}

const BASE_COLS = [0x34d399, 0x60a5fa, 0xfbbf24, 0xf87171];

/** Free nucleotides drifting around; those near the polymerase are pulled in and used up. */
class PlainBlocks implements BlockEffectInstance {
  private readonly count = 260;
  private readonly mesh: THREE.InstancedMesh;
  private readonly blocks: { p: THREE.Vector3; v: THREE.Vector3; color: THREE.Color; life: number }[];
  private readonly toTarget = new THREE.Vector3();
  private readonly col = new THREE.Color();

  constructor(private readonly ctx: BlockContext) {
    this.mesh = makeInstanced(new THREE.SphereGeometry(1, 10, 8), this.count, ctx.parent);
    (this.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x111111);
    this.blocks = Array.from({ length: this.count }, (_, k) => ({
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      color: new THREE.Color(BASE_COLS[k % 4]),
      life: 1,
    }));
    for (const b of this.blocks) this.spawn(b, true);
  }

  private spawn(b: (typeof this.blocks)[number], anywhere: boolean): void {
    const { bottom, top, radius } = this.ctx;
    const a = Math.random() * Math.PI * 2;
    const r = anywhere ? 1 + Math.random() * (radius - 1) : radius * (0.7 + Math.random() * 0.3);
    b.p.set(Math.cos(a) * r, bottom + 0.4 + Math.random() * (top - bottom - 0.8), Math.sin(a) * r);
    b.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.2);
    b.life = 1;
  }

  update(dt: number): void {
    const { target, bottom, top, radius, dimAt } = this.ctx;
    const reach = 3.4;
    for (let k = 0; k < this.count; k++) {
      const b = this.blocks[k];
      this.toTarget.subVectors(target, b.p);
      const d = this.toTarget.length();
      if (d < reach) b.v.addScaledVector(this.toTarget.normalize(), (dt * 2) / Math.max(0.5, d));
      else b.v.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(dt * 0.15));
      b.v.multiplyScalar(d < reach ? 0.985 : 0.995);
      b.p.addScaledVector(b.v, dt);
      if (d < 0.45) b.life -= dt * 4;
      if (b.life <= 0 || b.p.length() > radius * 1.5 || b.p.y < bottom || b.p.y > top) this.spawn(b, false);
      setSphere(this.mesh, k, b.p, 0.045 * Math.max(0, b.life));
      this.mesh.setColorAt(k, this.col.copy(b.color).multiplyScalar(1 - 0.85 * dimAt(b.p.y)));
    }
    markDirty(this.mesh);
  }

  dispose(): void {
    hideInstances(this.mesh, ...Array.from({ length: this.count }, (_, i) => i));
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export const BLOCK_EFFECTS = {
  off: { name: 'Off', create: () => null },
  plain: { name: 'Plain', create: (ctx: BlockContext) => new PlainBlocks(ctx) },
} satisfies Record<string, BlockEffect>;

export type BlockEffectId = keyof typeof BLOCK_EFFECTS;
