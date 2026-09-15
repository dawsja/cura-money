import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CircleHelp, Laptop, LogOut, Moon, Settings, Sun } from 'lucide-react';
import { fetchMe, signOut, SIGNOUT_FLAG_KEY } from '../lib/auth';
import { useFinancialOnboarding } from './FinancialOnboardingProvider';
import { useTheme, type ThemePreference } from './ThemeProvider';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const themeOptions: Array<{
  value: ThemePreference;
  label: string;
  icon: typeof Laptop;
}> = [
  { value: 'system', label: 'System', icon: Laptop },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
];

export function ProfileMenu() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onboarding = useFinancialOnboarding();
  const { preference, setPreference } = useTheme();
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe });

  const onSignOut = async () => {
    await signOut();
    sessionStorage.setItem(SIGNOUT_FLAG_KEY, '1');
    qc.invalidateQueries({ queryKey: ['me'] });
  };

  const name = me.data ? displayName(me.data.user) : '—';
  const email = me.data?.user.email ?? '';
  const initials = me.data ? initialsFor(name) : '?';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="size-11 md:size-11" aria-label="Open profile menu">
          <Avatar>
            <AvatarFallback className="bg-primary/15 text-sm text-primary">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <div className="font-semibold">{name}</div>
            <div className="truncate text-xs font-normal text-muted-foreground" title={email}>
              {email}
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preference}
            onValueChange={(value) => setPreference(value as ThemePreference)}
          >
            {themeOptions.map((option) => {
              const Icon = option.icon;
              return (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  <Icon />
                  {option.label}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => navigate('/settings')}>
            <Settings />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={onboarding.isSaving}
            onClick={() => onboarding.restart()}
          >
            <CircleHelp />
            Tutorial
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => void onSignOut()}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function displayName(user: { name: string; email: string }): string {
  const n = user.name?.trim();
  if (n) return n;
  const local = user.email?.split('@')[0]?.trim();
  if (local) return local;
  return 'User';
}

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]![0]!.toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
