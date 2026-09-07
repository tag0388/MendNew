import React, { useState, useEffect, useMemo } from 'react';
import { Project, RuleOfCredit, RuleOfCreditStep } from '../types';
import { db, auth } from '../firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  updateDoc, 
  doc, 
  writeBatch
} from 'firebase/firestore';
import { Download, Upload, Trash2, Loader2, Search, Edit2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { AgGridReact } from 'ag-grid-react';
import { ColDef, ICellRendererParams } from 'ag-grid-community';
import * as XLSX from 'xlsx';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  toast.error(`Firestore Error: ${errInfo.error}`);
}

interface BulkRulesOfCreditProps {
  project: Project;
  theme?: 'light' | 'dark';
}

interface FlattenedStep extends RuleOfCreditStep {
  parentRoCId: string;
  ruleId: string;
}

export default function BulkRulesOfCredit({ project, theme = 'light' }: BulkRulesOfCreditProps) {
  const [rules, setRules] = useState<RuleOfCredit[]>([]);
  const [loading, setLoading] = useState(true);
  const [quickFilterText, setQuickFilterText] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (!project.id) return;
    const path = 'rulesOfCredit';
    const q = query(collection(db, path), where('projectId', '==', project.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as RuleOfCredit));
      setRules(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });
    return unsubscribe;
  }, [project.id]);

  const flattenedSteps = useMemo(() => {
    const steps: FlattenedStep[] = [];
    rules.forEach(rule => {
      (rule.steps || []).forEach(step => {
        steps.push({
          ...step,
          parentRoCId: rule.id,
          ruleId: rule.ruleId
        });
      });
    });
    return steps.sort((a, b) => {
      if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId);
      return a.orderNo - b.orderNo;
    });
  }, [rules]);

  const updateStepInRoC = async (parentRoCId: string, stepId: string, updates: Partial<RuleOfCreditStep>) => {
    const rule = rules.find(r => r.id === parentRoCId);
    if (!rule) return;

    const newSteps = (rule.steps || []).map(s => {
      if (s.id === stepId) {
        return { ...s, ...updates };
      }
      return s;
    });

    try {
      await updateDoc(doc(db, 'rulesOfCredit', parentRoCId), { steps: newSteps });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `rulesOfCredit/${parentRoCId}`);
    }
  };

  const deleteStepFromRoC = async (parentRoCId: string, stepId: string) => {
    if (!window.confirm('Delete this step?')) return;
    const rule = rules.find(r => r.id === parentRoCId);
    if (!rule) return;

    const newSteps = (rule.steps || []).filter(s => s.id !== stepId);
    try {
      await updateDoc(doc(db, 'rulesOfCredit', parentRoCId), { steps: newSteps });
      toast.success('Step deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `rulesOfCredit/${parentRoCId}`);
    }
  };

  const [selectedSteps, setSelectedSteps] = useState<FlattenedStep[]>([]);

  const handleBulkDeleteSteps = async () => {
    if (selectedSteps.length === 0) return;
    if (!window.confirm(`Delete ${selectedSteps.length} selected steps from their respective Rules of Credit?`)) return;

    // Group selected steps by parentRoCId
    const groupedByRoC: Record<string, string[]> = {};
    selectedSteps.forEach(s => {
      if (!groupedByRoC[s.parentRoCId]) groupedByRoC[s.parentRoCId] = [];
      groupedByRoC[s.parentRoCId].push(s.id);
    });

    const batch = writeBatch(db);
    let affectedRules = 0;

    for (const rocId in groupedByRoC) {
      const rule = rules.find(r => r.id === rocId);
      if (rule) {
        const remainingSteps = (rule.steps || []).filter(s => !groupedByRoC[rocId].includes(s.id));
        batch.update(doc(db, 'rulesOfCredit', rocId), { steps: remainingSteps });
        affectedRules++;
      }
    }

    try {
      await batch.commit();
      toast.success(`Deleted ${selectedSteps.length} steps from ${affectedRules} rules`);
      setSelectedSteps([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'rulesOfCredit');
    }
  };

  const [isBulkUpdateOpen, setIsBulkUpdateOpen] = useState(false);
  const [bulkUpdateData, setBulkUpdateData] = useState<{ field: string; value: string }>({ field: '', value: '' });

  const handleBulkUpdateSteps = async () => {
    if (!bulkUpdateData.field || selectedSteps.length === 0) return;

    // Group selected steps by parentRoCId
    const groupedByRoC: Record<string, string[]> = {};
    selectedSteps.forEach(s => {
      if (!groupedByRoC[s.parentRoCId]) groupedByRoC[s.parentRoCId] = [];
      groupedByRoC[s.parentRoCId].push(s.id);
    });

    const batch = writeBatch(db);
    let affectedRules = 0;

    for (const rocId in groupedByRoC) {
      const rule = rules.find(r => r.id === rocId);
      if (rule) {
        const newSteps = (rule.steps || []).map(s => {
          if (groupedByRoC[rocId].includes(s.id)) {
            const val = bulkUpdateData.value;
            if (bulkUpdateData.field === 'weight' || bulkUpdateData.field === 'orderNo') {
              return { ...s, [bulkUpdateData.field]: parseFloat(val) || 0 };
            }
            return { ...s, [bulkUpdateData.field]: val };
          }
          return s;
        });
        batch.update(doc(db, 'rulesOfCredit', rocId), { steps: newSteps });
        affectedRules++;
      }
    }

    try {
      await batch.commit();
      toast.success(`Updated ${selectedSteps.length} steps in ${affectedRules} rules`);
      setIsBulkUpdateOpen(false);
      setSelectedSteps([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'rulesOfCredit');
    }
  };

  const columnDefs = useMemo<ColDef[]>(() => [
    { 
      field: 'ruleId', 
      headerName: 'RoC ID', 
      width: 150, 
      pinned: 'left',
      checkboxSelection: true,
      headerCheckboxSelection: true,
      cellClass: 'bg-gray-50/50 dark:bg-white/5 font-bold'
    },
    { 
      field: 'orderNo', 
      headerName: 'Step Order No', 
      width: 150, 
      editable: true,
      type: 'numericColumn',
      valueParser: p => parseFloat(p.newValue) || 0,
      onCellValueChanged: p => {
        const val = p.newValue;
        if (val.toString().length > 10) {
          toast.error('Step Order No must be max 10 characters');
          return;
        }
        updateStepInRoC(p.data.parentRoCId, p.data.id, { orderNo: val });
      }
    },
    { 
      field: 'description', 
      headerName: 'Step Description', 
      flex: 1, 
      editable: true,
      onCellValueChanged: p => {
        const val = p.newValue;
        if (val.length > 100) {
          toast.error('Description must be max 100 characters');
          return;
        }
        updateStepInRoC(p.data.parentRoCId, p.data.id, { description: val });
      }
    },
    { 
      field: 'weight', 
      headerName: 'Step Weight %', 
      width: 150, 
      type: 'numericColumn',
      editable: true,
      valueParser: p => parseFloat(p.newValue) || 0,
      onCellValueChanged: p => updateStepInRoC(p.data.parentRoCId, p.data.id, { weight: p.newValue })
    },
    {
      headerName: '',
      width: 60,
      pinned: 'right',
      cellRenderer: (p: ICellRendererParams) => (
        <button onClick={() => deleteStepFromRoC(p.data.parentRoCId, p.data.id)} className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded mt-1">
          <Trash2 className="w-4 h-4" />
        </button>
      )
    }
  ], [rules]);

  const exportToExcel = () => {
    const dataToExport = flattenedSteps.map(s => ({
      'RoC ID': s.ruleId,
      'Order No': s.orderNo,
      'Description': s.description,
      'Weight %': s.weight
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'RoC Steps');
    XLSX.writeFile(wb, `${project.projectName}_Bulk_RoC_Steps.xlsx`);
    toast.success('Exported to Excel');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        // Group steps by RoC ID
        const groupedSteps: Record<string, RuleOfCreditStep[]> = {};
        data.forEach((row, index) => {
          const rocId = row['RoC ID']?.toString().trim();
          if (!rocId) return;

          if (!groupedSteps[rocId]) groupedSteps[rocId] = [];
          
          groupedSteps[rocId].push({
            id: Math.random().toString(36).substr(2, 9),
            orderNo: parseFloat(row['Order No']) || 0,
            description: row['Description']?.toString() || '',
            weight: parseFloat(row['Weight %']) || 0
          });
        });

        // Batch update
        const batch = writeBatch(db);
        let updatedCount = 0;

        for (const rocId in groupedSteps) {
          const rule = rules.find(r => r.ruleId.toLowerCase() === rocId.toLowerCase());
          if (rule) {
            batch.update(doc(db, 'rulesOfCredit', rule.id), { steps: groupedSteps[rocId] });
            updatedCount++;
          }
        }

        if (updatedCount > 0) {
          await batch.commit();
          toast.success(`Imported steps for ${updatedCount} Rules of Credit`);
        } else {
          toast.info('No matching Rule of Credit IDs found. Ensure parent RoCs are created first.');
        }
      } catch (error) {
        console.error('Import error:', error);
        toast.error('Failed to parse Excel file');
      } finally {
        setIsImporting(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#141414]">
      <div className="p-6 border-b border-gray-100 dark:border-white/10 flex justify-between items-center bg-gray-50/50 dark:bg-white/5 shrink-0">
        <div>
          <h3 className="text-xl font-bold dark:text-white">Bulk Rules of Credit Steps</h3>
          <p className="text-sm text-gray-500">Manage all RoC steps in a single grid.</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedSteps.length > 0 && (
            <div className="flex items-center gap-2 mr-4 pr-4 border-r border-gray-200 dark:border-white/10">
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{selectedSteps.length} Selected</span>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setIsBulkUpdateOpen(true)}
                className="h-8 rounded-lg font-bold border-blue-200 text-blue-600"
              >
                <Edit2 className="w-3.5 h-3.5 mr-1" />
                Update
              </Button>
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={handleBulkDeleteSteps}
                className="h-8 rounded-lg font-bold"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Delete
              </Button>
            </div>
          )}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input 
              placeholder="Search steps..." 
              value={quickFilterText}
              onChange={e => setQuickFilterText(e.target.value)}
              className="pl-10 w-64 bg-white dark:bg-white/5"
            />
          </div>
          <Button variant="outline" onClick={exportToExcel} className="font-bold border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-500/20 dark:text-emerald-400">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <div className="relative">
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleImport}
              className="hidden"
              id="roc-bulk-import"
              disabled={isImporting}
            />
            <label 
              htmlFor="roc-bulk-import" 
              className={cn(
                "cursor-pointer flex items-center font-bold border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-500/20 dark:text-blue-400 rounded-lg px-4 h-8 border text-xs transition-colors",
                isImporting && "opacity-50 pointer-events-none"
              )}
            >
              {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Import
            </label>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-hidden">
        <div className={cn(
          "h-full ag-theme-quartz",
          theme === 'dark' ? "ag-theme-quartz-dark" : ""
        )}>
          <AgGridReact
            rowData={flattenedSteps}
            columnDefs={columnDefs}
            quickFilterText={quickFilterText}
            animateRows={true}
            rowSelection="multiple"
            suppressRowClickSelection={true}
            onSelectionChanged={p => setSelectedSteps(p.api.getSelectedRows())}
            singleClickEdit={true}
            stopEditingWhenCellsLoseFocus={true}
            defaultColDef={{
              sortable: true,
              filter: true,
              resizable: true
            }}
          />
        </div>
      </div>

      {/* Bulk Update Modal */}
      <Dialog open={isBulkUpdateOpen} onOpenChange={setIsBulkUpdateOpen}>
        <DialogContent className="max-w-md bg-white dark:bg-[#1a1a1a] border dark:border-white/10">
          <DialogHeader>
            <DialogTitle>Bulk Update {selectedSteps.length} Steps</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Select Field</label>
              <Select onValueChange={(val: string) => setBulkUpdateData(prev => ({ ...prev, field: val }))}>
                <SelectTrigger className="w-full h-12 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 rounded-xl">
                  <SelectValue placeholder="-- Select Field --" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="description">Step Description</SelectItem>
                  <SelectItem value="orderNo">Step Order No</SelectItem>
                  <SelectItem value="weight">Step Weight %</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">New Value</label>
              <Input 
                type={bulkUpdateData.field === 'description' ? 'text' : 'number'}
                value={bulkUpdateData.value}
                onChange={e => setBulkUpdateData(prev => ({ ...prev, value: e.target.value }))}
                placeholder="Enter new value"
                className="h-12 rounded-xl bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsBulkUpdateOpen(false)} className="rounded-xl font-bold">Cancel</Button>
            <Button onClick={handleBulkUpdateSteps} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold px-8">
              Update Steps
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
