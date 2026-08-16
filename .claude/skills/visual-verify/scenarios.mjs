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
    name: 'file-viewer-open',
    async run(window) {
      await window.locator('tbody tr').first().click()
      await window.getByRole('button', { name: 'Back to skills' }).waitFor()
    }
  },
  {
    name: 'project-filter-empty-state',
    async run(window) {
      await window.getByRole('button', { name: 'Project' }).click()
    }
  },
  {
    name: 'sidebar-filter-closes-open-viewer',
    async run(window) {
      await window.locator('tbody tr').first().click()
      await window.getByRole('button', { name: 'Back to skills' }).waitFor()
      await window.getByRole('button', { name: 'Global' }).click()
    }
  },
  {
    name: 'command-palette-open',
    async run(window) {
      await window.keyboard.press('Meta+k')
      await window.getByPlaceholder(/search skills/i).waitFor()
    }
  },
  {
    // Keyboard path is covered by command-palette-open above — this covers the
    // visible header button separately, since it's a distinct entry point.
    name: 'command-palette-via-header-button',
    async run(window) {
      await window.getByRole('button', { name: /search skills/i }).click()
      await window.getByPlaceholder(/search skills/i).waitFor()
    }
  },
  {
    // file-viewer-open above already captures the tree's default (all-collapsed)
    // state — this one exercises expand, the direct fix for the crowded-tree bug.
    name: 'file-viewer-tree-expanded',
    async run(window) {
      await window.locator('tbody tr').first().click()
      await window.getByRole('button', { name: 'Back to skills' }).waitFor()
      await window.locator('[role="treeitem"][aria-expanded]').first().click()
      await window.locator('[role="treeitem"][aria-expanded="true"]').first().waitFor()
      // The tree's expand/collapse and row-entrance effects are motion (JS-driven)
      // springs/fades, not CSS transitions Playwright can auto-wait on — settle
      // before capturing so the screenshot shows the resolved state, not a frame
      // mid-animation.
      await window.waitForTimeout(300)
    }
  },
  {
    name: 'file-viewer-tree-search',
    async run(window) {
      await window.locator('tbody tr').first().click()
      await window.getByRole('button', { name: 'Back to skills' }).waitFor()
      // Every skill has a SKILL.md, so this is guaranteed to match regardless
      // of which skill the first table row happens to be.
      await window.getByPlaceholder(/filter files/i).fill('skill')
    }
  },
  {
    // The sidebar nav's hover-glide pill (motion, mirrors the file tree's).
    name: 'sidebar-nav-hover',
    async run(window) {
      await window.getByRole('button', { name: 'Global' }).hover()
      // JS-driven spring, not a CSS transition Playwright can auto-wait on.
      await window.waitForTimeout(300)
    }
  },
  {
    // The skills table's hover-glide pill (motion, mirrors the file tree's).
    name: 'table-row-hover',
    async run(window) {
      await window.locator('tbody tr').nth(1).hover()
      await window.waitForTimeout(300)
    }
  }
]
