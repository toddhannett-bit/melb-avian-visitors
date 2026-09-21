/**
 * Optional password over the whole site, as a page rather than a dialog.
 *
 * The password is a Worker secret, not a var: wrangler.toml is committed and
 * a password in it would be public the moment the repository is. With no
 * secret set the site is open, which keeps a misconfiguration from silently
 * locking everyone out.
 *
 * This replaces the browser's basic-auth dialog, which asked for a username
 * the site does not have and could not be made to look like anything. What it
 * does NOT do is move the check into the page: the Worker still refuses every
 * request — HTML, images, audio, API — until a valid cookie arrives, so the
 * password is worth the same as it was before. A login form that only hides
 * the UI would be worth nothing.
 *
 * The cookie is `<issued-at>.<HMAC-SHA256 of issued-at, keyed by the
 * password>`. It cannot be forged without the password, it carries its own
 * expiry, and changing the password invalidates every cookie already out
 * there because the key changed.
 */
const COOKIE = 'bb_session';
const MAX_AGE_S = 180 * 24 * 60 * 60;   // six months: a gift, not a bank
/** A wrong password costs this long, which is what makes guessing tedious. */
const WRONG_PASSWORD_DELAY_MS = 700;

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * A naive `===` returns as soon as it finds a differing byte, so response
 * time reveals how much of a guess was correct. This always walks the whole
 * string.
 */
export function secretsMatch(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

async function sign(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function mintToken(secret: string): Promise<string> {
  const issued = Math.floor(Date.now() / 1000).toString();
  return `${issued}.${await sign(secret, issued)}`;
}

async function tokenValid(token: string, secret: string): Promise<boolean> {
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const issued = token.slice(0, dot);
  const age = Math.floor(Date.now() / 1000) - Number.parseInt(issued, 10);
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_S) return false;
  return secretsMatch(token.slice(dot + 1), await sign(secret, issued));
}

function readCookie(request: Request, name: string): string | null {
  const jar = request.headers.get('cookie');
  if (!jar) return null;
  for (const part of jar.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function passwordFor(env: { SITE_PASSWORD?: string }): string | null {
  const expected = env.SITE_PASSWORD?.trim();
  return expected ? expected : null;
}

export async function authorised(request: Request, secret: string): Promise<boolean> {
  const token = readCookie(request, COOKIE);
  if (token && await tokenValid(token, secret)) return true;

  // Basic auth is still accepted, just no longer advertised — so no browser
  // dialog, but `https://user:pass@host/frame.png` keeps working for anything
  // without a cookie jar. The e-ink frame, if it ever happens, is exactly that.
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Basic ')) return false;
  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  return secretsMatch(decoded.slice(decoded.indexOf(':') + 1), secret);
}

/**
 * Only ever redirect back to a path on this site.
 *
 * `//evil.com` is the obvious attack and is rejected. `/\evil.com` is the
 * same attack spelled differently: the URL parser treats a backslash as a
 * slash for http(s), so a browser resolves it to `https://evil.com/`. Any
 * leading run of either character therefore fails the check, not just a
 * second slash.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/')) return '/';
  if (/^[/\\]{2,}/.test(raw)) return '/';
  if (raw.includes('\\')) return '/';
  return raw;
}

export async function handleLogin(request: Request, secret: string): Promise<Response> {
  const form = await request.formData();
  const given = String(form.get('password') ?? '');
  const next = safeNext(String(form.get('next') ?? '/'));

  if (!secretsMatch(given, secret)) {
    await new Promise(r => setTimeout(r, WRONG_PASSWORD_DELAY_MS));
    return loginPage(next, { wrong: true, status: 401 });
  }

  return new Response(null, {
    status: 303,
    headers: {
      location: next,
      'cache-control': 'no-store',
      'set-cookie': `${COOKIE}=${await mintToken(secret)}; Path=/; Max-Age=${MAX_AGE_S}`
        + '; HttpOnly; Secure; SameSite=Lax',
    },
  });
}

/**
 * The page itself. Deliberately says nothing the password is meant to keep
 * back — not even SITE_NAME, which for most people is the suburb they live
 * in. Anyone who has not got in yet should learn nothing from the door.
 *
 * Wholly self-contained, because every static asset is behind the same check
 * and a stylesheet the visitor cannot fetch is no stylesheet at all.
 */
export function loginPage(next: string, opts: { wrong?: boolean; status?: number } = {}): Response {
  // Escaping the quote is what actually holds the attribute together; the
  // angle brackets go too, so a payload cannot even sit in the source
  // looking like markup to whatever reads it next.
  const nextAttr = safeNext(next)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Birds</title>
<style>
  :root { --paper:#faf8f2; --ink:#1a1612; --ink-soft:#908576; --rule:#e8e6df; }
  @media (prefers-color-scheme: dark) {
    :root { --paper:#17181c; --ink:#ece8e1; --ink-soft:#837c70; --rule:#2c2f36; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center;
    justify-content:center; padding:24px; gap:0;
    background:var(--paper); color:var(--ink);
    font-family:Georgia,'Times New Roman',serif; }
  form { width:100%; max-width:22rem; text-align:center; }
  h1 { margin:0 0 0.4em; font-weight:400; font-size:clamp(1.7rem,6vw,2.4rem); }
  p { margin:0 0 2em; font-size:0.82rem; letter-spacing:0.16em;
    text-transform:uppercase; color:var(--ink-soft);
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  input { width:100%; min-height:44px; padding:0.8em 1em; margin-bottom:0.9em;
    border:1px solid var(--rule); border-radius:10px; background:transparent;
    color:var(--ink); font:inherit; font-size:1rem; text-align:center; }
  input:focus { outline:none; border-color:var(--ink); }
  button { width:100%; min-height:44px; padding:0.85em 2em; border-radius:999px;
    border:1px solid var(--ink); background:var(--ink); color:var(--paper);
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:0.8rem;
    letter-spacing:0.16em; text-transform:uppercase; cursor:pointer; }
  .wrong { color:#b4472e; text-transform:none; letter-spacing:0;
    font-size:0.85rem; margin:-1.4em 0 1.4em; }
  @media (prefers-color-scheme: dark) { .wrong { color:#e08b70; } }
</style>
</head>
<body>
<form method="POST" action="/enter">
  <h1>Birds</h1>
  <p>Password, please</p>
  ${opts.wrong ? '<p class="wrong">That is not it. Try again?</p>' : ''}
  <input type="password" name="password" autocomplete="current-password"
         aria-label="Password" autofocus required>
  <input type="hidden" name="next" value="${nextAttr}">
  <button type="submit">Enter</button>
</form>
</body>
</html>`;
  return new Response(html, {
    status: opts.status ?? 401,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // No www-authenticate: that header is what summons the browser dialog.
    },
  });
}

/** Whether this request wants a page, as opposed to an image or some JSON. */
export function wantsPage(request: Request): boolean {
  return request.method === 'GET'
    && (request.headers.get('accept') ?? '').includes('text/html');
}
