// Recorded demo — renders web/data/replays.json + web/data/doctor.json.
// Two clocks, never mixed (DESIGN.md §4): data events replay on the RECORDED clock
// (row delays come from the capture's latencyMs/judgedCount, never taste); chrome
// moves on the interface clock (≤250ms). Numbers stamp, never tick.

const $ = (id) => document.getElementById(id)
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches

let DATA = null
let DOCTOR = null
const state = { fixture: null, scaleFixture: null, catalogAll: false }

// Catalog opens on the featured worked example, not the Mechanism's run again.
const DEFAULT_CATALOG = 'build-animation'
// Catalog shows at least this many rows, and always every banded (invoke/suggest) row.
const CATALOG_TOP = 12

/** The selected tabs live in the query string, so a reload or shared link lands on the same runs. */
function syncUrl() {
  const url = new URL(location.href)
  url.searchParams.set('catalog', state.fixture)
  url.searchParams.set('scale', state.scaleFixture)
  history.replaceState(null, '', url)
}

function fmt(p) {
  return p.toFixed(2)
}

function label(id) {
  return DATA.skills[id]?.name ?? id
}

/** The head stamp: the recorded date on the title block's right edge. */
function stampDate(el, date) {
  el.textContent = date
  el.dateTime = date
}

/**
 * Conclusion = the blue annotation closing a section. Scope and recorded cost in
 * plain sentences, and each number appears on the page exactly once (DESIGN.md
 * rules). The date lives in the head stamp, not here.
 */
function setConclusion(el, text) {
  const p = document.createElement('p')
  p.textContent = text
  el.replaceChildren(p)
}

function factsSentence(f) {
  const r = f.run
  const catalogWord = f.catalog === 'real' ? 'installed' : 'synthetic'
  const requests = r.shards > 1 ? `${r.shards} parallel requests` : 'one request'
  return `${r.judgedCount.toLocaleString('en-US')} ${catalogWord} skills judged in ${r.latencyMs}\u00a0ms, ${requests}`
}

/**
 * The signature line exactly as Claude Code prints it for this hook, built from a
 * fixture's recorded verdict (see hooks/user-prompt-submit.ts systemMessage).
 */
function signatureLine(run) {
  const suggestPart = run.suggested.length > 0 ? ` · suggest [${run.suggested.join(', ')}]` : ''
  return (
    `jev-skill-router · invoke [${run.selected.join(', ')}]` +
    `${suggestPart} · ${run.judgedCount} judged in ${run.latencyMs}ms (jev)`
  )
}

/** Terminal transcript into a <pre>: ⎿ elbow lines render in the muted register. */
function fillTranscript(pre, text) {
  pre.replaceChildren(
    ...text.split('\n').map((l) => {
      const s = document.createElement('span')
      s.textContent = `${l}\n`
      if (l.trimStart().startsWith('⎿')) s.className = 'term-dim'
      return s
    })
  )
}

/* The stock rotor: same prompt, four models, recorded stock outcomes. fable's hit
   is the manual arm A session; sonnet's silent no-load is the bench's 0-of-3;
   haiku's and opus's no-loads are the 2026-09-25 probes (bench/results/README.md).
   Only the strongest model reached for a skill at all. */
const STOCK_SCENARIOS = [
  {
    model: 'fable',
    out:
      '● Skill(better-accessibility)\n  ⎿  Launching skill: better-accessibility\n\n' +
      "● I'll rebuild the focus order and ARIA wiring per the accessibility skill."
  },
  {
    model: 'sonnet',
    out: "● I'll fix the focus management and ARIA wiring. Let me look at the component.\n\n● Read(components/ui/combobox.tsx)"
  },
  {
    model: 'haiku',
    out:
      "● I'll help you fix the combobox's keyboard navigation and accessibility. Let me first explore the project structure.\n\n" +
      '● Bash(find . -name "*.tsx" | grep -i combobox)'
  },
  {
    model: 'opus',
    out: "● Bash(find . -type f -not -path '*/node_modules/*' | head -50)\n\n● Bash(ls -la)\n\n● Read(components/ui/combobox.tsx)"
  }
]
const ROTOR_DWELL_MS = 6000

