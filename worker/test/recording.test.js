/**
 * The clip a species' play button gets. The rule is small, but it is what
 * every visitor hears, and a wrong tie-break would make the same button play
 * a different bird-less clip from one press to the next.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBestRecording } from '../src/recording.ts';

const MEDIA = 'https://media.birdweather.com/soundscapes/';
const ok = (url) => url.startsWith(MEDIA);

function det(id, score, confidence, timestamp, file = `${id}.flac`) {
  return {
    id, score, confidence, timestamp,
    speciesId: '1', commonName: 'Spotted Dove', scientificName: 'Spilopelia chinensis',
    stationId: '30108', soundscapeUrl: file === null ? null : MEDIA + file,
  };
}

test('the highest score wins, even over higher confidence', () => {
  const best = pickBestRecording([
    det('a', 7.1, 0.99, '2026-09-20T10:00:00Z'),
    det('b', 7.8, 0.80, '2026-09-19T10:00:00Z'),
    det('c', 6.5, 1.00, '2026-09-21T10:00:00Z'),
  ], ok);
  assert.equal(best.id, 'b');
});

test('equal scores fall to confidence, then to the newest clip', () => {
  const byConfidence = pickBestRecording([
    det('a', 7.4, 0.85, '2026-09-21T10:00:00Z'),
    det('b', 7.4, 0.93, '2026-09-18T10:00:00Z'),
  ], ok);
  assert.equal(byConfidence.id, 'b');

  const byRecency = pickBestRecording([
    det('old', 7.4, 0.9, '2026-09-18T10:00:00Z'),
    det('new', 7.4, 0.9, '2026-09-21T10:00:00Z'),
  ], ok);
  assert.equal(byRecency.id, 'new');
});

test('a detection with no audio is never chosen', () => {
  const best = pickBestRecording([
    det('silent', 9.9, 1.0, '2026-09-21T10:00:00Z', null),
    det('heard', 6.2, 0.7, '2026-09-20T10:00:00Z'),
  ], ok);
  assert.equal(best.id, 'heard');
});

test('a clip on a host outside the allowlist is never chosen', () => {
  const foreign = det('foreign', 9.9, 1.0, '2026-09-21T10:00:00Z');
  foreign.soundscapeUrl = 'https://example.com/x.flac';
  const best = pickBestRecording([foreign, det('ours', 6.2, 0.7, '2026-09-20T10:00:00Z')], ok);
  assert.equal(best.id, 'ours');
});

test('nothing playable returns null rather than a silent pick', () => {
  assert.equal(pickBestRecording([], ok), null);
  assert.equal(pickBestRecording([det('x', 8, 1, '2026-09-21T10:00:00Z', null)], ok), null);
});
