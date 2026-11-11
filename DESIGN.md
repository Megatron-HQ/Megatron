# Design System: Megatron

## Overview

**Creative North Star: "The Inventory Ledger"**

Megatron reads like a well-kept ledger, not a dashboard performing busyness. Every skill gets one flat, neutral-ink row — global, project, and plugin sources sit in the same visual register, distinguished by an icon and a word, never by their own color. Density is the feature, not a compromise: a page of quiet rows is the sign that nothing needs you, and the interface stays legible precisely because it refuses to compete with itself for attention.

Exactly one stamp of color breaks that quiet: acid lime, reserved for the single active thing on screen — the selected sidebar filter, or a primary call-to-action. Every other color has one job on its own channel: five status tones report state (lint, context budget, updates, disabled), entity hues say what a thing is (Skills, MCP, Memory, Agents), and model hues tell Usage chart series apart. None borrows the stamp's job, and none leaves its channel (the Channel Rule). Everything else — borders, hover states, focus rings — is drawn in warm ink and rule-lines on warm paper, the ledger's native materials.

Confirmed rejections: no shadow at rest except the one content sheet (every other shadow is reserved for genuinely floating layers), no gradients, no per-source-tier color coding, no hero-scale type anywhere in the product.

The **Usage** section (a retrospective, not an inventory) is a different surface class. Its user-authorised departures are all recorded below, each scoped to Usage: the Usage Stat numeral (Typography) and hand-rolled, animated charts (Components). Its chart colors are not departures: monochrome chart ink, model series, and entity identity are all part of the one color system (Colors).

**Onboarding** (the first-run dialog) is a third surface class, also user-authorised: large step headlines and motion-led transitions with live count-ups, scoped to that dialog alone. See the Onboarding entry under Components.

**Key Characteristics:**

- Dense, Linear-style sidebar + list/detail shell, now spanning three sections (Skills, Plugins, Usage) behind a persistent icon rail — still a utility, never a spacious admin dashboard
- One accent (acid lime), used sparingly, never as body text or a link
- Warm paper neutrals: ink, rule-lines, and surfaces share one faint warm tint in both themes
- Border-first, flat elevation: a flat frame (titlebar strip, rail, sidebars) holds one raised content sheet, the only surface with a shadow at rest; otherwise shadows appear only on floating layers (dropdowns, popovers, tooltips)
- Geist Sans for all UI text, Geist Mono for tabular/code-like data
- Every status signal pairs an icon with its color — never color alone

## Colors

Warm ledger ink on warm paper, with four color roles on top, each on its own channel: the lime stamp for "this is the active line," five status tones for state, four entity hues for what a thing is, and four model hues for Usage chart series. Nothing else carries color. Fourteen hues can't all stay colorblind-distinct from each other, so roles never share a surface: channel separation, not hue distance alone, is what keeps them apart (see Validation and the Channel Rule). Built on shadcn's `new-york`/`neutral` base (`components.json`). Every token below is defined in `src/renderer/src/assets/main.css`, light values in `:root` and dark in `.dark`.

### Primary

