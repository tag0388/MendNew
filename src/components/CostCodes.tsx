import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Project, Enterprise, CostCode, SavedView, Calendar as ProjectCalendar, Change, ChangeRecord, Subcontract, ScheduleItem } from '../types';
import { db, auth } from '../firebase';
import { 
  doc, 
  updateDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  addDoc, 
  deleteDoc, 
  writeBatch,
  getDocs,
  orderBy
} from 'firebase/firestore';
import { 
  Calendar,
  Search, 
  Plus, 
  Trash2, 
  Edit2, 
  Save, 
  X, 
  Upload, 
  Download, 
  Filter, 
  Layout, 
  Lock, 
  Unlock, 
  Hash, 
  Eye, 
  Maximize2,
  Minimize2,
  MoreVertical,
  PieChart,
  ChevronRight,
  ChevronLeft,
  List,
  RefreshCw,
  FileText,
  ChevronDown,
  ChevronUp,
  Layers,
  Settings,
  History,
  Target,
  Columns,
  RotateCcw,
  ArrowUp,
  Calculator,
  ArrowDown,
  Briefcase,
  ClipboardList,
  Activity,
  DollarSign,
  Database,
  CheckCircle2,
  BarChart3,
  AlertTriangle
} from 'lucide-react';
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
  Area,
  Cell,
  Legend,
  LabelList
} from 'recharts';
import * as XLSX from 'xlsx';
import { cn, formatCurrency, formatNumber } from '../lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { format, parseISO } from 'date-fns';
import { AgGridReact } from 'ag-grid-react';
import DataGridModule from './DataGridModule';
import { 
  ColDef, 
  ColGroupDef,
  GridReadyEvent, 
  GridApi,
  CellValueChangedEvent,
  RowDataUpdatedEvent,
  ValueFormatterParams,
  ICellRendererParams,
  RowGroupingDisplayType
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import 'ag-grid-enterprise';

interface CostCodesProps {
  project: Project;
  enterprise: Enterprise;
  theme?: 'light' | 'dark';
}

const ActionsCellRenderer = (params: any) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  if (params.node.footer || params.node.rowPinned === 'top') return null;
  
  const code = params.data as CostCode;
  const { 
    setFormData, 
    setIsEditing, 
    setSelectedEtcCode, 
    selectedEtcCode, 
    setSelectedActualsCode,
    selectedActualsCode,
    setSelectedTimephasingCode,
    selectedTimephasingCode,
    setSelectedChangesCode,
    selectedChangesCode,
    setSelectedBaselineCode,
    selectedBaselineCode,
    setSelectedSubcontractBreakdownCode,
    selectedSubcontractBreakdownCode,
    setDeleteConfirm 
  } = params.context;

  const getMenuPosition = () => {
    if (!buttonRef.current) return { top: 0, right: 0 };
    const rect = buttonRef.current.getBoundingClientRect();
    return {
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right
    };
  };

  return (
    <div className="flex items-center justify-center h-full gap-2 overflow-visible">
      <div className="flex items-center gap-1 border-r border-gray-200 dark:border-white/10 pr-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setFormData({
              code: code.code,
              name: code.name,
              enterpriseAttributes: code.enterpriseAttributes || {},
              projectAttributes: code.projectAttributes || {},
              eacMethod: code.eacMethod || 'Manual',
              assignedUsers: code.assignedUsers || []
            });
            setIsEditing({ id: code.id });
          }}
          className="p-1.5 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-lg transition-colors"
          title="Edit"
        >
          <Edit2 className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDeleteConfirm({ type: 'single', id: code.id, name: code.code });
          }}
          className="p-1.5 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition-colors"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="relative">
        <button
          ref={buttonRef}
          onClick={(e) => {
            e.stopPropagation();
            setIsMenuOpen(!isMenuOpen);
          }}
          className={cn(
            "p-1.5 rounded-lg transition-all duration-200",
            isMenuOpen 
              ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" 
              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10"
          )}
          title="Modules"
        >
          <Settings className={cn("w-4 h-4", isMenuOpen && "animate-spin")} />
        </button>
        
        {isMenuOpen && createPortal(
          <>
            <div className="fixed inset-0 z-[9998]" onClick={(e) => { e.stopPropagation(); setIsMenuOpen(false); }} />
            <div
              style={{
                position: 'fixed',
                top: getMenuPosition().top,
                right: getMenuPosition().right,
              }}
              className="w-56 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl z-[9999] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-1.5 space-y-0.5">
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-gray-100 dark:border-white/5 mb-1">Modules</div>
                {code.eacMethod === 'ETC Details' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedEtcCode(selectedEtcCode === code.code ? null : code.code);
                      setIsMenuOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors",
                      selectedEtcCode === code.code 
                        ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40" 
                        : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
                    )}
                  >
                    <ClipboardList className="w-4 h-4 text-orange-500" />
                    ETC Details
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedActualsCode(selectedActualsCode === code.code ? null : code.code);
                    if (selectedActualsCode !== code.code) setSelectedEtcCode(null);
                    setIsMenuOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors",
                    selectedActualsCode === code.code 
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40" 
                      : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
                  )}
                >
                  <History className="w-4 h-4 text-blue-500" />
                  Actual Cost
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTimephasingCode(selectedTimephasingCode === code.code ? null : code.code);
                    if (selectedTimephasingCode !== code.code) {
                      setSelectedEtcCode(null);
                      setSelectedActualsCode(null);
                    }
                    setIsMenuOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors",
                    selectedTimephasingCode === code.code 
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40" 
                      : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
                  )}
                >
                  <Activity className="w-4 h-4 text-emerald-500" />
                  Timephasing
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedBaselineCode(selectedBaselineCode === code.code ? null : code.code);
                    if (selectedBaselineCode !== code.code) {
                      setSelectedEtcCode(null);
                      setSelectedActualsCode(null);
                      setSelectedTimephasingCode(null);
                      setSelectedChangesCode(null);
                    }
                    setIsMenuOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors",
                    selectedBaselineCode === code.code 
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40" 
                      : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
                  )}
                >
                  <Target className="w-4 h-4 text-amber-500" />
                  Baseline Budget
                </button>
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setSelectedChangesCode(selectedChangesCode === code.code ? null : code.code);
                    if (selectedChangesCode !== code.code) {
                      setSelectedEtcCode(null);
                      setSelectedActualsCode(null);
                      setSelectedTimephasingCode(null);
                    }
                    setIsMenuOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors",
                    selectedChangesCode === code.code 
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40" 
                      : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
                  )}
                >
                  <RefreshCw className="w-4 h-4 text-purple-500" />
                  Changes
                </button>
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setSelectedSubcontractBreakdownCode(selectedSubcontractBreakdownCode === code.code ? null : code.code);
                    if (selectedSubcontractBreakdownCode !== code.code) {
                      setSelectedEtcCode(null);
                      setSelectedActualsCode(null);
                      setSelectedTimephasingCode(null);
                      setSelectedChangesCode(null);
                      setSelectedBaselineCode(null);
                    }
                    setIsMenuOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors",
                    selectedSubcontractBreakdownCode === code.code 
                      ? "bg-green-100 text-green-700 dark:bg-green-900/40" 
                      : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
                  )}
                >
                  <Briefcase className="w-4 h-4 text-green-500" />
                  Sub-Contract
                </button>
              </div>
            </div>
          </>,
          document.body
        )}
      </div>
    </div>
  );
};