function renderStockRotor() {
  const pre = $('stock-out')
  const labelEl = $('stock-model')
  const dotsEl = $('stock-dots')
  if (!pre || !labelEl || !dotsEl) return
  // The dots are the rotor's control: choosing a run shows it and stops the rotation
  // for good, so keyboard and touch readers can hold any scenario still.
  let current = 0
  let stopped = false
  dotsEl.replaceChildren(
    ...STOCK_SCENARIOS.map((s, i) => {
      const d = document.createElement('button')
      d.type = 'button'
      d.className = 'rotor-dot'
      d.setAttribute('aria-label', `Show the ${s.model} run`)
      d.addEventListener('click', () => {
        stopped = true
        show(i)
      })
      return d
    })
  )
  const show = (i) => {
    current = i
    labelEl.textContent = `Just a coding agent · ${STOCK_SCENARIOS[i].model}`
    fillTranscript(pre, STOCK_SCENARIOS[i].out)
    ;[...dotsEl.children].forEach((d, j) => {
      d.classList.toggle('rotor-dot-current', j === i)
      d.setAttribute('aria-pressed', String(j === i))
    })
  }
  show(0)
  if (REDUCED) return // no auto-rotation under reduced motion; the first scenario stands

  // Hover or keyboard focus pauses the rotor (auto-updating content needs an out).
  let paused = false
  const panel = pre.closest('.terminal')
  for (const [ev, val] of [['mouseenter', true], ['mouseleave', false], ['focusin', true], ['focusout', false]]) {
    panel.addEventListener(ev, () => {
      paused = val
    })
  }
  setInterval(() => {
    if (stopped || paused || document.hidden) return
    const next = (current + 1) % STOCK_SCENARIOS.length
    const out = pre.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out', fill: 'forwards' })
    out.onfinish = () => {
      show(next)
      const back = pre.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: EASE_OUT, fill: 'forwards' })
      back.onfinish = () => {
        out.cancel()
        back.cancel()
      }
    }
  }, ROTOR_DWELL_MS)
}

function bandOf(id, run) {
  if (run.selected.includes(id)) return 'invoke'
  if (run.suggested.includes(id)) return 'suggest'
  return 'dominated'
}

/** Ground-truth ids that were actually judged in this run (negative controls: none). */
function truthInCatalog(f, run) {
  const judged = new Set(run.rows.map(([id]) => id))
  return f.groundTruth.filter((id) => judged.has(id))
}

/**
 * A full tab pattern: one tab stop (roving tabindex), arrow keys / Home / End move the
 * selection, and each tab controls the chart panel below it. Re-rendering replaces
 * the buttons, so focus follows the newly selected tab when it was inside the row.
 */
function renderTabs(el, fixtures, activeId, onPick, panelId) {
  const hadFocus = el.contains(document.activeElement)
  const tabs = fixtures.map((f) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'tab'
    b.role = 'tab'
    b.id = `${el.id}-${f.id}`
    b.textContent = f.id
    b.tabIndex = f.id === activeId ? 0 : -1
    b.setAttribute('aria-selected', String(f.id === activeId))
    b.setAttribute('aria-controls', panelId)
    // Keyboard-driven switching stamps in with no transition (ev.detail === 0).
    b.addEventListener('click', (ev) => onPick(f.id, ev.detail > 0))
    return b
  })
  el.replaceChildren(...tabs)
  el.onkeydown = (ev) => {
    const i = fixtures.findIndex((f) => f.id === activeId)
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: fixtures.length - 1 }[ev.key]
    if (to === undefined) return
    ev.preventDefault()
    onPick(fixtures[(to + fixtures.length) % fixtures.length].id, false)
  }
  $(panelId)?.setAttribute('aria-labelledby', `${el.id}-${activeId}`)
  if (hadFocus) tabs[fixtures.findIndex((f) => f.id === activeId)]?.focus()
}

function makeRow(f, run, id, p, rank) {
  const truth = new Set(f.groundTruth)
  const decoys = new Set(f.decoys ?? [])
  const band = bandOf(id, run)
  const isTruth = truth.has(id)
  const missed = isTruth && band !== 'invoke'
  const decoy = decoys.has(id)

  const row = document.createElement('div')
  row.className = `run-row is-${band}${missed ? ' is-missed' : ''}${decoy ? ' is-decoy' : ''}`
  row.dataset.rank = String(rank)

  const name = document.createElement('button')
  name.type = 'button'
  name.className = 'run-name'
  name.setAttribute('aria-expanded', 'false')
  // The name truncates inside its own span; footnote marks live outside it so the
  // ellipsis can never eat a † or ‡.
  const nameText = document.createElement('span')
  nameText.className = 'run-name-text'
  nameText.textContent = label(id)
  name.append(nameText)
  if (isTruth) {
    const dag = document.createElement('span')
    dag.className = 'run-truth'
    dag.textContent = '†'
    name.append(dag)
  }
  if (decoy) {
    const mark = document.createElement('span')
    mark.className = 'run-verify'
    mark.textContent = '‡'
    name.append(mark)
  }

  const bar = document.createElement('span')
  bar.className = 'run-bar'
  const ink = document.createElement('span')
  ink.className = 'run-bar-ink'
  ink.style.width = `${p * 100}%`
  bar.append(ink)

  const prob = document.createElement('span')
  prob.className = 'run-p'
  prob.textContent = fmt(p)

  const bandEl = document.createElement('span')
  bandEl.className = 'run-band'
  bandEl.textContent = missed
    ? 'missed'
    : decoy
      ? 'rejected'
      : band === 'invoke'
        ? 'invoke'
        : band === 'suggest'
          ? 'suggest'
          : '—'

  row.append(name, bar, prob, bandEl)

  // Progressive disclosure: the description is the only context routing ever saw.
  const desc = document.createElement('p')
  desc.className = 'run-desc'
  desc.textContent = DATA.skills[id]?.description || '(no description on record)'
  desc.hidden = true
  name.addEventListener('click', () => {
    desc.hidden = !desc.hidden
    name.setAttribute('aria-expanded', String(!desc.hidden))
  })

  return [row, desc]
}

