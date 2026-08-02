# THEME.md — Cura Money color palette

Single source of truth for the app's theme. The agent should read this
file before changing any color, then make the edits in
`src/ui/src/styles.css`. The pattern is intentionally structured so that
a full palette swap = a handful of token replacements, not a sweep of
every component.

## Files that own the palette

| File | Role |
| --- | --- |
| `src/ui/src/styles.css` | All color tokens, semantic tokens, Tailwind `@theme` overrides, `.btn-primary`, `.card`, chart vars. **This is the only file you need to edit for a palette change.** |
| `src/ui/index.html` | Inline script that applies the `.dark` class to `<html>` before React mounts. No colors here. |
| `src/ui/src/lib/accounting.ts` | One read-time color utility (`formatAccountBalance`) that returns a Tailwind class string. Tied to the palette via `text-rose-600 dark:text-rose-400` + `fg-primary`. |
| `src/ui/public/logo.png`, `logo.ico` | Branding mark, not part of the palette. |

## How the system works

Three layers, each with a single responsibility:

1. **Brand surfaces** (3 per mode, the "what does this app feel like" decisions) — main canvas, secondary canvas, overlay.
2. **Tailwind color scales** (`amber`, `slate`, `emerald`, `rose`, `sky`, `violet`) — the same names Tailwind ships, but every slot is overridden via `@theme` to wire through a CSS variable. Hundreds of existing utility classes (`bg-amber-500`, `text-rose-600 dark:text-rose-400`, etc.) pick up the new palette automatically without touching component code.
3. **Semantic tokens** (`.fg-primary`, `.bg-surface`, `.border-default`, `.chart-*`) — the curated handful of design-system surface/text/border values that component code should prefer when possible.

The same `--mp-amber-500` variable is defined once in `:root` (light mode) and once in `.dark` (dark mode). The `.dark` class on `<html>` sets the cascade, so the same utility class emits a different color in each mode.

```
            ┌─────────────────┐
            │  3 brand surfaces│   ← design decision
            │   per mode      │
            └────────┬────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │  Tailwind scale slots  │   ← mechanical mapping
         │  amber-50…900, slate-* │      (one var per slot)
         └────────┬───────────────┘
                  │
                  ▼
   ┌─────────────────────────────────┐
   │  Component code: existing       │   ← unchanged
   │  `bg-amber-500 dark:text-rose-  │
   │  400` classes pick up new palette │
   └─────────────────────────────────┘
```

## Current palette (GitHub Dark surfaces + green-themed muted GitHub Light)

The dark mode mirrors GitHub Dark's primer palette (canvas/overlay
hierarchy + syntax accents). The light mode is built off GitHub Light
but with the page canvas muted to off-white so the app feels calm
rather than blinding — main canvas is `#e9eef2`, secondary canvas
`#dde4ea`, with no pure white anywhere (overlay cards are `#f6f8fa`).

The CTA hue is **GREEN** (not stock GitHub blue) so the app feels
distinctly its own brand. The Tailwind `amber-*` scale maps to a vivid
fresh green (Tailwind green-500 / `#22c55e`) for the CTA slot; the
`emerald-*` scale maps to GitHub's deeper forest-green (`#1a7f37`
light / `#3fb950` dark) for the success semantic. They share the
green family but stay visually distinguishable — a CTA button and a
success badge never fight for the same color.

### Dark mode (brand surfaces)

These are GitHub Dark's `color-canvas-default`, `color-canvas-subtle`,
and `color-canvas-overlay`. Every accent in the palette is derived from
GitHub's primer syntax + functional colors.

