import * as THREE from 'three';
import type { FoldResult } from '../core/fold';
import { complement } from '../core/genetics';
import { propertyClass, type PropertyClass } from '../core/protein';
import { BASE_COLORS, type HelixHighlight } from './helix';

/**
 * The gene-to-protein view: DNA → RNA polymerase → mRNA → ribosome → protein.
 *
 * Like the helix, it knows nothing about audio. Every frame is a pure function
 * of (sequence, protein, playhead position), so seeking anywhere just works.
 *
 * Layout (landscape, scene units): everything flows right → left, matching the
 * helix and the sequence strip (upcoming bases are on the right). In portrait
 * the whole layout turns 90° so the flow runs bottom → top.
 */

export const PROPERTY_COLORS: Record<PropertyClass, number> = {
  hydrophobic: 0xe8b26a,
  polar: 0x5eead4,
  positive: 0x818cf8,
  negative: 0xf472b6,
};

const TWIST = (2 * Math.PI) / 10.5;
const DNA_Y = 3.0;
const POL_X = 3.6;
const MRNA_Y = 0;
const RIB_X = -1.4;
const EXIT = new THREE.Vector3(RIB_X - 0.15, -1.5, 0); // exit tunnel, under the large subunit
const STAGE = new THREE.Vector3(-5.9, -2.85, 0);
const STEP = 0.2; // scene units per base, DNA and mRNA
const DNA_WINDOW = 96; // bases drawn around the polymerase
const MRNA_TAIL = 30; // bases drawn after the ribosome
const ANGSTROM = 0.055; // scene units per ångström for the protein
const STAGED_SCALE = 1.2;
const BOUNDS = { minX: -8.6, maxX: 6.8, minY: -5.4, maxY: 4.3 }; // landscape layout extent

export interface SceneProtein {
  residues: string;
  fold: FoldResult;
  stopFound: boolean;
}