function markPulled(row, rank) {
  const name = row.querySelector('.run-name')
  const r = document.createElement('span')
  r.className = 'run-rank'
  r.textContent = `#${rank}`
  name.prepend(r)
}

/**
 * `expand` (Catalog only) adds the show-all / show-top control: `{ all, total, top, onToggle }`,
 * plus `pull`: rows a worked-example note cites, pulled up like marked rows.
 */
function renderRun(el, f, { limit, expand } = {}) {
  // The table is about to be replaced: cancel any live animations first so
  // detached rows don't keep zombie animations alive.
  for (const a of el.closest('.tablewrap')?._chartAnims ?? []) a.cancel()
  const run = f.run
  const rows = limit ? run.rows.slice(0, limit) : run.rows

  const frag = document.createDocumentFragment()
  rows.forEach(([id, p], i) => frag.append(...makeRow(f, run, id, p, i + 1)))

  // Marked rows (truth, decoys) hidden below the display cut get pulled up with
  // their true rank, so the cut never hides the graded evidence.
  const shown = new Set(rows.map(([id]) => id))
  const marked = new Set([...(f.decoys ?? []), ...truthInCatalog(f, run), ...(expand?.pull ?? [])])
  const extras = limit
    ? run.rows.map(([id, p], i) => [id, p, i + 1]).filter(([id]) => marked.has(id) && !shown.has(id))
    : []

  const toggle = (text) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'link-flip run-toggle'
    b.textContent = text
    b.addEventListener('click', expand.onToggle)
    return b
  }
  if (limit && run.rows.length > limit) {
    const more = document.createElement('p')
    more.className = 'run-more'
    more.textContent =
      `… ${run.rows.length - limit} more skills judged below ${fmt(rows[rows.length - 1][1])}` +
      (extras.length > 0
        ? `, with ${extras.every(([id]) => expand?.pull?.includes(id)) ? 'cited' : 'marked'} rows pulled up from further down`
        : '')
    if (expand) more.append(' · ', toggle(`show all ${expand.total}`))
    frag.append(more)
  }
  for (const [id, p, rank] of extras) {
    const [row, desc] = makeRow(f, run, id, p, rank)
    markPulled(row, rank)
    frag.append(row, desc)
  }
  if (expand?.all) {
    const all = document.createElement('p')
    all.className = 'run-more'
    all.append(`all ${expand.total} judged skills shown · `, toggle(`show the top ${expand.top}`))
    frag.append(all)
  }

  el.replaceChildren(frag)

  if (run.selected.length === 0) {
    const note = document.createElement('p')
    note.className = 'abstained'
    if (run.suggested.length > 0) {
      note.dataset.tag = 'healthy shape'
      note.textContent =
        `0 invoked, ${run.suggested.length} suggested at t=${fmt(DATA.policy.threshold)}. ` +
        `The agent works normally and pulls from the menu only if needed`
    } else {
      note.dataset.tag = 'abstention'
      note.textContent = `0 selected at t=${fmt(DATA.policy.threshold)}, the correct outcome here`
    }
    el.append(note)
  }
}

/* ---- chart guides + the recorded clock ---------------------------------------- */

// The recorded latency IS the timeline: the wave's row delays are exact truth, and
// every presentation event — guide strokes, band labels, print tails — lands inside
// the recorded window at proportional times. Nothing animates past the measurement,
// so a scrubber over the timeline reads 0 → recorded total, edge to edge.
function chartTimes(run, rowCount) {
  const T = run.latencyMs
  return {
    suggestAt: Math.round(T * 0.45),
    invokeAt: Math.round(T * 0.6),
    guideDur: Math.max(1, Math.round(T * 0.3)),
    labelsAt: Math.round(T * 0.8),
    labelStep: rowCount > 0 ? Math.max(1, Math.floor((T * 0.19) / rowCount)) : 0
  }
}

/**
 * The two guides plus their value tags. Tags are sibling spans, not pseudo-elements,
 * because the pen reveal clips each guide and would clip a ::before with it.
 */
