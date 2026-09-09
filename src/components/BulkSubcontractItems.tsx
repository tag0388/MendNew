import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Project, Enterprise, Subcontract, SubcontractLineItem, CostCode } from '../types';
import { subscribeToTable } from '../lib/supabase';
import { fetchCostCodes } from '../lib/costCodes';
import {
  fetchProjectLineItems, upsertLineItemsAcrossSubcontracts,
  deleteLineItems, bulkUpdateLineItems, applyLineItemCellEdit,
} from '../lib/subcontracts';
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
  // The grid's rows are line items, so it reads line items. It used to load
  // every subcontract in the project and flatten their embedded arrays.
  const [rowData, setRowData] = useState<FlattenedLineItem[]>([]);
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
      // One statement. Each subcontract's total follows by trigger; this used
      // to rebuild every affected subcontract's line item array in the browser
      // and write the arrays back.
      await deleteLineItems(selectedIds);
      await reload();
      toast.success(`Deleted ${selectedIds.length} items.`);
      setSelectedIds([]);
    } catch (error: any) {
      console.error('Bulk delete error:', error);
      toast.error(`Failed to delete items: ${error?.message || 'Unknown error'}`);
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
      // A sheet row names its order and item number; those identify the row to
      // update. Unmatched rows are reported rather than silently dropped.
      const byKey = new Map<string, FlattenedLineItem>();
      rowData.forEach(r => byKey.set(`${r.orderId}\u0000${r.itemNo}`, r));

      const rows: any[] = [];
      const unmatched: string[] = [];

      data.forEach(row => {
        const orderId = String(row['Order ID'] || row['orderId'] || '').trim();
        const itemNo = String(row['Item No'] || row['itemNo'] || '').trim();
        if (!orderId || !itemNo) return;

        const existing = byKey.get(`${orderId}\u0000${itemNo}`);
        if (!existing) { unmatched.push(`${orderId} / ${itemNo}`); return; }

        const patch: any = {
          subcontractId: (existing as any).parentSubcontractId,
          itemNo,
        };
        if (row['Description'] !== undefined) patch.description = String(row['Description']);
        // qty and rate are the inputs; the database generates the total.
        if (row['Qty'] !== undefined) patch.qty = Number(row['Qty']) || 0;
        if (row['Unit'] !== undefined) patch.unit = String(row['Unit']);
        if (row['Rate'] !== undefined) patch.rate = Number(row['Rate']) || 0;
        if (row['Status'] !== undefined) patch.status = row['Status'];
        if (row['Type'] !== undefined) patch.type = row['Type'];
        rows.push(patch);
      });

      if (rows.length === 0) {
        toast.error('No sheet rows matched an existing order and item number.');
        return;
      }

      // One statement across every affected subcontract.
      const updated = await upsertLineItemsAcrossSubcontracts(project.id, rows);
      await reload();
      toast.success(
        unmatched.length > 0
          ? `Import complete. Updated ${updated} items. Not found: ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? ` and ${unmatched.length - 5} more` : ''}`
          : `Import complete. Updated ${updated} items.`
      );
    } catch (error: any) {
      console.error('Import error:', error);
      toast.error(`Import failed: ${error?.message || 'Unknown error'}`);
    }
  };

  const reload = useCallback(async () => {
    try {
      setRowData(await fetchProjectLineItems(project.id) as any);
    } catch (error: any) {
      console.error('BulkSubcontractItems: line items fetch error:', error);
      toast.error(`Failed to load line items: ${error?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    if (!project.id) return;
    void reload();

    const loadCostCodes = async () => {
      try {
        setCostCodes(await fetchCostCodes(project.id));
      } catch (error) {
        console.error('BulkSubcontractItems: cost codes fetch error:', error);
      }
    };
    void loadCostCodes();

    const unsubItems = subscribeToTable('subcontract_line_items', `project_id=eq.${project.id}`, () => void reload());
    // A rename or status change on the order shows in the grid's first columns.
    const unsubSub = subscribeToTable('subcontracts', `project_id=eq.${project.id}`, () => void reload());
    const unsubCost = subscribeToTable('cost_codes', `project_id=eq.${project.id}`, () => void loadCostCodes());

    return () => { unsubItems(); unsubSub(); unsubCost(); };
  }, [project.id, reload]);

  const handleBulkUpdate = async () => {
    if (selectedIds.length === 0) return;
    try {
      // One statement, whichever subcontracts the selected items belong to.
      const updated = await bulkUpdateLineItems(selectedIds, {
        status: bulkUpdateData.status || undefined,
        type: bulkUpdateData.type || undefined,
      });
      await reload();
      toast.success(`Updated ${updated} items.`);
      setSelectedIds([]);
      setIsBulkUpdateOpen(false);
      setBulkUpdateData({ status: '', type: '' });
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
      let value = newValue;
      if (field === 'costCodeId' && value) {
        // The column shows the cost CODE but holds the row id.
        const resolved = costCodes.find(c => c.code === String(value).trim() || c.id === value);
        if (!resolved) {
          toast.error(`Unknown cost code "${value}"`);
          await reload();
          return;
        }
        value = resolved.id;
      }

      // The total is generated from qty x rate by the database, and the
      // subcontract's roll-ups follow by trigger. Attribute columns carry a
      // dotted path and are merged rather than sent as a column name.
      await applyLineItemCellEdit(data.id, field, value);
      await reload();
      toast.success('Line item updated');
    } catch (error: any) {
      console.error('Error updating line item:', error);
      toast.error(`Failed to update line item: ${error?.message || 'Unknown error'}`);
      await reload();
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
