import type { Api } from '../../../shared/api'
import { baseSkills, skillFiles } from '@/fixtures/data'
import { fixture, sheet, type Fixture, type FixtureUser } from '@/fixtures/define'
import { TREE_WIDTH_DEFAULT } from '@/lib/file-tree'
import { SkillFileViewer } from './SkillFileViewer'

const ignore = (): void => {}
const CODE_REVIEW = 1

function viewer(interact: Fixture['interact'], api: Partial<Api> = {}): Fixture {
  return fixture({
    frame: sheet('skills'),
    api: { openSkill: async (id) => skillFiles(id), ...api },
    render: () => (
      <SkillFileViewer
        skillId={CODE_REVIEW}
        summary={baseSkills.find((skill) => skill.id === CODE_REVIEW)}
        treeWidth={TREE_WIDTH_DEFAULT}
        onTreeWidthChange={ignore}
        onBack={ignore}
      />
    ),
    interact
  })
}

// The tree is virtualized, so its rows only exist once it has measured its own height.
const treeRendered = (user: FixtureUser): Promise<void> =>
  user.until({ role: 'treeitem', name: /SKILL\.md/ }, 'The file tree rendered no rows.')

export const Open = viewer(async (user) => {
  await treeRendered(user)
  await user.until({ role: 'heading', name: 'Steps' }, 'SKILL.md was not rendered.')
})

export const LoadError = viewer(
  (user) => user.until({ text: 'Could not load these files.' }, 'The load error never showed.'),
  {
    openSkill: async () => {
      throw new Error('Fixture: the files are unavailable')
    }
  }
)

// The scanner stops reading once a skill's files pass the preview budget, and says so in the tree.
export const PreviewLimit = viewer(
  async (user) => {
    await user.click({ role: 'treeitem', name: /Preview limit reached/ })
    await user.until(
      { text: /^Preview limit reached\. / },
      'The preview limit notice never showed.'
    )
  },
  {
    openSkill: async (id) =>
      skillFiles(id, [
        { relativePath: '[Preview limit reached]', content: null, status: 'preview_limit' }
      ])
  }
)

export const TreeExpanded = viewer(async (user) => {
  await treeRendered(user)
  await user.click({ role: 'treeitem', name: /references/ })
  await user.until(
    { role: 'treeitem', name: /rollback\.md/ },
    'Expanding references did not render its last file.'
  )
})

export const TreeSearch = viewer(async (user) => {
  await treeRendered(user)
  await user.click({ role: 'textbox', name: 'Filter skill files' })
  await user.type('check')
  await user.until(
    () => document.querySelectorAll('[role="treeitem"]').length === 2,
    'Filtering for "check" did not narrow the tree to references/checklist.md.'
  )
})
