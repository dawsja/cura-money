/**
 * Paydown calculator — month-by-month debt simulation.
 *
 * Three methods (Monarch's "Pay down goals" terminology):
 *
 *   - Planned: pay the planned (or minimum) payment on each account, no
 *     rollover, no extra. Just project the schedule straight through.
 *
 *   - Avalanche: pay minimums on all accounts, then put the extra +
 *       any freed payments onto the highest-APR remaining balance. The
 *       classical "saves the most interest" strategy.
 *
 *   - Snowball: same logic but smallest-balance-first. Psychological
 *       "wins" as each account hits zero.
 *
 * All compounding is monthly. The interest accrued in a month is
 * `balance * (apr / 12)`, and we apply the payment after the interest
 * (standard US credit-card / loan convention).
 *
 * Returns a `Projection`:
 *   - per-account payoff months and total interest paid
 *   - aggregate timeline of (month, totalDebt) so the chart can plot
 *     one combined line, or we can render per-account lines
 *   - summary numbers for the dashboard cards
 *
 * Pure function: no DB, no IO. Caller passes in the accounts list and
 * the parameters (method, monthly extra, one-time extra). The HTTP
 * route is a thin wrapper around this.
 */

export type PaydownMethod = 'planned' | 'avalanche' | 'snowball';

export interface PaydownAccount {
  id: string;
  name: string;
  type: 'credit' | 'loan';
  balance: number;
  apr: number; // decimal, 0.18 = 18%
  minPayment: number;
  plannedPayment: number; // if 0, minPayment is used
  includeInPaydown: boolean;
}

export interface PaydownParams {
  method: PaydownMethod;
  monthlyExtra: number; // additional $/mo applied to the top-priority account (avalanche/snowball only)
  oneTimeExtra: number; // one-time lump sum applied in month 0 (avalanche/snowball only)
}

export interface PaydownAccountResult {
  accountId: string;
  name: string;
  startingBalance: number;
  apr: number;
  payoffMonth: string | null; // YYYY-MM or null if excluded
  monthsToPayoff: number | null; // 0 = already paid off
  totalInterest: number;
  totalPaid: number;
}

export interface PaydownPoint {
  month: string; // YYYY-MM
  totalDebt: number; // sum of remaining balances
  byAccount: Record<string, number>; // accountId -> remaining balance (excluded accounts not included)
}

export interface PaydownProjection {
  method: PaydownMethod;
  params: PaydownParams;
  startingTotal: number;
  totalInterest: number;
  totalPaid: number;
  monthsToDebtFree: number | null; // null if any account never pays off
  debtFreeMonth: string | null; // YYYY-MM
  perAccount: PaydownAccountResult[];
  timeline: PaydownPoint[]; // monthly snapshots
  // Simulated vs. baseline. baseline is the planned-only projection so
  // the chart can show both (dotted vs. solid) per Monarch's calculator UI.
  baselineTimeline: PaydownPoint[];
  baselineTotalInterest: number;
  baselineMonthsToDebtFree: number | null;
  baselineDebtFreeMonth: string | null;
}

const MAX_MONTHS = 12 * 40; // 40-year safety cap — auto-stops earlier when debts pay off
const HUNDRED = 100;

/**
 * Compute the priority order for avalanche/snowball. Single source of
 * truth shared by the simulator and by the Save-to-Budget scenario
 * allocation, so the budgeted amount lands on the same account the
 * projection targets.
 *
 * - Avalanche: highest APR first.
 * - Snowball:  smallest current balance first; tie-break by higher APR.
 * - Planned:   empty array — every account just pays its own amount.
 */
export function priorityOrder(
  method: PaydownMethod,
  activeAccounts: PaydownAccount[],
  currentBalances: Record<string, number>,
): string[] {
  if (method === 'planned') return [];
  if (method === 'avalanche') {
    return [...activeAccounts].sort((a, b) => b.apr - a.apr).map((a) => a.id);
  }
  // snowball
  return [...activeAccounts]
    .sort((a, b) => {
      const ba = currentBalances[a.id] ?? a.balance;
      const bb = currentBalances[b.id] ?? b.balance;
      if (ba !== bb) return ba - bb;
      return b.apr - a.apr;
    })
    .map((a) => a.id);
}

/**
 * Format a Date as YYYY-MM in the user's local zone.
 * Months are 1-indexed: January = "2026-01".
 */
function ymOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return out;
}

function totalDebtOf(remaining: Record<string, number>): number {
  let s = 0;
  for (const v of Object.values(remaining)) s += v;
  return s;
}

/**
 * Run a single month of the simulation. Mutates `remaining` and `interestAccrued`
 * in place. Returns the month label.
 *
 * Avalanche / Snowball order is passed in as `order` — the caller decides
 * the priority ranking (avalanche = highest APR first, snowball = smallest
 * balance first). Planned ignores `order` and just pays every account.
 */
