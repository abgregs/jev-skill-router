# 001 — Coalesce scrub seeks and unify the mechanism ticker

- **Status**: DONE
- **Commit**: dc25d41
- **Severity**: HIGH
- **Category**: Performance / Interruptibility
- **Estimated scope**: 1 file (`web/app.js`), ~40 lines changed

## Problem

The Mechanism figure's replay scrubber stutters during drags and gets progressively
jankier after repeated Replay presses. Three defects in `web/app.js`:

1. **Unthrottled seeks.** The range `input` event fires faster than frames during a
   drag, and each event pauses and seeks every WAAPI animation (~18 of them):

```js
/* web/app.js:400 — current */
scrub.addEventListener('input', () => mechScrubTo(Number(scrub.value)))

/* web/app.js:347 — current */
function mechScrubTo(ms) {
  cancelAnimationFrame(MECH.raf)
  for (const a of MECH.anims) {
    a.pause()
    a.currentTime = ms
  }
  mechCounter()
}
```

2. **rAF loop multiplication.** Every Replay click spawns an additional `syncScrub`
   chain; there is no guard (unlike `MECH.raf`, which is cancelled before reuse).
   After N replays, N loops write `scrub.value` every frame:

```js
/* web/app.js:401 — current */
const syncScrub = () => {
  const master = MECH.anims[MECH.anims.length - 1]
  if (master.playState === 'running') {
    scrub.value = String(Math.round(Number(master.currentTime ?? 0)))
    requestAnimationFrame(syncScrub)
  } else {
    scrub.value = scrub.max
  }
}
$('mech-replay').addEventListener('click', () => {
  mechPlay()
  requestAnimationFrame(syncScrub)
})

mechPlay()
requestAnimationFrame(syncScrub)
```

3. **Two parallel rAF loops** for one timeline: `mechCounter` (counter text) and
   `syncScrub` (thumb position) both run every frame and write the DOM separately:

```js
/* web/app.js:338 — current */
function mechCounter() {
  const master = MECH.anims[MECH.anims.length - 1]
  if (!master) return
  const t = Number(master.currentTime ?? 0)
  // The counter reads the WAVE segment only — it lands on the recorded total.
  $('mech-ms').textContent = `${Math.round(Math.min(Math.max(t - GUIDE.waveAt, 0), MECH.latency))} ms`
  if (master.playState === 'running') MECH.raf = requestAnimationFrame(mechCounter)
}
```

## Target

One guarded rAF loop owns both DOM writers; scrub input coalesces to at most one
seek per frame; Replay never spawns a second chain. Exact replacement code:

```js
/* replaces mechCounter/mechScrubTo/mechPlay (web/app.js:338–364) */
const MECH = { anims: [], total: 1, latency: 0, raf: 0, seekRaf: 0, seekTo: 0 }
// (extend the existing MECH literal with seekRaf/seekTo — do not redeclare it twice)

function mechMaster() {
  return MECH.anims[MECH.anims.length - 1]
}

function mechCounterSet(t) {
  // The counter reads the WAVE segment only — it lands on the recorded total.
  $('mech-ms').textContent = `${Math.round(Math.min(Math.max(t - GUIDE.waveAt, 0), MECH.latency))} ms`
}

/** The one ticker: counter text and thumb position, one write pass per frame. */
function mechTick() {
  const master = mechMaster()
  if (!master) return
  const t = Number(master.currentTime ?? 0)
  mechCounterSet(t)
  if (master.playState === 'running') {
    $('mech-scrub').value = String(Math.round(t))
    MECH.raf = requestAnimationFrame(mechTick)
  } else {
    $('mech-scrub').value = $('mech-scrub').max
  }
}

function mechScrubTo(ms) {
  cancelAnimationFrame(MECH.raf)
  for (const a of MECH.anims) {
    a.pause()
    a.currentTime = ms
  }
  mechCounterSet(ms) // never touch scrub.value here — the user owns the thumb mid-drag
}

function mechPlay() {
  for (const a of MECH.anims) {
    a.currentTime = 0
    a.play()
  }
  cancelAnimationFrame(MECH.raf)
  MECH.raf = requestAnimationFrame(mechTick)
}
```

