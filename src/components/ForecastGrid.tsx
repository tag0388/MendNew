import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, query, onSnapshot, doc, updateDoc, setDoc, addDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { Sheet, Project, ForecastRow, Enterprise } from '../types';
import { RefreshCw, Settings, Save, Plus, Filter, Download, Trash2, FileSpreadsheet, Upload } from 'lucide-react';
import SheetSettings from './SheetSettings';
import AgGridSheet, { AgGridSheetRef } from './AgGridSheet';
import { logAuditAction } from '../lib/audit';
import * as XLSX from 'xlsx';

interface ForecastGridProps {
  sheet: Sheet;
  project: Project;
  enterprise: Enterprise;
  theme: 'light' | 'dark';
}

export default function ForecastGrid({ sheet, project, enterprise, theme }: ForecastGridProps) {
  const [rows, setRows] = useState<ForecastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<ForecastRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const gridRef = useRef<AgGridSheetRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sheet?.id) return;
    
    console.log('Subscribing to rows for sheet:', sheet.id);
    const q = query(collection(db, `sheets/${sheet.id}/rows`));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`Received ${snapshot.size} rows for sheet: ${sheet.id}`);
      const r = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ForecastRow));
      setRows(r);
      setLoading(false);
    }, (error) => {
      console.error("Rows fetch error:", error);
      setLoading(false);
      alert(`Error fetching rows: ${error.message}`);
    });
    return () => unsubscribe();
  }, [sheet.id]);

  const handleAddRow = async () => {
    if (!sheet?.id) {
      alert('Cannot add row: Sheet ID is missing.');
      return;
    }

    const newRow: Partial<ForecastRow> = {
      sheetId: sheet.id,
      costCode: 'NEW-ITEM',
      description: 'New Item Description',
      vendor: '',
      qty: 0,
      rate: 0,
      budget: 0,
      committedCost: 0,
      actualCostToDate: 0,
      costToGo: 0,
      eac: 0,
      timePhasing: {},
      distributionMethod: 'even'
    };
    
    try {
      console.log('Adding row to sheet:', sheet.id, newRow);
      const rowsCollection = collection(db, `sheets/${sheet.id}/rows`);
      const docRef = await addDoc(rowsCollection, newRow);
      console.log('Row added successfully');
      
      await logAuditAction(enterprise.id, project.id, 'ADD_ROW', { 
        sheetId: sheet.id, 
        rowId: docRef.id,
        costCode: newRow.costCode 
      });
    } catch (error: any) {
      console.error('Failed to add row', error);
      alert(`Failed to add row: ${error.message}`);
    }
  };

  const handleSaveChanges = async () => {
    if (!pendingChanges) return;
    
    setSaving(true);
    try {
      const batch = writeBatch(db);
      for (const row of pendingChanges) {
        const rowRef = doc(db, `sheets/${sheet.id}/rows`, row.id);
        const { id, ...dataToUpdate } = row;
        batch.set(rowRef, dataToUpdate, { merge: true });
      }
      await batch.commit();
      
      await logAuditAction(enterprise.id, project.id, 'UPDATE_ROWS', { 
        sheetId: sheet.id, 
        rowCount: pendingChanges.length,
        rowIds: pendingChanges.map(r => r.id)
      });

      setPendingChanges(null);
      gridRef.current?.saveViewState();
    } catch (error) {
      console.error('Save failed', error);
      alert('Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleExportExcel = () => {
    gridRef.current?.exportToExcel(`${project.projectCode}_${sheet.sheetName}_${new Date().toISOString().split('T')[0]}`);
  };

  const handleExportCsv = () => {
    gridRef.current?.exportToCsv(`${project.projectCode}_${sheet.sheetName}_${new Date().toISOString().split('T')[0]}`);
  };

  const handleDeleteSelected = async () => {
    const selectedRows = gridRef.current?.getSelectedRows();
    if (!selectedRows || selectedRows.length === 0) {
      alert('No rows selected for deletion.');
      return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedRows.length} selected row(s)?`)) {
      return;
    }

    try {
      const batch = writeBatch(db);
      for (const row of selectedRows) {
        const rowRef = doc(db, `sheets/${sheet.id}/rows`, row.id);
        batch.delete(rowRef);
      }
      await batch.commit();
      
      await logAuditAction(enterprise.id, project.id, 'DELETE_ROWS', { 
        sheetId: sheet.id, 
        rowCount: selectedRows.length,
        rowIds: selectedRows.map(r => r.id)
      });

      console.log('Rows deleted successfully');
    } catch (error: any) {
      console.error('Failed to delete rows', error);
      alert(`Failed to delete rows: ${error.message}`);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        if (data.length === 0) {
          alert('No data found in the file.');
          return;
        }

        if (!confirm(`Import ${data.length} rows? This will add them to the current sheet.`)) {
          return;
        }

        setSaving(true);
        const batch = writeBatch(db);
        const rowsCollection = collection(db, `sheets/${sheet.id}/rows`);

        data.forEach((item) => {
          const newRowRef = doc(rowsCollection);
          const newRow: Partial<ForecastRow> = {
            sheetId: sheet.id,
            costCode: String(item.Item || item.costCode || 'NEW'),
            description: String(item.Description || item.description || ''),
            vendor: String(item.Vendor || item.vendor || ''),
            qty: Number(item.Qty || item.qty || 0),
            rate: Number(item.Rate || item.rate || 0),
            budget: Number(item.Budget || item.budget || 0),
            committedCost: Number(item.Committed || item.committedCost || 0),
            actualCostToDate: Number(item.Actuals || item.actualCostToDate || 0),
            costToGo: Number(item.CostToGo || item.costToGo || 0),
            eac: Number(item.EAC || item.eac || 0),
            timePhasing: {},
            distributionMethod: 'even'
          };
          batch.set(newRowRef, newRow);
        });

        await batch.commit();
        await logAuditAction(enterprise.id, project.id, 'IMPORT_ROWS', { 
          sheetId: sheet.id, 
          rowCount: data.length 
        });

        alert(`Successfully imported ${data.length} rows.`);
      } catch (error: any) {
        console.error('Import failed', error);
        alert(`Import failed: ${error.message}`);
      } finally {
        setSaving(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col w-full h-full bg-white dark:bg-[#0A0A0A] transition-colors duration-300 overflow-hidden">
      <div className="p-4 bg-white dark:bg-[#141414] border-b border-gray-200 dark:border-white/10 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">Project Cutoff</span>
            <span className="text-xs font-mono font-bold text-red-600 dark:text-red-400">{project.cutoffDate || 'NOT SET'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">Sheet Type</span>
            <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400 uppercase">{sheet.forecastMethod}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button 
            onClick={handleAddRow}
            className="flex items-center gap-2 bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/90 dark:hover:bg-white/90 transition-all shadow-lg shadow-black/10"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>

          <div className="h-10 w-[1px] bg-gray-200 dark:bg-white/10 mx-1" />

          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept=".xlsx,.xls,.csv" 
            className="hidden" 
          />
          
          <button 
            onClick={handleImportClick}
            className="flex items-center gap-2 px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl transition-all text-sm font-bold border border-blue-200 dark:border-blue-500/20"
            title="Import from Excel/CSV"
          >
            <Upload className="w-4 h-4" />
            IMPORT
          </button>

          <button 
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-3 py-2 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl transition-all text-sm font-bold border border-emerald-200 dark:border-emerald-500/20"
            title="Export to Excel"
          >
            <FileSpreadsheet className="w-4 h-4" />
            EXCEL
          </button>

          <button 
            onClick={handleExportCsv}
            className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-white/5 text-gray-600 dark:text-gray-400 rounded-xl transition-all text-sm font-bold border border-gray-200 dark:border-white/10"
            title="Export to CSV"
          >
            <Download className="w-4 h-4" />
            CSV
          </button>

          <button 
            onClick={handleDeleteSelected}
            className="flex items-center gap-2 px-3 py-2 hover:bg-red-50 dark:hover:bg-red-500/10 text-red-600 dark:text-red-400 rounded-xl transition-all text-sm font-bold border border-red-200 dark:border-red-500/20"
            title="Delete Selected Rows"
          >
            <Trash2 className="w-4 h-4" />
            DELETE
          </button>

          <div className="h-10 w-[1px] bg-gray-200 dark:bg-white/10 mx-1" />

          <button 
            onClick={() => gridRef.current?.clearFilters()}
            className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-white/5 text-gray-600 dark:text-gray-400 rounded-xl transition-all text-sm font-bold border border-gray-200 dark:border-white/10"
            title="Clear All Filters"
          >
            <Filter className="w-4 h-4" />
            CLEAR FILTERS
          </button>

          <button 
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-white/5 text-gray-600 dark:text-gray-400 rounded-xl transition-all text-sm font-bold border border-gray-200 dark:border-white/10"
            title="Refresh Data"
          >
            <RefreshCw className="w-4 h-4" />
            REFRESH
          </button>
          
          <button 
            onClick={handleSaveChanges}
            disabled={saving || !pendingChanges}
            className={`flex items-center gap-2 px-6 py-2 rounded-xl transition-all text-sm font-bold shadow-lg ${
              pendingChanges 
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20 hover:scale-[1.02] active:scale-[0.98]' 
                : 'bg-gray-200 dark:bg-white/5 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Save className={`w-4 h-4 ${saving ? 'animate-pulse' : ''}`} />
            {saving ? 'SAVING...' : 'SAVE CHANGES'}
          </button>
          
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2.5 hover:bg-gray-100 dark:hover:bg-white/5 rounded-xl transition-colors text-gray-900 border border-transparent hover:border-gray-200 dark:hover:border-white/10"
            title="Sheet Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 w-full overflow-hidden">
        <AgGridSheet 
          ref={gridRef}
          sheetId={sheet.id}
          sheetType={sheet.forecastMethod}
          project={project}
          enterprise={enterprise}
          data={rows} 
          onDataChange={(newData) => setPendingChanges(newData)} 
          theme={theme}
        />
      </div>

      <div className="p-3 bg-white dark:bg-[#141414] border-t border-gray-200 dark:border-white/10 flex justify-between items-center shrink-0">
        <div className="flex gap-8">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">Total EAC</span>
            <span className="text-sm font-mono font-bold dark:text-white">${rows.reduce((acc, r) => {
              const eac = sheet.forecastMethod === 'commitment' ? (r.qty || 0) * (r.rate || 0) : (r.actualCostToDate || 0) + (r.costToGo || 0);
              return acc + eac;
            }, 0).toLocaleString()}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">Total ETC</span>
            <span className="text-sm font-mono font-bold text-blue-600 dark:text-blue-400">${rows.reduce((acc, r) => {
              const eac = sheet.forecastMethod === 'commitment' ? (r.qty || 0) * (r.rate || 0) : (r.actualCostToDate || 0) + (r.costToGo || 0);
              const etc = Math.max(0, eac - (r.actualCostToDate || 0));
              return acc + etc;
            }, 0).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-gray-400 uppercase tracking-widest">
          <RefreshCw className="w-3 h-3 animate-spin-slow" />
          Live Sync Active
        </div>
      </div>

      {showSettings && (
        <SheetSettings 
          sheet={sheet} 
          project={project} 
          onClose={() => setShowSettings(false)} 
        />
      )}
    </div>
  );
}
