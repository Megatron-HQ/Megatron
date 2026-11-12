# Design System: Megatron

## Overview

**Creative North Star: "The Inventory Ledger"**

Megatron reads like a well-kept ledger, not a dashboard performing busyness. Every skill gets one flat, neutral-ink row: global, project, and plugin sources sit in the same visual register, told apart by an icon and a word, never by color. Density is the feature. A page of quiet rows means nothing needs you.

Two surfaces depart from the ledger, each user-authorised and scoped to itself: **Usage**, a retrospective rather than an inventory (the Usage Stat numeral under Typography, hand-rolled animated charts under Components), and **Onboarding**, the first-run dialog (under Components). Usage's chart colors are not departures; they belong to the one color system below.

## Colors

Warm ledger ink on warm paper, with four color roles on top, each on its own channel: the lime stamp for "this is the active line," five status tones for state, four entity hues for what a thing is, and four model hues for Usage chart series. Nothing else carries color. Fourteen hues can't all stay colorblind-distinct from each other, so roles never share a surface: channel separation, not hue distance, keeps them apart (see Validation and the Channel Rule). Built on shadcn's `new-york`/`neutral` base. Every token is defined in `src/renderer/src/assets/main.css`, light values in `:root` and dark in `.dark`.

### Primary

- **Acid Lime** (`--accent-lime`, text on it `--accent-lime-foreground`; the same literal value in both themes): the ledger's one stamp of color. Marks the active sidebar filter and the fill of a primary CTA. Never body text, never a link: lime text on a light background reads poorly, and its rarity is the point. shadcn's own `--accent` is a neutral hover fill, not the stamp.

### Neutral (Warm Paper)

Every neutral carries one warm tint: OKLCH C≈0.011 at h82 in light, C≈0.008 at h75 in dark. Surfaces take the full tint; text and ink fills take half, so ink stays sharp; light cards and popovers stay pure white so they lift off the paper.

The window is a flat frame around one raised content sheet (see Layout). The two read apart on lightness alone (sheet:frame 1.10:1 light, 1.09:1 dark), so the sheet's edge never depends on its shadow rendering.

- **Frame** (`--frame`): the titlebar strip, rail, sidebars, and the gutter around the sheet. One step darker than the sheet in both themes.
- **Ledger Paper** (`--background`): the content sheet. Off pure white/black in both themes.
- **Card** (`--card`, `--popover`): panels, popovers, and dialogs.
- **Ledger Ink** (`--foreground`): primary text and icons.
- **Primary Stamp** (`--primary`): the default button fill.
- **Ink, Muted** (`--muted-foreground`): secondary text, column headers, captions, placeholders.
- **Surface Muted** (`--muted`, `--secondary`, `--accent`): hover fills, the status-pill fill, secondary buttons.
- **Frame Muted** (`--frame-muted`): the same fills on the frame. `--muted` and `--accent` nearly vanish on the light frame (1.05:1), so the `frame-surface` utility on the rail-and-sidebar wrapper rescopes both to this step (1.09:1), the darkest that keeps `--muted-foreground` count-pill text at 4.5:1. Dark reuses `--muted`.
- **Rule Line** (`--border`, `--input`): the 1px borders that do the elevation system's work. A solid warm step, never alpha white, so a rule reads the same over every surface it crosses.
- **Focus Ring** (`--ring`): the one keyboard-focus indicator everywhere.

### Status tones (functional, not decorative)

Five tones carry every state. States share tones rather than each taking a hue, so a new state picks the closest tone and gets its own icon. A sixth tone is a design decision.

