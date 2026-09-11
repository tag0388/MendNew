import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase, subscribeToTable, raise } from '../lib/supabase';
import { fetchCostCodes } from '../lib/costCodes';
import {
  fetchChanges, createChange, updateChange, deleteChanges, importChanges,
  fetchChangeRecords, upsertChangeRecords, updateChangeRecord,
  deleteChangeRecords, bulkUpdateChangeRecords,
  applyChangeCellEdit, applyChangeRecordCellEdit,
} from '../lib/changes';
import { Project, Enterprise, Change, ChangeRecord, CostCode } from '../types';
import { 
  Search, 
  Plus, 
  Trash2, 
  Edit2, 
  Download, 
  Upload,
  Filter, 
  RefreshCw,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  X,
  RefreshCcw,
  PlusCircle,
  Calculator,
  AlertTriangle,
  BarChart3,
  PieChart,
  TrendingUp,
  DollarSign,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Database,
  Save,
  Layout,
  Columns,
  RotateCcw,
  History,
  Activity,
  Briefcase,
  ClipboardList
} from 'lucide-react';
import { AgGridReact } from 'ag-grid-react';
import { 
  ColDef, 
  ColGroupDef,
  GridApi, 
  GridReadyEvent, 
  CellValueChangedEvent,
  RowNode,
  ValueFormatterParams,
  SideBarDef,
  StatusPanelDef
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import 'ag-grid-enterprise';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn, formatCurrency } from '../lib/utils';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell, 
  PieChart as RePie, 
  Pie,
  Legend,
  ComposedChart,
  Line
} from 'recharts';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';


interface ChangeManagementProps {
  project: Project;
  enterprise: Enterprise;
}

