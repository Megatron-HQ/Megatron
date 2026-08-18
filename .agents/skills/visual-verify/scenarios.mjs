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
    // Clicking a row now lands on the SkillDetail page (metadata only) — the file
    // tree/content view is a separate page, one click further via "View files".
    name: 'skill-detail-open',
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
    name: 'sidebar-filter-closes-open-detail',
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
    // The dedicated entry point onto the trimmed file tree/content page: Detail's
    // "View files" button. Its own back arrow returns to Detail, not the table.
    name: 'skill-files-open',
    async run(window) {
      await window.locator('tbody tr').first().click()
      await window.getByRole('button', { name: 'View files' }).click()
      await window.getByRole('button', { name: 'Back to skill details' }).waitFor()
    }
  },
  {
    // skill-files-open above already captures the tree's default (all-collapsed)
    // state — this one exercises expand, the direct fix for the crowded-tree bug.
    name: 'file-viewer-tree-expanded',
    async run(window) {
      await window.locator('tbody tr').first().click()
      await window.getByRole('button', { name: 'View files' }).click()
      await window.getByRole('button', { name: 'Back to skill details' }).waitFor()
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
      await window.getByRole('button', { name: 'View files' }).click()
      await window.getByRole('button', { name: 'Back to skill details' }).waitFor()
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
  },
  {
    // M5 usage stats: a skill with real invocation history, rendering the always-expanded
    // trigger-type/per-project/recent-trigger breakdown (no disclosure toggle anymore — the
    // Detail page has room to just show it). Named skill rather than "first row" because this
    // depends on real usage existing — same real-~/.claude-data assumption every other scenario
    // here already makes (e.g. project-filter-empty-state assumes zero grants). Also exercises
    // the command-palette entry point landing on Detail, same as a table-row click would.
    name: 'skill-detail-with-usage-history',
    async run(window) {
      await window.keyboard.press('Meta+k')
      await window.getByPlaceholder(/search skills by name/i).fill('grill-me')
      await window
        .getByRole('option', { name: /^grill-me/ })
        .first()
        .click()
      await window.getByRole('button', { name: 'Back to skills' }).waitFor()
    }
  },
  {
    name: 'sidebar-projects-expanded',
    async run(window) {
      await window.getByRole('button', { name: 'Project' }).click()
      await window.waitForTimeout(300)
    }
  },
  {
    name: 'sidebar-plugins-expanded',
    async run(window) {
      await window.getByRole('button', { name: 'Plugin' }).click()
      await window.waitForTimeout(300)
    }
  },
  {
    name: 'skill-detail-lint-panel-expanded',
    async run(window) {
      await window.locator('tbody tr').first().click()
      await window.getByRole('button', { name: 'Back to skills' }).waitFor()
      await window.getByRole('button', { name: /Lint Status:/i }).click()
      await window.waitForTimeout(300)
    }
  }
]
