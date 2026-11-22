import * as THREE from 'three';
import { complement } from '../core/genetics';
import { type HelixHighlight } from './helix';
import { backboneColor, baseColor, dnaScale, floorLight, fogColor, mrnaLinkColor, rungColor } from './look';
import { ProteinChain, type SceneProtein } from './proteinChain';
import {
  addZoomControls,
  dnaBaseAt,
  hideInstances,
  makeInstanced,
  markDirty,
  radialTexture,
  setCylinder,
  setSphere,
  smoothstep,
  UP,
} from './sceneUtils';
import {
  BLOCK_EFFECTS,
  RIBOSOME_LOOKS,
  type BlockEffectId,
  type BlockEffectInstance,
  type RibosomeLookId,
  type RibosomeSubunit,
} from './towerLooks';

/**
 * The 3D scene: the gene-to-protein story built as a tower. The DNA stands
 * upright as a wiggly supercoil and feeds up through the RNA polymerase; the
 * mRNA spirals down around it to the ribosome; the protein grows from the
 * ribosome and folds. The camera slowly circles.
 *
 * Like the other views, every frame is a function of the playhead, so seeking
 * just works. Only the ambient motion (sway, orbit, drifting blocks) follows
 * the clock.
 *
 * Looks are switchable through `TowerOptions`; the lists of ribosome looks and
 * block effects live in towerLooks.ts.
 */

export interface TowerOptions {
  ribosome: RibosomeLookId;
  /** 'up' is the textbook orientation: small subunit under the mRNA, large on top, protein leaving upwards. */
  proteinDirection: 'up' | 'down';
  /** 'orbit': the camera circles. 'spin': the camera holds still and the DNA turns on its own axis. */
  motion: 'orbit' | 'spin';
  blocks: BlockEffectId;
  /** A pool of darkness above the tower, the floor's opposite; the DNA fades into it. */
  ceiling: boolean;
  /** A softly glowing floor the tower rises from. */
  floor: boolean;
}

export const DEFAULT_TOWER_OPTIONS: TowerOptions = {
  ribosome: 'prism',
  proteinDirection: 'up',
  motion: 'orbit',
  blocks: 'plain',
  ceiling: true,
  floor: true,
};

// Layout, in scene units. The tower's axis is the y axis.
const STEP = 0.1; // per base, DNA and mRNA
const TWIST = (2 * Math.PI) / 10.5;
const DNA_R = 0.22;
const Y_P = 2.4; // polymerase height
const Y_BOTTOM = -5.6;
const Y_TOP = 6.6;
const P = new THREE.Vector3(0, Y_P, 0);
const DNA_WINDOW = Math.ceil((Y_TOP - Y_BOTTOM) / STEP) + 2;
const MRNA_TAIL = 40; // bases drawn after the ribosome
const SMALL = { r: new THREE.Vector3(0.9, 0.44, 0.72), y: 0.44 };
const LARGE = { r: new THREE.Vector3(1.1, 0.7, 0.9), y: 0.66 };
const EXIT_Y = 1.25; // exit tunnel, at the far side of the large subunit
const PLATE_R = 6; // floor and ceiling radius
const ORBIT_SPEED = 0.14; // radians per second
const SPIN_SPEED = 0.45;

/** Centre line of the DNA at distance s from the polymerase (s > 0: above, already read). */
function dnaCentre(s: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  const y = Y_P + s;
  // Supercoil: a loose spring that winds one way above the polymerase and the other way below.
  const R = 0.95 * smoothstep(0.5, 2.3, Math.abs(s));
  const ph = (s > 0 ? 1.7 : -1.7) * s + 0.5 * t;
  // Wiggle: slow sideways waves; straight where the polymerase grips.
  const w = smoothstep(0.4, 2.0, Math.abs(s));
  return out.set(
    R * Math.cos(ph) + w * 0.75 * Math.sin(0.85 * y - 1.4 * t),
    y,
    R * Math.sin(ph) + w * 0.62 * Math.cos(0.62 * y - 1.0 * t + 1),
  );
}

