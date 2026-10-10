import Database from 'better-sqlite3'
import {
  mkdirSync,
  mkdtempSync,
  opendirSync,
  realpathSync,
  rmSync,
  writeFileSync,
  type Dirent
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, expect, it, vi } from 'vitest'
import { applySchema } from '../db/schema'
import { grantPath, resetGrantedPaths } from '../permissions'
import { scanTranscripts } from './transcript-scanner'

vi.mock('fs', async () => {
  const filesystem = await vi.importActual<typeof import('fs')>('fs')
  return { ...filesystem, opendirSync: vi.fn(filesystem.opendirSync) }
})

afterEach(() => resetGrantedPaths())

it('keeps replay ownership stable when the filesystem enumerates transcript names in reverse order', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'megatron-transcript-order-')))
  const projects = join(root, 'projects')
  const project = join(projects, 'project-a')
  mkdirSync(project, { recursive: true })
  grantPath(root)
  const database = new Database(':memory:')
  const filesystem = await vi.importActual<typeof import('fs')>('fs')
  try {
    applySchema(database)
    for (const sessionId of ['a-original', 'b-replay']) {
      const records = [
        {
          type: 'user',
          sessionId,
          isSidechain: false,
          uuid: `${sessionId}-meta`,
          cwd: '/fixture/project',
          timestamp: '2026-10-10T00:00:00Z',
          message: { content: 'fixture' }
        },
        {
          type: 'assistant',
          sessionId,
          isSidechain: false,
          uuid: 'shared-turn',
          timestamp: '2026-10-10T00:00:01Z',
          requestId: 'shared-request',
          message: {
            id: 'shared-message',
            model: 'claude-sonnet-5-20260901',
            content: [{ type: 'text', text: 'done' }],
            usage: { input_tokens: 10, output_tokens: 20 }
          }
        }
      ]
      writeFileSync(
        join(project, `${sessionId}.jsonl`),
        records.map((record) => JSON.stringify(record)).join('\n')
      )
    }
    vi.mocked(opendirSync).mockImplementation((path, options) => {
      const directory = filesystem.opendirSync(path, options)
      if (path === project) {
        const entries: Dirent[] = []
        for (let entry = directory.readSync(); entry !== null; entry = directory.readSync())
          entries.push(entry)
        entries.sort((left, right) => (left.name < right.name ? 1 : -1))
        directory.readSync = () => entries.shift() ?? null
      }
      return directory
    })

    scanTranscripts(database, projects)

    expect(database.prepare('SELECT session_id, output_tokens FROM turn_usage').all()).toEqual([
      { session_id: 'a-original', output_tokens: 20 }
    ])
  } finally {
    vi.mocked(opendirSync).mockImplementation(filesystem.opendirSync)
    database.close()
    rmSync(root, { recursive: true, force: true })
  }
})