function ensureGuides(wrap) {
  let suggest = wrap.querySelector('.guide-suggest')
  let invoke = wrap.querySelector('.guide-invoke')
  let suggestTag = wrap.querySelector('.guide-tag-suggest')
  let invokeTag = wrap.querySelector('.guide-tag-invoke')
  if (!suggest) {
    const mk = (className, text) => {
      const el = document.createElement('span')
      el.className = className
      el.setAttribute('aria-hidden', 'true')
      if (text) el.textContent = text
      return el
    }
    suggest = mk('guide guide-suggest')
    invoke = mk('guide guide-invoke')
    suggestTag = mk('guide-tag guide-tag-suggest', fmt(DATA.policy.suggestFloor))
    invokeTag = mk('guide-tag guide-tag-invoke', fmt(DATA.policy.threshold))
    wrap.append(suggest, invoke, suggestTag, invokeTag)
  }
  return { suggest, invoke, suggestTag, invokeTag }
}

/**
 * Both guidelines are continuous rules spanning the ranked column — never per-row
 * segments, and never through prose: they stop above the "… N more" line and the
 * abstention note rather than striking through text.
 */
function placeGuides(wrap) {
  const table = wrap.querySelector('.run-table')
  const bar = table?.querySelector('.run-bar')
  const firstRow = table?.querySelector('.run-row')
  if (!bar || !firstRow) return
  const { suggest, invoke, suggestTag, invokeTag } = ensureGuides(wrap)
  const wr = wrap.getBoundingClientRect()
  const br = bar.getBoundingClientRect()
  // A plot guideline, not a container edge: the rules peek a few px past the
  // ranked column's top and bottom, while staying clear of any prose below.
  const PEEK = 6
  const top = firstRow.getBoundingClientRect().top - wr.top - PEEK
  const stop = table.querySelector('.run-more, .abstained')
  const rows = table.querySelectorAll('.run-row')
  const lastRow = rows[rows.length - 1]
  const bottom = stop
    ? stop.getBoundingClientRect().top - wr.top - 2
    : Math.min(
        lastRow.getBoundingClientRect().bottom + PEEK,
        table.getBoundingClientRect().bottom + 2
      ) - wr.top
  for (const [el, tag, frac] of [
    [suggest, suggestTag, DATA.policy.suggestFloor],
    [invoke, invokeTag, DATA.policy.threshold]
  ]) {
    const x = br.left - wr.left + frac * br.width
    el.style.left = `${x}px`
    el.style.top = `${top}px`
    el.style.height = `${Math.max(bottom - top, 0)}px`
    // Tagged at the guide's head: suggest reads leftward, invoke rightward, so the
    // two values never collide however close the cuts sit.
    tag.style.left = `${x}px`
    tag.style.top = `${top - 15}px`
  }
}

const CHART_WRAPS = []
function registerWrap(wrap) {
  if (!CHART_WRAPS.includes(wrap)) CHART_WRAPS.push(wrap)
  placeGuides(wrap)
}
// Guides re-measure once per frame at most, however fast resize events arrive.
let resizeFrame = 0
addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => CHART_WRAPS.forEach(placeGuides))
})
document.fonts?.ready.then(() => CHART_WRAPS.forEach(placeGuides))

/**
 * The full chart replay: suggest guide → invoke guide (fixed stagger, linear —
 * pen speed is constant) → the judge wave, truth-timed from the CAPTURE
 * (delay = latencyMs × (trueRank − 1) / judgedCount, each row 140ms ease-out) →
 * band labels stamping per row. Returns the animations (empty under reduced motion).
 */
