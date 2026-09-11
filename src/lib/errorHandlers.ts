import { getCurrentUser } from './currentUser';

/**
 * Reporting a failed database call.
 *
 * This used to serialise the whole Firebase auth object -- provider list,
 * tenant, anonymous flag -- into the thrown message, which then reached the
 * user as a toast. None of it told anybody anything, and it put the signed-in
 * address into the UI. What a caller needs is what failed and why; the acting
 * user goes to the console for support, not into the message.
 */
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleDatabaseError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Database error', {
    message,
    operationType,
    path,
    userId: getCurrentUser()?.uid,
  });
  throw new Error(`Could not ${operationType} ${path ?? 'record'}: ${message}`);
}

/**
 * Kept under its old name so the modules still being converted keep compiling.
 * Remove the alias once nothing imports it.
 */
export const handleFirestoreError = handleDatabaseError;
