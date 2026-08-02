/**
 * INITIAL_CATEGORIES — the default category tree seeded for every new user
 * the first time they hit the app (see `seedInitialCategoriesIfEmpty` in
 * `db/queries.ts`).
 *
 * Structure mirrors Monarch's default groups: each top-level entry is a
 * "group" the user sees on the Budget / Categories page, and its
 * `subCategories` are the leaf buckets the user actually assigns to
 * transactions. `planned` is the per-sub budget — Monarch leaves these
 * at 0 so the user sets their own; we do the same.
 *
 * The Transfer group is its own `type` ("transfer"), excluded from
 * income/expense totals so credit card payments and account-to-account
 * moves don't double-count. `applyTransferMigration` in `db/migrate.ts`
 * also looks up a category named "Transfer" with type "transfer" — keep
 * that name (singular) so the lookup hits for both new and existing
 * users.
 */
export interface SeedSubCategory {
  id: string;
  name: string;
  planned: number;
}

export interface SeedCategory {
  id: string;
  name: string;
  type: 'income' | 'expense' | 'transfer';
  subCategories: SeedSubCategory[];
}

export const INITIAL_CATEGORIES: SeedCategory[] = [
  // --- Income ---------------------------------------------------------
  {
    id: 'cat-income',
    name: 'Income',
    type: 'income',
    subCategories: [
      { id: 'sub-paychecks', name: 'Paychecks', planned: 0 },
      { id: 'sub-interest', name: 'Interest', planned: 0 },
      { id: 'sub-business-income', name: 'Business Income', planned: 0 },
      { id: 'sub-other-income', name: 'Other Income', planned: 0 },
    ],
  },

  // --- Expense groups -------------------------------------------------
  {
    id: 'cat-gifts-donations',
    name: 'Gifts & Donations',
    type: 'expense',
    subCategories: [
      { id: 'sub-charity', name: 'Charity', planned: 0 },
      { id: 'sub-gifts', name: 'Gifts', planned: 0 },
    ],
  },
  {
    id: 'cat-auto-transport',
    name: 'Auto & Transport',
    type: 'expense',
    subCategories: [
      { id: 'sub-auto-payment', name: 'Auto Payment', planned: 0 },
      { id: 'sub-public-transit', name: 'Public Transit', planned: 0 },
      { id: 'sub-gas-fuel', name: 'Gas', planned: 0 },
      { id: 'sub-auto-maintenance', name: 'Auto Maintenance', planned: 0 },
      { id: 'sub-parking-tolls', name: 'Parking & Tolls', planned: 0 },
      { id: 'sub-taxi-rideshares', name: 'Taxi & Ride Shares', planned: 0 },
    ],
  },
  {
    id: 'cat-housing',
    name: 'Housing',
    type: 'expense',
    subCategories: [
      { id: 'sub-mortgage', name: 'Mortgage', planned: 0 },
      { id: 'sub-rent', name: 'Rent', planned: 0 },
      { id: 'sub-home-improvement', name: 'Home Improvement', planned: 0 },
    ],
  },
  {
    id: 'cat-bills-utilities',
    name: 'Bills & Utilities',
    type: 'expense',
    subCategories: [
      { id: 'sub-garbage', name: 'Garbage', planned: 0 },
      { id: 'sub-water', name: 'Water', planned: 0 },
      { id: 'sub-gas-electric', name: 'Gas & Electric', planned: 0 },
      { id: 'sub-internet-cable', name: 'Internet & Cable', planned: 0 },
      { id: 'sub-phone', name: 'Phone', planned: 0 },
    ],
  },
  {
    id: 'cat-food-dining',
    name: 'Food & Dining',
    type: 'expense',
    subCategories: [
      { id: 'sub-groceries', name: 'Groceries', planned: 0 },
      { id: 'sub-restaurants-bars', name: 'Restaurants & Bars', planned: 0 },
      { id: 'sub-coffee-shops', name: 'Coffee Shops', planned: 0 },
    ],
  },
  {
    id: 'cat-travel-lifestyle',
    name: 'Travel & Lifestyle',
    type: 'expense',
    subCategories: [
      { id: 'sub-travel-vacation', name: 'Travel & Vacation', planned: 0 },
      { id: 'sub-entertainment', name: 'Entertainment & Recreation', planned: 0 },
      { id: 'sub-personal', name: 'Personal', planned: 0 },
      { id: 'sub-pets', name: 'Pets', planned: 0 },
      { id: 'sub-fun-money', name: 'Fun Money', planned: 0 },
    ],
  },
  {
    id: 'cat-shopping',
    name: 'Shopping',
    type: 'expense',
    subCategories: [
      { id: 'sub-shopping', name: 'Shopping', planned: 0 },
      { id: 'sub-clothing', name: 'Clothing', planned: 0 },
      { id: 'sub-furniture-housewares', name: 'Furniture & Housewares', planned: 0 },
      { id: 'sub-electronics', name: 'Electronics', planned: 0 },
    ],
  },
  {
    id: 'cat-children',
    name: 'Children',
    type: 'expense',
    subCategories: [
      { id: 'sub-child-care', name: 'Child Care', planned: 0 },
      { id: 'sub-child-activities', name: 'Child Activities', planned: 0 },
    ],
  },
  {
    id: 'cat-education',
    name: 'Education',
    type: 'expense',
    subCategories: [
      { id: 'sub-student-loans', name: 'Student Loans', planned: 0 },
      { id: 'sub-education', name: 'Education', planned: 0 },
    ],
  },
  {
    id: 'cat-health-wellness',
    name: 'Health & Wellness',
    type: 'expense',
    subCategories: [
      { id: 'sub-medical', name: 'Medical', planned: 0 },
      { id: 'sub-dentist', name: 'Dentist', planned: 0 },
      { id: 'sub-fitness', name: 'Fitness', planned: 0 },
    ],
  },
  {
    id: 'cat-financial',
    name: 'Financial',
    type: 'expense',
    subCategories: [
      { id: 'sub-loan-repayment', name: 'Loan Repayment', planned: 0 },
      { id: 'sub-financial-legal', name: 'Financial & Legal Services', planned: 0 },
      { id: 'sub-financial-fees', name: 'Financial Fees', planned: 0 },
      { id: 'sub-cash-atm', name: 'Cash & ATM', planned: 0 },
      { id: 'sub-insurance', name: 'Insurance', planned: 0 },
      { id: 'sub-taxes', name: 'Taxes', planned: 0 },
    ],
  },
  {
    id: 'cat-other',
    name: 'Other',
    type: 'expense',
    subCategories: [
      { id: 'sub-uncategorized', name: 'Uncategorized', planned: 0 },
      { id: 'sub-check', name: 'Check', planned: 0 },
      { id: 'sub-miscellaneous', name: 'Miscellaneous', planned: 0 },
    ],
  },
  {
    id: 'cat-business',
    name: 'Business',
    type: 'expense',
    subCategories: [
      { id: 'sub-advertising-promotion', name: 'Advertising & Promotion', planned: 0 },
      { id: 'sub-business-utilities', name: 'Business Utilities & Communication', planned: 0 },
      { id: 'sub-employee-wages', name: 'Employee Wages & Contract Labor', planned: 0 },
      { id: 'sub-business-travel', name: 'Business Travel & Meals', planned: 0 },
      { id: 'sub-business-auto', name: 'Business Auto Expenses', planned: 0 },
      { id: 'sub-business-insurance', name: 'Business Insurance', planned: 0 },
      { id: 'sub-office-supplies', name: 'Office Supplies & Expenses', planned: 0 },
      { id: 'sub-office-rent', name: 'Office Rent', planned: 0 },
      { id: 'sub-postage-shipping', name: 'Postage & Shipping', planned: 0 },
    ],
  },

  // --- Transfers ------------------------------------------------------
  // Credit card payments, account-to-account moves, balance adjustments.
  // Excluded from income/expense totals. `applyTransferMigration` in
  // `db/migrate.ts` looks this up by name (singular) — keep the name
  // stable so the post-migration check is a no-op for new users.
  {
    id: 'cat-transfer',
    name: 'Transfer',
    type: 'transfer',
    subCategories: [
      { id: 'sub-account-transfer', name: 'Account Transfer', planned: 0 },
      { id: 'sub-credit-card-payment', name: 'Credit Card Payment', planned: 0 },
      { id: 'sub-balance-adjustments', name: 'Balance Adjustments', planned: 0 },
    ],
  },
];
