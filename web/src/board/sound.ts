/**
 * Move sounds.
 *
 * Synthesised from scratch by chessvault-app/chess-sounds-gen and therefore
 * ours outright — no recording is sampled and nothing here carries anyone
 * else's licence.
 *
 * There is no check sound, by the same reasoning lichess uses: a checking
 * move plays the ordinary move or capture sound. What used to be here was a
 * two-note accent synthesised on top, which no sample in the set was made
 * to sit under.
 *
 * Everything is decoded once into WebAudio buffers: no play latency, and
 * overlapping sounds mix instead of cutting each other off. WAV rather than
 * MP3 on purpose — an MP3 decoder prepends encoder padding, which is silence
 * in front of a sound whose whole job is to be instant.
 */

import { CAPTURE_SOUNDS, MOVE_SOUNDS, usePrefs, type SoundChoice } from '@/store/prefs';

export type SoundKind = 'move' | 'capture';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<void>>();

/** Where each kind is in its rotation. Per kind, so captures do not advance
    the move rotation and leave it audibly stuck on one take. */
const turn = new Map<SoundKind, number>();

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

/** One gain node for everything, so the volume setting is a single value
    rather than something each caller has to remember to apply. */
function output(ac: AudioContext): GainNode {
  if (!master) {
    master = ac.createGain();
    master.connect(ac.destination);
  }
  master.gain.value = usePrefs.getState().soundVolume;
  return master;
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
    source.connect(output(ac));
    source.start();
  };
  if (buffers.has(file)) play();
  // First use: play as soon as the decode lands — a beat late once, then
  // instant forever.
  else void load(ac, file).then(play);
}

/** The file a kind should play now, honouring the setting and the rotation. */
function pick(kind: SoundKind, choices: SoundChoice[], selected: string): string {
  const chosen = choices.find((c) => c.id === selected);
  if (chosen?.file) return chosen.file;

  // `rotate`, or a stored id from a build that no longer has it.
  const takes = choices.map((c) => c.file).filter((f): f is string => f !== null);
  const at = turn.get(kind) ?? 0;
  turn.set(kind, at + 1);
  return takes[at % takes.length]!;
}

export function playSound(kind: SoundKind): void {
  const prefs = usePrefs.getState();
  if (!prefs.sound) return;
  const ac = audio();
  if (!ac) return;
  switch (kind) {
    case 'move':
      playSample(ac, pick('move', MOVE_SOUNDS, prefs.moveSound));
      break;
    case 'capture':
      playSample(ac, pick('capture', CAPTURE_SOUNDS, prefs.captureSound));
      break;
  }
}

/**
 * Play one specific take, for auditioning in settings.
 *
 * Deliberately ignores the on/off switch — this only ever runs because
 * somebody just asked to hear it, and a preview button that silently does
 * nothing is how a setting gets called broken.
 */
export function previewSound(kind: 'move' | 'capture', id: string): void {
  const ac = audio();
  if (!ac) return;
  playSample(ac, pick(kind, kind === 'move' ? MOVE_SOUNDS : CAPTURE_SOUNDS, id));
}

/** Sound for a rendered move, judged from its SAN. */
export function soundForSan(san: string): SoundKind {
  return san.includes('x') ? 'capture' : 'move';
}
