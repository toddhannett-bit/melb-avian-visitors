# Putting a microphone in a back yard

**Recommendation: ~A$130 for a Pi Zero 2 W build — or ~A$35 if there is already
an always-on computer in the house.**
*Revised 2026-09-20 after the A$580 PUC was ruled out.*

The A$499 PUC was an over-spec. What it mostly buys is a weatherproof
enclosure — and the reference project doesn't weatherproof anything. Its
instruction is literally *"plug the USB mic into the Pi, place the capsule in a
window."* Its entire bill of materials is **US$62–117**.

So the cheap path isn't a compromise. It's the original design.

---

## The key realisation: the computer stays inside

A USB lavalier has a 1–2 m cable and costs about A$30. Run the capsule out a
rear window, or up under the eaves on an extension, and leave the computer
indoors on mains power and good Wi-Fi.

That deletes, in one move, the weatherproof enclosure, the outdoor power run,
the outdoor Wi-Fi problem, and most of the price difference. A mic at a back
window hears the back yard perfectly well — that is exactly what AvianVisitors
is built to do.

---

## Four options

### Tier 0 — ~A$35: use a computer that's already running

**BirdNET-Go runs on Linux, Windows and macOS, with Docker images for both
`linux/amd64` and `linux/arm64`, and it has built-in BirdWeather upload.** It is
not Pi-only.

So if there is anything already running 24/7 — an old laptop, a mini PC, a NAS
that runs Docker, a home server — **the entire hardware cost is a USB
microphone**.

| Item | Price |
|---|---|
| USB lavalier mic | ~A$30 |
| **Total** | **~A$30–40** |

**Check first.** This is worth asking before spending anything: *is there any
computer in the house that's on all the time?* If yes, this is done for the
price of lunch.

Caveat: it has to be genuinely always-on and near a window. A laptop that gets
shut at night is no good.

### Tier 1 — ~A$130: Pi Zero 2 W *(recommended if buying)*

Matches the reference project's own BOM. Runs **BirdNET-Pi** (not Go — see the
caveat).

