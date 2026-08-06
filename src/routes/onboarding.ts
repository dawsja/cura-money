import { Hono } from 'hono';
import { z } from 'zod';
import { getSetting, setSetting } from '@/db/queries';
import { badRequest, safe } from '@/lib/errors';
import { userId } from '@/lib/tenant';

export const onboardingRoutes = new Hono();

const ONBOARDING_KEY = 'financial_onboarding';
const Step = z.enum([
  'welcome',
  'accounts',
  'connect',
  'manual-account',
  'classify',
  'categories',
  'review',
  'transactions',
  'rules',
  'budget-income',
  'budget-expense',
  'paydown',
  'saveup',
  'reports',
  'recurring',
  'complete',
]);
const OnboardingState = z.object({
  version: z.literal(2),
  runId: z.string().uuid().nullable(),
  status: z.enum(['pending', 'in_progress', 'completed', 'dismissed']),
  currentStep: Step,
  skippedSteps: z.array(Step).max(Step.options.length),
}).refine(
  ({ skippedSteps }) => new Set(skippedSteps).size === skippedSteps.length,
  'skipped steps must be unique',
).superRefine((state, ctx) => {
  if (state.status === 'pending' && state.currentStep !== 'welcome') {
    ctx.addIssue({ code: 'custom', message: 'pending onboarding must be at the welcome step' });
  }
  if (state.status === 'completed' && state.currentStep !== 'complete') {
    ctx.addIssue({ code: 'custom', message: 'completed onboarding must be at the complete step' });
  }
});

const UpdateRequest = z.object({
  state: OnboardingState,
  restart: z.boolean().optional().default(false),
});

type OnboardingState = z.infer<typeof OnboardingState>;

const DEFAULT_STATE: OnboardingState = {
  version: 2,
  runId: null,
  status: 'pending',
  currentStep: 'welcome',
  skippedSteps: [],
};

function parseStoredState(raw: string | null): OnboardingState {
  if (!raw) return DEFAULT_STATE;
  try {
    const parsed = OnboardingState.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

onboardingRoutes.get(
  '/',
  safe(async (c) => {
    const raw = await getSetting(userId(c), ONBOARDING_KEY);
    return c.json(parseStoredState(raw));
  }),
);

onboardingRoutes.put(
  '/',
  safe(async (c) => {
    const parsed = UpdateRequest.safeParse(await c.req.json());
    if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'invalid onboarding state');

    const id = userId(c);
    const current = parseStoredState(await getSetting(id, ONBOARDING_KEY));
    const next = resolveTransition(current, parsed.data.state, parsed.data.restart);
    await setSetting(id, ONBOARDING_KEY, JSON.stringify(next));
    return c.json(next);
  }),
);

function resolveTransition(current: OnboardingState, requested: OnboardingState, restart: boolean): OnboardingState {
  if (restart) return { ...requested, status: 'in_progress', currentStep: 'accounts', skippedSteps: [] };
  if (current.status === 'completed' || current.status === 'dismissed') return current;
  if (current.status === 'pending') return requested;
  if (requested.runId !== current.runId) return current;
  if (requested.status === 'completed' || requested.status === 'dismissed') return requested;

  const currentIndex = Step.options.indexOf(current.currentStep);
  const requestedIndex = Step.options.indexOf(requested.currentStep);
  return requestedIndex >= currentIndex ? requested : current;
}
