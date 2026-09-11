import { supabase } from './supabase';
import { getCurrentUser } from './currentUser';

/**
 * Append-only record of who did what.
 *
 * The table has no update or delete policy, and its insert policy requires
 * user_id to be the acting user, so a row cannot be written on someone else's
 * behalf or edited afterwards.
 *
 * A failure here is logged and swallowed: an audit write must never take down
 * the action it is recording.
 */
export async function logAuditAction(
  enterpriseId: string,
  projectId: string | null,
  action: string,
  details: any = {}
): Promise<void> {
  const user = getCurrentUser();
  if (!user) return;

  try {
    const { error } = await supabase.from('audit_logs').insert({
      enterprise_id: enterpriseId,
      project_id: projectId,
      user_id: user.uid,
      user_email: user.email,
      action,
      details,
    });
    if (error) console.error('Audit log failed:', error.message);
  } catch (error) {
    console.error('Audit log failed:', error);
  }
}