- **Acid Lime** (`--accent-lime`, text on it `--accent-lime-foreground`; same literal value in both themes): the ledger's one stamp of color. shadcn's own `--accent` is a neutral hover fill, not the stamp. Marks the active sidebar filter-nav item and overrides the default button fill on primary CTAs (e.g. "Grant a folder to scan for skills"). Never body text, never a link — text-weight lime on a light background reads poorly, and its rarity is the point. The app rail's active section is deliberately excluded from this stamp — see the Rail entry under Components — so the One Stamp Rule's wording (acid lime marks the _sidebar's_ active filter) stays true without amendment.

### Neutral (Warm Paper)

Every neutral carries one warm tint: OKLCH C≈0.011 at h82 in light, C≈0.008 at h75 in dark. Surfaces take the full tint; text and ink fills take half, so ink stays sharp; light cards and popovers stay pure white so they lift off the paper.

The window is two surfaces: a flat frame around one raised content sheet (see Layout). They read apart from lightness alone, sheet:frame 1.10:1 light (ΔL 0.032) and 1.09:1 dark (ΔL 0.046), so the sheet's edge never depends on its shadow rendering.

- **Frame** (`--frame`): the window's outer surface: the titlebar strip, the rail, the sidebars, and the gutter around the sheet. One step darker than the sheet in both themes, so the content reads as raised.
- **Ledger Paper** (`--background`): the content sheet. Deliberately off pure white/black in both themes.
- **Card** (`--card`, `--popover`): panels, popovers, and dialogs — one step off the page.
- **Ledger Ink** (`--foreground`): primary text and icon color.
- **Primary Stamp** (`--primary`, `--primary-foreground`): the default button fill.
- **Ink, Muted** (`--muted-foreground`): secondary text, table column headers, captions, placeholder text.
- **Surface Muted** (`--muted`, `--secondary`, `--accent`): hover backgrounds, status-pill fill, secondary-button fill.
- **Frame Muted** (`--frame-muted`): the same fills on the frame. `--muted` and `--accent` were tuned against the sheet and nearly vanish on the light frame (1.05:1), so the `frame-surface` utility on the rail-and-sidebar wrapper rescopes both to this step (1.09:1). It's the darkest step that keeps `--muted-foreground` count-pill text at 4.5:1 (4.53). Dark reuses `--muted`, which already reads on the dark frame (1.28:1).
- **Rule Line** (`--border`, `--input`): the 1px borders that do the elevation system's work. A solid warm step in both themes, never alpha white, so a rule reads the same over every surface it crosses.
- **Focus Ring** (`--ring`): the single keyboard-focus indicator used everywhere — no separate focus-color system.

### Status tones (functional, not decorative)

Five tones carry every state in the app. States share tones rather than each taking a hue, so adding a state never runs the palette out of distinguishable colors: a new state picks the closest tone and gets its own icon. A sixth tone is a design decision.

- **Danger** (`--destructive`): lint errors; the sidebar's context-budget dot once usage is over budget; inline error messages; destructive actions (plugin uninstall).
- **Warning** (`--warning`): lint warnings; the budget dot once usage is approaching budget (past 80%, `BUDGET_WARNING_THRESHOLD` in `context-budget.ts`); the icon on a Usage data-quality caveat (e.g. a model Claude Code couldn't price). On the frame it takes a darker step, `--frame-warning` (`#c97400` light; dark reuses `--warning`), because the sheet's step is 2.85:1 on the light frame. It's the same tone with a frame step, not a sixth tone: `frame-surface` swaps it in, so the budget dot still writes `bg-warning`.
- **Success** (`--success`): passing lint / up to date; the budget dot's default, comfortably-under-budget state; a granted folder in onboarding.
- **Info** (`--info`): update available, and nothing else: the plugin update pill, PluginDetail's Update button, onboarding's update count, and the rail gear's dot. Neutral notices (e.g. a folder already covered by a grant) stay muted ink even when they use the `Info` icon.
- **Dormant** (`--dormant`): present but inactive: a skill disabled via `skillOverrides` or a disabled plugin (`Power`), and a stale skill that hasn't run in the last 30 days of recorded sessions (`Clock`). A muted violet rather than a quieter red, so "turned off" never reads as "broken" even though a skill can be both at once (lint status and disabled state are independent facts).

### Chart ink (Usage)

- **`--usage-bar`**: the default bar fill — every bar full ink, kept thin with air between. The polish is proportion and restraint, not color.
- **`--usage-bar-quiet`**: opt-in per chart, only where one value must be named and bar height alone doesn't carry it; the emphasized bar stays full ink and the rest go quiet. Also the "Other" fold for an unmapped model family.
- **Ordinal scales are ink ramps, never hue:** the punchcard's quantile opacity steps of `--usage-bar`, the contribution calendar's `--contribution-1..4` (usage ink mixed into the paper, so higher activity is darker in light mode and lighter in dark), and the effort mix's `color-mix` steps, with "not recorded" off the scale as `.usage-fill-unrecorded` stripes.

### Model series (functional, not decorative)

Four categorical hues — `--usage-series-1/2/3/4` (Sonnet, Opus, Haiku, Fable; CVD-validated all-pairs in both themes) — carrying **series identity** in the Usage view only, and only where a chart splits by a bounded identity dimension (today: cost & activity **by model**; ≤4 **family** hues, ever). Assigned by model family in a fixed order, never by rank. Versions within a family are solid tints of that family's hue — newest full, older stepped toward the paper — never a new hue. Always direct-labeled — the hue rides a legend dot or a mark that sits beside its own text label, never color-alone. A fifth+ family folds to `--usage-bar-quiet` ("Other"), never a generated hue. Scoped hard: not by project, not by day, not the Skills or Plugins surfaces. Acid lime is excluded from the palette: it is the stamp, and a near-yellow fails CVD beside the Opus orange.

### Entity identity

Four fixed hues name what a thing is: `--entity-skills` (violet), `--entity-mcp` (cyan), `--entity-memory` (magenta), and `--entity-agents` (orange). Plugins, hooks, and commands stay neutral. Today the entity hues mark two things. The entity glyph (Components → Entity glyph) marks Skills in ⌘K's skill rows and the SkillDetail header; MCP, Memory, and Agents glyphs render once those entities have surfaces of their own. Resident Tax colors its composition bar and matching ledger dots; MCP tools and MCP server instructions share the MCP hue. Deferred items use an outlined dot in the same hue. System overhead and unknown categories stay neutral, the autocompact buffer keeps quiet stripes, and free space stays the bare track. A glyph's tinted tile is part of the mark, not a row background. Entity hues never color text, numbers, row backgrounds, selection, drill-in dialogs, the rail, or section icons such as onboarding's overview cards, and never change with rank or refresh. They never appear on the frame at all (see the Channel Rule).

### Validation

Verified 2026-11-11 with the `dataviz` skill's `validate_palette.js`, against the `--background` sheet of each theme, against the `--frame` for the tones and neutrals the frame carries, and against `--popover` and the `--accent` selected-row fill for the entity glyph tiles.

- **Entities, all pairs** (entity marks can sit next to each other in any order): worst colorblind ΔE 13.9 light / 11.8 dark; worst normal-vision ΔE 18.2 / 15.2. Dark steps run up to L 0.70 so marks clear 3:1; MCP's dark step (L 0.701) sits just past the validator's dark lightness band on purpose, its one flagged check.
- **Entity glyph tiles** (the glyph against a 10% tint of its own hue, composited over the surface beneath): Skills 5.15 on the popover / 5.06 on the sheet / 4.39 on a selected row (`--accent`) light, 3.48 / 3.81 / 3.24 dark; Memory 5.19 / 5.14 / 4.44 light, 3.42 / 3.73 / 3.16 dark. Light Agents drops to 2.69 on a selected row, and light MCP to 2.93 / 2.88 / 2.51 (2.78 even bare on a selected row). Neither renders as a glyph yet; each gets a darker glyph step, validated here, before it does. A stronger tint costs contrast: at 16% dark Skills on a selected row falls to 3.02.
- **Tones:** icons clear 3:1 on the paper. Light: danger 5.77, warning 3.13, success 3.36, info 4.75, dormant 4.02. Dark: danger 5.66, warning 10.0, success 9.68, info 7.27, dormant 6.90.
- **Tones on the frame:** Light: danger 5.25, warning 3.14 (the `--frame-warning` step; the sheet's step would be 2.85), success 3.06, info 4.33, dormant 3.66. Dark: danger 6.17, warning 10.9, success 10.6, info 7.93, dormant 7.52. The frame step keeps its tone neighbors apart: warning ↔ danger ΔE 10.9 colorblind (deutan) / 16.0 normal, warning ↔ success 8.8 (protan) / 21.6.
- **Frame and sheet:** sheet:frame 1.10:1 light / 1.09:1 dark. Light `--frame-muted` on the frame 1.09:1; `--muted-foreground` on `--frame-muted` 4.53:1 and on the frame 4.96:1.
- **Model series, all pairs** (legend order isn't chart order): worst colorblind ΔE 9.2 light / 8.2 dark; worst normal-vision ΔE 16.3 / 16.9. Haiku green is 2.77:1 on the light paper, below 3:1; the direct labels the series already require are its relief.
- **Across roles:** the closest pair is Agents ↔ warning: ΔE 2.2 deutan / 3.4 normal against the sheet's step (light), and ΔE 0.3 deutan / 0.9 protan / 2.3 normal against the frame's `--frame-warning` step, which deuteranopes can't tell apart at all. The Channel Rule, not hue distance, keeps them from being confused: tones and entity hues never share a channel, and entity hues never appear on the frame.

### Named Rules

**The One Stamp Rule.** Acid lime marks exactly one thing at a time — the active sidebar filter, or a single primary call-to-action — and never appears as body text, a link, or a decorative fill.
**The Tones-Aren't-The-Stamp Rule.** The five tones report state only: lint, context budget, update availability, disabled, staleness, Usage data-quality caveats, onboarding's folder access, errors, and destructive actions. They never substitute for the lime accent, and a status is never color alone — always paired with an icon, and paired with a label wherever the tone renders as a pill (the dormant `Power` and `Clock` render as icon-only signals with a tooltip instead, since they live in the table's icon tray, not the Status column). Two ambient dots are deliberate, narrow exceptions, paired with a tooltip label instead of an icon: the context-budget dot in the sidebar footer and the update dot on the rail gear. Neither is a primary status pill, where icon-pairing stays mandatory.
**The Channel Rule.** Each color role has its own channel, and its hues stay in it. Entity hues: entity marks only, and never on the frame (rail, sidebars, titlebar strip), where the warning tone's `--frame-warning` step is indistinguishable from Agents for deuteranopes. Model hues: Usage chart marks that split by model, always direct-labeled, only inside `components/usage/`. Tones: status pills, status icons, the two ambient dots, inline alert and caveat messages, and destructive actions. No hue ever means "active" (that's the stamp), a source tier, or a UI accent.
**The Monochrome-Chart-Ink Rule.** Usage charts draw magnitude and emphasis in `--usage-bar` ink alone. Color in a chart only ever means identity (model or entity). A tinted "data" color was considered and rejected: it would be the second accent the ledger forbids.
**The Every-Hue-Has-A-Role Rule.** A new hue joins exactly one role. Before it ships, re-run the validator against that role's existing hues (all pairs, `--pairs all`), check its closest pair in every other role, and record the numbers under Validation.

## Typography

**UI Font:** Geist Sans (with `ui-sans-serif, system-ui, sans-serif` fallback)
**Mono Font:** Geist Mono (with `ui-monospace, monospace` fallback), for tabular/code-like data — skill paths, version strings, plugin IDs, token counts.

**Character:** A ledger's typeface, not a marketing one — every size sits at or below 16px/600, with one scoped exception (Usage Stat). Hierarchy comes entirely from position and ink-vs-muted contrast, never from a scale jump.

### Hierarchy

- **Title** (600, 16px, 1.3 line-height): the skill file viewer's detail-panel title — the largest text anywhere in the product.
- **Label, App** (600, 14px): the sidebar wordmark ("Megatron").
- **Body** (400, 13px): table cells, descriptions, and general UI text.
- **Label, Column** (500, 11px, uppercase, ink-muted, 0.04em tracking): table column headers.
- **Mono Data** (400, 12px, tabular-nums): file paths, plugin IDs, version strings — Geist Mono.
- **Section Header** (600, 13px, ledger-ink): Usage panel and section headers. Charts inside take Label, Column — a two-level hierarchy that gives a long retrospective real structure while staying under 16px.
- **Usage Stat** (`.text-usage-stat`: 500, 30px Geist Mono, tabular-nums, −0.01em tracking): the three or four primary stat numerals in a Usage panel, and nothing else.

**Rendered markdown** (inside the skill file viewer) gets its own descending scale rather than reusing UI sizes: h1 20px/600, h2 16px/600, h3 14px/600, h4–h6 share the Body size — all Geist Sans; fenced and inline code stay at the Mono Data step. Prose caps at `72ch`, the one place in the app that isn't fluid-width.

### Named Rules

**The No-Hero-Type Rule.** Nothing in the ledger exceeds 16px/600. If something needs to stand out, move it up in position or contrast — never up in size. The Usage Stat numeral is the one exception: a retrospective's headline figures are a different surface class from the list/detail UI this rule governs, and Geist Mono keeps it inside "Mono for data", so only size departs.

## Layout

A dense, Linear-style sidebar + list/detail shell, not a spacious admin dashboard or a marketing page. The window is a flat **frame** holding one raised **content sheet**. The frame carries a full-width top strip, a persistent 48px icon rail for switching sections (Skills, Plugins, Usage), and a 220px secondary sidebar nested inside each section; the rail and sidebars run to the window's bottom edge. The sheet fills the rest, inset 6px from the window's right and bottom edges (its own margin), with the `xl` radius, a 1px rule-line border, and `--sheet-shadow`. Its first row is the scan banner when one shows, clipped to the radius; below that is the fluid content pane, where the file viewer replaces (not layers over) the table when a skill row opens. Skills and Plugins use their sidebars for source/scope filters; Usage uses the same shell for its panels, rendering one at a time. The top strip is 32px on macOS, the drag region under the `hiddenInset` titlebar that holds the traffic lights, and 6px of frame under Windows' native titlebar. The sheet's top edge is the window's visible content edge under the strip, so no separate titlebar bar is drawn.

Row height is fixed at 40px with 8/12px cell padding. The file viewer's tree pane defaults to 240px and is user-resizable between 200–480px. Content max-width is `none` everywhere — fluid — except rendered markdown prose, which caps at `72ch`. The command palette (`⌘K`) is a modal overlay, not primary navigation; it does not reopen the "no search box in the sidebar" decision.

## Elevation & Depth

Border-first. The frame (titlebar strip, rail, sidebars) is flat; its one internal seam, between rail and sidebar, is a 1px rule-line. The content sheet is the one surface at rest that casts a shadow: `--sheet-shadow` plus its 1px border lift the content off the frame. Everything inside the sheet is flat: a 1px rule-line divides the scan banner, the file viewer's header/tree, and every other on-page seam. Otherwise shadows are reserved for layers genuinely floating above the page: dropdowns, popovers, tooltips, dialogs, toasts, the command palette. These use shadcn's default shadow scale, unmodified.

### Named Rules

**The Ledger-Lies-Flat Rule.** The frame is flat, and so is everything on the sheet: if it's part of the page, it's flat and bordered. The sheet itself is the one at-rest surface with a shadow, and that shadow is the sheet's alone. Anything else casts a shadow only if it floats above the page.

## Shapes

A single radius scale rooted at 10px (`--radius: 0.625rem`), applied identically regardless of skill source (global/project/plugin — no tier gets its own geometry): `sm` (6px) for the tightest inner controls, `md` (8px) — the default — for buttons, inputs, and nav items, `lg` (10px) for cards and dialogs, `xl` (14px) for the content sheet. Pills (badges, status chips, the context-budget progress track) use `full` (9999px). No borders on filled surfaces beyond the 1px rule-line already covered under Elevation.

## Components

**Lucide** (`lucide-react`) for every icon in the product — consistent stroke, geometric, monochrome-by-default; matches shadcn's own blocks and the Linear-grade quality bar the shell borrows from. Icon-only or color-alone is never used for a status or identity signal — see the Tones-Aren't-The-Stamp Rule.

### Buttons

- **Shape:** rounded-md (8px).
- **Primary:** `--primary` fill, `--primary-foreground` text — the default "open/confirm" action.
- **Lime override:** primary CTAs that need to stand out (e.g. "Grant a folder to scan for skills") swap in acid lime directly on the button rather than through a separate component variant — a targeted override, not a new button kind, per the One Stamp Rule.
- **Outline / Ghost / Secondary / Destructive:** standard shadcn treatment. Outline for de-emphasized actions; destructive for plugin uninstall, in the danger tone.
- **Hover / Focus:** every hover state dims to 90% of its own fill — never a separate token. Focus uses the shared `--ring` at a 3px, 50%-alpha ring.

### Text links

- **`TextLink`** — the one treatment for every inline "View X" / "Reveal X" affordance (an in-app `<button>`, not an `<a>`; v1 has no in-product navigation links). A 1px `currentColor` underline sweeps in left-to-right on **both hover and focus-visible** — keyboard users get the same affordance, and the reveal replaces the default focus ring. Drawn in ink; the lime stamp is never a link, per the One Stamp Rule.
- **Two registers.** The underline only appears on hover/focus, so a `TextLink` has no at-rest affordance of its own and leans on context. Sentence-embedded links and list-tail disclosure ("View all N", "Show all N") stay caption-quiet — 11px uppercase `ink-muted`. A **standalone navigation** link — alone under a paragraph, in the slot where the eye expects the next section caption — takes link register instead: 13px sentence-case `ledger-ink` plus a leading context icon (e.g. `FileText` for "View SKILL.md"), because no section caption carries an icon.
- **Adapted from Skiper UI's skiper40 "Link001"** — the `before:` pseudo-element geometry and `300ms cubic-bezier(0.4, 0, 0.2, 1)` are lifted verbatim; thickness drops from `0.05em` to 1px (sub-pixel at 11–13px type) and the external-URL arrow is dropped (nothing in scope leaves the app). What was lifted and what changed is recorded in the component's header comment.
- **Component owns the animation only** — font size, weight, case, and hover ink color stay at each call site, so it composes with any text style. Reduced motion keeps the underline, drops the sweep.

### Badges / Chips

- **Source badges** (`SourceBadge`): outline variant, icon + label always paired — `Globe` (global), `FolderGit2` (project), `Blocks` (plugin). No per-tier color; a trailing `Lock` icon marks plugin skills as read-only, with a tooltip on hover.
- **Status pills** (`LintStatusBadge`): rounded-full, muted fill, bordered. The only colored element is the icon (danger/warning/success tone) — the label text always stays ledger-ink, so a status is legible even to someone who can't distinguish the tones.
- **Plugin update pill** (`PluginBadges`): `ArrowUpCircle` + "Update" in the info tone. PluginDetail's Update button takes the same tone while an update is available.
- **Disabled** (`Power`): the dormant tone, icon-only with a tooltip in the table's icon tray, and icon + "Disabled" in the plugin status pill.
- **Stale** (`Clock`): the dormant tone, icon-only with a tooltip in the table's icon tray. Never alongside `Power` or the shadow warning, which already explain why a skill doesn't run. The rule lives in `docs/usage-analytics.md` (Stale skills).

### Entity glyph

- **`EntityGlyph`** is the entity mark outside Resident Tax: a 28px `rounded-lg` tile tinted with the entity's hue at 10%, holding a 16px glyph in the full hue. Skills `BrainCircuit`, MCP `Plug`, Memory `NotebookText`, Agents `Workflow`. Memory isn't `FileText`, which already means SKILL.md. Agents isn't `Bot`, which pairs with `BotOff` to mean "Claude invokes it on its own" (the Auto trigger and the user-invocable-only chip).
- **Where:** the leading slot of ⌘K skill rows, and the SkillDetail header between Back and the title. In ⌘K the source icon moves inline before the source label, keeping its icon + label pair, and plugin rows keep a bare, muted `Blocks` in a slot of the same width so both groups' text lines up. Plugins aren't an entity, so they get no tile.
- **Always beside text that names the entity** (a group heading, the detail view's title), so the glyph is decorative (`aria-hidden`) and identity is never carried by color alone.
- **Disabled skills** get a neutral tile (`--muted` fill, muted-ink glyph). ⌘K labels it with the dormant `Power` + "Disabled"; SkillDetail's Disabled chip already does.
- Never on the frame and never as a section icon: the rail, onboarding's overview cards, and the Usage panel list keep an ink `BrainCircuit` (the Channel Rule).

### Table (the ledger's spine)

- **Row height:** 40px; **cell padding:** 8/12px; `table-fixed` with Name/Source fixed-width and Description filling the remainder — no horizontal scroll, no variable row height.
- **Hover / selection:** one shared, absolutely-positioned highlight box tracks the hovered row's position via a spring transition (stiffness 500, damping 40) rather than each row repainting its own background — full-bleed and unrounded, matching the flat/bordered elevation stance.
- **Keyboard:** `↓`/`↑` moves selection, `Enter`/`Space` opens the file viewer; the focus ring is the same shared `--ring` token, applied inset. Back returns focus to the row that was opened.

### Rail (section switcher)

- 48px wide, icon-only, `Tooltip`-labeled (`AppRail.tsx`), 32px square targets, rounded-md, sitting left of everything else behind a single rule-line border — no shadow, per the Ledger-Lies-Flat Rule. Three sections today: Skills (`BrainCircuit`), Plugins (`Blocks` — the same plugin mark the source badge uses; `BrainCircuit` stands in for Skills because `Blocks` on a non-plugin section would collide with that meaning), and Usage (`BarChart3` — a retrospective over the user's own activity, not an inventory).
- **Active state is ink-fill, not lime:** `Frame Muted` background (`--frame-muted`, which the rail's `bg-muted` resolves to through `frame-surface`) + `Ledger Ink` icon color, inactive items sit at `Ink, Muted` with the standard hover treatment. The rail switches which _section_ is showing, not which item within a section is selected — that distinction is what the Sidebar's own lime-filter nav still owns, and is why the rail deliberately sits outside the One Stamp Rule's scope rather than adding a second lime instance.
- **Footer controls** (`mt-auto`): a Settings gear (opens the Settings dialog; also `Cmd+,`), using the same 32px muted-ink target and hover treatment as the section icons — no lime, no fill. Appearance is configured via the three-way Light/Dark/**System** segmented control inside the Settings dialog.
- **Update dot:** when an update is ready (Windows) or available (macOS), a 6px info-tone (`bg-info`) dot sits in the gear's top-right corner, `pointer-events-none` so the target is unchanged, and the tooltip/aria-label become "Settings · Update ready" / "Settings · Update available". Info, because it is the same "update available" signal as the plugin update pill; never lime, since it isn't the active thing on screen. Like the budget dot, it's an ambient indicator labeled by its tooltip rather than paired with an icon (Tones-Aren't-The-Stamp).

### Settings (dialog)

- Modal `Dialog` (`SettingsDialog.tsx`), opened by the rail gear or `Cmd+,` — not a third rail section. Built on the same vendored `Dialog` primitives and `Button variant="outline" size="sm"` as `ManageFoldersDialog`. Single column, sections separated by 1px `border-t` rule-lines per the Ledger-Lies-Flat Rule; floats above the page so it (via the primitive) may cast a shadow.
- v1 sections: **Appearance** (segmented Light | Dark | System control) · **Index** ("Rescan now") · **Project folders** ("Manage…", which closes Settings and opens `ManageFoldersDialog`, where revoking is two-step: the row turns into an inline confirm naming how many projects lose access, with "Keep some folders…" to re-pick children instead; picks already covered by a grant are listed in a muted notice, not an error) · **Updates** (status line; one outline action: "Check now", or "Restart to update" on Windows once downloaded, or "Download" on macOS plus a select-all `brew upgrade --cask megatron` line; a "Check for updates automatically" switch drawn in ink) · **About** (`Megatron v{version}` in Geist Mono + "Show welcome" and "Reveal data folder" text buttons).
- The segmented control's active item is **ink-fill** (`bg-muted text-foreground`), mirroring the rail's active-section treatment — deliberately not lime, per the One Stamp Rule. `role="radiogroup"` with `aria-checked` on each option.

### Onboarding (dialog)

- A three-step modal over the live app (`components/onboarding/`): a brief of what Megatron does and doesn't do, an overview of Skills / Plugins / Usage with the user's own counts, and folder access. It shows when no folder is granted and the flag in `preferences.json` is unset. Every exit (finish, Skip, Esc, close) sets the flag. Clicking outside does nothing. Settings › About › "Show welcome" replays it.
- **Departs from the ledger, user-authorised and scoped to this dialog:**
  - Step headlines are 24px/600, the one place above the No-Hero-Type cap besides the Usage Stat.
  - Steps slide and crossfade on springs, direction-aware, between steps; the shared dialog enter opens it.
  - The dialog's height animates to each step.
  - Facts, cards and folder rows stagger in.
  - Counts tick up as the scan reports.
  - Granted rows pop a check.
  - The progress dots stretch into a pill on the active step.
- **Kept:**
  - Geist and the theme tokens in both themes.
  - Lime on exactly one CTA at a time: Next, then "Choose folders…" until something is granted, then "Open Megatron".
  - Tones per the Tones-Aren't-The-Stamp Rule: the Skills attention count carries the lint icon and tone of its worst status, the Plugins update count the info `ArrowUpCircle`, and a granted folder a success check. Count text stays muted ink, and the skipped-grant `Info` notice stays muted, since it is a neutral note, not an update.
  - Overview card icons are section icons, like the rail's, so they stay ink and never take entity hues.
  - No gradients, glows or animated backgrounds.
  - Every `motion` use guards `useReducedMotion()`. With reduced motion, steps become opacity-only and counts show their final value.
  - Focus moves to each step's heading on mount.
  - ←/→ change steps, and Enter advances the two reading steps.
- **Reactive by design:** the overview and folder list read the same query caches the app polls during the first scan, so they fill in live. A count that settles at zero drops its numeral and keeps only the card's line. With no Claude Code data at all, the overview becomes a "No Claude Code data found" state listing the likely causes, with a Rescan button.

### Sidebar Navigation

- 32px items, rounded-md, icon + label. The active item is the One Stamp Rule's other live application — lime fill, never more than one item lit at a time. Nested project/plugin sublists indent under a border-left rule-line rather than a background change, and expand/collapse with a 0.15s ease-out height animation.
- Skills and Plugins share a Projects tree that mirrors the folder structure. Real rows are granted folders, repositories, and paths with cached entries, nested at Git repository boundaries. One rule groups every sibling set: a folder that is neither granted nor a repository becomes a row only when it holds two or more rows (no status, no count of its own, so no “This folder”), and otherwise merges into its single child's label (`me/dotfiles`). Runs of shared folders compact into one row (`source/repos`), as in VS Code's compact folders. Inside a row, labels show the full path relative to it. Roots are measured from the home folder when under it, otherwise from the drive, share, or filesystem root; the folders above a root stay hidden, so a lone root shows only its name. Generated folder rows with no real ancestor start expanded; everything else starts collapsed. Siblings sort in natural order (`repo2` before `repo10`), ignoring case.
- Granted folders and ancestor repositories show aggregate counts; selecting a label opens its children and selects all descendants, while the separate chevron only expands or collapses. “This repo” selects a repository's own entries, including zero; grouping folders with direct entries offer “This folder.” Rows with no entries fold behind one trailing “N without skills” / “N without plugins” row per sibling set, unless they are a grant, carry a warning, are an ancestor of either, or hold the current selection; the fold row expands but is never selected. An empty Git repository nested inside another (a clone or submodule with no Claude Code content) is omitted entirely. A selection whose row disappears (revoked, rescanned, regrouped) moves to the deepest remaining row containing it, else the only row inside it, else all projects.
- Project names everywhere (sidebar, headings, tables, details, search, Usage, activity) are name first: parent folders are added only to names that clash, ignoring case, one at a time, falling back to the full path. Display casing is preserved and separators are `/`. Tree roots follow the same rule among themselves (`Desktop/api` beside `work/api`). The parent-folder prefix is dimmed and truncates before the name, so the name stays readable: muted ink on the frame, paper, and cards, lime-foreground at 70% on the selected fill, both at least 4.5:1. Idle sidebar rows are already muted ink, so their prefix only separates on hover and selection. Full paths remain available on hover. Existing pills retain their styling and placement. Invocation working directories below a repository use its name; nested repositories use their own name. Unavailable repositories retain cached counts and pair an alert icon with an explanatory tooltip and selected-view notice. Hover glides, keyboard focus, reduced motion, and expansion state across section switches are preserved.
- Not built, with revisit triggers: OS-localized folder names and iCloud Drive display names (need a native addon and break path search; revisit if users report raw `Mobile Documents` rows). A sidebar search box (the Layout decision against one stands; revisit when real trees routinely run past a few screens). Virtualizing the tree (revisit when a real tree passes about 1,000 rows). Persisting expansion across launches (revisit if users report re-expanding the same rows every launch).
- Plugin inventory rows represent one plugin identity per repository (project and local installs combined), with User entries separate. Aggregate tables show Repository; scoped details and actions use only the selected repository. Global usage totals are labeled “Uses (all projects).”

### Inputs

- 36px height, rounded-md, 1px rule-line border, transparent background (a subtle input tint in dark mode). Focus swaps the border to `--ring` and adds the shared 3px ring — identical focus language to every other interactive element.

### Loading, Empty & Error States

- **Loading:** skeleton placeholders matching the final table/panel shape — never a generic spinner.
- **Empty:** one large `ink-muted` icon (e.g. `FolderOpen`), centered, above a short heading and one line of body text; closes with a single CTA when the state is actionable, styled per the Lime override button above.
- **Error:** inline, near the affected row or section — not a full-page state.

### Transitions

Timings live in `lib/transitions.ts`; dialog tuning lives in `main.css`.

- **Arrival only.** Departures are instant: no exit animations on screens or dialogs. The old screen leaves in the same commit the new one mounts.
- **Screens** (`ScreenTransition`): a section switch rises 4px for both sidebar and content; going deeper (list → detail → files) enters 16px from the right; Back enters 16px from the left; 150ms ease-out. The first paint never animates.
- **Title glide** (`GlideTitle`): the name glides from a Skills row into its detail, detail → files, files → detail, and from a Plugins row into its detail. Position only, so the size snaps to the destination and the text never distorts, on the row-glide spring (500/40). Destination headers render from the list row, so the glide can start before the query returns.
  - Back to a list doesn't glide. The row sits inside the table's scroll container, which would clip the title under the title strip, and the title would cross other rows' names. Back still focuses the opened row and scrolls it into view.
- **Data settle:** a 150ms opacity settle on pending → data only, never on a refetch or poll; cached data shows at once. Rows present when a list mounts arrive with it; rows added later fade and rise 4px.
- **Dialogs and ⌘K:** tw-animate-css, tuned to 0.98 → 1 plus fade over 150ms, with the overlay fading alongside. They close instantly. Onboarding opens with it, and its step slides run between steps.
- **Tooltips:** shadcn's stock fade, zoom-95 and 8px slide, in and out.
- **Reduced motion:** opacity only. Screens fade without travel, titles don't glide, and dialogs and tooltips keep only their fades. The settle is unchanged.

### File Tree (signature component)

The skill file viewer's file tree makes fuller use of motion than most surfaces today: per-row icon rotation on expand/collapse, a glide-highlight matching the table's (inset, rounded-pill shape rather than the table's full-bleed), and a fade-in for rows that mount after the viewer opens (an expanded folder, a scroll) — needed once virtualization ruled out a `height: auto` whole-subtree animation. Rows present when the viewer opens arrive with its enter. Follows the standard `role="tree"`/`treeitem` keyboard pattern with roving `tabIndex`.

### Charts (Usage)

- **Hand-rolled** in `components/usage/`, drawn in chart ink per the Monochrome-Chart-Ink Rule. A part-to-whole bar has no track: the whole bar is data.
- **Motion:** bars rise from the baseline, staggered, on enter. A window switch is the signature moment: bars interpolate to their new heights and stat numerals roll to the new value — numerals roll on a switch only, never on mount. Panel switches crossfade (150ms, opacity only). Hover dims siblings; it never recolors.

### Named Rules

**The Hand-Rolled-Charts Rule.** No charting library. Recharts, visx, and Chart.js ship visual opinions (tooltip chrome, axis styling, entrance animations) that cost as much to override as clean bars cost to build, and add bundle weight to an Electron app. Reopen only if a line chart ships, and then evaluate `d3-shape` alone or `uPlot`, never a full framework.
**The Motion-Earns-Its-Keep Rule.** `motion` is available anywhere a state change needs feedback CSS can't express — it isn't fixed to today's call sites (table, file-tree, and sidebar glides; Usage charts; screen enters, the title glide, and the data settle), and can grow into new surfaces as they earn it. CSS stays the default everywhere else; dialogs and tooltips are CSS keyframes (tw-animate-css). Every `motion` use guards `useReducedMotion()` explicitly, since JS-driven animation doesn't get `prefers-reduced-motion` for free. The one exception is an opacity-only fade (the data settle), which reduced motion keeps.

## App Icon

The icon is a white (`#f5f5f5`) magnet with acid-lime pole caps, pulling in a lime 12-ray sparkle, on a `#111111` tile. The magnet is Megatron, the collector. The sparkle is the skill being pulled in.

- **Masters:** `build/icon-source/icon.svg` holds the full art and `icon-small.svg` the simplified art. `npm run build:icons` generates every committed output from them:
  - `build/icon.ico` and `resources/icon.ico` (the same bytes)
  - `resources/icon.png` at 512 px
  - the Icon Composer layers in `build/icon-source/layers/`

  To change the icon, edit a master, rerun the script, and then rebuild `build/icon.icon` from the new layers. The committed `.icon` also carries per-layer nudges made by hand in Icon Composer (`translation-in-points` in its `icon.json`), which set the macOS magnet about 2.5% left and lower than the masters and the `.ico`. That shipped version is the approved one: a rebuild from fresh layers drops the nudges unless they're reapplied.

- **Sparkle:** 12 even rays at 30° with round caps, ray length 68, stroke 13.3 on the 816 canvas. It's centered at (557.7, 221.5), on the perpendicular bisector of the two nearest cap corners.
- **Color:** the caps and the sparkle use `--accent-lime` (`#e4f222`) itself, the app's own token. A brighter icon-only lime would hurt the app's light mode.
- **macOS:** an Icon Composer `.icon` (`build/icon.icon`) with Liquid Glass off or at minimum on every layer. The Ledger-Lies-Flat Rule applies to the icon too. electron-builder generates the `.icns` fallback for macOS before 26 from the `.icon`.
- **Windows:** the dark tile is nearly full-bleed, because Windows adds no mask or padding. The `.ico` carries 16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96 and 256 px. Windows uses the hand-tuned small sizes only at 100% scaling. From 125% up the taskbar shows the full art, scaled down.

### Building the `.icon` (Xcode 26+)

1. In Icon Composer, start a new document and set Fill to solid `#111111`. The tile is the fill, not a layer.
2. Drag in `layers/1-magnet.svg`, `2-caps.svg` and `3-sparkle.svg`. They're numbered in z-order, with the sparkle on top. Icon Composer puts all three in one group. Keep the single group: the layers don't overlap, and separate groups would bring back per-group depth shadows.
3. Turn Liquid Glass off on all three layers. On the group, set Shadow to None and turn off Specular and Translucency.
4. Check the Default, Dark, Clear and Tinted previews. The gap between the caps and the magnet must stay visible in all four.
5. Save as `build/icon.icon`.

### Named Rules

**The Equal-Gap Rule.** The sparkle sits exactly as far from one pole cap as from the other: 60 units each. If it moves or grows, both gaps move together. Rays keep their 13.3 stroke, because thicker rays fuse into a gear or a splat.

**The 30-Pixel Rule.** The sparkle appears from 30 px up. Below that, the `.ico` uses the small master: no sparkle, and caps joined to the magnet, because at taskbar size the cap gap and the sparkle blur into noise. In Clear and Tinted modes on macOS, the white and the lime collapse toward one color, so the cap gap is what keeps the poles readable. Keep it visible at every size that has one.

## Do's and Don'ts

### Do:

- **Do** keep acid lime to exactly one live instance on screen at a time — the active nav filter, or a single primary CTA.
- **Do** pair every status or state signal with an icon; never color alone.
- **Do** use rule-lines, not shadows, for on-page structure — reserve shadows for the one content sheet and for floating layers.
- **Do** keep type at or below 16px/600 — build hierarchy from position and ink/muted contrast, not size.
- **Do** cap rendered markdown prose at 72ch even though the rest of the app is fluid-width.
- **Do** reach for `motion` wherever a state change needs feedback CSS genuinely can't express — proven today in the table row, file tree, and sidebar nav glides, the Usage charts, screen enters, the title glide, and the data settle, but not limited to them.

### Don't:

- **Don't** give source tiers (global/project/plugin) their own color family — icon + neutral badge carries that meaning; color stays reserved for the stamp, status tones, entity identity, and model series.
- **Don't** introduce a second accent color or a gradient — the ledger has exactly one stamp. _(Entity and model hues are not accents: they carry identity, not emphasis, and stay in their channels — see the Channel Rule.)_
- **Don't** add a hue outside the four roles, or one that hasn't been validated — see the Every-Hue-Has-A-Role Rule.
- **Don't** let `motion` become decorative — reach for it only when CSS transitions genuinely can't deliver the feedback, and always guard it with `useReducedMotion()` (an opacity-only fade excepted).
