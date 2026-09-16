import { useCallback, useEffect, useId, useMemo, useState, type ComponentType } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Inbox,
  ListChecks,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatDateLong, formatMoney } from '../lib/format';
import {
  confirmReviewedTransactionRule,
  createReviewedTransactionRule,
  type ReviewDecisionResult,
  type ReviewRule,
  type ReviewTransaction,
} from '../lib/reviews';
import { cn } from '@/lib/utils';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

type TxType = 'income' | 'expense' | 'transfer';

interface MainCategory {
  id: string;
  name: string;
  type: TxType;
  subCategories: { id: string; name: string }[];
}

interface EditState {
  category: string;
  subCategory: string;
  type: TxType;
}

const TYPES: TxType[] = ['expense', 'income', 'transfer'];

const TYPE_META: Record<TxType, {
  label: string;
  sign: string;
  icon: ComponentType<{ className?: string }>;
  amountClass: string;
  mediaClass: string;
}> = {
  income: {
    label: 'Income',
    sign: '+',
    icon: TrendingUp,
    amountClass: 'text-emerald-700 dark:text-emerald-400',
    mediaClass: 'bg-emerald-600/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400',
  },
  expense: {
    label: 'Expense',
    sign: '−',
    icon: TrendingDown,
    amountClass: 'text-rose-700 dark:text-rose-400',
    mediaClass: 'bg-rose-600/10 text-rose-700 dark:bg-rose-400/10 dark:text-rose-400',
  },
  transfer: {
    label: 'Transfer',
    sign: '',
    icon: ArrowLeftRight,
    amountClass: 'text-foreground',
    mediaClass: 'bg-muted text-muted-foreground',
  },
};

