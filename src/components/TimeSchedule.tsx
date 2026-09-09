import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { subscribeToTable } from '../lib/supabase';
import {
  fetchScheduleItems, createScheduleItem, updateScheduleItem,
  deleteScheduleItems, bulkUpdateScheduleItems, importScheduleItems,
  syncScheduleDates,
} from '../lib/schedule';
import { Project, Enterprise } from '../types';
import DataGridModule from './DataGridModule';
import { GanttChartSquare, Activity, CheckCircle2, AlertCircle, Clock, RefreshCw, Upload, Download, Edit2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { AgGridReact } from 'ag-grid-react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from '../lib/utils';

interface ScheduleItem {
  id: string;
  projectId: string;
  activityId: string;
  description: string;
  activityPercentComplete: number;
  baselineStartDate: string;
  baselineEndDate: string;
  plannedStartDate: string;
  plannedEndDate: string;
  currentStartDate: string;
  currentEndDate: string;
  updatedAt?: any;
}

interface TimeScheduleProps {
  project: Project;
  enterprise: Enterprise;
  theme?: 'light' | 'dark';
}

export default function TimeSchedule({ project, enterprise, theme = 'light' }: TimeScheduleProps) {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [quickFilterText, setQuickFilterText] = useState('');
  const [selectedRows, setSelectedRows] = useState<ScheduleItem[]>([]);
  const gridRef = useRef<AgGridReact>(null);

  // Bulk Update State
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [bulkUpdateData, setBulkUpdateData] = useState<Partial<ScheduleItem>>({
    description: '',
    activityPercentComplete: 0,
    baselineStartDate: '',
    baselineEndDate: '',
    plannedStartDate: '',
    plannedEndDate: '',
    currentStartDate: '',
    currentEndDate: '',
  });

  const reload = useCallback(async () => {
    try {
      setItems(await fetchScheduleItems(project.id));
    } catch (error: any) {
      console.error('Schedule fetch error:', error);
      toast.error(`Failed to load schedule: ${error?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void reload();
    return subscribeToTable('schedule_items', `project_id=eq.${project.id}`, () => void reload());
  }, [reload, project.id]);

  const dateFormatter = (params: any) => {
    let val = params.value;
    if (!val) return '';
    
    const date = val instanceof Date ? val : new Date(val);
    if (isNaN(date.getTime())) return '';
    
    // Use local time for display exactly as preferred by user
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const safeDateGetter = (field: keyof ScheduleItem) => (params: any) => {
    let val = params.data?.[field];
    if (!val) return null;
    
    const date = val instanceof Date ? val : new Date(val);
    return isNaN(date.getTime()) ? null : date;
  };

  const safeDateSetter = (field: keyof ScheduleItem) => (params: any) => {
    const val = params.newValue;
    if (!val) {
      params.data[field] = '';
      return true;
    }
    
    const date = val instanceof Date ? val : new Date(val);
    if (isNaN(date.getTime())) {
      console.warn('Invalid date entered:', val);
      return false;
    }

    // Store as YYYY-MM-DD in local time to avoid UTC shifts
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    params.data[field] = `${y}-${m}-${d}`;
    return true;
  };

  const columnDefs = useMemo(() => [
    { 
      field: 'activityId', 
      headerName: 'Activity ID', 
      editable: true, 
      pinned: 'left',
      flex: 1,
      minWidth: 150,
      cellStyle: { fontWeight: 'bold' },
      checkboxSelection: (params: any) => !params.node?.rowPinned,
      headerCheckboxSelection: true,
    },
    { 
      field: 'description', 
      headerName: 'Activity Description', 
      editable: true,
      flex: 2,
      minWidth: 300
    },
    {
      field: 'activityPercentComplete',
      headerName: 'Activity % Complete',
      editable: true,
      width: 150,
      valueFormatter: (params: any) => params.value !== undefined ? `${params.value}%` : '',
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 0,
        max: 100,
        precision: 2
      },
      cellStyle: (params: any) => {
        const val = params.value || 0;
        if (val >= 100) return { color: '#059669', fontWeight: 'bold' };
        if (val > 0) return { color: '#2563eb', fontWeight: 'bold' };
        return null;
      }
    },
    { 
      headerName: 'Baseline Schedule',
      children: [
        { 
          field: 'baselineStartDate', 
          headerName: 'Baseline Start', 
          editable: true,
          width: 130,
          cellEditor: 'agDateCellEditor',
          valueFormatter: dateFormatter,
          valueGetter: safeDateGetter('baselineStartDate'),
          valueSetter: safeDateSetter('baselineStartDate')
        },
        { 
          field: 'baselineEndDate', 
          headerName: 'Baseline Finish', 
          editable: true,
          width: 130,
          cellEditor: 'agDateCellEditor',
          valueFormatter: dateFormatter,
          valueGetter: safeDateGetter('baselineEndDate'),
          valueSetter: safeDateSetter('baselineEndDate')
        }
      ]
    },
    { 
      headerName: 'Planned Schedule',
      children: [
        { 
          field: 'plannedStartDate', 
          headerName: 'Planned Start', 
          editable: true,
          width: 130,
          cellEditor: 'agDateCellEditor',
          valueFormatter: dateFormatter,
          valueGetter: safeDateGetter('plannedStartDate'),
          valueSetter: safeDateSetter('plannedStartDate')
        },
        { 
          field: 'plannedEndDate', 
          headerName: 'Planned Finish', 
          editable: true,
          width: 130,
          cellEditor: 'agDateCellEditor',
          valueFormatter: dateFormatter,
          valueGetter: safeDateGetter('plannedEndDate'),
          valueSetter: safeDateSetter('plannedEndDate')
        }
      ]
    },
    { 
      headerName: 'Current / Forecast',
      children: [
        { 
          field: 'currentStartDate', 
          headerName: 'Current Start', 
          editable: true,
          width: 130,
          cellEditor: 'agDateCellEditor',
          valueFormatter: dateFormatter,
          valueGetter: safeDateGetter('currentStartDate'),
          valueSetter: safeDateSetter('currentStartDate')
        },
        { 
          field: 'currentEndDate', 
          headerName: 'Current Finish', 
          editable: true,
          width: 130,
          cellEditor: 'agDateCellEditor',
          valueFormatter: dateFormatter,
          valueGetter: safeDateGetter('currentEndDate'),
          valueSetter: safeDateSetter('currentEndDate')
        }
      ]
    }
  ], [items]);

  const validateActivityId = (newId: string, currentDocId?: string) => {
    if (!newId) return 'Activity ID is required';
    const exists = items.find(item => item.activityId === newId && item.id !== currentDocId);
    if (exists) return `Activity ID "${newId}" already exists in this project`;
    return null;
  };

  const onCellValueChanged = async (event: any) => {
    const { data, colDef, oldValue } = event;
    const newValue = data[colDef.field]; // Get transformed value (string for dates) from setter
    if (newValue === oldValue) return;

    if (colDef.field === 'activityId') {
      const error = validateActivityId(newValue, data.id);
      if (error) {
        toast.error(error);
        event.node.setDataValue(colDef.field, oldValue);
        return;
      }
    }

    try {
      await updateScheduleItem(data.id, { [colDef.field]: newValue } as any);
      await reload();
    } catch (error: any) {
      console.error('Update failed', error);
      toast.error(`Failed to update activity: ${error?.message || 'Unknown error'}`);
      await reload();
    }
  };

  const handleAdd = async () => {
    try {
      let nextId = items.length + 1;
      let activityId = `ACT-${nextId}`;
      
      while (items.some(item => item.activityId === activityId)) {
        nextId++;
        activityId = `ACT-${nextId}`;
      }

      const today = new Date().toISOString().split('T')[0];
      await createScheduleItem(project.id, {
        activityId,
        description: 'New Activity',
        activityPercentComplete: 0,
        baselineStartDate: today,
        baselineEndDate: today,
        plannedStartDate: today,
        plannedEndDate: today,
        currentStartDate: today,
        currentEndDate: today,
      } as any);
      await reload();
      toast.success('Activity added');
    } catch (error: any) {
      console.error('Failed to add activity', error);
      toast.error(`Failed to add activity: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedRows.length === 0) return;
    
    // Filter out fields that are empty strings (unmodified by user in bulk dialog)
    const updates: any = {};
    if (bulkUpdateData.description) updates.description = bulkUpdateData.description;
    if (bulkUpdateData.activityPercentComplete !== undefined && bulkUpdateData.activityPercentComplete !== 0) {
      updates.activityPercentComplete = Number(bulkUpdateData.activityPercentComplete);
    }
    if (bulkUpdateData.baselineStartDate) updates.baselineStartDate = bulkUpdateData.baselineStartDate;
    if (bulkUpdateData.baselineEndDate) updates.baselineEndDate = bulkUpdateData.baselineEndDate;
    if (bulkUpdateData.plannedStartDate) updates.plannedStartDate = bulkUpdateData.plannedStartDate;
    if (bulkUpdateData.plannedEndDate) updates.plannedEndDate = bulkUpdateData.plannedEndDate;
    if (bulkUpdateData.currentStartDate) updates.currentStartDate = bulkUpdateData.currentStartDate;
    if (bulkUpdateData.currentEndDate) updates.currentEndDate = bulkUpdateData.currentEndDate;

    if (Object.keys(updates).length === 0) {
      toast.error('No changes specified for bulk update');
      return;
    }

    toast.promise(async () => {
      // One statement for every selected activity.
      await bulkUpdateScheduleItems(selectedRows.map(row => row.id), updates);
      await reload();
      setIsBulkUpdating(false);
      setBulkUpdateData({
        description: '',
        activityPercentComplete: 0,
        baselineStartDate: '',
        baselineEndDate: '',
        plannedStartDate: '',
        plannedEndDate: '',
        currentStartDate: '',
        currentEndDate: '',
      });
    }, {
      loading: `Updating ${selectedRows.length} activities...`,
      success: 'Bulk update completed',
      error: 'Bulk update failed'
    });
  };

  const handleBulkDelete = async () => {
    if (selectedRows.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedRows.length} activities?`)) return;

    try {
      await deleteScheduleItems(selectedRows.map(row => row.id));
      await reload();
      toast.success('Activities deleted');
    } catch (error: any) {
      console.error('Failed to delete activities', error);
      toast.error(`Failed to delete activities: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleSyncDates = async () => {
    if (items.length === 0) return;

    toast.promise(async () => {
      // Four UPDATE ... FROM statements in the database, joined on Activity ID.
      // This used to read every progress item, ETC detail line, cost code and
      // subcontract in the project into the browser, compare each one's dates
      // in JavaScript and write back the ones that differed -- at this app's
      // scale, the whole forecast crossing the network for one button press.
      //
      // Only rows whose dates actually differ are touched, so the count means
      // what it did before and running it twice is a no-op the second time.
      const updated = await syncScheduleDates(project.id);
      return `${updated} records synchronized across modules`;
    }, {
      loading: 'Synchronizing dates across modules...',
      success: (msg) => msg as string,
      error: (err: any) => `Synchronization failed: ${err?.message || 'Unknown error'}`,
    });
  };

  const handleExport = () => {
    if (!gridRef.current) return;
    gridRef.current.api.exportDataAsExcel();
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx, .xls, .csv';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (evt: any) => {
        try {
          const wb = XLSX.read(evt.target.result, { type: 'binary' });
          const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];

          // A DATE column takes yyyy-mm-dd; an empty cell is null, not ''.
          const asDate = (v: any) => {
            if (!v) return null;
            const d = new Date(v);
            if (isNaN(d.getTime())) return null;
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
          };

          const seen = new Set<string>();
          const rows: any[] = [];
          let duplicatesInFile = 0;

          data.forEach(row => {
            const activityId = String(row['Activity ID'] || row['activityId'] || row['ID'] || '').trim();
            if (!activityId) return;
            // A sheet naming the same activity twice would have the second row
            // silently win, so the later one is reported instead.
            if (seen.has(activityId)) { duplicatesInFile++; return; }
            seen.add(activityId);

            rows.push({
              activityId,
              description: String(row['Activity Description'] || row['description'] || row['Description'] || ''),
              activityPercentComplete: Number(row['Activity % Complete'] || row['activityPercentComplete'] || row['Percent Complete'] || 0),
              baselineStartDate: asDate(row['Baseline Start Date'] || row['baselineStartDate'] || row['Baseline Start']),
              baselineEndDate: asDate(row['Baseline End Date'] || row['baselineEndDate'] || row['Baseline Finish']),
              plannedStartDate: asDate(row['Planned Start Date'] || row['plannedStartDate'] || row['Start']),
              plannedEndDate: asDate(row['Planned End Date'] || row['plannedEndDate'] || row['Finish']),
              currentStartDate: asDate(row['Current Start Date'] || row['currentStartDate'] || row['Current Start']),
              currentEndDate: asDate(row['Current End Date'] || row['currentEndDate'] || row['Current Finish']),
            });
          });

          if (rows.length === 0) {
            toast.error('No rows in the sheet carried an Activity ID.');
            return;
          }

          // One statement, whatever the size of the schedule. Upsert on
          // (project_id, activity_id): an activity the project already has is
          // updated rather than skipped, so re-importing a revised programme
          // works instead of silently doing nothing.
          const imported = await importScheduleItems(project.id, rows);
          await reload();
          toast.success(
            `Imported ${imported} activities.` +
            (duplicatesInFile > 0 ? ` Skipped ${duplicatesInFile} duplicate IDs within the file.` : '')
          );
        } catch (err: any) {
          console.error('Schedule import failed', err);
          toast.error(`Failed to import schedule: ${err?.message || 'Unknown error'}`);
        }
      };
      reader.readAsBinaryString(file);
    };
    input.click();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 p-8 pt-4">
      <DataGridModule
        title="Time Schedule Module"
        description="Master project schedule integration - Activity ID reference center."
        icon={<GanttChartSquare className="w-6 h-6 text-blue-600" />}
        rowData={items}
        columnDefs={columnDefs}
        quickFilterText={quickFilterText}
        onQuickFilterChange={setQuickFilterText}
        onAdd={handleAdd}
        onImport={handleImport}
        onExport={handleExport}
        gridRef={gridRef}
        theme={theme}
        onCellValueChanged={onCellValueChanged}
        selectedCount={selectedRows.length}
        onBulkUpdate={() => setIsBulkUpdating(true)}
        onBulkDelete={handleBulkDelete}
        extraToolbarActions={
          <div className="flex items-center gap-2">
            <button 
              onClick={handleSyncDates}
              className="px-4 py-2 bg-black hover:bg-slate-800 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-lg shadow-black/20"
              title="Push latest schedule dates to all linked modules (Cost Phasing, Progress, etc)"
            >
              <RefreshCw className="w-4 h-4" />
              Sync Dates to Modules
            </button>
          </div>
        }
        gridProps={{
          onSelectionChanged: (p: any) => setSelectedRows(p.api.getSelectedRows()),
          rowSelection: 'multiple'
        }}
      />

      <Dialog open={isBulkUpdating} onOpenChange={setIsBulkUpdating}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden rounded-3xl border-none shadow-2xl">
          <DialogHeader className="p-8 pb-4 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
            <div className="flex items-center gap-4 mb-2">
              <div className="p-3 bg-white/20 rounded-2xl backdrop-blur-md">
                <Edit2 className="w-6 h-6 text-white" />
              </div>
              <div>
                <DialogTitle className="text-2xl font-black">Bulk Update Activities</DialogTitle>
                <DialogDescription className="text-blue-100 font-medium">
                  Updating {selectedRows.length} selected activities in the schedule
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <ScrollArea className="flex-1 p-8">
            <div className="space-y-8">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Activity Description</label>
                  <Input 
                    value={bulkUpdateData.description}
                    onChange={e => setBulkUpdateData({ ...bulkUpdateData, description: e.target.value })}
                    placeholder="Enter common description..."
                    className="h-12 rounded-2xl border-slate-200 focus:ring-blue-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Activity % Complete</label>
                  <Input 
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={bulkUpdateData.activityPercentComplete}
                    onChange={e => setBulkUpdateData({ ...bulkUpdateData, activityPercentComplete: Number(e.target.value) })}
                    placeholder="Enter common % complete..."
                    className="h-12 rounded-2xl border-slate-200 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-8 pt-4 border-t border-slate-100">
                <div className="space-y-6">
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-slate-400" />
                    Baseline Dates
                  </h4>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Start Date</label>
                    <Input 
                      type="date"
                      value={bulkUpdateData.baselineStartDate}
                      onChange={e => setBulkUpdateData({ ...bulkUpdateData, baselineStartDate: e.target.value })}
                      className="h-12 rounded-2xl border-slate-200"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Finish Date</label>
                    <Input 
                      type="date"
                      value={bulkUpdateData.baselineEndDate}
                      onChange={e => setBulkUpdateData({ ...bulkUpdateData, baselineEndDate: e.target.value })}
                      className="h-12 rounded-2xl border-slate-200"
                    />
                  </div>
                </div>

                <div className="space-y-6">
                  <h4 className="text-xs font-black text-blue-600 uppercase tracking-wider flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    Planned Dates
                  </h4>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Start Date</label>
                    <Input 
                      type="date"
                      value={bulkUpdateData.plannedStartDate}
                      onChange={e => setBulkUpdateData({ ...bulkUpdateData, plannedStartDate: e.target.value })}
                      className="h-12 rounded-2xl border-slate-200"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Finish Date</label>
                    <Input 
                      type="date"
                      value={bulkUpdateData.plannedEndDate}
                      onChange={e => setBulkUpdateData({ ...bulkUpdateData, plannedEndDate: e.target.value })}
                      className="h-12 rounded-2xl border-slate-200"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-6 pt-4 border-t border-slate-100">
                <h4 className="text-xs font-black text-emerald-600 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Current / Forecast Dates
                </h4>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Start Date</label>
                    <Input 
                      type="date"
                      value={bulkUpdateData.currentStartDate}
                      onChange={e => setBulkUpdateData({ ...bulkUpdateData, currentStartDate: e.target.value })}
                      className="h-12 rounded-2xl border-slate-200"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Finish Date</label>
                    <Input 
                      type="date"
                      value={bulkUpdateData.currentEndDate}
                      onChange={e => setBulkUpdateData({ ...bulkUpdateData, currentEndDate: e.target.value })}
                      className="h-12 rounded-2xl border-slate-200"
                    />
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="p-8 bg-slate-50 gap-3 border-t border-slate-100">
            <Button 
              variant="outline" 
              onClick={() => setIsBulkUpdating(false)}
              className="h-12 px-8 rounded-2xl font-bold border-slate-200"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleBulkUpdate}
              className="h-12 px-8 rounded-2xl font-bold bg-blue-600 hover:bg-blue-700 shadow-xl shadow-blue-600/20"
            >
              Update {selectedRows.length} Activities
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
