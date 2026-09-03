---
name: Megatron
description: A read-only ledger for every Claude Code skill you have — inventoried, linted, and tracked.
colors:
  ledger-paper: "oklch(0.99 0 0)"
  ledger-ink: "oklch(0.145 0 0)"
  card: "oklch(1 0 0)"
  ink-muted: "oklch(0.556 0 0)"
  surface-muted: "oklch(0.97 0 0)"
  rule-line: "oklch(0.922 0 0)"
  focus-ring: "oklch(0.708 0 0)"
  primary-stamp: "oklch(0.205 0 0)"
  primary-stamp-foreground: "oklch(0.985 0 0)"
  acid-lime: "#e4f222"
  acid-lime-ink: "oklch(0.145 0 0)"
  flag-red: "oklch(0.577 0.245 27.325)"
  flag-amber: "oklch(0.769 0.188 70.08)"
  flag-green: "oklch(0.723 0.219 149.579)"
  disabled-flag: "oklch(0.577 0.12 27.325)"
typography:
  title:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  label-app:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label-column:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.04em"
  mono-data:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.875rem"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary-stamp}"
    textColor: "{colors.primary-stamp-foreground}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-lime:
    backgroundColor: "{colors.acid-lime}"
    textColor: "{colors.acid-lime-ink}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "32px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  nav-item-active:
    backgroundColor: "{colors.acid-lime}"
    textColor: "{colors.acid-lime-ink}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "32px"
  status-pill:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
---

# Design System: Megatron

## Overview

**Creative North Star: "The Inventory Ledger"**

Megatron reads like a well-kept ledger, not a dashboard performing busyness. Every skill gets one flat, neutral-ink row — global, project, and plugin sources sit in the same visual register, distinguished by an icon and a word, never by their own color. Density is the feature, not a compromise: a page of quiet rows is the sign that nothing needs you, and the interface stays legible precisely because it refuses to compete with itself for attention.

Exactly one stamp of color breaks that quiet: acid lime, reserved for the single active thing on screen — the selected sidebar filter, or a primary call-to-action. A separate, purely functional palette of flags reports lint state (red/amber/green), disabled state (a quieter, desaturated red), and the sidebar's context-budget status (the same red/amber/green, reused rather than duplicated) — and never borrows the stamp's job or vice versa. Everything else — borders, hover states, focus rings — is drawn in ink and rule-lines, the ledger's native materials.

Confirmed rejections: no drop shadows on anything at rest (shadows are reserved for genuinely floating layers), no gradients, no per-source-tier color coding, no hero-scale type anywhere in the product.

**Key Characteristics:**
- Dense, Linear-style sidebar + list/detail shell, now spanning two sections (Skills, Plugins) behind a persistent icon rail — still a utility, never a spacious admin dashboard
- One accent (acid lime), used sparingly, never as body text or a link
- Border-first, flat elevation — shadows appear only on floating layers (dropdowns, popovers, tooltips)
- Geist Sans for all UI text, Geist Mono for tabular/code-like data
- Every status signal pairs an icon with its color — never color alone

## Colors

Near-monochrome ledger ink on paper, with exactly two functional color layers on top: one accent for "this is the active line," and four status flags — three shared between lint state and the sidebar's context-budget status, one for disabled state. Nothing else in the system carries color. Built on shadcn's `new-york`/`neutral` base (`components.json`) before the ledger's own accent and flags are layered on top.

### Primary
- **Acid Lime** (`#e4f222`, same literal value in both themes): the ledger's one stamp of color. Marks the active sidebar filter-nav item and overrides the default button fill on primary CTAs (e.g. "Grant a folder to scan for skills"). Never body text, never a link — text-weight lime on a light background reads poorly, and its rarity is the point. The app rail's active section is deliberately excluded from this stamp — see the Rail entry under Components — so the One Stamp Rule's wording (`{colors.accent}` marks the *sidebar's* active filter) stays true without amendment.

