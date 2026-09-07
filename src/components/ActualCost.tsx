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
  BarChart3
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
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Line, 
  ComposedChart,
  Cell,
  Legend,
  LabelList
} from 'recharts';
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

interface ActualCostProps {
  project: Project;
  enterprise: Enterprise;
}

interface ActualCostRecord {
  id: string;
  projectId: string;
  costCodeId: string;
  item: string;
  description: string;
  source: 'MAN' | 'ACC' | 'FIN' | 'REV';
  cost: number;
  reportingPeriodId: string;
  enterpriseAttributes?: Record<string, any>;
  projectAttributes?: Record<string, any>;
  createdAt: string;
  updatedAt?: string;
}

const ActualCost: React.FC<ActualCostProps> = ({ project, enterprise }) => {
  const [records, setRecords] = useState<ActualCostRecord[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [quickFilterText, setQuickFilterText] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isBulkUpdateOpen, setIsBulkUpdateOpen] = useState(false);
  const [isChartVisible, setIsChartVisible] = useState(false);
  
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

  // Fetch Actual Costs
  useEffect(() => {
    const q = query(
      collection(db, 'actualCosts'), 
      where('projectId', '==', project.id),
      orderBy('createdAt', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ActualCostRecord[];
      setRecords(data);
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching actual costs:", error);
      toast.error("Failed to load actual costs");
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

  const syncActualCostsToCostCode = useCallback(async (costCodeId: string) => {
    if (!costCodeId) return;
    try {
      // Fetch the cost code to get its string code for robust matching
      const ccDoc = await getDoc(doc(db, 'costCodes', costCodeId));
      if (!ccDoc.exists()) return;
      const ccData = ccDoc.data() as CostCode;

      // OPTIMIZATION: Query only the records for this specific cost code
      // We search for both the Firestore ID and the code string for legacy support
      const qById = query(
        collection(db, 'actualCosts'),
        where('projectId', '==', project.id),
        where('costCodeId', '==', costCodeId)
      );

      const qByCode = query(
        collection(db, 'actualCosts'),
        where('projectId', '==', project.id),
        where('costCodeId', '==', ccData.code)
      );

      const [snapById, snapByCode] = await Promise.all([
        getDocs(qById),
        getDocs(qByCode)
      ]);

      const recordsById = snapById.docs.map(doc => doc.data() as ActualCostRecord);
      const recordsByCode = snapByCode.docs.map(doc => doc.data() as ActualCostRecord);
      
      // Combine records and remove duplicates by ID if any
      const uniqueRecordsMap = new Map<string, ActualCostRecord>();
      snapById.docs.forEach((doc, i) => uniqueRecordsMap.set(doc.id, recordsById[i]));
      snapByCode.docs.forEach((doc, i) => uniqueRecordsMap.set(doc.id, recordsByCode[i]));
      
      const codeActuals = Array.from(uniqueRecordsMap.values());
      
      const totalToDate = codeActuals.reduce((sum, r) => sum + (Number(r.cost) || 0), 0);
      
      const currentPeriodId = project.reportingPeriods?.currentPeriodId;
      const currentPeriod = project.reportingPeriods?.periods.find(p => p.id === currentPeriodId);
      const currentPeriodNum = currentPeriod ? project.reportingPeriods?.periods.indexOf(currentPeriod) + 1 : -1;

      const totalThisPeriod = codeActuals
        .filter(a => {
          return a.reportingPeriodId === currentPeriodId || 
                 (currentPeriodNum !== -1 && String(a.reportingPeriodId) === String(currentPeriodNum));
        })
        .reduce((sum, r) => sum + (Number(r.cost) || 0), 0);

      await updateDoc(doc(db, 'costCodes', costCodeId), {
        actualCostToDate: totalToDate,
        actualCostThisPeriod: totalThisPeriod,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error syncing actual costs:", error);
    }
  }, [project.id, project.reportingPeriods]);

  const handleAddRecord = async () => {
    if (!isProjectAdmin) {
      toast.error("Only Project Admins can add actual costs.");
      return;
    }

    try {
      const newRecord = {
        projectId: project.id,
        costCodeId: '', // Leave blank as requested
        item: 'New Item',
        description: '',
        source: 'MAN',
        cost: 0,
        reportingPeriodId: project.reportingPeriods?.currentPeriodId || '',
        createdAt: new Date().toISOString(),
        enterpriseAttributes: {},
        projectAttributes: {}
      };
      await addDoc(collection(db, 'actualCosts'), newRecord);
      toast.success("Record added");

      // Scroll to the new record at the bottom
      setTimeout(() => {
        if (gridRef.current?.api) {
          const rowCount = gridRef.current.api.getDisplayedRowCount();
          if (rowCount > 0) {
            gridRef.current.api.ensureIndexVisible(rowCount - 1, 'bottom');
          }
        }
      }, 500);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'actualCosts');
      toast.error("Failed to add record");
    }
  };

  const handleDeleteRecord = async (id: string, costCodeId: string) => {
    if (!isProjectAdmin) {
      toast.error("Only Project Admins can delete actual costs.");
      return;
    }

    try {
      await deleteDoc(doc(db, 'actualCosts', id));
      toast.success("Record deleted");
      if (costCodeId) await syncActualCostsToCostCode(costCodeId);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `actualCosts/${id}`);
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
        batch.delete(doc(db, 'actualCosts', id));
      });

      await batch.commit();
      
      // Sync all affected cost codes
      for (const ccId of affectedCostCodeIds) {
        await syncActualCostsToCostCode(ccId);
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

  const chartData = useMemo(() => {
    const periods = project.reportingPeriods?.periods || [];
    let cumulative = 0;
    
    return periods.map((p, index) => {
      const periodicCost = records
        .filter(r => r.reportingPeriodId === p.id)
        .reduce((sum, r) => sum + (Number(r.cost) || 0), 0);
      
      cumulative += periodicCost;
      
      // Format date as Aug'26
      let formattedDate = (index + 1).toString();
      if (p.endDate) {
        try {
          formattedDate = format(parseISO(p.endDate), "MMM''yy");
        } catch (e) {
          console.error("Error formatting date:", e);
        }
      }
      
      return {
        name: formattedDate,
        periodNo: (index + 1).toString(),
        periodName: p.name,
        cost: periodicCost,
        cumulative: cumulative
      };
    });
  }, [records, project.reportingPeriods?.periods]);

  const handleExportExcel = () => {
    const periods = project.reportingPeriods?.periods || [];
    const enterpriseAttrs = (enterprise.lineItemAttributes || []).filter(a => a.title);
    const projectAttrs = (project.lineItemAttributes || []).filter(a => a.title);

    const data = records.map(r => {
      const exportRow: any = {
        'Cost Code ID': costCodes.find(cc => cc.id === r.costCodeId)?.code || '',
        'Item': r.item,
        'Description': r.description,
        'Source': r.source,
        'Cost': r.cost,
        'Reporting Period': periods.find(p => p.id === r.reportingPeriodId)?.name || '',
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
    XLSX.utils.book_append_sheet(wb, ws, 'Actual Costs');
    XLSX.writeFile(wb, `Actual_Costs_${project.projectName}_${new Date().toISOString().split('T')[0]}.xlsx`);
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

        const periods = project.reportingPeriods?.periods || [];
        const currentPeriodId = project.reportingPeriods?.currentPeriodId;
        const currentPeriodIndex = periods.findIndex(p => p.id === currentPeriodId);
        
        const errors: { row: number; msg: string; type: 'error' | 'warning' }[] = [];

        const findPeriod = (val: any) => {
          const strVal = String(val).trim();
          const numVal = parseInt(strVal);
          if (!isNaN(numVal) && numVal > 0 && numVal <= periods.length) {
            return periods[numVal - 1];
          }
          return periods.find(p => p.name === strVal);
        };

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
              errors.push({ row: rowNum, msg: `Cost Code "${costCodeValue}" not found in project`, type: 'error' });
            }
          }

          // Period Validation
          const periodValue = row['Reporting Period'];
          const period = findPeriod(periodValue);
          if (!period) {
            errors.push({ row: rowNum, msg: `Invalid Period: "${periodValue}"`, type: 'error' });
          } else {
            const pIdx = periods.findIndex(p => p.id === period.id);
            if (pIdx > currentPeriodIndex) {
              errors.push({ row: rowNum, msg: `Future Period (${pIdx + 1}) - Actuals not allowed`, type: 'error' });
            }
          }

          // Cost Validation
          if (isNaN(Number(row['Cost']))) {
            errors.push({ row: rowNum, msg: `Invalid Cost: "${row['Cost']}" (Must be a number)`, type: 'error' });
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
    const periods = project.reportingPeriods?.periods || [];
    const enterpriseAttrs = (enterprise.lineItemAttributes || []).filter(a => a.title);
    const projectAttrs = (project.lineItemAttributes || []).filter(a => a.title);
    const affectedCostCodeIds = new Set<string>();

    const findPeriod = (val: any) => {
      const strVal = String(val).trim();
      const numVal = parseInt(strVal);
      if (!isNaN(numVal) && numVal > 0 && numVal <= periods.length) {
        return periods[numVal - 1];
      }
      return periods.find(p => p.name === strVal);
    };

    setImportWizard(prev => ({ ...prev, phase: 'processing', progress: 0 }));

    const chunkSize = 400;
    const totalChunks = Math.ceil(data.length / chunkSize);
    
    try {
      for (let i = 0; i < totalChunks; i++) {
        const chunk = data.slice(i * chunkSize, (i + 1) * chunkSize);
        const batch = writeBatch(db);
        
        chunk.forEach(row => {
          const costCode = costCodes.find(cc => cc.code === String(row['Cost Code ID']).trim());
          const period = findPeriod(row['Reporting Period']);
          
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

          const newDocRef = doc(collection(db, 'actualCosts'));
          batch.set(newDocRef, {
            projectId: project.id,
            costCodeId: costCode?.id || '',
            item: row['Item'] || '',
            description: row['Description'] || '',
            source: row['Source'] || 'MAN',
            cost: Number(row['Cost']) || 0,
            reportingPeriodId: period?.id || '',
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

    // Validate future period
    if (colDef.field === 'reportingPeriodId') {
      const periods = project.reportingPeriods?.periods || [];
      const currentPeriodId = project.reportingPeriods?.currentPeriodId;
      const currentPeriodIndex = periods.findIndex(p => p.id === currentPeriodId);
      const newPeriodIndex = periods.findIndex(p => p.id === newValue);

      if (newPeriodIndex > currentPeriodIndex) {
        toast.error("Actual costs cannot be recorded for future periods.");
        event.node.setDataValue(colDef.field, oldValue);
        return;
      }
    }

    try {
      const updates: any = {
        ...data,
        updatedAt: new Date().toISOString()
      };
      delete updates.id;

      await updateDoc(doc(db, 'actualCosts', data.id), updates);
      
      // If costCodeId or cost changed, sync both old and new cost codes
      if (colDef.field === 'costCodeId' || colDef.field === 'cost' || colDef.field === 'reportingPeriodId') {
        if (data.costCodeId) await syncActualCostsToCostCode(data.costCodeId);
        if (colDef.field === 'costCodeId' && oldValue) {
          await syncActualCostsToCostCode(oldValue);
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `actualCosts/${data.id}`);
      toast.error("Failed to update record");
      event.node.setDataValue(colDef.field!, oldValue);
    }
  };

  const columnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    const periods = project.reportingPeriods?.periods || [];
    const currentPeriodId = project.reportingPeriods?.currentPeriodId;
    const currentPeriodIndex = periods.findIndex(p => p.id === currentPeriodId);
    const allowedPeriods = periods.slice(0, currentPeriodIndex + 1);

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
            headerName: 'Source',
            field: 'source',
            width: 100,
            editable: isProjectAdmin,
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: {
              values: ['MAN', 'ACC', 'FIN', 'REV'],
            },
            filter: 'agSetColumnFilter',
          },
          {
            headerName: 'Cost',
            field: 'cost',
            width: 120,
            type: 'numericColumn',
            editable: isProjectAdmin,
            valueFormatter: (params) => formatCurrency(params.value),
            aggFunc: 'sum',
          },
          {
            headerName: 'Reporting Period',
            field: 'reportingPeriodId',
            width: 180,
            editable: isProjectAdmin,
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: {
              values: allowedPeriods.map(p => p.id),
            },
            valueFormatter: (params) => {
              const index = periods.findIndex(p => p.id === params.value);
              return index !== -1 ? (index + 1).toString() : '';
            },
            filter: 'agSetColumnFilter',
            filterParams: {
              valueFormatter: (params: any) => {
                const index = periods.findIndex(p => p.id === params.value);
                return index !== -1 ? (index + 1).toString() : params.value;
              }
            }
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

  const totalActualCost = useMemo(() => records.reduce((sum, r) => sum + (Number(r.cost) || 0), 0), [records]);

  const pinnedTopRowData = useMemo(() => {
    if (records.length === 0) return [];
    return [{
      costCodeId: 'SubTotal',
      item: 'TOTAL ACTUALS',
      cost: totalActualCost,
      isPinned: true
    }];
  }, [records, totalActualCost]);

  const currentPeriodId = project.reportingPeriods?.currentPeriodId;
  const currentPeriodCost = useMemo(() => 
    records.filter(r => r.reportingPeriodId === currentPeriodId).reduce((sum, r) => sum + (Number(r.cost) || 0), 0),
    [records, currentPeriodId]
  );

  return (
    <div className="flex-1 flex flex-col p-8 overflow-hidden bg-gray-50/50 dark:bg-transparent h-full">
      <DataGridModule
        title="Actual Cost Management"
        description="Track and manage project expenditures and actual costs."
        icon={<DollarSign className="w-4 h-4 text-gray-400" />}
        searchPlaceholder="Search transactions..."
        quickFilterText={quickFilterText}
        onQuickFilterChange={setQuickFilterText}
        onImport={() => fileInputRef.current?.click()}
        onExport={handleExportExcel}
        onAdd={handleAddRecord}
        selectedCount={selectedIds.size}
        onBulkDelete={() => setIsDeleteConfirmOpen(true)}
        extraToolbarActions={
          <Button 
            variant="outline"
            size="sm"
            className={cn(
              "rounded-xl border-gray-200 dark:border-white/10 transition-all",
              isChartVisible && "bg-black text-white dark:bg-white dark:text-black shadow-lg"
            )}
            onClick={() => setIsChartVisible(!isChartVisible)}
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            Histogram
          </Button>
        }
        topContent={
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="rounded-2xl border-gray-200 dark:border-white/10 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Total Actual Cost (To Date)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold dark:text-white">{formatCurrency(totalActualCost)}</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-gray-200 dark:border-white/10 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Actual Cost (This Period)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold dark:text-white">{formatCurrency(currentPeriodCost)}</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-gray-200 dark:border-white/10 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Total Transactions</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold dark:text-white">{records.length}</p>
                </CardContent>
              </Card>
            </div>

            <AnimatePresence>
              {isChartVisible && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="bg-white dark:bg-[#141414] rounded-2xl border border-gray-200 dark:border-white/10 p-6 overflow-hidden shadow-sm"
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-blue-500" />
                        <h3 className="text-sm font-bold dark:text-white uppercase tracking-widest">Cost Distribution & Cumulative Flow</h3>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-sm bg-blue-500" />
                          <span className="text-[10px] font-bold text-gray-500 uppercase">Periodic Cost</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-0.5 bg-emerald-500" />
                          <span className="text-[10px] font-bold text-gray-500 uppercase">Cumulative Cost</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="h-80 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#333' : '#eee'} />
                          <XAxis 
                            dataKey="name" 
                            fontSize={10} 
                            tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                            axisLine={false}
                            tickLine={false}
                            label={{ value: 'Reporting Period', position: 'insideBottom', offset: -10, fontSize: 10, fill: '#999' }}
                          />
                          <YAxis 
                            yAxisId="left"
                            fontSize={10} 
                            tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                            domain={[0, 'auto']}
                          />
                          <YAxis 
                            yAxisId="right"
                            orientation="right"
                            fontSize={10} 
                            tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                            domain={[0, 'auto']}
                          />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: theme === 'dark' ? '#141414' : '#fff',
                              borderColor: theme === 'dark' ? '#333' : '#eee',
                              borderRadius: '12px',
                              fontSize: '11px',
                              padding: '12px',
                              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                            }}
                            formatter={(val: number) => [`$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, '']}
                            labelFormatter={(label) => `Period ${label}`}
                          />
                          <Bar 
                            yAxisId="left" 
                            dataKey="cost" 
                            name="Periodic Cost" 
                            fill="#3b82f6" 
                            radius={[4, 4, 0, 0]} 
                            barSize={30}
                          >
                            <LabelList 
                              dataKey="cost" 
                              position="top" 
                              formatter={(val: number) => val > 0 ? `${Math.round(val / 1000)}k` : ''} 
                              style={{ fill: theme === 'dark' ? '#fff' : '#000', fontWeight: 'bold', fontSize: '10px' }}
                            />
                          </Bar>
                          <Line 
                            yAxisId="right" 
                            type="monotone" 
                            dataKey="cumulative" 
                            name="Cumulative Cost" 
                            stroke="#10b981" 
                            strokeWidth={3} 
                            dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: theme === 'dark' ? '#141414' : '#fff' }} 
                            activeDot={{ r: 6, strokeWidth: 0 }}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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
            minWidth: 100,
            enableRowGroup: true,
            enablePivot: true,
            enableValue: true,
          },
          sideBar: sideBar,
          statusBar: statusBar,
          loading: isLoading,
          rowSelection: "multiple",
          suppressRowClickSelection: true,
          enableRangeSelection: true,
          enableFillHandle: true,
          undoRedoCellEditing: true,
          enableCellTextSelection: true,
          pagination: true,
          paginationPageSize: 100,
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
                  {importWizard.phase === 'preview' ? 'Import Preview' : 'Processing Import'}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  {importWizard.phase === 'preview' 
                    ? `Reviewing ${importWizard.data.length} transactions from Excel.` 
                    : `Please wait while we process ${importWizard.total} records.`}
                </DialogDescription>
              </div>
              <Badge variant={importWizard.errors.some(e => e.type === 'error') ? 'destructive' : 'secondary'} className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest">
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
                    <div className="flex items-center gap-2 mb-2 text-red-600 font-bold text-xs uppercase tracking-wider">
                      <AlertCircle className="w-4 h-4" />
                      Critical Validation Errors
                    </div>
                    <ScrollArea className="h-24">
                      <ul className="space-y-1">
                        {importWizard.errors.map((err, i) => (
                          <li key={i} className="text-[11px] text-red-700 dark:text-red-400 flex gap-2">
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
                    <thead className="sticky top-0 bg-white dark:bg-[#1a1a1a] shadow-sm z-10">
                      <tr className="border-b border-gray-200 dark:border-white/10 uppercase tracking-widest text-gray-500 transition-colors">
                        <th className="py-2 px-4 font-bold">#</th>
                        <th className="py-2 px-4 font-bold">Cost Code ID</th>
                        <th className="py-2 px-4 font-bold">Item</th>
                        <th className="py-2 px-4 font-bold">Reporting Period</th>
                        <th className="py-2 px-4 font-bold text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                      {importWizard.data.slice(0, 100).map((row, i) => (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group">
                          <td className="py-2 px-4 font-mono text-gray-400">{i + 1}</td>
                          <td className="py-2 px-4 font-bold text-blue-600 dark:text-blue-400">{row['Cost Code ID']}</td>
                          <td className="py-2 px-4">{row['Item']}</td>
                          <td className="py-2 px-4">{row['Reporting Period']}</td>
                          <td className="py-2 px-4 text-right font-mono font-bold">{formatCurrency(row['Cost'])}</td>
                        </tr>
                      ))}
                      {importWizard.data.length > 100 && (
                        <tr>
                          <td colSpan={5} className="py-4 text-center text-gray-400 italic">
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
                  {/* Circular Progress (Stylized) */}
                  <svg className="w-full h-full rotate-[-90deg]">
                    <circle
                      cx="96" cy="96" r="80"
                      fill="none" stroke="currentColor" strokeWidth="12"
                      className="text-gray-100 dark:text-white/5"
                    />
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
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Complete</span>
                  </div>
                </div>

                <div className="w-full max-w-md space-y-2">
                  <div className="flex justify-between text-xs font-bold text-gray-500 uppercase tracking-widest">
                    <span>Processed {importWizard.processed} records</span>
                    <span>Total {importWizard.total}</span>
                  </div>
                  <div className="h-3 w-full bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${importWizard.progress}%` }}
                      className="h-full bg-blue-600 rounded-full"
                    />
                  </div>
                  <p className="text-center text-sm text-gray-500 animate-pulse mt-4 italic font-medium">
                    Saving transactions in robust chunks to ensure stability...
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
              className="rounded-xl px-6 font-bold"
            >
              Cancel
            </Button>
            {importWizard.phase === 'preview' && (
              <Button 
                onClick={executeImport}
                disabled={importWizard.errors.some(e => e.type === 'error')}
                className="bg-black dark:bg-white text-white dark:text-black rounded-xl px-8 font-bold flex items-center gap-2 hover:opacity-90 shadow-xl shadow-black/20"
              >
                <Upload className="w-4 h-4" />
                Proceed with Import
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ActualCost;