export class TowerScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  private readonly root = new THREE.Group();
  private readonly dnaSpheres: THREE.InstancedMesh;
  private readonly dnaRungs: THREE.InstancedMesh;
  private readonly mrnaBeads: THREE.InstancedMesh;
  private readonly mrnaLinks: THREE.InstancedMesh;
  private readonly chain: ProteinChain;
  private readonly mrnaPath: THREE.CatmullRomCurve3;
  private readonly mrnaLength: number;
  private readonly ribDist: number; // path distance from the polymerase to the ribosome
  private readonly rib: THREE.Vector3;
  private readonly ribQ: THREE.Quaternion;
  private readonly ribX: THREE.Vector3; // along the mRNA
  private readonly ribY: THREE.Vector3; // up
  private readonly ribZ: THREE.Vector3;
  private readonly outward: THREE.Vector3; // horizontal, from the tower's axis to the ribosome
  private readonly floor: THREE.Mesh;
  private readonly ceiling: THREE.Mesh;
  private readonly floorLight = new THREE.PointLight(floorLight().light, 0, 9);
  private readonly ceilingLight = new THREE.PointLight(0xffffff, 0, 8); // negative: takes light away
  private readonly labels: { el: HTMLElement; at: () => THREE.Vector3 | null }[] = [];
  private readonly resizeObserver: ResizeObserver;

  private options: TowerOptions = { ...DEFAULT_TOWER_OPTIONS };
  private subunits: { small: RibosomeSubunit; large: RibosomeSubunit } | null = null;
  private blocks: BlockEffectInstance | null = null;
  private seq = '';
  private frameStart = 0;
  private lastTime = -1;
  private yaw = 0;
  private pitch = 0;
  private dist = 20;
  private target = new THREE.Vector3(0, 0.5, 0);
  private dragging: { x: number; y: number } | null = null;

  // scratch
  private readonly centres = Array.from({ length: DNA_WINDOW }, () => new THREE.Vector3());
  private readonly tangents = Array.from({ length: DNA_WINDOW }, () => new THREE.Vector3());
  private readonly normals = Array.from({ length: DNA_WINDOW }, () => new THREE.Vector3());
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly bin = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly col = new THREE.Color();
  private readonly white = new THREE.Color(0xffffff);
  private readonly black = new THREE.Color(0x05070c);
  private static readonly X = new THREE.Vector3(1, 0, 0);

  constructor(
    private readonly container: HTMLElement,
    labelLayer: HTMLElement,
    opts: { small: boolean; options?: Partial<TowerOptions> },
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.small ? 1.5 : 2));
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.classList.add('gene-canvas');
    container.prepend(this.canvas);

    this.scene.fog = new THREE.Fog(fogColor(), 18, 40);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(3, 6, 10);
    const rim = new THREE.DirectionalLight(0x8ab4ff, 0.9);
    rim.position.set(-6, -4, -6);
    this.floorLight.position.set(0, Y_BOTTOM + 0.8, 0);
    this.ceilingLight.position.set(0, Y_TOP - 0.4, 0);
    this.scene.add(key, rim, this.floorLight, this.ceilingLight, this.root);

    const sphere = new THREE.SphereGeometry(1, 14, 10);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    this.dnaSpheres = makeInstanced(sphere, DNA_WINDOW * 2, this.root, { dna: true });
    this.dnaRungs = makeInstanced(cyl, DNA_WINDOW * 2, this.root, { dna: true });

    // RNA polymerase: a soft translucent body around the DNA.
    const polymerase = new THREE.Mesh(
      sphere,
      new THREE.MeshStandardMaterial({ color: 0xa78bfa, emissive: 0xa78bfa, emissiveIntensity: 0.4, roughness: 0.6, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    polymerase.position.copy(P);
    polymerase.scale.setScalar(0.7);
    polymerase.renderOrder = 2;
    this.root.add(polymerase);

    // mRNA: spirals down around the tower from the polymerase to the ribosome, then trails away.
    const pts = [P.clone()];
    for (let k = 1; k <= 9; k++) {
      const ang = k * 0.72, r = 0.6 + k * 0.24, y = Y_P - 0.25 - k * 0.55;
      pts.push(new THREE.Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r));
    }
    this.rib = pts[pts.length - 1].clone();
    this.outward = new THREE.Vector3(this.rib.x, 0, this.rib.z).normalize();
    pts.push(this.rib.clone().addScaledVector(this.outward, 1.8).add(new THREE.Vector3(0, -0.4, 0)));
    pts.push(this.rib.clone().addScaledVector(this.outward, 4.2).add(new THREE.Vector3(0, -0.8, 0)));
    this.mrnaPath = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.mrnaLength = this.mrnaPath.getLength();
    let best = Infinity;
    let ribDist = 0;
    for (let k = 0; k <= 800; k++) {
      const d = this.mrnaPath.getPointAt(k / 800).distanceTo(this.rib);
      if (d < best) { best = d; ribDist = (k / 800) * this.mrnaLength; }
    }
    this.ribDist = ribDist;
    const mrnaCount = Math.ceil(this.ribDist / STEP) + MRNA_TAIL + 4;
    this.mrnaBeads = makeInstanced(sphere, mrnaCount, this.root, { dna: true });
    this.mrnaLinks = makeInstanced(cyl, mrnaCount, this.root, { dna: true });

    // The ribosome's own frame: x along the mRNA, y up, z across.
    this.ribX = this.mrnaPath.getTangentAt(this.ribDist / this.mrnaLength).normalize();
    this.ribY = UP.clone().addScaledVector(this.ribX, -UP.dot(this.ribX)).normalize();
    this.ribZ = this.ribX.clone().cross(this.ribY).normalize();
    this.ribQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(this.ribX, this.ribY, this.ribZ));

    this.chain = new ProteinChain(this.root, sphere, cyl, opts.small ? 800 : 1500, {
      exit: new THREE.Vector3(),
      away: new THREE.Vector3(0, 1, 0),
      stage: new THREE.Vector3(),
      angstrom: 0.045,
      stagedScale: 1.2,
    });

    // Floor and ceiling: the same rings, one glowing and one dark.
    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(PLATE_R, 64),
      new THREE.MeshBasicMaterial({
        map: radialTexture(floorLight().glow, [34, 64, 94], floorLight().ring),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = Y_BOTTOM - 0.1;
    this.ceiling = new THREE.Mesh(
      new THREE.CircleGeometry(PLATE_R, 64),
      new THREE.MeshBasicMaterial({
        map: radialTexture([[0, 'rgba(2, 3, 8, 0.97)'], [0.35, 'rgba(3, 5, 12, 0.7)'], [1, 'rgba(10, 14, 22, 0)']], [34, 64, 94], 'rgba(0, 0, 0, 0.5)'),
        transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }),
    );
    this.ceiling.rotation.x = Math.PI / 2;
    this.ceiling.position.y = Y_TOP + 0.1;
    this.ceiling.renderOrder = 3;
    this.root.add(this.floor, this.ceiling);

    // Floating labels, positioned by projecting points each frame.
    const label = (text: string, at: () => THREE.Vector3 | null) => {
      const el = document.createElement('span');
      el.className = 'scene-label';
      el.textContent = text;
      el.hidden = true;
      labelLayer.append(el);
      this.labels.push({ el, at });
    };
    label('DNA', () => new THREE.Vector3(0.9, Y_P + 2.8, 0));
    label('RNA polymerase', () => P.clone().add(new THREE.Vector3(0, 0.95, 0)));
    label('mRNA', () => this.mrnaPath.getPointAt((this.ribDist * 0.55) / this.mrnaLength).add(new THREE.Vector3(0, 0.35, 0)));
    label('Ribosome', () => this.rib.clone().add(new THREE.Vector3(0, this.options.proteinDirection === 'up' ? -1.25 : 1.25, 0)));
    label('Protein', () =>
      this.chain.hasResidues ? this.chain.labelPoint(this.chain.layout.away.clone().multiplyScalar(1.4).addScaledVector(this.outward, 0.8), new THREE.Vector3(0, 1.9, 0)) : null,
    );

    // Drag to look around.
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw -= (e.clientX - this.dragging.x) * 0.006;
      this.pitch = Math.max(-0.9, Math.min(0.9, this.pitch + (e.clientY - this.dragging.y) * 0.006));
      this.dragging = { x: e.clientX, y: e.clientY };
    });
    const end = () => (this.dragging = null);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    addZoomControls(this.canvas, this.camera, () => (this.dragging = null));

    this.setOptions(opts.options ?? {});
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  get currentOptions(): Readonly<TowerOptions> {
    return this.options;
  }

  /** Change any of the looks; unspecified options keep their current values. */
  setOptions(next: Partial<TowerOptions>): void {
    const prev = this.options;
    this.options = { ...prev, ...next };
    const o = this.options;

    if (!this.subunits || o.ribosome !== prev.ribosome) {
      for (const s of this.subunits ? [this.subunits.small, this.subunits.large] : []) s.object.removeFromParent();
      const look = RIBOSOME_LOOKS[o.ribosome];
      this.subunits = { small: look.build(true), large: look.build(false) };
      for (const s of [this.subunits.small, this.subunits.large]) this.root.add(s.object);
    }

    // Textbook ("up"): small subunit under the mRNA, large on top, protein out of the top.
    const side = o.proteinDirection === 'up' ? 1 : -1;
    const place = (s: RibosomeSubunit, size: { r: THREE.Vector3; y: number }, y: number) => {
      s.object.position.copy(this.ribLocal(0, y, 0));
      s.object.quaternion.copy(this.ribQ);
      s.object.scale.copy(size.r);
    };
    place(this.subunits.small, SMALL, -side * SMALL.y);
    place(this.subunits.large, LARGE, side * LARGE.y);
    const away = new THREE.Vector3(this.outward.x * (side > 0 ? 0.45 : 0.3), side, this.outward.z * (side > 0 ? 0.45 : 0.3)).normalize();
    this.chain.layout = {
      ...this.chain.layout,
      exit: this.ribLocal(0, side * EXIT_Y, 0),
      away,
      // The finished protein settles beside the tower: above the ribosome when it grows up, below when it grows down.
      stage: this.outward.clone().multiplyScalar(3.9).setY(side > 0 ? 0.9 : Y_BOTTOM + 1.6),
    };

    this.floor.visible = o.floor;
    this.floorLight.intensity = o.floor ? 0.9 : 0;
    this.ceiling.visible = o.ceiling;
    this.ceilingLight.intensity = o.ceiling ? -1.0 : 0;

    if (o.blocks !== prev.blocks || (!this.blocks && o.blocks !== 'off')) {
      this.blocks?.dispose();
      this.blocks = BLOCK_EFFECTS[o.blocks].create({
        parent: this.root,
        target: P,
        bottom: Y_BOTTOM,
        top: Y_TOP,
        radius: 7,
        dimAt: (y) => this.darkAt(y),
      });
    }
  }

  setSequence(seq: string, frameStart: number): void {
    this.seq = seq;
    this.frameStart = frameStart;
  }

  setProtein(protein: SceneProtein | null): void {
    this.chain.setProtein(protein);
  }

  setVisible(visible: boolean): void {
    this.canvas.hidden = !visible;
    // three.js sets an inline display:block on its canvas, so `hidden` alone isn't enough.
    this.canvas.style.display = visible ? 'block' : 'none';
    for (const l of this.labels) l.el.hidden = !visible;
    if (visible) this.resize();
  }

  render(pos: number, hl: HelixHighlight | null, timeSec: number): void {
    const dt = this.lastTime < 0 ? 0 : Math.min(0.05, Math.max(0, timeSec - this.lastTime));
    this.lastTime = timeSec;
    const pulse = hl?.pulse ?? 0;
    const ribPos = pos;
    // Not clamped: past the end of the gene the polymerase keeps moving along the grey flanking DNA.
    const polyPos = ribPos + this.ribDist / STEP;
    const spin = this.options.motion === 'spin' ? timeSec * SPIN_SPEED : 0;

    this.renderDna(polyPos, timeSec, spin);
    this.renderMrna(ribPos, polyPos, hl);
    this.chain.render((pos - this.frameStart) / 3, pulse, timeSec, 0, 0.25);
    this.subunits?.small.tick?.(timeSec, pulse);
    this.subunits?.large.tick?.(timeSec, pulse);
    this.blocks?.update(dt, timeSec);
    markDirty(this.dnaSpheres, this.dnaRungs, this.mrnaBeads, this.mrnaLinks);

    this.placeCamera(timeSec);
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  }

  // ---------- DNA: a wiggly supercoiled tower that unzips inside the polymerase ----------
  private renderDna(polyPos: number, t: number, spin: number): void {
    const start = Math.floor(polyPos - (Y_TOP - Y_P) / STEP);
    const n = DNA_WINDOW;
    for (let k = 0; k < n; k++) dnaCentre((polyPos - (start + k)) * STEP, t, this.centres[k]);
    for (let k = 0; k < n; k++) {
      this.tangents[k].subVectors(this.centres[Math.min(n - 1, k + 1)], this.centres[Math.max(0, k - 1)]).normalize();
    }
    // Frames carried smoothly outward from the polymerase, so the strands never flip.
    const k0 = Math.max(0, Math.min(n - 1, Math.round(polyPos - start)));
    this.normals[k0].crossVectors(this.tangents[k0], TowerScene.X).normalize();
    const carry = (from: number, to: number) => {
      this.q.setFromUnitVectors(this.tangents[from], this.tangents[to]);
      const nn = this.normals[to].copy(this.normals[from]).applyQuaternion(this.q);
      nn.addScaledVector(this.tangents[to], -nn.dot(this.tangents[to])).normalize();
    };
    for (let k = k0 + 1; k < n; k++) carry(k - 1, k);
    for (let k = k0 - 1; k >= 0; k--) carry(k + 1, k);

    for (let k = 0; k < n; k++) {
      const i = start + k;
      const { base, flank } = dnaBaseAt(this.seq, i);
      const s = (polyPos - i) * STEP;
      const c = this.centres[k];
      const nrm = this.normals[k];
      this.bin.crossVectors(this.tangents[k], nrm);
      const fade = smoothstep(0, 1.0, Math.min(c.y - Y_BOTTOM, Y_TOP - c.y));
      const dark = this.darkAt(c.y);
      const open = 1 - smoothstep(0.35, 0.6, Math.abs(s)); // 1 inside the polymerase
      const sizes = dnaScale();
      const r = DNA_R * sizes.radius * (1 + open * 0.9);
      const th = i * TWIST;
      this.a.copy(c).addScaledVector(nrm, Math.cos(th) * r).addScaledVector(this.bin, Math.sin(th) * r);
      this.b.copy(c).addScaledVector(nrm, Math.cos(th + 2.4) * r).addScaledVector(this.bin, Math.sin(th + 2.4) * r);
      if (spin) {
        this.a.applyAxisAngle(UP, spin);
        this.b.applyAxisAngle(UP, spin);
      }
      setSphere(this.dnaSpheres, 2 * k, this.a, 0.07 * sizes.bead * fade);
      setSphere(this.dnaSpheres, 2 * k + 1, this.b, 0.07 * sizes.bead * fade);
      this.dnaSpheres.setColorAt(2 * k, backboneColor(i, 0, flank, this.col).lerp(this.black, dark * 0.9));
      this.dnaSpheres.setColorAt(2 * k + 1, backboneColor(i, 1, flank, this.col).lerp(this.black, dark * 0.9));
      // Half-rungs: each base reaches to the middle, coloured by its base; they part inside the polymerase.
      if (open > 0.3 || fade <= 0) {
        hideInstances(this.dnaRungs, 2 * k, 2 * k + 1);
        continue;
      }
      this.mid.addVectors(this.a, this.b).multiplyScalar(0.5);
      setCylinder(this.dnaRungs, 2 * k, this.a, this.mid, 0.035 * sizes.rung * fade);
      setCylinder(this.dnaRungs, 2 * k + 1, this.b, this.mid, 0.035 * sizes.rung * fade);
      this.dnaRungs.setColorAt(2 * k, rungColor(base, flank, this.col).lerp(this.black, dark * 0.9));
      this.dnaRungs.setColorAt(2 * k + 1, rungColor(complement(base), flank, this.col).lerp(this.black, dark * 0.9));
    }
  }

  // ---------- mRNA: beads sliding along the spiral, read at the ribosome ----------
  private renderMrna(ribPos: number, polyPos: number, hl: HelixHighlight | null): void {
    const count = this.mrnaBeads.count;
    const first = Math.ceil(ribPos - MRNA_TAIL);
    for (let k = 0; k < count; k++) {
      const j = first + k;
      // Base j sits at the ribosome when j == ribPos; later bases are further back up the spiral.
      const dist = this.ribDist + (ribPos - j) * STEP;
      if (j < 0 || j >= polyPos || j >= this.seq.length || dist < 0 || dist > this.mrnaLength) {
        hideInstances(this.mrnaBeads, k);
        hideInstances(this.mrnaLinks, k);
        continue;
      }
      this.mrnaPath.getPointAt(dist / this.mrnaLength, this.a);
      const fade = smoothstep(0, 10, k);
      const active = hl !== null && j >= hl.start && j < hl.start + hl.length;
      setSphere(this.mrnaBeads, k, this.a, 0.055 * dnaScale().bead * fade * (active ? 1.35 + 0.5 * hl!.pulse : 1));
      this.col.setHex(baseColor(this.seq[j])); // U takes T's colour
      if (active) this.col.lerp(this.white, 0.2 + 0.5 * hl!.pulse);
      this.mrnaBeads.setColorAt(k, this.col);
      const nextDist = dist - STEP;
      if (j + 1 < polyPos && j + 1 < this.seq.length && nextDist >= 0) {
        this.mrnaPath.getPointAt(nextDist / this.mrnaLength, this.b);
        setCylinder(this.mrnaLinks, k, this.a, this.b, 0.02 * dnaScale().thread * fade);
        this.mrnaLinks.setColorAt(k, mrnaLinkColor(j, this.col));
      } else hideInstances(this.mrnaLinks, k);
    }
  }

  /** 0 away from the dark ceiling, rising to 1 right under it. */
  private darkAt(y: number): number {
    return this.options.ceiling ? smoothstep(Y_TOP - 2.6, Y_TOP, y) : 0;
  }

  private ribLocal(x: number, y: number, z: number): THREE.Vector3 {
    return this.rib.clone().addScaledVector(this.ribX, x).addScaledVector(this.ribY, y).addScaledVector(this.ribZ, z);
  }

  private placeCamera(timeSec: number): void {
    // Orbit: circle slowly. Spin: hold still, looking at the ribosome from slightly to one side.
    const base = this.options.motion === 'orbit' ? timeSec * ORBIT_SPEED : Math.atan2(this.outward.x, this.outward.z) + 0.45;
    const az = base + this.yaw;
    const el = 0.12 + this.pitch;
    const horiz = Math.cos(el) * this.dist;
    this.camera.position.set(
      this.target.x + Math.sin(az) * horiz,
      this.target.y + Math.sin(el) * this.dist,
      this.target.z + Math.cos(az) * horiz,
    );
    this.camera.lookAt(this.target);
  }

  private placeLabels(): void {
    if (this.canvas.hidden) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    for (const { el, at } of this.labels) {
      const p = at();
      if (!p) {
        el.style.opacity = '0';
        continue;
      }
      p.project(this.camera);
      el.style.opacity = p.z > 1 ? '0' : '';
      const hw = el.offsetWidth / 2 + 6;
      const hh = el.offsetHeight / 2 + 6;
      const sx = Math.min(w - hw, Math.max(hw, ((p.x + 1) / 2) * w));
      const sy = Math.min(h - hh, Math.max(hh, ((1 - p.y) / 2) * h));
      el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
    }
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Fit the whole tower, floor to ceiling, plus the orbiting ribosome and protein.
    const inset = w < 600 ? 0.1 : 0.07; // room under the floor so its glow isn't cut off
    const halfH = ((Y_TOP - Y_BOTTOM) / 2 + 0.8) / (1 - inset);
    const halfW = 5.6;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.dist = Math.max(halfH / tanHalf, halfW / (tanHalf * aspect)) * 1.02;
    this.target.set(0, (Y_TOP + Y_BOTTOM) / 2 - inset * this.dist * tanHalf, 0);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = this.dist * 0.85;
    fog.far = this.dist * 2;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.blocks?.dispose();
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }
}
