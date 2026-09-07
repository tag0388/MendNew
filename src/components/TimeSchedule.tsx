import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, writeBatch, getDocs } from 'firebase/firestore';
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

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const message = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: message,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  // Show user-friendly error toast
  if (message.includes('permission-denied')) {
    toast.error('Permission denied: You do not have access to perform this operation.');
  } else {
    toast.error(`Operation failed: ${message}`);
  }
  
  throw new Error(JSON.stringify(errInfo));
}

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

  useEffect(() => {
    const q = query(collection(db, 'scheduleItems'), where('projectId', '==', project.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data() as ScheduleItem, id: doc.id }));
      setItems(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'scheduleItems');
    });
    return () => unsubscribe();
  }, [project.id]);

  const dateFormatter = (params: any) => {
    let val = params.value;
    if (!val) return '';
    
    // Handle Firestore Timestamp
    if (val && typeof val === 'object' && 'seconds' in val) {
      val = new Date(val.seconds * 1000);
    }
    
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
    
    // Handle Firestore Timestamp
    if (val && typeof val === 'object' && 'seconds' in val) {
      val = new Date(val.seconds * 1000);
    }
    
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

    const updateData: any = { [colDef.field]: newValue || '', updatedAt: new Date().toISOString() };
    
    try {
      await updateDoc(doc(db, 'scheduleItems', data.id), updateData);
    } catch (error: any) {
      console.error('Update failed', error);
      handleFirestoreError(error, OperationType.UPDATE, `scheduleItems/${data.id}`);
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
      await addDoc(collection(db, 'scheduleItems'), {
        projectId: project.id,
        activityId,
        description: 'New Activity',
        activityPercentComplete: 0,
        baselineStartDate: today,
        baselineEndDate: today,
        plannedStartDate: today,
        plannedEndDate: today,
        currentStartDate: today,
        currentEndDate: today,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      toast.success('Activity added');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, 'scheduleItems');
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

    updates.updatedAt = new Date().toISOString();

    toast.promise(async () => {
      const batch = writeBatch(db);
      selectedRows.forEach(row => {
        batch.update(doc(db, 'scheduleItems', row.id), updates);
      });
      await batch.commit();
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
      const batch = writeBatch(db);
      selectedRows.forEach(row => {
        batch.delete(doc(db, 'scheduleItems', row.id));
      });
      await batch.commit();
      toast.success('Activities deleted');
    } catch (error: any) {
      toast.error('Failed to delete activities: ' + (error.message || 'Unknown error'));
      handleFirestoreError(error, OperationType.DELETE, 'scheduleItems');
    }
  };

  const handleSyncDates = async () => {
    if (items.length === 0) return;
    
    toast.promise(async () => {
      try {
        const batch = writeBatch(db);
        let totalUpdated = 0;

        // Collections to sync
        const syncCollections = ['progressItems', 'etcDetails', 'subcontractLineItems', 'costCodes', 'subcontracts'];
        
        for (const colName of syncCollections) {
          const q = query(collection(db, colName), where('projectId', '==', project.id));
          const snap = await getDocs(q);
          
          snap.docs.forEach(d => {
            const itemData = d.data();
            
            // Handle standard individual items
            if (colName !== 'subcontracts') {
              if (itemData.activityId) {
                const scheduleItem = items.find(s => s.activityId === itemData.activityId);
                if (scheduleItem) {
                  const updates: any = {};
                  let hasChange = false;

                  // Progress Items Mapping
                  if (colName === 'progressItems') {
                    if (itemData.plannedStartDate !== scheduleItem.plannedStartDate) { updates.plannedStartDate = scheduleItem.plannedStartDate; hasChange = true; }
                    if (itemData.plannedEndDate !== scheduleItem.plannedEndDate) { updates.plannedEndDate = scheduleItem.plannedEndDate; hasChange = true; }
                    if (itemData.currentStartDate !== scheduleItem.currentStartDate) { updates.currentStartDate = scheduleItem.currentStartDate; hasChange = true; }
                    if (itemData.currentEndDate !== scheduleItem.currentEndDate) { updates.currentEndDate = scheduleItem.currentEndDate; hasChange = true; }
                  }
                  
                  // ETC Details Mapping
                  if (colName === 'etcDetails') {
                    if (itemData.phasingStartDate !== scheduleItem.currentStartDate) { updates.phasingStartDate = scheduleItem.currentStartDate; hasChange = true; }
                    if (itemData.phasingEndDate !== scheduleItem.currentEndDate) { updates.phasingEndDate = scheduleItem.currentEndDate; hasChange = true; }
                  }

                  // Cost Codes Mapping
                  if (colName === 'costCodes') {
                    if (itemData.plannedStartDate !== scheduleItem.plannedStartDate) { updates.plannedStartDate = scheduleItem.plannedStartDate; hasChange = true; }
                    if (itemData.plannedEndDate !== scheduleItem.plannedEndDate) { updates.plannedEndDate = scheduleItem.plannedEndDate; hasChange = true; }
                  }

                  if (hasChange) {
                    batch.update(d.ref, { ...updates, updatedAt: new Date().toISOString() });
                    totalUpdated++;
                  }
                }
              }
            } else {
              // Handle subcontracts (nested line items)
              if (itemData.lineItems) {
                let subChange = false;
                const newItems = itemData.lineItems.map((li: any) => {
                  if (li.activityId) {
                    const scheduleItem = items.find(s => s.activityId === li.activityId);
                    if (scheduleItem) {
                      let liChange = false;
                      if (li.startDate !== scheduleItem.currentStartDate) { li.startDate = scheduleItem.currentStartDate; liChange = true; }
                      if (li.endDate !== scheduleItem.currentEndDate) { li.endDate = scheduleItem.currentEndDate; liChange = true; }
                      if (liChange) subChange = true;
                    }
                  }
                  return li;
                });
                if (subChange) {
                  batch.update(d.ref, { lineItems: newItems, updatedAt: new Date().toISOString() });
                  totalUpdated++;
                }
              }
            }
          });
        }

        if (totalUpdated > 0) {
          await batch.commit();
        }
        return `${totalUpdated} records synchronized across modules`;
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'syncCollections');
      }
    }, {
      loading: 'Synchronizing dates across modules...',
      success: (msg) => msg,
      error: 'Synchronization failed'
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
          const bstr = evt.target.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const data = XLSX.utils.sheet_to_json(ws) as any[];

          const batch = writeBatch(db);
          let count = 0;
          let duplicates = 0;
          
          const existingIds = new Set(items.map(i => i.activityId));

          data.forEach(row => {
            const activityId = String(row['Activity ID'] || row['activityId'] || row['ID'] || '');
            const description = String(row['Activity Description'] || row['description'] || row['Description'] || '');
            const percentComplete = Number(row['Activity % Complete'] || row['activityPercentComplete'] || row['Percent Complete'] || 0);
            
            if (activityId && !existingIds.has(activityId)) {
              existingIds.add(activityId); // Prevent duplicates within same import
              const bStart = row['Baseline Start Date'] || row['baselineStartDate'] || row['Baseline Start'];
              const bEnd = row['Baseline End Date'] || row['baselineEndDate'] || row['Baseline Finish'];
              const pStart = row['Planned Start Date'] || row['plannedStartDate'] || row['Start'];
              const pEnd = row['Planned End Date'] || row['plannedEndDate'] || row['Finish'];
              const cStart = row['Current Start Date'] || row['currentStartDate'] || row['Current Start'];
              const cEnd = row['Current End Date'] || row['currentEndDate'] || row['Current Finish'];
 
              const docRef = doc(collection(db, 'scheduleItems'));
              batch.set(docRef, {
                projectId: project.id,
                activityId,
                description,
                activityPercentComplete: percentComplete,
                baselineStartDate: bStart ? new Date(new Date(bStart).setHours(0,0,0,0)).toISOString().split('T')[0] : '',
                baselineEndDate: bEnd ? new Date(new Date(bEnd).setHours(0,0,0,0)).toISOString().split('T')[0] : '',
                plannedStartDate: pStart ? new Date(new Date(pStart).setHours(0,0,0,0)).toISOString().split('T')[0] : '',
                plannedEndDate: pEnd ? new Date(new Date(pEnd).setHours(0,0,0,0)).toISOString().split('T')[0] : '',
                currentStartDate: cStart ? new Date(new Date(cStart).setHours(0,0,0,0)).toISOString().split('T')[0] : '',
                currentEndDate: cEnd ? new Date(new Date(cEnd).setHours(0,0,0,0)).toISOString().split('T')[0] : '',
                updatedAt: new Date().toISOString()
              });
              count++;
            } else if (activityId) {
              duplicates++;
            }
          });

          await batch.commit();
          toast.success(`Successfully imported ${count} activities. ${duplicates > 0 ? `Skipped ${duplicates} duplicate IDs.` : ''}`);
        } catch (err) {
          console.error(err);
          handleFirestoreError(err, OperationType.WRITE, 'scheduleItems/import');
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
