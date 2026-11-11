import * as THREE from 'three';
import { complement } from '../core/genetics';

/** Idealised B-DNA geometry, in nanometres (1 scene unit = 1 nm). */
const TWIST = (2 * Math.PI) / 10.5; // ~34.3° per base pair
const RISE = 0.34;
const RADIUS = 1.0;
const GROOVE = THREE.MathUtils.degToRad(140); // strand offset → major/minor grooves

/** How much of the axis (in nm) should fill the long side of the view. */
const VISIBLE_LENGTH = 17;
const EDGE_FADE = 16; // bases

export const BASE_COLORS: Record<string, number> = {
  A: 0x34d399,
  T: 0xf87171,
  G: 0xfbbf24,
  C: 0x60a5fa,
  N: 0x6b7280,
};

const STRAND_COLORS = [0xa5b4cf, 0x7f8db0];

export interface HelixHighlight {
  start: number;
  length: number;
  /** 0..1, how strongly the note is sounding right now. */
  pulse: number;
}

/**
 * Renders a sliding window of the helix around a playhead position. It knows
 * nothing about audio: callers give it a sequence, a position and highlights.
 */
export class HelixView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
  private readonly orient = new THREE.Group();
  private readonly spin = new THREE.Group();
  private readonly spheres: THREE.InstancedMesh;
  private readonly links: THREE.InstancedMesh;
  private readonly rungs: THREE.InstancedMesh;
  private readonly n: number;
  private seq = '';
  private markers = new Map<number, number>();
  private readonly resizeObserver: ResizeObserver;

  // scratch objects, reused every frame
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private readonly white = new THREE.Color(0xffffff);
  private static readonly UP = new THREE.Vector3(0, 1, 0);
  private static readonly ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(
    private readonly container: HTMLElement,
    windowSize: number,
  ) {
    this.n = windowSize;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, windowSize < 150 ? 1.5 : 2));
    this.renderer.setClearColor(0x000000, 0);
    container.prepend(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(4, 7, 9);
    const rim = new THREE.DirectionalLight(0x8ab4ff, 1.0);
    rim.position.set(-6, -4, -6);
    this.scene.add(key, rim, this.orient);
    this.orient.add(this.spin);

    const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
    const make = (geo: THREE.BufferGeometry, count: number) => {
      const mesh = new THREE.InstancedMesh(
        geo,
        new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.08 }),
        count,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, this.white); // allocates instanceColor
      mesh.frustumCulled = false;
      this.spin.add(mesh);
      return mesh;
    };
    this.spheres = make(sphereGeo, this.n * 2);
    this.links = make(cylGeo, this.n * 2);
    this.rungs = make(cylGeo, this.n * 2);

    // "Now" ring around the axis at the playhead.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.45, 0.012, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 }),
    );
    ring.rotation.y = Math.PI / 2;
    this.orient.add(ring);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  setSequence(seq: string): void {
    this.seq = seq;
  }

  setVisible(visible: boolean): void {
    // three.js sets an inline display:block on its canvas, so `hidden` alone isn't enough.
    this.renderer.domElement.style.display = visible ? 'block' : 'none';
    if (visible) this.resize();
  }

  /** Per-base backbone tints, e.g. start/stop codons. */
  setMarkers(markers: Map<number, number>): void {
    this.markers = markers;
  }

  render(pos: number, highlight: HelixHighlight | null, timeSec: number): void {
    const { n, seq } = this;
    const start = Math.floor(pos) - Math.floor(n / 2);
    this.spin.rotation.x = timeSec * 0.08;

    for (let k = 0; k < n; k++) {
      const i = start + k;
      if (i < 0 || i >= seq.length) {
        for (const mesh of [this.spheres, this.links, this.rungs]) {
          mesh.setMatrixAt(2 * k, HelixView.ZERO);
          mesh.setMatrixAt(2 * k + 1, HelixView.ZERO);
        }
        continue;
      }
      const fade = smoothstep(0, EDGE_FADE, Math.min(k, n - 1 - k));
      const active = highlight !== null && i >= highlight.start && i < highlight.start + highlight.length;
      const pulse = active ? highlight!.pulse : 0;

      this.point(i, 0, pos, this.a);
      this.point(i, 1, pos, this.b);
      this.mid.addVectors(this.a, this.b).multiplyScalar(0.5);

      // Backbone spheres
      const marker = this.markers.get(i);
      for (let strand = 0; strand < 2; strand++) {
        const p = strand === 0 ? this.a : this.b;
        const r = 0.19 * fade * (active ? 1.12 + 0.35 * pulse : 1);
        this.m.compose(p, this.q.identity(), this.s.setScalar(r));
        this.spheres.setMatrixAt(2 * k + strand, this.m);
        this.col.setHex(marker ?? STRAND_COLORS[strand]);
        if (active) this.col.lerp(this.white, 0.25 + 0.5 * pulse);
        this.spheres.setColorAt(2 * k + strand, this.col);
      }

      // Backbone links to the next base
      if (i + 1 < seq.length) {
        this.point(i + 1, 0, pos, this.c);
        this.point(i + 1, 1, pos, this.d);
        this.cylinder(this.links, 2 * k, this.a, this.c, 0.055 * fade);
        this.cylinder(this.links, 2 * k + 1, this.b, this.d, 0.055 * fade);
      } else {
        this.links.setMatrixAt(2 * k, HelixView.ZERO);
        this.links.setMatrixAt(2 * k + 1, HelixView.ZERO);
      }
      this.col.setHex(STRAND_COLORS[0]);
      this.links.setColorAt(2 * k, this.col);
      this.col.setHex(STRAND_COLORS[1]);
      this.links.setColorAt(2 * k + 1, this.col);

      // Base-pair rung, split into two half-colours
      const base = seq[i];
      const rr = 0.085 * fade * (active ? 1.3 + 0.9 * pulse : 1);
      this.cylinder(this.rungs, 2 * k, this.a, this.mid, rr);
      this.cylinder(this.rungs, 2 * k + 1, this.b, this.mid, rr);
      this.col.setHex(BASE_COLORS[base] ?? BASE_COLORS.N);
      if (active) this.col.lerp(this.white, 0.15 + 0.5 * pulse);
      this.rungs.setColorAt(2 * k, this.col);
      this.col.setHex(BASE_COLORS[complement(base)] ?? BASE_COLORS.N);
      if (active) this.col.lerp(this.white, 0.15 + 0.5 * pulse);
      this.rungs.setColorAt(2 * k + 1, this.col);
    }

    for (const mesh of [this.spheres, this.links, this.rungs]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Backbone position of base i on a strand, with the playhead at the origin. */
  private point(i: number, strand: number, pos: number, out: THREE.Vector3): THREE.Vector3 {
    const theta = i * TWIST + strand * GROOVE;
    return out.set((i - pos) * RISE, RADIUS * Math.cos(theta), RADIUS * Math.sin(theta));
  }

  private cylinder(mesh: THREE.InstancedMesh, index: number, from: THREE.Vector3, to: THREE.Vector3, radius: number) {
    const dir = this.s.subVectors(to, from);
    const len = dir.length();
    if (len < 1e-6 || radius <= 0) {
      mesh.setMatrixAt(index, HelixView.ZERO);
      return;
    }
    this.q.setFromUnitVectors(HelixView.UP, dir.divideScalar(len));
    this.center.addVectors(from, to).multiplyScalar(0.5);
    this.m.compose(this.center, this.q, this.scale.set(radius, len, radius));
    mesh.setMatrixAt(index, this.m);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const portrait = aspect < 0.9;
    // Landscape: axis runs left→right. Portrait: axis runs top→bottom, upcoming bases rise from below.
    this.orient.rotation.z = portrait ? -Math.PI / 2 : 0;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const alongAxis = portrait ? tanHalf : tanHalf * aspect;
    const across = portrait ? tanHalf * aspect : tanHalf;
    // Narrow screens show less of the axis so the helix stays a readable size.
    const longPx = portrait ? h : w;
    const visible = Math.min(VISIBLE_LENGTH, Math.max(7, longPx / 48));
    const dist = Math.max(visible / 2 / alongAxis, 2.6 / across);
    if (portrait) this.camera.position.set(dist * 0.2, 0, dist);
    else this.camera.position.set(0, dist * 0.2, dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
