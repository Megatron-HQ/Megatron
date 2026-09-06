// One-shot exploration harness for the Usage Analytics feature (docs/usage-analytics.md).
// Walks the real ~/.claude on this machine and dumps the open data-shape questions the design
// still needs answered, into scripts/explore-usage.report.md. Imports the production parser
// (src/main/ingest/cost-parser.ts — Node strips the types on load) so the tricky extraction
// logic isn't re-derived here. Committed with its output for provenance, like the cost
// investigation docs/usage-analytics.md already cites. Re-run: `npm run explore:usage`.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { extractCostState, extractTurnUsage } from '../src/main/ingest/cost-parser.ts'

const CLAUDE_DIR = join(homedir(), '.claude')
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects')
const HISTORY_FILE = join(CLAUDE_DIR, 'history.jsonl')
const REPORT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'explore-usage.report.md')
const COLD_START_CACHE_READ_MAX = 100 // turn-1 cache_read at/below this = "nothing preceded it"

function parseLines(filePath) {
  const records = []
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) records.push(parsed)
    } catch {
      /* skip malformed line, same as the production scanner */
    }
  }
  return records
}

// Main transcripts only — the top-level <sessionId>.jsonl files, never <sessionId>/subagents/*.
function mainTranscriptPaths() {
  const paths = []
  for (const projectName of readdirSync(PROJECTS_DIR)) {
    const projectPath = join(PROJECTS_DIR, projectName)
    let stat
    try {
      stat = statSync(projectPath)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    for (const fileName of readdirSync(projectPath)) {
      if (fileName.endsWith('.jsonl')) paths.push(join(projectPath, fileName))
    }
  }
  return paths
}

function firstTimestamp(records) {
  for (const r of records) if (typeof r.timestamp === 'string') return r.timestamp
  return null
}

function monthKey(iso) {
  return typeof iso === 'string' && iso.length >= 7 ? iso.slice(0, 7) : 'unknown'
}

function pct(n, total) {
  return total === 0 ? '0%' : `${((n / total) * 100).toFixed(1)}%`
}

function histogram(counts) {
  const max = Math.max(1, ...Object.values(counts))
  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `  ${k.padEnd(14)} ${'█'.repeat(Math.round((v / max) * 40)).padEnd(40)} ${v}`)
    .join('\n')
}

function quantiles(values) {
  if (values.length === 0) return { min: 0, p25: 0, median: 0, p75: 0, max: 0, n: 0 }
  const s = [...values].sort((a, b) => a - b)
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return {
    min: s[0],
    p25: at(0.25),
    median: at(0.5),
    p75: at(0.75),
    max: s[s.length - 1],
    n: s.length
  }
}

// ─── walk every main transcript ──────────────────────────────────────────────
const sessions = new Map() // sessionId -> collected facts
const rawModelKeys = new Set()
const rawTurnModels = new Set()
let totalTurns = 0
let syntheticTurns = 0
let turnsMissingApiBlockIndex = 0
let effortNull = 0
const modelEffortCrosstab = {} // `${model} / ${effort}` -> count
const transcriptPaths = mainTranscriptPaths()

for (const filePath of transcriptPaths) {
  const records = parseLines(filePath)
  const sessionId =
    records.find((r) => typeof r.sessionId === 'string')?.sessionId ??
    filePath.split('/').pop().replace('.jsonl', '')

  const cost = extractCostState(records)
  const turns = extractTurnUsage(records)
  const started = firstTimestamp(records)

  for (const r of records) {
    if (r.type === 'cost-state' && r.modelUsage && typeof r.modelUsage === 'object') {
      for (const k of Object.keys(r.modelUsage)) rawModelKeys.add(k)
    }
    if (r.type === 'assistant' && r.isSidechain === false) {
      totalTurns++
      const model = typeof r.message?.model === 'string' ? r.message.model : '(none)'
      rawTurnModels.add(model)
      if (model === '<synthetic>') syntheticTurns++
      if (typeof r.apiBlockIndex !== 'number') turnsMissingApiBlockIndex++
    }
  }

  for (const t of turns) {
    if (t.effort === null) effortNull++
    const key = `${t.model} / ${t.effort ?? '(null)'}`
    modelEffortCrosstab[key] = (modelEffortCrosstab[key] ?? 0) + 1
  }

  // apiBlockIndex monotonicity across the ordered assistant turns of this session
  const blockIdx = records
    .filter((r) => r.type === 'assistant' && r.isSidechain === false)
    .map((r) => r.apiBlockIndex)
  const numericIdx = blockIdx.filter((n) => typeof n === 'number')
  const monotonic = numericIdx.every((n, i) => i === 0 || n >= numericIdx[i - 1])

  const turn1 = turns.find((t) => t.turn_index === 0) ?? null

  sessions.set(sessionId, {
    id: sessionId,
    filePath,
    started,
    hasCostState: cost !== null,
    isZeroed: cost?.isZeroed ?? false,
    totalCostUsd: cost?.totalCostUsd ?? null,
    hasUnknownModelCost: cost?.hasUnknownModelCost ?? false,
    continuedInSessionId: cost?.continuedInSessionId ?? null,
    costStateStartTime: cost?.costStateStartTime ?? null,
    turnCount: turns.length,
    turn1CacheRead: turn1?.cache_read_tokens ?? null,
    turn1CacheCreation: turn1?.cache_creation_tokens ?? null,
    apiBlockIndexAllPresent: blockIdx.length > 0 && numericIdx.length === blockIdx.length,
    apiBlockIndexMonotonic: monotonic
  })
}

