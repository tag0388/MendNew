import React, { ReactNode, useState, useRef, useMemo } from 'react';
import { Search, Plus, Trash2, Edit2, Upload, Download, Calculator, ChevronDown, ChevronUp, Hash, Calendar, RefreshCw, X, AlertTriangle } from 'lucide-react';
import { AgGridReact } from 'ag-grid-react';
import { cn } from '../lib/utils';
import { Project } from '../types';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';

interface DataGridModuleProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  
  // Toolbar
  searchPlaceholder?: string;
  quickFilterText?: string;
  onQuickFilterChange?: (text: string) => void;
  onImport?: () => void; // Legacy / Custom trigger
  onImportData?: (data: any[]) => void; // Standardized data handler
  importUniqueKey?: string | string[]; // Key for duplicate checking
  onExport?: () => void;
  onAdd?: () => void;
  onCalculate?: () => void;
  isCalculating?: boolean;
  
  // Bulk Actions
  selectedCount?: number;
  onBulkUpdate?: () => void;
  onBulkDelete?: () => void;
  
  // Extra Actions
  extraToolbarActions?: ReactNode;
  
  // Grid
  gridRef?: React.RefObject<AgGridReact>;
  rowData: any[];
  columnDefs: any[];
  pinnedTopRowData?: any[];
  pinnedBottomRowData?: any[];
  gridProps?: any;
  theme?: 'light' | 'dark';
  onCellValueChanged?: (event: any) => void;
  sideBar?: any;
  statusBar?: any;
  autoGroupColumnDef?: any;
  
  // Collapse logic (for split view)
  isMainTableCollapsed?: boolean;
  onToggleMainTableCollapse?: () => void;
  hasSubContent?: boolean;
  
  // Project context (for current period)
  project?: Project;
  showCurrentPeriod?: boolean;

  // Top content (summary cards, charts, etc)
  topContent?: ReactNode;
}

