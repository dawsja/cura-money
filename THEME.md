# Cura Money Theme

This file is the source of truth for Cura Money's light and dark palettes.
Palette values live in `src/ui/src/styles.css`; component code should use
semantic classes whenever possible.

## Theme Behavior

The profile menu offers three preferences:

- `system` follows `prefers-color-scheme` and updates when the OS changes.
- `dark` always uses the dark palette.
- `light` always uses the light palette.

The preference is stored as `cura.theme`. `src/ui/index.html` applies it
before the app loads to avoid a flash of the wrong theme. React owns later
changes through `ThemeProvider`. The resolved dark theme is represented by a
`.dark` class on `<html>`; `data-theme` retains the user's actual preference.

Browser `theme-color` is updated to the resolved page canvas. The web manifest
uses the default light canvas because manifest colors cannot react to runtime
preferences.

## Palette Ownership

| File | Role |
| --- | --- |
| `src/ui/src/styles.css` | Color scales, semantic tokens, components, charts |
| `src/ui/src/components/ThemeProvider.tsx` | Preference state and system-theme listener |
| `src/ui/src/components/ProfileMenu.tsx` | System/dark/light selector |
| `src/ui/index.html` | Pre-paint theme initialization and browser metadata |
| `src/ui/public/manifest.webmanifest` | Static PWA startup colors |

Do not edit generated root `public/` assets.

## Color Strategy

Both modes use cool blue-gray neutrals, which support long sessions with dense
financial data. Light mode raises cards to a restrained pale gray rather than
white. Dark mode retains the established GitHub Dark-inspired canvas
hierarchy. Cards become lighter than their surroundings in both modes.

Light mode is intentionally **dimmed light**, not a white theme. Large surfaces
stay between `#cfd8df` and `#e9edf0`, substantially reducing emitted luminance
and abrupt surface changes compared with Primer's white default canvas. The
cool tint preserves the existing visual language without drifting into beige
or sepia.

The primary CTA remains fresh green (`#22c55e`). Its dark label (`#0d1117`)
passes AA and keeps the button more legible than white text would. Success uses
a quieter green, danger uses red, warnings use ochre-yellow, and purple is
reserved for depth and investment data.

## Semantic Tokens

| Role | Light | Dark | Token |
| --- | --- | --- | --- |
| Main canvas | `#d9e0e5` | `#0d1117` | `--bg-page` |
| Secondary canvas | `#cfd8df` | `#161b22` | `--bg-canvas-subtle` |
| Elevated surface | `#e9edf0` | `#21262d` | `--bg-surface` |
| Border | `#b8c3cb` | `#30363d` | `--border-default` |
| Strong border | `#96a5b0` | `#484f58` | `--border-strong` |
| Control boundary | `#657783` | `#68737f` | `--border-control` |
| Focus indicator | `#116329` | `#4ade80` | `--focus-ring` |
| Primary text | `#20262c` | `#c9d1d9` | `--fg-primary` |
| Secondary text | `#43515c` | `#8b949e` | `--fg-secondary` |
| Tertiary text | `#485661` | `#afb8c1` | `--fg-tertiary` |
| Muted text | `#4f5d68` | `#8b949e` | `--fg-muted` |
| Coffee accent | `#8b5e34` | `#c58b5a` | `--coffee-accent` |

Exposed semantic classes include `.fg-primary`, `.fg-secondary`,
`.fg-tertiary`, `.fg-muted`, `.bg-page`, `.bg-canvas-subtle`, `.bg-surface`,
`.border-default`, and `.coffee-accent`.
Use `.border-control` for interactive control boundaries and `.focus-ring` for
custom interactive elements. Native form controls receive both tokens globally.

Portal overlays use the explicit `.dialog-overlay`, `.dialog-content`, and
variant classes in `styles.css`. These classes own backdrop opacity, stacking,
safe-area spacing, and viewport-constrained scrolling; dialog components should
not recreate those rules with generic fixed/inset/z utility combinations.
Bottom-sheet content owns the bottom safe-area inset so the backdrop reaches the
viewport edge without applying that inset twice.

## Accent Roles

| Role | Light foreground | Dark foreground | Core/action |
| --- | --- | --- | --- |
| Primary | `#116329` | `#4ade80` | `#22c55e` |
| Success | `#116329` | `#56d364` | light/dark mode-specific green |
| Danger | `#b4232b` | `#ff6e64` | red |
| Warning | `#765000` | `#d29922` | ochre-yellow |
| Depth | `#8250df` | `#d2a8ff` | purple |