export default function CostCodes({ project, enterprise, theme = 'light' }: CostCodesProps) {
  const navigate = useNavigate();
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [calendars, setCalendars] = useState<ProjectCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Table State
  const [quickFilterText, setQuickFilterText] = useState('');
  const [etcQuickFilterText, setEtcQuickFilterText] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedEtcIds, setSelectedEtcIds] = useState<Set<string>>(new Set());
  
  // UI State
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState<{ id: string | null; insertIndex?: number } | null>(null);
  const [formData, setFormData] = useState<Partial<CostCode>>({ 
    code: '', 
    name: '', 
    enterpriseAttributes: {}, 
    projectAttributes: {}, 
    eacMethod: 'Manual',
    assignedUsers: []
  });
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'single' | 'bulk'; id?: string; name?: string; count?: number } | null>(null);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [isEtcBulkUpdating, setIsEtcBulkUpdating] = useState(false);
  const [etcBulkUpdateData, setEtcBulkUpdateData] = useState<{
    category?: string;
    calendarId?: string;
    phasingMethod?: 'Manual' | 'Auto-Phase';
    phasingUnit?: 'Daily' | 'Weekly' | 'Monthly' | 'Total' | 'Profile';
    enterpriseAttributes: Record<string, string>;
    projectAttributes: Record<string, string>;
    userDefined: Record<string, any>;
  }>({
    enterpriseAttributes: {},
    projectAttributes: {},
    userDefined: {}
  });
  const [selectedEtcCode, setSelectedEtcCode] = useState<string | null>(null);
  const [selectedActualsCode, setSelectedActualsCode] = useState<string | null>(null);
  const [selectedTimephasingCode, setSelectedTimephasingCode] = useState<string | null>(null);
  const [selectedChangesCode, setSelectedChangesCode] = useState<string | null>(null);
  const [selectedBaselineCode, setSelectedBaselineCode] = useState<string | null>(null);
  const [riskRecords, setRiskRecords] = useState<any[]>([]);
  const [changeRecords, setChangeRecords] = useState<ChangeRecord[]>([]);
  const [allChanges, setAllChanges] = useState<Change[]>([]);
  const [isCalculated, setIsCalculated] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isChangesLoading, setIsChangesLoading] = useState(false);
  const [importPreview, setImportPreview] = useState<{ data: any[] } | null>(null);

  const handleRecalculateAll = async () => {
    if (!project.id) return;
    setIsCalculating(true);
    const toastId = toast.loading('Recalculating project totals...');

    try {
      // 1. Bulk fetch all relevant data for the project
      const [actualsSnap, budgetsSnap, changesSnap, changeRecordsSnap] = await Promise.all([
        getDocs(query(collection(db, 'actualCosts'), where('projectId', '==', project.id))),
        getDocs(query(collection(db, 'baselineBudgets'), where('projectId', '==', project.id))),
        getDocs(query(collection(db, 'changes'), where('projectId', '==', project.id))),
        getDocs(query(collection(db, 'changeRecords'), where('projectId', '==', project.id)))
      ]);

      const allActuals = actualsSnap.docs.map(d => d.data());
      const allBudgets = budgetsSnap.docs.map(d => d.data());
      const fetchedChanges = changesSnap.docs.map(d => ({ ...d.data(), id: d.id } as Change));
      const allChangeRecords = changeRecordsSnap.docs.map(d => d.data());
      
      // APPROVED CHANGES: Only sum records from approved changes
      const approvedChangeIds = new Set(fetchedChanges.filter(c => c.status === 'Approved').map(c => c.id));

      const batch = writeBatch(db);
      let count = 0;

      for (const cc of costCodes) {
        const ccId = cc.id;
        const ccCode = cc.code;

        // Sum Actuals
        const actualCost = allActuals
          .filter((a: any) => a.costCodeId === ccId || a.costCodeId === ccCode)
          .reduce((sum, a: any) => sum + (Number(a.cost) || 0), 0);

        // Sum Baseline
        const baselineBudget = allBudgets
          .filter((b: any) => b.costCodeId === ccId || b.costCodeId === ccCode)
          .reduce((sum, b: any) => sum + (Number(b.amount) || 0), 0);

        // Sum Approved Changes
        const approvedChanges = allChangeRecords
          .filter((cr: any) => (cr.costCodeId === ccId || cr.costCodeId === ccCode) && approvedChangeIds.has(cr.changeId))
          .reduce((sum, cr: any) => sum + (Number(cr.budgetAmount) || 0), 0);
          
        // Sum Subcontracts
        let subcontractAmount = 0;
        subcontracts.forEach(sub => {
          (sub.lineItems || []).forEach(li => {
            if (li.status === 'Rejected') return;
            const assignedId = li.costCodeId || sub.defaultCostCodeId;
            if (assignedId === ccId || assignedId === ccCode) {
              subcontractAmount += (Number(li.total) || 0);
            }
          });
        });

        const ccRef = doc(db, 'costCodes', cc.id);
        batch.update(ccRef, {
          actualCostToDate: actualCost,
          baselineBudget: baselineBudget,
          approvedChanges: approvedChanges,
          subcontractAmount: subcontractAmount,
          updatedAt: new Date().toISOString()
        });
        count++;

        // Batch limit is 500
        if (count >= 450) {
          await batch.commit();
          // Reset batch for next set
          // (Actually we would need a new batch object here)
          // But usually cost codes are < 500. If more, we handle recursively.
        }
      }

      if (count > 0) await batch.commit();

      toast.success(`Recalculated totals for ${count} cost codes`, { id: toastId });
      setIsCalculated(true);
    } catch (error) {
      console.error("Recalculation error:", error);
      toast.error("Failed to recalculate project totals", { id: toastId });
    } finally {
      setIsCalculating(false);
    }
  };
  const [changesQuickFilterText, setChangesQuickFilterText] = useState('');
  const [etcRows, setEtcRows] = useState<any[]>([]);
  const [actualsRows, setActualsRows] = useState<any[]>([]);
  const [baselineRows, setBaselineRows] = useState<any[]>([]);
  const [costPhasing, setCostPhasing] = useState<any[]>([]);
  const [timephasingRows, setTimephasingRows] = useState<any[]>([]);
  const [isEtcLoading, setIsEtcLoading] = useState(false);
  const [isActualsLoading, setIsActualsLoading] = useState(false);
  const [isBaselineLoading, setIsBaselineLoading] = useState(false);
  const [isTimephasingLoading, setIsTimephasingLoading] = useState(false);
  const [actualsQuickFilterText, setActualsQuickFilterText] = useState('');
  const [baselineQuickFilterText, setBaselineQuickFilterText] = useState('');
  const [timephasingQuickFilterText, setTimephasingQuickFilterText] = useState('');
  const [isActualsChartVisible, setIsActualsChartVisible] = useState(false);
  const [isTimephasingChartVisible, setIsTimephasingChartVisible] = useState(false);
  const [timephasingChartMode, setTimephasingChartMode] = useState<'value' | 'percent'>('value');
  const [isMainTableCollapsed, setIsMainTableCollapsed] = useState(false);
  const [weekEndingDay] = useState<number>(0); // 0: Sun, 5: Fri, 6: Sat
  const [subcontracts, setSubcontracts] = useState<Subcontract[]>([]);
  const [selectedSubcontractBreakdownCode, setSelectedSubcontractBreakdownCode] = useState<string | null>(null);
  const [subcontractQuickFilterText, setSubcontractQuickFilterText] = useState('');

  const dateFormatter = useCallback((params: any) => {
    if (!params.value) return '';
    const date = params.value instanceof Date ? params.value : new Date(params.value);
    if (isNaN(date.getTime())) return '';
    
    // Use local time for display to avoid UTC shifts
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }, []);

  const safeDateSetter = useCallback((field: string) => (params: any) => {
    const val = params.newValue;
    if (!val) {
      params.data[field] = '';
      return true;
    }
    
    const date = val instanceof Date ? val : new Date(val);
    if (isNaN(date.getTime())) {
      console.warn('Invalid date entered:', val);
      return false;
    }

    // Convert to YYYY-MM-DD in local time to avoid UTC shifts
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    params.data[field] = `${y}-${m}-${d}`;
    return true;
  }, []);

  const subcontractBreakdownRows = useMemo(() => {
    if (!selectedSubcontractBreakdownCode) return [];
    
    const targetCode = costCodes.find(c => 
      c.code.trim().toUpperCase() === selectedSubcontractBreakdownCode.trim().toUpperCase()
    );

    const matchCode = selectedSubcontractBreakdownCode.trim().toUpperCase();

    return subcontracts.flatMap(sub => 
      (sub.lineItems || [])
        .filter(li => {
          if (li.status === 'Rejected') return false;
          
          // Capture the assigned code, preferring line item level over subcontract default
          const rawId = li.costCodeId;
          const assignedCodeId = (rawId && rawId.trim() !== '') ? rawId : sub.defaultCostCodeId;
          
          if (!assignedCodeId) return false;

          const assignedClean = assignedCodeId.toString().trim().toUpperCase();
          // Extract the code portion in case it's in "CODE - NAME" format
          const assignedCodeOnly = assignedClean.split(' - ')[0].trim();

          // 1. Direct match with the selected code string (e.g., "E3")
          if (assignedClean === matchCode || assignedCodeOnly === matchCode) return true;
          
          // 2. Match with the full code object's internal ID or code string if found
          if (targetCode) {
            const targetId = (targetCode.id || '').toString().trim().toUpperCase();
            const targetCodeValue = (targetCode.code || '').toString().trim().toUpperCase();
            if (assignedClean === targetId || assignedCodeOnly === targetId || assignedClean === targetCodeValue || assignedCodeOnly === targetCodeValue) return true;
          }

          return false;
        })
        .map(li => ({
          ...li,
          subcontractId: sub.orderId,
          subcontractName: sub.orderName,
          vendorName: sub.vendorName
        }))
    );
  }, [subcontracts, selectedSubcontractBreakdownCode, costCodes]);

  const subcontractBreakdownPinnedBottomRowData = useMemo(() => {
    if (subcontractBreakdownRows.length === 0) return [];
    const total = subcontractBreakdownRows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
    return [{
      description: 'SubTotal',
      total: total
    }];
  }, [subcontractBreakdownRows]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const currencyFormatter = (params: ValueFormatterParams) => {
    if (params.value == null) return '';
    return formatCurrency(params.value);
  };

  const timephasingChartData = useMemo(() => {
    if (!project.reportingPeriods?.periods || timephasingRows.length === 0) return [];
    
    let cumulativeBaseline = 0;
    let cumulativeApproved = 0;
    let cumulativeEac = 0;
    let cumulativeEacPrevious = 0;

    const baselineRow = timephasingRows.find(r => r.id === 'baseline');
    const approvedRow = timephasingRows.find(r => r.id === 'approved');
    const eacRow = timephasingRows.find(r => r.id === 'eac');
    const eacPrevRow = timephasingRows.find(r => r.id === 'eacPrevious');

    const totalBaseline = baselineRow?.totalFromCode || 1;
    const totalApproved = approvedRow?.totalFromCode || 1;
    const totalEac = eacRow?.totalFromCode || 1;
    const totalEacPrev = eacPrevRow?.totalFromCode || 1;

    return project.reportingPeriods.periods.map(p => {
      const baseline = baselineRow?.periodValues?.[p.id] || 0;
      const approved = approvedRow?.periodValues?.[p.id] || 0;
      const eac = eacRow?.periodValues?.[p.id] || 0;
      const eacPrev = eacPrevRow?.periodValues?.[p.id] || 0;

      cumulativeBaseline += baseline;
      cumulativeApproved += approved;
      cumulativeEac += eac;
      cumulativeEacPrevious += eacPrev;
      
      const date = new Date(p.endDate);
      const month = date.toLocaleString('default', { month: 'short' });
      const year = date.getFullYear().toString().slice(-2);
      const periodNumber = project.reportingPeriods.periods.indexOf(p) + 1;
      const dateStr = `P${periodNumber} (${month}'${year})`;

      if (timephasingChartMode === 'percent') {
        return {
          name: dateStr,
          baseline: (baseline / totalBaseline) * 100,
          approved: (approved / totalApproved) * 100,
          eac: (eac / totalEac) * 100,
          eacPrevious: (eacPrev / totalEacPrev) * 100,
          cumulativeBaseline: (cumulativeBaseline / totalBaseline) * 100,
          cumulativeApproved: (cumulativeApproved / totalApproved) * 100,
          cumulativeEac: (cumulativeEac / totalEac) * 100,
          cumulativeEacPrevious: (cumulativeEacPrevious / totalEacPrev) * 100
        };
      }

      return {
        name: dateStr,
        baseline,
        approved,
        eac,
        eacPrevious: eacPrev,
        cumulativeBaseline,
        cumulativeApproved,
        cumulativeEac,
        cumulativeEacPrevious
      };
    });
  }, [project.reportingPeriods?.periods, timephasingRows, timephasingChartMode]);

  const actualsChartData = useMemo(() => {
    if (!project.reportingPeriods?.periods || actualsRows.length === 0) return [];
    
    // Aggregate actuals by reporting period
    const periodTotals: Record<string, number> = {};
    actualsRows.forEach(row => {
      const periodId = row.reportingPeriodId;
      if (periodId) {
        periodTotals[periodId] = (periodTotals[periodId] || 0) + (row.cost || 0);
      }
    });

    let cumulative = 0;
    return project.reportingPeriods.periods.map(p => {
      const cost = periodTotals[p.id] || 0;
      cumulative += cost;
      
      const date = new Date(p.endDate);
      const month = date.toLocaleString('default', { month: 'short' });
      const year = date.getFullYear().toString().slice(-2);
      const periodNumber = project.reportingPeriods.periods.indexOf(p) + 1;
      const dateStr = `P${periodNumber} (${month}'${year})`;

      return {
        name: dateStr,
        cost: Math.round(cost * 100) / 100,
        cumulative: Math.round(cumulative * 100) / 100
      };
    });
  }, [project.reportingPeriods, actualsRows]);

  const etcChartData = useMemo(() => {
    if (!project.reportingPeriods?.periods || etcRows.length === 0) return [];
    
    const selectedCostCodeObj = costCodes.find(c => c.code === selectedEtcCode);
    const initialActualCost = selectedCostCodeObj?.actualCostToDate || 0;
    
    const currentPeriodId = project.reportingPeriods?.currentPeriodId;
    const currentPeriodIndex = project.reportingPeriods?.periods.findIndex(p => p.id === currentPeriodId) ?? -1;
    const periods = project.reportingPeriods.periods.slice(currentPeriodIndex + 1);
    let cumulative = initialActualCost;
    
    return periods.map(p => {
      const periodCost = etcRows.reduce((sum, row) => {
        const qty = row.periodValues?.[p.id] || 0;
        const rate = row.rate || 0;
        return sum + (qty * rate);
      }, 0);
      const periodQty = etcRows.reduce((sum, row) => {
        return sum + (row.periodValues?.[p.id] || 0);
      }, 0);
      cumulative += periodCost;
      
      // Format date for Monthly
      const date = new Date(p.endDate);
      const month = date.toLocaleString('default', { month: 'short' });
      const year = date.getFullYear().toString().slice(-2);
      const periodNumber = periods.indexOf(p) + 1;
      const dateStr = `P${periodNumber} (${month}'${year})`;

      return {
        name: dateStr,
        cost: Math.round(periodCost * 100) / 100,
        qty: Math.round(periodQty * 100) / 100,
        cumulative: Math.round(cumulative * 100) / 100
      };
    });
  }, [etcRows, project.reportingPeriods, costCodes, selectedEtcCode]);
  const [isEtcChartVisible, setIsEtcChartVisible] = useState(false);
  const [addRowsCount, setAddRowsCount] = useState(1);
  const [isResourceModalOpen, setIsResourceModalOpen] = useState(false);
  const [resourceSearch, setResourceSearch] = useState('');
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(new Set());
  const [resourceLibrarySource, setResourceLibrarySource] = useState<'enterprise' | 'project'>('enterprise');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [bulkUpdateData, setBulkUpdateData] = useState<{
    enterpriseAttributes: Record<string, string>;
    projectAttributes: Record<string, string>;
    eacMethod?: CostCode['eacMethod'];
  }>({
    enterpriseAttributes: {},
    projectAttributes: {},
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const etcFileInputRef = useRef<HTMLInputElement>(null);
  const timephasingFileInputRef = useRef<HTMLInputElement>(null);

  // Real-time duplicate check
  const isDuplicateId = useMemo(() => {
    if (!formData.code || isEditing?.id || isSaving) return false;
    return costCodes.some(c => c.code.toLowerCase() === formData.code?.toLowerCase());
  }, [formData.code, costCodes, isEditing, isSaving]);

  const groupedLibraryResources = useMemo(() => {
    const library = resourceLibrarySource === 'enterprise' ? enterprise.resourceRates : project.resourceRates;
    const filtered = library?.filter(r => 
      r.name.toLowerCase().includes(resourceSearch.toLowerCase()) ||
      r.id.toLowerCase().includes(resourceSearch.toLowerCase()) ||
      r.category?.toLowerCase().includes(resourceSearch.toLowerCase())
    ) || [];

    const grouped = filtered.reduce((acc, resource) => {
      const category = resource.category || 'Uncategorized';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(resource);
      return acc;
    }, {} as Record<string, typeof filtered>);

    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
  }, [resourceLibrarySource, enterprise.resourceRates, project.resourceRates, resourceSearch]);

  // Fetch ETC Details
  useEffect(() => {
    if (!selectedEtcCode) {
      setEtcRows([]);
      return;
    }

    setIsEtcLoading(true);
    const q = query(
      collection(db, 'etcDetails'),
      where('projectId', '==', project.id),
      where('costCode', '==', selectedEtcCode)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort in memory to include rows without sortOrder
      const sortedRows = rows.sort((a: any, b: any) => {
        const orderA = a.sortOrder ?? -1;
        const orderB = b.sortOrder ?? -1;
        if (orderA !== orderB) return orderA - orderB;
        return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      });
      setEtcRows(sortedRows);
      setIsEtcLoading(false);
    }, (error) => {
      console.error("Error fetching ETC details:", error);
      setIsEtcLoading(false);
    });

    return () => unsubscribe();
  }, [selectedEtcCode, project.id]);

  // Fetch Actual Cost Details
  useEffect(() => {
    if (!selectedBaselineCode) {
      setBaselineRows([]);
      return;
    }

    setIsBaselineLoading(true);
    const costCodeObj = costCodes.find(c => c.code === selectedBaselineCode);
    
    const q = query(
      collection(db, 'baselineBudgets'), 
      where('projectId', '==', project.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allBaseline = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      const filtered = allBaseline.filter((a: any) => 
        a.costCodeId === costCodeObj?.id || a.costCodeId === selectedBaselineCode
      );

      setBaselineRows(filtered);
      setIsBaselineLoading(false);
    }, (error) => {
      console.error("Error fetching baseline budgets:", error);
      setIsBaselineLoading(false);
    });

    return () => unsubscribe();
  }, [selectedBaselineCode, project.id, costCodes]);

  useEffect(() => {
    if (!selectedActualsCode) {
      setActualsRows([]);
      return;
    }

    setIsActualsLoading(true);
    // We match on both ID and Code string for robustness
    const costCodeObj = costCodes.find(c => c.code === selectedActualsCode);
    
    const q = query(
      collection(db, 'actualCosts'),
      where('projectId', '==', project.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allActuals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const filteredActuals = allActuals.filter((a: any) => 
        a.costCodeId === costCodeObj?.id || a.costCodeId === selectedActualsCode
      );
      
      // Sort by date/createdAt
      const sortedRows = filteredActuals.sort((a: any, b: any) => {
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      });
      
      setActualsRows(sortedRows);
      setIsActualsLoading(false);
    }, (error) => {
      console.error("Error fetching Actual Cost details:", error);
      setIsActualsLoading(false);
    });

    return () => unsubscribe();
  }, [selectedActualsCode, project.id, costCodes]);

  // Fetch Cost Phasing (Baseline/Approved)
  useEffect(() => {
    if (!selectedTimephasingCode) {
      setCostPhasing([]);
      return;
    }

    const q = query(
      collection(db, 'costPhasing'),
      where('projectId', '==', project.id),
      where('costCodeId', '==', selectedTimephasingCode)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCostPhasing(data);
    });

    return () => unsubscribe();
  }, [selectedTimephasingCode, project.id]);

  // Changes Effects
  useEffect(() => {
    if (!project.id) return;
    const q = query(collection(db, 'changes'), where('projectId', '==', project.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setAllChanges(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Change)));
    });
    return () => unsubscribe();
  }, [project.id]);

  useEffect(() => {
    if (!project.id) return;
    const q = query(collection(db, 'subcontracts'), where('projectId', '==', project.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSubcontracts(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Subcontract)));
    });
    return () => unsubscribe();
  }, [project.id]);

  useEffect(() => {
    if (!selectedChangesCode || !project.id) {
      setChangeRecords([]);
      return;
    }
    setIsChangesLoading(true);
    const q = query(
      collection(db, 'changeRecords'), 
      where('projectId', '==', project.id),
      where('costCodeId', '==', selectedChangesCode)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setChangeRecords(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ChangeRecord)));
      setIsChangesLoading(false);
    });
    return () => unsubscribe();
  }, [selectedChangesCode, project.id]);

  useEffect(() => {
    if (!project.id) return;
    const q = query(collection(db, 'riskRecords'), where('projectId', '==', project.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setRiskRecords(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [project.id]);

  const riskExposureByCostCode = useMemo(() => {
    const aggregates: Record<string, { initialEMV: number; mitigationCost: number; residualEMV: number }> = {};
    
    riskRecords.forEach(record => {
      const ccId = record.costCodeId;
      if (!ccId) return;
      
      if (!aggregates[ccId]) {
        aggregates[ccId] = { initialEMV: 0, mitigationCost: 0, residualEMV: 0 };
      }
      
      const prob = Number(record.probability) || 0;
      const impact = Number(record.impactAmount) || 0;
      const resProb = Number(record.residualProbability) || 0;
      const resImpact = Number(record.residualImpactAmount) || 0;
      const mitCost = Number(record.mitigationCost) || 0;
      
      aggregates[ccId].initialEMV += prob * impact;
      aggregates[ccId].mitigationCost += mitCost;
      aggregates[ccId].residualEMV += resProb * resImpact;
    });
    
    return aggregates;
  }, [riskRecords]);

  const changesPinnedBottomRowData = useMemo(() => {
    if (changeRecords.length === 0) return [];
    const totalBudget = changeRecords.reduce((sum, r) => sum + (Number(r.budgetAmount) || 0), 0);
    const totalEac = changeRecords.reduce((sum, r) => sum + (Number(r.eacAmount) || 0), 0);
    return [{
      changeIdStr: 'Total',
      budgetAmount: totalBudget,
      eacAmount: totalEac,
      isTotalRow: true
    }];
  }, [changeRecords]);

  // Process Timephasing Rows
  useEffect(() => {
    if (!selectedTimephasingCode) {
      setTimephasingRows([]);
      return;
    }

    setIsTimephasingLoading(true);
    
    // We need actuals and etc for EAC calculation
    // Since we might not have them fetched yet (they are fetched in other effects)
    // We should probably fetch them here too or ensure they are available.
    // To be safe and consistent with the user's request for "smart" handling,
    // I'll fetch them specifically for this view if not already there.
    
    const fetchData = async () => {
      try {
        const periods = project.reportingPeriods?.periods || [];
        const currentPeriodId = project.reportingPeriods?.currentPeriodId;
        const currentPeriodIndex = periods.findIndex(p => p.id === currentPeriodId);
        
        // 1. Get Actuals
        const actualsQuery = query(
          collection(db, 'actualCosts'),
          where('projectId', '==', project.id)
        );
        const actualsSnap = await getDocs(actualsQuery);
        const costCodeObj = costCodes.find(c => c.code === selectedTimephasingCode);
        const filteredActuals = actualsSnap.docs
          .map(doc => doc.data())
          .filter((a: any) => a.costCodeId === costCodeObj?.id || a.costCodeId === selectedTimephasingCode);
        
        const actualsByPeriod: Record<string, number> = {};
        filteredActuals.forEach((a: any) => {
          actualsByPeriod[a.reportingPeriodId] = (actualsByPeriod[a.reportingPeriodId] || 0) + (a.cost || 0);
        });

        // 2. Get ETC Details
        const etcQuery = query(
          collection(db, 'etcDetails'),
          where('projectId', '==', project.id),
          where('costCode', '==', selectedTimephasingCode)
        );
        const etcSnap = await getDocs(etcQuery);
        const etcDetails = etcSnap.docs.map(doc => doc.data());
        
        // 3. Get Subcontract Phasing
        const subphasingByPeriod: Record<string, number> = {};
        const matchCode = selectedTimephasingCode.trim().toUpperCase();
        const targetCodeForSub = costCodes.find(c => 
          c.code.trim().toUpperCase() === matchCode
        );

        subcontracts.forEach(sub => {
          (sub.lineItems || []).forEach(li => {
            if (li.status === 'Rejected') return;
            
            const rawId = li.costCodeId;
            const assignedCodeId = (rawId && rawId.trim() !== '') ? rawId : sub.defaultCostCodeId;
            if (!assignedCodeId) return;

            const assignedClean = assignedCodeId.toString().trim().toUpperCase();
            const assignedCodeOnly = assignedClean.split(' - ')[0].trim();

            let isMatch = (assignedClean === matchCode || assignedCodeOnly === matchCode);
            if (!isMatch && targetCodeForSub) {
              const targetId = (targetCodeForSub.id || '').toString().trim().toUpperCase();
              const targetCodeValue = (targetCodeForSub.code || '').toString().trim().toUpperCase();
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

        const etcByPeriod: Record<string, number> = {};
        const futurePeriodIds = periods.slice(currentPeriodIndex + 1).map(p => p.id);

        etcDetails.forEach((etc: any) => {
          if (etc.periodValues) {
            Object.entries(etc.periodValues).forEach(([periodId, value]) => {
              // Only include future periods in ETC aggregation
              if (futurePeriodIds.includes(periodId)) {
                etcByPeriod[periodId] = (etcByPeriod[periodId] || 0) + (Number(value) || 0) * (etc.rate || 0);
              }
            });
          }
        });

        // 3. Get Phasing (Baseline/Approved/EAC settings)
        const codePhasing = costPhasing.filter(p => p.costCodeId === selectedTimephasingCode);
        const baselineDoc = codePhasing.find(p => p.type === 'baseline');
        const approvedDoc = codePhasing.find(p => p.type === 'approved');
        const eacDoc = codePhasing.find(p => p.type === 'eac');

        const baselinePhasing = baselineDoc?.periodValues || {};
        const approvedPhasing = approvedDoc?.periodValues || {};

        const eacPrevDoc = codePhasing.find(p => p.type === 'eacPrevious');

        // 4. Construct Rows
        const selectedCodeData = costCodes.find(c => c.code === selectedTimephasingCode);
        const eacMethod = selectedCodeData?.eacMethod;

        const getPhasingSource = (doc: any, type: string) => {
          const savedSource = doc?.phasingSource;
          if (type === 'eac') {
            // If EAC Method is not ETC Details, Phasing Source cannot be ETC Details
            if (savedSource === 'ETC Details' && eacMethod !== 'ETC Details') {
              return 'Manual';
            }
            return savedSource || (eacMethod === 'ETC Details' ? 'ETC Details' : 'Manual');
          }
          return savedSource || 'Manual';
        };

        const rows: any[] = [
          {
            id: 'baseline',
            type: 'Baseline Budget',
            costCode: selectedTimephasingCode,
            phasingSource: getPhasingSource(baselineDoc, 'baseline'),
            activityId: baselineDoc?.activityId || null,
            startDate: baselineDoc?.startDate ? new Date(baselineDoc.startDate) : '',
            endDate: baselineDoc?.endDate ? new Date(baselineDoc.endDate) : '',
            distribution: baselineDoc?.distribution || 'Even',
            periodValues: periods.reduce((acc, p) => {
              const source = getPhasingSource(baselineDoc, 'baseline');
              if (source === 'SubContract') {
                acc[p.id] = subphasingByPeriod[p.id] || 0;
              } else {
                acc[p.id] = baselineDoc?.periodValues?.[p.id] || 0;
              }
              return acc;
            }, {} as Record<string, number>),
            totalFromCode: selectedCodeData?.baselineBudget || 0,
            docId: baselineDoc?.id,
            eacMethod
          },
          {
            id: 'approved',
            type: 'Approved Budget',
            costCode: selectedTimephasingCode,
            phasingSource: getPhasingSource(approvedDoc, 'approved'),
            activityId: approvedDoc?.activityId || null,
            startDate: approvedDoc?.startDate ? new Date(approvedDoc.startDate) : '',
            endDate: approvedDoc?.endDate ? new Date(approvedDoc.endDate) : '',
            distribution: approvedDoc?.distribution || 'Even',
            periodValues: periods.reduce((acc, p) => {
              const source = getPhasingSource(approvedDoc, 'approved');
              if (source === 'SubContract') {
                acc[p.id] = subphasingByPeriod[p.id] || 0;
              } else {
                acc[p.id] = approvedDoc?.periodValues?.[p.id] || 0;
              }
              return acc;
            }, {} as Record<string, number>),
            totalFromCode: selectedCodeData?.approvedBudget || 0,
            docId: approvedDoc?.id,
            eacMethod
          },
          {
            id: 'eac',
            type: 'Estimate At Completion',
            costCode: selectedTimephasingCode,
            phasingSource: getPhasingSource(eacDoc, 'eac'),
            activityId: eacDoc?.activityId || null,
            startDate: eacDoc?.startDate ? new Date(eacDoc.startDate) : '',
            endDate: eacDoc?.endDate ? new Date(eacDoc.endDate) : '',
            distribution: eacDoc?.distribution || 'Even',
            totalFromCode: selectedCodeData?.estimateAtCompletion || 0,
            docId: eacDoc?.id,
            eacMethod,
            periodValues: periods.reduce((acc, p, idx) => {
              const phasingSource = getPhasingSource(eacDoc, 'eac');
              
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
              } else if (phasingSource === 'Manual' || phasingSource === 'Auto') {
                acc[p.id] = eacDoc?.periodValues?.[p.id] || 0;
                if (idx <= currentPeriodIndex) {
                  acc[p.id] = actualsByPeriod[p.id] || 0;
                }
              }
              return acc;
            }, {} as Record<string, number>)
          }
        ];

        if (eacPrevDoc) {
          rows.push({
            id: 'eacPrevious',
            type: 'EAC Previous',
            costCode: selectedTimephasingCode,
            periodValues: eacPrevDoc.periodValues || {},
            totalFromCode: selectedCodeData?.estimateAtCompletionPrevious || 0,
            docId: eacPrevDoc.id,
            hidden: true
          });
        }

        setTimephasingRows(rows);
        setIsTimephasingLoading(false);
      } catch (error) {
        console.error("Error processing timephasing data:", error);
        setIsTimephasingLoading(false);
      }
    };

    fetchData();
  }, [selectedTimephasingCode, project.id, costCodes, costPhasing, project.reportingPeriods, subcontracts]);

  enum OperationType {
    CREATE = 'create',
    UPDATE = 'update',
    DELETE = 'delete',
    LIST = 'list',
    GET = 'get',
    WRITE = 'write',
  }

  const handleFirestoreError = (error: any, operationType: OperationType, path: string | null) => {
    const errInfo = {
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
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    return error;
  };

  const handleAddEtcRow = async () => {
    if (!selectedEtcCode) return;
    try {
      const batch = writeBatch(db);
      const count = Math.max(1, Math.min(500, addRowsCount));
      
      // Determine insertion point
      let insertSortOrder: number;
      const selectedRows = etcGridRef.current?.api.getSelectedRows() || [];
      if (selectedRows.length > 0) {
        // Insert after the last selected row
        const lastSelected = selectedRows[selectedRows.length - 1];
        insertSortOrder = lastSelected.sortOrder + 1;
        
        // Shift others
        const toShift = etcRows.filter(r => r.sortOrder >= insertSortOrder);
        toShift.forEach(r => {
          batch.update(doc(db, 'etcDetails', r.id), { sortOrder: r.sortOrder + count });
        });
      } else {
        // Add at the end
        const maxSortOrder = etcRows.length > 0 ? Math.max(...etcRows.map(r => r.sortOrder || 0)) : -1;
        insertSortOrder = maxSortOrder + 1;
      }
      
      for (let i = 0; i < count; i++) {
          const newRow = {
            projectId: project.id,
            costCode: selectedEtcCode,
            item: '',
            description: '',
            qty: 0,
            unit: '',
            rate: 0,
            phasingMethod: 'Manual',
            phasingStartDate: '',
            phasingEndDate: '',
            phasingUnit: '',
            phasingQty: 0,
            category: '',
            periodValues: {},
            enterpriseAttributes: {},
            projectAttributes: {},
            userDefined: {},
            sortOrder: insertSortOrder + i,
            createdAt: new Date().toISOString(),
            source: 'MANUAL',
            isEnterpriseResource: false
          };
        const docRef = doc(collection(db, 'etcDetails'));
        batch.set(docRef, newRow);
      }
      
      await batch.commit();
      toast.success(`${count} row(s) added successfully`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'etcDetails');
      toast.error("Failed to add row. Check console for details.");
    }
  };


  const handleAddResources = async (resources: any[], source: 'enterprise' | 'project' = 'enterprise') => {
    if (!selectedEtcCode || resources.length === 0) return;
    try {
      const batch = writeBatch(db);
      const count = Math.max(1, Math.min(500, addRowsCount));
      
      // Determine insertion point
      let insertSortOrder: number;
      const selectedRows = etcGridRef.current?.api.getSelectedRows() || [];
      if (selectedRows.length > 0) {
        // Insert after the last selected row
        const lastSelected = selectedRows[selectedRows.length - 1];
        insertSortOrder = lastSelected.sortOrder + 1;
        
        // Shift others
        const totalNewRows = count * resources.length;
        const toShift = etcRows.filter(r => r.sortOrder >= insertSortOrder);
        toShift.forEach(r => {
          batch.update(doc(db, 'etcDetails', r.id), { sortOrder: r.sortOrder + totalNewRows });
        });
      } else {
        // Add at the end
        const maxSortOrder = etcRows.length > 0 ? Math.max(...etcRows.map(r => r.sortOrder || 0)) : -1;
        insertSortOrder = maxSortOrder + 1;
      }

      let currentSortOrder = insertSortOrder;
      for (const resource of resources) {
        for (let i = 0; i < count; i++) {
          const newRow = {
            projectId: project.id,
            costCode: selectedEtcCode,
            item: resource.id,
            description: resource.name,
            qty: 0,
            unit: resource.unit || 'HR',
            rate: resource.rate || 0,
            phasingMethod: 'Manual',
            phasingStartDate: '',
            phasingEndDate: '',
            phasingUnit: '',
            phasingQty: 0,
            category: resource.category || '',
            periodValues: {},
            enterpriseAttributes: {},
            projectAttributes: {},
            userDefined: {},
            sortOrder: currentSortOrder++,
            createdAt: new Date().toISOString(),
            isEnterpriseResource: source === 'enterprise',
            source: source.toUpperCase(),
            resourceId: resource.id
          };
          const docRef = doc(collection(db, 'etcDetails'));
          batch.set(docRef, newRow);
        }
      }
      
      await batch.commit();
      setIsResourceModalOpen(false);
      setSelectedResourceIds(new Set());
      toast.success(`${resources.length * count} row(s) added successfully`);
    } catch (error) {
      console.error("Error adding resources:", error);
      toast.error("Failed to add resources");
    }
  };

  const handleUpdateEtcRow = useCallback(async (rowId: string, data: any) => {
    if (!rowId) return;
    try {
      const allPeriods = project.reportingPeriods?.periods || [];
      const currentPeriodId = project.reportingPeriods?.currentPeriodId;
      const currentIndex = allPeriods.findIndex(p => p.id === currentPeriodId);
      const futurePeriodIds = allPeriods.slice(currentIndex + 1).map(p => p.id);

      // Create a clean update object with only valid fields
      const updates: any = {
        updatedAt: new Date().toISOString()
      };

      // Define allowed fields
      const allowedFields = [
        'item', 'description', 'category', 'unit', 'rate', 'qty', 
        'phasingMethod', 'phasingStartDate', 'phasingEndDate', 
        'phasingUnit', 'phasingQty', 'calendarId', 'periodValues',
        'enterpriseAttributes', 'projectAttributes', 'userDefined',
        'source', 'isEnterpriseResource', 'externalId', 'activityId'
      ];

      allowedFields.forEach(field => {
        if (data[field] !== undefined) {
          let val = data[field];
          
          if (val === null) {
            if (field === 'item' || field === 'description' || field === 'unit' || field === 'category') {
              val = '';
            } else if (field === 'qty' || field === 'rate' || field === 'phasingQty') {
              val = 0;
            } else if (field === 'periodValues' || field === 'enterpriseAttributes' || field === 'projectAttributes' || field === 'userDefined') {
              val = {};
            }
          }
          
          // CRITICAL: Zero out non-future periods for ETC
          if (field === 'periodValues' && val && typeof val === 'object') {
            const cleanedPeriodValues: Record<string, number> = {};
            Object.entries(val).forEach(([periodId, value]) => {
              if (futurePeriodIds.includes(periodId)) {
                cleanedPeriodValues[periodId] = Number(value) || 0;
              } else {
                cleanedPeriodValues[periodId] = 0;
              }
            });
            val = cleanedPeriodValues;
          }

          updates[field] = val;
        }
      });

      await updateDoc(doc(db, 'etcDetails', rowId), updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `etcDetails/${rowId}`);
      toast.error("Failed to update row");
    }
  }, [project.id, project.reportingPeriods]);

  const handleCalculatePhasing = async () => {
    const selectedRows = etcGridRef.current?.api.getSelectedRows() || [];
    let rowsToPhase = etcRows.filter(r => r.phasingMethod === 'Auto-Phase');
    
    // If user has selected specific rows, only phase those
    if (selectedRows.length > 0) {
      rowsToPhase = selectedRows;
    }

    if (rowsToPhase.length === 0) {
      toast.info("No rows selected for phasing");
      return;
    }

    if (!project.reportingPeriods?.periods) return;

    const allPeriods = project.reportingPeriods.periods;
    const currentPeriodId = project.reportingPeriods.currentPeriodId;
    const currentIndex = allPeriods.findIndex(p => p.id === currentPeriodId);

    // Clearing periods (starting from current period to ensure no old forecast pollution)
    const periodsToClear = currentIndex !== -1 ? allPeriods.slice(currentIndex) : allPeriods;
    // Distribution periods (starting from next period)
    const distributionPeriods = currentIndex !== -1 ? allPeriods.slice(currentIndex + 1) : allPeriods;

    if (distributionPeriods.length === 0) {
      toast.error("No future periods available for phasing");
      return;
    }

    const batch = writeBatch(db);
    let updatedCount = 0;

    const parseDateToUTCMidnight = (val: any): Date | null => {
      if (!val) return null;
      let d: Date;
      if (val instanceof Date) d = val;
      else if (typeof val === 'object' && 'toDate' in val) d = val.toDate();
      else d = new Date(val);
      if (isNaN(d.getTime())) return null;
      return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    };

    for (const row of rowsToPhase) {
        const phasingQty = Number(row.phasingQty) || 0;
        if (!phasingQty || !row.phasingUnit) continue;

        const userStartRaw = parseDateToUTCMidnight(row.phasingStartDate);
        const userEndRaw = parseDateToUTCMidnight(row.phasingEndDate);

        const newPeriodValues: Record<string, number> = { ...(row.periodValues as Record<string, number> || {}) };
        
        // Retain past periods but clear out all distribution periods before writing new values
        periodsToClear.forEach(p => {
          delete newPeriodValues[p.id];
          Object.keys(newPeriodValues).forEach(k => { if (k.startsWith(p.id + '_')) delete newPeriodValues[k]; });
        });

        if (row.phasingUnit === 'Profile' && (!userStartRaw || !userEndRaw)) {
          const existingPeriodValues = (row.periodValues || {}) as Record<string, number>;
          let totalWeight = 0;
          const periodWeights: Record<string, number> = {};
          
          distributionPeriods.forEach(p => {
            let pWeight = Number(existingPeriodValues[p.id]) || 0;
            Object.entries(existingPeriodValues).forEach(([key, val]) => {
              if (key.startsWith(p.id + '_')) pWeight += Number(val) || 0;
            });
            periodWeights[p.id] = pWeight;
            totalWeight += pWeight;
          });

          if (totalWeight > 0) {
            let sumDistributed = 0;
            distributionPeriods.forEach((p, idx) => {
              if (idx === distributionPeriods.length - 1) {
                newPeriodValues[p.id] = Math.round((phasingQty - sumDistributed) * 10000) / 10000;
              } else {
                const weight = (periodWeights[p.id] || 0) / totalWeight;
                const periodQty = Math.round(phasingQty * weight * 10000) / 10000;
                newPeriodValues[p.id] = periodQty;
                sumDistributed += periodQty;
              }
            });
          } else {
            let sumDistributed = 0;
            const evenQty = Math.round((phasingQty / distributionPeriods.length) * 10000) / 10000;
            distributionPeriods.forEach((p, idx) => {
              if (idx === distributionPeriods.length - 1) {
                newPeriodValues[p.id] = Math.round((phasingQty - sumDistributed) * 10000) / 10000;
              } else {
                newPeriodValues[p.id] = evenQty;
                sumDistributed += evenQty;
              }
            });
          }

          batch.update(doc(db, 'etcDetails', row.id), {
            periodValues: newPeriodValues,
            qty: Object.keys(newPeriodValues)
              .filter(key => distributionPeriods.some(dp => dp.id === key)) 
              .reduce((sum, key) => sum + (newPeriodValues[key] || 0), 0),
            updatedAt: new Date().toISOString()
          });
          updatedCount++;
          continue;
        }

        if (!userStartRaw || !userEndRaw) continue;

        let userStart = new Date(userStartRaw.getTime());
        let userEnd = new Date(userEndRaw.getTime());

        // Constrain distribution to future periods
        if (distributionPeriods.length > 0) {
          const futureStartRaw = parseDateToUTCMidnight(distributionPeriods[0].startDate);
          if (futureStartRaw) {
            if (userStart < futureStartRaw) userStart = new Date(futureStartRaw.getTime());
            if (userEnd < futureStartRaw) userEnd = new Date(futureStartRaw.getTime());
          }
        }

        if (userEnd < userStart) continue;

        const calendar = calendars.find(c => c.id === row.calendarId);
        const isWorkingDay = (date: Date) => {
          if (!calendar) return true;
          const day = date.getUTCDay();
          const dateStr = date.toISOString().split('T')[0];
          if (Array.isArray(calendar.weekends) && calendar.weekends.includes(day)) return false;
          if (Array.isArray(calendar.holidays) && calendar.holidays.includes(dateStr)) return false;
          return true;
        };

        const workingDaysInPeriod: Record<string, number> = {};
        const distributionPeriodIds: string[] = [];
        let totalWorkingDaysInRange = 0;

        let tempStep = new Date(userStart.getTime());
        while (tempStep <= userEnd) {
          if (isWorkingDay(tempStep)) {
            totalWorkingDaysInRange++;
            const period = distributionPeriods.find(p => {
              const ps = parseDateToUTCMidnight(p.startDate);
              const pe = parseDateToUTCMidnight(p.endDate);
              return ps && pe && tempStep >= ps && tempStep <= pe;
            });
            if (period) {
              if (!workingDaysInPeriod[period.id]) {
                distributionPeriodIds.push(period.id);
                workingDaysInPeriod[period.id] = 0;
              }
              workingDaysInPeriod[period.id]++;
            }
          }
          tempStep.setUTCDate(tempStep.getUTCDate() + 1);
        }

        if (totalWorkingDaysInRange === 0 || distributionPeriodIds.length === 0) continue;

        if (row.phasingUnit === 'Total') {
          const dailyQty = phasingQty / totalWorkingDaysInRange;
          let sumDistributed = 0;
          distributionPeriodIds.forEach((pid, idx) => {
            if (idx === distributionPeriodIds.length - 1) {
              newPeriodValues[pid] = Math.round((phasingQty - sumDistributed) * 10000) / 10000;
            } else {
              const periodQty = Math.round(dailyQty * workingDaysInPeriod[pid] * 10000) / 10000;
              newPeriodValues[pid] = periodQty;
              sumDistributed += periodQty;
            }
          });
        } else {
          // Legacy Day-by-Day for Daily/Weekly
          let current = new Date(userStart.getTime());
          while (current <= userEnd) {
            if (!isWorkingDay(current)) {
              current.setUTCDate(current.getUTCDate() + 1);
              continue;
            }

            const dayStr = current.getUTCDate().toString().padStart(2, '0');
            const monthStr = (current.getUTCMonth() + 1).toString().padStart(2, '0');
            
            const period = distributionPeriods.find(p => {
              const ps = parseDateToUTCMidnight(p.startDate);
              const pe = parseDateToUTCMidnight(p.endDate);
              return ps && pe && current >= ps && current <= pe;
            });

            if (period) {
              let dailyQtyAmt = 0;
              if (row.phasingUnit === 'Daily') {
                dailyQtyAmt = phasingQty;
              } else if (row.phasingUnit === 'Weekly') {
                let weekWorkingDays = 0;
                let weekEnd = new Date(current.getTime());
                let diff = (weekEndingDay - weekEnd.getUTCDay() + 7) % 7;
                weekEnd.setUTCDate(weekEnd.getUTCDate() + diff);
                let weekStart = new Date(weekEnd.getTime());
                weekStart.setUTCDate(weekStart.getUTCDate() - 6);
                let weekTemp = new Date(weekStart.getTime());
                while (weekTemp <= weekEnd) {
                  if (isWorkingDay(weekTemp)) weekWorkingDays++;
                  weekTemp.setUTCDate(weekTemp.getUTCDate() + 1);
                }
                dailyQtyAmt = weekWorkingDays > 0 ? phasingQty / weekWorkingDays : 0;
              } else if (row.phasingUnit === 'Monthly') {
                let monthWorkingDays = 0;
                let monthStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
                let monthEnd = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0));
                let monthTemp = new Date(monthStart.getTime());
                while (monthTemp <= monthEnd) {
                  if (isWorkingDay(monthTemp)) monthWorkingDays++;
                  monthTemp.setUTCDate(monthTemp.getUTCDate() + 1);
                }
                dailyQtyAmt = monthWorkingDays > 0 ? phasingQty / monthWorkingDays : 0;
              }

              newPeriodValues[period.id] = (newPeriodValues[period.id] || 0) + dailyQtyAmt;

              // Also handle weekly and daily buckets
              let weekId = '';
              let weekStart = new Date(current.getTime());
              let wEnd = new Date(current.getTime());
              let wDiff = (weekEndingDay - wEnd.getUTCDay() + 7) % 7;
              wEnd.setUTCDate(wEnd.getUTCDate() + wDiff);
              
              // Find which week this is in the period
              const pStart = parseDateToUTCMidnight(period.startDate);
              if (pStart) {
                let weekCounter = 1;
                let tempW = new Date(pStart.getTime());
                while (tempW <= parseDateToUTCMidnight(period.endDate)!) {
                  let twEnd = new Date(tempW.getTime());
                  let twDiff = (weekEndingDay - twEnd.getUTCDay() + 7) % 7;
                  twEnd.setUTCDate(twEnd.getUTCDate() + twDiff);
                  if (current >= tempW && current <= twEnd) {
                    weekId = `${period.id}_w${weekCounter}`;
                    break;
                  }
                  tempW = new Date(twEnd.getTime());
                  tempW.setUTCDate(tempW.getUTCDate() + 1);
                  weekCounter++;
                }
              }

              if (weekId) {
                newPeriodValues[weekId] = (newPeriodValues[weekId] || 0) + dailyQtyAmt;
              }
              const dayId = `${period.id}_d${dayStr}${monthStr}`;
              newPeriodValues[dayId] = (newPeriodValues[dayId] || 0) + dailyQtyAmt;
            }
            current.setUTCDate(current.getUTCDate() + 1);
          }
        }

        // Final rounding for all period values
        Object.keys(newPeriodValues).forEach(key => {
          newPeriodValues[key] = Math.round(newPeriodValues[key] * 10000) / 10000;
        });

        batch.update(doc(db, 'etcDetails', row.id), {
          periodValues: newPeriodValues,
          qty: Object.keys(newPeriodValues)
            .filter(key => distributionPeriods.some(dp => dp.id === key)) 
            .reduce((sum, key) => sum + (newPeriodValues[key] || 0), 0),
          updatedAt: new Date().toISOString()
        });
        updatedCount++;
      }

    if (updatedCount > 0) {
      try {
        await batch.commit();
        toast.success(`Calculated phasing for ${updatedCount} rows`);
      } catch (error) {
        console.error("Error calculating phasing:", error);
        toast.error("Failed to calculate phasing");
      }
    } else {
      toast.warning("No valid rows to calculate. Check highlighted rows.");
    }
  };

  const handleDeleteEtcRow = async (rowId: string) => {
    try {
      await deleteDoc(doc(db, 'etcDetails', rowId));
      toast.success("Row deleted");
    } catch (error) {
      console.error("Error deleting ETC row:", error);
      toast.error("Failed to delete row");
    }
  };

  const handleDeleteEtcRows = async (type: 'selected' | 'all') => {
    if (!selectedEtcCode) return;
    
    const rowsToDelete = type === 'selected' 
      ? Array.from(selectedEtcIds) 
      : etcRows.map(r => r.id);

    if (rowsToDelete.length === 0) return;

    if (!confirm(`Are you sure you want to delete ${type === 'selected' ? rowsToDelete.length : 'all'} row(s)?`)) return;

    try {
      const batch = writeBatch(db);
      rowsToDelete.forEach(id => {
        batch.delete(doc(db, 'etcDetails', id));
      });
      await batch.commit();
      setSelectedEtcIds(new Set());
      toast.success(`${rowsToDelete.length} row(s) deleted`);
    } catch (error) {
      console.error("Error bulk deleting ETC rows:", error);
      toast.error("Failed to delete rows");
    }
  };

  const handleBulkUpdateEtc = async () => {
    if (selectedEtcIds.size === 0) return;
    
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      selectedEtcIds.forEach(id => {
        const row = etcRows.find(r => r.id === id);
        const updateObj: any = {
          updatedAt: new Date().toISOString()
        };
        
        // Only allow category update if NOT a library resource
        const isLibraryResource = row?.isEnterpriseResource || row?.source === 'PROJECT';
        if (etcBulkUpdateData.category && !isLibraryResource) {
          updateObj.category = etcBulkUpdateData.category;
        }
        
        if (etcBulkUpdateData.calendarId) updateObj.calendarId = etcBulkUpdateData.calendarId;
        if (etcBulkUpdateData.phasingMethod) updateObj.phasingMethod = etcBulkUpdateData.phasingMethod;
        if (etcBulkUpdateData.phasingUnit) updateObj.phasingUnit = etcBulkUpdateData.phasingUnit;
        
        if (Object.keys(etcBulkUpdateData.enterpriseAttributes).length > 0) {
          updateObj.enterpriseAttributes = { 
            ...(row?.enterpriseAttributes || {}), 
            ...etcBulkUpdateData.enterpriseAttributes 
          };
        }
        
        if (Object.keys(etcBulkUpdateData.projectAttributes).length > 0) {
          updateObj.projectAttributes = { 
            ...(row?.projectAttributes || {}), 
            ...etcBulkUpdateData.projectAttributes 
          };
        }

        if (Object.keys(etcBulkUpdateData.userDefined || {}).length > 0) {
          updateObj.userDefined = {
            ...(row?.userDefined || {}),
            ...etcBulkUpdateData.userDefined
          };
        }
        
        batch.update(doc(db, 'etcDetails', id), updateObj);
      });
      
      await batch.commit();
      setIsEtcBulkUpdating(false);
      setSelectedEtcIds(new Set());
      setEtcBulkUpdateData({ enterpriseAttributes: {}, projectAttributes: {}, userDefined: {} });
      toast.success(`Updated ${selectedEtcIds.size} rows`);
    } catch (error) {
      console.error("Error bulk updating ETC:", error);
      toast.error("Failed to update rows");
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportEtc = () => {
    if (!selectedEtcCode) return;
    const allPeriods = project.reportingPeriods?.periods || [];
    const currentPeriodId = project.reportingPeriods?.currentPeriodId;
    const currentIndex = allPeriods.findIndex(p => p.id === currentPeriodId);
    
    // Only export future periods for ETC
    const futurePeriods = allPeriods.slice(currentIndex + 1);

    const data = etcRows.map(row => {
      const exportRow: any = {
        'Activity ID': row.activityId || '',
        'Item': row.item,
        'Description': row.description,
        'Category': row.category,
        'Unit': row.unit,
        'Rate': row.rate,
      };

      enterpriseLineItemAttrs.forEach(attr => {
        exportRow[`E_${attr.title}`] = row.enterpriseAttributes?.[attr.id] || '';
      });

      projectLineItemAttrs.forEach(attr => {
        exportRow[`P_${attr.title}`] = row.projectAttributes?.[attr.id] || '';
      });

      for (let i = 1; i <= 5; i++) {
        exportRow[`Numeric ${i}`] = row.userDefined?.[`num${i}`] || 0;
        exportRow[`Text ${i}`] = row.userDefined?.[`text${i}`] || '';
      }

      futurePeriods.forEach(p => {
        exportRow[p.name] = row.periodValues?.[p.id] || 0;
      });
      return exportRow;
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ETC Details');
    XLSX.writeFile(wb, `ETC_Details_${selectedEtcCode}_${project.projectName}.xlsx`);
  };

  const handleImportEtc = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedEtcCode) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const allPeriods = project.reportingPeriods?.periods || [];
        const currentPeriodId = project.reportingPeriods?.currentPeriodId;
        const currentIndex = allPeriods.findIndex(p => p.id === currentPeriodId);
        const futurePeriodIds = allPeriods.slice(currentIndex + 1).map(p => p.id);

        const batch = writeBatch(db);

        data.forEach(row => {
          const periodValues: Record<string, number> = {};
          allPeriods.forEach(p => {
            if (row[p.name] !== undefined) {
              // Only import values for future periods
              if (futurePeriodIds.includes(p.id)) {
                periodValues[p.id] = Number(row[p.name]) || 0;
              } else {
                periodValues[p.id] = 0;
              }
            }
          });

          const enterpriseAttributes: Record<string, string> = {};
          enterpriseLineItemAttrs.forEach(attr => {
            if (row[`E_${attr.title}`] !== undefined) {
              enterpriseAttributes[attr.id] = String(row[`E_${attr.title}`]);
            }
          });

          const projectAttributes: Record<string, string> = {};
          projectLineItemAttrs.forEach(attr => {
            if (row[`P_${attr.title}`] !== undefined) {
              projectAttributes[attr.id] = String(row[`P_${attr.title}`]);
            }
          });

          const userDefined: Record<string, any> = {};
          for (let i = 1; i <= 5; i++) {
            if (row[`Numeric ${i}`] !== undefined) userDefined[`num${i}`] = Number(row[`Numeric ${i}`]) || 0;
            if (row[`Text ${i}`] !== undefined) userDefined[`text${i}`] = String(row[`Text ${i}`]);
          }

          const newRowRef = doc(collection(db, 'etcDetails'));
          batch.set(newRowRef, {
            projectId: project.id,
            costCode: selectedEtcCode,
            activityId: row['Activity ID'] || '',
            item: row['Item'] || '',
            description: row['Description'] || '',
            orderNumber: row['Order Number'] || '',
            qty: 0, // Calculated by valueGetter
            unit: row['Unit'] || '',
            rate: Number(row['Rate']) || 0,
            periodValues,
            enterpriseAttributes,
            projectAttributes,
            userDefined,
            createdAt: new Date().toISOString()
          });
        });

        await batch.commit();
        toast.success(`Imported ${data.length} rows successfully`);
      } catch (error) {
        console.error("Error importing ETC details:", error);
        toast.error("Failed to import rows");
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const etcPinnedTopRowData = useMemo(() => {
    if (etcRows.length === 0) return [];
    const allPeriods = project.reportingPeriods?.periods || [];
    const currentPeriodId = project.reportingPeriods?.currentPeriodId;
    const currentIndex = allPeriods.findIndex(p => p.id === currentPeriodId);
    
    // Only consider future periods for ETC subtotal
    const futurePeriods = allPeriods.slice(currentIndex + 1);
    const futurePeriodIds = futurePeriods.map(p => p.id);

    const totals: Record<string, number> = {};
    let totalEtcPrevious = 0;
    
    etcRows.forEach(row => {
      const periodValues = row.periodValues || {};
      futurePeriodIds.forEach(pId => {
        totals[pId] = (totals[pId] || 0) + (periodValues[pId] || 0);
        // Also handle sub-periods if any
        Object.keys(periodValues).forEach(key => {
          if (key.startsWith(pId + '_')) {
            totals[key] = (totals[key] || 0) + (periodValues[key] || 0);
          }
        });
      });
      totalEtcPrevious += row.totalEtcPrevious || 0;
    });

    const totalQty = etcRows.reduce((acc, r) => {
      const periodValues = (r.periodValues || {}) as Record<string, number>;
      const rowQty = futurePeriodIds.reduce((sum: number, pId: string) => sum + (periodValues[pId] || 0), 0);
      return acc + rowQty;
    }, 0);

    const totalEtc = etcRows.reduce((acc, r) => {
      const periodValues = (r.periodValues || {}) as Record<string, number>;
      const rowQty = futurePeriodIds.reduce((sum: number, pId: string) => sum + (periodValues[pId] || 0), 0);
      return acc + (rowQty * (r.rate || 0));
    }, 0);

    return [{
      item: '',
      description: 'SubTotal',
      qty: totalQty,
      rate: null,
      totalEtc: totalEtc,
      totalEtcPrevious: totalEtcPrevious,
      etcMvmt: totalEtc - totalEtcPrevious,
      periodValues: totals,
      isSubtotal: true
    }];
  }, [etcRows, project.reportingPeriods]);

  const enterpriseLineItemAttrs = useMemo(() => 
    (enterprise.lineItemAttributes || []).filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0),
    [enterprise.lineItemAttributes]
  );

  const projectLineItemAttrs = useMemo(() => 
    (project.lineItemAttributes || []).filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0),
    [project.lineItemAttributes]
  );

  const etcColumnDefsRef = useRef<(ColDef | ColGroupDef)[]>([]);
  const DEFAULT_CATEGORIES = ['Labour', 'Plant', 'Material', 'Subcontractor', 'Sundries', 'Staff'];

  const etcColumnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    const allPeriods = project.reportingPeriods?.periods || [];
    const currentPeriodId = project.reportingPeriods?.currentPeriodId;
    const currentIndex = allPeriods.findIndex(p => p.id === currentPeriodId);
    
    // Only show future periods
    const periods = allPeriods.slice(currentIndex + 1);

    const defs: (ColDef | ColGroupDef)[] = [
      {
        headerName: 'Core Information',
        openByDefault: true,
        children: [
          {
            headerName: '',
            width: 40,
            pinned: 'left',
            checkboxSelection: true,
            headerCheckboxSelection: true,
            headerCheckboxSelectionFilteredOnly: true,
            cellRenderer: (params: any) => {
              if (params.node.rowPinned === 'top') return null;
              return null; // Ag-grid handles checkbox
            }
          },
          {
            headerName: 'Source',
            width: 100,
            pinned: 'left',
            cellRenderer: (params: any) => {
              if (params.node.rowPinned === 'top') return null;
              const source = params.data.source || (params.data.isEnterpriseResource ? 'ENTERPRISE' : 'MANUAL');
              
              if (source === 'PROJECT') {
                return <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px] uppercase font-bold">Project</Badge>;
              }
              if (source === 'ENTERPRISE') {
                return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] uppercase font-bold">Enterprise</Badge>;
              }
              return <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200 text-[10px] uppercase font-bold">Manual</Badge>;
            }
          },
          {
            headerName: 'Item Details',
            pinned: 'left',
            openByDefault: true,
            children: [
              { 
                field: 'item', 
                headerName: 'Item', 
                width: 120, 
                pinned: 'left',
                editable: (params) => !params.data.isEnterpriseResource && params.data.source !== 'PROJECT'
              },
              { 
                field: 'description', 
                headerName: 'Description', 
                width: 200, 
                pinned: 'left',
                editable: (params) => !params.data.isEnterpriseResource && params.data.source !== 'PROJECT',
                cellRenderer: (params: any) => {
                  if (params.node.rowPinned === 'top') {
                    return <span className="font-bold text-blue-600 dark:text-blue-400">SubTotal</span>;
                  }
                  return params.value;
                }
              },
              { 
                field: 'category', 
                headerName: 'Resource Category', 
                width: 120, 
                editable: (params) => !params.data.isEnterpriseResource && params.data.source !== 'PROJECT',
                cellEditor: 'agSelectCellEditor',
                cellEditorParams: {
                  values: (enterprise.categories && enterprise.categories.length > 0) ? enterprise.categories : DEFAULT_CATEGORIES
                }
              },
            ]
          },
        ]
      }
    ];

    if (enterpriseLineItemAttrs.length > 0) {
      defs.push({
        headerName: 'Enterprise Line-Item Attributes',
        openByDefault: true,
        children: enterpriseLineItemAttrs.map((attr, index) => ({
          headerName: attr.title,
          field: `enterpriseAttributes.${attr.id}`,
          width: 150,
          columnGroupShow: index === 0 ? undefined : 'open',
          editable: (params: any) => params.node.rowPinned !== 'top',
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: {
            values: attr.values.map(v => v.id),
          },
          valueSetter: (params: any) => {
            if (!params.data || params.newValue === undefined) return false;
            if (!params.data.enterpriseAttributes) {
              params.data.enterpriseAttributes = {};
            }
            let val = params.newValue;
            if (typeof val === 'string' && val.includes(' - ')) {
              val = val.split(' - ')[0];
            }
            params.data.enterpriseAttributes[attr.id] = val;
            return true;
          },
          valueFormatter: (params: any) => {
            const v = attr.values.find(v => v.id === params.value);
            return v ? `${v.id} - ${v.description}` : params.value;
          }
        }))
      });
    }

    if (projectLineItemAttrs.length > 0) {
      defs.push({
        headerName: 'Project Line-Item Attributes',
        openByDefault: true,
        children: projectLineItemAttrs.map((attr, index) => ({
          headerName: attr.title,
          field: `projectAttributes.${attr.id}`,
          width: 150,
          columnGroupShow: index === 0 ? undefined : 'open',
          editable: (params: any) => params.node.rowPinned !== 'top',
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: {
            values: attr.values.map(v => v.id),
          },
          valueSetter: (params: any) => {
            if (!params.data || params.newValue === undefined) return false;
            if (!params.data.projectAttributes) {
              params.data.projectAttributes = {};
            }
            let val = params.newValue;
            if (typeof val === 'string' && val.includes(' - ')) {
              val = val.split(' - ')[0];
            }
            params.data.projectAttributes[attr.id] = val;
            return true;
          },
          valueFormatter: (params: any) => {
            const v = attr.values.find(v => v.id === params.value);
            return v ? `${v.id} - ${v.description}` : params.value;
          }
        }))
      });
    }

    // 4. User Defined Attributes
    defs.push({
      headerName: 'User Defined',
      openByDefault: true,
      children: [
        ...Array.from({ length: 5 }).map((_, i) => ({
          headerName: `Numeric ${i + 1}`,
          field: `userDefined.num${i + 1}`,
          width: 120,
          type: 'numericColumn',
          columnGroupShow: (i === 0 ? undefined : 'open') as any,
          editable: (params: any) => params.node.rowPinned !== 'top',
          valueParser: (params: any) => Number(params.newValue) || 0,
          valueSetter: (params: any) => {
            if (!params.data.userDefined) params.data.userDefined = {};
            params.data.userDefined[`num${i + 1}`] = params.newValue;
            return true;
          }
        })),
        ...Array.from({ length: 5 }).map((_, i) => ({
          headerName: `Text ${i + 1}`,
          field: `userDefined.text${i + 1}`,
          width: 150,
          columnGroupShow: 'open' as any,
          editable: (params: any) => params.node.rowPinned !== 'top',
          valueParser: (params: any) => {
            if (typeof params.newValue === 'string') {
              return params.newValue.substring(0, 100);
            }
            return params.newValue;
          },
          valueSetter: (params: any) => {
            if (!params.data.userDefined) params.data.userDefined = {};
            params.data.userDefined[`text${i + 1}`] = params.newValue;
            return true;
          }
        }))
      ]
    });

    defs.push({
      headerName: 'Pricing',
      pinned: 'left',
      openByDefault: true,
      children: [
          { 
            field: 'qty', 
            headerName: 'Qty', 
            width: 100, 
            type: 'numericColumn',
            aggFunc: 'sum',
            editable: false,
            valueGetter: (params) => {
              if (params.node?.rowPinned === 'top') return params.data.qty;
              if (!params.data) return 0;
              const periodValues = (params.data.periodValues || {}) as Record<string, number>;
              // CRITICAL: Only sum future periods for ETC Qty
              const total = periods.reduce((acc: number, p: any) => acc + (periodValues[p.id] || 0), 0);
              return Math.round(total * 100) / 100;
            },
            valueFormatter: (params) => {
              if (params.node?.rowPinned === 'top') return formatNumber(params.value, 2);
              return formatNumber(params.value, 2);
            },
            cellStyle: (params: any) => {
              const isPinned = params.node.rowPinned === 'top';
              if (isPinned) return {};
              return { backgroundColor: '#f3f4f6', fontWeight: 'bold', color: 'black' };
            }
          },
          { 
            field: 'unit', 
            headerName: 'Unit', 
            width: 100, 
            editable: (params) => !params.data.isEnterpriseResource && params.data.source !== 'PROJECT',
            cellStyle: (params: any) => {
              const isReadOnly = params.data?.isEnterpriseResource || params.data?.source === 'PROJECT';
              return {
                backgroundColor: isReadOnly ? '#f3f4f6' : 'white',
                fontWeight: isReadOnly ? 'bold' : 'normal',
                color: 'black'
              };
            }
          },
          { 
            field: 'rate', 
            headerName: 'Rate', 
            width: 100, 
            type: 'numericColumn', 
            editable: (params) => !params.data.isEnterpriseResource && params.data.source !== 'PROJECT',
            valueFormatter: (params) => {
              if (params.node?.rowPinned === 'top') return '';
              return formatNumber(params.value, 2);
            },
            cellStyle: (params: any) => {
              const isReadOnly = params.data?.isEnterpriseResource || params.data?.source === 'PROJECT';
              return {
                backgroundColor: isReadOnly ? '#f3f4f6' : 'white',
                fontWeight: isReadOnly ? 'bold' : 'normal',
                color: 'black'
              };
            }
          },
          { 
            headerName: 'Total ETC', 
            width: 120, 
            type: 'numericColumn',
            aggFunc: 'sum',
            valueGetter: (params) => {
              if (params.node?.rowPinned === 'top') return params.data.totalEtc;
              if (params.node?.group) return undefined;
              const periodValues = (params.data.periodValues || {}) as Record<string, number>;
              // Only sum future periods for ETC Total
              const qty = periods.reduce((acc: number, p: any) => acc + (periodValues[p.id] || 0), 0);
              return qty * (params.data.rate || 0);
            },
            valueFormatter: (params) => formatNumber(params.value, 2),
            cellStyle: (params: any) => params.node.rowPinned === 'top' ? {} : { backgroundColor: '#f3f4f6', fontWeight: 'bold', color: 'black' }
          },
          { 
            headerName: 'Total ETC Previous', 
            width: 140, 
            type: 'numericColumn',
            aggFunc: 'sum',
            editable: false,
            valueGetter: (params) => {
              if (params.node?.rowPinned === 'top') return params.data.totalEtcPrevious;
              if (params.node?.group) return undefined;
              return params.data.totalEtcPrevious || 0;
            },
            valueFormatter: (params) => formatNumber(params.value, 2),
            cellStyle: (params: any) => params.node.rowPinned === 'top' ? {} : { backgroundColor: '#f3f4f6', fontWeight: 'bold', color: 'black' }
          },
          { 
            headerName: 'ETC Mvmt', 
            width: 120, 
            type: 'numericColumn',
            aggFunc: 'sum',
            editable: false,
            valueGetter: (params) => {
              if (params.node?.rowPinned === 'top') return params.data.etcMvmt;
              if (params.node?.group) return undefined;
              
              const periodValues = (params.data.periodValues || {}) as Record<string, number>;
              const qty = periods.reduce((acc: number, p: any) => acc + (periodValues[p.id] || 0), 0);
              const totalEtc = qty * (params.data.rate || 0);
              const previous = params.data.totalEtcPrevious || 0;
              return totalEtc - previous;
            },
            valueFormatter: (params) => formatNumber(params.value, 2),
            cellStyle: (params: any) => {
              const isPinned = params.node.rowPinned === 'top';
              if (isPinned) return {};
              const val = params.value || 0;
              return {
                backgroundColor: '#f3f4f6',
                fontWeight: 'bold',
                color: val > 0 ? '#ef4444' : (val < 0 ? '#10b981' : 'black')
              };
            }
          },
        ]
      });

    defs.push({
      headerName: 'Auto-Phasing',
      pinned: 'left',
      openByDefault: true,
      children: [
        {
          field: 'calendarId',
          headerName: 'Calendar',
          width: 150,
          columnGroupShow: 'open',
          editable: (params) => params.data.phasingMethod === 'Auto-Phase',
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: {
            values: [null, ...calendars.map(c => c.id)],
            formatValue: (val: string) => calendars.find(c => c.id === val)?.name || 'None'
          },
          valueFormatter: (params) => calendars.find(c => c.id === params.value)?.name || 'None',
          cellClass: (params) => params.data.phasingMethod === 'Auto-Phase' ? 'bg-white dark:bg-transparent' : 'bg-gray-100 dark:bg-white/5 text-gray-400'
        },
        {
          field: 'phasingMethod',
          headerName: 'Method',
          width: 120,
          editable: true,
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: {
            values: ['Manual', 'Auto-Phase']
          },
          cellClass: 'font-medium'
        },
        {
          headerName: 'Activity ID',
          field: 'activityId',
          width: 150,
          editable: true,
          cellEditor: 'agRichSelectCellEditor',
          cellEditorParams: {
            values: [null, ...scheduleItems.map(item => item.activityId).sort()],
            formatValue: (val: string) => {
              const item = scheduleItems.find(i => i.activityId === val);
              return item ? `${item.activityId} - ${item.description}` : val || 'None';
            },
            searchType: 'match',
            allowTyping: true,
            filterList: true,
            highlightMatch: true
          },
          onCellValueChanged: (params) => {
            const newActivityId = params.newValue;
            if (newActivityId) {
              const scheduleItem = scheduleItems.find(s => s.activityId === newActivityId);
              if (scheduleItem) {
                params.data.phasingStartDate = scheduleItem.currentStartDate;
                params.data.phasingEndDate = scheduleItem.currentEndDate;
                params.data.phasingMethod = 'Auto-Phase';
                // Force refresh of the row to update UI
                params.api.refreshCells({ rowNodes: [params.node], force: true });
                handleUpdateEtcRow(params.data.id, params.data);
              }
            } else {
              handleUpdateEtcRow(params.data.id, params.data);
            }
          },
          cellClass: 'bg-emerald-50/10 dark:bg-emerald-900/10'
        },
        {
          field: 'phasingStartDate',
          headerName: 'Start Date',
          width: 120,
          columnGroupShow: 'open',
          editable: (params) => params.data.phasingMethod === 'Auto-Phase' && !params.data.activityId,
          cellEditor: 'agDateCellEditor',
          valueGetter: (params) => {
            const val = params.data.phasingStartDate;
            if (!val) return null;
            const d = new Date(val);
            return isNaN(d.getTime()) ? null : d;
          },
          valueSetter: safeDateSetter('phasingStartDate'),
          valueFormatter: dateFormatter,
          cellClass: (params) => {
            if (params.data.phasingMethod !== 'Auto-Phase') return 'bg-gray-100 dark:bg-white/5 text-gray-400';
            if (params.data.activityId) return 'bg-amber-50/30 dark:bg-amber-900/10 text-gray-500 italic';
            return 'bg-white dark:bg-transparent';
          }
        },
        {
          field: 'phasingEndDate',
          headerName: 'End Date',
          width: 120,
          columnGroupShow: 'open',
          editable: (params) => params.data.phasingMethod === 'Auto-Phase' && !params.data.activityId,
          cellEditor: 'agDateCellEditor',
          valueGetter: (params) => {
            const val = params.data.phasingEndDate;
            if (!val) return null;
            const d = new Date(val);
            return isNaN(d.getTime()) ? null : d;
          },
          valueSetter: safeDateSetter('phasingEndDate'),
          valueFormatter: dateFormatter,
          cellClass: (params) => {
            if (params.data.phasingMethod !== 'Auto-Phase') return 'bg-gray-100 dark:bg-white/5 text-gray-400';
            if (params.data.activityId) return 'bg-amber-50/30 dark:bg-amber-900/10 text-gray-500 italic';
            return 'bg-white dark:bg-transparent';
          }
        },
        {
          field: 'phasingUnit',
          headerName: 'Phasing Unit',
          width: 120,
          columnGroupShow: 'open',
          editable: (params) => params.data.phasingMethod === 'Auto-Phase',
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: {
            values: ['Daily', 'Weekly', 'Monthly', 'Total', 'Profile']
          },
          cellClass: (params) => params.data.phasingMethod === 'Auto-Phase' ? 'bg-white dark:bg-transparent' : 'bg-gray-100 dark:bg-white/5 text-gray-400'
        },
        {
          field: 'phasingQty',
          headerName: 'Phasing Qty',
          width: 110,
          columnGroupShow: 'open',
          type: 'numericColumn',
          editable: (params) => params.data.phasingMethod === 'Auto-Phase',
          valueFormatter: (params) => formatNumber(params.value, 2),
          cellClass: (params) => params.data.phasingMethod === 'Auto-Phase' ? 'bg-white dark:bg-transparent' : 'bg-gray-100 dark:bg-white/5 text-gray-400'
        }
      ]
    });

    if (periods.length > 0) {
      defs.push({
        headerName: 'Resource Forecasting',
        openByDefault: true,
        children: periods.map((p, idx) => {
          const date = new Date(p.endDate);
          const month = date.getUTCMonth();
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const monthName = monthNames[month];
          const year = date.getUTCFullYear().toString().slice(-2);
          const periodNumber = allPeriods.findIndex(per => per.id === p.id) + 1;
          const headerName = `P${periodNumber}\n(${monthName}'${year})`;

          return {
            headerName,
            field: `periodValues.${p.id}`,
            width: 120,
            minWidth: 110,
            type: 'numericColumn',
            aggFunc: 'sum',
            editable: (params: any) => params.data?.phasingMethod !== 'Auto-Phase',
            cellStyle: (params: any) => ({
              backgroundColor: params.data?.phasingMethod === 'Auto-Phase' ? '#f3f4f6' : 'white',
              fontWeight: params.data?.phasingMethod === 'Auto-Phase' ? 'bold' : 'normal',
              color: 'black'
            }),
            valueGetter: (params: any) => {
              if (!params.data) return 0;
              return params.data.periodValues?.[p.id] || 0;
            },
            valueFormatter: (params: any) => formatNumber(params.value, 2),
            valueSetter: (params: any) => {
              if (!params.data) return false;
              const val = Number(params.newValue);
              if (isNaN(val)) return false;
              const periodValues = { ...(params.data.periodValues || {}), [p.id]: val };
              params.data.periodValues = periodValues;
              return true;
            }
          };
        })
      });
    }

    // Add Actions column at the very end
    defs.push({
      headerName: 'Actions',
      width: 80,
      pinned: 'right',
      cellRenderer: (params: any) => {
        if (params.node.rowPinned === 'top') return null;
        return (
          <div className="flex items-center justify-center h-full">
            <button 
              onClick={() => handleDeleteEtcRow(params.data.id)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-white/10 rounded text-gray-400 hover:text-red-600 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      }
    });

    // Stable Reference Pattern: Only return a new object if the content actually changed
    if (JSON.stringify(defs) === JSON.stringify(etcColumnDefsRef.current)) {
      return etcColumnDefsRef.current;
    }
    etcColumnDefsRef.current = defs;
    return defs;
  }, [
    project.reportingPeriods, 
    etcRows,
    theme,
    calendars,
    scheduleItems,
    enterpriseLineItemAttrs,
    projectLineItemAttrs
  ]);

  const timephasingColumnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    const periods = project.reportingPeriods?.periods || [];
    const currentPeriodId = project.reportingPeriods?.currentPeriodId;
    const currentPeriodIndex = periods.findIndex(p => p.id === currentPeriodId);
    
    const defs: (ColDef | ColGroupDef)[] = [
      {
        headerName: 'Type',
        field: 'type',
        width: 180,
        pinned: 'left',
        lockPosition: 'left',
        suppressMovable: true,
        checkboxSelection: true,
        headerCheckboxSelection: true,
        cellClass: 'font-bold bg-slate-50 dark:bg-slate-900',
      },
      {
        headerName: 'Phasing Source',
        field: 'phasingSource',
        width: 130,
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: (params: any) => {
          if (params.data.id === 'eac') {
            const values = ['SubContract', 'Manual', 'Auto'];
            if (params.data.eacMethod === 'ETC Details') {
              values.unshift('ETC Details');
            }
            return { values };
          }
          return { values: ['Manual', 'Auto'] };
        },
        cellClass: 'bg-white dark:bg-slate-900',
      },
      {
        headerName: 'Activity ID',
        field: 'activityId',
        width: 150,
        editable: true,
        cellEditor: 'agRichSelectCellEditor',
        cellEditorParams: {
          values: [null, ...scheduleItems.map(item => item.activityId).sort()],
          formatValue: (val: string) => {
            const item = scheduleItems.find(i => i.activityId === val);
            return item ? `${item.activityId} - ${item.description}` : val || 'None';
          },
          searchType: 'match',
          allowTyping: true,
          filterList: true,
          highlightMatch: true
        },
        onCellValueChanged: (params: any) => {
          const newActivityId = params.newValue;
          if (newActivityId) {
            const scheduleItem = scheduleItems.find(s => s.activityId === newActivityId);
            if (scheduleItem) {
              params.data.startDate = scheduleItem.currentStartDate;
              params.data.endDate = scheduleItem.currentEndDate;
              params.data.phasingSource = 'Auto';
              // Force refresh of the row to update UI
              params.api.refreshCells({ rowNodes: [params.node], force: true });
            }
          }
        },
        cellClass: 'bg-emerald-50/10 dark:bg-emerald-900/10'
      },
      {
        headerName: 'Start Date',
        field: 'startDate',
        width: 120,
        editable: (params: any) => params.data.phasingSource === 'Auto',
        valueGetter: (params) => {
          const val = params.data.startDate;
          if (!val) return null;
          const d = new Date(val);
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
        editable: (params: any) => params.data.phasingSource === 'Auto',
        valueGetter: (params) => {
          const val = params.data.endDate;
          if (!val) return null;
          const d = new Date(val);
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
              // Baseline and Approved are always editable if source is Manual
              if (params.data.id === 'baseline' || params.data.id === 'approved') {
                return params.data.phasingSource === 'Manual';
              }
              // EAC is editable only for Future periods and if source is Manual
              if (params.data.id === 'eac') {
                return params.data.phasingSource === 'Manual' && periodIndex > currentPeriodIndex;
              }
              return false;
            },
            cellClass: (params: any) => {
              const isEditable = (params.data.id === 'baseline' || params.data.id === 'approved') 
                ? params.data.phasingSource === 'Manual'
                : (params.data.id === 'eac' && params.data.phasingSource === 'Manual' && periodIndex > currentPeriodIndex);
              
              if (isEditable) {
                return 'bg-white dark:bg-slate-900';
              }
              return 'bg-slate-50 dark:bg-slate-900/50 text-slate-400';
            },
            valueSetter: (params: any) => {
              if (!params.data.periodValues) params.data.periodValues = {};
              params.data.periodValues[p.id] = Number(params.newValue) || 0;
              return true;
            }
          };
        })
      }
    ];

    return defs;
  }, [project.reportingPeriods?.periods, project.reportingPeriods?.currentPeriodId, scheduleItems]);

  const calculatePhasing = useCallback((
    total: number,
    startDate: string,
    endDate: string,
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
    if (!selectedTimephasingCode) return;
    
    // Get selected rows from grid API
    const selectedNodes = timephasingGridRef.current?.api.getSelectedNodes();
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
          if (row.id === 'eac') {
            const code = costCodes.find(c => c.code === selectedTimephasingCode);
            // EAC auto-phasing should only distribute the ETC part
            total = code?.estimateToComplete || 0;
            
            // Validation: if start date <= current period end date, auto phasing starts from next period
            if (currentPeriodEnd && nextPeriodStart) {
              const userStart = new Date(row.startDate);
              if (userStart <= currentPeriodEnd) {
                console.log(`EAC Auto Phasing: Adjusting start date from ${row.startDate} to ${nextPeriodStart} because it was on or before current period.`);
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

          // Find doc to update
          const q = query(
            collection(db, 'costPhasing'),
            where('projectId', '==', project.id),
            where('costCodeId', '==', selectedTimephasingCode),
            where('type', '==', row.id)
          );
          const snap = await getDocs(q);
          
          const updatePayload = {
            projectId: project.id,
            costCodeId: selectedTimephasingCode,
            type: row.id,
            phasingSource: 'Auto',
            startDate: row.startDate instanceof Date ? row.startDate.toISOString() : row.startDate,
            endDate: row.endDate instanceof Date ? row.endDate.toISOString() : row.endDate,
            distribution: row.distribution,
            periodValues: newPhasing,
            updatedAt: new Date().toISOString()
          };

          if (!snap.empty) {
            batch.update(snap.docs[0].ref, updatePayload);
          } else {
            batch.set(doc(collection(db, 'costPhasing')), updatePayload);
          }
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        await batch.commit();
        toast.success(`Recalculated phasing for ${updatedCount} row(s)`);
      } else {
        toast.warning("Incomplete auto-phasing settings (Dates or Distribution missing)");
      }
    } catch (error) {
      console.error("Error calculating auto phasing:", error);
      handleFirestoreError(error, OperationType.UPDATE, 'costPhasing/batch');
      toast.error("Failed to calculate auto phasing");
    } finally {
      setIsTimephasingLoading(false);
    }
  }, [selectedTimephasingCode, timephasingRows, project.id, project.reportingPeriods, costCodes, calculatePhasing]);

  const handleExportTimephasing = () => {
    if (!selectedTimephasingCode) return;
    const periods = project.reportingPeriods?.periods || [];
    
    const data = timephasingRows.map(row => {
      const exportRow: any = {
        'Type': row.type,
        'Phasing Source': row.phasingSource,
        'Start Date': row.startDate ? (row.startDate instanceof Date ? row.startDate.toLocaleDateString() : row.startDate) : '',
        'End Date': row.endDate ? (row.endDate instanceof Date ? row.endDate.toLocaleDateString() : row.endDate) : '',
        'Distribution': row.distribution,
      };

      periods.forEach(p => {
        exportRow[p.name] = row.periodValues?.[p.id] || 0;
      });
      return exportRow;
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Timephasing');
    XLSX.writeFile(wb, `Timephasing_${selectedTimephasingCode}_${project.projectName}.xlsx`);
  };

  const handleImportTimephasing = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedTimephasingCode) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const periods = project.reportingPeriods?.periods || [];
        const currentPeriodId = project.reportingPeriods?.currentPeriodId;
        const currentPeriodIndex = periods.findIndex(p => p.id === currentPeriodId);
        const futurePeriodIds = periods.slice(currentPeriodIndex + 1).map(p => p.id);

        const batch = writeBatch(db);

        for (const row of data) {
          const type = row['Type'];
          let phasingType = '';
          if (type === 'Baseline Budget') phasingType = 'baseline';
          else if (type === 'Approved Budget') phasingType = 'approved';
          else if (type === 'Estimate At Completion') phasingType = 'eac';

          if (!phasingType) continue;

          const existingDoc = costPhasing.find(p => p.type === phasingType && p.costCodeId === selectedTimephasingCode);
          
          const periodValues: Record<string, number> = { ...(existingDoc?.periodValues || {}) };
          periods.forEach(p => {
            if (row[p.name] !== undefined) {
              const newValue = Number(row[p.name]) || 0;
              
              if (phasingType === 'eac') {
                // Only update future periods for EAC
                if (futurePeriodIds.includes(p.id)) {
                  periodValues[p.id] = newValue;
                }
              } else {
                // Update all periods for Baseline and Approved
                periodValues[p.id] = newValue;
              }
            }
          });

          const updatePayload: any = {
            projectId: project.id,
            costCodeId: selectedTimephasingCode,
            type: phasingType,
            phasingSource: row['Phasing Source'] || (phasingType === 'eac' ? 'ETC Details' : 'Manual'),
            startDate: row['Start Date'] || '',
            endDate: row['End Date'] || '',
            distribution: row['Distribution'] || 'Even',
            periodValues,
            updatedAt: new Date().toISOString()
          };

          if (existingDoc) {
            batch.update(doc(db, 'costPhasing', existingDoc.id), updatePayload);
          } else {
            batch.set(doc(collection(db, 'costPhasing')), updatePayload);
          }
        }

        await batch.commit();
        toast.success("Timephasing imported successfully");
      } catch (error) {
        console.error("Error importing timephasing:", error);
        toast.error("Failed to import timephasing");
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const onTimephasingCellValueChanged = useCallback(async (event: CellValueChangedEvent) => {
    const { data, colDef, newValue, oldValue } = event;
    const colId = (colDef as ColDef).field;
    
    if (newValue === oldValue) return;
    if (!selectedTimephasingCode) {
      console.error("No cost code selected for timephasing update");
      return;
    }
    if (!project.id) {
      console.error("No project ID available for timephasing update");
      return;
    }

    console.log(`Updating Timephasing: Code=${selectedTimephasingCode}, Type=${data.id}, Field=${colId}, NewValue=${newValue}`);

    try {
      // Ensure dates are strings for Firestore
      let startDateStr = data.startDate;
      if (startDateStr instanceof Date) {
        startDateStr = startDateStr.toISOString();
      } else if (startDateStr && !isNaN(new Date(startDateStr).getTime())) {
        startDateStr = new Date(startDateStr).toISOString();
      } else {
        startDateStr = '';
      }

      let endDateStr = data.endDate;
      if (endDateStr instanceof Date) {
        endDateStr = endDateStr.toISOString();
      } else if (endDateStr && !isNaN(new Date(endDateStr).getTime())) {
        endDateStr = new Date(endDateStr).toISOString();
      } else {
        endDateStr = '';
      }

      const updatePayload = {
        projectId: project.id,
        costCodeId: selectedTimephasingCode,
        type: data.id,
        phasingSource: data.phasingSource || 'Manual',
        activityId: data.activityId || null,
        startDate: startDateStr,
        endDate: endDateStr,
        distribution: data.distribution || 'Even',
        periodValues: data.periodValues || {},
        updatedAt: new Date().toISOString()
      };

      if (data.docId) {
        console.log(`Updating existing doc: ${data.docId}`);
        await updateDoc(doc(db, 'costPhasing', data.docId), updatePayload);
      } else {
        console.log(`Searching for existing doc via query...`);
        const q = query(
          collection(db, 'costPhasing'),
          where('projectId', '==', project.id),
          where('costCodeId', '==', selectedTimephasingCode),
          where('type', '==', data.id)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          console.log(`Found doc via query: ${snap.docs[0].id}`);
          await updateDoc(snap.docs[0].ref, updatePayload);
        } else {
          console.log(`No doc found, creating new one.`);
          await addDoc(collection(db, 'costPhasing'), updatePayload);
        }
      }
      
      toast.success(`${data.type} updated`);
    } catch (error) {
      console.error("Error updating cost phasing:", error);
      handleFirestoreError(error, OperationType.UPDATE, `costPhasing/${data.docId || 'new'}`);
      toast.error("Failed to update cost phasing");
    }
  }, [project.id, selectedTimephasingCode]);

  const actualsColumnDefs = useMemo<ColDef[]>(() => [
    { 
      headerName: 'Date', 
      field: 'date', 
      width: 120,
      valueGetter: params => params.data?.date ? new Date(params.data.date) : null,
      valueFormatter: dateFormatter,
      cellRenderer: (params: any) => {
        if (params.node.rowPinned === 'top') return <span className="font-bold text-blue-800 dark:text-blue-200">TOTAL</span>;
        return params.valueFormatted || params.value;
      }
    },
    { headerName: 'Description', field: 'description', flex: 1 },
    { headerName: 'Source', field: 'source', width: 150 },
    { 
      headerName: 'Reporting Period', 
      field: 'reportingPeriodId', 
      width: 150,
      valueFormatter: (params) => {
        const period = project.reportingPeriods?.periods.find(p => p.id === params.value);
        if (period) return period.name;
        // Fallback for numeric periods
        const num = Number(params.value);
        if (!isNaN(num) && project.reportingPeriods?.periods[num - 1]) {
          return project.reportingPeriods.periods[num - 1].name;
        }
        return params.value;
      }
    },
    { 
      headerName: 'Cost', 
      field: 'cost', 
      width: 150,
      type: 'numericColumn',
      valueFormatter: currencyFormatter,
      cellClass: 'font-bold',
      aggFunc: 'sum'
    }
  ], [project.reportingPeriods]);
  
  const baselineColumnDefs = useMemo<ColDef[]>(() => [
    { 
      headerName: 'Item', 
      field: 'item', 
      width: 150,
      cellRenderer: (params: any) => {
        if (params.node.rowPinned === 'top') return <span className="font-bold text-amber-800 dark:text-amber-200">TOTAL</span>;
        return params.value;
      }
    },
    { headerName: 'Description', field: 'description', flex: 1 },
    { 
      headerName: 'Amount', 
      field: 'amount', 
      width: 150,
      type: 'numericColumn',
      valueFormatter: currencyFormatter,
      cellClass: 'font-bold',
      aggFunc: 'sum'
    },
    { 
      headerName: 'Created', 
      field: 'createdAt', 
      width: 150,
      valueFormatter: (params) => params.value ? format(parseISO(params.value), 'MMM dd, yyyy') : ''
    }
  ], []);

  // Re-apply column group state when columnDefs change to prevent auto-collapsing
  useEffect(() => {
    // This is now handled by the stable reference pattern, but we keep this as a fallback
    // only if the defs actually changed.
    if (etcGridRef.current?.api && etcGroupStateRef.current) {
      etcGridRef.current.api.setColumnGroupState(etcGroupStateRef.current);
    }
  }, [etcColumnDefs]);

  const onEtcRowDataUpdated = useCallback((params: RowDataUpdatedEvent) => {
    // No longer re-applying state here to avoid flicker during data updates
  }, []);

  const onEtcCellValueChanged = useCallback((params: CellValueChangedEvent) => {
    handleUpdateEtcRow(params.data.id, params.data);
    // Force refresh of the row to update calculated columns like Total ETC and Qty
    params.api.refreshCells({ rowNodes: [params.node], force: true });
  }, [handleUpdateEtcRow]);

  const getEtcRowId = useCallback((params: any) => params.data.id, []);

  const components = useMemo(() => ({
    actionsRenderer: ActionsCellRenderer
  }), []);

  const gridContext = useMemo(() => ({
    setFormData,
    setIsEditing,
    setSelectedEtcCode,
    selectedEtcCode,
    setSelectedActualsCode,
    selectedActualsCode,
    setSelectedTimephasingCode,
    selectedTimephasingCode,
    setSelectedChangesCode,
    selectedChangesCode,
    setSelectedBaselineCode,
    selectedBaselineCode,
    setDeleteConfirm,
    setSelectedSubcontractBreakdownCode,
    selectedSubcontractBreakdownCode
  }), [selectedEtcCode, selectedActualsCode, selectedTimephasingCode, selectedChangesCode, selectedBaselineCode, selectedSubcontractBreakdownCode]);

  // Dynamic Attributes
  const enterpriseAttrs = useMemo(() => 
    (enterprise.costCodeAttributes || []).filter(attr => attr.title && attr.title.trim() !== ''),
    [enterprise.costCodeAttributes]
  );

  const projectAttrs = useMemo(() => 
    (project.costCodeAttributes || []).filter(attr => attr.title && attr.title.trim() !== ''),
    [project.costCodeAttributes]
  );

  // Visible Columns State
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);

  const calculateCosts = useCallback(async () => {
    if (!project.id) return;
    setIsSaving(true);
    const toastId = toast.loading('Starting project cost calculations...');
    
    try {
      const codesToUpdate = selectedIds.size > 0 
        ? costCodes.filter(c => selectedIds.has(c.id)) 
        : costCodes;

      if (codesToUpdate.length === 0) {
        toast.error('No cost codes found to calculate.', { id: toastId });
        setIsSaving(false);
        return;
      }

      // 1. Fetch all project data once
      const [actualsSnap, budgetsSnap, etcSnap, changesSnap, recordsSnap, subSnap] = await Promise.all([
        getDocs(query(collection(db, 'actualCosts'), where('projectId', '==', project.id))),
        getDocs(query(collection(db, 'baselineBudgets'), where('projectId', '==', project.id))),
        getDocs(query(collection(db, 'etcDetails'), where('projectId', '==', project.id))),
        getDocs(query(collection(db, 'changes'), where('projectId', '==', project.id))),
        getDocs(query(collection(db, 'changeRecords'), where('projectId', '==', project.id))),
        getDocs(query(collection(db, 'subcontracts'), where('projectId', '==', project.id)))
      ]);

      const allActuals = actualsSnap.docs.map(d => d.data());
      const allBudgets = budgetsSnap.docs.map(d => d.data());
      const allEtcRows = etcSnap.docs.map(d => d.data());
      const allChanges = changesSnap.docs.map(d => ({ ...d.data(), id: d.id } as Change));
      const allChangeRecords = recordsSnap.docs.map(d => d.data());
      const allSubcontracts = subSnap.docs.map(d => ({ ...d.data(), id: d.id } as Subcontract));

      const currentPeriodId = project.reportingPeriods?.currentPeriodId;
      const currentPeriod = project.reportingPeriods?.periods.find(p => p.id === currentPeriodId);
      const currentPeriodNum = currentPeriod ? project.reportingPeriods?.periods.indexOf(currentPeriod) + 1 : -1;
      
      const allPeriods = project.reportingPeriods?.periods || [];
      const currentIndex = allPeriods.findIndex(p => p.id === currentPeriodId);
      const futurePeriodIds = allPeriods.slice(currentIndex + 1).map(p => p.id);

      // 2. Pre-process Approved Changes
      const approvedChangeIds = new Set(allChanges.filter(c => c.status === 'Approved' || c.status === 'Pending').map(c => c.id));

      // 3. Optimized Aggregation Lookups (O(N) instead of O(N*M))
      const actualsToDateMap = new Map<string, number>();
      const actualsThisPeriodMap = new Map<string, number>();
      const baselineMap = new Map<string, number>();
      const budgetChangeMap = new Map<string, number>();
      const eacChangeMap = new Map<string, number>();
      const etcMap = new Map<string, number>();

      allActuals.forEach(a => {
        const cost = Number(a.cost) || 0;
        const key = a.costCodeId;
        actualsToDateMap.set(key, (actualsToDateMap.get(key) || 0) + cost);
        
        const isCurrent = a.reportingPeriodId === currentPeriodId || 
                         (currentPeriodNum !== -1 && String(a.reportingPeriodId) === String(currentPeriodNum));
        if (isCurrent) {
          actualsThisPeriodMap.set(key, (actualsThisPeriodMap.get(key) || 0) + cost);
        }
      });

      allBudgets.forEach(b => {
        const amount = Number(b.amount) || 0;
        baselineMap.set(b.costCodeId, (baselineMap.get(b.costCodeId) || 0) + amount);
      });

      allChangeRecords.forEach(r => {
        if (approvedChangeIds.has(r.changeId)) {
          const budgetAmt = Number(r.budgetAmount) || 0;
          const eacAmt = Number(r.eacAmount) || 0;
          budgetChangeMap.set(r.costCodeId, (budgetChangeMap.get(r.costCodeId) || 0) + budgetAmt);
          eacChangeMap.set(r.costCodeId, (eacChangeMap.get(r.costCodeId) || 0) + eacAmt);
        }
      });

      allEtcRows.forEach(r => {
        const periodValues = (r.periodValues || {}) as Record<string, number>;
        const futureQty = futurePeriodIds.reduce((sum, pId) => sum + (periodValues[pId] || 0), 0);
        const etcVal = futureQty * (r.rate || 0);
        etcMap.set(r.costCode, (etcMap.get(r.costCode) || 0) + etcVal);
      });

      // 4. Calculate everything for each Cost Code
      const getVal = (map: Map<string, number>, id: string, code: string) => (map.get(id) || 0) + (map.get(code) || 0);

      // Subcontract lookup optimization
      const subTotalsByCode = new Map<string, number>();
      allSubcontracts.forEach(sub => {
        (sub.lineItems || []).forEach(li => {
          if (li.status === 'Rejected') return;
          const assignedId = li.costCodeId || sub.defaultCostCodeId;
          if (assignedId) {
            subTotalsByCode.set(assignedId, (subTotalsByCode.get(assignedId) || 0) + (Number(li.total) || 0));
          }
        });
      });

      // 5. Bulk updates in chunks of 500
      const batchSize = 450;
      for (let i = 0; i < codesToUpdate.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = codesToUpdate.slice(i, i + batchSize);

        chunk.forEach(code => {
          const baselineBudget = Number(getVal(baselineMap, code.id, code.code)) || 0;
          const actualCostToDate = Number(getVal(actualsToDateMap, code.id, code.code)) || 0;
          const actualCostThisPeriod = Number(getVal(actualsThisPeriodMap, code.id, code.code)) || 0;
          const budgetChanges = Number(getVal(budgetChangeMap, code.id, code.code)) || 0;
          const approvedBudget = baselineBudget + budgetChanges;
          
          let estimateAtCompletion = 0;
          let estimateToComplete = 0;

          if (code.eacMethod === 'ETC Details') {
            estimateToComplete = Number(getVal(etcMap, code.id, code.code)) || 0;
            estimateAtCompletion = actualCostToDate + estimateToComplete;
          } else if (code.eacMethod === 'Change Management') {
            const eacChanges = Number(getVal(eacChangeMap, code.id, code.code)) || 0;
            estimateAtCompletion = baselineBudget + eacChanges;
            estimateToComplete = estimateAtCompletion - actualCostToDate;
          } else if (code.eacMethod === 'Sub-Contract Management') {
            estimateAtCompletion = Number(getVal(subTotalsByCode, code.id, code.code)) || 0;
            estimateToComplete = estimateAtCompletion - actualCostToDate;
          } else {
            estimateAtCompletion = Number(code.estimateAtCompletion) || 0;
            estimateToComplete = estimateAtCompletion - actualCostToDate;
          }

          const approvedBudgetMovement = approvedBudget - (Number(code.approvedBudgetPrevious) || 0);
          const estimateAtCompletionMovement = estimateAtCompletion - (Number(code.estimateAtCompletionPrevious) || 0);
          const costVariance = approvedBudget - estimateAtCompletion;
          const costVarianceMovement = costVariance - (Number(code.costVariancePrevious) || 0);

          // Sanitize values to prevent Firestore rejection of NaN/Infinity
          const sanitize = (val: number) => isFinite(val) ? val : 0;

          batch.update(doc(db, 'costCodes', code.id), {
            baselineBudget: sanitize(baselineBudget),
            budgetChanges: sanitize(budgetChanges),
            approvedBudget: sanitize(approvedBudget),
            approvedBudgetMovement: sanitize(approvedBudgetMovement),
            actualCostToDate: sanitize(actualCostToDate),
            actualCostThisPeriod: sanitize(actualCostThisPeriod),
            estimateToComplete: sanitize(estimateToComplete),
            estimateAtCompletion: sanitize(estimateAtCompletion),
            estimateAtCompletionMovement: sanitize(estimateAtCompletionMovement),
            costVariance: sanitize(costVariance),
            costVarianceMovement: sanitize(costVarianceMovement),
            updatedAt: new Date().toISOString(),
            projectId: code.projectId, // Re-affirming to satisfy rules
            code: code.code // Re-affirming to satisfy rules
          });
        });

        await batch.commit();
      }

      toast.success('Calculations completed successfully.', { id: toastId });
    } catch (error: any) {
      console.error('Error calculating costs:', error);
      handleFirestoreError(error, OperationType.UPDATE, 'costCodes/batch_calculate');
      toast.error(`Failed to complete calculations: ${error.message || 'Unknown error'}`, { id: toastId });
    } finally {
      setIsSaving(false);
    }
  }, [project, costCodes, selectedIds, subcontracts]);

  const handleUpdateField = async (id: string, field: string, value: any) => {
    try {
      await updateDoc(doc(db, 'costCodes', id), {
        [field]: value,
        updatedAt: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Error updating field:', error);
      handleFirestoreError(error, OperationType.UPDATE, `costCodes/${id}/${field}`);
      toast.error(`Failed to update field: ${error.message || 'Unknown error'}`);
    }
  };

  useEffect(() => {
    const q = query(
      collection(db, 'costCodes'), 
      where('projectId', '==', project.id),
      orderBy('sortOrder', 'asc')
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
      toast.error("Failed to fetch cost codes. Check permissions.");
      setLoading(false);
    });

    const qSch = query(collection(db, 'scheduleItems'), where('projectId', '==', project.id));
    const unsubSch = onSnapshot(qSch, (snapshot) => {
      setScheduleItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ScheduleItem)));
    });

    return () => {
      unsubscribe();
      unsubSch();
    };
  }, [project.id, project.users]);

  useEffect(() => {
    const q = query(collection(db, 'calendars'), where('projectId', '==', project.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCalendars(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectCalendar)));
    }, (error) => {
      console.error("Error fetching calendars:", error);
    });
    return () => unsubscribe();
  }, [project.id]);

  const gridRef = useRef<AgGridReact>(null);
  const etcGridRef = useRef<AgGridReact>(null);
  const timephasingGridRef = useRef<AgGridReact>(null);
  const etcGroupStateRef = useRef<any>(null);
  const [gridApi, setGridApi] = useState<GridApi | null>(null);

  const onGridReady = (params: GridReadyEvent) => {
    setGridApi(params.api);
  };

  const movementRenderer = (params: any, type: 'budget' | 'eac' | 'variance') => {
    if (params.value == null || params.value === 0) return formatCurrency(params.value || 0);
    const isPositive = params.value > 0;
    
    let colorClass = '';
    if (type === 'eac') {
      colorClass = isPositive ? 'text-red-600' : 'text-emerald-600';
    } else {
      colorClass = isPositive ? 'text-emerald-600' : 'text-red-600';
    }

    return (
      <div className={cn("flex items-center gap-1 font-medium justify-end h-full", colorClass)}>
        {isPositive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
        <span>{formatCurrency(params.value)}</span>
      </div>
    );
  };

    const columnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    const defs: (ColDef | ColGroupDef)[] = [
      {
        headerName: 'General',
        headerClass: 'header-group-general',
        openByDefault: true,
        children: [
          {
            headerName: 'Cost Code ID',
            field: 'code',
            sort: 'asc',
            cellStyle: { backgroundColor: '#f3f4f6', fontWeight: 'bold', color: 'black' },
            checkboxSelection: true,
            headerCheckboxSelection: true,
            headerCheckboxSelectionFilteredOnly: true,
            width: 150,
            pinned: 'left',
            filter: 'agTextColumnFilter',
            sortable: true,
            enableRowGroup: true,
            cellRenderer: (params: any) => {
              if (params.node.footer || params.node.rowPinned === 'top') {
                return <span className="font-bold text-blue-800 dark:text-blue-200">GRAND TOTAL</span>;
              }
              return params.value;
            },
          },
          { 
            field: 'name', 
            headerName: 'Cost Code Description', 
            width: 250, 
            pinned: 'left', 
            filter: 'agTextColumnFilter', 
            sortable: true, 
            editable: true, 
            cellStyle: { backgroundColor: 'white', color: 'black' }, 
            enableRowGroup: true, 
          },
          { 
            headerName: 'EAC Method',
            field: 'eacMethod',
            width: 150,
            editable: true,
            cellStyle: { backgroundColor: 'white', color: 'black' },
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: {
              values: ['Manual', 'Change Management', 'ETC Details', 'Sub-Contract Management']
            },
            filter: 'agSetColumnFilter',
            sortable: true,
            enableRowGroup: true,
          },
          {
            headerName: 'Users',
            field: 'assignedUsers',
            width: 200,
            editable: true,
            cellClass: 'bg-white dark:bg-slate-900',
            cellRenderer: (params: any) => {
              if (!params.value || !Array.isArray(params.value)) return '';
              return params.value
                .map((uid: string) => enterprise.users?.[uid]?.email || uid)
                .join(', ');
            },
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: {
              values: Object.keys(project.users || {}),
              valueListMaxHeight: 200,
              // Note: Built-in select editor doesn't support multi-select.
              // For a true multi-select, a custom cell editor would be needed.
            },
            valueFormatter: (params: any) => {
              if (!params.value || !Array.isArray(params.value)) return '';
              return params.value
                .map((uid: string) => enterprise.users?.[uid]?.email || uid)
                .join(', ');
            },
            filter: 'agSetColumnFilter',
            sortable: true,
            enableRowGroup: true,
          },
        ]
      }
    ];

    // 2. Enterprise Attributes
    if (enterpriseAttrs.length > 0) {
      defs.push({
        headerName: 'Enterprise Attributes',
        headerClass: 'header-group-enterprise',
        openByDefault: true,
        children: enterpriseAttrs.map((attr, index) => ({
          headerName: attr.title,
          field: `enterpriseAttributes.${attr.id}`,
          width: 150,
          columnGroupShow: index === 0 ? undefined : 'open',
          filter: 'agSetColumnFilter',
          sortable: true,
          enableRowGroup: true,
          editable: true,
          cellClass: 'bg-white dark:bg-slate-900',
          cellEditor: 'agRichSelectCellEditor',
          cellEditorParams: {
            values: attr.values.map(v => v.id),
            formatValue: (id: string) => {
              if (!id) return '';
              const match = attr.values.find(v => v.id === id);
              return match ? `${match.id} - ${match.description}` : id;
            },
            searchType: 'match',
            allowTyping: true,
            filterList: true,
            highlightMatch: true
          },
          refData: Object.fromEntries(attr.values.map(v => [v.id, `${v.id} - ${v.description}`])),
          valueSetter: (params: any) => {
            if (!params.data || params.newValue === undefined) return false;
            if (!params.data.enterpriseAttributes) {
              params.data.enterpriseAttributes = {};
            }
            let val = params.newValue;
            if (typeof val === 'string' && val.includes(' - ')) {
              val = val.split(' - ')[0];
            }
            params.data.enterpriseAttributes[attr.id] = val;
            return true;
          },
          valueGetter: (params: any) => {
            if (!params.data) return '';
            return params.data.enterpriseAttributes?.[attr.id] || '';
          }
        }))
      });
    }

    // 3. Project Attributes
    if (projectAttrs.length > 0) {
      defs.push({
        headerName: 'Project Attributes',
        headerClass: 'header-group-project',
        openByDefault: true,
        children: projectAttrs.map((attr, index) => ({
          headerName: attr.title,
          field: `projectAttributes.${attr.id}`,
          width: 150,
          columnGroupShow: index === 0 ? undefined : 'open',
          filter: 'agSetColumnFilter',
          sortable: true,
          enableRowGroup: true,
          editable: true,
          cellClass: 'bg-white dark:bg-slate-900',
          cellEditor: 'agRichSelectCellEditor',
          cellEditorParams: {
            values: attr.values.map(v => v.id),
            formatValue: (id: string) => {
              if (!id) return '';
              const match = attr.values.find(v => v.id === id);
              return match ? `${match.id} - ${match.description}` : id;
            },
            searchType: 'match',
            allowTyping: true,
            filterList: true,
            highlightMatch: true
          },
          refData: Object.fromEntries(attr.values.map(v => [v.id, `${v.id} - ${v.description}`])),
          valueSetter: (params: any) => {
            if (!params.data || params.newValue === undefined) return false;
            if (!params.data.projectAttributes) {
              params.data.projectAttributes = {};
            }
            let val = params.newValue;
            if (typeof val === 'string' && val.includes(' - ')) {
              val = val.split(' - ')[0];
            }
            params.data.projectAttributes[attr.id] = val;
            return true;
          },
          valueGetter: (params: any) => {
            if (!params.data) return '';
            return params.data.projectAttributes?.[attr.id] || '';
          }
        }))
      });
    }

    // 4. EAC Method - MOVED TO GENERAL

    // 5. Budget
    defs.push({
      headerName: 'Budget',
      headerClass: 'header-group-budget',
      openByDefault: true,
      children: [
        {
          headerName: 'Baseline',
          field: 'baselineBudget',
          width: 130,
          type: 'numericColumn',
          valueFormatter: currencyFormatter,
          editable: false,
          cellClass: 'bg-slate-100 dark:bg-slate-800 font-medium',
          aggFunc: 'sum',
        },
        {
          headerName: 'Budget Changes',
          field: 'budgetChanges',
          width: 130,
          type: 'numericColumn',
          valueFormatter: currencyFormatter,
          cellClass: 'bg-slate-100 dark:bg-slate-800',
          aggFunc: 'sum',
        },
        {
          headerName: 'Approved Budget',
          field: 'approvedBudget',
          width: 150,
          type: 'numericColumn',
          valueFormatter: currencyFormatter,
          cellClass: 'font-bold bg-slate-100 dark:bg-slate-800',
          aggFunc: 'sum',
        },
        {
          headerName: 'Appr Prev',
          field: 'approvedBudgetPrevious',
          width: 130,
          type: 'numericColumn',
          valueFormatter: currencyFormatter,
          cellClass: 'bg-slate-100 dark:bg-slate-800',
          aggFunc: 'sum',
        },
        {
          headerName: 'Mvmt',
          width: 130,
          type: 'numericColumn',
          valueGetter: (params: any) => {
            if (params.node?.group) return undefined;
            const current = params.data?.approvedBudget || 0;
            const previous = params.data?.approvedBudgetPrevious || 0;
            return current - previous;
          },
          cellRenderer: (params: any) => movementRenderer(params, 'budget'),
          cellClass: 'bg-slate-100 dark:bg-slate-800',
          aggFunc: 'sum',
        }
      ]
    });

    // 6. Actual Cost
    defs.push({
      headerName: 'Actual Cost',
      headerClass: 'header-group-actuals',
      openByDefault: true,
      children: [
        {
          headerName: 'This Period',
          field: 'actualCostThisPeriod',
          width: 130,
          type: 'numericColumn',
          valueFormatter: currencyFormatter,
          editable: false,
          cellClass: 'bg-slate-100 dark:bg-slate-800',
          aggFunc: 'sum',
        },
        {
          headerName: 'To Date',
          field: 'actualCostToDate',
          width: 130,
          type: 'numericColumn',
          valueFormatter: currencyFormatter,
          editable: false,
          cellClass: 'bg-slate-100 dark:bg-slate-800',
          aggFunc: 'sum',
        }
      ]
    });

    // 7. ETC & EAC
    defs.push({
      headerName: 'ETC & EAC',
      headerClass: 'header-group-eac',
      openByDefault: true,
      children: [
        {
          headerName: 'ETC',
          field: 'estimateToComplete',
          width: 130,
          type: 'numericColumn',
          valueFormatter: currencyFormatter,
          cellClass: 'bg-slate-100 dark:bg-slate-800',
          aggFunc: 'sum',
        },
        {
          headerName: 'EAC',
          field: 'estimateAtCompletion',
          width: 130,
          type: 'numericColumn',
          valueFormatter: currencyFormatter,
          editable: (params) => params.data?.eacMethod === 'Manual',
          cellClass: (params) => cn(
            "font-bold",
            params.data?.eacMethod === 'Manual' ? "bg-white dark:bg-slate-900" : "bg-slate-100 dark:bg-slate-800"
          ),
          aggFunc: 'sum',
        },
        {
          headerName: 'EAC Prev',
          field: 'estimateAtCompletionPrevious',
          width: 130,
          type: 'numericColumn',
          valueFormatter: currencyFormatter,
          cellClass: 'bg-slate-100 dark:bg-slate-800',
          aggFunc: 'sum',
        },
        {
          headerName: 'Mvmt',
          width: 130,
          type: 'numericColumn',
          valueGetter: (params: any) => {
            if (params.node?.group) return undefined;
            const current = params.data?.estimateAtCompletion || 0;
            const previous = params.data?.estimateAtCompletionPrevious || 0;
            return current - previous;
          },
          cellRenderer: (params: any) => movementRenderer(params, 'eac'),
          cellClass: 'bg-slate-100 dark:bg-slate-800',
          aggFunc: 'sum',
        }
      ]
    });

    // 8. Risk Management
    defs.push({
      headerName: 'Risk Management',
      headerClass: 'header-group-risk',
      openByDefault: true,
      children: [
        {
          headerName: 'Initial EMV Exposure',
          width: 130,
          type: 'numericColumn',
          valueGetter: (params: any) => {
            if (params.node?.group) return undefined;
            const cc = params.data;
            if (!cc) return 0;
            // The link is the risk records cost code. In our system, costCodeId in record matches cc.id or cc.code
            return riskExposureByCostCode[cc.id]?.initialEMV || riskExposureByCostCode[cc.code]?.initialEMV || 0;
          },
          valueFormatter: currencyFormatter,
          cellClass: 'bg-slate-100 dark:bg-slate-800',
          aggFunc: 'sum',
        },
        {
          headerName: 'Mitigation Cost',
          width: 130,
          type: 'numericColumn',
          valueGetter: (params: any) => {
            if (params.node?.group) return undefined;
            const cc = params.data;
            if (!cc) return 0;
            return riskExposureByCostCode[cc.id]?.mitigationCost || riskExposureByCostCode[cc.code]?.mitigationCost || 0;
          },
          valueFormatter: currencyFormatter,
          cellClass: 'bg-slate-100 dark:bg-slate-800',
          aggFunc: 'sum',
        },
        {
          headerName: 'Residual Exposure',
          width: 130,
          type: 'numericColumn',
          valueGetter: (params: any) => {
            if (params.node?.group) return undefined;
            const cc = params.data;
            if (!cc) return 0;
            return riskExposureByCostCode[cc.id]?.residualEMV || riskExposureByCostCode[cc.code]?.residualEMV || 0;
          },
          valueFormatter: currencyFormatter,
          cellClass: 'bg-slate-100 dark:bg-slate-800 font-bold',
          aggFunc: 'sum',
        }
      ]
    });

    // 8. Cost Variance
    defs.push({
      headerName: 'Cost Variance',
      headerClass: 'header-group-variance',
      openByDefault: true,
      children: [
        {
          headerName: 'Cost Variance',
          width: 130,
          type: 'numericColumn',
          valueGetter: (params: any) => {
            if (params.node?.group) return undefined;
            const budget = params.data?.approvedBudget || 0;
            const eac = params.data?.estimateAtCompletion || 0;
            return budget - eac;
          },
          valueFormatter: currencyFormatter,
          cellClass: 'bg-slate-100 dark:bg-slate-800',
          cellClassRules: {
            'text-red-600 font-bold': (params: any) => params.value < 0,
            'text-emerald-600 font-bold': (params: any) => params.value > 0,
          },
          aggFunc: 'sum',
        },
        {
          headerName: 'Var Prev',
          width: 130,
          type: 'numericColumn',
          valueGetter: (params: any) => {
            if (params.node?.group) return undefined;
            const budgetPrev = params.data?.approvedBudgetPrevious || 0;
            const eacPrev = params.data?.estimateAtCompletionPrevious || 0;
            return budgetPrev - eacPrev;
          },
          valueFormatter: currencyFormatter,
          cellClass: 'bg-slate-100 dark:bg-slate-800',
          aggFunc: 'sum',
        },
        {
          headerName: 'Var Mvmt',
          width: 130,
          type: 'numericColumn',
          valueGetter: (params: any) => {
            if (params.node?.group) return undefined;
            const budget = params.data?.approvedBudget || 0;
            const eac = params.data?.estimateAtCompletion || 0;
            const budgetPrev = params.data?.approvedBudgetPrevious || 0;
            const eacPrev = params.data?.estimateAtCompletionPrevious || 0;
            return (budget - eac) - (budgetPrev - eacPrev);
          },
          cellRenderer: (params: any) => movementRenderer(params, 'variance'),
          cellClass: 'bg-slate-100 dark:bg-slate-800',
          aggFunc: 'sum',
        }
      ]
    });

    // 9. Actions
    defs.push({
      headerName: 'Actions',
      width: 160,
      pinned: 'right',
      cellRenderer: 'actionsRenderer',
      cellClass: 'overflow-visible',
      suppressNavigable: true,
    });

    return defs;
  }, [enterpriseAttrs, projectAttrs, selectedEtcCode, riskExposureByCostCode]);

  const sideBar = useMemo(() => {
    return {
      toolPanels: [
        {
          id: 'columns',
          labelDefault: 'Columns',
          labelKey: 'columns',
          iconKey: 'columns',
          toolPanel: 'agColumnsToolPanel',
          toolPanelParams: {
            suppressRowGroups: false,
            suppressValues: true,
            suppressPivots: true,
            suppressPivotMode: true,
            suppressColumnFilter: false,
            suppressColumnSelectAll: false,
            suppressColumnExpandAll: false,
          },
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
  }, []);

  const statusBar = useMemo(() => {
    return {
      statusPanels: [
        { statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'left' },
        { statusPanel: 'agTotalRowCountComponent', align: 'center' },
        { statusPanel: 'agFilteredRowCountComponent', align: 'center' },
        { statusPanel: 'agSelectedRowCountComponent', align: 'center' },
        { statusPanel: 'agAggregationComponent', align: 'right' },
      ],
    };
  }, []);

  const onSelectionChanged = () => {
    if (gridRef.current?.api) {
      const selectedRows = gridRef.current.api.getSelectedRows().filter(row => {
        const node = gridRef.current?.api.getRowNode(row.id);
        return node && node.displayed;
      });
      setSelectedIds(new Set(selectedRows.map(row => row.id)));
    }
  };

  const defaultColDef = useMemo(() => ({
    resizable: true,
    sortable: true,
    filter: true,
    minWidth: 100,
  }), []);

  const autoGroupColumnDef = useMemo(() => ({
    headerName: 'Group',
    minWidth: 200,
    cellRendererParams: {
      checkbox: true,
    },
  }), []);

  const onCellValueChanged = async (event: CellValueChangedEvent) => {
    const { data, colDef, newValue, oldValue } = event;
    if (newValue === oldValue) return;
    if (!colDef.field) return;
    if (isSaving) return; // Prevent triggering during bulk calculations or imports

    try {
      const docRef = doc(db, 'costCodes', data.id);
      const updates: any = {
        [colDef.field]: newValue,
        updatedAt: new Date().toISOString()
      };

      // Reactive calculations for immediate feedback
      const baseline = Number(colDef.field === 'baselineBudget' ? newValue : data.baselineBudget) || 0;
      const changes = Number(colDef.field === 'budgetChanges' ? newValue : data.budgetChanges) || 0;
      const approvedPrev = Number(colDef.field === 'approvedBudgetPrevious' ? newValue : data.approvedBudgetPrevious) || 0;
      
      const approved = baseline + changes;
      const approvedMovement = approved - approvedPrev;

      const actualsToDate = Number(colDef.field === 'actualCostToDate' ? newValue : data.actualCostToDate) || 0;
      const eacPrev = Number(colDef.field === 'estimateAtCompletionPrevious' ? newValue : data.estimateAtCompletionPrevious) || 0;
      
      let eac = Number(colDef.field === 'estimateAtCompletion' ? newValue : data.estimateAtCompletion) || 0;
      let etc = Number(data.estimateToComplete) || 0;

      if (data.eacMethod === 'ETC Details') {
        // ETC is fixed from forecast (already in data), EAC = Actuals + ETC
        eac = actualsToDate + etc;
      } else {
        // ETC = EAC - Actuals
        etc = eac - actualsToDate;
      }
      
      const eacMovement = eac - eacPrev;

      const variance = approved - eac;
      const variancePrev = Number(colDef.field === 'costVariancePrevious' ? newValue : data.costVariancePrevious) || 0;
      const varianceMovement = variance - variancePrev;

      // Add calculated fields to updates
      updates.approvedBudget = approved;
      updates.approvedBudgetMovement = approvedMovement;
      updates.estimateAtCompletion = eac;
      updates.estimateAtCompletionMovement = eacMovement;
      updates.estimateToComplete = etc;
      updates.costVariance = variance;
      updates.costVarianceMovement = varianceMovement;

      // Update grid data immediately for UI responsiveness
      event.node.setData({ ...data, ...updates });

      await updateDoc(docRef, updates);
    } catch (error: any) {
      console.error('Update error:', error);
      handleFirestoreError(error, OperationType.UPDATE, `costCodes/${data.id}`);
      toast.error(`Failed to update cell: ${error.message || 'Unknown error'}`);
      event.node.setDataValue(colDef.field, oldValue);
    }
  };

  const toggleAllEtcColumnGroups = (opened: boolean) => {
    if (!etcGridRef.current) return;
    const api = etcGridRef.current.api;
    const groups = api.getColumnGroupState();
    const newState = groups.map(g => ({
      groupId: g.groupId,
      open: opened
    }));
    api.setColumnGroupState(newState);
  };

  const toggleAllCostCodeColumnGroups = (opened: boolean) => {
    if (!gridRef.current) return;
    const api = gridRef.current.api;
    const groups = api.getColumnGroupState();
    const newState = groups.map(g => ({
      groupId: g.groupId,
      open: opened
    }));
    api.setColumnGroupState(newState);
  };

  const clearAllFilters = () => {
    setQuickFilterText('');
    setEtcQuickFilterText('');
    if (gridApi) {
      gridApi.setFilterModel(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (!formData.code) {
      toast.error('Cost Code ID is required.');
      return;
    }

    setIsSaving(true);
    try {
      if (isEditing?.id) {
        // Update existing
        await updateDoc(doc(db, 'costCodes', isEditing.id), formData);
        toast.success('Cost code updated.');
      } else {
        // Create new
        // Check for duplicates within the current project
        const isDuplicate = costCodes.some(c => c.code.toLowerCase() === formData.code?.toLowerCase());
        if (isDuplicate) {
          toast.error(`Cost Code ID "${formData.code}" already exists in this project.`);
          setIsSaving(false);
          return;
        }

        const batch = writeBatch(db);
        let newSortOrder = 0;
        
        if (typeof isEditing?.insertIndex === 'number') {
          // Insert at index: shift others
          newSortOrder = isEditing.insertIndex;
          const toShift = costCodes.filter(c => c.sortOrder >= isEditing.insertIndex!);
          toShift.forEach(c => {
            batch.update(doc(db, 'costCodes', c.id), { sortOrder: c.sortOrder + 1 });
          });
        } else {
          // Append at end
          newSortOrder = costCodes.length > 0 ? Math.max(...costCodes.map(c => c.sortOrder)) + 1 : 0;
        }

        const newRef = doc(collection(db, 'costCodes'));
        batch.set(newRef, {
          ...formData,
          projectId: project.id,
          sortOrder: newSortOrder
        });
        
        await batch.commit();
        toast.success('Cost code created.');
      }
      setIsEditing(null);
      setFormData({ 
        code: '', 
        name: '', 
        enterpriseAttributes: {}, 
        projectAttributes: {}, 
        eacMethod: 'Manual',
        assignedUsers: []
      });
    } catch (error) {
      console.error('Error saving cost code:', error);
      toast.error('Failed to save changes.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;

    try {
      if (deleteConfirm.type === 'single' && deleteConfirm.id) {
        await deleteDoc(doc(db, 'costCodes', deleteConfirm.id));
      } else if (deleteConfirm.type === 'bulk') {
        const batch = writeBatch(db);
        selectedIds.forEach(id => {
          batch.delete(doc(db, 'costCodes', id));
        });
        await batch.commit();
      }
      setSelectedIds(new Set());
      setDeleteConfirm(null);
      toast.success('Deleted successfully.');
    } catch (error) {
      console.error('Error deleting:', error);
      toast.error('Failed to delete.');
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedIds.size === 0) return;
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      selectedIds.forEach(id => {
        const updateObj: any = {};
        if (bulkUpdateData.eacMethod) updateObj.eacMethod = bulkUpdateData.eacMethod;
        
        // Merge attributes
        const currentCode = costCodes.find(c => c.id === id);
        if (currentCode) {
          updateObj.enterpriseAttributes = { 
            ...(currentCode.enterpriseAttributes || {}), 
            ...bulkUpdateData.enterpriseAttributes 
          };
          updateObj.projectAttributes = { 
            ...(currentCode.projectAttributes || {}), 
            ...bulkUpdateData.projectAttributes 
          };
        }
        
        batch.update(doc(db, 'costCodes', id), updateObj);
      });
      await batch.commit();
      toast.success(`Updated ${selectedIds.size} cost codes.`);
      setIsBulkUpdating(false);
      setSelectedIds(new Set());
      setBulkUpdateData({ enterpriseAttributes: {}, projectAttributes: {} });
    } catch (error) {
      console.error('Error bulk updating:', error);
      toast.error('Failed to bulk update.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenForecast = async (code: CostCode) => {
    try {
      const q = query(
        collection(db, 'sheets'), 
        where('projectId', '==', project.id),
        where('sheetName', '==', `Forecast: ${code.code}`)
      );
      const snapshot = await getDocs(q);
      
      let sheetId = '';
      if (!snapshot.empty) {
        sheetId = snapshot.docs[0].id;
      } else {
        const newSheet = {
          projectId: project.id,
          sheetName: `Forecast: ${code.code}`,
          forecastMethod: 'time-based',
          version: '1.0',
          lockedStatus: false,
          createdBy: auth.currentUser?.uid || 'system',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        const docRef = await addDoc(collection(db, 'sheets'), newSheet);
        sheetId = docRef.id;
        
        await addDoc(collection(db, `sheets/${sheetId}/rows`), {
          sheetId,
          costCode: code.code,
          description: code.name,
          vendor: '',
          budget: code.baselineBudget || 0,
          committedCost: 0,
          actualCostToDate: code.actualCostToDate || 0,
          costToGo: 0,
          eac: code.baselineBudget || 0,
          timePhasing: {},
          distributionMethod: 'even',
          attributes: {}
        });
      }
      navigate(`/project/${project.id}/sheet/${sheetId}`);
    } catch (error) {
      console.error('Error opening forecast sheet:', error);
      toast.error('Failed to open forecast sheet.');
    }
  };

  useEffect(() => {
    if (gridApi) {
      gridApi.setGridOption('quickFilterText', quickFilterText);
    }
  }, [quickFilterText, gridApi]);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rows = XLSX.utils.sheet_to_json(ws) as any[];

        setImportPreview({ data: rows });
      } catch (error) {
        console.error("Error reading import file:", error);
        toast.error("Failed to read the excel file.");
      }
    };
    reader.readAsArrayBuffer(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const confirmImport = async () => {
    if (!importPreview || !project.id) return;
    
    const toastId = toast.loading('Importing cost codes...');
    try {
      const batch = writeBatch(db);
      let currentMaxOrder = costCodes.length > 0 ? Math.max(...costCodes.map(c => c.sortOrder)) : -1;
      let importCount = 0;
      let updateCount = 0;
      
      const { data } = importPreview;

      for (const row of data) {
        const code = row.code || row.Code || row['Cost Code ID'] || row['Code'];
        const name = row.name || row.Name || row['Cost Code Name'] || row['Description'] || '';
        const eacMethod = row.eacMethod || row.EACMethod || row['EAC Method'] || 'Manual';

        if (code) {
          const entAttrs: Record<string, string> = {};
          const prjAttrs: Record<string, string> = {};

          enterpriseAttrs.forEach(attr => {
            const val = row[attr.title];
            if (val) {
              const match = attr.values.find(v => v.description.toLowerCase() === String(val).toLowerCase());
              if (match) entAttrs[attr.id] = match.id;
            }
          });

          projectAttrs.forEach(attr => {
            const val = row[attr.title];
            if (val) {
              const match = attr.values.find(v => v.description.toLowerCase() === String(val).toLowerCase());
              if (match) prjAttrs[attr.id] = match.id;
            }
          });

          const existing = costCodes.find(c => c.code.toLowerCase() === String(code).toLowerCase());
          const costCodeData: any = {
            code: String(code),
            name: String(name),
            eacMethod: String(eacMethod),
            projectId: project.id,
            enterpriseAttributes: entAttrs,
            projectAttributes: prjAttrs,
            updatedAt: new Date().toISOString()
          };
          
          if (existing) {
            batch.update(doc(db, 'costCodes', existing.id), costCodeData);
            updateCount++;
          } else {
            currentMaxOrder++;
            const newRef = doc(collection(db, 'costCodes'));
            batch.set(newRef, { 
              ...costCodeData, 
              sortOrder: currentMaxOrder,
              createdAt: new Date().toISOString(),
              actualCostToDate: 0,
              baselineBudget: 0,
              approvedChanges: 0,
              subcontractAmount: 0
            });
            importCount++;
          }
        }
      }

      await batch.commit();
      toast.success(`Import complete: ${importCount} new, ${updateCount} updated.`, { id: toastId });
      setImportPreview(null);
    } catch (error) {
      console.error("Import error:", error);
      toast.error("Failed to complete import.", { id: toastId });
    }
  };

  const { duplicateIds, hasImportDuplicates } = useMemo(() => {
    if (!importPreview) return { duplicateIds: [], hasImportDuplicates: false };
    
    // Check for duplicates within the file itself
    const idsInFile = new Set<string>();
    const duplicates = new Set<string>();
    
    importPreview.data.forEach(row => {
      const id = row.code || row.Code || row['Cost Code ID'] || row['Code'];
      if (id) {
        const normalizedId = id.toString().trim().toLowerCase();
        if (idsInFile.has(normalizedId)) {
          duplicates.add(id.toString().trim());
        }
        idsInFile.add(normalizedId);
      }
    });

    const duplicateList = Array.from(duplicates);
    return { 
      duplicateIds: duplicateList, 
      hasImportDuplicates: duplicateList.length > 0 
    };
  }, [importPreview]);

  const handleExport = () => {
    const exportData = costCodes.map(c => ({
      'Cost Code ID': c.code,
      'Cost Code Name': c.name,
      'EAC Method': c.eacMethod,
      ...Object.fromEntries(enterpriseAttrs.map(a => [a.title, a.values.find(v => v.id === c.enterpriseAttributes?.[a.id])?.description || ''])),
      ...Object.fromEntries(projectAttrs.map(a => [a.title, a.values.find(v => v.id === c.projectAttributes?.[a.id])?.description || '']))
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cost Codes');
    XLSX.writeFile(wb, `${project.projectCode}_CostCodes.xlsx`);
  };

  const getRowClass = (params: any) => {
    const classes = ['overflow-visible'];
    if (params.node.footer || params.node.rowPinned === 'top') {
      classes.push('bg-blue-50 dark:bg-blue-900/40 font-bold text-blue-800 dark:text-blue-200 border-b-2 border-blue-200 dark:border-blue-800');
    }
    return classes.join(' ');
  };

  const getEtcRowClass = (params: any) => {
    const classes = ['overflow-visible'];
    if (params.node.rowPinned) {
      classes.push('pinned-row-highlight');
    }
    
    // Highlight invalid Auto-Phase rows
    if (params.data?.phasingMethod === 'Auto-Phase') {
      const { phasingStartDate, phasingEndDate, phasingQty, phasingUnit } = params.data;
      if (!phasingStartDate || !phasingEndDate || !phasingQty || !phasingUnit || new Date(phasingEndDate) < new Date(phasingStartDate)) {
        classes.push('bg-red-50 dark:bg-red-900/20');
      }
    }
    
    return classes.join(' ');
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full gap-6 overflow-hidden">
      <DataGridModule
        title="Project Cost Codes"
        description="Define and manage project-specific cost codes and attributes."
        icon={<Hash className="w-4 h-4 text-gray-400" />}
        searchPlaceholder="Search cost codes..."
        quickFilterText={quickFilterText}
        onQuickFilterChange={setQuickFilterText}
        onImport={() => fileInputRef.current?.click()}
        onExport={handleExport}
        onCalculate={calculateCosts}
        isCalculating={isSaving}
        selectedCount={selectedIds.size}
        onBulkUpdate={() => setIsBulkUpdating(true)}
        onBulkDelete={() => setDeleteConfirm({ type: 'bulk', count: selectedIds.size })}
        onAdd={() => { setFormData({ code: '', name: '', enterpriseAttributes: {}, projectAttributes: {}, eacMethod: 'Manual', assignedUsers: [] }); setIsEditing({ id: null }); }}
        extraToolbarActions={
          <>
            <button 
              onClick={() => toggleAllCostCodeColumnGroups(true)}
              className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
              title="Expand All Groups"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button 
              onClick={() => toggleAllCostCodeColumnGroups(false)}
              className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
              title="Collapse All Groups"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          </>
        }
        gridRef={gridRef}
        rowData={(selectedEtcCode || selectedActualsCode || selectedTimephasingCode || selectedChangesCode || selectedBaselineCode) ? costCodes.filter(c => c.code === (selectedEtcCode || selectedActualsCode || selectedTimephasingCode || selectedChangesCode || selectedBaselineCode)) : costCodes}
        columnDefs={columnDefs}
        theme={theme}
        isMainTableCollapsed={isMainTableCollapsed}
        onToggleMainTableCollapse={() => setIsMainTableCollapsed(!isMainTableCollapsed)}
        hasSubContent={!!(selectedEtcCode || selectedActualsCode || selectedTimephasingCode || selectedChangesCode || selectedBaselineCode)}
        project={project}
        showCurrentPeriod={true}
        gridProps={{
          getRowId: (params: any) => params.data.id,
          components: components,
          context: gridContext,
          defaultColDef: defaultColDef,
          autoGroupColumnDef: autoGroupColumnDef,
          onGridReady: onGridReady,
          onCellValueChanged: onCellValueChanged,
          onSelectionChanged: onSelectionChanged,
          onFilterChanged: onSelectionChanged,
          processCellFromClipboard: (params: any) => {
            const colId = params.column.getColId();
            if (colId.startsWith('enterpriseAttributes.') || colId.startsWith('projectAttributes.')) {
              const val = params.value;
              if (typeof val === 'string' && val.includes(' - ')) {
                return val.split(' - ')[0];
              }
            }
            return params.value;
          },
          rowSelection: "multiple",
          groupDisplayType: "multipleColumns",
          groupTotalRow: "top",
          grandTotalRow: "top",
          getRowClass: getRowClass,
          sideBar: sideBar,
          statusBar: statusBar,
          suppressRowClickSelection: true,
          paginationPageSize: 50
        }}
      />

      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept=".xlsx,.xls,.csv"
        onChange={handleImport}
      />





      {/* Subcontract Breakdown Details Section */}
      <AnimatePresence>
        {selectedSubcontractBreakdownCode && (
          <motion.div 
            key={selectedSubcontractBreakdownCode}
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
                  <Briefcase className="w-5 h-5 text-green-600" />
                  <h3 className="font-bold dark:text-white">Related Subcontracts: <span className="text-green-600">{selectedSubcontractBreakdownCode}</span></h3>
                </div>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10" />
                <p className="text-xs text-gray-500 font-medium">Read-Only View</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type="text" 
                    placeholder="Search subcontracts..."
                    value={subcontractQuickFilterText}
                    onChange={(e) => setSubcontractQuickFilterText(e.target.value)}
                    className="pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-xs focus:ring-2 focus:ring-green-500 outline-none w-48 dark:text-white"
                  />
                </div>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10 mx-1" />
                <button 
                  onClick={() => setSelectedSubcontractBreakdownCode(null)}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 min-h-0 relative">
              <div className={cn(
                "absolute inset-0 ag-theme-quartz",
                theme === 'dark' ? "ag-theme-quartz-dark" : ""
              )}>
                <AgGridReact
                  rowData={subcontractBreakdownRows}
                  pinnedBottomRowData={subcontractBreakdownPinnedBottomRowData}
                  getRowClass={(params) => {
                    if (params.node.rowPinned === 'bottom') return 'font-bold bg-gray-50 dark:bg-white/5';
                    return '';
                  }}
                  columnDefs={[
                    { field: 'subcontractId', headerName: 'Subcontract ID', width: 140, pinned: 'left', cellStyle: { fontWeight: 'bold' } },
                    { field: 'subcontractName', headerName: 'Subcontract Name', width: 200 },
                    { field: 'vendorName', headerName: 'Vendor', width: 180 },
                    { field: 'itemNo', headerName: 'Item No', width: 100 },
                    { 
                      field: 'description', 
                      headerName: 'Description', 
                      width: 250,
                      cellRenderer: (params: any) => {
                        if (params.node.rowPinned === 'bottom') {
                          return <span className="text-green-600 font-bold">SubTotal</span>;
                        }
                        return params.value;
                      }
                    },
                    { field: 'qty', headerName: 'Qty', width: 100, type: 'numericColumn' },
                    { field: 'unit', headerName: 'Unit', width: 80 },
                    { field: 'rate', headerName: 'Rate', width: 120, type: 'numericColumn', valueFormatter: currencyFormatter },
                    { field: 'total', headerName: 'Total', width: 140, type: 'numericColumn', valueFormatter: currencyFormatter, cellClass: 'font-bold' },
                    { field: 'status', headerName: 'Status', width: 120 },
                    { field: 'type', headerName: 'Type', width: 120 }
                  ]}
                  quickFilterText={subcontractQuickFilterText}
                  defaultColDef={{
                    sortable: true,
                    filter: true,
                    resizable: true,
                    minWidth: 100,
                  }}
                  animateRows={true}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ETC Details Section */}
      <AnimatePresence>
        {selectedEtcCode && (
          <motion.div 
            key={selectedEtcCode}
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
                  <ClipboardList className="w-5 h-5 text-orange-600" />
                  <h3 className="font-bold dark:text-white">ETC Details: <span className="text-orange-600">{selectedEtcCode}</span></h3>
                </div>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10" />
                <p className="text-xs text-gray-500">Time-Based Forecasting</p>
              </div>
              <div className="flex items-center gap-2">
                {selectedEtcIds.size > 0 && (
                  <button 
                    onClick={() => handleDeleteEtcRows('selected')}
                    className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-red-700 transition-colors shadow-sm"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Selected ({selectedEtcIds.size})
                  </button>
                )}
                <div className="h-4 w-px bg-gray-200 dark:border-white/10 mx-1" />
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type="text" 
                    placeholder="Search items..."
                    value={etcQuickFilterText}
                    onChange={(e) => setEtcQuickFilterText(e.target.value)}
                    className="pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-xs focus:ring-2 focus:ring-orange-500 outline-none w-48 dark:text-white"
                  />
                </div>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10 mx-1" />
                <input 
                  type="file" 
                  ref={etcFileInputRef} 
                  className="hidden" 
                  accept=".xlsx,.xls,.csv"
                  onChange={handleImportEtc}
                />
                <button 
                  onClick={() => etcFileInputRef.current?.click()}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                  title="Import Excel"
                >
                  <Upload className="w-5 h-5" />
                </button>
                <button 
                  onClick={handleExportEtc}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                  title="Export Excel"
                >
                  <Download className="w-5 h-5" />
                </button>
                <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
                
                <button 
                  onClick={() => toggleAllEtcColumnGroups(true)}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                  title="Expand All Groups"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => toggleAllEtcColumnGroups(false)}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                  title="Collapse All Groups"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
                <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
                {selectedEtcIds.size > 0 && (
                  <>
                    <button 
                      onClick={() => setIsEtcBulkUpdating(true)}
                      className="flex items-center gap-2 bg-black dark:bg-white text-white dark:text-black px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-all shadow-lg shadow-black/10"
                      title={`Bulk Update (${selectedEtcIds.size})`}
                    >
                      <Edit2 className="w-4 h-4" /> ({selectedEtcIds.size})
                    </button>
                    <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
                  </>
                )}
                <button 
                  onClick={() => setIsEtcChartVisible(!isEtcChartVisible)}
                  className={cn(
                    "p-2 rounded-lg transition-all",
                    isEtcChartVisible 
                      ? "bg-black text-white dark:bg-white dark:text-black shadow-lg" 
                      : "text-gray-400 hover:text-black dark:hover:text-white"
                  )}
                  title={isEtcChartVisible ? "Hide Chart" : "Show Chart"}
                >
                  <BarChart3 className="w-5 h-5" />
                </button>
                <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
                <button
                  onClick={handleCalculatePhasing}
                  className="flex items-center gap-2 bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 transition-all shadow-lg shadow-black/10"
                >
                  <Calculator className="w-4 h-4" /> Calculate
                </button>
                <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
                <div className="flex items-center gap-2 bg-gray-100 dark:bg-white/5 p-1 rounded-xl">
                  <input 
                    type="number" 
                    value={addRowsCount}
                    onChange={(e) => setAddRowsCount(parseInt(e.target.value) || 1)}
                    className="w-16 px-2 py-1 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-orange-500"
                    min="1"
                    max="500"
                  />
                  <button 
                    onClick={handleAddEtcRow}
                    className="flex items-center gap-2 bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 transition-all shadow-lg shadow-black/10"
                  >
                    <Plus className="w-4 h-4" /> Add
                  </button>
                  <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
                  <button 
                    onClick={() => setIsResourceModalOpen(true)}
                    className="p-2 text-black dark:text-white hover:bg-gray-200 dark:hover:bg-white/10 rounded-lg transition-colors"
                    title="Resource Library"
                  >
                    <Database className="w-5 h-5" />
                  </button>
                </div>
                <button 
                  onClick={() => setSelectedEtcCode(null)}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            {/* Histogram Chart */}
            <AnimatePresence>
              {isEtcChartVisible && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="bg-white dark:bg-[#141414] border-b border-gray-200 dark:border-white/10 px-4 py-4 overflow-hidden"
                >
                  <div className="grid grid-cols-2 gap-8">
                    {/* Qty Histogram */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Quantity Distribution</span>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-purple-500" />
                          <span className="text-[10px] font-bold text-gray-500 uppercase">Periodic Qty</span>
                        </div>
                      </div>
                      <div className="h-64 bg-gray-50 dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 p-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={etcChartData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#333' : '#eee'} />
                            <XAxis 
                              dataKey="name" 
                              fontSize={9} 
                              tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis 
                              fontSize={9} 
                              tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: theme === 'dark' ? '#141414' : '#fff',
                                borderColor: theme === 'dark' ? '#333' : '#eee',
                                borderRadius: '8px',
                                fontSize: '11px',
                                padding: '8px'
                              }}
                            />
                            <Bar dataKey="qty" name="Periodic Qty" fill="#a855f7" radius={[2, 2, 0, 0]} barSize={20}>
                              <LabelList 
                                dataKey="qty" 
                                position="top" 
                                formatter={(val: number) => Math.round(val).toLocaleString()} 
                                style={{ fill: theme === 'dark' ? '#fff' : '#000', fontWeight: 'bold', fontSize: '9px' }}
                              />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Cost Chart */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Cost Distribution (Cost Flow)</span>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-blue-500" />
                            <span className="text-[10px] font-bold text-gray-500 uppercase">Periodic Cost</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-0.5 bg-emerald-500" />
                            <span className="text-[10px] font-bold text-gray-500 uppercase">Cumulative</span>
                          </div>
                        </div>
                      </div>
                      <div className="h-64 bg-gray-50 dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 p-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={etcChartData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#333' : '#eee'} />
                            <XAxis 
                              dataKey="name" 
                              fontSize={9} 
                              tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis 
                              yAxisId="left"
                              fontSize={9} 
                              tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                            />
                            <YAxis 
                              yAxisId="right"
                              orientation="right"
                              fontSize={9} 
                              tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                            />
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: theme === 'dark' ? '#141414' : '#fff',
                                borderColor: theme === 'dark' ? '#333' : '#eee',
                                borderRadius: '8px',
                                fontSize: '11px',
                                padding: '8px'
                              }}
                              formatter={(val: number) => [`$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, '']}
                            />
                            <Bar yAxisId="left" dataKey="cost" name="Periodic Cost" fill="#3b82f6" radius={[2, 2, 0, 0]} barSize={20}>
                              <LabelList 
                                dataKey="cost" 
                                position="top" 
                                formatter={(val: number) => `${Math.round(val / 1000)}k`} 
                                style={{ fill: theme === 'dark' ? '#fff' : '#000', fontWeight: 'bold', fontSize: '9px' }}
                              />
                            </Bar>
                            <Line yAxisId="right" type="monotone" dataKey="cumulative" name="Cumulative" stroke="#10b981" strokeWidth={2} dot={false} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            
            <div className="flex-1 min-h-0 relative">
              <div className={cn(
                "absolute inset-0 ag-theme-quartz",
                theme === 'dark' ? "ag-theme-quartz-dark" : ""
              )}>
                <AgGridReact
                  ref={etcGridRef}
                  rowData={etcRows}
                  columnDefs={etcColumnDefs}
                  quickFilterText={etcQuickFilterText}
                  getRowId={getEtcRowId}
                  defaultColDef={{
                    sortable: true,
                    filter: true,
                    resizable: true,
                    wrapHeaderText: true,
                    autoHeaderHeight: true,
                    enableRowGroup: true,
                    enablePivot: true,
                    enableValue: true,
                    minWidth: 100,
                  }}
                  autoGroupColumnDef={autoGroupColumnDef}
                  sideBar={sideBar}
                  statusBar={statusBar}
                  onCellValueChanged={onEtcCellValueChanged}
                  onRowDataUpdated={onEtcRowDataUpdated}
                  suppressColumnVirtualisation={true}
                  onColumnGroupOpened={(params) => {
                    etcGroupStateRef.current = params.api.getColumnGroupState();
                    const state = params.api.getColumnGroupState();
                    localStorage.setItem(`etcColumnGroupState_${project.id}_${selectedEtcCode}`, JSON.stringify(state));
                  }}
                  onGridReady={(params) => {
                    const savedState = localStorage.getItem(`etcGridState_${project.id}_${selectedEtcCode}`);
                    if (savedState) {
                      params.api.applyColumnState({ state: JSON.parse(savedState), applyOrder: true });
                    }
                    const savedGroupState = localStorage.getItem(`etcColumnGroupState_${project.id}_${selectedEtcCode}`);
                    if (savedGroupState) {
                      params.api.setColumnGroupState(JSON.parse(savedGroupState));
                      etcGroupStateRef.current = JSON.parse(savedGroupState);
                    }
                  }}
                  animateRows={false}
                  suppressColumnMoveAnimation={true}
                  enableRangeSelection={true}
                  enableFillHandle={true}
                  undoRedoCellEditing={true}
                  enableCellTextSelection={true}
                  suppressClipboardPaste={false}
                  processCellFromClipboard={(params) => {
                    const colId = params.column.getColId();
                    if (colId === 'phasingStartDate' || colId === 'phasingEndDate') {
                      const val = params.value;
                      if (typeof val === 'string') {
                        const trimmed = val.trim();
                        const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
                        if (dmyMatch) {
                          let day = parseInt(dmyMatch[1]);
                          let month = parseInt(dmyMatch[2]);
                          let year = parseInt(dmyMatch[3]);
                          if (year < 100) year += 2000;
                          const date = new Date(year, month - 1, day);
                          if (!isNaN(date.getTime())) return date.toISOString();
                        }
                      }
                    }
                    if (colId.startsWith('enterpriseAttributes.') || colId.startsWith('projectAttributes.')) {
                      const val = params.value;
                      if (typeof val === 'string' && val.includes(' - ')) {
                        return val.split(' - ')[0];
                      }
                    }
                    return params.value;
                  }}
                  loading={isEtcLoading}
                  pinnedTopRowData={etcPinnedTopRowData}
                  getRowClass={getEtcRowClass}
                  rowSelection="multiple"
                  suppressRowClickSelection={true}
                  onSelectionChanged={(event) => {
                    const selectedRows = event.api.getSelectedRows();
                    const displayedSelected = selectedRows.filter(row => {
                      const node = event.api.getRowNode(row.id);
                      return node && node.displayed;
                    });
                    const ids = new Set(displayedSelected.map(row => row.id));
                    setSelectedEtcIds(ids);
                  }}
                  onFilterChanged={(event) => {
                    const selectedRows = event.api.getSelectedRows();
                    const displayedSelected = selectedRows.filter(row => {
                      const node = event.api.getRowNode(row.id);
                      return node && node.displayed;
                    });
                    const ids = new Set(displayedSelected.map(row => row.id));
                    setSelectedEtcIds(ids);
                  }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Changes Details Section */}
      <AnimatePresence>
        {selectedChangesCode && (
          <motion.div 
            key={selectedChangesCode}
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
                  <RefreshCw className="w-5 h-5 text-purple-600" />
                  <h3 className="font-bold dark:text-white">Related Changes: <span className="text-purple-600">{selectedChangesCode}</span></h3>
                </div>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10" />
                <p className="text-xs text-gray-500 font-medium">Read-Only View</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type="text" 
                    placeholder="Search changes..."
                    value={changesQuickFilterText}
                    onChange={(e) => setChangesQuickFilterText(e.target.value)}
                    className="pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-xs focus:ring-2 focus:ring-purple-500 outline-none w-48 dark:text-white"
                  />
                </div>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10 mx-1" />
                <button 
                  onClick={() => setSelectedChangesCode(null)}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 min-h-0 relative">
              <div className={cn(
                "absolute inset-0 ag-theme-quartz",
                theme === 'dark' ? "ag-theme-quartz-dark" : ""
              )}>
                <AgGridReact
                  rowData={changeRecords.map(r => {
                    const parentChange = allChanges.find(c => c.id === r.changeId);
                    return {
                      ...r,
                      changeIdStr: parentChange?.changeId || 'Unknown',
                      changeDescription: parentChange?.description || '',
                      changeStatus: parentChange?.status || 'Unknown',
                      changeType: parentChange?.type || ''
                    };
                  })}
                  pinnedBottomRowData={changesPinnedBottomRowData}
                  getRowClass={(params) => {
                    if (params.node.rowPinned === 'bottom') return 'font-bold bg-gray-50 dark:bg-white/5';
                    return '';
                  }}
                  columnDefs={[
                    {
                      headerName: 'Change ID',
                      field: 'changeIdStr',
                      width: 150,
                      cellStyle: { fontWeight: 'bold' },
                      pinned: 'left'
                    },
                    {
                      headerName: 'Status',
                      field: 'changeStatus',
                      width: 120,
                      cellClassRules: {
                        'text-emerald-600 font-bold': (p: any) => p.value === 'Approved',
                        'text-amber-600 font-bold': (p: any) => p.value === 'Pending',
                        'text-red-600 font-bold': (p: any) => p.value === 'Rejected',
                        'text-gray-500 font-bold': (p: any) => p.value === 'Withdrawn',
                      }
                    },
                    {
                      headerName: 'Type',
                      field: 'changeType',
                      width: 120
                    },
                    {
                      headerName: 'Change Description',
                      field: 'changeDescription',
                      width: 250
                    },
                    {
                      headerName: 'Scope',
                      field: 'scope',
                      width: 200
                    },
                    {
                      headerName: 'Budget Amount',
                      field: 'budgetAmount',
                      width: 150,
                      type: 'numericColumn',
                      valueFormatter: (p: any) => formatCurrency(p.value),
                      cellStyle: { fontWeight: 'bold' }
                    },
                    {
                      headerName: 'EAC Amount',
                      field: 'eacAmount',
                      width: 150,
                      type: 'numericColumn',
                      valueFormatter: (p: any) => formatCurrency(p.value),
                      cellStyle: { fontWeight: 'bold' }
                    }
                  ]}
                  quickFilterText={changesQuickFilterText}
                  defaultColDef={{
                    sortable: true,
                    filter: true,
                    resizable: true,
                    minWidth: 100,
                  }}
                  animateRows={true}
                  loading={isChangesLoading}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {selectedActualsCode && (
          <motion.div 
            key={selectedActualsCode}
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
                  <History className="w-5 h-5 text-blue-600" />
                  <h3 className="font-bold dark:text-white">Actual Cost Transactions: <span className="text-blue-600">{selectedActualsCode}</span></h3>
                </div>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10" />
                <p className="text-xs text-gray-500">Read-Only View</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type="text" 
                    placeholder="Search transactions..."
                    value={actualsQuickFilterText}
                    onChange={(e) => setActualsQuickFilterText(e.target.value)}
                    className="pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none w-48 dark:text-white"
                  />
                </div>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10 mx-1" />
                <button 
                  onClick={() => setIsActualsChartVisible(!isActualsChartVisible)}
                  className={cn(
                    "p-2 rounded-lg transition-all",
                    isActualsChartVisible 
                      ? "bg-black text-white dark:bg-white dark:text-black shadow-lg" 
                      : "text-gray-400 hover:text-black dark:hover:text-white"
                  )}
                  title={isActualsChartVisible ? "Hide Chart" : "Show Chart"}
                >
                  <BarChart3 className="w-5 h-5" />
                </button>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10 mx-1" />
                <button 
                  onClick={() => setSelectedActualsCode(null)}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Actuals Chart */}
            <AnimatePresence>
              {isActualsChartVisible && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="bg-white dark:bg-[#141414] border-b border-gray-200 dark:border-white/10 px-4 py-4 overflow-hidden"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Actual Cost Distribution (Cost Flow)</span>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                          <span className="text-[10px] font-bold text-gray-500 uppercase">Periodic Cost</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-0.5 bg-emerald-500" />
                          <span className="text-[10px] font-bold text-gray-500 uppercase">Cumulative</span>
                        </div>
                      </div>
                    </div>
                    <div className="h-64 bg-gray-50 dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 p-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={actualsChartData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#333' : '#eee'} />
                          <XAxis 
                            dataKey="name" 
                            fontSize={9} 
                            tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis 
                            fontSize={9} 
                            tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                          />
                          <YAxis 
                            yAxisId="right" 
                            orientation="right" 
                            fontSize={9} 
                            tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                          />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: theme === 'dark' ? '#141414' : '#fff',
                              borderColor: theme === 'dark' ? '#333' : '#eee',
                              borderRadius: '8px',
                              fontSize: '11px',
                              padding: '8px'
                            }}
                            formatter={(val: number) => formatCurrency(val)}
                          />
                          <Bar dataKey="cost" name="Periodic Cost" fill="#3b82f6" radius={[2, 2, 0, 0]} barSize={20}>
                            <LabelList 
                              dataKey="cost" 
                              position="top" 
                              formatter={(val: number) => `$${Math.round(val / 1000)}k`} 
                              style={{ fill: theme === 'dark' ? '#fff' : '#000', fontWeight: 'bold', fontSize: '9px' }}
                            />
                          </Bar>
                          <Line yAxisId="right" type="monotone" dataKey="cumulative" name="Cumulative" stroke="#10b981" strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex-1 min-h-0 relative">
              <div className={cn(
                "absolute inset-0 ag-theme-quartz",
                theme === 'dark' ? "ag-theme-quartz-dark" : ""
              )}>
                <AgGridReact
                  rowData={actualsRows}
                  columnDefs={actualsColumnDefs}
                  quickFilterText={actualsQuickFilterText}
                  loading={isActualsLoading}
                  defaultColDef={{
                    sortable: true,
                    filter: true,
                    resizable: true,
                    minWidth: 100,
                  }}
                  animateRows={true}
                  enableRangeSelection={true}
                  enableCellTextSelection={true}
                  grandTotalRow="top"
                  pagination={true}
                  paginationPageSize={100}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Baseline Budget Details Section */}
      <AnimatePresence>
        {selectedBaselineCode && (
          <motion.div 
            key={selectedBaselineCode}
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
                  <Target className="w-5 h-5 text-amber-600" />
                  <h3 className="font-bold dark:text-white">Baseline Budget Breakdown: <span className="text-amber-600">{selectedBaselineCode}</span></h3>
                </div>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10" />
                <p className="text-xs text-gray-500">Read-Only View</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type="text" 
                    placeholder="Search items..."
                    value={baselineQuickFilterText}
                    onChange={(e) => setBaselineQuickFilterText(e.target.value)}
                    className="pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-xs focus:ring-2 focus:ring-amber-500 outline-none w-48 dark:text-white"
                  />
                </div>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10 mx-1" />
                <button 
                  onClick={() => setSelectedBaselineCode(null)}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 relative">
              <div className={cn(
                "absolute inset-0 ag-theme-quartz",
                theme === 'dark' ? "ag-theme-quartz-dark" : ""
              )}>
                <AgGridReact
                  rowData={baselineRows}
                  columnDefs={baselineColumnDefs}
                  quickFilterText={baselineQuickFilterText}
                  loading={isBaselineLoading}
                  defaultColDef={{
                    sortable: true,
                    filter: true,
                    resizable: true,
                    minWidth: 100,
                  }}
                  animateRows={true}
                  enableRangeSelection={true}
                  enableCellTextSelection={true}
                  grandTotalRow="top"
                  pagination={true}
                  paginationPageSize={100}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timephasing Details Section */}
      <AnimatePresence>
        {selectedTimephasingCode && (
          <motion.div 
            key={selectedTimephasingCode}
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
                  <Activity className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-bold dark:text-white">Timephasing: <span className="text-emerald-600">{selectedTimephasingCode}</span></h3>
                </div>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10" />
                <p className="text-xs text-gray-500">Baseline, Approved, and EAC Cost Flow</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input 
                    type="text" 
                    placeholder="Search timephasing..."
                    value={timephasingQuickFilterText}
                    onChange={(e) => setTimephasingQuickFilterText(e.target.value)}
                    className="pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 outline-none w-48 dark:text-white"
                  />
                </div>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10 mx-1" />
                <input 
                  type="file" 
                  ref={timephasingFileInputRef} 
                  className="hidden" 
                  accept=".xlsx,.xls,.csv"
                  onChange={handleImportTimephasing}
                />
                <button 
                  onClick={() => timephasingFileInputRef.current?.click()}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                  title="Import Excel"
                >
                  <Upload className="w-5 h-5" />
                </button>
                <button 
                  onClick={handleExportTimephasing}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                  title="Export Excel"
                >
                  <Download className="w-5 h-5" />
                </button>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10 mx-1" />
                <button 
                  onClick={() => setIsTimephasingChartVisible(!isTimephasingChartVisible)}
                  className={cn(
                    "p-2 rounded-lg transition-all",
                    isTimephasingChartVisible 
                      ? "bg-black text-white dark:bg-white dark:text-black shadow-lg" 
                      : "text-gray-400 hover:text-black dark:hover:text-white"
                  )}
                  title={isTimephasingChartVisible ? "Hide Chart" : "Show Chart"}
                >
                  <BarChart3 className="w-5 h-5" />
                </button>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10 mx-1" />
                <button
                  onClick={handleCalculateAutoPhasing}
                  className="flex items-center gap-2 bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 transition-all shadow-lg shadow-black/10"
                >
                  <Calculator className="w-4 h-4" /> Calculate Auto
                </button>
                <div className="h-4 w-px bg-gray-200 dark:border-white/10 mx-1" />
                <button 
                  onClick={() => setSelectedTimephasingCode(null)}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors text-gray-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <AnimatePresence>
              {isTimephasingChartVisible && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="bg-white dark:bg-[#141414] border-b border-gray-200 dark:border-white/10 overflow-hidden"
                >
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 bg-gray-100 dark:bg-white/5 p-1 rounded-lg">
                          <button
                            onClick={() => setTimephasingChartMode('value')}
                            className={cn(
                              "px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all",
                              timephasingChartMode === 'value' 
                                ? "bg-white dark:bg-[#141414] text-black dark:text-white shadow-sm" 
                                : "text-gray-500 hover:text-black dark:hover:text-white"
                            )}
                          >
                            Value ($)
                          </button>
                          <button
                            onClick={() => setTimephasingChartMode('percent')}
                            className={cn(
                              "px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all",
                              timephasingChartMode === 'percent' 
                                ? "bg-white dark:bg-[#141414] text-black dark:text-white shadow-sm" 
                                : "text-gray-500 hover:text-black dark:hover:text-white"
                            )}
                          >
                            Percent (%)
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-slate-400" />
                          <span className="text-[10px] font-bold text-gray-500 uppercase">Baseline</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span className="text-[10px] font-bold text-gray-500 uppercase">Approved</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                          <span className="text-[10px] font-bold text-gray-500 uppercase">EAC</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-slate-300" />
                          <span className="text-[10px] font-bold text-gray-500 uppercase">EAC Prev</span>
                        </div>
                        <div className="h-3 w-px bg-gray-200 dark:bg-white/10 mx-1" />
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-0.5 bg-slate-400" />
                          <span className="text-[10px] font-bold text-gray-500 uppercase">Cum. Baseline</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-0.5 bg-emerald-500" />
                          <span className="text-[10px] font-bold text-gray-500 uppercase">Cum. Approved</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-0.5 bg-blue-500" />
                          <span className="text-[10px] font-bold text-gray-500 uppercase">Cum. EAC</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-0.5 bg-slate-300 border-t border-dashed border-slate-500" />
                          <span className="text-[10px] font-bold text-gray-500 uppercase">Cum. EAC Prev</span>
                        </div>
                      </div>
                    </div>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={timephasingChartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#333' : '#eee'} />
                          <XAxis 
                            dataKey="name" 
                            fontSize={9} 
                            tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis 
                            fontSize={9} 
                            tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(val) => timephasingChartMode === 'percent' ? `${val}%` : `$${(val / 1000).toFixed(0)}k`}
                          />
                          <YAxis 
                            yAxisId="right" 
                            orientation="right" 
                            fontSize={9} 
                            tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(val) => timephasingChartMode === 'percent' ? `${val}%` : `$${(val / 1000).toFixed(0)}k`}
                          />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: theme === 'dark' ? '#141414' : '#fff',
                              borderColor: theme === 'dark' ? '#333' : '#eee',
                              borderRadius: '8px',
                              fontSize: '11px',
                              padding: '8px'
                            }}
                            formatter={(val: number) => timephasingChartMode === 'percent' ? `${val.toFixed(1)}%` : formatCurrency(val)}
                          />
                          <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase' }} />
                          <Bar dataKey="baseline" name="Baseline" fill="#94a3b8" radius={[2, 2, 0, 0]} barSize={15} />
                          <Bar dataKey="approved" name="Approved" fill="#10b981" radius={[2, 2, 0, 0]} barSize={15} />
                          <Bar dataKey="eac" name="EAC" fill="#3b82f6" radius={[2, 2, 0, 0]} barSize={15} />
                          <Line yAxisId="right" type="monotone" dataKey="cumulativeBaseline" name="Cum. Baseline" stroke="#94a3b8" strokeWidth={2} dot={false} />
                          <Line yAxisId="right" type="monotone" dataKey="cumulativeApproved" name="Cum. Approved" stroke="#10b981" strokeWidth={2} dot={false} />
                          <Line yAxisId="right" type="monotone" dataKey="cumulativeEac" name="Cum. EAC" stroke="#3b82f6" strokeWidth={2} dot={false} />
                          <Line yAxisId="right" type="monotone" dataKey="cumulativeEacPrevious" name="Cum. EAC Prev" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex-1 min-h-0 relative">
              <div className={cn(
                "absolute inset-0 ag-theme-quartz",
                theme === 'dark' ? "ag-theme-quartz-dark" : ""
              )}>
                <AgGridReact
                  ref={timephasingGridRef}
                  rowData={timephasingRows}
                  isExternalFilterPresent={() => true}
                  doesExternalFilterPass={(node) => !node.data.hidden}
                  columnDefs={timephasingColumnDefs}
                  quickFilterText={timephasingQuickFilterText}
                  loading={isTimephasingLoading}
                  onCellValueChanged={onTimephasingCellValueChanged}
                  getRowId={(params) => params.data.id}
                  rowSelection="multiple"
                  suppressRowClickSelection={true}
                  enableFillHandle={true}
                  undoRedoCellEditing={true}
                  defaultColDef={{
                    sortable: true,
                    filter: true,
                    resizable: true,
                    minWidth: 100,
                    wrapHeaderText: true,
                    autoHeaderHeight: true,
                  }}
                  animateRows={true}
                  enableRangeSelection={true}
                  enableCellTextSelection={true}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add/Edit Modal */}
      {isEditing && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <div className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-2xl shadow-2xl border border-gray-200 dark:border-white/10 animate-in zoom-in-95 duration-200 overflow-y-auto max-h-[90vh] custom-scrollbar">
            <h2 className="text-xl font-bold mb-6 dark:text-white">{isEditing.id ? 'Edit' : 'Add'} Cost Code</h2>
            <form onSubmit={handleSave} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Cost Code ID <span className="text-red-500">*</span></label>
                  <input 
                    required 
                    disabled={!!isEditing.id} 
                    type="text" 
                    maxLength={20} 
                    value={formData.code} 
                    onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })} 
                    className={cn(
                      "w-full p-4 bg-gray-50 dark:bg-white/5 border rounded-2xl text-sm focus:outline-none focus:ring-2 transition-all dark:text-white disabled:opacity-50",
                      isDuplicateId 
                        ? "border-red-500 focus:ring-red-500/20" 
                        : "border-gray-200 dark:border-white/10 focus:ring-black/5"
                    )} 
                  />
                  {isDuplicateId && (
                    <p className="text-[10px] text-red-500 mt-1 font-bold uppercase tracking-wider">Duplicate Cost Code ID</p>
                  )}
                </div>
                <div className="col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Name (Optional)</label>
                  <input type="text" maxLength={200} value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">EAC Method</label>
                  <select value={formData.eacMethod} onChange={e => setFormData({ ...formData, eacMethod: e.target.value as any })} className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white">
                    {['Manual', 'Change Management', 'ETC Details', 'Sub-Contract Management'].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4 border-b border-gray-100 dark:border-white/10 pb-2">Assigned Users (Visibility Control)</p>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 bg-gray-50 dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 custom-scrollbar">
                  {Object.entries(project.users || {}).map(([uid, role]) => (
                    <label key={uid} className="flex items-center gap-2 p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl cursor-pointer transition-colors">
                      <input 
                        type="checkbox"
                        checked={formData.assignedUsers?.includes(uid)}
                        onChange={(e) => {
                          const current = formData.assignedUsers || [];
                          if (e.target.checked) {
                            setFormData({ ...formData, assignedUsers: [...current, uid] });
                          } else {
                            setFormData({ ...formData, assignedUsers: current.filter(id => id !== uid) });
                          }
                        }}
                        className="w-4 h-4 rounded border-gray-300 dark:border-white/10 text-blue-600 focus:ring-blue-500 bg-transparent"
                      />
                      <div className="flex flex-col">
                        <span className="text-xs font-bold dark:text-white truncate max-w-[150px]">
                          {enterprise.users?.[uid]?.email || uid}
                        </span>
                        <span className="text-[9px] text-gray-400 uppercase tracking-widest font-bold">{role}</span>
                      </div>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[9px] text-gray-400 italic">
                  If users are assigned, only those users and Project Admins can see this cost code. If empty, all project members can see it.
                </p>
              </div>

              {enterpriseAttrs.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4 border-b border-gray-100 dark:border-white/10 pb-2">Enterprise Attributes</p>
                  <div className="grid grid-cols-2 gap-4">
                    {enterpriseAttrs.map(attr => (
                      <div key={attr.id}>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{attr.title}</label>
                        <select 
                          value={formData.enterpriseAttributes?.[attr.id] || ''} 
                          onChange={e => setFormData({ ...formData, enterpriseAttributes: { ...formData.enterpriseAttributes, [attr.id]: e.target.value } })}
                          className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                        >
                          <option value="">Select...</option>
                          {attr.values.map(v => <option key={v.id} value={v.id}>{v.description}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {projectAttrs.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4 border-b border-gray-100 dark:border-white/10 pb-2">Project Attributes</p>
                  <div className="grid grid-cols-2 gap-4">
                    {projectAttrs.map(attr => (
                      <div key={attr.id}>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{attr.title}</label>
                        <select 
                          value={formData.projectAttributes?.[attr.id] || ''} 
                          onChange={e => setFormData({ ...formData, projectAttributes: { ...formData.projectAttributes, [attr.id]: e.target.value } })}
                          className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                        >
                          <option value="">Select...</option>
                          {attr.values.map(v => <option key={v.id} value={v.id}>{v.description}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-6 border-t border-gray-100 dark:border-white/10">
                <button type="button" onClick={() => setIsEditing(null)} className="px-6 py-3 text-sm font-bold text-gray-500 hover:text-black dark:hover:text-white transition-colors">Cancel</button>
                <button 
                  type="submit" 
                  disabled={isSaving || isDuplicateId} 
                  className={cn(
                    "px-8 py-3 rounded-2xl text-sm font-bold transition-all flex items-center gap-2 shadow-xl",
                    (isSaving || isDuplicateId)
                      ? "bg-gray-200 dark:bg-white/5 text-gray-400 cursor-not-allowed shadow-none"
                      : "bg-black dark:bg-white text-white dark:text-black hover:bg-black/90 dark:hover:bg-white/90 shadow-black/10"
                  )}
                >
                  {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {isEditing.id ? 'Update' : 'Create'} Cost Code
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ETC Bulk Update Modal */}
      {isEtcBulkUpdating && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <div className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-2xl shadow-2xl border border-gray-200 dark:border-white/10 animate-in zoom-in-95 duration-200 overflow-y-auto max-h-[90vh] custom-scrollbar">
            <h2 className="text-xl font-bold mb-2 dark:text-white">Bulk Update ETC Details</h2>
            <p className="text-sm text-gray-500 mb-6 uppercase tracking-widest font-bold">Updating {selectedEtcIds.size} selected rows</p>
            
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Resource Category</label>
                  <select 
                    value={etcBulkUpdateData.category || ''} 
                    onChange={e => setEtcBulkUpdateData({ ...etcBulkUpdateData, category: e.target.value || undefined })} 
                    className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                  >
                    <option value="">No Change</option>
                    {((enterprise.categories && enterprise.categories.length > 0) ? enterprise.categories : DEFAULT_CATEGORIES).map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <p className="text-[9px] text-gray-400 mt-1 italic">* Only applies to manual rows</p>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Calendar</label>
                  <select 
                    value={etcBulkUpdateData.calendarId || ''} 
                    onChange={e => setEtcBulkUpdateData({ ...etcBulkUpdateData, calendarId: e.target.value || undefined })} 
                    className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                  >
                    <option value="">No Change</option>
                    {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Phasing Method</label>
                  <select 
                    value={etcBulkUpdateData.phasingMethod || ''} 
                    onChange={e => setEtcBulkUpdateData({ ...etcBulkUpdateData, phasingMethod: e.target.value as any || undefined })} 
                    className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                  >
                    <option value="">No Change</option>
                    <option value="Manual">Manual</option>
                    <option value="Auto-Phase">Auto-Phase</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Phasing Unit</label>
                  <select 
                    value={etcBulkUpdateData.phasingUnit || ''} 
                    onChange={e => setEtcBulkUpdateData({ ...etcBulkUpdateData, phasingUnit: e.target.value as any || undefined })} 
                    className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                  >
                    <option value="">No Change</option>
                    {['Daily', 'Weekly', 'Monthly', 'Total'].map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              {enterpriseLineItemAttrs.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4 border-b border-gray-100 dark:border-white/10 pb-2">Enterprise Attributes</p>
                  <div className="grid grid-cols-2 gap-4">
                    {enterpriseLineItemAttrs.map(attr => (
                      <div key={attr.id}>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{attr.title}</label>
                        <select 
                          value={etcBulkUpdateData.enterpriseAttributes[attr.id] || ''} 
                          onChange={e => setEtcBulkUpdateData({ 
                            ...etcBulkUpdateData, 
                            enterpriseAttributes: { ...etcBulkUpdateData.enterpriseAttributes, [attr.id]: e.target.value } 
                          })}
                          className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                        >
                          <option value="">No Change</option>
                          {attr.values.map(v => <option key={v.id} value={v.id}>{v.description}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {projectLineItemAttrs.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4 border-b border-gray-100 dark:border-white/10 pb-2">Project Attributes</p>
                  <div className="grid grid-cols-2 gap-4">
                    {projectLineItemAttrs.map(attr => (
                      <div key={attr.id}>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{attr.title}</label>
                        <select 
                          value={etcBulkUpdateData.projectAttributes[attr.id] || ''} 
                          onChange={e => setEtcBulkUpdateData({ 
                            ...etcBulkUpdateData, 
                            projectAttributes: { ...etcBulkUpdateData.projectAttributes, [attr.id]: e.target.value } 
                          })}
                          className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                        >
                          <option value="">No Change</option>
                          {attr.values.map(v => <option key={v.id} value={v.id}>{v.description}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-6 border-t border-gray-100 dark:border-white/10">
                <button type="button" onClick={() => setIsEtcBulkUpdating(false)} className="px-6 py-3 text-sm font-bold text-gray-500 hover:text-black dark:hover:text-white transition-colors">Cancel</button>
                <button 
                  onClick={handleBulkUpdateEtc} 
                  disabled={isSaving} 
                  className="px-8 py-3 bg-black dark:bg-white text-white dark:text-black rounded-2xl text-sm font-bold hover:opacity-90 transition-all shadow-lg shadow-black/10 disabled:opacity-50"
                >
                  {isSaving ? 'Updating...' : 'Update Rows'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Bulk Update Modal */}
      {isBulkUpdating && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <div className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-2xl shadow-2xl border border-gray-200 dark:border-white/10 animate-in zoom-in-95 duration-200 overflow-y-auto max-h-[90vh] custom-scrollbar">
            <h2 className="text-xl font-bold mb-2 dark:text-white">Bulk Update Attributes</h2>
            <p className="text-sm text-gray-500 mb-6 uppercase tracking-widest font-bold">Updating {selectedIds.size} selected items</p>
            
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">EAC Method</label>
                  <select 
                    value={bulkUpdateData.eacMethod || ''} 
                    onChange={e => setBulkUpdateData({ ...bulkUpdateData, eacMethod: e.target.value as any || undefined })} 
                    className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                  >
                    <option value="">No Change</option>
                    {['Manual', 'Change Management', 'ETC Details', 'Sub-Contract Management'].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              {enterpriseAttrs.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4 border-b border-gray-100 dark:border-white/10 pb-2">Enterprise Attributes</p>
                  <div className="grid grid-cols-2 gap-4">
                    {enterpriseAttrs.map(attr => (
                      <div key={attr.id}>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{attr.title}</label>
                        <select 
                          value={bulkUpdateData.enterpriseAttributes[attr.id] || ''} 
                          onChange={e => setBulkUpdateData({ 
                            ...bulkUpdateData, 
                            enterpriseAttributes: { ...bulkUpdateData.enterpriseAttributes, [attr.id]: e.target.value } 
                          })}
                          className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                        >
                          <option value="">No Change</option>
                          {attr.values.map(v => <option key={v.id} value={v.id}>{v.description}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {projectAttrs.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4 border-b border-gray-100 dark:border-white/10 pb-2">Project Attributes</p>
                  <div className="grid grid-cols-2 gap-4">
                    {projectAttrs.map(attr => (
                      <div key={attr.id}>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{attr.title}</label>
                        <select 
                          value={bulkUpdateData.projectAttributes[attr.id] || ''} 
                          onChange={e => setBulkUpdateData({ 
                            ...bulkUpdateData, 
                            projectAttributes: { ...bulkUpdateData.projectAttributes, [attr.id]: e.target.value } 
                          })}
                          className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                        >
                          <option value="">No Change</option>
                          {attr.values.map(v => <option key={v.id} value={v.id}>{v.description}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-6 border-t border-gray-100 dark:border-white/10">
                <button type="button" onClick={() => setIsBulkUpdating(false)} className="px-6 py-3 text-sm font-bold text-gray-500 hover:text-black dark:hover:text-white transition-colors">Cancel</button>
                <button 
                  onClick={handleBulkUpdate} 
                  disabled={isSaving} 
                  className="px-8 py-3 bg-black dark:bg-white text-white dark:text-black rounded-2xl text-sm font-bold hover:bg-black/90 dark:hover:bg-white/90 transition-all flex items-center gap-2 shadow-xl shadow-black/10"
                >
                  {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Update {selectedIds.size} Items
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[110] p-4">
          <div className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-md shadow-2xl border border-gray-200 dark:border-white/10 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-red-50 dark:bg-red-500/10 rounded-full flex items-center justify-center mb-6">
              <Trash2 className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-xl font-bold mb-2 dark:text-white">Confirm Delete</h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-8">
              {deleteConfirm.type === 'single' 
                ? `Are you sure you want to delete cost code "${deleteConfirm.name}"? This action cannot be undone.`
                : `Are you sure you want to delete ${deleteConfirm.count} selected cost codes? This action cannot be undone.`}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 px-6 py-3 bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 rounded-2xl text-sm font-bold hover:bg-gray-200 dark:hover:bg-white/10 transition-all">Cancel</button>
              <button onClick={handleDelete} className="flex-1 px-6 py-3 bg-red-600 text-white rounded-2xl text-sm font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-600/20">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Enterprise/Project Resource Selection Sidebar */}
      <AnimatePresence>
        {isResourceModalOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsResourceModalOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[100]"
            />
            {/* Sidebar */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-[800px] bg-white dark:bg-[#0A0A0A] shadow-[-20px_0_50px_rgba(0,0,0,0.1)] z-[101] flex flex-col border-l border-gray-200 dark:border-white/10"
            >
              {/* Header Section */}
              <div className="shrink-0 p-6 border-b bg-white dark:bg-[#0A0A0A]">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
                      <Database className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold tracking-tight dark:text-white">
                          Resource Library
                        </h2>
                        <div className="flex bg-gray-100 dark:bg-white/5 p-1 rounded-lg ml-4">
                          <button 
                            onClick={() => setResourceLibrarySource('enterprise')}
                            className={cn(
                              "px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all",
                              resourceLibrarySource === 'enterprise' ? "bg-white dark:bg-[#1a1a1a] shadow-sm text-blue-600" : "text-gray-400 hover:text-gray-600"
                            )}
                          >
                            Enterprise
                          </button>
                          <button 
                            onClick={() => setResourceLibrarySource('project')}
                            className={cn(
                              "px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all",
                              resourceLibrarySource === 'project' ? "bg-white dark:bg-[#1a1a1a] shadow-sm text-blue-600" : "text-gray-400 hover:text-gray-600"
                            )}
                          >
                            Project
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                        Adding to <span className="font-bold text-blue-600">{selectedEtcCode}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-white/5 rounded-lg border border-gray-200 dark:border-white/10">
                      <span className="text-sm font-bold text-blue-600">{selectedResourceIds.size}</span>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Selected</span>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => setIsResourceModalOpen(false)}
                      className="w-10 h-10 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400"
                    >
                      <X className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input 
                      placeholder={`Search ${resourceLibrarySource} resources...`} 
                      value={resourceSearch}
                      onChange={(e) => setResourceSearch(e.target.value)}
                      className="pl-10 h-10 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="h-10 px-4 font-bold rounded-xl border hover:bg-gray-50 dark:hover:bg-white/5 transition-all text-xs"
                      onClick={() => {
                        const library = resourceLibrarySource === 'enterprise' ? enterprise.resourceRates : project.resourceRates;
                        const filtered = library?.filter(r => 
                          r.name.toLowerCase().includes(resourceSearch.toLowerCase()) ||
                          r.id.toLowerCase().includes(resourceSearch.toLowerCase()) ||
                          r.category?.toLowerCase().includes(resourceSearch.toLowerCase())
                        ) || [];
                        if (selectedResourceIds.size === filtered.length && filtered.length > 0) {
                          setSelectedResourceIds(new Set());
                        } else {
                          setSelectedResourceIds(new Set(filtered.map(r => r.id)));
                        }
                      }}
                    >
                      {selectedResourceIds.size > 0 && selectedResourceIds.size === ((resourceLibrarySource === 'enterprise' ? enterprise.resourceRates : project.resourceRates)?.filter(r => 
                        r.name.toLowerCase().includes(resourceSearch.toLowerCase()) ||
                        r.id.toLowerCase().includes(resourceSearch.toLowerCase()) ||
                        r.category?.toLowerCase().includes(resourceSearch.toLowerCase())
                      ).length || 0) ? 'Deselect All' : 'Select All'}
                    </Button>
                    <div className="flex bg-gray-100 dark:bg-white/5 p-1 rounded-lg">
                      <button 
                        onClick={() => setCollapsedCategories(new Set())}
                        className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-gray-400 hover:text-blue-600 transition-all"
                      >
                        Expand All
                      </button>
                      <button 
                        onClick={() => setCollapsedCategories(new Set(groupedLibraryResources.map(([cat]) => cat)))}
                        className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-gray-400 hover:text-blue-600 transition-all"
                      >
                        Collapse All
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Table Content Section */}
              <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#0A0A0A]">
                {/* Table Header */}
                <div className="shrink-0 grid grid-cols-[60px_100px_1fr_120px_80px_100px] gap-4 px-6 py-3 bg-gray-50 dark:bg-white/5 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-white/10 sticky top-0 z-20">
                  <div className="flex justify-center">Select</div>
                  <div>ID</div>
                  <div>Name</div>
                  <div>Category</div>
                  <div>Unit</div>
                  <div className="text-right">Rate</div>
                </div>
                
                {/* Scrollable List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  <div className="divide-y divide-gray-100 dark:divide-white/5">
                    {groupedLibraryResources.map(([category, resources]) => (
                      <div key={category}>
                        <div 
                          onClick={() => {
                            const next = new Set(collapsedCategories);
                            if (next.has(category)) {
                              next.delete(category);
                            } else {
                              next.add(category);
                            }
                            setCollapsedCategories(next);
                          }}
                          className="px-6 py-2 bg-gray-50/50 dark:bg-white/5 text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider border-y border-gray-100 dark:border-white/5 sticky top-0 z-10 backdrop-blur-sm cursor-pointer flex items-center justify-between group"
                        >
                          <div className="flex items-center gap-2">
                            {collapsedCategories.has(category) ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            {category}
                          </div>
                          <span className="text-[9px] text-gray-400 group-hover:text-blue-600 transition-colors">
                            {resources.length} Resources
                          </span>
                        </div>
                        {!collapsedCategories.has(category) && (
                          <div className="divide-y divide-gray-100 dark:divide-white/5">
                            {resources.map((resource) => (
                              <div 
                                key={resource.id}
                                onClick={() => {
                                  const next = new Set(selectedResourceIds);
                                  if (next.has(resource.id)) {
                                    next.delete(resource.id);
                                  } else {
                                    next.add(resource.id);
                                  }
                                  setSelectedResourceIds(next);
                                }}
                                className={cn(
                                  "grid grid-cols-[60px_100px_1fr_120px_80px_100px] gap-4 px-6 py-3 items-center cursor-pointer transition-all hover:bg-blue-50/30 dark:hover:bg-blue-900/5 group relative",
                                  selectedResourceIds.has(resource.id) && "bg-blue-50/60 dark:bg-blue-900/10"
                                )}
                              >
                                {selectedResourceIds.has(resource.id) && (
                                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-600" />
                                )}
                                
                                <div className="flex justify-center">
                                  <div className={cn(
                                    "w-5 h-5 rounded border flex items-center justify-center transition-all duration-200",
                                    selectedResourceIds.has(resource.id)
                                      ? "bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-600/20"
                                      : "border-gray-200 dark:border-white/10 bg-white dark:bg-transparent group-hover:border-blue-400"
                                  )}>
                                    {selectedResourceIds.has(resource.id) && <CheckCircle2 className="w-3 h-3" />}
                                  </div>
                                </div>
                                
                                <div className="text-xs font-mono text-gray-500 dark:text-gray-400">
                                  {resource.id}
                                </div>
                                
                                <div className="text-sm font-bold text-gray-900 dark:text-white group-hover:text-blue-600 transition-colors truncate">
                                  {resource.name}
                                </div>
                                
                                <div>
                                  <Badge variant="secondary" className="text-[9px] font-bold uppercase px-2 py-0.5 bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 border-none rounded-md">
                                    {resource.category}
                                  </Badge>
                                </div>
                                
                                <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                  {resource.unit}
                                </div>
                                
                                <div className="text-sm font-bold text-blue-600 dark:text-blue-400 text-right tabular-nums">
                                  {formatCurrency(resource.rate)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    
                    {groupedLibraryResources.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-20">
                        <div className="w-16 h-16 bg-gray-100 dark:bg-white/5 rounded-full flex items-center justify-center mb-4">
                          <Search className="w-8 h-8 text-gray-300" />
                        </div>
                        <h3 className="text-lg font-bold dark:text-white">No resources found</h3>
                        <p className="text-gray-500 text-center mt-1 text-xs px-10">Try a different search term or switch library.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Section */}
                <div className="shrink-0 p-6 border-t bg-white dark:bg-[#0A0A0A] flex items-center justify-between shadow-[0_-10px_30px_rgba(0,0,0,0.05)] relative z-30">
                  <div className="flex items-center gap-4">
                    <div className="text-lg font-bold dark:text-white">
                      {selectedResourceIds.size} <span className="text-gray-400 font-medium text-sm">Selected</span>
                    </div>
                  </div>
                  
                  <div className="flex gap-3">
                    <Button 
                      variant="ghost" 
                      onClick={() => {
                        setIsResourceModalOpen(false);
                        setSelectedResourceIds(new Set());
                      }}
                      className="px-4 h-10 font-bold rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 transition-all text-sm"
                    >
                      Cancel
                    </Button>
                    <Button 
                      onClick={() => {
                        const library = resourceLibrarySource === 'enterprise' ? enterprise.resourceRates : project.resourceRates;
                        const selected = library?.filter(r => selectedResourceIds.has(r.id)) || [];
                        handleAddResources(selected, resourceLibrarySource);
                      }}
                      disabled={selectedResourceIds.size === 0}
                      className="px-6 h-10 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-600/20 disabled:opacity-50 disabled:shadow-none transition-all flex items-center gap-2 text-sm"
                    >
                      Add to Forecast <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <Dialog open={!!importPreview} onOpenChange={(open) => !open && setImportPreview(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 border-b border-gray-100 dark:border-white/10 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-xl font-bold dark:text-white flex items-center gap-2">
                   <Upload className="w-5 h-5 text-blue-600" />
                   Review Cost Codes Import
                </DialogTitle>
                <DialogDescription className="mt-1">
                  Previewing {importPreview?.data.length || 0} cost codes from your file.
                </DialogDescription>
              </div>
              <div className="flex items-center gap-3">
                <Button 
                   variant="outline" 
                   onClick={() => setImportPreview(null)}
                   className="font-bold h-10 rounded-xl"
                >
                  Cancel
                </Button>
                <Button 
                   onClick={confirmImport} 
                   disabled={hasImportDuplicates}
                   className="bg-blue-600 hover:bg-blue-700 text-white font-bold h-10 rounded-xl px-6 shadow-lg shadow-blue-600/20"
                >
                  Import Selected
                </Button>
              </div>
            </div>
            
            {hasImportDuplicates && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-xl flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                <div className="text-xs text-red-800 dark:text-red-400">
                  <span className="font-bold">Duplicate IDs detected! </span>
                  The following codes appear multiple times in your file: {duplicateIds.join(', ')}.
                  Please fix your Excel file and try again.
                </div>
              </div>
            )}
          </DialogHeader>

          <div className="flex-1 overflow-auto bg-gray-50/30 dark:bg-black/20 p-6">
            <div className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
                    <th className="p-4 font-bold uppercase tracking-widest text-gray-500">Code</th>
                    <th className="p-4 font-bold uppercase tracking-widest text-gray-500">Name</th>
                    <th className="p-4 font-bold uppercase tracking-widest text-gray-500">EAC Method</th>
                    <th className="p-4 font-bold uppercase tracking-widest text-gray-500">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                  {importPreview?.data.slice(0, 100).map((row, idx) => {
                    const code = row.code || row.Code || row['Cost Code ID'] || row['Code'];
                    const existing = costCodes.find(c => c.code.toLowerCase() === String(code || '').toLowerCase());
                    const isDuplicate = code && duplicateIds.includes(String(code));

                    return (
                      <tr key={idx} className={cn(
                        "hover:bg-gray-50 dark:hover:bg-white/5 transition-colors",
                        isDuplicate && "bg-red-50/30 dark:bg-red-500/5"
                      )}>
                        <td className="p-4">
                          <span className={cn("font-mono font-bold", isDuplicate ? "text-red-600" : "text-blue-600")}>
                            {code || 'MISSING'}
                          </span>
                        </td>
                        <td className="p-4 text-gray-700 dark:text-gray-300">
                           {row.name || row.Name || row['Cost Code Name'] || row['Description'] || '-'}
                        </td>
                        <td className="p-4">
                           <span className="px-2 py-1 bg-gray-100 dark:bg-white/10 rounded text-[10px] font-bold">
                             {row.eacMethod || row.EACMethod || row['EAC Method'] || 'Manual'}
                           </span>
                        </td>
                        <td className="p-4">
                           {existing ? (
                             <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-bold">
                               <RefreshCw className="w-3 h-3" /> Update Existing
                             </span>
                           ) : (
                             <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold">
                               <Plus className="w-3 h-3" /> New Code
                             </span>
                           )}
                        </td>
                      </tr>
                    );
                  })}
                  {(importPreview?.data.length || 0) > 100 && (
                    <tr>
                       <td colSpan={4} className="p-4 text-center text-gray-400 italic">
                         ... and {(importPreview?.data.length || 0) - 100} more rows
                       </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
