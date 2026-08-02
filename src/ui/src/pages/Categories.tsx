import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Trash2, FolderTree, TrendingUp, TrendingDown, GripVertical, ArrowLeftRight } from 'lucide-react';
import clsx from 'clsx';

interface SubCategory { id: string; name: string; }
interface MainCategory {
  id: string;
  name: string;
  type: 'income' | 'expense' | 'transfer';
  icon?: string;
  sortOrder: number;
  subCategories: SubCategory[];
}

export function Categories() {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<MainCategory[]>('/api/categories') });

  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'income' | 'expense' | 'transfer'>('expense');

  const addMain = useMutation({
    mutationFn: (input: { name: string; type: 'income' | 'expense' | 'transfer' }) => api.post<MainCategory>('/api/categories', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
  const delMain = useMutation({
    mutationFn: (id: string) => api.delete(`/api/categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
  const addSub = useMutation({
    mutationFn: (input: { mainCategoryId: string; name: string }) =>
      api.post(`/api/categories/${input.mainCategoryId}/sub`, { name: input.name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
  const delSub = useMutation({
    mutationFn: (id: string) => api.delete(`/api/categories/_/sub/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
  // Drag-to-reorder. Optimistic: we mutate the React Query cache
  // immediately so the UI re-orders without waiting for the server.
  // If the server rejects (e.g. network error), we roll back to the
  // previous order and the user sees the items snap back.
  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => api.post<{ ok: true }>('/api/categories/reorder', { orderedIds }),
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: ['categories'] });
      const previous = qc.getQueryData<MainCategory[]>(['categories']);
      if (previous) {
        const byId = new Map(previous.map((c) => [c.id, c]));
        const next: MainCategory[] = [];
        for (let i = 0; i < orderedIds.length; i++) {
          const c = byId.get(orderedIds[i]!);
          if (c) next.push({ ...c, sortOrder: i });
        }
        // Append any categories the user didn't include (shouldn't
        // happen, but defensive) at the end so nothing disappears.
        for (const c of previous) {
          if (!orderedIds.includes(c.id)) next.push({ ...c, sortOrder: next.length });
        }
        qc.setQueryData(['categories'], next);
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['categories'], ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
    },
  });

  const onAddMain = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    addMain.mutate({ name: newName.trim(), type: newType });
    setNewName('');
  };

  // The backend already orders all categories together by sortOrder.
  // We group by type for visual layout; the order within each group is
  // the user's drag order, which the Budget page also respects.
  const expenseCats = cats.data?.filter((c) => c.type === 'expense') ?? [];
  const incomeCats = cats.data?.filter((c) => c.type === 'income') ?? [];
  const transferCats = cats.data?.filter((c) => c.type === 'transfer') ?? [];

  // Reorder helper — moves `sourceId` to the position of `targetId`
  // (`position: 'before'` inserts ahead of target, `'after'` past it),
  // then fires the mutation. We pass the full new list so the server
  // renumbers every id (not just the moved one), keeping the order
  // compact from 0..N.
  const onReorder = (
    group: 'expense' | 'income' | 'transfer',
    sourceId: string,
    targetId: string,
    position: 'before' | 'after',
  ) => {
    if (sourceId === targetId) return;
    const list = group === 'expense' ? expenseCats : group === 'income' ? incomeCats : transferCats;
    const fromIdx = list.findIndex((c) => c.id === sourceId);
    let toIdx = list.findIndex((c) => c.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    if (position === 'after') toIdx += 1;
    if (fromIdx < toIdx) toIdx -= 1; // account for the removal
    if (fromIdx === toIdx) return;
    const next = [...list];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved!);
    reorder.mutate(next.map((c) => c.id));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold fg-primary">Categories</h1>
      <p className="text-sm fg-tertiary -mt-4">
        Drag the cards to set the order. The Budget page uses the same
        order, so put your biggest categories first.
      </p>

      <section className="card">
        <h2 className="text-lg font-semibold mb-3 fg-primary">Add category</h2>
        <form onSubmit={onAddMain} className="flex gap-2 flex-wrap">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name (e.g. Housing, Salary)"
            className="flex-1 min-w-[200px] rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
          />
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-default p-1 bg-slate-50 dark:bg-slate-700/50">
            <button
              type="button"
              onClick={() => setNewType('expense')}
              className={clsx(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                newType === 'expense'
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                  : 'fg-tertiary hover:bg-surface dark:hover:bg-slate-600',
              )}
            >
              <TrendingDown className="h-3 w-3 inline mr-1" /> Expense
            </button>
            <button
              type="button"
              onClick={() => setNewType('income')}
              className={clsx(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                newType === 'income'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'fg-tertiary hover:bg-surface dark:hover:bg-slate-600',
              )}
            >
              <TrendingUp className="h-3 w-3 inline mr-1" /> Income
            </button>
            <button
              type="button"
              onClick={() => setNewType('transfer')}
              className={clsx(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                newType === 'transfer'
                  ? 'bg-slate-200 text-slate-800 dark:bg-slate-500 dark:text-slate-100'
                  : 'fg-tertiary hover:bg-surface dark:hover:bg-slate-600',
              )}
            >
              <ArrowLeftRight className="h-3 w-3 inline mr-1" /> Transfer
            </button>
          </div>
          <button type="submit" className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add
          </button>
        </form>
      </section>

      {(expenseCats.length > 0 || incomeCats.length > 0 || transferCats.length > 0) ? (
        <div className="grid gap-4 md:grid-cols-2">
          {expenseCats.length > 0 && (
            <CategoryGroup
              title="Expense categories"
              icon={TrendingDown}
              tone="rose"
              group="expense"
              categories={expenseCats}
              onDeleteMain={(id) => delMain.mutate(id)}
              onAddSub={(mainId, name) => addSub.mutate({ mainCategoryId: mainId, name })}
              onDeleteSub={(id) => delSub.mutate(id)}
              onReorder={onReorder}
              disabled={reorder.isPending}
            />
          )}
          {incomeCats.length > 0 && (
            <CategoryGroup
              title="Income categories"
              icon={TrendingUp}
              tone="emerald"
              group="income"
              categories={incomeCats}
              onDeleteMain={(id) => delMain.mutate(id)}
              onAddSub={(mainId, name) => addSub.mutate({ mainCategoryId: mainId, name })}
              onDeleteSub={(id) => delSub.mutate(id)}
              onReorder={onReorder}
              disabled={reorder.isPending}
            />
          )}
          {transferCats.length > 0 && (
            <CategoryGroup
              title="Transfer categories"
              icon={ArrowLeftRight}
              tone="slate"
              group="transfer"
              categories={transferCats}
              onDeleteMain={(id) => delMain.mutate(id)}
              onAddSub={(mainId, name) => addSub.mutate({ mainCategoryId: mainId, name })}
              onDeleteSub={(id) => delSub.mutate(id)}
              onReorder={onReorder}
              disabled={reorder.isPending}
            />
          )}
        </div>
      ) : (
        <div className="card text-sm fg-muted text-center">
          <FolderTree className="h-5 w-5 inline mr-1 fg-muted" /> No categories yet. Add one above to start organizing transactions.
        </div>
      )}
    </div>
  );
}

