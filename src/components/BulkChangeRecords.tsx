import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Project, Enterprise, Change, ChangeRecord, CostCode } from '../types';
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

interface BulkChangeRecordsProps {
  project: Project;
  enterprise: Enterprise;
}

export default function BulkChangeRecords({ project, enterprise }: BulkChangeRecordsProps) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [allChangeRecords, setAllChangeRecords] = useState<ChangeRecord[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [bulkRecordsQuickFilterText, setBulkRecordsQuickFilterText] = useState('');
  const [selectedBulkRecordIds, setSelectedBulkRecordIds] = useState<Set<string>>(new Set());
  const [isBulkRecordUpdateOpen, setIsBulkRecordUpdateOpen] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
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

  const bulkRecordsGridRef = useRef<AgGridReact>(null);
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

  const enterpriseLineItemAttrs = useMemo(() => 
    (enterprise.lineItemAttributes || []).filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0),
    [enterprise.lineItemAttributes]
  );

  const projectLineItemAttrs = useMemo(() => 
    (project.lineItemAttributes || []).filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0),
    [project.lineItemAttributes]
  );

  // Fetch Changes
  useEffect(() => {
    const q = query(collection(db, 'changes'), where('projectId', '==', project.id));
    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Change));
      setChanges(data);
    }, (error) => {
      console.error("BulkChangeRecords: changes fetch error:", error);
      toast.error("Failed to load changes: " + error.message);
    });
    return () => unsub();
  }, [project.id]);

  // Fetch All Change Records for project
  useEffect(() => {
    const q = query(collection(db, 'changeRecords'), where('projectId', '==', project.id));
    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ChangeRecord));
      setAllChangeRecords(data);
      setIsLoading(false);
    }, (error) => {
      console.error("BulkChangeRecords: change records fetch error:", error);
      toast.error("Failed to load change records: " + error.message);
      setIsLoading(false);
    });
    return () => unsub();
  }, [project.id]);

  // Fetch Cost Codes for dropdown
  useEffect(() => {
    const q = query(collection(db, 'costCodes'), where('projectId', '==', project.id));
    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as CostCode));
      setCostCodes(data.sort((a, b) => a.sortOrder - b.sortOrder));
    }, (error) => {
      console.error("BulkChangeRecords: cost codes fetch error:", error);
      toast.error("Failed to load cost codes: " + error.message);
    });
    return () => unsub();
  }, [project.id]);

  const allRecordPinnedBottomRowData = useMemo(() => {
    if (allChangeRecords.length === 0) return [];
    const totalBudget = allChangeRecords.reduce((sum, r) => sum + (Number(r.budgetAmount) || 0), 0);
    const totalEac = allChangeRecords.reduce((sum, r) => sum + (Number(r.eacAmount) || 0), 0);
    return [{
      changeId: 'Total',
      budgetAmount: totalBudget,
      eacAmount: totalEac,
      isTotalRow: true
    }];
  }, [allChangeRecords]);

  const handleExportRecords = () => {
    if (allChangeRecords.length === 0) {
      toast.error("No records to export");
      return;
    }
    const exportData = allChangeRecords.map(r => {
      const row: any = {
        'Change ID': changes.find(c => c.id === r.changeId)?.changeId || 'Unknown',
        'Cost Code': r.costCodeId,
        'Scope': r.scope,
        'Budget Amount': r.budgetAmount,
        'EAC Amount': r.eacAmount
      };
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
    XLSX.writeFile(wb, `${project.projectName}_Bulk_Change_Records_${new Date().toISOString().split('T')[0]}.xlsx`);
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

        // Validation Phase
        for (const row of data) {
          const changeIdStr = String(row['Change ID'] || '').trim();
          const foundChange = changes.find(c => c.changeId === changeIdStr);
          if (!foundChange) {
            toast.error(`Import failed: Change ID "${changeIdStr}" does not exist in the project.`);
            return;
          }

          const costCode = String(row['Cost Code'] || '').trim();
          const foundCostCode = costCodes.find(c => c.code === costCode);
          if (!foundCostCode) {
            toast.error(`Import failed: Cost Code "${costCode}" does not exist in the project.`);
            return;
          }
        }

        const batch = writeBatch(db);
        let addedCount = 0;
        const affectedChangeIds = new Set<string>();

        for (const row of data) {
          const changeIdStr = String(row['Change ID'] || '').trim();
          const foundChange = changes.find(c => c.changeId === changeIdStr)!;
          const targetChangeId = foundChange.id;
          const costCode = String(row['Cost Code'] || '').trim();

          const entAttrs: Record<string, string> = {};
          enterprise.lineItemAttributes?.forEach(a => {
            if (row[a.title]) entAttrs[a.id] = String(row[a.title]);
          });

          const prjAttrs: Record<string, string> = {};
          project.lineItemAttributes?.forEach(a => {
            if (row[a.title]) prjAttrs[a.id] = String(row[a.title]);
          });

          const newRecordRef = doc(collection(db, 'changeRecords'));
          batch.set(newRecordRef, {
            changeId: targetChangeId,
            projectId: project.id,
            costCodeId: costCode,
            scope: String(row['Scope'] || '').slice(0, 100),
            enterpriseAttributes: entAttrs,
            projectAttributes: prjAttrs,
            budgetAmount: Number(row['Budget Amount']) || 0,
            eacAmount: Number(row['EAC Amount']) || 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          addedCount++;
          affectedChangeIds.add(targetChangeId);
        }

        if (addedCount > 0) {
          await batch.commit();
          for (const cid of affectedChangeIds) {
            await updateParentTotals(cid);
          }
          toast.success(`Imported ${addedCount} records`);
        }
      } catch (error) {
        toast.error("Failed to import Excel file");
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleBulkUpdateRecords = async () => {
    if (selectedBulkRecordIds.size === 0) return;

    try {
      const batch = writeBatch(db);
      const updates: any = {
        updatedAt: new Date().toISOString()
      };

      if (bulkRecordUpdateData.costCodeId) updates.costCodeId = bulkRecordUpdateData.costCodeId;
      if (bulkRecordUpdateData.scope) updates.scope = bulkRecordUpdateData.scope.slice(0, 100);
      if (bulkRecordUpdateData.budgetAmount !== '') updates.budgetAmount = Number(bulkRecordUpdateData.budgetAmount);
      if (bulkRecordUpdateData.eacAmount !== '') updates.eacAmount = Number(bulkRecordUpdateData.eacAmount);

      // Add attributes to updates
      Object.entries(bulkRecordUpdateData.enterpriseAttributes).forEach(([id, val]) => {
        if (val !== undefined && val !== '') {
          updates[`enterpriseAttributes.${id}`] = val;
        }
      });
      Object.entries(bulkRecordUpdateData.projectAttributes).forEach(([id, val]) => {
        if (val !== undefined && val !== '') {
          updates[`projectAttributes.${id}`] = val;
        }
      });

      selectedBulkRecordIds.forEach(id => {
        batch.update(doc(db, 'changeRecords', id), updates);
      });

      await batch.commit();
      
      const affectedChangeIds = new Set<string>();
      selectedBulkRecordIds.forEach(id => {
        const record = allChangeRecords.find(r => r.id === id);
        if (record) affectedChangeIds.add(record.changeId);
      });

      for (const changeId of affectedChangeIds) {
        await updateParentTotals(changeId);
      }

      toast.success(`Updated ${selectedBulkRecordIds.size} records`);
      setIsBulkRecordUpdateOpen(false);
      setBulkRecordUpdateData({ 
        costCodeId: '', 
        scope: '', 
        budgetAmount: '', 
        eacAmount: '',
        enterpriseAttributes: {},
        projectAttributes: {}
      });
      setSelectedBulkRecordIds(new Set());
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'changeRecords');
    }
  };

  const handleBulkDeleteRecords = async () => {
    if (selectedBulkRecordIds.size === 0) return;
    try {
      const batch = writeBatch(db);
      const affectedChangeIds = new Set<string>();
      
      selectedBulkRecordIds.forEach(id => {
        const record = allChangeRecords.find(r => r.id === id);
        if (record) {
          affectedChangeIds.add(record.changeId);
          batch.delete(doc(db, 'changeRecords', id));
        }
      });
      
      await batch.commit();
      
      for (const cid of affectedChangeIds) {
        await updateParentTotals(cid);
      }
      
      toast.success(`Deleted ${selectedBulkRecordIds.size} records`);
      setSelectedBulkRecordIds(new Set());
      setIsBulkDeleteOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'changeRecords/bulk');
    }
  };

  const updateParentTotals = async (changeId: string) => {
    try {
      const recordsSnap = await getDocs(query(collection(db, 'changeRecords'), where('changeId', '==', changeId)));
      const records = recordsSnap.docs.map(d => d.data() as ChangeRecord);
      
      const totalBudget = records.reduce((sum, r) => sum + (Number(r.budgetAmount) || 0), 0);
      const totalEac = records.reduce((sum, r) => sum + (Number(r.eacAmount) || 0), 0);
      
      await updateDoc(doc(db, 'changes', changeId), {
        budget: totalBudget,
        eac: totalEac,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `changes/${changeId}/totals`);
    }
  };

  const onRecordCellValueChanged = async (params: CellValueChangedEvent) => {
    const { data, colDef } = params;
    if (!data.id) return;

    try {
      let updates: any = {
        [colDef.field!]: params.newValue,
        updatedAt: new Date().toISOString()
      };

      // Handle attribute updates
      if (colDef.field?.startsWith('enterpriseAttributes.') || colDef.field?.startsWith('projectAttributes.')) {
        const parts = colDef.field.split('.');
        const attrField = parts[0];
        const attrId = parts[1];
        updates = {
          [`${attrField}.${attrId}`]: params.newValue,
          updatedAt: new Date().toISOString()
        };
      }

      if (colDef.field === 'scope') {
        updates.scope = String(params.newValue).slice(0, 100);
      }

      await updateDoc(doc(db, 'changeRecords', data.id), updates);
      
      if (colDef.field === 'budgetAmount' || colDef.field === 'eacAmount') {
        updateParentTotals(data.changeId);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `changeRecords/${data.id}`);
    }
  };

  const bulkRecordColumnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => [
    {
      headerName: '',
      width: 50,
      pinned: 'left',
      checkboxSelection: true,
      headerCheckboxSelection: true,
      filter: false,
      sortable: false,
    },
    {
      headerName: 'Change ID',
      field: 'changeId',
      pinned: 'left',
      width: 120,
      sort: 'asc',
      valueFormatter: (params: ValueFormatterParams) => {
        if (params.data?.isTotalRow) return 'Total';
        const change = changes.find(c => c.id === params.value);
        return change?.changeId || params.value;
      },
      cellClass: (params) => params.data?.isTotalRow ? 'font-bold bg-gray-50 dark:bg-white/5' : '',
    },
    {
      headerName: 'Cost Code',
      field: 'costCodeId',
      width: 150,
      editable: (params) => !params.data?.isTotalRow,
      cellEditor: 'agRichSelectCellEditor',
      cellEditorParams: {
        values: costCodes.map(c => c.code),
        searchType: 'match',
        allowTyping: true,
        filterList: true
      },
      cellClass: (params) => params.data?.isTotalRow ? 'font-bold bg-gray-50 dark:bg-white/5' : '',
    },
    {
      headerName: 'Scope',
      field: 'scope',
      width: 300,
      editable: (params) => !params.data?.isTotalRow,
      cellClass: (params) => params.data?.isTotalRow ? 'bg-gray-50 dark:bg-white/5' : '',
    },
    {
      headerName: 'Enterprise Line-Item Attributes',
      openByDefault: true,
      children: enterpriseLineItemAttrs.map((attr, index) => ({
        headerName: attr.title,
        field: `enterpriseAttributes.${attr.id}`,
        width: 150,
        columnGroupShow: index === 0 ? undefined : 'open',
        editable: (params: any) => !params.data?.isTotalRow,
        cellEditor: 'agRichSelectCellEditor',
        cellEditorParams: {
          values: attr.values.map(v => v.id),
          searchType: 'match',
          allowTyping: true,
          filterList: true
        },
        valueSetter: (params: any) => {
          if (!params.data || params.newValue === undefined) return false;
          if (!params.data.enterpriseAttributes) {
            params.data.enterpriseAttributes = {};
          }
          params.data.enterpriseAttributes[attr.id] = params.newValue;
          return true;
        },
        valueFormatter: (params: any) => {
          const v = attr.values.find(v => v.id === params.value);
          return v ? `${v.id} - ${v.description}` : params.value;
        },
        cellClass: (params: any) => params.data?.isTotalRow ? 'bg-gray-50 dark:bg-white/5' : '',
      }))
    },
    {
      headerName: 'Project Line-Item Attributes',
      openByDefault: true,
      children: projectLineItemAttrs.map((attr, index) => ({
        headerName: attr.title,
        field: `projectAttributes.${attr.id}`,
        width: 150,
        columnGroupShow: index === 0 ? undefined : 'open',
        editable: (params: any) => !params.data?.isTotalRow,
        cellEditor: 'agRichSelectCellEditor',
        cellEditorParams: {
          values: attr.values.map(v => v.id),
          searchType: 'match',
          allowTyping: true,
          filterList: true
        },
        valueSetter: (params: any) => {
          if (!params.data || params.newValue === undefined) return false;
          if (!params.data.projectAttributes) {
            params.data.projectAttributes = {};
          }
          params.data.projectAttributes[attr.id] = params.newValue;
          return true;
        },
        valueFormatter: (params: any) => {
          const v = attr.values.find(v => v.id === params.value);
          return v ? `${v.id} - ${v.description}` : params.value;
        },
        cellClass: (params: any) => params.data?.isTotalRow ? 'bg-gray-50 dark:bg-white/5' : '',
      }))
    },
    {
      headerName: 'Budget Amount',
      field: 'budgetAmount',
      width: 150,
      editable: (params) => !params.data?.isTotalRow,
      valueFormatter: (params: ValueFormatterParams) => formatCurrency(params.value),
      cellClass: (params) => cn(
        "text-right font-mono",
        params.data?.isTotalRow ? 'font-bold bg-gray-50 dark:bg-white/5' : ''
      ),
    },
    {
      headerName: 'EAC Amount',
      field: 'eacAmount',
      width: 150,
      editable: (params) => !params.data?.isTotalRow,
      valueFormatter: (params: ValueFormatterParams) => formatCurrency(params.value),
      cellClass: (params) => cn(
        "text-right font-mono",
        params.data?.isTotalRow ? 'font-bold bg-gray-50 dark:bg-white/5' : ''
      ),
    }
  ], [changes, costCodes, enterprise.lineItemAttributes, project.lineItemAttributes]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#F5F5F4] dark:bg-[#0A0A0A]">
      <div className="p-8 flex flex-col h-full gap-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold dark:text-white">Bulk Change Records</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Manage all change records across the project</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 mr-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (bulkRecordsGridRef.current?.api) {
                    const api = bulkRecordsGridRef.current.api;
                    const groups = api.getColumnGroupState();
                    const newState = groups.map(g => ({
                      groupId: g.groupId,
                      open: true
                    }));
                    api.setColumnGroupState(newState);
                  }
                }}
                className="h-8 w-8 text-gray-500 hover:text-blue-600"
                title="Expand All Groups"
              >
                <Maximize2 className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (bulkRecordsGridRef.current?.api) {
                    const api = bulkRecordsGridRef.current.api;
                    const groups = api.getColumnGroupState();
                    const newState = groups.map(g => ({
                      groupId: g.groupId,
                      open: false
                    }));
                    api.setColumnGroupState(newState);
                  }
                }}
                className="h-8 w-8 text-gray-500 hover:text-blue-600"
                title="Collapse All Groups"
              >
                <Minimize2 className="w-4 h-4" />
              </Button>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input 
                placeholder="Search records..."
                value={bulkRecordsQuickFilterText}
                onChange={e => setBulkRecordsQuickFilterText(e.target.value)}
                className="pl-10 bg-white dark:bg-[#141414] border-gray-200 dark:border-white/10"
              />
            </div>
            <Button variant="outline" onClick={handleExportRecords} className="gap-2">
              <Download className="w-4 h-4" />
              Export
            </Button>
            <Button variant="outline" onClick={() => recordFileInputRef.current?.click()} className="gap-2">
              <Upload className="w-4 h-4" />
              Import
            </Button>
            <input 
              type="file"
              ref={recordFileInputRef}
              onChange={handleImportRecords}
              accept=".xlsx,.xls"
              className="hidden"
            />
            {selectedBulkRecordIds.size > 0 && (
              <>
                <Button variant="outline" onClick={() => setIsBulkRecordUpdateOpen(true)} className="gap-2 text-blue-600 border-blue-200 hover:bg-blue-50">
                  <RotateCcw className="w-4 h-4" />
                  Bulk Update ({selectedBulkRecordIds.size})
                </Button>
                <Button variant="outline" onClick={() => setIsBulkDeleteOpen(true)} className="gap-2 text-red-600 border-red-200 hover:bg-red-50">
                  <Trash2 className="w-4 h-4" />
                  Delete ({selectedBulkRecordIds.size})
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-white dark:bg-[#141414] rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm overflow-hidden">
          <div className="ag-theme-quartz-dark h-full w-full">
            <AgGridReact
              ref={bulkRecordsGridRef}
              rowData={allChangeRecords}
              columnDefs={bulkRecordColumnDefs}
              defaultColDef={{
                sortable: true,
                filter: true,
                resizable: true,
                flex: 1,
                minWidth: 100,
              }}
              rowSelection="multiple"
              onSelectionChanged={(params) => {
                const selected = params.api.getSelectedRows();
                setSelectedBulkRecordIds(new Set(selected.map(r => r.id)));
              }}
              onCellValueChanged={onRecordCellValueChanged}
              pinnedTopRowData={allRecordPinnedBottomRowData}
              getRowClass={(params) => {
                if (params.node.rowPinned) return 'pinned-row-highlight';
                return '';
              }}
              quickFilterText={bulkRecordsQuickFilterText}
              sideBar={sideBar}
              statusBar={statusBar}
              enableRangeSelection={true}
              enableFillHandle={true}
              undoRedoCellEditing={true}
              animateRows={true}
            />
          </div>
        </div>
      </div>

      {/* Bulk Update Modal */}
      <Dialog open={isBulkRecordUpdateOpen} onOpenChange={setIsBulkRecordUpdateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk Update Records</DialogTitle>
            <DialogDescription>
              Update {selectedBulkRecordIds.size} selected records. Only filled fields will be updated.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Cost Code</label>
              <Select 
                value={bulkRecordUpdateData.costCodeId} 
                onValueChange={val => setBulkRecordUpdateData(prev => ({ ...prev, costCodeId: val }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Cost Code" />
                </SelectTrigger>
                <SelectContent>
                  {costCodes.map(c => (
                    <SelectItem key={c.id} value={c.code}>{c.code} - {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Scope</label>
              <Input 
                value={bulkRecordUpdateData.scope}
                onChange={e => setBulkRecordUpdateData(prev => ({ ...prev, scope: e.target.value }))}
                placeholder="Update scope..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Budget Amount</label>
                <Input 
                  type="number"
                  value={bulkRecordUpdateData.budgetAmount}
                  onChange={e => setBulkRecordUpdateData(prev => ({ ...prev, budgetAmount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-gray-500">EAC Amount</label>
                <Input 
                  type="number"
                  value={bulkRecordUpdateData.eacAmount}
                  onChange={e => setBulkRecordUpdateData(prev => ({ ...prev, eacAmount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Enterprise Attributes */}
            {enterpriseLineItemAttrs.length > 0 && (
              <div className="space-y-4 pt-2 border-t border-gray-100 dark:border-white/10">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Enterprise Attributes</h4>
                <div className="grid grid-cols-2 gap-4">
                  {enterpriseLineItemAttrs.map(attr => (
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
            {projectLineItemAttrs.length > 0 && (
              <div className="space-y-4 pt-2 border-t border-gray-100 dark:border-white/10">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Project Attributes</h4>
                <div className="grid grid-cols-2 gap-4">
                  {projectLineItemAttrs.map(attr => (
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
            <Button onClick={handleBulkUpdateRecords} className="bg-blue-600 hover:bg-blue-700 text-white">Update Records</Button>
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
              Are you sure you want to delete {selectedBulkRecordIds.size} records? This action cannot be undone and will update parent change totals.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkDeleteOpen(false)}>Cancel</Button>
            <Button onClick={handleBulkDeleteRecords} className="bg-red-600 hover:bg-red-700 text-white">Delete Records</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AlertTriangle({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
    </svg>
  );
}