| Role | Hex | Token | Notes |
| --- | --- | --- | --- |
| Main canvas | `#0d1117` | `--bg-page` | Page background, sidebar, header. |
| Secondary canvas | `#161b22` | `--bg-canvas-subtle` | Inset surfaces (sidebar rail on a page, code blocks). |
| Overlay | `#21262d` | `--bg-surface` | Elevated surfaces (cards, modals, popovers). |
| Border | `#30363d` | `--border-default` | Dividers, input borders. |
| Primary text | `#c9d1d9` | `--fg-primary` | Body text. |
| Secondary text | `#8b949e` | `--fg-secondary` | Captions, helper text. |
| Accent — green | `#22c55e` | `--mp-amber-500` | Primary CTA, links. (Tailwind `amber-*` scale — distinct from the success green below.) |
| Accent — green syntax | `#4ade80` | `--mp-amber-300` | Light tint for readable text on dark. |
| Accent — blue syntax | `#a5d6ff` | n/a | Reused only as informational — stock GitHub's link-blue, no longer the CTA. |
| Accent — green | `#3fb950` | `--mp-emerald-500` | Success state. |
| Accent — red | `#ff7b72` | `--mp-rose-500` | Danger, alerts. |
| Accent — yellow | `#d29922` | `--mp-sky-300` | Warning, attention. |
| Accent — purple | `#d2a8ff` | `--mp-violet-600` | Rare depth accent (investment icons). |

### Light mode (muted GitHub Light)

All three surfaces are muted off-white — no pure white anywhere on
screen. The page canvas is the most muted (`#e9eef2` — the surface you
stare at), secondary canvas is a notch further muted (`#dde4ea` —
insets, sidebar rails), and overlay/cards are slightly lighter
(`#f6f8fa` — the lifted surface that still gives cards elevation
without "flash-banging" the user on large monitors). Border and text
tones come straight from GitHub Light's `color-border-default`,
`color-fg-default`, and `color-fg-muted`.

| Role | Hex | Token | Notes |
| --- | --- | --- | --- |
| Main canvas | `#e9eef2` | `--bg-page` | Page background, sidebar, header. The most muted surface — the one you stare at. |
| Secondary canvas | `#dde4ea` | `--bg-canvas-subtle` | Inset surfaces. A notch further muted. |
| Overlay | `#f6f8fa` | `--bg-surface` | Cards, modals, popovers. Slightly lighter than the page for subtle elevation. No pure white. |
| Border | `#d1d9e0` | `--border-default` | Dividers, input borders. |
| Primary text | `#1f2328` | `--fg-primary` | Body text. |
| Secondary text | `#59636e` | `--fg-secondary` | Captions, helper text. |
| Accent — green | `#22c55e` | `--mp-amber-500` | Primary CTA, links. (Tailwind `amber-*` scale — vivid fresh green, distinct from the success green below.) |
| Accent — green (success) | `#1a7f37` | `--mp-emerald-500` | Success state (Tailwind `emerald-*` scale — deeper forest-green). |
| Accent — red | `#cf222e` | `--mp-rose-500` | Danger, alerts. |
| Accent — yellow | `#9a6700` | `--mp-sky-500` | Warning, attention. |
| Accent — purple | `#8250df` | `--mp-violet-600` | Rare depth accent (investment icons). |

The CTA green is the same hex in both modes (`#22c55e`) because it's
medium-saturation — dark text passes AA on it in either mode, and it
has enough contrast against both the `#0d1117` and `#e9eef2` page
backgrounds to feel like a distinct, clickable surface.

### Tailwind scale → palette mapping

| Tailwind scale | Maps to | Why |
| --- | --- | --- |
| `amber-*` | Green (primary CTA) | Brand CTA slot per AGENTS.md. Amber buttons always use dark text. Tailwind green-500 / `#22c55e` in both modes. |
| `slate-*` | Consistent cool-neutral ramp | Shared by both modes so `dark:text-slate-100` patterns still resolve to light text on dark. Cool blue-gray to harmonize with `#e9eef2`. |
| `emerald-*` | Success (green) | GitHub Primer `color-success-*` family (`#1a7f37` light / `#3fb950` dark). Distinct shade from the amber CTA green above. |
| `rose-*` | Danger (red) | GitHub Primer `color-danger-*` family. |
| `sky-*` | Warning (yellow) | GitHub Primer `color-attention-*` family. |
| `violet-*` | Depth accent (purple) | GitHub Primer `color-done-*` / accent family. |