Tailwind's historical `amber-*` scale is the primary green scale. Keep that
mapping to avoid a broad component migration. In dark mode, the accent scales
remain intentionally role-driven rather than monotonic: `200/300/400` are
light readable foregrounds while `50/100/900` provide dark tinted surfaces.
Light mode uses conventional pale-to-deep ramps.

## Chart Tokens

| Token | Light | Dark |
| --- | --- | --- |
| `--chart-grid` | `#c7d0d7` | `#21262d` |
| `--chart-axis` | `#4f5d68` | `#8b949e` |
| `--chart-tooltip-bg` | `#e9edf0` | `#161b22` |
| `--chart-tooltip-border` | `#b8c3cb` | `#30363d` |
| `--chart-tooltip-fg` | `#20262c` | `#c9d1d9` |
| `--chart-tooltip-muted` | `#4f5d68` | `#8b949e` |
| `--chart-total` | `#25292e` | `#c9d1d9` |
| `--chart-baseline` | `#116329` | `#22c55e` |
| `--chart-orange` | `#bc4c00` | `#ffa657` |
| `--chart-income` | `#116329` | `#56d364` |
| `--chart-expense` | `#b4232b` | `#ff6e64` |
| `--chart-net` | `#765000` | `#d29922` |
| `--chart-comparison` | `#53606b` | `#8b949e` |
| `--chart-merchant` | `#8250df` | `#d2a8ff` |
| `--chart-net-worth-positive` | `#765000` | `#d29922` |
| `--chart-net-worth-negative` | `#b4232b` | `#ff6e64` |
| `--chart-category-1` | `#765000` | `#d29922` |
| `--chart-category-2` | `#116329` | `#56d364` |
| `--chart-category-3` | `#b4232b` | `#ff6e64` |
| `--chart-category-4` | `#0550ae` | `#58a6ff` |
| `--chart-category-5` | `#8250df` | `#d2a8ff` |
| `--chart-category-6` | `#953800` | `#ffa657` |
| `--chart-category-7` | `#0a6b6b` | `#39c5cf` |
| `--chart-category-8` | `#53606b` | `#afb8c1` |
| `--chart-excluded` | `#657783` | `#68737f` |

The eight category tokens form the shared category/account cycle. Every value
is unique within its theme and is selected to retain at least 3:1 contrast
against the elevated chart surface (`#e9edf0` light, `#21262d` dark). Series
still use labels, tooltips, and accessible data tables rather than color alone.

That contrast holds for strokes, not for compounded fills. Where several series
overlap without stacking — the Pay down page's per-account payoff curves —
translucent fills pile up into one flat tint that no longer separates the
tokens, so those series render as strokes alone and only a lone series takes a
filled gradient. Stacked or single-series charts (Reports cash flow, net worth)
keep their gradient fills, since nothing overlaps to compound.

## Rules

1. Define palette values only in `src/ui/src/styles.css`; do not place hex
   colors in component files.
2. Update this file whenever palette values or theme behavior change.
3. Amber/primary buttons use dark text, never white.
4. Prefer semantic classes for surfaces, body text, and borders.
5. Use explicit light and `dark:` pairs for accent treatments that are not
   represented by semantic classes.
6. Meaningful normal text, including tertiary and muted labels, must maintain
   at least 4.5:1 against its surface. Decorative content may use opacity only
   when it does not communicate information.
7. Interactive control boundaries and focus indicators must maintain at least
   3:1 against adjacent surfaces. Use `--border-control` and `--focus-ring`;
   `--border-default` remains available for non-interactive dividers.
8. The global focus default excludes `tabindex="-1"` containers and components
   with explicit `focus-visible:outline-none` or `focus-visible:ring-*` styles,
   preventing a second indicator from being layered over component-owned rings.
9. If either page canvas changes, update the pre-paint script's `theme-color`
   values and the applicable static manifest color.
10. Composite inputs keep their control border neutral and place the focus
    outline on their shared wrapper so icons and text fields receive one
    continuous focus indicator.

## Verification

```bash
bun run lint
bun run typecheck
(cd src/ui && bun run build)
```

Confirm that system mode reacts without reload, explicit modes ignore OS
changes, reloads do not flash the opposite theme, and the profile menu remains
usable by keyboard and on mobile.
