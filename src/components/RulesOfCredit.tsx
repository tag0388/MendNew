import React, { useState, useEffect, useMemo } from 'react';
import { Project, RuleOfCredit, RuleOfCreditStep, ProgressPackage } from '../types';
import { db, auth } from '../firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  deleteDoc, 
  writeBatch
} from 'firebase/firestore';
import { Download, Upload, Trash2, X, Loader2, Edit2, Plus } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
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

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  toast.error(`Firestore Error: ${errInfo.error}`);
  throw new Error(JSON.stringify(errInfo));
}

interface RulesOfCreditProps {
  project: Project;
  theme?: 'light' | 'dark';
}

export default function RulesOfCredit({ project, theme = 'light' }: RulesOfCreditProps) {
  const [rules, setRules] = useState<RuleOfCredit[]>([]);
  const [packages, setPackages] = useState<ProgressPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState<Partial<RuleOfCredit>>({ ruleId: '', description: '', packageId: '' });
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);

  const selectedRule = useMemo(() => rules.find(r => r.id === selectedRuleId), [rules, selectedRuleId]);

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

  useEffect(() => {
    if (!project.id) return;
    const q = query(collection(db, 'progressPackages'), where('projectId', '==', project.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ProgressPackage));
      setPackages(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'progressPackages');
    });
    return unsubscribe;
  }, [project.id]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project.id) {
      toast.error('Project ID is missing');
      return;
    }

    if (!formData.ruleId?.trim()) {
      toast.error('Rule ID is required');
      return;
    }

    if (formData.ruleId.length > 20) {
      toast.error('Rule ID must be max 20 characters');
      return;
    }

    // Check uniqueness
    if (rules.some(r => r.ruleId.toLowerCase() === formData.ruleId?.toLowerCase())) {
      toast.error('Rule ID must be unique per project');
      return;
    }

    setSaving(true);
    const path = 'rulesOfCredit';
    try {
      await addDoc(collection(db, path), {
        ruleId: formData.ruleId,
        description: formData.description || '',
        packageId: formData.packageId || '',
        steps: [],
        projectId: project.id,
        createdAt: new Date().toISOString()
      });
      setIsAdding(false);
      setFormData({ ruleId: '', description: '', packageId: '' });
      toast.success('Rule of Credit added');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this Rule of Credit and all its steps?')) return;
    const path = `rulesOfCredit/${id}`;
    try {
      await deleteDoc(doc(db, 'rulesOfCredit', id));
      if (selectedRuleId === id) setSelectedRuleId(null);
      toast.success('Rule deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const updateRule = async (id: string, updates: Partial<RuleOfCredit>) => {
    const path = `rulesOfCredit/${id}`;
    try {
      await updateDoc(doc(db, 'rulesOfCredit', id), updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const addStep = async () => {
    if (!selectedRuleId || !selectedRule) return;
    
    const nextOrder = selectedRule.steps && selectedRule.steps.length > 0 
      ? Math.max(...selectedRule.steps.map(s => s.orderNo)) + 1 
      : 1;

    const newStep: RuleOfCreditStep = {
      id: Math.random().toString(36).substr(2, 9),
      orderNo: nextOrder,
      description: 'New Step',
      weight: 0
    };

    const newSteps = [...(selectedRule.steps || []), newStep];
    await updateRule(selectedRuleId, { steps: newSteps });
  };

  const updateStep = async (stepId: string, updates: Partial<RuleOfCreditStep>) => {
    if (!selectedRuleId || !selectedRule) return;

    const newSteps = (selectedRule.steps || []).map(s => {
      if (s.id === stepId) {
        return { ...s, ...updates };
      }
      return s;
    });

    await updateRule(selectedRuleId, { steps: newSteps });
  };

  const deleteStep = async (stepId: string) => {
    if (!selectedRuleId || !selectedRule) return;
    if (!window.confirm('Delete this step?')) return;

    const newSteps = (selectedRule.steps || []).filter(s => s.id !== stepId);
    await updateRule(selectedRuleId, { steps: newSteps });
  };

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedIds.length} Rules of Credit and all their steps?`)) return;

    const batch = writeBatch(db);
    selectedIds.forEach(id => {
      batch.delete(doc(db, 'rulesOfCredit', id));
    });

    try {
      await batch.commit();
      toast.success(`Deleted ${selectedIds.length} rules`);
      setSelectedIds([]);
      if (selectedIds.includes(selectedRuleId || '')) setSelectedRuleId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'rulesOfCredit');
    }
  };

  const [isBulkUpdateOpen, setIsBulkUpdateOpen] = useState(false);
  const [bulkUpdateData, setBulkUpdateData] = useState<{ field: string; value: string }>({ field: '', value: '' });

  const handleBulkUpdate = async () => {
    if (!bulkUpdateData.field || selectedIds.length === 0) return;
    
    const batch = writeBatch(db);
    selectedIds.forEach(id => {
      batch.update(doc(db, 'rulesOfCredit', id), { [bulkUpdateData.field]: bulkUpdateData.value });
    });

    try {
      await batch.commit();
      toast.success(`Updated ${selectedIds.length} rules`);
      setIsBulkUpdateOpen(false);
      setSelectedIds([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'rulesOfCredit');
    }
  };

  const parentColumnDefs = useMemo<ColDef[]>(() => [
    { 
      field: 'ruleId', 
      headerName: 'RoC ID', 
      width: 180, 
      checkboxSelection: true,
      headerCheckboxSelection: true,
      editable: true,
      cellClass: 'cursor-pointer font-bold text-blue-600 hover:underline',
      onCellValueChanged: p => {
        const newVal = p.newValue?.trim();
        if (!newVal) return;
        if (newVal.length > 20) {
          toast.error('RoC ID must be max 20 characters');
          p.node.setDataValue('ruleId', p.oldValue);
          return;
        }
        // Unique check
        if (rules.some(r => r.id !== p.data.id && r.ruleId.toLowerCase() === newVal.toLowerCase())) {
          toast.error('RoC ID must be unique');
          p.node.setDataValue('ruleId', p.oldValue);
          return;
        }
        updateRule(p.data.id, { ruleId: newVal });
      }
    },
    { 
      field: 'description', 
      headerName: 'RoC Description', 
      flex: 1, 
      editable: true,
      onCellValueChanged: p => updateRule(p.data.id, { description: p.newValue })
    },
    {
      field: 'packageId',
      headerName: 'Commodity',
      width: 200,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: {
        values: packages.map(p => p.packageId)
      },
      valueFormatter: (p) => {
        const pkg = packages.find(pkg => pkg.packageId === p.value);
        return pkg ? `${pkg.packageId} | ${pkg.description}` : p.value || '-';
      },
      onCellValueChanged: p => updateRule(p.data.id, { packageId: p.newValue })
    },
    { 
      field: 'userField1', 
      headerName: 'Field 1', 
      width: 150, 
      editable: true,
      onCellValueChanged: p => updateRule(p.data.id, { userField1: p.newValue })
    },
    { 
      field: 'userField2', 
      headerName: 'Field 2', 
      width: 150, 
      editable: true,
      onCellValueChanged: p => updateRule(p.data.id, { userField2: p.newValue })
    },
    { 
      field: 'userField3', 
      headerName: 'Field 3', 
      width: 150, 
      editable: true,
      onCellValueChanged: p => updateRule(p.data.id, { userField3: p.newValue })
    },
    { 
      field: 'userField4', 
      headerName: 'Field 4', 
      width: 150, 
      editable: true,
      onCellValueChanged: p => updateRule(p.data.id, { userField4: p.newValue })
    },
    { 
      field: 'userField5', 
      headerName: 'Field 5', 
      width: 150, 
      editable: true,
      onCellValueChanged: p => updateRule(p.data.id, { userField5: p.newValue })
    },
    {
      headerName: '',
      width: 60,
      pinned: 'right',
      cellRenderer: (p: ICellRendererParams) => (
        <button onClick={(e) => deleteRule(p.data.id, e)} className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded mt-1">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )
    }
  ], [rules]);

  const stepColumnDefs = useMemo<ColDef[]>(() => [
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
        updateStep(p.data.id, { orderNo: val });
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
        updateStep(p.data.id, { description: val });
      }
    },
    { 
      field: 'weight', 
      headerName: 'Step Weight %', 
      width: 150, 
      type: 'numericColumn',
      editable: true,
      valueParser: p => parseFloat(p.newValue) || 0,
      onCellValueChanged: p => updateStep(p.data.id, { weight: p.newValue })
    },
    {
      headerName: '',
      width: 60,
      pinned: 'right',
      cellRenderer: (p: ICellRendererParams) => (
        <button onClick={() => deleteStep(p.data.id)} className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded mt-1">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )
    }
  ], [selectedRuleId, selectedRule]);

  const totalWeight = useMemo(() => {
    return (selectedRule?.steps || []).reduce((sum, s) => sum + (s.weight || 0), 0);
  }, [selectedRule]);

  const exportToExcel = () => {
    const dataToExport = rules.map(r => ({
      'RoC ID': r.ruleId,
      'Description': r.description,
      'Package ID': r.packageId || '',
      'Field 1': r.userField1 || '',
      'Field 2': r.userField2 || '',
      'Field 3': r.userField3 || '',
      'Field 4': r.userField4 || '',
      'Field 5': r.userField5 || ''
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'RoC Headers');
    XLSX.writeFile(wb, `${project.projectName}_RoC_Headers.xlsx`);
    toast.success('Exported to Excel');
  };

  const [isImporting, setIsImporting] = useState(false);
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

        const batch = writeBatch(db);
        let count = 0;

        for (const row of data) {
          const rocId = row['RoC ID']?.toString().trim();
          if (!rocId) continue;

          // Check if it already exists
          const existing = rules.find(r => r.ruleId.toLowerCase() === rocId.toLowerCase());
          
          const payload = {
            ruleId: rocId,
            description: row['Description']?.toString() || '',
            packageId: row['Package ID']?.toString() || '',
            userField1: row['Field 1']?.toString() || '',
            userField2: row['Field 2']?.toString() || '',
            userField3: row['Field 3']?.toString() || '',
            userField4: row['Field 4']?.toString() || '',
            userField5: row['Field 5']?.toString() || '',
            projectId: project.id,
            updatedAt: new Date().toISOString()
          };

          if (existing) {
            batch.update(doc(db, 'rulesOfCredit', existing.id), payload);
          } else {
            const newDocRef = doc(collection(db, 'rulesOfCredit'));
            batch.set(newDocRef, {
              ...payload,
              steps: [],
              createdAt: new Date().toISOString()
            });
          }
          count++;
        }

        await batch.commit();
        toast.success(`Imported/Updated ${count} Rules of Credit`);
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
          <h3 className="text-xl font-bold dark:text-white">Setup Rules of Credit</h3>
          <p className="text-sm text-gray-500">Define weightings for progress monitoring by commodity.</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2 mr-4 pr-4 border-r border-gray-200 dark:border-white/10">
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{selectedIds.length} Selected</span>
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
                onClick={handleBulkDelete}
                className="h-8 rounded-lg font-bold"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Delete
              </Button>
            </div>
          )}
          <Button variant="outline" onClick={exportToExcel} className="font-bold border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-500/20 dark:text-emerald-400 rounded-xl">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <div className="relative">
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleImport}
              className="hidden"
              id="roc-import"
              disabled={isImporting}
            />
            <label 
              htmlFor="roc-import" 
              className={cn(
                "cursor-pointer flex items-center font-bold border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-500/20 dark:text-blue-400 rounded-xl px-4 h-8 border text-sm transition-colors",
                isImporting && "opacity-50 pointer-events-none"
              )}
            >
              {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Import
            </label>
          </div>
          <Button onClick={() => setIsAdding(true)} className="bg-black dark:bg-white text-white dark:text-black rounded-xl font-bold">
            <Plus className="w-4 h-4 mr-2" />
            Add Rule
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col p-6 gap-6 overflow-hidden">
        {/* Parent Grid */}
        <div className="flex-1 min-h-[300px]">
          <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Rules of Credit Headers</h4>
          <div className={cn(
            "h-full ag-theme-quartz",
            theme === 'dark' ? "ag-theme-quartz-dark" : ""
          )}>
            <AgGridReact
              rowData={rules}
              columnDefs={parentColumnDefs}
              animateRows={true}
              rowSelection="multiple"
              suppressRowClickSelection={true}
              onSelectionChanged={p => setSelectedIds(p.api.getSelectedRows().map(r => r.id))}
              singleClickEdit={true}
              stopEditingWhenCellsLoseFocus={true}
              onCellClicked={p => {
                if (p.column.getColId() === 'ruleId') {
                  setSelectedRuleId(p.data.id);
                }
              }}
            />
          </div>
        </div>

        {/* Child Grid (Steps) */}
        {selectedRuleId && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 min-h-[350px] flex flex-col border-t border-gray-100 dark:border-white/10 pt-6"
          >
            <div className="flex justify-between items-center mb-4">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">
                  Steps for RoC: {selectedRule?.ruleId}
                </h4>
                <p className="text-[10px] text-gray-500 mt-1">{selectedRule?.description}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold border",
                  Math.abs(totalWeight - 100) < 0.01 
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20"
                    : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20"
                )}>
                  Total Weight: {totalWeight.toFixed(2)}%
                </div>
                <Button onClick={addStep} variant="outline" size="sm" className="rounded-lg font-bold border-blue-200 dark:border-blue-500/20 text-blue-600 dark:text-blue-400">
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Add Step
                </Button>
              </div>
            </div>
            
            <div className={cn(
              "flex-1 ag-theme-quartz",
              theme === 'dark' ? "ag-theme-quartz-dark" : ""
            )}>
              <AgGridReact
                rowData={selectedRule?.steps || []}
                columnDefs={stepColumnDefs}
                animateRows={true}
                singleClickEdit={true}
                stopEditingWhenCellsLoseFocus={true}
              />
            </div>
          </motion.div>
        )}
      </div>

      {/* Add Modal */}
      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl w-full max-w-md p-6 border border-gray-200 dark:border-white/10"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold dark:text-white">Add Rule of Credit</h2>
                <button onClick={() => setIsAdding(false)}><X className="w-5 h-5 text-gray-400" /></button>
              </div>
              <form onSubmit={handleAdd} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">RoC ID</label>
                  <Input required maxLength={20} value={formData.ruleId} onChange={e => setFormData({ ...formData, ruleId: e.target.value })} placeholder="e.g. 01" />
                  <p className="text-[10px] text-gray-500 text-right">{formData.ruleId?.length || 0}/20</p>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Description</label>
                  <Input value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="e.g. Concrete" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Assigned Commodity</label>
                  <select 
                    value={formData.packageId}
                    onChange={e => setFormData({ ...formData, packageId: e.target.value })}
                    className="w-full p-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="">-- Select Commodity (Optional) --</option>
                    {packages.map(pkg => (
                      <option key={pkg.id} value={pkg.packageId}>{pkg.packageId} | {pkg.description}</option>
                    ))}
                  </select>
                </div>
                <div className="pt-4 flex gap-3">
                  <Button type="button" variant="ghost" onClick={() => setIsAdding(false)} disabled={saving} className="flex-1">Cancel</Button>
                  <Button type="submit" disabled={saving} className="flex-1 bg-blue-600 text-white font-bold hover:bg-blue-700">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add Rule'}
                  </Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bulk Update Modal */}
      <Dialog open={isBulkUpdateOpen} onOpenChange={setIsBulkUpdateOpen}>
        <DialogContent className="max-w-md bg-white dark:bg-[#1a1a1a] border dark:border-white/10">
          <DialogHeader>
            <DialogTitle>Bulk Update {selectedIds.length} Rules</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Select Field</label>
              <Select onValueChange={(val: string) => setBulkUpdateData(prev => ({ ...prev, field: val }))}>
                <SelectTrigger className="w-full h-12 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 rounded-xl">
                  <SelectValue placeholder="-- Select Field --" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="description">Description</SelectItem>
                  <SelectItem value="packageId">Commodity ID</SelectItem>
                  <SelectItem value="userField1">User Field 1</SelectItem>
                  <SelectItem value="userField2">User Field 2</SelectItem>
                  <SelectItem value="userField3">User Field 3</SelectItem>
                  <SelectItem value="userField4">User Field 4</SelectItem>
                  <SelectItem value="userField5">User Field 5</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">New Value</label>
              {bulkUpdateData.field === 'packageId' ? (
                <Select onValueChange={(val: string) => setBulkUpdateData(prev => ({ ...prev, value: val }))}>
                  <SelectTrigger className="w-full h-12 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 rounded-xl">
                    <SelectValue placeholder="-- Select Commodity --" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">-- Clear Commodity --</SelectItem>
                    {packages.map(pkg => (
                      <SelectItem key={pkg.id} value={pkg.packageId}>{pkg.packageId} | {pkg.description}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input 
                  value={bulkUpdateData.value}
                  onChange={e => setBulkUpdateData(prev => ({ ...prev, value: e.target.value }))}
                  placeholder="Enter new value"
                  className="h-12 rounded-xl bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10"
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsBulkUpdateOpen(false)} className="rounded-xl font-bold">Cancel</Button>
            <Button onClick={handleBulkUpdate} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold px-8">
              Update Rules
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