const DataGridModule: React.FC<DataGridModuleProps> = ({
  title,
  description,
  icon,
  searchPlaceholder = "Search...",
  quickFilterText,
  onQuickFilterChange,
  onImport,
  onImportData,
  importUniqueKey = 'id',
  onExport,
  onAdd,
  onCalculate,
  isCalculating,
  selectedCount = 0,
  onBulkUpdate,
  onBulkDelete,
  extraToolbarActions,
  gridRef,
  rowData,
  columnDefs,
  pinnedTopRowData,
  pinnedBottomRowData,
  gridProps = {},
  theme = 'light',
  onCellValueChanged,
  sideBar,
  statusBar,
  autoGroupColumnDef,
  isMainTableCollapsed = false,
  onToggleMainTableCollapse,
  hasSubContent = false,
  project,
  showCurrentPeriod = false,
  topContent
}) => {
  const [importPreview, setImportPreview] = useState<any[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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

        setImportPreview(data);
      } catch (error) {
        console.error('Error reading import file:', error);
        toast.error('Failed to read the import file.');
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsBinaryString(file);
  };

  const { duplicateIds, hasImportDuplicates } = useMemo(() => {
    if (!importPreview || !importUniqueKey) return { duplicateIds: [], hasImportDuplicates: false };
    
    const idsInFile = new Set<string>();
    const fileDuplicates = new Set<string>();
    const keys = Array.isArray(importUniqueKey) ? importUniqueKey : [importUniqueKey];
    
    importPreview.forEach(row => {
      // Try to find the ID using multiple common naming conventions if a specific key isn't found
      let idValue: any = null;
      for (const k of keys) {
        if (row[k] !== undefined) {
          idValue = row[k];
          break;
        }
      }
      
      // Fallback to common ID field names if specified key not found
      if (idValue === null) {
        idValue = row['ID'] || row['id'] || row['Code'] || row['code'] || row['Order ID'] || row['orderId'] || row['Risk ID'] || row['riskId'] || row['Vendor ID'] || row['Vendor Name'] || row['Vendor'];
      }

      if (idValue !== null && idValue !== undefined) {
        const normalizedId = idValue.toString().trim().toLowerCase();
        if (idsInFile.has(normalizedId)) {
          fileDuplicates.add(idValue.toString().trim());
        }
        idsInFile.add(normalizedId);
      }
    });

    const duplicateList = Array.from(fileDuplicates);
    return { 
      duplicateIds: duplicateList, 
      hasImportDuplicates: duplicateList.length > 0 
    };
  }, [importPreview, importUniqueKey]);

  const finalColumnDefs = React.useMemo(() => {
    if (!columnDefs || columnDefs.length === 0) return [];
    
    // Helper to check for checkbox selection in nested groups
    const hasCheckboxInDefs = (defs: any[]): boolean => {
      return defs.some(col => {
        if (col.children) return hasCheckboxInDefs(col.children);
        return col.checkboxSelection;
      });
    };

    const hasCheckbox = hasCheckboxInDefs(columnDefs);

    // Helper to map and inject checkbox settings recursively
    const injectCheckboxSettings = (defs: any[]): any[] => {
      return defs.map(col => {
        if (col.children) {
          return { ...col, children: injectCheckboxSettings(col.children) };
        }
        if (col.checkboxSelection) {
          return {
            ...col,
            checkboxSelection: (typeof col.checkboxSelection === 'function' && !col.checkboxSelection.toString().includes('rowPinned')) 
              ? col.checkboxSelection 
              : (params: any) => !params.node?.rowPinned,
            headerCheckboxSelectionFilteredOnly: true
          };
        }
        return col;
      });
    };

    if (hasCheckbox) {
      return injectCheckboxSettings(columnDefs);
    }
    return [
      {
        headerName: '',
        width: 50,
        checkboxSelection: (params: any) => !params.node?.rowPinned,
        headerCheckboxSelection: true,
        headerCheckboxSelectionFilteredOnly: true,
        pinned: 'left',
        lockPosition: 'left',
        suppressMenu: true,
        suppressMovable: true,
        suppressColumnsToolPanel: true,
        headerClass: 'bg-gray-50 dark:bg-[#1a1a1a]',
        cellClass: 'bg-white dark:bg-[#141414]'
      },
      ...columnDefs
    ];
  }, [columnDefs]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden">
      {/* Header / Toolbar */}
      <div className="p-6 border-b border-gray-100 dark:border-white/10 flex justify-between items-center bg-gray-50/50 dark:bg-white/5 shrink-0">
        <div>
          <h3 className="text-xl font-bold dark:text-white">{title}</h3>
          {description && <p className="text-sm text-gray-900 dark:text-gray-400">{description}</p>}
        </div>
        <div className="flex gap-2">
          {onQuickFilterChange && (
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                type="text" 
                placeholder={searchPlaceholder}
                value={quickFilterText}
                onChange={(e) => onQuickFilterChange(e.target.value)}
                className="pl-10 pr-4 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none w-64 dark:text-white"
              />
            </div>
          )}
          
          {(onImport || onImportData) && (
            <>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                className="hidden" 
                accept=".xlsx,.xls" 
              />
              <button 
                onClick={onImport || (() => fileInputRef.current?.click())} 
                className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" 
                title="Import"
              >
                <Upload className="w-5 h-5" />
              </button>
            </>
          )}
          {(onExport || gridRef) && (
            <button 
              onClick={() => {
                if (onExport) {
                  onExport();
                } else if (gridRef?.current?.api) {
                  gridRef.current.api.exportDataAsExcel({ 
                    fileName: `${title.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx` 
                  });
                }
              }} 
              className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors" 
              title="Export"
            >
              <Download className="w-5 h-5" />
            </button>
          )}
          
          {(onImport || onExport) && <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />}
          
          {extraToolbarActions}
          
          {onCalculate && (
            <button 
              onClick={onCalculate} 
              disabled={isCalculating}
              className="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-xl text-sm font-bold flex items-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-black/10 disabled:opacity-50"
            >
              {isCalculating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
              Calculate
            </button>
          )}

          {selectedCount > 1 && (
            <div className="flex gap-2">
              {onBulkUpdate && (
                <button onClick={onBulkUpdate} className="px-4 py-2 bg-black hover:bg-slate-800 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-lg shadow-black/20">
                  <Edit2 className="w-4 h-4" /> Bulk Update ({selectedCount})
                </button>
              )}
              {onBulkDelete && (
                <button onClick={onBulkDelete} className="px-4 py-2 bg-black hover:bg-slate-800 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-lg shadow-black/20">
                  <Trash2 className="w-4 h-4" /> Delete ({selectedCount})
                </button>
              )}
            </div>
          )}

          {onAdd && (
            <button onClick={onAdd} className="flex items-center gap-2 bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/90 dark:hover:bg-white/90 transition-all shadow-lg shadow-black/10">
              <Plus className="w-4 h-4" /> Add
            </button>
          )}
        </div>
      </div>

      {/* Top Content (Summary Cards, Charts) */}
      {topContent && (
        <div className="p-6 border-b border-gray-100 dark:border-white/10 bg-gray-50/30 dark:bg-white/5 shrink-0 overflow-y-auto max-h-[40%]">
          {topContent}
        </div>
      )}

      {/* Table Area */}
      <div className={cn(
        "flex flex-col transition-all duration-500 ease-in-out overflow-hidden",
        hasSubContent 
          ? (isMainTableCollapsed ? "h-[60px]" : "h-[40%]") 
          : "flex-1"
      )}>
        <div className="flex items-center justify-between px-4 py-1.5 bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-6">
            {showCurrentPeriod && project?.reportingPeriods?.currentPeriodId && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600">Current Period:</span>
                </div>
                {(() => {
                  const currentPeriod = project.reportingPeriods?.periods.find(p => p.id === project.reportingPeriods?.currentPeriodId);
                  if (!currentPeriod) return null;
                  
                  const date = new Date(currentPeriod.endDate);
                  const month = date.toLocaleString('default', { month: 'short' });
                  const year = date.getFullYear().toString().slice(-2);
                  const periodNumber = project.reportingPeriods.periods.indexOf(currentPeriod) + 1;
                  const dateStr = `P${periodNumber} (${month}'${year})`;
                  
                  return (
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-blue-600">{dateStr}</span>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
          {hasSubContent && onToggleMainTableCollapse && (
            <button 
              onClick={onToggleMainTableCollapse}
              className="p-1 hover:bg-gray-200 dark:hover:bg-white/10 rounded-md transition-colors text-gray-500"
              title={isMainTableCollapsed ? "Expand Table" : "Collapse Table"}
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
              rowData={rowData}
              columnDefs={finalColumnDefs}
              pinnedTopRowData={pinnedTopRowData}
              pinnedBottomRowData={pinnedBottomRowData}
              quickFilterText={quickFilterText}
              animateRows={true}
              enableRangeSelection={true}
              enableFillHandle={true}
              undoRedoCellEditing={true}
              pagination={true}
              paginationPageSize={50}
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
                ...gridProps.defaultColDef
              }}
              sideBar={sideBar || {
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
                  }
                ],
                defaultToolPanel: ''
              }}
              statusBar={statusBar || {
                statusPanels: [
                  { statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'left' },
                  { statusPanel: 'agTotalRowCountComponent', align: 'center' },
                  { statusPanel: 'agFilteredRowCountComponent', align: 'center' },
                  { statusPanel: 'agSelectedRowCountComponent', align: 'center' },
                  { statusPanel: 'agAggregationComponent', align: 'right' },
                ],
              }}
              autoGroupColumnDef={autoGroupColumnDef}
              onCellValueChanged={onCellValueChanged}
              suppressRowClickSelection={true}
              getRowClass={(params) => {
                if (params.node.rowPinned) {
                  return 'pinned-row-highlight';
                }
                return undefined;
              }}
              rowSelection="multiple"
              {...gridProps}
            />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {importPreview && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[110] p-4 text-left">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-4xl shadow-2xl border border-gray-200 dark:border-white/10 flex flex-col max-h-[90vh]"
            >
              <div className="flex justify-between items-start mb-6 shrink-0">
                <div>
                  <h2 className="text-2xl font-bold dark:text-white">Review Import: {title}</h2>
                  <p className="text-gray-900 dark:text-gray-400 text-sm mt-1">
                    Review records from your file. Existing entries will be updated based on matching IDs.
                  </p>
                </div>
                <button onClick={() => setImportPreview(null)} className="p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              {hasImportDuplicates && (
                <div className="mb-4 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl flex flex-col gap-2 shrink-0">
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
                      {Object.keys(importPreview[0] || {}).map(key => (
                        <th key={key} className="px-4 py-3 font-bold text-gray-900 dark:text-white uppercase tracking-widest text-[10px] bg-white dark:bg-[#1a1a1a]">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                    {importPreview.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-100/50 dark:hover:bg-white/5 transition-colors">
                        {Object.values(row).map((val: any, j) => (
                          <td key={j} className="px-4 py-3 text-gray-900 dark:text-gray-300 font-medium whitespace-nowrap">{val?.toString()}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-4 shrink-0">
                <button 
                  onClick={() => setImportPreview(null)}
                  className="flex-1 py-4 border border-gray-200 dark:border-white/10 rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-white/5 transition-colors dark:text-white"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    if (onImportData) {
                      onImportData(importPreview);
                    }
                    setImportPreview(null);
                  }}
                  disabled={hasImportDuplicates}
                  className="flex-1 py-4 bg-black dark:bg-white text-white dark:text-black rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-black/90 dark:hover:bg-white/90 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  Complete Import ({importPreview.length} records)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DataGridModule;