function playChart(wrap, run, { paused = false, keep = false } = {}) {
  if (REDUCED) return []
  // fill:'both' animations never expire on their own: cancel the previous replay's
  // set or every Replay press and tab switch accumulates live animations forever.
  for (const a of wrap._chartAnims ?? []) a.cancel()
  placeGuides(wrap)
  const table = wrap.querySelector('.run-table')
  const { suggest, invoke, suggestTag, invokeTag } = ensureGuides(wrap)
  const rows = [...table.querySelectorAll('.run-row')]
  const tm = chartTimes(run, rows.length)
  const pen = [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }]
  // Each tag stamps in as its guide's pen touches down.
  const stamp = (at) => ({ duration: 1, delay: at, easing: 'steps(1, end)', fill: 'both' })
  const anims = [
    suggest.animate(pen, { duration: tm.guideDur, delay: tm.suggestAt, easing: 'linear', fill: 'both' }),
    invoke.animate(pen, { duration: tm.guideDur, delay: tm.invokeAt, easing: 'linear', fill: 'both' }),
    suggestTag.animate([{ opacity: 0 }, { opacity: 1 }], stamp(tm.suggestAt)),
    invokeTag.animate([{ opacity: 0 }, { opacity: 1 }], stamp(tm.invokeAt))
  ]

  rows.forEach((row, i) => {
    const rank = Number(row.dataset.rank || 1)
    const delay = ((rank - 1) / run.judgedCount) * run.latencyMs
    anims.push(
      row.animate(
        [
          { opacity: 0, transform: 'translateY(4px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ],
        {
          // print tails clip at the timeline's edge — nothing outlives the measurement
          duration: Math.max(1, Math.min(140, run.latencyMs - delay)),
          delay,
          easing: EASE_OUT,
          fill: 'both'
        }
      )
    )
    const band = row.querySelector('.run-band')
    if (band) {
      anims.push(
        band.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 1,
          delay: tm.labelsAt + i * tm.labelStep,
          easing: 'steps(1, end)',
          fill: 'both'
        })
      )
    }
  })

  // Pad the master so the timeline ends at exactly the recorded total.
  const master = anims[anims.length - 1]
  if (master) {
    const timing = master.effect.getTiming()
    const end = Number(timing.delay) + Number(timing.duration)
    if (end < run.latencyMs) master.effect.updateTiming({ endDelay: run.latencyMs - end })
  }
  wrap._chartAnims = anims
  if (!keep) {
    // Once the timeline ends, the filled state equals the natural CSS state —
    // cancel everything so nothing lingers on the compositor. The Mechanism's
    // set is kept (keep: true) because the scrubber seeks it.
    const last = anims[anims.length - 1]
    if (last) last.onfinish = () => anims.forEach((a) => a.cancel())
  }
  if (paused) anims.forEach((a) => a.pause())
  return anims
}


/* ---- Fig. 0: the mechanism ---------------------------------------------------- */

const MECH = { anims: [], total: 1, latency: 0, raf: 0, seekRaf: 0, seekTo: 0 }

function mechMaster() {
  return MECH.anims[MECH.anims.length - 1]
}

