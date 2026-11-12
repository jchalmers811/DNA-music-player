/**
 * iOS mutes Web Audio when the ring/silent switch is set to silent, unless the
 * page has declared that it plays media. Two ways to do that:
 *
 *  - Safari 16.4+: the Audio Session API (`navigator.audioSession.type = 'playback'`).
 *  - Older iOS: start an HTML <audio> element (here, a looping silent clip),
 *    which moves the page into the "playback" audio category.
 *
 * Must be called synchronously inside a user gesture (a tap or click).
 * Harmless on other platforms.
 */

let silentAudio: HTMLAudioElement | null = null;

interface AudioSessionNavigator {
  audioSession?: { type: string };
}

export function unlockMediaPlayback(): void {
  const nav = navigator as Navigator & AudioSessionNavigator;
  if (nav.audioSession) {
    try {
      nav.audioSession.type = 'playback';
    } catch {
      /* unsupported value: fall through to the <audio> trick */
    }
  }
  if (!isIOS()) return;
  // Keep the silent clip running too: older iOS has no Audio Session API, and on newer
  // iOS it does no harm.
  if (!silentAudio) {
    silentAudio = document.createElement('audio');
    silentAudio.src = URL.createObjectURL(silentWav());
    silentAudio.loop = true;
    silentAudio.setAttribute('playsinline', '');
    silentAudio.preload = 'auto';
  }
  void silentAudio.play().catch(() => {
    /* blocked or interrupted; Web Audio still works when the switch is on ring */
  });
}

function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/** A tiny silent 16-bit mono WAV (0.5 s at 8 kHz). */
function silentWav(seconds = 0.5, sampleRate = 8000): Blob {
  const samples = Math.round(seconds * sampleRate);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  v.setUint32(40, samples * 2, true);
  return new Blob([buffer], { type: 'audio/wav' });
}
