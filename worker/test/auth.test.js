/**
 * The password is the only thing standing between two children's names, their
 * suburb, the fact that there is a microphone in their back yard, and anyone
 * who guesses the address. Moving it from the browser's basic-auth dialog to
 * a form on the page is a UI change, and these pin the part that must NOT
 * have changed with it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorised, handleLogin, loginPage, passwordFor, secretsMatch, wantsPage,
} from '../src/auth.ts';

const PASSWORD = 'correct horse battery staple';

// Whatever a deployment calls itself; the login page must not say it.
const SITE_NAME = 'Melbourne';

const page = (path = '/') => new Request(`https://birds.example.com${path}`, {
  headers: { accept: 'text/html,application/xhtml+xml' },
});

const withCookie = (cookie, path = '/') =>
  new Request(`https://birds.example.com${path}`, { headers: { cookie } });

const login = (fields) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return new Request('https://birds.example.com/enter', { method: 'POST', body });
};

/** The Set-Cookie value a successful login hands back. */
async function sessionCookie(password = PASSWORD) {
  const res = await handleLogin(login({ password, next: '/' }), PASSWORD);
  const header = res.headers.get('set-cookie');
  return header.slice(0, header.indexOf(';'));
}

test('no secret set means the site is open', () => {
  assert.equal(passwordFor({}), null);
  assert.equal(passwordFor({ SITE_PASSWORD: '   ' }), null);
  assert.equal(passwordFor({ SITE_PASSWORD: ' hunter2 ' }), 'hunter2');
});

test('a request with no cookie is refused', async () => {
  assert.equal(await authorised(page(), PASSWORD), false);
});

test('the right password issues a cookie that gets you in', async () => {
  const res = await handleLogin(login({ password: PASSWORD, next: '/' }), PASSWORD);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/');
  assert.ok(await authorised(withCookie(await sessionCookie()), PASSWORD));
});

test('the cookie is HttpOnly, Secure and SameSite — it must not be readable from JS', async () => {
  const res = await handleLogin(login({ password: PASSWORD, next: '/' }), PASSWORD);
  const header = res.headers.get('set-cookie');
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Lax/);
});

test('a wrong password issues nothing', async () => {
  const res = await handleLogin(login({ password: 'hunter2', next: '/' }), PASSWORD);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('a forged cookie is refused', async () => {
  const real = await sessionCookie();
  const token = real.slice(real.indexOf('=') + 1);
  const issued = token.split('.')[0];
  // Change the last byte to something it is not. `replace(/.$/, 'f')` looked
  // equivalent and was not: one signature in sixteen already ends in 'f', and
  // on those runs the "forgery" was the untouched, valid cookie, so the test
  // failed roughly every fifth full run.
  const lastByteChanged = token.slice(0, -1) + (token.endsWith('f') ? 'e' : 'f');
  for (const forged of [
    `bb_session=${issued}.${'0'.repeat(64)}`,     // plausible-looking signature
    `bb_session=${issued}.`,                      // empty signature
    `bb_session=${issued}`,                       // no signature at all
    'bb_session=nonsense',
    `bb_session=${lastByteChanged}`,              // one byte off
  ]) {
    assert.equal(await authorised(withCookie(forged), PASSWORD), false, forged);
  }
});

test('a cookie signed with a different password is refused', async () => {
  assert.equal(await authorised(withCookie(await sessionCookie()), 'a different one'), false);
});

test('an expired cookie is refused', async () => {
  // Signed correctly, but issued seven months ago.
  const stale = Math.floor(Date.now() / 1000) - 210 * 24 * 60 * 60;
  const res = await handleLogin(login({ password: PASSWORD, next: '/' }), PASSWORD);
  const real = res.headers.get('set-cookie');
  const sig = real.slice(0, real.indexOf(';')).split('.')[1];
  assert.equal(await authorised(withCookie(`bb_session=${stale}.${sig}`), PASSWORD), false);
});

test('basic auth still works, for anything without a cookie jar', async () => {
  const req = new Request('https://birds.example.com/frame.png', {
    headers: { authorization: 'Basic ' + btoa('frame:' + PASSWORD) },
  });
  assert.ok(await authorised(req, PASSWORD));
  const wrong = new Request('https://birds.example.com/frame.png', {
    headers: { authorization: 'Basic ' + btoa('frame:hunter2') },
  });
  assert.equal(await authorised(wrong, PASSWORD), false);
});

test('the login page never summons the browser dialog', () => {
  // www-authenticate is the header that does it. Its absence is the feature.
  assert.equal(loginPage('/').headers.get('www-authenticate'), null);
});

test('the login page gives nothing away', () => {
  const html = loginPage('/').body;
  return new Response(html).text().then(text => {
    // The door must not carry SITE_NAME, a place name, or anything about
    // where the microphone is. Nothing here is interpolated, so this test is
    // really a tripwire against someone helpfully adding it later.
    for (const secret of [SITE_NAME, 'Melbourne', 'back yard', 'microphone']) {
      assert.ok(!text.includes(secret), `login page leaks "${secret}"`);
    }
  });
});

test('next= cannot be turned into an open redirect', async () => {
  for (const [given, expected] of [
    ['https://evil.example/', '/'],
    ['//evil.example/', '/'],
    // A backslash is a slash to the URL parser, so each of these resolves to
    // https://evil.example/ in a browser exactly as '//evil.example/' does.
    ['/\\evil.example/', '/'],
    ['\\\\evil.example/', '/'],
    ['/\\/evil.example/', '/'],
    ['/birds?x=1', '/birds?x=1'],
    ['', '/'],
  ]) {
    const res = await handleLogin(login({ password: PASSWORD, next: given }), PASSWORD);
    assert.equal(res.headers.get('location'), expected, given);
  }
});

test('next= cannot break out of the hidden field', async () => {
  const res = loginPage('/"><script>alert(1)</script>');
  const text = await new Response(res.body).text();
  assert.ok(!text.includes('<script>alert(1)</script>'));
});

test('only a browser navigation should be answered with the form', () => {
  assert.ok(wantsPage(page()));
  assert.equal(wantsPage(new Request('https://birds.example.com/a.png')), false);
  assert.equal(wantsPage(login({ password: 'x' })), false);
});

test('secretsMatch is length-safe and exact', () => {
  assert.ok(secretsMatch('abc', 'abc'));
  assert.equal(secretsMatch('abc', 'abd'), false);
  assert.equal(secretsMatch('ab', 'abc'), false);
  assert.equal(secretsMatch('', ''), true);
});
