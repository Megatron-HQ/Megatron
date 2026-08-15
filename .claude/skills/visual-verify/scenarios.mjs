// The screens/states visual-verify captures, every run, regardless of which
// screen the current change actually touched — this is what catches a shared-
// component or token change breaking something elsewhere. The runner
// (verify.mjs) reloads the app back to its default baseline before every
// single (scenario, size) pair, so each `run` can assume it's starting fresh
// — describe how to get from the default state to the state you want to
// screenshot, nothing more. Don't rely on another scenario having run first.
//
// Implementing a UI change that adds a new screen, nav destination, or major
// state includes adding its scenario here in the same change — see SKILL.md.

/** @typedef {{ name: string, run(window: import('playwright-core').Page): Promise<void> }} Scenario */

/** @type {Scenario[]} */
export const scenarios = [
  {
    name: 'inventory-default-theme',
    async run() {
      // Nothing to do — the reloaded baseline itself is what we want to capture.
    }
  },
  {
    name: 'inventory-other-theme',
    async run(window) {
      await window.getByRole('button', { name: /mode$/i }).click()
    }
  },
  {
    name: 'detail-panel-open',
    async run(window) {
      await window.locator('tbody tr').first().click()
      await window.getByRole('button', { name: 'Close detail panel' }).waitFor()
    }
  },
  {
    name: 'project-filter-empty-state',
    async run(window) {
      await window.getByRole('button', { name: 'Project' }).click()
    }
  },
  {
    name: 'command-palette-open',
    async run(window) {
      await window.keyboard.press('Meta+k')
      await window.getByPlaceholder(/search skills/i).waitFor()
    }
  }
]
