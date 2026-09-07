import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  Receipt,
  Send,
  CheckCircle,
  XCircle,
  CreditCard,
  Hash,
  ChevronUp,
  ArrowLeft,
  Settings,
  Download,
  Upload,
  RefreshCw,
  AlertCircle,
  X
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
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
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { Enterprise, Project, Subcontract, Invoice, InvoiceItem, SubcontractLineItem } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn, formatCurrency } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { AgGridReact } from 'ag-grid-react';
import { 
  ColDef, 
  GridReadyEvent, 
  GridApi,
  ICellRendererParams
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import 'ag-grid-enterprise';

interface InvoicingProps {
  enterprise: Enterprise;
  project: Project;
  user: any;
  theme?: 'light' | 'dark';
}

export default function Invoicing({ enterprise, project, user, theme = 'light' }: InvoicingProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [subcontracts, setSubcontracts] = useState<Subcontract[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [isMainTableCollapsed, setIsMainTableCollapsed] = useState(false);
  
  const [isAddingInvoice, setIsAddingInvoice] = useState(false);
  const [invoiceFormData, setInvoiceFormData] = useState<Partial<Invoice>>({
    invoiceId: '',
    description: '',
    status: 'Draft',
    subcontractId: '',
    vendorId: '',
    vendorName: ''
  });

  const gridRef = useRef<AgGridReact>(null);
  const itemsGridRef = useRef<AgGridReact>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [importPreview, setImportPreview] = useState<{ type: 'invoices', data: any[] } | null>(null);

  const dateToISO = (date: Date) => {
    try {
      return date.toISOString().split('T')[0];
    } catch {
      return '';
    }
  };

  const handleExport = () => {
    if (gridRef.current?.api) {
      gridRef.current.api.exportDataAsExcel({
        fileName: `${project.projectCode}_Invoices_${new Date().toISOString().split('T')[0]}.xlsx`
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
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];
        
        if (data.length === 0) {
          toast.error("The file is empty.");
          return;
        }

        setImportPreview({ type: 'invoices', data });
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
    const { data } = importPreview;
    const toastId = toast.loading('Importing invoices...');
    
    try {
      const batch = writeBatch(db);
      const subcontractsMap = new Map(subcontracts.map(s => [s.orderId.toLowerCase(), s]));

      for (const row of data) {
        const orderId = String(row['Order ID'] || row.orderId || '').trim();
        const invoiceNo = String(row['Invoice No.'] || row.invoiceId || row.ID || row.id || '').trim();
        
        if (!orderId || !invoiceNo) continue;

        const targetSub = subcontractsMap.get(orderId.toLowerCase());
        if (!targetSub) continue;

        const existingInvoice = invoices.find(i => i.subcontractId === targetSub.id && i.invoiceId === invoiceNo);
        
        const invoiceData: any = {
          description: String(row['Invoice Name'] || row.description || row.Description || 'Imported Invoice'),
          status: (row['Status'] || row.status || 'Draft') as any,
          submittedDate: row['Submit Date'] ? dateToISO(new Date(row['Submit Date'])) : '',
          certifiedDate: row['Approve Date'] ? dateToISO(new Date(row['Approve Date'])) : '',
          paymentDate: row['Payment Date'] ? dateToISO(new Date(row['Payment Date'])) : '',
          updatedAt: new Date().toISOString()
        };

        if (existingInvoice) {
          batch.update(doc(db, 'invoices', existingInvoice.id), invoiceData);
        } else {
          const newRef = doc(collection(db, 'invoices'));
          batch.set(newRef, {
            ...invoiceData,
            id: newRef.id,
            invoiceId: invoiceNo,
            subcontractId: targetSub.id,
            projectId: project.id,
            enterpriseId: enterprise.id,
            vendorId: targetSub.vendorId,
            vendorName: targetSub.vendorName,
            totalAmount: 0,
            certifiedAmount: 0,
            items: [],
            createdAt: new Date().toISOString()
          });
        }
      }

      await batch.commit();
      toast.success('Successfully imported invoices.', { id: toastId });
    } catch (error) {
      console.error('Error committing import:', error);
      toast.error('Failed to commit import.', { id: toastId });
    }
    setImportPreview(null);
  };

  const { duplicateIds, hasImportDuplicates } = useMemo(() => {
    if (!importPreview) return { duplicateIds: [], hasImportDuplicates: false };
    
    const idsInFile = new Set<string>();
    const fileDuplicates = new Set<string>();
    
    importPreview.data.forEach(row => {
      const orderId = String(row['Order ID'] || row.orderId || '').trim();
      const invoiceNo = String(row['Invoice No.'] || row.invoiceId || row.ID || row.id || '').trim();
      if (orderId && invoiceNo) {
        const key = `${orderId.toLowerCase()}_${invoiceNo.toLowerCase()}`;
        if (idsInFile.has(key)) {
          fileDuplicates.add(key);
        }
        idsInFile.add(key);
      }
    });

    const duplicateList = Array.from(fileDuplicates);
    return { duplicateIds: duplicateList, hasImportDuplicates: duplicateList.length > 0 };
  }, [importPreview]);

  useEffect(() => {
    if (!project.id) return;

    const qInvoices = query(collection(db, 'invoices'), where('projectId', '==', project.id));
    const unsubscribeInvoices = onSnapshot(qInvoices, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Invoice));
      setInvoices(data);
      setLoading(false);
    });

    const qSubcontracts = query(collection(db, 'subcontracts'), where('projectId', '==', project.id));
    const unsubscribeSubcontracts = onSnapshot(qSubcontracts, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Subcontract));
      setSubcontracts(data);
    });

    return () => {
      unsubscribeInvoices();
      unsubscribeSubcontracts();
    };
  }, [project.id]);

  const selectedInvoice = useMemo(() => 
    invoices.find(i => i.id === selectedInvoiceId), 
    [invoices, selectedInvoiceId]
  );

  const selectedSubcontract = useMemo(() => 
    subcontracts.find(s => s.id === selectedInvoice?.subcontractId),
    [subcontracts, selectedInvoice?.subcontractId]
  );

  const handleAddInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project.id || !enterprise.id || !invoiceFormData.subcontractId) return;

    const subcontract = subcontracts.find(s => s.id === invoiceFormData.subcontractId);
    if (!subcontract) return;

    try {
      const projectInvoices = invoices.filter(i => i.projectId === project.id);
      const nextId = (projectInvoices.length + 1).toString().padStart(3, '0');

      const items: InvoiceItem[] = (subcontract.lineItems || []).map(li => ({
        id: Math.random().toString(36).substring(2, 9),
        subcontractLineItemId: li.id,
        itemNo: li.itemNo,
        description: li.description,
        qty: li.qty,
        unit: li.unit,
        rate: li.rate,
        total: li.total,
        claimQty: 0,
        claimPercent: 0,
        claimValue: 0,
        certifiedQty: 0,
        certifiedPercent: 0,
        certifiedValue: 0
      }));

      const newInvoice = {
        ...invoiceFormData,
        invoiceId: nextId,
        enterpriseId: enterprise.id,
        projectId: project.id,
        vendorId: subcontract.vendorId,
        vendorName: subcontract.vendorName,
        createdAt: new Date().toISOString(),
        createdBy: user.uid,
        items,
        totalAmount: 0,
        certifiedAmount: 0
      };

      const docRef = await addDoc(collection(db, 'invoices'), newInvoice);
      setIsAddingInvoice(false);
      setSelectedInvoiceId(docRef.id);
    } catch (error) {
      console.error('Error adding invoice:', error);
    }
  };

  const updateInvoiceItem = async (itemId: string, updates: Partial<InvoiceItem>) => {
    if (!selectedInvoiceId || !selectedInvoice) return;

    const updatedItems = selectedInvoice.items.map(item => {
      if (item.id === itemId) {
        const newItem = { ...item, ...updates };
        const li = selectedSubcontract?.lineItems?.find(l => l.id === item.subcontractLineItemId);
        if (li) {
          if ('claimQty' in updates) {
            newItem.claimValue = (updates.claimQty || 0) * li.rate;
            newItem.claimPercent = li.total > 0 ? (newItem.claimValue / li.total) * 100 : 0;
          } else if ('claimPercent' in updates) {
            newItem.claimValue = ((updates.claimPercent || 0) / 100) * li.total;
            newItem.claimQty = li.rate > 0 ? newItem.claimValue / li.rate : 0;
          }

          if ('certifiedQty' in updates) {
            newItem.certifiedValue = (updates.certifiedQty || 0) * li.rate;
            newItem.certifiedPercent = li.total > 0 ? (newItem.certifiedValue / li.total) * 100 : 0;
          } else if ('certifiedPercent' in updates) {
            newItem.certifiedValue = ((updates.certifiedPercent || 0) / 100) * li.total;
            newItem.certifiedQty = li.rate > 0 ? newItem.certifiedValue / li.rate : 0;
          }
        }
        return newItem;
      }
      return item;
    });

    const totalAmount = updatedItems.reduce((sum, i) => sum + (i.claimValue || 0), 0);
    const certifiedAmount = updatedItems.reduce((sum, i) => sum + (i.certifiedValue || 0), 0);

    await updateDoc(doc(db, 'invoices', selectedInvoiceId), {
      items: updatedItems,
      totalAmount,
      certifiedAmount
    });
  };

  const updateInvoiceStatus = async (status: Invoice['status']) => {
    if (!selectedInvoiceId) return;
    const updates: any = { status };
    if (status === 'Submitted') updates.submittedDate = new Date().toISOString();
    if (status === 'Certified') updates.certifiedDate = new Date().toISOString();
    
    await updateDoc(doc(db, 'invoices', selectedInvoiceId), updates);
  };

  const invoiceColumnDefs = useMemo<ColDef[]>(() => [
    { 
      field: 'invoiceId', 
      headerName: 'Invoice ID', 
      pinned: 'left', 
      width: 120,
      cellRenderer: (params: ICellRendererParams) => (
        <span className="font-mono font-bold text-blue-600 dark:text-blue-400">INV-{params.value}</span>
      )
    },
    { field: 'description', headerName: 'Description', flex: 1, minWidth: 200 },
    { field: 'vendorName', headerName: 'Vendor', width: 180 },
    { 
      field: 'status', 
      headerName: 'Status', 
      width: 120,
      cellRenderer: (params: ICellRendererParams) => (
        <span className={cn(
          "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest",
          params.value === 'Draft' ? "bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-gray-400" :
          params.value === 'Submitted' ? "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400" :
          params.value === 'Certified' ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400" :
          params.value === 'Paid' ? "bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400" :
          "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400"
        )}>
          {params.value}
        </span>
      )
    },
    { 
      field: 'totalAmount', 
      headerName: 'Claimed', 
      width: 130, 
      type: 'numericColumn',
      valueFormatter: params => formatCurrency(params.value)
    },
    { 
      field: 'certifiedAmount', 
      headerName: 'Certified', 
      width: 130, 
      type: 'numericColumn',
      valueFormatter: params => formatCurrency(params.value),
      cellClass: 'text-green-600 dark:text-green-400 font-bold'
    },
    { field: 'submittedDate', headerName: 'Submitted', width: 120, valueFormatter: params => params.value ? new Date(params.value).toLocaleDateString() : '-' },
    {
      headerName: 'Actions',
      width: 80,
      pinned: 'right',
      cellRenderer: (params: ICellRendererParams) => (
        <div className="flex items-center gap-1 h-full">
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setSelectedInvoiceId(params.data.id);
            }}
            className="p-1.5 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-lg transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      )
    }
  ], []);

  const itemColumnDefs = useMemo<ColDef[]>(() => [
    { field: 'description', headerName: 'Description', flex: 1, minWidth: 200, pinned: 'left' },
    { 
      field: 'claimQty', 
      headerName: 'Claim Qty', 
      width: 100, 
      editable: selectedInvoice?.status === 'Draft',
      type: 'numericColumn',
      onCellValueChanged: params => updateInvoiceItem(params.data.id, { claimQty: parseFloat(params.newValue) || 0 })
    },
    { 
      field: 'claimPercent', 
      headerName: 'Claim %', 
      width: 100, 
      editable: selectedInvoice?.status === 'Draft',
      type: 'numericColumn',
      onCellValueChanged: params => updateInvoiceItem(params.data.id, { claimPercent: parseFloat(params.newValue) || 0 })
    },
    { 
      field: 'claimValue', 
      headerName: 'Claim Value', 
      width: 120, 
      type: 'numericColumn',
      valueFormatter: params => formatCurrency(params.value)
    },
    { 
      field: 'certifiedQty', 
      headerName: 'Cert. Qty', 
      width: 100, 
      editable: selectedInvoice?.status === 'Submitted',
      type: 'numericColumn',
      onCellValueChanged: params => updateInvoiceItem(params.data.id, { certifiedQty: parseFloat(params.newValue) || 0 })
    },
    { 
      field: 'certifiedPercent', 
      headerName: 'Cert. %', 
      width: 100, 
      editable: selectedInvoice?.status === 'Submitted',
      type: 'numericColumn',
      onCellValueChanged: params => updateInvoiceItem(params.data.id, { certifiedPercent: parseFloat(params.newValue) || 0 })
    },
    { 
      field: 'certifiedValue', 
      headerName: 'Cert. Value', 
      width: 120, 
      type: 'numericColumn',
      valueFormatter: params => formatCurrency(params.value),
      cellClass: 'font-bold text-green-600 dark:text-green-400'
    }
  ], [selectedInvoice, selectedSubcontract]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden">
      {/* Toolbar */}
      <div className="p-6 border-b border-gray-100 dark:border-white/10 flex justify-between items-center bg-gray-50/50 dark:bg-white/5 shrink-0">
        <div>
          <h3 className="text-xl font-bold dark:text-white">Invoicing</h3>
          <p className="text-sm text-gray-900 dark:text-gray-400">Manage subcontractor claims, certifications, and payments.</p>
        </div>
        <div className="flex gap-2">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImport} 
            accept=".xlsx,.xls" 
            className="hidden" 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
            title="Import Excel"
          >
            <Upload className="w-5 h-5" />
          </button>
          <button 
            onClick={handleExport}
            className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
            title="Export Excel"
          >
            <Download className="w-5 h-5" />
          </button>
          
          <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
          
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              type="text"
              placeholder="Search invoices..."
              className="pl-10 pr-4 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none w-64 dark:text-white"
            />
          </div>
          
          <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />

          <Button 
            onClick={() => setIsAddingInvoice(true)}
            className="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-xl text-sm font-bold flex items-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-black/10"
          >
            <Plus className="w-4 h-4" />
            Create Invoice
          </Button>
        </div>
      </div>

      {/* Import Preview Modal */}
      <AnimatePresence>
        {importPreview && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-[#1a1a1a] rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden border border-gray-200 dark:border-white/10"
            >
              <div className="p-8 border-b border-gray-100 dark:border-white/5 flex justify-between items-center bg-gray-50/50 dark:bg-white/5">
                <div>
                  <h2 className="text-2xl font-bold dark:text-white uppercase tracking-tight">Review Invoices Import</h2>
                  <p className="text-sm text-gray-500 mt-1 uppercase font-bold tracking-widest opacity-60">Review data before final processing</p>
                </div>
                {hasImportDuplicates && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-500/10 text-red-600 rounded-xl animate-pulse">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">Duplicates detected: {duplicateIds.length}</span>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-auto p-8">
                {hasImportDuplicates && (
                  <div className="mb-6 p-6 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl">
                    <h3 className="text-red-800 dark:text-red-400 font-bold text-sm uppercase tracking-widest mb-4">Duplicate Invoices Detected in file</h3>
                    <p className="text-xs text-red-600 dark:text-red-400/80 mb-4 uppercase tracking-wider font-medium leading-relaxed">
                      The following duplicate (Subcontract + Invoice No) combinations were found in your Excel file. Duplicates are NOT allowed. Please resolve these in your Excel file before importing.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {duplicateIds.map(id => (
                        <span key={id} className="px-3 py-1 bg-white dark:bg-black/40 text-red-600 text-[10px] font-mono font-bold rounded-lg border border-red-200 dark:border-red-500/30">
                          {id}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <table className="w-full text-left border-collapse rounded-2xl overflow-hidden">
                  <thead>
                    <tr className="bg-gray-100 dark:bg-white/5">
                      {Object.keys(importPreview.data[0] || {}).map(key => (
                        <th key={key} className="px-4 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-200 dark:border-white/10">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.data.map((row, i) => {
                      const orderId = String(row['Order ID'] || row.orderId || '').trim();
                      const invoiceNo = String(row['Invoice No.'] || row.invoiceId || '').trim();
                      const key = `${orderId.toLowerCase()}_${invoiceNo.toLowerCase()}`;
                      const isDup = duplicateIds.includes(key);

                      return (
                        <tr key={i} className={cn(
                          "border-b border-gray-100 dark:border-white/5",
                          isDup ? "bg-red-50/50 dark:bg-red-500/10" : ""
                        )}>
                          {Object.values(row).map((val: any, j) => (
                            <td key={j} className="px-4 py-4 text-xs dark:text-gray-300 font-medium">
                              {val instanceof Date ? val.toLocaleDateString() : String(val)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="p-8 bg-gray-50 dark:bg-white/5 border-t border-gray-100 dark:border-white/10 flex gap-4">
                <button 
                  onClick={() => setImportPreview(null)}
                  className="flex-1 py-4 border border-gray-200 dark:border-white/10 rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-white/5 transition-colors dark:text-white"
                >
                  Cancel
                </button>
                <button 
                  onClick={completeImport}
                  disabled={hasImportDuplicates}
                  className="flex-[2] py-4 bg-black dark:bg-white text-white dark:text-black rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-black/90 dark:hover:bg-white/90 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  Complete Import ({importPreview.data.length} records)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content - Top/Bottom Split */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Table: Invoices */}
        <div className={cn(
          "flex flex-col transition-all duration-500 ease-in-out overflow-hidden",
          selectedInvoiceId 
            ? (isMainTableCollapsed ? "h-[60px]" : "h-[40%]") 
            : "flex-1"
        )}>
          <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
            <div className="flex items-center gap-2">
              <Hash className="w-4 h-4 text-gray-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Invoices</span>
            </div>
            {selectedInvoiceId && (
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
                rowData={selectedInvoiceId ? invoices.filter(i => i.id === selectedInvoiceId) : invoices}
                columnDefs={invoiceColumnDefs}
                onRowClicked={(params) => setSelectedInvoiceId(params.data.id)}
                rowSelection="single"
                animateRows={true}
                pagination={true}
                paginationPageSize={20}
              />
            </div>
          </div>
        </div>

        {/* Bottom Table: Invoice Items */}
        <AnimatePresence>
          {selectedInvoiceId && selectedInvoice && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ 
                height: isMainTableCollapsed ? 'calc(100% - 60px)' : '60%', 
                opacity: 1 
              }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0a0a0a] flex flex-col overflow-hidden"
            >
              <div className="p-4 flex items-center justify-between bg-white dark:bg-[#141414] border-b border-gray-200 dark:border-white/10">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    <h3 className="font-bold dark:text-white">Invoice Items: <span className="text-blue-600">INV-{selectedInvoice.invoiceId}</span></h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedInvoice.status === 'Draft' && (
                      <Button 
                        size="sm"
                        onClick={() => updateInvoiceStatus('Submitted')}
                        className="h-8 bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <Send className="w-3.5 h-3.5 mr-1.5" /> Submit Claim
                      </Button>
                    )}
                    {selectedInvoice.status === 'Submitted' && (
                      <div className="flex items-center gap-2">
                        <Button 
                          size="sm"
                          onClick={() => updateInvoiceStatus('Certified')}
                          className="h-8 bg-green-600 hover:bg-green-700 text-white"
                        >
                          <CheckCircle className="w-3.5 h-3.5 mr-1.5" /> Certify
                        </Button>
                        <Button 
                          size="sm"
                          variant="destructive"
                          onClick={() => updateInvoiceStatus('Rejected')}
                          className="h-8"
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1.5" /> Reject
                        </Button>
                      </div>
                    )}
                    {selectedInvoice.status === 'Certified' && (
                      <Button 
                        size="sm"
                        onClick={() => updateInvoiceStatus('Paid')}
                        className="h-8 bg-purple-600 hover:bg-purple-700 text-white"
                      >
                        <CreditCard className="w-3.5 h-3.5 mr-1.5" /> Mark as Paid
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Claimed</p>
                    <p className="text-sm font-bold text-blue-600 dark:text-blue-400">{formatCurrency(selectedInvoice.totalAmount)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Certified</p>
                    <p className="text-sm font-bold text-green-600 dark:text-green-400">{formatCurrency(selectedInvoice.certifiedAmount)}</p>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => setSelectedInvoiceId(null)}
                    className="h-8 text-xs"
                  >
                    Close
                  </Button>
                </div>
              </div>
              <div className="flex-1 min-h-0 relative">
                <div className={cn(
                  "absolute inset-0 ag-theme-quartz",
                  theme === 'dark' ? "ag-theme-quartz-dark" : ""
                )}>
                  <AgGridReact
                    ref={itemsGridRef}
                    rowData={selectedInvoice.items || []}
                    columnDefs={itemColumnDefs}
                    animateRows={true}
                    singleClickEdit={true}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Add Invoice Modal */}
      {isAddingInvoice && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold dark:text-white">Create New Invoice</h2>
              <button onClick={() => setIsAddingInvoice(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full">
                <Plus className="w-5 h-5 rotate-45 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleAddInvoice} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Subcontract</label>
                <select 
                  value={invoiceFormData.subcontractId}
                  onChange={e => setInvoiceFormData({ ...invoiceFormData, subcontractId: e.target.value })}
                  className="w-full p-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                  required
                >
                  <option value="">Select Subcontract</option>
                  {subcontracts.map(s => (
                    <option key={s.id} value={s.id}>{s.orderId} - {s.orderName}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Description</label>
                <Input 
                  value={invoiceFormData.description}
                  onChange={e => setInvoiceFormData({ ...invoiceFormData, description: e.target.value })}
                  placeholder="e.g. Claim for October 2026"
                  required
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="ghost" onClick={() => setIsAddingInvoice(false)}>Cancel</Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white">Create Invoice</Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
