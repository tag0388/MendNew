import { supabase, fromRow, fromRows, raise } from './supabase';
import type { Enterprise, Project } from '../types';

export type EnterpriseRole = 'Enterprise System Admin' | 'Enterprise User';
export type ProjectRole = 'Project Admin' | 'Project User';

export interface EnterpriseMembership {
  enterpriseId: string;
  role: EnterpriseRole;
  name: string;
}

/**
 * Who the signed-in user is, and what they can reach.
 *
 * The Firestore version loaded the enterprise with
 *   where('adminUsers', 'array-contains', uid)
 * so an ordinary Enterprise User matched nothing and the app rendered empty.
 * Membership now comes from enterprise_members, so normal users load their
 * enterprise too -- they simply have no projects until they are assigned one.
 */
export interface SessionContext {
  userId: string;
  email: string;
  displayName: string | null;
  photoUrl: string | null;
  isPlatformAdmin: boolean;
  memberships: EnterpriseMembership[];
}

export async function loadSessionContext(userId: string, email: string): Promise<SessionContext> {
  const [profileRes, adminRes, membershipRes] = await Promise.all([
    supabase.from('user_profiles').select('display_name, photo_url').eq('id', userId).maybeSingle(),
    supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    supabase
      .from('enterprise_members')
      .select('enterprise_id, role, enterprises(name)')
      .eq('user_id', userId),
  ]);

  raise('load profile', profileRes.error);
  raise('load memberships', membershipRes.error);
  // A non-admin reading platform_admins sees zero rows rather than an error;
  // only a genuine failure is worth surfacing.
  if (adminRes.error && adminRes.error.code !== 'PGRST116') {
    console.warn('platform_admins probe failed:', adminRes.error.message);
  }

  const profile = profileRes.data as { display_name: string | null; photo_url: string | null } | null;

  return {
    userId,
    email,
    displayName: profile?.display_name ?? null,
    photoUrl: profile?.photo_url ?? null,
    isPlatformAdmin: Boolean(adminRes.data),
    memberships: (membershipRes.data ?? []).map((row: any) => ({
      enterpriseId: row.enterprise_id,
      role: row.role as EnterpriseRole,
      name: row.enterprises?.name ?? 'Untitled enterprise',
    })),
  };
}

// ------------------------------------------------------------ enterprise ----

export async function fetchEnterprise(enterpriseId: string): Promise<Enterprise | null> {
  const { data, error } = await supabase
    .from('enterprises')
    .select('*')
    .eq('id', enterpriseId)
    .maybeSingle();
  raise('load enterprise', error);
  if (!data) return null;

  // Vendors and resource rates are their own tables now; the components still
  // read them as arrays hanging off the enterprise.
  const [vendorsRes, ratesRes] = await Promise.all([
    supabase.from('vendors').select('*').eq('enterprise_id', enterpriseId).order('name'),
    supabase.from('resource_rates').select('*').eq('enterprise_id', enterpriseId).order('sort_order'),
  ]);
  raise('load vendors', vendorsRes.error);
  raise('load resource rates', ratesRes.error);

  return {
    ...(fromRow<Enterprise>(data) as Enterprise),
    vendors: fromRows(vendorsRes.data),
    resourceRates: fromRows(ratesRes.data),
  };
}

/**
 * Projects the user may open. RLS already filters this: an enterprise admin
 * sees every project in the enterprise, a normal user only those they are a
 * member of, which is what "doesn't see anything until assigned" means.
 */
export async function fetchProjects(enterpriseId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .order('project_name');
  raise('load projects', error);
  return fromRows<Project>(data);
}

// ------------------------------------------------------------ membership ----

export interface EnterpriseUser {
  userId: string;
  email: string;
  displayName: string | null;
  photoUrl: string | null;
  role: EnterpriseRole;
  joinedAt: string;
}

export async function fetchEnterpriseUsers(enterpriseId: string): Promise<EnterpriseUser[]> {
  const { data, error } = await supabase
    .from('enterprise_members')
    .select('user_id, role, joined_at, user_profiles(email, display_name, photo_url)')
    .eq('enterprise_id', enterpriseId);
  raise('load enterprise users', error);

  return (data ?? []).map((row: any) => ({
    userId: row.user_id,
    email: row.user_profiles?.email ?? '',
    displayName: row.user_profiles?.display_name ?? null,
    photoUrl: row.user_profiles?.photo_url ?? null,
    role: row.role as EnterpriseRole,
    joinedAt: row.joined_at,
  }));
}

