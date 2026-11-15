import { describe, expect, it } from 'vitest';
import { parseFasta } from './fasta';
import { SAMPLES } from './samples';
import {
  BEAT_ORDER,
  INSTRUMENT_ORDER,
  SCALE_ORDER,
  soundSignature,
  TEMPO_MAX,
  TEMPO_MIN,
  type SoundSignature,
} from './signature';

const sample = (id: string) => parseFasta(SAMPLES.find((s) => s.id === id)!.fasta).records[0].sequence;
const DISCRETE = ['key', 'scale', 'instrument', 'beat'] as const;
const differences = (a: SoundSignature, b: SoundSignature) => DISCRETE.filter((k) => a[k] !== b[k]).length;

/** Small seeded generator so "random" tests are repeatable. */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function mutate(seq: string, pos: number, rand: () => number): string {
  const others = 'ACGT'.replace(seq[pos], '');
  return seq.slice(0, pos) + others[Math.floor(rand() * others.length)] + seq.slice(pos + 1);
}

describe('sound signature', () => {
  it('is the same every time for the same sequence', () => {
    expect(soundSignature(sample('ins'))).toEqual(soundSignature(sample('ins')));
  });

  // Pinned so any change to a sample's sound is deliberate (bump SIGNATURE_VERSION and note it in the changelog).
  it('gives the sample genes their v1 sounds', () => {
    const pick = (s: SoundSignature) => ({ key: s.key, scale: s.scale, tempo: s.tempo, instrument: s.instrument, beat: s.beat });
    expect(pick(soundSignature(sample('ins')))).toEqual({ key: 5, scale: 'lydian', tempo: 86, instrument: 'marimba', beat: 'halftime' });
    expect(pick(soundSignature(sample('hbb')))).toEqual({ key: 4, scale: 'mixolydian', tempo: 112, instrument: 'pad', beat: 'halftime' });
    expect(pick(soundSignature(sample('egfp')))).toEqual({ key: 1, scale: 'major', tempo: 124, instrument: 'keys', beat: 'dembow' });
  });

  // Related genes are allowed to sound partly alike: the same gene in two
  // species, and two members of the haemoglobin family.
  const RELATED = [
    ['cycs-human', 'cycs-mouse'],
    ['hba', 'hbb'],
  ];
  const related = (x: string, y: string) => RELATED.some(([p, q]) => (x === p && y === q) || (x === q && y === p));

  // Unrelated genes must differ in at least 2 of: key, scale, instrument, beat, tempo (10+ BPM apart).
  // Property-based sounds can land unrelated genes with similar make-up near each other; see design write-up 4.15.
  it('gives unrelated sample genes clearly different sounds', () => {
    const sigs = SAMPLES.map((s) => ({ id: s.id, sig: soundSignature(sample(s.id)) }));
    for (let i = 0; i < sigs.length; i++)
      for (let j = i + 1; j < sigs.length; j++) {
        if (related(sigs[i].id, sigs[j].id)) continue;
        const a = sigs[i].sig;
        const b = sigs[j].sig;
        const tempoDiffers = Math.abs(a.tempo - b.tempo) >= 10 ? 1 : 0;
        expect(differences(a, b) + tempoDiffers, `${sigs[i].id} vs ${sigs[j].id}`).toBeGreaterThanOrEqual(2);
      }
  });

  it('human and mouse cytochrome c (91% identical genes) sound alike', () => {
    const a = soundSignature(sample('cycs-human'));
    const b = soundSignature(sample('cycs-mouse'));
    expect(differences(a, b)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.tempo - b.tempo)).toBeLessThanOrEqual(5);
  });

  it('the sickle-cell change (GAG→GTG in codon 7) barely changes the sound', () => {
    const normal = sample('hbb');
    const pos = 6 * 3 + 1; // middle base of codon 7
    expect(normal.slice(18, 21)).toBe('GAG');
    const sickle = normal.slice(0, pos) + 'T' + normal.slice(pos + 1);
    const a = soundSignature(normal);
    const b = soundSignature(sickle);
    expect(differences(a, b)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.tempo - b.tempo)).toBeLessThanOrEqual(5);
  });

  it('single-base changes nudge the sound; unrelated genes differ much more', () => {
    const rand = rng(7);
    const base = sample('egfp');
    const sig = soundSignature(base);
    let changed = 0;
    for (let n = 0; n < 40; n++) {
      const pos = Math.floor(rand() * base.length);
      const d = differences(sig, soundSignature(mutate(base, pos, rand)));
      expect(d).toBeLessThanOrEqual(1);
      changed += d;
    }
    // Most single-base edits shouldn't change any discrete choice at all.
    expect(changed).toBeLessThan(10);
  });

  it('only picks pleasant defaults within range', () => {
    const rand = rng(3);
    for (let n = 0; n < 50; n++) {
      const len = 30 + Math.floor(rand() * 900);
      let seq = 'ATG';
      for (let i = 0; i < len; i++) seq += 'ACGT'[Math.floor(rand() * 4)];
      const s = soundSignature(seq);
      expect(SCALE_ORDER).toContain(s.scale);
      expect(s.scale).not.toBe('locrian');
      expect(BEAT_ORDER).toContain(s.beat);
      expect(s.beat).not.toBe('off');
      expect(INSTRUMENT_ORDER).toContain(s.instrument);
      expect(s.key).toBeGreaterThanOrEqual(0);
      expect(s.key).toBeLessThan(12);
      expect(s.tempo).toBeGreaterThanOrEqual(TEMPO_MIN);
      expect(s.tempo).toBeLessThanOrEqual(TEMPO_MAX);
      expect(s.reasons.map((r) => r.setting).sort()).toEqual(['beat', 'instrument', 'key', 'scale', 'tempo']);
    }
  });

  it('falls back to DNA-only properties when there is no real protein', () => {
    const noncoding = 'TTAGGG'.repeat(40) + 'CCCTAA'.repeat(20); // telomere-like repeats, no ATG
    const s = soundSignature(noncoding);
    expect(s.dnaOnly).toBe(true);
    expect(s.reasons.find((r) => r.setting === 'instrument')!.measure).toMatch(/repeat/);
    expect(soundSignature(sample('ins')).dnaOnly).toBe(false);
  });

  it('copes with empty and tiny input', () => {
    for (const seq of ['', 'A', 'NNNN', 'ATG']) {
      const s = soundSignature(seq);
      expect(s.dnaOnly).toBe(true);
      expect(Number.isFinite(s.tempo)).toBe(true);
    }
  });
});
