import { subscribeToTable } from '../lib/supabase';
import { fetchCostCodes } from '../lib/costCodes';
import {
  fetchRisks, createRisk, updateRisk, deleteRisks, bulkUpdateRisks, importRisks,
  fetchRiskRecords, upsertRiskRecords, updateRiskRecord, deleteRiskRecords,
  bulkUpdateRiskRecords, applyRiskCellEdit, applyRiskRecordCellEdit,
  mergeRiskRecordAttributes,
} from '../lib/risks';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Project, Enterprise, Risk, RiskRecord, CostCode } from '../types';
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
  ClipboardList,
  ShieldCheck,
  ShieldAlert
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

interface RiskManagementProps {
  project: Project;
  enterprise: Enterprise;
}

export default function RiskManagement({ project, enterprise }: RiskManagementProps) {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [riskRecords, setRiskRecords] = useState<RiskRecord[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRiskId, setSelectedRiskId] = useState<string | null>(null);
  const [quickFilterText, setQuickFilterText] = useState('');
  const [recordsQuickFilterText, setRecordsQuickFilterText] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [isChartsVisible, setIsChartsVisible] = useState(false);
  const [chartMetric, setChartMetric] = useState<'exposure' | 'mitigation' | 'residualExposure'>('exposure');
  const [isBulkRiskUpdateOpen, setIsBulkRiskUpdateOpen] = useState(false);
  const [isBulkRiskDeleteOpen, setIsBulkRiskDeleteOpen] = useState(false);
  const [isBulkRecordUpdateOpen, setIsBulkRecordUpdateOpen] = useState(false);
  const [isBulkRecordDeleteOpen, setIsBulkRecordDeleteOpen] = useState(false);
  const [bulkRiskUpdateData, setBulkRiskUpdateData] = useState({
    status: '',
    strategy: '',
    initiator: '',
    type: ''
  });

  const handleBulkUpdateRisks = async () => {
    if (selectedIds.size === 0) return;
    try {
      const updates: any = {};
      if (bulkRiskUpdateData.status) updates.status = bulkRiskUpdateData.status;
      if (bulkRiskUpdateData.strategy) updates.strategy = bulkRiskUpdateData.strategy;
      if (bulkRiskUpdateData.initiator) updates.initiator = bulkRiskUpdateData.initiator;
      if (bulkRiskUpdateData.type) updates.type = bulkRiskUpdateData.type;

      // One statement for every selected risk.
      const updated = await bulkUpdateRisks(Array.from(selectedIds), updates);
      await reloadRisks();
      toast.success(`Updated ${updated} risks`);
      setIsBulkRiskUpdateOpen(false);
      setSelectedIds(new Set());
    } catch (error: any) {
      console.error('Failed to bulk update risks', error);
      toast.error(`Failed to update risks: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleBulkDeleteRisks = async () => {
    if (selectedIds.size === 0) return;
    try {
      // One statement. The records cascade with their risk, so there is no
      // read of every child first to avoid orphans.
      await deleteRisks(Array.from(selectedIds));
      await reloadRisks();
      toast.success('Risks and associated records deleted');
      setIsBulkRiskDeleteOpen(false);
      if (selectedRiskId && selectedIds.has(selectedRiskId)) setSelectedRiskId(null);
      setSelectedIds(new Set());
    } catch (error: any) {
      console.error('Failed to delete risks', error);
      toast.error(`Failed to delete risks: ${error?.message || 'Unknown error'}`);
    }
  };
  const [bulkRecordUpdateData, setBulkRecordUpdateData] = useState<{
    costCodeId: string;
    scope: string;
    probability: string;
    minImpactAmount: string;
    mostLikelyImpactAmount: string;
    maxImpactAmount: string;
    enterpriseAttributes: Record<string, any>;
    projectAttributes: Record<string, any>;
  }>({
    costCodeId: '',
    scope: '',
    probability: '',
    minImpactAmount: '',
    mostLikelyImpactAmount: '',
    maxImpactAmount: '',
    enterpriseAttributes: {},
    projectAttributes: {}
  });
  
  // Modal States
  const [isCreateRiskOpen, setIsCreateRiskOpen] = useState(false);
  const [isDeleteRiskOpen, setIsDeleteRiskOpen] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [riskToDelete, setRiskToDelete] = useState<Risk | null>(null);
  
  const [newRisk, setNewRisk] = useState({
    riskId: '',
    description: '',
    type: '',
    status: 'Open' as Risk['status'],
    strategy: 'Mitigate' as Risk['strategy'],
    initiator: '',
    reference: '',
    periodId: ''
  });

  const [isMainTableCollapsed, setIsMainTableCollapsed] = useState(false);

  const enterpriseLineItemAttrs = useMemo(() => 
    (enterprise.lineItemAttributes || []).filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0),
    [enterprise.lineItemAttributes]
  );

  const projectLineItemAttrs = useMemo(() => 
    (project.lineItemAttributes || []).filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0),
    [project.lineItemAttributes]
  );

  const gridRef = useRef<AgGridReact>(null);
  const recordsGridRef = useRef<AgGridReact>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recordFileInputRef = useRef<HTMLInputElement>(null);

  const toggleAllRiskColumnGroups = (opened: boolean) => {
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

  const [importPreview, setImportPreview] = useState<{ type: 'risks' | 'records', data: any[] } | null>(null);

  const handleExport = () => {
    if (gridRef.current?.api) {
      gridRef.current.api.exportDataAsExcel({
        fileName: `${project.projectCode}_Risks_${new Date().toISOString().split('T')[0]}.xlsx`
      });
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];
        if (data.length === 0) {
          toast.error("The file is empty.");
          return;
        }
        setImportPreview({ type: 'risks', data });
      } catch (error) { toast.error("Import failed"); }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleExportRecords = () => {
    if (recordsGridRef.current?.api) {
      recordsGridRef.current.api.exportDataAsExcel({
        fileName: `${project.projectCode}_Risk_Records_${selectedRiskId}_${new Date().toISOString().split('T')[0]}.xlsx`
      });
    }
  };

  const handleImportRecords = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedRiskId) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];
        if (data.length === 0) {
          toast.error("The file is empty.");
          return;
        }
        setImportPreview({ type: 'records', data });
      } catch (error) { toast.error("Import failed"); }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const completeImport = async () => {
    if (!importPreview) return;
    const { type, data } = importPreview;
    try {
      if (type === 'risks') {
        const rows = data
          .map(row => ({
            riskId: String(row['Risk ID'] || row.riskId || row.ID || row.id || '').trim().slice(0, 20),
            description: String(row['Description'] || row.description || ''),
            type: String(row['Type'] || row.type || (enterprise.riskTypes?.[0] || '')),
            status: String(row['Status'] || row.status || 'Open'),
            strategy: String(row['Strategy'] || row.strategy || 'Mitigate'),
            initiator: String(row['Initiator'] || row.initiator || '').slice(0, 50),
            reference: String(row['Reference'] || row.reference || '').slice(0, 50),
          }))
          .filter(r => r.riskId);

        if (rows.length === 0) {
          toast.error('No rows in the sheet carried a Risk ID.');
          setImportPreview(null);
          return;
        }

        // One statement. Upsert on (project_id, risk_id), so the database
        // decides whether a sheet row is a new risk or an update -- this used
        // to scan the risks the browser happened to be holding. The four
        // totals are derived from the records by trigger, so a new risk does
        // not carry zeroes in.
        const imported = await importRisks(project.id, rows as any);
        await reloadRisks();
        toast.success(`Processed ${imported} risks`);
      } else if (type === 'records' && selectedRiskId) {
        const unknownCodes = new Set<string>();
        const rows: any[] = [];

        data.forEach(row => {
          const codeText = String(row['Cost Code'] || row.costCodeId || '').trim();
          if (!codeText) return;

          // The sheet names a cost code; the column is a foreign key.
          const resolved = costCodes.find(c => c.code === codeText || c.id === codeText);
          if (!resolved) { unknownCodes.add(codeText); return; }

          rows.push({
            riskId: selectedRiskId,
            costCodeId: resolved.id,
            scope: String(row['Scope'] || row.scope || '').slice(0, 100),
            // The Beta PERT impact is generated by the database from these.
            probability: Number(row['Prob %'] || row.probability || 100) / 100,
            minImpactAmount: Number(row['Min Value $'] || row.minImpactAmount || 0),
            mostLikelyImpactAmount: Number(row['Most Likely $'] || row.mostLikelyImpactAmount || 0),
            maxImpactAmount: Number(row['Max Value $'] || row.maxImpactAmount || 0),
          });
        });

        if (rows.length === 0) {
          toast.error(
            unknownCodes.size > 0
              ? `No records imported. Unknown cost codes: ${Array.from(unknownCodes).join(', ')}`
              : 'No rows in the sheet carried a Cost Code.'
          );
          setImportPreview(null);
          return;
        }

        // The risk's totals follow by trigger.
        const imported = await upsertRiskRecords(project.id, rows);
        await reloadRecords();
        await reloadRisks();
        toast.success(
          unknownCodes.size > 0
            ? `Imported ${imported} records. Unknown cost codes skipped: ${Array.from(unknownCodes).join(', ')}`
            : `Imported ${imported} records`
        );
      }
    } catch (error: any) {
      console.error('Import commit error:', error);
      toast.error(`Failed to finish import: ${error?.message || 'Unknown error'}`);
    }
    setImportPreview(null);
  };

  const riskPinnedBottomRowData = useMemo(() => {
    if (risks.length === 0) return [];
    return [{
      riskId: 'TOTALS',
      minImpactTotal: risks.reduce((sum, r) => sum + (r.minImpactTotal || 0), 0),
      mostLikelyImpactTotal: risks.reduce((sum, r) => sum + (r.mostLikelyImpactTotal || 0), 0),
      maxImpactTotal: risks.reduce((sum, r) => sum + (r.maxImpactTotal || 0), 0),
      exposure: risks.reduce((sum, r) => sum + (r.exposure || 0), 0)
    }];
  }, [risks]);

  const recordPinnedBottomRowData = useMemo(() => {
    if (riskRecords.length === 0) return [];
    return [{
      costCodeId: 'TOTALS',
      minImpactAmount: riskRecords.reduce((sum, r) => sum + (r.minImpactAmount || 0), 0),
      mostLikelyImpactAmount: riskRecords.reduce((sum, r) => sum + (r.mostLikelyImpactAmount || 0), 0),
      maxImpactAmount: riskRecords.reduce((sum, r) => sum + (r.maxImpactAmount || 0), 0),
      betaPertImpactAmount: riskRecords.reduce((sum, r) => sum + (r.betaPertImpactAmount || 0), 0)
    }];
  }, [riskRecords]);

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

    // Sort periods by start date
    const periods = [...project.reportingPeriods.periods].sort((a, b) => 
      new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );
    
    let cumulativeExposure = 0;
    let cumulativeMitigation = 0;
    let cumulativeResidual = 0;

    const data = periods.map((p, index) => {
      const periodRisks = risks.filter(r => r.periodId === p.id);
      const exposure = periodRisks.reduce((sum, r) => sum + (r.exposure || 0), 0);
      
      cumulativeExposure += exposure;

      const date = new Date(p.startDate);
      const month = date.toLocaleString('en-US', { month: 'short' });
      const year = date.getFullYear().toString().slice(-2);
      const dateLabel = `${month}'${year}`;

      return {
        name: `P${index + 1} (${dateLabel})`,
        exposure,
        cumulativeExposure
      };
    });

    return data;
  }, [risks, project.reportingPeriods]);

  useEffect(() => {
    const root = document.documentElement;
    setTheme(root.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  const reloadRisks = useCallback(async () => {
    try {
      setRisks(await fetchRisks(project.id));
    } catch (error: any) {
      console.error('Risks fetch error:', error);
      toast.error(`Failed to load risks: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void reloadRisks();
    const unsubRisks = subscribeToTable('risks', `project_id=eq.${project.id}`, () => void reloadRisks());
    // A record changes its risk's exposure, which the grid shows.
    const unsubRecords = subscribeToTable('risk_records', `project_id=eq.${project.id}`, () => void reloadRisks());
    return () => { unsubRisks(); unsubRecords(); };
  }, [reloadRisks, project.id]);

  // Records are fetched for the risk that is open, never for all of them.
  const reloadRecords = useCallback(async () => {
    if (!selectedRiskId) { setRiskRecords([]); return; }
    try {
      setRiskRecords(await fetchRiskRecords(project.id, { riskId: selectedRiskId }));
    } catch (error: any) {
      console.error('Risk records fetch error:', error);
      toast.error(`Failed to load risk records: ${error?.message || 'Unknown error'}`);
    }
  }, [project.id, selectedRiskId]);

  useEffect(() => {
    void reloadRecords();
    if (!selectedRiskId) return;
    return subscribeToTable('risk_records', `risk_id=eq.${selectedRiskId}`, () => void reloadRecords());
  }, [reloadRecords, selectedRiskId]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const rows = await fetchCostCodes(project.id);
        if (active) setCostCodes(rows);
      } catch (error) {
        console.error('RiskManagement: cost codes fetch error:', error);
      }
    };
    void load();
    const unsubscribe = subscribeToTable('cost_codes', `project_id=eq.${project.id}`, () => void load());
    return () => { active = false; unsubscribe(); };
  }, [project.id]);

  const handleCreateRisk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRisk.riskId.trim()) { toast.error("Risk ID is required"); return; }
    if (newRisk.riskId.length > 20) { toast.error("Risk ID must be max 20 characters"); return; }
    if (risks.some(r => r.riskId.toLowerCase() === newRisk.riskId.toLowerCase())) { toast.error("Risk ID must be unique"); return; }

    try {
      const riskData = {
        projectId: project.id,
        riskId: newRisk.riskId.trim(),
        description: newRisk.description,
        type: newRisk.type || (enterprise.riskTypes?.[0] || ''),
        status: newRisk.status,
        strategy: newRisk.strategy,
        initiator: newRisk.initiator.slice(0, 50),
        reference: newRisk.reference.slice(0, 50),
        // The four impact totals are derived from the risk's records by
        // trigger, so a new risk does not carry zeroes in.
        mitigation: 0,
        residualExposure: 0,
        periodId: newRisk.periodId || undefined,
      };
      await createRisk(project.id, riskData as any);
      await reloadRisks();
      toast.success("Risk created successfully");
      setIsCreateRiskOpen(false);
      setNewRisk({ riskId: '', description: '', type: '', status: 'Open', strategy: 'Mitigate', initiator: '', reference: '', periodId: '' });
    } catch (error: any) {
      console.error('Failed to create risk', error);
      toast.error(`Failed to create risk: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleDeleteRisk = async () => {
    if (!riskToDelete) return;
    try {
      // The records cascade with the risk.
      await deleteRisks([riskToDelete.id]);
      await reloadRisks();
      toast.success("Risk and records deleted");
      setIsDeleteRiskOpen(false);
      if (selectedRiskId === riskToDelete.id) setSelectedRiskId(null);
      setRiskToDelete(null);
    } catch (error: any) {
      console.error('Failed to delete risk', error);
      toast.error(`Failed to delete risk: ${error?.message || 'Unknown error'}`);
    }
  };

  // A risk's exposure and its three impact totals are re-derived from its
  // records by a database trigger, so there is nothing to recompute here. This
  // used to read every record of the risk back after each edit, sum them in
  // the browser and write the totals onto the risk -- which could leave a risk
  // showing an exposure that did not match its own records if it failed in
  // between. Kept as a refresh so callers still show the new totals.
  const updateParentTotals = async (_riskId?: string) => {
    await reloadRisks();
  };

  const riskColumnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    const defs: (ColDef | ColGroupDef)[] = [
      {
        headerName: '', headerCheckboxSelection: true, checkboxSelection: true, headerCheckboxSelectionFilteredOnly: true, width: 50, pinned: 'left',
      },
      {
        headerName: 'Risk ID', field: 'riskId', pinned: 'left', width: 150, sort: 'asc',
        cellRenderer: (params: any) => {
          if (params.node.rowPinned) return <span className="font-bold">{params.value}</span>;
          return (
            <button onClick={() => setSelectedRiskId(params.data.id)} className="text-blue-600 hover:text-blue-800 hover:underline font-bold text-left capitalize truncate">
              {params.value}
            </button>
          );
        }
      },
      { headerName: 'Period', field: 'periodId', editable: true, width: 120, cellEditor: 'agSelectCellEditor', cellEditorParams: { values: project.reportingPeriods?.periods.map(p => p.id) || [] }, valueFormatter: (p: any) => project.reportingPeriods?.periods.find(per => per.id === p.value)?.name || p.value },
      { headerName: 'Description', field: 'description', editable: true, width: 250 },
      { headerName: 'Type', field: 'type', editable: true, width: 150, cellEditor: 'agSelectCellEditor', cellEditorParams: { values: enterprise.riskTypes || [] } },
      {
        headerName: 'Status', field: 'status', editable: true, width: 130,
        cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['Open', 'Mitigated', 'Closed', 'Realized'] },
        cellClassRules: {
          'text-amber-600 font-bold': (p: any) => p.value === 'Open',
          'text-blue-600 font-bold': (p: any) => p.value === 'Mitigated',
          'text-gray-500 font-bold': (p: any) => p.value === 'Closed',
          'text-red-600 font-bold': (p: any) => p.value === 'Realized',
        }
      },
      {
        headerName: 'Strategy', field: 'strategy', editable: true, width: 130,
        cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['Avoid', 'Mitigate', 'Transfer', 'Accept'] }
      },
      { headerName: 'Min Value $', field: 'minImpactTotal', width: 130, valueFormatter: (p) => formatCurrency(p.value), type: 'numericColumn' },
      { headerName: 'Most Likely $', field: 'mostLikelyImpactTotal', width: 130, valueFormatter: (p) => formatCurrency(p.value), type: 'numericColumn' },
      { headerName: 'Max Value $', field: 'maxImpactTotal', width: 130, valueFormatter: (p) => formatCurrency(p.value), type: 'numericColumn' },
      { headerName: 'Beta Pert Exposure', field: 'exposure', width: 160, valueFormatter: (p) => formatCurrency(p.value), type: 'numericColumn', cellStyle: { fontWeight: 'bold', color: '#dc2626' } },
      {
        headerName: 'Actions', width: 80, pinned: 'right',
        cellRenderer: (p: any) => p.node.rowPinned ? null : (
          <button onClick={() => { setRiskToDelete(p.data); setIsDeleteRiskOpen(true); }} className="p-1.5 text-gray-400 hover:text-red-600">
            <Trash2 className="w-4 h-4" />
          </button>
        )
      }
    ];

    // Enterprise Risk Attributes
    const enterpriseRiskAttrs = (enterprise.riskAttributes || []).filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0);
    if (enterpriseRiskAttrs.length > 0) {
      defs.splice(defs.length - 1, 0, {
        headerName: 'Enterprise Risk Attributes',
        openByDefault: true,
        children: enterpriseRiskAttrs.map(attr => ({
          headerName: attr.title,
          field: `enterpriseAttributes.${attr.id}`,
          width: 200,
          editable: true,
          cellEditor: 'agRichSelectCellEditor',
          cellEditorParams: {
            values: (attr.values || [])
              .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
              .map(v => `${v.id} | ${v.description}`),
            searchType: 'matchAny',
            allowTyping: true,
            filterList: true
          }
        }))
      });
    }

    // Project Risk Attributes
    const projectRiskAttrs = (project.riskAttributes || []).filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0);
    if (projectRiskAttrs.length > 0) {
      defs.splice(defs.length - 1, 0, {
        headerName: 'Project Risk Attributes',
        openByDefault: true,
        children: projectRiskAttrs.map(attr => ({
          headerName: attr.title,
          field: `projectAttributes.${attr.id}`,
          width: 200,
          editable: true,
          cellEditor: 'agRichSelectCellEditor',
          cellEditorParams: {
            values: (attr.values || [])
              .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
              .map(v => `${v.id} | ${v.description}`),
            searchType: 'matchAny',
            allowTyping: true,
            filterList: true
          }
        }))
      });
    }

    return defs;
  }, [project, enterprise, risks]);

  // Handle cell value changes
  const onCellValueChanged = async (params: CellValueChangedEvent) => {
    const { data, colDef } = params;
    if (!data.id) return;
    try {
      // Attribute columns carry a dotted path, which is a Firestore idiom for
      // merging into a nested map and not a column name. applyRiskCellEdit
      // routes those to the merge function.
      await applyRiskCellEdit(data.id, colDef.field!, params.newValue);
      await reloadRisks();
    } catch (error: any) {
      console.error('Failed to update risk', error);
      toast.error(`Failed to update risk: ${error?.message || 'Unknown error'}`);
      await reloadRisks();
    }
  };

  const recordColumnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    const defs: (ColDef | ColGroupDef)[] = [
      { headerName: '', checkboxSelection: true, headerCheckboxSelection: true, headerCheckboxSelectionFilteredOnly: true, width: 50, pinned: 'left' },
      {
        headerName: 'Cost Code', field: 'costCodeId', editable: true, width: 180,
        cellEditor: 'agSelectCellEditor', 
        cellEditorParams: { 
          values: ['', ...costCodes.map(c => c.id)],
          valueListGap: 0,
          formatValue: (id: string) => {
            if (!id) return 'Select Cost Code...';
            const cc = costCodes.find(c => c.id === id);
            return cc ? `${cc.code} - ${cc.name}` : id;
          }
        },
        valueFormatter: (params) => {
          if (!params.value) return '';
          const cc = costCodes.find(c => c.id === params.value || c.code === params.value);
          return cc ? cc.code : params.value;
        },
        tooltipValueGetter: (params) => {
          const cc = costCodes.find(c => c.id === params.value || c.code === params.value);
          return cc ? `${cc.code} - ${cc.name}` : params.value;
        }
      },
      { headerName: 'Scope', field: 'scope', editable: true, width: 250 },
      {
        headerName: 'Risk Impact Analysis',
        openByDefault: true,
        children: [
          {
            headerName: 'Prob %', field: 'probability', editable: true, width: 100,
            valueFormatter: (p) => p.value === null ? '' : `${((p.value || 0) * 100).toFixed(0)}%`,
            cellEditor: 'agNumberCellEditor',
            cellEditorParams: { min: 0, max: 1 },
            valueParser: (p) => Number(p.newValue) > 1 ? Number(p.newValue) / 100 : Number(p.newValue)
          },
          {
            headerName: 'Min Value $', field: 'minImpactAmount', editable: true, width: 130, type: 'numericColumn',
            valueFormatter: (p) => formatCurrency(p.value), cellEditor: 'agNumberCellEditor'
          },
          {
            headerName: 'Most Likely $', field: 'mostLikelyImpactAmount', editable: true, width: 130, type: 'numericColumn',
            valueFormatter: (p) => formatCurrency(p.value), cellEditor: 'agNumberCellEditor'
          },
          {
            headerName: 'Maximum Value $', field: 'maxImpactAmount', editable: true, width: 130, type: 'numericColumn',
            valueFormatter: (p) => formatCurrency(p.value), cellEditor: 'agNumberCellEditor'
          },
          {
            headerName: 'Beta Pert', width: 120, type: 'numericColumn',
            field: 'betaPertImpactAmount',
            valueGetter: (p) => {
              if (p.node.rowPinned) return p.data.betaPertImpactAmount;
              const prob = Number(p.data.probability) || 0;
              const min = Number(p.data.minImpactAmount) || 0;
              const ml = Number(p.data.mostLikelyImpactAmount) || 0;
              const max = Number(p.data.maxImpactAmount) || 0;
              return ((min + 4 * ml + max) / 6) * prob;
            },
            valueFormatter: (p) => formatCurrency(p.value),
            cellStyle: { backgroundColor: 'rgba(220, 38, 38, 0.05)', fontWeight: 'bold' }
          }
        ]
      },
      {
         headerName: 'Actions', width: 80, pinned: 'right',
         cellRenderer: (p: any) => p.node.rowPinned ? null : (
           <button onClick={async () => {
             try {
               // The risk's totals follow by trigger.
               await deleteRiskRecords([p.data.id]);
               await reloadRecords();
               await reloadRisks();
             } catch (error: any) {
               console.error('Failed to delete risk record', error);
               toast.error(`Failed to delete record: ${error?.message || 'Unknown error'}`);
             }
           }} className="p-1.5 text-gray-400 hover:text-red-600">
             <Trash2 className="w-4 h-4" />
           </button>
         )
      }
    ];

    // Enterprise Line Item Attributes
    if (enterpriseLineItemAttrs.length > 0) {
      defs.splice(defs.length - 1, 0, {
        headerName: 'Enterprise Line-Item Attributes',
        openByDefault: true,
        children: enterpriseLineItemAttrs.map(attr => ({
          headerName: attr.title,
          field: `enterpriseAttributes.${attr.id}`,
          width: 200,
          editable: true,
          cellEditor: 'agRichSelectCellEditor',
          cellEditorParams: {
            values: (attr.values || [])
              .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
              .map(v => `${v.id} | ${v.description}`),
            searchType: 'matchAny',
            allowTyping: true,
            filterList: true
          }
        }))
      });
    }

    // Project Line Item Attributes
    if (projectLineItemAttrs.length > 0) {
      defs.splice(defs.length - 1, 0, {
        headerName: 'Project Line-Item Attributes',
        openByDefault: true,
        children: projectLineItemAttrs.map(attr => ({
          headerName: attr.title,
          field: `projectAttributes.${attr.id}`,
          width: 200,
          editable: true,
          cellEditor: 'agRichSelectCellEditor',
          cellEditorParams: {
            values: (attr.values || [])
              .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
              .map(v => `${v.id} | ${v.description}`),
            searchType: 'matchAny',
            allowTyping: true,
            filterList: true
          }
        }))
      });
    }

    return defs;
  }, [costCodes, enterpriseLineItemAttrs, projectLineItemAttrs]);

  const onRecordCellValueChanged = async (params: CellValueChangedEvent) => {
    const { data, colDef } = params;
    if (!data.id) return;
    const field = colDef.field!;
    try {
      let value = params.newValue;

      if (field === 'costCodeId' && value) {
        // The column shows the cost CODE but holds the row id.
        const resolved = costCodes.find(c => c.code === String(value).trim() || c.id === value);
        if (!resolved) {
          toast.error(`Unknown cost code "${value}"`);
          await reloadRecords();
          return;
        }
        value = resolved.id;
      }

      // The Beta PERT impact is a generated column and the risk's totals are
      // derived by trigger, so neither is computed or written here. This used
      // to re-derive the PERT on every edit and then re-sum the whole risk.
      await applyRiskRecordCellEdit(data.id, field, value);
      await reloadRecords();
      await reloadRisks();
    } catch (error: any) {
      console.error('Failed to update risk record', error);
      toast.error(`Failed to update record: ${error?.message || 'Unknown error'}`);
      await reloadRecords();
    }
  };

  const handleAddRecord = async () => {
    if (!selectedRiskId) return;
    if (costCodes.length === 0) {
      toast.error('Create a cost code first -- a risk record has to be against one.');
      return;
    }
    try {
      // A record REFERENCES a cost code and cannot reference nothing, so a new
      // row starts on the first cost code and is changed in the grid. It used
      // to be created with an empty cost code, which the column cannot hold.
      await upsertRiskRecords(project.id, [{
        riskId: selectedRiskId,
        costCodeId: costCodes[0].id,
        scope: '',
        probability: 1.0,
        minImpactAmount: 0,
        mostLikelyImpactAmount: 0,
        maxImpactAmount: 0,
      }]);
      await reloadRecords();
      await reloadRisks();
      toast.success("Record added (Default Prob 100%)");
    } catch (error: any) {
      console.error('Failed to add risk record', error);
      toast.error(`Failed to add record: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleBulkUpdateRecords = async () => {
    if (selectedRecordIds.size === 0 || !selectedRiskId) return;
    try {
      const updates: any = {};
      if (bulkRecordUpdateData.costCodeId && bulkRecordUpdateData.costCodeId !== '_') {
        updates.costCodeId = bulkRecordUpdateData.costCodeId;
      }
      if (bulkRecordUpdateData.scope) updates.scope = bulkRecordUpdateData.scope;
      if (bulkRecordUpdateData.probability !== '') {
        const p = Number(bulkRecordUpdateData.probability);
        updates.probability = p > 1 ? p / 100 : p;
      }
      if (bulkRecordUpdateData.minImpactAmount !== '') updates.minImpactAmount = Number(bulkRecordUpdateData.minImpactAmount);
      if (bulkRecordUpdateData.mostLikelyImpactAmount !== '') updates.mostLikelyImpactAmount = Number(bulkRecordUpdateData.mostLikelyImpactAmount);
      if (bulkRecordUpdateData.maxImpactAmount !== '') updates.maxImpactAmount = Number(bulkRecordUpdateData.maxImpactAmount);

      const ids = Array.from(selectedRecordIds);

      // The PERT figure follows from the inputs by generated column, so the
      // per-record recomputation this used to do -- reading each record to
      // fill in the values the dialog did not set -- is gone.
      const updated = await bulkUpdateRiskRecords(ids, updates);

      // Attributes merge into what is stored rather than replacing the map.
      const entAttrs: Record<string, string> = {};
      Object.entries(bulkRecordUpdateData.enterpriseAttributes).forEach(([id, val]) => {
        if (val) entAttrs[id] = val === '_' ? '' : String(val);
      });
      const prjAttrs: Record<string, string> = {};
      Object.entries(bulkRecordUpdateData.projectAttributes).forEach(([id, val]) => {
        if (val) prjAttrs[id] = val === '_' ? '' : String(val);
      });
      if (Object.keys(entAttrs).length > 0 || Object.keys(prjAttrs).length > 0) {
        // One statement, merging into what is stored now rather than into the
        // copy this browser is holding.
        await mergeRiskRecordAttributes(ids, {
          enterpriseAttributes: entAttrs,
          projectAttributes: prjAttrs,
        });
      }

      await reloadRecords();
      await reloadRisks();
      toast.success(`Updated ${updated} records`);
      setIsBulkRecordUpdateOpen(false);
      setSelectedRecordIds(new Set());
    } catch (error: any) {
      console.error('Failed to bulk update risk records', error);
      toast.error(`Failed to update records: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleBulkDeleteRecords = async () => {
    if (selectedRecordIds.size === 0 || !selectedRiskId) return;
    try {
      const count = selectedRecordIds.size;
      // One statement. The risk's totals follow by trigger.
      await deleteRiskRecords(Array.from(selectedRecordIds));
      await reloadRecords();
      await reloadRisks();
      toast.success(`Deleted ${count} records`);
      setIsBulkRecordDeleteOpen(false);
      setSelectedRecordIds(new Set());
    } catch (error: any) {
      console.error('Failed to delete risk records', error);
      toast.error(`Failed to delete records: ${error?.message || 'Unknown error'}`);
    }
  };

  const { duplicateIds, hasImportDuplicates } = useMemo(() => {
    if (!importPreview) return { duplicateIds: [], hasImportDuplicates: false };
    const idsInFile = new Set<string>();
    const fileDuplicates = new Set<string>();
    importPreview.data.forEach(row => {
      const id = importPreview.type === 'risks' 
        ? (row['Risk ID'] || row.riskId || row.ID || row.id)
        : (row['Cost Code'] || row.costCodeId);
      if (id) {
        const normalizedId = id.toString().trim().toLowerCase();
        if (idsInFile.has(normalizedId)) fileDuplicates.add(id.toString().trim());
        idsInFile.add(normalizedId);
      }
    });
    const duplicateList = Array.from(fileDuplicates);
    return { duplicateIds: duplicateList, hasImportDuplicates: duplicateList.length > 0 };
  }, [importPreview]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-gray-100 dark:border-white/10 flex justify-between items-center bg-gray-50/50 dark:bg-white/5 shrink-0">
        <div className="flex items-center gap-8">
          <div>
            <h3 className="text-xl font-bold dark:text-white">Risk Management</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">Identify and mitigate project risks.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              type="text" placeholder="Search risks..." value={quickFilterText} onChange={(e) => setQuickFilterText(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm w-64 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleImport} />
          <button onClick={() => fileInputRef.current?.click()} className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Import Risks"><Upload className="w-5 h-5" /></button>
          <button onClick={handleExport} className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Export Risks"><Download className="w-5 h-5" /></button>
          
          <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
          
          <button onClick={() => toggleAllRiskColumnGroups(true)} className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Expand All Groups"><Maximize2 className="w-4 h-4" /></button>
          <button onClick={() => toggleAllRiskColumnGroups(false)} className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Collapse All Groups"><Minimize2 className="w-4 h-4" /></button>
          
          <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />

          <button onClick={() => setIsChartsVisible(!isChartsVisible)} className={cn("p-2 rounded-lg transition-all", isChartsVisible ? "bg-black text-white dark:bg-white dark:text-black shadow-lg" : "text-gray-400 hover:text-black dark:hover:text-white")} title="Trends"><BarChart3 className="w-5 h-5" /></button>
          
          {selectedIds.size > 0 && (
            <div className="flex gap-2">
              <button onClick={() => setIsBulkRiskUpdateOpen(true)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-colors">Bulk Update ({selectedIds.size})</button>
              <button onClick={() => setIsBulkRiskDeleteOpen(true)} className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-red-600/20 hover:bg-red-700 transition-colors flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> Delete ({selectedIds.size})
              </button>
            </div>
          )}
          <button onClick={() => setIsCreateRiskOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-xl text-sm font-bold shadow-lg shadow-black/10 hover:opacity-90 transition-all"><Plus className="w-4 h-4" /> Add</button>
        </div>
      </div>

      <div className={cn("flex flex-col transition-all duration-500", selectedRiskId ? (isMainTableCollapsed ? "h-[60px]" : "h-[45%]") : "flex-1")}>
        <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-white/5 border-b border-gray-200 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-600" />
              <span className="text-xs font-bold uppercase tracking-wider dark:text-white">Active Risks</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedRiskId && (
              <button onClick={() => setIsMainTableCollapsed(!isMainTableCollapsed)} className="p-1.5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-lg transition-colors">
                {isMainTableCollapsed ? <ChevronDown className="w-4 h-4 dark:text-white" /> : <ChevronUp className="w-4 h-4 dark:text-white" />}
              </button>
            )}
          </div>
        </div>

        <AnimatePresence>
          {isChartsVisible && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 300, opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="flex gap-4 p-8 border-b border-gray-100 dark:border-white/10 shrink-0 overflow-hidden">
              <div className="flex-1">
                <h4 className="text-xs font-bold text-gray-400 uppercase mb-4 px-2">Risk Exposure Trend (Beta Pert)</h4>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'} />
                      <XAxis dataKey="name" stroke={theme === 'dark' ? '#94a3b8' : '#64748b'} fontSize={10} axisLine={false} tickLine={false} />
                      <YAxis stroke={theme === 'dark' ? '#94a3b8' : '#64748b'} fontSize={10} axisLine={false} tickLine={false} tickFormatter={(val) => `$${(val / 1000)}k`} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: theme === 'dark' ? '#1a1a1a' : '#fff', border: 'none', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                        formatter={(value: number) => [formatCurrency(value), '']}
                      />
                      <Bar dataKey="exposure" fill="#dc2626" radius={[4, 4, 0, 0]} barSize={30} />
                      <Line type="monotone" dataKey="cumulativeExposure" stroke="#dc2626" strokeWidth={2} dot={{ r: 4 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-2 gap-4 p-6 bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10 shrink-0">
          <div className="bg-white dark:bg-[#1a1a1a] p-4 rounded-xl border border-gray-200 dark:border-white/10">
            <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">Total Beta Pert Exposure</h4>
            <div className="flex items-center justify-between">
              <span className="text-xl font-bold text-red-600">{formatCurrency(risks.reduce((sum, r) => sum + (r.exposure || 0), 0))}</span>
              <AlertTriangle className="w-5 h-5 text-red-500 opacity-20" />
            </div>
          </div>
          <div className="bg-white dark:bg-[#1a1a1a] p-4 rounded-xl border border-gray-200 dark:border-white/10">
            <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">Impact Reduction Factor</h4>
            <div className="flex items-center justify-between">
              <span className="text-xl font-bold text-emerald-600">Active Monitoring</span>
              <Activity className="w-5 h-5 text-emerald-500 opacity-20" />
            </div>
          </div>
        </div>

        <div className="flex-1 relative">
          <div className={cn("absolute inset-0 ag-theme-quartz", theme === 'dark' ? "ag-theme-quartz-dark" : "")}>
            <AgGridReact
              ref={gridRef} rowData={risks} columnDefs={riskColumnDefs} quickFilterText={quickFilterText}
              onCellValueChanged={onCellValueChanged} rowSelection="multiple" animateRows={true}
              pinnedBottomRowData={riskPinnedBottomRowData}
              onSelectionChanged={(p) => setSelectedIds(new Set(p.api.getSelectedRows().map(r => r.id)))}
              defaultColDef={{ sortable: true, filter: true, resizable: true }}
            />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {selectedRiskId && (
          <motion.div initial={{ height: 0 }} animate={{ height: isMainTableCollapsed ? 'calc(100% - 60px)' : '60%' }} exit={{ height: 0 }} className="border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0a0a0a] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-white/5 border-b border-gray-200 dark:border-white/10 shrink-0">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-bold uppercase tracking-wider dark:text-white">
                    Risk Impacts: <span className="text-blue-600 ml-1">{risks.find(r => r.id === selectedRiskId)?.riskId}</span>
                  </span>
                </div>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type="text" placeholder="Search records..." value={recordsQuickFilterText} onChange={(e) => setRecordsQuickFilterText(e.target.value)}
                    className="pl-8 pr-3 py-1 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-lg text-[10px] w-48 dark:text-white outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="file" ref={recordFileInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleImportRecords} />
                <button onClick={() => recordFileInputRef.current?.click()} className="p-1.5 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Import Records"><Upload className="w-4 h-4" /></button>
                <button onClick={handleExportRecords} className="p-1.5 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Export Records"><Download className="w-4 h-4" /></button>
                
                <div className="w-px h-4 bg-gray-200 dark:bg-white/10 mx-1" />
                
                <button onClick={() => toggleAllRecordColumnGroups(true)} className="p-1.5 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Expand All"><Maximize2 className="w-3.5 h-3.5" /></button>
                <button onClick={() => toggleAllRecordColumnGroups(false)} className="p-1.5 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Collapse All"><Minimize2 className="w-3.5 h-3.5" /></button>

                <div className="w-px h-4 bg-gray-200 dark:border-white/10 mx-1" />

                {selectedRecordIds.size > 0 && (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setIsBulkRecordUpdateOpen(true)} className="px-2 py-1 bg-blue-600 text-white rounded text-[10px] font-bold shadow-lg shadow-blue-600/20 hover:bg-blue-700">Update ({selectedRecordIds.size})</button>
                    <button onClick={() => setIsBulkRecordDeleteOpen(true)} className="px-2 py-1 bg-red-600 text-white rounded text-[10px] font-bold shadow-lg shadow-red-600/20 hover:bg-red-700">Delete ({selectedRecordIds.size})</button>
                  </div>
                )}
                <button onClick={() => updateParentTotals(selectedRiskId!)} className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-800 transition-colors">
                  <RefreshCw className="w-3 h-3" />
                  Recalculate
                </button>
                <button onClick={handleAddRecord} className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white rounded-lg text-[10px] font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"><Plus className="w-3 h-3" /> Add Impact</button>
                <button onClick={() => setSelectedRiskId(null)} className="p-1.5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-lg transition-colors"><X className="w-4 h-4 dark:text-white" /></button>
              </div>
            </div>
            <div className="flex-1 relative ag-theme-quartz-dark">
              <AgGridReact 
                ref={recordsGridRef} rowData={riskRecords} columnDefs={recordColumnDefs}
                onCellValueChanged={onRecordCellValueChanged} quickFilterText={recordsQuickFilterText}
                pinnedBottomRowData={recordPinnedBottomRowData}
                rowSelection="multiple"
                onSelectionChanged={(p) => setSelectedRecordIds(new Set(p.api.getSelectedRows().map(r => r.id)))}
                defaultColDef={{ sortable: true, filter: true, resizable: true }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={isBulkRiskUpdateOpen} onOpenChange={setIsBulkRiskUpdateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bulk Update Risks</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <Select onValueChange={v => setBulkRiskUpdateData({...bulkRiskUpdateData, status: v as any})}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Open">Open</SelectItem>
                  <SelectItem value="Mitigated">Mitigated</SelectItem>
                  <SelectItem value="Closed">Closed</SelectItem>
                  <SelectItem value="Realized">Realized</SelectItem>
                </SelectContent>
              </Select>
              <Select onValueChange={v => setBulkRiskUpdateData({...bulkRiskUpdateData, strategy: v as any})}>
                <SelectTrigger><SelectValue placeholder="Strategy" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Avoid">Avoid</SelectItem>
                  <SelectItem value="Mitigate">Mitigate</SelectItem>
                  <SelectItem value="Transfer">Transfer</SelectItem>
                  <SelectItem value="Accept">Accept</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input placeholder="Type" value={bulkRiskUpdateData.type} onChange={e => setBulkRiskUpdateData({...bulkRiskUpdateData, type: e.target.value})} />
            <Input placeholder="Initiator" value={bulkRiskUpdateData.initiator} onChange={e => setBulkRiskUpdateData({...bulkRiskUpdateData, initiator: e.target.value})} />
          </div>
          <DialogFooter><Button onClick={handleBulkUpdateRisks}>Update</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkRiskDeleteOpen} onOpenChange={setIsBulkRiskDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-red-600">Bulk Delete Risks</DialogTitle></DialogHeader>
          <div className="py-4 text-sm text-gray-500">
            Are you sure you want to delete {selectedIds.size} risks and their associated records? This action cannot be undone.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkRiskDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleBulkDeleteRisks}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateRiskOpen} onOpenChange={setIsCreateRiskOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add New Risk</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Risk ID (e.g. RSK-001)" value={newRisk.riskId} onChange={e => setNewRisk({...newRisk, riskId: e.target.value})} />
            <Input placeholder="Description" value={newRisk.description} onChange={e => setNewRisk({...newRisk, description: e.target.value})} />
            <div className="grid grid-cols-2 gap-4">
              <Select onValueChange={v => setNewRisk({...newRisk, status: v as any})} defaultValue="Open">
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Open">Open</SelectItem>
                  <SelectItem value="Mitigated">Mitigated</SelectItem>
                  <SelectItem value="Closed">Closed</SelectItem>
                  <SelectItem value="Realized">Realized</SelectItem>
                </SelectContent>
              </Select>
              <Select onValueChange={v => setNewRisk({...newRisk, strategy: v as any})} defaultValue="Mitigate">
                <SelectTrigger><SelectValue placeholder="Strategy" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Avoid">Avoid</SelectItem>
                  <SelectItem value="Mitigate">Mitigate</SelectItem>
                  <SelectItem value="Transfer">Transfer</SelectItem>
                  <SelectItem value="Accept">Accept</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={handleCreateRisk}>Create</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkRecordUpdateOpen} onOpenChange={setIsBulkRecordUpdateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bulk Update Risk Records</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto pr-2">
            <Select onValueChange={v => setBulkRecordUpdateData({...bulkRecordUpdateData, costCodeId: v})} value={bulkRecordUpdateData.costCodeId}>
              <SelectTrigger>
                <SelectValue placeholder="Cost Code">
                  {bulkRecordUpdateData.costCodeId === '_' ? 'Clear Cost Code' : 
                   costCodes.find(cc => cc.id === bulkRecordUpdateData.costCodeId)?.code || 
                   (bulkRecordUpdateData.costCodeId && "Selected")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">Clear Cost Code</SelectItem>
                {costCodes.map(cc => (
                  <SelectItem key={cc.id} value={cc.id}>{cc.code} - {cc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Scope" value={bulkRecordUpdateData.scope} onChange={e => setBulkRecordUpdateData({...bulkRecordUpdateData, scope: e.target.value})} />
            <Input type="number" placeholder="Prob % (0-100)" value={bulkRecordUpdateData.probability} onChange={e => setBulkRecordUpdateData({...bulkRecordUpdateData, probability: e.target.value})} />
            <div className="grid grid-cols-3 gap-4">
              <Input type="number" placeholder="Min Value $" value={bulkRecordUpdateData.minImpactAmount} onChange={e => setBulkRecordUpdateData({...bulkRecordUpdateData, minImpactAmount: e.target.value})} />
              <Input type="number" placeholder="Most Likely $" value={bulkRecordUpdateData.mostLikelyImpactAmount} onChange={e => setBulkRecordUpdateData({...bulkRecordUpdateData, mostLikelyImpactAmount: e.target.value})} />
              <Input type="number" placeholder="Max Value $" value={bulkRecordUpdateData.maxImpactAmount} onChange={e => setBulkRecordUpdateData({...bulkRecordUpdateData, maxImpactAmount: e.target.value})} />
            </div>

            {enterpriseLineItemAttrs.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-white/5">
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Enterprise Line-Item Attributes</h4>
                <div className="grid grid-cols-1 gap-3">
                  {enterpriseLineItemAttrs.map(attr => (
                    <div key={attr.id} className="space-y-1">
                      <label className="text-[10px] font-medium text-gray-500 pl-1">{attr.title}</label>
                      <Select 
                        onValueChange={v => setBulkRecordUpdateData({
                          ...bulkRecordUpdateData, 
                          enterpriseAttributes: { ...bulkRecordUpdateData.enterpriseAttributes, [attr.id]: v }
                        })} 
                        value={bulkRecordUpdateData.enterpriseAttributes[attr.id] || ''}
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder={`Select ${attr.title}...`} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_">Clear Value</SelectItem>
                          {attr.values.map(v => (
                            <SelectItem key={v.id} value={`${v.id} | ${v.description}`}>{v.id} | {v.description}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {projectLineItemAttrs.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-white/5">
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Project Line-Item Attributes</h4>
                <div className="grid grid-cols-1 gap-3">
                  {projectLineItemAttrs.map(attr => (
                    <div key={attr.id} className="space-y-1">
                      <label className="text-[10px] font-medium text-gray-500 pl-1">{attr.title}</label>
                      <Select 
                        onValueChange={v => setBulkRecordUpdateData({
                          ...bulkRecordUpdateData, 
                          projectAttributes: { ...bulkRecordUpdateData.projectAttributes, [attr.id]: v }
                        })} 
                        value={bulkRecordUpdateData.projectAttributes[attr.id] || ''}
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder={`Select ${attr.title}...`} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_">Clear Value</SelectItem>
                          {attr.values.map(v => (
                            <SelectItem key={v.id} value={`${v.id} | ${v.description}`}>{v.id} | {v.description}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter><Button onClick={handleBulkUpdateRecords}>Update</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkRecordDeleteOpen} onOpenChange={setIsBulkRecordDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-red-600">Bulk Delete Risk Records</DialogTitle></DialogHeader>
          <div className="py-4">
            <p>Are you sure you want to delete {selectedRecordIds.size} risk records? This action cannot be undone.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkRecordDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleBulkDeleteRecords}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AnimatePresence>
        {importPreview && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[110] p-4 font-sans">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-4xl shadow-2xl border border-gray-200 dark:border-white/10 flex flex-col max-h-[90vh]"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-2xl font-bold dark:text-white">Review {importPreview.type === 'risks' ? 'Risks' : 'Records'} Import</h2>
                  <p className="text-gray-900 dark:text-gray-400 text-sm mt-1">
                    Review the data from your file below. {importPreview.type === 'risks' ? 'Existing Risk IDs will be updated.' : 'New records will be added to the selected risk.'}
                  </p>
                </div>
                <button onClick={() => setImportPreview(null)} className="p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              {hasImportDuplicates && (
                <div className="mb-4 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl flex flex-col gap-2">
                  <div className="flex items-center gap-3 text-red-600 dark:text-red-400 text-[10px] font-black uppercase tracking-[0.15em]">
                    <AlertTriangle className="w-4 h-4" />
                    Duplicate ID found in file
                  </div>
                  <div className="text-sm text-red-600 dark:text-red-400 font-medium leading-relaxed">
                    The following IDs appear multiple times in your excel: <span className="font-bold underline">{duplicateIds.join(', ')}</span>. Please resolve duplicates before importing.
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-auto border border-gray-100 dark:border-white/10 rounded-2xl mb-6 shadow-inner bg-gray-50/50 dark:bg-black/20">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-white dark:bg-[#1a1a1a] sticky top-0 border-b border-gray-200 dark:border-white/10 shadow-sm z-10">
                    <tr>
                      {Object.keys(importPreview.data[0] || {}).map(key => (
                        <th key={key} className="px-4 py-3 font-bold text-gray-900 dark:text-white uppercase tracking-widest text-[10px] bg-white dark:bg-[#1a1a1a]">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                    {importPreview.data.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-100/50 dark:hover:bg-white/5 transition-colors">
                        {Object.values(row).map((val: any, j) => (
                          <td key={j} className="px-4 py-3 text-gray-900 dark:text-gray-300 font-medium whitespace-nowrap">{val?.toString()}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => setImportPreview(null)}
                  className="flex-1 py-4 border border-gray-200 dark:border-white/10 rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-white/5 transition-colors dark:text-white"
                >
                  Cancel
                </button>
                <button 
                  onClick={completeImport}
                  disabled={hasImportDuplicates}
                  className="flex-1 py-4 bg-black dark:bg-white text-white dark:text-black rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-black/90 dark:hover:bg-white/90 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  Complete Import ({importPreview.data.length} records)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
