import { supabase, fromRows, raise } from './supabase';

/** Per-user grid layouts. RLS restricts every row to `user_id = auth.uid()`. */
export interface SavedView {
  id: string;
  name: string;
  tableId: string;
  columns: string[];
  gridState: any;
  createdAt: string;
}

export async function fetchSavedViews(userId: string, tableId?: string): Promise<SavedView[]> {
  let q = supabase.from('saved_views').select('*').eq('user_id', userId);
  if (tableId) q = q.eq('table_id', tableId);
  const { data, error } = await q.order('created_at', { ascending: false });
  raise('load saved views', error);
  return fromRows<SavedView>(data);
}

export async function createSavedView(
  userId: string,
  view: { name: string; tableId: string; columns: string[]; gridState?: any; projectId?: string }
): Promise<void> {
  const { error } = await supabase.from('saved_views').insert({
    user_id: userId,
    name: view.name,
    table_id: view.tableId,
    columns: view.columns,
    grid_state: view.gridState ?? null,
    project_id: view.projectId ?? null,
  });
  raise('save view', error);
}

export async function deleteSavedView(viewId: string): Promise<void> {
  const { error } = await supabase.from('saved_views').delete().eq('id', viewId);
  raise('delete view', error);
}
