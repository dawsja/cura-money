import { useId, useState, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';

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
    <div className="h-full overflow-y-auto bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:flex sm:items-center sm:justify-center">
      <div className={cn('w-full', WIDTH[width])}>{children}</div>
    </div>
  );
}

export function AuthPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

export function AuthBrand({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-2 flex flex-col items-center text-center">
      <img src="/logo.png" alt="Cura Money" className="mb-3 size-14" />
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
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
    <FieldGroup>
      <Field data-disabled={disabled || undefined}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <InputGroup>
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
              <InputGroupButton
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                {show ? <EyeOff /> : <Eye />}
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      </Field>
    </FieldGroup>
  );
}

export function AuthError({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
