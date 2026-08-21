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
//
// A few scenarios below (skill-detail-with-usage-history,
// skill-detail-with-metadata, skill-detail-without-metadata) target specific
// skills by name — grill-me, design, ponytail — because they need to hit
// specific real data states (usage history present, metadata present,
// metadata absent) in this developer's own ~/.claude. Those names are
// load-bearing: renaming or removing one of those skills breaks the matching
// scenario. Update the scenario alongside any such rename.

/** @typedef {{ name: string, run(window: import('playwright-core').Page): Promise<void> }} Scenario */

// JS-driven spring/fade motion isn't a CSS transition Playwright can
// auto-wait on — this is how long a scenario waits for one to settle before
// capturing, so the screenshot shows the resolved state, not a stuck frame.
const MOTION_SETTLE_MS = 300

/** Row click → SkillDetail, the common opening move for several scenarios below. */
async function openFirstSkillDetail(window) {
  await window.locator('tbody tr').first().click()
  await window.getByRole('button', { name: 'Back to skills' }).waitFor()
}

/** Row click → SkillDetail → "View files", landing on the trimmed file tree/content page. */
async function openFirstSkillFileView(window) {
  await window.locator('tbody tr').first().click()
  await window.getByRole('button', { name: 'View files' }).click()
  await window.getByRole('button', { name: 'Back to skill details' }).waitFor()
}

/** Command palette → search by name → open the matching skill's detail page. */
async function openSkillViaCommandPalette(window, searchTerm, optionNamePattern) {
  await window.keyboard.press('Meta+k')
  await window.getByPlaceholder(/search skills by name/i).fill(searchTerm)
  await window.getByRole('option', { name: optionNamePattern }).first().click()
  await window.getByRole('button', { name: 'Back to skills' }).waitFor()
}

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
      await openFirstSkillDetail(window)
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
      await openFirstSkillDetail(window)
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
      await openFirstSkillFileView(window)
    }
  },
  {
    // skill-files-open above already captures the tree's default (all-collapsed)
    // state — this one exercises expand, the direct fix for the crowded-tree bug.
    name: 'file-viewer-tree-expanded',
    async run(window) {
      await openFirstSkillFileView(window)
      await window.locator('[role="treeitem"][aria-expanded]').first().click()
      await window.locator('[role="treeitem"][aria-expanded="true"]').first().waitFor()
      // The tree's expand/collapse and row-entrance effects are motion (JS-driven)
      // springs/fades, not CSS transitions Playwright can auto-wait on — settle
      // before capturing so the screenshot shows the resolved state, not a frame
      // mid-animation.
      await window.waitForTimeout(MOTION_SETTLE_MS)
    }
  },
  {
    name: 'file-viewer-tree-search',
    async run(window) {
      await openFirstSkillFileView(window)
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
      await window.waitForTimeout(MOTION_SETTLE_MS)
    }
  },
  {
    // The skills table's hover-glide pill (motion, mirrors the file tree's).
    name: 'table-row-hover',
    async run(window) {
      await window.locator('tbody tr').nth(1).hover()
      await window.waitForTimeout(MOTION_SETTLE_MS)
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
      await openSkillViaCommandPalette(window, 'grill-me', /^grill-me/)
    }
  },
  {
    // Named skill rather than "first row", same reasoning as skill-detail-with-usage-history:
    // this depends on real data — a skill whose frontmatter has a `metadata:` block and a
    // populated `modified_at`, to exercise the Modified stat + Metadata badge section.
    name: 'skill-detail-with-metadata',
    async run(window) {
      await openSkillViaCommandPalette(window, 'design', /^design\s/)
    }
  },
  {
    // The inverse of skill-detail-with-metadata: a plugin-sourced skill, where
    // metadata_json/modified_at are always NULL (plugin skills use install-time
    // provenance instead — see docs/data-model.md). Confirms the Modified stat and
    // Metadata section are both correctly omitted, not rendered empty/broken.
    name: 'skill-detail-without-metadata',
    async run(window) {
      // Namespaced as "ponytail:ponytail" (plugin-name:skill-name — see
      // docs/data-model.md), not the bare "ponytail" this used to match pre-namespacing.
      await openSkillViaCommandPalette(window, 'ponytail', /^ponytail:/)
    }
  },
  {
    name: 'sidebar-projects-expanded',
    async run(window) {
      await window.getByRole('button', { name: 'Project' }).click()
      await window.waitForTimeout(MOTION_SETTLE_MS)
    }
  },
  {
    name: 'sidebar-plugins-expanded',
    async run(window) {
      await window.getByRole('button', { name: 'Plugin' }).click()
      await window.waitForTimeout(MOTION_SETTLE_MS)
    }
  },
  {
    // The table Name column's hook-driven-skill indicator (Webhook icon, next to the
    // existing synced/plugin-managed/shadowed icons) — filters to the ponytail plugin
    // via the sidebar so the icon's row is guaranteed on-screen, then hovers it to
    // reveal the tooltip's real event-name list (skills.hook_events, not a placeholder).
    name: 'table-hook-driven-icon-tooltip',
    async run(window) {
      await window.getByRole('button', { name: 'Plugin' }).click()
      await window.getByRole('button', { name: /^ponytail/ }).click()
      await window
        .locator('tbody tr', { hasText: 'ponytail:ponytail' })
        .first()
        .locator('svg.lucide-webhook')
        .hover()
      await window.getByText(/Also runs via hooks:/).waitFor()
    }
  },
  {
    name: 'skill-detail-lint-panel-expanded',
    async run(window) {
      await openFirstSkillDetail(window)
      await window.getByRole('button', { name: /Lint Status:/i }).click()
      await window.waitForTimeout(MOTION_SETTLE_MS)
    }
  },
  {
    // Sidebar's "N EST. tokens" readout button → the explainer modal (stat, budget
    // derivation, heaviest-skills breakdown).
    name: 'context-budget-dialog-open',
    async run(window) {
      await window.getByRole('button', { name: /EST\. tokens$/i }).click()
      await window.getByText('Never used, heaviest first').waitFor()
    }
  }
]
