import type Database from 'better-sqlite3'

const TOKEN_COLUMNS = [
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_creation_tokens'
] as const
type TokenColumn = (typeof TOKEN_COLUMNS)[number]
type RecordedTokens = Record<TokenColumn, number>
interface ArchivedSession {
  session_id: string
  project: string
  started_at: string
  continued_in_session_id: string | null
  has_totals: number
  is_zeroed: number
}
interface ArchivedTurn extends RecordedTokens {
  logical_turn_key: string
  source_uuid: string
  session_id: string
  model: string
  invoked_at: string
}

function archivePrompts(index: Database.Database, archive: Database.Database, now: Date): void {
  const insert = archive.prepare(`INSERT INTO history_prompts VALUES
    (@session_id, @project, @typed_at, @is_slash_command, @copies)
    ON CONFLICT DO UPDATE SET copies = MAX(copies, excluded.copies)`)
  let earliest = now.toISOString()
  for (const row of index
    .prepare(
      `SELECT session_id, project, typed_at, is_slash_command,
      COUNT(*) AS copies FROM prompt_history GROUP BY session_id, project, typed_at, is_slash_command`
    )
    .iterate() as Iterable<{
    session_id: string
    project: string
    typed_at: string
    is_slash_command: number
    copies: number
  }>) {
    if (!Number.isFinite(Date.parse(row.typed_at)) || row.typed_at > now.toISOString()) continue
    insert.run(row)
    if (row.typed_at < earliest) earliest = row.typed_at
  }
  let end = new Date(now.getTime() + 1).toISOString()
  const ranges = archive
    .prepare('SELECT start_at, end_at FROM history_coverage WHERE end_at >= ? AND start_at <= ?')
    .all(earliest, end) as Array<{ start_at: string; end_at: string }>
  for (const range of ranges) {
    if (range.start_at < earliest) earliest = range.start_at
    if (range.end_at > end) end = range.end_at
  }
  archive
    .prepare('DELETE FROM history_coverage WHERE end_at >= ? AND start_at <= ?')
    .run(earliest, end)
  archive.prepare('INSERT INTO history_coverage VALUES (?, ?)').run(earliest, end)
}

// Fork lineages (cost-lineage.ts) reach the archive as plain continued-in links: every member
// points at its head, and the head carries the lineage's tokens, so rebuildTokenShares needs no
// lineage logic of its own.
function copyTokenSources(index: Database.Database, archive: Database.Database): void {
  const insertSession = archive.prepare(`INSERT INTO history_sessions VALUES
    (@session_id, @project, @started_at, @continued_in_session_id, @has_totals, @is_zeroed)
    ON CONFLICT DO UPDATE SET project=excluded.project, started_at=excluded.started_at,
      continued_in_session_id=excluded.continued_in_session_id,
      has_totals=excluded.has_totals, is_zeroed=excluded.is_zeroed`)
  const deleteModels = archive.prepare('DELETE FROM history_models WHERE session_id = ?')
  const selectHeadModels = index.prepare(
    `SELECT head_session_id AS session_id,model,${TOKEN_COLUMNS.join(',')}
     FROM lineage_model_cost WHERE head_session_id = ?`
  )
  const selectModels = index.prepare(
    `SELECT session_id,model,${TOKEN_COLUMNS.join(',')} FROM session_model_cost WHERE session_id = ?`
  )
  const insertModel = archive.prepare(`INSERT INTO history_models VALUES
    (@session_id,@model,@input_tokens,@output_tokens,@cache_read_tokens,@cache_creation_tokens)`)
  const storedNext = archive
    .prepare('SELECT continued_in_session_id FROM history_sessions WHERE session_id = ?')
    .pluck()
  const indexed = new Set(index.prepare('SELECT session_id FROM sessions_meta').pluck().all())
  for (const row of index
    .prepare(
      `SELECT sm.session_id, sm.cwd AS project, sm.started_at,
      CASE WHEN cl.session_id IS NULL THEN sm.continued_in_session_id
           ELSE NULLIF(cl.head_session_id, sm.session_id) END AS continued_in_session_id,
      CASE WHEN sc.session_id IS NULL THEN 0 ELSE 1 END AS has_totals,
      COALESCE(sc.is_zeroed,0) AS is_zeroed, cl.head_session_id = sm.session_id AS is_head
      FROM sessions_meta sm LEFT JOIN session_cost sc ON sm.session_id=sc.session_id
      LEFT JOIN cost_lineage cl ON cl.session_id = sm.session_id`
    )
    .iterate() as Iterable<ArchivedSession & { is_head: number | null }>) {
    const { is_head: isHead, ...session } = row
    // A head pruned from the index left its lineage's tokens in the archive. Its surviving
    // members now resolve to a new head in the index, so they keep pointing at the archived one
    // rather than being counted a second time. A link to a session still indexed is never kept:
    // the index's own resolution of it is current.
    const previous = storedNext.get(session.session_id) as string | null | undefined
    if (session.continued_in_session_id === null && previous && !indexed.has(previous)) {
      session.continued_in_session_id = previous
    }
    insertSession.run(session)
    deleteModels.run(session.session_id)
    const models = isHead === 1 ? selectHeadModels : selectModels
    for (const model of models.iterate(session.session_id)) insertModel.run(model)
  }
  const insertTurn = archive.prepare(`INSERT INTO history_turns VALUES
    (@logical_turn_key,@source_uuid,@session_id,@model,@invoked_at,
     @input_tokens,@output_tokens,@cache_read_tokens,@cache_creation_tokens)
    ON CONFLICT DO UPDATE SET ${TOKEN_COLUMNS.map((column) => `${column}=MAX(${column},excluded.${column})`).join(',')}`)
  for (const row of index
    .prepare(
      `SELECT logical_turn_key, source_uuid, session_id, model, invoked_at,
      ${TOKEN_COLUMNS.join(',')} FROM turn_usage`
    )
    .iterate() as Iterable<ArchivedTurn>) {
    if (Number.isFinite(Date.parse(row.invoked_at))) insertTurn.run(row)
  }
}

