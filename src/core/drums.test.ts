import { describe, expect, it } from 'vitest';
import { BEATS, DEFAULT_BEAT, drumHits } from './drums';
import { getMapping } from './mappings';
import type { MusicSettings } from './types';

const settings: MusicSettings = { key: 0, scale: 'majorPentatonic', faithful: false, frame: 0 };

describe('drums', () => {
  it('off means no hits; the default is Steady', () => {
    expect(drumHits('off', [], 16, '')).toEqual([]);
    expect(DEFAULT_BEAT).toBe('steady');
  });

  it('every beat stays inside the piece, sorted, with no duplicate hits per voice', () => {
    for (const b of BEATS) {
      const { events, totalBeats } = getMapping('aminoAcid').map('ATGGCTAAAGATTGGTAA'.repeat(3), settings);
      const hits = drumHits(b.id, events, totalBeats, 'ATGGCTAAAGATTGGTAA'.repeat(3));
      const keys = new Set(hits.map((h) => `${h.voice}@${h.time}`));
      expect(keys.size).toBe(hits.length);
      for (let i = 0; i < hits.length; i++) {
        expect(hits[i].time).toBeGreaterThanOrEqual(0);
        expect(hits[i].time).toBeLessThan(totalBeats);
        if (i) expect(hits[i].time).toBeGreaterThanOrEqual(hits[i - 1].time);
        expect(hits[i].velocity).toBeGreaterThan(0);
        expect(hits[i].velocity).toBeLessThanOrEqual(1);
      }
    }
  });

  it('backbeat puts snares on beats 2 and 4', () => {
    const snares = drumHits('backbeat', [], 8, '').filter((h) => h.voice === 'snare').map((h) => h.time);
    expect(snares).toEqual([1, 3, 5, 7]);
  });

  it('shuffle swings the off-beat hat to two-thirds of the beat', () => {
    const hats = drumHits('shuffle', [], 2, '').filter((h) => h.voice === 'hat').map((h) => h.time);
    expect(hats[0]).toBe(0);
    expect(hats[1]).toBeCloseTo(2 / 3);
  });

  it('808 trap: tuned 808s, clap on beat 3, hi-hat rolls', () => {
    const hits = drumHits('trap', [], 8, '', 9); // key of A
    const subs = hits.filter((h) => h.voice === 'sub808');
    expect(subs[0]).toMatchObject({ time: 0, midi: 33 }); // A1
    expect(hits.filter((h) => h.voice === 'clap').map((h) => h.time)).toEqual([2, 6]);
    const hatTimes = hits.filter((h) => h.voice === 'hat').map((h) => h.time);
    const gaps = new Set(hatTimes.slice(1).map((t, i) => +(t - hatTimes[i]).toFixed(3)));
    expect(gaps).toContain(0.125); // 32nd-note roll
    expect(gaps).toContain(+(1 / 6).toFixed(3)); // triplet roll
  });

  it('trap slices: some bars get fast bursts that sweep in tone', () => {
    const hits = drumHits('trapSlices', [], 64, '', 0);
    const sliced = hits.filter((h) => h.voice === 'hat' && h.tone !== undefined);
    expect(sliced.length).toBeGreaterThan(20);
    const gaps = sliced.slice(1).map((h, i) => +(h.time - sliced[i].time).toFixed(4));
    expect(Math.min(...gaps.filter((g) => g > 0))).toBeLessThanOrEqual(0.0625);
    expect(new Set(sliced.map((h) => Math.round(h.tone! * 10))).size).toBeGreaterThan(4);
    // Occasional, not constant: some bars have no slice.
    const slicedBars = new Set(sliced.map((h) => Math.floor(h.time / 4)));
    expect(slicedBars.size).toBeGreaterThan(3);
    expect(slicedBars.size).toBeLessThan(14);
    // Deterministic.
    expect(drumHits('trapSlices', [], 64, '', 0)).toEqual(hits);
  });

  describe('fills', () => {
    const seq = 'ATGGCTAAAGATTGGCTGCAGTCTAAA'.repeat(4) + 'TAA';
    const { events, totalBeats } = getMapping('aminoAcid').map(seq, settings);
    const playing = BEATS.filter((b) => b.id !== 'off');
    const sig = (hits: { time: number; voice: string }[]) => hits.map((h) => `${h.voice}@${h.time.toFixed(3)}`).join(' ');

    it('every beat has its own intro and outro fill', () => {
      const intros = new Set<string>();
      const outros = new Set<string>();
      for (const b of playing) {
        const hits = drumHits(b.id, events, totalBeats, seq, 0);
        intros.add(sig(hits.filter((h) => h.time < 4)));
        outros.add(sig(hits.filter((h) => h.time >= totalBeats - 3)));
      }
      expect(intros.size).toBe(playing.length);
      expect(outros.size).toBe(playing.length);
    });

    it('intros land on a crash at bar 2; pieces end on a final crash with nothing after', () => {
      const finalAt = Math.floor(totalBeats - 1e-6);
      for (const b of playing) {
        const hits = drumHits(b.id, events, totalBeats, seq, 0);
        expect(hits.some((h) => h.voice === 'crash' && h.time === 4)).toBe(true);
        expect(hits.some((h) => h.voice === 'crash' && h.time === finalAt)).toBe(true);
        expect(hits.every((h) => h.time <= finalAt)).toBe(true);
      }
    });

    it('fills use toms tuned to the key', () => {
      const toms = (key: number) =>
        drumHits('backbeat', events, totalBeats, seq, key).filter((h) => h.voice === 'tom').map((h) => h.midi);
      expect(toms(0).length).toBeGreaterThan(0);
      expect(toms(2)).toEqual(toms(0).map((m) => m! + 2));
    });

    it('short pieces skip fills', () => {
      expect(drumHits('backbeat', [], 8, '', 0).some((h) => h.voice === 'tom')).toBe(false);
    });
  });

  it('"from the sequence" follows the biology', () => {
    // ATG (start) · GCT Ala (water-avoiding) · AAA Lys (charged) · TCT Ser (other) · TAA (stop)
    const seq = 'ATGGCTAAATCTTAA';
    const { events, totalBeats } = getMapping('aminoAcid').map(seq, settings);
    const onBeat = (t: number) => drumHits('sequence', events, totalBeats, seq).filter((h) => h.time === t).map((h) => h.voice);
    expect(onBeat(0)).toEqual(expect.arrayContaining(['crash', 'kick']));
    expect(onBeat(1)).toEqual(['kick']);
    expect(onBeat(2)).toEqual(['snare']);
    expect(onBeat(3)).toEqual(['hat']);
    expect(onBeat(4)).toEqual(expect.arrayContaining(['crash', 'kick']));
  });

  it('"from the sequence" in base mode: A kick, G snare, C/T hats', () => {
    const seq = 'AGCT';
    const { events, totalBeats } = getMapping('base').map(seq, settings);
    expect(drumHits('sequence', events, totalBeats, seq).map((h) => h.voice)).toEqual(['kick', 'snare', 'hat', 'hat']);
  });
});
