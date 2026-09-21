#!/usr/bin/env node
/**
 * Run one of the art tools with whichever Python this machine calls Python.
 *
 * The npm scripts all said `python3`, which does not exist on Windows — the
 * name is a Microsoft Store stub that prints "Python was not found" and exits.
 * Meanwhile plain `python` is Python 2 on some older Linux and absent on
 * others, so neither name is portable on its own. This tries the candidates in
 * order and uses the first that reports 3.x.
 *
 *     node tools/art/py.mjs cutout.py --force
 */
import { spawnSync } from 'node:child_process';

// `py -3` is the Windows launcher and the most reliable name there; python3
// first everywhere else. Trying all of them costs a few milliseconds.
const CANDIDATES = [['python3'], ['py', '-3'], ['python']];

function works(cmd) {
  const r = spawnSync(cmd[0], [...cmd.slice(1), '-c', 'import sys; print(sys.version_info[0])'],
                      { encoding: 'utf8', shell: false });
  return r.status === 0 && r.stdout.trim() === '3';
}

const python = CANDIDATES.find(works);
if (!python) {
  console.error('No Python 3 found. Tried: ' + CANDIDATES.map(c => c.join(' ')).join(', '));
  console.error('Install Python 3 and make sure it is on PATH.');
  process.exit(127);
}

const [script, ...rest] = process.argv.slice(2);
if (!script) {
  console.error('usage: node tools/art/py.mjs <script.py> [args…]');
  process.exit(2);
}

const r = spawnSync(python[0], [...python.slice(1), `tools/art/${script}`, ...rest],
                    { stdio: 'inherit', shell: false });
process.exit(r.status ?? 1);
