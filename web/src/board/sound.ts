/**
 * Move sounds. Move and capture are the lichess standard samples
 * (web/public/sound, from lila's public/sound/standard — AGPL, fine for
 * this personal, non-distributed vault). Lichess has no distinct check
 * sound, so check plays the move sample plus a short synthesised accent.
 * Everything is decoded once into WebAudio buffers: no play latency, and
 * overlapping sounds mix instead of cutting each other off.
 */

export type SoundKind = 'move' | 'capture' | 'check';

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<void>>();

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

function load(ac: AudioContext, file: string): Promise<void> {
  let pending = loading.get(file);
  if (!pending) {
    pending = fetch(`/sound/${file}`)
      .then((res) => res.arrayBuffer())
      .then((data) => ac.decodeAudioData(data))
      .then((buffer) => {
        buffers.set(file, buffer);
      })
      .catch(() => {
        loading.delete(file); // allow a retry on the next play
      });
    loading.set(file, pending);
  }
  return pending;
}

function playSample(ac: AudioContext, file: string): void {
  const play = (): void => {
    const buffer = buffers.get(file);
    if (!buffer) return;
    const source = ac.createBufferSource();
    source.buffer = buffer;
    source.connect(ac.destination);
    source.start();
  };
  if (buffers.has(file)) play();
  // First use: play as soon as the decode lands — a beat late once, then
  // instant forever.
  else void load(ac, file).then(play);
}

/** The check accent: a brief, quiet two-note alert over the move sample. */
function playAccent(ac: AudioContext): void {
  const at = ac.currentTime + 0.02;
  for (const [offset, freq] of [
    [0, 740],
    [0.085, 990],
  ] as const) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, at + offset);
    gain.gain.setValueAtTime(0.07, at + offset);
    gain.gain.exponentialRampToValueAtTime(0.001, at + offset + 0.1);
    osc.connect(gain).connect(ac.destination);
    osc.start(at + offset);
    osc.stop(at + offset + 0.12);
  }
}

export function playSound(kind: SoundKind): void {
  const ac = audio();
  if (!ac) return;
  switch (kind) {
    case 'move':
      playSample(ac, 'Move.mp3');
      break;
    case 'capture':
      playSample(ac, 'Capture.mp3');
      break;
    case 'check':
      playSample(ac, 'Move.mp3');
      playAccent(ac);
      break;
  }
}

/** Sound for a rendered move, judged from its SAN. Check trumps capture. */
export function soundForSan(san: string): SoundKind {
  if (san.includes('+') || san.includes('#')) return 'check';
  if (san.includes('x')) return 'capture';
  return 'move';
}
