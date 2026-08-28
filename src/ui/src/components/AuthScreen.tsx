import { useId, useState, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import clsx from 'clsx';
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group';

const WIDTH = {
  sm: 'max-w-sm',
  xl: 'max-w-xl',
} as const;

export function AuthPage({
  children,
  width = 'sm',
}: {
  children: ReactNode;
  width?: keyof typeof WIDTH;
}) {
  return (
    <div className="h-full overflow-y-auto bg-page px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:flex sm:items-center sm:justify-center">
      <div className={clsx('w-full', WIDTH[width])}>{children}</div>
    </div>
  );
}

export function AuthPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-xl border border-default bg-surface p-4 sm:p-5', className)}>
      {children}
    </div>
  );
}

export function AuthBrand({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      <img src="/logo.png" alt="Cura Money" className="mb-3 h-14 w-14" />
      <h1 className="text-2xl font-bold tracking-tight fg-primary">{title}</h1>
      {subtitle && <p className="mt-1 text-sm fg-secondary">{subtitle}</p>}
    </div>
  );
}

export function AuthTextField({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  mono,
  placeholder,
  required = true,
  autoComplete,
  name,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password';
  hint?: string;
  mono?: boolean;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  name?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword && !show ? 'password' : type === 'email' ? 'email' : 'text';

  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium fg-secondary">{label}</label>
      <InputGroup className="mt-1">
        <InputGroupInput
          id={id}
          type={inputType}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          autoComplete={autoComplete}
          disabled={disabled}
          spellCheck={type === 'email' ? false : undefined}
          className={mono ? 'font-mono' : undefined}
        />
        {isPassword && (
          <InputGroupAddon align="inline-end">
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="rounded-md p-1.5 fg-muted hover:fg-primary"
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </InputGroupAddon>
        )}
      </InputGroup>
      {hint && <span className="mt-1 block text-xs fg-muted">{hint}</span>}
    </div>
  );
}

export function AuthError({ message }: { message: string }) {
  return (
    <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
      {message}
    </p>
  );
}
