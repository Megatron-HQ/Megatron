// Resolves the local index the same way the app does — Electron's `userData` path — without
// booting Electron, so `npm run db` / `npm run db:reset` work on every platform CI runs on.
// Keep APP_NAME in sync with package.json's `name`, which is what Electron derives userData from;
// unpackaged runs use `${APP_NAME}-dev` (src/main/data-folder.ts).
import { execFile } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const APP_NAME = 'megatron'

function appDataDir() {
  if (process.platform === 'win32') {
    return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support')
  }
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
}

const installedDbPath = join(appDataDir(), APP_NAME, 'megatron.db')
const devDbPath = join(appDataDir(), `${APP_NAME}-dev`, 'megatron.db')

// Both indexes are derived caches, so reset clears the installed app's as well as `npm run dev`'s.
// SQLite leaves -wal/-shm alongside the database; deleting only the main file would restore a
// stale page cache on the next open.
function reset() {
  for (const path of [installedDbPath, devDbPath]) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      rmSync(path + suffix, { force: true })
    }
    console.log(`Deleted ${path}`)
  }
  console.log('Relaunch the app to rebuild the index.')
  console.log('Folder grants live in preferences.json and are kept.')
}

function open() {
  if (!existsSync(devDbPath)) {
    console.error(`No index at ${devDbPath}. Run "npm run dev" once to create it.`)
    process.exit(1)
  }
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', devDbPath]]
      : process.platform === 'darwin'
        ? ['open', ['-a', 'DB Browser for SQLite', devDbPath]]
        : ['xdg-open', [devDbPath]]

  execFile(command, args, (error) => {
    if (error) {
      console.error(`Could not open ${devDbPath}: ${error.message}`)
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