export class GeneScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
  private readonly orient = new THREE.Group();
  private readonly dnaSpheres: THREE.InstancedMesh;
  private readonly dnaRungs: THREE.InstancedMesh;
  private readonly mrnaBeads: THREE.InstancedMesh;
  private readonly mrnaLinks: THREE.InstancedMesh;
  private readonly beads: THREE.InstancedMesh;
  private readonly links: THREE.InstancedMesh;
  private readonly labels: { el: HTMLElement; at: () => THREE.Vector3 | null }[] = [];
  private readonly mrnaPath: THREE.CurvePath<THREE.Vector3>;
  private readonly ribDist: number; // path distance from polymerase exit to ribosome
  private readonly maxResidues: number;
  private readonly resizeObserver: ResizeObserver;

  private seq = '';
  private frameStart = 0;
  private protein: SceneProtein | null = null;
  private colors: THREE.Color[] = [];
  private released = 0;
  private yaw = 0;
  private pitch = 0.25;
  private dragging: { x: number; y: number } | null = null;

  // scratch
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qa = new THREE.Quaternion();
  private readonly qs = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly centroid = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private readonly white = new THREE.Color(0xffffff);
  private positions = new Float32Array(0);
  private static readonly UP = new THREE.Vector3(0, 1, 0);
  private static readonly ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  private static readonly AWAY = new THREE.Vector3(-0.5, -0.85, 0.2).normalize();

  constructor(
    private readonly container: HTMLElement,
    labelLayer: HTMLElement,
    opts: { small: boolean },
  ) {
    this.maxResidues = opts.small ? 800 : 1500;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.small ? 1.5 : 2));
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.classList.add('gene-canvas');
    container.prepend(this.canvas);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(3, 6, 10);
    const rim = new THREE.DirectionalLight(0x8ab4ff, 0.9);
    rim.position.set(-6, -4, -6);
    this.scene.add(key, rim, this.orient);

    const sphere = new THREE.SphereGeometry(1, 14, 10);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    const instanced = (geo: THREE.BufferGeometry, count: number) => {
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.06 }), count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, this.white);
      mesh.frustumCulled = false;
      this.orient.add(mesh);
      return mesh;
    };
    this.dnaSpheres = instanced(sphere, DNA_WINDOW * 2);
    this.dnaRungs = instanced(cyl, DNA_WINDOW * 2);

    // mRNA path: down out of the polymerase, round a corner, left through the ribosome and beyond.
    const p = (x: number, y: number) => new THREE.Vector3(x, y, 0);
    this.mrnaPath = new THREE.CurvePath<THREE.Vector3>();
    this.mrnaPath.add(new THREE.LineCurve3(p(POL_X - 0.15, DNA_Y - 0.75), p(POL_X - 0.15, MRNA_Y + 0.7)));
    this.mrnaPath.add(new THREE.QuadraticBezierCurve3(p(POL_X - 0.15, MRNA_Y + 0.7), p(POL_X - 0.15, MRNA_Y), p(POL_X - 0.85, MRNA_Y)));
    this.mrnaPath.add(new THREE.LineCurve3(p(POL_X - 0.85, MRNA_Y), p(RIB_X, MRNA_Y)));
    this.mrnaPath.add(new THREE.LineCurve3(p(RIB_X, MRNA_Y), p(RIB_X - MRNA_TAIL * STEP - 2, MRNA_Y)));
    this.ribDist = this.mrnaPath.getCurveLengths()[2];
    const mrnaCount = Math.ceil(this.ribDist / STEP) + MRNA_TAIL + 4;
    this.mrnaBeads = instanced(sphere, mrnaCount);
    this.mrnaLinks = instanced(cyl, mrnaCount);

    this.beads = instanced(sphere, this.maxResidues);
    this.links = instanced(cyl, this.maxResidues);

    // Machines: soft translucent bodies.
    const blob = (color: number, opacity: number, pos: THREE.Vector3, s: THREE.Vector3, glow = 0.35) => {
      const mesh = new THREE.Mesh(
        sphere,
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: glow, // keeps translucent bodies bright against the dark background
          roughness: 0.6,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      );
      mesh.position.copy(pos);
      mesh.scale.copy(s);
      mesh.renderOrder = 2;
      this.orient.add(mesh);
      return mesh;
    };
    blob(0xa78bfa, 0.3, new THREE.Vector3(POL_X, DNA_Y - 0.1, 0), new THREE.Vector3(1.0, 0.95, 0.85));
    // Ribosome: small subunit above the mRNA, large subunit below (the protein leaves from its underside).
    blob(0xfde4b8, 0.4, new THREE.Vector3(RIB_X, MRNA_Y + 0.46, 0), new THREE.Vector3(0.95, 0.46, 0.75), 0.7);
    blob(0xfcd9a0, 0.36, new THREE.Vector3(RIB_X, MRNA_Y - 0.74, 0), new THREE.Vector3(1.15, 0.78, 0.9), 0.7);

    // Floating labels, positioned by projecting points each frame.
    const label = (text: string, at: () => THREE.Vector3 | null) => {
      const el = document.createElement('span');
      el.className = 'scene-label';
      el.textContent = text;
      labelLayer.append(el);
      this.labels.push({ el, at });
    };
    label('DNA', () => new THREE.Vector3(POL_X + 2.4, DNA_Y + 0.75, 0));
    label('RNA polymerase', () => new THREE.Vector3(POL_X, DNA_Y + 1.15, 0));
    label('mRNA', () => new THREE.Vector3(POL_X - 2.2, MRNA_Y - 0.42, 0));
    label('Ribosome', () => new THREE.Vector3(RIB_X + 1.75, MRNA_Y + 0.55, 0));
    label('Protein', () => (this.protein && this.protein.residues.length ? this.proteinLabelPoint() : null));

    // Drag to turn the finished protein.
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.dragging.x) * 0.01;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + (e.clientY - this.dragging.y) * 0.01));
      this.dragging = { x: e.clientX, y: e.clientY };
    });
    const end = () => (this.dragging = null);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  setSequence(seq: string, frameStart: number): void {
    this.seq = seq;
    this.frameStart = frameStart;
  }

  setProtein(protein: SceneProtein | null): void {
    this.protein = protein;
    const n = protein ? Math.min(protein.residues.length, this.maxResidues) : 0;
    this.colors = protein ? Array.from(protein.residues.slice(0, n), (aa) => new THREE.Color(PROPERTY_COLORS[propertyClass(aa)])) : [];
    this.positions = new Float32Array(n * 3);
  }

  setVisible(visible: boolean): void {
    this.canvas.hidden = !visible;
    // three.js sets an inline display:block on its canvas, so `hidden` alone isn't enough.
    this.canvas.style.display = visible ? 'block' : 'none';
    for (const l of this.labels) l.el.hidden = !visible;
    if (visible) this.resize();
  }

  /** How far translation has got, in residues (fractional), from a base position. */
  private residuesMade(pos: number): number {
    return (pos - this.frameStart) / 3;
  }

  render(pos: number, hl: HelixHighlight | null, timeSec: number): void {
    const ribPos = pos;
    const polyPos = Math.min(this.seq.length, ribPos + this.ribDist / STEP);
    this.renderDna(polyPos);
    this.renderMrna(ribPos, polyPos, hl);
    this.renderProtein(this.residuesMade(pos), hl?.pulse ?? 0, timeSec);
    for (const mesh of [this.dnaSpheres, this.dnaRungs, this.mrnaBeads, this.mrnaLinks, this.beads, this.links]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  }

  // ---------- DNA: a twisted ladder that unzips inside the polymerase ----------
  private renderDna(polyPos: number): void {
    const start = Math.floor(polyPos) - DNA_WINDOW / 2;
    for (let k = 0; k < DNA_WINDOW; k++) {
      const i = start + k;
      if (i < 0 || i >= this.seq.length) {
        this.hide(this.dnaSpheres, 2 * k, 2 * k + 1);
        this.hide(this.dnaRungs, 2 * k, 2 * k + 1);
        continue;
      }
      const x = POL_X + (i - polyPos) * STEP;
      // Fade at the window ends and before the edge of the layout, so DNA never runs under the overlays.
      const fade = smoothstep(0, 12, Math.min(k, DNA_WINDOW - 1 - k)) * smoothstep(BOUNDS.maxX + 0.3, BOUNDS.maxX - 1.8, x);
      const open = Math.exp(-(((x - POL_X) / 0.75) ** 2)); // 1 inside the polymerase
      const r = 0.2 + 0.42 * open;
      const theta = i * TWIST * (1 - open);
      // Strand 0 = coding strand (top when open); strand 1 = template strand (bottom), read by the polymerase.
      this.a.set(x, DNA_Y + r * Math.cos(theta), r * Math.sin(theta));
      this.b.set(x, DNA_Y - r * Math.cos(theta), -r * Math.sin(theta));
      const base = this.seq[i];
      for (let s = 0; s < 2; s++) {
        const pt = s === 0 ? this.a : this.b;
        this.m.compose(pt, this.q.identity(), this.scale.setScalar(0.085 * fade));
        this.dnaSpheres.setMatrixAt(2 * k + s, this.m);
        this.dnaSpheres.setColorAt(2 * k + s, this.col.setHex(s === 0 ? 0xa5b4cf : 0x7f8db0));
      }
      // Half-rungs reach toward each other; they shrink apart as the strands separate.
      const reach = Math.min(r, 0.2);
      this.v.subVectors(this.b, this.a).normalize();
      this.center.copy(this.a).addScaledVector(this.v, reach);
      this.cylinder(this.dnaRungs, 2 * k, this.a, this.center, 0.045 * fade);
      this.center.copy(this.b).addScaledVector(this.v, -reach);
      this.cylinder(this.dnaRungs, 2 * k + 1, this.b, this.center, 0.045 * fade);
      this.dnaRungs.setColorAt(2 * k, this.col.setHex(BASE_COLORS[base] ?? BASE_COLORS.N));
      this.dnaRungs.setColorAt(2 * k + 1, this.col.setHex(BASE_COLORS[complement(base)] ?? BASE_COLORS.N));
    }
  }

  // ---------- mRNA: beads sliding along a fixed path, read at the ribosome ----------
  private renderMrna(ribPos: number, polyPos: number, hl: HelixHighlight | null): void {
    const count = this.mrnaBeads.count;
    const total = this.mrnaPath.getLength();
    const first = Math.ceil(ribPos - MRNA_TAIL);
    for (let k = 0; k < count; k++) {
      const j = first + k;
      // Base j sits at the ribosome when j == ribPos; earlier bases have moved further along.
      const dist = this.ribDist + (ribPos - j) * STEP;
      if (j < 0 || j >= polyPos || j >= this.seq.length || dist < 0 || dist > total) {
        this.hide(this.mrnaBeads, k);
        this.hide(this.mrnaLinks, k);
        continue;
      }
      this.mrnaPath.getPointAt(dist / total, this.a);
      const fade = smoothstep(0, 10, k);
      const active = hl !== null && j >= hl.start && j < hl.start + hl.length;
      const r = 0.07 * fade * (active ? 1.35 + 0.5 * hl!.pulse : 1);
      this.m.compose(this.a, this.q.identity(), this.scale.setScalar(r));
      this.mrnaBeads.setMatrixAt(k, this.m);
      this.col.setHex(BASE_COLORS[this.seq[j]] ?? BASE_COLORS.N); // U takes T's colour
      if (active) this.col.lerp(this.white, 0.2 + 0.5 * hl!.pulse);
      this.mrnaBeads.setColorAt(k, this.col);

      const nextDist = dist - STEP; // base j+1 is one step back along the path
      if (j + 1 < polyPos && nextDist >= 0) {
        this.mrnaPath.getPointAt(nextDist / total, this.b);
        this.cylinder(this.mrnaLinks, k, this.a, this.b, 0.025 * fade);
        this.mrnaLinks.setColorAt(k, this.col.setHex(0x9aa7bd));
      } else this.hide(this.mrnaLinks, k);
    }
  }

  // ---------- Protein: grows from the ribosome, folding as it goes ----------
  private renderProtein(made: number, pulse: number, timeSec: number): void {
    const p = this.protein;
    const n = p ? Math.min(p.residues.length, this.maxResidues) : 0;
    if (!p || n === 0 || made <= 0) {
      this.hide(this.beads, ...range(this.beads.count));
      this.hide(this.links, ...range(this.links.count));
      this.released = 0;
      return;
    }
    const e = Math.min(made, n);
    const { frames } = p.fold;
    // Fold progress follows how much of the chain exists.
    const phi = Math.pow(Math.min(1, e / n), 1.3) * (frames.length - 1);
    const f0 = Math.floor(phi);
    const f1 = Math.min(frames.length - 1, f0 + 1);
    const ft = phi - f0;
    const A = frames[f0];
    const B = frames[f1];
    const X = this.positions;
    for (let i = 0; i < n * 3; i++) X[i] = A[i] + (B[i] - A[i]) * ft;

    // Released into the "stage" once the stop codon has been read.
    this.released = p.stopFound ? easeInOut(Math.min(1, Math.max(0, made - n))) : 0;

    // Attached: newest residue at the ribosome exit, chain trailing away from it.
    const visible = Math.min(n, Math.ceil(e));
    const newest = Math.max(0, Math.min(n - 1, e - 1));
    const lo = Math.floor(newest);
    const hiIdx = Math.min(n - 1, lo + 1);
    const t = newest - lo;
    this.anchor.set(
      X[lo * 3] + (X[hiIdx * 3] - X[lo * 3]) * t,
      X[lo * 3 + 1] + (X[hiIdx * 3 + 1] - X[lo * 3 + 1]) * t,
      X[lo * 3 + 2] + (X[hiIdx * 3 + 2] - X[lo * 3 + 2]) * t,
    );
    this.centroidOf(X, visible);
    this.v.subVectors(this.centroid, this.anchor);
    if (this.v.lengthSq() > 4) this.qa.setFromUnitVectors(this.v.normalize(), GeneScene.AWAY);
    else this.qa.identity();

    // Staged: centred, larger, turning slowly; drag to rotate.
    this.centroidOf(X, n);
    const stagedCentroid = this.b.copy(this.centroid);
    this.e.set(this.pitch, this.yaw + timeSec * 0.25, 0);
    this.qs.setFromEuler(this.e);

    const rel = this.released;
    const newestIdx = Math.floor(Math.max(0, Math.min(n - 1, e)));
    for (let i = 0; i < n; i++) {
      if (i >= visible) {
        this.hide(this.beads, i);
        this.hide(this.links, i);
        continue;
      }
      this.residuePoint(i, X, stagedCentroid, rel, this.a);
      const growing = i === visible - 1 && e < n ? Math.max(0.15, e - Math.floor(e) || 1) : 1;
      const isNewest = rel === 0 && i === newestIdx;
      // Beads and links share a radius, so the chain reads as one continuous tube.
      const tube = 1.25 * ANGSTROM * (rel > 0 ? 1 + (STAGED_SCALE - 1) * rel : 1);
      const radius = tube * growing * (isNewest ? 1.8 + 0.8 * pulse : 1);
      this.m.compose(this.a, this.q.identity(), this.scale.setScalar(radius));
      this.beads.setMatrixAt(i, this.m);
      this.col.copy(this.colors[i]);
      if (isNewest) this.col.lerp(this.white, 0.35 + 0.5 * pulse);
      this.beads.setColorAt(i, this.col);

      if (i + 1 < visible) {
        this.residuePoint(i + 1, X, stagedCentroid, rel, this.v);
        this.cylinder(this.links, i, this.a, this.v, tube);
        this.links.setColorAt(i, this.colors[i]);
      } else this.hide(this.links, i);
    }
  }

  /** Scene position of residue i, blended between attached-to-ribosome and staged. */
  private residuePoint(i: number, X: Float32Array, stagedCentroid: THREE.Vector3, rel: number, out: THREE.Vector3) {
    const x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2];
    // attached
    out.set(x - this.anchor.x, y - this.anchor.y, z - this.anchor.z).applyQuaternion(this.qa).multiplyScalar(ANGSTROM).add(EXIT);
    if (rel <= 0) return out;
    // staged
    const sx = x - stagedCentroid.x, sy = y - stagedCentroid.y, sz = z - stagedCentroid.z;
    this.center.set(sx, sy, sz).applyQuaternion(this.qs).multiplyScalar(ANGSTROM * STAGED_SCALE).add(STAGE);
    return out.lerp(this.center, rel);
  }

  private centroidOf(X: Float32Array, count: number): void {
    this.centroid.set(0, 0, 0);
    if (count <= 0) return;
    for (let i = 0; i < count; i++) this.centroid.x += X[i * 3], this.centroid.y += X[i * 3 + 1], this.centroid.z += X[i * 3 + 2];
    this.centroid.divideScalar(count);
  }

  private proteinLabelPoint(): THREE.Vector3 {
    const attached = EXIT.clone().add(new THREE.Vector3(1.1, -0.9, 0));
    const staged = STAGE.clone().add(new THREE.Vector3(2.7, 0.4, 0));
    return new THREE.Vector3().lerpVectors(attached, staged, this.released);
  }

  private placeLabels(): void {
    if (this.canvas.hidden) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.orient.updateMatrixWorld();
    for (const { el, at } of this.labels) {
      const p = at();
      if (!p) {
        el.style.opacity = '0';
        continue;
      }
      p.applyMatrix4(this.orient.matrixWorld).project(this.camera);
      el.style.opacity = '';
      // Keep labels fully inside the frame.
      const hw = el.offsetWidth / 2 + 6;
      const hh = el.offsetHeight / 2 + 6;
      const sx = Math.min(w - hw, Math.max(hw, ((p.x + 1) / 2) * w));
      const sy = Math.min(h - hh, Math.max(hh, ((1 - p.y) / 2) * h));
      el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
    }
  }

  private cylinder(mesh: THREE.InstancedMesh, index: number, from: THREE.Vector3, to: THREE.Vector3, radius: number) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6 || radius <= 0) return this.hide(mesh, index);
    this.scale.set(dx / len, dy / len, dz / len);
    this.q.setFromUnitVectors(GeneScene.UP, this.scale);
    this.center.set(from.x + dx / 2, from.y + dy / 2, from.z + dz / 2);
    this.m.compose(this.center, this.q, this.scale.set(radius, len, radius));
    mesh.setMatrixAt(index, this.m);
  }

  private hide(mesh: THREE.InstancedMesh, ...indices: number[]) {
    for (const i of indices) mesh.setMatrixAt(i, GeneScene.ZERO);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const portrait = aspect < 1;
    // Portrait: turn the layout so the flow runs bottom → top (upcoming bases below).
    this.orient.rotation.z = portrait ? -Math.PI / 2 : 0;
    const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
    const cy = (BOUNDS.minY + BOUNDS.maxY) / 2;
    const halfLong = (BOUNDS.maxX - BOUNDS.minX) / 2;
    const halfShort = (BOUNDS.maxY - BOUNDS.minY) / 2;
    const halfW = portrait ? halfShort : halfLong;
    // Leave a strip at the bottom for the legend and caveat (taller on narrow screens, where they stack).
    const inset = w < 600 ? 0.2 : 0.07;
    const halfH = (portrait ? halfLong : halfShort) / (1 - inset);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = Math.max(halfH / tanHalf, halfW / (tanHalf * aspect)) * 1.04;
    // Centre of the layout after rotation: (x, y) → (y, -x) in portrait; shift down to clear the inset.
    const wx = portrait ? cy : cx;
    const wy = (portrait ? -cx : cy) - inset * dist * tanHalf;
    this.camera.position.set(wx, wy + dist * 0.06, dist);
    this.camera.lookAt(wx, wy, 0);
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

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}
