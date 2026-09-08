import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Project, ResourceRate } from '../types';
import {
  fetchProjectResourceRates,
  upsertProjectResourceRate,
  deleteProjectResourceRates,
  importProjectResourceRates,
} from '../lib/projectSettings';
import { Plus, Trash2, Edit2, Download, Upload, DollarSign } from 'lucide-react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import DataGridModule from './DataGridModule';
import { ColDef } from 'ag-grid-community';
import { toast } from 'sonner';

const RESOURCE_CATEGORIES = ['Labour', 'Plant', 'Material', 'Subcontractor', 'Sundries', 'Staff'];

interface ProjectResourceRatesProps {
  project: Project;
}

export default function ProjectResourceRates({ project }: ProjectResourceRatesProps) {
  const [selectedRateIds, setSelectedRateIds] = useState<Set<string>>(new Set());
  const [isEditingResource, setIsEditingResource] = useState<{ id: string | null } | null>(null);
  const [rates, setRates] = useState<ResourceRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [resourceFormData, setResourceFormData] = useState<ResourceRate>({
    id: '',
    code: '',
    name: '', 
    unit: '', 
    rate: 0, 
    category: 'Labour',
    udf1: '',
    udf2: '',
    udf3: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const columnDefs = useMemo<ColDef[]>(() => [
    {
      headerName: '',
      width: 50,
      checkboxSelection: true,
      headerCheckboxSelection: true,
      pinned: 'left',
      lockPosition: true,
      suppressMenu: true,
    },
    {
      // The code people type, not the row's uuid.
      field: 'code',
      headerName: 'ID',
      width: 120,
      pinned: 'left',
      fontFamily: 'monospace'
    },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
    { field: 'category', headerName: 'Category', width: 150 },
    { field: 'unit', headerName: 'Unit', width: 100 },
    { 
      field: 'rate', 
      headerName: 'Rate', 
      width: 120,
      valueFormatter: (params) => params.value ? `$${params.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '$0.00',
      cellClass: 'text-right font-medium'
    },
    { field: 'udf1', headerName: 'UDF 1', width: 120 },
    { field: 'udf2', headerName: 'UDF 2', width: 120 },
    { field: 'udf3', headerName: 'UDF 3', width: 120 },
    {
      headerName: '',
      width: 80,
      pinned: 'right',
      cellRenderer: (params: any) => (
        <button 
          onClick={() => {
            setResourceFormData(params.data);
            setIsEditingResource({ id: params.data.id });
          }}
          className="p-1.5 text-gray-400 hover:text-black dark:hover:text-white rounded-lg transition-all"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      )
    }
  ], []);

  const reload = useCallback(async () => {
    try {
      setRates(await fetchProjectResourceRates(project.id));
    } catch (error) {
      console.error('Failed to load project resources', error);
      toast.error('Failed to load project resources.');
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleSaveResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      // One row written, not the whole library rewritten. The duplicate check
      // is the database's: (project_id, code) is unique, so it holds even when
      // two people add the same code at the same moment.
      await upsertProjectResourceRate(project.id, {
        ...resourceFormData,
        id: isEditingResource?.id || undefined,
      });
      await reload();
      setIsEditingResource(null);
      toast.success(isEditingResource?.id ? 'Resource updated' : 'Resource added');
    } catch (error: any) {
      console.error('Failed to save resource', error);
      toast.error(
        error?.code === '23505'
          ? `Resource ID "${resourceFormData.code}" already exists in this project.`
          : `Failed to save resource: ${error?.message || 'Unknown error'}`
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteResources = async () => {
    if (selectedRateIds.size === 0) return;
    
    try {
      await deleteProjectResourceRates(Array.from(selectedRateIds));
      await reload();
      setSelectedRateIds(new Set());
      toast.success('Resources deleted');
    } catch (error: any) {
      console.error('Failed to delete resources', error);
      toast.error(`Failed to delete resources: ${error?.message || 'Unknown error'}`);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
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

        // The sheet's ID column is the resource CODE; the row's uuid is
        // assigned by the database.
        const newRates = data.map(row => ({
          code: String(row.ID || row.id || '').trim(),
          name: String(row.Name || row.name || '').trim(),
          category: String(row.Category || row.category || 'Labour'),
          unit: String(row.Unit || row.unit || ''),
          rate: Number(row.Rate || row.rate || 0),
          udf1: String(row.UDF1 || row.udf1 || ''),
          udf2: String(row.UDF2 || row.udf2 || ''),
          udf3: String(row.UDF3 || row.udf3 || '')
        })).filter(r => r.code && r.name);

        if (newRates.length === 0) {
          toast.error('No rows with both an ID and a Name were found in the sheet.');
          return;
        }

        // One insert for the whole sheet -- imports are expected to run to
        // thousands of rows, so this must not become a loop.
        const imported = await importProjectResourceRates(project.id, newRates);
        await reload();
        toast.success(`Imported ${imported} resources`);
      } catch (error: any) {
        console.error('Import failed', error);
        toast.error(
          error?.code === '23505'
            ? 'Import failed: the sheet contains a Resource ID that already exists in this project.'
            : `Import failed: ${error?.message || 'Unknown error'}`
        );
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleExport = () => {
    const ws = XLSX.utils.json_to_sheet(rates);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Resources');
    XLSX.writeFile(wb, `${project.projectCode}_Resources.xlsx`);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#141414] rounded-2xl border border-gray-200 dark:border-white/10 overflow-hidden m-8">
      <DataGridModule
        title="Project Resource Rates"
        description="Manage project-specific resources and their base rates."
        rowData={rates}
        columnDefs={columnDefs}
        onImport={() => fileInputRef.current?.click()}
        onExport={handleExport}
        extraToolbarActions={
          <>
            {selectedRateIds.size > 0 && (
              <button 
                onClick={handleDeleteResources} 
                className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-red-700 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete ({selectedRateIds.size})
              </button>
            )}
            <button 
              onClick={() => {
                setResourceFormData({ id: '', code: '', name: '', unit: '', rate: 0, category: 'Labour', udf1: '', udf2: '', udf3: '' });
                setIsEditingResource({ id: null });
              }}
              className="flex items-center gap-2 bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-all"
            >
              <Plus className="w-4 h-4" /> Add Resource
            </button>
          </>
        }
        gridProps={{
          rowSelection: 'multiple',
          onSelectionChanged: (event) => {
            const selectedNodes = event.api.getSelectedNodes();
            setSelectedRateIds(new Set(selectedNodes.map(node => node.data.id)));
          }
        }}
      />

      <input type="file" ref={fileInputRef} className="hidden" onChange={handleImport} />

      <AnimatePresence>
        {isEditingResource && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-200 dark:border-white/10"
            >
              <div className="p-6 border-b border-gray-100 dark:border-white/10 flex justify-between items-center">
                <h3 className="text-xl font-bold dark:text-white">{isEditingResource.id ? 'Edit Resource' : 'Add New Resource'}</h3>
                <button onClick={() => setIsEditingResource(null)} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-colors">
                  <Plus className="w-5 h-5 text-gray-400 rotate-45" />
                </button>
              </div>
              <form onSubmit={handleSaveResource} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Resource ID</label>
                    <input 
                      required
                      disabled={!!isEditingResource.id}
                      value={resourceFormData.code}
                      onChange={e => setResourceFormData({ ...resourceFormData, code: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black dark:focus:ring-white dark:text-white disabled:opacity-50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Resource Category</label>
                    <select 
                      value={resourceFormData.category}
                      onChange={e => setResourceFormData({ ...resourceFormData, category: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black dark:focus:ring-white dark:text-white"
                    >
                      {RESOURCE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Resource Name</label>
                  <input 
                    required
                    value={resourceFormData.name}
                    onChange={e => setResourceFormData({ ...resourceFormData, name: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black dark:focus:ring-white dark:text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Unit</label>
                    <input 
                      type="text"
                      value={resourceFormData.unit}
                      onChange={e => setResourceFormData({ ...resourceFormData, unit: e.target.value })}
                      placeholder="e.g. HR, DAY, M2"
                      className="w-full px-4 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black dark:focus:ring-white dark:text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Base Rate ($)</label>
                    <input 
                      type="number"
                      step="0.01"
                      required
                      value={resourceFormData.rate}
                      onChange={e => setResourceFormData({ ...resourceFormData, rate: parseFloat(e.target.value) || 0 })}
                      className="w-full px-4 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black dark:focus:ring-white dark:text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {['udf1', 'udf2', 'udf3'].map((field, i) => (
                    <div key={field} className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">UDF {i + 1}</label>
                      <input 
                        value={(resourceFormData as any)[field]}
                        onChange={e => setResourceFormData({ ...resourceFormData, [field]: e.target.value })}
                        className="w-full px-4 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black dark:focus:ring-white dark:text-white"
                      />
                    </div>
                  ))}
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setIsEditingResource(null)} className="flex-1 px-6 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-bold dark:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">Cancel</button>
                  <button type="submit" disabled={isSubmitting} className="flex-1 px-6 py-2.5 bg-black dark:bg-white text-white dark:text-black rounded-xl text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50">
                    {isSubmitting ? 'Saving...' : 'Save Resource'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
