import { describe, expect, it } from 'vitest';
import { parseFasta } from './fasta';
import { foldProtein } from './fold';
import { applyMutations, describeMutation, nextBase, withMutation } from './mutations';
import { proteinFrom } from './protein';
import { SAMPLES, SICKLE_CELL } from './samples';

const sample = (id: string) => parseFasta(SAMPLES.find((s) => s.id === id)!.fasta).records[0].sequence;

describe('nextBase', () => {
  it('visits the other three bases and comes back to the original on the fourth click', () => {
    for (const original of 'ACGT') {
      const seen: string[] = [];
      let current = original;
      for (let click = 0; click < 4; click++) seen.push((current = nextBase(original, current)));
      expect(seen[3]).toBe(original);
      expect(new Set(seen)).toEqual(new Set('ACGT'));
    }
  });

  it('gives an unknown base (N) all four bases before coming back', () => {
    const seen: string[] = [];
    let current = 'N';
    for (let click = 0; click < 5; click++) seen.push((current = nextBase('N', current)));
    expect(seen).toEqual(['A', 'C', 'G', 'T', 'N']);
  });
});

describe('applyMutations', () => {
  it('returns the original when there are no mutations', () => {
    expect(applyMutations('ATGGAG', new Map())).toBe('ATGGAG');
  });

  it('swaps bases and keeps the length', () => {
    expect(applyMutations('ATGGAG', new Map([[4, 'T'], [0, 'C']]))).toBe('CTGGTG');
  });

  it('ignores positions outside the sequence', () => {
    expect(applyMutations('ATG', new Map([[9, 'T'], [-1, 'T']]))).toBe('ATG');
  });
});

describe('withMutation', () => {
  it('adds a change without touching the map it was given', () => {
    const before = new Map<number, string>();
    const after = withMutation('ATGGAG', before, 4, 'T');
    expect([...after]).toEqual([[4, 'T']]);
    expect(before.size).toBe(0);
  });

  it('removes the entry when a base goes back to the original', () => {
    const one = withMutation('ATGGAG', new Map(), 4, 'T');
    expect(withMutation('ATGGAG', one, 4, 'A').size).toBe(0);
  });

  it('replaces an earlier change at the same position', () => {
    const one = withMutation('ATGGAG', new Map(), 4, 'T');
    expect([...withMutation('ATGGAG', one, 4, 'C')]).toEqual([[4, 'C']]);
  });
});

describe('describeMutation', () => {
  //            M  E  K  *  G
  const seq = 'ATGGAGAAATAAGGG';

  it('reports a changed amino acid', () => {
    expect(describeMutation(seq, 0, 4, 'T')).toMatchObject({
      kind: 'changed', codonStart: 3, codonNumber: 2, codonBefore: 'GAG', codonAfter: 'GTG', aaBefore: 'E', aaAfter: 'V',
    });
  });

  it('reports a silent change', () => {
    expect(describeMutation(seq, 0, 5, 'A')).toMatchObject({ kind: 'silent', codonAfter: 'GAA', aaBefore: 'E', aaAfter: 'E' });
  });

  it('reports a new stop codon', () => {
    expect(describeMutation(seq, 0, 6, 'T')).toMatchObject({ kind: 'new-stop', codonAfter: 'TAA', aaAfter: '*' });
  });

  it('reports a lost stop codon', () => {
    expect(describeMutation(seq, 0, 9, 'C')).toMatchObject({ kind: 'stop-lost', aaBefore: '*', aaAfter: 'Q' });
  });

  it('reports a lost start codon', () => {
    expect(describeMutation(seq, 0, 2, 'C')).toMatchObject({ kind: 'start-lost', codonBefore: 'ATG', codonAfter: 'ATC' });
  });

  it('is outside before the reading frame, after the first stop, and in a trailing part-codon', () => {
    expect(describeMutation('CC' + seq, 2, 1, 'A').kind).toBe('outside');
    expect(describeMutation(seq, 0, 13, 'A').kind).toBe('outside');
    expect(describeMutation('ATGGA', 0, 4, 'C').kind).toBe('outside');
  });

  it('follows the reading frame it is given', () => {
    expect(describeMutation('CC' + seq, 2, 6, 'T')).toMatchObject({ kind: 'changed', codonStart: 5, codonNumber: 2 });
  });
});

describe('the sickle-cell mutation', () => {
  it('changes codon 7 of haemoglobin beta from GAG to GTG, glutamate to valine', () => {
    const hbb = sample(SICKLE_CELL.sampleId);
    expect(describeMutation(hbb, 0, SICKLE_CELL.position, SICKLE_CELL.base)).toMatchObject({
      kind: 'changed', codonNumber: 7, codonBefore: 'GAG', codonAfter: 'GTG', aaBefore: 'E', aaAfter: 'V',
    });
    const sickle = applyMutations(hbb, new Map([[SICKLE_CELL.position, SICKLE_CELL.base]]));
    expect(sickle.length).toBe(hbb.length);
    expect(sickle.slice(18, 21)).toBe('GTG');
  });
});

describe('folding a mutant', () => {
  /** Mean difference in residue-to-residue distances between two folds, in Å. */
  function shapeDifference(a: Float32Array, b: Float32Array, n: number): number {
    const dist = (x: Float32Array, i: number, j: number) =>
      Math.hypot(x[i * 3] - x[j * 3], x[i * 3 + 1] - x[j * 3 + 1], x[i * 3 + 2] - x[j * 3 + 2]);
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i += 2)
      for (let j = i + 4; j < n; j += 2) {
        sum += Math.abs(dist(a, i, j) - dist(b, i, j));
        count++;
      }
    return sum / count;
  }

  it('seeded from the original, the sickle-cell protein keeps nearly the same shape', () => {
    const hbb = sample(SICKLE_CELL.sampleId);
    const normal = proteinFrom(hbb, 0).residues;
    const sickle = proteinFrom(applyMutations(hbb, new Map([[SICKLE_CELL.position, SICKLE_CELL.base]])), 0).residues;
    const last = (residues: string, seedFrom?: string) => foldProtein(residues, { seedFrom }).frames.at(-1)!;
    const seeded = shapeDifference(last(normal), last(sickle, normal), normal.length);
    const unseeded = shapeDifference(last(normal), last(sickle), normal.length);
    expect(seeded).toBeLessThan(2);
    expect(seeded).toBeLessThan(unseeded);
  });
});
