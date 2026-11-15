import * as THREE from 'three';
import type { FoldResult } from '../core/fold';
import { propertyClass, type PropertyClass } from '../core/protein';
import { easeInOut, hideInstances, makeInstanced, markDirty, range, setCylinder, setSphere } from './sceneUtils';

/**
 * The growing protein, shared by the 3D scenes: one bead per residue joined into a
 * tube, coloured by amino-acid property. It grows from the ribosome's exit, folds
 * along the precomputed fold trajectory as it lengthens, and once the stop codon
 * is read it is released and settles, larger and slowly turning, at a stage point.
 */

export const PROPERTY_COLORS: Record<PropertyClass, number> = {
  hydrophobic: 0xe8b26a,
  polar: 0x5eead4,
  positive: 0x818cf8,
  negative: 0xf472b6,
};

export interface SceneProtein {
  residues: string;
  fold: FoldResult;
  stopFound: boolean;
}

/** Where the chain lives in its scene. Points are in the parent's coordinates. */
export interface ProteinLayout {
  /** The ribosome's exit tunnel: the newest residue sits here. */
  exit: THREE.Vector3;
  /** Unit direction the grown chain trails away from the exit. */
  away: THREE.Vector3;
  /** Where the finished protein settles once released. */
  stage: THREE.Vector3;
  /** Scene units per ångström. */
  angstrom: number;
  /** How much larger the protein is once released. */
  stagedScale: number;
}

export class ProteinChain {
  readonly beads: THREE.InstancedMesh;
  readonly links: THREE.InstancedMesh;
  /** 0 while attached to the ribosome, easing to 1 once released. */
  released = 0;

  private protein: SceneProtein | null = null;
  private colors: THREE.Color[] = [];
  private positions = new Float32Array(0);

  // scratch
  private readonly a = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly centroid = new THREE.Vector3();
  private readonly stagedCentroid = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly qa = new THREE.Quaternion();
  private readonly qs = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly col = new THREE.Color();
  private readonly white = new THREE.Color(0xffffff);

  constructor(
    parent: THREE.Object3D,
    sphere: THREE.BufferGeometry,
    cylinder: THREE.BufferGeometry,
    private readonly maxResidues: number,
    public layout: ProteinLayout,
  ) {
    this.beads = makeInstanced(sphere, maxResidues, parent);
    this.links = makeInstanced(cylinder, maxResidues, parent);
  }

  get hasResidues(): boolean {
    return !!this.protein && this.protein.residues.length > 0;
  }

  setProtein(protein: SceneProtein | null): void {
    this.protein = protein;
    const n = protein ? Math.min(protein.residues.length, this.maxResidues) : 0;
    this.colors = protein ? Array.from(protein.residues.slice(0, n), (aa) => new THREE.Color(PROPERTY_COLORS[propertyClass(aa)])) : [];
    this.positions = new Float32Array(n * 3);
    // Only slots below n are drawn from now on, so clear any left over from a longer protein.
    this.clear();
  }

  /**
   * Draw the chain. `made` is how far translation has got, in residues (fractional);
   * `yaw`/`pitch` turn the released protein (plus a slow spin over time).
   */
  render(made: number, pulse: number, timeSec: number, yaw: number, pitch: number): void {
    const p = this.protein;
    const n = p ? Math.min(p.residues.length, this.maxResidues) : 0;
    if (!p || n === 0 || made <= 0) {
      this.clear();
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

    // Released once the stop codon has been read.
    this.released = p.stopFound ? easeInOut(Math.min(1, Math.max(0, made - n))) : 0;

    // Attached: newest residue at the exit, the rest of the chain trailing away from it.
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
    this.centroidOf(X, visible, this.centroid);
    this.v.subVectors(this.centroid, this.anchor);
    if (this.v.lengthSq() > 4) this.qa.setFromUnitVectors(this.v.normalize(), this.layout.away);
    else this.qa.identity();

    // Staged: centred, larger, turning slowly.
    this.centroidOf(X, n, this.stagedCentroid);
    this.e.set(pitch, yaw + timeSec * 0.25, 0);
    this.qs.setFromEuler(this.e);

    const rel = this.released;
    const newestIdx = Math.floor(Math.max(0, Math.min(n - 1, e)));
    const { angstrom, stagedScale } = this.layout;
    for (let i = 0; i < n; i++) {
      if (i >= visible) {
        hideInstances(this.beads, i);
        hideInstances(this.links, i);
        continue;
      }
      this.residuePoint(i, X, rel, this.a);
      const growing = i === visible - 1 && e < n ? Math.max(0.15, e - Math.floor(e) || 1) : 1;
      const isNewest = rel === 0 && i === newestIdx;
      // Beads and links share a radius, so the chain reads as one continuous tube.
      const tube = 1.25 * angstrom * (rel > 0 ? 1 + (stagedScale - 1) * rel : 1);
      setSphere(this.beads, i, this.a, tube * growing * (isNewest ? 1.8 + 0.8 * pulse : 1));
      this.col.copy(this.colors[i]);
      if (isNewest) this.col.lerp(this.white, 0.35 + 0.5 * pulse);
      this.beads.setColorAt(i, this.col);

      if (i + 1 < visible) {
        this.residuePoint(i + 1, X, rel, this.v);
        setCylinder(this.links, i, this.a, this.v, tube);
        this.links.setColorAt(i, this.colors[i]);
      } else hideInstances(this.links, i);
    }
    markDirty(this.beads, this.links);
  }

  /** A point for the "Protein" label: offset from the exit while attached, from the stage once released. */
  labelPoint(attachedOffset: THREE.Vector3, stagedOffset: THREE.Vector3): THREE.Vector3 {
    const attached = this.layout.exit.clone().add(attachedOffset);
    const staged = this.layout.stage.clone().add(stagedOffset);
    return new THREE.Vector3().lerpVectors(attached, staged, this.released);
  }

  private clear(): void {
    hideInstances(this.beads, ...range(this.beads.count));
    hideInstances(this.links, ...range(this.links.count));
    markDirty(this.beads, this.links);
  }

  /** Scene position of residue i, blended between attached-to-ribosome and staged. */
  private residuePoint(i: number, X: Float32Array, rel: number, out: THREE.Vector3): THREE.Vector3 {
    const x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2];
    const { exit, stage, angstrom, stagedScale } = this.layout;
    out.set(x - this.anchor.x, y - this.anchor.y, z - this.anchor.z).applyQuaternion(this.qa).multiplyScalar(angstrom).add(exit);
    if (rel <= 0) return out;
    const c = this.stagedCentroid;
    this.center.set(x - c.x, y - c.y, z - c.z).applyQuaternion(this.qs).multiplyScalar(angstrom * stagedScale).add(stage);
    return out.lerp(this.center, rel);
  }

  private centroidOf(X: Float32Array, count: number, out: THREE.Vector3): void {
    out.set(0, 0, 0);
    if (count <= 0) return;
    for (let i = 0; i < count; i++) out.x += X[i * 3], out.y += X[i * 3 + 1], out.z += X[i * 3 + 2];
    out.divideScalar(count);
  }
}
