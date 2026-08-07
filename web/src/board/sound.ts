/**
 * Move sounds, synthesised with WebAudio — no audio assets to ship or
 * license, and they work fully offline. Deliberately quiet and short:
 * a woody tap for a move, a lower double-knock for a capture, a brief
 * two-note alert for check.
 */

export type SoundKind = 'move' | 'capture' | 'check';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    // Unlocked by the first user gesture; resume is a no-op afterwards.
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** One decaying tone: frequency glides down, gain snaps up then dies. */
function tap(
  ac: AudioContext,
  at: number,
  freqFrom: number,
  freqTo: number,
  duration: number,
  peak: number,
): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freqFrom, at);
  osc.frequency.exponentialRampToValueAtTime(freqTo, at + duration);
  gain.gain.setValueAtTime(peak, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(at);
  osc.stop(at + duration + 0.01);
}

export function playSound(kind: SoundKind): void {
  const ac = audio();
  if (!ac) return;
  const now = ac.currentTime;
  switch (kind) {
    case 'move':
      tap(ac, now, 520, 160, 0.09, 0.18);
      break;
    case 'capture':
      tap(ac, now, 340, 110, 0.1, 0.22);
      tap(ac, now + 0.045, 220, 90, 0.09, 0.18);
      break;
    case 'check':
      tap(ac, now, 740, 700, 0.07, 0.14);
      tap(ac, now + 0.085, 990, 940, 0.12, 0.14);
      break;
  }
}

/** Sound for a rendered move, judged from its SAN. Check trumps capture. */
export function soundForSan(san: string): SoundKind {
  if (san.includes('+') || san.includes('#')) return 'check';
  if (san.includes('x')) return 'capture';
  return 'move';
}
