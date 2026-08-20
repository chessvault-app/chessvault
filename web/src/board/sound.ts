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

/**
 * Awake, or a promise of being awake — null when it is already running.
 *
 * `!== 'running'` rather than `=== 'suspended'`, because suspended is not
 * the only way a context stops. WebKit has a fourth state, `interrupted`,
 * which is where an iPhone puts the context for a call, for Siri, for
 * another app taking the audio session, and for a home-screen app being
 * switched away from. Nothing here used to resume out of it — the test was
 * for `suspended` exactly — so one interruption left every later move
 * starting sources into a context that would never play them, silently,
 * until the app was reloaded. That is the shape of a board that stops
 * sounding with no way to reproduce it: it is not the move, it is whatever
 * happened before the move.
 *
 * lib.dom's AudioContextState does not know that fourth state, which is why
 * this is a negative test against `running` and not a list of the states
 * worth resuming from.
 */
function wake(ac: AudioContext): Promise<void> | null {
  if (ac.state === 'running') return null;
  // A context that cannot resume yet — no gesture has reached the page —
  // is not an error: the sample is started anyway, exactly as before, and
  // the next gesture arms it for good.
  return ac.resume().catch(() => {});
}

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      listen(ctx);
    }
    // No wake here: every caller goes on to playSample, which waits for the
    // resume it asks for rather than starting a source alongside it.
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Put the context back before it is needed, not when a move needs it.
 *
 * `playSample` can wait for a resume, but waiting is a sound that arrives
 * late, and the move that pays for it is the first one after coming back
 * to the app — the one most likely to be noticed. So the two moments that
 * end an interruption re-arm it directly: returning to the foreground, and
 * the first touch after that (WebKit will often only resume inside a
 * gesture, and on a board the first touch IS the move about to be played).
 * `statechange` covers an interruption that ends while the app is open.
 *
 * Guarded by wake()'s own `running` test, so none of these does anything
 * once the context is live — including the statechange that resuming fires.
 */
function listen(ac: AudioContext): void {
  if (typeof document === 'undefined') return;
  const back = (): void => {
    if (document.visibilityState === 'visible') void wake(ac);
  };
  document.addEventListener('visibilitychange', back);
  document.addEventListener('pointerdown', back, { passive: true });
  ac.addEventListener('statechange', back);
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
    // BASE_URL, not a bare leading slash: the demo is published under
    // /app/, so a root-absolute path looked for /sound/… on the domain
    // root and 404'd every take. Silently — the catch below only clears
    // the entry for a retry — so the demo simply had no sound at all.
    pending = fetch(`${import.meta.env.BASE_URL}sound/${file}`)
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
  // Two things can be missing: the sample, and a context able to play it.
  // The sample is the familiar one — first use of a take waits for its
  // decode, a beat late once and instant forever after.
  //
  // The context is the one that bit. A source started on a context that is
  // not running is at the mercy of the engine: Chrome queues it for the
  // resume, WebKit is content to drop it. So the start waits for the
  // resume to land instead of racing it — which costs the move after an
  // interruption a few milliseconds, and buys it being heard at all.
  const decoded = buffers.has(file) ? null : load(ac, file);
  const awake = wake(ac);
  if (!decoded && !awake) play();
  else void Promise.all([decoded, awake]).then(play);
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

/**
 * One short tick when the user's own piece lands — fired from the board's
 * move event, so replaying or stepping through a line never buzzes.
 * Android only: iOS Safari exposes no haptics API to web pages, so there
 * this is a silent no-op (a native shell would be the route to iOS
 * haptics). Desktop browsers without a motor accept the call and do
 * nothing, which is also fine.
 */
export function moveHaptic(): void {
  if (!usePrefs.getState().haptics) return;
  try {
    navigator.vibrate?.(10);
  } catch {
    // Some engines throw instead of ignoring; a missing buzz is not an
    // error worth surfacing.
  }
}
