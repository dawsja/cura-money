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
    // Use a dedicated Transfer / Account Transfer bucket. The UI maps
    // this through the user's Transfer category (auto-seeded for new
    // users, inserted by migration 0008 for existing ones).
    return {
      category: 'Transfer',
      subCategory: 'Account Transfer',
      type: 'transfer',
    };
  }

  const isIncome = amount > 0;

  if (isIncome) {
    if (m.includes('payroll') || m.includes('salary') || m.includes('direct deposit') || m.includes('paycheck') || m.includes('employer')) {
      return { category: 'Income', subCategory: 'Paychecks' };
    }
    if (m.includes('freelance') || m.includes('stripe') || m.includes('upwork') || m.includes('client')) {
      return { category: 'Income', subCategory: 'Business Income' };
    }
    if (m.includes('dividend') || m.includes('interest') || m.includes('yield')) {
      return { category: 'Income', subCategory: 'Interest' };
    }
    return { category: 'Income', subCategory: 'Other Income' };
  }

  if (
    m.includes('trader joe') || m.includes('whole foods') || m.includes('kroger') ||
    m.includes('safeway') || m.includes('target') || m.includes('costco') ||
    m.includes('aldi') || m.includes('walmart') || m.includes('grocery') ||
    m.includes('supermarket')
  ) {
    return { category: 'Food & Dining', subCategory: 'Groceries' };
  }

  if (
    m.includes('starbucks') || m.includes('mcdonald') || m.includes('chipotle') ||
    m.includes('uber eats') || m.includes('doordash') || m.includes('grubhub') ||
    m.includes('restaurant') || m.includes('cafe') || m.includes('dunkin') ||
    m.includes('pizza') || m.includes('burger')
  ) {
    return { category: 'Food & Dining', subCategory: 'Restaurants & Bars' };
  }

  if (
    m.includes('chevron') || m.includes('shell') || m.includes('exxon') ||
    m.includes('bp') || m.includes('7-eleven') || m.includes('gas') ||
    m.includes('fuel') || m.includes('uber') || m.includes('lyft') ||
    m.includes('transit')
  ) {
    return { category: 'Auto & Transport', subCategory: 'Gas' };
  }

  if (
    m.includes('electric') || m.includes('water') || m.includes('verizon') ||
    m.includes('att') || m.includes('t-mobile') || m.includes('comcast') ||
    m.includes('xfinity') || m.includes('utility') || m.includes('power')
  ) {
    return { category: 'Bills & Utilities', subCategory: 'Gas & Electric' };
  }

  if (
    m.includes('netflix') || m.includes('spotify') || m.includes('hulu') ||
    m.includes('apple') || m.includes('google') || m.includes('prime') ||
    m.includes('disney') || m.includes('cinema') || m.includes('ticketmaster')
  ) {
    return { category: 'Travel & Lifestyle', subCategory: 'Entertainment & Recreation' };
  }

  if (
    m.includes('amazon') || m.includes('zara') || m.includes('nike') ||
    m.includes('nordstrom') || m.includes('sephora') || m.includes('ebay') ||
    m.includes('apparel')
  ) {
    return { category: 'Shopping', subCategory: 'Shopping' };
  }

  return { category: 'Other', subCategory: 'Miscellaneous' };
}

/** Port of inferAccountType. Used by SimpleFIN sync. */
export type InferredAccountType = 'checking' | 'savings' | 'credit' | 'investment' | 'loan';