- **Danger** (`--destructive`): lint errors, the context-budget dot over budget, inline errors, destructive actions (plugin uninstall).
- **Warning** (`--warning`): lint warnings, the budget dot past 80% (`BUDGET_WARNING_THRESHOLD` in `context-budget.ts`), Usage data-quality caveats. On the frame it takes a darker step, `--frame-warning`, because the sheet's step is 2.85:1 on the light frame. `frame-surface` swaps it in, so it's the same tone rather than a sixth, and the dot still writes `bg-warning`.
- **Success** (`--success`): passing lint, up to date, the budget dot's default state, a granted folder in onboarding.
- **Info** (`--info`): update available, and nothing else: the plugin update pill, PluginDetail's Update button, onboarding's update count, the rail gear's dot. Neutral notices (e.g. a folder already covered by a grant) stay muted ink even when they use the `Info` icon.
- **Dormant** (`--dormant`): present but inactive: a skill disabled via `skillOverrides` or a disabled plugin (`Power`), and a stale skill that hasn't run in the last 30 days of recorded sessions (`Clock`). A muted violet rather than a quieter red, so "turned off" never reads as "broken"; a skill can be both, since lint status and disabled state are independent.

### Chart ink (Usage)

- **`--usage-bar`**: the default bar fill. Every bar full ink, kept thin, with air between.
- **`--usage-bar-quiet`**: opt-in per chart, only where one value must be named and bar height doesn't carry it; the emphasized bar stays full ink and the rest go quiet. Also the "Other" fold for an unmapped model family.
- **Ordinal scales are ink ramps, never hue:** the punchcard's quantile opacity steps of `--usage-bar`, the contribution calendar's `--contribution-1..4` (usage ink mixed into the paper), and the effort mix's `color-mix` steps, with "not recorded" off the scale as `.usage-fill-unrecorded` stripes.

### Model series (functional, not decorative)

Four categorical hues, `--usage-series-1/2/3/4` (Sonnet, Opus, Haiku, Fable), carry series identity in the Usage view only, and only where a chart splits by model: ≤4 family hues, ever. Assigned by family in a fixed order, never by rank. Versions within a family are tints of its hue, newest full and older stepped toward the paper. Always direct-labeled: the hue rides a legend dot or a mark beside its own text label. A fifth family folds to `--usage-bar-quiet` ("Other"), never a generated hue. Lime is excluded: it's the stamp, and a near-yellow fails CVD beside the Opus orange.

### Entity identity

Four fixed hues name what a thing is: `--entity-skills` (violet), `--entity-mcp` (cyan), `--entity-memory` (magenta), `--entity-agents` (orange). Plugins, hooks, commands, and LSP servers stay neutral. Glyph tiles read `--entity-*-glyph` steps: light MCP and Agents are darkened there (`#0a86aa`, `#c26402`) because their base hues fall under 3:1 on their own tint; dark maps every step to its base, and the base hues stay for Resident Tax. Today the hues mark the entity glyph (Components) and Resident Tax's composition bar and ledger dots, where MCP tools and MCP server instructions share the MCP hue, deferred items use an outlined dot, and system overhead, unknown categories, the autocompact buffer, and free space stay neutral. Entity hues never color text, numbers, row backgrounds, selection, drill-in dialogs, or section icons, never change with rank or refresh, and never appear on the frame.

### Validation

Verified 2026-11-11 with the `dataviz` skill's `validate_palette.js`, against each theme's `--background` sheet, against `--frame` for the tones and neutrals the frame carries, and against `--popover` and the `--accent` selected-row fill for the entity glyph tiles.

