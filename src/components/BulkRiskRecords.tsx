import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Project, Enterprise, Risk, RiskRecord, CostCode } from '../types';
import { db, auth } from '../firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  getDocs,
  writeBatch,
  doc,
  updateDoc,
  addDoc,
  deleteDoc
} from 'firebase/firestore';
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
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  toast.error(`Database Error: ${errInfo.error}`);
  throw new Error(JSON.stringify(errInfo));
}

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

  useEffect(() => {
    const qr = query(collection(db, 'risks'), where('projectId', '==', project.id));
    const unsubR = onSnapshot(qr, (snapshot) => {
      setRisks(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Risk)));
    });
    const qrr = query(collection(db, 'riskRecords'), where('projectId', '==', project.id));
    const unsubRr = onSnapshot(qrr, (snapshot) => {
      setAllRiskRecords(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as RiskRecord)));
      setIsLoading(false);
    });
    const qcc = query(collection(db, 'costCodes'), where('projectId', '==', project.id));
    const unsubCc = onSnapshot(qcc, (snapshot) => {
      setCostCodes(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as CostCode)).sort((a,b) => a.sortOrder - b.sortOrder));
    });
    return () => { unsubR(); unsubRr(); unsubCc(); };
  }, [project.id]);

  const updateParentTotals = async (riskId: string) => {
    try {
      const recordsSnap = await getDocs(query(collection(db, 'riskRecords'), where('riskId', '==', riskId)));
      const records = recordsSnap.docs.map(d => d.data() as RiskRecord);
      const totalBetaPert = records.reduce((sum, r) => sum + (Number(r.betaPertImpactAmount) || 0), 0);
      const totalMin = records.reduce((sum, r) => sum + (Number(r.minImpactAmount) || 0), 0);
      const totalLikely = records.reduce((sum, r) => sum + (Number(r.mostLikelyImpactAmount) || 0), 0);
      const totalMax = records.reduce((sum, r) => sum + (Number(r.maxImpactAmount) || 0), 0);
      
      await updateDoc(doc(db, 'risks', riskId), {
        exposure: totalBetaPert,
        minImpactTotal: totalMin,
        mostLikelyImpactTotal: totalLikely,
        maxImpactTotal: totalMax,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error(error);
    }
  };

  const onRecordCellValueChanged = async (params: CellValueChangedEvent) => {
    const { data, colDef } = params;
    if (!data.id) return;
    try {
      let updates: any = { [colDef.field!]: params.newValue, updatedAt: new Date().toISOString() };
      
      // If any PERT input changes, update betaPertImpactAmount
      if (['probability', 'minImpactAmount', 'mostLikelyImpactAmount', 'maxImpactAmount'].includes(colDef.field!)) {
        const prob = Number(colDef.field === 'probability' ? params.newValue : data.probability) || 0;
        const min = Number(colDef.field === 'minImpactAmount' ? params.newValue : data.minImpactAmount) || 0;
        const ml = Number(colDef.field === 'mostLikelyImpactAmount' ? params.newValue : data.mostLikelyImpactAmount) || 0;
        const max = Number(colDef.field === 'maxImpactAmount' ? params.newValue : data.maxImpactAmount) || 0;
        const betaPert = ((min + 4 * ml + max) / 6) * prob;
        updates.betaPertImpactAmount = betaPert;
      }
      
      await updateDoc(doc(db, 'riskRecords', data.id), updates);
      if (['probability', 'minImpactAmount', 'mostLikelyImpactAmount', 'maxImpactAmount'].includes(colDef.field!)) {
        updateParentTotals(data.riskId);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `riskRecords/${data.id}`);
    }
  };

  const handleExportRecords = () => {
    const exportData = allRiskRecords.map(r => {
      const parentRisk = risks.find(c => c.id === r.riskId);
      return {
        'Risk ID': parentRisk?.riskId || 'Unknown',
        'Cost Code': r.costCodeId,
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
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];
        const batch = writeBatch(db);
        let addedCount = 0;
        const riskMap = new Map(risks.map(r => [r.riskId.toLowerCase(), r.id]));
        for (const row of data) {
          const riskIdStr = String(row['Risk ID'] || '').trim().toLowerCase();
          const riskId = riskMap.get(riskIdStr);
          if (!riskId) continue;
          const newRecordRef = doc(collection(db, 'riskRecords'));
          const min = Number(row['Min Value $']) || 0;
          const ml = Number(row['Most Likely $']) || 0;
          const max = Number(row['Max Value $']) || 0;
          const prob = (Number(row['Prob %']) || 100) / 100;
          const betaPert = ((min + 4 * ml + max) / 6) * prob;

          batch.set(newRecordRef, {
            riskId: riskId,
            projectId: project.id,
            costCodeId: String(row['Cost Code'] || '').trim(),
            scope: String(row['Scope'] || ''),
            probability: prob,
            minImpactAmount: min,
            mostLikelyImpactAmount: ml,
            maxImpactAmount: max,
            betaPertImpactAmount: betaPert,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          addedCount++;
        }
        if (addedCount > 0) {
          await batch.commit();
          // Update all parent totals
          const affectedRisks = new Set(data.map(row => riskMap.get(String(row['Risk ID'] || '').trim().toLowerCase())).filter(id => id));
          for (const rid of affectedRisks) {
            if (rid) await updateParentTotals(rid);
          }
          toast.success(`Imported ${addedCount} records`);
        }
      } catch (error) { toast.error("Import failed"); }
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
      const batch = writeBatch(db);
      const updates: any = { updatedAt: new Date().toISOString() };
      if (bulkRecordUpdateData.costCodeId) {
        updates.costCodeId = bulkRecordUpdateData.costCodeId === '_' ? '' : bulkRecordUpdateData.costCodeId;
      }
      if (bulkRecordUpdateData.scope) updates.scope = bulkRecordUpdateData.scope;
      if (bulkRecordUpdateData.probability) updates.probability = Number(bulkRecordUpdateData.probability) > 1 ? Number(bulkRecordUpdateData.probability) / 100 : Number(bulkRecordUpdateData.probability);
      
      const hasMinChange = bulkRecordUpdateData.minImpactAmount !== '';
      const hasMLChange = bulkRecordUpdateData.mostLikelyImpactAmount !== '';
      const hasMaxChange = bulkRecordUpdateData.maxImpactAmount !== '';

      if (hasMinChange) updates.minImpactAmount = Number(bulkRecordUpdateData.minImpactAmount);
      if (hasMLChange) updates.mostLikelyImpactAmount = Number(bulkRecordUpdateData.mostLikelyImpactAmount);
      if (hasMaxChange) updates.maxImpactAmount = Number(bulkRecordUpdateData.maxImpactAmount);

      // Add Attributes to updates
      Object.entries(bulkRecordUpdateData.enterpriseAttributes).forEach(([id, val]) => {
        if (val) updates[`enterpriseAttributes.${id}`] = val === '_' ? '' : val;
      });
      Object.entries(bulkRecordUpdateData.projectAttributes).forEach(([id, val]) => {
        if (val) updates[`projectAttributes.${id}`] = val === '_' ? '' : val;
      });

      selectedBulkRecordIds.forEach(id => {
        const record = allRiskRecords.find(x => x.id === id);
        if (record) {
          const finalUpdates = { ...updates };
          const hasProbChange = bulkRecordUpdateData.probability !== '';
          if (hasMinChange || hasMLChange || hasMaxChange || hasProbChange) {
            const prob = hasProbChange ? (Number(bulkRecordUpdateData.probability) > 1 ? Number(bulkRecordUpdateData.probability) / 100 : Number(bulkRecordUpdateData.probability)) : (record.probability || 0);
            const min = hasMinChange ? Number(bulkRecordUpdateData.minImpactAmount) : (record.minImpactAmount || 0);
            const ml = hasMLChange ? Number(bulkRecordUpdateData.mostLikelyImpactAmount) : (record.mostLikelyImpactAmount || 0);
            const max = hasMaxChange ? Number(bulkRecordUpdateData.maxImpactAmount) : (record.maxImpactAmount || 0);
            finalUpdates.betaPertImpactAmount = ((min + 4 * ml + max) / 6) * prob;
          }
          batch.update(doc(db, 'riskRecords', id), finalUpdates);
        }
      });
      await batch.commit();

      const affected = new Set<string>();
      selectedBulkRecordIds.forEach(id => {
        const r = allRiskRecords.find(x => x.id === id);
        if (r) affected.add(r.riskId);
      });
      for (const rid of affected) await updateParentTotals(rid);

      toast.success("Updated Successfully");
      setIsBulkRecordUpdateOpen(false);
      setSelectedBulkRecordIds(new Set());
    } catch (e) { toast.error("Update failed"); }
  };

  const handleBulkDeleteRecords = async () => {
    try {
      const batch = writeBatch(db);
      const affected = new Set<string>();
      selectedBulkRecordIds.forEach(id => {
        const r = allRiskRecords.find(x => x.id === id);
        if (r) { affected.add(r.riskId); batch.delete(doc(db, 'riskRecords', id)); }
      });
      await batch.commit();
      for (const rid of affected) await updateParentTotals(rid);
      toast.success("Deleted Successfully");
      setSelectedBulkRecordIds(new Set());
      setIsBulkDeleteOpen(false);
    } catch (e) { toast.error("Delete failed"); }
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
