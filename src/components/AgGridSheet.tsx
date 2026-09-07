import React, { useMemo, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { 
  ColDef, 
  ValueGetterParams, 
  CellValueChangedEvent,
  GridReadyEvent,
  ValueFormatterParams
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import { format, addMonths, startOfMonth, parseISO, isAfter } from 'date-fns';
import { Project, Enterprise, ForecastRow } from '../types';

export interface AgGridSheetRef {
  clearFilters: () => void;
  exportToExcel: (fileName: string) => void;
  exportToCsv: (fileName: string) => void;
  saveViewState: () => void;
  getSelectedRows: () => ForecastRow[];
}

interface AgGridSheetProps {
  sheetId: string;
  sheetType: 'commitment' | 'time-based';
  project: Project;
  enterprise: Enterprise;
  data: ForecastRow[];
  onDataChange: (newData: ForecastRow[]) => void;
  theme: 'light' | 'dark';
}

const AgGridSheet = forwardRef<AgGridSheetRef, AgGridSheetProps>(({ 
  sheetId,
  sheetType, 
  project, 
  enterprise, 
  data, 
  onDataChange,
  theme 
}, ref) => {
  const gridRef = useRef<AgGridReact>(null);

  const saveViewState = useCallback(() => {
    if (gridRef.current?.api) {
      const columnState = gridRef.current.api.getColumnState();
      const filterModel = gridRef.current.api.getFilterModel();
      const state = { columnState, filterModel };
      localStorage.setItem(`grid-state-${sheetId}`, JSON.stringify(state));
    }
  }, [sheetId]);

  useImperativeHandle(ref, () => ({
    clearFilters: () => {
      if (gridRef.current?.api) {
        gridRef.current.api.setFilterModel(null);
        saveViewState();
      }
    },
    exportToExcel: (fileName: string) => {
      if (gridRef.current?.api) {
        gridRef.current.api.exportDataAsExcel({ fileName: `${fileName}.xlsx` });
      }
    },
    exportToCsv: (fileName: string) => {
      if (gridRef.current?.api) {
        gridRef.current.api.exportDataAsCsv({ fileName: `${fileName}.csv` });
      }
    },
    getSelectedRows: () => {
      if (gridRef.current?.api) {
        const selectedRows = gridRef.current.api.getSelectedRows();
        return selectedRows.filter(row => {
          const node = gridRef.current?.api.getRowNode(row.id);
          return node && node.displayed;
        });
      }
      return [];
    },
    saveViewState
  }));

  // Generate phasing months
  const phasingMonths = useMemo(() => {
    try {
      const startStr = project.startDate || new Date().toISOString();
      const endStr = project.endDate || new Date().toISOString();
      
      const start = startOfMonth(parseISO(startStr));
      const end = parseISO(endStr);
      
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        console.warn('Invalid project dates in AgGridSheet:', { startStr, endStr });
        return [format(new Date(), 'MMM yy')];
      }

      const months = [];
      let current = start;
      let safetyCounter = 0;
      
      // Limit to 120 months (10 years) to prevent infinite loops
      while (!isAfter(current, end) && safetyCounter < 120) {
        months.push(format(current, 'MMM yy'));
        current = addMonths(current, 1);
        safetyCounter++;
      }
      
      return months.length > 0 ? months : [format(start, 'MMM yy')];
    } catch (e) {
      console.error("Phasing months calculation error:", e);
      return [format(new Date(), 'MMM yy')];
    }
  }, [project.startDate, project.endDate]);

  const currencyFormatter = (params: ValueFormatterParams) => {
    if (params.value == null) return '';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(params.value);
  };

  const columnDefs = useMemo<ColDef[]>(() => {
    const categories = project.categories?.length ? project.categories : enterprise.categories || [];
    const controlAccounts = project.controlAccounts?.length ? project.controlAccounts : enterprise.controlAccounts || [];
    const orderNumbers = project.orderNumbers?.length ? project.orderNumbers : enterprise.orderNumbers || [];

    const baseCols: ColDef[] = [
      { 
        headerName: 'Item', 
        field: 'costCode', 
        editable: true, 
        pinned: 'left',
        width: 120,
        filter: 'agTextColumnFilter',
        checkboxSelection: true,
        headerCheckboxSelection: true,
        headerCheckboxSelectionFilteredOnly: true
      },
      { 
        headerName: 'Description', 
        field: 'description', 
        editable: true, 
        pinned: 'left',
        width: 250,
        filter: 'agTextColumnFilter'
      },
      { 
        headerName: 'Vendor', 
        field: 'vendor', 
        editable: true, 
        width: 150,
        filter: 'agTextColumnFilter'
      },
      { 
        headerName: 'Qty', 
        field: 'qty', 
        editable: sheetType === 'commitment',
        type: 'numericColumn',
        width: 100,
        filter: 'agNumberColumnFilter',
        valueGetter: (params: ValueGetterParams) => {
          if (!params.data) return 0;
          if (sheetType === 'time-based') {
            const cutoffStr = project.cutoffDate;
            const cutoff = (cutoffStr && cutoffStr !== 'NOT SET') ? parseISO(cutoffStr) : new Date(1970, 0, 1);
            let sum = 0;
            const monthMap: Record<string, string> = {
              'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
              'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
            };
            phasingMonths.forEach(m => {
              const [monthName, yearShort] = m.split(' ');
              if (!monthName || !yearShort || !monthMap[monthName]) return;
              
              const monthDate = parseISO(`20${yearShort}-${monthMap[monthName]}-01`);
              if (isNaN(monthDate.getTime())) return;
              
              if (isAfter(monthDate, cutoff)) {
                sum += Number(params.data.timePhasing?.[m]) || 0;
              }
            });
            return sum;
          }
          return params.data.qty;
        }
      },
      { 
        headerName: 'Unit', 
        field: 'unit', 
        editable: true, 
        width: 80,
        filter: 'agTextColumnFilter'
      },
      { 
        headerName: 'Rate', 
        field: 'rate', 
        editable: true, 
        type: 'numericColumn',
        width: 100,
        filter: 'agNumberColumnFilter',
        valueFormatter: currencyFormatter
      },
      { 
        headerName: 'Total', 
        field: 'total', 
        width: 120,
        type: 'numericColumn',
        filter: 'agNumberColumnFilter',
        valueGetter: (params: ValueGetterParams) => {
          if (!params.data) return 0;
          const qty = params.getValue('qty') || 0;
          const rate = params.data.rate || 0;
          return qty * rate;
        },
        valueFormatter: currencyFormatter,
        cellStyle: { fontWeight: 'bold', backgroundColor: theme === 'dark' ? '#1a1a1a' : '#f9fafb' }
      },
      {
        headerName: 'Budget',
        field: 'budget',
        editable: true,
        type: 'numericColumn',
        width: 120,
        filter: 'agNumberColumnFilter',
        valueFormatter: currencyFormatter
      },
      {
        headerName: 'Committed',
        field: 'committedCost',
        editable: true,
        type: 'numericColumn',
        width: 120,
        filter: 'agNumberColumnFilter',
        valueFormatter: currencyFormatter
      },
      {
        headerName: 'Actuals',
        field: 'actualCostToDate',
        editable: true,
        type: 'numericColumn',
        width: 120,
        filter: 'agNumberColumnFilter',
        valueFormatter: currencyFormatter
      },
      {
        headerName: 'Cost To Go',
        field: 'costToGo',
        editable: true,
        type: 'numericColumn',
        width: 120,
        filter: 'agNumberColumnFilter',
        valueFormatter: currencyFormatter
      },
      {
        headerName: 'EAC',
        field: 'eac',
        width: 120,
        type: 'numericColumn',
        filter: 'agNumberColumnFilter',
        valueGetter: (params: ValueGetterParams) => {
          if (!params.data) return 0;
          if (sheetType === 'commitment') {
            return (params.getValue('qty') || 0) * (params.data.rate || 0);
          }
          return (params.data.actualCostToDate || 0) + (params.data.costToGo || 0);
        },
        valueFormatter: currencyFormatter,
        cellStyle: { fontWeight: 'bold', backgroundColor: theme === 'dark' ? '#1a1a1a' : '#f9fafb' }
      },
      { 
        headerName: 'Category', 
        field: 'category', 
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: categories },
        width: 150,
        filter: 'agSetColumnFilter'
      },
      { 
        headerName: 'Control Account', 
        field: 'controlAccount', 
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: controlAccounts },
        width: 180,
        filter: 'agSetColumnFilter'
      },
      { 
        headerName: 'Order Number', 
        field: 'orderNumber', 
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: orderNumbers },
        width: 150,
        filter: 'agSetColumnFilter'
      }
    ];

    const phasingCols: ColDef[] = phasingMonths.map(month => ({
      headerName: month,
      field: `timePhasing.${month.replace(' ', '_')}`,
      editable: true,
      type: 'numericColumn',
      width: 100,
      valueGetter: (params: ValueGetterParams) => {
        if (!params.data) return 0;
        return params.data.timePhasing?.[month] || 0;
      },
      valueSetter: (params) => {
        if (!params.data.timePhasing) params.data.timePhasing = {};
        params.data.timePhasing[month] = Number(params.newValue);
        return true;
      },
      valueFormatter: currencyFormatter
    }));

    // Enterprise Cost Code Attributes
    const enterpriseCostCodeAttrs = (enterprise.costCodeAttributes || []).filter(attr => attr.title && attr.title.trim() !== '');
    const costCodeAttrCols: ColDef[] = enterpriseCostCodeAttrs.map(attr => ({
      headerName: `Cost Code: ${attr.title}`,
      field: `enterpriseCostCodeAttributes.${attr.id}`,
      width: 200,
      editable: true,
      filter: 'agSetColumnFilter',
      cellEditor: 'agRichSelectCellEditor',
      cellEditorParams: {
        values: (attr.values || [])
          .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
          .map(v => `${v.id} | ${v.description}`),
        searchType: 'matchAny',
        allowTyping: true,
        filterList: true
      }
    }));

    // Enterprise Line-Item Attributes
    const enterpriseLineItemAttrs = (enterprise.lineItemAttributes || []).filter(attr => attr.title && attr.title.trim() !== '');
    const lineItemAttrCols: ColDef[] = enterpriseLineItemAttrs.map(attr => ({
      headerName: `Line Item: ${attr.title}`,
      field: `enterpriseLineItemAttributes.${attr.id}`,
      width: 200,
      editable: true,
      filter: 'agSetColumnFilter',
      cellEditor: 'agRichSelectCellEditor',
      cellEditorParams: {
        values: (attr.values || [])
          .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
          .map(v => `${v.id} | ${v.description}`),
        searchType: 'matchAny',
        allowTyping: true,
        filterList: true
      }
    }));

    return [...baseCols, ...costCodeAttrCols, ...lineItemAttrCols, ...phasingCols];
  }, [sheetType, project, enterprise, phasingMonths, theme]);

  const onCellValueChanged = useCallback((event: CellValueChangedEvent) => {
    const updatedRows = [...data];
    const index = updatedRows.findIndex(r => r.id === event.data.id);
    if (index !== -1) {
      updatedRows[index] = { ...event.data };
      onDataChange(updatedRows);
    }
  }, [data, onDataChange]);

  const onGridReady = (params: GridReadyEvent) => {
    params.api.sizeColumnsToFit();
    
    // Load saved state
    const savedState = localStorage.getItem(`grid-state-${sheetId}`);
    if (savedState) {
      try {
        const { columnState, filterModel } = JSON.parse(savedState);
        if (columnState) params.api.applyColumnState({ state: columnState, applyOrder: true });
        if (filterModel) params.api.setFilterModel(filterModel);
      } catch (e) {
        console.error('Failed to load grid state', e);
      }
    }
  };

  const onColumnMoved = useCallback(() => saveViewState(), [saveViewState]);
  const onColumnResized = useCallback(() => saveViewState(), [saveViewState]);
  const onSortChanged = useCallback(() => saveViewState(), [saveViewState]);
  const onFilterChanged = useCallback(() => saveViewState(), [saveViewState]);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    filter: true,
    resizable: true,
    enableRowGroup: true,
    enablePivot: true,
    enableValue: true,
  }), []);

  const sideBar = useMemo(() => ({
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
    defaultToolPanel: '',
  }), []);

  return (
    <div className={`w-full h-full ${theme === 'dark' ? 'ag-theme-quartz-dark' : 'ag-theme-quartz'}`}>
      <AgGridReact
        key={sheetId}
        ref={gridRef}
        rowData={data}
        columnDefs={columnDefs}
        getRowId={(params) => params.data.id}
        defaultColDef={defaultColDef}
        sideBar={sideBar}
        rowSelection="multiple"
        onCellValueChanged={onCellValueChanged}
        onGridReady={onGridReady}
        onColumnMoved={onColumnMoved}
        onColumnResized={onColumnResized}
        onSortChanged={onSortChanged}
        onFilterChanged={onFilterChanged}
        animateRows={true}
        headerHeight={48}
        rowHeight={40}
        undoRedoCellEditing={true}
        undoRedoCellEditingLimit={20}
        enableRangeSelection={true}
        copyHeadersToClipboard={true}
      />
      <style>{`
        .ag-theme-quartz, .ag-theme-quartz-dark {
          --ag-font-family: 'Inter', sans-serif;
          --ag-font-size: 13px;
        }
        .ag-theme-quartz-dark {
          --ag-background-color: #141414;
          --ag-header-background-color: #1a1a1a;
          --ag-odd-row-background-color: #181818;
          --ag-border-color: rgba(255,255,255,0.1);
        }
      `}</style>
    </div>
  );
});

export default AgGridSheet;