function terminalFor(id: string, sessions: Map<string, ArchivedSession>): ArchivedSession | null {
  const visited = new Set<string>()
  let session = sessions.get(id)
  while (session?.continued_in_session_id) {
    if (visited.has(session.session_id)) return null
    visited.add(session.session_id)
    session = sessions.get(session.continued_in_session_id)
  }
  return session && session.has_totals === 1 && session.is_zeroed === 0 ? session : null
}

function splitTokens(total: number, turns: ArchivedTurn[], column: TokenColumn): number[] {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid recorded token count')
  let weights = turns.map((turn) => turn[column])
  if (!weights.some((weight) => weight > 0)) weights = turns.map((turn) => turn.output_tokens)
  if (!weights.some((weight) => weight > 0)) weights = turns.map(() => 1)
  if (weights.some((weight) => !Number.isSafeInteger(weight) || weight < 0))
    throw new Error('Invalid token allocation weight')
  const sum = weights.reduce((result, weight) => result + weight, 0)
  let cumulative = 0
  let allocated = 0
  return weights.map((weight, index) => {
    cumulative += weight
    // Cumulative integer boundaries preserve each recorded category exactly, including tiny totals.
    const boundary = index === weights.length - 1 ? total : Math.floor(total * (cumulative / sum))
    const share = boundary - allocated
    allocated = boundary
    return share
  })
}

function rebuildTokenShares(archive: Database.Database): void {
  const sessions = new Map(
    (archive.prepare('SELECT * FROM history_sessions').all() as ArchivedSession[]).map(
      (session) => [session.session_id, session]
    )
  )
  const turnsByTerminal = new Map<string, Map<string, ArchivedTurn[]>>()
  const terminals = new Map<string, ArchivedSession | null>()
  for (const session of sessions.values())
    terminals.set(session.session_id, terminalFor(session.session_id, sessions))
  for (const turn of archive
    .prepare('SELECT * FROM history_turns ORDER BY invoked_at, logical_turn_key')
    .iterate() as Iterable<ArchivedTurn>) {
    const terminal = terminals.get(turn.session_id)
    if (!terminal) continue
    const models = turnsByTerminal.get(terminal.session_id) ?? new Map<string, ArchivedTurn[]>()
    const turns = models.get(turn.model) ?? []
    turns.push(turn)
    models.set(turn.model, turns)
    turnsByTerminal.set(terminal.session_id, models)
  }
  archive.prepare('DELETE FROM history_token_shares').run()
  archive.prepare('DELETE FROM history_undated_tokens').run()
  const insert = archive.prepare(`INSERT INTO history_token_shares VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  const undated = archive.prepare('INSERT INTO history_undated_tokens VALUES (?, ?, ?, ?, ?, ?)')
  const selectModels = archive.prepare('SELECT * FROM history_models WHERE session_id = ?')
  for (const session of sessions.values()) {
    if (terminals.get(session.session_id)?.session_id !== session.session_id) continue
    for (const model of selectModels.all(session.session_id) as Array<
      RecordedTokens & { model: string }
    >) {
      const turns = turnsByTerminal.get(session.session_id)?.get(model.model) ?? []
      if (turns.length === 0) {
        undated.run(
          session.session_id,
          model.model,
          ...TOKEN_COLUMNS.map((column) => model[column])
        )
        continue
      }
      const allocations = TOKEN_COLUMNS.map((column) => splitTokens(model[column], turns, column))
      turns.forEach((turn, index) =>
        insert.run(
          session.session_id,
          session.project,
          model.model,
          turn.invoked_at,
          ...allocations.map((category) => category[index])
        )
      )
    }
  }
}

export function archiveUsageHistory(
  index: Database.Database,
  archive: Database.Database,
  sources: { prompts: boolean; tokens: boolean },
  now: Date = new Date()
): void {
  archive.transaction(() => {
    if (sources.prompts) archivePrompts(index, archive, now)
    if (sources.tokens) {
      copyTokenSources(index, archive)
      rebuildTokenShares(archive)
    }
  })()
}
