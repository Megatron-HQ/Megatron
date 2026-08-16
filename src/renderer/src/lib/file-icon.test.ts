import { File, FileCode, FileCog, FileImage, FileJson, FileText } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { resolveFileIcon } from './file-icon'

describe('resolveFileIcon', () => {
  it('maps common code extensions', () => {
    expect(resolveFileIcon('index.tsx')).toBe(FileCode)
    expect(resolveFileIcon('generate.py')).toBe(FileCode)
  })

  it('maps json and markdown extensions', () => {
    expect(resolveFileIcon('package.json')).toBe(FileJson)
    expect(resolveFileIcon('README.md')).toBe(FileText)
  })

  it('maps image extensions', () => {
    expect(resolveFileIcon('logo.png')).toBe(FileImage)
  })

  it('resolves a compound extension before the final segment', () => {
    expect(resolveFileIcon('vite.config.ts')).toBe(FileCode)
  })

  it('matches known filenames case-insensitively regardless of extension', () => {
    expect(resolveFileIcon('Dockerfile')).toBe(FileCog)
    expect(resolveFileIcon('.gitignore')).toBe(FileCog)
  })

  it('falls back to the generic file icon for unknown extensions', () => {
    expect(resolveFileIcon('data.bin')).toBe(File)
    expect(resolveFileIcon('noextension')).toBe(File)
  })
})
