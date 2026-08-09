import { ElectronAPI } from '@electron-toolkit/preload'

interface Api {
  getSqliteVersion: () => Promise<string>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
