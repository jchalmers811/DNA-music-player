import * as Tone from 'tone';

export type InstrumentId = 'keys' | 'marimba' | 'bell' | 'pad';

export const INSTRUMENTS: { id: InstrumentId; name: string }[] = [
  { id: 'keys', name: 'Soft keys' },
  { id: 'marimba', name: 'Marimba' },
  { id: 'bell', name: 'Glass bell' },
  { id: 'pad', name: 'Warm pad' },
];

export interface Instrument {
  play(midi: number, durationSec: number, time: number, velocity: number): void;
  /** Let ringing notes fade, then free resources. */
  retire(): void;
}

function wrap(synth: Tone.PolySynth, extra: Tone.ToneAudioNode[] = []): Instrument {
  return {
    play(midi, durationSec, time, velocity) {
      synth.triggerAttackRelease(Tone.Frequency(midi, 'midi').toFrequency(), durationSec, time, velocity);
    },
    retire() {
      synth.releaseAll();
      window.setTimeout(() => {
        synth.dispose();
        extra.forEach((n) => n.dispose());
      }, 4000);
    },
  };
}

export function createInstrument(id: InstrumentId, destination: Tone.InputNode): Instrument {
  switch (id) {
    case 'keys': {
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.005, decay: 0.35, sustain: 0.25, release: 0.9 },
        volume: -9,
      }).connect(destination);
      return wrap(synth);
    }
    case 'marimba': {
      const synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 4,
        modulationIndex: 2,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.4 },
        modulation: { type: 'sine' },
        modulationEnvelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.1 },
        volume: -6,
      }).connect(destination);
      return wrap(synth);
    }
    case 'bell': {
      const synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 12,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 1.2, sustain: 0, release: 1.4 },
        modulation: { type: 'sine' },
        modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.3 },
        volume: -14,
      }).connect(destination);
      return wrap(synth);
    }
    case 'pad': {
      const filter = new Tone.Filter({ frequency: 1400, type: 'lowpass', rolloff: -24 }).connect(destination);
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 24 },
        envelope: { attack: 0.12, decay: 0.4, sustain: 0.55, release: 1.6 },
        volume: -20,
      }).connect(filter);
      return wrap(synth, [filter]);
    }
  }
}
