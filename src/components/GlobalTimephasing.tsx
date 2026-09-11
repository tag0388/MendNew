import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { resolveCurrentPeriodIndex } from '../lib/periods';
import { Project, Enterprise, CostCode, Subcontract, ScheduleItem } from '../types';
import { subscribeToTable } from '../lib/supabase';
import { fetchCostCodes, fetchScheduleItems } from '../lib/costCodes';
import {
  fetchTimephasing, saveCostPhasing, bulkSaveCostPhasing,
  upsertCostPhasingRows, applyCostPhasing,
} from '../lib/timephasing';
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

  /** A DATE column takes yyyy-mm-dd, not a full ISO timestamp. */
  const toDateString = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

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

  // Cost codes. RLS already limits a project user to their assigned codes, so
  // the browser no longer re-filters what it was sent -- it used to compare
  // the signed-in id against an assignedUsers array that RLS had already
  // decided on.
  const reloadCostCodes = useCallback(async () => {
    try {
      setCostCodes(await fetchCostCodes(project.id));
    } catch (error: any) {
      console.error('Cost codes fetch error:', error);
      toast.error(`Failed to fetch cost codes: ${error?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void reloadCostCodes();
    return subscribeToTable('cost_codes', `project_id=eq.${project.id}`, () => void reloadCostCodes());
  }, [reloadCostCodes, project.id]);

  // Schedule activities, for the Activity ID column's date sync.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const items = await fetchScheduleItems(project.id);
        if (active) setScheduleItems(items as any);
      } catch (error) {
        console.error('Schedule items fetch error:', error);
      }
    };
    void load();
    const unsubscribe = subscribeToTable('schedule_items', `project_id=eq.${project.id}`, () => void load());
    return () => { active = false; unsubscribe(); };
  }, [project.id]);

  /**
   * The grid's rows, from project_timephasing.
   *
   * This replaces the largest browser-side aggregation in the app: it used to
   * fetch every cost phasing row, every actual cost transaction, every ETC
   * detail line and every subcontract in the project, then work out each cost
   * code's value per period in JavaScript. The rules are unchanged; they run
   * in SQL now, and only the finished rows cross the network.
   */
  const reloadRows = useCallback(async () => {
    setIsTimephasingLoading(true);
    try {
      const rows = await fetchTimephasing(project.id);
      setTimephasingRows(rows.map(r => ({
        ...r,
        // The grid keys its rows by cost code and type, and its date editors
        // want Date objects.
        id: `${r.costCode}_${r.rowType}`,
        startDate: r.startDate ? new Date(r.startDate) : '',
        endDate: r.endDate ? new Date(r.endDate) : '',
        hidden: r.rowType === 'eacPrevious',
      })) as any);
    } catch (error: any) {
      console.error('Error fetching global timephasing data:', error);
      toast.error(`Failed to load timephasing: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsTimephasingLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void reloadRows();
    // The rows are derived from five tables, so each of them refreshes the grid.
    const unsubs = [
      subscribeToTable('cost_phasing', `project_id=eq.${project.id}`, () => void reloadRows()),
      subscribeToTable('cost_codes', `project_id=eq.${project.id}`, () => void reloadRows()),
      subscribeToTable('actual_costs', `project_id=eq.${project.id}`, () => void reloadRows()),
      subscribeToTable('etc_details', `project_id=eq.${project.id}`, () => void reloadRows()),
      subscribeToTable('subcontract_line_items', `project_id=eq.${project.id}`, () => void reloadRows()),
    ];
    return () => unsubs.forEach(u => u());
  }, [reloadRows, project.id, refreshTrigger]);

  const handleCalculateAutoPhasing = useCallback(async () => {
    const selectedRows = (gridRef.current?.api.getSelectedNodes() || []).map(node => node.data);
    const scoped = selectedRows.length > 0;
    const autoRows = (scoped ? selectedRows : timephasingRows).filter(r => r?.phasingSource === 'Auto');

    if (autoRows.length === 0) {
      toast.info(scoped
        ? "Selected rows are not set to 'Auto' phasing source."
        : "No rows set to 'Auto' phasing source.");
      return;
    }

    setIsTimephasingLoading(true);
    try {
      // The whole calculation is one statement in the database: which periods
      // each row's dates touch, the weight per period for its distribution
      // curve, and the amount to spread -- the budget for a budget row, the
      // estimate still to spend for an EAC row, which cannot start before the
      // next open period.
      //
      // It used to run here, over every row in the project, and write the
      // results back in a batch.
      const phased = await applyCostPhasing(
        project.id,
        scoped ? autoRows.map(r => r.phasingId).filter(Boolean) : undefined
      );
      await reloadRows();
      if (phased > 0) {
        toast.success(`Recalculated phasing for ${phased} row(s)`);
      } else {
        toast.warning('Incomplete auto-phasing settings (dates or distribution missing)');
      }
    } catch (error: any) {
      console.error('Error calculating auto phasing:', error);
      toast.error(`Failed to calculate auto phasing: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsTimephasingLoading(false);
    }
  }, [project.id, timephasingRows, reloadRows]);

  const onCellValueChanged = useCallback(async (params: any) => {
    const { data, colDef, newValue, oldValue } = params;
    if (newValue === oldValue) return;

    const field = colDef.field;
    const isPeriodValue = field?.startsWith('periodValues.');

    try {
      const patch: any = {};

      if (isPeriodValue) {
        patch.periodValues = data.periodValues;
      } else {
        // start_date / end_date are DATE columns; an ISO timestamp is refused.
        patch[field] = newValue instanceof Date ? toDateString(newValue) : newValue;

        // Auto-populate dates if Activity ID changes
        if (field === 'activityId' && newValue) {
          const scheduleItem = scheduleItems.find(sch => sch.activityId === newValue);
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

            if (startDate) patch.startDate = startDate;
            if (endDate) patch.endDate = endDate;

            // Update local row data for immediate feedback
            data.startDate = startDate ? new Date(startDate) : '';
            data.endDate = endDate ? new Date(endDate) : '';
            params.api.applyTransaction({ update: [data] });
          }
        }
      }

      // (cost_code_id, type) is unique, so this creates the phasing row or
      // updates it. The browser used to track whether one existed.
      await saveCostPhasing(project.id, data.costCodeId, data.rowType, patch);

      if (field === 'activityId') {
        toast.success('Synced dates from schedule');
      }
      await reloadRows();
    } catch (error: any) {
      console.error('Error updating phasing cell:', error);
      toast.error(`Failed to save changes: ${error?.message || 'Unknown error'}`);
      await reloadRows();
    }
  }, [project.id, scheduleItems, reloadRows]);

  const handleBulkUpdate = async () => {
    const selectedRows = (gridRef.current?.api.getSelectedNodes() || []).map(node => node.data);

    if (selectedRows.length === 0) {
      toast.warning('Please select rows to bulk update');
      return;
    }

    setIsTimephasingLoading(true);
    try {
      // One upsert for every selected row.
      const updated = await bulkSaveCostPhasing(
        project.id,
        selectedRows.map(r => ({ costCodeId: r.costCodeId, type: r.rowType })),
        {
          phasingSource: bulkUpdateData.phasingSource || undefined,
          startDate: bulkUpdateData.startDate || undefined,
          endDate: bulkUpdateData.endDate || undefined,
          distribution: bulkUpdateData.distribution || undefined,
        }
      );
      await reloadRows();
      toast.success(`Bulk updated ${updated} row(s)`);
      setIsBulkUpdateOpen(false);
      setBulkUpdateData({});
    } catch (error: any) {
      console.error('Error bulk updating phasing:', error);
      toast.error(`Failed to bulk update: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsTimephasingLoading(false);
    }
  };

  const columnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    const periods = project.reportingPeriods?.periods || [];
    const currentPeriodId = project.reportingPeriods?.currentPeriodId;
    const currentPeriodIndex = resolveCurrentPeriodIndex(periods, currentPeriodId);

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
        const wb = XLSX.read(evt.target?.result, { type: 'binary' });
        const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];

        const periods = project.reportingPeriods?.periods || [];
        const labelToRowType: Record<string, string> = {
          'Baseline Budget': 'baseline',
          'Approved Budget': 'approved',
          'Estimate At Completion': 'eac',
        };
        const errors: string[] = [];
        const writes: Array<{ costCodeId: string; rowType: string; periodValues: Record<string, number> }> = [];

        for (const excelRow of data) {
          const costCode = excelRow['Cost Code'];
          const typeLabel = excelRow['Type'];
          if (!costCode || !typeLabel) continue;

          const code = costCodes.find(c => c.code === costCode);
          if (!code) {
            errors.push(`Cost Code "${costCode}" does not exist in this project.`);
            continue;
          }

          const rowType = labelToRowType[typeLabel];
          if (!rowType) {
            errors.push(`Invalid Type "${typeLabel}" for Cost Code "${costCode}". Must be one of: ${Object.keys(labelToRowType).join(', ')}`);
            continue;
          }

          // An EAC row's periods are actual cost up to the current period and
          // a forecast after it, both derived; a sheet cannot overwrite them.
          if (rowType === 'eac') continue;

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

          // Totals and differences in the sheet are formulas; the phasing
          // source, dates and distribution stay as the grid has them.
          if (hasChanges) writes.push({ costCodeId: code.id, rowType, periodValues });
        }

        if (errors.length > 0) {
          const displayErrors = errors.slice(0, 3);
          toast.error('Import failed due to validation errors:', {
            description: displayErrors.join('\n') + (errors.length > 3 ? `\n...and ${errors.length - 3} more errors.` : ''),
            duration: 5000,
          });
          return;
        }

        if (writes.length === 0) {
          toast.info('No valid changes found in Excel file.');
          return;
        }

        // Each row carries its own period map, and they all go in one
        // statement -- (cost_code_id, type) is unique, so a row the project
        // does not have yet is created rather than needing to be looked up
        // first. This used to be a Firestore batch capped at 500 writes.
        const saved = await upsertCostPhasingRows(project.id, writes.map(w => ({
          costCodeId: w.costCodeId,
          type: w.rowType,
          periodValues: w.periodValues,
        })));
        await reloadRows();
        toast.success(`Successfully imported phasing for ${saved} rows`);
      } catch (error: any) {
        console.error('Excel import error:', error);
        toast.error(`Failed to import Excel file: ${error?.message || 'Ensure the format matches the export.'}`);
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