function mechCounterSet(t) {
  // Thumb and counter share one scale: the timeline IS the recorded latency.
  $('mech-ms').textContent = `${Math.round(Math.min(Math.max(t, 0), MECH.latency))}\u00a0ms`
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

function renderMech() {
  const f =
    DATA.fixtures.find((x) => x.id === 'a11y-widget' && x.catalog === 'real') ??
    DATA.fixtures.find((x) => x.catalog === 'real')
  const run = f.run

  $('mech-query').textContent = f.query
  $('mech-cat').textContent = String(f.catalogSize)
  stampDate($('mech-date'), f.capturedAt)
  renderRun($('mech-table'), f, { limit: 8 })

  // The verdict as the terminal prints it: elbow line, muted, matching the opener.
  const verdictLine = document.createElement('span')
  verdictLine.className = 'term-dim'
  verdictLine.textContent = `⎿  UserPromptSubmit says: ${signatureLine(run)}`
  $('mech-verdict').replaceChildren(verdictLine)


  const wrap = $('mech-tablewrap')
  registerWrap(wrap)

  if (REDUCED) {
    $('mech-ms').textContent = `${run.latencyMs}\u00a0ms`
    $('mech-controls').hidden = true
    return
  }

  // The replay covers only the tool in action (step 2): wave, guides, band labels.
  // Steps 3 and 4 are explanation, not execution — they stay static. The counter
  // lands on the recorded total and holds.
  MECH.latency = run.latencyMs
  MECH.total = run.latencyMs
  MECH.anims = playChart(wrap, run, { paused: true, keep: true })

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
}

/* ---- Fig. 1: real-catalog routing --------------------------------------------- */

// The featured worked example: direction discrimination beside same-territory
// co-invocation, with the control story. Annotations are blue; data stays mono.
const WORKED = {
  'build-animation': {
    text:
      'Worked example, 1 of 2. These skills invoke together because they really do overlap. ' +
      'better-ui and make-interfaces-feel-better are documented duplicates at 0.97 each, and ' +
      'impeccable is a broad umbrella over the same ground (see Doctor). The router shows the ' +
      'overlap rather than hiding it, since an extra skill costs tokens while a missed one ' +
      'costs the answer. The exclude list and the threshold are the dials. And better-interface, ' +
      'the skill that reviews a whole screen across every design domain at once, sits at 0.07. ' +
      'This ask is one build task, not a full review, so it stays out.',
    flip: 'holistic-review',
    // the note cites better-interface at 0.07, far below the cut: pull it up
    pull: ['better-interface'],
    flipLabel: 'compare the holistic ask →'
  },
  'holistic-review': {
    text:
      'Worked example, 2 of 2. better-interface, which sat at 0.07 on the build task, ' +
      'jumps to 0.96 here. Seven skills clear the bar here and the invoke ' +
      'cap of six drops the seventh, make-interfaces-feel-better at 0.87, into suggest ' +
      'with its score untouched. Co-invocation beats a missed skill, and Doctor and ' +
      'the thresholds keep it under control.',
    flip: 'build-animation',
    flipLabel: '← compare the single-domain build task'
  }
}

function renderAnnotation(f) {
  const el = $('fig1-annotation')
  const w = WORKED[f.id]
  if (!w) {
    el.hidden = true
    el.replaceChildren()
    return
  }
  el.hidden = false
  const p = document.createElement('p')
  p.textContent = w.text + ' '
  const flip = document.createElement('button')
  flip.type = 'button'
  flip.className = 'link-flip'
  flip.textContent = w.flipLabel
  flip.addEventListener('click', (ev) => pickFixture(w.flip, ev.detail > 0))
  p.append(flip)
  el.replaceChildren(p)
}

/** Legend lines, one concern each — symbols, controls, red marks, the disclosure cue. */
function renderLegend(el, f, run) {
  const lines = []
  const present = truthInCatalog(f, run)
  if ((f.decoys ?? []).length > 0) {
    lines.push(`‡ marks a curated decoy, a look-alike the judge correctly rejected`)
  }
  if (present.some((id) => bandOf(id, run) !== 'invoke')) {
    lines.push(`red marks where the eval bites`)
  }
  el.hidden = lines.length === 0
  el.replaceChildren(
    ...lines.map((text) => {
      const li = document.createElement('li')
      li.textContent = text
      return li
    })
  )
}

/**
 * The fixture-type label above the chart: a caps tag naming the eval case plus its
 * one defining sentence, so the context sits next to the rows it describes. The
 * label set is exactly two — expected invoke (ground truth present) and negative
 * control (truth lives in the other catalog, or is installed but outside the
 * routable catalog; correct outcome abstention either way).
 */
function renderFixtureType(el, f, run) {
  const tag = document.createElement('span')
  tag.className = 'type-tag'
  const def = document.createElement('span')
  if (truthInCatalog(f, run).length > 0) {
    tag.textContent = 'expected invoke'
    // Defined once, in Catalog. Scale points back rather than repeating it.
    def.textContent =
      f.catalog === 'synthetic'
        ? `† marks ground truth, as defined in Catalog above.`
        : `† marks ground truth, the skill each part of the ask can’t do without. ` +
          `The eval expects every † in the invoke band. Other skills that fit are ` +
          `welcome to co-invoke and aren’t graded.`
  } else {
    tag.textContent = 'negative control'
    if (f.negativeControl) {
      const one = f.groundTruth.length === 1
      def.textContent =
        `The true ${one ? 'skill' : 'skills'} (${f.groundTruth.join(', ')}) ` +
        `${one ? 'lives' : 'live'} only in the ` +
        `${f.catalog === 'real' ? 'synthetic org' : 'installed'} catalog, ` +
        `so the correct outcome is abstention.`
    } else {
      // The recorded case is user-only frontmatter (to-prd). A truth skill kept out
      // by the exclude list instead would need its own wording here.
      const one = f.groundTruth.length === 1
      const flag = document.createElement('span')
      flag.className = 'notation'
      flag.textContent = 'disable-model-invocation: true'
      def.append(
        `The true ${one ? 'skill' : 'skills'} (${f.groundTruth.join(', ')}) ` +
          `${one ? 'is' : 'are'} installed but ${one ? 'sets' : 'set'} `,
        flag,
        `, so only the user can invoke ${one ? 'it' : 'them'}. The router never judges ` +
          `${one ? 'it' : 'them'}, and the correct outcome is abstention.`
      )
    }
  }
  el.replaceChildren(tag, def)
}

function pickFixture(id, animate) {
  state.fixture = id
  state.catalogAll = false
  renderFig1(animate)
  syncUrl()
}

function renderFig1(animate = false) {
  const real = DATA.fixtures.filter((f) => f.catalog === 'real')
  const f =
    real.find((x) => x.id === state.fixture) ?? real.find((x) => x.id === DEFAULT_CATALOG) ?? real[0]
  state.fixture = f.id

  renderTabs($('fixture-tabs'), real, f.id, pickFixture, 'run-tablewrap')

  $('fig1-query').textContent = f.query
  renderFixtureType($('fig1-type'), f, f.run)

  // The Mechanism's pattern: the banded rows and the top of the tail, the rest one
  // click away, and marked rows below the cut pulled up so the cut hides no evidence.
  const top = Math.max(CATALOG_TOP, f.run.selected.length + f.run.suggested.length)
  const onToggle = () => {
    state.catalogAll = !state.catalogAll
    renderFig1(false)
    $('run-table').querySelector('.run-toggle')?.focus()
  }
  renderRun($('run-table'), f, {
    limit: state.catalogAll ? undefined : top,
    expand: { all: state.catalogAll, total: f.run.rows.length, top, onToggle, pull: WORKED[f.id]?.pull }
  })
  registerWrap($('run-tablewrap'))
  if (animate) playChart($('run-tablewrap'), f.run)
  renderLegend($('fig1-legend'), f, f.run)
  renderAnnotation(f)
  setConclusion(
    $('fig1-conclusion'),
    `${factsSentence(f)}. Only the ask changes between the tabs above, ` +
      `the catalog and both thresholds hold still.`
  )
  stampDate($('fig1-date'), f.capturedAt)
}

/* ---- the threshold key (inside Fig. 1, fixture-independent) --------------------- */

// The chart's two guides restated as values, in the guides' own colors: gray for the
// suggest cut, red for the invoke cut. Every recorded verdict on the page came from
// these two settings.
function renderThresholdKey() {
  const entry = (band, value) => {
    const item = document.createElement('span')
    item.className = `tkey tkey-${band}`
    const rule = document.createElement('span')
    rule.className = 'tkey-rule'
    const name = document.createElement('span')
    name.className = 'tkey-band'
    name.textContent = band
    const val = document.createElement('span')
    val.className = 'tkey-val'
    val.textContent = `≥ ${fmt(value)}`
    item.append(rule, name, val)
    return item
  }
  const note = document.createElement('p')
  note.className = 'tkey-note'
  note.textContent = 'Both cuts are tunable settings, and every verdict above came from them.'
  $('threshold-key').replaceChildren(
    entry('suggest', DATA.policy.suggestFloor),
    entry('invoke', DATA.policy.threshold),
    note
  )
}

/* ---- Fig. 2: synthetic scale --------------------------------------------------- */

function renderFig3(animate = false) {
  const synth = DATA.fixtures.filter((f) => f.catalog === 'synthetic')
  if (synth.length === 0) return
  const f = synth.find((x) => x.id === state.scaleFixture) ?? synth[0]
  state.scaleFixture = f.id

  renderTabs(
    $('scale-tabs'),
    synth,
    f.id,
    (id, anim) => {
      state.scaleFixture = id
      renderFig3(anim)
      syncUrl()
    },
    'scale-tablewrap'
  )
  $('fig3-query').textContent = f.query
  renderFixtureType($('fig3-type'), f, f.run)
  renderRun($('scale-table'), f, { limit: 12 })
  registerWrap($('scale-tablewrap'))
  if (animate) playChart($('scale-tablewrap'), f.run)
  renderLegend($('fig3-legend'), f, f.run)
  setConclusion(
    $('fig3-conclusion'),
    `${factsSentence(f)}. The same two cuts band an org-scale sweep, ` +
      `unchanged from the installed catalog.`
  )
  stampDate($('fig3-date'), f.capturedAt)
}

/* ---- Table 3: the catalog doctor ----------------------------------------------- */

const DOCTOR_TAG = {
  unroutable: 'unroutable',
  'stale-config': 'stale config',
  duplicate: 'duplicate',
  collision: 'collision',
  overlap: 'overlap',
  'self-miss': 'self-miss',
  'weak-description': 'weak'
}

function findingHead(f) {
  if (f.kind === 'collision') return f.skills.join(' ↔ ')
  if (f.kind === 'duplicate') return f.skills.join(' ≡ ')
  if (f.kind === 'overlap') return f.skills[0]
  return f.skills.join(', ')
}

function renderDoctor() {
  if (!DOCTOR) {
    $('table-doctor').hidden = true
    return
  }
  const comp = DOCTOR.composition

  const frag = document.createDocumentFragment()
  DOCTOR.findings.forEach((f, i) => {
    const row = document.createElement('div')
    row.className = 'doctor-row'
    const head = document.createElement('p')
    head.className = 'doctor-head'
    const no = document.createElement('span')
    no.className = 'doctor-no'
    no.textContent = String(i + 1).padStart(2, '0')
    const tag = document.createElement('span')
    tag.className = `doctor-tag doctor-tag-${f.kind}`
    tag.textContent = DOCTOR_TAG[f.kind] ?? f.kind
    const skills = document.createElement('span')
    skills.className = 'doctor-skills'
    skills.textContent = findingHead(f)
    head.append(no, tag, skills)

    const evidence = document.createElement('p')
    evidence.className = 'doctor-evidence'
    evidence.textContent = f.evidence

    const action = document.createElement('p')
    action.className = 'doctor-action'
    const lbl = document.createElement('span')
    lbl.className = 'doctor-action-label'
    lbl.textContent = 'action'
    action.append(lbl, document.createTextNode(f.action))

    row.append(head, evidence, action)
    frag.append(row)
  })
  $('doctor-table').replaceChildren(frag)

  setConclusion(
    $('t3-conclusion'),
    `${comp.catalogSize} probes × ${comp.catalogSize} skills at t=${fmt(DOCTOR.threshold)}, ` +
      `judged by ${DOCTOR.judge}. Every finding replays from the recorded sweep.`
  )
}

/* ---- the sliding spotlight (nav) ------------------------------------------------ */

const SECTIONS = [
  { id: 'fig-mechanism', label: 'Mechanism' },
  { id: 'fig-routing', label: 'Catalog' },
  { id: 'fig-scale', label: 'Scale' },
  { id: 'table-doctor', label: 'Doctor' }
]
let currentSection = 0
let turning = false

/** A page turn without unmounting: fade out, jump, fade in. Manual scroll untouched. */
function navTo(i) {
  const idx = Math.max(0, Math.min(SECTIONS.length - 1, i))
  const target = document.getElementById(SECTIONS[idx].id)
  if (!target || turning) return
  if (REDUCED) {
    target.scrollIntoView()
    return
  }
  turning = true
  const report = document.querySelector('.report')
  const out = report.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out', fill: 'forwards' })
  out.onfinish = () => {
    target.scrollIntoView({ behavior: 'instant', block: 'start' })
    const back = report.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: EASE_OUT, fill: 'forwards' })
    back.onfinish = () => {
      out.cancel()
      back.cancel()
      turning = false
    }
  }
}

