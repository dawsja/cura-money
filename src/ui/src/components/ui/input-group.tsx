/**
 * shadcn-style InputGroup — a single rounded control that wraps an
 * input with optional icon or text addons on either side.
 *
 * Layout: a flex row whose children line up horizontally. The wrapper
 * owns the visible border + bg; addons are borderless, transparent,
 * and inherit the wrapper's height/padding so the whole group reads
 * as one continuous control.
 *
 * Usage:
 *
 *   <InputGroup className="max-w-xs">
 *     <InputGroupAddon><Search /></InputGroupAddon>
 *     <InputGroupInput placeholder="Filter…" value={q} onChange={...} />
 *     <InputGroupAddon align="inline-end">12 results</InputGroupAddon>
 *   </InputGroup>
 *
 * Focus handling: the wrapper applies the amber border on
 * `focus-within` so the visual focus cue follows whichever descendant
 * (typically the input) is actually focused. Individual children
 * strip their own border + outline so there's no double border or
 * conflicting focus ring.
 *
 * Matches the project's existing INPUT_CLS treatment (rounded-lg +
 * bg-surface + border-default + focus amber), just split across
 * wrapper / children so addons can sit inside the same control.
 */
import * as React from 'react';
import clsx from 'clsx';

export function InputGroup({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="input-group"
      className={clsx(
        // Visible border + background live on the wrapper so addons
        // and the input read as one control. focus-within promotes
        // the same amber border the existing INPUT_CLS uses; the
        // inner input strips its own outline to avoid double-stacking.
        'flex items-stretch w-full rounded-lg border border-default bg-surface',
        'transition-colors focus-within:border-amber-500',
        'has-[>input:disabled]:opacity-50 has-[>input:disabled]:cursor-not-allowed',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Decorative or interactive content inside the group. Default align
 * is `inline-start` (prefix, left side); pass `align="inline-end"`
 * for a suffix (right side).
 *
 * Addons inherit the wrapper's bg-surface so they look like part of
 * the same control. They have no border, no outline, and zero
 * horizontal padding of their own — the spacing comes from the
 * wrapper's gap so adjacent addons don't visually merge.
 */
export function InputGroupAddon({
  align = 'inline-start',
  className,
  children,
}: {
  align?: 'inline-start' | 'inline-end';
  className?: string;
  children: React.ReactNode;
}) {
  return (
<div
        data-slot="input-group-addon"
        data-align={align}
        className={clsx(
          'flex items-center fg-muted text-sm shrink-0',
          align === 'inline-start' ? 'pl-3' : 'pr-3',
          className,
        )}
      >
        {children}
      </div>
  );
}

/**
 * The actual input. Strips its own border + bg + outline so the
 * wrapper is the only source of those properties — keeps the visual
 * "single control" illusion. Padding is reduced (vs. INPUT_CLS)
 * because the wrapper and addons already provide the breathing room.
 */
export const InputGroupInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function InputGroupInput({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      data-slot="input-group-input"
      className={clsx(
        'flex-1 min-w-0 bg-transparent border-0 outline-none',
        'fg-primary placeholder-slate-400',
        'px-3 py-2 text-sm rounded-lg',
        'focus:outline-none focus:ring-0',
        className,
      )}
      {...props}
    />
  );
});