/**
 * Choosing one recording to stand for a species.
 *
 * The atlas card's play button and the species card's Listen button ask for
 * a bird by name alone, with no particular detection in mind. Upstream's
 * BirdNET-Pi answered that from its own disk; here we pick from BirdWeather's
 * detections instead: the best-scored clip heard recently.
 *
 * Kept free of I/O so the choice can be tested without the network.
 */
import type { Detection } from './birdweather.ts';

/**
 * How far back to look, tried in order until one yields a playable clip.
 * A week of a common bird is hundreds of clips, so it almost always stops at
 * the first. A bird heard once, years ago, is still found by the last.
 */
export const BEST_RECORDING_WINDOWS_DAYS = [7, 30, 365, 3650];

/** One page of detections per window: plenty to find a good clip in. */
export const BEST_RECORDING_CAP = 500;

/**
 * The clip to play for a species, or null if none has audio.
 *
 * Highest BirdWeather score first. It already folds the model's confidence
 * together with how plausible the species is at that place and time, so it
 * is the better single measure of "this is clearly that bird". Confidence
 * breaks ties, then recency, so equal clips resolve to the newest and the
 * answer is stable for a given set of detections.
 *
 * `isPlayable` decides which URLs count. The caller passes its media-host
 * allowlist, so a malformed or foreign URL can never be chosen and then
 * redirected to.
 */
export function pickBestRecording(
  detections: Detection[],
  isPlayable: (url: string) => boolean,
): Detection | null {
  let best: Detection | null = null;
  for (const d of detections) {
    if (!d.soundscapeUrl || !isPlayable(d.soundscapeUrl)) continue;
    if (!best || better(d, best)) best = d;
  }
  return best;
}

function better(a: Detection, b: Detection): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.confidence !== b.confidence) return a.confidence > b.confidence;
  return a.timestamp > b.timestamp;
}
