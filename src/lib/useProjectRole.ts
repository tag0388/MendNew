import { useEffect, useState } from 'react';
import { fetchMyProjectRole } from './projects';
import { getCurrentUser } from './currentUser';
import type { ProjectRole } from './session';

export type EffectiveProjectRole = ProjectRole | 'Enterprise System Admin' | null;

/**
 * The signed-in user's role on a project, from the database.
 *
 * This replaces three broken checks that were doing the job in components:
 *
 *   enterprise?.users?.[userId]?.role === 'Enterprise System Admin'
 *   project?.users?.[userId] === 'Project Admin'
 *   userEmail === 'someone@example.com'
 *
 * The first two read maps that existed on the Firestore documents and do not
 * exist in the relational model, so they were always undefined -- which left
 * the hardcoded email address as the only thing still granting admin. That is
 * one person, by address, in eight files.
 *
 * This is a UI gate only. The database is the real boundary: RLS refuses the
 * writes regardless of what the interface offers. Getting it right still
 * matters, because showing someone controls that will fail is its own kind of
 * broken.
 */
export function useProjectRole(projectId: string | undefined): {
  role: EffectiveProjectRole;
  isProjectAdmin: boolean;
  loading: boolean;
} {
  const [role, setRole] = useState<EffectiveProjectRole>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = getCurrentUser()?.uid;
    if (!projectId || !uid) {
      setRole(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void fetchMyProjectRole(projectId, uid)
      .then((r) => { if (active) setRole(r); })
      .catch((error) => {
        console.error('Failed to load project role', error);
        if (active) setRole(null);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  return {
    role,
    // An enterprise admin acts as a project admin throughout the enterprise;
    // fetchMyProjectRole already resolves that.
    isProjectAdmin: role === 'Project Admin' || role === 'Enterprise System Admin',
    loading,
  };
}