- **Entities, all pairs** (marks can sit side by side in any order): worst colorblind ΔE 13.9 light / 11.8 dark; worst normal-vision ΔE 18.2 / 15.2. Dark steps run up to L 0.70 so marks clear 3:1; MCP's dark step (L 0.701) sits just past the validator's dark lightness band on purpose, its one flagged check.
- **Entity glyph tiles** (the glyph against a 10% tint of its own hue, over the surface beneath): Skills 5.15 on the popover / 5.06 on the sheet / 4.39 on a selected row light, 3.48 / 3.81 / 3.24 dark; Memory 5.19 / 5.14 / 4.44 light, 3.42 / 3.73 / 3.16 dark. The base light Agents dropped to 2.69 on a selected row and light MCP to 2.93 / 2.88 / 2.51, so each renders a darker glyph step: MCP `#0a86aa` (L 0.639→0.579) 3.71 / 3.65 / 3.18, Agents `#c26402` (L 0.641→0.601) 3.64 / 3.58 / 3.10. The light glyph set, all pairs: worst colorblind ΔE 9.4 (MCP ↔ Memory, deutan), worst normal-vision ΔE 16.8. Dark tiles use the base steps. A stronger tint costs contrast: at 16%, dark Skills on a selected row falls to 3.02.
- **Tones on the paper** (icons clear 3:1): light danger 5.77, warning 3.13, success 3.36, info 4.75, dormant 4.02; dark 5.66, 10.0, 9.68, 7.27, 6.90.
- **Tones on the frame:** light danger 5.25, warning 3.14 (the `--frame-warning` step), success 3.06, info 4.33, dormant 3.66; dark 6.17, 10.9, 10.6, 7.93, 7.52. The frame step keeps its neighbors apart: warning ↔ danger ΔE 10.9 colorblind (deutan) / 16.0 normal, warning ↔ success 8.8 (protan) / 21.6.
- **Frame and sheet:** sheet:frame 1.10:1 light / 1.09:1 dark. Light `--frame-muted` on the frame 1.09:1; `--muted-foreground` on `--frame-muted` 4.53:1 and on the frame 4.96:1.
- **Model series, all pairs** (legend order isn't chart order): worst colorblind ΔE 9.2 light / 8.2 dark; worst normal-vision ΔE 16.3 / 16.9. Haiku green is 2.77:1 on the light paper, below 3:1; the required direct labels are its relief.
- **Across roles:** the closest pair is Agents ↔ warning: ΔE 2.2 deutan / 3.4 normal against the sheet's step (light), and ΔE 0.3 deutan / 0.9 protan / 2.3 normal against `--frame-warning`, which deuteranopes can't tell apart at all. Only the Channel Rule keeps them from meeting. The light Agents glyph step sits further off: ΔE 6.2 deutan / 6.5 normal against warning, 3.7 / 4.1 against `--frame-warning`; the MCP glyph step against info is 9.5 protan / 9.6 normal.

### Named Rules

**The One Stamp Rule.** Acid lime marks exactly one thing at a time (the active sidebar filter or a single primary CTA) and never appears as body text, a link, or a decorative fill. The rail's active section and the Settings segmented control use ink-fill instead: they switch what's showing, they don't select an item.
**The Tones-Aren't-The-Stamp Rule.** Tones report state only and never substitute for lime. A status is never color alone: it pairs with an icon, and with a label wherever it renders as a pill. The narrow exceptions are labeled by a tooltip: the icon-only dormant `Power` and `Clock` in the table's icon tray, and two ambient dots with no icon, the context-budget dot in the sidebar footer and the update dot on the rail gear.
**The Channel Rule.** Each color role keeps its hues in its own channel. Entity hues: entity marks only, never on the frame (rail, sidebars, titlebar strip), where `--frame-warning` is indistinguishable from Agents for deuteranopes. Model hues: Usage chart marks that split by model, direct-labeled, only inside `components/usage/`. Tones: status pills and icons, the two ambient dots, inline alerts and caveats, destructive actions. No hue ever means "active" (that's the stamp), a source tier, or a UI accent.
**The Monochrome-Chart-Ink Rule.** Usage charts draw magnitude and emphasis in `--usage-bar` ink alone. Color in a chart only ever means identity (model or entity), never a category. A tinted "data" color was considered and rejected: it would be the second accent the ledger forbids.
**The Every-Hue-Has-A-Role Rule.** A new hue joins exactly one role. Before it ships, re-run the validator against that role's hues (all pairs, `--pairs all`), check its closest pair in every other role, and record the numbers under Validation.

## Typography

**UI:** Geist Sans (`ui-sans-serif, system-ui, sans-serif` fallback). **Mono:** Geist Mono (`ui-monospace, monospace` fallback), for tabular and code-like data: paths, version strings, plugin IDs, token counts. Hierarchy comes from position and ink-vs-muted contrast, never a scale jump.

- **Title** (600, 16px, 1.3 line-height): the file viewer's detail title, the largest text in the product.
- **Label, App** (600, 14px): the sidebar wordmark.
- **Body** (400, 13px): table cells, descriptions, general UI.
- **Label, Column** (500, 11px, uppercase, ink-muted, 0.04em tracking): column headers and chart labels.
- **Mono Data** (400, 12px Geist Mono, tabular-nums).
- **Section Header** (600, 13px, ledger ink): Usage panel and section headers; charts inside take Label, Column.
- **Usage Stat** (`.text-usage-stat`: 500, 30px Geist Mono, tabular-nums, −0.01em tracking): the three or four primary stat numerals in a Usage panel, and nothing else.

Rendered markdown in the file viewer has its own scale: h1 20px, h2 16px, h3 14px (all 600), h4–h6 at Body; code stays at Mono Data. Prose caps at `72ch`.

### Named Rules

**The No-Hero-Type Rule.** Nothing in the ledger exceeds 16px/600; to make something stand out, move it up in position or contrast, never in size. The Usage Stat is one exception: a retrospective's headline figures are a different surface class, and Geist Mono keeps it inside "Mono for data", so only size departs. Onboarding's step headlines are the other.

## Layout

A dense, Linear-style sidebar + list/detail shell, not a spacious admin dashboard. The window is a flat **frame** holding one raised **content sheet**. The frame carries a full-width top strip (the macOS drag region under the `hiddenInset` titlebar; a thin band under Windows' native titlebar), a persistent icon rail for switching sections (Skills, Plugins, Usage), and a secondary sidebar inside each section. The sheet fills the rest with the `xl` radius, a rule-line border, and `--sheet-shadow`; its top edge is the visible content edge, so no separate titlebar bar is drawn. The scan banner, when shown, is the sheet's first row. The file viewer replaces the table when a row opens rather than layering over it. Usage renders one panel at a time in the same shell.

Content is fluid width everywhere except rendered markdown prose (`72ch`). The command palette (`⌘K`) is a modal overlay, not primary navigation, and doesn't reopen the decision against a sidebar search box.

## Elevation & Depth

**The Ledger-Lies-Flat Rule.** The frame is flat, and so is everything on the sheet: every on-page seam (rail/sidebar, scan banner, the file viewer's header and tree) is a 1px rule-line. The content sheet is the one at-rest surface with a shadow, and `--sheet-shadow` is its alone. Anything else casts a shadow only if it floats above the page (dropdowns, popovers, tooltips, dialogs, toasts, ⌘K), using shadcn's default scale unmodified. No gradients anywhere.

## Shapes

One radius scale rooted at `--radius: 0.625rem`, the same for every skill source (no tier gets its own geometry): `sm` for the tightest inner controls, `md` (the default) for buttons, inputs, and nav items, `lg` for cards and dialogs, `xl` for the content sheet, `full` for pills (badges, status chips, the budget track).

## Components

**Lucide** (`lucide-react`) for every icon. No status or identity signal is ever carried by color alone (the Tones-Aren't-The-Stamp Rule).

### Buttons

- Primary is `--primary`. A primary CTA that must stand out swaps in acid lime on the button itself, a targeted override rather than a new variant, per the One Stamp Rule. Destructive (plugin uninstall) is the danger tone; outline, ghost, and secondary are stock shadcn.
- Every hover dims to 90% of its own fill, never a separate token. Focus is the shared `--ring` at 3px, 50% alpha, on every interactive element, inputs included.

### Text links

- **`TextLink`** is the one treatment for every inline "View X" / "Reveal X" affordance: an in-app `<button>` whose underline sweeps in on hover and focus-visible, drawn in ink, never lime.
- **Two registers.** The underline shows only on hover/focus, so a link leans on context. Sentence-embedded links and list-tail disclosure ("View all N") stay caption-quiet: 11px uppercase ink-muted. A standalone navigation link, alone under a paragraph where the eye expects the next section caption, takes 13px sentence-case ledger ink plus a leading context icon (e.g. `FileText` for "View SKILL.md"), because no section caption carries an icon.

### Badges / Chips

- **Source badges** (`SourceBadge`): outline, icon + label always paired (`Globe` global, `FolderGit2` project, `Blocks` plugin). No per-tier color; a trailing `Lock` marks plugin skills read-only.
- **Status pills** (`LintStatusBadge`): only the icon takes the tone; the label stays ledger ink, so status is legible to someone who can't tell the tones apart.
- **Plugin update pill** (`PluginBadges`): `ArrowUpCircle` + "Update" in the info tone.
- **Disabled** (`Power`): the dormant tone, icon-only with a tooltip in the table's icon tray, icon + "Disabled" in the plugin status pill.
- **Stale** (`Clock`): the dormant tone, icon-only with a tooltip in the icon tray. Never alongside `Power` or the shadow warning, which already explain why a skill doesn't run (`docs/usage-analytics.md`, Stale skills).

### Entity glyph

- **`EntityGlyph`** is the entity mark outside Resident Tax: a `rounded-lg` tile tinted with the entity's hue at 10%, holding the glyph in the full hue. The tile is part of the mark, not a row background.
- **Where:** the leading slot of ⌘K skill rows, the SkillDetail header, and PluginDetail's MCP server and agent rows. Memory renders once it has a surface of its own; plugins can't ship it. Plugins aren't an entity and get no tile; their ⌘K rows keep a muted `Blocks` in a slot of the same width so text lines up.
- **PluginDetail components** sit between the stats card and Installs, each under an 11px uppercase caption with its count (`Agents · 3`). MCP servers and agents are two-line rows led by the tile; commands and LSP servers are dense one-line mono rows on a `--muted` panel; hooks are outline chips, one per event. Names read as the user types them, with the plugin prefix dimmed (`/vercel:deploy`, `vercel:ai-architect`). A list over five shows five and a caption-quiet "Show all N" that expands in place. Rows are static: no hover, selection, or focus stop.
- Always beside text that names the entity, so the glyph is `aria-hidden` and identity is never color alone. Disabled skills, and the components of a plugin disabled in every scoped install, get a neutral tile (`--muted` fill, muted glyph); the header status pill names that state.
- Never on the frame and never as a section icon: the rail, onboarding's overview cards, and the Usage panel list keep an ink `BrainCircuit`.

### Table (the ledger's spine)

- Fixed row height and `table-fixed` columns, with Description filling the remainder: no horizontal scroll, no variable row height.
- Hover and selection share one absolutely-positioned highlight box that glides between rows on a spring instead of each row repainting; full-bleed and unrounded, matching the flat elevation.

### Usage project lists

Claude app chats (folderless Claude desktop chats) fold into one "Claude app chats (N)" row in every project ranked list and the Project timeline, including the day and hour detail dialogs. It ranks and takes a share like any project, from the sum of its chats. A chevron toggle opens the chats beneath it, indented, as a nested ranked list with its own show-more; each chat's share stays of the whole window. Chats show their title, else "Claude app chat · <local start date>", in plain text (a title can hold `/`), and never their folder path.

### Rail (section switcher)

- Icon-only, tooltip-labeled, behind one rule-line, no shadow. The active section is ink-fill (`--frame-muted` + ledger ink), never lime: the rail switches which section shows, while selecting within a section is the sidebar's lime filter.
- The footer gear opens Settings (also `Cmd+,`). When an update is ready (Windows) or available (macOS), an info-tone dot sits on the gear and its label reads "Settings · Update ready" / "Settings · Update available".

### Settings (dialog)

- A modal dialog opened by the rail gear or `Cmd+,`, not a rail section, with sections separated by rule-lines. Its Light/Dark/System segmented control marks the active option with ink-fill, like the rail, never lime.

### Onboarding (dialog)

- A three-step modal over the live app (`components/onboarding/`): what Megatron does and doesn't do, an overview of Skills / Plugins / Usage with the user's own counts, and folder access. It shows when no folder is granted and the `preferences.json` flag is unset; every exit sets the flag; Settings › About › "Show welcome" replays it.
- **Departs from the ledger, user-authorised and scoped to this dialog:** 24px/600 step headlines, and motion-led steps: direction-aware spring slides, the dialog's height animating to each step, staggered entries, counts ticking up as the scan reports, a check popping on granted rows, progress dots stretching into a pill.
- **Everything else holds:** lime on exactly one CTA at a time (Next, then "Choose folders…" until something is granted, then "Open Megatron"); tones per the Tones-Aren't-The-Stamp Rule; overview card icons stay ink like the rail's; no gradients, glows, or animated backgrounds. With reduced motion, steps are opacity-only and counts show their final value.

### Sidebar Navigation

- Items are icon + label; the active item is the One Stamp Rule's lime fill, one at a time. Nested sublists indent under a border-left rule-line rather than a background change.
- Skills and Plugins share a Projects tree that mirrors the folder structure, nested at Git repository boundaries, with runs of shared folders compacted into one row as in VS Code's compact folders. The grouping, folding, and selection rules are pinned by `lib/project-tree.test.ts`.
- **Project names** everywhere (sidebar, headings, tables, details, search, Usage, activity) are name first: parent folders are added only to names that clash, ignoring case, one at a time, falling back to the full path. Casing is preserved and separators are `/`. The parent prefix is dimmed and truncates before the name: muted ink on the frame, paper, and cards, lime-foreground at 70% on the selected fill, both at least 4.5:1. Full paths show on hover.
- Unavailable repositories keep cached counts and pair an alert icon with a tooltip and a notice in the selected view.
- Plugin rows are one plugin identity per repository (project and local installs combined), with User entries separate. Aggregate tables show Repository; scoped details and actions use only the selected repository. Global usage totals are labeled "Uses (all projects)."
- **Not built, with revisit triggers:** OS-localized folder names and iCloud Drive display names (need a native addon and break path search; revisit if users report raw `Mobile Documents` rows). A sidebar search box (revisit when real trees routinely run past a few screens). Virtualizing the tree (revisit when a real tree passes about 1,000 rows). Persisting expansion across launches (revisit if users report re-expanding the same rows every launch).

### Loading, Empty & Error States

- **Loading:** skeletons in the final table/panel shape, never a generic spinner.
- **Empty:** one large ink-muted icon above a short heading and one line of body text; a single lime CTA when the state is actionable.
- **Error:** inline, near the affected row or section, never a full-page state.

### Transitions

Timings live in `lib/transitions.ts`; dialog tuning lives in `main.css`.

- **Arrival only.** No exit animations on screens or dialogs: the old screen leaves in the same commit the new one mounts.
- **Screens** (`ScreenTransition`): a section switch rises slightly; going deeper (list → detail → files) enters from the right, and Back from the left. The first paint never animates.
- **Title glide** (`GlideTitle`): the name glides from a Skills or Plugins row into its detail, and between detail and files. Position only, so the size snaps and the text never distorts. Destination headers render from the list row, so the glide can start before the query returns. Back to a list doesn't glide: the table's scroll container would clip the title, and it would cross other rows' names. Back still focuses the opened row and scrolls it into view.
- **Data settle:** an opacity settle on pending → data only, never on a refetch or poll; cached data shows at once. Rows present when a list mounts arrive with it; rows added later fade and rise.
- **Dialogs and ⌘K** scale and fade in (tw-animate-css) and close instantly. **Tooltips** keep shadcn's stock fade, in and out.
- **Reduced motion:** opacity only. Screens fade without travel, titles don't glide, dialogs and tooltips keep their fades, and the settle is unchanged.

### File Tree (signature component)

The file viewer's tree uses more motion than most surfaces: icon rotation on expand/collapse, a glide highlight like the table's (inset and pill-shaped rather than full-bleed), and a fade-in for rows that mount after the viewer opens, since virtualization rules out animating a whole subtree's `height: auto`.

### Charts (Usage)

- Hand-rolled in `components/usage/`, in chart ink per the Monochrome-Chart-Ink Rule. A part-to-whole bar has no track: the whole bar is data.
- Bars rise from the baseline, staggered, on enter. A window switch is the signature moment: bars interpolate to their new heights and stat numerals roll to the new value, on a switch only, never on mount. Panel switches crossfade. Hover dims siblings and never recolors.

### Named Rules

**The Hand-Rolled-Charts Rule.** No charting library. Recharts, visx, and Chart.js ship visual opinions (tooltip chrome, axis styling, entrance animations) that cost as much to override as clean bars cost to build, and add bundle weight to an Electron app. Reopen only if a line chart ships, and then evaluate `d3-shape` alone or `uPlot`, never a full framework.
**The Motion-Earns-Its-Keep Rule.** `motion` is for state changes that need feedback CSS can't express, on any surface that earns it, and is never decorative. CSS stays the default; dialogs and tooltips are CSS keyframes. Every `motion` use guards `useReducedMotion()` explicitly, since JS-driven animation doesn't get `prefers-reduced-motion` for free. The one exception is an opacity-only fade (the data settle), which reduced motion keeps.

## App Icon

A white (`#f5f5f5`) magnet with acid-lime pole caps pulling in a lime 12-ray sparkle, on a `#111111` tile. The magnet is Megatron, the collector; the sparkle is the skill being pulled in.

- **Masters:** `build/icon-source/icon.svg` (full art) and `icon-small.svg` (simplified). `npm run build:icons` generates `build/icon.ico`, `resources/icon.ico`, `resources/icon.png`, and the Icon Composer layers in `build/icon-source/layers/`. Then rebuild `build/icon.icon` from the new layers (below).
- **Hand nudges:** the committed `.icon` carries per-layer nudges made in Icon Composer (`translation-in-points` in its `icon.json`) that set the macOS magnet about 2.5% left and lower than the masters and the `.ico`. That shipped version is the approved one; a rebuild from fresh layers drops the nudges unless they're reapplied.
- **Color:** the caps and sparkle use `--accent-lime` (`#e4f222`) itself. A brighter icon-only lime would hurt the app's light mode.
- **macOS:** Liquid Glass off or at minimum on every layer; the Ledger-Lies-Flat Rule applies to the icon too. electron-builder generates the `.icns` fallback for macOS before 26 from the `.icon`.
- **Windows:** the dark tile is nearly full-bleed, because Windows adds no mask or padding. Windows uses the hand-tuned small sizes only at 100% scaling; from 125% up the taskbar shows the full art, scaled down.

### Building the `.icon` (Xcode 26+)

1. In Icon Composer, start a new document and set Fill to solid `#111111`. The tile is the fill, not a layer.
2. Drag in `layers/1-magnet.svg`, `2-caps.svg` and `3-sparkle.svg`. They're numbered in z-order, with the sparkle on top. Icon Composer puts all three in one group. Keep the single group: the layers don't overlap, and separate groups would bring back per-group depth shadows.
3. Turn Liquid Glass off on all three layers. On the group, set Shadow to None and turn off Specular and Translucency.
4. Check the Default, Dark, Clear and Tinted previews. The gap between the caps and the magnet must stay visible in all four.
5. Save as `build/icon.icon`.

### Named Rules

**The Equal-Gap Rule.** The sparkle sits exactly as far from one pole cap as from the other: 60 units each. If it moves or grows, both gaps move together. Rays keep their 13.3 stroke, because thicker rays fuse into a gear or a splat.

**The 30-Pixel Rule.** The sparkle appears from 30 px up. Below that, the `.ico` uses the small master: no sparkle, and caps joined to the magnet, because at taskbar size the cap gap and the sparkle blur into noise. In Clear and Tinted modes on macOS, the white and the lime collapse toward one color, so the cap gap is what keeps the poles readable. Keep it visible at every size that has one.
