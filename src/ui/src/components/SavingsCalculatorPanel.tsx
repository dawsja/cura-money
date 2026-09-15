/**
 * Savings calculator — inline panel beside the Pay down chart and
 * accounts list. The calculator is always visible (Monarch-style)
 * instead of a modal so the inputs keep focus while typing and the
 * saved scenario is plainly visible next to the projection.
 *
 * State (method, monthlyExtra, oneTimeExtra, showSim) is owned by the
 * parent page so the page header's "Save to Budget" button can read
 * the same scenario the user just configured. The parent also persists
 * that scenario to localStorage so leaving and returning to Pay down
 * restores the inputs, payoff dates, and chart.
 */
import { Calculator } from 'lucide-react';
import { currencySymbol } from '../lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Field, FieldGroup, FieldLabel } from './ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from './ui/input-group';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';

type Method = 'planned' | 'avalanche' | 'snowball';

interface MethodOption {
  value: Method;
  label: string;
  description: string;
}

const METHOD_OPTIONS: MethodOption[] = [
  {
    value: 'planned',
    label: 'Planned payments',
    description: "Pay the scheduled minimum or planned amount on each debt without redirecting freed-up payments to other debts as they're paid off.",
  },
  {
    value: 'avalanche',
    label: 'Debt avalanche',
    description: 'Target the highest-interest debt first and roll each completed payment into the next highest-interest balance to minimize total interest paid.',
  },
  {
    value: 'snowball',
    label: 'Debt snowball',
    description: 'Pay off the smallest balances first to build momentum, rolling each eliminated payment into the next smallest debt.',
  },
];

interface SavingsCalculatorPanelProps {
  method: Method;
  setMethod: (m: Method) => void;
  monthlyExtra: string;
  setMonthlyExtra: (v: string) => void;
  oneTimeExtra: string;
  setOneTimeExtra: (v: string) => void;
  setShowSim: (v: boolean) => void;
  isSimulated: boolean;
  projection: {
    baselineTotalInterest: number;
    totalInterest: number;
    baselineDebtFreeMonth: string | null;
    debtFreeMonth: string | null;
  } | null;
  monthlyExtraNum: number;
  oneTimeExtraNum: number;
  formatMoney: (n: number) => string;
  ymToMonths: (ym: string) => number;
}

export function SavingsCalculatorPanel({
  method,
  setMethod,
  monthlyExtra,
  setMonthlyExtra,
  oneTimeExtra,
  setOneTimeExtra,
  setShowSim,
  isSimulated,
  projection,
  monthlyExtraNum,
  oneTimeExtraNum,
  formatMoney,
  ymToMonths,
}: SavingsCalculatorPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="text-muted-foreground" />
          Savings calculator
        </CardTitle>
        <CardDescription>
          Try different payoff methods. Extra payments are only applied
          for Avalanche and Snowball.
        </CardDescription>
      </CardHeader>
      <CardContent>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel>Method</FieldLabel>
          <RadioGroup
            value={method}
            onValueChange={(value) => {
              setMethod(value as Method);
              setShowSim(true);
            }}
            aria-label="Payoff method"
            className="flex flex-col gap-2"
          >
            {METHOD_OPTIONS.map((opt) => (
              <FieldLabel
                key={opt.value}
                htmlFor={`payoff-method-${opt.value}`}
                className="cursor-pointer rounded-lg border border-border p-3 has-data-checked:border-primary has-data-checked:bg-primary/5"
              >
                <Field orientation="horizontal">
                  <RadioGroupItem id={`payoff-method-${opt.value}`} value={opt.value} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{opt.description}</div>
                  </div>
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field>
            <FieldLabel>Additional monthly payment</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>{currencySymbol()}</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                step="0.01"
                min="0"
                value={monthlyExtra}
                onChange={(e) => {
                  setMonthlyExtra(e.target.value);
                  setShowSim(true);
                }}
                placeholder="0"
                className="tabular-nums"
              />
            </InputGroup>
          </Field>
          <Field>
            <FieldLabel>Additional one-time payment</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>{currencySymbol()}</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                step="0.01"
                min="0"
                value={oneTimeExtra}
                onChange={(e) => {
                  setOneTimeExtra(e.target.value);
                  setShowSim(true);
                }}
                placeholder="0"
                className="tabular-nums"
              />
            </InputGroup>
          </Field>
        </div>

        {isSimulated && projection && (
          <div className="rounded-lg bg-primary/10 p-3 text-xs text-foreground">
            <div className="mb-1 font-semibold capitalize">
              {method === 'planned' ? 'Planned payments' : method === 'avalanche' ? 'Debt avalanche' : 'Debt snowball'}
              {monthlyExtraNum > 0 ? ` with ${formatMoney(monthlyExtraNum)}/mo extra` : ''}
              {oneTimeExtraNum > 0 ? ` + ${formatMoney(oneTimeExtraNum)} one-time` : ''}
            </div>
            {projection.baselineTotalInterest > 0 && (
              <div>
                Saves {formatMoney(Math.max(0, projection.baselineTotalInterest - projection.totalInterest))} in interest vs. baseline
              </div>
            )}
            {projection.baselineDebtFreeMonth && projection.debtFreeMonth && projection.baselineDebtFreeMonth !== projection.debtFreeMonth && (
              <div>
                Debt-free{' '}
                {(() => {
                  const baseMonths = ymToMonths(projection.baselineDebtFreeMonth);
                  const newMonths = ymToMonths(projection.debtFreeMonth);
                  const diff = baseMonths - newMonths;
                  return diff > 0 ? `${diff} months earlier` : `${-diff} months later`;
                })()}
              </div>
            )}
          </div>
        )}
      </FieldGroup>
      </CardContent>
    </Card>
  );
}
