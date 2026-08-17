import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { grantPath, resetGrantedPaths } from '../../permissions'
import { brokenFilePathsRule } from './broken-file-paths'
import type { SkillLintTarget, LinterContext } from '../types'

describe('brokenFilePathsRule', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatron-rule3-test-'))
    grantPath(tmpDir)
  })

  afterEach(() => {
    resetGrantedPaths()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const dummyContext: LinterContext = {
    skills: [],
    globalMcpServers: new Set()
  }

  it('detects broken markdown link targets in SKILL.md as warnings', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.mkdirSync(path.join(skillDir, 'docs'))
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: skill-1\ndescription: Test\n---\nSee [guide](./docs/guide.md) for details.'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: 'Test'
    }

    const findings = brokenFilePathsRule.run(skill, dummyContext)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule_id: 'broken-file-paths',
      severity: 'warning',
      file_path: 'SKILL.md'
    })
    expect(findings[0].message).toContain('./docs/guide.md')
  })

  it('ignores external URLs, anchor links, and home paths', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: skill-1\ndescription: Test\n---\n[Website](https://example.com) and [Section](#overview) and [Mail](mailto:test@example.com)\nStore in `~/.agent-reach/` and `/tmp/output.json`'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: 'Test'
    }

    const findings = brokenFilePathsRule.run(skill, dummyContext)
    expect(findings).toHaveLength(0)
  })

  it('ignores template placeholders, mime types, and CLI flags', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: skill-1\ndescription: Test\n---\nWrite report to `job-search/reports/<YYYY-MM-DD>.md` or `-run3.md` with `application/json`'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: 'Test'
    }

    const findings = brokenFilePathsRule.run(skill, dummyContext)
    expect(findings).toHaveLength(0)
  })

  it('detects broken backtick path references in body as warnings', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.mkdirSync(path.join(skillDir, 'scripts'))
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: skill-1\ndescription: Test\n---\nRun `scripts/deploy.sh` to build.'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: 'Test'
    }

    const findings = brokenFilePathsRule.run(skill, dummyContext)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warning')
    expect(findings[0].message).toContain('scripts/deploy.sh')
  })

  it('passes when referenced files exist', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.mkdirSync(path.join(skillDir, 'scripts'))
    fs.writeFileSync(path.join(skillDir, 'scripts', 'deploy.sh'), '#!/bin/bash')
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: skill-1\ndescription: Test\n---\nRun `./scripts/deploy.sh` or `<skill-dir>/scripts/deploy.sh` to build.'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: 'Test'
    }

    const findings = brokenFilePathsRule.run(skill, dummyContext)
    expect(findings).toHaveLength(0)
  })

  it('checks the path token in a backtick command, not the CLI flags', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.mkdirSync(path.join(skillDir, 'scripts'))
    fs.writeFileSync(path.join(skillDir, 'scripts', 'ats_scan.py'), 'print("ok")')
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: skill-1\ndescription: Test\n---\nBoard-only scanner: `scripts/ats_scan.py --days N` — ATS APIs alone'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: 'Test'
    }

    expect(brokenFilePathsRule.run(skill, dummyContext)).toEqual([])
  })

  it('still flags a missing script when the backtick includes CLI flags', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.mkdirSync(path.join(skillDir, 'scripts'))
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: skill-1\ndescription: Test\n---\nRun `scripts/missing.py --days N`'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: 'Test'
    }

    const findings = brokenFilePathsRule.run(skill, dummyContext)
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('scripts/missing.py')
    expect(findings[0].message).not.toContain('--days')
  })

  it('does not flag trailing-slash directory mentions as missing skill files', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: skill-1\ndescription: Test\n---\nIf no `docs/adr/` exists, create it when the first ADR is needed.'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: 'Test'
    }

    expect(brokenFilePathsRule.run(skill, dummyContext)).toEqual([])
  })

  it('accepts a project-skill path that exists at the repo root, not inside the skill', () => {
    const repo = path.join(tmpDir, 'repo')
    const skillDir = path.join(repo, '.claude', 'skills', 'visual-verify')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.mkdirSync(path.join(repo, 'docs'))
    fs.writeFileSync(path.join(repo, 'docs', 'design-system.md'), '# design')
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: visual-verify\ndescription: Test\n---\nsee `docs/design-system.md`.'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'visual-verify',
      source_type: 'project',
      source_path: skillDir,
      plugin_name: null,
      description: 'Test',
      project_root: repo
    }

    expect(brokenFilePathsRule.run(skill, dummyContext)).toEqual([])
  })

  it('still flags a project-skill path missing from both the skill directory and the repo', () => {
    const repo = path.join(tmpDir, 'repo')
    const skillDir = path.join(repo, '.claude', 'skills', 'visual-verify')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.mkdirSync(path.join(repo, 'docs'))
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: visual-verify\ndescription: Test\n---\nsee `docs/design-system.md`.'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'visual-verify',
      source_type: 'project',
      source_path: skillDir,
      plugin_name: null,
      description: 'Test',
      project_root: repo
    }

    const findings = brokenFilePathsRule.run(skill, dummyContext)
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('docs/design-system.md')
  })

  it('does not treat another folder as a fallback for a global skill', () => {
    const repo = path.join(tmpDir, 'repo')
    const skillDir = path.join(tmpDir, 'global-skill')
    fs.mkdirSync(repo)
    fs.mkdirSync(path.join(repo, 'docs'))
    fs.mkdirSync(skillDir)
    fs.mkdirSync(path.join(skillDir, 'docs'))
    fs.writeFileSync(path.join(repo, 'docs', 'design-system.md'), '# design')
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: visual-verify\ndescription: Test\n---\nsee `docs/design-system.md`.'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'visual-verify',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: 'Test',
      project_root: repo
    }

    const findings = brokenFilePathsRule.run(skill, dummyContext)
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('docs/design-system.md')
  })

  it('does not flag ellipsis placeholders as missing files', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: skill-1\ndescription: Test\n---\nDo not use `./scripts/...` from the working directory.'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'plugin',
      source_path: skillDir,
      plugin_name: 'demo@marketplace',
      description: 'Test'
    }

    expect(brokenFilePathsRule.run(skill, dummyContext)).toEqual([])
  })

  it('does not flag well-known target-repo files like CLAUDE.md', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: skill-1\ndescription: Test\n---\n| Project root | `./CLAUDE.md` |\n| Local | `./.claude.local.md` |'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'plugin',
      source_path: skillDir,
      plugin_name: 'demo@marketplace',
      description: 'Test'
    }

    expect(brokenFilePathsRule.run(skill, dummyContext)).toEqual([])
  })

  it('does not flag a bundled-dir path when that directory does not exist in the skill', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: skill-1\ndescription: Test\n---\nA `scripts/rotate_pdf.py` script would be helpful to store in the skill.'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'plugin',
      source_path: skillDir,
      plugin_name: 'demo@marketplace',
      description: 'Test'
    }

    expect(brokenFilePathsRule.run(skill, dummyContext)).toEqual([])
  })

  it('does not flag example catalog paths even when the parent directory exists', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.mkdirSync(path.join(skillDir, 'references'))
    fs.writeFileSync(path.join(skillDir, 'references', 'real.md'), '# real')
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: skill-1',
        'description: Test',
        '---',
        '- **Examples**: `references/finance.md` for financial schemas',
        '- Detailed patterns → `references/patterns.md`',
        '3. `references/patterns.md` for detailed hook patterns to avoid bloating SKILL.md',
        '',
        '```markdown',
        '- **`references/advanced.md`** - Advanced techniques',
        '```'
      ].join('\n')
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'plugin',
      source_path: skillDir,
      plugin_name: 'demo@marketplace',
      description: 'Test'
    }

    expect(brokenFilePathsRule.run(skill, dummyContext)).toEqual([])
  })

  it('accepts a plugin-skill path that exists at the plugin package root', () => {
    const pluginRoot = path.join(tmpDir, 'my-plugin')
    const skillDir = path.join(pluginRoot, 'skills', 'cool-skill')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.mkdirSync(path.join(pluginRoot, 'scripts'))
    fs.writeFileSync(path.join(pluginRoot, 'scripts', 'tool.sh'), '#!/bin/bash')
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: cool-skill\ndescription: Test\n---\nRun `scripts/tool.sh`.'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'cool-skill',
      source_type: 'plugin',
      source_path: skillDir,
      plugin_name: 'my-plugin@marketplace',
      description: 'Test'
    }

    expect(brokenFilePathsRule.run(skill, dummyContext)).toEqual([])
  })

  it('still flags a plugin-skill path missing from both the skill directory and the plugin root', () => {
    const pluginRoot = path.join(tmpDir, 'my-plugin')
    const skillDir = path.join(pluginRoot, 'skills', 'cool-skill')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.mkdirSync(path.join(skillDir, 'scripts'))
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: cool-skill\ndescription: Test\n---\nRun `scripts/missing.sh`.'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'cool-skill',
      source_type: 'plugin',
      source_path: skillDir,
      plugin_name: 'my-plugin@marketplace',
      description: 'Test'
    }

    const findings = brokenFilePathsRule.run(skill, dummyContext)
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('scripts/missing.sh')
  })

  it('strips an optional title from a markdown link target', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.mkdirSync(path.join(skillDir, 'docs'))
    fs.writeFileSync(path.join(skillDir, 'docs', 'guide.md'), '# guide')
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: skill-1\ndescription: Test\n---\nSee [guide](./docs/guide.md "Usage guide").'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: 'Test'
    }

    expect(brokenFilePathsRule.run(skill, dummyContext)).toEqual([])
  })
})
