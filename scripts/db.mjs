// Resolves the local index the same way the app does — Electron's `userData` path — without
// booting Electron, so `npm run db` / `npm run db:reset` work on every platform CI runs on.
// Keep APP_NAME in sync with package.json's `name`, which is what Electron derives userData from.
import { execFile } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const APP_NAME = 'megatron'

function userDataDir() {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), APP_NAME)
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', APP_NAME)
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), APP_NAME)
}

const dbPath = join(userDataDir(), 'megatron.db')

// SQLite leaves -wal/-shm alongside the database; deleting only the main file would restore a
// stale page cache on the next open.
function reset() {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    rmSync(dbPath + suffix, { force: true })
  }
  console.log(`Deleted ${dbPath} — relaunch the app to rebuild the index.`)
  console.log('Tier-2 folder grants (allowed_paths) are gone too; re-grant them in the app.')
}

function open() {
  if (!existsSync(dbPath)) {
    console.error(`No index at ${dbPath}. Launch the app once to create it.`)
    process.exit(1)
  }
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', dbPath]]
      : process.platform === 'darwin'
        ? ['open', ['-a', 'DB Browser for SQLite', dbPath]]
        : ['xdg-open', [dbPath]]

  execFile(command, args, (error) => {
    if (error) {
      console.error(`Could not open ${dbPath}: ${error.message}`)
      process.exit(1)
    }
  })
}

const command = process.argv[2]
if (command === 'reset') {
  reset()
} else if (command === 'open') {
  open()
} else {
  console.error('Usage: node scripts/db.mjs <open|reset>')
  process.exit(1)
}