const all = [...sessions.values()]
const tracked = all.filter((s) => s.hasCostState && !s.isZeroed)
const zeroed = all.filter((s) => s.hasCostState && s.isZeroed)
const untracked = all.filter((s) => !s.hasCostState)

// ─── Q3: continued-in lineage graph ─────────────────────────────────────────
const continuedIntoTargets = new Set(
  all.map((s) => s.continuedInSessionId).filter((id) => id !== null)
)
const edges = all
  .filter((s) => s.continuedInSessionId !== null)
  .map((s) => [s.id, s.continuedInSessionId])

const forward = new Map(edges) // fromId -> toId
let maxDepth = 0
let cycleDetected = false
const terminalsMissingCost = []
for (const [fromId] of edges) {
  const visited = new Set()
  let cur = fromId
  let depth = 0
  while (forward.has(cur)) {
    if (visited.has(cur)) {
      cycleDetected = true
      break
    }
    visited.add(cur)
    cur = forward.get(cur)
    depth++
  }
  maxDepth = Math.max(maxDepth, depth)
  const terminal = sessions.get(cur)
  if (terminal && !terminal.hasCostState) terminalsMissingCost.push(cur)
}

// ─── Q1: cold-start detection agreement ─────────────────────────────────────
let bothAgreeCold = 0
let onlyNotTarget = 0
let onlyLowCacheRead = 0
let neither = 0
const turn1CacheReadValues = []
for (const [id, s] of sessions) {
  if (s.turn1CacheRead === null) continue
  turn1CacheReadValues.push(s.turn1CacheRead)
  const notTarget = !continuedIntoTargets.has(id)
  const lowRead = s.turn1CacheRead <= COLD_START_CACHE_READ_MAX
  if (notTarget && lowRead) bothAgreeCold++
  else if (notTarget) onlyNotTarget++
  else if (lowRead) onlyLowCacheRead++
  else neither++
}
const coldStartSessions = [...sessions.entries()].filter(
  ([id, s]) =>
    !continuedIntoTargets.has(id) &&
    s.turn1CacheRead !== null &&
    s.turn1CacheRead <= COLD_START_CACHE_READ_MAX
)

// ─── Q7: history.jsonl ──────────────────────────────────────────────────────
let historyReport = '_history.jsonl not found._'
if (existsSync(HISTORY_FILE)) {
  const lines = parseLines(HISTORY_FILE)
  const perDay = {}
  const perHour = {}
  const perWeekday = {}
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  let slashOnly = 0
  for (const entry of lines) {
    const display = typeof entry.display === 'string' ? entry.display.trim() : ''
    if (/^\/[a-z][\w-]*$/i.test(display)) slashOnly++
    if (typeof entry.timestamp === 'number') {
      const d = new Date(entry.timestamp)
      perDay[d.toISOString().slice(0, 10)] = (perDay[d.toISOString().slice(0, 10)] ?? 0) + 1
      const hour = String(d.getHours()).padStart(2, '0') // localtime
      perHour[hour] = (perHour[hour] ?? 0) + 1
      const wd = weekdays[d.getDay()]
      perWeekday[wd] = (perWeekday[wd] ?? 0) + 1
    }
  }
  const days = Object.keys(perDay).length
  historyReport = [
    `- Total lines: **${lines.length}**  ·  distinct days: **${days}**  ·  mean prompts/active day: **${(lines.length / Math.max(1, days)).toFixed(1)}**`,
    `- Slash-command-only lines (\`/clear\`, \`/quit\`, …): **${slashOnly}** (${pct(slashOnly, lines.length)}) — decides whether "prompts" filters these`,
    '',
    '**By hour of day (localtime):**',
    '```',
    histogram(perHour),
    '```',
    '**By weekday:**',
    '```',
    histogram(
      Object.fromEntries(weekdays.filter((w) => perWeekday[w]).map((w) => [w, perWeekday[w]]))
    ),
    '```'
  ].join('\n')
}