export async function setEnterpriseRole(
  enterpriseId: string,
  userId: string,
  role: EnterpriseRole
): Promise<void> {
  const { error } = await supabase
    .from('enterprise_members')
    .update({ role })
    .eq('enterprise_id', enterpriseId)
    .eq('user_id', userId);
  raise('update enterprise role', error);
}

export async function removeEnterpriseUser(enterpriseId: string, userId: string): Promise<void> {
  // project_members and cost_code_users cascade from this row, so removing
  // someone from the enterprise removes every project and cost code
  // assignment they held in it.
  const { error } = await supabase
    .from('enterprise_members')
    .delete()
    .eq('enterprise_id', enterpriseId)
    .eq('user_id', userId);
  raise('remove enterprise user', error);
}

// ------------------------------------------------------------ invitations ----

/**
 * Firestore built this token from Math.random(), which is not a CSPRNG -- and
 * the token is what grants access to an enterprise.
 */
function secureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Invitation {
  id: string;
  email: string;
  role: EnterpriseRole;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
}

export async function fetchInvitations(enterpriseId: string): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from('invitations')
    .select('id, email, role, status, expires_at, created_at')
    .eq('enterprise_id', enterpriseId)
    .order('created_at', { ascending: false });
  raise('load invitations', error);
  return fromRows<Invitation>(data);
}

export async function createInvitation(
  enterpriseId: string,
  email: string,
  role: EnterpriseRole,
  invitedBy: string
): Promise<{ token: string; link: string }> {
  const token = secureToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.from('invitations').insert({
    enterprise_id: enterpriseId,
    email: email.toLowerCase().trim(),
    token,
    role,
    status: 'pending',
    invited_by: invitedBy,
    expires_at: expiresAt,
  });
  raise('create invitation', error);

  return { token, link: `${window.location.origin}?token=${token}` };
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase
    .from('invitations')
    .update({ status: 'revoked' })
    .eq('id', invitationId);
  raise('revoke invitation', error);
}

/**
 * Redeems a token. The whole check-and-join runs in one SECURITY DEFINER
 * function so the recipient cannot rewrite which enterprise or role they are
 * being granted -- in Firestore this was a client-side update.
 * Returns the enterprise joined.
 */
export async function acceptInvitation(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_invitation', { invite_token: token });
  raise('accept invitation', error);
  return data as string;
}

// --------------------------------------------------------- own profile ----

export interface OwnProfile {
  displayName: string;
  email: string;
  photoUrl: string | null;
  preferences: Record<string, any>;
  role: EnterpriseRole | null;
  joinedAt: string | null;
}

export async function fetchOwnProfile(
  userId: string,
  enterpriseId: string
): Promise<OwnProfile | null> {
  const [profileRes, memberRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('email, display_name, photo_url, preferences')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('enterprise_members')
      .select('role, joined_at')
      .eq('enterprise_id', enterpriseId)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  raise('load profile', profileRes.error);
  raise('load membership', memberRes.error);
  if (!profileRes.data) return null;

  const p = profileRes.data as any;
  const m = memberRes.data as any;
  return {
    displayName: p.display_name ?? '',
    email: p.email ?? '',
    photoUrl: p.photo_url ?? null,
    preferences: p.preferences ?? {},
    role: m?.role ?? null,
    joinedAt: m?.joined_at ?? null,
  };
}

/**
 * Writes the caller's own profile. RLS restricts user_profiles updates to
 * `id = auth.uid()`, so this cannot touch anyone else's row.
 *
 * TODO: photoUrl currently holds a base64 data URL, as it did in Firestore.
 * It belongs in Supabase Storage with only the URL kept here -- worth doing
 * before real avatars go in, but it no longer bloats the enterprise document.
 */
export async function updateOwnProfile(
  userId: string,
  patch: { displayName?: string; photoUrl?: string; preferences?: Record<string, any> }
): Promise<void> {
  const row: Record<string, any> = {};
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.photoUrl !== undefined) row.photo_url = patch.photoUrl;
  if (patch.preferences !== undefined) row.preferences = patch.preferences;
  if (Object.keys(row).length === 0) return;

  const { error } = await supabase.from('user_profiles').update(row).eq('id', userId);
  raise('update profile', error);
}
