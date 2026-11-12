// Electron 43 ships no install script: node_modules/electron downloads and extracts its binary the
// first time anything loads it. On a fresh install (every CI and release job) that first load used
// to happen inside parallel Vitest workers, and two concurrent extractions into
// node_modules/electron/dist collided ("os error 183", CI run 43293932437). Loading it once here,
// before any worker starts, makes the download happen at most once per run.
import { createRequire } from 'node:module'

export default function installElectronBinaryOnce() {
  createRequire(import.meta.url)('electron')
}