function setCurrentSection(i) {
  currentSection = i
  document.querySelectorAll('.spot-chip').forEach((c, j) => c.setAttribute('aria-current', String(j === i)))
  const arrows = document.querySelectorAll('.spot-arrow')
  const [prev, next] = [arrows[0], arrows[1]]
  if (prev) {
    prev.disabled = i === 0
    prev.title = i > 0 ? `Previous: ${SECTIONS[i - 1].label}` : ''
  }
  if (next) {
    next.disabled = i === SECTIONS.length - 1
    next.title = i < SECTIONS.length - 1 ? `Next: ${SECTIONS[i + 1].label}` : ''
  }
}

function renderSpotlight() {
  const nav = $('spotlight')
  const mkArrow = (glyph, step) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'navbtn spot-arrow'
    b.setAttribute('aria-label', step < 0 ? 'Previous section' : 'Next section')
    b.textContent = glyph
    b.addEventListener('click', () => navTo(currentSection + step))
    return b
  }
  const chips = document.createElement('div')
  chips.className = 'spot-chips'
  SECTIONS.forEach((s, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'navbtn spot-chip'
    b.textContent = s.label
    b.addEventListener('click', () => navTo(i))
    chips.append(b)
  })
  nav.replaceChildren(mkArrow('‹', -1), chips, mkArrow('›', 1))
  setCurrentSection(0)

  // Scrollspy: the highlight follows reading position; nothing else moves.
  const spy = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const i = SECTIONS.findIndex((s) => s.id === e.target.id)
        if (i >= 0) setCurrentSection(i)
      }
    },
    { rootMargin: '-15% 0px -75% 0px' }
  )
  for (const s of SECTIONS) {
    const el = document.getElementById(s.id)
    if (el) spy.observe(el)
  }
}

