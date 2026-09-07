import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Project, Enterprise, CostCode, Subcontract, ScheduleItem } from '../types';
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
  addDoc
} from 'firebase/firestore';
import { 
  Search, 
  Download, 
  Filter, 
  RefreshCw,
  Activity,
  Calculator,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  BarChart3,
  Upload,
  Edit2
} from 'lucide-react';
import { 
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area
} from 'recharts';
import { AgGridReact } from 'ag-grid-react';
import { 
  ColDef, 
  ColGroupDef,
  ValueFormatterParams
} from 'ag-grid-community';
import { cn, formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import DataGridModule from './DataGridModule';
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

interface GlobalTimephasingProps {
  project: Project;
  enterprise: Enterprise;
  theme?: 'light' | 'dark';
}

export default function GlobalTimephasing({ project, enterprise, theme = 'light' }: GlobalTimephasingProps) {
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [subcontracts, setSubcontracts] = useState<Subcontract[]>([]);
  const [loading, setLoading] = useState(true);
  const [timephasingRows, setTimephasingRows] = useState<any[]>([]);
  const [isTimephasingLoading, setIsTimephasingLoading] = useState(false);
  const [quickFilterText, setQuickFilterText] = useState('');
  const [isChartVisible, setIsChartVisible] = useState(false);
  const [chartMode, setChartMode] = useState<'value' | 'percent'>('value');
  const [isBulkUpdateOpen, setIsBulkUpdateOpen] = useState(false);
  const [selectedRowCount, setSelectedRowCount] = useState(0);
  const [bulkUpdateData, setBulkUpdateData] = useState<{
    phasingSource?: string;
    startDate?: string;
    endDate?: string;
    distribution?: string;
  }>({});
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const gridRef = useRef<AgGridReact>(null);

  const dateFormatter = (params: any) => {
    if (!params.value) return '';
    const date = params.value instanceof Date ? params.value : new Date(params.value);
    if (isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const currencyFormatter = useCallback((params: ValueFormatterParams) => {
    return formatCurrency(params.value);
  }, []);

  const safeDateSetter = (field: string) => (params: any) => {
    const val = params.newValue;
    if (!val) {
      params.data[field] = '';
      return true;
    }
    const date = val instanceof Date ? val : new Date(val);
    if (isNaN(date.getTime())) return false;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    params.data[field] = `${y}-${m}-${d}`;
    return true;
  };

  // Fetch all cost codes
  useEffect(() => {
    const q = query(
      collection(db, 'costCodes'), 
      where('projectId', '==', project.id)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allCodes = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as CostCode));
      
      // Filter codes based on assignedUsers
      const currentUser = auth.currentUser;
      const isAdmin = project.users[currentUser?.uid || ''] === 'Project Admin';
      
      const filteredCodes = isAdmin 
        ? allCodes 
        : allCodes.filter(code => 
            !code.assignedUsers || 
            code.assignedUsers.length === 0 || 
            code.assignedUsers.includes(currentUser?.uid || '')
          );

      setCostCodes(filteredCodes);
      setLoading(false);
    }, (error) => {
      console.error("Cost codes fetch error:", error);
      toast.error("Failed to fetch cost codes.");
      setLoading(false);
    });
    return () => unsubscribe();
  }, [project.id, project.users]);

  // Fetch all subcontracts
  useEffect(() => {
    const q = query(
      collection(db, 'subcontracts'),
      where('projectId', '==', project.id)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSubcontracts(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Subcontract)));
    });
    return () => unsubscribe();
  }, [project.id]);

  // Fetch all schedule items
  useEffect(() => {
    const q = query(
      collection(db, 'scheduleItems'),
      where('projectId', '==', project.id)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setScheduleItems(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ScheduleItem)));
    });
    return () => unsubscribe();
  }, [project.id]);

  // Fetch all phasing data and construct rows
  useEffect(() => {
    if (costCodes.length === 0) return;

    setIsTimephasingLoading(true);
    
    const fetchData = async () => {
      try {
        const periods = project.reportingPeriods?.periods || [];
        const currentPeriodId = project.reportingPeriods?.currentPeriodId;
        const currentPeriodIndex = periods.findIndex(p => p.id === currentPeriodId);
        
        // 1. Get ALL Phasing data for the project
        const phasingQuery = query(
          collection(db, 'costPhasing'),
          where('projectId', '==', project.id)
        );
        const phasingSnap = await getDocs(phasingQuery);
        const allPhasing = phasingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

        // 2. Get ALL Actuals for the project
        const actualsQuery = query(
          collection(db, 'actualCosts'),
          where('projectId', '==', project.id)
        );
        const actualsSnap = await getDocs(actualsQuery);
        const allActuals = actualsSnap.docs.map(doc => doc.data());

        // 3. Get ALL ETC Details for the project
        const etcQuery = query(
          collection(db, 'etcDetails'),
          where('projectId', '==', project.id)
        );
        const etcSnap = await getDocs(etcQuery);
        const allEtcDetails = etcSnap.docs.map(doc => doc.data());

        // 4. Construct Rows for each cost code
        const allRows: any[] = [];

        costCodes.forEach(code => {
          const codePhasing = allPhasing.filter((p: any) => p.costCodeId === code.code);
          const baselineDoc = codePhasing.find((p: any) => p.type === 'baseline');
          const approvedDoc = codePhasing.find((p: any) => p.type === 'approved');
          const eacDoc = codePhasing.find((p: any) => p.type === 'eac');

          const filteredActuals = allActuals.filter((a: any) => a.costCodeId === code.id || a.costCodeId === code.code);
          const actualsByPeriod: Record<string, number> = {};
          filteredActuals.forEach((a: any) => {
            actualsByPeriod[a.reportingPeriodId] = (actualsByPeriod[a.reportingPeriodId] || 0) + (a.cost || 0);
          });

          const etcDetails = allEtcDetails.filter((etc: any) => etc.costCode === code.code);
          const etcByPeriod: Record<string, number> = {};
          const futurePeriodIds = periods.slice(currentPeriodIndex + 1).map(p => p.id);
          etcDetails.forEach((etc: any) => {
            if (etc.periodValues) {
              Object.entries(etc.periodValues).forEach(([periodId, value]) => {
                if (futurePeriodIds.includes(periodId)) {
                  etcByPeriod[periodId] = (etcByPeriod[periodId] || 0) + (Number(value) || 0) * (etc.rate || 0);
                }
              });
            }
          });

          // Subcontract Phasing Aggregation
          const subphasingByPeriod: Record<string, number> = {};
          const matchCode = code.code.trim().toUpperCase();
          
          subcontracts.forEach(sub => {
            (sub.lineItems || []).forEach(li => {
              if (li.status === 'Rejected') return;
              
              const rawId = li.costCodeId;
              const assignedCodeId = (rawId && rawId.trim() !== '') ? rawId : sub.defaultCostCodeId;
              if (!assignedCodeId) return;

              const assignedClean = assignedCodeId.toString().trim().toUpperCase();
              const assignedCodeOnly = assignedClean.split(' - ')[0].trim();

              let isMatch = (assignedClean === matchCode || assignedCodeOnly === matchCode);
              if (!isMatch) {
                const targetId = (code.id || '').toString().trim().toUpperCase();
                const targetCodeValue = (code.code || '').toString().trim().toUpperCase();
                if (assignedClean === targetId || assignedCodeOnly === targetId || assignedClean === targetCodeValue || assignedCodeOnly === targetCodeValue) {
                  isMatch = true;
                }
              }

              if (isMatch && li.periodValues) {
                Object.entries(li.periodValues).forEach(([pid, val]) => {
                  subphasingByPeriod[pid] = (subphasingByPeriod[pid] || 0) + (Number(val) || 0);
                });
              }
            });
          });

          // Baseline Row
          allRows.push({
            id: `${code.code}_baseline`,
            costCode: code.code,
            costCodeName: code.name,
            type: 'Baseline Budget',
            rowType: 'baseline',
            phasingSource: baselineDoc?.phasingSource || 'Manual',
            startDate: baselineDoc?.startDate ? new Date(baselineDoc.startDate) : '',
            endDate: baselineDoc?.endDate ? new Date(baselineDoc.endDate) : '',
            distribution: baselineDoc?.distribution || 'Even',
            activityId: baselineDoc?.activityId || '',
            periodValues: periods.reduce((acc, p) => {
              const source = baselineDoc?.phasingSource || 'Manual';
              if (source === 'SubContract') {
                acc[p.id] = subphasingByPeriod[p.id] || 0;
              } else {
                acc[p.id] = baselineDoc?.periodValues?.[p.id] || 0;
              }
              return acc;
            }, {} as Record<string, number>),
            totalFromCode: code.baselineBudget || 0,
            docId: baselineDoc?.id
          });

          // Approved Row
          allRows.push({
            id: `${code.code}_approved`,
            costCode: code.code,
            costCodeName: code.name,
            type: 'Approved Budget',
            rowType: 'approved',
            phasingSource: approvedDoc?.phasingSource || 'Manual',
            startDate: approvedDoc?.startDate ? new Date(approvedDoc.startDate) : '',
            endDate: approvedDoc?.endDate ? new Date(approvedDoc.endDate) : '',
            distribution: approvedDoc?.distribution || 'Even',
            activityId: approvedDoc?.activityId || '',
            periodValues: periods.reduce((acc, p) => {
              const source = approvedDoc?.phasingSource || 'Manual';
              if (source === 'SubContract') {
                acc[p.id] = subphasingByPeriod[p.id] || 0;
              } else {
                acc[p.id] = approvedDoc?.periodValues?.[p.id] || 0;
              }
              return acc;
            }, {} as Record<string, number>),
            totalFromCode: code.approvedBudget || 0,
            docId: approvedDoc?.id
          });

          // EAC Row
          allRows.push({
            id: `${code.code}_eac`,
            costCode: code.code,
            costCodeName: code.name,
            type: 'Estimate At Completion',
            rowType: 'eac',
            phasingSource: eacDoc?.phasingSource || 'ETC Details',
            startDate: eacDoc?.startDate ? new Date(eacDoc.startDate) : '',
            endDate: eacDoc?.endDate ? new Date(eacDoc.endDate) : '',
            distribution: eacDoc?.distribution || 'Even',
            activityId: eacDoc?.activityId || '',
            totalFromCode: code.estimateAtCompletion || 0,
            docId: eacDoc?.id,
            periodValues: periods.reduce((acc, p, idx) => {
              const phasingSource = eacDoc?.phasingSource || 'ETC Details';
              if (phasingSource === 'ETC Details') {
                if (idx <= currentPeriodIndex) {
                  acc[p.id] = actualsByPeriod[p.id] || 0;
                } else {
                  acc[p.id] = etcByPeriod[p.id] || 0;
                }
              } else if (phasingSource === 'SubContract') {
                if (idx <= currentPeriodIndex) {
                  acc[p.id] = actualsByPeriod[p.id] || 0;
                } else {
                  acc[p.id] = subphasingByPeriod[p.id] || 0;
                }
              } else {
                acc[p.id] = eacDoc?.periodValues?.[p.id] || 0;
                if (idx <= currentPeriodIndex) {
                  acc[p.id] = actualsByPeriod[p.id] || 0;
                }
              }
              return acc;
            }, {} as Record<string, number>)
          });

          // EAC Previous Row (for chart only)
          const eacPrevDoc = codePhasing.find((p: any) => p.type === 'eacPrevious');
          if (eacPrevDoc) {
            allRows.push({
              id: `${code.code}_eac_prev`,
              costCode: code.code,
              costCodeName: code.name,
              type: 'EAC Previous',
              rowType: 'eacPrevious',
              periodValues: eacPrevDoc.periodValues || {},
              totalFromCode: code.estimateAtCompletionPrevious || 0,
              docId: eacPrevDoc.id,
              hidden: true
            });
          }
        });

        setTimephasingRows(allRows);
        setIsTimephasingLoading(false);
      } catch (error) {
        console.error("Error fetching global timephasing data:", error);
        setIsTimephasingLoading(false);
      }
    };

    fetchData();
  }, [costCodes, project.id, project.reportingPeriods, refreshTrigger, subcontracts]);

  const calculatePhasing = useCallback((
    total: number,
    startDate: string | Date,
    endDate: string | Date,
    distribution: string,
    periods: any[],
    existingPeriodValues?: Record<string, number>
  ) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) return {};

    const periodValues: Record<string, number> = {};
    const activePeriods = periods.filter(p => {
      const pStart = new Date(p.startDate);
      const pEnd = new Date(p.endDate);
      return (pStart <= end && pEnd >= start);
    });

    if (activePeriods.length === 0) return {};

    const n = activePeriods.length;
    let weights: number[] = [];

    switch (distribution) {
      case 'Even':
        weights = new Array(n).fill(1);
        break;
      case 'Front load':
        weights = activePeriods.map((_, i) => n - i);
        break;
      case 'Back load':
        weights = activePeriods.map((_, i) => i + 1);
        break;
      case 'Bell Curve':
        weights = activePeriods.map((_, i) => {
          const x = (i - (n - 1) / 2) / (n / 4 || 1);
          return Math.exp(-0.5 * x * x);
        });
        break;
      case 'S-Curve':
        weights = activePeriods.map((_, i) => {
          const x = (i / (n - 1 || 1)) * 10 - 5;
          const sigmoid = 1 / (1 + Math.exp(-x));
          const prevX = ((i - 1) / (n - 1 || 1)) * 10 - 5;
          const prevSigmoid = i === 0 ? 0 : 1 / (1 + Math.exp(-prevX));
          return sigmoid - prevSigmoid;
        });
        break;
      case 'Profile':
        if (existingPeriodValues) {
          weights = activePeriods.map(p => existingPeriodValues[p.id] || 0);
          const weightSum = weights.reduce((a, b) => a + b, 0);
          if (weightSum === 0) {
            weights = new Array(n).fill(1);
          }
        } else {
          weights = new Array(n).fill(1);
        }
        break;
      default:
        weights = new Array(n).fill(1);
    }

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    activePeriods.forEach((p, i) => {
      periodValues[p.id] = (weights[i] / (totalWeight || 1)) * total;
    });

    return periodValues;
  }, []);

  const handleCalculateAutoPhasing = useCallback(async () => {
    const selectedNodes = gridRef.current?.api.getSelectedNodes();
    const selectedRows = selectedNodes?.map(node => node.data) || [];
    
    let rowsToProcess = [];
    if (selectedRows.length > 0) {
      rowsToProcess = selectedRows.filter(r => r.phasingSource === 'Auto');
      if (rowsToProcess.length === 0) {
        toast.info("Selected rows are not set to 'Auto' phasing source.");
        return;
      }
    } else {
      rowsToProcess = timephasingRows.filter(r => r.phasingSource === 'Auto');
      if (rowsToProcess.length === 0) {
        toast.info("No rows set to 'Auto' phasing source.");
        return;
      }
    }

    setIsTimephasingLoading(true);
    try {
      const batch = writeBatch(db);
      const periods = project.reportingPeriods?.periods || [];
      const currentPeriodId = project.reportingPeriods?.currentPeriodId;
      const currentPeriod = periods.find(p => p.id === currentPeriodId);
      const currentPeriodEnd = currentPeriod ? new Date(currentPeriod.endDate) : null;
      const currentIndex = periods.findIndex(p => p.id === currentPeriodId);
      const nextPeriodStart = (currentIndex !== -1 && currentIndex < periods.length - 1) 
        ? periods[currentIndex + 1].startDate 
        : null;

      let updatedCount = 0;

      for (const row of rowsToProcess) {
        if (row.startDate && row.endDate && row.distribution) {
          let total = row.totalFromCode || 0;
          let effectiveStartDate = row.startDate;

          // SPECIAL LOGIC FOR EAC
          if (row.rowType === 'eac') {
            const code = costCodes.find(c => c.code === row.costCode);
            total = code?.estimateToComplete || 0;
            
            if (currentPeriodEnd && nextPeriodStart) {
              const userStart = new Date(row.startDate);
              if (userStart <= currentPeriodEnd) {
                effectiveStartDate = nextPeriodStart;
              }
            }
          }

          const newPhasing = calculatePhasing(
            total,
            effectiveStartDate,
            row.endDate,
            row.distribution,
            periods,
            row.periodValues
          );

          const updatePayload = {
            projectId: project.id,
            costCodeId: row.costCode,
            type: row.rowType,
            phasingSource: 'Auto',
            startDate: row.startDate instanceof Date ? row.startDate.toISOString() : row.startDate,
            endDate: row.endDate instanceof Date ? row.endDate.toISOString() : row.endDate,
            distribution: row.distribution,
            periodValues: newPhasing,
            updatedAt: new Date().toISOString()
          };

          if (row.docId) {
            batch.update(doc(db, 'costPhasing', row.docId), updatePayload);
          } else {
            batch.set(doc(collection(db, 'costPhasing')), updatePayload);
          }
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        await batch.commit();
        toast.success(`Recalculated phasing for ${updatedCount} row(s)`);
        setRefreshTrigger(prev => prev + 1);
      } else {
        toast.warning("Incomplete auto-phasing settings (Dates or Distribution missing)");
      }
    } catch (error) {
      console.error("Error calculating auto phasing:", error);
      toast.error("Failed to calculate auto phasing");
    } finally {
      setIsTimephasingLoading(false);
    }
  }, [project.id, project.reportingPeriods, costCodes, timephasingRows, calculatePhasing]);

  const onCellValueChanged = useCallback(async (params: any) => {
    const { data, colDef, newValue, oldValue } = params;
    if (newValue === oldValue) return;

    const field = colDef.field;
    const isPeriodValue = field?.startsWith('periodValues.');

    try {
      const updatePayload: any = {
        projectId: project.id,
        costCodeId: data.costCode,
        type: data.rowType,
        updatedAt: new Date().toISOString()
      };

      if (isPeriodValue) {
        updatePayload.periodValues = data.periodValues;
      } else {
        updatePayload[field] = newValue instanceof Date ? newValue.toISOString() : newValue;
        
        // Auto-populate dates if Activity ID changes
        if (field === 'activityId' && newValue) {
          const scheduleItem = scheduleItems.find(s => s.activityId === newValue);
          if (scheduleItem) {
            let startDate = '';
            let endDate = '';
            
            if (data.rowType === 'baseline') {
              startDate = scheduleItem.baselineStartDate;
              endDate = scheduleItem.baselineEndDate;
            } else if (data.rowType === 'approved') {
              startDate = scheduleItem.plannedStartDate;
              endDate = scheduleItem.plannedEndDate;
            } else if (data.rowType === 'eac') {
              startDate = scheduleItem.currentStartDate;
              endDate = scheduleItem.currentEndDate;
            }
            
            if (startDate) updatePayload.startDate = startDate;
            if (endDate) updatePayload.endDate = endDate;
            
            // Update local row data for immediate feedback
            data.startDate = startDate ? new Date(startDate) : '';
            data.endDate = endDate ? new Date(endDate) : '';
            params.api.applyTransaction({ update: [data] });
          }
        }
      }

      if (data.docId) {
        await updateDoc(doc(db, 'costPhasing', data.docId), updatePayload);
      } else {
        const docRef = await addDoc(collection(db, 'costPhasing'), updatePayload);
        data.docId = docRef.id;
      }
      
      if (field === 'activityId') {
        toast.success('Synced dates from schedule');
        setRefreshTrigger(prev => prev + 1);
      }
    } catch (error) {
      console.error("Error updating phasing cell:", error);
      toast.error("Failed to save changes");
    }
  }, [project.id, scheduleItems]);

  const handleBulkUpdate = async () => {
    const selectedNodes = gridRef.current?.api.getSelectedNodes();
    const selectedRows = selectedNodes?.map(node => node.data) || [];

    if (selectedRows.length === 0) {
      toast.warning("Please select rows to bulk update");
      return;
    }

    setIsTimephasingLoading(true);
    try {
      const batch = writeBatch(db);
      let updatedCount = 0;

      for (const row of selectedRows) {
        const updatePayload: any = {
          projectId: project.id,
          costCodeId: row.costCode,
          type: row.rowType,
          updatedAt: new Date().toISOString()
        };

        if (bulkUpdateData.phasingSource) updatePayload.phasingSource = bulkUpdateData.phasingSource;
        if (bulkUpdateData.startDate) updatePayload.startDate = bulkUpdateData.startDate;
        if (bulkUpdateData.endDate) updatePayload.endDate = bulkUpdateData.endDate;
        if (bulkUpdateData.distribution) updatePayload.distribution = bulkUpdateData.distribution;

        if (row.docId) {
          batch.update(doc(db, 'costPhasing', row.docId), updatePayload);
        } else {
          batch.set(doc(collection(db, 'costPhasing')), updatePayload);
        }
        updatedCount++;
      }

      await batch.commit();
      toast.success(`Bulk updated ${updatedCount} row(s)`);
      setIsBulkUpdateOpen(false);
      setBulkUpdateData({});
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      console.error("Error bulk updating phasing:", error);
      toast.error("Failed to bulk update");
    } finally {
      setIsTimephasingLoading(false);
    }
  };

  const columnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    const periods = project.reportingPeriods?.periods || [];
    const currentPeriodId = project.reportingPeriods?.currentPeriodId;
    const currentPeriodIndex = periods.findIndex(p => p.id === currentPeriodId);

    return [
      {
        headerName: 'Cost Code',
        field: 'costCode',
        sort: 'asc',
        width: 150,
        pinned: 'left',
        lockPosition: 'left',
        suppressMovable: true,
        rowSpan: (params) => {
          if (params.data.rowType === 'baseline') return 3;
          return 1;
        },
        cellStyle: (params) => {
          if (params.data.rowType === 'baseline') {
            return { 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              textAlign: 'center',
              fontWeight: 'bold',
              backgroundColor: theme === 'dark' ? '#1a1a1a' : '#f8fafc',
              borderBottom: theme === 'dark' ? '1px solid rgba(255,255,255,0.1)' : '1px solid #e2e8f0',
            };
          }
          return {};
        },
        cellClassRules: {
          'hidden': (params) => params.data.rowType !== 'baseline'
        },
        valueGetter: (params) => `${params.data.costCode} - ${params.data.costCodeName}`,
        tooltipValueGetter: (params) => params.value,
      },
      {
        headerName: 'Type',
        field: 'type',
        width: 180,
        pinned: 'left',
        lockPosition: 'left',
        suppressMovable: true,
        checkboxSelection: true,
        headerCheckboxSelection: true,
        headerCheckboxSelectionFilteredOnly: true,
        cellClass: 'font-bold bg-slate-50 dark:bg-slate-900',
      },
      {
        headerName: 'Activity ID',
        field: 'activityId',
        width: 150,
        editable: (params: any) => params.data.phasingSource === 'Auto',
        cellEditor: 'agRichSelectCellEditor',
        cellEditorParams: {
          values: scheduleItems.map(item => item.activityId).sort(),
          formatValue: (val: string) => {
            const item = scheduleItems.find(i => i.activityId === val);
            return item ? `${item.activityId} - ${item.description}` : val;
          },
          searchType: 'match',
          allowTyping: true,
          filterList: true,
          highlightMatch: true
        },
        cellClass: (params: any) => params.data.phasingSource === 'Auto' ? 'bg-white dark:bg-slate-900 border-l-2 border-l-emerald-500' : 'bg-slate-50 dark:bg-slate-900/50',
      },
      {
        headerName: 'Phasing Source',
        field: 'phasingSource',
        width: 130,
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: (params: any) => {
          if (params.data.rowType === 'eac') {
            return { values: ['ETC Details', 'SubContract', 'Manual', 'Auto'] };
          }
          return { values: ['Manual', 'Auto'] };
        },
        cellClass: 'bg-white dark:bg-slate-900',
      },
      {
        headerName: 'Start Date',
        field: 'startDate',
        width: 120,
        editable: (params: any) => params.data.phasingSource === 'Auto' && !params.data.activityId,
        valueGetter: (params) => {
          const val = params.data.startDate;
          if (!val) return null;
          const d = val instanceof Date ? val : new Date(val);
          return isNaN(d.getTime()) ? null : d;
        },
        valueFormatter: dateFormatter,
        valueSetter: safeDateSetter('startDate'),
        cellEditor: 'agDateCellEditor',
        cellClass: (params: any) => params.data.phasingSource === 'Auto' ? 'bg-white dark:bg-slate-900' : 'bg-slate-50 dark:bg-slate-900/50',
      },
      {
        headerName: 'End Date',
        field: 'endDate',
        width: 120,
        editable: (params: any) => params.data.phasingSource === 'Auto' && !params.data.activityId,
        valueGetter: (params) => {
          const val = params.data.endDate;
          if (!val) return null;
          const d = val instanceof Date ? val : new Date(val);
          return isNaN(d.getTime()) ? null : d;
        },
        valueFormatter: dateFormatter,
        valueSetter: safeDateSetter('endDate'),
        cellEditor: 'agDateCellEditor',
        cellClass: (params: any) => params.data.phasingSource === 'Auto' ? 'bg-white dark:bg-slate-900' : 'bg-slate-50 dark:bg-slate-900/50',
      },
      {
        headerName: 'Distribution',
        field: 'distribution',
        width: 130,
        editable: (params: any) => params.data.phasingSource === 'Auto',
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: {
          values: ['Even', 'Bell Curve', 'Front load', 'Back load', 'S-Curve', 'Profile']
        },
        cellClass: (params: any) => params.data.phasingSource === 'Auto' ? 'bg-white dark:bg-slate-900' : 'bg-slate-50 dark:bg-slate-900/50',
      },
      {
        headerName: 'Total Phased',
        width: 130,
        type: 'numericColumn',
        valueFormatter: currencyFormatter,
        valueGetter: (params) => {
          if (!params.data?.periodValues) return 0;
          return Object.values(params.data.periodValues).reduce((acc: number, val: any) => acc + (Number(val) || 0), 0);
        },
        cellClass: 'font-bold bg-slate-100 dark:bg-slate-800',
      },
      {
        headerName: 'Total',
        field: 'totalFromCode',
        width: 130,
        type: 'numericColumn',
        valueFormatter: currencyFormatter,
        cellClass: 'font-bold bg-slate-50 dark:bg-slate-900 text-blue-600',
      },
      {
        headerName: 'Difference',
        width: 130,
        type: 'numericColumn',
        valueFormatter: currencyFormatter,
        valueGetter: (params) => {
          const totalPhased = Object.values(params.data?.periodValues || {}).reduce((acc: number, val: any) => acc + (Number(val) || 0), 0) as number;
          const totalFromCode = (params.data?.totalFromCode || 0) as number;
          return totalPhased - totalFromCode;
        },
        cellClassRules: {
          'text-red-600 font-bold': (params: any) => Math.abs(Number(params.value)) > 0.01,
          'text-emerald-600 font-bold': (params: any) => Math.abs(Number(params.value)) <= 0.01,
        },
        cellClass: 'bg-slate-50 dark:bg-slate-900',
      },
      {
        headerName: 'Periods',
        children: periods.map(p => {
          const date = new Date(p.endDate);
          const month = date.toLocaleString('default', { month: 'short' });
          const year = date.getFullYear().toString().slice(-2);
          const periodNumber = periods.findIndex(per => per.id === p.id) + 1;
          const headerName = `P${periodNumber}\n(${month}'${year})`;
          const periodIndex = periods.findIndex(per => per.id === p.id);

          return {
            headerName,
            field: `periodValues.${p.id}`,
            width: 120,
            minWidth: 110,
            type: 'numericColumn',
            valueFormatter: currencyFormatter,
            editable: (params: any) => {
              if (params.data.rowType === 'baseline' || params.data.rowType === 'approved') {
                return params.data.phasingSource === 'Manual';
              }
              if (params.data.rowType === 'eac') {
                return params.data.phasingSource === 'Manual' && periodIndex > currentPeriodIndex;
              }
              return false;
            },
            cellClass: (params: any) => {
              const isEditable = (params.data.rowType === 'baseline' || params.data.rowType === 'approved') 
                ? params.data.phasingSource === 'Manual'
                : params.data.phasingSource === 'Manual' && periodIndex > currentPeriodIndex;
              return isEditable ? 'bg-white dark:bg-slate-900' : 'bg-slate-50 dark:bg-slate-900/50 text-gray-500';
            },
            valueGetter: (params: any) => params.data.periodValues?.[p.id] || 0,
            valueSetter: (params: any) => {
              const val = Number(params.newValue);
              if (isNaN(val)) return false;
              params.data.periodValues = { ...params.data.periodValues, [p.id]: val };
              return true;
            }
          };
        })
      }
    ];
  }, [project.reportingPeriods, currencyFormatter]);

  const handleExport = () => {
    const periods = project.reportingPeriods?.periods || [];
    const data = timephasingRows.map(row => {
      const exportRow: any = {
        'Cost Code': row.costCode,
        'Cost Code Name': row.costCodeName,
        'Type': row.type,
        'Phasing Source': row.phasingSource,
        'Start Date': row.startDate ? (row.startDate instanceof Date ? row.startDate.toLocaleDateString() : row.startDate) : '',
        'End Date': row.endDate ? (row.endDate instanceof Date ? row.endDate.toLocaleDateString() : row.endDate) : '',
        'Distribution': row.distribution,
        'Total From Code': row.totalFromCode
      };
      periods.forEach(p => {
        exportRow[p.name] = row.periodValues?.[p.id] || 0;
      });
      return exportRow;
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Global Timephasing");
    XLSX.writeFile(wb, `${project.projectCode}_Global_Timephasing.xlsx`);
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

        const periods = project.reportingPeriods?.periods || [];
        const batch = writeBatch(db);
        let importCount = 0;
        const errors: string[] = [];

        for (const excelRow of data) {
          const costCode = excelRow['Cost Code'];
          const typeLabel = excelRow['Type'];
          
          if (!costCode || !typeLabel) continue;

          // Validation 1: Check if Cost Code exists in project
          const costCodeExists = costCodes.some(c => c.code === costCode);
          if (!costCodeExists) {
            errors.push(`Cost Code "${costCode}" does not exist in this project.`);
            continue;
          }

          // Determine rowType from label
          let rowType = '';
          const validTypes = ['Baseline Budget', 'Approved Budget', 'Estimate At Completion'];
          if (typeLabel === 'Baseline Budget') rowType = 'baseline';
          else if (typeLabel === 'Approved Budget') rowType = 'approved';
          else if (typeLabel === 'Estimate At Completion') rowType = 'eac';

          // Validation 2: Check if Type is valid
          if (!rowType) {
            errors.push(`Invalid Type "${typeLabel}" for Cost Code "${costCode}". Must be one of: ${validTypes.join(', ')}`);
            continue;
          }

          // Rule 1: Always ignore EAC actuals
          if (rowType === 'eac') continue;

          // Find existing row to get docId
          const existingRow = timephasingRows.find(r => r.costCode === costCode && r.rowType === rowType);
          
          const periodValues: Record<string, number> = { ...(existingRow?.periodValues || {}) };
          let hasChanges = false;

          periods.forEach(p => {
            if (excelRow[p.name] !== undefined) {
              const newVal = Number(excelRow[p.name]);
              if (!isNaN(newVal) && periodValues[p.id] !== newVal) {
                periodValues[p.id] = newVal;
                hasChanges = true;
              }
            }
          });

          if (hasChanges) {
            const updatePayload: any = {
              projectId: project.id,
              costCodeId: costCode,
              type: rowType,
              periodValues,
              updatedAt: new Date().toISOString()
            };

            // Rule 2: Formulas (Total, Total Phased, Difference) are ignored (not in payload)
            // Rule 3: Phasing Source, Dates, Distribution are kept as is unless user changed them in grid
            // Here we only update periodValues from Excel

            if (existingRow?.docId) {
              batch.update(doc(db, 'costPhasing', existingRow.docId), updatePayload);
            } else {
              batch.set(doc(collection(db, 'costPhasing')), updatePayload);
            }
            importCount++;
          }
        }

        if (errors.length > 0) {
          // Show first few errors to avoid overwhelming the toast
          const displayErrors = errors.slice(0, 3);
          const errorMsg = displayErrors.join('\n') + (errors.length > 3 ? `\n...and ${errors.length - 3} more errors.` : '');
          toast.error("Import failed due to validation errors:", {
            description: errorMsg,
            duration: 5000
          });
          return;
        }

        if (importCount > 0) {
          await batch.commit();
          toast.success(`Successfully imported phasing for ${importCount} rows`);
          setRefreshTrigger(prev => prev + 1);
        } else {
          toast.info("No valid changes found in Excel file.");
        }
      } catch (error) {
        console.error("Excel import error:", error);
        toast.error("Failed to import Excel file. Ensure format matches export.");
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = ''; // Reset input
  };

  const chartData = useMemo(() => {
    if (!project.reportingPeriods?.periods || timephasingRows.length === 0) return [];
    
    // Aggregate all rows by type and period
    const totalsByPeriod: Record<string, { baseline: number, approved: number, eac: number, eacPrevious: number }> = {};
    
    project.reportingPeriods.periods.forEach(p => {
      totalsByPeriod[p.id] = { baseline: 0, approved: 0, eac: 0, eacPrevious: 0 };
    });

    timephasingRows.forEach(row => {
      Object.entries(row.periodValues || {}).forEach(([periodId, value]) => {
        if (totalsByPeriod[periodId]) {
          if (row.rowType === 'baseline') totalsByPeriod[periodId].baseline += Number(value) || 0;
          if (row.rowType === 'approved') totalsByPeriod[periodId].approved += Number(value) || 0;
          if (row.rowType === 'eac') totalsByPeriod[periodId].eac += Number(value) || 0;
          if (row.rowType === 'eacPrevious') totalsByPeriod[periodId].eacPrevious += Number(value) || 0;
        }
      });
    });

    let cumulativeBaseline = 0;
    let cumulativeApproved = 0;
    let cumulativeEac = 0;
    let cumulativeEacPrevious = 0;

    const totalBaseline = timephasingRows.filter(r => r.rowType === 'baseline').reduce((acc, r) => acc + (r.totalFromCode || 0), 0) || 1;
    const totalApproved = timephasingRows.filter(r => r.rowType === 'approved').reduce((acc, r) => acc + (r.totalFromCode || 0), 0) || 1;
    const totalEac = timephasingRows.filter(r => r.rowType === 'eac').reduce((acc, r) => acc + (r.totalFromCode || 0), 0) || 1;
    const totalEacPrevious = timephasingRows.filter(r => r.rowType === 'eacPrevious').reduce((acc, r) => acc + (r.totalFromCode || 0), 0) || 1;

    return project.reportingPeriods.periods.map(p => {
      const { baseline, approved, eac, eacPrevious } = totalsByPeriod[p.id];
      cumulativeBaseline += baseline;
      cumulativeApproved += approved;
      cumulativeEac += eac;
      cumulativeEacPrevious += eacPrevious;
      
      const date = new Date(p.endDate);
      const month = date.toLocaleString('default', { month: 'short' });
      const year = date.getFullYear().toString().slice(-2);
      const periodNumber = project.reportingPeriods.periods.indexOf(p) + 1;
      const dateStr = `P${periodNumber} (${month}'${year})`;

      if (chartMode === 'percent') {
        return {
          name: dateStr,
          baseline: (baseline / totalBaseline) * 100,
          approved: (approved / totalApproved) * 100,
          eac: (eac / totalEac) * 100,
          eacPrevious: (eacPrevious / totalEacPrevious) * 100,
          cumulativeBaseline: (cumulativeBaseline / totalBaseline) * 100,
          cumulativeApproved: (cumulativeApproved / totalApproved) * 100,
          cumulativeEac: (cumulativeEac / totalEac) * 100,
          cumulativeEacPrevious: (cumulativeEacPrevious / totalEacPrevious) * 100
        };
      }

      return {
        name: dateStr,
        baseline,
        approved,
        eac,
        eacPrevious,
        cumulativeBaseline,
        cumulativeApproved,
        cumulativeEac,
        cumulativeEacPrevious
      };
    });
  }, [project.reportingPeriods?.periods, timephasingRows, chartMode]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden h-full">
      <DataGridModule
        title="Global Timephasing"
        description="Project-wide Phasing Overview"
        icon={<Activity className="w-4 h-4 text-gray-400" />}
        searchPlaceholder="Search cost codes..."
        quickFilterText={quickFilterText}
        onQuickFilterChange={setQuickFilterText}
        onImport={() => document.getElementById('excel-import')?.click()}
        onExport={handleExport}
        onCalculate={handleCalculateAutoPhasing}
        isCalculating={isTimephasingLoading}
        selectedCount={selectedRowCount}
        onBulkUpdate={() => setIsBulkUpdateOpen(true)}
        project={project}
        showCurrentPeriod={true}
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
            Charts
          </Button>
        }
        topContent={isChartVisible ? (
          <AnimatePresence mode="wait">
            <motion.div
              key="global-phasing-chart"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10">
                <div className="p-6">
                  <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <h3 className="text-sm font-bold dark:text-white">Project Cashflow Profile</h3>
                    <div className="flex bg-white dark:bg-white/5 p-1 rounded-lg border border-gray-200 dark:border-white/10">
                      <button
                        onClick={() => setChartMode('value')}
                        className={cn(
                          "px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-md transition-all",
                          chartMode === 'value' ? "bg-black dark:bg-white text-white dark:text-black" : "text-gray-400 hover:text-gray-600"
                        )}
                      >
                        Value
                      </button>
                      <button
                        onClick={() => setChartMode('percent')}
                        className={cn(
                          "px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-md transition-all",
                          chartMode === 'percent' ? "bg-black dark:bg-white text-white dark:text-black" : "text-gray-400 hover:text-gray-600"
                        )}
                      >
                        Percent
                      </button>
                    </div>
                  </div>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#333' : '#eee'} />
                      <XAxis 
                        dataKey="name" 
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: theme === 'dark' ? '#666' : '#999' }}
                      />
                      <YAxis 
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: theme === 'dark' ? '#666' : '#999' }}
                        tickFormatter={(val) => chartMode === 'percent' ? `${val}%` : formatCurrency(val)}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: theme === 'dark' ? '#1a1a1a' : '#fff',
                          border: 'none',
                          borderRadius: '12px',
                          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'
                        }}
                        formatter={(val: any) => chartMode === 'percent' ? `${val.toFixed(1)}%` : formatCurrency(val)}
                      />
                      <Legend verticalAlign="top" align="right" iconType="circle" />
                      <Bar dataKey="baseline" name="Baseline (Periodic)" fill="#3b82f6" radius={[4, 4, 0, 0]} opacity={0.3} />
                      <Bar dataKey="approved" name="Approved (Periodic)" fill="#10b981" radius={[4, 4, 0, 0]} opacity={0.3} />
                      <Bar dataKey="eac" name="EAC (Periodic)" fill="#f59e0b" radius={[4, 4, 0, 0]} opacity={0.3} />
                      <Area type="monotone" dataKey="cumulativeBaseline" name="Baseline (Cumulative)" stroke="#3b82f6" fill="url(#colorBaseline)" strokeWidth={3} dot={false} />
                      <Area type="monotone" dataKey="cumulativeApproved" name="Approved (Cumulative)" stroke="#10b981" fill="url(#colorApproved)" strokeWidth={3} dot={false} />
                      <Area type="monotone" dataKey="cumulativeEac" name="EAC (Cumulative)" stroke="#f59e0b" fill="url(#colorEac)" strokeWidth={3} dot={false} />
                      <Area type="monotone" dataKey="cumulativeEacPrevious" name="EAC Previous (Cumulative)" stroke="#94a3b8" fill="url(#colorEacPrev)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                      <defs>
                        <linearGradient id="colorBaseline" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorApproved" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorEac" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorEacPrev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.05}/>
                          <stop offset="95%" stopColor="#94a3b8" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      ) : null}
        gridRef={gridRef}
        rowData={timephasingRows}
        columnDefs={columnDefs}
        theme={theme}
        gridProps={{
          quickFilterText: quickFilterText,
          loading: isTimephasingLoading,
          onCellValueChanged: onCellValueChanged,
          onSelectionChanged: (event: any) => {
            const selectedRows = event.api.getSelectedRows();
            const displayedSelected = selectedRows.filter((row: any) => {
              const node = event.api.getRowNode(row.id);
              return node && node.displayed;
            });
            setSelectedRowCount(displayedSelected.length);
          },
          onFilterChanged: (event: any) => {
            const selectedRows = event.api.getSelectedRows();
            const displayedSelected = selectedRows.filter((row: any) => {
              const node = event.api.getRowNode(row.id);
              return node && node.displayed;
            });
            setSelectedRowCount(displayedSelected.length);
          },
          getRowId: (params: any) => params.data.id,
          isExternalFilterPresent: () => true,
          doesExternalFilterPass: (node: any) => !node.data.hidden,
          rowSelection: "multiple",
          suppressRowClickSelection: true,
          enableFillHandle: true,
          undoRedoCellEditing: true,
          defaultColDef: {
            sortable: true,
            filter: true,
            resizable: true,
            minWidth: 100,
            wrapHeaderText: true,
            autoHeaderHeight: true,
          },
          animateRows: true,
          enableRangeSelection: true,
          enableCellTextSelection: true,
          suppressRowTransform: true,
        }}
      />

      <input
        type="file"
        id="excel-import"
        className="hidden"
        accept=".xlsx, .xls"
        onChange={handleImport}
      />

      {/* Bulk Update Modal */}
      <Dialog open={isBulkUpdateOpen} onOpenChange={setIsBulkUpdateOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Bulk Update Phasing</DialogTitle>
            <DialogDescription>
              Apply these settings to <span className="font-bold text-blue-600 dark:text-blue-400">{selectedRowCount}</span> selected rows.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Phasing Source</label>
              <select 
                className="w-full p-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-sm"
                value={bulkUpdateData.phasingSource || ''}
                onChange={(e) => setBulkUpdateData({ ...bulkUpdateData, phasingSource: e.target.value })}
              >
                <option value="">No Change</option>
                <option value="Manual">Manual</option>
                <option value="Auto">Auto</option>
                <option value="ETC Details">ETC Details (EAC Only)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Start Date</label>
                <Input 
                  type="date" 
                  value={bulkUpdateData.startDate || ''}
                  onChange={(e) => setBulkUpdateData({ ...bulkUpdateData, startDate: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-xs font-bold uppercase tracking-widest text-gray-500">End Date</label>
                <Input 
                  type="date" 
                  value={bulkUpdateData.endDate || ''}
                  onChange={(e) => setBulkUpdateData({ ...bulkUpdateData, endDate: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Distribution</label>
              <select 
                className="w-full p-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-sm"
                value={bulkUpdateData.distribution || ''}
                onChange={(e) => setBulkUpdateData({ ...bulkUpdateData, distribution: e.target.value })}
              >
                <option value="">No Change</option>
                <option value="Even">Even</option>
                <option value="Bell Curve">Bell Curve</option>
                <option value="Front load">Front load</option>
                <option value="Back load">Back load</option>
                <option value="S-Curve">S-Curve</option>
                <option value="Profile">Profile</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkUpdateOpen(false)}>Cancel</Button>
            <Button onClick={handleBulkUpdate}>Apply Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