| Item | Price | Notes |
|---|---|---|
| Raspberry Pi Zero 2 W | ~A$33 | [Pi Australia](https://piaustralia.com.au/products/raspberry-pi-zero-2-w) — **currently backordered**, check Core Electronics / Little Bird / Zaitronics |
| 32 GB microSD (A1 or high-endurance) | ~A$15 | **Not** the A$59 one the Pi shops upsell. Endurance cards suit 24/7 writes |
| 5 V power supply | ~A$20 | |
| micro-USB OTG adapter | ~A$8 | The Zero has micro-USB, the mic is USB-A |
| USB lavalier mic | ~A$30 | Upstream uses a US$16.95 one |
| Shelter for the capsule | ~A$0–15 | An upturned jar, a bit of pipe, or nothing if it sits inside the window |
| **Total** | **~A$105–130** | |

**Caveat:** the Zero 2 W has 512 MB of RAM. BirdNET-Pi supports it but needs a
[specific install path for 512 MB boards](https://github.com/mcguirepr89/BirdNET-Pi/wiki/RPi0W2-Installation-Guide),
and it is doing real inference on every three-second window. Inner suburbia is
noisy — the nearest station alone logs ~11,000 detections a month — so a Zero 2 W will be
working hard and may drop clips at the dawn peak. Acceptable; not ideal.

### Tier 2 — ~A$220: Pi 4 / Pi 5 + a better mic

| Item | Price |
|---|---|
| Pi 4 Model B 2 GB (or Pi 5 2 GB) | ~A$95–130 |
| 32 GB high-endurance microSD | ~A$15 |
| USB-C power supply | ~A$20 |
| Better USB mic (Boya BY-LM40 or similar) | ~A$50–60 |
| **Total** | **~A$180–225** |

Buys headroom, **BirdNET-Go** (Docker, actively developed, what most new
Melbourne stations run), and a mic that will measurably out-detect the A$30 one.
This is the "do it once, properly" option.

### Tier 3 — A$580: BirdWeather PUC

[traps.com.au](https://traps.com.au/product/birdweather-puc/), A$499 + A$54 hut.
Weatherproof, zero assembly, zero maintenance. **Ruled out on price.** Noted
only so the trade-off is on the record: what you're declining is the enclosure
and someone else's warranty.

---

## What I'd actually do

1. **Ask: is there a computer in the house that's on all the time?** If yes →
   Tier 0, ~A$35, done.
2. If no → **Tier 1 at ~A$130.** It matches the reference design, and if the Zero
   2 W struggles the board is A$33 to replace with a Pi 4 later. Nothing else in
   the build gets thrown away.
3. Tier 2 only if you'd rather not revisit it.

Either way the mic is worth spending on before the computer is. Detection
quality tracks the microphone far more than the CPU.

---

## Melbourne is not California

Worth flagging against the reference build. Theodore's own mic is a USB lavalier
on an **apartment balcony** on a 3D-printed base, and he says plainly that the
mounts are *"'california weather grade' (lol) ... not meant for any weather
besides clear blue skys"*, with an all-weather enclosure listed as future work.

That cuts both ways. It **confirms the cheap path** — the reference rig is a
lavalier clipped up outdoors, and it works. But **Melbourne gets horizontal
rain**, so an upturned jar won't do. Either keep the capsule under a genuine
eave, or budget a real enclosure. This is the one part of that design that
doesn't transfer, and it is precisely what the A$499 PUC was selling.

Also concrete for Tier 1: the **Zero 2 W needs a swap file configured and Wi-Fi
power-save disabled** to cope with 512 MB. Upstream's installer handles it; do
not skip it.

## Two things the cheap path costs us

**1. A worse mic lowers detection scores — and we gate on score.**

This is the one real interaction between the budget decision and the app. The
spike settled on `score >= 6.0` as the quality filter, tuned against the
*neighbours'* microphones. A less sensitive capsule produces lower confidence
and lower scores across the board, so that threshold will need re-tuning against
your own station once it's live, or good birds will silently vanish.

Budget a re-tune after the first week of data. It's a config value, not a
rewrite — but it is not optional.

**2. Someone has to maintain it.**

A PUC is an appliance. A Pi is a computer, and in two years it will want an SD
card. If it lives in someone else's house, be honest up front about who that
falls to.

---

## Placement (unchanged, and free)

- **Rear window or under the eaves**, sheltered from direct rain and out of the
  prevailing wind. Wind noise is the main quality killer.
- **Aim at foliage, not fence line.** A tree in or over the yard is worth more
  than every dollar above.
- **Away from the road.** A nearby freeway raises the noise floor and depresses
  scores — which, per the point above, is not cosmetic.

---

## The part that doesn't change

Whatever you buy, **it publishes to BirdWeather**, and that is the entire
integration:

```
your mic  ──►  BirdWeather  ──►  the Worker (cached)  ──►  the web app
```

BirdNET-Pi and BirdNET-Go both upload to BirdWeather natively. So your station
is one more `stationId`; there's no tunnel into the house, no port forwarding,
no dynamic DNS; and you can build and test the whole app against a neighbouring
public station while the parts arrive, then flip one config value.

**Nothing in the app depends on which tier you pick.**

---

## Setup, once it's running

Register the station with BirdWeather, set the location, **make it public** (our
app reads the public API), then take the numeric ID from the end of its
BirdWeather station-page URL. That number is the one config value the app needs.

---

## Sources

[AvianVisitors BOM](https://github.com/Twarner491/AvianVisitors) ·
[BirdNET-Go](https://github.com/tphakala/birdnet-go) ·
[BirdNET-Go hardware guide](https://github.com/tphakala/birdnet-go/blob/main/doc/wiki/hardware.md) ·
[BirdNET-Pi on 512 MB boards](https://github.com/mcguirepr89/BirdNET-Pi/wiki/RPi0W2-Installation-Guide) ·
[Pi Australia](https://piaustralia.com.au/products/raspberry-pi-zero-2-w) ·
[Mic comparison thread](https://github.com/mcguirepr89/BirdNET-Pi/discussions/1092) ·
[BirdWeather PUC, AU](https://traps.com.au/product/birdweather-puc/)