/* ---- boot ---------------------------------------------------------------------- */

async function boot() {
  renderStockRotor()
  // A failed load says so plainly and hides the figures it would have left empty.
  let doctorRes = null
  try {
    const [replaysRes, dRes] = await Promise.all([
      fetch('data/replays.json'),
      fetch('data/doctor.json').catch(() => null)
    ])
    if (!replaysRes.ok) throw new Error(`HTTP ${replaysRes.status}`)
    DATA = await replaysRes.json()
    doctorRes = dRes
  } catch (err) {
    $('intro-verdict').textContent =
      `The recorded data didn’t load (${err.message}). Reload the page, or regenerate ` +
      `it locally with npm run demo:data.`
    document.querySelectorAll('.figure, .spotlight').forEach((el) => (el.hidden = true))
    return
  }
  DOCTOR = doctorRes && doctorRes.ok ? await doctorRes.json().catch(() => null) : null

  // The two-terminals opener replays the same recorded verdict FIG. 0 walks through.
  const introFixture = DATA.fixtures.find((f) => f.id === 'a11y-widget' && f.catalog === 'real')
  if (introFixture) {
    $('intro-query').textContent = introFixture.query
    // Line-by-line, with Claude Code's real styling: ⎿ hook/result lines muted,
    // ● action lines solid.
    const lines = [
      `⎿  UserPromptSubmit says: ${signatureLine(introFixture.run)}`,
      '',
      ...introFixture.run.selected.flatMap((id) => [`● Skill(${id})`, `  ⎿  Launching skill: ${id}`, ''])
    ]
    lines.pop()
    fillTranscript($('intro-verdict'), lines.join('\n'))
  }
  const params = new URLSearchParams(location.search)
  state.fixture = params.get('catalog')
  state.scaleFixture = params.get('scale')
  renderMech()
  renderFig1()
  renderThresholdKey()
  renderFig3()
  renderDoctor()
  renderSpotlight()
}

boot()