The orange `#ffa657` from the user spec is folded into the **chart
palette** (as a fourth series color) rather than its own Tailwind scale —
no component code uses an `orange-*` utility, so a one-off chart slot
keeps the Tailwind surface uncluttered.

### The non-monotonic dark amber scale

**Important**: the dark-mode `amber` scale is NOT a clean light→dark
gradient. Reading the values in `styles.css` you'll see:

- `amber-50/100` — deep green tints (subtle backgrounds)
- `amber-200/300/400` — LIGHT green (readable text on dark surfaces;
  `amber-300` is `#4ade80` — a light-green tint that reads on `#0d1117`)
- `amber-500` — `#22c55e` (primary CTA, dark text passes AA)
- `amber-600` — `#16a34a` (CTA hover, deeper than 500)
- `amber-700/800/900` — deeper greens (for `text-amber-700 dark:text-amber-700` patterns that expect darker fg)

**Why this shape**: components use `text-amber-200`, `text-amber-300`,
`text-amber-400` as light-readable text on dark surfaces. With a
conventional monotonic scale (where 200 < 300 < 400 < 500), those
slots would be DARKER than 500 — invisible on the dark page bg. The
role-based scale lets 200/300/400 stay light enough to read while
500/600 stay CTA-shaped.

If you change the accent hue, preserve this shape — the 200/300/400
slots always need to be readable LIGHT text on the dark page bg.

Same convention applies to the emerald, rose, and sky scales in dark
mode.

### Semantic tokens

```css
/* Light mode */
--fg-primary:     #1f2328  /* GitHub Light body text */
--fg-secondary:   #59636e  /* GitHub Light muted */
--fg-tertiary:    #6e7681
--fg-muted:       #8b949e
--bg-surface:     #f6f8fa  /* lifted overlay — NOT pure white */
--bg-canvas-subtle: #dde4ea  /* inset secondary canvas */
--bg-page:        #e9eef2  /* page canvas — the most muted surface */
--border-default: #d1d9e0  /* GitHub Light border */
--border-strong:  #afb8c1

/* Dark mode */
--fg-primary:     #c9d1d9  /* GitHub Dark body text */
--fg-secondary:   #8b949e  /* GitHub Dark muted */
--fg-tertiary:    #6e7681
--fg-muted:       #484f58
--bg-surface:     #21262d  /* GitHub Dark overlay */
--bg-canvas-subtle: #161b22  /* GitHub Dark secondary */
--bg-page:        #0d1117  /* GitHub Dark main */
--border-default: #30363d  /* GitHub Dark border */
--border-strong:  #484f58
```

Exposed as utility classes: `.fg-primary`, `.fg-secondary`,
`.fg-tertiary`, `.fg-muted`, `.bg-surface`, `.bg-page`,
`.bg-canvas-subtle`, `.border-default`. Prefer these over the raw
Tailwind scales when touching component code.

### Chart palette (`--chart-*`)

| Token | Light | Dark | Used by |
| --- | --- | --- | --- |
| `--chart-grid` | `#d1d9e0` | `#21262d` | Recharts `<CartesianGrid>` |
| `--chart-axis` | `#59636e` | `#8b949e` | Axis tick labels |
| `--chart-tooltip-bg` | `#f6f8fa` | `#161b22` | Tooltip surface (matches `--bg-surface` — no pure white in light mode) |
| `--chart-tooltip-border` | `#d1d9e0` | `#30363d` | Tooltip outline |
| `--chart-tooltip-fg` | `#1f2328` | `#c9d1d9` | Tooltip text |
| `--chart-tooltip-muted` | `#59636e` | `#8b949e` | Tooltip secondary text |
| `--chart-total` | `#1f2328` | `#c9d1d9` | "Total" series |
| `--chart-baseline` | `#22c55e` | `#22c55e` | "Baseline" series (amber CTA green — same hex in both modes for brand consistency) |
| `--chart-orange` | `#bc4c00` | `#ffa657` | GitHub orange — used as a fourth series color |

