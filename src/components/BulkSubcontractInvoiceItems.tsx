import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Project, Enterprise, Invoice, Subcontract } from '../types';
import { subscribeToTable } from '../lib/supabase';
import {
  fetchProjectInvoiceItemDetail, fetchSubcontractSummaries,
  bulkSetInvoiceClaimPercent, setInvoiceItemClaim, applyInvoiceItemClaims,
} from '../lib/subcontracts';
import DataGridModule from './DataGridModule';
import { ColDef, ColGroupDef, CellValueChangedEvent, ValueFormatterParams } from 'ag-grid-community';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { formatCurrency, formatNumber, formatDate, dateToISO } from '../lib/utils';
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

interface BulkSubcontractInvoiceItemsProps {
  project: Project;
  enterprise: Enterprise;
}

interface FlattenedInvoiceItem {
  id: string; // The inner item.id
  invoiceId: string; // The parent invoice doc ID
  parentInvoiceId: string; // the string invoice number (UI display)
  orderId: string;
  orderName: string;
  vendorName: string;
  subcontractStatus: string;
  subcontractLineItemId: string;
  itemNo: string;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  total: number;
  claimQty: number;
  claimPercent: number;
  claimValue: number;
  certifiedQty: number;
  certifiedPercent: number;
  certifiedValue: number;
  periodicClaimQty?: number;
  periodicClaimPercent?: number;
  periodicClaimValue?: number;
  periodicCertifiedQty?: number;
  periodicCertifiedPercent?: number;
  periodicCertifiedValue?: number;
}

