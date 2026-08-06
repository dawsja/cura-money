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
| Primary text | `#20262c` | `#c9d1d9` | `--fg-primary` |
| Secondary text | `#43515c` | `#8b949e` | `--fg-secondary` |
| Tertiary text | `#485661` | `#6e7681` | `--fg-tertiary` |
| Muted text | `#4f5d68` | `#484f58` | `--fg-muted` |
| Coffee accent | `#8b5e34` | `#c58b5a` | `--coffee-accent` |

Exposed semantic classes include `.fg-primary`, `.fg-secondary`,
`.fg-tertiary`, `.fg-muted`, `.bg-page`, `.bg-canvas-subtle`, `.bg-surface`,
`.border-default`, and `.coffee-accent`.

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

## Rules

1. Define palette values only in `src/ui/src/styles.css`; do not place hex
   colors in component files.
2. Update this file whenever palette values or theme behavior change.
3. Amber/primary buttons use dark text, never white.
4. Prefer semantic classes for surfaces, body text, and borders.
5. Use explicit light and `dark:` pairs for accent treatments that are not
   represented by semantic classes.
6. Keep body-text contrast at least 4.5:1 and control/border contrast clear in
   both themes.
7. If either page canvas changes, update the pre-paint script's `theme-color`
   values and the applicable static manifest color.

## Verification

```bash
bun run lint
bun run typecheck
(cd src/ui && bun run build)
```

Confirm that system mode reacts without reload, explicit modes ignore OS
changes, reloads do not flash the opposite theme, and the profile menu remains
usable by keyboard and on mobile.
