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
// Every scenario carries a `screen` — one of the nine names in SKILL.md's "Scope
// the run" table (skill-inventory, skill-detail, skill-file-viewer, sidebar,
// command-palette, context-budget-dialog, settings-dialog, plugin-inventory,
// plugin-detail), tagged by what the screenshot is actually testing. It's what
// `npm run verify:visual -- --only <screen>` filters on. The two interaction
// guards (sidebar-filter-closes-open-detail, command-palette-skill-from-plugins-
// section) list both screens they span. A new scenario MUST have one.
//
// A few scenarios below (skill-detail-with-usage-history,
// skill-detail-with-metadata, skill-detail-without-metadata) target specific
// skills by name — grill-me, banner-design, ponytail — because they need to hit
// specific real data states (usage history present, metadata present,
// metadata absent) in this developer's own ~/.claude. Those names are
// load-bearing: renaming or removing one of those skills breaks the matching
// scenario. Disabled-skill scenarios instead find any local disabled skill and
// explicitly skip when none exists.

/** @typedef {{ name: string, screen: string | string[], shouldSkip?: (window: import('playwright-core').Page) => Promise<string | null>, run(window: import('playwright-core').Page): Promise<void> }} Scenario */

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
  await window.getByPlaceholder(/search skills/i).fill(searchTerm)
  await window.getByRole('option', { name: optionNamePattern }).first().click()
  await window.getByRole('button', { name: 'Back to skills' }).waitFor()
}

/** Expand the first Recent-activity row so a screenshot carries the accordion's open state
 *  (full prompt + Project / When / Subagent) alongside its still-collapsed siblings. */
async function expandFirstRecentTrigger(window) {
  await window.getByText('Recent activity', { exact: true }).waitFor()
  // Each recent-activity row is the only kind of button on this page that wraps a <time>.
  await window.locator('button:has(time)').first().click()
  await window.locator('button:has(time)[aria-expanded="true"]').first().waitFor()
}

/** Rail click → Plugins section, landing on the inventory table. */
async function openPluginsSection(window) {
  // `exact` matters: the section's own sidebar has an "All Plugins" row, and after a scenario
  // leaves the app on Plugins the reload-to-baseline lands there with that row already rendered.
  await window.getByRole('button', { name: 'Plugins', exact: true }).click()
  await window.locator('tbody tr').first().waitFor()
}

/** Plugins table row click → PluginDetail, the common opening move below. */
async function openFirstPluginDetail(window) {
  await openPluginsSection(window)
  await window.locator('tbody tr').first().click()
  await window.getByRole('button', { name: 'Back to plugins' }).waitFor()
}

/**
 * PluginDetail for one named plugin. Scope now changes what the detail page offers — a
 * project/local install's actions are disabled (see docs/data-model.md) — so scenarios that
 * depend on an action being clickable can't take whichever row happens to sort first.
 */
async function openPluginDetailByName(window, pluginName) {
  await openPluginsSection(window)
  await window.locator(`tbody tr:has-text("${pluginName}")`).first().click()
  await window.getByRole('button', { name: 'Back to plugins' }).waitFor()
}

async function skipWithoutScopedPlugin(window, scopeLabel) {
  await openPluginsSection(window)
  const count = await window.locator(`tbody tr:has-text("${scopeLabel}")`).count()
  return count === 0 ? `no ${scopeLabel.toLowerCase()}-scope plugin installed locally` : null
}

async function skipWithoutDisabledSkills(window) {
  const disabledSkillCount = await window.locator('tbody tr svg.lucide-power').count()
  return disabledSkillCount === 0 ? 'no disabled skills found locally' : null
}

async function skipWithoutUserInvocableOnlySkills(window) {
  const count = await window.locator('tbody tr svg.lucide-bot-off').count()
  return count === 0 ? 'no user-invocable-only skills found locally' : null
}

/**
 * Scenarios pinned to a skill by name (see the header note above) hard-fail the whole run when
 * that skill is no longer installed, taking every later scenario down with them. Skipping is the
 * same trade already made for disabled-skill scenarios: visible, and scoped to the one scenario.
 */
function skipWithoutNamedSkill(skillName) {
  return async (window) => {
    const count = await window.locator(`tbody tr:has-text("${skillName}")`).count()
    return count === 0 ? `no skill named "${skillName}" installed locally` : null
  }
}