### Neutral
- **Ledger Paper** (`oklch(0.99 0 0)` light / `oklch(0.145 0 0)` dark): app background. Deliberately off pure white/black in both themes.
- **Card** (`oklch(1 0 0)` light / `oklch(0.205 0 0)` dark): panels, popovers, and dialogs — one half-step off the page.
- **Ledger Ink** (`oklch(0.145 0 0)` light / `oklch(0.985 0 0)` dark): primary text and icon color.
- **Ink, Muted** (`oklch(0.556 0 0)` light / `oklch(0.708 0 0)` dark): secondary text, table column headers, captions, placeholder text.
- **Surface Muted** (`oklch(0.97 0 0)` light / `oklch(0.269 0 0)` dark): hover backgrounds, status-pill fill, secondary-button fill.
- **Rule Line** (`oklch(0.922 0 0)` light / `oklch(1 0 0 / 10%)` dark): the 1px borders that do the elevation system's work.
- **Focus Ring** (`oklch(0.708 0 0)` light / `oklch(0.556 0 0)` dark): the single keyboard-focus indicator used everywhere — no separate focus-color system.

### Status flags (functional, not decorative)
- **Flag Red** (`oklch(0.577 0.245 27.325)` light / `oklch(0.704 0.191 22.216)` dark): lint errors; also the sidebar's context-budget dot once usage is over budget.
- **Flag Amber** (`oklch(0.769 0.188 70.08)` light / `oklch(0.828 0.189 84.429)` dark): lint warnings; also the budget dot once usage is approaching budget (past 80%, `BUDGET_WARNING_THRESHOLD` in `context-budget.ts`).
- **Flag Green** (`oklch(0.723 0.219 149.579)` light / `oklch(0.792 0.209 151.711)` dark): passing lint / up to date; also the budget dot's default, comfortably-under-budget state.
- **Disabled Flag** (`oklch(0.577 0.12 27.325)` light / `oklch(0.704 0.094 22.216)` dark): a skill disabled via `skillOverrides` or a disabled plugin. Same hue as Flag Red, roughly half the chroma — deliberately quieter, so "turned off" never gets mistaken for "broken" even though a skill can be both at once (lint status and disabled state are independent facts).

