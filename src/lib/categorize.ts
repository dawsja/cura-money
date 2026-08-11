/**
 * Smart merchant categoriser. Returns a *suggestion* — the UI can
 * override before save.
 *
 * The optional `type` field is a hint to the caller. When present, it
 * takes precedence over the caller-side amount-sign heuristic. This is
 * what catches credit card payments, which arrive on a credit/loan
 * account as a positive amount and would otherwise be misread as
 * "income" — they're not income, they're a transfer between two of the
 * user's own accounts.
 */
export interface CategorySuggestion {
  category: string;
  subCategory?: string;
  // Optional type override. Only set when the merchant signals a
  // transfer so the caller's income/expense heuristic can be bypassed.
  type?: 'income' | 'expense' | 'transfer';
}

/**
 * Payment / transfer patterns. These run BEFORE the income/expense
 * branches so a merchant like "Capital One - Credit Card Payment"
 * always lands as a transfer, never as income.
 *
 * The patterns are intentionally broad — false positives are safer
 * than false negatives here. A transaction misclassified as "transfer"
 * is invisible to income/expense totals; a transaction misclassified
 * as "income" inflates net cash flow. (See the original bug report:
 * a $579 credit card payment was being tallied as income.)
 */
const TRANSFER_MERCHANT_PATTERNS = [
  /\bpayment\b/i,
  /\bautopay\b/i,
  /\bauto pay\b/i,
  /\bpymt\b/i,
  /\bweb payment\b/i,
  /\bonline payment\b/i,
  /\bcc payment\b/i,
  /\bcredit card payment\b/i,
  /\bcard payment\b/i,
  /\bmobile payment\b/i,
  /\bpayment thank you\b/i,
  /\bthank you payment\b/i,
  /\bautopayment\b/i,
  /\bpay by phone\b/i,
  /\bbill pay\b/i,
  /\bbillpay\b/i,
  // "Transfer from / to" patterns are also strong signals.
  /\btransfer (from|to)\b/i,
  /\baccount transfer\b/i,
  /\binter-account\b/i,
  /\binterbank transfer\b/i,
  /\bwire transfer\b/i,
  /\bexternal transfer\b/i,
  /\binternal transfer\b/i,
  /\bpeer to peer\b/i,
  /\bp2p\b/i,
];

function looksLikeTransfer(merchantLower: string): boolean {
  for (const re of TRANSFER_MERCHANT_PATTERNS) {
    if (re.test(merchantLower)) return true;
  }
  return false;
}

export function smartCategorizeMerchant(merchantStr: string, amount: number): CategorySuggestion {
  const m = merchantStr.toLowerCase();

  // Transfer detection runs first. A merchant matching a payment /
  // transfer pattern is almost always moving money between two of the
  // user's own accounts regardless of which side the bank is showing.
  if (looksLikeTransfer(m)) {
    // Use the dedicated Transfer / Account Transfer bucket. The UI maps
    // this through the user's Transfer category (auto-seeded for new
    // users, inserted by migration 0008 for existing ones).
    return {
      category: 'Transfer',
      subCategory: '🔄 Account Transfer',
      type: 'transfer',
    };
  }

  const isIncome = amount > 0;

  if (isIncome) {
    if (m.includes('payroll') || m.includes('salary') || m.includes('direct deposit') || m.includes('paycheck') || m.includes('employer')) {
      return { category: 'Income', subCategory: '💵 Paychecks' };
    }
    if (m.includes('freelance') || m.includes('stripe') || m.includes('upwork') || m.includes('client')) {
      return { category: 'Income', subCategory: '💼 Business Income' };
    }
    if (m.includes('dividend') || m.includes('interest') || m.includes('yield')) {
      return { category: 'Income', subCategory: '🏦 Interest' };
    }
    return { category: 'Income', subCategory: '💰 Other Income' };
  }

  if (
    m.includes('trader joe') || m.includes('whole foods') || m.includes('kroger') ||
    m.includes('safeway') || m.includes('target') || m.includes('costco') ||
    m.includes('aldi') || m.includes('walmart') || m.includes('grocery') ||
    m.includes('supermarket')
  ) {
    return { category: 'Food & Dining', subCategory: '🛒 Groceries' };
  }

  if (
    m.includes('starbucks') || m.includes('mcdonald') || m.includes('chipotle') ||
    m.includes('uber eats') || m.includes('doordash') || m.includes('grubhub') ||
    m.includes('restaurant') || m.includes('cafe') || m.includes('dunkin') ||
    m.includes('pizza') || m.includes('burger')
  ) {
    return { category: 'Food & Dining', subCategory: '🍻 Restaurants & Bars' };
  }

  if (
    m.includes('chevron') || m.includes('shell') || m.includes('exxon') ||
    m.includes('bp') || m.includes('7-eleven') || m.includes('gas') ||
    m.includes('fuel') || m.includes('uber') || m.includes('lyft') ||
    m.includes('transit')
  ) {
    return { category: 'Auto & Transport', subCategory: '⛽ Gas' };
  }

  if (
    m.includes('electric') || m.includes('water') || m.includes('verizon') ||
    m.includes('att') || m.includes('t-mobile') || m.includes('comcast') ||
    m.includes('xfinity') || m.includes('utility') || m.includes('power')
  ) {
    return { category: 'Bills & Utilities', subCategory: '⚡ Gas & Electric' };
  }

  if (
    m.includes('netflix') || m.includes('spotify') || m.includes('hulu') ||
    m.includes('apple') || m.includes('google') || m.includes('prime') ||
    m.includes('disney') || m.includes('cinema') || m.includes('ticketmaster')
  ) {
    return { category: 'Travel & Lifestyle', subCategory: '🎮 Entertainment & Recreation' };
  }

  if (
    m.includes('amazon') || m.includes('zara') || m.includes('nike') ||
    m.includes('nordstrom') || m.includes('sephora') || m.includes('ebay') ||
    m.includes('apparel')
  ) {
    return { category: 'Shopping', subCategory: '🛍️ Shopping' };
  }

  return { category: 'Other', subCategory: '📦 Miscellaneous' };
}

