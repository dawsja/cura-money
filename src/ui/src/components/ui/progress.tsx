"use client"

import * as React from "react"
import { cn } from "cn"
import { Progress as ProgressPrimitive } from "radix-ui"

const TONE_CLASS = {
  amber: "bg-primary",
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
  slate: "bg-slate-500",
} as const

function Progress({
  className,
  value,
  tone = "amber",
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  tone?: keyof typeof TONE_CLASS
}) {
  const clamped = Math.min(100, Math.max(0, Number(value) || 0))
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative flex h-2 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      value={clamped}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn("size-full flex-1 transition-all", TONE_CLASS[tone])}
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