export default function ChangeManagement({ project, enterprise }: ChangeManagementProps) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [changeRecords, setChangeRecords] = useState<ChangeRecord[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [quickFilterText, setQuickFilterText] = useState('');
  const [recordsQuickFilterText, setRecordsQuickFilterText] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [isChartsVisible, setIsChartsVisible] = useState(false);
  const [chartMetric, setChartMetric] = useState<'budget' | 'eac'>('budget');
  const [isBulkRecordUpdateOpen, setIsBulkRecordUpdateOpen] = useState(false);
  const [bulkRecordUpdateData, setBulkRecordUpdateData] = useState<{
    costCodeId: string;
    scope: string;
    budgetAmount: string;
    eacAmount: string;
    enterpriseAttributes: Record<string, any>;
    projectAttributes: Record<string, any>;
  }>({
    costCodeId: '',
    scope: '',
    budgetAmount: '',
    eacAmount: '',
    enterpriseAttributes: {},
    projectAttributes: {}
  });
  
  // Modal States
  const [isCreateChangeOpen, setIsCreateChangeOpen] = useState(false);
  const [isDeleteChangeOpen, setIsDeleteChangeOpen] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [changeToDelete, setChangeToDelete] = useState<Change | null>(null);
  
  const [newChange, setNewChange] = useState({
    changeId: '',
    description: '',
    status: 'Pending' as Change['status'],
    initiator: '',
    reference: '',
    periodId: ''
  });

  const [isMainTableCollapsed, setIsMainTableCollapsed] = useState(false);

  const gridRef = useRef<AgGridReact>(null);
  const recordsGridRef = useRef<AgGridReact>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recordFileInputRef = useRef<HTMLInputElement>(null);

  const sideBar: SideBarDef = {
    toolPanels: [
      {
        id: 'columns',
        labelDefault: 'Columns',
        labelKey: 'columns',
        iconKey: 'columns',
        toolPanel: 'agColumnsToolPanel',
      },
      {
        id: 'filters',
        labelDefault: 'Filters',
        labelKey: 'filters',
        iconKey: 'filter',
        toolPanel: 'agFiltersToolPanel',
      },
    ],
    defaultToolPanel: '',
  };

  const statusBar: { statusPanels: StatusPanelDef[] } = {
    statusPanels: [
      { statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'left' },
      { statusPanel: 'agSelectedRowCountComponent', align: 'left' },
      { statusPanel: 'agAggregationComponent', align: 'right' },
    ],
  };

  const chartData = useMemo(() => {
    if (!project.reportingPeriods?.periods) return [];

    // Sort periods by start date to ensure correct chronological order
    const periods = [...project.reportingPeriods.periods].sort((a, b) => 
      new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );
    
    let cumulativeBudget = 0;
    let cumulativeEac = 0;

    const data = periods.map((p, index) => {
      const periodChanges = changes.filter(c => c.periodId === p.id);
      const budget = periodChanges.reduce((sum, c) => sum + (c.budget || 0), 0);
      const eac = periodChanges.reduce((sum, c) => sum + (c.eac || 0), 0);
      
      cumulativeBudget += budget;
      cumulativeEac += eac;

      // Format date label (e.g., Aug'26)
      const date = new Date(p.startDate);
      const month = date.toLocaleString('en-US', { month: 'short' });
      const year = date.getFullYear().toString().slice(-2);
      const dateLabel = `${month}'${year}`;

      return {
        name: `P${index + 1} (${dateLabel})`,
        budget,
        eac,
        cumulativeBudget,
        cumulativeEac
      };
    });

    return data;
  }, [changes, project.reportingPeriods]);

  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

  useEffect(() => {
    const root = document.documentElement;
    setTheme(root.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  // Hoisted so the write handlers can refresh after their own writes rather
  // than waiting for a change broadcast to tell them what they just did.
  const reloadChanges = useCallback(async () => {
    try {
      setChanges(await fetchChanges(project.id));
    } catch (error: any) {
      console.error('ChangeManagement: changes fetch error:', error);
      toast.error(`Failed to load changes: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void reloadChanges();
    return subscribeToTable('changes', `project_id=eq.${project.id}`, () => void reloadChanges());
  }, [reloadChanges, project.id]);

  const reloadChangeRecords = useCallback(async () => {
    if (!selectedChangeId) {
      setChangeRecords([]);
      return;
    }
    try {
      setChangeRecords(await fetchChangeRecords(project.id, { changeId: selectedChangeId }));
    } catch (error: any) {
      console.error('ChangeManagement: change records fetch error:', error);
      toast.error(`Failed to load change records: ${error?.message || 'Unknown error'}`);
    }
  }, [project.id, selectedChangeId]);

  useEffect(() => {
    void reloadChangeRecords();
    if (!selectedChangeId) return;
    // Filtered by the database, not by downloading the project's records.
    return subscribeToTable('change_records', `change_id=eq.${selectedChangeId}`, () => void reloadChangeRecords());
  }, [reloadChangeRecords, selectedChangeId]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const rows = await fetchCostCodes(project.id);
        if (active) setCostCodes(rows);
      } catch (error) {
        console.error('ChangeManagement: cost codes fetch error:', error);
      }
    };
    void load();
    const unsubscribe = subscribeToTable('cost_codes', `project_id=eq.${project.id}`, () => void load());
    return () => { active = false; unsubscribe(); };
  }, [project.id]);

  const handleCreateChange = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!newChange.changeId.trim()) {
      toast.error("Change ID is required");
      return;
    }
    if (newChange.changeId.length > 20) {
      toast.error("Change ID must be max 20 characters");
      return;
    }
    
    // Unique check
    const isDuplicate = changes.some(c => c.changeId.toLowerCase() === newChange.changeId.toLowerCase());
    if (isDuplicate) {
      toast.error("Change ID must be unique per project");
      return;
    }

    try {
      const changeData: Omit<Change, 'id'> = {
        projectId: project.id,
        changeId: newChange.changeId.trim(),
        description: newChange.description,
        type: '',
        status: newChange.status,
        initiator: newChange.initiator.slice(0, 50),
        reference: newChange.reference.slice(0, 50),
        budget: 0,
        eac: 0,
        periodId: newChange.periodId,
        enterpriseAttributes: {},
        projectAttributes: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await createChange(project.id, changeData as any);
      await reloadChanges();
      toast.success("Change created successfully");
      setIsCreateChangeOpen(false);
      setNewChange({
        changeId: '',
        description: '',
        status: 'Pending',
        initiator: '',
        reference: '',
        periodId: ''
      });
    } catch (error: any) {
      console.error('Error creating change:', error);
      // (project_id, change_id) is unique, so a duplicate reference is caught
      // by the database even when two people submit the same one at once.
      toast.error(
        error?.code === '23505'
          ? `Change ID "${newChange.changeId}" already exists in this project.`
          : `Failed to create change: ${error?.message || 'Unknown error'}`
      );
    }
  };

  const handleDeleteChange = async () => {
    if (!changeToDelete) return;
    try {
      // The records go with the change by cascade. Deleting them here first
      // and then the change was two steps that could half-commit, leaving
      // records pointing at a change that no longer existed.
      await deleteChanges([changeToDelete.id]);
      await reloadChanges();
      toast.success("Change and associated records deleted");
      setIsDeleteChangeOpen(false);
      setChangeToDelete(null);
      if (selectedChangeId === changeToDelete.id) setSelectedChangeId(null);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(changeToDelete.id);
        return next;
      });
    } catch (error: any) {
      console.error('Error deleting change:', error);
      toast.error(`Failed to delete change: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      // One statement. The old loop issued a query PER selected change to find
      // its records, so deleting fifty changes was fifty round trips before
      // the batch even committed; the cascade does it here.
      await deleteChanges(Array.from(selectedIds));
      await reloadChanges();
      toast.success(`Deleted ${selectedIds.size} changes`);
      setSelectedIds(new Set());
      setIsBulkDeleteOpen(false);
      if (selectedChangeId && selectedIds.has(selectedChangeId)) setSelectedChangeId(null);
    } catch (error: any) {
      toast.error(`Operation failed: ${(error as any)?.message || 'Unknown error'}`);
    }
  };

  const toggleAllChangeColumnGroups = (opened: boolean) => {
    if (!gridRef.current) return;
    const api = gridRef.current.api;
    const groups = api.getColumnGroupState();
    const newState = groups.map(g => ({
      groupId: g.groupId,
      open: opened
    }));
    api.setColumnGroupState(newState);
  };

  const toggleAllRecordColumnGroups = (opened: boolean) => {
    if (!recordsGridRef.current) return;
    const api = recordsGridRef.current.api;
    const groups = api.getColumnGroupState();
    const newState = groups.map(g => ({
      groupId: g.groupId,
      open: opened
    }));
    api.setColumnGroupState(newState);
  };

  const recordPinnedBottomRowData = useMemo(() => {
    if (changeRecords.length === 0) return [];
    const totalBudget = changeRecords.reduce((sum, r) => sum + (Number(r.budgetAmount) || 0), 0);
    const totalEac = changeRecords.reduce((sum, r) => sum + (Number(r.eacAmount) || 0), 0);
    return [{
      costCodeId: 'Total',
      budgetAmount: totalBudget,
      eacAmount: totalEac,
      isTotalRow: true
    }];
  }, [changeRecords]);

  const changesPinnedBottomRowData = useMemo(() => {
    if (changes.length === 0) return [];
    const totalBudget = changes.reduce((sum, c) => sum + (Number(c.budget) || 0), 0);
    const totalEac = changes.reduce((sum, c) => sum + (Number(c.eac) || 0), 0);
    return [{
      changeId: 'Total',
      budget: totalBudget,
      eac: totalEac,
      isTotalRow: true
    }];
  }, [changes]);

  const handleExport = () => {
    const exportData = changes.map(c => {
      const row: any = {
        'Change ID': c.changeId,
        'Description': c.description,
        'Status': c.status,
        'Initiator': c.initiator,
        'Reference': c.reference,
        'Budget': c.budget,
        'EAC': c.eac
      };
      
      // Add Enterprise Change Attributes
      enterprise.changeAttributes?.forEach(attr => {
        const val = c.enterpriseAttributes?.[attr.id];
        const v = attr.values.find(v => v.id === val);
        row[`[E] ${attr.title}`] = v ? `${v.id} - ${v.description}` : val || '';
      });
      
      // Add Project Change Attributes
      project.changeAttributes?.forEach(attr => {
        const val = c.projectAttributes?.[attr.id];
        const v = attr.values.find(v => v.id === val);
        row[`[P] ${attr.title}`] = v ? `${v.id} - ${v.description}` : val || '';
      });
      
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Changes");
    XLSX.writeFile(wb, `Changes_${project.projectName}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const rows: any[] = [];
        let addedCount = 0;
        let duplicateCount = 0;

        for (const row of data) {
          const changeId = String(row['Change ID'] || '').trim();
          if (!changeId) continue;

          // Check for duplicates in current state and imported data
          const isDuplicate = changes.some(c => c.changeId.toLowerCase() === changeId.toLowerCase());
          if (isDuplicate) {
            duplicateCount++;
            continue;
          }

          const entAttrs: Record<string, string> = {};
          enterprise.changeAttributes?.forEach(attr => {
            const key = `[E] ${attr.title}`;
            if (row[key]) {
              const valString = String(row[key]);
              const id = valString.split(' - ')[0]; // Handle formatted 'id - description'
              entAttrs[attr.id] = id;
            }
          });

          const prjAttrs: Record<string, string> = {};
          project.changeAttributes?.forEach(attr => {
            const key = `[P] ${attr.title}`;
            if (row[key]) {
              const valString = String(row[key]);
              const id = valString.split(' - ')[0];
              prjAttrs[attr.id] = id;
            }
          });

          rows.push({
            changeId: changeId.slice(0, 20),
            description: row['Description'] || '',
            type: '',
            status: row['Status'] || 'Pending',
            initiator: String(row['Initiator'] || '').slice(0, 50),
            reference: String(row['Reference'] || '').slice(0, 50),
            budget: Number(row['Budget']) || 0,
            eac: Number(row['EAC']) || 0,
            enterpriseAttributes: entAttrs,
            projectAttributes: prjAttrs,
          });
          addedCount++;
        }

        if (addedCount > 0) {
          // One statement for the whole sheet. Budget and EAC are not sent:
          // they are derived from the change's records by trigger, so a
          // spreadsheet cannot put a total on a change that its own records
          // do not add up to.
          const imported = await importChanges(project.id, rows);
          await reloadChanges();
          toast.success(`Imported ${imported} changes. ${duplicateCount > 0 ? `${duplicateCount} duplicates skipped.` : ''}`);
        } else if (duplicateCount > 0) {
          toast.warning(`No changes added. ${duplicateCount} duplicates found.`);
        }
      } catch (error: any) {
        console.error('Failed to import changes', error);
        toast.error(`Failed to import: ${error?.message || 'Unknown error'}`);
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleExportRecords = () => {
    if (changeRecords.length === 0) {
      toast.error("No records to export");
      return;
    }
    const exportData = changeRecords.map(r => {
      const row: any = {
        'Change ID': changes.find(c => c.id === r.changeId)?.changeId || 'Unknown',
        'Cost Code': costCodes.find(c => c.id === r.costCodeId)?.code || '',
        'Scope': r.scope,
        'Budget Amount': r.budgetAmount,
        'EAC Amount': r.eacAmount
      };
      // Add attributes
      enterprise.lineItemAttributes?.forEach(a => {
        row[a.title] = r.enterpriseAttributes?.[a.id] || '';
      });
      project.lineItemAttributes?.forEach(a => {
        row[a.title] = r.projectAttributes?.[a.id] || '';
      });
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Change Records");
    XLSX.writeFile(wb, `${project.projectName}_Change_Records_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleBulkUpdateRecords = async () => {
    if (selectedRecordIds.size === 0) return;

    try {
      // Merged server-side against each row's current attributes. The old code
      // built dotted keys ("enterpriseAttributes.<id>"), a Firestore idiom for
      // merging into a nested map that nothing in SQL reads -- those updates
      // would simply have been lost.
      const updated = await bulkUpdateChangeRecords(Array.from(selectedRecordIds), {
        costCodeId: bulkRecordUpdateData.costCodeId || undefined,
        scope: bulkRecordUpdateData.scope ? bulkRecordUpdateData.scope.slice(0, 100) : undefined,
        budgetAmount: bulkRecordUpdateData.budgetAmount !== '' ? Number(bulkRecordUpdateData.budgetAmount) : undefined,
        eacAmount: bulkRecordUpdateData.eacAmount !== '' ? Number(bulkRecordUpdateData.eacAmount) : undefined,
        enterpriseAttributes: bulkRecordUpdateData.enterpriseAttributes,
        projectAttributes: bulkRecordUpdateData.projectAttributes,
      });

      await reloadChangeRecords();
      // The changes' budget and EAC totals follow by trigger; this only
      // refreshes what the grid shows.
      await reloadChanges();

      toast.success(`Updated ${updated} record${updated === 1 ? '' : 's'}`);
      setIsBulkRecordUpdateOpen(false);
      setBulkRecordUpdateData({ 
        costCodeId: '', 
        scope: '', 
        budgetAmount: '', 
        eacAmount: '',
        enterpriseAttributes: {},
        projectAttributes: {}
      });
      setSelectedRecordIds(new Set());
    } catch (error: any) {
      console.error('Error bulk updating change records:', error);
      toast.error(`Failed to update records: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleImportRecords = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedChangeId) return;
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const recordRows: any[] = [];
        let addedCount = 0;
        const unknownCodes = new Set<string>();

        for (const row of data) {
          const costCode = String(row['Cost Code'] || '').trim();
          if (!costCode) continue;

          const targetChangeId = selectedChangeId;

          const entAttrs: Record<string, string> = {};
          enterprise.lineItemAttributes?.forEach(a => {
            if (row[a.title]) entAttrs[a.id] = String(row[a.title]);
          });

          const prjAttrs: Record<string, string> = {};
          project.lineItemAttributes?.forEach(a => {
            if (row[a.title]) prjAttrs[a.id] = String(row[a.title]);
          });

          // The sheet holds the cost CODE; the column is a foreign key. An
          // unrecognised code is reported rather than written as-is.
          const resolved = costCodes.find(c => c.code === costCode);
          if (!resolved) { unknownCodes.add(costCode); continue; }

          recordRows.push({
            changeId: targetChangeId,
            costCodeId: resolved.id,
            scope: String(row['Scope'] || '').slice(0, 100),
            enterpriseAttributes: entAttrs,
            projectAttributes: prjAttrs,
            budgetAmount: Number(row['Budget Amount']) || 0,
            eacAmount: Number(row['EAC Amount']) || 0,
          });
          addedCount++;
        }

        if (addedCount > 0) {
          // One statement. The changes' totals follow by trigger, so there is
          // no per-change recount loop afterwards.
          const imported = await upsertChangeRecords(project.id, recordRows);
          await reloadChangeRecords();
          await reloadChanges();
          toast.success(
            unknownCodes.size > 0
              ? `Imported ${imported} records. Skipped rows for unknown cost codes: ${Array.from(unknownCodes).join(', ')}`
              : `Imported ${imported} records`
          );
        } else if (unknownCodes.size > 0) {
          toast.error(`No records imported. Unknown cost codes: ${Array.from(unknownCodes).join(', ')}`);
        }
      } catch (error: any) {
        console.error('Failed to import change records', error);
        toast.error(`Failed to import: ${error?.message || 'Unknown error'}`);
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleAddRecord = async () => {
    if (!selectedChangeId) {
      toast.error("Please select a change first");
      return;
    }
    if (costCodes.length === 0) {
      toast.error("Create a cost code first -- a change record has to be against one.");
      return;
    }
    const toastId = toast.loading("Adding new record...");
    try {
      const newRecord = {
        changeId: selectedChangeId,
        // A record REFERENCES a cost code and cannot reference nothing, so a
        // new row starts on the first cost code and is changed in the grid.
        // It used to be created with an empty cost code, which the column
        // cannot hold.
        costCodeId: costCodes[0].id,
        scope: '',
        enterpriseAttributes: {},
        projectAttributes: {},
        budgetAmount: 0,
        eacAmount: 0,
      };
      await upsertChangeRecords(project.id, [newRecord as any]);
      await reloadChangeRecords();
      await reloadChanges();
      toast.success("Record added", { id: toastId });
    } catch (error: any) {
      toast.dismiss(toastId);
      console.error('Error adding change record:', error);
      toast.error(`Failed to add record: ${error?.message || 'Unknown error'}`);
    }
  };

  const enterpriseLineItemAttrs = useMemo(() => 
    (enterprise.lineItemAttributes || []).filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0),
    [enterprise.lineItemAttributes]
  );

  const projectLineItemAttrs = useMemo(() => 
    (project.lineItemAttributes || []).filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0),
    [project.lineItemAttributes]
  );

  const onCellValueChanged = async (params: CellValueChangedEvent) => {
    const { data, colDef } = params;
    if (!data.id) return;

    const field = colDef.field!;
    try {
      let value = params.newValue;

      // Enforce character limits
      if (field === 'initiator' || field === 'reference') {
        value = String(params.newValue ?? '').slice(0, 50);
      }

      // Attribute columns carry a dotted path, which is a Firestore idiom for
      // merging into a nested map and not a column name. applyChangeCellEdit
      // routes those to the merge function.
      await applyChangeCellEdit(data.id, field, value);
      await reloadChanges();
    } catch (error: any) {
      console.error('Change update failed', error);
      toast.error(`Failed to update change: ${error?.message || 'Unknown error'}`);
      await reloadChanges();
    }
  };

  const onRecordCellValueChanged = async (params: CellValueChangedEvent) => {
    const { data, colDef } = params;
    if (!data.id) return;

    const field = colDef.field!;
    try {
      let value = params.newValue;

      // Enforce character limits
      if (field === 'scope') {
        value = String(params.newValue ?? '').slice(0, 100);
      }

      if (field === 'costCodeId') {
        // The column shows the cost CODE but holds the row id, so the typed
        // code is resolved before it reaches a uuid column.
        const resolved = costCodes.find(c => c.code === String(params.newValue ?? '').trim());
        if (!resolved) {
          toast.error(`Unknown cost code "${params.newValue}"`);
          await reloadChangeRecords();
          return;
        }
        value = resolved.id;
      }

      await applyChangeRecordCellEdit(data.id, field, value);
      await reloadChangeRecords();
      // The change's totals follow by trigger.
      await reloadChanges();
    } catch (error: any) {
      toast.error(`Operation failed: ${(error as any)?.message || 'Unknown error'}`);
    }
  };

  // A change's budget and EAC are derived by a database trigger from its
  // records, so there is nothing to recompute here. This used to read every
  // record of the change back, sum them in the browser and write the totals
  // onto the change -- which could leave a change showing a total that did
  // not match its own records if it failed in between. Kept as a no-op
  // refresh so callers still show the new totals.
  const updateParentTotals = async (_changeId: string) => {
    await reloadChanges();
  };

  const changeColumnDefs: (ColDef | ColGroupDef)[] = [
    {
      headerName: '',
      headerCheckboxSelection: true,
      checkboxSelection: true,
      headerCheckboxSelectionFilteredOnly: true,
      width: 50,
      pinned: 'left',
      sortable: false,
      filter: false
    },
    {
      headerName: 'Change ID',
      field: 'changeId',
      pinned: 'left',
      width: 150,
      sort: 'asc',
      cellRenderer: (params: any) => {
        if (params.node.rowPinned) return params.value;
        return (
          <button 
            onClick={() => setSelectedChangeId(params.data.id)}
            className="text-blue-600 hover:text-blue-800 hover:underline font-bold text-left transition-colors"
          >
            {params.value}
          </button>
        );
      },
      enableRowGroup: true
    },
    {
      headerName: 'Period',
      field: 'periodId',
      editable: true,
      width: 150,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: {
        values: project.reportingPeriods?.periods.map(p => p.id) || []
      },
      valueFormatter: (p: any) => {
        const period = project.reportingPeriods?.periods.find(per => per.id === p.value);
        return period ? period.name : p.value;
      },
      enableRowGroup: true
    },
    {
      headerName: 'Description',
      field: 'description',
      editable: true,
      width: 300,
      enableRowGroup: true
    },
    {
      headerName: 'Status',
      field: 'status',
      editable: true,
      width: 150,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: {
        values: ['Approved', 'Pending', 'Rejected', 'Withdrawn']
      },
      cellClassRules: {
        'text-emerald-600 font-bold': (p: any) => p.value === 'Approved',
        'text-amber-600 font-bold': (p: any) => p.value === 'Pending',
        'text-red-600 font-bold': (p: any) => p.value === 'Rejected',
        'text-gray-500 font-bold': (p: any) => p.value === 'Withdrawn',
      },
      enableRowGroup: true
    },
    {
      headerName: 'Initiator',
      field: 'initiator',
      editable: true,
      width: 150,
      enableRowGroup: true
    },
    {
      headerName: 'Reference',
      field: 'reference',
      editable: true,
      width: 150,
      enableRowGroup: true
    },
    {
      headerName: 'Budget',
      field: 'budget',
      width: 150,
      valueFormatter: (p) => formatCurrency(p.value),
      type: 'numericColumn',
      cellStyle: { fontWeight: 'bold' },
      aggFunc: 'sum'
    },
    {
      headerName: 'EAC',
      field: 'eac',
      width: 150,
      valueFormatter: (p) => formatCurrency(p.value),
      type: 'numericColumn',
      cellStyle: { fontWeight: 'bold' },
      aggFunc: 'sum'
    },
      {
        headerName: 'Actions',
        width: 100,
        pinned: 'right',
        cellRenderer: (p: any) => {
          if (p.node.rowPinned) return null;
          return (
            <div className="flex items-center gap-2 h-full">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setChangeToDelete(p.data);
                  setIsDeleteChangeOpen(true);
                }}
                className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          );
        }
      }
  ];

  // Dynamically add enterprise change attributes
  const enterpriseChangeAttrs = (enterprise.changeAttributes || []).filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0);
  if (enterpriseChangeAttrs.length > 0) {
    changeColumnDefs.splice(changeColumnDefs.length - 1, 0, {
      headerName: 'Enterprise Change Attributes',
      openByDefault: true,
      children: enterpriseChangeAttrs.map((attr, index) => ({
        headerName: attr.title,
        field: `enterpriseAttributes.${attr.id}`,
        width: 200,
        columnGroupShow: index === 0 ? undefined : 'open',
        editable: true,
        cellEditor: 'agRichSelectCellEditor',
        cellEditorParams: {
          values: (attr.values || [])
            .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
            .map(v => `${v.id} | ${v.description}`),
          searchType: 'matchAny',
          allowTyping: true,
          filterList: true
        },
        enableRowGroup: true
      }))
    });
  }

  // Dynamically add project change attributes
  const projectChangeAttrs = (project.changeAttributes || []).filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0);
  if (projectChangeAttrs.length > 0) {
    changeColumnDefs.splice(changeColumnDefs.length - 1, 0, {
      headerName: 'Project Change Attributes',
      openByDefault: true,
      children: projectChangeAttrs.map((attr, index) => ({
        headerName: attr.title,
        field: `projectAttributes.${attr.id}`,
        width: 200,
        columnGroupShow: index === 0 ? undefined : 'open',
        editable: true,
        cellEditor: 'agRichSelectCellEditor',
        cellEditorParams: {
          values: (attr.values || [])
            .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
            .map(v => `${v.id} | ${v.description}`),
          searchType: 'matchAny',
          allowTyping: true,
          filterList: true
        },
        enableRowGroup: true
      }))
    });
  }

  const recordColumnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => [
    {
      headerName: '',
      headerCheckboxSelection: true,
      checkboxSelection: true,
      headerCheckboxSelectionFilteredOnly: true,
      width: 50,
      pinned: 'left',
      sortable: false,
      filter: false
    },
    {
      headerName: 'Cost Code',
      field: 'costCodeId',
      editable: true,
      width: 200,
      cellEditor: 'agRichSelectCellEditor',
      cellEditorParams: {
        values: costCodes.map(c => c.code),
        searchType: 'match',
        allowTyping: true,
        filterList: true
      },
      // The column holds a foreign key; a user reads and types the code.
      valueFormatter: (params: ValueFormatterParams) =>
        costCodes.find(c => c.id === params.value)?.code || '',
      enableRowGroup: true
    },
    {
      headerName: 'Scope',
      field: 'scope',
      editable: true,
      width: 250,
      enableRowGroup: true
    },
    {
      headerName: 'Enterprise Line-Item Attributes',
      openByDefault: true,
      children: enterpriseLineItemAttrs.map((attr, index) => ({
        headerName: attr.title,
        field: `enterpriseAttributes.${attr.id}`,
        width: 200,
        columnGroupShow: index === 0 ? undefined : 'open',
        editable: true,
        cellEditor: 'agRichSelectCellEditor',
        cellEditorParams: {
          values: (attr.values || [])
            .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
            .map(v => `${v.id} | ${v.description}`),
          searchType: 'matchAny',
          allowTyping: true,
          filterList: true
        },
        enableRowGroup: true
      }))
    },
    {
      headerName: 'Project Line-Item Attributes',
      openByDefault: true,
      children: projectLineItemAttrs.map((attr, index) => ({
        headerName: attr.title,
        field: `projectAttributes.${attr.id}`,
        width: 200,
        columnGroupShow: index === 0 ? undefined : 'open',
        editable: true,
        cellEditor: 'agRichSelectCellEditor',
        cellEditorParams: {
          values: (attr.values || [])
            .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
            .map(v => `${v.id} | ${v.description}`),
          searchType: 'matchAny',
          allowTyping: true,
          filterList: true
        },
        enableRowGroup: true
      }))
    },
    {
      headerName: 'Budget Amount',
      field: 'budgetAmount',
      editable: true,
      width: 150,
      type: 'numericColumn',
      valueFormatter: (p) => formatCurrency(p.value),
      cellEditor: 'agNumberCellEditor',
      aggFunc: 'sum'
    },
    {
      headerName: 'EAC Amount',
      field: 'eacAmount',
      editable: true,
      width: 150,
      type: 'numericColumn',
      valueFormatter: (p) => formatCurrency(p.value),
      cellEditor: 'agNumberCellEditor',
      aggFunc: 'sum'
    },
    {
      headerName: 'Actions',
      width: 100,
      pinned: 'right',
      cellRenderer: (p: any) => {
        if (p.node.rowPinned) return null;
        return (
          <div className="flex items-center gap-2 h-full">
            <button 
              onClick={async (e) => {
                e.stopPropagation();
                await deleteChangeRecords([p.data.id]);
                await reloadChangeRecords();
                await reloadChanges();
                updateParentTotals(p.data.changeId);
              }}
              className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      }
    }
  ], [costCodes, enterpriseLineItemAttrs, projectLineItemAttrs, changes]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden">
      {/* Header / Toolbar */}
      <div className="p-6 border-b border-gray-100 dark:border-white/10 flex justify-between items-center bg-gray-50/50 dark:bg-white/5 shrink-0">
        <div className="flex items-center gap-8">
          <div>
            <h3 className="text-xl font-bold dark:text-white">Change Management</h3>
            <p className="text-sm text-gray-900 dark:text-gray-400">Manage project changes and their cost impacts.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              type="text" 
              placeholder="Search changes..."
              value={quickFilterText}
              onChange={(e) => setQuickFilterText(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none w-64 dark:text-white"
            />
          </div>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept=".xlsx,.xls,.csv"
            onChange={handleImport}
          />
          
          <button onClick={() => fileInputRef.current?.click()} className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Import"><Upload className="w-5 h-5" /></button>
          <button onClick={handleExport} className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Export"><Download className="w-5 h-5" /></button>
          
          <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
          
          <button 
            onClick={() => toggleAllChangeColumnGroups(true)}
            className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
            title="Expand All Groups"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button 
            onClick={() => toggleAllChangeColumnGroups(false)}
            className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
            title="Collapse All Groups"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
          
          <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
          
          <button 
            onClick={() => setIsChartsVisible(!isChartsVisible)}
            className={cn(
              "p-2 rounded-lg transition-all",
              isChartsVisible 
                ? "bg-black text-white dark:bg-white dark:text-black shadow-lg" 
                : "text-gray-400 hover:text-black dark:hover:text-white"
            )}
            title={isChartsVisible ? "Hide Charts" : "Show Charts"}
          >
            <BarChart3 className="w-5 h-5" />
          </button>

          {selectedIds.size > 0 && (
            <div className="flex gap-2">
              <select 
                onChange={async (e) => {
                  const newStatus = e.target.value;
                  if (!newStatus) return;
                  try {
                    // One statement for the whole selection. A status change
                    // moves money in or out of every cost code the change
                    // touches, since only Approved and Pending changes count.
                    const { error } = await supabase
                      .from('changes')
                      .update({ status: newStatus })
                      .in('id', Array.from(selectedIds));
                    raise('update change status', error);
                    await reloadChanges();
                    toast.success(`Updated ${selectedIds.size} changes to ${newStatus}`);
                    e.target.value = '';
                  } catch (error) {
                    toast.error("Failed to bulk update");
                  }
                }}
                className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-xs font-bold outline-none dark:text-white"
              >
                <option value="">Bulk Update Status</option>
                <option value="Approved">Approved</option>
                <option value="Pending">Pending</option>
                <option value="Rejected">Rejected</option>
                <option value="Withdrawn">Withdrawn</option>
              </select>

              <button 
                onClick={() => setIsBulkDeleteOpen(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
              >
                <Trash2 className="w-4 h-4" /> Delete ({selectedIds.size})
              </button>
            </div>
          )}

          <button 
            onClick={() => setIsCreateChangeOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-xl text-sm font-bold hover:bg-black/90 dark:hover:bg-white/90 transition-all shadow-lg shadow-black/10 dark:shadow-white/10"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </div>

      {/* Table Area */}
      <div className={cn(
        "flex flex-col transition-all duration-500 ease-in-out overflow-hidden",
        selectedChangeId 
          ? (isMainTableCollapsed ? "h-[60px]" : "h-[40%]") 
          : "flex-1"
      )}>
        <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Layout className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-bold uppercase tracking-wider dark:text-white">Changes List</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Approved</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Pending</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedChangeId && (
              <button 
                onClick={() => setIsMainTableCollapsed(!isMainTableCollapsed)}
                className="p-1.5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-lg transition-colors"
                title={isMainTableCollapsed ? "Expand Table" : "Collapse Table"}
              >
                {isMainTableCollapsed ? <ChevronDown className="w-4 h-4 dark:text-white" /> : <ChevronUp className="w-4 h-4 dark:text-white" />}
              </button>
            )}
          </div>
        </div>

        {/* Charts Section */}
        <AnimatePresence>
          {isChartsVisible && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="shrink-0 overflow-hidden bg-gray-50/50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <h3 className="text-sm font-bold dark:text-white uppercase tracking-widest text-gray-400">
                      {chartMetric === 'budget' ? 'Budget' : 'EAC'} Changes by Period
                    </h3>
                    <div className="flex bg-gray-200 dark:bg-white/10 p-1 rounded-lg">
                      <button
                        onClick={() => setChartMetric('budget')}
                        className={cn(
                          "px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all",
                          chartMetric === 'budget' 
                            ? "bg-white dark:bg-[#141414] text-blue-600 shadow-sm" 
                            : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                        )}
                      >
                        Budget
                      </button>
                      <button
                        onClick={() => setChartMetric('eac')}
                        className={cn(
                          "px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all",
                          chartMetric === 'eac' 
                            ? "bg-white dark:bg-[#141414] text-emerald-600 shadow-sm" 
                            : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                        )}
                      >
                        EAC
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <div className={cn("w-3 h-3 rounded-sm", chartMetric === 'budget' ? "bg-blue-500" : "bg-emerald-500")} />
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                        {chartMetric === 'budget' ? 'Budget Amount' : 'EAC Amount'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={cn("w-3 h-0.5", chartMetric === 'budget' ? "bg-blue-400" : "bg-emerald-400")} />
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Cumulative</span>
                    </div>
                  </div>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#333' : '#eee'} />
                      <XAxis 
                        dataKey="name" 
                        fontSize={10} 
                        tick={{ fill: '#9ca3af' }} 
                        axisLine={false} 
                        tickLine={false} 
                      />
                      <YAxis 
                        yAxisId="left"
                        fontSize={10} 
                        tick={{ fill: '#9ca3af' }} 
                        axisLine={false} 
                        tickLine={false} 
                        tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`}
                        domain={[0, 'auto']}
                      />
                      <YAxis 
                        yAxisId="right"
                        orientation="right"
                        fontSize={10} 
                        tick={{ fill: '#9ca3af' }} 
                        axisLine={false} 
                        tickLine={false} 
                        tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`}
                        domain={[0, 'auto']}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: theme === 'dark' ? '#1a1a1a' : '#fff', border: 'none', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                        formatter={(v: number) => formatCurrency(v)}
                      />
                      <Bar 
                        yAxisId="left"
                        dataKey={chartMetric} 
                        fill={chartMetric === 'budget' ? "#3B82F6" : "#10B981"} 
                        radius={[4, 4, 0, 0]} 
                        barSize={40} 
                      />
                      <Line 
                        yAxisId="right"
                        type="monotone" 
                        dataKey={chartMetric === 'budget' ? "cumulativeBudget" : "cumulativeEac"} 
                        stroke={chartMetric === 'budget' ? "#60A5FA" : "#34D399"} 
                        strokeWidth={2} 
                        dot={{ fill: chartMetric === 'budget' ? "#60A5FA" : "#34D399", r: 4 }} 
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 relative">
          <div className={cn(
            "absolute inset-0 ag-theme-quartz",
            theme === 'dark' ? "ag-theme-quartz-dark" : ""
          )}>
            <AgGridReact
              ref={gridRef}
              rowData={changes}
              columnDefs={changeColumnDefs}
              pinnedTopRowData={changesPinnedBottomRowData}
              groupDefaultExpanded={-1}
              getRowClass={(params) => {
                if (params.node.rowPinned) return 'pinned-row-highlight';
                return '';
              }}
              quickFilterText={quickFilterText}
              onCellValueChanged={onCellValueChanged}
              onSelectionChanged={(p) => {
                const selectedRows = p.api.getSelectedRows();
                const displayedSelected = selectedRows.filter(row => {
                  const node = p.api.getRowNode(row.id);
                  return node && node.displayed;
                });
                setSelectedIds(new Set(displayedSelected.map(r => r.id)));
              }}
              onFilterChanged={(p) => {
                const selectedRows = p.api.getSelectedRows();
                const displayedSelected = selectedRows.filter(row => {
                  const node = p.api.getRowNode(row.id);
                  return node && node.displayed;
                });
                setSelectedIds(new Set(displayedSelected.map(r => r.id)));
              }}
              getRowId={(params) => params.data.id}
              rowSelection="multiple"
              suppressRowClickSelection={true}
              sideBar={sideBar}
              statusBar={statusBar}
              rowGroupPanelShow="always"
              pivotPanelShow="always"
              groupDisplayType="multipleColumns"
              enableRangeSelection={true}
              enableFillHandle={true}
              undoRedoCellEditing={true}
              animateRows={true}
              defaultColDef={{
                sortable: true,
                filter: true,
                resizable: true,
                enableRowGroup: true,
                enablePivot: true,
                enableValue: true,
              }}
            />
          </div>
        </div>
      </div>

      {/* Records Section */}
      <AnimatePresence>
        {selectedChangeId && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ 
              height: isMainTableCollapsed ? 'calc(100% - 60px)' : '60%', 
              opacity: 1 
            }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0a0a0a] flex flex-col overflow-hidden"
          >
            <div className="p-4 flex items-center justify-between bg-white dark:bg-[#141414] border-b border-gray-200 dark:border-white/10">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-bold dark:text-white">Change Records: <span className="text-emerald-600">{changes.find(c => c.id === selectedChangeId)?.changeId}</span></h3>
                </div>
                <div className="h-4 w-px bg-gray-200 dark:bg-white/10" />
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input 
                    type="text" 
                    placeholder="Search records..."
                    value={recordsQuickFilterText}
                    onChange={(e) => setRecordsQuickFilterText(e.target.value)}
                    className="pl-9 pr-4 py-1.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 outline-none w-48 dark:text-white"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="file" ref={recordFileInputRef} className="hidden" accept=".xlsx,.xls,.csv" onChange={handleImportRecords} />
                <button onClick={() => recordFileInputRef.current?.click()} className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Import Records"><Upload className="w-4 h-4" /></button>
                <button onClick={handleExportRecords} className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Export Records"><Download className="w-4 h-4" /></button>
                
                <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />

                <button 
                  onClick={() => toggleAllRecordColumnGroups(true)}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                  title="Expand All Groups"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => toggleAllRecordColumnGroups(false)}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                  title="Collapse All Groups"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>

                <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />

                {selectedRecordIds.size > 0 && (
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setIsBulkRecordUpdateOpen(true)}
                      className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-blue-700 transition-all shadow-sm"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Update ({selectedRecordIds.size})
                    </button>
                    <button 
                      onClick={async () => {
                        if (confirm(`Delete ${selectedRecordIds.size} records?`)) {
                          await deleteChangeRecords(Array.from(selectedRecordIds));
                          await reloadChangeRecords();
                          await reloadChanges();
                          setSelectedRecordIds(new Set());
                          toast.success(`Deleted ${selectedRecordIds.size} records`);
                        }
                      }}
                      className="flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-700 transition-all shadow-sm"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete ({selectedRecordIds.size})
                    </button>
                  </div>
                )}

                <button 
                  onClick={handleAddRecord}
                  className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-xl text-sm font-bold hover:bg-black/90 dark:hover:bg-white/90 transition-all shadow-lg shadow-black/10"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
                <button 
                  onClick={() => setSelectedChangeId(null)}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 relative">
              <div className={cn(
                "absolute inset-0 ag-theme-quartz",
                theme === 'dark' ? "ag-theme-quartz-dark" : ""
              )}>
                <AgGridReact
                  ref={recordsGridRef}
                  rowData={changeRecords}
                  columnDefs={recordColumnDefs}
                  pinnedTopRowData={recordPinnedBottomRowData}
                  getRowClass={(params) => {
                    if (params.node.rowPinned) return 'pinned-row-highlight';
                    return '';
                  }}
                  quickFilterText={recordsQuickFilterText}
                  onCellValueChanged={onRecordCellValueChanged}
                  onSelectionChanged={(p) => {
                    const selectedRows = p.api.getSelectedRows();
                    const displayedSelected = selectedRows.filter(row => {
                      const node = p.api.getRowNode(row.id);
                      return node && node.displayed;
                    });
                    setSelectedRecordIds(new Set(displayedSelected.map(r => r.id)));
                  }}
                  onFilterChanged={(p) => {
                    const selectedRows = p.api.getSelectedRows();
                    const displayedSelected = selectedRows.filter(row => {
                      const node = p.api.getRowNode(row.id);
                      return node && node.displayed;
                    });
                    setSelectedRecordIds(new Set(displayedSelected.map(r => r.id)));
                  }}
                  getRowId={(params) => params.data.id}
                  rowSelection="multiple"
                  suppressRowClickSelection={true}
                  sideBar={sideBar}
                  statusBar={statusBar}
                  rowGroupPanelShow="always"
                  pivotPanelShow="always"
                  groupDisplayType="multipleColumns"
                  enableRangeSelection={true}
                  enableFillHandle={true}
                  undoRedoCellEditing={true}
                  animateRows={true}
                  defaultColDef={{
                    sortable: true,
                    filter: true,
                    resizable: true,
                    enableRowGroup: true,
                    enablePivot: true,
                    enableValue: true,
                  }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Change Modal */}
      <Dialog open={isCreateChangeOpen} onOpenChange={setIsCreateChangeOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Create New Change</DialogTitle>
            <DialogDescription>Enter the details for the new project change.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateChange} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Change ID</label>
                <Input 
                  required
                  maxLength={20}
                  value={newChange.changeId}
                  onChange={e => setNewChange({...newChange, changeId: e.target.value})}
                  placeholder="e.g. CHG-001"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Period</label>
                <Select 
                  value={newChange.periodId} 
                  onValueChange={v => setNewChange({...newChange, periodId: v})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Period" />
                  </SelectTrigger>
                  <SelectContent>
                    {(project.reportingPeriods?.periods || []).map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Description</label>
              <Input 
                value={newChange.description}
                onChange={e => setNewChange({...newChange, description: e.target.value})}
                placeholder="Brief description of the change"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Initiator</label>
                <Input 
                  maxLength={50}
                  value={newChange.initiator}
                  onChange={e => setNewChange({...newChange, initiator: e.target.value})}
                  placeholder="Person who initiated"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Reference</label>
                <Input 
                  maxLength={50}
                  value={newChange.reference}
                  onChange={e => setNewChange({...newChange, reference: e.target.value})}
                  placeholder="External reference #"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateChangeOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-black text-white dark:bg-white dark:text-black">Create Change</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={isDeleteChangeOpen} onOpenChange={setIsDeleteChangeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Confirm Deletion
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete change <span className="font-bold">"{changeToDelete?.changeId}"</span>? This will also delete all associated change records. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteChangeOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteChange}>Delete Change</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog open={isBulkDeleteOpen} onOpenChange={setIsBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Confirm Bulk Deletion
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <span className="font-bold">{selectedIds.size}</span> selected changes? This will also delete all associated change records. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleBulkDelete}>Delete Selected</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Bulk Update Records Modal */}
      <Dialog open={isBulkRecordUpdateOpen} onOpenChange={setIsBulkRecordUpdateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk Update Records</DialogTitle>
            <DialogDescription>
              Update selected fields for {selectedRecordIds.size} records.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cost Code</label>
              <Select 
                value={bulkRecordUpdateData.costCodeId} 
                onValueChange={(v) => setBulkRecordUpdateData({ ...bulkRecordUpdateData, costCodeId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Cost Code" />
                </SelectTrigger>
                <SelectContent>
                  {costCodes.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.code} - {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Scope</label>
              <Input 
                value={bulkRecordUpdateData.scope}
                onChange={(e) => setBulkRecordUpdateData({ ...bulkRecordUpdateData, scope: e.target.value })}
                placeholder="Enter scope..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Budget Amount</label>
                <Input 
                  type="number"
                  value={bulkRecordUpdateData.budgetAmount}
                  onChange={(e) => setBulkRecordUpdateData({ ...bulkRecordUpdateData, budgetAmount: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">EAC Amount</label>
                <Input 
                  type="number"
                  value={bulkRecordUpdateData.eacAmount}
                  onChange={(e) => setBulkRecordUpdateData({ ...bulkRecordUpdateData, eacAmount: e.target.value })}
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Enterprise Attributes */}
            {enterprise.lineItemAttributes && enterprise.lineItemAttributes.length > 0 && (
              <div className="space-y-4 pt-2 border-t border-gray-100 dark:border-white/10">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Enterprise Attributes</h4>
                <div className="grid grid-cols-2 gap-4">
                  {enterprise.lineItemAttributes.map(attr => (
                    <div key={attr.id} className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{attr.title}</label>
                      <Select 
                        value={bulkRecordUpdateData.enterpriseAttributes[attr.id] || ''} 
                        onValueChange={val => setBulkRecordUpdateData(prev => ({
                          ...prev,
                          enterpriseAttributes: { ...prev.enterpriseAttributes, [attr.id]: val }
                        }))}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          {attr.values.map(v => (
                            <SelectItem key={v.id} value={v.id}>{v.id} - {v.description}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Project Attributes */}
            {project.lineItemAttributes && project.lineItemAttributes.length > 0 && (
              <div className="space-y-4 pt-2 border-t border-gray-100 dark:border-white/10">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Project Attributes</h4>
                <div className="grid grid-cols-2 gap-4">
                  {project.lineItemAttributes.map(attr => (
                    <div key={attr.id} className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{attr.title}</label>
                      <Select 
                        value={bulkRecordUpdateData.projectAttributes[attr.id] || ''} 
                        onValueChange={val => setBulkRecordUpdateData(prev => ({
                          ...prev,
                          projectAttributes: { ...prev.projectAttributes, [attr.id]: val }
                        }))}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          {attr.values.map(v => (
                            <SelectItem key={v.id} value={v.id}>{v.id} - {v.description}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkRecordUpdateOpen(false)}>Cancel</Button>
            <Button onClick={handleBulkUpdateRecords}>Update Records</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