const VALID_TYPES: ReadonlySet<InferredAccountType> = new Set([
  'checking', 'savings', 'credit', 'investment', 'loan',
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
 *   2. Balance. A clearly negative balance is what you owe → credit.
 *      Threshold of -100 avoids false positives on small checking
 *      overdrafts but still catches cards with a small first
 *      statement. Brand-new cards with a $0 balance fall through.
 *   3. Institution. A brokerage/retail-investment org name
 *      (Fidelity, Vanguard, Schwab, Merrill, E*Trade, Robinhood,
 *      SoFi, Wealthfront, Betterment, Coinbase, Stash) is a strong
 *      investment signal even when the account name is generic
 *      (e.g. "NetBenefits", "BrokerageLink").
 *   4. Substring match on the account name. Broad coverage for
 *      issuers, branded card products, and retirement/brokerage
 *      keywords. Order matters — credit keywords run before
 *      savings/loan/investment so a name containing both "card" and
 *      "savings" resolves to credit.
 *   5. Fallback `checking`. The Accounts page surfaces a post-sync
 *      review carousel so the user can correct anything that lands
 *      here by accident.
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

  // (2) Negative balance — credit or loan. Check for loan keywords
  //     first so a "Personal Loan" or "Auto Loan" with a negative
  //     balance isn't misclassified as a credit card.
  if (balance < -100) {
    if (
      lowerName.includes('loan') || lowerName.includes('mortgage') ||
      lowerName.includes('debt') || lowerName.includes('student') ||
      lowerName.includes('auto loan') || lowerName.includes('personal loan')
    ) return 'loan';
    return 'credit';
  }

  // (3) Institution signal. Strong investment org names imply
  // investment even when the account name is generic.
  const institution = (opts?.institution ?? '').toLowerCase();
  if (
    institution.includes('fidelity') || institution.includes('vanguard') ||
    institution.includes('schwab') || institution.includes('merrill') ||
    institution.includes('etrade') || institution.includes('e*trade') ||
    institution.includes('robinhood') || institution.includes('sofi') ||
    institution.includes('wealthfront') || institution.includes('betterment') ||
    institution.includes('coinbase') || institution.includes('stash')
  ) return 'investment';

  // (4a) Credit / loan keywords. Order: credit runs first.
  if (
    lowerName.includes('credit') || lowerName.includes('card') ||
    lowerName.includes('sapphire') || lowerName.includes('freedom') ||
    lowerName.includes('amex') || lowerName.includes('visa') ||
    lowerName.includes('mastercard') || lowerName.includes('capital one') ||
    lowerName.includes('discover') ||
    lowerName.includes('venture') || lowerName.includes('quicksilver') ||
    lowerName.includes('savor') || lowerName.includes('spark') ||
    lowerName.includes('bonvoy') || lowerName.includes('skymiles')
  ) return 'credit';
  if (lowerName.includes('savings') || lowerName.includes('hysa') || lowerName.includes('high yield')) return 'savings';
  if (lowerName.includes('loan') || lowerName.includes('mortgage') || lowerName.includes('auto loan') || lowerName.includes('debt')) return 'loan';

  // (4b) Investment / retirement / brokerage keywords. Expanded list —
  // the original set missed common retirement-account naming
  // (Roth, 403b, 529, TSP, HSA, NetBenefits, BrokerageLink, etc.) and
  // several retail-brokerage brands.
  if (
    lowerName.includes('401k') || lowerName.includes('401(k)') ||
    lowerName.includes('ira') || lowerName.includes('roth') ||
    lowerName.includes('403b') || lowerName.includes('403(b)') ||
    lowerName.includes('529') || lowerName.includes('tsp') ||
    lowerName.includes('pension') || lowerName.includes('sep ira') ||
    lowerName.includes('hsa') || lowerName.includes('mutual fund') ||
    lowerName.includes(' etf') || lowerName.includes('brokerage') ||
    lowerName.includes('brokeragelink') || lowerName.includes('netbenefits') ||
    lowerName.includes('retirement') ||
    lowerName.includes('investment') || lowerName.includes('wealth') ||
    lowerName.includes('fidelity') || lowerName.includes('vanguard') ||
    lowerName.includes('schwab') || lowerName.includes('merrill') ||
    lowerName.includes('etrade') || lowerName.includes('robinhood') ||
    lowerName.includes('sofi') || lowerName.includes('wealthfront') ||
    lowerName.includes('betterment') || lowerName.includes('coinbase') ||
    lowerName.includes('stash')
  ) return 'investment';

  // (5) Fallback.
  return 'checking';
}
