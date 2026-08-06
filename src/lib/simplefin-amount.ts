const MAX_ABSOLUTE_DOLLARS = 1_000_000_000;

/** Bank feeds may include fractional minor units; normalize them to ledger cents. */
export function simpleFinAmountToCents(value: string | number): number {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || Math.abs(amount) > MAX_ABSOLUTE_DOLLARS) {
    throw new RangeError('SimpleFIN transaction amount is outside the supported range.');
  }
  const cents = Math.sign(amount) * Math.round((Math.abs(amount) + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError('SimpleFIN transaction amount is invalid.');
  }
  return cents;
}
