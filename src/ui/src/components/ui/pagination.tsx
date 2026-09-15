import * as React from "react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react"

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  )
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex items-center gap-0.5", className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
  disabled?: boolean
  href?: string
  onClick?: () => void
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  Omit<React.ComponentProps<"a">, "href" | "onClick">

function PaginationLink({
  className,
  isActive,
  size = "icon",
  href,
  disabled,
  onClick,
  ...props
}: PaginationLinkProps) {
  if (href) {
    return (
      <Button
        asChild
        variant={isActive ? "outline" : "ghost"}
        size={size}
        className={cn(className)}
      >
        <a
          href={href}
          aria-current={isActive ? "page" : undefined}
          aria-disabled={disabled || undefined}
          data-slot="pagination-link"
          data-active={isActive}
          onClick={(event) => {
            if (disabled) {
              event.preventDefault()
              return
            }
            onClick?.()
          }}
          {...props}
        />
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant={isActive ? "outline" : "ghost"}
      size={size}
      disabled={disabled}
      aria-current={isActive ? "page" : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      className={cn(className)}
      onClick={() => {
        if (disabled) return
        onClick?.()
      }}
    >
      {props.children}
    </Button>
  )
}

function PaginationPrevious({
  className,
  text = "Previous",
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="default"
      className={cn("pl-1.5!", className)}
      {...props}
    >
      <ChevronLeftIcon data-icon="inline-start" />
      <span className="hidden sm:block">{text}</span>
    </PaginationLink>
  )
}

function PaginationNext({
  className,
  text = "Next",
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="default"
      className={cn("pr-1.5!", className)}
      {...props}
    >
      <span className="hidden sm:block">{text}</span>
      <ChevronRightIcon data-icon="inline-end" />
    </PaginationLink>
  )
}

function PaginationEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn(
        "flex size-8 items-center justify-center [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <MoreHorizontalIcon
      />
      <span className="sr-only">More pages</span>
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}

/** Visible page-number window with ellipsis collapsing. */
export function pageWindow(
  page: number,
  totalPages: number,
  siblingCount = 1,
): Array<number | "ellipsis"> {
  if (totalPages <= 1) return [1]
  const totalNumbers = siblingCount * 2 + 5
  if (totalPages <= totalNumbers) {
    const out: number[] = []
    for (let i = 1; i <= totalPages; i++) out.push(i)
    return out
  }

  const leftSibling = Math.max(page - siblingCount, 1)
  const rightSibling = Math.min(page + siblingCount, totalPages)
  const showLeftEllipsis = leftSibling > 2
  const showRightEllipsis = rightSibling < totalPages - 1

  const out: Array<number | "ellipsis"> = []
  out.push(1)
  if (showLeftEllipsis) out.push("ellipsis")
  for (let i = leftSibling; i <= rightSibling; i++) {
    if (i === 1 || i === totalPages) continue
    out.push(i)
  }
  if (showRightEllipsis) out.push("ellipsis")
  if (totalPages > 1) out.push(totalPages)
  return out
}
