import { mkdirSync } from 'fs'
import { join } from 'path'

export interface DataFolderApp {
  readonly isPackaged: boolean
  readonly commandLine: { hasSwitch(name: string): boolean }
  getName(): string
  getPath(name: 'appData'): string
  setPath(name: 'userData', path: string): void
}

export function ownedDataFolder(app: DataFolderApp): string {
  return join(app.getPath('appData'), app.isPackaged ? app.getName() : `${app.getName()}-dev`)
}

// Electron derives userData from package.json's name, so `npm run dev` and the installed app would
// share one folder. The release PR bumps the version on staging before users get it, so a dev run
// in between marked that release's What's New seen for the installed app, and it took the
// installed app's single-instance lock, preferences and usage archive along with it.
// An explicit --user-data-dir (visual-verify, smoke scripts) keeps winning.
export function separateDevDataFolder(app: DataFolderApp): void {
  if (app.isPackaged || app.commandLine.hasSwitch('user-data-dir')) return
  const folder = ownedDataFolder(app)
  // setPath throws on a missing directory.
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  app.setPath('userData', folder)
}
