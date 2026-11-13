import type { AppSection } from '../../../shared/ipc'
import { fixture, type Fixture } from '@/fixtures/define'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppHeader } from './AppHeader'

const ignore = (): void => {}

function header(
  section: AppSection,
  updateNotice?: string,
  platform?: 'darwin' | 'win32'
): Fixture {
  return fixture({
    frame: 'window',
    platform,
    render: () => (
      <TooltipProvider>
        <AppHeader
          section={section}
          onSectionChange={ignore}
          onOpenSettings={ignore}
          updateNotice={updateNotice}
        />
      </TooltipProvider>
    )
  })
}

export const Skills = header('skills')
export const Plugins = header('plugins')
export const Usage = header('usage')
export const Windows = header('skills', undefined, 'win32')
export const UpdateNotice = {
  ...header('skills', 'Update available'),
  interact: async (user: Parameters<NonNullable<Fixture['interact']>>[0]): Promise<void> => {
    await user.hover({ role: 'button', name: /Settings.*Update available/ })
    await user.until(
      { role: 'tooltip', name: /Update available/ },
      'The Settings update notice showed no tooltip.'
    )
  }
}
