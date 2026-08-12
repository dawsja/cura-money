import { motion, useReducedMotion } from 'motion/react';

/** Rainbow XP-style bar used on Save up cards and the dashboard widget. */
export function GoalProgressBar({
  value,
  celebrate = false,
  className,
}: {
  value: number;
  celebrate?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className={className}>
      <div
        className="relative h-3 rounded-full bg-slate-200 dark:bg-slate-700"
        role="progressbar"
        aria-label="Goal progress"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div
          className="goal-progress-gradient absolute inset-0 overflow-hidden rounded-full"
          initial={reduceMotion ? false : { clipPath: 'inset(0 100% 0 0)' }}
          animate={{ clipPath: `inset(0 ${100 - clamped}% 0 0)` }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          {!reduceMotion && (
            <motion.div
              key={`${Math.round(clamped)}-${celebrate}`}
              className="absolute inset-y-0 w-1/4 -skew-x-12 bg-white/30"
              initial={{ x: '-120%' }}
              animate={{ x: '500%' }}
              transition={{ duration: 0.75, delay: 0.55, ease: 'easeInOut' }}
            />
          )}
        </motion.div>
      </div>
    </div>
  );
}