const BulkSubcontractInvoiceItems: React.FC<BulkSubcontractInvoiceItemsProps> = ({ project, enterprise }) => {
  // Rows are invoice items, read from invoice_item_detail with their order and
  // invoice joined on. This used to load every invoice in the project and
  // flatten the item array inside each one.
  const [rowData, setRowData] = useState<FlattenedInvoiceItem[]>([]);
  const [subcontracts, setSubcontracts] = useState<Subcontract[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkUpdateOpen, setIsBulkUpdateOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<any>(null);

  const [bulkUpdateData, setBulkUpdateData] = useState({
    claimPercent: '',
    certifiedPercent: '',
  });

  const reload = useCallback(async () => {
    try {
      setRowData(await fetchProjectInvoiceItemDetail(project.id) as any);
    } catch (error: any) {
      console.error('BulkSubcontractInvoiceItems: invoice items fetch error:', error);
      toast.error(`Failed to load invoice items: ${error?.message || 'Unknown error'}`);
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
        console.error('BulkSubcontractInvoiceItems: subcontracts fetch error:', error);
      }
    };
    void loadSubcontracts();

    const unsubItems = subscribeToTable('invoice_items', undefined, () => void reload());
    const unsubInv = subscribeToTable('invoices', `project_id=eq.${project.id}`, () => void reload());
    const unsubSub = subscribeToTable('subcontracts', `project_id=eq.${project.id}`, () => {
      void loadSubcontracts();
      void reload();
    });

    return () => { unsubItems(); unsubInv(); unsubSub(); };
  }, [project.id, reload]);

  const handleBulkUpdate = async () => {
    if (selectedIds.length === 0) return;
    try {
      // Every selected item gets the same this-period percentage, and the
      // quantities and values follow from it in the database, measured from
      // what the previous invoice certified.
      //
      // The browser could not do that: it had no access to the previous
      // invoice from this grid, so it set the periodic fields and left the
      // cumulative ones stale -- its own comment said it "can only guess".
      const claimPercent = bulkUpdateData.claimPercent !== '' ? Number(bulkUpdateData.claimPercent) : undefined;
      const certifiedPercent = bulkUpdateData.certifiedPercent !== '' ? Number(bulkUpdateData.certifiedPercent) : undefined;
      if (claimPercent === undefined && certifiedPercent === undefined) {
        toast.error('Enter a claim or certified percentage.');
        return;
      }

      const edits: Array<{ id: string; field: string; value: number }> = [];
      selectedIds.forEach(id => {
        if (claimPercent !== undefined) edits.push({ id, field: 'periodicClaimPercent', value: claimPercent });
        if (certifiedPercent !== undefined) edits.push({ id, field: 'periodicCertifiedPercent', value: certifiedPercent });
      });

      const applied = await applyInvoiceItemClaims(edits);
      await reload();
      toast.success(`Updated ${selectedIds.length} invoice items (${applied} edits).`);
      setSelectedIds([]);
      setIsBulkUpdateOpen(false);
      setBulkUpdateData({ claimPercent: '', certifiedPercent: '' });
    } catch (error: any) {
      console.error('Bulk update error:', error);
      toast.error(`Failed to update items: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleCellValueChanged = async (event: CellValueChangedEvent) => {
    const { data, colDef, newValue, oldValue } = event;
    if (newValue === oldValue) return;
    const field = colDef.field!;

    try {
      // One of the twelve claim / certification figures; the rest follow in
      // the database. The six derivations that used to live here worked from
      // the item's own total and rate only, so the cumulative columns went
      // stale whenever a periodic one was edited.
      await setInvoiceItemClaim(data.id, field, Number(newValue) || 0);
      await reload();
      toast.success('Item updated');
    } catch (error: any) {
      console.error('Error updating item:', error);
      toast.error(`Failed to update item: ${error?.message || 'Unknown error'}`);
      await reload();
    }
  };

  /**
   * Import claim figures from a sheet.
   *
   * There were two copies of this, differing only in which spellings of the
   * column headings they accepted and in whether they read percentages or
   * values. Both are this.
   *
   * A sheet row names its order, invoice and item; that identifies the row.
   * Whichever figure the sheet supplies is what is sent, and the other eleven
   * are derived in the database -- which is also the correctness fix, since
   * neither copy could work out the cumulative figures from this grid.
   */
  const importFromSheet = async (excelData: any[]) => {
    const toastId = toast.loading('Importing invoice items...');
    try {
      if (excelData.length === 0) {
        toast.error('The Excel file is empty.', { id: toastId });
        return;
      }

      const pick = (row: any, ...keys: string[]) => {
        for (const k of keys) if (row[k] !== undefined && row[k] !== '') return row[k];
        return undefined;
      };

      const byKey = new Map<string, FlattenedInvoiceItem>();
      rowData.forEach(r => byKey.set(
        `${r.orderId}\u0000${r.parentInvoiceId}\u0000${r.itemNo}`.toLowerCase(), r));

      const seen = new Set<string>();
      const duplicates: string[] = [];
      const unmatched: string[] = [];
      const edits: Array<{ id: string; field: string; value: number }> = [];

      excelData.forEach(row => {
        const orderId = String(pick(row, 'Order ID', 'orderId') || '').trim();
        const invoiceNo = String(pick(row, 'Invoice No.', 'invoiceId') || '').trim();
        const itemNo = String(pick(row, 'Item No', 'Item No.', 'itemNo') || '').trim();
        if (!orderId || !invoiceNo || !itemNo) return;

        const key = `${orderId}\u0000${invoiceNo}\u0000${itemNo}`.toLowerCase();
        if (seen.has(key)) { duplicates.push(`${orderId} / ${invoiceNo} / ${itemNo}`); return; }
        seen.add(key);

        const target = byKey.get(key);
        if (!target) { unmatched.push(`${orderId} / ${invoiceNo} / ${itemNo}`); return; }

        // A percentage takes precedence over a value, as it did before.
        const claimPct = pick(row, 'Claim %', 'periodicClaimPercent');
        const claimVal = pick(row, 'Claim Value', 'periodicClaimValue');
        if (claimPct !== undefined) {
          edits.push({ id: target.id, field: 'periodicClaimPercent', value: Number(claimPct) || 0 });
        } else if (claimVal !== undefined) {
          edits.push({ id: target.id, field: 'periodicClaimValue', value: Number(claimVal) || 0 });
        }

        const certPct = pick(row, 'Certified %', 'periodicCertifiedPercent');
        const certVal = pick(row, 'Certified Value', 'periodicCertifiedValue');
        if (certPct !== undefined) {
          edits.push({ id: target.id, field: 'periodicCertifiedPercent', value: Number(certPct) || 0 });
        } else if (certVal !== undefined) {
          edits.push({ id: target.id, field: 'periodicCertifiedValue', value: Number(certVal) || 0 });
        }
      });

      if (duplicates.length > 0) {
        toast.error(`Duplicate items found in file: ${duplicates.join(', ')}`, { id: toastId });
        return;
      }
      if (edits.length === 0) {
        toast.error(
          unmatched.length > 0
            ? `No rows imported. Not found: ${unmatched.slice(0, 5).join(', ')}`
            : 'No rows in the sheet carried a claim or certified figure.',
          { id: toastId }
        );
        return;
      }

      // One call. This used to be split into batches of 400 because Firestore
      // capped a batch at 500 writes.
      const applied = await applyInvoiceItemClaims(edits);
      await reload();
      toast.success(
        unmatched.length > 0
          ? `Applied ${applied} edits. Not found: ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? ` and ${unmatched.length - 5} more` : ''}`
          : `Applied ${applied} edits.`,
        { id: toastId }
      );
    } catch (error: any) {
      console.error('Import error:', error);
      toast.error(`Failed to import invoice items: ${error?.message || 'Unknown error'}`, { id: toastId });
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
        headerName: 'Invoice Root',
        children: [
          { field: 'orderId', headerName: 'Order ID', width: 120, enableRowGroup: true, editable: false, sort: 'asc', sortIndex: 0 },
          { field: 'vendorName', headerName: 'Vendor Name', width: 150, enableRowGroup: true, editable: false },
          { field: 'parentInvoiceId', headerName: 'Invoice No.', width: 120, enableRowGroup: true, editable: false, sort: 'asc', sortIndex: 1 },
        ]
      },
      {
        headerName: 'Item Info',
        children: [
          { 
            field: 'itemNo', 
            headerName: 'Item No', 
            width: 100, 
            editable: false, 
            sort: 'asc', 
            sortIndex: 2,
            checkboxSelection: true,
            headerCheckboxSelection: true,
            headerCheckboxSelectionFilteredOnly: true,
          },
          { field: 'description', headerName: 'Description', flex: 1, minWidth: 200, editable: false },
        ]
      },
      {
        headerName: 'Contract Value',
        children: [
          { field: 'qty', headerName: 'Qty', width: 90, editable: false, type: 'numericColumn', valueFormatter: p => formatNumber(p.value) },
          { field: 'unit', headerName: 'Unit', width: 80, editable: false },
          { field: 'rate', headerName: 'Rate', width: 110, editable: false, type: 'numericColumn', valueFormatter: p => formatCurrency(p.value) },
          { field: 'total', headerName: 'Total', width: 120, editable: false, type: 'numericColumn', valueFormatter: p => formatCurrency(p.value) },
        ]
      },
      {
        headerName: 'Claim Amount',
        children: [
          { field: 'periodicClaimQty', headerName: 'Period Qty', width: 100, editable: true, type: 'numericColumn', valueFormatter: p => formatNumber(p.value) },
          { field: 'periodicClaimPercent', headerName: 'Period %', width: 120, editable: true, type: 'numericColumn', valueFormatter: params => params.value ? `${Number(params.value).toFixed(2)}%` : '0%' },
          { field: 'periodicClaimValue', headerName: 'Period Value', width: 120, editable: true, type: 'numericColumn', valueFormatter: params => formatCurrency(params.value) },
        ]
      },
      {
        headerName: 'Certified Amount',
        children: [
          { field: 'periodicCertifiedQty', headerName: 'Period Qty', width: 100, editable: true, type: 'numericColumn', valueFormatter: p => formatNumber(p.value) },
          { field: 'periodicCertifiedPercent', headerName: 'Period %', width: 120, editable: true, type: 'numericColumn', valueFormatter: params => params.value ? `${Number(params.value).toFixed(2)}%` : '0%' },
          { field: 'periodicCertifiedValue', headerName: 'Period Value', width: 120, editable: true, type: 'numericColumn', valueFormatter: params => formatCurrency(params.value) },
        ]
      }
    ];
  }, []);

  const pinnedBottomRowData = useMemo(() => {
    if (rowData.length === 0) return [];
    return [{
      itemNo: 'GRAND TOTAL',
      total: rowData.reduce((sum, r) => sum + (Number(r.total) || 0), 0),
      periodicClaimValue: rowData.reduce((sum, r) => sum + (Number(r.periodicClaimValue) || 0), 0),
      periodicCertifiedValue: rowData.reduce((sum, r) => sum + (Number(r.periodicCertifiedValue) || 0), 0),
    }];
  }, [rowData]);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading Invoice Items...</div>;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <DataGridModule
        title="Bulk Subcontract Invoice Items"
        description="View and update claimed and certified amounts per line item across all invoices."
        rowData={rowData}
        columnDefs={columnDefs}
        pinnedBottomRowData={pinnedBottomRowData}
        gridRef={gridRef}
        onImportData={(excelData) => { void importFromSheet(excelData); }}
        selectedCount={selectedIds.length}
        onBulkUpdate={() => setIsBulkUpdateOpen(true)}
        gridProps={{
          rowSelection: 'multiple',
          suppressRowClickSelection: true,
          onCellValueChanged: handleCellValueChanged,
          onSelectionChanged: (e: any) => setSelectedIds(e.api.getSelectedNodes().map((n: any) => n.data.id).filter(Boolean)),
          getRowClass: (p: any) => p.node.rowPinned ? 'pinned-row-highlight font-bold' : ''
        }}
      />
      <input type="file" ref={fileInputRef} onChange={onFileChange} accept=".xlsx, .xls" className="hidden" />

      <Dialog open={isBulkUpdateOpen} onOpenChange={setIsBulkUpdateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Bulk Update Items</DialogTitle><DialogDescription>Update {selectedIds.length} items. Entering a percentage will recalculate totals and quantities.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-gray-500">Claim %</label>
              <Input type="number" placeholder="0.00" value={bulkUpdateData.claimPercent} onChange={(e) => setBulkUpdateData(prev => ({ ...prev, claimPercent: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-gray-500">Certified %</label>
              <Input type="number" placeholder="0.00" value={bulkUpdateData.certifiedPercent} onChange={(e) => setBulkUpdateData(prev => ({ ...prev, certifiedPercent: e.target.value }))} />
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

export default BulkSubcontractInvoiceItems;