function CategoryGroup({
  title,
  icon: Icon,
  tone,
  group,
  categories,
  onDeleteMain,
  onAddSub,
  onDeleteSub,
  onReorder,
  disabled,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'rose' | 'emerald' | 'slate';
  group: 'expense' | 'income' | 'transfer';
  categories: MainCategory[];
  onDeleteMain: (id: string) => void;
  onAddSub: (mainId: string, name: string) => void;
  onDeleteSub: (id: string) => void;
  onReorder: (group: 'expense' | 'income' | 'transfer', sourceId: string, targetId: string, position: 'before' | 'after') => void;
  disabled?: boolean;
}) {
  const toneClass =
    tone === 'rose' ? 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300' :
    tone === 'emerald' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300' :
    'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';

  // Custom drag-to-reorder via Pointer Events. The whole card header
  // is the drag handle (the grip icon is the visual affordance, but
  // grabbing anywhere on the header works — gives a 44px+ touch
  // target on mobile). On pointerdown we capture the pointer and
  // install window listeners for pointermove/up/cancel + Escape.
  //
  // Visual feedback during drag:
  //   - dragged card translates with the cursor Y delta and fades
  //     to 0.4 opacity so the user sees where the card is going
  //   - a 2px amber bar snaps between cards based on whether the
  //     cursor is above or below each card's midpoint, giving a
  //     live preview of where the drop will land
  //   - on release, the card slides into its new position via a
  //     200ms transform/opacity transition
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragDeltaY, setDragDeltaY] = useState(0);
  const [insertionTarget, setInsertionTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const listRef = useRef<HTMLDivElement>(null);
  // Mirror the live drag state so the global listeners (attached
  // once per drag) can read the latest values without re-attaching
  // on every pointermove. State setters are still called to drive
  // the render.
  const dragRef = useRef({ startY: 0, deltaY: 0, target: null as { id: string; position: 'before' | 'after' } | null });
  // Always-fresh onReorder reference so the pointerup handler calls
  // the latest closure even if the parent re-renders mid-drag.
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  // Global listeners while dragging. Only re-attaches when
  // draggingId flips, not on every pointermove.
  useEffect(() => {
    if (!draggingId) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      d.deltaY = e.clientY - d.startY;
      setDragDeltaY(d.deltaY);
      const target = computeInsertionTarget(categories, cardRefs.current, draggingId, e.clientY);
      d.target = target;
      setInsertionTarget(target);
      // Auto-scroll when the cursor is near the viewport edges so
      // a long list can be reordered past the fold.
      const edge = 40;
      if (e.clientY < edge) {
        window.scrollBy({ top: -8 });
      } else if (e.clientY > window.innerHeight - edge) {
        window.scrollBy({ top: 8 });
      }
    };
    const finish = (commit: boolean) => {
      const d = dragRef.current;
      if (commit && d.target && d.target.id !== draggingId && Math.abs(d.deltaY) > 5) {
        onReorderRef.current(group, draggingId, d.target.id, d.target.position);
      }
      setDraggingId(null);
      setDragDeltaY(0);
      setInsertionTarget(null);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [draggingId, categories, group]);

  // Grabbing cursor + lock text selection while dragging so the
  // cursor stays "grabbing" even when it's over an unrelated
  // element outside the captured card.
  useEffect(() => {
    if (!draggingId) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [draggingId]);

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    if (disabled) return;
    if (e.button !== 0) return;
    // Don't start a drag from interactive elements inside the card
    // (sub-category input, add-save button, delete button has its own
    // stopPropagation, but the input needs the closest() check).
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, label')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, deltaY: 0, target: null };
    setDraggingId(id);
    setDragDeltaY(0);
    setInsertionTarget(null);
  };

  // Vertical position of the insertion bar, in coordinates relative
  // to the list container. Computed from the target card's bounding
  // rect (un-translated) so the bar snaps to the right gap even
  // while the dragged card is mid-flight.
  const indicatorY = (() => {
    if (!insertionTarget || !listRef.current) return null;
    const targetEl = cardRefs.current.get(insertionTarget.id);
    if (!targetEl) return null;
    const tRect = targetEl.getBoundingClientRect();
    const lRect = listRef.current.getBoundingClientRect();
    const offset = insertionTarget.position === 'before'
      ? tRect.top - lRect.top - 6  // center of the gap above the card
      : tRect.bottom - lRect.top + 6; // center of the gap below
    return offset - 1; // 1px for the 2px bar to be centered on the gap
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={clsx('h-7 w-7 rounded-lg flex items-center justify-center', toneClass)}>
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold fg-primary">{title}</h3>
        <span className="text-xs fg-muted">· {categories.length}</span>
      </div>
      <div ref={listRef} className="relative space-y-3">
        {categories.map((cat) => {
          const isDragging = draggingId === cat.id;
          return (
            <section
              key={cat.id}
              ref={(el) => {
                if (el) cardRefs.current.set(cat.id, el);
                else cardRefs.current.delete(cat.id);
              }}
              style={isDragging ? {
                transform: `translateY(${dragDeltaY}px)`,
                opacity: 0.4,
                transition: 'none',
                zIndex: 10,
                position: 'relative',
              } : undefined}
              className={clsx(
                'card',
                // Smooth landing when the drag ends — the transform
                // slides from the last cursor delta back to 0 and
                // the opacity fades back to 1.
                !isDragging && 'transition-[transform,opacity] duration-200 ease-out',
                disabled && 'opacity-60',
              )}
            >
              <div
                onPointerDown={(e) => onPointerDown(e, cat.id)}
                // touch-action: none prevents the browser from
                // interpreting the touch as a scroll, so the drag
                // starts cleanly on mobile.
                className="flex items-center justify-between mb-2 cursor-grab active:cursor-grabbing select-none touch-none"
                title="Drag to reorder"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <GripVertical className="h-4 w-4 text-slate-300 dark:text-slate-600 shrink-0" />
                  <h4 className="text-sm font-semibold truncate fg-primary">{cat.name}</h4>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${cat.name}" and its sub-categories?`)) onDeleteMain(cat.id);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="fg-muted hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded p-1"
                  title="Delete category"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {cat.subCategories.length > 0 ? (
                <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                  {cat.subCategories.map((sub) => (
                    <li key={sub.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="fg-secondary">{sub.name}</span>
                      <button
                        onClick={() => onDeleteSub(sub.id)}
                        className="fg-muted hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded p-1"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs fg-muted italic py-1">No sub-categories yet</p>
              )}
              <AddSub onAdd={(name) => onAddSub(cat.id, name)} />
            </section>
          );
        })}
        {indicatorY !== null && (
          <div
            aria-hidden
            className="absolute left-0 right-0 h-0.5 bg-amber-500 rounded-full pointer-events-none z-20 shadow-sm shadow-amber-500/30"
            style={{ top: `${indicatorY}px` }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Find the insertion target for the current cursor Y. Walk the
 * non-dragging cards in order; the first card whose midpoint is
 * below the cursor becomes a "before" insertion. If the cursor is
 * below every card's midpoint, the insertion goes after the last
 * non-dragging card.
 */
function computeInsertionTarget(
  categories: MainCategory[],
  cardRefs: Map<string, HTMLElement>,
  draggingId: string,
  cursorY: number,
): { id: string; position: 'before' | 'after' } | null {
  for (const cat of categories) {
    if (cat.id === draggingId) continue;
    const el = cardRefs.get(cat.id);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (cursorY < mid) {
      return { id: cat.id, position: 'before' };
    }
  }
  for (let i = categories.length - 1; i >= 0; i--) {
    const cat = categories[i]!;
    if (cat.id !== draggingId) {
      return { id: cat.id, position: 'after' };
    }
  }
  return null;
}

function AddSub({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd(name.trim());
        setName('');
      }}
      className="mt-2 flex gap-2"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Sub-category"
        className="flex-1 rounded border border-default bg-surface fg-primary placeholder-slate-400 px-2 py-1 text-sm focus:border-amber-500 focus:outline-none"
      />
      <button type="submit" className="rounded bg-amber-500 px-2 text-slate-900 text-sm hover:bg-amber-600 flex items-center justify-center">
        <Plus className="h-4 w-4" />
      </button>
    </form>
  );
}
