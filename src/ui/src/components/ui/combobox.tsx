/**
 * shadcn-style combobox — searchable select built on `cmdk`.
 *
 * API mirrors the shadcn example:
 *
 *   const items = [
 *     { value: 'next', label: 'Next.js' },
 *     { value: 'svelte', label: 'SvelteKit' },
 *   ];
 *   <Combobox items={items} value={value} onValueChange={setValue}>
 *     <ComboboxInput placeholder="Select a framework" />
 *     <ComboboxContent>
 *       <ComboboxList>
 *         {(item) => (
 *           <ComboboxItem key={item.value} value={item.value}>
 *             {item.label}
 *           </ComboboxItem>
 *         )}
 *       </ComboboxList>
 *     </ComboboxContent>
 *   </Combobox>
 *
 * Differences from the shadcn reference (no `@radix-ui/react-popover`):
 *   - The popover is a plain `absolute` div positioned below the
 *     input. Click-outside closes it via a document mousedown listener.
 *   - `cmdk` handles search filtering, keyboard nav, and the
 *     empty state. We expose `emptyMessage` on `ComboboxList`.
 *   - The input shows the selected item's label as a placeholder
 *     when one is picked, so the user can always see what's active.
 */
import { Command } from 'cmdk';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import clsx from 'clsx';

export interface ComboboxItem {
  value: string;
  label: string;
}

interface ComboboxContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  value: string;
  setValue: (value: string) => void;
  items: ComboboxItem[];
}

const ComboboxContext = createContext<ComboboxContextValue | null>(null);

function useComboboxContext(): ComboboxContextValue {
  const ctx = useContext(ComboboxContext);
  if (!ctx) {
    throw new Error('Combobox subcomponents must be used inside <Combobox>.');
  }
  return ctx;
}

const INPUT_CLS =
  'w-full rounded-lg border border-default bg-surface fg-primary placeholder-slate-400 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none';

export function Combobox({
  items,
  value,
  onValueChange,
  children,
}: {
  items: ComboboxItem[];
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(value ?? '');
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep internal state in sync with the controlled `value` prop.
  useEffect(() => {
    if (value !== undefined) setInternalValue(value);
  }, [value]);

  // Click outside closes the popover. We listen on mousedown (not
  // click) so a press that lands outside fires before any focus
  // shift inside the popover — prevents the "click selects then
  // outside click also fires" double-handler.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const setValue = (v: string) => {
    setInternalValue(v);
    onValueChange?.(v);
  };

  return (
    <ComboboxContext.Provider value={{ open, setOpen, value: internalValue, setValue, items }}>
      <div ref={containerRef} className="relative">
        <Command shouldFilter className="w-full">
          {children}
        </Command>
      </div>
    </ComboboxContext.Provider>
  );
}

export function ComboboxInput({
  placeholder,
  className,
}: {
  placeholder?: string;
  className?: string;
}) {
  const { setOpen, value, items } = useComboboxContext();
  // Show the selected item's label as the placeholder so the user
  // can always see what's picked, even after the search query is
  // cleared by `cmdk` on selection.
  const selected = items.find((item) => item.value === value);
  return (
    <Command.Input
      placeholder={selected ? selected.label : (placeholder ?? 'Select…')}
      onFocus={() => setOpen(true)}
      className={clsx(INPUT_CLS, className)}
    />
  );
}

export function ComboboxContent({ children }: { children: ReactNode }) {
  const { open } = useComboboxContext();
  return (
    <div
      className={clsx(
        'absolute top-full left-0 right-0 z-50 mt-1',
        !open && 'hidden',
      )}
    >
      {children}
    </div>
  );
}

export function ComboboxList({
  children,
  emptyMessage = 'No items found.',
}: {
  // Render-prop for the simple case: `(item) => <ComboboxItem .../>`
  // for each entry in the `items` prop. Pass JSX directly to use
  // `Command.Group` for grouped dropdowns (category › sub-category).
  children: ReactNode | ((item: ComboboxItem) => ReactNode);
  emptyMessage?: string;
}) {
  const { items } = useComboboxContext();
  return (
    <Command.List
      className={clsx(
        'max-h-60 overflow-auto rounded-lg border shadow-lg',
        'border-default bg-surface',
      )}
    >
      <Command.Empty className="px-3 py-2 text-sm fg-muted text-center">
        {emptyMessage}
      </Command.Empty>
      {typeof children === 'function'
        ? items.map((item) => children(item))
        : children}
    </Command.List>
  );
}

export function ComboboxItem({
  value: itemValue,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  const { setValue, setOpen, value: selectedValue } = useComboboxContext();
  const isSelected = selectedValue === itemValue;
  return (
    <Command.Item
      value={itemValue}
      onSelect={() => {
        setValue(itemValue);
        setOpen(false);
      }}
      className={clsx(
        'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer fg-secondary',
        'hover:bg-slate-100 dark:hover:bg-slate-700',
        'data-[selected=true]:bg-amber-50 dark:data-[selected=true]:bg-amber-900/30',
      )}
    >
      <span className="flex-1 truncate">{children}</span>
      {isSelected && (
        <span className="text-amber-700 dark:text-amber-400 text-xs">✓</span>
      )}
    </Command.Item>
  );
}