The baseline tracks the amber CTA hue — `#22c55e` (Tailwind green-500)
in both modes. Same hex because the green is medium-saturation and
reads cleanly against either the light card bg or the dark page bg.

## Rules (do not break)

These are enforced by AGENTS.md and the styles.css comments; preserve
them across every palette change.

1. **Amber buttons use dark text, never `text-white`.** The CTA slot
   is a medium green (`#22c55e`) and white fails AA contrast on it in
   either mode. Use `text-slate-900` (or another dark fg token) on
   every amber background. The `.btn-primary` class already does this.
2. **Light text on dark bg needs ≥4.5:1 contrast.** The same applies
   for dark text on light bg. Verify any new color pair with
   https://webaim.org/resources/contrastchecker/ before committing.
3. **The dark amber 200/300/400 slots must stay light.** They are the
   readable-text slots for the dark side of the palette. If you flatten
   the scale to a conventional light-to-dark ramp, every
   `text-amber-200/300/400` utility on a dark surface becomes invisible.
4. **Slate is shared across modes.** Don't redefine it in `.dark` —
   every `dark:text-slate-100` and `bg-slate-100` pattern depends on
   the same scale working in both modes.
5. **Don't scatter light/dark class pairs in components.** Use the
   semantic tokens (`.fg-primary`, `.bg-surface`, `.border-default`)
   or rely on the auto-swapping utilities (`bg-amber-500` works in both
   modes without a `dark:` variant). If you find yourself writing
   `bg-slate-100 dark:bg-slate-700` for a hover state, that's a hint
   the slate scale is being used for two different roles — consider
   adding a semantic class instead.
6. **One file to edit.** Never change palette values inside component
   `.tsx` files. Everything routes through `src/ui/src/styles.css`.

## How to change the palette

### Pick your new palette

Decide three brand surfaces per mode:

- **Main canvas** — the largest surface; sets the overall mood
- **Secondary canvas** — inset surfaces (sidebar rail, code blocks)
- **Overlay** — cards, modals, popovers (always slightly more elevated
  than the canvas above it)

Plus 4–6 accents: primary CTA, success, danger, warning, depth.

Verify each brand color passes AA contrast against both:
- Its own foreground (a button label)
- The page bg and the surface

### Update light mode

In `src/ui/src/styles.css`, in the `:root` block (top of file):

1. Replace the slate scale (`--mp-slate-50` through `--mp-slate-900`)
   with a new cool-gray ramp that pairs with your new mood. The
   lightest slate should be your new page bg derived from the brand
   palette, and the darkest should be deep enough that dark text on
   amber-500 passes AA.
2. Replace the amber scale (`--mp-amber-50` through `--mp-amber-900`)
   with a tint ramp of your new Accent 1. `500` is the primary CTA.
3. Replace the violet scale (`--mp-violet-600`) with the light-mode
   value of Accent 5 (deep enough to read on white).
4. Update the semantic tokens (`--fg-primary`, `--bg-page`, etc.) to
   match.
5. Update the chart palette (`--chart-*`) — at minimum `--chart-baseline`
   should be your new Accent 1.

### Update dark mode

In the `.dark` block (same file):

1. Replace the amber scale with the dark-mode Accent 1 ramp. **Remember
   the non-monotonic rule**: 200/300/400 must be readable light text on
   dark, 50/100/900 must be subtle dark backgrounds, 500 is the CTA,
   600 is the hover (deeper than 500).