function defaultEdit(tx: ReviewTransaction): EditState {
  return {
    category: tx.category,
    subCategory: tx.subCategory ?? '',
    type: tx.type,
  };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export interface ReviewCarouselModalProps {
  queue: ReviewTransaction[];
  pendingCount: number;
  completedCount: number;
  isLoading: boolean;
  queueError: string | null;
  isMutating: boolean;
  onRetryQueue: () => Promise<void>;
  onClose: () => void;
  onDecide: (
    id: string,
    payload: {
      action: 'skip' | 'categorize';
      category?: string;
      subCategory?: string | null;
      type?: TxType;
    },
  ) => Promise<ReviewDecisionResult>;
  onSkipAll: () => Promise<void>;
}

export function ReviewCarouselModal({
  queue,
  pendingCount,
  completedCount,
  isLoading,
  queueError,
  isMutating,
  onRetryQueue,
  onClose,
  onDecide,
  onSkipAll,
}: ReviewCarouselModalProps) {
  const queryClient = useQueryClient();
  const rememberId = useId();
  const [idx, setIdx] = useState(0);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [err, setErr] = useState<string | null>(null);
  const [rememberRules, setRememberRules] = useState<Record<string, boolean>>({});
  const [ruleConfirmation, setRuleConfirmation] = useState<{
    transactionId: string;
    rule: ReviewRule;
  } | null>(null);
  const [ruleOperation, setRuleOperation] = useState<{
    transactionId: string;
    status: 'pending' | 'error';
    error?: string;
  } | null>(null);
  const [confirmAcceptAll, setConfirmAcceptAll] = useState(false);

  const cats = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<MainCategory[]>('/api/categories'),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (queue.length === 0) {
      setIdx(0);
      return;
    }
    setIdx((current) => Math.min(current, queue.length - 1));
  }, [queue.length]);

  const currentIdx = Math.min(idx, Math.max(0, queue.length - 1));
  const slide = queue[currentIdx] ?? null;
  const edit = slide ? edits[slide.id] ?? defaultEdit(slide) : null;
  const blocking = Boolean(ruleConfirmation || confirmAcceptAll || ruleOperation?.status === 'pending');
  const closeLocked = isMutating || ruleOperation?.status === 'pending';

  useEffect(() => {
    if (blocking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.target instanceof HTMLElement && event.target.closest('[data-slot="select-trigger"], [data-slot="select-content"], [data-slot="toggle-group"]')) return;
      if (event.key === 'ArrowLeft') setIdx((prev) => Math.max(0, prev - 1));
      if (event.key === 'ArrowRight' && idx < queue.length - 1) setIdx((prev) => prev + 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [blocking, idx, queue.length]);

  const updateEdit = useCallback((id: string, patch: Partial<EditState>) => {
    setEdits((prev) => {
      const current = queue.find((row) => row.id === id);
      if (!current) return prev;
      const base = prev[id] ?? defaultEdit(current);
      return { ...prev, [id]: { ...base, ...patch } };
    });
  }, [queue]);

  const visibleCats = useMemo(() => {
    if (!edit || !cats.data) return [];
    return cats.data.filter((category) => category.type === edit.type || category.name === 'Pay down goals');
  }, [cats.data, edit]);

  useEffect(() => {
    if (!edit || !cats.data || !slide) return;
    const valid = visibleCats.some((category) =>
      category.name === edit.category && category.subCategories.some((sub) => sub.name === edit.subCategory),
    );
    if ((edit.category || edit.subCategory) && !valid) {
      updateEdit(slide.id, { category: '', subCategory: '' });
    }
  }, [cats.data, edit, slide, updateEdit, visibleCats]);

  const createScopedRule = useCallback(async (transactionId: string) => {
    setRuleOperation({ transactionId, status: 'pending' });
    try {
      const ruleResult = await createReviewedTransactionRule(transactionId);
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      setRuleOperation(null);
      if (ruleResult.status === 'confirmation_required') {
        setRuleConfirmation({ transactionId, rule: ruleResult.rule });
      }
    } catch (caught) {
      setRuleOperation({
        transactionId,
        status: 'error',
        error: caught instanceof Error ? caught.message : 'unknown error',
      });
    }
  }, [queryClient]);

  const handleSkip = useCallback(async () => {
    if (!slide || isMutating) return;
    setErr(null);
    try {
      await onDecide(slide.id, { action: 'skip' });
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : 'Could not keep the imported category.');
    }
  }, [isMutating, onDecide, slide]);

  const handleSkipAll = useCallback(async () => {
    if (isMutating || pendingCount === 0) return;
    setErr(null);
    try {
      await onSkipAll();
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : 'Could not accept all suggestions.');
      throw caught;
    }
  }, [isMutating, onSkipAll, pendingCount]);

  const handleCategorize = useCallback(async () => {
    if (!slide || isMutating || !edit?.category || !edit.subCategory) return;
    setErr(null);
    try {
      await onDecide(slide.id, {
        action: 'categorize',
        category: edit.category,
        subCategory: edit.subCategory || null,
        type: edit.type,
      });
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : 'Could not save this category.');
      return;
    }
    if (rememberRules[slide.id] === true) {
      await createScopedRule(slide.id);
    }
  }, [createScopedRule, edit, isMutating, onDecide, rememberRules, slide]);

  const total = completedCount + pendingCount;
  const progress = total === 0 ? 0 : (completedCount / total) * 100;
  const isLoadingFirst = isLoading && !queueError;
  const isFinished = !isLoading && pendingCount === 0 && completedCount > 0 && !isMutating && !ruleOperation;
  const isEmpty = !isLoading && queue.length === 0 && pendingCount === 0 && completedCount === 0 && !isMutating;
  const waitingForRows = !isFinished && !isEmpty && !queueError && queue.length === 0 && !ruleOperation && (pendingCount > 0 || isMutating);
  const queueFailed = Boolean(queueError && queue.length === 0 && !isLoadingFirst);
  const reviewing = Boolean(slide && edit && !ruleOperation && !isLoadingFirst && !isFinished && !isEmpty);
  const remember = slide ? rememberRules[slide.id] === true : false;
  const categoryValue = slide && edit?.category && edit.subCategory
    ? JSON.stringify({ category: edit.category, subCategory: edit.subCategory })
    : undefined;

  const description = ruleOperation
      ? 'The transaction is saved.'
      : 'Confirm how imported transactions are categorized.';

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !closeLocked && !blocking) onClose();
        }}
      >
        <DialogContent
          className="gap-5 sm:max-w-md"
          showCloseButton={!closeLocked}
          onEscapeKeyDown={(event) => {
            if (closeLocked || blocking) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (closeLocked || blocking) event.preventDefault();
          }}
        >
          <DialogHeader className="gap-1 pr-8">
            <DialogTitle>Review transactions</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {reviewing && slide && edit ? (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
                    Transaction <span className="font-medium text-foreground">{currentIdx + 1}</span> of {pendingCount}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={() => setIdx((prev) => Math.max(0, prev - 1))}
                      disabled={currentIdx === 0 || isMutating}
                      aria-label="Previous transaction"
                    >
                      <ChevronLeft />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={() => setIdx((prev) => Math.min(queue.length - 1, prev + 1))}
                      disabled={currentIdx >= queue.length - 1 || isMutating}
                      aria-label="Next transaction"
                    >
                      <ChevronRight />
                    </Button>
                  </div>
                </div>
                <Progress value={progress} className="h-1" aria-label={`${completedCount} of ${total} reviewed`} />
              </div>

              <TransactionSummary transaction={slide} type={edit.type} />

              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel>Type</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={edit.type}
                    onValueChange={(value) => {
                      if (value) updateEdit(slide.id, { type: value as TxType });
                    }}
                    variant="outline"
                    spacing={1}
                    className="grid w-full grid-cols-3"
                    disabled={isMutating}
                  >
                    {TYPES.map((type) => {
                      const Icon = TYPE_META[type].icon;
                      return (
                        <ToggleGroupItem
                          key={type}
                          value={type}
                          className="w-full data-[state=on]:border-primary/50 data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
                        >
                          <Icon data-icon="inline-start" />
                          {TYPE_META[type].label}
                        </ToggleGroupItem>
                      );
                    })}
                  </ToggleGroup>
                </Field>

                <Field>
                  <FieldLabel>Category</FieldLabel>
                  <Select
                    value={categoryValue}
                    onValueChange={(value) => {
                      if (!value) {
                        updateEdit(slide.id, { category: '', subCategory: '' });
                        return;
                      }
                      const selected = JSON.parse(value) as { category: string; subCategory: string };
                      updateEdit(slide.id, selected);
                    }}
                    disabled={isMutating || (!cats.data && (cats.isLoading || cats.isError))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={cats.isLoading ? 'Loading categories…' : 'Choose a category'}>
                        {categoryValue ? (
                          <span className="truncate">
                            <span className="text-muted-foreground">{edit.category} ›</span> {edit.subCategory}
                          </span>
                        ) : null}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {visibleCats.map((category) => (
                        <SelectGroup key={category.id}>
                          <SelectLabel>{category.name}</SelectLabel>
                          {category.subCategories.map((sub) => (
                            <SelectItem
                              key={sub.id}
                              value={JSON.stringify({ category: category.name, subCategory: sub.name })}
                            >
                              {sub.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  {cats.isError ? (
                    <Alert variant="destructive">
                      <AlertDescription>Categories could not be loaded.</AlertDescription>
                      <AlertAction>
                        <Button type="button" size="sm" variant="outline" onClick={() => void cats.refetch()}>
                          Retry
                        </Button>
                      </AlertAction>
                    </Alert>
                  ) : null}
                </Field>

                <FieldLabel htmlFor={rememberId}>
                  <Field orientation="horizontal" data-disabled={isMutating || undefined}>
                    <FieldContent>
                      <FieldTitle>Remember for this merchant</FieldTitle>
                      <FieldDescription>
                        {slide.sourceClassificationTrusted
                          ? 'Create a rule for this merchant, account, and original type.'
                          : 'Create a rule for this merchant and account. The original type was not kept for this older transaction.'}
                      </FieldDescription>
                    </FieldContent>
                    <Switch
                      id={rememberId}
                      checked={remember}
                      onCheckedChange={(checked) => setRememberRules((current) => ({
                        ...current,
                        [slide.id]: checked,
                      }))}
                      disabled={isMutating}
                    />
                  </Field>
                </FieldLabel>
              </FieldGroup>

              {err ? (
                <Alert variant="destructive">
                  <AlertDescription>{err}</AlertDescription>
                </Alert>
              ) : null}
              {queueError ? (
                <Alert variant="destructive">
                  <AlertDescription>{queueError}</AlertDescription>
                  <AlertAction>
                    <Button type="button" size="sm" variant="outline" onClick={() => void onRetryQueue()}>
                      Retry
                    </Button>
                  </AlertAction>
                </Alert>
              ) : null}

              <DialogFooter className="sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmAcceptAll(true)}
                  disabled={isMutating || pendingCount === 0}
                >
                  <ListChecks data-icon="inline-start" />
                  Accept all
                </Button>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleSkip()}
                    disabled={isMutating}
                  >
                    Keep suggestion
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleCategorize()}
                    disabled={isMutating || !edit.category || !edit.subCategory}
                  >
                    {isMutating ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                    {isMutating ? 'Saving…' : remember ? 'Save & create rule' : 'Save'}
                  </Button>
                </div>
              </DialogFooter>
            </>
          ) : null}

          {isLoadingFirst || waitingForRows ? <ReviewLoadingState /> : null}

          {ruleOperation?.status === 'pending' ? (
            <Empty className="border py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Spinner />
                </EmptyMedia>
                <EmptyTitle>Creating rule</EmptyTitle>
                <EmptyDescription>Checking existing rules for this merchant…</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}

          {ruleOperation?.status === 'error' ? (
            <>
              <Alert variant="destructive">
                <AlertTitle>The rule was not created</AlertTitle>
                <AlertDescription>{ruleOperation.error}</AlertDescription>
              </Alert>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRuleOperation(null)}>
                  Continue without rule
                </Button>
                <Button type="button" onClick={() => void createScopedRule(ruleOperation.transactionId)}>
                  Retry rule
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {queueFailed ? (
            <>
              <Alert variant="destructive">
                <AlertTitle>Could not load reviews</AlertTitle>
                <AlertDescription>{queueError}</AlertDescription>
                <AlertAction>
                  <Button type="button" size="sm" variant="outline" onClick={() => void onRetryQueue()}>
                    Retry
                  </Button>
                </AlertAction>
              </Alert>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {isEmpty || isFinished ? (
            <>
              <Empty className="border py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    {isFinished ? <CircleCheck /> : <Inbox />}
                  </EmptyMedia>
                  <EmptyTitle>{isFinished ? 'You’re all caught up' : 'Nothing to review'}</EmptyTitle>
                  <EmptyDescription>
                    {isFinished
                      ? `You reviewed ${plural(completedCount, 'transaction')}.`
                      : 'New SimpleFIN imports wait here for confirmation before they show up on Home.'}
                  </EmptyDescription>
                </EmptyHeader>
                {isFinished ? (
                  <EmptyContent>
                    <Button type="button" onClick={onClose}>
                      <Check data-icon="inline-start" />
                      Done
                    </Button>
                  </EmptyContent>
                ) : null}
              </Empty>
              {isEmpty ? (
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={onClose}>
                    Close
                  </Button>
                </DialogFooter>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {confirmAcceptAll ? (
        <ConfirmDialog
          title="Accept all suggestions?"
          confirmLabel={`Accept ${plural(pendingCount, 'transaction')}`}
          onConfirm={async () => {
            await handleSkipAll();
            setConfirmAcceptAll(false);
          }}
          onClose={() => setConfirmAcceptAll(false)}
        >
          <p>
            This keeps the suggested category and type for {plural(pendingCount, 'pending transaction')} without
            creating rules.
          </p>
        </ConfirmDialog>
      ) : null}

      {ruleConfirmation ? (
        <ConfirmDialog
          title={ruleConfirmation.rule.accountId ? 'Update existing scoped rule?' : 'Narrow existing broad rule?'}
          confirmLabel={ruleConfirmation.rule.accountId ? 'Update rule' : 'Narrow rule'}
          onConfirm={async () => {
            const result = await confirmReviewedTransactionRule(ruleConfirmation.transactionId, ruleConfirmation.rule);
            if (result.status === 'confirmation_required') {
              setRuleConfirmation({ transactionId: ruleConfirmation.transactionId, rule: result.rule });
              throw new Error('The matching rule changed. Review the updated rule and confirm again.');
            }
            queryClient.invalidateQueries({ queryKey: ['rules'] });
          }}
          onClose={() => setRuleConfirmation(null)}
        >
          <p>
            The existing rule for <span className="font-medium text-foreground">{ruleConfirmation.rule.matchValue}</span>
            {' '}currently sets {ruleConfirmation.rule.category}
            {ruleConfirmation.rule.subCategory ? ` › ${ruleConfirmation.rule.subCategory}` : ''}.
          </p>
          <p>Confirming replaces it with this transaction&apos;s scoped conditions and assignment.</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function TransactionSummary({ transaction, type }: { transaction: ReviewTransaction; type: TxType }) {
  const meta = TYPE_META[type];
  const Icon = meta.icon;
  const importedCategory = [transaction.category, transaction.subCategory].filter(Boolean).join(' › ');

  return (
    <Card size="sm" className="gap-0 bg-muted/40 py-0 shadow-none">
      <CardContent className="flex items-center gap-3 pt-3 pb-3">
        <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', meta.mediaClass)}>
          <Icon className="size-5" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="line-clamp-2 font-medium break-words text-foreground">
            {transaction.merchant}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {formatDateLong(transaction.date)} · {transaction.account}
          </p>
        </div>
        <p className={cn('shrink-0 text-lg font-semibold tabular-nums', meta.amountClass)}>
          {meta.sign}
          {formatMoney(transaction.amount)}
        </p>
      </CardContent>
      {transaction.notes ? (
        <CardContent className="pb-3">
          <p className="truncate font-mono text-xs text-muted-foreground" title={transaction.notes}>
            {transaction.notes}
          </p>
        </CardContent>
      ) : null}
      <CardFooter className="flex-wrap gap-x-2 gap-y-1 py-2 text-xs text-muted-foreground">
        <span>Suggested</span>
        <Badge variant="outline">{TYPE_META[transaction.type].label}</Badge>
        <Badge variant="secondary">{importedCategory || 'Uncategorized'}</Badge>
      </CardFooter>
    </Card>
  );
}

function ReviewLoadingState() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-7 w-15" />
        </div>
        <Skeleton className="h-1 w-full" />
      </div>
      <div className="flex items-center gap-3 rounded-xl border p-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
        <Skeleton className="h-6 w-20" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-full" />
      </div>
      <Skeleton className="h-16 w-full" />
    </div>
  );
}
