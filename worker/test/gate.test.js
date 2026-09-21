/**
 * Regression tests for the gate's serialisation, which has bitten once: a Set
 * stringifies to `{}`, so a cached gate came back empty and empty means every
 * species is rejected — a blank collage, in production only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviveGate, serialiseGate } from '../src/gate.ts';

test('a gate survives a JSON round-trip through the cache', () => {
  const original = {
    allowed: new Set(['1', '2', '3']),
    rejected: new Map([['9', 'Glossy Black-Cockatoo']]),
    builtAt: '2026-09-20T09:00:00.000Z',
  };
  const revived = reviveGate(JSON.parse(JSON.stringify(serialiseGate(original))));

  assert.ok(revived.allowed instanceof Set);
  assert.ok(revived.rejected instanceof Map);
  assert.equal(revived.allowed.size, 3);
  assert.ok(revived.allowed.has('2'));
  assert.equal(revived.rejected.get('9'), 'Glossy Black-Cockatoo');
  assert.equal(revived.builtAt, original.builtAt);
});

test('stringifying a Set directly would have lost everything', () => {
  // Pinning the hazard itself, so nobody "simplifies" serialiseGate away.
  assert.equal(JSON.stringify(new Set(['a', 'b'])), '{}');
});

test('a malformed cache entry revives as an empty gate, not a crash', () => {
  const revived = reviveGate({ builtAt: 'x' });
  assert.equal(revived.allowed.size, 0);
  assert.equal(revived.rejected.size, 0);
});
