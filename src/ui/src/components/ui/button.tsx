/**
 * shadcn-style Button — the project's variant/size matrix follows the
 * standard shadcn naming (`default`, `outline`, `ghost`, `destructive`,
 * `secondary` × `sm`, `default`, `lg`, `icon`) but is implemented
 * without `@radix-ui/react-slot`. `asChild` accepts a pre-rendered
 * child element and merges className/event handlers onto it (the
 * render-prop shadcn pattern uses for `DropdownMenuTrigger render={…}`).
 *
 * Colors:
 *   - `default` = amber-500 + dark text (9.4:1 contrast — Hard Rule #22).
 *   - `outline` = slate border + fg-primary text on bg-surface.
 *   - `ghost`   = transparent + fg-secondary text, surface on hover.
 *   - `destructive` = rose-600 + white text (rose-600/white = 5.7:1 ✓ AA).
 *
 * `icon` size rounds to a square and centers the icon; combined with
 * `ghost` it's the default for toolbar buttons (the month picker uses
 * exactly this combination).
 */
import * as React from 'react';
import clsx from 'clsx';

type ButtonVariant = 'default' | 'outline' | 'ghost' | 'secondary' | 'destructive';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default:
    'bg-amber-500 text-slate-900 hover:bg-amber-600 focus-visible:ring-amber-500',
  outline:
    'border border-default bg-surface fg-primary hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:ring-amber-500',
  ghost:
    'fg-secondary hover:bg-slate-100 dark:hover:bg-slate-700 hover:fg-primary focus-visible:ring-amber-500',
  secondary:
    'bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 focus-visible:ring-amber-500',
  destructive:
    'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  default: 'h-11 px-4 text-sm md:h-9',
  sm: 'h-11 px-3 text-xs md:h-8',
  lg: 'h-12 px-6 text-base md:h-10',
  icon: 'h-11 w-11 p-0 md:h-9 md:w-9',
};

const BASE_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-[var(--bg-page)] ' +
  'disabled:pointer-events-none disabled:opacity-50';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}

/**
 * Render-prop shim for `asChild`. The shadcn reference accepts a child
 * element and clones it with the merged className + handlers. We
 * avoid pulling in `@radix-ui/react-slot` for one tiny merge — `cloneElement`
 * is enough for our use cases (DropdownMenuTrigger, Link wrapping).
 */
function mergeWithChild(
  child: React.ReactElement,
  extra: { className?: string; onClick?: React.MouseEventHandler<HTMLElement> },
): React.ReactElement {
  const existing = (child.props as { className?: string }).className ?? '';
  return React.cloneElement(child, {
    className: clsx(existing, extra.className),
    onClick: extra.onClick,
  } as React.Attributes);
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'default', size = 'default', asChild = false, children, ...props },
  ref,
) {
  const cls = clsx(BASE_CLASS, VARIANT_CLASS[variant], SIZE_CLASS[size], className);

  if (asChild && React.isValidElement(children)) {
    return mergeWithChild(children, { className: cls, onClick: props.onClick });
  }

  return (
    <button ref={ref} className={cls} {...props}>
      {children}
    </button>
  );
});