```js
/* replaces the scrub + replay wiring inside renderMech (web/app.js:398–416) */
const scrub = $('mech-scrub')
scrub.max = String(MECH.total)
scrub.addEventListener('input', () => {
  MECH.seekTo = Number(scrub.value)
  if (MECH.seekRaf) return
  MECH.seekRaf = requestAnimationFrame(() => {
    MECH.seekRaf = 0
    mechScrubTo(MECH.seekTo)
  })
})
$('mech-replay').addEventListener('click', mechPlay)

mechPlay()
```

The `syncScrub` function is deleted entirely.

## Repo conventions to follow

- Vanilla JS, no framework; helpers are top-level `function` declarations in
  `web/app.js` under section comments (`/* ---- Fig. 0: the mechanism ---- */`).
- rAF handles are stored on the `MECH` state object and cancelled before reuse —
  imitate the existing `MECH.raf` pattern (`web/app.js:361–362`).
- Animations come from `playChart()`; do not touch it, and do not change how
  `MECH.anims`/`MECH.total` are assigned in `renderMech`.

## Steps

1. In `web/app.js`, extend the `MECH` literal with `seekRaf: 0, seekTo: 0`.
2. Replace `mechCounter`, `mechScrubTo`, and `mechPlay` with the target block above
   (adding `mechMaster` and `mechCounterSet`).
3. In `renderMech`, replace the scrub `input` listener, the `syncScrub` closure, the
   replay-click listener, and the trailing `mechPlay(); requestAnimationFrame(syncScrub)`
   with the target wiring block above.
4. Search the file for `syncScrub` and `mechCounter(` — zero remaining references.
5. Run `node --check web/app.js`.

## Boundaries

- Only `web/app.js` changes. No CSS, no HTML, no `playChart`, no other figures'
  replay buttons, no reduced-motion branch changes (`renderMech`'s `REDUCED` early
  return stays exactly as is).

## Verification

- `node --check web/app.js` passes.
- Load the page, let the autoplay run: counter lands on the recorded total (325 ms
  for `a11y-widget`) and the thumb parks at the right end.
- Drag the thumb rapidly end-to-end several times: rows/guides/labels track the
  thumb with no stutter; the counter follows; releasing mid-way leaves the timeline
  parked (no snap-back).
- Click Replay five times in fast succession: motion restarts cleanly each time and
  stays smooth on the fifth as on the first (the old code degrades here).
- Feel-check at 10% speed via DevTools > Animations while dragging: seeks should
  land once per frame, not burst.
- With `prefers-reduced-motion: reduce` emulated: controls hidden, no loops run.

## Addendum (user-directed, same execution pass)

4. **Counter clarity past the wave.** In `mechCounterSet(t)`: when
   `t >= GUIDE.waveAt + MECH.latency`, render `` `${MECH.latency} ms · judged` ``;
   otherwise the existing wave-relative count. The counter never counts past the
   recorded total — the suffix explains why it stopped while the thumb continues.

5. **"Judged" tick on the scrub track.** In `renderMech`, after `MECH.total` is set:
   `scrub.style.setProperty('--judged-at', String((GUIDE.waveAt + run.latencyMs) / MECH.total))`.
   In `web/styles.css`, layer a threshold-red tick onto the `.scrub` track:

```css
.scrub {
  /* replace the single background with layered track + judged tick */
  background:
    linear-gradient(var(--color-threshold), var(--color-threshold)) no-repeat
      calc(var(--judged-at, 1) * 100%) center / 2px 8px,
    linear-gradient(var(--color-rule-strong), var(--color-rule-strong)) no-repeat
      center / 100% 2px;
}
```

6. **No easing on the thumb itself.** A scrubber maps time linearly; smoothness must
   come from the perf fixes (steps 1–3), never from a CSS transition on the thumb,
   which would lag it behind the seek during drags. Do not add one.

Verification additions: the red tick sits at the point where the counter reads
325 ms and gains the `· judged` suffix; dragging across the tick toggles the suffix.
