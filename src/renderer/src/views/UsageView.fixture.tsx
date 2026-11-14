import { useState } from 'react'
import { fixture, sheet, type Fixture, type FixtureUser } from '@/fixtures/define'
import { historyApi, usageCalendar } from '@/fixtures/usage-data'
import { UsageView } from './UsageView'

const ignore = (): void => {}

function HistoryView(): React.JSX.Element {
  const [year, setYear] = useState(new Date().getFullYear())
  return (
    <UsageView
      panel="history"
      activityWindow="30d"
      onActivityWindowChange={ignore}
      tokenWindow="30d"
      onTokenWindowChange={ignore}
      calendarYear={year}
      onCalendarYearChange={setYear}
      costWindow="30d"
      onCostWindowChange={ignore}
      modelWindow="30d"
      onModelWindowChange={ignore}
      skillWindow="30d"
      onSkillWindowChange={ignore}
      onShowInvocations={ignore}
    />
  )
}

async function loaded(user: FixtureUser): Promise<void> {
  await user.until(
    { role: 'group', name: /Daily activity calendar/ },
    'The contribution calendar never loaded.'
  )
}

function history(interact: Fixture['interact'] = loaded, api = historyApi()): Fixture {
  return fixture({ frame: sheet('usage'), api, render: () => <HistoryView />, interact })
}

export const Calendar = history()
export const ProjectSearch = history(async (user) => {
  await loaded(user)
  await user.click({ role: 'searchbox', name: 'Search project timeline' })
  await user.type('Internal')
  await user.until({ text: '1 of 2 projects match' }, 'Project search did not filter the timeline.')
})
export const PriorYear = history(async (user) => {
  await loaded(user)
  await user.click({ role: 'button', name: String(new Date().getFullYear() - 1), exact: true })
  await user.until(
    { role: 'group', name: `Daily activity calendar for ${new Date().getFullYear() - 1}` },
    'Changing the contribution year did not load that year.'
  )
})
export const DayKeyboardReturn = history(async (user) => {
  await loaded(user)
  await user.click({
    selector: '[aria-label^="Daily activity calendar"] button[aria-haspopup="dialog"]'
  })
  await user.until({ role: 'dialog' }, 'Selecting a calendar day did not open its details.')
  await user.press('Escape')
  await user.until(
    () => document.activeElement?.getAttribute('aria-haspopup') === 'dialog',
    'Closing day details did not restore focus to its calendar cell.'
  )
  const nextWeek = document.querySelectorAll('[aria-label^="Daily activity calendar"] button')[7]
  await user.press('ArrowRight')
  await user.until(
    () => document.activeElement === nextWeek,
    'The right arrow did not move to the same weekday in the next week.'
  )
})
export const CalendarUnavailable = history(loaded, {
  ...historyApi(),
  getUsageCalendar: async (year) => {
    const data = usageCalendar(year)
    return {
      ...data,
      prompts: 0,
      activeDays: 0,
      byProject: [],
      summary: {
        ...data.summary,
        observedDays: 0,
        longestStreak: null,
        busiestDay: null,
        promptsPerActiveDay: null
      },
      months: data.months.map((month) => ({
        ...month,
        count: 0,
        coverage: month.coverage === 'future' ? 'future' : 'unavailable'
      })),
      days: data.days.map((day) =>
        day.coverage === 'future'
          ? day
          : { ...day, coverage: 'unavailable', count: 0, tokens: null }
      )
    }
  }
})