/** Port of inferAccountType. Used by SimpleFIN sync. */
export type InferredAccountType = 'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'uncategorized';

const VALID_TYPES: ReadonlySet<InferredAccountType> = new Set([
  'checking', 'savings', 'credit', 'investment', 'loan', 'uncategorized',
]);

/**
 * Best-effort account-type classifier used by the SimpleFIN sync. The
 * SimpleFIN protocol doesn't standardize an account-type field — the
 * `extra` object is explicitly opaque (server-determined). So this is
 * always a heuristic; the UI lets the user correct any wrong call.
 *
 * Signals, in priority order:
 *
 *   1. `extra` sniff. Some SimpleFIN servers populate the opaque
 *      `extra` object with `account_type`, `account_class`, `type`,
 *      or `category` keys whose value matches our enum. If present,
 *      trust it. Unknown values are ignored.
 *   2. Retirement-name keywords, which must not be mistaken for debt.
 *   3. Loan-name keywords. These must beat institution because firms such
 *      as SoFi offer both loans and investments.
 *   4. Balance. A clearly negative balance is what you owe → credit.
 *      Threshold of -100 avoids false positives on small checking
 *      overdrafts but still catches cards with a small first
 *      statement. Brand-new cards with a $0 balance fall through.
 *   5. Explicit credit, savings, checking, and investment names.
 *   6. Institution. A brokerage/retail-investment org name
 *      (Fidelity, Vanguard, Schwab, Merrill, E*Trade, Robinhood,
 *      Wealthfront, Betterment, Coinbase, Stash) is a strong
 *      investment signal even when the account name is generic
 *      (e.g. "NetBenefits", "BrokerageLink").
 *   7. Fallback `uncategorized`. The Accounts page prompts the user to
 *      choose a type, and that correction survives every re-sync.
 *
 * Pass the `institution` (`sAcc.org?.name`) and the parsed `extra`
 * object (`sAcc.extra`) for the strongest classification. Both are
 * optional — older callers that only had `name` + `balance` still work.
 */
