/**
 * Exercises every action against the real BirdWeather API and the real
 * example stations. Not a unit test — a smoke test that the contract the
 * forked frontend expects is actually being met with live data.
 *
 *   node --experimental-strip-types test/live.js
 */
import worker from '../src/index.ts';

const env = {
  STATION_IDS: '30108,16110,10847,19263,26279,30491',
  OWN_STATION_ID: '',
  TIMEZONE: 'Australia/Melbourne',
  SCORE_GTE: '6.0',
  SITE_NAME: 'Melbourne',
};

const call = async (qs) => {
  const res = await worker.fetch(
    new Request(`https://example.invalid/avian/api/birdnet-api.php?${qs}`), env);
  return { status: res.status, body: await res.json() };
};

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('\n=== health ===');
{
  const res = await worker.fetch(new Request('https://example.invalid/healthz'), env);
  const body = await res.json();
  console.log(`  source=${body.source} score_gte=${body.score_gte} stations=${body.stations.length}`);
  for (const s of body.stations) console.log(`    ${s.id.padEnd(6)} ${String(s.name).slice(0,34).padEnd(34)} last=${s.latestDetectionAt}`);
  check('healthz returns every configured station', body.stations.length === 6);
}

console.log('\n=== the quality gate ===');
{
  const { buildGate } = await import('../src/gate.ts');
  const g = await buildGate({
    stationIds: env.STATION_IDS.split(','),
    scoreGte: Number(env.SCORE_GTE),
    tz: env.TIMEZONE,
  });
  const rejected = new Set([...g.rejected.values()]);
  console.log(`  allowed=${g.allowed.size}  rejected=${g.rejected.size}`);
  console.log('  rejected:', [...rejected].join(', ') || '(none)');

  // The birds the spike identified as implausible for an inner-suburban
  // Melbourne back yard. If any of these reappears in the collage, the gate
  // has regressed — most likely by reading totalCount, which ignores filters.
  const mustReject = ['Glossy Black-Cockatoo', 'Osprey', 'Superb Lyrebird', 'Whiskered Tern'];
  for (const name of mustReject) {
    check(`gate rejects ${name}`, rejected.has(name));
  }
  // And the rarities that must survive it.
  const allowedNames = new Set();
  {
    const { topSpecies } = await import('../src/birdweather.ts');
    const all = await topSpecies({
      stationIds: env.STATION_IDS.split(','),
      period: { count: 90, unit: 'day', timezone: env.TIMEZONE },
    });
    for (const s of all) if (g.allowed.has(s.speciesId)) allowedNames.add(s.commonName);
  }
  for (const name of ['Laughing Kookaburra', 'Musk Lorikeet', 'Long-billed Corella', 'Galah']) {
    check(`gate keeps ${name}`, allowedNames.has(name));
  }
  check('gate is not empty', g.allowed.size > 20, `${g.allowed.size} species`);
}

console.log('\n=== stats ===');
{
  const { status, body } = await call('action=stats');
  console.log(' ', JSON.stringify(body).slice(0, 300));
  check('stats 200', status === 200);
  check('stats has totals.detections', Number.isFinite(body?.totals?.detections));
  check('stats has station_date', /^\d{4}-\d{2}-\d{2}$/.test(body?.station_date ?? ''));
}

console.log('\n=== recent (24h) ===');
{
  const { status, body } = await call('action=recent&hours=24');
  check('recent 200', status === 200);
  check('recent has species[]', Array.isArray(body?.species));
  console.log(`  ${body.species?.length} species, window_start=${body.window_start}, site=${body.site_name}`);
  for (const s of (body.species ?? []).slice(0, 8)) {
    console.log(`    ${String(s.com).padEnd(26)} n=${String(s.n).padEnd(5)} conf=${s.best_conf} last=${s.last_seen}`);
  }
  const first = body.species?.[0];
  check('row has the fields apt.js reads',
    !!first && 'sci' in first && 'com' in first && 'n' in first &&
    'best_conf' in first && 'last_seen' in first && 'detection_id' in first);
  check('gate excluded the junk',
    !(body.species ?? []).some((s) => s.com === 'Glossy Black-Cockatoo'));
}

console.log('\n=== hourly ===');
{
  const { status, body } = await call('action=hourly&limit=6');
  check('hourly 200', status === 200);
  check('hourly pivots to species[].hours[]',
    Array.isArray(body?.species) && (body.species.length === 0 || Array.isArray(body.species[0].hours)));
  for (const s of (body.species ?? []).slice(0, 5)) {
    const peak = s.hours.reduce((a, b) => (b.n > a.n ? b : a), { hour: -1, n: 0 });
    console.log(`    ${String(s.com).padEnd(26)} total=${String(s.total).padEnd(5)} peak=${peak.hour}:00`);
  }
}

console.log('\n=== rhythm ===');
{
  const { status, body } = await call('action=rhythm&days=7&hours=24');
  check('rhythm 200', status === 200);
  check('rhythm slots=1440', body?.slots === 1440);
  check('rhythm today[] is slot-keyed',
    Array.isArray(body?.today) && (body.today.length === 0 || 'slot' in body.today[0]));
  console.log(`  mode=${body.mode} today=${body.today?.length} slots, avg=${body.avg?.length} slots, now_slot=${body.now_slot}`);
}

console.log('\n=== timeseries / calendar / firstseen / lifelist ===');
for (const [name, qs, assert] of [
  ['timeseries', 'action=timeseries&days=14', (b) => Array.isArray(b.daily) && Array.isArray(b.by_hour)],
  ['calendar', 'action=calendar', (b) => Array.isArray(b.days)],
  ['firstseen', 'action=firstseen&limit=5', (b) => Array.isArray(b.species)],
  ['lifelist', 'action=lifelist', (b) => Array.isArray(b.species)],
]) {
  const { status, body } = await call(qs);
  check(`${name} 200`, status === 200);
  check(`${name} shape`, assert(body ?? {}));
  if (name === 'timeseries') {
    console.log('    daily tail:', JSON.stringify(body.daily?.slice(-3)));
    console.log('    by_hour   :', body.by_hour?.map((h) => `${h.hour}:${h.detections}`).join(' '));
  }
  if (name === 'lifelist') console.log(`    ${body.species?.length} species on the life list`);
  if (name === 'firstseen') console.log('    newest:', body.species?.map((s) => s.com).join(', '));
}

console.log('\n=== unknown action ===');
{
  const { status, body } = await call('action=nope');
  check('unknown action 404s', status === 404 && body?.error === 'unknown action');
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join('; ')); process.exit(1); }
