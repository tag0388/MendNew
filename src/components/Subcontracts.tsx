import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { resolveCurrentPeriodIndex } from '../lib/periods';
import { 
  Plus, 
  Search, 
  Trash2, 
  Edit2, 
  ChevronRight, 
  ChevronDown,
  Building2,
  Calendar,
  DollarSign,
  FileText,
  Briefcase,
  Receipt,
  Hash,
  ChevronUp,
  Filter,
  Download,
  MoreVertical,
  Settings,
  Layout,
  Upload,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  X,
  PlusCircle,
  Database,
  Calculator,
  Maximize2,
  Minimize2,
  BarChart3
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { subscribeToTable } from '../lib/supabase';
import { fetchCostCodes } from '../lib/costCodes';
import {
  fetchSubcontractSummaries, createSubcontract, updateSubcontract,
  deleteSubcontracts, importSubcontracts, bulkUpdateSubcontracts,
  fetchLineItems, upsertLineItems, deleteLineItems,
  bulkUpdateLineItems, applyLineItemCellEdit,
  fetchInvoices, createInvoiceFromSubcontract, updateInvoice, deleteInvoices,
  fetchInvoiceItemDetail, updateInvoiceItem, setInvoiceItemClaim,
  fetchClaimPositions, resolveVendorByName, applyLineItemPhasing,
} from '../lib/subcontracts';
import { Enterprise, Project, Subcontract, SubcontractLineItem, Vendor, Invoice, CostCode } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn, formatCurrency, formatDate, dateToISO, calculatePhasing } from '@/lib/utils';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ComposedChart,
  Line
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { AgGridReact } from 'ag-grid-react';
import { createPortal } from 'react-dom';
import { 
  ColDef, 
  GridReadyEvent, 
  GridApi,
  ICellRendererParams,
  ValueFormatterParams,
  CellValueChangedEvent
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import 'ag-grid-enterprise';

interface SubcontractManagementProps {
  enterprise: Enterprise;
  project: Project;
  user: any;
  theme?: 'light' | 'dark';
}

const ActionsCellRenderer = (params: any) => {
  if (params.node.rowPinned) return null;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  
  const { 
    setSelectedSubcontractId,
    setDeleteConfirm,
    setSubcontractFormData,
    setIsAddingSubcontract,
    setEditingSubcontractId,
    setBottomPanelTab
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
            setDeleteConfirm({ type: 'single', id: params.data.id, name: params.data.orderId });
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
          title="Settings"
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
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-gray-100 dark:border-white/5 mb-1">Options</div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSubcontractId(params.data.id);
                    setBottomPanelTab('lineItems');
                    setIsMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 rounded-lg transition-colors"
                >
                  <FileText className="w-4 h-4 text-blue-500" />
                  Details
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSubcontractFormData({
                      orderId: params.data.orderId,
                      orderName: params.data.orderName,
                      orderScope: params.data.orderScope,
                      status: params.data.status,
                      paymentType: params.data.paymentType,
                      awardDate: params.data.awardDate,
                      vendorId: params.data.vendorId,
                      vendorName: params.data.vendorName,
                      vendorUsers: params.data.vendorUsers || [],
                      defaultCostCodeId: params.data.defaultCostCodeId || '',
                      defaultPhasingSource: params.data.defaultPhasingSource || 'Manual',
                      defaultStartDate: params.data.defaultStartDate || '',
                      defaultEndDate: params.data.defaultEndDate || '',
                      defaultDistribution: params.data.defaultDistribution || 'Even'
                    });
                    setEditingSubcontractId(params.data.id);
                    setIsAddingSubcontract(true);
                    setIsMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 rounded-lg transition-colors"
                >
                  <Edit2 className="w-4 h-4 text-emerald-500" />
                  Edit Details
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

const InvoiceActionsCellRenderer = (params: ICellRendererParams) => {
  if (params.node.rowPinned) return null;
  const { setSelectedInvoiceId, setEditingInvoiceId, setIsAddingInvoice, setInvoiceFormData, setInvoiceDeleteConfirm } = params.context;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const getMenuPosition = () => {
    if (!menuRef.current) return { top: 0, right: 0 };
    const rect = menuRef.current.getBoundingClientRect();
    return {
      top: rect.bottom + 5,
      right: window.innerWidth - rect.right
    };
  };

  return (
    <div className="flex items-center justify-center gap-1 h-full" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setInvoiceDeleteConfirm(params.data.id);
        }}
        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
        title="Delete Invoice"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsMenuOpen(!isMenuOpen);
          }}
          className={cn(
            "p-1.5 rounded-lg transition-all",
            isMenuOpen 
              ? "bg-green-600 text-white shadow-lg shadow-green-600/20" 
              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10"
          )}
          title="Settings"
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
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-gray-100 dark:border-white/5 mb-1">Invoice Options</div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedInvoiceId(params.data.id);
                    setIsMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 rounded-lg transition-colors"
                >
                  <FileText className="w-4 h-4 text-blue-500" />
                  Details
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setInvoiceFormData({
                      description: params.data.description,
                      submittedDate: params.data.submittedDate || '',
                      certifiedDate: params.data.certifiedDate || '',
                      paymentDate: params.data.paymentDate || '',
                      status: params.data.status
                    });
                    setEditingInvoiceId(params.data.id);
                    setIsAddingInvoice(true);
                    setIsMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 rounded-lg transition-colors"
                >
                  <Edit2 className="w-4 h-4 text-emerald-500" />
                  Edit Details
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

export default function SubcontractManagement({ enterprise, project, user, theme = 'light' }: SubcontractManagementProps) {
  const [subcontracts, setSubcontracts] = useState<Subcontract[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  // Children of whatever is open, not of everything in the project.
  const [lineItems, setLineItems] = useState<SubcontractLineItem[]>([]);
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);
  const [claimPositions, setClaimPositions] = useState<Record<string, { claimed: number; certified: number }>>({});
  const [loading, setLoading] = useState(true);
  const [selectedSubcontractId, setSelectedSubcontractId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [isMainTableCollapsed, setIsMainTableCollapsed] = useState(false);
  const [isBottomPanelCollapsed, setIsBottomPanelCollapsed] = useState(false);
  const [isInvoicesCollapsed, setIsInvoicesCollapsed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedLineItemIds, setSelectedLineItemIds] = useState<Set<string>>(new Set());
  const [quickFilterText, setQuickFilterText] = useState('');
  const [lineItemQuickFilterText, setLineItemQuickFilterText] = useState('');
  const [bottomPanelTab, setBottomPanelTab] = useState<'lineItems' | 'invoices'>('lineItems');
  
  const projectPeriodDates = useMemo(() => {
    const periods = project.reportingPeriods?.periods || [];
    if (periods.length === 0) return { start: '', end: '' };
    return {
      start: periods[0].startDate || '',
      end: periods[periods.length - 1].endDate || ''
    };
  }, [project.reportingPeriods]);

  const [isAddingSubcontract, setIsAddingSubcontract] = useState(false);
  const [isAddingInvoice, setIsAddingInvoice] = useState(false);
  const [editingSubcontractId, setEditingSubcontractId] = useState<string | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [isLineItemBulkUpdating, setIsLineItemBulkUpdating] = useState(false);
  const [bulkUpdateData, setBulkUpdateData] = useState<Partial<Subcontract>>({});
  const [lineItemBulkUpdateData, setLineItemBulkUpdateData] = useState<Partial<SubcontractLineItem>>({
    enterpriseAttributes: {},
    projectAttributes: {},
    userDefined: {}
  });
  const [subcontractFormData, setSubcontractFormData] = useState<Partial<Subcontract>>({
    orderId: '',
    orderName: '',
    orderScope: '',
    status: 'Active',
    defaultCostCodeId: '',
    defaultPhasingSource: 'Auto',
    defaultStartDate: projectPeriodDates.start,
    defaultEndDate: projectPeriodDates.end,
    defaultDistribution: 'Even',
    paymentType: 'LumpSum',
    awardDate: new Date().toISOString().split('T')[0],
    vendorId: '',
    vendorName: ''
  });
  const [invoiceFormData, setInvoiceFormData] = useState({
    description: '',
    submittedDate: '',
    certifiedDate: '',
    paymentDate: '',
    status: 'Draft' as any
  });
  const [invoiceDeleteConfirm, setInvoiceDeleteConfirm] = useState<string | null>(null);

  const [isHistogramVisible, setIsHistogramVisible] = useState(false);
  const [isAddingLineItem, setIsAddingLineItem] = useState(false);
  const [lineItemFormData, setLineItemFormData] = useState<Partial<SubcontractLineItem>>({
    itemNo: '',
    description: '',
    costCodeId: '',
    date: new Date().toISOString().split('T')[0],
    qty: 0,
    unit: '',
    rate: 0,
    type: 'Original',
    status: 'Approved',
    enterpriseAttributes: {},
    projectAttributes: {},
    userDefined: {}
  });

  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'single' | 'bulk'; id?: string; name?: string; count?: number } | null>(null);
  const [entryMethod, setEntryMethod] = useState<'Cumulative' | 'Periodic'>('Cumulative');
  const [importPreview, setImportPreview] = useState<{ type: 'subcontracts' | 'lineItems', data: any[] } | null>(null);

  const gridRef = useRef<AgGridReact>(null);
  const lineItemsGridRef = useRef<AgGridReact>(null);
  const invoicesGridRef = useRef<AgGridReact>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (projectPeriodDates.start || projectPeriodDates.end) {
      setSubcontractFormData(prev => ({
        ...prev,
        defaultStartDate: prev.defaultStartDate || projectPeriodDates.start,
        defaultEndDate: prev.defaultEndDate || projectPeriodDates.end
      }));
    }
  }, [projectPeriodDates]);

  // The grid reads subcontract_summary: one row per subcontract with the
  // roll-ups already computed in SQL. It used to load every line item of every
  // subcontract so the browser could sum them, which is the whole commitment
  // ledger crossing the network to draw a handful of rows.
  const reloadSubcontracts = useCallback(async () => {
    try {
      setSubcontracts(await fetchSubcontractSummaries(project.id));
    } catch (error: any) {
      console.error('Subcontracts fetch error:', error);
      toast.error(`Failed to load subcontracts: ${error?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  const reloadInvoices = useCallback(async () => {
    try {
      setInvoices(await fetchInvoices(project.id));
    } catch (error: any) {
      console.error('Invoices fetch error:', error);
    }
  }, [project.id]);

  useEffect(() => {
    if (!project.id) return;
    void reloadSubcontracts();
    void reloadInvoices();

    const load = async () => {
      try {
        setCostCodes(await fetchCostCodes(project.id));
      } catch (error) {
        console.error('Subcontracts: cost codes fetch error:', error);
      }
    };
    void load();

    const unsubSub = subscribeToTable('subcontracts', `project_id=eq.${project.id}`, () => void reloadSubcontracts());
    // A line item changes the subcontract's roll-ups, so the grid follows it.
    const unsubItems = subscribeToTable('subcontract_line_items', `project_id=eq.${project.id}`, () => void reloadSubcontracts());
    const unsubInv = subscribeToTable('invoices', `project_id=eq.${project.id}`, () => {
      void reloadInvoices();
      void reloadSubcontracts();
    });
    const unsubCost = subscribeToTable('cost_codes', `project_id=eq.${project.id}`, () => void load());

    return () => { unsubSub(); unsubItems(); unsubInv(); unsubCost(); };
  }, [project.id, reloadSubcontracts, reloadInvoices]);

  // Line items are fetched for the subcontract that is open, never for all of
  // them at once.
  const reloadLineItems = useCallback(async () => {
    if (!selectedSubcontractId) { setLineItems([]); setClaimPositions({}); return; }
    try {
      const [items, positions] = await Promise.all([
        fetchLineItems(selectedSubcontractId),
        fetchClaimPositions(project.id, selectedSubcontractId),
      ]);
      setLineItems(items);
      setClaimPositions(positions);
    } catch (error: any) {
      console.error('Line items fetch error:', error);
      toast.error(`Failed to load line items: ${error?.message || 'Unknown error'}`);
    }
  }, [selectedSubcontractId, project.id]);

  useEffect(() => {
    void reloadLineItems();
    if (!selectedSubcontractId) return;
    return subscribeToTable(
      'subcontract_line_items',
      `subcontract_id=eq.${selectedSubcontractId}`,
      () => void reloadLineItems()
    );
  }, [reloadLineItems, selectedSubcontractId]);

  // Likewise the open invoice's items.
  const reloadInvoiceItems = useCallback(async () => {
    if (!selectedInvoiceId) { setInvoiceItems([]); return; }
    try {
      // The view carries the parent line item's reference fields and the
      // position on the previous invoice, so the grid does not derive them.
      setInvoiceItems(await fetchInvoiceItemDetail(selectedInvoiceId));
    } catch (error: any) {
      console.error('Invoice items fetch error:', error);
    }
  }, [selectedInvoiceId]);

  useEffect(() => {
    void reloadInvoiceItems();
    if (!selectedInvoiceId) return;
    return subscribeToTable(
      'invoice_items',
      `invoice_id=eq.${selectedInvoiceId}`,
      () => void reloadInvoiceItems()
    );
  }, [reloadInvoiceItems, selectedInvoiceId]);

  // Clear selected invoice when subcontract changes
  useEffect(() => {
    setSelectedInvoiceId(null);
  }, [selectedSubcontractId]);

  const selectedSubcontract = useMemo(() => 
    subcontracts.find(s => s.id === selectedSubcontractId), 
    [subcontracts, selectedSubcontractId]
  );

  const selectedSubcontractInvoices = useMemo(() => {
    if (!selectedSubcontractId) return [];
    return invoices
      .filter(i => i.subcontractId === selectedSubcontractId)
      .sort((a, b) => {
        // Sort by Subcontract ID (should be the same here) then Invoice ID
        if (a.subcontractId !== b.subcontractId) {
          return a.subcontractId.localeCompare(b.subcontractId);
        }
        const aNo = parseInt(a.invoiceId.replace(/\D/g, '') || '0');
        const bNo = parseInt(b.invoiceId.replace(/\D/g, '') || '0');
        return aNo - bNo;
      });
  }, [invoices, selectedSubcontractId]);

  const selectedInvoice = useMemo(() => {
    return invoices.find(i => i.id === selectedInvoiceId);
  }, [invoices, selectedInvoiceId]);

  // Read from invoice_item_detail: the parent line item's reference fields and
  // the position on the PREVIOUS invoice come from the view. This used to be
  // derived here by loading every invoice on the order with all of its items.
  const selectedInvoiceItems = invoiceItems;

  const invoiceItemsPinnedTopRowData = useMemo(() => {
    if (selectedInvoiceItems.length === 0) return [];
    
    const totals = selectedInvoiceItems.reduce((acc, item) => {
      acc.total += (item.qty || 0) * (item.rate || 0);
      acc.claimValue += (item.claimValue || 0);
      acc.periodicClaimValue += (item.periodicClaimValue || 0);
      acc.certifiedValue += (item.certifiedValue || 0);
      acc.periodicCertifiedValue += (item.periodicCertifiedValue || 0);
      return acc;
    }, {
      total: 0,
      claimValue: 0,
      periodicClaimValue: 0,
      certifiedValue: 0,
      periodicCertifiedValue: 0
    });

    return [{
      isPinned: true,
      description: 'SUB-TOTAL',
      total: totals.total,
      claimValue: totals.claimValue,
      periodicClaimValue: totals.periodicClaimValue,
      certifiedValue: totals.certifiedValue,
      periodicCertifiedValue: totals.periodicCertifiedValue
    }];
  }, [selectedInvoiceItems]);

  /**
   * The subcontracts grid's figures, read from subcontract_summary.
   *
   * Every one of these used to be computed here: original, approved, pending
   * and forecast change values by filtering and summing the subcontract's line
   * item array, and the claimed and certified positions by sorting the
   * project's invoices on the digits in their reference. That meant loading
   * every line item of every subcontract in the project to draw the grid. The
   * view does the same arithmetic in SQL, on one row per subcontract.
   */
  const getSubcontractCalculations = (subcontract: any | undefined) => {
    const zero = {
      originalAmount: 0, approvedChanges: 0, pendingChanges: 0, forecastChanges: 0,
      totalAmount: 0, claimedAmountToDate: 0, claimedLastInvoice: 0,
      certifiedAmountToDate: 0, certifiedLastInvoice: 0, varianceAmount: 0,
    };
    if (!subcontract) return zero;

    const claimedAmountToDate = Number(subcontract.claimedAmountToDate) || 0;
    const certifiedAmountToDate = Number(subcontract.certifiedAmountToDate) || 0;

    return {
      originalAmount: Number(subcontract.originalAmount) || 0,
      approvedChanges: Number(subcontract.approvedChanges) || 0,
      pendingChanges: Number(subcontract.pendingChanges) || 0,
      forecastChanges: Number(subcontract.forecastChanges) || 0,
      totalAmount: Number(subcontract.totalAmount) || 0,
      claimedAmountToDate,
      // The cumulative position IS the latest invoice's position, so these are
      // the same number under two headings, as they were before.
      claimedLastInvoice: claimedAmountToDate,
      certifiedAmountToDate,
      certifiedLastInvoice: certifiedAmountToDate,
      varianceAmount: Number(subcontract.varianceAmount) || (certifiedAmountToDate - claimedAmountToDate),
    };
  };

  const onCellValueChanged = async (event: CellValueChangedEvent) => {
    const { data, colDef, newValue, oldValue } = event;
    if (newValue === oldValue) return;
    if (!colDef.field) return;

    // Uniqueness check for orderId
    if (colDef.field === 'orderId') {
      const isDuplicate = subcontracts.some(s => s.id !== data.id && s.orderId.toLowerCase() === String(newValue).toLowerCase());
      if (isDuplicate) {
        toast.error(`Order ID "${newValue}" already exists.`);
        event.node.setDataValue(colDef.field, oldValue);
        return;
      }
    }

    const updateData: any = {
      [colDef.field]: (newValue instanceof Date) ? dateToISO(newValue) : newValue,
      updatedAt: new Date().toISOString()
    };

    if (colDef.field === 'vendorName') {
      const vendor = enterprise.vendors?.find(v => v.name === newValue);
      if (vendor) {
        updateData.vendorId = vendor.id;
      }
    }

    // vendorName is the vendor's name, not a column on subcontracts.
    delete updateData.vendorName;

    try {
      await updateSubcontract(data.id, updateData);
      await reloadSubcontracts();
      toast.success('Updated successfully.');
    } catch (error: any) {
      console.error('Error updating subcontract:', error);
      toast.error(`Failed to update: ${error?.message || 'Unknown error'}`);
      await reloadSubcontracts();
    }
  };

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
            suppressValues: false,
            suppressPivots: false,
            suppressPivotMode: false,
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

  const defaultColDef = useMemo(() => ({
    resizable: true,
    sortable: true,
    filter: true,
    minWidth: 100,
    floatingFilter: false,
  }), []);

  const subcontractColumnDefs = useMemo<any[]>(() => {
    const sortedCostCodes = [...costCodes].sort((a, b) => a.code.localeCompare(b.code));
    const defs: any[] = [
    { 
      field: 'orderId', 
      headerName: 'Order ID', 
      pinned: 'left', 
      width: 120,
      sort: 'asc',
      checkboxSelection: (params) => params.node.rowPinned !== 'top',
      headerCheckboxSelection: true,
      editable: false,
      filter: 'agTextColumnFilter',
      sortable: true,
      enableRowGroup: true,
      enablePivot: true,
      cellRenderer: (params: ICellRendererParams) => {
        if (params.node.rowPinned === 'top') {
          return <span className="font-bold text-blue-600">SubTotal</span>;
        }
        return (
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setSelectedSubcontractId(params.data.id);
              setBottomPanelTab('lineItems');
              setIsMainTableCollapsed(false); // Ensure it's not collapsed when opening details
              setIsBottomPanelCollapsed(false); // Ensure details are visible
            }}
            className="font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline hover:text-blue-800 transition-colors"
          >
            {params.value}
          </button>
        );
      }
    },
    { field: 'orderName', headerName: 'Order Name', width: 200, editable: true, filter: 'agTextColumnFilter', sortable: true, enableRowGroup: true, enablePivot: true },
    { field: 'orderScope', headerName: 'Description', width: 250, editable: true, filter: 'agTextColumnFilter', sortable: true, enableRowGroup: true, enablePivot: true },
    { 
      field: 'vendorName', 
      headerName: 'Vendor', 
      width: 180, 
      editable: true,
      filter: 'agSetColumnFilter', 
      sortable: true, 
      enableRowGroup: true, 
      enablePivot: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: {
        values: enterprise.vendors?.map(v => v.name) || []
      }
    },
    { 
      field: 'paymentType', 
      headerName: 'Payment Type', 
      width: 150,
      editable: true,
      filter: 'agSetColumnFilter',
      sortable: true,
      enableRowGroup: true,
      enablePivot: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: {
        values: ['LumpSum', 'Schedule of Rates', 'Re-measurable']
      }
    },
    { 
      field: 'awardDate', 
      headerName: 'Award Date', 
      width: 130, 
      editable: true, 
      filter: 'agDateColumnFilter', 
      sortable: true, 
      enableRowGroup: true, 
      enablePivot: true,
      cellEditor: 'agDateCellEditor',
      valueFormatter: params => formatDate(params.value)
    },
    { 
      field: 'status', 
      headerName: 'Status', 
      width: 120,
      editable: true,
      filter: 'agSetColumnFilter',
      sortable: true,
      enableRowGroup: true,
      enablePivot: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: {
        values: ['Active', 'Complete', 'On Hold']
      },
      cellRenderer: (params: ICellRendererParams) => (
        <span className={cn(
          "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest",
          params.value === 'Active' ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400" :
          params.value === 'Complete' ? "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400" :
          "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400"
        )}>
          {params.value}
        </span>
      )
    },
    {
      headerName: 'Default Values',
      children: [
        {
          field: 'defaultCostCodeId',
          headerName: 'Default Cost Code',
          width: 180,
          editable: true,
          sortable: true,
          filter: 'agSetColumnFilter',
          enableRowGroup: true,
          cellEditor: 'agRichSelectCellEditor',
          cellEditorParams: {
            values: sortedCostCodes.map(c => c.code),
            formatValue: (val: string) => {
              const code = sortedCostCodes.find(c => c.code === val);
              return code ? `${code.code} - ${code.name}` : val;
            },
            searchType: 'match',
            allowTyping: true,
            filterList: true,
            highlightMatch: true
          },
          valueFormatter: params => {
            const code = sortedCostCodes.find(c => c.code === params.value);
            return code ? `${code.code} - ${code.name}` : params.value;
          }
        },
        {
          field: 'defaultStartDate',
          headerName: 'Default Start Date',
          width: 150,
          editable: true,
          sortable: true,
          filter: 'agDateColumnFilter',
          enableRowGroup: true,
          cellEditor: 'agDateCellEditor',
          valueFormatter: params => formatDate(params.value)
        },
        {
          field: 'defaultEndDate',
          headerName: 'Default End Date',
          width: 150,
          editable: true,
          sortable: true,
          filter: 'agDateColumnFilter',
          enableRowGroup: true,
          cellEditor: 'agDateCellEditor',
          valueFormatter: params => formatDate(params.value)
        },
        {
          field: 'defaultPhasingSource',
          headerName: 'Default Phasing Source',
          width: 160,
          editable: true,
          sortable: true,
          filter: 'agSetColumnFilter',
          enableRowGroup: true,
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: {
            values: ['Manual', 'Auto']
          }
        },
        {
          field: 'defaultDistribution',
          headerName: 'Default Distribution',
          width: 160,
          editable: true,
          sortable: true,
          filter: 'agSetColumnFilter',
          enableRowGroup: true,
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: {
            values: ['Even', 'Bell Curve', 'Front load', 'Back load', 'S-Curve', 'Profile']
          }
        }
      ]
    },
    { 
      headerName: 'Original Amount', 
      width: 150,
      type: 'numericColumn',
      filter: 'agNumberColumnFilter',
      sortable: true,
      enableValue: true,
      valueGetter: params => {
        if (!params.data) return 0;
        if (params.node?.rowPinned === 'top') return params.data.originalAmount;
        return getSubcontractCalculations(params.data).originalAmount;
      },
      valueFormatter: params => formatCurrency(params.value)
    },
    { 
      headerName: 'Approved Changes', 
      width: 150,
      type: 'numericColumn',
      filter: 'agNumberColumnFilter',
      sortable: true,
      enableValue: true,
      valueGetter: params => {
        if (!params.data) return 0;
        if (params.node?.rowPinned === 'top') return params.data.approvedChanges;
        return getSubcontractCalculations(params.data).approvedChanges;
      },
      valueFormatter: params => formatCurrency(params.value)
    },
    { 
      headerName: 'Pending Changes', 
      width: 150,
      type: 'numericColumn',
      filter: 'agNumberColumnFilter',
      sortable: true,
      enableValue: true,
      valueGetter: params => {
        if (!params.data) return 0;
        if (params.node?.rowPinned === 'top') return params.data.pendingChanges;
        return getSubcontractCalculations(params.data).pendingChanges;
      },
      valueFormatter: params => formatCurrency(params.value)
    },
    { 
      headerName: 'Forecast Changes', 
      width: 150,
      type: 'numericColumn',
      filter: 'agNumberColumnFilter',
      sortable: true,
      enableValue: true,
      valueGetter: params => {
        if (!params.data) return 0;
        if (params.node?.rowPinned === 'top') return params.data.forecastChanges;
        return getSubcontractCalculations(params.data).forecastChanges;
      },
      valueFormatter: params => formatCurrency(params.value)
    },
    { 
      headerName: 'Total Amount', 
      width: 150,
      type: 'numericColumn',
      filter: 'agNumberColumnFilter',
      sortable: true,
      enableValue: true,
      valueGetter: params => {
        if (!params.data) return 0;
        if (params.node?.rowPinned === 'top') return params.data.totalAmount;
        return getSubcontractCalculations(params.data).totalAmount;
      },
      valueFormatter: params => formatCurrency(params.value),
      cellClass: 'font-bold'
    },
    { 
      headerName: 'Claimed To Date', 
      width: 150,
      type: 'numericColumn',
      filter: 'agNumberColumnFilter',
      sortable: true,
      enableValue: true,
      valueGetter: params => {
        if (!params.data) return 0;
        if (params.node?.rowPinned === 'top') return params.data.claimedAmountToDate;
        return getSubcontractCalculations(params.data).claimedAmountToDate;
      },
      valueFormatter: params => formatCurrency(params.value)
    },
    { 
      headerName: 'Certified To Date', 
      width: 150,
      type: 'numericColumn',
      filter: 'agNumberColumnFilter',
      sortable: true,
      enableValue: true,
      valueGetter: params => {
        if (!params.data) return 0;
        if (params.node?.rowPinned === 'top') return params.data.certifiedAmountToDate;
        return getSubcontractCalculations(params.data).certifiedAmountToDate;
      },
      valueFormatter: params => formatCurrency(params.value),
    },
    { 
      headerName: 'Variance', 
      width: 150,
      type: 'numericColumn',
      filter: 'agNumberColumnFilter',
      sortable: true,
      enableValue: true,
      valueGetter: params => {
        if (!params.data) return 0;
        if (params.node?.rowPinned === 'top') return params.data.varianceAmount;
        return getSubcontractCalculations(params.data).varianceAmount;
      },
      valueFormatter: params => formatCurrency(params.value)
    },
    ];

    const validEnterpriseSubcontractAttrs = (enterprise.subcontractAttributes || [])
      .filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0);

    if (validEnterpriseSubcontractAttrs.length > 0) {
      const entGroup = {
        headerName: 'Enterprise Subcontract Attributes',
        openByDefault: true,
        children: validEnterpriseSubcontractAttrs.map(attr => ({
          field: `enterpriseAttributes.${attr.id}`,
          headerName: attr.title || `Attribute ${attr.id}`,
          width: 200,
          editable: true,
          enableRowGroup: true,
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
      };
      defs.push(entGroup);
    }

    const validProjectSubcontractAttrs = (project.subcontractAttributes || [])
      .filter(attr => attr.title && attr.title.trim() !== '' && attr.values && attr.values.length > 0);

    if (validProjectSubcontractAttrs.length > 0) {
      const projGroup = {
        headerName: 'Project Subcontract Attributes',
        openByDefault: true,
        children: validProjectSubcontractAttrs.map(attr => ({
          field: `projectAttributes.${attr.id}`,
          headerName: attr.title || `Attribute ${attr.id}`,
          width: 200,
          editable: true,
          enableRowGroup: true,
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
      };
      defs.push(projGroup);
    }

    defs.push({
      headerName: 'Actions',
      width: 120,
      pinned: 'right',
      cellRenderer: 'actionsRenderer',
      cellClass: 'overflow-visible'
    });

    return defs;
  }, [invoices, selectedSubcontractId, enterprise.subcontractAttributes, project.subcontractAttributes, enterprise.vendors, costCodes, enterprise]);

  const subcontractPinnedTopRowData = useMemo(() => {
    if (subcontracts.length === 0) return [];
    
    const dataToSum = selectedSubcontractId 
      ? subcontracts.filter(s => s.id === selectedSubcontractId)
      : subcontracts;

    const totals = dataToSum.reduce((acc, s) => {
      const calcs = getSubcontractCalculations(s);
      acc.originalAmount += calcs.originalAmount;
      acc.approvedChanges += calcs.approvedChanges;
      acc.pendingChanges += calcs.pendingChanges;
      acc.forecastChanges += calcs.forecastChanges;
      acc.totalAmount += calcs.totalAmount;
      acc.claimedAmountToDate += calcs.claimedAmountToDate;
      acc.certifiedAmountToDate += calcs.certifiedAmountToDate;
      acc.varianceAmount += calcs.varianceAmount;
      return acc;
    }, {
      originalAmount: 0,
      approvedChanges: 0,
      pendingChanges: 0,
      forecastChanges: 0,
      totalAmount: 0,
      claimedAmountToDate: 0,
      certifiedAmountToDate: 0,
      varianceAmount: 0
    });

    return [{
      orderId: 'SubTotal',
      ...totals,
      isPinned: true
    }];
  }, [subcontracts, invoices, selectedSubcontractId]);

  const handleAddSubcontract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project.id || !enterprise.id) return;

    if (editingSubcontractId) {
      // Update existing
      try {
        const { vendorName, ...fields } = subcontractFormData as any;
        await updateSubcontract(editingSubcontractId, fields);
        await reloadSubcontracts();
        setIsAddingSubcontract(false);
        setEditingSubcontractId(null);
        setSubcontractFormData({
          orderId: '',
          orderName: '',
          orderScope: '',
          status: 'Active',
          defaultCostCodeId: '',
          defaultPhasingSource: 'Auto',
          defaultStartDate: projectPeriodDates.start,
          defaultEndDate: projectPeriodDates.end,
          defaultDistribution: 'Even',
          paymentType: 'LumpSum',
          awardDate: new Date().toISOString().split('T')[0],
          vendorId: '',
          vendorName: ''
        });
        toast.success('Subcontract updated successfully.');
      } catch (error: any) {
        console.error('Error updating subcontract:', error);
        toast.error(`Failed to update subcontract: ${error?.message || 'Unknown error'}`);
      }
      return;
    }

    const isDuplicate = subcontracts.some(s => s.orderId.toLowerCase() === subcontractFormData.orderId?.toLowerCase());
    if (isDuplicate) {
      toast.error('Order ID must be unique within the project.');
      return;
    }

    try {
      const { vendorName, ...fields } = subcontractFormData as any;
      // totalAmount is derived from the line items by trigger, so a new
      // subcontract does not carry one in.
      await createSubcontract(project.id, { ...fields, createdBy: user.uid });
      await reloadSubcontracts();
      setIsAddingSubcontract(false);
      setSubcontractFormData({
        orderId: '',
        orderName: '',
        orderScope: '',
        status: 'Active',
        defaultCostCodeId: '',
        defaultPhasingSource: 'Auto',
        defaultStartDate: projectPeriodDates.start,
        defaultEndDate: projectPeriodDates.end,
        defaultDistribution: 'Even',
        paymentType: 'LumpSum',
        awardDate: new Date().toISOString().split('T')[0],
        vendorId: '',
        vendorName: ''
      });
      toast.success('Subcontract added successfully.');
    } catch (error: any) {
      console.error('Error adding subcontract:', error);
      toast.error(`Failed to add subcontract: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedIds.size === 0) return;
    try {
      const patch: any = {};
      if (bulkUpdateData.status) patch.status = bulkUpdateData.status;
      if (bulkUpdateData.paymentType) patch.paymentType = bulkUpdateData.paymentType;
      if (bulkUpdateData.awardDate) patch.awardDate = bulkUpdateData.awardDate;
      // The vendor is a foreign key; its name lives on the vendor row.
      if (bulkUpdateData.vendorId) patch.vendorId = bulkUpdateData.vendorId;

      // One statement for every selected subcontract.
      const updated = await bulkUpdateSubcontracts(Array.from(selectedIds), patch);
      await reloadSubcontracts();
      toast.success(`Updated ${updated} subcontracts successfully.`);
      setIsBulkUpdating(false);
      setSelectedIds(new Set());
      setBulkUpdateData({});
    } catch (error: any) {
      console.error('Error bulk updating:', error);
      toast.error(`Failed to bulk update subcontracts: ${error?.message || 'Unknown error'}`);
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

        setImportPreview({ type: 'subcontracts', data });
      } catch (error) {
        console.error('Error reading import file:', error);
        toast.error('Failed to read the import file.');
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsBinaryString(file);
  };

  const completeImport = async () => {
    if (!importPreview) return;
    const { type, data } = importPreview;
    
    if (type === 'subcontracts') {
      try {
        const parsed = data
          .map(row => ({
            orderId: String(row['Order ID'] || row.orderId || row.ID || row.id || '').trim(),
            orderName: String(row['Order Name'] || row.orderName || row.Name || row.name || ''),
            vendorName: String(row['Vendor'] || row.vendorName || '').trim(),
            status: String(row['Status'] || row.status || 'Active'),
            paymentType: String(row['Payment Type'] || row.paymentType || 'LumpSum'),
            awardDate: String(row['Award Date'] || row.awardDate || new Date().toISOString().split('T')[0]),
          }))
          .filter(r => r.orderId);

        if (parsed.length === 0) {
          toast.error('No rows in the sheet carried an Order ID.');
          setImportPreview(null);
          return;
        }

        // The sheet names the vendor; the column is a foreign key. Each
        // distinct name is resolved once -- not once per row -- and an unknown
        // vendor is created on the enterprise.
        const vendorIdByName = new Map<string, string | null>();
        for (const name of new Set(parsed.map(r => r.vendorName).filter(Boolean))) {
          vendorIdByName.set(
            name.toLowerCase(),
            (enterprise.vendors || []).find(v => v.name.toLowerCase() === name.toLowerCase())?.id
              ?? await resolveVendorByName(enterprise.id, name)
          );
        }

        // Upsert on (project_id, order_id): a sheet row whose order number is
        // already in the project updates that subcontract instead of creating
        // a second one with the same reference.
        const imported = await importSubcontracts(project.id, parsed.map(r => ({
          orderId: r.orderId,
          orderName: r.orderName,
          status: r.status as any,
          paymentType: r.paymentType as any,
          awardDate: r.awardDate,
          vendorId: (r.vendorName ? vendorIdByName.get(r.vendorName.toLowerCase()) : null) || undefined,
          createdBy: user.uid,
        })));
        await reloadSubcontracts();
        toast.success(`Imported ${imported} subcontracts.`);
      } catch (error: any) {
        console.error('Error committing import:', error);
        toast.error(`Failed to commit import: ${error?.message || 'Unknown error'}`);
      }
    }
    setImportPreview(null);
  };

  const handleExport = () => {
    if (gridRef.current?.api) {
      gridRef.current.api.exportDataAsExcel({
        fileName: `${project.projectCode}_Subcontracts_${new Date().toISOString().split('T')[0]}.xlsx`
      });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      const ids = Array.from(selectedIds);
      // Line items and invoices cascade with the subcontract.
      await deleteSubcontracts(ids);
      await reloadSubcontracts();
      if (selectedSubcontractId && selectedIds.has(selectedSubcontractId)) setSelectedSubcontractId(null);
      setSelectedIds(new Set());
      setDeleteConfirm(null);
      toast.success(`Deleted ${ids.length} subcontracts.`);
    } catch (error: any) {
      console.error('Error bulk deleting:', error);
      toast.error(`Failed to delete subcontracts: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleDeleteSubcontract = async (id: string) => {
    try {
      await deleteSubcontracts([id]);
      await reloadSubcontracts();
      if (selectedSubcontractId === id) setSelectedSubcontractId(null);
      setDeleteConfirm(null);
      toast.success('Subcontract deleted.');
    } catch (error: any) {
      console.error('Error deleting subcontract:', error);
      toast.error(`Failed to delete subcontract: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleAddLineItem = async () => {
    if (!selectedSubcontractId || !selectedSubcontract) return;

    try {
      // Calculate next sequential item number
      let nextNum = 1;
      if (lineItems.length > 0) {
        const lastItem = lineItems[lineItems.length - 1];
        const lastNum = parseInt(lastItem.itemNo);
        nextNum = isNaN(lastNum) ? lineItems.length + 1 : lastNum + 1;
      }
      const itemNo = String(nextNum).padStart(3, '0');

      // One row. `total` is generated from qty x rate by the database, so it
      // is not sent, and the subcontract's total follows by trigger.
      await upsertLineItems(project.id, selectedSubcontractId, [{
        itemNo,
        description: 'New Line Item',
        qty: 0,
        unit: 'ea',
        rate: 0,
        type: 'Original',
        status: 'Approved',
        date: new Date().toISOString().split('T')[0],
        phasingSource: selectedSubcontract.defaultPhasingSource || 'Manual',
        startDate: selectedSubcontract.defaultStartDate || undefined,
        endDate: selectedSubcontract.defaultEndDate || undefined,
        distribution: selectedSubcontract.defaultDistribution || 'Even',
        sortOrder: lineItems.length,
      } as any]);

      await reloadLineItems();
      toast.success('Line item added.');
    } catch (error: any) {
      console.error('Error adding line item:', error);
      toast.error(`Failed to add line item: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleLineItemBulkDelete = async () => {
    if (!selectedSubcontractId || !selectedSubcontract || selectedLineItemIds.size === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedLineItemIds.size} selected line items?`)) return;

    try {
      const count = selectedLineItemIds.size;
      // One statement. The subcontract's total follows by trigger.
      await deleteLineItems(Array.from(selectedLineItemIds));
      await reloadLineItems();
      setSelectedLineItemIds(new Set());
      toast.success(`Deleted ${count} line items.`);
    } catch (error: any) {
      console.error('Error bulk deleting line items:', error);
      toast.error(`Failed to delete line items: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleLineItemBulkUpdate = async () => {
    if (!selectedSubcontractId || !selectedSubcontract || selectedLineItemIds.size === 0) return;

    try {
      // The dialog offers "set this value" and "clear it" (the CLEAR
      // sentinel). Setting merges into the stored map; clearing removes the
      // key. Both happen in one statement, against what is stored now rather
      // than against the copy this browser is holding.
      const split = (m?: Record<string, any>) => {
        const set: Record<string, string> = {};
        const clear: string[] = [];
        Object.entries(m || {}).forEach(([key, val]) => {
          if (val === 'CLEAR') clear.push(key);
          else if (val) set[key] = String(val);
        });
        return { set, clear };
      };
      const ent = split(lineItemBulkUpdateData.enterpriseAttributes);
      const prj = split(lineItemBulkUpdateData.projectAttributes);
      const usr = split(lineItemBulkUpdateData.userDefined);

      const updated = await bulkUpdateLineItems(Array.from(selectedLineItemIds), {
        costCodeId: lineItemBulkUpdateData.costCodeId || undefined,
        date: lineItemBulkUpdateData.date || undefined,
        startDate: lineItemBulkUpdateData.startDate || undefined,
        endDate: lineItemBulkUpdateData.endDate || undefined,
        phasingSource: lineItemBulkUpdateData.phasingSource || undefined,
        distribution: lineItemBulkUpdateData.distribution || undefined,
        type: lineItemBulkUpdateData.type || undefined,
        status: lineItemBulkUpdateData.status || undefined,
        enterpriseAttributes: ent.set,
        projectAttributes: prj.set,
        userDefined: usr.set,
        clearEnterpriseAttributes: ent.clear,
        clearProjectAttributes: prj.clear,
        clearUserDefined: usr.clear,
      });

      await reloadLineItems();
      setIsLineItemBulkUpdating(false);
      setSelectedLineItemIds(new Set());
      toast.success(`Updated ${updated} line items.`);
    } catch (error: any) {
      console.error('Error bulk updating line items:', error);
      toast.error(`Failed to update line items: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleLineItemExport = () => {
    if (!selectedSubcontract) return;
    const exportData = lineItems.map(li => ({
      'No.': li.itemNo,
      'Description': li.description,
      'Cost Code ID': li.costCodeId || '',
      'Date': li.date || '',
      'Type': li.type,
      'Status': li.status,
      'Qty': li.qty,
      'Unit': li.unit,
      'Rate': li.rate,
      'Total': li.total
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'LineItems');
    XLSX.writeFile(wb, `${selectedSubcontract.orderId}_LineItems.xlsx`);
  };

  const handleInvoiceExport = () => {
    if (!selectedSubcontractId) return;
    const exportData = selectedSubcontractInvoices.map(inv => ({
      'Invoice ID': inv.invoiceId,
      'Invoice Name': inv.description,
      'Submit Date': inv.submittedDate || '',
      'Approve Date': inv.certifiedDate || '',
      'Payment Date': inv.paymentDate || '',
      'Status': inv.status,
      'Claimed Amount': inv.totalAmount,
      'Certified Amount': inv.certifiedAmount
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Invoices');
    XLSX.writeFile(wb, `${selectedSubcontract?.orderId}_Invoices.xlsx`);
  };

  const handleLineItemImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedSubcontractId || !selectedSubcontract) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        const unknownCodes = new Set<string>();
        const rows: any[] = [];

        data.forEach((row: any) => {
          const itemNo = row['No.'] || row.itemNo || '';
          const description = row['Description'] || row.description || '';
          if (!description) return;

          // The sheet names a cost code; the column is a foreign key. A code
          // the project does not have is reported rather than written as-is.
          const codeText = String(row['Cost Code'] || row['Cost Code ID'] || row.costCodeId || '').trim();
          let costCodeId: string | undefined;
          if (codeText) {
            const resolved = costCodes.find(c => c.code === codeText || c.id === codeText);
            if (resolved) costCodeId = resolved.id;
            else unknownCodes.add(codeText);
          }

          rows.push({
            itemNo: String(itemNo),
            description: String(description),
            costCodeId,
            date: row['Date'] || row.date || dateToISO(new Date()),
            // qty and rate are the inputs; the database generates the total.
            qty: Number(row['Qty'] || row.qty) || 0,
            unit: String(row['Unit'] || row.unit || 'ea'),
            rate: Number(row['Rate'] || row.rate) || 0,
            type: (row['Type'] || row.type || 'Original'),
            status: (row['Status'] || row.status || 'Approved'),
            phasingSource: selectedSubcontract.defaultPhasingSource || 'Manual',
            startDate: selectedSubcontract.defaultStartDate || undefined,
            endDate: selectedSubcontract.defaultEndDate || undefined,
            distribution: selectedSubcontract.defaultDistribution || 'Even',
            sortOrder: rows.length,
          });
        });

        if (rows.length === 0) {
          toast.error('No rows in the sheet carried a description.');
          return;
        }

        // One statement, whatever the size of the sheet. Upsert on
        // (subcontract_id, item_no), so re-importing a corrected sheet updates
        // the items rather than duplicating them, and the subcontract's totals
        // follow by trigger.
        const imported = await upsertLineItems(project.id, selectedSubcontractId, rows);
        await reloadLineItems();
        toast.success(
          unknownCodes.size > 0
            ? `Imported ${imported} line items. Unknown cost codes left blank: ${Array.from(unknownCodes).join(', ')}`
            : `Imported ${imported} line items.`
        );
      } catch (error: any) {
        console.error('Error importing line items:', error);
        toast.error(`Failed to import line items: ${error?.message || 'Unknown error'}`);
      }
    };
    reader.readAsBinaryString(file);
  };

  const onLineItemCellValueChanged = async (event: CellValueChangedEvent) => {
    const { data, colDef, newValue, oldValue } = event;

    // Don't skip if oldValue is undefined, as it might be the first time setting it
    if (newValue === oldValue && oldValue !== undefined) return;
    if (!colDef.field || !selectedSubcontractId || !selectedSubcontract) return;

    const field = colDef.field;
    try {
      let value = (newValue instanceof Date) ? dateToISO(newValue) : newValue;

      if (field === 'costCodeId' && value) {
        // The column shows the cost CODE but holds the row id.
        const resolved = costCodes.find(c => c.code === String(value).trim() || c.id === value);
        if (!resolved) {
          toast.error(`Unknown cost code "${value}"`);
          await reloadLineItems();
          return;
        }
        value = resolved.id;
      }

      // The total is generated from qty x rate by the database, so there is
      // nothing to recompute here, and the subcontract's roll-ups follow by
      // trigger rather than being summed in the browser and written back.
      await applyLineItemCellEdit(data.id, field, value);
      await reloadLineItems();
    } catch (error: any) {
      console.error('Error updating line item:', error);
      toast.error(`Failed to update line item: ${error?.message || 'Unknown error'}`);
      await reloadLineItems();
    }
  };

  const handleAddInvoice = async () => {
    if (!selectedSubcontractId || !selectedSubcontract) return;

    try {
      const subInvoices = invoices.filter(i => i.subcontractId === selectedSubcontractId);
      let nextNum = 1;
      if (subInvoices.length > 0) {
        const ids = subInvoices.map(i => parseInt(i.invoiceId)).filter(n => !isNaN(n));
        if (ids.length > 0) nextNum = Math.max(...ids) + 1;
      }
      const invoiceRef = String(nextNum).padStart(3, '0');

      // The invoice and its items are created in the database, opening at what
      // has already been certified. This used to load every invoice on the
      // order with all of its items just to work out the opening position --
      // and it summed the cumulative certified figures across them, so each
      // new invoice opened higher than the work actually certified.
      const newId = await createInvoiceFromSubcontract(
        selectedSubcontractId,
        invoiceRef,
        `Invoice ${invoiceRef}`,
        user.displayName || user.email
      );
      await reloadInvoices();
      setSelectedInvoiceId(newId);
      toast.success('Invoice created.');
    } catch (error: any) {
      console.error('Error adding invoice:', error);
      toast.error(`Failed to add invoice: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleUpdateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInvoiceId) return;
    try {
      const { vendorName, ...fields } = invoiceFormData as any;
      await updateInvoice(editingInvoiceId, fields);
      await reloadInvoices();
      toast.success('Invoice updated.');
      setIsAddingInvoice(false);
      setEditingInvoiceId(null);
    } catch (error: any) {
      console.error('Error updating invoice:', error);
      toast.error(`Failed to update invoice: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleDeleteInvoice = async () => {
    if (!invoiceDeleteConfirm) return;
    try {
      // The invoice's items cascade.
      await deleteInvoices([invoiceDeleteConfirm]);
      await reloadInvoices();
      await reloadSubcontracts();
      toast.success('Invoice deleted.');
      if (selectedInvoiceId === invoiceDeleteConfirm) setSelectedInvoiceId(null);
      setInvoiceDeleteConfirm(null);
    } catch (error: any) {
      console.error('Error deleting invoice:', error);
      toast.error(`Failed to delete invoice: ${error?.message || 'Unknown error'}`);
    }
  };

  const onInvoiceCellValueChanged = async (event: CellValueChangedEvent) => {
    const { data, colDef, newValue, oldValue } = event;
    if (newValue === oldValue) return;
    if (!colDef.field) return;

    try {
      const valueToSave = (newValue instanceof Date) ? dateToISO(newValue) : newValue;
      await updateInvoice(data.id, { [colDef.field]: valueToSave } as any);
      await reloadInvoices();
    } catch (error: any) {
      console.error('Error updating invoice:', error);
      toast.error(`Failed to update invoice: ${error?.message || 'Unknown error'}`);
      await reloadInvoices();
    }
  };

  const onInvoiceLineItemCellValueChanged = async (event: CellValueChangedEvent) => {
    const { data, colDef, newValue, oldValue } = event;
    if (newValue === oldValue) return;
    if (!selectedInvoiceId || !colDef.field) return;

    const field = colDef.field;
    try {
      if (field === 'commentary') {
        await updateInvoiceItem(data.id, { commentary: newValue ?? '' } as any);
      } else {
        // Editing any one of the twelve claim / certification figures
        // determines the other eleven. That derivation lives in the database
        // now: it used to run in the browser, on a copy of the invoice this
        // tab happened to be holding, and rewrite the whole item array.
        await setInvoiceItemClaim(data.id, field, Number(newValue) || 0);
      }
      await reloadInvoiceItems();
      // The invoice's and the subcontract's totals follow by trigger.
      await reloadInvoices();
      event.api.refreshCells({ rowNodes: [event.node] });
    } catch (error: any) {
      console.error('Error updating invoice item:', error);
      toast.error(`Failed to update invoice item: ${error?.message || 'Unknown error'}`);
      await reloadInvoiceItems();
    }
  };

  const toggleAllLineItemColumnGroups = (opened: boolean) => {
    if (!lineItemsGridRef.current) return;
    const api = lineItemsGridRef.current.api;
    const groups = api.getColumnGroupState();
    const newState = groups.map(g => ({
      groupId: g.groupId,
      open: opened
    }));
    api.setColumnGroupState(newState);
  };

  // Claimed and certified per line item, from subcontract_line_item_claim_position.
  // Each invoice states the cumulative position, so the answer is the value on
  // the latest invoice that mentions the item; the view works that out. This
  // used to load every invoice in the project and walk them in date order.
  const lineItemInvoiceAggregates = claimPositions;

  const phasingHistogramData = useMemo(() => {
    if (!selectedSubcontract || !project.reportingPeriods?.periods) return [];
    
    const periods = project.reportingPeriods.periods;
    const currentPeriodId = project.reportingPeriods.currentPeriodId;
    const currentPeriodIndex = resolveCurrentPeriodIndex(periods, currentPeriodId);
    
    
    // Starting cumulative value is the sum of total claimed across all line items
    const initialClaimed = lineItems.reduce((sum, li) => {
      return sum + (lineItemInvoiceAggregates[li.id]?.claimed || 0);
    }, 0);
    
    let cumulative = initialClaimed;
    
    // Start from current period to show the baseline cumulative value
    const startIndex = Math.max(0, currentPeriodIndex);
    const relevantPeriods = periods.slice(startIndex);
    
    return relevantPeriods.map((p) => {
      const isPastOrCurrent = periods.indexOf(p) <= currentPeriodIndex;
      const periodValue = isPastOrCurrent ? 0 : lineItems.reduce((sum, li) => {
        return sum + (Number(li.periodValues?.[p.id]) || 0);
      }, 0);
      
      cumulative += periodValue;
      
      const date = new Date(p.endDate);
      const month = date.toLocaleString('default', { month: 'short' });
      const year = date.getFullYear().toString().slice(-2);
      const periodNumber = periods.findIndex(per => per.id === p.id) + 1;
      
      return {
        name: `P${periodNumber} (${month}'${year})`,
        periodic: Math.round(periodValue * 100) / 100,
        cumulative: Math.round(cumulative * 100) / 100
      };
    });
  }, [selectedSubcontract, project.reportingPeriods, lineItemInvoiceAggregates]);

  const invoiceColumnDefs = useMemo<ColDef[]>(() => [
    { 
      field: 'invoiceId', 
      headerName: 'Invoice ID', 
      width: 120,
      pinned: 'left',
      sort: 'asc',
      cellRenderer: (params: any) => (
        <button 
          onClick={(e) => {
            e.stopPropagation();
            setSelectedInvoiceId(params.data.id);
            setIsInvoicesCollapsed(false);
          }}
          className="font-mono font-bold text-green-600 dark:text-green-500 hover:underline hover:text-green-800 transition-colors text-left"
        >
          {params.value}
        </button>
      )
    },
    { field: 'description', headerName: 'Invoice Name', width: 250, editable: true },
    { 
      field: 'submittedDate', 
      headerName: 'Invoice Submit Date', 
      width: 150,
      editable: true,
      cellEditor: 'agDateCellEditor',
      valueGetter: params => params.data.submittedDate ? new Date(params.data.submittedDate) : null,
      valueSetter: params => {
        if (params.newValue instanceof Date) {
          params.data.submittedDate = dateToISO(params.newValue);
        } else {
          params.data.submittedDate = params.newValue;
        }
        return true;
      },
      valueFormatter: params => formatDate(params.value)
    },
    { 
      field: 'certifiedDate', 
      headerName: 'Invoice Approved Date', 
      width: 150,
      editable: true,
      cellEditor: 'agDateCellEditor',
      valueGetter: params => params.data.certifiedDate ? new Date(params.data.certifiedDate) : null,
      valueSetter: params => {
        if (params.newValue instanceof Date) {
          params.data.certifiedDate = dateToISO(params.newValue);
        } else {
          params.data.certifiedDate = params.newValue;
        }
        return true;
      },
      valueFormatter: params => formatDate(params.value)
    },
    {
      field: 'paymentDate',
      headerName: 'Invoice Payment Date',
      width: 150,
      editable: true,
      cellEditor: 'agDateCellEditor',
      valueGetter: params => params.data.paymentDate ? new Date(params.data.paymentDate) : null,
      valueSetter: params => {
        if (params.newValue instanceof Date) {
          params.data.paymentDate = dateToISO(params.newValue);
        } else {
          params.data.paymentDate = params.newValue;
        }
        return true;
      },
      valueFormatter: params => formatDate(params.value)
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: {
        values: ['Draft', 'Submitted', 'Certified', 'Rejected', 'Paid']
      },
      cellRenderer: (params: any) => (
        <span className={cn(
          "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest",
          params.value === 'Paid' ? "bg-green-100 text-green-700 font-bold" :
          params.value === 'Certified' ? "bg-blue-100 text-blue-700 font-bold" :
          params.value === 'Submitted' ? "bg-yellow-100 text-yellow-700 font-bold" :
          "bg-gray-100 text-gray-700 font-bold"
        )}>
          {params.value}
        </span>
      )
    },
    {
      field: 'totalAmount',
      headerName: 'Claimed Amount',
      width: 150,
      type: 'numericColumn',
      valueFormatter: params => formatCurrency(params.value)
    },
    {
      field: 'certifiedAmount',
      headerName: 'Certified Amount',
      width: 150,
      type: 'numericColumn',
      valueFormatter: params => formatCurrency(params.value)
    },
    {
      headerName: 'Variance',
      width: 150,
      type: 'numericColumn',
      valueGetter: params => (params.data?.certifiedAmount || 0) - (params.data?.totalAmount || 0),
      valueFormatter: params => formatCurrency(params.value),
      cellStyle: params => {
        if (params.value < -0.01) return { color: '#ef4444', fontWeight: 'bold' };
        if (params.value > 0.01) return { color: '#10b981', fontWeight: 'bold' };
        return null;
      }
    },
    {
      headerName: 'Actions',
      width: 100,
      pinned: 'right',
      cellRenderer: InvoiceActionsCellRenderer,
      cellRendererParams: {
        setSelectedInvoiceId,
        setEditingInvoiceId,
        setIsAddingInvoice,
        setInvoiceFormData,
        setInvoiceDeleteConfirm
      }
    }
  ], [
    setSelectedInvoiceId,
    setEditingInvoiceId,
    setIsAddingInvoice,
    setInvoiceFormData,
    setInvoiceDeleteConfirm
  ]);

  const invoiceLineItemColumnDefs = useMemo<ColDef[]>(() => [
    { field: 'itemNo', headerName: 'No.', width: 80, pinned: 'left', sort: 'asc' },
    { 
      field: 'description', 
      headerName: 'Description', 
      width: 250, 
      pinned: 'left',
      cellRenderer: (params: any) => {
        if (params.node.rowPinned === 'top') {
          return <span className="font-bold text-blue-600 dark:text-blue-400">{params.value}</span>;
        }
        return params.value;
      }
    },
    {
      headerName: 'Contract Reference',
      openByDefault: true,
      children: [
        { 
          field: 'qty', 
          headerName: 'Qty', 
          width: 100, 
          type: 'numericColumn',
          editable: false,
          cellRenderer: (params: any) => params.node.rowPinned === 'top' ? null : params.value
        },
        { 
          field: 'unit', 
          headerName: 'Unit', 
          width: 80,
          editable: false,
          cellRenderer: (params: any) => params.node.rowPinned === 'top' ? null : params.value
        },
        { 
          field: 'rate', 
          headerName: 'Rate', 
          width: 100, 
          type: 'numericColumn',
          editable: false,
          cellRenderer: (params: any) => params.node.rowPinned === 'top' ? null : formatCurrency(params.value)
        },
        { 
          field: 'total', 
          headerName: 'Total', 
          width: 130, 
          type: 'numericColumn',
          editable: false,
          valueGetter: params => {
            if (!params.data) return 0;
            if (params.node?.rowPinned === 'top') return params.data.total;
            return (params.data.qty || 0) * (params.data.rate || 0);
          },
          valueFormatter: params => formatCurrency(params.value),
          cellStyle: (params: any) => {
            if (params.node.rowPinned === 'top') {
              return { color: '#2563eb', fontWeight: 'bold' };
            }
            return null;
          }
        }
      ]
    },
    { 
      headerName: 'Claimed Amount',
      openByDefault: true,
      children: [
        {
          headerName: 'This Period',
          children: [
            { 
              field: 'periodicClaimQty', 
              headerName: 'Qty', 
              width: 100, 
              type: 'numericColumn', 
              editable: entryMethod === 'Periodic',
              cellClass: entryMethod === 'Periodic' ? 'bg-green-50/30' : 'bg-gray-100 dark:bg-white/5 opacity-60',
              valueFormatter: params => params.value?.toFixed(2),
              cellRenderer: (params: any) => params.node.rowPinned === 'top' ? null : params.value
            },
            { 
              field: 'periodicClaimPercent', 
              headerName: '%', 
              width: 80, 
              type: 'numericColumn', 
              editable: entryMethod === 'Periodic',
              cellClass: entryMethod === 'Periodic' ? 'bg-green-50/30' : 'bg-gray-100 dark:bg-white/5 opacity-60',
              valueFormatter: params => params.value ? `${params.value.toFixed(2)}%` : '0.00%',
              cellRenderer: (params: any) => params.node.rowPinned === 'top' ? null : params.value
            },
            { 
              field: 'periodicClaimValue', 
              headerName: 'Value', 
              width: 120, 
              type: 'numericColumn', 
              editable: entryMethod === 'Periodic',
              cellClass: (params: any) => {
                const baseClass = entryMethod === 'Periodic' ? 'bg-green-50/30' : 'bg-gray-100 dark:bg-white/5 opacity-60';
                return baseClass;
              },
              valueFormatter: params => formatCurrency(params.value),
              cellStyle: (params: any) => {
                if (params.node.rowPinned === 'top') return { color: '#2563eb', fontWeight: 'bold' };
                return null;
              }
            }
          ]
        },
        { 
          headerName: 'Cumulative to Date',
          children: [
            { 
              field: 'claimQty', 
              headerName: 'Qty', 
              width: 100, 
              type: 'numericColumn', 
              editable: entryMethod === 'Cumulative',
              cellClass: entryMethod === 'Cumulative' ? 'bg-blue-50/30' : 'bg-gray-100 dark:bg-white/5 opacity-60',
              valueFormatter: params => params.value?.toFixed(2),
              cellRenderer: (params: any) => params.node.rowPinned === 'top' ? null : params.value
            },
            { 
              field: 'claimPercent', 
              headerName: '%', 
              width: 80, 
              type: 'numericColumn', 
              editable: entryMethod === 'Cumulative',
              cellClass: entryMethod === 'Cumulative' ? 'bg-blue-50/30' : 'bg-gray-100 dark:bg-white/5 opacity-60',
              valueFormatter: params => params.value ? `${params.value.toFixed(2)}%` : '0.00%',
              cellRenderer: (params: any) => params.node.rowPinned === 'top' ? null : params.value
            },
            { 
              field: 'claimValue', 
              headerName: 'Value', 
              width: 130, 
              type: 'numericColumn', 
              editable: entryMethod === 'Cumulative',
              cellClass: (params: any) => {
                const baseClass = entryMethod === 'Cumulative' ? 'bg-blue-50/30' : 'bg-gray-100 dark:bg-white/5 opacity-60';
                return `${baseClass} font-bold`;
              },
              valueFormatter: params => formatCurrency(params.value),
            cellStyle: (params: any) => {
              if (params.node.rowPinned === 'top') {
                return { color: '#2563eb', fontWeight: 'bold' };
              }
              const contractTotal = (params.data.qty || 0) * (params.data.rate || 0);
              if (contractTotal > 0 && (params.value || 0) > contractTotal + 0.01) {
                return { color: '#ef4444', fontWeight: 'bold' }; // Red-500
              }
              return null;
            }
            }
          ]
        }
      ]
    },
    { 
      headerName: 'Certified Amount',
      openByDefault: true,
      children: [
        {
          headerName: 'This Period',
          children: [
            { 
              field: 'periodicCertifiedQty', 
              headerName: 'Qty', 
              width: 100, 
              type: 'numericColumn', 
              editable: entryMethod === 'Periodic',
              cellClass: entryMethod === 'Periodic' ? 'bg-green-50/30' : 'bg-gray-100 dark:bg-white/5 opacity-60',
              valueFormatter: params => params.value?.toFixed(2),
              cellRenderer: (params: any) => params.node.rowPinned === 'top' ? null : params.value
            },
            { 
              field: 'periodicCertifiedPercent', 
              headerName: '%', 
              width: 80, 
              type: 'numericColumn', 
              editable: entryMethod === 'Periodic',
              cellClass: entryMethod === 'Periodic' ? 'bg-green-50/30' : 'bg-gray-100 dark:bg-white/5 opacity-60',
              valueFormatter: params => params.value ? `${params.value.toFixed(2)}%` : '0.00%',
              cellRenderer: (params: any) => params.node.rowPinned === 'top' ? null : params.value
            },
            { 
              field: 'periodicCertifiedValue', 
              headerName: 'Value', 
              width: 120, 
              type: 'numericColumn', 
              editable: entryMethod === 'Periodic',
              cellClass: (params: any) => {
                const baseClass = entryMethod === 'Periodic' ? 'bg-green-50/30' : 'bg-gray-100 dark:bg-white/5 opacity-60';
                return baseClass;
              },
              valueFormatter: params => formatCurrency(params.value),
              cellStyle: (params: any) => {
                if (params.node.rowPinned === 'top') return { color: '#2563eb', fontWeight: 'bold' };
                return null;
              }
            }
          ]
        },
        { 
          headerName: 'Cumulative to Date',
          children: [
            { 
              field: 'certifiedQty', 
              headerName: 'Qty', 
              width: 100, 
              type: 'numericColumn', 
              editable: entryMethod === 'Cumulative',
              cellClass: entryMethod === 'Cumulative' ? 'bg-blue-50/30' : 'bg-gray-100 dark:bg-white/5 opacity-60',
              valueFormatter: params => params.value?.toFixed(2),
              cellRenderer: (params: any) => params.node.rowPinned === 'top' ? null : params.value
            },
            { 
              field: 'certifiedPercent', 
              headerName: '%', 
              width: 80, 
              type: 'numericColumn', 
              editable: entryMethod === 'Cumulative',
              cellClass: entryMethod === 'Cumulative' ? 'bg-blue-50/30' : 'bg-gray-100 dark:bg-white/5 opacity-60',
              valueFormatter: params => params.value ? `${params.value.toFixed(2)}%` : '0.00%',
              cellRenderer: (params: any) => params.node.rowPinned === 'top' ? null : params.value
            },
            { 
              field: 'certifiedValue', 
              headerName: 'Value', 
              width: 130, 
              type: 'numericColumn', 
              editable: entryMethod === 'Cumulative',
              cellClass: (params: any) => {
                const baseClass = entryMethod === 'Cumulative' ? 'bg-blue-50/30' : 'bg-gray-100 dark:bg-white/5 opacity-60';
                return `${baseClass} font-bold`;
              },
              valueFormatter: params => formatCurrency(params.value),
              cellStyle: (params: any) => {
                if (params.node.rowPinned === 'top') return { color: '#2563eb', fontWeight: 'bold' };
                // Red if certified > contract total
                const contractTotal = (params.data.qty || 0) * (params.data.rate || 0);
                if (contractTotal > 0 && (params.value || 0) > contractTotal + 0.01) {
                  return { color: '#ef4444', fontWeight: 'bold' };
                }
                return null;
              }
            }
          ]
        }
      ]
    },
    { 
      headerName: 'Variance', 
      field: 'variance',
      width: 130,
      type: 'numericColumn',
      valueGetter: params => {
        if (!params.data) return 0;
        return (params.data.certifiedValue || 0) - (params.data.claimValue || 0);
      },
      valueFormatter: params => formatCurrency(params.value),
      cellStyle: params => {
        if (params.node.rowPinned === 'top') return { color: '#2563eb', fontWeight: 'bold' };
        if ((params.value || 0) < -0.01) { // Certified < Claimed
          return { color: '#f97316' }; // Orange-500
        }
        return null;
      }
    },
    {
      headerName: 'Commentary',
      field: 'commentary',
      width: 250,
      editable: (params: any) => params.node.rowPinned !== 'top',
      cellEditor: 'agLargeTextCellEditor',
      cellEditorParams: {
        maxLength: 500
      }
    }
  ], [entryMethod]);

  const handleCalculateLineItemAutoPhasing = async () => {
    if (!selectedSubcontractId || !selectedSubcontract) return;

    const selectedRows = (lineItemsGridRef.current?.api.getSelectedNodes() || []).map(n => n.data);
    const scoped = selectedRows.length > 0;
    const autoRows = (scoped ? selectedRows : lineItems).filter(r => r?.phasingSource === 'Auto');

    if (autoRows.length === 0) {
      toast.info(scoped
        ? "Selected items are not set to 'Auto' phasing source."
        : "No line items set to 'Auto' phasing source.");
      return;
    }

    const toastId = toast.loading('Calculating phasing...');
    try {
      // The whole calculation is one statement in the database: which periods
      // each item's dates touch, the weight per period for its distribution
      // curve, and the value still to claim. It used to run in the browser and
      // rewrite every line item on the order for one button press.
      const phased = await applyLineItemPhasing(
        selectedSubcontractId,
        scoped ? autoRows.map(r => r.id) : undefined
      );
      await reloadLineItems();
      toast.success(`Recalculated phasing for ${phased} line item(s).`, { id: toastId });
    } catch (error: any) {
      toast.dismiss(toastId);
      console.error('Error calculating auto phasing:', error);
      toast.error(`Failed to calculate auto phasing: ${error?.message || 'Unknown error'}`);
    }
  };

  const lineItemColumnDefs = useMemo<any[]>(() => {
    const sortedCostCodes = [...costCodes].sort((a, b) => a.code.localeCompare(b.code));
    const periods = project.reportingPeriods?.periods || [];
    const currentPeriodId = project.reportingPeriods?.currentPeriodId;
    const currentPeriodIndex = resolveCurrentPeriodIndex(periods, currentPeriodId);

    const defs: any[] = [
      {
        headerName: 'Item Details',
        pinned: 'left',
        openByDefault: true,
        children: [
          { 
            field: 'itemNo', 
            headerName: 'No.', 
            width: 80, 
            pinned: 'left', 
            editable: false,
            sort: 'asc',
            checkboxSelection: true,
            headerCheckboxSelection: true,
            cellRenderer: (params: any) => {
              if (params.node.rowPinned === 'top') return null;
              return params.value;
            }
          },
          { 
            field: 'description', 
            headerName: 'Description', 
            width: 250, 
            pinned: 'left', 
            editable: (params: any) => params.node.rowPinned !== 'top',
            cellRenderer: (params: any) => {
              if (params.node.rowPinned === 'top') {
                return <span className="font-bold text-blue-600 dark:text-blue-400">SubTotal</span>;
              }
              return params.value;
            }
          },
          {
            field: 'costCodeId',
            headerName: 'Cost Code ID',
            width: 180,
            columnGroupShow: 'open',
            editable: (params: any) => params.node.rowPinned !== 'top',
            valueGetter: params => {
              if (params.node.rowPinned === 'top') return null;
              return params.data.costCodeId || selectedSubcontract?.defaultCostCodeId;
            },
            valueFormatter: params => {
              const val = params.value;
              const code = sortedCostCodes.find(c => c.code === val);
              return code ? `${code.code} - ${code.name}` : val;
            },
            cellStyle: params => {
              if (params.node.rowPinned === 'top') return null;
              if (!params.data.costCodeId && selectedSubcontract?.defaultCostCodeId) {
                return { fontStyle: 'italic', color: '#6b7280' }; // Gray-500 italic
              }
              return null;
            },
            cellEditor: 'agRichSelectCellEditor',
            cellEditorParams: {
              values: sortedCostCodes.map(c => c.code),
              formatValue: (val: string) => {
                const code = sortedCostCodes.find(c => c.code === val);
                return code ? `${code.code} - ${code.name}` : val;
              },
              searchType: 'match',
              allowTyping: true,
              filterList: true,
              highlightMatch: true
            }
          },
          {
            field: 'date',
            headerName: 'Date',
            width: 120,
            columnGroupShow: 'open',
            editable: (params: any) => params.node.rowPinned !== 'top',
            cellEditor: 'agDateCellEditor',
            valueGetter: params => params.data.date ? new Date(params.data.date) : null,
            valueSetter: params => {
              if (params.newValue instanceof Date) {
                params.data.date = dateToISO(params.newValue);
              } else {
                params.data.date = params.newValue;
              }
              return true;
            },
            valueFormatter: params => params.node.rowPinned === 'top' ? '' : formatDate(params.value)
          }
        ]
      },
      // Pricing
      {
        headerName: 'Pricing',
        pinned: 'left',
        openByDefault: true,
        children: [
          { 
            field: 'qty', 
            headerName: 'Qty', 
            width: 100, 
            type: 'numericColumn', 
            editable: (params: any) => params.node.rowPinned !== 'top',
            cellRenderer: (params: any) => {
              if (params.node.rowPinned === 'top') return null;
              return params.value;
            }
          },
          { 
            field: 'unit', 
            headerName: 'Unit', 
            width: 80, 
            editable: (params: any) => params.node.rowPinned !== 'top',
            cellRenderer: (params: any) => {
              if (params.node.rowPinned === 'top') return null;
              return params.value;
            }
          },
          { 
            field: 'rate', 
            headerName: 'Rate', 
            width: 120, 
            type: 'numericColumn', 
            editable: (params: any) => params.node.rowPinned !== 'top', 
            valueFormatter: params => params.node?.rowPinned === 'top' ? '' : formatCurrency(params.value) 
          },
          { 
            field: 'total', 
            headerName: 'Total', 
            width: 130, 
            type: 'numericColumn',
            valueGetter: params => {
              if (!params.data) return 0;
              if (params.node?.rowPinned === 'top') return params.data.total;
              return (params.data.qty || 0) * (params.data.rate || 0);
            },
            valueFormatter: params => formatCurrency(params.value),
            cellClass: 'font-bold',
            cellStyle: (params: any) => {
              if (params.node?.rowPinned === 'top') {
                return { color: '#2563eb', fontWeight: 'bold' };
              }
              const totalContract = params.data.total || 0;
              const claimed = lineItemInvoiceAggregates[params.data.id]?.claimed || 0;
              const certified = lineItemInvoiceAggregates[params.data.id]?.certified || 0;
              if (totalContract > 0 && (claimed > totalContract + 0.01 || certified > totalContract + 0.01)) {
                return { color: '#ef4444', fontWeight: 'bold' }; 
              }
              return null;
            }
          },
          {
            headerName: 'Claimed Total',
            field: 'claimedTotal',
            width: 130,
            type: 'numericColumn',
            valueGetter: params => {
              if (params.node?.rowPinned === 'top') return params.data.claimedTotal;
              if (!params.data) return 0;
              return lineItemInvoiceAggregates[params.data.id]?.claimed || 0;
            },
            valueFormatter: params => formatCurrency(params.value),
            cellClass: 'text-blue-600 dark:text-blue-400 font-medium'
          },
          {
            headerName: 'Certified Total',
            field: 'certifiedTotal',
            width: 130,
            type: 'numericColumn',
            valueGetter: params => {
              if (params.node?.rowPinned === 'top') return params.data.certifiedTotal;
              if (!params.data) return 0;
              return lineItemInvoiceAggregates[params.data.id]?.certified || 0;
            },
            valueFormatter: params => formatCurrency(params.value),
            cellClass: 'font-medium'
          },
          {
            headerName: 'Variance',
            width: 130,
            type: 'numericColumn',
            valueGetter: params => {
              if (params.node?.rowPinned === 'top') return (params.data?.certifiedTotal || 0) - (params.data?.claimedTotal || 0);
              const claimed = lineItemInvoiceAggregates[params.data?.id]?.claimed || 0;
              const certified = lineItemInvoiceAggregates[params.data?.id]?.certified || 0;
              return certified - claimed;
            },
            valueFormatter: params => formatCurrency(params.value),
            cellStyle: params => {
              if (params.value < -0.01) return { color: '#ef4444', fontWeight: 'bold' };
              if (params.value > 0.01) return { color: '#10b981', fontWeight: 'bold' };
              return null;
            }
          }
        ]
      },
      // Note
      {
        headerName: 'Commentary',
        openByDefault: true,
        children: [
          {
            field: 'note',
            headerName: 'Note',
            width: 300,
            editable: (params: any) => params.node.rowPinned !== 'top',
            cellEditor: 'agLargeTextCellEditor',
            cellEditorParams: {
              maxLength: 1000
            }
          }
        ]
      },
      {
        headerName: 'Status',
        openByDefault: true,
        children: [
          { 
            field: 'type', 
            headerName: 'Type', 
            width: 140, 
            editable: (params: any) => params.node.rowPinned !== 'top',
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: {
              values: ['Original', 'ChangeOrder']
            },
            cellRenderer: (params: any) => {
              if (params.node.rowPinned === 'top') return null;
              return (
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest",
                  params.value === 'Original' ? "bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-gray-400" :
                  "bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400"
                )}>
                  {params.value}
                </span>
              );
            }
          },
          { 
            field: 'status', 
            headerName: 'Status', 
            width: 140, 
            editable: (params: any) => params.node.rowPinned !== 'top',
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: {
              values: ['Approved', 'Pending', 'Forecast', 'Rejected']
            },
            cellRenderer: (params: any) => {
              if (params.node.rowPinned === 'top') return null;
              return (
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest",
                  params.value === 'Approved' ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400" :
                  params.value === 'Pending' ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400" :
                  params.value === 'Forecast' ? "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400" :
                  "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400"
                )}>
                  {params.value}
                </span>
              );
            }
          }
        ]
      }
    ];

    // Helper for nested value setting
    const nestedValueSetter = (params: any) => {
      const field = params.colDef.field;
      if (!field) return false;
      const parts = field.split('.');
      let current = params.data;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current[part]) current[part] = {};
        current = current[part];
      }
      current[parts[parts.length - 1]] = params.newValue;
      return true;
    };

    // Enterprise Attributes
    const enterpriseLineItemAttrs = (enterprise.lineItemAttributes || []).filter(attr => attr.title && attr.title.trim() !== '');
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
          cellEditor: 'agRichSelectCellEditor',
          cellEditorParams: {
            values: attr.values.map(v => v.id),
            formatValue: (id: string) => {
              if (!id) return '';
              const match = attr.values?.find(v => v.id === id);
              return match ? `${match.id} - ${match.description}` : id;
            },
            searchType: 'match',
            allowTyping: true,
            filterList: true
          },
          valueSetter: nestedValueSetter,
          valueFormatter: (params: any) => {
            const v = attr.values.find(v => v.id === params.value);
            return v ? `${v.id} - ${v.description}` : params.value;
          }
        }))
      });
    }

    // Project Attributes
    const projectLineItemAttrs = (project.lineItemAttributes || []).filter(attr => attr.title && attr.title.trim() !== '');
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
          cellEditor: 'agRichSelectCellEditor',
          cellEditorParams: {
            values: attr.values.map(v => v.id),
            formatValue: (id: string) => {
              if (!id) return '';
              const match = attr.values?.find(v => v.id === id);
              return match ? `${match.id} - ${match.description}` : id;
            },
            searchType: 'match',
            allowTyping: true,
            filterList: true
          },
          valueSetter: nestedValueSetter,
          valueFormatter: (params: any) => {
            const v = attr.values.find(v => v.id === params.value);
            return v ? `${v.id} - ${v.description}` : params.value;
          }
        }))
      });
    }

    // User Defined
    defs.push({
      headerName: 'User Defined',
      openByDefault: true,
      children: [
        ...Array.from({ length: 5 }).map((_, i) => ({
          headerName: `Numeric ${i + 1}`,
          field: `userDefined.num${i + 1}`,
          width: 120,
          type: 'numericColumn',
          columnGroupShow: i === 0 ? undefined : 'open',
          editable: (params: any) => params.node.rowPinned !== 'top',
          valueParser: (params: any) => {
            const val = Number(params.newValue);
            return isNaN(val) ? 0 : val;
          },
          valueSetter: nestedValueSetter
        })),
        ...Array.from({ length: 5 }).map((_, i) => ({
          headerName: `Text ${i + 1}`,
          field: `userDefined.text${i + 1}`,
          width: 150,
          columnGroupShow: 'open',
          editable: (params: any) => params.node.rowPinned !== 'top',
          valueSetter: nestedValueSetter
        }))
      ]
    });

    // Timephasing Consolidated Group
    defs.push({
      headerName: 'Timephasing',
      openByDefault: true,
      children: [
        {
          headerName: 'Phasing Source',
          field: 'phasingSource',
          width: 130,
          editable: (params: any) => params.node.rowPinned !== 'top',
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: { values: ['Manual', 'Auto'] },
          cellStyle: (params: any) => params.node.rowPinned === 'top' ? null : { backgroundColor: 'rgba(255, 237, 213, 0.3)' } // subtle orange
        },
        {
          headerName: 'Start Date',
          field: 'startDate',
          width: 120,
          editable: (params: any) => params.node.rowPinned !== 'top',
          cellEditor: 'agDateCellEditor',
          valueGetter: params => params.data.startDate ? new Date(params.data.startDate) : null,
          valueSetter: params => {
            if (params.newValue instanceof Date) {
              params.data.startDate = dateToISO(params.newValue);
            } else {
              params.data.startDate = params.newValue;
            }
            return true;
          },
          valueFormatter: params => params.node.rowPinned === 'top' ? '' : formatDate(params.value)
        },
        {
          headerName: 'End Date',
          field: 'endDate',
          width: 120,
          editable: (params: any) => params.node.rowPinned !== 'top',
          cellEditor: 'agDateCellEditor',
          valueGetter: params => params.data.endDate ? new Date(params.data.endDate) : null,
          valueSetter: params => {
            if (params.newValue instanceof Date) {
              params.data.endDate = dateToISO(params.newValue);
            } else {
              params.data.endDate = params.newValue;
            }
            return true;
          },
          valueFormatter: params => params.node.rowPinned === 'top' ? '' : formatDate(params.value)
        },
        {
          headerName: 'Distribution',
          field: 'distribution',
          width: 130,
          editable: (params: any) => params.data.phasingSource === 'Auto' && params.node.rowPinned !== 'top',
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: {
            values: ['Even', 'Bell Curve', 'Front load', 'Back load', 'S-Curve', 'Profile']
          },
        },
        {
          headerName: 'Remaining to Claim',
          width: 150,
          type: 'numericColumn',
          valueGetter: params => {
            if (params.node?.rowPinned === 'top') return (params.data?.total || 0) - (params.data?.claimedTotal || 0);
            const total = (params.data.qty || 0) * (params.data.rate || 0);
            const claimed = lineItemInvoiceAggregates[params.data.id]?.claimed || 0;
            return Math.max(0, total - claimed);
          },
          valueFormatter: params => formatCurrency(params.value),
          cellClass: 'font-bold bg-slate-50 dark:bg-slate-900',
        },
        {
          headerName: 'Total Phased',
          width: 130,
          type: 'numericColumn',
          valueFormatter: params => formatCurrency(params.value),
          valueGetter: (params) => {
            if (params.node?.rowPinned === 'top') return params.data.totalPhased;
            if (!params.data?.periodValues) return 0;
            // Only sum up values for future periods
            return periods.filter((_, idx) => idx > currentPeriodIndex).reduce((acc, p) => acc + (Number(params.data.periodValues?.[p.id]) || 0), 0);
          },
          cellClass: 'font-bold bg-slate-100 dark:bg-slate-800',
        },
        {
          headerName: 'Variance',
          width: 130,
          type: 'numericColumn',
          valueFormatter: params => formatCurrency(params.value),
          valueGetter: (params) => {
            const totalPhased = params.node?.rowPinned === 'top' ? (params.data.totalPhased || 0) : (periods.filter((_, idx) => idx > currentPeriodIndex).reduce((acc, p) => acc + (Number(params.data.periodValues?.[p.id]) || 0), 0));
            const totalRemaining = params.node?.rowPinned === 'top' ? ((params.data?.total || 0) - (params.data?.claimedTotal || 0)) : (Math.max(0, (params.data.qty || 0) * (params.data.rate || 0) - (lineItemInvoiceAggregates[params.data.id]?.claimed || 0)));
            return totalPhased - totalRemaining;
          },
          cellStyle: params => {
            if (Math.abs(params.value) > 0.01) return { color: '#ef4444', fontWeight: 'bold' };
            return { color: '#10b981', fontWeight: 'bold' };
          }
        },
        // Month columns inside the same group
        ...periods.map(p => {
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
            columnGroupShow: 'open',
            minWidth: 110,
            type: 'numericColumn',
            hide: periodIndex <= currentPeriodIndex,
            valueGetter: (params: any) => {
              if (periodIndex <= currentPeriodIndex && params.node?.rowPinned !== 'top') return 0;
              if (params.node?.rowPinned === 'top') {
                return lineItems.reduce((sum, li) => sum + (li.periodValues?.[p.id] || 0), 0);
              }
              return params.data.periodValues?.[p.id] || 0;
            },
            valueFormatter: (params: any) => formatCurrency(params.value),
            editable: (params: any) => {
              if (params.node.rowPinned === 'top') return false;
              return params.data.phasingSource === 'Manual' && periodIndex > currentPeriodIndex;
            },
            cellClass: (params: any) => {
              if (params.node.rowPinned === 'top') return 'bg-blue-50 dark:bg-blue-900/20 font-bold';
              const isEditable = params.data.phasingSource === 'Manual' && periodIndex > currentPeriodIndex;
              return isEditable ? 'bg-white dark:bg-slate-900' : 'bg-slate-50 dark:bg-slate-900/50 text-gray-500';
            },
            valueSetter: (params: any) => {
              const val = Number(params.newValue);
              if (isNaN(val)) return false;
              params.data.periodValues = { ...params.data.periodValues, [p.id]: val };
              return true;
            }
          };
        })
      ]
    });

    // Actions
    defs.push({
      headerName: '',
      width: 60,
      pinned: 'right',
      cellRenderer: (params: ICellRendererParams) => {
        if (params.node.rowPinned) return null;
        return (
          <button 
            onClick={async () => {
              if (!window.confirm('Delete this line item?')) return;
              try {
                // One row. The subcontract's total follows by trigger.
                await deleteLineItems([params.data.id]);
                await reloadLineItems();
                toast.success('Line item deleted.');
              } catch (error: any) {
                console.error('Error deleting line item:', error);
                toast.error(`Failed to delete line item: ${error?.message || 'Unknown error'}`);
              }
            }}
            className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        );
      }
    });

    return defs;
  }, [selectedSubcontractId, selectedSubcontract, costCodes, enterprise, project]);

  const lineItemPinnedTopRowData = useMemo(() => {
    if (!selectedSubcontract) return [];
    
    const periods = project.reportingPeriods?.periods || [];
    const currentPeriodId = project.reportingPeriods?.currentPeriodId;
    const currentPeriodIndex = resolveCurrentPeriodIndex(periods, currentPeriodId);

    const totalContract = lineItems.reduce((sum, li) => sum + (li.total || 0), 0);
    const totalClaimed = lineItems.reduce((sum, li) => sum + (lineItemInvoiceAggregates[li.id]?.claimed || 0), 0);
    const totalCertified = lineItems.reduce((sum, li) => sum + (lineItemInvoiceAggregates[li.id]?.certified || 0), 0);
    
    return [{
      id: 'subtotal',
      description: 'SUB-TOTAL',
      total: totalContract,
      claimedTotal: totalClaimed,
      certifiedTotal: totalCertified,
      totalPhased: lineItems.reduce((sum, li) => {
        return sum + periods.filter((_, idx) => idx > currentPeriodIndex).reduce((s, p) => s + (Number(li.periodValues?.[p.id]) || 0), 0);
      }, 0)
    }];
  }, [selectedSubcontract, lineItemInvoiceAggregates, project.reportingPeriods]);

  const { duplicateIds, hasImportDuplicates } = useMemo(() => {
    if (!importPreview) return { duplicateIds: [], hasImportDuplicates: false };
    
    const idsInFile = new Set<string>();
    const fileDuplicates = new Set<string>();
    
    importPreview.data.forEach(row => {
      const id = row['Order ID'] || row.orderId || row.ID || row.id;
      if (id) {
        const normalizedId = id.toString().trim().toLowerCase();
        if (idsInFile.has(normalizedId)) {
          fileDuplicates.add(id.toString().trim());
        }
        idsInFile.add(normalizedId);
      }
    });

    const duplicateList = Array.from(fileDuplicates);
    return { 
      duplicateIds: duplicateList, 
      hasImportDuplicates: duplicateList.length > 0 
    };
  }, [importPreview]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden">
      {/* Toolbar */}
      <div className="p-6 border-b border-gray-100 dark:border-white/10 flex justify-between items-center bg-gray-50/50 dark:bg-white/5 shrink-0">
        <div className="flex items-center gap-6">
          <div>
            <h3 className="text-xl font-bold dark:text-white">Sub-Contract Management</h3>
            <p className="text-sm text-gray-900 dark:text-gray-400">Manage project subcontracts, vendors, and line items.</p>
          </div>
          
          {project.reportingPeriods?.currentPeriodId && (
            <div className="flex flex-col border-l border-gray-200 dark:border-white/10 pl-6">
              <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-1">Current Period</span>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-semibold dark:text-white">
                  {project.reportingPeriods.periods.find(p => p.id === project.reportingPeriods?.currentPeriodId)?.name || 'Period'}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  ({project.reportingPeriods.periods.find(p => p.id === project.reportingPeriods?.currentPeriodId) ? 
                    `${formatDate(project.reportingPeriods.periods.find(p => p.id === project.reportingPeriods?.currentPeriodId)!.startDate)} - ${formatDate(project.reportingPeriods.periods.find(p => p.id === project.reportingPeriods?.currentPeriodId)!.endDate)}` 
                  : ''})
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              type="text"
              placeholder="Search subcontracts..."
              value={quickFilterText}
              onChange={(e) => {
                setQuickFilterText(e.target.value);
                gridRef.current?.api.setGridOption('quickFilterText', e.target.value);
              }}
              className="pl-10 pr-4 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none w-64 dark:text-white"
            />
          </div>
          
          <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />

          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImport} 
            className="hidden" 
            accept=".xlsx,.xls" 
          />
          <button 
            onClick={() => fileInputRef.current?.click()} 
            className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" 
            title="Import"
          >
            <Upload className="w-5 h-5" />
          </button>
          <button 
            onClick={handleExport} 
            className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" 
            title="Export"
          >
            <Download className="w-5 h-5" />
          </button>

          {selectedIds.size > 0 && (
            <div className="flex gap-2">
              <Button 
                variant="outline"
                onClick={() => setIsBulkUpdating(true)}
                className="px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 border-blue-200 text-blue-600 hover:bg-blue-50"
              >
                <Edit2 className="w-3.5 h-3.5" />
                Bulk Update ({selectedIds.size})
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => setDeleteConfirm({ type: 'bulk', count: selectedIds.size })}
                className="px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete ({selectedIds.size})
              </Button>
            </div>
          )}

          <Button 
            onClick={() => setIsAddingSubcontract(true)}
            className="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-xl text-sm font-bold flex items-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-black/10"
          >
            <Plus className="w-4 h-4" />
            + Add
          </Button>
        </div>
      </div>

      {/* Main Content - Top/Bottom Split */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Table: Subcontracts */}
        <div className={cn(
          "flex flex-col transition-all duration-500 ease-in-out overflow-hidden",
          selectedSubcontractId 
            ? (isMainTableCollapsed ? "h-[60px]" : "h-[40%]") 
            : "flex-1"
        )}>
          <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
            <div className="flex items-center gap-2">
              <Hash className="w-4 h-4 text-gray-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Subcontracts</span>
            </div>
            {selectedSubcontractId && (
              <button 
                onClick={() => setIsMainTableCollapsed(!isMainTableCollapsed)}
                className="p-1 hover:bg-gray-200 dark:hover:bg-white/10 rounded-md transition-colors text-gray-500"
              >
                {isMainTableCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>
            )}
          </div>
          <div className="flex-1 min-h-0 relative">
            <div className={cn(
              "absolute inset-0 ag-theme-quartz",
              theme === 'dark' ? "ag-theme-quartz-dark" : ""
            )}>
              <AgGridReact
                ref={gridRef}
                rowData={selectedSubcontractId ? subcontracts.filter(s => s.id === selectedSubcontractId) : subcontracts}
                columnDefs={subcontractColumnDefs}
                pinnedTopRowData={subcontractPinnedTopRowData}
                getRowClass={(params) => {
                  if (params.node.rowPinned) return 'pinned-row-highlight';
                  return '';
                }}
                onSelectionChanged={(params) => {
                  const selectedNodes = params.api.getSelectedNodes();
                  setSelectedIds(new Set(selectedNodes.map(node => node.data?.id).filter(id => !!id)));
                }}
                onCellValueChanged={onCellValueChanged}
                components={{
                  actionsRenderer: ActionsCellRenderer
                }}
                context={{
                  setSelectedSubcontractId,
                  setDeleteConfirm,
                  setSubcontractFormData,
                  setIsAddingSubcontract,
                  setEditingSubcontractId,
                  setBottomPanelTab
                }}
                rowSelection="multiple"
                animateRows={true}
                pagination={true}
                paginationPageSize={20}
                suppressRowClickSelection={true}
                sideBar={sideBar}
                rowGroupPanelShow="always"
                pivotPanelShow="always"
                defaultColDef={defaultColDef}
                headerHeight={56}
                enableFillHandle={true}
                enableRangeSelection={true}
              />
            </div>
          </div>
        </div>

        {/* Bottom Table: Line Items / Invoices */}
        <AnimatePresence>
          {selectedSubcontractId && selectedSubcontract && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ 
                height: isBottomPanelCollapsed 
                  ? '60px' 
                  : (isMainTableCollapsed ? 'calc(100% - 60px)' : '60%'), 
                opacity: 1 
              }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0a0a0a] flex flex-col overflow-hidden"
            >
              <div className="p-4 flex items-center justify-between bg-white dark:bg-[#141414] border-b border-gray-200 dark:border-white/10">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <div className="flex bg-gray-100 dark:bg-white/5 p-1 rounded-xl">
                      <button
                        onClick={() => setBottomPanelTab('lineItems')}
                        className={cn(
                          "px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
                          bottomPanelTab === 'lineItems' 
                            ? "bg-white dark:bg-white/10 text-blue-600 shadow-sm" 
                            : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                        )}
                      >
                        <Briefcase className="w-3.5 h-3.5" />
                        Line Items
                      </button>
                      <button
                        onClick={() => setBottomPanelTab('invoices')}
                        className={cn(
                          "px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
                          bottomPanelTab === 'invoices' 
                            ? "bg-white dark:bg-white/10 text-green-600 shadow-sm" 
                            : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                        )}
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        Invoices
                      </button>
                    </div>
                  </div>
                  
                  <div className="h-4 w-px bg-gray-200 dark:bg-white/10" />
                  
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold dark:text-white">
                      {bottomPanelTab === 'lineItems' ? 'Line Items' : 'Invoices'}: 
                      <span className={bottomPanelTab === 'lineItems' ? "text-blue-600" : "text-green-600"}>
                        {selectedSubcontract.orderId}
                      </span>
                    </h3>
                  </div>
                  
                  <div className="h-4 w-px bg-gray-200 dark:bg-white/10" />
                  
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input 
                      type="text" 
                      placeholder={`Search ${bottomPanelTab === 'lineItems' ? 'items' : 'invoices'}...`}
                      value={lineItemQuickFilterText}
                      onChange={(e) => {
                        setLineItemQuickFilterText(e.target.value);
                        if (bottomPanelTab === 'lineItems') {
                          lineItemsGridRef.current?.api.setGridOption('quickFilterText', e.target.value);
                        } else {
                          invoicesGridRef.current?.api.setGridOption('quickFilterText', e.target.value);
                        }
                      }}
                      className="pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none w-48 dark:text-white"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setIsBottomPanelCollapsed(!isBottomPanelCollapsed)}
                    className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                    title={isBottomPanelCollapsed ? "Expand Panel" : "Collapse Panel"}
                  >
                    {isBottomPanelCollapsed ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </button>
                  <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
                  {bottomPanelTab === 'lineItems' ? (
                    <>
                      <input 
                        type="file" 
                        id="lineItemImport"
                        className="hidden" 
                        accept=".xlsx,.xls"
                        onChange={handleLineItemImport}
                      />
                      <button 
                        onClick={() => document.getElementById('lineItemImport')?.click()}
                        className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                        title="Import Excel"
                      >
                        <Upload className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={handleLineItemExport}
                        className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                        title="Export Excel"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        onClick={handleInvoiceExport}
                        className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                        title="Export Excel"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                    </>
                  )}
                  <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
                  
                  {bottomPanelTab === 'lineItems' && (
                    <>
                      <button 
                        onClick={() => setIsHistogramVisible(!isHistogramVisible)}
                        className={cn(
                          "p-2 rounded-lg transition-all",
                          isHistogramVisible 
                            ? "bg-black text-white dark:bg-white dark:text-black shadow-lg" 
                            : "text-gray-400 hover:text-black dark:hover:text-white"
                        )}
                        title={isHistogramVisible ? "Hide Histogram" : "Show Histogram"}
                      >
                        <BarChart3 className="w-5 h-5" />
                      </button>
                      <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
                      <button 
                        onClick={() => toggleAllLineItemColumnGroups(true)}
                        className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                        title="Expand All Groups"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => toggleAllLineItemColumnGroups(false)}
                        className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                        title="Collapse All Groups"
                      >
                        <Minimize2 className="w-4 h-4" />
                      </button>
                      <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
                    </>
                  )}
                  
                  {bottomPanelTab === 'lineItems' && selectedLineItemIds.size > 0 && (
                    <>
                      <button 
                        onClick={() => setIsLineItemBulkUpdating(true)}
                        className="flex items-center gap-2 bg-black dark:bg-white text-white dark:text-black px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-all shadow-lg shadow-black/10"
                        title={`Bulk Update (${selectedLineItemIds.size})`}
                      >
                        <Edit2 className="w-4 h-4" /> ({selectedLineItemIds.size})
                      </button>
                      <button 
                        onClick={handleLineItemBulkDelete}
                        className="flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-600/10"
                        title={`Bulk Delete (${selectedLineItemIds.size})`}
                      >
                        <Trash2 className="w-4 h-4" /> ({selectedLineItemIds.size})
                      </button>
                      <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
                    </>
                  )}
                  
                  {bottomPanelTab === 'lineItems' && (
                    <Button 
                      size="sm" 
                      onClick={handleCalculateLineItemAutoPhasing}
                      className="h-8 text-[10px] font-bold uppercase tracking-widest gap-2 bg-black dark:bg-white text-white dark:text-black border-none hover:opacity-90 transition-opacity"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Calculate Phasing
                    </Button>
                  )}
                  {bottomPanelTab === 'lineItems' ? (
                    <Button 
                      size="sm"
                      onClick={handleAddLineItem}
                      className="h-8 text-xs bg-black dark:bg-white text-white dark:text-black"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Item
                    </Button>
                  ) : (
                    <Button 
                      size="sm"
                      onClick={handleAddInvoice}
                      className="h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Invoice
                    </Button>
                  )}
                  
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => setSelectedSubcontractId(null)}
                    className="h-8 text-xs"
                  >
                    Close
                  </Button>
                </div>
              </div>
              
              <AnimatePresence>
                {bottomPanelTab === 'lineItems' && isHistogramVisible && !isBottomPanelCollapsed && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="bg-white dark:bg-[#141414] border-b border-gray-200 dark:border-white/10 px-6 py-6 overflow-hidden"
                  >
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Remaining to Claim Projection</span>
                          <h4 className="text-sm font-bold dark:text-white">Monthly Phasing Histogram</h4>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded bg-purple-500/80 shadow-sm shadow-purple-500/20" />
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Periodic Value</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-0.5 bg-orange-500 rounded-full" />
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Cumulative Value</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="h-72 w-full bg-gray-50/50 dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-6">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={phasingHistogramData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#333' : '#eee'} />
                            <XAxis 
                              dataKey="name" 
                              fontSize={10} 
                              tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                              axisLine={false}
                              tickLine={false}
                              dy={10}
                            />
                            <YAxis 
                              yAxisId="left"
                              fontSize={10} 
                              tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                            />
                            <YAxis 
                              yAxisId="right"
                              orientation="right"
                              fontSize={10} 
                              tick={{ fill: theme === 'dark' ? '#999' : '#666' }} 
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                            />
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: theme === 'dark' ? '#1a1a1a' : '#fff',
                                border: 'none',
                                borderRadius: '12px',
                                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                                fontSize: '12px'
                              }}
                              formatter={(val: number) => formatCurrency(val)}
                            />
                            <Bar 
                              yAxisId="left"
                              dataKey="periodic" 
                              fill="#a855f7" 
                              opacity={0.8}
                              radius={[4, 4, 0, 0]} 
                              barSize={40}
                            />
                            <Line 
                              yAxisId="right"
                              type="monotone" 
                              dataKey="cumulative" 
                              stroke="#f97316" 
                              strokeWidth={3}
                              dot={{ r: 4, fill: '#f97316', strokeWidth: 2, stroke: '#fff' }}
                              activeDot={{ r: 6, strokeWidth: 0 }}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className={cn("flex-1 min-h-0 relative", isBottomPanelCollapsed && "hidden")}>
                <div className={cn(
                  "absolute inset-0 ag-theme-quartz",
                  theme === 'dark' ? "ag-theme-quartz-dark" : ""
                )}>
                  {bottomPanelTab === 'lineItems' ? (
                    <AgGridReact
                      key="lineItemsGrid"
                      ref={lineItemsGridRef}
                      rowData={lineItems}
                      columnDefs={lineItemColumnDefs}
                      pinnedTopRowData={lineItemPinnedTopRowData}
                      getRowClass={(params) => {
                        if (params.node.rowPinned) return 'pinned-row-highlight';
                        return '';
                      }}
                      quickFilterText={lineItemQuickFilterText}
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
                      rowSelection="multiple"
                      suppressRowClickSelection={true}
                      onSelectionChanged={(event) => {
                        const selectedRows = event.api.getSelectedRows();
                        setSelectedLineItemIds(new Set(selectedRows.map(row => row?.id).filter(id => !!id)));
                      }}
                      onCellValueChanged={onLineItemCellValueChanged}
                      animateRows={true}
                      enableFillHandle={true}
                      enableRangeSelection={true}
                      getRowId={(params) => params.data.id}
                      sideBar={{
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
                      }}
                    />
                  ) : (
                    <div className="flex flex-col h-full">
                      <div className={cn(
                        "transition-all duration-300 ease-in-out overflow-hidden flex flex-col",
                        selectedInvoiceId 
                          ? (isInvoicesCollapsed ? "h-[40px]" : "h-[40%]") 
                          : "flex-1 min-h-0"
                      )}>
                        <div className="flex items-center justify-between px-2 py-1 bg-gray-50 dark:bg-white/5 border-b border-gray-100 dark:border-white/5">
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Invoices</span>
                          {selectedInvoiceId && (
                            <button 
                              onClick={() => setIsInvoicesCollapsed(!isInvoicesCollapsed)}
                              className="p-1 hover:bg-gray-200 dark:hover:bg-white/10 rounded-md transition-colors text-gray-500"
                            >
                              {isInvoicesCollapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                            </button>
                          )}
                        </div>
                        <div className="flex-1 min-h-0">
                          <AgGridReact
                            key="invoicesGrid"
                            ref={invoicesGridRef}
                            rowData={selectedSubcontractInvoices}
                            columnDefs={invoiceColumnDefs}
                            quickFilterText={lineItemQuickFilterText}
                            context={{
                              setSelectedInvoiceId,
                              setEditingInvoiceId,
                              setIsAddingInvoice,
                              setInvoiceFormData,
                              setInvoiceDeleteConfirm
                            }}
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
                            onCellValueChanged={onInvoiceCellValueChanged}
                            animateRows={true}
                            enableFillHandle={true}
                            enableRangeSelection={true}
                            getRowId={(params) => params.data.id}
                            sideBar={{
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
                            }}
                          />
                        </div>
                      </div>
                      {selectedInvoiceId && (
                        <div className={cn(
                          "flex flex-col bg-white dark:bg-[#141414] transition-all duration-300 ease-in-out",
                          isInvoicesCollapsed ? "flex-1" : "h-[60%]"
                        )}>
                          <div className="p-2 border-b border-gray-100 dark:border-white/5 flex items-center justify-between bg-gray-50 dark:bg-white/5">
                            <div className="flex items-center gap-4">
                              <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500">
                                Invoice Items: <span className="text-green-600">{selectedInvoice?.invoiceId}</span>
                              </h4>
                              <div className="flex items-center gap-1 bg-gray-200 dark:bg-white/5 p-0.5 rounded-lg">
                                <Button 
                                  variant={entryMethod === 'Cumulative' ? 'default' : 'ghost'} 
                                  size="sm" 
                                  onClick={() => setEntryMethod('Cumulative')}
                                  className={cn(
                                    "h-6 px-3 text-[10px] uppercase font-bold tracking-wider rounded-md transition-all",
                                    entryMethod === 'Cumulative' ? "shadow-sm" : "text-gray-500"
                                  )}
                                >
                                  Cumulative
                                </Button>
                                <Button 
                                  variant={entryMethod === 'Periodic' ? 'default' : 'ghost'} 
                                  size="sm" 
                                  onClick={() => setEntryMethod('Periodic')}
                                  className={cn(
                                    "h-6 px-3 text-[10px] uppercase font-bold tracking-wider rounded-md transition-all",
                                    entryMethod === 'Periodic' ? "shadow-sm" : "text-gray-500"
                                  )}
                                >
                                  Periodic
                                </Button>
                              </div>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => setSelectedInvoiceId(null)} className="h-6 text-[10px]">
                              Close Items
                            </Button>
                          </div>
                          <div className="flex-1 min-h-0 ag-theme-quartz dark:ag-theme-quartz-dark">
                            <AgGridReact
                              key="invoiceItemsGrid"
                              rowData={selectedInvoiceItems}
                              columnDefs={invoiceLineItemColumnDefs}
                              pinnedTopRowData={invoiceItemsPinnedTopRowData}
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
                              onCellValueChanged={onInvoiceLineItemCellValueChanged}
                              animateRows={true}
                              enableFillHandle={true}
                              enableRangeSelection={true}
                              getRowId={(params) => params.data.id}
                              sideBar={{
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
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {importPreview && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[110] p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-4xl shadow-2xl border border-gray-200 dark:border-white/10 flex flex-col max-h-[90vh]"
              >
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-2xl font-bold dark:text-white">Review Import</h2>
                    <p className="text-gray-900 dark:text-gray-400 text-sm mt-1">
                      Review the records found in your file. Existing Order IDs will be updated.
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

      {/* Add/Edit Invoice Modal */}
      {isAddingInvoice && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-lg p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold dark:text-white">{editingInvoiceId ? 'Edit Invoice' : 'New Invoice'}</h2>
              <button onClick={() => { setIsAddingInvoice(false); setEditingInvoiceId(null); }} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full">
                <Plus className="w-5 h-5 rotate-45 text-gray-400" />
              </button>
            </div>
            <form onSubmit={editingInvoiceId ? handleUpdateInvoice : handleAddInvoice} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Invoice Name</label>
                <Input 
                  value={invoiceFormData.description}
                  onChange={e => setInvoiceFormData({ ...invoiceFormData, description: e.target.value })}
                  placeholder="e.g. Monthly Progress Claim"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Submit Date</label>
                  <Input 
                    type="date"
                    value={invoiceFormData.submittedDate}
                    onChange={e => setInvoiceFormData({ ...invoiceFormData, submittedDate: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Approve Date</label>
                  <Input 
                    type="date"
                    value={invoiceFormData.certifiedDate}
                    onChange={e => setInvoiceFormData({ ...invoiceFormData, certifiedDate: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Payment Date</label>
                  <Input 
                    type="date"
                    value={invoiceFormData.paymentDate}
                    onChange={e => setInvoiceFormData({ ...invoiceFormData, paymentDate: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Status</label>
                  <select 
                    value={invoiceFormData.status}
                    onChange={e => setInvoiceFormData({ ...invoiceFormData, status: e.target.value as any })}
                    className="w-full p-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                  >
                    <option value="Draft">Draft</option>
                    <option value="Submitted">Submitted</option>
                    <option value="Certified">Certified</option>
                    <option value="Paid">Paid</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t border-gray-100 dark:border-white/10 mt-6">
                <Button variant="ghost" onClick={() => { setIsAddingInvoice(false); setEditingInvoiceId(null); }}>Cancel</Button>
                <Button type="submit" className="bg-green-600 hover:bg-green-700 text-white">
                  {editingInvoiceId ? 'Update Invoice' : 'Create Invoice'}
                </Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Invoice Delete Confirmation */}
      {invoiceDeleteConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6"
          >
            <div className="flex items-center gap-4 mb-6 text-red-600">
              <div className="p-3 bg-red-100 dark:bg-red-900/20 rounded-full">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Delete Invoice?</h2>
                <p className="text-sm text-gray-500">This action cannot be undone.</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setInvoiceDeleteConfirm(null)}>Cancel</Button>
              <Button onClick={handleDeleteInvoice} className="bg-red-600 hover:bg-red-700 text-white">Delete</Button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Add Subcontract Modal */}
      {isAddingSubcontract && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold dark:text-white">{editingSubcontractId ? 'Edit Subcontract' : 'New Subcontract'}</h2>
              <button onClick={() => { setIsAddingSubcontract(false); setEditingSubcontractId(null); }} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full">
                <Plus className="w-5 h-5 rotate-45 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleAddSubcontract} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Order ID</label>
                  <Input 
                    maxLength={50}
                    value={subcontractFormData.orderId}
                    onChange={e => setSubcontractFormData({ ...subcontractFormData, orderId: e.target.value })}
                    placeholder="e.g. SC-001"
                    required
                    disabled={!!editingSubcontractId}
                    className={cn(!!editingSubcontractId && "bg-gray-50 dark:bg-white/5 cursor-not-allowed")}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Order Name</label>
                  <Input 
                    value={subcontractFormData.orderName}
                    onChange={e => setSubcontractFormData({ ...subcontractFormData, orderName: e.target.value })}
                    placeholder="e.g. Concrete Works"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Order Scope</label>
                <textarea 
                  value={subcontractFormData.orderScope}
                  onChange={e => setSubcontractFormData({ ...subcontractFormData, orderScope: e.target.value })}
                  className="w-full p-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white min-h-[100px]"
                  placeholder="Describe the scope of work..."
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Status</label>
                  <select 
                    value={subcontractFormData.status}
                    onChange={e => setSubcontractFormData({ ...subcontractFormData, status: e.target.value as any })}
                    className="w-full p-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                  >
                    <option value="Active">Active</option>
                    <option value="Complete">Complete</option>
                    <option value="On Hold">On Hold</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Cost Code</label>
                  <select 
                    value={subcontractFormData.defaultCostCodeId || ''}
                    onChange={e => setSubcontractFormData({ ...subcontractFormData, defaultCostCodeId: e.target.value })}
                    className="w-full p-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                  >
                    <option value="">None</option>
                    {[...costCodes].sort((a, b) => a.code.localeCompare(b.code)).map(c => (
                      <option key={c.id} value={c.code}>{c.code} - {c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Payment Type</label>
                  <select 
                    value={subcontractFormData.paymentType}
                    onChange={e => setSubcontractFormData({ ...subcontractFormData, paymentType: e.target.value as any })}
                    className="w-full p-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                  >
                    <option value="LumpSum">LumpSum</option>
                    <option value="Schedule of Rates">Schedule of Rates</option>
                    <option value="Re-measurable">Re-measurable</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Award Date</label>
                  <Input 
                    type="date"
                    value={subcontractFormData.awardDate}
                    onChange={e => setSubcontractFormData({ ...subcontractFormData, awardDate: e.target.value })}
                  />
                </div>
              </div>

              {/* Default Timephasing Section */}
              <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/5 space-y-4">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Default Timephasing</div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 tracking-wider">Phasing Source</label>
                    <select 
                      value={subcontractFormData.defaultPhasingSource}
                      onChange={e => setSubcontractFormData({ ...subcontractFormData, defaultPhasingSource: e.target.value as any })}
                      className="w-full p-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                    >
                      <option value="Manual">Manual</option>
                      <option value="Auto">Auto</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 tracking-wider">Distribution</label>
                    <select 
                      value={subcontractFormData.defaultDistribution}
                      onChange={e => setSubcontractFormData({ ...subcontractFormData, defaultDistribution: e.target.value as any })}
                      className="w-full p-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                    >
                      <option value="Even">Even</option>
                      <option value="Bell Curve">Bell Curve</option>
                      <option value="Front load">Front load</option>
                      <option value="Back load">Back load</option>
                      <option value="S-Curve">S-Curve</option>
                      <option value="Profile">Profile</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 tracking-wider">Start Date</label>
                    <Input 
                      type="date"
                      value={subcontractFormData.defaultStartDate || ''}
                      onChange={e => setSubcontractFormData({ ...subcontractFormData, defaultStartDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 tracking-wider">End Date</label>
                    <Input 
                      type="date"
                      value={subcontractFormData.defaultEndDate || ''}
                      onChange={e => setSubcontractFormData({ ...subcontractFormData, defaultEndDate: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Vendor</label>
                <select 
                  value={subcontractFormData.vendorId}
                  onChange={e => {
                    const vendor = (enterprise.vendors || []).find(v => v.id === e.target.value);
                    setSubcontractFormData({ 
                      ...subcontractFormData, 
                      vendorId: e.target.value,
                      vendorName: vendor?.name || ''
                    });
                  }}
                  className="w-full p-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                >
                  <option value="">Select Vendor</option>
                  {(enterprise.vendors || []).map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="ghost" onClick={() => { setIsAddingSubcontract(false); setEditingSubcontractId(null); }}>Cancel</Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white">{editingSubcontractId ? 'Update Subcontract' : 'Create Subcontract'}</Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Add Line Item Modal */}
      {isAddingLineItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-lg p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold dark:text-white">Add Line Item</h2>
              <button onClick={() => setIsAddingLineItem(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full">
                <Plus className="w-5 h-5 rotate-45 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleAddLineItem} className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Item No</label>
                  <Input 
                    value={lineItemFormData.itemNo}
                    onChange={e => setLineItemFormData({ ...lineItemFormData, itemNo: e.target.value })}
                    placeholder="001"
                    required
                  />
                </div>
                <div className="col-span-3 space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Description</label>
                  <Input 
                    value={lineItemFormData.description}
                    onChange={e => setLineItemFormData({ ...lineItemFormData, description: e.target.value })}
                    placeholder="Item description..."
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Type</label>
                  <select 
                    value={lineItemFormData.type}
                    onChange={e => setLineItemFormData({ ...lineItemFormData, type: e.target.value as any })}
                    className="w-full p-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                  >
                    <option value="Original">Original</option>
                    <option value="ChangeOrder">Change Order</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Status</label>
                  <select 
                    value={lineItemFormData.status}
                    onChange={e => setLineItemFormData({ ...lineItemFormData, status: e.target.value as any })}
                    className="w-full p-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                  >
                    <option value="Approved">Approved</option>
                    <option value="Pending">Pending</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Unit</label>
                  <Input 
                    value={lineItemFormData.unit}
                    onChange={e => setLineItemFormData({ ...lineItemFormData, unit: e.target.value })}
                    placeholder="m2, kg, etc."
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Quantity</label>
                  <Input 
                    type="number"
                    step="any"
                    value={lineItemFormData.qty}
                    onChange={e => setLineItemFormData({ ...lineItemFormData, qty: parseFloat(e.target.value) || 0 })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Rate</label>
                  <Input 
                    type="number"
                    step="any"
                    value={lineItemFormData.rate}
                    onChange={e => setLineItemFormData({ ...lineItemFormData, rate: parseFloat(e.target.value) || 0 })}
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="ghost" onClick={() => setIsAddingLineItem(false)}>Cancel</Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white">Add Item</Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Bulk Update Modal */}
      {isBulkUpdating && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-lg p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold dark:text-white">Bulk Update ({selectedIds.size} rows)</h2>
              <button onClick={() => setIsBulkUpdating(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full">
                <Plus className="w-5 h-5 rotate-45 text-gray-400" />
              </button>
            </div>
            
            <div className="space-y-4">
              <p className="text-sm text-gray-500 mb-4">Select the fields you want to update for all selected subcontracts. Fields left blank will not be changed.</p>
              
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Status</label>
                <select 
                  value={bulkUpdateData.status || ''}
                  onChange={e => setBulkUpdateData({ ...bulkUpdateData, status: e.target.value as any })}
                  className="w-full px-4 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                >
                  <option value="">No Change</option>
                  <option value="Active">Active</option>
                  <option value="Complete">Complete</option>
                  <option value="On Hold">On Hold</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Payment Type</label>
                <select 
                  value={bulkUpdateData.paymentType || ''}
                  onChange={e => setBulkUpdateData({ ...bulkUpdateData, paymentType: e.target.value as any })}
                  className="w-full px-4 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                >
                  <option value="">No Change</option>
                  <option value="LumpSum">LumpSum</option>
                  <option value="Schedule of Rates">Schedule of Rates</option>
                  <option value="Re-measurable">Re-measurable</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Award Date</label>
                <Input 
                  type="date"
                  value={bulkUpdateData.awardDate || ''}
                  onChange={e => setBulkUpdateData({ ...bulkUpdateData, awardDate: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Vendor</label>
                <select 
                  value={bulkUpdateData.vendorId || ''}
                  onChange={e => {
                    const vendor = enterprise.vendors?.find(v => v.id === e.target.value);
                    setBulkUpdateData({ 
                      ...bulkUpdateData, 
                      vendorId: e.target.value,
                      vendorName: vendor?.name || ''
                    });
                  }}
                  className="w-full px-4 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                >
                  <option value="">No Change</option>
                  {enterprise.vendors?.map(vendor => (
                    <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-6">
                <Button variant="ghost" onClick={() => setIsBulkUpdating(false)}>Cancel</Button>
                <Button 
                  onClick={handleBulkUpdate}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={Object.keys(bulkUpdateData).length === 0}
                >
                  Update {selectedIds.size} Rows
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6"
          >
            <div className="flex items-center gap-3 mb-4 text-red-600">
              <AlertCircle className="w-6 h-6" />
              <h2 className="text-xl font-bold">Confirm Delete</h2>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {deleteConfirm.type === 'single' 
                ? `Are you sure you want to delete subcontract "${deleteConfirm.name}"? This action cannot be undone.`
                : `Are you sure you want to delete ${deleteConfirm.count} selected subcontracts? This action cannot be undone.`
              }
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button 
                variant="destructive" 
                onClick={() => deleteConfirm.type === 'single' ? handleDeleteSubcontract(deleteConfirm.id!) : handleBulkDelete()}
              >
                Delete
              </Button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Line Item Bulk Update Modal */}
      {isLineItemBulkUpdating && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold dark:text-white">Bulk Update Line Items ({selectedLineItemIds.size})</h2>
              <button onClick={() => setIsLineItemBulkUpdating(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            
            <div className="space-y-8 max-h-[60vh] overflow-y-auto pr-2">
              {/* Core Details */}
              <section className="space-y-4">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest border-b border-gray-100 dark:border-white/10 pb-2">Core Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Cost Code ID</label>
                    <select 
                      value={lineItemBulkUpdateData.costCodeId || ''}
                      onChange={e => setLineItemBulkUpdateData({ ...lineItemBulkUpdateData, costCodeId: e.target.value })}
                      className="w-full px-4 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none dark:text-white"
                    >
                      <option value="">No Change</option>
                      {costCodes.map(c => (
                        <option key={c.id} value={c.code}>{c.code} - {c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Date</label>
                    <Input 
                      type="date"
                      value={lineItemBulkUpdateData.date || ''}
                      onChange={e => setLineItemBulkUpdateData({ ...lineItemBulkUpdateData, date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Type</label>
                    <select 
                      value={lineItemBulkUpdateData.type || ''}
                      onChange={e => setLineItemBulkUpdateData({ ...lineItemBulkUpdateData, type: e.target.value as any })}
                      className="w-full px-4 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none dark:text-white"
                    >
                      <option value="">No Change</option>
                      <option value="Original">Original</option>
                      <option value="ChangeOrder">ChangeOrder</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Status</label>
                    <select 
                      value={lineItemBulkUpdateData.status || ''}
                      onChange={e => setLineItemBulkUpdateData({ ...lineItemBulkUpdateData, status: e.target.value as any })}
                      className="w-full px-4 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none dark:text-white"
                    >
                      <option value="">No Change</option>
                      <option value="Approved">Approved</option>
                      <option value="Pending">Pending</option>
                      <option value="Forecast">Forecast</option>
                      <option value="Rejected">Rejected</option>
                    </select>
                  </div>
                </div>
              </section>

              {/* Timephasing Section */}
              <section className="space-y-4">
                <h3 className="text-xs font-bold text-blue-500 uppercase tracking-widest border-b border-blue-100 dark:border-blue-500/10 pb-2">Timephasing</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Phasing Source</label>
                    <select 
                      value={lineItemBulkUpdateData.phasingSource || ''}
                      onChange={e => setLineItemBulkUpdateData({ ...lineItemBulkUpdateData, phasingSource: e.target.value as any })}
                      className="w-full px-4 py-2 bg-white dark:bg-[#1a1a1a] border border-blue-200 dark:border-blue-500/10 rounded-xl text-sm outline-none dark:text-white"
                    >
                      <option value="">No Change</option>
                      <option value="Auto">Auto</option>
                      <option value="Manual">Manual</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Distribution</label>
                    <select 
                      value={lineItemBulkUpdateData.distribution || ''}
                      onChange={e => setLineItemBulkUpdateData({ ...lineItemBulkUpdateData, distribution: e.target.value as any })}
                      className="w-full px-4 py-2 bg-white dark:bg-[#1a1a1a] border border-blue-200 dark:border-blue-500/10 rounded-xl text-sm outline-none dark:text-white"
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
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Start Date</label>
                    <Input 
                      type="date"
                      value={lineItemBulkUpdateData.startDate || ''}
                      onChange={e => setLineItemBulkUpdateData({ ...lineItemBulkUpdateData, startDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">End Date</label>
                    <Input 
                      type="date"
                      value={lineItemBulkUpdateData.endDate || ''}
                      onChange={e => setLineItemBulkUpdateData({ ...lineItemBulkUpdateData, endDate: e.target.value })}
                    />
                  </div>
                </div>
              </section>

              {/* Enterprise Attributes Section */}
              {enterprise.lineItemAttributes?.some(attr => attr.title && attr.title.trim() !== '') && (
                <section className="space-y-4">
                  <h3 className="text-xs font-bold text-green-600 uppercase tracking-widest border-b border-green-100 dark:border-green-500/10 pb-2">Enterprise Attributes</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {enterprise.lineItemAttributes?.filter(attr => attr.title && attr.title.trim() !== '').map(attr => (
                      <div key={attr.id} className="space-y-2">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">{attr.title}</label>
                        <select 
                          value={lineItemBulkUpdateData.enterpriseAttributes?.[attr.id] || ''}
                          onChange={e => setLineItemBulkUpdateData({ 
                            ...lineItemBulkUpdateData, 
                            enterpriseAttributes: { ...lineItemBulkUpdateData.enterpriseAttributes, [attr.id]: e.target.value }
                          })}
                          className="w-full px-4 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none dark:text-white"
                        >
                          <option value="">No Change</option>
                          <option value="CLEAR">CLEAR FIELD</option>
                          {attr.values.map(v => (
                            <option key={v.id} value={v.id}>{v.id} - {v.description}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Project Attributes Section */}
              {project.lineItemAttributes?.some(attr => attr.title && attr.title.trim() !== '') && (
                <section className="space-y-4">
                  <h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest border-b border-blue-100 dark:border-blue-500/10 pb-2">Project Attributes</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {project.lineItemAttributes?.filter(attr => attr.title && attr.title.trim() !== '').map(attr => (
                      <div key={attr.id} className="space-y-2">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">{attr.title}</label>
                        <select 
                          value={lineItemBulkUpdateData.projectAttributes?.[attr.id] || ''}
                          onChange={e => setLineItemBulkUpdateData({ 
                            ...lineItemBulkUpdateData, 
                            projectAttributes: { ...lineItemBulkUpdateData.projectAttributes, [attr.id]: e.target.value }
                          })}
                          className="w-full px-4 py-2 bg-white dark:bg-[#1a1a1a] border border-blue-100 dark:border-blue-500/10 rounded-xl text-sm outline-none dark:text-white"
                        >
                          <option value="">No Change</option>
                          <option value="CLEAR">CLEAR FIELD</option>
                          {attr.values.map(v => (
                            <option key={v.id} value={v.id}>{v.id} - {v.description}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* User Defined Section */}
              <section className="space-y-4">
                <h3 className="text-xs font-bold text-orange-500 uppercase tracking-widest border-b border-orange-100 dark:border-orange-500/10 pb-2">User Defined Fields</h3>
                <div className="grid grid-cols-2 gap-4">
                  {/* Numeric Fields */}
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={`num${i}`} className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">{`Numeric ${i + 1}`}</label>
                      <Input 
                        type="number"
                        placeholder="No Change"
                        value={lineItemBulkUpdateData.userDefined?.[`num${i + 1}`] === undefined ? '' : lineItemBulkUpdateData.userDefined[`num${i + 1}`]}
                        onChange={e => setLineItemBulkUpdateData({ 
                          ...lineItemBulkUpdateData, 
                          userDefined: { ...lineItemBulkUpdateData.userDefined, [`num${i + 1}`]: e.target.value === '' ? undefined : Number(e.target.value) }
                        })}
                      />
                    </div>
                  ))}
                  {/* Text Fields */}
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={`text${i}`} className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">{`Text ${i + 1}`}</label>
                      <Input 
                        type="text"
                        placeholder="No Change"
                        value={lineItemBulkUpdateData.userDefined?.[`text${i + 1}`] || ''}
                        onChange={e => setLineItemBulkUpdateData({ 
                          ...lineItemBulkUpdateData, 
                          userDefined: { ...lineItemBulkUpdateData.userDefined, [`text${i + 1}`]: e.target.value }
                        })}
                      />
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="flex justify-end gap-3 pt-6 border-t border-gray-100 dark:border-white/10 mt-6">
              <Button variant="ghost" onClick={() => setIsLineItemBulkUpdating(false)}>Cancel</Button>
              <Button 
                onClick={handleLineItemBulkUpdate}
                className="bg-black dark:bg-white text-white dark:text-black"
              >
                Update {selectedLineItemIds.size} Items
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
