import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Project, Enterprise, CostCode } from '../types';
import { 
  DollarSign, 
  Plus, 
  Filter, 
  Search, 
  Download, 
  Trash2, 
  Save,
  ChevronDown,
  FileSpreadsheet,
  History,
  Upload,
  Maximize2,
  Minimize2,
  X,
  Edit2,
  AlertCircle,
  Target
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AgGridReact } from 'ag-grid-react';
import { 
  ColDef, 
  ColGroupDef, 
  CellValueChangedEvent, 
  GridReadyEvent,
  ValueFormatterParams,
  GridApi
} from 'ag-grid-community';
import { format, parseISO } from 'date-fns';
import { db, auth } from '../firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  getDocs,
  getDoc,
  writeBatch,
  orderBy
} from 'firebase/firestore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatCurrency, formatNumber } from '../lib/utils';
import { OperationType, handleFirestoreError } from '../lib/errorHandlers';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from 'next-themes';
import DataGridModule from './DataGridModule';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BaselineBudgetProps {
  project: Project;
  enterprise: Enterprise;
}

interface BaselineBudgetRecord {
  id: string;
  projectId: string;
  costCodeId: string;
  item: string;
  description: string;
  source: 'EST' | 'CON' | 'BID';
  amount: number;
  reportingPeriodId: string;
  enterpriseAttributes?: Record<string, any>;
  projectAttributes?: Record<string, any>;
  createdAt: string;
  updatedAt?: string;
}

