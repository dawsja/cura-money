# THEME.md — Cura Money color palette

Single source of truth for the app's theme. The agent should read this
file before changing any color, then make the edits in
`src/ui/src/styles.css`. The pattern is intentionally structured so that
a full palette swap = a handful of token replacements, not a sweep of
every component.

**This app is dark-only.** There is no light mode, no theme toggle, and
no `cura.theme` localStorage key. Do not reintroduce a light palette or
a theme selector without an explicit product decision.

## Files that own the palette

| File | Role |
| --- | --- |
| `src/ui/src/styles.css` | All color tokens, semantic tokens, Tailwind `@theme` overrides, `.btn-primary`, `.card`, chart vars. **This is the only file you need to edit for a palette change.** |
| `src/ui/index.html` | Sets `color-scheme: dark` and mirrors `--bg-page` in the required `theme-color` meta value for mobile browser chrome. |
| `src/ui/public/manifest.webmanifest` | Mirrors `--bg-page` in `background_color` and `theme_color`; installed PWAs require literal manifest colors. |
| `src/ui/src/lib/accounting.ts` | One read-time color utility (`formatAccountBalance`) that returns a Tailwind class string. Tied to the palette via `text-rose-600 dark:text-rose-400` + `fg-primary`. |
| `src/ui/public/logo.png`, `logo.ico` | Branding mark, not part of the palette. |

## How the system works

Three layers, each with a single responsibility:

1. **Brand surfaces** (3 — the "what does this app feel like" decisions) — main canvas, secondary canvas, overlay.
2. **Tailwind color scales** (`amber`, `slate`, `emerald`, `rose`, `sky`, `violet`) — the same names Tailwind ships, but every slot is overridden via `@theme` to wire through a CSS variable on `:root`.
3. **Semantic tokens** (`.fg-primary`, `.bg-surface`, `.border-default`, `.chart-*`) — the curated handful of design-system surface/text/border values that component code should prefer when possible.

All palette variables live on `:root` only. There is no `.dark` class and
no light/dark token swap.

Legacy components still use `dark:` utility pairs (e.g.
`text-rose-600 dark:text-rose-400`). `styles.css` defines
`@custom-variant dark (&);` so every `dark:` selector always matches and
resolves to the dark side. Prefer bare utilities or semantic tokens for
new code.

```
            ┌─────────────────┐
            │  3 brand surfaces│   ← design decision
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
   │  utilities pick up the palette  │
   └─────────────────────────────────┘
```

## Current palette (GitHub Dark + green CTA)

Surfaces mirror GitHub Dark's primer palette (canvas/overlay hierarchy +
syntax accents). The CTA hue is **GREEN** (not stock GitHub blue) so the
app feels distinctly its own brand. The Tailwind `amber-*` scale maps to
a vivid fresh green (Tailwind green-500 / `#22c55e`) for the CTA slot;
the `emerald-*` scale maps to GitHub's syntax success green (`#3fb950`)
for the success semantic. They share the green family but stay visually
distinguishable — a CTA button and a success badge never fight for the
same color.

### Brand surfaces

| Role | Hex | Token | Notes |
| --- | --- | --- | --- |
| Main canvas | `#0d1117` | `--bg-page` | Page background, sidebar, header. |
| Secondary canvas | `#161b22` | `--bg-canvas-subtle` | Inset surfaces (sidebar rail on a page, code blocks). |
| Overlay | `#21262d` | `--bg-surface` | Elevated surfaces (cards, modals, popovers). |
| Border | `#30363d` | `--border-default` | Dividers, input borders. |
| Border strong | `#484f58` | `--border-strong` | Hover / stronger dividers. |
| Primary text | `#c9d1d9` | `--fg-primary` | Body text. |
| Secondary text | `#8b949e` | `--fg-secondary` | Captions, helper text. |
| Accent — green | `#22c55e` | `--mp-amber-500` | Primary CTA, links. (Tailwind `amber-*` scale — distinct from the success green below.) |
| Accent — green syntax | `#4ade80` | `--mp-amber-300` | Light tint for readable text on dark. |
| Accent — green | `#3fb950` | `--mp-emerald-500` | Success state. |
| Accent — red | `#ff7b72` | `--mp-rose-500` | Danger, alerts. |
| Accent — yellow | `#d29922` | `--mp-sky-300` | Warning, attention. |
| Accent — purple | `#d2a8ff` | `--mp-violet-600` | Rare depth accent (investment icons). |
| Coffee accent — brown | `#c58b5a` | `--coffee-accent` | Sidebar support-link coffee icon. |

