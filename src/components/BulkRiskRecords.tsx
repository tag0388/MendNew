import { subscribeToTable } from '../lib/supabase';
import { fetchCostCodes } from '../lib/costCodes';
import {
  fetchRisks, fetchRiskRecords, upsertRiskRecords, deleteRiskRecords,
  bulkUpdateRiskRecords, applyRiskRecordCellEdit, mergeRiskRecordAttributes,
} from '../lib/risks';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Project, Enterprise, Risk, RiskRecord, CostCode } from '../types';
import { 
  Search, 
  Trash2, 
  Download, 
  Upload,
  Filter, 
  RefreshCw,
  X,
  PlusCircle,
  Database,
  Save,
  Columns,
  RotateCcw,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { AgGridReact } from 'ag-grid-react';
import { 
  ColDef, 
  ColGroupDef,
  GridApi, 
  GridReadyEvent, 
  CellValueChangedEvent,
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


interface BulkRiskRecordsProps {
  project: Project;
  enterprise: Enterprise;
}

export default function BulkRiskRecords({ project, enterprise }: BulkRiskRecordsProps) {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [allRiskRecords, setAllRiskRecords] = useState<RiskRecord[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [bulkRecordsQuickFilterText, setBulkRecordsQuickFilterText] = useState('');
  const [selectedBulkRecordIds, setSelectedBulkRecordIds] = useState<Set<string>>(new Set());
  const [isBulkRecordUpdateOpen, setIsBulkRecordUpdateOpen] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
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

  const bulkRecordsGridRef = useRef<AgGridReact>(null);
  const recordFileInputRef = useRef<HTMLInputElement>(null);

  const pinnedBottomRowData = useMemo(() => {
    if (allRiskRecords.length === 0) return [];
    return [{
      riskId: 'TOTALS',
      minImpactAmount: allRiskRecords.reduce((sum, r) => sum + (r.minImpactAmount || 0), 0),
      mostLikelyImpactAmount: allRiskRecords.reduce((sum, r) => sum + (r.mostLikelyImpactAmount || 0), 0),
      maxImpactAmount: allRiskRecords.reduce((sum, r) => sum + (r.maxImpactAmount || 0), 0),
      betaPertImpactAmount: allRiskRecords.reduce((sum, r) => sum + (r.betaPertImpactAmount || 0), 0),
    }];
  }, [allRiskRecords]);

  const sideBar: SideBarDef = {
    toolPanels: [
      { id: 'columns', labelDefault: 'Columns', labelKey: 'columns', iconKey: 'columns', toolPanel: 'agColumnsToolPanel' },
      { id: 'filters', labelDefault: 'Filters', labelKey: 'filters', iconKey: 'filter', toolPanel: 'agFiltersToolPanel' }
    ],
    defaultToolPanel: ''
  };

  const statusBar: { statusPanels: StatusPanelDef[] } = {
    statusPanels: [
      { statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'left' },
      { statusPanel: 'agAggregationComponent', align: 'right' }
    ]
  };

  const enterpriseLineItemAttrs = useMemo(() => 
    (enterprise.lineItemAttributes || []).filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0),
    [enterprise.lineItemAttributes]
  );

  const projectLineItemAttrs = useMemo(() => 
    (project.lineItemAttributes || []).filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0),
    [project.lineItemAttributes]
  );

  const reload = useCallback(async () => {
    try {
      const [riskRows, recordRows] = await Promise.all([
        fetchRisks(project.id),
        fetchRiskRecords(project.id),
      ]);
      setRisks(riskRows);
      setAllRiskRecords(recordRows);
    } catch (error: any) {
      console.error('Bulk risk records fetch error:', error);
      toast.error(`Failed to load risk records: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void reload();

    const loadCostCodes = async () => {
      try {
        setCostCodes(await fetchCostCodes(project.id));
      } catch (error) {
        console.error('BulkRiskRecords: cost codes fetch error:', error);
      }
    };
    void loadCostCodes();

    const unsubRisks = subscribeToTable('risks', `project_id=eq.${project.id}`, () => void reload());
    const unsubRecords = subscribeToTable('risk_records', `project_id=eq.${project.id}`, () => void reload());
    const unsubCost = subscribeToTable('cost_codes', `project_id=eq.${project.id}`, () => void loadCostCodes());
    return () => { unsubRisks(); unsubRecords(); unsubCost(); };
  }, [reload, project.id]);

  // A risk's exposure and impact totals are re-derived from its records by a
  // database trigger. This used to read every record of the risk back, sum
  // them in the browser and write the totals onto the risk.
  const updateParentTotals = async (_riskId?: string) => {
    await reload();
  };

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
          await reload();
          return;
        }
        value = resolved.id;
      }

      // The Beta PERT impact is a generated column and the risk's totals are
      // derived by trigger, so neither is computed here.
      await applyRiskRecordCellEdit(data.id, field, value);
      await reload();
    } catch (error: any) {
      console.error('Failed to update risk record', error);
      toast.error(`Failed to update record: ${error?.message || 'Unknown error'}`);
      await reload();
    }
  };

  const handleExportRecords = () => {
    const exportData = allRiskRecords.map(r => {
      const parentRisk = risks.find(c => c.id === r.riskId);
      return {
        'Risk ID': parentRisk?.riskId || 'Unknown',
        'Cost Code': costCodes.find(c => c.id === r.costCodeId)?.code || '',
        'Scope': r.scope,
        'Prob %': (Number(r.probability) || 0) * 100,
        'Min Value $': r.minImpactAmount || 0,
        'Most Likely $': r.mostLikelyImpactAmount || 0,
        'Max Value $': r.maxImpactAmount || 0,
        'Beta Pert $': r.betaPertImpactAmount || 0,
        'Parent Strategy': parentRisk?.strategy || '-',
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Risk Records");
    XLSX.writeFile(wb, `${project.projectName}_Bulk_Risk_Records.xlsx`);
  };

  const toggleAllRecordColumnGroups = (opened: boolean) => {
    if (!bulkRecordsGridRef.current) return;
    const api = bulkRecordsGridRef.current.api;
    const groups = api.getColumnGroupState();
    const newState = groups.map(g => ({
      groupId: g.groupId,
      open: opened
    }));
    api.setColumnGroupState(newState);
  };

  const handleImportRecords = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' });
        const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];

        const riskMap = new Map(risks.map(r => [r.riskId.toLowerCase(), r.id]));
        const unknownRisks = new Set<string>();
        const unknownCodes = new Set<string>();
        const rows: any[] = [];

        for (const row of data) {
          const riskRef = String(row['Risk ID'] || '').trim();
          const riskId = riskMap.get(riskRef.toLowerCase());
          if (!riskId) { if (riskRef) unknownRisks.add(riskRef); continue; }

          // The sheet names a cost code; the column is a foreign key.
          const codeText = String(row['Cost Code'] || '').trim();
          const resolved = costCodes.find(c => c.code === codeText || c.id === codeText);
          if (!resolved) { unknownCodes.add(codeText || '(blank)'); continue; }

          rows.push({
            riskId,
            costCodeId: resolved.id,
            scope: String(row['Scope'] || '').slice(0, 100),
            // The Beta PERT impact is generated by the database from these.
            probability: (Number(row['Prob %']) || 100) / 100,
            minImpactAmount: Number(row['Min Value $']) || 0,
            mostLikelyImpactAmount: Number(row['Most Likely $']) || 0,
            maxImpactAmount: Number(row['Max Value $']) || 0,
          });
        }

        if (rows.length === 0) {
          const problems = [
            unknownRisks.size > 0 ? `unknown risks: ${Array.from(unknownRisks).join(', ')}` : '',
            unknownCodes.size > 0 ? `unknown cost codes: ${Array.from(unknownCodes).join(', ')}` : '',
          ].filter(Boolean).join('; ');
          toast.error(problems ? `No records imported (${problems})` : 'No rows in the sheet could be imported.');
          return;
        }

        // One statement, whatever the size of the sheet. The affected risks'
        // totals follow by trigger, so there is no per-risk recount loop.
        const imported = await upsertRiskRecords(project.id, rows);
        await reload();
        const skipped = [
          unknownRisks.size > 0 ? `unknown risks: ${Array.from(unknownRisks).join(', ')}` : '',
          unknownCodes.size > 0 ? `unknown cost codes: ${Array.from(unknownCodes).join(', ')}` : '',
        ].filter(Boolean).join('; ');
        toast.success(skipped ? `Imported ${imported} records. Skipped ${skipped}` : `Imported ${imported} records`);
      } catch (error: any) {
        console.error('Risk record import failed', error);
        toast.error(`Import failed: ${error?.message || 'Unknown error'}`);
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const bulkRecordColumnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    const defs: (ColDef | ColGroupDef)[] = [
    { headerName: '', width: 50, pinned: 'left', checkboxSelection: true, headerCheckboxSelection: true, headerCheckboxSelectionFilteredOnly: true },
    {
      headerName: 'Risk ID', field: 'riskId', pinned: 'left', width: 130, sort: 'asc',
      valueFormatter: (p) => {
        if (p.node?.rowPinned) return p.value;
        const r = risks.find(r => r.id === p.value);
        return r ? r.riskId : p.value;
      },
      cellRenderer: (p: any) => p.node?.rowPinned 
        ? <span className="font-bold text-gray-500">{p.value}</span> 
        : <span className="font-bold text-blue-600 dark:text-blue-400">{p.valueFormatted}</span>
    },
    {
      headerName: 'Parent Strategy', width: 130,
      valueGetter: (p) => risks.find(r => r.id === p.data.riskId)?.strategy || '-'
    },
    {
      headerName: 'Cost Code', field: 'costCodeId', width: 180, editable: true,
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
    { headerName: 'Scope', field: 'scope', width: 200, editable: true },
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
            if (p.node?.rowPinned) return p.data.betaPertImpactAmount;
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
    }
  ];

  // Enterprise Line Item Attributes
  if (enterpriseLineItemAttrs.length > 0) {
    defs.push({
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
    defs.push({
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
}, [risks, costCodes, enterpriseLineItemAttrs, projectLineItemAttrs]);

  const handleBulkUpdateRecords = async () => {
    if (selectedBulkRecordIds.size === 0) return;
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

      const ids = Array.from(selectedBulkRecordIds);

      // The PERT figure follows from the inputs by generated column, so the
      // per-record recomputation this used to do -- reading each record to
      // fill in the values the dialog did not set -- is gone, and so is the
      // per-risk recount afterwards.
      const updated = await bulkUpdateRiskRecords(ids, updates);

      const entAttrs: Record<string, string> = {};
      Object.entries(bulkRecordUpdateData.enterpriseAttributes).forEach(([id, val]) => {
        if (val) entAttrs[id] = val === '_' ? '' : String(val);
      });
      const prjAttrs: Record<string, string> = {};
      Object.entries(bulkRecordUpdateData.projectAttributes).forEach(([id, val]) => {
        if (val) prjAttrs[id] = val === '_' ? '' : String(val);
      });
      if (Object.keys(entAttrs).length > 0 || Object.keys(prjAttrs).length > 0) {
        // Merged into what is stored, not into this browser's copy.
        await mergeRiskRecordAttributes(ids, {
          enterpriseAttributes: entAttrs,
          projectAttributes: prjAttrs,
        });
      }

      await reload();
      toast.success(`Updated ${updated} records`);
      setIsBulkRecordUpdateOpen(false);
      setSelectedBulkRecordIds(new Set());
    } catch (error: any) {
      console.error('Failed to bulk update risk records', error);
      toast.error(`Failed to update records: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleBulkDeleteRecords = async () => {
    if (selectedBulkRecordIds.size === 0) return;
    try {
      const count = selectedBulkRecordIds.size;
      // One statement; the affected risks' totals follow by trigger.
      await deleteRiskRecords(Array.from(selectedBulkRecordIds));
      await reload();
      toast.success(`Deleted ${count} records`);
      setSelectedBulkRecordIds(new Set());
      setIsBulkDeleteOpen(false);
    } catch (error: any) {
      console.error('Failed to delete risk records', error);
      toast.error(`Failed to delete records: ${error?.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-gray-100 dark:border-white/10 flex justify-between items-center bg-gray-50/50 dark:bg-white/5 shrink-0">
        <div className="flex items-center gap-8">
          <div>
            <h3 className="text-xl font-bold dark:text-white">Bulk Risk Records</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">Manage all risk cost impacts across the project.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              type="text" placeholder="Search records..." value={bulkRecordsQuickFilterText} onChange={(e) => setBulkRecordsQuickFilterText(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm w-64 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <input type="file" ref={recordFileInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleImportRecords} />
          <button onClick={() => recordFileInputRef.current?.click()} className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Import Records"><Upload className="w-5 h-5" /></button>
          <button onClick={handleExportRecords} className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Export Records"><Download className="w-5 h-5" /></button>
          
          <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
          
          <button onClick={() => toggleAllRecordColumnGroups(true)} className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Expand All Groups"><Maximize2 className="w-4 h-4" /></button>
          <button onClick={() => toggleAllRecordColumnGroups(false)} className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" title="Collapse All Groups"><Minimize2 className="w-4 h-4" /></button>
          
          <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
          
          <button onClick={async () => {
            const affected = new Set(allRiskRecords.map(r => r.riskId));
            let count = 0;
            for (const rid of affected) {
              await updateParentTotals(rid);
              count++;
            }
            toast.success(`Recalculated totals for ${count} risks`);
          }} className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors" title="Recalculate All Totals">
            <RefreshCw className="w-5 h-5" />
          </button>

          {selectedBulkRecordIds.size > 0 && (
            <div className="flex gap-2">
              <button onClick={() => setIsBulkRecordUpdateOpen(true)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-colors">Bulk Update ({selectedBulkRecordIds.size})</button>
              <button 
                onClick={() => setIsBulkDeleteOpen(true)} 
                className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-red-600/20 hover:bg-red-700 transition-colors flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> Delete ({selectedBulkRecordIds.size})
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 bg-white dark:bg-[#141414] border-t border-gray-200 dark:border-white/10 overflow-hidden">
        <div className="ag-theme-quartz-dark h-full w-full">
          <AgGridReact
            ref={bulkRecordsGridRef} rowData={allRiskRecords} columnDefs={bulkRecordColumnDefs}
            rowSelection="multiple" animateRows={true} quickFilterText={bulkRecordsQuickFilterText}
            pinnedBottomRowData={pinnedBottomRowData} statusBar={statusBar}
            onSelectionChanged={(p) => setSelectedBulkRecordIds(new Set(p.api.getSelectedRows().map(r => r.id)))}
            onCellValueChanged={onRecordCellValueChanged}
            defaultColDef={{ sortable: true, filter: true, resizable: true }}
          />
        </div>
      </div>

      <Dialog open={isBulkRecordUpdateOpen} onOpenChange={setIsBulkRecordUpdateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bulk Update Risks</DialogTitle></DialogHeader>
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

      <Dialog open={isBulkDeleteOpen} onOpenChange={setIsBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-red-600">Bulk Delete Risk Records</DialogTitle></DialogHeader>
          <div className="py-4">
            <p>Are you sure you want to delete {selectedBulkRecordIds.size} risk records? This action cannot be undone.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleBulkDeleteRecords}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