function simulateMonth(
  remaining: Record<string, number>,
  interestAccrued: Record<string, number>,
  order: string[],
  method: PaydownMethod,
  monthlyExtraBudget: number,
  payments: Record<string, PayInfo>,
): { monthInterest: number; cashPaid: number } {
  let monthInterest = 0;
  let cashPaid = 0;
  // 1) Accrue interest on every still-positive balance.
  for (const id of Object.keys(remaining)) {
    if (remaining[id]! <= 0) continue;
    const acc = payments[id];
    if (!acc) continue;
    const i = remaining[id]! * (acc.apr / 12);
    remaining[id]! += i;
    interestAccrued[id] = (interestAccrued[id] ?? 0) + i;
    monthInterest += i;
  }
  // 2) Apply payments. Track actual cash paid this month so the
  // aggregate totalPaid equals the sum of cash that left the user's
  // account — not a capped projection of planned payments (which
  // would overcount when an account hits zero mid-stream and would
  // miss the user's monthlyExtra under avalanche/snowball).
  if (method === 'planned') {
    // Pay each account its planned (or minimum) amount. No rollover.
    for (const id of Object.keys(remaining)) {
      if (remaining[id]! <= 0) continue;
      const acc = payments[id]!;
      const pay = Math.min(remaining[id]!, acc.effectivePayment);
      remaining[id]! -= pay;
      cashPaid += pay;
    }
  } else {
    // Avalanche / Snowball: first ensure every account gets at least its
    // minimum, then throw all remaining cash at the top-priority
    // still-positive account. The pool is the user's "extra beyond
    // minimums" — computed by the caller as
    //   sum(effectivePayment) - sum(minPayment for positive accounts)
    //   + monthlyExtra
    // — so we just consume it here. The first pass only pays minimums
    // from each account's balance; the second pass pours the pool.
    let pool = monthlyExtraBudget;
    // First pass: minimums.
    for (const id of order) {
      if (remaining[id]! <= 0) continue;
      const acc = payments[id]!;
      const minPay = Math.min(remaining[id]!, acc.minPayment);
      remaining[id]! -= minPay;
      cashPaid += minPay;
    }
    // Second pass: pour pool into the top-priority still-positive.
    for (const id of order) {
      if (pool <= 0) break;
      if (remaining[id]! <= 0) continue;
      const pay = Math.min(remaining[id]!, pool);
      remaining[id]! -= pay;
      pool -= pay;
      cashPaid += pay;
    }
  }
  return { monthInterest, cashPaid };
}

interface PayInfo {
  apr: number;
  minPayment: number;
  effectivePayment: number; // planned if > 0, else min
}

/**
 * Run a full simulation and return the structured result.
 *
 * @param accounts The user's liability accounts. Anything with
 *                 `includeInPaydown: false` or `balance <= 0` is excluded
 *                 from the active set but listed in the per-account result
 *                 for completeness (so the UI can still render them).
 * @param params   Method + extra payment overrides.
 * @param startAt  The month the simulation starts (default: today).
 */