The CTA green (`#22c55e`) is medium-saturation — dark text
(`--mp-slate-900` / `#0d1117`) passes AA (~7.2:1) on it, and it has
enough contrast against the `#0d1117` page background to feel like a
distinct, clickable surface.

### Tailwind scale → palette mapping

| Tailwind scale | Maps to | Why |
| --- | --- | --- |
| `amber-*` | Green (primary CTA) | Brand CTA slot per AGENTS.md. Amber buttons always use dark text. Tailwind green-500 / `#22c55e`. |
| `slate-*` | Cool-neutral ramp | Light slots double as readable light text (`text-slate-100`); dark slots for elevated surfaces. |
| `emerald-*` | Success (green) | GitHub Primer / syntax green (`#3fb950`). Distinct shade from the amber CTA green above. |
| `rose-*` | Danger (red) | GitHub Primer `color-danger-*` / syntax red family. |
| `sky-*` | Warning (yellow) | GitHub Primer `color-attention-*` family. |
| `violet-*` | Depth accent (purple) | GitHub Primer / syntax purple. |

Orange (`#ffa657`) is folded into the **chart palette** (as a fourth
series color) rather than its own Tailwind scale — no component code
uses an `orange-*` utility.

### The non-monotonic amber (and accent) scales

**Important**: the `amber` scale is NOT a clean light→dark gradient.
Reading the values in `styles.css` you'll see:

- `amber-50/100` — deep green tints (subtle backgrounds)
- `amber-200/300/400` — LIGHT green (readable text on dark surfaces;
  `amber-300` is `#4ade80`)
- `amber-500` — `#22c55e` (primary CTA, dark text passes AA)
- `amber-600` — `#16a34a` (CTA hover, deeper than 500)
- `amber-700/800/900` — deeper greens

**Why this shape**: components use `text-amber-200`, `text-amber-300`,
`text-amber-400` as light-readable text on dark surfaces. With a
conventional monotonic scale (where 200 < 300 < 400 < 500), those
slots would be DARKER than 500 — invisible on the dark page bg. The
role-based scale lets 200/300/400 stay light enough to read while
500/600 stay CTA-shaped.

If you change the accent hue, preserve this shape — the 200/300/400
slots always need to be readable LIGHT text on the dark page bg.

Same convention applies to the emerald, rose, and sky scales.

### Semantic tokens

```css
--fg-primary:     #c9d1d9  /* GitHub Dark body text */
--fg-secondary:   #8b949e  /* GitHub Dark muted */
--fg-tertiary:    #6e7681
--fg-muted:       #484f58
--bg-surface:     #21262d  /* GitHub Dark overlay */
--bg-canvas-subtle: #161b22  /* GitHub Dark secondary */
--bg-page:        #0d1117  /* GitHub Dark main */
--border-default: #30363d  /* GitHub Dark border */
--border-strong:  #484f58
--coffee-accent:  #c58b5a  /* Sidebar coffee icon */
```

Exposed as utility classes: `.fg-primary`, `.fg-secondary`,
`.fg-tertiary`, `.fg-muted`, `.bg-surface`, `.bg-page`,
`.bg-canvas-subtle`, `.border-default`, `.coffee-accent`. Prefer these over the raw
Tailwind scales when touching component code.

### Chart palette (`--chart-*`)

| Token | Hex | Used by |
| --- | --- | --- |
| `--chart-grid` | `#21262d` | Recharts `<CartesianGrid>` |
| `--chart-axis` | `#8b949e` | Axis tick labels |
| `--chart-tooltip-bg` | `#161b22` | Tooltip surface |
| `--chart-tooltip-border` | `#30363d` | Tooltip outline |
| `--chart-tooltip-fg` | `#c9d1d9` | Tooltip text |
| `--chart-tooltip-muted` | `#8b949e` | Tooltip secondary text |
| `--chart-total` | `#c9d1d9` | "Total" series |
| `--chart-baseline` | `#22c55e` | "Baseline" series (amber CTA green) |
| `--chart-orange` | `#ffa657` | Fourth series color |

## Rules (do not break)

