# Deploying the shim to Cloudflare

With a Cloudflare account this is about ten minutes. Everything below runs on
**your** machine — Cloudflare credentials should never be pasted into a chat or
committed, and `wrangler login` uses a browser OAuth flow so there is no token
to handle at all.

Verified against **wrangler 4.135.0**. The v3 syntax (`wrangler kv:namespace`,
with a colon) is gone; v4 uses spaces.

---

## 1. Get the code

```bash
git clone https://github.com/toddhannett-bit/melb-avian-visitors
cd melb-avian-visitors
npm run install:worker
```

**Stay in the repository root from here on.** The worker's `package.json`
lives in `worker/`, but the root scripts delegate to it, so `npm run deploy`
works from the top and you never have to track which directory you are in.
Running it from the root without this would fail with `ENOENT: no such file
or directory, open ...\package.json`.

Check it works before involving Cloudflare at all — these hit the real
BirdWeather API and need no account:

```bash
npm test        # 9 unit tests: timezone maths, gate serialisation
npm run live    # 31 checks against the six live stations in wrangler.toml
```

`npm run live` should print real birds with timestamps from the last few
minutes. If it doesn't, stop here — it's not a Cloudflare problem.

### Point it at your own patch

`worker/wrangler.toml` ships with a working cluster of six public stations in
inner Melbourne, so the above runs before you change anything. To make it
yours, find stations near you at
[app.birdweather.com/stations](https://app.birdweather.com/stations) — the id
is the number at the end of each station's URL — and set:

```toml
STATION_IDS = "...,...,..."   # 3-6 public stations within ~5 km
TIMEZONE    = "Australia/Melbourne"
SITE_NAME   = "Melbourne"     # whatever the header should say
```

`TIMEZONE` is load-bearing rather than cosmetic; see `worker/src/time.ts`.

### On Windows

PowerShell runs all of the above unchanged. Three differences, none of which
affect deploying:

**Environment variables.** Where these docs say `export FOO=bar`, PowerShell
wants:

```powershell
$env:FOO = "bar"
```

That matters for the art pipeline's `GEMINI_API_KEY`.

**`python3` does not exist on Windows.** The name is a Microsoft Store stub
that prints *"Python was not found"* and exits, even with Python installed.
Use `python` or `py -3` — or just use the npm scripts (`npm run art:cutout`
and friends), which go through `tools/art/py.mjs` and find whichever name
this machine uses.

**Backslash is not a line continuation.** A command split across lines with
`\` fails with *"Missing expression after unary operator"*. Put it on one
line, or use a backtick at the end of each line.

## 2. Log in

```bash
npx wrangler login
```

Opens a browser, asks you to authorise Wrangler, done. Confirm it picked the
right account:

```bash
npx wrangler whoami
```

If you have more than one account, note the **Account ID** and add it to
`wrangler.toml`:

```toml
account_id = "your-account-id"
```

## 3. Create the KV namespace

This is the response cache. It's what keeps us to a few hundred upstream
requests a day no matter how much traffic we get — which matters, because
BirdWeather publishes no rate limits and we'd rather not find them.

```bash
npx wrangler kv namespace create CACHE
```

It prints something like:

```
{ "kv_namespaces": [ { "binding": "CACHE", "id": "a1b2c3d4e5f6..." } ] }
```

Uncomment the block at the bottom of `wrangler.toml` and paste the id in:

```toml
[[kv_namespaces]]
binding = "CACHE"
id = "a1b2c3d4e5f6..."
```

**The id is not a secret** — it's an identifier, not a credential. Commit it.

## 4. Deploy

```bash
npm run deploy
```

You get a URL like `https://melb-avian-visitors.<your-subdomain>.workers.dev`.

## 5. Check it

```bash
curl https://melb-avian-visitors.<your-subdomain>.workers.dev/healthz
```

Should report `"source":"neighbourhood"` and six stations with recent
`latestDetectionAt` values. Then the real test:

```bash
curl 'https://melb-avian-visitors.<your-subdomain>.workers.dev/avian/api/birdnet-api.php?action=recent&hours=24' | head -c 600
```

Real birds heard near your stations in the last 24 hours. On the shipped
Melbourne cluster, a Spotted Dove with a four-figure count means it's working.

## 6. A custom domain

Attach one in the Cloudflare dashboard under *Workers & Pages >
melb-avian-visitors > Settings > Domains & Routes > Add > Custom domain*.
Cloudflare writes the DNS record and issues the certificate itself; nothing
about it lives in `wrangler.toml`, and `npm run deploy` leaves it alone.

Deliberately not declared as a `routes` entry here. The dashboard binding
already works, and moving it into the config would make every deploy
re-assert the domain - a new failure mode on the hot path, for no gain.

The `workers.dev` URL keeps working alongside it. Both are `noindex`.

---

## Free tier

Comfortably inside it:

| | Free limit | We use |
|---|---|---|
| Worker requests | 100,000/day | a few thousand at most |
| KV reads | 100,000/day | one per request, mostly cache hits |
| KV writes | 1,000/day | ~300 — this is the binding one, and caching is what keeps it low |

The KV write limit is the only one worth watching, and it is per **account**,
not per Worker — another site on the same account spends the same 1,000.
That is why the TTLs in `src/cache.ts` are as long as they are; don't shorten
them casually. They were raised once already, from values tuned for a site
with traffic: see the comment there and `docs/FUTURE.md` §2b.

## Optional: put it behind a password

A site like this quietly announces that there is a microphone in a particular
back yard, and `SITE_NAME` is usually a suburb. `noindex` keeps it out of
search results, but a memorable domain is easier to pass on than a long random
one — and easier to arrive at uninvited.

```bash
npm run secret:set
```

It prompts for the value and stores it encrypted on Cloudflare. **Never put
it in `wrangler.toml`** — that file is committed, and a password in it is
public the moment the repository is.

Run it from the repository root like everything else here. Calling
`npx wrangler secret put SITE_PASSWORD` directly from the root instead fails
with *"Required Worker name missing"*: `wrangler.toml` lives in `worker/`,
and a bare `wrangler` invocation only looks in the directory it was started
from. (On Windows the failure is followed by an `Assertion failed:
!(handle->flags & UV_HANDLE_CLOSING)` from libuv. That is noise on the way
out, not a second problem.)

Then `npm run deploy`. Every request now needs it: the page, the assets, the
audio, the API, all of it. There is one thing to tell people — a password, no
username.

It asks on a page of its own, styled like the rest of the site, rather than
in the browser's grey dialog box. That dialog is summoned by the
`www-authenticate` header, so the Worker simply does not send one.

**The form is not the check.** The Worker still refuses every request until a
valid cookie arrives. A login page that only hid the UI would be worth
nothing, because the API and the images are reachable directly; what the page
does is collect the password, and what enforces it is the same gate as
before.

The cookie is `<issued-at>.<HMAC-SHA256 of issued-at, keyed by the
password>`. It cannot be forged without knowing the password, it is HttpOnly
so no script can read it, and it lasts six months. There is no log-out:
changing the password invalidates every cookie already issued, because the
key that signed them changed. That is the way back if it is ever passed
around further than intended.

With no secret set the site stays open, which is the default and means a
misconfiguration cannot silently lock everyone out.

To remove it:

```bash
npm run secret:delete
```

**One thing to know if the e-ink frame ever happens:** a Raspberry Pi
fetching `/frame.png` would need the password too. Basic auth is still
accepted for exactly that — `https://user:pass@host/frame.png` or an
`Authorization` header. It is only no longer advertised, so no browser is
prompted by it. Any username; only the password is checked.

## Later: deploy from GitHub

If you'd rather not deploy by hand each time, create an API token
(**My Profile → API Tokens → Create Token → Edit Cloudflare Workers**) and put
it in the repo's GitHub Actions secrets as `CLOUDFLARE_API_TOKEN`. That token
*is* a credential — GitHub Secrets only, never the repo, never a chat.

Worth doing once the frontend lands and deploys get frequent. Not yet.

---

## Stage two: pointing it at your own mic

When your station exists, one value changes:

```toml
OWN_STATION_ID = "31234"   # the number at the end of its BirdWeather page URL
```

```bash
npm run deploy
```

Every view narrows from the neighbourhood to your back yard. Nothing else moves.

Two things to do at the same time:

1. **Re-tune `SCORE_GTE`.** The 6.0 floor was measured on the neighbours'
   microphones. A less sensitive capsule scores lower across the board, so the
   same threshold will cut deeper. Give it a week of data, then check
   `/healthz` and the rejected list in `npm run live` against what you are
   actually hearing.
2. **Check `/healthz` reports `"source":"own-station"`.** If it still says
   `neighbourhood`, the variable didn't take.

## If something breaks

| Symptom | Cause |
|---|---|
| Every action returns `{"error":"sensor offline"}` | Upstream unreachable, or the gate failed to build. This is the designed degradation, not a crash — check the Worker logs with `npx wrangler tail` |
| Views return 200 but with empty arrays | Almost certainly the `scoreGte: null` trap — see `worker/README.md`. An explicit null matches nothing upstream |
| Collage is blank in production but fine in dev | The gate cache reviving empty. Dev runs without KV bound, so it only shows once deployed. Covered by `test/gate.test.js` |
| Species you expect are missing | They're below the score floor. `npm run live` prints the full rejected list |
