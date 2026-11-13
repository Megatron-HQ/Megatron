import type { ReactNode } from 'react'
import type { Api } from '../../../shared/api'
import type { AppSection } from '../../../shared/ipc'

// Where the gallery puts a fixture. 'window' fills the window, for fixtures that render <App />.
// The others place one component in the rectangle the real app gives that slot, measured from a
// live <App /> at mount time, so no layout constant is copied here.
export type Frame = 'window' | { slot: 'sheet' | 'sidebar'; section: AppSection }

export function sheet(section: AppSection): Frame {
  return { slot: 'sheet', section }
}

export function sidebar(section: AppSection): Frame {
  return { slot: 'sidebar', section }
}

// The first match is used. Prefer role and name; fall back to text, then to a CSS selector.
export type Target =
  | { role: string; name?: string | RegExp; exact?: boolean }
  | { text: string | RegExp; exact?: boolean }
  | { selector: string }

export interface FixtureUser {
  click(target: Target): Promise<void>
  hover(target: Target): Promise<void>
  press(key: string): Promise<void>
  type(text: string): Promise<void>
  // The pass/fail step: waits for the target to be visible or the function to return true, and
  // fails the fixture with `message` if neither happens in time.
  until(condition: Target | (() => boolean), message: string): Promise<void>
}

export interface Fixture {
  frame: Frame
  // Replaces members of the fake window.api for this fixture only.
  api?: Partial<Api>
  // Read by app modules while they load, so it cannot be set through `api`.
  platform?: 'darwin' | 'win32'
  render: () => ReactNode
  // Runs after the first render and before the screenshot. Input is real browser input.
  interact?: (user: FixtureUser) => Promise<void>
}

export function fixture(definition: Fixture): Fixture {
  return definition
}