2. Replace the violet scale with the dark-mode Accent 5 — usually the
   brand value as-given (light enough to read on dark).
3. Update the semantic tokens.
4. Update the chart palette.

### Verify

```bash
bun install --frozen-lockfile
(cd src/ui && bun install --frozen-lockfile)
bun run typecheck
(cd src/ui && bun run build)
```

Then run the app and confirm:

- Light mode page bg renders the new color (NOT pure white — the muted
  canvas is the whole point)
- Dark mode page bg renders the new color
- Primary CTA button: dark text on it, passes AA
- The active sidebar item, modal close buttons, focus rings all use
  the new accent
- The text `text-amber-200/300/400` patterns (e.g. notifications,
  warning banners) are still readable in dark mode

### Common changes (cheat sheet)

| Change | Where in `src/ui/src/styles.css` |
| --- | --- |
| New page bg color (light) | `:root` → `--bg-page` AND `--mp-slate-50` |
| New page bg color (dark) | `.dark` → `--bg-page` |
| New secondary canvas color (light) | `:root` → `--bg-canvas-subtle` |
| New secondary canvas color (dark) | `.dark` → `--bg-canvas-subtle` |
| New overlay color (light) | `:root` → `--bg-surface` |
| New overlay color (dark) | `.dark` → `--bg-surface` |
| New primary CTA hue | `:root` → `--mp-amber-500` AND `.dark` → `--mp-amber-500` (same value if it works on both modes) AND `--chart-baseline` in both modes |
| New secondary accent (light) | `:root` → `--mp-violet-600` |
| New secondary accent (dark) | `.dark` → `--mp-violet-600` (often different from light — light purple replaces dark purple for readability) |
| New text primary color (light) | `--mp-slate-900` AND `--fg-primary` in `:root` |
| New text primary color (dark) | `--fg-primary` in `.dark` |
| New text secondary | `--fg-secondary` in both modes |
| New border default | `--border-default` in both `:root` and `.dark` |
| Specific status color (success / danger / warning) | `--mp-emerald-*` / `--mp-rose-*` / `--mp-sky-*` in both modes |

### Quick color swap example

To swap the primary CTA from Tailwind green-500 (`#22c55e`) to a
deeper forest-green like `#15803d`:

```css
/* :root + .dark — same hex works in both */
--mp-amber-500: #15803d;  /* was #22c55e — note: dark text fails AA here (~3.5:1) */
--mp-amber-600: #166534;  /* hover, slightly deeper */

/* And update .btn-primary text color, because #15803d needs white text
   in BOTH modes (dark text fails AA on it). The mode-aware swap goes
   through --mp-amber-fg, which the .btn-primary class then references. */
```

After this swap, all the existing `bg-amber-500 text-slate-900`
patterns in components would have to change to a new mode-aware
utility class that references `--mp-amber-fg`. That's why the existing
palette picked a universal `#22c55e` for both modes — it keeps the
component code simple at the cost of a slightly more "vivid" green
than a deeper forest tone would allow.

## When the palette can't be a simple swap

If the new brand color is significantly lighter or darker than the
current CTA, the dark-mode non-monotonic shape needs to be
recalculated. Specifically:

- The 200/300/400 slots must be light enough to read on the dark
  page bg — verify each one passes 4.5:1 against `--bg-page` in
  dark mode.
- The 600 slot must be at least slightly darker than 500 for the
  hover to be visible.
- If you switch to a dark brand color that fails AA with dark text
  (e.g. `#15803d`), you'll need to define a mode-aware
  `--mp-amber-fg` and update component code that hardcodes
  `text-slate-900` on amber backgrounds.

If the new accent hue is very different from green (e.g. you're going
to a bright red or a pale yellow), the entire amber scale needs a
rethink, not just `500` and `600`. Treat the scale as a tint ladder
that spans the new hue from very-light (200) to very-dark (900 /
950) and place the CTA at the rung that pops against both page
backgrounds.
