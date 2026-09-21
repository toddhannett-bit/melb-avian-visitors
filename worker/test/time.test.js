/**
 * The timezone helpers carry real risk: a Worker runs in UTC and Melbourne is
 * 10-11 hours ahead, so a naive date is *yesterday* for most of the local day, and
 * the dawn chorus smears across the boundary. These pin the behaviour.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, daysBetween, localDate, localHour, localSlot, localStamp,
} from '../src/time.ts';

const TZ = 'Australia/Melbourne';

test('local date is the Melbourne day, not the UTC day', () => {
  // 2026-09-20 22:00 UTC is already the 21st in Melbourne (AEST, +10).
  assert.equal(localDate(TZ, new Date('2026-09-20T22:00:00Z')), '2026-09-21');
  // And 13:00 UTC is 23:00 the same evening — still the 20th.
  assert.equal(localDate(TZ, new Date('2026-09-20T13:00:00Z')), '2026-09-20');
});

test('midnight Melbourne resolves to hour 0, not 24', () => {
  const at = new Date('2026-09-20T14:00:00Z'); // 00:00 on the 21st, AEST
  assert.equal(localHour(TZ, at), 0);
  assert.equal(localSlot(TZ, at), 0);
  assert.equal(localStamp(TZ, at), '2026-09-21 00:00:00');
});

test('slots cover the whole day and match the dawn peak', () => {
  // 06:00 Melbourne, the hour the spike found carries the chorus.
  const dawn = new Date('2026-09-19T20:00:00Z');
  assert.equal(localHour(TZ, dawn), 6);
  assert.equal(localSlot(TZ, dawn), 360);
  // 23:59 local is the last slot.
  assert.equal(localSlot(TZ, new Date('2026-09-20T13:59:00Z')), 1439);
});

test('AEST/AEDT transition is handled', () => {
  // Melbourne moves to AEDT (+11) on the first Sunday of October.
  const beforeDst = new Date('2026-10-03T13:00:00Z'); // 23:00 AEST, Sat 3rd
  const afterDst = new Date('2026-10-04T13:00:00Z');  // 00:00 AEDT, Mon 5th
  assert.equal(localDate(TZ, beforeDst), '2026-10-03');
  assert.equal(localHour(TZ, beforeDst), 23);
  // Same UTC hour a day later is already the next local day, because the
  // offset moved from +10 to +11.
  assert.equal(localDate(TZ, afterDst), '2026-10-05');
  assert.equal(localHour(TZ, afterDst), 0);
});

test('addDays crosses months and a DST boundary without drifting', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-10-01', -1), '2026-09-30');
  assert.equal(addDays('2026-10-03', 2), '2026-10-05'); // spans the DST change
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('daysBetween is signed and inclusive-exclusive', () => {
  assert.equal(daysBetween('2026-09-20', '2026-09-27'), 7);
  assert.equal(daysBetween('2026-09-27', '2026-09-20'), -7);
  assert.equal(daysBetween('2026-09-20', '2026-09-20'), 0);
  assert.equal(daysBetween('2026-10-03', '2026-10-05'), 2);
});
