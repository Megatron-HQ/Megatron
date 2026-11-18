import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { gitBoolean, parseGitConfig, parseGitdir } from './git-config'

describe('core.bare as git reads it', () => {
  const coreBare = (config: string): boolean => gitBoolean(parseGitConfig(config).get('core.bare'))

  it.each([
    '[core]\n\tbare = true\n',
    '[core]\n\tbare = yes\n',
    '[core]\n\tbare = on\n',
    '[core]\n\tbare = 1\n',
    '[core]\n\tbare = 2\n',
    '[core]\n\tbare\n',
    '[core]\n\tbare # set by clone --bare\n',
    '[core]\n\tbare = true # set by clone --bare\n',
    '[core]\n\tbare = "true"\n',
    '[Core]\n\tBare = TRUE\n',
    '[core] bare = true\n',
    '[core]\r\n\tbare = true\r\n',
    '[core]\nbare=true',
    '[core]\n\tbare = false\n[core]\n\tbare = true\n'
  ])('reads %j as a bare repository', (config) => {
    expect(coreBare(config)).toBe(true)
  })

  it.each([
    '',
    '[core]\n\tbare = false\n',
    '[core]\n\tbare = no\n',
    '[core]\n\tbare = off\n',
    '[core]\n\tbare = 0\n',
    '[core]\n\tbare =\n',
    '[core]\n\tbare = false ; was true\n',
    '[core]\n\tbare = "yes ; not a comment"\n',
    '[core]\n\tbare = maybe\n',
    '[core]\n\t# bare = true\n',
    '[core]\n\tbareword = true\n',
    '[foo]\n\tbare = true\n',
    '[foo] bare = true\n',
    '[core "x"]\n\tbare = true\n',
    '[core]\n\tbare = false\n[foo]\n\tbare = true\n',
    '[core]\n\tbare = true\n[core]\n\tbare = false\n'
  ])('reads %j as a repository with a checkout', (config) => {
    expect(coreBare(config)).toBe(false)
  })
})

describe('parseGitdir', () => {
  it.each([
    ['gitdir: /code/app/.git/worktrees/x\n', '/code/wt', '/code/app/.git/worktrees/x'],
    ['gitdir: /code/app/.git/worktrees/x\r\n', '/code/wt', '/code/app/.git/worktrees/x'],
    ['/code/wt/.git\n', '/code/app/.git/worktrees/wt', '/code/wt/.git'],
    // Relative pointers resolve with the host's own path rules (a drive letter on Windows).
    ['gitdir: ../app/.git/worktrees/x\n', '/code/wt', resolve('/code/app/.git/worktrees/x')],
    ['../../../../wt/.git\n', '/code/app/.git/worktrees/wt', resolve('/code/wt/.git')],
    [
      'gitdir: C:/Users/sai/app/.git/worktrees/x\n',
      '/code/wt',
      'C:/Users/sai/app/.git/worktrees/x'
    ],
    [
      'gitdir: //server/share/app/.git/worktrees/x',
      '/code/wt',
      '//server/share/app/.git/worktrees/x'
    ]
  ])('reads %j relative to %s', (content, base, expected) => {
    expect(parseGitdir(content, base, 'darwin')).toBe(expected)
  })

  it.each(['', '\n', 'gitdir:   \n'])('rejects an empty pointer %j', (content) => {
    expect(parseGitdir(content, '/code/wt')).toBeNull()
  })

  it('rejects a WSL pointer on Windows without rejecting UNC paths', () => {
    expect(parseGitdir('gitdir: /mnt/c/code/.git', 'C:\\wt', 'win32')).toBeNull()
    expect(parseGitdir('gitdir: //server/share/.git', 'C:\\wt', 'win32')).toBe(
      '//server/share/.git'
    )
  })
})