export function inferAccountType(
  name: string,
  balance: number,
  opts?: { institution?: string; extra?: Record<string, unknown> },
): InferredAccountType {
  const lowerName = name.toLowerCase();

  // (1) `extra` sniff — trust the bank-supplied type if we can find one.
  if (opts?.extra) {
    for (const key of ['account_type', 'account_class', 'type', 'category']) {
      const v = opts.extra[key];
      if (typeof v === 'string') {
        const lower = v.toLowerCase().trim();
        if (VALID_TYPES.has(lower as InferredAccountType)) {
          return lower as InferredAccountType;
        }
        // Tolerate a few common synonyms.
        if (lower === 'depository' || lower === 'cash') return 'checking';
        if (lower === 'retirement' || lower === 'brokerage') return 'investment';
        if (lower === 'credit card' || lower === 'creditcard') return 'credit';
        if (lower === 'mortgage' || lower === 'student loan' || lower === 'auto') return 'loan';
      }
    }
  }

  // Shared retirement / tax-advantaged detectors. Checked early so they
  // beat balance-sign and bare "credit" company-name matches.
  // Word-boundary-ish patterns avoid `ira` matching inside "admirable".
  const isRetirementName =
    /401\s*[(-]?\s*k/.test(lowerName) ||
    /403\s*[(-]?\s*b/.test(lowerName) ||
    /457\s*[(-]?\s*b/.test(lowerName) ||
    /\bira\b/.test(lowerName) ||
    lowerName.includes('roth') ||
    lowerName.includes('sep ira') ||
    lowerName.includes('simple ira') ||
    /\btsp\b/.test(lowerName) ||
    lowerName.includes('pension') ||
    lowerName.includes('retirement') ||
    /\b529\b/.test(lowerName) ||
    /\bhsa\b/.test(lowerName) ||
    lowerName.includes('netbenefits') ||
    lowerName.includes('brokeragelink');

  if (isRetirementName) return 'investment';

  const isLoanName =
    lowerName.includes('loan') || lowerName.includes('mortgage') ||
    lowerName.includes('debt') || lowerName.includes('student');

  if (isLoanName) return 'loan';

  // (4) A negative balance without a stronger account-name signal is
  // most likely revolving credit.
  if (balance < -100) {
    return 'credit';
  }

  // (5a) Credit-card signals. Bare "credit" alone is intentionally
  // omitted — it fires on employer/issuer names ("Concord Credit",
  // "Acme Credit Union") that are not revolving debt.
  if (
    lowerName.includes('credit card') || lowerName.includes('creditcard') ||
    lowerName.includes('line of credit') ||
    lowerName.includes('sapphire') || lowerName.includes('freedom') ||
    lowerName.includes('amex') || lowerName.includes('american express') ||
    lowerName.includes('visa') || lowerName.includes('mastercard') ||
    lowerName.includes('capital one') || lowerName.includes('discover') ||
    lowerName.includes('venture') || lowerName.includes('quicksilver') ||
    lowerName.includes('savor') || lowerName.includes('spark') ||
    lowerName.includes('bonvoy') || lowerName.includes('skymiles') ||
    // Trailing/standalone " card" (e.g. "Chase card") — not bare "card"
    // inside unrelated words.
    /\bcard\b/.test(lowerName)
  ) return 'credit';

  // (5b) Depository accounts.
  if (lowerName.includes('savings') || lowerName.includes('hysa') || lowerName.includes('high yield')) {
    return 'savings';
  }
  if (
    lowerName.includes('checking') || lowerName.includes('cash management') ||
    lowerName.includes('spending account') || lowerName.includes('spend account')
  ) return 'checking';

  const institution = (opts?.institution ?? '').toLowerCase();
  if (lowerName.includes('credit union') || institution.includes('credit union')) return 'checking';

  // (5c) Investment / brokerage keywords.
  if (
    lowerName.includes('mutual fund') ||
    lowerName.includes(' etf') || lowerName.includes('brokerage') ||
    lowerName.includes('investment') || /\binvest\b/.test(lowerName) || lowerName.includes('wealth') ||
    lowerName.includes('fidelity') || lowerName.includes('vanguard') ||
    lowerName.includes('schwab') || lowerName.includes('merrill') ||
    lowerName.includes('etrade') || lowerName.includes('robinhood') ||
    lowerName.includes('wealthfront') ||
    lowerName.includes('betterment') || lowerName.includes('coinbase') ||
    lowerName.includes('stash')
  ) return 'investment';

  // (6) Strong investment institution names are useful only after the
  // account's own product name has had a chance to identify another type.
  if (
    institution.includes('fidelity') || institution.includes('vanguard') ||
    institution.includes('schwab') || institution.includes('merrill') ||
    institution.includes('etrade') || institution.includes('e*trade') ||
    institution.includes('robinhood') ||
    institution.includes('wealthfront') || institution.includes('betterment') ||
    institution.includes('coinbase') || institution.includes('stash')
  ) return 'investment';

  // (7) No strong signal. Import the account without pretending it is
  // checking; the Accounts page gives it an explicit review section.
  return 'uncategorized';
}