const BaselineBudget: React.FC<BaselineBudgetProps> = ({ project, enterprise }) => {
  const [records, setRecords] = useState<BaselineBudgetRecord[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [quickFilterText, setQuickFilterText] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isBulkUpdateOpen, setIsBulkUpdateOpen] = useState(false);
  
  // Bulk Update State
  const [bulkData, setBulkData] = useState<{
    costCodeId?: string;
    source?: 'EST' | 'CON' | 'BID';
    enterpriseAttributes: Record<string, any>;
    projectAttributes: Record<string, any>;
  }>({
    enterpriseAttributes: {},
    projectAttributes: {}
  });
  
  // Import Wizard State
  const [importWizard, setImportWizard] = useState<{
    isOpen: boolean;
    phase: 'preview' | 'processing';
    data: any[];
    errors: { row: number; msg: string; type: 'error' | 'warning' }[];
    progress: number;
    total: number;
    processed: number;
  }>({
    isOpen: false,
    phase: 'preview',
    data: [],
    errors: [],
    progress: 0,
    total: 0,
    processed: 0
  });

  const gridRef = useRef<AgGridReact>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { theme: currentTheme } = useTheme();
  const theme = currentTheme === 'dark' ? 'dark' : 'light';

  const userId = auth.currentUser?.uid;
  const isEnterpriseAdmin = userId && enterprise?.users?.[userId]?.role === 'Enterprise System Admin';
  const isProjectAdmin = userId && (isEnterpriseAdmin || project?.users?.[userId] === 'Project Admin');

  // Fetch Baseline Budgets
  useEffect(() => {
    const q = query(
      collection(db, 'baselineBudgets'), 
      where('projectId', '==', project.id),
      orderBy('createdAt', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as BaselineBudgetRecord[];
      setRecords(data);
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching baseline budgets:", error);
      toast.error("Failed to load baseline budgets");
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, [project.id]);

  // Fetch Cost Codes for dropdown
  useEffect(() => {
    const q = query(collection(db, 'costCodes'), where('projectId', '==', project.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as CostCode[];
      setCostCodes(data.sort((a, b) => a.sortOrder - b.sortOrder));
    });
    return () => unsubscribe();
  }, [project.id]);

  const syncBaselineBudgetToCostCode = useCallback(async (costCodeId: string) => {
    if (!costCodeId) return;
    try {
      const ccDoc = await getDoc(doc(db, 'costCodes', costCodeId));
      if (!ccDoc.exists()) return;
      const ccData = ccDoc.data() as CostCode;

      // OPTIMIZATION: Query only the records for this specific cost code
      const qById = query(
        collection(db, 'baselineBudgets'),
        where('projectId', '==', project.id),
        where('costCodeId', '==', costCodeId)
      );

      const qByCode = query(
        collection(db, 'baselineBudgets'),
        where('projectId', '==', project.id),
        where('costCodeId', '==', ccData.code)
      );

      const [snapById, snapByCode] = await Promise.all([
        getDocs(qById),
        getDocs(qByCode)
      ]);

      const recordsById = snapById.docs.map(doc => doc.data() as BaselineBudgetRecord);
      const recordsByCode = snapByCode.docs.map(doc => doc.data() as BaselineBudgetRecord);
      
      const uniqueRecordsMap = new Map<string, BaselineBudgetRecord>();
      snapById.docs.forEach((doc, i) => uniqueRecordsMap.set(doc.id, recordsById[i]));
      snapByCode.docs.forEach((doc, i) => uniqueRecordsMap.set(doc.id, recordsByCode[i]));
      
      const codeBudgets = Array.from(uniqueRecordsMap.values());
      const totalBaseline = codeBudgets.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      
      await updateDoc(doc(db, 'costCodes', costCodeId), {
        baselineBudget: totalBaseline,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error syncing baseline budget:", error);
    }
  }, [project.id]);

  const handleAddRecord = async () => {
    if (!isProjectAdmin) {
      toast.error("Only Project Admins can add baseline budget details.");
      return;
    }

    try {
      const newRecord = {
        projectId: project.id,
        costCodeId: '',
        item: 'New Budget Item',
        description: '',
        source: 'EST',
        amount: 0,
        reportingPeriodId: project.reportingPeriods?.currentPeriodId || '',
        createdAt: new Date().toISOString(),
        enterpriseAttributes: {},
        projectAttributes: {}
      };
      await addDoc(collection(db, 'baselineBudgets'), newRecord);
      toast.success("Record added");

      setTimeout(() => {
        if (gridRef.current?.api) {
          const rowCount = gridRef.current.api.getDisplayedRowCount();
          if (rowCount > 0) {
            gridRef.current.api.ensureIndexVisible(rowCount - 1, 'bottom');
          }
        }
      }, 500);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'baselineBudgets');
      toast.error("Failed to add record");
    }
  };

  const handleDeleteRecord = async (id: string, costCodeId: string) => {
    if (!isProjectAdmin) {
      toast.error("Only Project Admins can delete baseline budget details.");
      return;
    }

    try {
      await deleteDoc(doc(db, 'baselineBudgets', id));
      toast.success("Record deleted");
      if (costCodeId) await syncBaselineBudgetToCostCode(costCodeId);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `baselineBudgets/${id}`);
      toast.error("Failed to delete record");
    }
  };

  const handleDeleteSelected = async () => {
    if (!isProjectAdmin) return;
    const idsToDelete = Array.from(selectedIds);
    if (idsToDelete.length === 0) return;

    setIsLoading(true);
    try {
      const batch = writeBatch(db);
      const affectedCostCodeIds = new Set<string>();
      
      idsToDelete.forEach(id => {
        const record = records.find(r => r.id === id);
        if (record?.costCodeId) affectedCostCodeIds.add(record.costCodeId);
        batch.delete(doc(db, 'baselineBudgets', id));
      });

      await batch.commit();
      
      for (const ccId of affectedCostCodeIds) {
        await syncBaselineBudgetToCostCode(ccId);
      }

      toast.success(`Deleted ${idsToDelete.length} records`);
      setSelectedIds(new Set());
      setIsDeleteConfirmOpen(false);
    } catch (error) {
      console.error("Error deleting records:", error);
      toast.error("Failed to delete records");
    } finally {
      setIsLoading(false);
    }
  };

  const totalBaselineBudget = useMemo(() => records.reduce((sum, r) => sum + (Number(r.amount) || 0), 0), [records]);

  const handleBulkUpdate = async () => {
    if (!isProjectAdmin) return;
    const idsToUpdate = Array.from(selectedIds);
    if (idsToUpdate.length === 0) return;

    setIsLoading(true);
    try {
      const batch = writeBatch(db);
      const affectedCostCodeIds = new Set<string>();
      
      idsToUpdate.forEach(id => {
        const record = records.find(r => r.id === id);
        if (record?.costCodeId) affectedCostCodeIds.add(record.costCodeId);
        
        const updates: any = {
          updatedAt: new Date().toISOString()
        };
        
        if (bulkData.costCodeId) {
          updates.costCodeId = bulkData.costCodeId;
          affectedCostCodeIds.add(bulkData.costCodeId);
        }
        if (bulkData.source) updates.source = bulkData.source;
        
        if (Object.keys(bulkData.enterpriseAttributes).length > 0) {
          updates.enterpriseAttributes = {
            ...(record?.enterpriseAttributes || {}),
            ...bulkData.enterpriseAttributes
          };
        }
        
        if (Object.keys(bulkData.projectAttributes).length > 0) {
          updates.projectAttributes = {
            ...(record?.projectAttributes || {}),
            ...bulkData.projectAttributes
          };
        }

        batch.update(doc(db, 'baselineBudgets', id), updates);
      });

      await batch.commit();
      
      for (const ccId of affectedCostCodeIds) {
        await syncBaselineBudgetToCostCode(ccId);
      }

      toast.success(`Updated ${idsToUpdate.length} records`);
      setSelectedIds(new Set());
      setIsBulkUpdateOpen(false);
      setBulkData({ enterpriseAttributes: {}, projectAttributes: {} });
    } catch (error) {
      console.error("Error updating records:", error);
      toast.error("Failed to update records");
    } finally {
      setIsLoading(false);
    }
  };

  const pinnedTopRowData = useMemo(() => {
    if (records.length === 0) return [];
    return [{
      costCodeId: 'SubTotal',
      item: 'TOTAL BUDGET',
      amount: totalBaselineBudget,
      isPinned: true
    }];
  }, [records, totalBaselineBudget]);

  const handleExportExcel = () => {
    const enterpriseAttrs = (enterprise.lineItemAttributes || []).filter(a => a.title);
    const projectAttrs = (project.lineItemAttributes || []).filter(a => a.title);

    const data = records.map(r => {
      const exportRow: any = {
        'Cost Code ID': costCodes.find(cc => cc.id === r.costCodeId)?.code || '',
        'Item': r.item,
        'Description': r.description,
        'Amount': r.amount,
      };

      enterpriseAttrs.forEach(attr => {
        exportRow[`E_${attr.title}`] = r.enterpriseAttributes?.[attr.id] || '';
      });

      projectAttrs.forEach(attr => {
        exportRow[`P_${attr.title}`] = r.projectAttributes?.[attr.id] || '';
      });

      return exportRow;
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Baseline Budget');
    XLSX.writeFile(wb, `Baseline_Budget_${project.projectName}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        if (data.length === 0) {
          toast.error("The Excel file is empty.");
          return;
        }

        const errors: { row: number; msg: string; type: 'error' | 'warning' }[] = [];

        // Validation pass
        data.forEach((row, index) => {
          const rowNum = index + 1;
          
          // Cost Code Validation
          const costCodeValue = String(row['Cost Code ID'] || '').trim();
          if (!costCodeValue) {
            errors.push({ row: rowNum, msg: "Missing Cost Code ID", type: 'error' });
          } else {
            const costCode = costCodes.find(cc => cc.code === costCodeValue);
            if (!costCode) {
              errors.push({ row: rowNum, msg: `Cost Code "${costCodeValue}" not found`, type: 'error' });
            }
          }

          // Amount Validation
          if (isNaN(Number(row['Amount']))) {
            errors.push({ row: rowNum, msg: `Invalid Amount: "${row['Amount']}"`, type: 'error' });
          }
        });

        setImportWizard({
          isOpen: true,
          phase: 'preview',
          data,
          errors,
          progress: 0,
          total: data.length,
          processed: 0
        });

      } catch (error) {
        console.error("Error reading Excel:", error);
        toast.error("Failed to read Excel file.");
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const executeImport = async () => {
    const { data } = importWizard;
    const enterpriseAttrs = (enterprise.lineItemAttributes || []).filter(a => a.title);
    const projectAttrs = (project.lineItemAttributes || []).filter(a => a.title);
    const affectedCostCodeIds = new Set<string>();

    setImportWizard(prev => ({ ...prev, phase: 'processing', progress: 0 }));

    const chunkSize = 400;
    const totalChunks = Math.ceil(data.length / chunkSize);
    
    try {
      for (let i = 0; i < totalChunks; i++) {
        const chunk = data.slice(i * chunkSize, (i + 1) * chunkSize);
        const batch = writeBatch(db);
        
        chunk.forEach(row => {
          const costCode = costCodes.find(cc => cc.code === String(row['Cost Code ID']).trim());
          if (costCode) affectedCostCodeIds.add(costCode.id);

          const enterpriseAttributes: Record<string, any> = {};
          enterpriseAttrs.forEach(attr => {
            if (row[`E_${attr.title}`] !== undefined) {
              enterpriseAttributes[attr.id] = String(row[`E_${attr.title}`]);
            }
          });

          const projectAttributes: Record<string, any> = {};
          projectAttrs.forEach(attr => {
            if (row[`P_${attr.title}`] !== undefined) {
              projectAttributes[attr.id] = String(row[`P_${attr.title}`]);
            }
          });

          const newDocRef = doc(collection(db, 'baselineBudgets'));
          batch.set(newDocRef, {
            projectId: project.id,
            costCodeId: costCode?.id || '',
            item: row['Item'] || '',
            description: row['Description'] || '',
            source: 'EST',
            amount: Number(row['Amount']) || 0,
            reportingPeriodId: project.reportingPeriods?.currentPeriodId || '',
            enterpriseAttributes,
            projectAttributes,
            createdAt: new Date().toISOString()
          });
        });

        await batch.commit();
        const processed = Math.min((i + 1) * chunkSize, data.length);
        setImportWizard(prev => ({ 
          ...prev, 
          processed,
          progress: Math.round((processed / data.length) * 100) 
        }));
      }
      
      toast.success(`Imported ${data.length} records successfully. Click 'Calculate' in the Cost Codes module to update totals.`, { duration: 5000 });
      setImportWizard(prev => ({ ...prev, isOpen: false }));
    } catch (error) {
      console.error("Import execution error:", error);
      toast.error("Failed to complete import.");
      setImportWizard(prev => ({ ...prev, isOpen: false }));
    }
  };

  const onCellValueChanged = async (event: CellValueChangedEvent) => {
    const { data, colDef, newValue, oldValue } = event;
    if (newValue === oldValue) return;

    try {
      const updates: any = {
        ...data,
        updatedAt: new Date().toISOString()
      };
      delete updates.id;

      await updateDoc(doc(db, 'baselineBudgets', data.id), updates);
      
      if (colDef.field === 'costCodeId' || colDef.field === 'amount') {
        if (data.costCodeId) await syncBaselineBudgetToCostCode(data.costCodeId);
        if (colDef.field === 'costCodeId' && oldValue) {
          await syncBaselineBudgetToCostCode(oldValue);
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `baselineBudgets/${data.id}`);
      toast.error("Failed to update record");
      event.node.setDataValue(colDef.field!, oldValue);
    }
  };

  const columnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    const periods = project.reportingPeriods?.periods || [];
    const enterpriseAttrs = (enterprise.lineItemAttributes || []).filter(a => a.title);
    const projectAttrs = (project.lineItemAttributes || []).filter(a => a.title);

    const defs: (ColDef | ColGroupDef)[] = [
      {
        headerName: 'Core Information',
        children: [
          {
            headerName: 'Cost Code ID',
            field: 'costCodeId',
            sort: 'asc',
            width: 180,
            checkboxSelection: true,
            headerCheckboxSelection: true,
            headerCheckboxSelectionFilteredOnly: true,
            editable: isProjectAdmin,
            cellEditor: 'agRichSelectCellEditor',
            cellEditorParams: {
              values: ['', ...costCodes.map(c => c.id)],
              formatValue: (id: string) => {
                if (!id) return '';
                const cc = costCodes.find(c => c.id === id);
                return cc ? `${cc.code} - ${cc.name}` : id;
              },
              searchType: 'match',
              allowTyping: true,
              filterList: true
            },
            valueFormatter: (params) => {
              if (!params.value) return '';
              return costCodes.find(c => c.id === params.value)?.code || params.value;
            },
            filter: 'agSetColumnFilter',
          },
          {
            headerName: 'Item',
            field: 'item',
            width: 150,
            editable: isProjectAdmin,
            filter: 'agTextColumnFilter',
          },
          {
            headerName: 'Description',
            field: 'description',
            width: 250,
            editable: isProjectAdmin,
            filter: 'agTextColumnFilter',
          },
          {
            headerName: 'Amount',
            field: 'amount',
            width: 120,
            type: 'numericColumn',
            editable: isProjectAdmin,
            valueFormatter: (params) => formatCurrency(params.value),
            aggFunc: 'sum',
          },
        ]
      }
    ];

    if (enterpriseAttrs.length > 0) {
      defs.push({
        headerName: 'Enterprise Attributes',
        children: enterpriseAttrs.map(attr => ({
          headerName: attr.title,
          field: `enterpriseAttributes.${attr.id}`,
          width: 150,
          editable: isProjectAdmin,
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: {
            values: attr.values.map(v => v.id),
          },
          valueFormatter: (params: any) => {
            const v = attr.values.find(v => v.id === params.value);
            return v ? `${v.id} - ${v.description}` : params.value;
          },
          valueSetter: (params: any) => {
            if (!params.data.enterpriseAttributes) params.data.enterpriseAttributes = {};
            params.data.enterpriseAttributes[attr.id] = params.newValue;
            return true;
          }
        }))
      });
    }

    if (projectAttrs.length > 0) {
      defs.push({
        headerName: 'Project Attributes',
        children: projectAttrs.map(attr => ({
          headerName: attr.title,
          field: `projectAttributes.${attr.id}`,
          width: 150,
          editable: isProjectAdmin,
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: {
            values: attr.values.map(v => v.id),
          },
          valueFormatter: (params: any) => {
            const v = attr.values.find(v => v.id === params.value);
            return v ? `${v.id} - ${v.description}` : params.value;
          },
          valueSetter: (params: any) => {
            if (!params.data.projectAttributes) params.data.projectAttributes = {};
            params.data.projectAttributes[attr.id] = params.newValue;
            return true;
          }
        }))
      });
    }

    defs.push({
      headerName: 'Actions',
      width: 80,
      pinned: 'right',
      cellRenderer: (params: any) => {
        if (params.node.rowPinned) return null;
        return (
          <div className="flex items-center justify-center h-full">
            <button 
              onClick={() => handleDeleteRecord(params.data.id, params.data.costCodeId)}
              className="p-1 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded transition-colors"
              disabled={!isProjectAdmin}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      }
    });

    return defs;
  }, [costCodes, project.reportingPeriods?.periods, enterprise.lineItemAttributes, project.lineItemAttributes, isProjectAdmin]);

  const sideBar = useMemo(() => ({
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
  }), []);

  const statusBar = useMemo(() => ({
    statusPanels: [
      { statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'left' },
      { statusPanel: 'agAggregationComponent', align: 'right' },
    ],
  }), []);

  return (
    <div className="flex-1 flex flex-col p-8 overflow-hidden bg-gray-50/50 dark:bg-transparent h-full">
      <DataGridModule
        title="Baseline Budget Management"
        description="Track and manage project baseline budget details and breakdowns."
        icon={<Target className="w-4 h-4 text-gray-400" />}
        quickFilterText={quickFilterText}
        onQuickFilterChange={setQuickFilterText}
        onImport={() => fileInputRef.current?.click()}
        onExport={handleExportExcel}
        onAdd={handleAddRecord}
        selectedCount={selectedIds.size}
        onBulkUpdate={() => setIsBulkUpdateOpen(true)}
        onBulkDelete={() => setIsDeleteConfirmOpen(true)}
        topContent={
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="rounded-2xl border-gray-200 dark:border-white/10 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Total Baseline Budget</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold dark:text-white">{formatCurrency(totalBaselineBudget)}</p>
              </CardContent>
            </Card>
          </div>
        }
        gridRef={gridRef}
        rowData={records}
        columnDefs={columnDefs}
        pinnedTopRowData={pinnedTopRowData}
        theme={theme}
        gridProps={{
          getRowId: (params: any) => params.data.id,
          onCellValueChanged: onCellValueChanged,
          defaultColDef: {
            sortable: true,
            filter: true,
            resizable: true,
            enableRowGroup: true,
            enablePivot: true,
            enableValue: true,
          },
          sideBar: sideBar,
          statusBar: statusBar,
          rowSelection: "multiple",
          rowGroupPanelShow: "always",
          pivotPanelShow: "always",
          groupDisplayType: "multipleColumns",
          enableRangeSelection: true,
          enableFillHandle: true,
          undoRedoCellEditing: true,
          animateRows: true,
          onSelectionChanged: (event: any) => {
            const selectedRows = event.api.getSelectedRows();
            const displayedSelected = selectedRows.filter((row: any) => {
              const node = event.api.getRowNode(row.id);
              return node && node.displayed;
            });
            setSelectedIds(new Set(displayedSelected.map((r: any) => r.id)));
          },
          onFilterChanged: (event: any) => {
            const selectedRows = event.api.getSelectedRows();
            const displayedSelected = selectedRows.filter((row: any) => {
              const node = event.api.getRowNode(row.id);
              return node && node.displayed;
            });
            setSelectedIds(new Set(displayedSelected.map((r: any) => r.id)));
          }
        }}
      />

      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept=".xlsx,.xls,.csv"
        onChange={handleImportExcel}
      />

      {/* Import Wizard Modal */}
      <Dialog 
        open={importWizard.isOpen} 
        onOpenChange={(open) => !importWizard.phase.includes('processing') && setImportWizard(prev => ({ ...prev, isOpen: open }))}
      >
        <DialogContent className="max-w-[95vw] w-full max-h-[95vh] flex flex-col p-0 overflow-hidden rounded-[2rem] border-none shadow-2xl ring-1 ring-black/5 dark:ring-white/5 bg-white dark:bg-[#1a1a1a]">
          <DialogHeader className="p-8 pb-4 bg-gray-50 dark:bg-white/5 border-b border-gray-100 dark:border-white/10 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-2xl font-bold tracking-tight">
                  {importWizard.phase === 'preview' ? 'Baseline Import Preview' : 'Processing Baseline Import'}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  {importWizard.phase === 'preview' 
                    ? `Reviewing ${importWizard.data.length} baseline budget items.` 
                    : `Please wait while we process ${importWizard.total} records.`}
                </DialogDescription>
              </div>
              <Badge variant={importWizard.errors.some(e => e.type === 'error') ? 'destructive' : 'secondary'} className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest text-[10px]">
                {importWizard.errors.filter(e => e.type === 'error').length} Errors Found
              </Badge>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col">
            {importWizard.phase === 'preview' ? (
              <div className="flex-1 overflow-hidden flex flex-col">
                {/* Error List */}
                {importWizard.errors.length > 0 && (
                  <div className="p-4 bg-red-50/50 dark:bg-red-500/5 border-b border-red-100 dark:border-red-500/10 shrink-0">
                    <div className="flex items-center gap-2 mb-2 text-red-600 font-bold text-[10px] uppercase tracking-wider">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Critical Validation Errors
                    </div>
                    <ScrollArea className="h-20">
                      <ul className="space-y-1">
                        {importWizard.errors.map((err, i) => (
                          <li key={i} className="text-[10px] text-red-700 dark:text-red-400 flex gap-2">
                            <span className="font-mono font-bold shrink-0">Row {err.row}:</span>
                            <span>{err.msg}</span>
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                )}

                {/* Data Preview Table */}
                <div className="flex-1 overflow-auto p-4">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead className="sticky top-0 bg-white dark:bg-[#1a1a1a] shadow-sm z-10 transition-colors">
                      <tr className="border-b border-gray-200 dark:border-white/10 uppercase tracking-widest text-gray-500">
                        <th className="py-2.5 px-4 font-bold">#</th>
                        <th className="py-2.5 px-4 font-bold">Cost Code ID</th>
                        <th className="py-2.5 px-4 font-bold">Item</th>
                        <th className="py-2.5 px-4 font-bold text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                      {importWizard.data.slice(0, 100).map((row, i) => (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group">
                          <td className="py-2.5 px-4 font-mono text-gray-400">{i + 1}</td>
                          <td className="py-2.5 px-4 font-bold text-blue-600 dark:text-blue-400">{row['Cost Code ID']}</td>
                          <td className="py-2.5 px-4">{row['Item']}</td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold">{formatCurrency(row['Amount'])}</td>
                        </tr>
                      ))}
                      {importWizard.data.length > 100 && (
                        <tr>
                          <td colSpan={4} className="py-4 text-center text-gray-400 italic text-[10px]">
                            + {importWizard.data.length - 100} more rows...
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-12 gap-8 bg-white dark:bg-[#141414]">
                <div className="relative w-48 h-48">
                  {/* Circular Progress */}
                  <svg className="w-full h-full rotate-[-90deg]">
                    <circle cx="96" cy="96" r="80" fill="none" stroke="currentColor" strokeWidth="12" className="text-gray-100 dark:text-white/5" />
                    <circle
                      cx="96" cy="96" r="80"
                      fill="none" stroke="currentColor" strokeWidth="12"
                      strokeDasharray={2 * Math.PI * 80}
                      strokeDashoffset={2 * Math.PI * 80 * (1 - importWizard.progress / 100)}
                      strokeLinecap="round"
                      className="text-blue-600 transition-all duration-500 ease-out"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-4xl font-bold text-slate-900 dark:text-white">{importWizard.progress}%</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Complete</span>
                  </div>
                </div>

                <div className="w-full max-w-sm space-y-3">
                  <div className="flex justify-between text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                    <span>Imported {importWizard.processed}</span>
                    <span>Total {importWizard.total}</span>
                  </div>
                  <div className="h-2.5 w-full bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${importWizard.progress}%` }} className="h-full bg-blue-600 rounded-full" />
                  </div>
                  <p className="text-center text-[11px] text-gray-500 animate-pulse mt-4 font-medium italic">
                    Recalculating cost center summaries to ensure data integrity...
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="p-8 bg-gray-50 dark:bg-white/5 border-t border-gray-100 dark:border-white/10 shrink-0 gap-3">
            <Button 
              variant="ghost" 
              onClick={() => setImportWizard(prev => ({ ...prev, isOpen: false }))}
              disabled={importWizard.phase === 'processing'}
              className="rounded-xl px-6 font-bold text-xs"
            >
              Cancel
            </Button>
            {importWizard.phase === 'preview' && (
              <Button 
                onClick={executeImport}
                disabled={importWizard.errors.some(e => e.type === 'error')}
                className="bg-black dark:bg-white text-white dark:text-black rounded-xl px-10 font-bold flex items-center gap-2 hover:opacity-90 shadow-xl shadow-black/20 text-xs"
              >
                <Upload className="w-4 h-4" />
                Initialize Budget Import
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              Confirm Deletion
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedIds.size} selected records? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsDeleteConfirmOpen(false)} className="rounded-xl">Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteSelected} className="rounded-xl">Delete Selected</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkUpdateOpen} onOpenChange={setIsBulkUpdateOpen}>
        <DialogContent className="max-w-xl rounded-3xl overflow-hidden p-0 border-none shadow-2xl">
          <DialogHeader className="p-8 pb-4 bg-gray-50 dark:bg-white/5 border-b border-gray-100 dark:border-white/10 shrink-0">
            <DialogTitle className="text-2xl font-bold tracking-tight">Bulk Update ({selectedIds.size} records)</DialogTitle>
            <DialogDescription>
              Update selected baseline budget records with new values. Only fields with values will be updated.
            </DialogDescription>
          </DialogHeader>
          
          <div className="p-8 space-y-6 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-1 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Cost Code</label>
                <select 
                  className="w-full p-3 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm"
                  value={bulkData.costCodeId || ''}
                  onChange={(e) => setBulkData(prev => ({ ...prev, costCodeId: e.target.value }))}
                >
                  <option value="">No Change</option>
                  {costCodes.map(cc => (
                    <option key={cc.id} value={cc.id}>{cc.code} - {cc.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Source</label>
                <select 
                  className="w-full p-3 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm"
                  value={bulkData.source || ''}
                  onChange={(e) => setBulkData(prev => ({ ...prev, source: e.target.value as any }))}
                >
                  <option value="">No Change</option>
                  <option value="EST">Estimate (EST)</option>
                  <option value="CON">Contract (CON)</option>
                  <option value="BID">Bid (BID)</option>
                </select>
              </div>

              {/* Enterprise Attributes */}
              {enterprise.lineItemAttributes?.map(attr => (
                <div key={attr.id} className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{attr.title} (Enterprise)</label>
                  <select 
                    className="w-full p-3 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm"
                    value={bulkData.enterpriseAttributes[attr.id] || ''}
                    onChange={(e) => setBulkData(prev => ({ 
                      ...prev, 
                      enterpriseAttributes: { ...prev.enterpriseAttributes, [attr.id]: e.target.value }
                    }))}
                  >
                    <option value="">No Change / Clear</option>
                    {attr.values?.map(v => (
                      <option key={v.id} value={v.id}>{v.id} - {v.description}</option>
                    ))}
                  </select>
                </div>
              ))}

              {/* Project Attributes */}
              {project.lineItemAttributes?.map(attr => (
                <div key={attr.id} className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{attr.title} (Project)</label>
                  <select 
                    className="w-full p-3 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm"
                    value={bulkData.projectAttributes[attr.id] || ''}
                    onChange={(e) => setBulkData(prev => ({ 
                      ...prev, 
                      projectAttributes: { ...prev.projectAttributes, [attr.id]: e.target.value }
                    }))}
                  >
                    <option value="">No Change / Clear</option>
                    {attr.values?.map(v => (
                      <option key={v.id} value={v.id}>{v.id} - {v.description}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="p-8 bg-gray-50 dark:bg-white/5 border-t border-gray-100 dark:border-white/10 shrink-0 gap-3">
            <Button variant="ghost" onClick={() => setIsBulkUpdateOpen(false)} className="rounded-xl px-6 font-bold text-xs">
              Cancel
            </Button>
            <Button onClick={handleBulkUpdate} className="bg-black dark:bg-white text-white dark:text-black rounded-xl px-10 font-bold hover:opacity-90 shadow-xl shadow-black/20 text-xs">
              Update Records
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BaselineBudget;
