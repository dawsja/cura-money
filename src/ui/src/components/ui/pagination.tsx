/**
 * shadcn-style Pagination — numeric page links, prev/next, and an
 * ellipsis for collapsed windows.
 *
 * Used for table-style navigation (e.g. the Transactions list).
 * Designed to be controlled: the parent owns the current page and
 * provides an `onPageChange` callback. The link components accept
 * either an `onClick` handler (preferred for React state) or an
 * `href` (for server-rendered links).
 *
 * Usage:
 *
 *   const [page, setPage] = useState(1);
 *   const totalPages = Math.ceil(total / pageSize);
 *   <Pagination>
 *     <PaginationContent>
 *       <PaginationItem>
 *         <PaginationPrevious onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} />
 *       </PaginationItem>
 *       {pageNumbers({ page, totalPages }).map((n, i) =>
 *         n === 'ellipsis' ? (
 *           <PaginationItem key={`e-${i}`}><PaginationEllipsis /></PaginationItem>
 *         ) : (
 *           <PaginationItem key={n}>
 *             <PaginationLink isActive={n === page} onClick={() => setPage(n)}>{n}</PaginationLink>
 *           </PaginationItem>
 *         ),
 *       )}
 *       <PaginationItem>
 *         <PaginationNext onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} />
 *       </PaginationItem>
 *     </PaginationContent>
 *   </Pagination>
 */
import * as React from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';

export function Pagination({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      className={clsx('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  );
}

export function PaginationContent({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      className={clsx('flex flex-row items-center gap-1', className)}
      {...props}
    />
  );
}

export function PaginationItem({ className, ...props }: React.HTMLAttributes<HTMLLIElement>) {
  return <li className={clsx('', className)} {...props} />;
}

type PaginationLinkProps = {
  isActive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  href?: string;
  children: React.ReactNode;
  className?: string;
};

/**
 * Numeric page link. Uses an `<a>` when `href` is provided (so the
 * browser's middle-click / right-click "open in new tab" still works),
 * otherwise a `<button>` so onClick is the primary path. The
 * disabled state suppresses the click + adds 50% opacity per the
 * existing microinteraction grammar.
 */
export function PaginationLink({
  isActive = false,
  disabled = false,
  onClick,
  href,
  children,
  className,
}: PaginationLinkProps) {
  const base =
    'inline-flex items-center justify-center h-9 min-w-9 rounded-md text-sm font-medium tabular-nums ' +
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-page)]';
  const state = isActive
    ? 'bg-amber-500 text-slate-900 hover:bg-amber-600'
    : disabled
      ? 'fg-muted cursor-not-allowed opacity-50'
      : 'fg-secondary hover:bg-slate-100 dark:hover:bg-slate-700 hover:fg-primary';
  const cls = clsx(base, state, className);

  if (href !== undefined) {
    return (
      <a
        href={href}
        aria-current={isActive ? 'page' : undefined}
        aria-disabled={disabled || undefined}
        onClick={(e) => {
          if (disabled) {
            e.preventDefault();
            return;
          }
          onClick?.();
        }}
        className={cls}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      aria-current={isActive ? 'page' : undefined}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onClick?.();
      }}
      className={cls}
    >
      {children}
    </button>
  );
}

export function PaginationPrevious({ className, ...rest }: Omit<PaginationLinkProps, 'children'>) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      className={clsx('gap-1 px-2.5', className)}
      {...rest}
    >
      <ChevronLeft className="h-4 w-4" />
      <span className="hidden sm:inline">Previous</span>
    </PaginationLink>
  );
}

export function PaginationNext({ className, ...rest }: Omit<PaginationLinkProps, 'children'>) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      className={clsx('gap-1 px-2.5', className)}
      {...rest}
    >
      <span className="hidden sm:inline">Next</span>
      <ChevronRight className="h-4 w-4" />
    </PaginationLink>
  );
}

export function PaginationEllipsis({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      className={clsx('flex h-9 w-9 items-center justify-center fg-muted', className)}
      {...props}
    >
      <MoreHorizontal className="h-4 w-4" />
      <span className="sr-only">More pages</span>
    </span>
  );
}

/**
 * Compute the visible page-number window with ellipsis collapsing.
 * Returns an array of numbers (page) and the string `'ellipsis'`
 * for gaps. Always includes the first and last page so the user
 * can always jump to either edge.
 *
 * Examples:
 *   totalPages=10, page=1  → [1, 2, 3, '…', 10]
 *   totalPages=10, page=5  → [1, '…', 4, 5, 6, '…', 10]
 *   totalPages=3,  page=2  → [1, 2, 3]
 *   totalPages=1,  page=1  → [1]
 */
export function pageWindow(
  page: number,
  totalPages: number,
  siblingCount = 1,
): Array<number | 'ellipsis'> {
  if (totalPages <= 1) return [1];
  // Always show: 1, last, current, and `siblingCount` on each side
  // of current.
  const totalNumbers = siblingCount * 2 + 5; // first + last + current + 2*siblings + 2 ellipses
  if (totalPages <= totalNumbers) {
    const out: number[] = [];
    for (let i = 1; i <= totalPages; i++) out.push(i);
    return out;
  }

  const leftSibling = Math.max(page - siblingCount, 1);
  const rightSibling = Math.min(page + siblingCount, totalPages);
  const showLeftEllipsis = leftSibling > 2;
  const showRightEllipsis = rightSibling < totalPages - 1;

  const out: Array<number | 'ellipsis'> = [];
  out.push(1);
  if (showLeftEllipsis) out.push('ellipsis');
  for (let i = leftSibling; i <= rightSibling; i++) {
    if (i === 1 || i === totalPages) continue;
    out.push(i);
  }
  if (showRightEllipsis) out.push('ellipsis');
  if (totalPages > 1) out.push(totalPages);
  return out;
}
