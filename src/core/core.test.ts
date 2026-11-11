import { describe, expect, it } from 'vitest';
import { parseFasta } from './fasta';
import { complement, findFirstStart, gcContent, HYDROPATHY_ORDER, translate, translateCodon } from './genetics';
import { codonIndex, getMapping, MAPPINGS, resolveReadingStart } from './mappings';
import { degreeToMidi, midiToName, rootMidi, SCALES, scaleIntervals } from './music';
import { eventIndexAt, eventIndexForBase, firstEventAtOrAfter, positionAt } from './playhead';
import { SAMPLES } from './samples';
import type { MusicSettings } from './types';

const settings: MusicSettings = { key: 0, scale: 'majorPentatonic', faithful: false, frame: 'auto' };

describe('fasta', () => {
  it('parses multiple records with ids and descriptions', () => {
    const { records } = parseFasta('>one first gene\nACGT\nacgt\n\n>two\nGGCC\n');
    expect(records).toEqual([
      { id: 'one', description: 'first gene', sequence: 'ACGTACGT' },
      { id: 'two', description: '', sequence: 'GGCC' },
    ]);
  });

  it('accepts a bare sequence, converts U to T, strips digits and whitespace', () => {
    const { records, warnings } = parseFasta('  1 acgu acgu\r\n 9 NNA ');
    expect(records[0].sequence).toBe('ACGTACGTNNA');
    expect(warnings).toEqual([]);
  });

  it('maps ambiguity codes to N and warns about junk', () => {
    const { records, warnings } = parseFasta('ACRYGTZ');
    expect(records[0].sequence).toBe('ACNNGT');
    expect(warnings).toHaveLength(2);
  });

  it('throws when there is no sequence', () => {
    expect(() => parseFasta('>empty\n\n')).toThrow();
  });
});

describe('genetics', () => {
  it('translates the standard code', () => {
    expect(translateCodon('ATG')).toBe('M');
    expect(translateCodon('TGG')).toBe('W');
    expect(['TAA', 'TAG', 'TGA'].map(translateCodon)).toEqual(['*', '*', '*']);
    expect(translateCodon('GGN')).toBe('X');
    expect(translate('ATGGCCTAA')).toBe('MA*');
  });

  it('finds the first start codon, complements and measures GC', () => {
    expect(findFirstStart('CCATGA')).toBe(2);
    expect(findFirstStart('CCC')).toBe(-1);
    expect(complement('A')).toBe('T');
    expect(complement('G')).toBe('C');
    expect(gcContent('GGCCAATT')).toBe(0.5);
    expect(gcContent('NNGC')).toBe(1);
  });

  it('orders all 20 amino acids from hydrophilic to hydrophobic', () => {
    expect(HYDROPATHY_ORDER).toHaveLength(20);
    expect(HYDROPATHY_ORDER[0]).toBe('R');
    expect(HYDROPATHY_ORDER[19]).toBe('I');
  });
});

describe('music', () => {
  it('converts degrees across octaves', () => {
    const iv = SCALES.majorPentatonic.intervals;
    expect(degreeToMidi(0, iv, 60)).toBe(60);
    expect(degreeToMidi(4, iv, 60)).toBe(69);
    expect(degreeToMidi(5, iv, 60)).toBe(72);
    expect(midiToName(60)).toBe('C4');
    expect(rootMidi(9, 60)).toBe(57);
  });

  it('the seven modes are rotations of the major scale', () => {
    const major = SCALES.major.intervals;
    const modes = ['major', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'minor', 'locrian'] as const;
    modes.forEach((id, k) => {
      const rotated = major.map((_, i) => (major[(i + k) % 7] - major[k] + 12) % 12);
      expect(SCALES[id].intervals).toEqual(rotated);
    });
    expect(degreeToMidi(1, SCALES.phrygian.intervals, 64)).toBe(65); // E Phrygian: E → F
  });

  it('faithful mode is chromatic', () => {
    expect(scaleIntervals({ ...settings, faithful: true })).toHaveLength(12);
  });
});

describe('mappings', () => {
  const seq = 'CCATGGCCTAAGNT';

  it('auto reading start finds the first ATG; manual frames are offsets', () => {
    expect(resolveReadingStart(seq, 'auto')).toBe(2);
    expect(resolveReadingStart('CCCCCC', 'auto')).toBe(0);
    expect(resolveReadingStart(seq, 1)).toBe(1);
  });

  it('base mode: one event per base, N is a rest, all notes in scale', () => {
    const r = getMapping('base').map('ACGTN', settings);
    expect(r.events).toHaveLength(5);
    expect(r.events[4].midi).toBeNull();
    expect(r.totalBeats).toBe(2.5);
    const pcs = new Set(SCALES.majorPentatonic.intervals);
    for (const e of r.events) if (e.midi !== null) expect(pcs.has(e.midi % 12)).toBe(true);
  });

  it('codon mode reads from the frame start and gives distinct codons distinct indices', () => {
    const r = getMapping('codon').map(seq, settings);
    expect(r.readingStart).toBe(2);
    expect(r.events.map((e) => e.label)).toEqual(['ATG', 'GCC', 'TAA', 'GNT']);
    expect(r.events[0].kind).toBe('start');
    expect(r.events[2].kind).toBe('stop');
    expect(r.events[3].midi).toBeNull();
    expect(new Set(['AAA', 'ACG', 'TTT', 'GCA'].map(codonIndex)).size).toBe(4);
  });

  it('amino-acid mode: synonymous codons share a note, stops are rests', () => {
    const r = getMapping('aminoAcid').map('GCTGCCGCAGCGTAA', { ...settings, frame: 0 });
    const notes = r.events.map((e) => e.midi);
    expect(new Set(notes.slice(0, 4)).size).toBe(1);
    expect(notes[4]).toBeNull();
    expect(r.events[0].label).toBe('Ala');
  });

  it('every mapping produces time-sorted events with non-decreasing source positions', () => {
    for (const m of MAPPINGS) {
      const { events } = m.map(SAMPLES[0].fasta.split('\n').slice(1).join(''), settings);
      for (let i = 1; i < events.length; i++) {
        expect(events[i].time).toBeGreaterThan(events[i - 1].time);
        expect(events[i].start).toBeGreaterThan(events[i - 1].start);
      }
    }
  });
});

describe('playhead', () => {
  const { events } = getMapping('codon').map('ATGGCCAAATTT', settings);

  it('finds events by beat and base', () => {
    expect(eventIndexAt(events, -1)).toBe(-1);
    expect(eventIndexAt(events, 0)).toBe(0);
    expect(eventIndexAt(events, 2.5)).toBe(2);
    expect(firstEventAtOrAfter(events, 1.5)).toBe(2);
    expect(eventIndexForBase(events, 7)).toBe(2);
  });

  it('glides through the bases of the current codon', () => {
    expect(positionAt(events, 0).pos).toBe(0);
    expect(positionAt(events, 1.5).pos).toBeCloseTo(4.5);
    expect(positionAt(events, 1.5).sinceOnset).toBeCloseTo(0.5);
  });
});

describe('samples', () => {
  const expected: Record<string, string> = {
    ins: 'MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN*',
    hbb: 'MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH*',
    egfp: 'MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITLGMDELYK*',
  };

  for (const s of SAMPLES) {
    it(`${s.name} translates to the known protein`, () => {
      const { records } = parseFasta(s.fasta);
      expect(translate(records[0].sequence, 0)).toBe(expected[s.id]);
    });
  }
});
