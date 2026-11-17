import { describe, expect, it } from 'vitest'
import { folderLabel } from './folder-label'

describe('folderLabel', () => {
  it.each([
    ['/Users/me/.claude', '~/.claude'],
    ['/Users/me', '~'],
    ['/Users/meg/.claude', '/Users/meg/.claude'],
    ['/Volumes/usb/.claude', '/Volumes/usb/.claude']
  ])('shortens %s under home on macOS', (path, label) => {
    expect(folderLabel(path, '/Users/me', 'darwin')).toBe(label)
  })

  it.each([
    ['C:\\Users\\Me\\.claude', '%USERPROFILE%\\.claude'],
    ['c:\\users\\me\\.claude-work', '%USERPROFILE%\\.claude-work'],
    ['C:\\Users\\Megan\\.claude', 'C:\\Users\\Megan\\.claude'],
    ['D:\\claude', 'D:\\claude']
  ])('shortens %s under home on Windows, ignoring case', (path, label) => {
    expect(folderLabel(path, 'C:\\Users\\Me', 'win32')).toBe(label)
  })
})