### Named Rules
**The One Stamp Rule.** Acid lime marks exactly one thing at a time — the active sidebar filter, or a single primary call-to-action — and never appears as body text, a link, or a decorative fill.
**The Flags-Aren't-The-Stamp Rule.** The flag palette reports lint state, disabled state, and the sidebar's context-budget status only. It never substitutes for the lime accent, and a status is never color alone — always paired with an icon, and paired with a label wherever the flag renders as a pill (the disabled flag renders as an icon-only signal with a tooltip instead, since it lives in the table's icon tray, not the Status column). The context-budget dot is a deliberate, narrow exception: a compact, always-visible ambient indicator in the sidebar footer, paired with a tooltip label instead of an icon — not a primary status pill, where icon-pairing stays mandatory.

## Typography

**UI Font:** Geist Sans (with `ui-sans-serif, system-ui, sans-serif` fallback)
**Mono Font:** Geist Mono (with `ui-monospace, monospace` fallback), for tabular/code-like data — skill paths, version strings, plugin IDs, token counts.

**Character:** A ledger's typeface, not a marketing one — every size sits at or below 16px/600. Hierarchy comes entirely from position and ink-vs-muted contrast, never from a scale jump.

### Hierarchy
- **Title** (600, 16px, 1.3 line-height): the skill file viewer's detail-panel title — the largest text anywhere in the product.
- **Label, App** (600, 14px): the sidebar wordmark ("Megatron").
- **Body** (400, 13px): table cells, descriptions, and general UI text.
- **Label, Column** (500, 11px, uppercase, ink-muted, 0.04em tracking): table column headers.
- **Mono Data** (400, 12px, tabular-nums): file paths, plugin IDs, version strings — Geist Mono.

**Rendered markdown** (inside the skill file viewer) gets its own descending scale rather than reusing UI sizes: h1 20px/600, h2 16px/600, h3 14px/600, h4–h6 share the Body size — all Geist Sans; fenced and inline code stay at the Mono Data step. Prose caps at `72ch`, the one place in the app that isn't fluid-width.

### Named Rules
**The No-Hero-Type Rule.** Nothing in the ledger exceeds 16px/600. If something needs to stand out, move it up in position or contrast — never up in size.

## Layout

A dense, Linear-style sidebar + list/detail shell, not a spacious admin dashboard or a marketing page: a persistent 48px icon rail for switching sections (Skills, Plugins), a 220px sidebar nested inside the Skills section only, a fluid table pane that fills the rest of the window, and a fullscreen file viewer that replaces (not layers over) the table when a row opens. The Plugins section runs full-width with no sidebar of its own. A 40px full-width drag strip sits above all panes for window-dragging under the `hiddenInset` titlebar.

Row height is fixed at 40px with 8/12px cell padding. The file viewer's tree pane defaults to 240px and is user-resizable between 200–480px. Content max-width is `none` everywhere — fluid — except rendered markdown prose, which caps at `72ch` for readability. The command palette (`⌘K`) is a modal overlay, not primary navigation; it does not reopen the "no search box in the sidebar" decision.

## Elevation & Depth

Border-first. Nothing at rest casts a shadow — a 1px rule-line divides the sidebar, the file viewer's header/tree, and every other on-page seam. Shadows are reserved for layers that are genuinely floating above the page: dropdowns, popovers, tooltips, the command palette. These use shadcn's default shadow scale, unmodified.

### Named Rules
**The Ledger-Lies-Flat Rule.** If it's part of the page, it's flat and bordered. If it floats above the page, it may cast a shadow — and only then.

## Shapes

A single radius scale rooted at 10px (`--radius: 0.625rem`), applied identically regardless of skill source (global/project/plugin — no tier gets its own geometry): `sm` (6px) for the tightest inner controls, `md` (8px) — the default — for buttons, inputs, and nav items, `lg` (10px) for cards and dialogs, `xl` (14px) for the outer app frame. Pills (badges, status chips, the context-budget progress track) use `full` (9999px). No borders on filled surfaces beyond the 1px rule-line already covered under Elevation.

## Components

**Lucide** (`lucide-react`) for every icon in the product — consistent stroke, geometric, monochrome-by-default; matches shadcn's own blocks and the Linear-grade quality bar the shell borrows from. Icon-only or color-alone is never used for a status or identity signal — see the Flags-Aren't-The-Stamp Rule. The one sanctioned non-Lucide mark is the rail's light↔dark toggle (`ThemeToggle.tsx`): a bespoke inline SVG whose sun-ray retract and clip-path crescent are adapted from Skiper UI's skiper4, `motion`-driven and `useReducedMotion`-guarded per the Motion-Earns-Its-Keep Rule, rendered bare in `currentColor` at the same `size-4` as a Lucide icon so it reads as one of the family.

### Buttons
- **Shape:** rounded-md (8px).
- **Primary:** `{colors.primary-stamp}` fill, `{colors.primary-stamp-foreground}` text — the default "open/confirm" action.
- **Lime override:** primary CTAs that need to stand out (e.g. "Grant a folder to scan for skills") swap in acid lime directly on the button rather than through a separate component variant — a targeted override, not a new button kind, per the One Stamp Rule.
- **Outline / Ghost / Secondary / Destructive:** standard shadcn treatment. Outline for de-emphasized actions; destructive is seeded for a future mutating action (v1 is read-only, so none is live yet).
- **Hover / Focus:** every hover state dims to 90% of its own fill — never a separate token. Focus uses the shared `{colors.focus-ring}` at a 3px, 50%-alpha ring.

### Badges / Chips
- **Source badges** (`SourceBadge`): outline variant, icon + label always paired — `Globe` (global), `FolderGit2` (project), `Blocks` (plugin). No per-tier color; a trailing `Lock` icon marks plugin skills as read-only, with a tooltip on hover.
- **Status pills** (`LintStatusBadge`): rounded-full, muted fill, bordered. The only colored element is the icon (flag-red/amber/green) — the label text always stays ledger-ink, so a status is legible even to someone who can't distinguish the flag colors.

### Table (the ledger's spine)
- **Row height:** 40px; **cell padding:** 8/12px; `table-fixed` with Name/Source fixed-width and Description filling the remainder — no horizontal scroll, no variable row height.
- **Hover / selection:** one shared, absolutely-positioned highlight box tracks the hovered row's position via a spring transition (stiffness 500, damping 40) rather than each row repainting its own background — full-bleed and unrounded, matching the flat/bordered elevation stance.
- **Keyboard:** `↓`/`↑` moves selection, `Enter`/`Space` opens the fullscreen file viewer; the focus ring is the same shared `{colors.focus-ring}` token, applied inset.

### Rail (section switcher)
- 48px wide, icon-only, `Tooltip`-labeled (`AppRail.tsx`), 32px square targets, rounded-md, sitting left of everything else behind a single rule-line border — no shadow, per the Ledger-Lies-Flat Rule. Two sections today: Skills (`BrainCircuit`) and Plugins (`Blocks` — the same plugin mark the source badge uses; `BrainCircuit` stands in for Skills because `Blocks` on a non-plugin section would collide with that meaning).
- **Active state is ink-fill, not lime:** `Surface Muted` background + `Ledger Ink` icon color, inactive items sit at `Ink, Muted` with the standard hover treatment. The rail switches which *section* is showing, not which item within a section is selected — that distinction is what the Sidebar's own lime-filter nav still owns, and is why the rail deliberately sits outside the One Stamp Rule's scope rather than adding a second lime instance.
- **Footer controls** (`mt-auto`): a Settings gear (opens the Settings dialog; also `Cmd+,`) above the light↔dark `ThemeToggle`. Both use the same 32px muted-ink target and hover treatment as the section icons — no lime, no fill. Appearance is a one-click toggle here, not a menu; the three-way Light/Dark/**System** choice lives in Settings, and clicking the toggle while in System mode sets the explicit opposite of what's currently showing.

### Settings (dialog)
- Modal `Dialog` (`SettingsDialog.tsx`), opened by the rail gear or `Cmd+,` — not a third rail section. Built on the same vendored `Dialog` primitives and `Button variant="outline" size="sm"` as `ManageFoldersDialog`. Single column, sections separated by 1px `border-t` rule-lines per the Ledger-Lies-Flat Rule; floats above the page so it (via the primitive) may cast a shadow.
- v1 sections: **Appearance** (segmented Light | Dark | System control) · **Index** ("Rescan now") · **Project folders** ("Manage…", which closes Settings and opens `ManageFoldersDialog`) · **About** (`Megatron v{version}` in Geist Mono + a "Reveal data folder" text button).
- The segmented control's active item is **ink-fill** (`bg-muted text-foreground`), mirroring the rail's active-section treatment — deliberately not lime, per the One Stamp Rule. `role="radiogroup"` with `aria-checked` on each option.

### Sidebar Navigation
- 32px items, rounded-md, icon + label. The active item is the One Stamp Rule's other live application — lime fill, never more than one item lit at a time. Nested project/plugin sublists indent under a border-left rule-line rather than a background change, and expand/collapse with a 0.15s ease-out height animation.

### Inputs
- 36px height, rounded-md, 1px rule-line border, transparent background (a subtle input tint in dark mode). Focus swaps the border to `{colors.focus-ring}` and adds the shared 3px ring — identical focus language to every other interactive element.

### Loading, Empty & Error States
- **Loading:** skeleton placeholders matching the final table/panel shape — never a generic spinner.
- **Empty:** one large `ink-muted` icon (e.g. `FolderOpen`), centered, above a short heading and one line of body text; closes with a single CTA when the state is actionable, styled per the Lime override button above.
- **Error:** inline, near the affected row or section — not a full-page state.

### File Tree (signature component)
The skill file viewer's file tree makes fuller use of motion than most surfaces today: per-row icon rotation on expand/collapse, a glide-highlight matching the table's (inset, rounded-pill shape rather than the table's full-bleed), and a fade-in on mount — needed once virtualization ruled out a `height: auto` whole-subtree animation. Follows the standard `role="tree"`/`treeitem` keyboard pattern with roving `tabIndex`.

### Named Rules
**The Motion-Earns-Its-Keep Rule.** `motion` is available anywhere a state change needs feedback CSS can't express — it isn't fixed to today's three call sites (table row glide, file-tree glide, sidebar nav glide/expand), and can grow into new surfaces as they earn it. CSS transitions stay the default everywhere else, and every `motion` use guards `useReducedMotion()` explicitly, since JS-driven animation doesn't get `prefers-reduced-motion` for free.

## Do's and Don'ts

### Do:
- **Do** keep acid lime to exactly one live instance on screen at a time — the active nav filter, or a single primary CTA.
- **Do** pair every status or state signal with an icon; never color alone.
- **Do** use rule-lines, not shadows, for on-page structure — reserve shadows for floating layers only.
- **Do** keep type at or below 16px/600 — build hierarchy from position and ink/muted contrast, not size.
- **Do** cap rendered markdown prose at 72ch even though the rest of the app is fluid-width.
- **Do** reach for `motion` wherever a state change needs feedback CSS genuinely can't express — proven today in the table row, file tree, and sidebar nav glides, but not limited to them.

### Don't:
- **Don't** give source tiers (global/project/plugin) their own color family — icon + neutral badge carries that meaning; color stays reserved for lint status, disabled state, and the lime accent.
- **Don't** introduce a second accent color or a gradient — the ledger has exactly one stamp.
- **Don't** let `motion` become decorative — reach for it only when CSS transitions genuinely can't deliver the feedback, and always guard it with `useReducedMotion()`.
