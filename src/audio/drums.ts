import * as Tone from 'tone';
import type { DrumHit } from '../core/drums';

/** Plain hi-hats sit at this cutoff; slices sweep between HAT_DARK and HAT_BRIGHT. */
const HAT_CUTOFF = 8000;
const HAT_DARK = 3500;
const HAT_BRIGHT = 12000;

/**
 * A synthesised drum kit: nothing to download. Each voice is monophonic, like
 * a real drum machine, so a new 808 cuts off the previous one.
 */
export class DrumKit {
  private readonly out: Tone.Volume;
  private readonly kick: Tone.MembraneSynth;
  private readonly sub: Tone.MembraneSynth;
  private readonly snare: Tone.NoiseSynth;
  private readonly snareBody: Tone.MembraneSynth;
  private readonly clap: Tone.NoiseSynth;
  private readonly hat: Tone.NoiseSynth;
  private readonly hatFilter: Tone.Filter;
  private readonly tom: Tone.MembraneSynth;
  private readonly openHat: Tone.NoiseSynth;
  private readonly crash: Tone.NoiseSynth;
  private readonly nodes: Tone.ToneAudioNode[] = [];
  /** Last start time booked per voice. */
  private readonly lastStart = new Map<string, number>();

  constructor(destination: Tone.InputNode) {
    this.out = new Tone.Volume(0).connect(destination);
    const keep = <T extends Tone.ToneAudioNode>(n: T) => (this.nodes.push(n), n);
    const filter = (type: BiquadFilterType, frequency: number, Q = 1) =>
      keep(new Tone.Filter({ type, frequency, Q }).connect(this.out));

    this.kick = keep(
      new Tone.MembraneSynth({
        pitchDecay: 0.03,
        octaves: 6,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.05 },
        volume: -3,
      }).connect(this.out),
    );

    // 808: a long sine boom with a pitch glide. Light saturation adds harmonics,
    // so it can be heard on laptop and phone speakers that can't reproduce sub-bass.
    const drive = keep(new Tone.Distortion({ distortion: 0.4, wet: 0.55 }).connect(this.out));
    this.sub = keep(
      new Tone.MembraneSynth({
        pitchDecay: 0.09,
        octaves: 2.5,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.002, decay: 1.3, sustain: 0, release: 0.2 },
        volume: -4,
      }).connect(drive),
    );

    this.snare = keep(
      new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.03 },
        volume: -11,
      }).connect(filter('highpass', 1500)),
    );
    this.snareBody = keep(
      new Tone.MembraneSynth({
        pitchDecay: 0.01,
        octaves: 2,
        envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.02 },
        volume: -15,
      }).connect(this.out),
    );
    this.clap = keep(
      new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.003, decay: 0.14, sustain: 0, release: 0.03 },
        volume: -5,
      }).connect(filter('bandpass', 1400, 0.8)),
    );
    this.hatFilter = filter('highpass', HAT_CUTOFF);
    this.hat = keep(
      new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.01 },
        volume: -15,
      }).connect(this.hatFilter),
    );
    this.tom = keep(
      new Tone.MembraneSynth({
        pitchDecay: 0.05,
        octaves: 2.5,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.05 },
        volume: -6,
      }).connect(this.out),
    );
    this.openHat = keep(
      new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.05 },
        volume: -17,
      }).connect(filter('highpass', 7000)),
    );
    this.crash = keep(
      new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 1.4, sustain: 0, release: 0.2 },
        volume: -21,
      }).connect(filter('highpass', 5000)),
    );
  }

  play(hit: DrumHit, requested: number): void {
    const { velocity, midi } = hit;
    // Each voice is monophonic and Tone requires its start times to strictly increase.
    // After a seek or restart, new hits can be booked before ones booked a moment earlier
    // (sounds are scheduled slightly ahead), so nudge them just after the last one.
    const prev = this.lastStart.get(hit.voice) ?? -Infinity;
    const time = requested > prev ? requested : prev + 0.001;
    this.lastStart.set(hit.voice, time);
    switch (hit.voice) {
      case 'kick':
        this.kick.triggerAttackRelease('C1', 0.3, time, velocity);
        break;
      case 'sub808':
        this.sub.triggerAttackRelease(Tone.Frequency(midi ?? 24, 'midi').toFrequency(), 1.2, time, velocity);
        break;
      case 'snare':
        this.snare.triggerAttackRelease(0.15, time, velocity);
        this.snareBody.triggerAttackRelease('G2', 0.1, time, velocity);
        break;
      case 'clap':
        this.clap.triggerAttackRelease(0.14, time, velocity);
        break;
      case 'hat': {
        // Every hat sets its own cutoff, so a slice's sweep never leaks into the plain hats after it.
        const cutoff = hit.tone === undefined ? HAT_CUTOFF : HAT_DARK * (HAT_BRIGHT / HAT_DARK) ** hit.tone;
        this.hatFilter.frequency.setValueAtTime(cutoff, time);
        this.hat.triggerAttackRelease(hit.tone === undefined ? 0.035 : 0.025, time, velocity);
        break;
      }
      case 'tom':
        this.tom.triggerAttackRelease(Tone.Frequency(midi ?? 45, 'midi').toFrequency(), 0.3, time, velocity);
        break;
      case 'openHat':
        this.openHat.triggerAttackRelease(0.28, time, velocity);
        break;
      case 'crash':
        this.crash.triggerAttackRelease(1.4, time, velocity);
        break;
    }
  }

  /** 0..1, where 0 mutes. */
  setLevel(level: number): void {
    this.out.mute = level <= 0;
    if (level > 0) this.out.volume.value = 20 * Math.log10(level);
  }

  dispose(): void {
    for (const n of this.nodes) n.dispose();
    this.out.dispose();
  }
}
