// The folder list on its own for the states its add and revoke actions hold, and through App for
// the revoke result App writes into the folder cache.
import type { ComponentProps } from 'react'
import App from '@/App'
import { projectTree } from '@/fixtures/data'
import { fixture, type Fixture, type FixtureUser } from '@/fixtures/define'
import { ManageFoldersDialog } from './ManageFoldersDialog'

const ignore = (): void => {}
const never = (): Promise<never> => new Promise(() => {})
const fail = async (): Promise<never> => {
  throw new Error('Fixture: the folder change failed')
}

// The parent folder and its first repository are granted, so revoking the parent leaves the other
// two repositories without access.
const tree = projectTree('available')
const parent = tree.folders[0].path
const site = tree.projects.find((project) => project.path.endsWith('\\Megatron-site'))!.path

function dialog(
  props: Partial<ComponentProps<typeof ManageFoldersDialog>>,
  interact: Fixture['interact']
): Fixture {
  return fixture({
    frame: 'window',
    render: () => (
      <ManageFoldersDialog
        open
        onOpenChange={ignore}
        folders={tree.folders}
        projectCatalog={tree.projects}
        onAddFolders={async () => []}
        onNarrowFolder={async () => []}
        onRevokeFolder={async () => {}}
        {...props}
      />
    ),
    interact
  })
}

async function revokeParent(user: FixtureUser): Promise<void> {
  await user.click({ role: 'button', name: 'Revoke access to Megatron HQ', exact: true })
  await user.click({ role: 'button', name: 'Revoke', exact: true })
}

const addFolder = (user: FixtureUser): Promise<void> =>
  user.click({ role: 'button', name: 'Add Folder...', exact: true })

export const RevokeConfirm = dialog({}, async (user) => {
  await user.click({ role: 'button', name: 'Revoke access to Megatron HQ', exact: true })
  await user.until(
    { text: '2 projects inside it lose access.' },
    'The confirmation did not count the projects losing access.'
  )
  await user.until(
    { role: 'button', name: 'Keep some folders…', exact: true },
    'The confirmation offered no way to keep some folders.'
  )
})

export const Revoking = dialog({ onRevokeFolder: never }, async (user) => {
  await revokeParent(user)
  await user.until({ text: 'Revoking folder access…' }, 'A running revoke showed no progress.')
})

export const RevokeError = dialog({ onRevokeFolder: fail }, async (user) => {
  await revokeParent(user)
  await user.until(
    { text: 'Could not revoke folder access. Please try again.' },
    'A failed revoke showed no error.'
  )
})

export const SkippedNotice = dialog(
  { onAddFolders: async () => [{ path: site, coveredBy: parent }] },
  async (user) => {
    await addFolder(user)
    await user.until(
      { text: 'Megatron-site is already included in Megatron HQ.' },
      'A folder the parent already covers was not explained.'
    )
  }
)

export const Adding = dialog({ onAddFolders: never }, async (user) => {
  await addFolder(user)
  await user.until({ text: 'Adding folders…' }, 'A running add showed no progress.')
})

export const AddError = dialog({ onAddFolders: fail }, async (user) => {
  await addFolder(user)
  await user.until(
    { text: 'Could not add folders. Please try again.' },
    'A failed add showed no error.'
  )
})

// Behaviour: the list shows what the revoke returned without waiting for a refetch, which here
// never comes back. Revoking the parent leaves the repository granted on its own.
export const RevokedBeforeRefetch = fixture({
  frame: 'window',
  api: {
    listAllowedPaths: async () => tree.folders,
    listProjects: async () => tree.projects,
    listSkills: async () => tree.skills,
    revokeAllowedPath: async () => tree.folders.slice(1)
  },
  render: () => <App />,
  interact: async (user) => {
    await user.click({ role: 'button', name: 'Settings', exact: true })
    await user.click({ role: 'button', name: 'Manage…', exact: true })
    window.api.listAllowedPaths = never
    await revokeParent(user)
    await user.until(
      () => document.querySelector('[aria-label="Revoke access to Megatron HQ"]') === null,
      'The revoked folder stayed in the list until a refetch.'
    )
    await user.until(
      { role: 'button', name: 'Revoke access to Megatron', exact: true },
      'The folder the revoke kept left the list.'
    )
  }
})
