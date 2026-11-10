import { AMINO_ACIDS, translateCodon } from '../core/genetics';
import type { HelixHighlight } from '../visual/helix';

const CELL = 22; // px per base; keep in sync with --cell in CSS

/**
 * A horizontally scrolling view of the letters around the playhead.
 * With biology on, it adds a row of amino acids under each codon of the reading frame.
 */
export class SequenceStrip {
  private readonly viewport: HTMLElement;
  private readonly track: HTMLElement;
  private seq = '';
  private frameStart = 0;
  private showBiology = false;
  private builtStart = -1;
  private builtEnd = -1;
  private cells: HTMLElement[] = [];
  private codonCells = new Map<number, HTMLElement>();
  private hlKey = '';

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="strip-viewport">
        <div class="strip-track"></div>
        <div class="strip-cursor" aria-hidden="true"></div>
      </div>`;
    this.viewport = root.querySelector('.strip-viewport')!;
    this.track = root.querySelector('.strip-track')!;
  }

  setData(seq: string, frameStart: number, showBiology: boolean): void {
    this.seq = seq;
    this.frameStart = frameStart;
    this.showBiology = showBiology;
    this.viewport.classList.toggle('with-aa', showBiology);
    this.builtStart = this.builtEnd = -1;
  }

  update(pos: number, hl: HelixHighlight | null): void {
    const width = this.viewport.clientWidth;
    const half = Math.ceil(width / CELL / 2) + 6;
    const center = Math.floor(pos);
    const start = Math.max(0, center - half);
    const end = Math.min(this.seq.length, center + half + 1);
    if (start !== this.builtStart || end !== this.builtEnd) this.build(start, end);
    this.track.style.transform = `translateX(${width / 2 - (pos - start) * CELL}px)`;

    const key = hl ? `${hl.start}:${hl.length}:${start}` : '';
    if (key !== this.hlKey) {
      this.hlKey = key;
      this.track.querySelectorAll('.active').forEach((el) => el.classList.remove('active'));
      if (hl) {
        for (let i = hl.start; i < hl.start + hl.length; i++) this.cells[i - start]?.classList.add('active');
        this.codonCells.get(hl.start)?.classList.add('active');
      }
    }
  }

  private build(start: number, end: number): void {
    this.builtStart = start;
    this.builtEnd = end;
    this.hlKey = '';
    const frag = document.createDocumentFragment();
    this.cells = [];
    this.codonCells.clear();

    for (let i = start; i < end; i++) {
      const b = this.seq[i];
      const el = document.createElement('span');
      el.className = `b b-${b}`;
      el.style.left = `${(i - start) * CELL}px`;
      el.textContent = b;
      if ((i + 1) % 10 === 0) el.dataset.tick = String(i + 1);
      frag.append(el);
      this.cells.push(el);
    }

    if (this.showBiology) {
      const fs = this.frameStart;
      let cs = start <= fs ? fs : fs + Math.floor((start - fs) / 3) * 3;
      for (; cs < end && cs + 3 <= this.seq.length; cs += 3) {
        const aa = translateCodon(this.seq.slice(cs, cs + 3));
        const el = document.createElement('span');
        el.className = 'aa';
        if (aa === '*') el.classList.add('aa-stop');
        if (cs === fs && aa === 'M') el.classList.add('aa-start');
        el.style.left = `${(cs - start) * CELL}px`;
        el.textContent = aa === '*' ? 'Stop' : (AMINO_ACIDS[aa]?.three ?? '?');
        el.title = aa === '*' ? 'Stop codon' : (AMINO_ACIDS[aa]?.name ?? 'Unknown');
        frag.append(el);
        this.codonCells.set(cs, el);
      }
    }
    this.track.replaceChildren(frag);
  }
}
