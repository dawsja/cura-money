/**
 * /api/paydown — Monarch-style debt paydown.
 *
 *   - GET    /accounts      → liability accounts (credit + loan) with
 *                             paydown fields.
 *   - GET    /projection    → current projection under "Planned".
 *   - POST   /simulate      → projection under a chosen method + extras.
 *   - PATCH  /account/:id   → edit interest / min / planned / include.
 *
 * The calculator is in @/lib/paydown and is a pure function — the routes
 * just translate HTTP → function args and persist side effects.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  getLiabilityAccounts,
  getAccount,
  editAccountPaydown,
  getPaydownModalData,
  syncMonthlyPaydown,
  syncMonthlyPaydownWithScenario,
} from '@/db/queries';
import {
  projectPaydown,
  type PaydownAccount,
  type PaydownMethod,
  type PaydownParams,
  type PaydownProjection,
} from '@/lib/paydown';
import { userId, routeParam } from '@/lib/tenant';
import { badRequest, safe } from '@/lib/errors';

export const paydownRoutes = new Hono();

function toPaydownAccount(row: {
  id: string;
  name: string;
  type: string;
  balance: number;
  interestRate: number;
  minPayment: number;
  plannedPayment: number;
  includeInPaydown: boolean;
}): PaydownAccount {
  return {
    id: row.id,
    name: row.name,
    type: row.type === 'loan' ? 'loan' : 'credit',
    balance: row.balance,
    apr: row.interestRate,
    minPayment: row.minPayment,
    plannedPayment: row.plannedPayment,
    includeInPaydown: row.includeInPaydown,
  };
}

const Method = z.enum(['planned', 'avalanche', 'snowball']);
const SimulateSchema = z.object({
  method: Method,
  monthlyExtra: z.number().finite().min(0).default(0),
  oneTimeExtra: z.number().finite().min(0).default(0),
});
const EditPaydownSchema = z
  .object({
    interestRate: z.number().finite().min(0).max(1).optional(),
    minPayment: z.number().finite().min(0).optional(),
    plannedPayment: z.number().finite().min(0).optional(),
    includeInPaydown: z.boolean().optional(),
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), { message: 'empty patch' });

// GET /api/paydown/accounts — every credit + loan account, including
// ones the user has excluded (so the UI can render the "Manage" list).
paydownRoutes.get(
  '/accounts',
  safe(async (c) => c.json(await getLiabilityAccounts(userId(c)))),
);

// GET /api/paydown/projection — Planned-only projection. The page calls
// this once on mount to populate the chart, then POSTs /simulate for
// each calculator tweak.
paydownRoutes.get(
  '/projection',
  safe(async (c) => {
    const accts = await getLiabilityAccounts(userId(c));
    if (accts.length === 0) {
      return c.json(emptyProjection('planned', { method: 'planned', monthlyExtra: 0, oneTimeExtra: 0 }));
    }
    const projection = projectPaydown(accts.map(toPaydownAccount), { method: 'planned', monthlyExtra: 0, oneTimeExtra: 0 });
    return c.json(projection);
  }),
);

// POST /api/paydown/simulate — body: { method, monthlyExtra, oneTimeExtra }.
paydownRoutes.post(
  '/simulate',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = SimulateSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const accts = await getLiabilityAccounts(userId(c));
    if (accts.length === 0) {
      return c.json(emptyProjection(parsed.data.method, parsed.data));
    }
    const params: PaydownParams = {
      method: parsed.data.method as PaydownMethod,
      monthlyExtra: parsed.data.monthlyExtra,
      oneTimeExtra: parsed.data.oneTimeExtra,
    };
    const projection = projectPaydown(accts.map(toPaydownAccount), params);
    return c.json(projection);
  }),
);

// PATCH /api/paydown/account/:id — edit per-account paydown fields.
paydownRoutes.patch(
  '/account/:id',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = EditPaydownSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    // Credit / loan accounts must keep a non-zero minimum payment or
    // the planned-method projection never produces a payoff date and
    // the chart runs flat for the full 60-month horizon. Refuse the
    // save so the user can't put a debt account in an unprojectable
    // state. Other paydown fields (rate, planned, include) stay
    // freely editable even when minPayment is currently 0 — we only
    // block an explicit move toward 0.
    if (parsed.data.minPayment !== undefined && parsed.data.minPayment <= 0) {
      const existing = await getAccount(userId(c), routeParam(c, 'id'));
      if (existing && (existing.type === 'credit' || existing.type === 'loan')) {
        return badRequest(
          c,
          'Credit and loan accounts require a minimum payment greater than 0',
        );
      }
    }
    await editAccountPaydown(userId(c), routeParam(c, 'id'), parsed.data);
    return c.json({ ok: true });
  }),
);

const SnapshotSchema = z.object({
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/, 'yearMonth must be YYYY-MM'),
});

const SyncSchema = z.object({
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/, 'yearMonth must be YYYY-MM'),
  method: Method.optional(),
  monthlyExtra: z.number().finite().min(0).optional(),
  oneTimeExtra: z.number().finite().min(0).optional(),
});

// GET /api/paydown/snapshot/:yearMonth — modal data for the Budget page.
// Returns per-account planned (snapshot, falling back to
// `accounts.plannedPayment` when no snapshot exists), per-account actual
// (sum of transfers on the account in ym), and meta { syncedAt, rowCount }.
paydownRoutes.get(
  '/snapshot/:yearMonth',
  safe(async (c) => {
    const ym = routeParam(c, 'yearMonth');
    if (!/^\d{4}-\d{2}$/.test(ym)) return badRequest(c, 'yearMonth must be YYYY-MM');
    return c.json(await getPaydownModalData(userId(c), ym));
  }),
);

// POST /api/paydown/sync — Save-to-Budget action. Body
//   { yearMonth, method?, monthlyExtra?, oneTimeExtra? }.
// When method + extras are present the priority account (per the chosen
// method) absorbs the extra payment, capped at its remaining balance.
// Without method, every account just snapshots its plannedPayment.
// Returns { ok, rowCount, syncedAt }.
paydownRoutes.post(
  '/sync',
  safe(async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = SyncSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid input');
    const { yearMonth, method, monthlyExtra, oneTimeExtra } = parsed.data;
    if (method) {
      const result = await syncMonthlyPaydownWithScenario(
        userId(c),
        yearMonth,
        method,
        monthlyExtra ?? 0,
        oneTimeExtra ?? 0,
      );
      return c.json({ ok: true, rowCount: result.rowCount, syncedAt: result.syncedAt });
    }
    const result = await syncMonthlyPaydown(userId(c), yearMonth);
    return c.json({ ok: true, rowCount: result.rowCount, syncedAt: result.syncedAt });
  }),
);

function emptyProjection(method: PaydownMethod, params: PaydownParams): PaydownProjection {
  return {
    method,
    params,
    startingTotal: 0,
    totalInterest: 0,
    totalPaid: 0,
    monthsToDebtFree: 0,
    debtFreeMonth: null,
    perAccount: [],
    timeline: [],
    baselineTimeline: [],
    baselineTotalInterest: 0,
    baselineMonthsToDebtFree: 0,
    baselineDebtFreeMonth: null,
  };
}
