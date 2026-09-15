import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Inbox,
  MoreHorizontal,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';
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
import { Checkbox } from '@/components/ui/checkbox';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
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

const TYPE_LABEL: Record<TxType, string> = {
  income: 'Income',
  expense: 'Expense',
  transfer: 'Transfer',
};

const TYPE_SIGN: Record<TxType, string> = {
  income: '+',
  expense: '−',
  transfer: '⇄',
};

const TYPE_AMOUNT_CLASS: Record<TxType, string> = {
  income: 'text-emerald-600 dark:text-emerald-400',
  expense: 'text-rose-600 dark:text-rose-400',
  transfer: 'text-muted-foreground',
};

function defaultEdit(tx: ReviewTransaction): EditState {
  return {
    category: tx.category,
    subCategory: tx.subCategory ?? '',
    type: tx.type,
  };
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
      if (event.target instanceof HTMLElement && event.target.closest('[data-slot="select-trigger"], [data-slot="select-content"]')) return;
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
  const reviewing = Boolean(slide && edit && !ruleOperation && !isLoadingFirst && !isFinished && !isEmpty);
  const categoryValue = slide && edit?.category && edit.subCategory
    ? JSON.stringify({ category: edit.category, subCategory: edit.subCategory })
    : undefined;

  const title = isFinished || isEmpty
    ? 'All caught up'
    : ruleOperation?.status === 'pending'
      ? 'Creating rule'
      : ruleOperation?.status === 'error'
        ? 'Rule was not created'
        : 'Review transactions';

  const description = isFinished
    ? `You reviewed ${completedCount} transaction${completedCount === 1 ? '' : 's'}.`
    : isEmpty
      ? 'New SimpleFIN imports will wait here before they appear on Home.'
      : ruleOperation?.status === 'pending'
        ? 'The transaction is saved. Checking existing rules…'
        : reviewing
          ? `${pendingCount} remaining`
          : 'Imported transactions that still need a category.';

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !closeLocked && !blocking) onClose();
        }}
      >
        <DialogContent
          className="sm:max-w-lg"
          showCloseButton={!closeLocked}
          onEscapeKeyDown={(event) => {
            if (closeLocked || blocking) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (closeLocked || blocking) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {reviewing && total > 0 ? (
            <div className="flex flex-col gap-2">
              <Progress value={progress} className="h-1" />
              <p className="text-xs text-muted-foreground tabular-nums">
                {completedCount} of {total} reviewed
              </p>
            </div>
          ) : null}

          {ruleOperation?.status === 'pending' ? (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-4 text-sm">
              <Spinner />
              <p className="text-muted-foreground">Saving a scoped merchant rule…</p>
            </div>
          ) : null}

          {ruleOperation?.status === 'error' ? (
            <Alert variant="destructive">
              <AlertTitle>The transaction was saved</AlertTitle>
              <AlertDescription>
                Its rule failed: {ruleOperation.error}
              </AlertDescription>
            </Alert>
          ) : null}

          {isLoadingFirst || waitingForRows ? <ReviewLoadingState /> : null}

          {queueError && queue.length === 0 && !isLoadingFirst ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load reviews</AlertTitle>
              <AlertDescription>{queueError}</AlertDescription>
              <AlertAction>
                <Button type="button" size="sm" variant="outline" onClick={() => void onRetryQueue()}>
                  Retry
                </Button>
              </AlertAction>
            </Alert>
          ) : null}

          {isEmpty ? (
            <Empty className="border-0 py-2">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox />
                </EmptyMedia>
                <EmptyTitle>Nothing to review</EmptyTitle>
                <EmptyDescription>
                  New SimpleFIN imports will land here for confirmation before they show up on Home.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}

          {isFinished ? (
            <Empty className="border-0 py-2">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CircleCheck />
                </EmptyMedia>
                <EmptyTitle>You&apos;re all caught up</EmptyTitle>
                <EmptyDescription>
                  You reviewed {completedCount} transaction{completedCount === 1 ? '' : 's'}.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button type="button" onClick={onClose}>
                  <Check data-icon="inline-start" />
                  Done
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}

          {reviewing && slide && edit ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  {formatDate(slide.date)}
                  <span className="px-1.5 text-border">·</span>
                  {slide.account}
                </p>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold leading-tight">{slide.merchant}</h3>
                  <Badge variant="outline">{TYPE_LABEL[edit.type]}</Badge>
                </div>
                <p className={cn('text-2xl font-semibold tabular-nums', TYPE_AMOUNT_CLASS[edit.type])}>
                  {TYPE_SIGN[edit.type]}
                  {formatMoney(slide.amount)}
                </p>
                {slide.notes ? (
                  <p className="text-sm text-muted-foreground">{slide.notes}</p>
                ) : null}
              </div>

              <Separator />

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
                    className="w-full"
                    disabled={isMutating}
                  >
                    {(['income', 'expense', 'transfer'] as const).map((type) => (
                      <ToggleGroupItem key={type} value={type} className="flex-1">
                        {TYPE_LABEL[type]}
                      </ToggleGroupItem>
                    ))}
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
                      <SelectValue placeholder={cats.isLoading ? 'Loading categories…' : 'Pick a category…'} />
                    </SelectTrigger>
                    <SelectContent>
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

                <Field orientation="horizontal">
                  <Checkbox
                    id={rememberId}
                    checked={rememberRules[slide.id] === true}
                    onCheckedChange={(checked) => setRememberRules((current) => ({
                      ...current,
                      [slide.id]: checked === true,
                    }))}
                    disabled={isMutating}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor={rememberId}>Create a rule</FieldLabel>
                    <FieldDescription>
                      {slide.sourceClassificationTrusted
                        ? 'Apply this category to the same merchant, account, and original type next time.'
                        : 'Apply this category to the same merchant and account. Original type and category were not kept for this older transaction.'}
                    </FieldDescription>
                  </FieldContent>
                </Field>

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
                        Retry queue
                      </Button>
                    </AlertAction>
                  </Alert>
                ) : null}
              </FieldGroup>
            </div>
          ) : null}

          {ruleOperation?.status === 'error' ? (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRuleOperation(null)}>
                Continue without rule
              </Button>
              <Button type="button" onClick={() => void createScopedRule(ruleOperation.transactionId)}>
                Retry rule
              </Button>
            </DialogFooter>
          ) : null}

          {reviewing && slide && edit ? (
            <DialogFooter className="sm:justify-between">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setIdx((prev) => Math.max(0, prev - 1))}
                  disabled={currentIdx === 0 || isMutating}
                  aria-label="Previous transaction"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setIdx((prev) => Math.min(queue.length - 1, prev + 1))}
                  disabled={currentIdx >= queue.length - 1 || isMutating}
                  aria-label="Next transaction"
                >
                  <ChevronRight />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label="More review actions" disabled={isMutating}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        disabled={pendingCount === 0}
                        onClick={() => setConfirmAcceptAll(true)}
                      >
                        Accept all suggestions
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => void handleSkip()} disabled={isMutating}>
                  Keep suggestion
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleCategorize()}
                  disabled={isMutating || !edit.category || !edit.subCategory}
                >
                  {isMutating ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                  {isMutating ? 'Saving…' : rememberRules[slide.id] ? 'Save with rule' : 'Save & next'}
                </Button>
              </div>
            </DialogFooter>
          ) : null}

          {(isEmpty || (queueError && queue.length === 0 && !isLoadingFirst)) ? (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      {confirmAcceptAll ? (
        <ConfirmDialog
          title="Accept all suggestions?"
          confirmLabel={`Accept all ${pendingCount} suggestion${pendingCount === 1 ? '' : 's'}`}
          onConfirm={async () => {
            await handleSkipAll();
            setConfirmAcceptAll(false);
          }}
          onClose={() => setConfirmAcceptAll(false)}
        >
          <p>
            This keeps the imported category and type for {pendingCount} pending
            transaction{pendingCount === 1 ? '' : 's'} without creating rules.
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

function ReviewLoadingState() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-8 w-28" />
      </div>
      <Separator />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}
