import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Project, Enterprise, Subcontract, SubcontractLineItem, CostCode } from '../types';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, doc, writeBatch, updateDoc } from 'firebase/firestore';
import DataGridModule from './DataGridModule';
import { ColDef, ColGroupDef, CellValueChangedEvent } from 'ag-grid-community';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface BulkSubcontractItemsProps {
  project: Project;
  enterprise: Enterprise;
}

interface FlattenedLineItem extends SubcontractLineItem {
  parentSubcontractId: string; // The doc ID
  orderId: string;
  orderName: string;
  vendorName: string;
  subStatus: string;
}

const BulkSubcontractItems: React.FC<BulkSubcontractItemsProps> = ({ project, enterprise }) => {
  const [subcontracts, setSubcontracts] = useState<Subcontract[]>([]);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkUpdateOpen, setIsBulkUpdateOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<any>(null);

  const [bulkUpdateData, setBulkUpdateData] = useState({
    status: '',
    type: '',
  });

  const [quickFilterText, setQuickFilterText] = useState('');

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.length} items? This will remove them from their respective subcontracts.`)) return;

    try {
      const batch = writeBatch(db);
      const subcontractsToUpdate = new Map<string, Subcontract>();

      selectedIds.forEach(id => {
        const row = rowData.find(r => r.id === id);
        if (!row) return;

        let sub = subcontractsToUpdate.get(row.parentSubcontractId) || subcontracts.find(s => s.id === row.parentSubcontractId);
        if (!sub) return;

        if (!subcontractsToUpdate.has(row.parentSubcontractId)) {
          sub = { ...sub!, lineItems: sub!.lineItems?.map(it => ({ ...it })) || [] };
        }

        sub!.lineItems = sub!.lineItems.filter(it => it.id !== id);
        sub!.updatedAt = new Date().toISOString();
        subcontractsToUpdate.set(row.parentSubcontractId, sub!);
      });

      for (const [id, updatedSub] of Array.from(subcontractsToUpdate.entries())) {
        batch.update(doc(db, 'subcontracts', id), {
          lineItems: updatedSub.lineItems,
          updatedAt: updatedSub.updatedAt
        });
      }

      await batch.commit();
      toast.success(`Deleted ${selectedIds.length} items.`);
      setSelectedIds([]);
    } catch (error) {
      console.error('Bulk delete error:', error);
      toast.error('Failed to delete items.');
    }
  };

  const handleExport = () => {
    try {
      const exportData = rowData.map(item => {
        const row: any = {
          'Order ID': item.orderId,
          'Order Name': item.orderName,
          'Vendor': item.vendorName,
          'Item No': item.itemNo,
          'Description': item.description,
          'Reference': item.activityId || '',
          'Date': item.date || '',
          'Cost Code': costCodes.find(c => c.id === item.costCodeId)?.code || item.costCodeId,
          'Type': item.type,
          'Status': item.status,
          'Qty': item.qty,
          'Unit': item.unit,
          'Rate': item.rate,
          'Total': item.total,
          'Note': item.note || '',
          'Phasing Source': item.phasingSource || 'Manual',
          'Start Date': item.startDate || '',
          'End Date': item.endDate || '',
          'Distribution': item.distribution || '',
        };

        // Add User Defined
        for (let i = 1; i <= 5; i++) {
          row[`Numeric ${i}`] = item.userDefined?.[`num${i}`] || 0;
          row[`Text ${i}`] = item.userDefined?.[`text${i}`] || '';
        }

        // Add attributes
        enterprise.lineItemAttributes?.forEach(attr => {
          row[attr.title] = (item.enterpriseAttributes as any)?.[attr.id] || '';
        });
        project.lineItemAttributes?.forEach(attr => {
          row[attr.title] = (item.projectAttributes as any)?.[attr.id] || '';
        });

        // Add periodic phasing
        project.reportingPeriods?.periods.forEach(p => {
          row[p.name || formatDate(p.endDate)] = item.periodValues?.[p.id] || 0;
        });

        return row;
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'SubcontractItems');
      XLSX.writeFile(wb, `Bulk_Subcontract_Items_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('Export successful');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export data.');
    }
  };

  const handleImportData = async (data: any[]) => {
    try {
      const batch = writeBatch(db);
      const subcontractsToUpdate = new Map<string, Subcontract>();
      let updateCount = 0;

      data.forEach(row => {
        const orderId = row['Order ID'] || row['orderId'];
        const itemNo = row['Item No'] || row['itemNo'];
        if (!orderId || !itemNo) return;

        // Find match in current subcontracts
        const sub = subcontracts.find(s => s.orderId === orderId);
        if (!sub) return;

        let updatedSub = subcontractsToUpdate.get(sub.id) || { ...sub, lineItems: sub.lineItems?.map(it => ({ ...it })) || [] };
        
        const itemIndex = updatedSub.lineItems.findIndex(it => it.itemNo === itemNo);
        if (itemIndex === -1) return;

        const originalItem = updatedSub.lineItems[itemIndex];
        const updatedItem = { ...originalItem };

        if (row['Description'] !== undefined) updatedItem.description = row['Description'];
        if (row['Qty'] !== undefined) updatedItem.qty = Number(row['Qty']) || 0;
        if (row['Unit'] !== undefined) updatedItem.unit = row['Unit'];
        if (row['Rate'] !== undefined) updatedItem.rate = Number(row['Rate']) || 0;
        if (row['Status'] !== undefined) updatedItem.status = row['Status'];
        if (row['Type'] !== undefined) updatedItem.type = row['Type'];

        // Recalculate total
        updatedItem.total = (updatedItem.qty || 0) * (updatedItem.rate || 0);
        updatedItem.updatedAt = new Date().toISOString();

        updatedSub.lineItems[itemIndex] = updatedItem;
        updatedSub.updatedAt = new Date().toISOString();
        subcontractsToUpdate.set(sub.id, updatedSub);
        updateCount++;
      });

      for (const [id, updatedSub] of Array.from(subcontractsToUpdate.entries())) {
        batch.update(doc(db, 'subcontracts', id), {
          lineItems: updatedSub.lineItems,
          updatedAt: updatedSub.updatedAt
        });
      }

      await batch.commit();
      toast.success(`Import complete. Updated ${updateCount} items.`);
    } catch (error) {
      console.error('Import error:', error);
      toast.error('Import failed.');
    }
  };

  useEffect(() => {
    if (!project.id) return;
    const qSub = query(collection(db, 'subcontracts'), where('projectId', '==', project.id));
    const unsubSub = onSnapshot(qSub, (snapshot) => {
      setSubcontracts(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Subcontract)));
      setLoading(false);
    }, (error) => {
      console.error("BulkSubcontractItems: subcontracts fetch error:", error);
      toast.error("Failed to load subcontracts: " + error.message);
      setLoading(false);
    });

    const qCost = query(collection(db, 'costCodes'), where('projectId', '==', project.id));
    const unsubCost = onSnapshot(qCost, (snapshot) => {
      setCostCodes(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as CostCode)));
    });

    return () => {
      unsubSub();
      unsubCost();
    };
  }, [project.id]);

  const rowData = useMemo(() => {
    const items: FlattenedLineItem[] = [];
    subcontracts.forEach(sub => {
      if (sub.lineItems) {
        sub.lineItems.forEach(li => {
          items.push({
            ...li,
            parentSubcontractId: sub.id,
            orderId: sub.orderId || 'Unknown',
            orderName: sub.orderName || 'Unknown',
            vendorName: sub.vendorName || 'Unknown',
            subStatus: sub.status || 'Unknown',
          });
        });
      }
    });

    return items.sort((a, b) => {
      const subCmp = (a.orderId || '').localeCompare(b.orderId || '');
      if (subCmp !== 0) return subCmp;
      return (a.itemNo || '').localeCompare(b.itemNo || '', undefined, { numeric: true });
    });
  }, [subcontracts]);

  const handleBulkUpdate = async () => {
    if (selectedIds.length === 0) return;
    try {
      const batch = writeBatch(db);
      const subcontractsToUpdate = new Map<string, Subcontract>();

      selectedIds.forEach(id => {
        const row = rowData.find(r => r.id === id);
        if (!row) return;

        let sub = subcontractsToUpdate.get(row.parentSubcontractId) || subcontracts.find(s => s.id === row.parentSubcontractId);
        if (!sub) return;

        if (!subcontractsToUpdate.has(row.parentSubcontractId)) {
          sub = { ...sub!, lineItems: sub!.lineItems?.map(it => ({ ...it })) || [] };
        }

        sub!.lineItems = sub!.lineItems.map(it => {
          if (it.id === id) {
            const updated = { ...it };
            if (bulkUpdateData.status) updated.status = bulkUpdateData.status as any;
            if (bulkUpdateData.type) updated.type = bulkUpdateData.type as any;
            updated.updatedAt = new Date().toISOString();
            return updated;
          }
          return it;
        });

        sub!.updatedAt = new Date().toISOString();
        subcontractsToUpdate.set(row.parentSubcontractId, sub!);
      });

      for (const [id, updatedSub] of Array.from(subcontractsToUpdate.entries())) {
        batch.update(doc(db, 'subcontracts', id), {
          lineItems: updatedSub.lineItems,
          updatedAt: updatedSub.updatedAt
        });
      }

      await batch.commit();
      toast.success(`Updated ${selectedIds.length} items.`);
      setSelectedIds([]);
      setIsBulkUpdateOpen(false);
      setBulkUpdateData({ status: '', type: '' });
    } catch (error) {
      console.error('Bulk update error:', error);
      toast.error('Failed to update items.');
    }
  };

  const handleCellValueChanged = async (event: CellValueChangedEvent) => {
    const { data, colDef, newValue, oldValue } = event;
    if (newValue === oldValue) return;

    const subcontractDocId = data.parentSubcontractId;
    const lineItemId = data.id;

    const sub = subcontracts.find(s => s.id === subcontractDocId);
    if (!sub) return;

    const field = colDef.field!;
    
    const setNestedValue = (obj: any, path: string, value: any) => {
      const parts = path.split('.');
      let current = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current[part]) current[part] = {};
        // Make a copy if it's an object to ensure immutability if needed, 
        // though here we are building a new updatedItem.
        current[part] = { ...current[part] };
        current = current[part];
      }
      current[parts[parts.length - 1]] = value;
    };

    const updatedLineItems = (sub.lineItems || []).map(item => {
      if (item.id === lineItemId) {
        const updatedItem = JSON.parse(JSON.stringify(item)); // Deep copy to handle nested objects easily
        setNestedValue(updatedItem, field, newValue);
        
        // Handle calculated fields for pricing
        if (field === 'qty' || field === 'rate') {
          updatedItem.total = (Number(updatedItem.qty) || 0) * (Number(updatedItem.rate) || 0);
        }
        
        updatedItem.updatedAt = new Date().toISOString();
        return updatedItem;
      }
      return item;
    });

    try {
      await updateDoc(doc(db, 'subcontracts', subcontractDocId), {
        lineItems: updatedLineItems,
        updatedAt: new Date().toISOString()
      });
      toast.success('Line item updated');
    } catch (error) {
      console.error('Error updating line item:', error);
      toast.error('Failed to update line item.');
    }
  };

  const columnDefs = useMemo<(ColDef | ColGroupDef)[]>(() => {
    const sortedCostCodes = [...costCodes].sort((a, b) => a.code.localeCompare(b.code));
    const periods = project.reportingPeriods?.periods || [];
    
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
        headerName: 'Item Details',
        children: [
          { 
            field: 'itemNo', 
            headerName: 'Item No', 
            width: 100, 
            editable: true, 
            sort: 'asc', 
            sortIndex: 1,
            checkboxSelection: true,
            headerCheckboxSelection: true,
          },
          { field: 'description', headerName: 'Description', flex: 1, minWidth: 200, editable: true },
          { field: 'activityId', headerName: 'Reference', width: 150, editable: true },
          { 
            field: 'date', 
            headerName: 'Date', 
            width: 120, 
            editable: true,
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
            valueFormatter: params => formatDate(params.value)
          },
          { 
            field: 'costCodeId', 
            headerName: 'Cost Code', 
            width: 180, 
            editable: true,
            cellEditor: 'agRichSelectCellEditor',
            cellEditorParams: {
              values: sortedCostCodes.map(c => c.code),
              formatValue: (val: string) => {
                const code = sortedCostCodes.find(c => c.code === val);
                return code ? `${code.code} - ${code.name}` : val;
              }
            },
            valueFormatter: params => {
              const code = sortedCostCodes.find(c => c.code === params.value);
              return code ? `${code.code} - ${code.name}` : params.value;
            }
          },
          { 
            field: 'type', 
            headerName: 'Type', 
            width: 120, 
            editable: true,
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: { values: ['Original', 'ChangeOrder'] }
          },
          { 
            field: 'status', 
            headerName: 'Status', 
            width: 120, 
            editable: true,
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: { values: ['Approved', 'Pending', 'Forecast', 'Rejected'] }
          },
        ]
      },
      {
        headerName: 'Pricing',
        children: [
          { field: 'qty', headerName: 'Qty', width: 100, editable: true, type: 'numericColumn', valueFormatter: p => formatNumber(p.value) },
          { field: 'unit', headerName: 'Unit', width: 80, editable: true },
          { field: 'rate', headerName: 'Rate', width: 120, editable: true, type: 'numericColumn', valueFormatter: p => formatCurrency(p.value) },
          { 
            field: 'total', 
            headerName: 'Total', 
            width: 140, 
            editable: false, 
            type: 'numericColumn', 
            cellClass: 'bg-gray-50/50 font-bold',
            valueFormatter: p => formatCurrency(p.value) 
          },
        ]
      },
      {
        headerName: 'Commentary',
        children: [
          { field: 'note', headerName: 'Notes', width: 250, editable: true, cellEditor: 'agLargeTextCellEditor' }
        ]
      },
      {
        headerName: 'Attributes',
        children: [
          ...(enterprise.lineItemAttributes || [])
            .filter(a => a.title)
            .map(attr => ({
              field: `enterpriseAttributes.${attr.id}`,
              headerName: attr.title,
              width: 150,
              editable: true,
              cellEditor: 'agRichSelectCellEditor',
              cellEditorParams: {
                values: (attr.values || []).map(v => `${v.id} | ${v.description}`)
              }
            })),
          ...(project.lineItemAttributes || [])
            .filter(a => a.title)
            .map(attr => ({
              field: `projectAttributes.${attr.id}`,
              headerName: attr.title,
              width: 150,
              editable: true,
              cellEditor: 'agRichSelectCellEditor',
              cellEditorParams: {
                values: (attr.values || []).map(v => `${v.id} | ${v.description}`)
              }
            }))
        ]
      },
      {
        headerName: 'User Defined',
        children: [
          ...Array.from({ length: 5 }).map((_, i) => ({
            headerName: `Numeric ${i + 1}`,
            field: `userDefined.num${i + 1}`,
            width: 120,
            type: 'numericColumn',
            editable: true,
            valueParser: (params: any) => Number(params.newValue) || 0
          })),
          ...Array.from({ length: 5 }).map((_, i) => ({
            headerName: `Text ${i + 1}`,
            field: `userDefined.text${i + 1}`,
            width: 150,
            editable: true
          }))
        ]
      },
      {
        headerName: 'Timephasing',
        children: [
          { 
            field: 'phasingSource', 
            headerName: 'Phasing Source', 
            width: 130, 
            editable: true,
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: { values: ['Manual', 'Auto'] }
          },
          { 
            field: 'startDate', 
            headerName: 'Start Date', 
            width: 120, 
            editable: true,
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
            valueFormatter: params => formatDate(params.value)
          },
          { 
            field: 'endDate', 
            headerName: 'End Date', 
            width: 120, 
            editable: true,
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
            valueFormatter: params => formatDate(params.value)
          },
          { 
            field: 'distribution', 
            headerName: 'Distribution', 
            width: 130, 
            editable: params => params.data.phasingSource === 'Auto',
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: { values: ['Even', 'Bell Curve', 'Front load', 'Back load', 'S-Curve', 'Profile'] }
          },
          {
            headerName: 'Periodic Phasing',
            children: periods.map(p => ({
              headerName: p.name || formatDate(p.endDate),
              field: `periodValues.${p.id}`,
              width: 120,
              type: 'numericColumn',
              editable: params => params.data.phasingSource === 'Manual',
              valueGetter: params => params.data.periodValues?.[p.id] || 0,
              valueFormatter: params => formatCurrency(params.value),
              valueParser: params => Number(params.newValue) || 0,
              cellClass: params => params.data.phasingSource === 'Manual' ? 'bg-amber-50/10' : 'bg-gray-50/30'
            }))
          }
        ]
      }
    ];
  }, [costCodes, enterprise, project]);

  const pinnedBottomRowData = useMemo(() => {
    if (rowData.length === 0) return [];
    return [{
      itemNo: 'TOTAL',
      total: rowData.reduce((sum, r) => sum + (Number(r.total) || 0), 0)
    }];
  }, [rowData]);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading Line Items...</div>;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <DataGridModule
        title="Bulk Subcontract Items"
        description="View and bulk edit line items across all subcontracts."
        rowData={rowData}
        columnDefs={columnDefs}
        pinnedBottomRowData={pinnedBottomRowData}
        gridRef={gridRef}
        selectedCount={selectedIds.length}
        onBulkUpdate={() => setIsBulkUpdateOpen(true)}
        onBulkDelete={handleBulkDelete}
        onExport={handleExport}
        onImportData={handleImportData}
        quickFilterText={quickFilterText}
        onQuickFilterChange={setQuickFilterText}
        gridProps={{
          rowSelection: 'multiple',
          suppressRowClickSelection: true,
          onCellValueChanged: handleCellValueChanged,
          onSelectionChanged: (e: any) => setSelectedIds(e.api.getSelectedNodes().map((n: any) => n.data.id).filter(Boolean)),
          getRowClass: (p: any) => p.node.rowPinned ? 'pinned-row-highlight font-bold' : ''
        }}
      />

      <Dialog open={isBulkUpdateOpen} onOpenChange={setIsBulkUpdateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Bulk Update Items</DialogTitle><DialogDescription>Update {selectedIds.length} items. Only selected fields apply.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-gray-500">Status</label>
              <Select value={bulkUpdateData.status} onValueChange={v => setBulkUpdateData(prev => ({ ...prev, status: v }))}>
                <SelectTrigger><SelectValue placeholder="Select Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Approved">Approved</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Forecast">Forecast</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-gray-500">Type</label>
              <Select value={bulkUpdateData.type} onValueChange={v => setBulkUpdateData(prev => ({ ...prev, type: v }))}>
                <SelectTrigger><SelectValue placeholder="Select Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Original">Original</SelectItem>
                  <SelectItem value="ChangeOrder">Change Order</SelectItem>
                </SelectContent>
              </Select>
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

export default BulkSubcontractItems;