export function projectPaydown(
  accounts: PaydownAccount[],
  params: PaydownParams,
  startAt: Date = new Date(),
): PaydownProjection {
  const start = new Date(startAt.getFullYear(), startAt.getMonth(), 1);

  // Split into active (eligible) and excluded.
  const active = accounts.filter((a) => a.includeInPaydown && a.balance > 0);
  const excluded = accounts.filter((a) => !a.includeInPaydown || a.balance <= 0);

  // Compute the "planned" effective payment per account.
  const buildPayInfo = (a: PaydownAccount): PayInfo => ({
    apr: a.apr,
    minPayment: a.minPayment,
    effectivePayment: a.plannedPayment > 0 ? a.plannedPayment : a.minPayment,
  });

  // Compute the priority order for avalanche / snowball.
  const orderFor = (method: PaydownMethod, currentBalances: Record<string, number>): string[] => {
    if (method === 'planned') return []; // unused
    return priorityOrder(method, active, currentBalances);
  };

  /**
   * Run a full simulation under a given method, returning a parallel
   * array indexed by month (0 = start month).
   */
  function run(method: PaydownMethod, monthlyExtra: number, oneTimeExtra: number) {
    const remaining: Record<string, number> = {};
    const interestAccrued: Record<string, number> = {};
    const payments: Record<string, PayInfo> = {};
    for (const a of active) {
      remaining[a.id] = a.balance;
      interestAccrued[a.id] = 0;
      payments[a.id] = buildPayInfo(a);
    }
    const timeline: PaydownPoint[] = [];
    let totalInterest = 0;
    let totalPaid = 0;
    let oneTimeApplied = oneTimeExtra <= 0;
    let monthsToDebtFree: number | null = null;
    let debtFreeMonth: string | null = null;
    const monthInterestByAccount: Record<string, number> = {};
    for (const a of active) monthInterestByAccount[a.id] = 0;

    for (let m = 0; m < MAX_MONTHS; m++) {
      // Snapshot before this month's payments so the chart shows
      // the user's balance AT the start of each month.
      const snapshotBalances: Record<string, number> = { ...remaining };
      const snapMonth = addMonths(start, m);
      timeline.push({
        month: ymOf(snapMonth),
        totalDebt: totalDebtOf(snapshotBalances),
        byAccount: snapshotBalances,
      });
      if (totalDebtOf(remaining) <= 0.005) {
        // Already paid off — record the month if we haven't already and stop.
        if (monthsToDebtFree === null) {
          monthsToDebtFree = m;
          debtFreeMonth = ymOf(snapMonth);
        }
        break;
      }
      const order = orderFor(method, remaining);
      // Compute the month's pool and the user's monthly budget.
      //
      // userBudget = sum(effectivePayment) + monthlyExtra (planned skips
      // the extra per Monarch's design). This is the actual cash the
      // user is committed to putting on debt this month.
      //
      // pool = userBudget - sum(minPayment for still-positive accounts).
      // Every active account contributes its full effectivePayment to
      // the budget (the user committed to that money even on accounts
      // that may pay off this month), but only positive accounts force
      // a minimum. Subtracting minPayment only for positive accounts
      // makes the cascade automatic: when an account pays off, its freed
      // minimum flows into the pool for the top-priority pour.
      let userBudget = 0;
      for (const a of active) userBudget += payments[a.id]!.effectivePayment;
      let pool = userBudget;
      if (method !== 'planned') {
        pool += monthlyExtra;
        for (const a of active) {
          if (remaining[a.id]! > 0) {
            pool -= payments[a.id]!.minPayment;
          }
        }
      }
      // Apply the one-time extra as a payment to the top-priority account
      // on month 0.
      if (!oneTimeApplied && oneTimeExtra > 0) {
        const target = order[0];
        if (target) {
          const pay = Math.min(remaining[target] ?? 0, oneTimeExtra);
          remaining[target] = (remaining[target] ?? 0) - pay;
          totalPaid += pay;
        }
        oneTimeApplied = true;
      }
      const { monthInterest, cashPaid } = simulateMonth(remaining, interestAccrued, order, method, pool, payments);
      totalInterest += monthInterest;
      totalPaid += cashPaid;
    }
    // Per-account results.
    const perAccount: PaydownAccountResult[] = active.map((a) => {
      const payoffIdx = (() => {
        for (let i = 0; i < timeline.length; i++) {
          if ((timeline[i]!.byAccount[a.id] ?? 0) <= 0.005) return i;
        }
        return null;
      })();
      return {
        accountId: a.id,
        name: a.name,
        startingBalance: a.balance,
        apr: a.apr,
        payoffMonth: payoffIdx !== null ? timeline[payoffIdx]!.month : null,
        monthsToPayoff: payoffIdx,
        totalInterest: interestAccrued[a.id] ?? 0,
        totalPaid:
          (interestAccrued[a.id] ?? 0) +
          timeline.reduce((maxDrop, p) => {
            const b = p.byAccount[a.id] ?? 0;
            return Math.max(maxDrop, a.balance - b);
          }, 0),
      };
    });
    // Excluded accounts are listed with no payoff / no interest.
    for (const a of excluded) {
      perAccount.push({
        accountId: a.id,
        name: a.name,
        startingBalance: a.balance,
        apr: a.apr,
        payoffMonth: null,
        monthsToPayoff: null,
        totalInterest: 0,
        totalPaid: 0,
      });
    }
    return {
      perAccount,
      timeline,
      totalInterest,
      totalPaid,
      monthsToDebtFree,
      debtFreeMonth,
    };
  }

  // Run the user's chosen scenario.
  const scenario = run(params.method, params.monthlyExtra, params.oneTimeExtra);

  // Always also compute the "planned payments, no extras" baseline so the
  // UI can show the dotted "where you'd be without this scenario" line.
  const baseline = run('planned', 0, 0);

  const startingTotal = active.reduce((s, a) => s + a.balance, 0);

  return {
    method: params.method,
    params,
    startingTotal,
    totalInterest: scenario.totalInterest,
    totalPaid: scenario.totalPaid,
    monthsToDebtFree: scenario.monthsToDebtFree,
    debtFreeMonth: scenario.debtFreeMonth,
    perAccount: scenario.perAccount,
    timeline: scenario.timeline,
    baselineTimeline: baseline.timeline,
    baselineTotalInterest: baseline.totalInterest,
    baselineMonthsToDebtFree: baseline.monthsToDebtFree,
    baselineDebtFreeMonth: baseline.debtFreeMonth,
  };
}

// Re-export so the route can format things consistently.
export { ymOf, addMonths, MAX_MONTHS, HUNDRED };
