import React, { useMemo, useCallback, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { 
  ColDef, 
  CellValueChangedEvent,
  GridReadyEvent
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import { Plus, Trash2 } from 'lucide-react';

interface AgGridMasterListEditorProps {
  items: string[];
  onSave: (items: string[]) => void;
  label: string;
  theme: 'light' | 'dark';
}

export default function AgGridMasterListEditor({ 
  items, 
  onSave,
  label,
  theme 
}: AgGridMasterListEditorProps) {
  const gridRef = useRef<AgGridReact>(null);

  const rowData = useMemo(() => {
    const minRows = 10;
    const rows = items.map((item, i) => ({ id: i, value: item }));
    while (rows.length < minRows) {
      rows.push({ id: rows.length, value: '' });
    }
    return rows;
  }, [items]);

  const columnDefs = useMemo<ColDef[]>(() => [
    { 
      headerName: label, 
      field: 'value', 
      editable: true,
      flex: 1,
      cellStyle: { fontWeight: '500' }
    }
  ], [label]);

  const handleSave = useCallback(() => {
    if (!gridRef.current) return;
    
    const newItems: string[] = [];
    gridRef.current.api.forEachNode((node) => {
      const val = node.data.value?.trim();
      if (val) newItems.push(val);
    });

    onSave(Array.from(new Set(newItems)));
  }, [onSave]);

  const addRow = () => {
    gridRef.current?.api.applyTransaction({ add: [{ value: '' }] });
  };

  const onGridReady = (params: GridReadyEvent) => {
    params.api.sizeColumnsToFit();
  };

  const defaultColDef = useMemo(() => ({
    sortable: true,
    filter: true,
    resizable: true,
    suppressMovable: true
  }), []);

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex justify-between items-center shrink-0">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">{label}</h3>
        <div className="flex gap-2">
          <button
            onClick={addRow}
            className="p-1.5 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 rounded-lg transition-all border border-gray-200 dark:border-white/10"
            title="Add Row"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all text-[10px] font-bold shadow-sm"
          >
            SAVE
          </button>
        </div>
      </div>

      <div className={`flex-1 min-h-[150px] ${theme === 'dark' ? 'ag-theme-quartz-dark' : 'ag-theme-quartz'}`}>
        <AgGridReact
          ref={gridRef}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          onGridReady={onGridReady}
          animateRows={true}
          headerHeight={32}
          rowHeight={32}
          enableRangeSelection={true}
          copyHeadersToClipboard={false}
          suppressCopyRowsToClipboard={false}
          processDataFromClipboard={(params) => {
            return params.data;
          }}
        />
      </div>

      <style>{`
        .ag-theme-quartz, .ag-theme-quartz-dark {
          --ag-font-family: 'Inter', sans-serif;
          --ag-font-size: 12px;
        }
        .ag-theme-quartz-dark {
          --ag-background-color: #1a1a1a;
          --ag-header-background-color: #222;
          --ag-odd-row-background-color: #1c1c1c;
          --ag-border-color: rgba(255,255,255,0.05);
        }
      `}</style>
    </div>
  );
}
