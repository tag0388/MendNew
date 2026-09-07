import { db, auth } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';

export async function logAuditAction(
  enterpriseId: string, 
  projectId: string | null, 
  action: string, 
  details: any = {}
) {
  const user = auth.currentUser;
  if (!user) return;

  try {
    await addDoc(collection(db, 'auditLogs'), {
      enterpriseId,
      projectId,
      userId: user.uid,
      userEmail: user.email,
      action,
      timestamp: new Date().toISOString(),
      details
    });
  } catch (error) {
    console.error('Audit log failed:', error);
  }
}