// ─── Q7: Tier-3 association (needs the existing megatron.db) ─────────────────
let tier3Report = '_megatron.db not found — launch the app once, then re-run._'
const dbPath = join(homedir(), 'Library', 'Application Support', 'megatron', 'megatron.db')
if (existsSync(dbPath)) {
  const db = new Database(dbPath, { readonly: true })
  const invRows = db.prepare('SELECT DISTINCT skill_name, session_id FROM skill_invocations').all()
  const bySkill = {}
  for (const { skill_name, session_id } of invRows) {
    ;(bySkill[skill_name] ??= new Set()).add(session_id)
  }
  const top = Object.entries(bySkill)
    .map(([skill, sessionSet]) => {
      let costTracked = 0
      let est = 0
      for (const sid of sessionSet) {
        const s = sessions.get(sid)
        if (s?.hasCostState && !s.isZeroed) {
          costTracked++
          est += s.totalCostUsd ?? 0
        }
      }
      return { skill, sessions: sessionSet.size, costTracked, est }
    })
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 8)
  tier3Report = [
    '| skill | sessions | cost-tracked | assoc. $ (est) |',
    '| --- | ---: | ---: | ---: |',
    ...top.map(
      (t) =>
        `| ${t.skill} | ${t.sessions} | ${t.costTracked} | ${t.costTracked ? '$' + t.est.toFixed(2) : '—'} |`
    )
  ].join('\n')
  db.close()
}

// ─── coverage by month ─────────────────────────────────────────────────────
const byMonth = {}
for (const s of all) {
  const m = monthKey(s.started)
  const b = (byMonth[m] ??= { total: 0, tracked: 0, zeroed: 0, untracked: 0 })
  b.total++
  if (s.hasCostState && !s.isZeroed) b.tracked++
  else if (s.isZeroed) b.zeroed++
  else b.untracked++
}
const earliestTracked = tracked
  .map((s) => s.started)
  .filter(Boolean)
  .sort()[0]

const t1r = quantiles(turn1CacheReadValues)
const coldCreation = quantiles(coldStartSessions.map(([, s]) => s.turn1CacheCreation ?? 0))

