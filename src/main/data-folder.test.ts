import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ownedDataFolder, separateDevDataFolder, type DataFolderApp } from './data-folder'

let appData: string

beforeEach(() => {
  appData = realpathSync(mkdtempSync(join(tmpdir(), 'megatron-data-folder-')))
})

afterEach(() => {
  rmSync(appData, { recursive: true, force: true })
})

// Electron's app is the external boundary here: a fake records the userData redirect.
function fakeApp(options: {
  isPackaged: boolean
  switches?: string[]
}): DataFolderApp & { userData: string | undefined } {
  const fake = {
    isPackaged: options.isPackaged,
    userData: undefined as string | undefined,
    commandLine: { hasSwitch: (name: string) => (options.switches ?? []).includes(name) },
    getName: () => 'megatron',
    getPath: (name: 'appData') => {
      if (name !== 'appData') throw new Error(`unexpected path ${name}`)
      return appData
    },
    setPath: (name: 'userData', path: string) => {
      if (name !== 'userData') throw new Error(`unexpected path ${name}`)
      // Electron's setPath throws on a missing directory; the fake holds Megatron to the same rule.
      if (!existsSync(path)) throw new Error(`setPath on missing directory ${path}`)
      fake.userData = path
    }
  }
  return fake
}

describe('data folder an installed app and a dev run each own', () => {
  it('keeps the installed app on its released folder', () => {
    const app = fakeApp({ isPackaged: true })

    separateDevDataFolder(app)

    expect(ownedDataFolder(app)).toBe(join(appData, 'megatron'))
    expect(app.userData).toBeUndefined()
    expect(existsSync(join(appData, 'megatron-dev'))).toBe(false)
  })

  it('moves an unpackaged run to its own folder so it never writes the installed app’s data', () => {
    const app = fakeApp({ isPackaged: false })

    separateDevDataFolder(app)

    const devFolder = join(appData, 'megatron-dev')
    expect(ownedDataFolder(app)).toBe(devFolder)
    expect(app.userData).toBe(devFolder)
    if (process.platform !== 'win32') expect(statSync(devFolder).mode & 0o777).toBe(0o700)
  })

  it('lets an explicit --user-data-dir keep winning for isolated launches', () => {
    const app = fakeApp({ isPackaged: false, switches: ['user-data-dir'] })

    separateDevDataFolder(app)

    expect(app.userData).toBeUndefined()
    expect(existsSync(join(appData, 'megatron-dev'))).toBe(false)
  })

  it('reuses the dev folder on later runs', () => {
    mkdirSync(join(appData, 'megatron-dev'), { mode: 0o700 })
    const app = fakeApp({ isPackaged: false })

    separateDevDataFolder(app)

    expect(app.userData).toBe(join(appData, 'megatron-dev'))
  })
})