These are enforced by AGENTS.md and the styles.css comments; preserve
them across every palette change.

1. **Dark only.** Do not reintroduce light-mode tokens, a `.dark` class
   toggle, `cura.theme` storage, or a theme selector in the profile menu
   without an explicit product decision.
2. **Amber buttons use dark text, never `text-white`.** The CTA slot
   is a medium green (`#22c55e`) and white fails AA contrast on it.
   Use `text-slate-900` (or another dark fg token) on every amber
   background. The `.btn-primary` class already does this.
3. **Light text on dark bg needs ≥4.5:1 contrast.** Verify any new color
   pair with https://webaim.org/resources/contrastchecker/ before
   committing.
4. **The amber 200/300/400 slots must stay light.** They are the
   readable-text slots. If you flatten the scale to a conventional
   light-to-dark ramp, every `text-amber-200/300/400` utility becomes
   invisible on the page bg.
5. **Don't scatter redundant light/dark class pairs in new code.** Use
   the semantic tokens (`.fg-primary`, `.bg-surface`, `.border-default`)
   or a single utility that already matches dark (`bg-amber-500`).
   Legacy `dark:` pairs still work because `dark:` always matches.
6. **One file to edit for colors.** Never change palette values inside
   component `.tsx` files. Everything routes through
   `src/ui/src/styles.css`. **Always update this file (`THEME.md`) in
   the same change** so the docs match the live tokens.

## How to change the palette

### Pick your new palette

Decide three brand surfaces:

- **Main canvas** — the largest surface; sets the overall mood
- **Secondary canvas** — inset surfaces (sidebar rail, code blocks)
- **Overlay** — cards, modals, popovers (always slightly more elevated
  than the canvas above it)

Plus 4–6 accents: primary CTA, success, danger, warning, depth.

Verify each brand color passes AA contrast against both:
- Its own foreground (a button label)
- The page bg and the surface

### Update tokens

In `src/ui/src/styles.css`, in the single `:root` block:

1. Replace the slate scale (`--mp-slate-50` through `--mp-slate-900`)
   if the neutral ramp must move. Keep light slots readable as text on
   dark surfaces (`text-slate-100` patterns). Keep slate-900 dark enough
   that dark text on amber-500 passes AA.
2. Replace the amber scale with a tint ramp of your new CTA. **Remember
   the non-monotonic rule**: 200/300/400 must be readable light text on
   dark; 50/100/900 subtle dark backgrounds; 500 is the CTA; 600 is
   hover (deeper than 500).
3. Replace emerald / rose / sky / violet as needed (same non-monotonic
   shape for accents used as text).
4. Update the semantic tokens (`--fg-primary`, `--bg-page`, etc.).
5. Update the chart palette (`--chart-*`) — at minimum `--chart-baseline`
   should track the CTA.
6. If `--bg-page` changes, mirror it in `src/ui/index.html`'s
   `theme-color` and in the PWA manifest's `background_color` and
   `theme_color`. These platform metadata formats cannot reference CSS
   variables.

Then **update this file (`THEME.md`)** — tables, hex lists, semantic
snippet, chart table — so it matches `styles.css` exactly. Mirror the
core surface hexes in `AGENTS.md` UI constraints.

### Verify

```bash
bun install --frozen-lockfile
(cd src/ui && bun install --frozen-lockfile)
bun run typecheck
(cd src/ui && bun run build)
```

Then run the app and confirm:

- Page bg is the dark canvas (not light / not pure white)
- Primary CTA button: dark text on it, passes AA
- Active sidebar item, modal close buttons, focus rings use the accent
- `text-amber-200/300/400` patterns remain readable
- No theme toggle appears in the profile menu
- `THEME.md` hexes match `styles.css`

### Common changes (cheat sheet)

| Change | Where in `src/ui/src/styles.css` |
| --- | --- |
| New page bg color | `:root` → `--bg-page` |
| New secondary canvas color | `:root` → `--bg-canvas-subtle` |
| New overlay color | `:root` → `--bg-surface` |
| New primary CTA hue | `:root` → `--mp-amber-500` AND `--chart-baseline` |
| New secondary accent | `:root` → `--mp-violet-600` |
| New text primary color | `:root` → `--fg-primary` |
| New text secondary | `:root` → `--fg-secondary` |
| New border default | `:root` → `--border-default` |