// ─── render ────────────────────────────────────────────────────────────────
const report = `# Usage Analytics — exploration report

_Generated by \`npm run explore:usage\` from the real \`~/.claude\` on this machine._
_Generated: ${new Date().toISOString()}_

Main transcripts scanned: **${transcriptPaths.length}**  ·  distinct sessions: **${sessions.size}**

---

## Q2 — cost-state coverage

| bucket | sessions | share |
| --- | ---: | ---: |
| priced cost-state | ${tracked.length} | ${pct(tracked.length, all.length)} |
| all-zeroed cost-state (immature-feature artifact) | ${zeroed.length} | ${pct(zeroed.length, all.length)} |
| no cost-state (pre-feature) | ${untracked.length} | ${pct(untracked.length, all.length)} |

- **Earliest priced session (\`started_at\`): ${earliestTracked ?? 'n/a'}** — use this, not a hardcoded date, for the "cost tracking started" copy.
- \`hasUnknownModelCost: true\`: **${all.filter((s) => s.hasUnknownModelCost).length}** sessions.
- Zeroed session ids: ${zeroed.map((s) => s.id.slice(0, 8)).join(', ') || '(none)'}

**By month (session \`started_at\`):**

| month | total | priced | zeroed | untracked |
| --- | ---: | ---: | ---: | ---: |
${Object.entries(byMonth)
  .sort()
  .map(([m, b]) => `| ${m} | ${b.total} | ${b.tracked} | ${b.zeroed} | ${b.untracked} |`)
  .join('\n')}

---

## Q3 — continued-in lineage chains

- Edges (\`session → continuedInSessionId\`): **${edges.length}**
- Max chain depth: **${maxDepth}**
- Cycle / self-pointer in real data: **${cycleDetected ? 'YES — the recursive CTE cycle guard is load-bearing' : 'none'}**
- Chain terminals lacking a cost-state row: **${terminalsMissingCost.length}** ${terminalsMissingCost.length ? '→ fall back to last-in-chain-with-cost-state' : ''}
- Edge list: ${edges.map(([a, b]) => `${a.slice(0, 8)}→${b.slice(0, 8)}`).join(', ') || '(none)'}

---

## Q1 — cold-start detection (\`not continued-into\` ∧ turn-1 \`cache_read ≤ ${COLD_START_CACHE_READ_MAX}\`)

| outcome | sessions |
| --- | ---: |
| both signals agree → cold start | ${bothAgreeCold} |
| only "not a continued-in target" | ${onlyNotTarget} |
| only "turn-1 cache_read low" | ${onlyLowCacheRead} |
| neither | ${neither} |

**turn-1 \`cache_read_input_tokens\` distribution (all sessions with a turn 0):**
min ${t1r.min} · p25 ${t1r.p25} · median ${t1r.median} · p75 ${t1r.p75} · max ${t1r.max} · n=${t1r.n}

→ The two signals are NOT redundant. "Not a continued-in target" is loose (nearly every session). "turn-1 cache_read low" is the strict one — it selects sessions that ran cache-*cold*, where turn-1 \`cache_creation\` is the whole resident-context prefix rather than a warm-cache delta. §4 wants exactly that intersection: a fresh session measured cold.

---

## Q4 — model keys & synthetic turns

- Raw \`cost-state.modelUsage\` keys seen: ${[...rawModelKeys].map((k) => `\`${k}\``).join(', ') || '(none)'}
- Raw \`message.model\` values on assistant turns: ${[...rawTurnModels].map((k) => `\`${k}\``).join(', ')}
- \`<synthetic>\` assistant turns: **${syntheticTurns}** / ${totalTurns} (${pct(syntheticTurns, totalTurns)})

---

## Q5 — apiBlockIndex is unusable as turn_index

- Assistant turns missing a numeric \`apiBlockIndex\`: **${turnsMissingApiBlockIndex}** / ${totalTurns} (${pct(turnsMissingApiBlockIndex, totalTurns)})
- Sessions where every assistant turn has \`apiBlockIndex\`: **${all.filter((s) => s.apiBlockIndexAllPresent).length}** / ${all.length}
- Sessions where \`apiBlockIndex\` is non-decreasing: **${all.filter((s) => s.apiBlockIndexMonotonic).length}** / ${all.length}

→ \`apiBlockIndex\` can't anchor "the first turn" — \`extractTurnUsage\` assigns \`turn_index\` as a 0-based ordinal by scan position instead (transcript is chronological, so ordinal 0 = the session's first real assistant turn). \`turn1CacheRead\`/\`turn1CacheCreation\` below are read from that ordinal-0 row.

---

## Q6 — effort field

- Turns with \`effort = null\`: **${effortNull}** / ${totalTurns} (${pct(effortNull, totalTurns)})

---

## Q7 — panel distributions

### model × effort crosstab (all turns)

\`\`\`
${Object.entries(modelEffortCrosstab)
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `  ${k.padEnd(32)} ${v}`)
  .join('\n')}
\`\`\`

### turn-1 cache_creation on cold-start sessions (§4 "measured resident context" headline)

cold-start sessions: **${coldStartSessions.length}**
min ${coldCreation.min} · p25 ${coldCreation.p25} · median ${coldCreation.median} · p75 ${coldCreation.p75} · max ${coldCreation.max}

→ Tight spread ⇒ "most recent cold start" is an honest single sample. Wide spread ⇒ revisit showing a distribution.

### history.jsonl

${historyReport}

### Tier-3 association (top skills by session count)

${tier3Report}
`

writeFileSync(REPORT_PATH, report)
console.log(`Wrote ${REPORT_PATH}`)
console.log(
  `${transcriptPaths.length} transcripts · ${tracked.length} priced · ${untracked.length} untracked · ${edges.length} lineage edges · ${coldStartSessions.length} cold starts`
)
