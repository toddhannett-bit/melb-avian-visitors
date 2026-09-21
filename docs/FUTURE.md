# Future enhancements

Nothing here is committed to. It is a record of where the good ideas were,
so they are not re-derived from scratch in six months.

Two things below are more than musing and are written up properly: the
**artwork-gap watcher** (§1), which is the next piece of work, and the
**"I saw it" button** (§2), which is the one idea that changes what the site
is for rather than making it nicer.

---

## 1. Tell me when a bird turns up that we cannot draw

**The problem.** Twenty-two species are illustrated. Fifty-one have been
detected. When an undrawn species is heard, the atlas shows the empty-nest
fallback — which reads as "not drawn yet" rather than as a fault, so nothing
is broken. But nobody finds out, and the gap only closes if somebody goes
looking for it.

**What this is not.** Not an alert. An undrawn bird is not an incident; the
site handles it gracefully. This is a *backlog feed* — it should produce a
work item, not a notification that demands attention at 3am. Treating it as
an alarm is how it ends up muted.

### What counts as a gap

Only a species that **passes the score gate**. `SCORE_GTE` is 6.0 and it
rejects roughly twenty of the fifty-one — a Glossy Black-Cockatoo that the
gate throws out is not a missing illustration, it is a misidentification
working as intended. Checking against raw detections instead would produce a
list of birds that should never be drawn.

Slug convention: the scientific name, lowercased, non-letters to hyphens.
`Grallina cyanoleuca` → `grallina-cyanoleuca.png` in
`web/avian/assets/illustrations/`. Both poses share the stem, the second
being `-2`.

### Recommended: a scheduled GitHub Action that opens one issue

Query BirdWeather directly, compare against the files in the repository,
open or update a single issue titled something like "Undrawn species (4)"
with the list and detection counts.

Why this shape:

- **It needs no password.** The BirdWeather API is public and anonymous, so
  the check queries it directly rather than going through the deployed site.
  That also means it keeps working if the site is down, and it does not need
  `SITE_PASSWORD` as a repository secret.
- **The work item lands where the work happens.** Fixing a gap means running
  `generate_missing.py` and pushing. An issue in the repo is already the
  right place for that, and it is free.
- **One issue, updated in place.** A new issue per species per week becomes
  noise, and noise becomes a filter rule.
- Inputs it needs are already in `worker/wrangler.toml`: `STATION_IDS` and
  `SCORE_GTE`. Read them rather than duplicating them, or they will drift.

Run it weekly, not hourly. A new species is a once-a-fortnight event at this
station, and the whole point is a list to work through, not a stream.

### Alternatives considered

- **Add the list to `/healthz`.** Worth doing anyway — it is two lines and
  makes the gap visible at a glance. But it is passive: it only tells you
  when you already thought to look.
- **Email or push (ntfy, Pushover).** Another service, another credential,
  for a signal that is not urgent. The Action can gain a push step later if
  the issue turns out to be too quiet.
- **Query the deployed site instead of BirdWeather.** Would work — Basic
  auth is still accepted precisely so non-browser clients can get in (see
  `docs/DEPLOY.md`) — but it puts the password in a GitHub secret and makes
  the check depend on the site being up, for no gain.

### The reason this matters more later

Every idea in §2 gets worse when a bird cannot be drawn. Spotting a
Magpie-lark and finding the site has nothing to show for it is a flat
moment. Magpie-lark is the largest gap today at 4,579 detections.

---

## 2. "I saw it!"

**The insight.** The microphone hears. People see. Those are different
datasets, and the gap between them is the game.

The site already knows a Rainbow Lorikeet called twenty minutes ago — so the
question it can ask is not "what did you see today?" (a blank page, a chore)
but "this one was just here, can you find it?". That makes the screen a reason
to go outside, which is the opposite of what screens usually do. A plain
logbook, with people typing in what they saw, would compete with the
microphone instead of complementing it.

**Shape.** A button on each bird. One tap, no typing, no reading. Then a
second tap for *who*. A confirmed bird gets marked permanently: a gold edge on
the collage, a marker beside it in the atlas. Upstream already has a `LIFER`
badge to build on.

**The failure mode to design against.** If it becomes a chore or a
leaderboard it dies in a week — and where the players are small children of
different ages, the younger one loses every time. A shared household total,
never a scoreboard.

**Infrastructure.** This is the first feature that writes. A household tapping
a few birds a day is nowhere near the 1,000 writes/day free KV limit that
constrains caching (`worker/src/cache.ts`), so it is free and needs nothing
new. And because a site like this is password-gated to the people who live
there, everything you would normally need for user-generated content —
accounts, moderation, abuse handling — is simply absent.

---

## 2b. Cache warming — considered, not done

First paint on a cold cache was 25.6s. Most of that is now gone for free (the
collage no longer waits on seven responses it does not read), but the
remainder is real: BirdWeather's aggregate queries take 5-24s cold and 4-11ms
warm, a factor of about five thousand.

The cache is not the problem — it is that **it is never warm**. The TTLs were
set to protect BirdWeather from our traffic: `recent` 60s, `stats` 120s. That
is right for a busy site. A site with one household on it has a gap between
visits that is always longer than the TTL, so every visit is a miss.

A Cloudflare Cron Trigger (free plan) would fix it by paying the cold cost on
a schedule. **Deferred on quota**, not on merit: the 1,000 KV writes/day free
tier is per *account*, and another site is already using about half of it.
Warming all eight endpoints every 20 minutes is ~576 writes/day, which does
not fit in what is left.

If it is revisited, the cheap version is to warm only what the first screen
needs — `recent` and `stats` — and leave the historical aggregates cold until
someone opens Stats or Atlas. At a 10-minute refresh that is ~288 writes/day
for both.

**Raising the TTLs is the free half of this and is worth doing on its own.**
Writes only happen on a miss, so a longer TTL means *fewer* writes, not more,
and a repeat visit inside the window is instant. `recent` at 10 minutes
instead of 60 seconds costs up to 10 minutes of staleness on a view of what
has been heard in the last hour — invisible in practice — and strictly
reduces quota use.

## 3. The rest, roughly in order of appetite

**A sound game.** Play a call, show three birds, tap the right one. Real
recordings from your own neighbourhood already work. No reading required, so
it works for a pre-reader, and it is the thing most likely to be replayed.

**"Something new arrived."** `action=lifelist` already tracks `first_seen`.
A species never heard before turning up is genuinely exciting and happens
often enough to matter. Make the site say so, loudly, for a day.

**Bird of the day.** One bird, large, its call, nothing else. The toddler's
version of the whole site.

**The dawn chorus.** The data has real shape — a peak at 6am and a second
wind around 5pm (`docs/SPIKE.md`). "The garden at six in the morning" is
something a small child can be shown and then go and experience.

**The long game.** A yearly ring — the birds of 2026, of 2027 — is worth
little now and quietly a lot in a decade.

**The e-ink frame.** Already planned; see `docs/HARDWARE.md` and PLAN.md §7.

---

## 4. What gates most of this

**Artwork coverage**, which is why §1 comes first — and stage two. "Go and
find it" only really works when the bird is fifteen metres away rather than a
kilometre down the road at somebody else's station.
