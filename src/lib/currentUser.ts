import { supabase } from './supabase';

/**
 * TEMPORARY MIGRATION BRIDGE.
 *
 * 25 components still read `auth.currentUser?.uid` / `.email` from the Firebase
 * SDK. Porting 50k lines in one pass would be untestable, so this mirrors the
 * Supabase session behind the same shape, letting modules be converted one at
 * a time. Delete it once no component imports from '../firebase'.
 *
 * Never use this for authorization -- it is a client-side convenience for
 * display and for stamping created_by. Access is decided by RLS.
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
