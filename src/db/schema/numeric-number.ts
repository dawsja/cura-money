import { customType } from 'drizzle-orm/pg-core';

type NumericNumberConfig = {
  precision: number;
  scale: number;
};

/** Numeric number mode for the Drizzle version currently used by the app. */
export const numericNumber = customType<{
  data: number;
  driverData: string;
  config: NumericNumberConfig;
  configRequired: true;
}>({
  dataType: ({ precision, scale }) => `numeric(${precision},${scale})`,
  fromDriver: (value) => Number(value),
  toDriver: (value) => String(value),
});