/** @type {Scenario[]} */
export const scenarios = [
  {
    name: 'inventory-default-theme',
    screen: 'skill-inventory',
    async run() {
      // Nothing to do — the reloaded baseline itself is what we want to capture.
    }
  },
  {
    // The rail's one-click light↔dark toggle (skiper4-adapted sun/moon morph, motion-driven).
    name: 'inventory-other-theme',
    screen: 'skill-inventory',
    async run(window) {
      await window.getByRole('button', { name: /Switch to (dark|light) mode/ }).click()
      // The morph is a JS-driven motion tween, not a CSS transition Playwright auto-waits on.
      await window.waitForTimeout(MOTION_SETTLE_MS)
    }
  },
  {
    // The Cmd+, / rail-gear Settings dialog, which now owns the three-way appearance choice
    // (segmented control, ink-fill active) plus rescan / folders / about.
    name: 'settings-dialog-open',
    screen: 'settings-dialog',
    async run(window) {
      await window.getByRole('button', { name: 'Settings' }).click()
      await window.getByRole('radio', { name: 'System' }).waitFor()
    }
  },
  {
    name: 'plugins-settings-dialog-open',
    screen: 'settings-dialog',
    async run(window) {
      await openPluginsSection(window)
      await window.getByRole('button', { name: 'Settings' }).click()
      await window.getByRole('radio', { name: 'System' }).waitFor()
    }
  },
  {
    // Clicking a row now lands on the SkillDetail page (metadata only) — the file
    // tree/content view is a separate page, one click further via "View files".
    name: 'skill-detail-open',
    screen: 'skill-detail',
    async run(window) {
      await openFirstSkillDetail(window)
    }
  },
  {
    name: 'project-filter-empty-state',
    screen: 'skill-inventory',
    async run(window) {
      await window.getByRole('button', { name: 'Project', exact: true }).click()
    }
  },
  {
    name: 'sidebar-filter-closes-open-detail',
    screen: ['sidebar', 'skill-detail'],
    async run(window) {
      await openFirstSkillDetail(window)
      await window.getByRole('button', { name: 'Global' }).click()
    }
  },
  {
    name: 'command-palette-open',
    screen: 'command-palette',
    async run(window) {
      await window.keyboard.press('Meta+k')
      await window.getByPlaceholder(/search skills/i).waitFor()
    }
  },
  {
    // Keyboard path is covered by command-palette-open above — this covers the
    // visible header button separately, since it's a distinct entry point.
    name: 'command-palette-via-header-button',
    screen: 'command-palette',
    async run(window) {
      await window.getByRole('button', { name: /search skills/i }).click()
      await window.getByPlaceholder(/search skills/i).waitFor()
    }
  },
  {
    // The dedicated entry point onto the trimmed file tree/content page: Detail's
    // "View files" button. Its own back arrow returns to Detail, not the table.
    name: 'skill-files-open',
    screen: 'skill-file-viewer',
    async run(window) {
      await openFirstSkillFileView(window)
    }
  },
  {
    // skill-files-open above already captures the tree's default (all-collapsed)
    // state — this one exercises expand, the direct fix for the crowded-tree bug.
    name: 'file-viewer-tree-expanded',
    screen: 'skill-file-viewer',
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
    screen: 'skill-file-viewer',
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
    screen: 'sidebar',
    async run(window) {
      await window.getByRole('button', { name: 'Global' }).hover()
      // JS-driven spring, not a CSS transition Playwright can auto-wait on.
      await window.waitForTimeout(MOTION_SETTLE_MS)
    }
  },
  {
    // The skills table's hover-glide pill (motion, mirrors the file tree's).
    name: 'table-row-hover',
    screen: 'skill-inventory',
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
    // Left unexpanded so this capture keeps covering the monochrome pattern-fill trigger bar
    // and the non-clickable by-project rows near the top of the section; the accordion's open
    // state has its own scenario below.
    name: 'skill-detail-with-usage-history',
    screen: 'skill-detail',
    async run(window) {
      await openSkillViaCommandPalette(window, 'grill-me', /^grill-me/)
    }
  },
  {
    // PR 1, item 5: a Recent-activity row expanded — full (unclamped) prompt plus the
    // Project / When / Subagent detail list. Expanding scrolls the trigger bar out of frame,
    // which is why it's a separate scenario from skill-detail-with-usage-history rather than
    // a step added to it.
    name: 'skill-detail-recent-activity-expanded',
    screen: 'skill-detail',
    async run(window) {
      await openSkillViaCommandPalette(window, 'grill-me', /^grill-me/)
      await expandFirstRecentTrigger(window)
    }
  },
  {
    // The trigger bar is monochrome by design (DESIGN.md forbids color-as-category), so the
    // three trigger types are told apart by texture — solid / faint hatch / faint dot grid.
    // This confirms the texture stays resolvable at h-3 in dark mode, where the old ink-shade
    // treatment went nearly invisible. Left unexpanded so the bar stays in frame.
    name: 'skill-detail-usage-history-dark',
    screen: 'skill-detail',
    async run(window) {
      // Runner resets theme to 'system' before each scenario; check the class rather than
      // trust the toggle's label so this holds on a dark-mode host too.
      const isDark = () =>
        window.evaluate(() => document.documentElement.classList.contains('dark'))
      if (!(await isDark())) {
        await window.getByRole('button', { name: /Switch to dark mode/ }).click()
      }
      await window.waitForFunction(() => document.documentElement.classList.contains('dark'))
      await window.waitForTimeout(MOTION_SETTLE_MS)
      await openSkillViaCommandPalette(window, 'grill-me', /^grill-me/)
    }
  },
  {
    // Named skill rather than "first row", same reasoning as skill-detail-with-usage-history:
    // this depends on real data — a skill whose frontmatter has a `metadata:` block and a
    // populated `modified_at`, to exercise the Modified stat + Metadata badge section.
    name: 'skill-detail-with-metadata',
<<<<<<< HEAD
    shouldSkip: skipWithoutNamedSkill('banner-design'),
=======
    screen: 'skill-detail',
>>>>>>> d16d1cf (feat: redesign skill detail with usage insights)
    async run(window) {
      await openSkillViaCommandPalette(window, 'banner-design', /^banner-design/)
    }
  },
  {
    // The inverse of skill-detail-with-metadata: a plugin-sourced skill, where
    // metadata_json/modified_at are always NULL (plugin skills use install-time
    // provenance instead — see docs/data-model.md). Confirms the Modified stat and
    // Metadata section are both correctly omitted, not rendered empty/broken.
    name: 'skill-detail-without-metadata',
    screen: 'skill-detail',
    async run(window) {
      // Namespaced as "ponytail:ponytail" (plugin-name:skill-name — see
      // docs/data-model.md), not the bare "ponytail" this used to match pre-namespacing.
      await openSkillViaCommandPalette(window, 'ponytail', /^ponytail:/)
    }
  },
  {
    // A skill whose frontmatter carries `disable-model-invocation: true` — Detail
    // shows the neutral BotOff icon in the header and an "Invocation" stat reading
    // "User-invocable only · via SKILL.md frontmatter", with the token stat relabeled
    // "Est. listing tokens if listed". Named skill, same real-~/.claude-data assumption
    // as skill-detail-with-metadata: `handoff` is one of this developer's user-invocable-only
    // command skills.
    name: 'skill-detail-model-invocable-no',
<<<<<<< HEAD
    shouldSkip: skipWithoutNamedSkill('handoff'),
=======
    screen: 'skill-detail',
>>>>>>> d16d1cf (feat: redesign skill detail with usage insights)
    async run(window) {
      await openSkillViaCommandPalette(window, 'handoff', /^handoff/)
    }
  },
  {
    name: 'sidebar-projects-expanded',
    screen: 'sidebar',
    async run(window) {
      await window.getByRole('button', { name: 'Project', exact: true }).click()
      await window.waitForTimeout(MOTION_SETTLE_MS)
    }
  },
  {
    name: 'sidebar-plugins-expanded',
    screen: 'sidebar',
    async run(window) {
      await window.getByRole('button', { name: 'Plugin', exact: true }).click()
      await window.waitForTimeout(MOTION_SETTLE_MS)
    }
  },
  {
    // The chevron is a separate hit target from the row label (polish pass fixing
    // the P0 filter/expand click-coupling finding) — this proves the sublist can
    // open while the active filter stays put, rather than jumping to Project.
    name: 'sidebar-projects-expanded-via-chevron',
    screen: 'sidebar',
    async run(window) {
      await window.getByRole('button', { name: 'Global' }).click()
      await window.getByRole('button', { name: 'Expand project list' }).click()
      await window.waitForTimeout(MOTION_SETTLE_MS)
    }
  },
  {
    // SourceBadge's tooltip moved from native `title` to Radix Tooltip, matching
    // the name column's icon-affordance tooltips (LintStatusBadge, synced/lock/hook).
    // Targeted by data-variant="outline" rather than data-slot="badge" — wrapping
    // Badge in TooltipTrigger asChild has Radix's Slot overwrite data-slot to
    // "tooltip-trigger" on the merged element (harmless: nothing else in the app
    // selects on data-slot="badge"), but data-variant survives untouched.
    name: 'source-badge-tooltip',
    screen: 'skill-inventory',
    async run(window) {
      await window.locator('tbody tr').first().locator('[data-variant="outline"]').hover()
      await window.waitForTimeout(MOTION_SETTLE_MS)
    }
  },
  {
    // The table Name column's hook-driven-skill indicator (Webhook icon, next to the
    // existing synced/plugin-managed/shadowed icons) — filters to the ponytail plugin
    // via the sidebar so the icon's row is guaranteed on-screen, then hovers it to
    // reveal the tooltip's real event-name list (skills.hook_events, not a placeholder).
    name: 'table-hook-driven-icon-tooltip',
    screen: 'skill-inventory',
    async run(window) {
      await window.getByRole('button', { name: 'Plugin', exact: true }).click()
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
    // The table Name column's disabled-skill indicator: a red Power icon (promoted
    // from a neutral CircleSlash to its own flag color — see DESIGN.md's Disabled
    // Flag entry). Real local data may have no disabled skills, in which case this
    // scenario is visibly skipped rather than failing the rest of verification.
    name: 'table-disabled-icon-tooltip',
    screen: 'skill-inventory',
    shouldSkip: skipWithoutDisabledSkills,
    async run(window) {
      // The table focuses its first row and starts the glide highlight on mount; hovering into
      // that still-moving layout intermittently lands outside the icon and no tooltip opens.
      await window.waitForTimeout(MOTION_SETTLE_MS)
      await window.locator('tbody tr:has(svg.lucide-power) svg.lucide-power').first().hover()
      // Matches both tooltip variants — the icon carries "Plugin is disabled" for a
      // disabled plugin's skill and "Disabled via /skills" for a skillOverrides "off".
      // Waiting on the latter alone breaks on a machine whose only disabled skills are
      // plugin-disabled, which skipWithoutDisabledSkills above still counts as present.
      await window
        .getByText(/not loaded into context/)
        .first()
        .waitFor()
    }
  },
  {
    // The table Name column's user-invocable-only indicator: a neutral (muted-ink, NOT
    // flag-colored) BotOff icon, reading as a deliberate config beside the flag-colored
    // Power. Real local data may have none, in which case this scenario is skipped.
    name: 'table-user-invocable-only-icon-tooltip',
    screen: 'skill-inventory',
    shouldSkip: skipWithoutUserInvocableOnlySkills,
    async run(window) {
      await window.locator('tbody tr svg.lucide-bot-off').first().hover()
      await window.getByText(/User-invocable only/).waitFor()
    }
  },
  {
    // "View these skills" in the budget dialog closes it and filters the table down to
    // exactly the user-invocable-only global/plugin skills behind the sentence above it —
    // the row count must match budget.userInvocableOnlyCount.
    name: 'context-budget-dialog-view-user-invocable-only',
    screen: 'context-budget-dialog',
    shouldSkip: skipWithoutUserInvocableOnlySkills,
    async run(window) {
      await window.getByRole('button', { name: /EST\. tokens$/i }).click()
      await window.getByRole('button', { name: 'View these skills' }).click()
      await window.getByText('User-Invocable Only Skills').waitFor()
    }
  },
  {
    // Disabled-skill detail header: same red Power icon as the table row, next to
    // the skill name. Confirms it renders there too, while the "Disabled" Stat
    // further down the page stays plain text (deliberately left unchanged).
    name: 'skill-detail-disabled',
    screen: 'skill-detail',
    shouldSkip: skipWithoutDisabledSkills,
    async run(window) {
      await window.locator('tbody tr:has(svg.lucide-power)').first().click()
      await window.getByRole('button', { name: 'Back to skills' }).waitFor()
    }
  },
  {
    name: 'skill-detail-lint-panel-expanded',
    screen: 'skill-detail',
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
    screen: 'context-budget-dialog',
    async run(window) {
      await window.getByRole('button', { name: /EST\. tokens$/i }).click()
      await window.getByText('Never used, heaviest first').waitFor()
    }
  },
  {
    // "View disabled skills" link in the dialog closes it and filters the table down to
    // exactly the disabled global/plugin skills behind the excludedCount sentence above it.
    name: 'context-budget-dialog-view-disabled',
    screen: 'context-budget-dialog',
    shouldSkip: skipWithoutDisabledSkills,
    async run(window) {
      await window.getByRole('button', { name: /EST\. tokens$/i }).click()
      await window.getByRole('button', { name: 'View disabled skills' }).click()
      await window.getByText('Disabled Skills').waitFor()
    }
  },
  {
    // The AppRail's Plugins destination: PluginSidebar (All / User / Project / Local) beside
    // the inventory table. Real ~/.claude data on this machine has plugins at all three
    // scopes, so this is never the empty state.
    name: 'plugins-inventory-open',
    screen: 'plugin-inventory',
    async run(window) {
      await openPluginsSection(window)
    }
  },
  {
    // Project group expanded: one child row per project root holding a project-scope install,
    // with its plugin count. Confirms the group both filters and expands on one click.
    name: 'plugins-sidebar-project-expanded',
    async run(window) {
      await openPluginsSection(window)
      await window.getByRole('button', { name: 'Project', exact: true }).click()
      await window.getByText('Project Plugins').waitFor()
      await window.waitForTimeout(MOTION_SETTLE_MS)
    }
  },
  {
    // A single project selected under Local. The Scope column is deliberately dropped once a
    // scope is chosen — the sidebar already states it, and the table needs the width.
    name: 'plugins-sidebar-local-project-selected',
    shouldSkip: (window) => skipWithoutScopedPlugin(window, 'Local'),
    async run(window) {
      await openPluginsSection(window)
      await window.getByRole('button', { name: 'Local', exact: true }).click()
      await window.waitForTimeout(MOTION_SETTLE_MS)
      await window.locator('nav button').filter({ hasText: 'Megatron' }).first().click()
      // Unanchored: the header renders the title followed by a " · N" count span.
      await window.getByText(/Local \/ .+ Plugins/).waitFor()
    }
  },
  {
    // User scope: no expander, since a user install isn't anchored to a project. Also the
    // narrowest the table gets — five columns beside a 220px sidebar.
    name: 'plugins-sidebar-user-selected',
    async run(window) {
      await openPluginsSection(window)
      await window.getByRole('button', { name: 'User', exact: true }).click()
      await window.getByText('User Plugins').waitFor()
    }
  },
  {
    name: 'plugin-detail-open',
    screen: 'plugin-detail',
    async run(window) {
      await openFirstPluginDetail(window)
    }
  },
  {
    // The uninstall confirmation Dialog, opened but not confirmed — proves the
    // destructive action is gated and names the plugin/scope before it runs.
    // Pinned to a user-scope plugin: project/local installs have Uninstall disabled.
    name: 'plugin-detail-uninstall-confirm',
    screen: 'plugin-detail',
    async run(window) {
      await openPluginDetailByName(window, 'ponytail')
      await window.getByRole('button', { name: 'Uninstall' }).first().click()
      await window.getByText(/^Uninstall .+\?$/).waitFor()
    }
  },
  {
    // A project-scope install: the Scope cell carries the owning project, the status
    // reads Unknown because verify runs in a throwaway profile with no folder grants,
    // and the three actions are disabled pending the CLI-cwd follow-up.
    name: 'plugin-detail-project-scope',
    shouldSkip: (window) => skipWithoutScopedPlugin(window, 'Project'),
    async run(window) {
      await openPluginsSection(window)
      await window.locator('tbody tr:has-text("Project")').first().click()
      await window.getByRole('button', { name: 'Back to plugins' }).waitFor()
    }
  },
  {
    // Command palette now lists a Plugins group alongside Skills — same modal, no
    // new UI surface.
    name: 'command-palette-plugin-search',
    screen: 'command-palette',
    async run(window) {
      await window.keyboard.press('Meta+k')
      await window.getByPlaceholder(/search skills, plugins/i).fill('ponytail')
      await window
        .getByRole('option', { name: /^ponytail/ })
        .first()
        .waitFor()
    }
  },
  {
    // Regression guard: picking a skill from the command palette while the Plugins
    // section is active must switch back to Skills and render the detail.
    // openDetail() used to set the view without the section, so the palette closed
    // and nothing appeared. openSkillViaCommandPalette's wait for "Back to skills"
    // is the assertion — it times out if the section switch is missing.
    name: 'command-palette-skill-from-plugins-section',
    screen: ['command-palette', 'plugin-inventory'],
    async run(window) {
      await openPluginsSection(window)
      await openSkillViaCommandPalette(window, 'grill-me', /^grill-me/)
    }
  }
]
