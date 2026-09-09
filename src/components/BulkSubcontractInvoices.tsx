import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Project, Enterprise, Invoice, Subcontract } from '../types';
import { subscribeToTable } from '../lib/supabase';
import {
  fetchInvoiceSummaries, fetchSubcontractSummaries, deleteInvoices,
  bulkUpdateInvoices, bulkSetInvoiceClaimPercent, updateInvoice, importInvoices,
} from '../lib/subcontracts';
import DataGridModule from './DataGridModule';
import { ColDef, ColGroupDef, CellValueChangedEvent, ValueFormatterParams } from 'ag-grid-community';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { formatCurrency, formatDate, dateToISO } from '../lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface BulkSubcontractInvoicesProps {
  project: Project;
  enterprise: Enterprise;
}

interface FlattenedInvoice extends Invoice {
  orderId: string;
  orderName: string;
  periodicClaimed: number;
  periodicCertified: number;
}

const BulkSubcontractInvoices: React.FC<BulkSubcontractInvoicesProps> = ({ project, enterprise }) => {
  // Rows come from invoice_summary: the order, the vendor and the this-period
  // totals are already joined and aggregated. The subcontracts are kept only
  // to resolve an Order ID on import.
  const [rowData, setRowData] = useState<FlattenedInvoice[]>([]);
  const [subcontracts, setSubcontracts] = useState<Subcontract[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkUpdateOpen, setIsBulkUpdateOpen] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [quickFilterText, setQuickFilterText] = useState('');
  const gridRef = useRef<any>(null);

  const [bulkUpdateData, setBulkUpdateData] = useState({
    status: '',
    initiator: '',
    submittedDate: '',
    certifiedDate: '',
    paymentDate: '',
    claimPercent: '',
    certifiedPercent: '',
  });

  const reload = useCallback(async () => {
    try {
      setRowData(await fetchInvoiceSummaries(project.id) as any);
    } catch (error: any) {
      console.error('BulkSubcontractInvoices: invoices fetch error:', error);
      toast.error(`Failed to load invoices: ${error?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    if (!project.id) return;
    void reload();

    const loadSubcontracts = async () => {
      try {
        setSubcontracts(await fetchSubcontractSummaries(project.id));
      } catch (error) {
        console.error('BulkSubcontractInvoices: subcontracts fetch error:', error);
      }
    };
    void loadSubcontracts();

    const unsubInv = subscribeToTable('invoices', `project_id=eq.${project.id}`, () => void reload());
    // An item's periodic figures roll up into the row's totals.
    const unsubItems = subscribeToTable('invoice_items', undefined, () => void reload());
    const unsubSub = subscribeToTable('subcontracts', `project_id=eq.${project.id}`, () => {
      void loadSubcontracts();
      void reload();
    });

    return () => { unsubInv(); unsubItems(); unsubSub(); };
  }, [project.id, reload]);

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      // One statement. Each invoice's items cascade, and the subcontracts'
      // positions follow.
      await deleteInvoices(selectedIds);
      await reload();
      toast.success(`Deleted ${selectedIds.length} invoices.`);
      setSelectedIds([]);
      setIsBulkDeleteOpen(false);
    } catch (error: any) {
      console.error('Bulk delete error:', error);
      toast.error(`Failed to delete invoices: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleExport = () => {
    try {
      const exportData = rowData.map(inv => ({
        'Order ID': inv.orderId,
        'Order Name': inv.orderName,
        'Invoice No.': inv.invoiceId,
        'Description': inv.description,
        'Status': inv.status,
        'Initiator': inv.initiator,
        'Submitted Date': inv.submittedDate,
        'Certified Date': inv.certifiedDate,
        'Payment Date': inv.paymentDate,
        'Claimed Amount': inv.periodicClaimed,
        'Certified Amount': inv.periodicCertified,
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Invoices');
      XLSX.writeFile(wb, `Bulk_Invoices_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('Export successful');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export invoices.');
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedIds.length === 0) return;
    try {
      const header: any = {};
      if (bulkUpdateData.status) header.status = bulkUpdateData.status;
      if (bulkUpdateData.initiator) header.initiator = bulkUpdateData.initiator;
      if (bulkUpdateData.submittedDate) header.submittedDate = bulkUpdateData.submittedDate;
      if (bulkUpdateData.certifiedDate) header.certifiedDate = bulkUpdateData.certifiedDate;
      if (bulkUpdateData.paymentDate) header.paymentDate = bulkUpdateData.paymentDate;

      if (Object.keys(header).length > 0) {
        await bulkUpdateInvoices(selectedIds, header);
      }

      // The percentages apply to every item of every selected invoice. The
      // quantities and values follow from them inside the database, measured
      // from what the previous invoice certified; this used to be worked out
      // in the browser and written back as whole item arrays.
      if (bulkUpdateData.claimPercent || bulkUpdateData.certifiedPercent) {
        await bulkSetInvoiceClaimPercent(selectedIds, {
          periodicClaimPercent: bulkUpdateData.claimPercent !== '' ? Number(bulkUpdateData.claimPercent) : undefined,
          periodicCertifiedPercent: bulkUpdateData.certifiedPercent !== '' ? Number(bulkUpdateData.certifiedPercent) : undefined,
        });
      }

      await reload();
      toast.success(`Updated ${selectedIds.length} invoices.`);
      setSelectedIds([]);
      setIsBulkUpdateOpen(false);
      setBulkUpdateData({ status: '', initiator: '', submittedDate: '', certifiedDate: '', paymentDate: '', claimPercent: '', certifiedPercent: '' });
    } catch (error: any) {
      console.error('Bulk update error:', error);
      toast.error(`Failed to update invoices: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleCellValueChanged = async (event: CellValueChangedEvent) => {
    const { data, colDef, newValue, oldValue } = event;
    if (newValue === oldValue) return;
    const field = colDef.field!;

    // The claimed and certified columns are sums of the invoice's items, so
    // they are not editable here -- typing over a total would leave it
    // disagreeing with the items it is a sum of. They are edited on the
    // invoice's own items grid.
    if (field === 'periodicClaimed' || field === 'periodicCertified' ||
        field === 'totalAmount' || field === 'certifiedAmount') {
      toast.error('Claimed and certified amounts come from the invoice\u2019s items. Edit them on the invoice.');
      await reload();
      return;
    }

    try {
      await updateInvoice(data.id, {
        [field]: (newValue instanceof Date) ? dateToISO(newValue) : newValue,
      } as any);
      await reload();
      toast.success('Invoice updated successfully');
    } catch (error: any) {
      console.error('Error updating invoice:', error);
      toast.error(`Failed to update invoice: ${error?.message || 'Unknown error'}`);
      await reload();
    }
  };

  /**
   * Import invoice headers from a sheet.
   *
   * There were two copies of this, one behind the file input and one behind
   * the grid's import button, differing only in which spelling of each column
   * they accepted. Both are this.
   */
  const importFromSheet = async (excelData: any[]) => {
    const toastId = toast.loading('Importing invoices...');
    try {
      if (excelData.length === 0) {
        toast.error('The Excel file is empty.', { id: toastId });
        return;
      }

      const pick = (row: any, ...keys: string[]) => {
        for (const k of keys) if (row[k] !== undefined && row[k] !== '') return row[k];
        return undefined;
      };
      const asDate = (v: any) => (v ? dateToISO(new Date(v)) : undefined);

      // A sheet that names the same invoice twice would have the second row
      // silently win, so it is refused instead.
      const seen = new Set<string>();
      const duplicates: string[] = [];
      const rows: any[] = [];
      const unknownOrders = new Set<string>();

      excelData.forEach(row => {
        const orderId = String(pick(row, 'Order ID', 'orderId') || '').trim();
        const invoiceNo = String(pick(row, 'Invoice No.', 'invoiceId') || '').trim();
        if (!orderId || !invoiceNo) return;

        const key = `${orderId.toLowerCase()}_${invoiceNo.toLowerCase()}`;
        if (seen.has(key)) { duplicates.push(key); return; }
        seen.add(key);

        const targetSub = subcontracts.find(sub => sub.orderId === orderId);
        if (!targetSub) { unknownOrders.add(orderId); return; }

        rows.push({
          subcontractId: targetSub.id,
          invoiceId: invoiceNo,
          description: String(pick(row, 'Description', 'description') || ''),
          status: pick(row, 'Status', 'status') || 'Draft',
          initiator: String(pick(row, 'Initiator', 'initiator') || ''),
          vendorId: targetSub.vendorId || undefined,
          submittedDate: asDate(pick(row, 'Submitted Date', 'submittedDate')),
          certifiedDate: asDate(pick(row, 'Certified Date', 'certifiedDate')),
          paymentDate: asDate(pick(row, 'Payment Date', 'paymentDate')),
        });
      });

      if (duplicates.length > 0) {
        toast.error(`Duplicate invoices found in file: ${duplicates.join(', ')}`, { id: toastId });
        return;
      }
      if (rows.length === 0) {
        toast.error(
          unknownOrders.size > 0
            ? `No rows imported. Unknown orders: ${Array.from(unknownOrders).join(', ')}`
            : 'No rows in the sheet carried an Order ID and an Invoice No.',
          { id: toastId }
        );
        return;
      }

      // One statement, whatever the size of the sheet. This used to be split
      // into batches of 400 because Firestore capped a batch at 500 writes.
      const imported = await importInvoices(project.id, rows);
      await reload();
      toast.success(
        unknownOrders.size > 0
          ? `Imported ${imported} invoices. Unknown orders skipped: ${Array.from(unknownOrders).join(', ')}`
          : `Imported ${imported} invoices.`,
        { id: toastId }
      );
    } catch (error: any) {
      console.error('Import error:', error);
      toast.error(`Failed to import invoices: ${error?.message || 'Unknown error'}`, { id: toastId });
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const wb = XLSX.read(evt.target?.result, { type: 'binary', cellDates: true });
      await importFromSheet(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[]);
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const columnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    return [
      {
        headerName: 'Subcontract',
        children: [
          { field: 'orderId', headerName: 'Order ID', width: 120, enableRowGroup: true, editable: false, sort: 'asc', sortIndex: 0 },
          { field: 'orderName', headerName: 'Order Name', width: 150, enableRowGroup: true, editable: false },
          { field: 'vendorName', headerName: 'Vendor Name', width: 150, enableRowGroup: true, editable: false },
        ]
      },
      {
        headerName: 'Invoice Details',
        children: [
          { 
            field: 'invoiceId', 
            headerName: 'Invoice No.', 
            width: 120, 
            editable: true, 
            sort: 'asc', 
            sortIndex: 1,
            checkboxSelection: true,
            headerCheckboxSelection: true,
            headerCheckboxSelectionFilteredOnly: true,
          },
          { field: 'description', headerName: 'Invoice Name', flex: 1, minWidth: 200, editable: true },
          { 
            field: 'status', 
            headerName: 'Status', 
            width: 120, 
            editable: true,
            enableRowGroup: true,
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: {
              values: ['Draft', 'Submitted', 'Certified', 'Rejected', 'Paid']
            }
          },
          { field: 'initiator', headerName: 'Initiator', width: 150, editable: true },
        ]
      },
      {
        headerName: 'Dates',
        children: [
          { 
            field: 'submittedDate', 
            headerName: 'Submit Date', 
            width: 130, 
            editable: true, 
            cellEditor: 'agDateCellEditor',
            valueFormatter: params => formatDate(params.value)
          },
          { 
            field: 'certifiedDate', 
            headerName: 'Approved Date', 
            width: 130, 
            editable: true, 
            cellEditor: 'agDateCellEditor',
            valueFormatter: params => formatDate(params.value)
          },
          { 
            field: 'paymentDate', 
            headerName: 'Payment Date', 
            width: 130, 
            editable: true, 
            cellEditor: 'agDateCellEditor',
            valueFormatter: params => formatDate(params.value)
          },
        ]
      },
      {
        headerName: 'Financials',
        children: [
          { 
            field: 'periodicClaimed', 
            headerName: 'Claimed Amount', 
            width: 140, 
            editable: true, 
            type: 'numericColumn', 
            valueGetter: params => params.node?.rowPinned === 'top' ? params.data.periodicClaimed : (params.data.totalAmount || 0),
            valueFormatter: (params: ValueFormatterParams) => formatCurrency(params.value) 
          },
          { 
            field: 'periodicCertified', 
            headerName: 'Certified Amount', 
            width: 140, 
            editable: true, 
            type: 'numericColumn', 
            valueGetter: params => params.node?.rowPinned === 'top' ? params.data.periodicCertified : (params.data.certifiedAmount || 0),
            valueFormatter: (params: ValueFormatterParams) => formatCurrency(params.value) 
          },
        ]
      }
    ];
  }, []);

  const pinnedBottomRowData = useMemo(() => {
    if (rowData.length === 0) return [];
    const totalClaimed = rowData.reduce((sum, row) => sum + (Number(row.periodicClaimed) || 0), 0);
    const totalCertified = rowData.reduce((sum, row) => sum + (Number(row.periodicCertified) || 0), 0);
    return [{
      invoiceId: 'GRAND TOTAL',
      periodicClaimed: totalClaimed,
      periodicCertified: totalCertified,
    }];
  }, [rowData]);

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading Bulk Invoices...</div>;
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <DataGridModule
        title="Bulk Subcontract Invoices"
        description="View and update invoices across all subcontracts for the project."
        rowData={rowData}
        columnDefs={columnDefs}
        pinnedBottomRowData={pinnedBottomRowData}
        gridRef={gridRef}
        onImportData={(excelData) => { void importFromSheet(excelData); }}
        selectedCount={selectedIds.length}
        onBulkUpdate={() => setIsBulkUpdateOpen(true)}
        onBulkDelete={() => setIsBulkDeleteOpen(true)}
        onExport={handleExport}
        quickFilterText={quickFilterText}
        onQuickFilterChange={setQuickFilterText}
        gridProps={{
          rowSelection: 'multiple',
          suppressRowClickSelection: true,
          onCellValueChanged: handleCellValueChanged,
          onSelectionChanged: (event: any) => {
            const selectedNodes = event.api.getSelectedNodes();
            setSelectedIds(selectedNodes.map((node: any) => node.data.id).filter(Boolean));
          },
          getRowClass: (params: any) => params.node.rowPinned ? 'pinned-row-highlight font-bold' : ''
        }}
      />

      <Dialog open={isBulkDeleteOpen} onOpenChange={setIsBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Bulk Delete</DialogTitle><DialogDescription>Delete {selectedIds.length} selected invoices? This cannot be undone.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleBulkDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkUpdateOpen} onOpenChange={setIsBulkUpdateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Bulk Update Invoices</DialogTitle><DialogDescription>Update {selectedIds.length} invoices. Only filled fields apply.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-gray-500">Status</label>
              <Select value={bulkUpdateData.status} onValueChange={(val) => setBulkUpdateData(prev => ({ ...prev, status: val }))}>
                <SelectTrigger><SelectValue placeholder="Select Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Draft">Draft</SelectItem>
                  <SelectItem value="Submitted">Submitted</SelectItem>
                  <SelectItem value="Certified">Certified</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                  <SelectItem value="Paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-gray-500">Initiator</label>
              <Input placeholder="Invoice Initiator" value={bulkUpdateData.initiator} onChange={(e) => setBulkUpdateData(prev => ({ ...prev, initiator: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-gray-500">Claim %</label>
                <Input type="number" placeholder="0.00" value={bulkUpdateData.claimPercent} onChange={(e) => setBulkUpdateData(prev => ({ ...prev, claimPercent: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-gray-500">Certified %</label>
                <Input type="number" placeholder="0.00" value={bulkUpdateData.certifiedPercent} onChange={(e) => setBulkUpdateData(prev => ({ ...prev, certifiedPercent: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-gray-500">Submit Date</label>
                <Input type="date" value={bulkUpdateData.submittedDate} onChange={(e) => setBulkUpdateData(prev => ({ ...prev, submittedDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-gray-500">Approved Date</label>
                <Input type="date" value={bulkUpdateData.certifiedDate} onChange={(e) => setBulkUpdateData(prev => ({ ...prev, certifiedDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-gray-500">Payment Date</label>
              <Input type="date" value={bulkUpdateData.paymentDate} onChange={(e) => setBulkUpdateData(prev => ({ ...prev, paymentDate: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkUpdateOpen(false)}>Cancel</Button>
            <Button onClick={handleBulkUpdate}>Apply Updates</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BulkSubcontractInvoices;
