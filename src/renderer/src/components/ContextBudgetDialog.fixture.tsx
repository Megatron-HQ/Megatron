import App from '@/App'
import { baseSkills, skillsResult } from '@/fixtures/data'
import { fixture, type Fixture } from '@/fixtures/define'
import { ContextBudgetDialog } from './ContextBudgetDialog'

const ignore = (): void => {}

export const Open = fixture({
  frame: 'window',
  render: () => (
    <ContextBudgetDialog
      open
      onOpenChange={ignore}
      budget={skillsResult().contextBudget}
      skills={baseSkills}
      onSelectSkill={ignore}
      onViewDisabled={ignore}
      onViewUserInvocableOnly={ignore}
    />
  ),
  interact: (user) =>
    user.until({ text: 'Never used, heaviest first' }, 'The heaviest skills never showed.')
})

// Behaviour: each excluded count links to the list behind it, and following it closes the dialog.
function viewExcluded(link: string, title: string): Fixture {
  return fixture({
    frame: 'window',
    render: () => <App />,
    interact: async (user) => {
      await user.click({ role: 'button', name: /EST\. tokens$/ })
      await user.click({ role: 'button', name: link })
      await user.until(
        { text: new RegExp(`^${title} · \\d+$`) },
        `${link} did not filter the table.`
      )
      await user.until(
        () => document.querySelector('[role="dialog"]') === null,
        `${link} left the dialog open.`
      )
    }
  })
}

export const ViewDisabled = viewExcluded('View disabled skills', 'Disabled Skills')
export const ViewUserInvocableOnly = viewExcluded(
  'View user-invocable skills',
  'User-Invocable Only Skills'
)
