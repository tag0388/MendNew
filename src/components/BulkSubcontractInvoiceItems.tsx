import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Project, Enterprise, Invoice, Subcontract } from '../types';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, writeBatch } from 'firebase/firestore';
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
  const [invoices, setInvoices] = useState<Invoice[]>([]);
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

  useEffect(() => {
    if (!project.id) return;
    const qSub = query(collection(db, 'subcontracts'), where('projectId', '==', project.id));
    const unsubSub = onSnapshot(qSub, (snapshot) => {
      setSubcontracts(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Subcontract)));
    }, (error) => {
      console.error("BulkSubcontractInvoiceItems: subcontracts fetch error:", error);
      toast.error("Failed to load subcontracts: " + error.message);
      setLoading(false);
    });

    const qInv = query(collection(db, 'invoices'), where('projectId', '==', project.id));
    const unsubInv = onSnapshot(qInv, (snapshot) => {
      setInvoices(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Invoice)));
      setLoading(false);
    }, (error) => {
      console.error("BulkSubcontractInvoiceItems: invoices fetch error:", error);
      toast.error("Failed to load invoices: " + error.message);
      setLoading(false);
    });

    return () => {
      unsubSub();
      unsubInv();
    };
  }, [project.id]);

  const rowData = useMemo(() => {
    const items: FlattenedInvoiceItem[] = [];
    invoices.forEach(inv => {
      const sub = subcontracts.find(s => s.id === inv.subcontractId);
      if (inv.items) {
        inv.items.forEach(li => {
          items.push({
            ...li,
            invoiceId: inv.id,
            parentInvoiceId: inv.invoiceId,
            orderId: sub?.orderId || 'Unknown',
            orderName: sub?.orderName || 'Unknown',
            vendorName: sub?.vendorName || 'Unknown',
            subcontractStatus: sub?.status || 'Unknown',
          });
        });
      }
    });

    return items.sort((a, b) => {
      const subCmp = (a.orderId || '').localeCompare(b.orderId || '');
      if (subCmp !== 0) return subCmp;
      const invCmp = (a.parentInvoiceId || '').localeCompare(b.parentInvoiceId || '', undefined, { numeric: true });
      if (invCmp !== 0) return invCmp;
      return (a.itemNo || '').localeCompare(b.itemNo || '', undefined, { numeric: true });
    });
  }, [invoices, subcontracts]);

  const handleBulkUpdate = async () => {
    if (selectedIds.length === 0) return;
    try {
      const batch = writeBatch(db);
      const invoicesToUpdate = new Map<string, Invoice>();

      // To calculate cumulative correctly, we'd need previous invoice data
      // For simplicity in bulk update, we'll assume the user is updating the periodic value
      // and we'll let Subcontracts.tsx or a later sync handle full cumulative re-calc if needed.
      // However, we MUST at least update the local periodic fields.

      selectedIds.forEach(id => {
        const row = rowData.find(r => r.id === id);
        if (!row) return;

        let inv = invoicesToUpdate.get(row.invoiceId) || invoices.find(i => i.id === row.invoiceId);
        if (!inv) return;

        if (!invoicesToUpdate.has(row.invoiceId)) {
          inv = { ...inv, items: inv.items.map(it => ({ ...it })) };
        }

        inv!.items = inv!.items.map(it => {
          if (it.id === id) {
            const updated = { ...it };
            const totalLine = updated.total || 0;
            
            if (bulkUpdateData.claimPercent !== '') {
              updated.periodicClaimPercent = Number(bulkUpdateData.claimPercent);
              updated.periodicClaimValue = (updated.periodicClaimPercent / 100) * totalLine;
              if (updated.rate > 0) updated.periodicClaimQty = updated.periodicClaimValue / updated.rate;
              // We should also update the cumulative claimValue if we want the invoice totalAmount to be correct
              // but without previous info we can only guess.
              // For now, let's keep totals consistent with periodic if user wants per-invoice view.
            }
            
            if (bulkUpdateData.certifiedPercent !== '') {
              updated.periodicCertifiedPercent = Number(bulkUpdateData.certifiedPercent);
              updated.periodicCertifiedValue = (updated.periodicCertifiedPercent / 100) * totalLine;
              if (updated.rate > 0) updated.periodicCertifiedQty = updated.periodicCertifiedValue / updated.rate;
            }
            return updated;
          }
          return it;
        });

        // If we update periodic, we should probably update the invoice total as the sum of periodic?
        // Actually, the user said totalAmount should be periodic.
        inv!.totalAmount = inv!.items.reduce((sum, item) => sum + (item.periodicClaimValue || 0), 0);
        inv!.certifiedAmount = inv!.items.reduce((sum, item) => sum + (item.periodicCertifiedValue || 0), 0);
        inv!.updatedAt = new Date().toISOString();
        invoicesToUpdate.set(row.invoiceId, inv!);
      });

      invoicesToUpdate.forEach((updatedInv, id) => {
        batch.update(doc(db, 'invoices', id), {
          items: updatedInv.items,
          totalAmount: updatedInv.totalAmount,
          certifiedAmount: updatedInv.certifiedAmount,
          updatedAt: updatedInv.updatedAt
        });
      });

      await batch.commit();
      toast.success(`Updated ${selectedIds.length} invoice items.`);
      setSelectedIds([]);
      setIsBulkUpdateOpen(false);
      setBulkUpdateData({ claimPercent: '', certifiedPercent: '' });
    } catch (error) {
      console.error('Bulk update error:', error);
      toast.error('Failed to updates items.');
    }
  };

  const handleCellValueChanged = async (event: CellValueChangedEvent) => {
    const { data, colDef, newValue, oldValue } = event;
    if (newValue === oldValue) return;

    const invoiceDocId = data.invoiceId;
    const invoiceItemId = data.id;

    const invoice = invoices.find(i => i.id === invoiceDocId);
    if (!invoice) return;

    const field = colDef.field!;
    const updatedItems = invoice.items.map(item => {
      if (item.id === invoiceItemId) {
        const updatedItem = { ...item };
        (updatedItem as any)[field] = newValue;
        const totalLineAmount = updatedItem.total || 0;
        const rate = updatedItem.rate || 0;
        
        if (field === 'periodicClaimQty') {
          updatedItem.periodicClaimValue = (Number(updatedItem.periodicClaimQty) || 0) * rate;
          if (totalLineAmount > 0) updatedItem.periodicClaimPercent = (updatedItem.periodicClaimValue / totalLineAmount) * 100;
        } else if (field === 'periodicClaimPercent') {
          updatedItem.periodicClaimValue = (Number(updatedItem.periodicClaimPercent) / 100) * totalLineAmount;
          if (rate > 0) updatedItem.periodicClaimQty = updatedItem.periodicClaimValue / rate;
        } else if (field === 'periodicClaimValue') {
          if (totalLineAmount > 0) updatedItem.periodicClaimPercent = (Number(updatedItem.periodicClaimValue) / totalLineAmount) * 100;
          if (rate > 0) updatedItem.periodicClaimQty = Number(updatedItem.periodicClaimValue) / rate;
        } else if (field === 'periodicCertifiedQty') {
          updatedItem.periodicCertifiedValue = (Number(updatedItem.periodicCertifiedQty) || 0) * rate;
          if (totalLineAmount > 0) updatedItem.periodicCertifiedPercent = (updatedItem.periodicCertifiedValue / totalLineAmount) * 100;
        } else if (field === 'periodicCertifiedPercent') {
          updatedItem.periodicCertifiedValue = (Number(updatedItem.periodicCertifiedPercent) / 100) * totalLineAmount;
          if (rate > 0) updatedItem.periodicCertifiedQty = updatedItem.periodicCertifiedValue / rate;
        } else if (field === 'periodicCertifiedValue') {
          if (totalLineAmount > 0) updatedItem.periodicCertifiedPercent = (Number(updatedItem.periodicCertifiedValue) / totalLineAmount) * 100;
          if (rate > 0) updatedItem.periodicCertifiedQty = Number(updatedItem.periodicCertifiedValue) / rate;
        }
        return updatedItem;
      }
      return item;
    });

    const newClaimedTotal = updatedItems.reduce((sum, item) => sum + (item.periodicClaimValue || 0), 0);
    const newCertifiedTotal = updatedItems.reduce((sum, item) => sum + (item.periodicCertifiedValue || 0), 0);

    try {
      await updateDoc(doc(db, 'invoices', invoiceDocId), {
        items: updatedItems,
        totalAmount: newClaimedTotal,
        certifiedAmount: newCertifiedTotal,
        updatedAt: new Date().toISOString()
      });
      toast.success('Item updated');
    } catch (error) {
      console.error('Error updating item:', error);
      toast.error('Failed to update item.');
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const toastId = toast.loading('Reading file...');
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const excelData = XLSX.utils.sheet_to_json(ws) as any[];

        if (excelData.length === 0) {
          toast.dismiss(toastId);
          toast.error('The Excel file is empty.');
          return;
        }

        const invoicesToUpdate = new Map<string, Invoice>();

        toast.loading(`Processing ${excelData.length} items...`, { id: toastId });

        for (const row of excelData) {
          const orderId = String(row['Order ID'] || '').trim();
          const invoiceNo = String(row['Invoice No.'] || '').trim();
          const itemNo = String(row['Item No'] || '').trim();
          if (!orderId || !invoiceNo || !itemNo) continue;

          const targetSub = subcontracts.find(s => s.orderId === orderId);
          if (!targetSub) continue;

          // Note: Here we use the invoiceNo (string) which maps to multiple potential docs if not careful, 
          // but we filter by subcontract too.
          const invoiceDocKey = `${targetSub.id}_${invoiceNo}`;
          let inv = invoicesToUpdate.get(invoiceDocKey) || invoices.find(i => i.subcontractId === targetSub.id && i.invoiceId === invoiceNo);
          if (!inv) continue;

          if (!invoicesToUpdate.has(invoiceDocKey)) {
            inv = { ...inv, items: inv.items.map(it => ({ ...it })) };
          }

          inv!.items = inv!.items.map(it => {
            if (it.itemNo === itemNo) {
              const updated = { ...it };
              const totalLine = updated.total || 0;
              
              if (row['Claim %'] !== undefined) {
                updated.periodicClaimPercent = Number(row['Claim %']);
                updated.periodicClaimValue = (updated.periodicClaimPercent / 100) * totalLine;
                if (updated.rate > 0) updated.periodicClaimQty = updated.periodicClaimValue / updated.rate;
              } else if (row['Claim Value'] !== undefined) {
                updated.periodicClaimValue = Number(row['Claim Value']);
                if (totalLine > 0) updated.periodicClaimPercent = (updated.periodicClaimValue / totalLine) * 100;
                if (updated.rate > 0) updated.periodicClaimQty = updated.periodicClaimValue / updated.rate;
              }
              
              if (row['Certified %'] !== undefined) {
                updated.periodicCertifiedPercent = Number(row['Certified %']);
                updated.periodicCertifiedValue = (updated.periodicCertifiedPercent / 100) * totalLine;
                if (updated.rate > 0) updated.periodicCertifiedQty = updated.periodicCertifiedValue / updated.rate;
              } else if (row['Certified Value'] !== undefined) {
                updated.periodicCertifiedValue = Number(row['Certified Value']);
                if (totalLine > 0) updated.periodicCertifiedPercent = (updated.periodicCertifiedValue / totalLine) * 100;
                if (updated.rate > 0) updated.periodicCertifiedQty = updated.periodicCertifiedValue / updated.rate;
              }
              return updated;
            }
            return it;
          });

          inv!.totalAmount = inv!.items.reduce((sum, item) => sum + (item.periodicClaimValue || 0), 0);
          inv!.certifiedAmount = inv!.items.reduce((sum, item) => sum + (item.periodicCertifiedValue || 0), 0);
          inv!.updatedAt = new Date().toISOString();
          invoicesToUpdate.set(invoiceDocKey, inv!);
        }

        if (invoicesToUpdate.size === 0) {
          toast.dismiss(toastId);
          toast.error('No matching invoices or items found.');
          return;
        }

        // Chunked updates
        const updateEntries = Array.from(invoicesToUpdate.values());
        const chunkSize = 450;
        const totalChunks = Math.ceil(updateEntries.length / chunkSize);

        for (let i = 0; i < totalChunks; i++) {
          const chunk = updateEntries.slice(i * chunkSize, (i + 1) * chunkSize);
          const batch = writeBatch(db);
          toast.loading(`Saving invoice data chunk ${i + 1} of ${totalChunks}...`, { id: toastId });
          
          chunk.forEach((updatedInv) => {
            batch.update(doc(db, 'invoices', updatedInv.id), {
              items: updatedInv.items,
              totalAmount: updatedInv.totalAmount,
              certifiedAmount: updatedInv.certifiedAmount,
              updatedAt: updatedInv.updatedAt
            });
          });
          await batch.commit();
        }

        toast.success(`Processed items across ${invoicesToUpdate.size} invoices.`, { id: toastId });
      } catch (error) {
        console.error('Import error:', error);
        toast.dismiss(toastId);
        toast.error('Failed to import invoice items.');
      }
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
        onImportData={(excelData) => {
          const processImport = async () => {
            const toastId = toast.loading('Importing invoice items...');
            try {
              // Duplicate check in file
              const idsInFile = new Set<string>();
              const duplicates = [];
              excelData.forEach((row, idx) => {
                const orderId = String(row['Order ID'] || row.orderId || '').trim();
                const invoiceNo = String(row['Invoice No.'] || row.invoiceId || '').trim();
                const itemNo = String(row['Item No.'] || row.itemNo || '').trim();
                if (orderId && invoiceNo && itemNo) {
                  const key = `${orderId.toLowerCase()}_${invoiceNo.toLowerCase()}_${itemNo.toLowerCase()}`;
                  if (idsInFile.has(key)) duplicates.push({ row: idx + 1, key });
                  idsInFile.add(key);
                }
              });

              if (duplicates.length > 0) {
                toast.error(`Duplicate items found in file: ${duplicates.map(d => d.key).join(', ')}`, { id: toastId });
                return;
              }

              const chunkSize = 400;
              const totalChunks = Math.ceil(excelData.length / chunkSize);
              let importedCount = 0;

              for (let i = 0; i < totalChunks; i++) {
                const chunk = excelData.slice(i * chunkSize, (i + 1) * chunkSize);
                const batch = writeBatch(db);

                for (const row of chunk) {
                  const orderId = String(row['Order ID'] || row.orderId || '').trim();
                  const targetSub = subcontracts.find(s => s.orderId === orderId);
                  if (!targetSub) continue;

                  const invoiceNo = String(row['Invoice No.'] || row.invoiceId || '');
                  if (!invoiceNo) continue;

                  const invoice = invoices.find(inv => inv.subcontractId === targetSub.id && inv.invoiceId === invoiceNo);
                  if (!invoice) continue;

                  const itemNo = String(row['Item No.'] || row.itemNo || '');
                  if (!itemNo) continue;

                  const items = invoice.items || [];
                  const itemIndex = items.findIndex(it => it.itemNo === itemNo);
                  if (itemIndex === -1) continue;

                  const updatedItems = [...items];
                  const item = { ...updatedItems[itemIndex] };
                  
                  if (row['Claim Value'] !== undefined || row.periodicClaimValue !== undefined) item.periodicClaimValue = Number(row['Claim Value'] || row.periodicClaimValue || 0);
                  if (row['Certified Value'] !== undefined || row.periodicCertifiedValue !== undefined) item.periodicCertifiedValue = Number(row['Certified Value'] || row.periodicCertifiedValue || 0);
                  
                  updatedItems[itemIndex] = item;
                  
                  // Calculate new invoice totals
                  const invoiceTotal = updatedItems.reduce((sum, it) => sum + (it.periodicClaimValue || 0), 0);
                  const invoiceCertifiedTotal = updatedItems.reduce((sum, it) => sum + (it.periodicCertifiedValue || 0), 0);

                  batch.update(doc(db, 'invoices', invoice.id), {
                    items: updatedItems,
                    totalAmount: invoiceTotal,
                    certifiedAmount: invoiceCertifiedTotal,
                    updatedAt: new Date().toISOString()
                  });
                  importedCount++;
                }
                await batch.commit();
              }
              toast.success(`Imported ${importedCount} invoice items.`, { id: toastId });
            } catch (error: any) {
              console.error("Import error:", error);
              toast.error("Failed to import invoice items: " + error.message, { id: toastId });
            }
          };
          processImport();
        }}
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
