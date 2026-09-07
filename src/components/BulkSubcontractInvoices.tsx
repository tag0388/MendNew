import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Project, Enterprise, Invoice, Subcontract } from '../types';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, writeBatch } from 'firebase/firestore';
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
  const [invoices, setInvoices] = useState<Invoice[]>([]);
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

  useEffect(() => {
    if (!project.id) return;

    const qSub = query(collection(db, 'subcontracts'), where('projectId', '==', project.id));
    const unsubSub = onSnapshot(qSub, (snapshot) => {
      setSubcontracts(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Subcontract)));
    }, (error) => {
      console.error("BulkSubcontractInvoices: subcontracts fetch error:", error);
      toast.error("Failed to load subcontracts: " + error.message);
      setLoading(false);
    });

    const qInv = query(collection(db, 'invoices'), where('projectId', '==', project.id));
    const unsubInv = onSnapshot(qInv, (snapshot) => {
      setInvoices(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Invoice)));
      setLoading(false);
    }, (error) => {
      console.error("BulkSubcontractInvoices: invoices fetch error:", error);
      toast.error("Failed to load invoices: " + error.message);
      setLoading(false);
    });

    return () => {
      unsubSub();
      unsubInv();
    };
  }, [project.id]);

  const rowData = useMemo(() => {
    const flat = invoices.map(inv => {
      const sub = subcontracts.find(s => s.id === inv.subcontractId);
      
      // Periodic totals are the sum of periodic fields of line items
      const periodicClaimed = (inv.items || []).reduce((sum, item) => sum + (item.periodicClaimValue || 0), 0);
      const periodicCertified = (inv.items || []).reduce((sum, item) => sum + (item.periodicCertifiedValue || 0), 0);

      return {
        ...inv,
        orderId: sub?.orderId || 'Unknown',
        orderName: sub?.orderName || 'Unknown',
        periodicClaimed,
        periodicCertified,
      } as FlattenedInvoice;
    });

    return flat.sort((a, b) => {
      const subCmp = (a.orderId || '').localeCompare(b.orderId || '');
      if (subCmp !== 0) return subCmp;
      return (a.invoiceId || '').localeCompare(b.invoiceId || '', undefined, { numeric: true });
    });
  }, [invoices, subcontracts]);

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      const batch = writeBatch(db);
      selectedIds.forEach(id => {
        batch.delete(doc(db, 'invoices', id));
      });
      await batch.commit();
      toast.success(`Deleted ${selectedIds.length} invoices.`);
      setSelectedIds([]);
      setIsBulkDeleteOpen(false);
    } catch (error) {
      console.error('Bulk delete error:', error);
      toast.error('Failed to delete invoices.');
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
      const batch = writeBatch(db);
      selectedIds.forEach(id => {
        const updateData: any = { updatedAt: new Date().toISOString() };
        if (bulkUpdateData.status) updateData.status = bulkUpdateData.status;
        if (bulkUpdateData.initiator) updateData.initiator = bulkUpdateData.initiator;
        if (bulkUpdateData.submittedDate) updateData.submittedDate = bulkUpdateData.submittedDate;
        if (bulkUpdateData.certifiedDate) updateData.certifiedDate = bulkUpdateData.certifiedDate;
        if (bulkUpdateData.paymentDate) updateData.paymentDate = bulkUpdateData.paymentDate;
        
        // Apply percentages to items if provided
        const invoice = invoices.find(inv => inv.id === id);
        if (invoice && (bulkUpdateData.claimPercent || bulkUpdateData.certifiedPercent)) {
          const updatedItems = (invoice.items || []).map(item => {
            const newItem = { ...item };
            const lineTotal = newItem.total || 0;
            const rate = newItem.rate || 0;

            if (bulkUpdateData.claimPercent) {
              newItem.periodicClaimPercent = Number(bulkUpdateData.claimPercent);
              newItem.periodicClaimValue = (newItem.periodicClaimPercent / 100) * lineTotal;
              if (rate > 0) newItem.periodicClaimQty = newItem.periodicClaimValue / rate;
            }

            if (bulkUpdateData.certifiedPercent) {
              newItem.periodicCertifiedPercent = Number(bulkUpdateData.certifiedPercent);
              newItem.periodicCertifiedValue = (newItem.periodicCertifiedPercent / 100) * lineTotal;
              if (rate > 0) newItem.periodicCertifiedQty = newItem.periodicCertifiedValue / rate;
            }

            return newItem;
          });

          updateData.items = updatedItems;
          updateData.totalAmount = updatedItems.reduce((sum, it) => sum + (it.periodicClaimValue || 0), 0);
          updateData.certifiedAmount = updatedItems.reduce((sum, it) => sum + (it.periodicCertifiedValue || 0), 0);
        }
        
        batch.update(doc(db, 'invoices', id), updateData);
      });
      await batch.commit();
      toast.success(`Updated ${selectedIds.length} invoices.`);
      setSelectedIds([]);
      setIsBulkUpdateOpen(false);
      setBulkUpdateData({ status: '', initiator: '', submittedDate: '', certifiedDate: '', paymentDate: '', claimPercent: '', certifiedPercent: '' });
    } catch (error) {
      console.error('Bulk update error:', error);
      toast.error('Failed to update invoices.');
    }
  };

  const handleCellValueChanged = async (event: CellValueChangedEvent) => {
    const { data, colDef, newValue, oldValue } = event;
    if (newValue === oldValue) return;

    const invoiceId = data.id;
    const field = colDef.field!;

    try {
      let updateData: any = {
        updatedAt: new Date().toISOString()
      };

      if (field === 'periodicClaimed') {
        updateData.totalAmount = Number(newValue) || 0;
      } else if (field === 'periodicCertified') {
        updateData.certifiedAmount = Number(newValue) || 0;
      } else {
        updateData[field] = (newValue instanceof Date) ? dateToISO(newValue) : newValue;
      }

      await updateDoc(doc(db, 'invoices', invoiceId), updateData);
      toast.success('Invoice updated successfully');
    } catch (error) {
      console.error('Error updating invoice:', error);
      toast.error('Failed to update invoice.');
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
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const excelData = XLSX.utils.sheet_to_json(ws) as any[];

        if (excelData.length === 0) {
          toast.dismiss(toastId);
          toast.error('The Excel file is empty.');
          return;
        }

        // Chunked Processing
        const chunkSize = 400;
        const totalChunks = Math.ceil(excelData.length / chunkSize);
        let importedCount = 0;

        for (let i = 0; i < totalChunks; i++) {
          const chunk = excelData.slice(i * chunkSize, (i + 1) * chunkSize);
          const batch = writeBatch(db);
          toast.loading(`Importing invoice chunk ${i + 1} of ${totalChunks}...`, { id: toastId });

          for (const row of chunk) {
            const orderId = String(row['Order ID'] || '').trim();
            const targetSub = subcontracts.find(s => s.orderId === orderId);
            if (!targetSub) continue;

            const invoiceNo = String(row['Invoice No.'] || '');
            if (!invoiceNo) continue;

            const existingInvoice = invoices.find(i => i.subcontractId === targetSub.id && i.invoiceId === invoiceNo);
            
            if (existingInvoice) {
              const updateProps: any = { updatedAt: new Date().toISOString() };
              if (row['Description']) updateProps.description = String(row['Description']);
              if (row['Status']) updateProps.status = row['Status'];
              if (row['Initiator']) updateProps.initiator = row['Initiator'];
              if (row['Submitted Date']) updateProps.submittedDate = dateToISO(new Date(row['Submitted Date']));
              if (row['Certified Date']) updateProps.certifiedDate = dateToISO(new Date(row['Certified Date']));
              if (row['Payment Date']) updateProps.paymentDate = dateToISO(new Date(row['Payment Date']));

              batch.update(doc(db, 'invoices', existingInvoice.id), updateProps);
            } else {
              const newInvRef = doc(collection(db, 'invoices'));
              const newInv: Invoice = {
                id: newInvRef.id,
                subcontractId: targetSub.id,
                projectId: project.id,
                enterpriseId: enterprise.id,
                invoiceId: invoiceNo,
                description: String(row['Description'] || ''),
                status: (row['Status'] || 'Draft') as any,
                initiator: String(row['Initiator'] || ''),
                vendorId: targetSub.vendorId,
                vendorName: targetSub.vendorName,
                totalAmount: 0,
                certifiedAmount: 0,
                items: [],
                submittedDate: row['Submitted Date'] ? dateToISO(new Date(row['Submitted Date'])) : undefined,
                certifiedDate: row['Certified Date'] ? dateToISO(new Date(row['Certified Date'])) : undefined,
                paymentDate: row['Payment Date'] ? dateToISO(new Date(row['Payment Date'])) : undefined,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
              batch.set(newInvRef, newInv);
            }
            importedCount++;
          }
          await batch.commit();
        }

        toast.success(`Successfully processed ${importedCount} invoices.`, { id: toastId });
      } catch (error) {
        console.error('Import error:', error);
        toast.dismiss(toastId);
        toast.error('Failed to import invoices.');
      }
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
        onImportData={(excelData) => {
          const processImport = async () => {
            const toastId = toast.loading('Importing invoices...');
            try {
              // Duplicate check in file
              const idsInFile = new Set<string>();
              const duplicates = [];
              excelData.forEach((row, idx) => {
                const orderId = String(row['Order ID'] || row.orderId || '').trim();
                const invoiceNo = String(row['Invoice No.'] || row.invoiceId || '').trim();
                if (orderId && invoiceNo) {
                  const key = `${orderId.toLowerCase()}_${invoiceNo.toLowerCase()}`;
                  if (idsInFile.has(key)) duplicates.push({ row: idx + 1, key });
                  idsInFile.add(key);
                }
              });

              if (duplicates.length > 0) {
                toast.error(`Duplicate invoices found in file: ${duplicates.map(d => d.key).join(', ')}`, { id: toastId });
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

                  const existingInvoice = invoices.find(i => i.subcontractId === targetSub.id && i.invoiceId === invoiceNo);
                  
                  if (existingInvoice) {
                    const updateProps: any = { updatedAt: new Date().toISOString() };
                    if (row['Description'] || row.description) updateProps.description = String(row['Description'] || row.description);
                    if (row['Status'] || row.status) updateProps.status = row['Status'] || row.status;
                    if (row['Initiator'] || row.initiator) updateProps.initiator = row['Initiator'] || row.initiator;
                    if (row['Submitted Date'] || row.submittedDate) updateProps.submittedDate = dateToISO(new Date(row['Submitted Date'] || row.submittedDate));
                    if (row['Certified Date'] || row.certifiedDate) updateProps.certifiedDate = dateToISO(new Date(row['Certified Date'] || row.certifiedDate));
                    if (row['Payment Date'] || row.paymentDate) updateProps.paymentDate = dateToISO(new Date(row['Payment Date'] || row.paymentDate));

                    batch.update(doc(db, 'invoices', existingInvoice.id), updateProps);
                  } else {
                    const newInvRef = doc(collection(db, 'invoices'));
                    const newInv: Invoice = {
                      id: newInvRef.id,
                      subcontractId: targetSub.id,
                      projectId: project.id,
                      enterpriseId: enterprise.id,
                      invoiceId: invoiceNo,
                      description: String(row['Description'] || row.description || ''),
                      status: (row['Status'] || row.status || 'Draft') as any,
                      initiator: String(row['Initiator'] || row.initiator || ''),
                      vendorId: targetSub.vendorId,
                      vendorName: targetSub.vendorName,
                      totalAmount: 0,
                      certifiedAmount: 0,
                      items: [],
                      submittedDate: (row['Submitted Date'] || row.submittedDate) ? dateToISO(new Date(row['Submitted Date'] || row.submittedDate)) : undefined,
                      certifiedDate: (row['Certified Date'] || row.certifiedDate) ? dateToISO(new Date(row['Certified Date'] || row.certifiedDate)) : undefined,
                      paymentDate: (row['Payment Date'] || row.paymentDate) ? dateToISO(new Date(row['Payment Date'] || row.paymentDate)) : undefined,
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                    };
                    batch.set(newInvRef, newInv);
                  }
                  importedCount++;
                }
                await batch.commit();
              }
              toast.success(`Imported ${importedCount} invoices.`, { id: toastId });
            } catch (error: any) {
              console.error("Import error:", error);
              toast.error("Failed to import invoices: " + error.message, { id: toastId });
            }
          };
          processImport();
        }}
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
