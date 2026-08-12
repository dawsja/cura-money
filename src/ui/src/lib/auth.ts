/**
 * Auth client wrapper. Better Auth exposes /api/auth/* for sign-in, sign-up,
 * sign-out, session, OIDC. We talk to it via plain fetch.
 */
import { api, type ApiError } from './api';

export interface Me {
  user: {
    id: string;
    email: string;
    name: string;
    role: 'admin' | 'user';
    /** True when the user has an email/password account row. False for
     *  OIDC-only users (they don't have a password to change). */
    hasCredential: boolean;
  };
  preferences: {
    /** ISO 4217 display-currency code, e.g. "USD". */
    currency: string;
  };
}

/**
 * Key used to flag a "just signed out" state across the redirect to
 * /sign-in. SignIn reads this on mount and, if set, forces the next
 * OIDC click to include `prompt=login` so the IdP actually re-auths
 * instead of silently using its own session cookie.
 *
 * Why sessionStorage and not a query param:
 *   App.tsx's protected Layout has a wildcard that redirects anything
 *   (including /sign-in?from=signout) back to / while meQ.data is still
 *   truthy during the refetch window. So a query param gets eaten by
 *   that redirect. sessionStorage survives the route change and is
 *   cleared on read.
 */
export const SIGNOUT_FLAG_KEY = 'cura.fromSignOut';

export async function fetchMe(): Promise<Me | null> {
  try {
    return await api.get<Me>('/api/auth-app/me');
  } catch (err) {
    if ((err as ApiError).status === 401) return null;
    throw err;
  }
}

/**
 * Change the current user's password via Better Auth's built-in
 * `changePassword` flow. Only works for users with a credential account
 * (the client checks `me.user.hasCredential` before showing the form);
 * for OIDC users the server returns 400.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post('/api/auth/change-password', { currentPassword, newPassword });
}

export async function signOut(): Promise<void> {
  await api.post('/api/auth-app/sign-out');
}

export async function signInEmail(email: string, password: string): Promise<void> {
  await api.post('/api/auth/sign-in/email', { email, password });
}

export async function signUpEmail(email: string, password: string, name: string): Promise<void> {
  await api.post('/api/auth/sign-up/email', { email, password, name });
}

export async function startOidc(providerId: string, callbackURL: string): Promise<void> {
  // Better Auth's genericOAuth plugin exposes /api/auth/sign-in/oauth/:providerId
  window.location.href = `/api/auth/sign-in/oauth/${encodeURIComponent(
    providerId,
  )}?callbackURL=${encodeURIComponent(callbackURL)}`;
}
