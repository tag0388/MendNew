import { supabase } from './supabase';

/**
 * The signed-in user, for display and for stamping created_by.
 *
 * This began as a bridge while modules were converted one at a time; the SDK
 * it mirrored is gone now and this is simply where the session is read from.
 *
 * Never use it for authorization. Access is decided by RLS, which reads the
 * session server-side -- what this object says is a client-side convenience
 * and a browser can say anything.
 */
export interface CurrentUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

let current: CurrentUser | null = null;

export function getCurrentUser(): CurrentUser | null {
  return current;
}

export function setCurrentUser(user: CurrentUser | null): void {
  current = user;
}

/** Mirrors a Supabase user onto the shape the older components expect. */
export function toCurrentUser(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, any>;
} | null): CurrentUser | null {
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  return {
    uid: user.id,
    email: user.email ?? null,
    displayName: meta.display_name ?? meta.full_name ?? meta.name ?? null,
    photoURL: meta.photo_url ?? meta.avatar_url ?? null,
  };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  current = null;
}
