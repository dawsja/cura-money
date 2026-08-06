import { z } from 'zod';

const CENTS_PER_DOLLAR = 100;
const APR_SCALE = 10_000_000_000;

export const MAX_MONEY = 90_000_000_000_000;

function hasExactScale(value: number, scale: number): boolean {
  const scaled = value * scale;
  const rounded = Math.round(scaled);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * scale;
  return Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) <= tolerance;
}

const centPrecision = (value: number) => hasExactScale(value, CENTS_PER_DOLLAR);
const centPrecisionMessage = 'amount must have at most 2 decimal places';

export const signedMoneyAmount = z
  .number()
  .finite()
  .min(-MAX_MONEY)
  .max(MAX_MONEY)
  .refine(centPrecision, centPrecisionMessage);

export const moneyAmount = z
  .number()
  .finite()
  .min(0)
  .max(MAX_MONEY)
  .refine(centPrecision, centPrecisionMessage);

export const positiveMoneyAmount = z
  .number()
  .finite()
  .positive()
  .max(MAX_MONEY)
  .refine(centPrecision, centPrecisionMessage);

/** APR is stored as a decimal in PostgreSQL numeric(12,10). */
export const aprRate = z
  .number()
  .finite()
  .min(0)
  .max(1)
  .refine((value) => hasExactScale(value, APR_SCALE), 'APR must have at most 10 decimal places');

/** Convert a dollar value with at most two decimal places to integer cents. */
export function dollarsToCents(value: number | string): number {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
    if (!match) throw new Error('amount must be a finite dollar value with at most 2 decimal places');

    const whole = Number(match[2]);
    const fraction = Number((match[3] ?? '').padEnd(2, '0'));
    const cents = whole * CENTS_PER_DOLLAR + fraction;
    const signed = match[1] === '-' ? -cents : cents;
    if (!Number.isSafeInteger(signed)) throw new Error('amount is outside the supported range');
    return signed;
  }

  if (!Number.isFinite(value)) throw new Error('amount must be finite');
  const cents = Math.round(value * CENTS_PER_DOLLAR);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * CENTS_PER_DOLLAR;
  if (Math.abs(value * CENTS_PER_DOLLAR - cents) > tolerance) {
    throw new Error('amount must have at most 2 decimal places');
  }
  if (!Number.isSafeInteger(cents)) throw new Error('amount is outside the supported range');
  return cents;
}

/** Convert stored integer cents to the public dollar-valued contract. */
export function centsToDollars(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error('stored amount cents is outside the supported range');
  return value / CENTS_PER_DOLLAR;
}
