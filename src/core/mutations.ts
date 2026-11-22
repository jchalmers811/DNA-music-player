import { translateCodon } from './genetics';

/** Point mutations on a sequence: position → the base it has been changed to. */
export type Mutations = ReadonlyMap<number, string>;

const CYCLE = 'ACGT';

/**
 * The base a click turns `current` into. Clicking steps through the other
 * three bases and then back to the original, so four clicks undo themselves.
 */
export function nextBase(original: string, current: string): string {
  // Start the cycle at the original, so it is always the last stop. An unknown base (N) gets a fifth stop.
  const at = CYCLE.indexOf(original);
  const cycle = at < 0 ? original + CYCLE : CYCLE.slice(at) + CYCLE.slice(0, at);
  return cycle[(cycle.indexOf(current) + 1) % cycle.length];
}

/** The original sequence with every mutation applied. Only swaps, so the length never changes. */
export function applyMutations(original: string, mutations: Mutations): string {
  if (mutations.size === 0) return original;
  const chars = original.split('');
  for (const [pos, base] of mutations) if (pos >= 0 && pos < chars.length) chars[pos] = base;
  return chars.join('');
}

/**
 * A copy of `mutations` with `position` set to `base`. Setting a base back to
 * what the original has there removes the entry, so "undo" is just another swap.
 */
export function withMutation(original: string, mutations: Mutations, position: number, base: string): Map<number, string> {
  const next = new Map(mutations);
  if (position < 0 || position >= original.length) return next;
  if (original[position] === base) next.delete(position);
  else next.set(position, base);
  return next;
}

export type MutationKind =
  /** Not in a codon the ribosome reads: before the reading frame, after the first stop, or a trailing part-codon. */
  | 'outside'
  /** The codon changes but still means the same amino acid. */
  | 'silent'
  /** A different amino acid. */
  | 'changed'
  /** The codon becomes a stop, so the protein ends early. */
  | 'new-stop'
  /** The stop codon becomes an amino acid, so the protein runs on. */
  | 'stop-lost'
  /** The ATG the protein starts from is broken. */
  | 'start-lost';

export interface MutationEffect {
  kind: MutationKind;
  /** First base of the affected codon, or -1 when outside. */
  codonStart: number;
  /** 1-based codon number within the reading frame, or 0 when outside. */
  codonNumber: number;
  codonBefore: string;
  codonAfter: string;
  /** One-letter amino acids; '*' = stop, 'X' = unknown. Empty when outside. */
  aaBefore: string;
  aaAfter: string;
}

/**
 * What changing `seq[position]` to `base` does to the protein read from
 * `frameStart`. `seq` is the sequence as it is before this one change.
 */
export function describeMutation(seq: string, frameStart: number, position: number, base: string): MutationEffect {
  const outside: MutationEffect = { kind: 'outside', codonStart: -1, codonNumber: 0, codonBefore: '', codonAfter: '', aaBefore: '', aaAfter: '' };
  if (position < frameStart || position >= seq.length) return outside;
  const codonStart = frameStart + Math.floor((position - frameStart) / 3) * 3;
  if (codonStart + 3 > seq.length) return outside;
  // Past the first stop codon the ribosome has already let go.
  for (let i = frameStart; i < codonStart; i += 3) if (translateCodon(seq.slice(i, i + 3)) === '*') return outside;

  const codonBefore = seq.slice(codonStart, codonStart + 3);
  const offset = position - codonStart;
  const codonAfter = codonBefore.slice(0, offset) + base + codonBefore.slice(offset + 1);
  const aaBefore = translateCodon(codonBefore);
  const aaAfter = translateCodon(codonAfter);
  let kind: MutationKind;
  if (codonStart === frameStart && codonBefore === 'ATG' && codonAfter !== 'ATG') kind = 'start-lost';
  else if (aaBefore === aaAfter) kind = 'silent';
  else if (aaAfter === '*') kind = 'new-stop';
  else if (aaBefore === '*') kind = 'stop-lost';
  else kind = 'changed';
  return { kind, codonStart, codonNumber: (codonStart - frameStart) / 3 + 1, codonBefore, codonAfter, aaBefore, aaAfter };
}
