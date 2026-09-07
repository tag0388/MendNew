import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Project, ProjectAttribute, ProjectAttributeValue } from '../types';
import { db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { 
  Plus, 
  Trash2, 
  Edit2, 
  ChevronRight, 
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import DataGridModule from './DataGridModule';
import { ColDef } from 'ag-grid-community';

// We reuse the pattern from EnterpriseAdmin for AttributeTitleInput but adapted for local component usage
const AttributeTitleInput = ({ 
  attr, 
  onSave 
}: { 
  attr: any; 
  onSave: (id: string, title: string) => void;
}) => {
  const [localTitle, setLocalTitle] = useState(attr.title || '');

  useEffect(() => {
    setLocalTitle(attr.title || '');
  }, [attr.title]);

  const handleBlur = () => {
    if (localTitle !== attr.title) {
      onSave(attr.id, localTitle);
    }
  };

  return (
    <input 
      type="text"
      value={localTitle}
      onChange={(e) => setLocalTitle(e.target.value)}
      onBlur={handleBlur}
      placeholder="Assign Title..."
      className="w-full bg-transparent border-none p-0 text-sm font-medium focus:ring-0 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600"
      onClick={(e) => e.stopPropagation()}
    />
  );
};

interface SubcontractAttributesProps {
  project: Project;
}

const SubcontractAttributes: React.FC<SubcontractAttributesProps> = ({ project }) => {
  const [attributes, setAttributes] = useState<ProjectAttribute[]>([]);
  const [selectedAttrId, setSelectedAttrId] = useState<string | null>('01');
  const [attrSearch, setAttrSearch] = useState('');
  const [isEditingValue, setIsEditingValue] = useState<{ attrId: string; valueId: string | null } | null>(null);
  const [valueFormData, setValueFormData] = useState<ProjectAttributeValue>({ id: '', description: '', sortOrder: 1 });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Initialize with 10 default attributes if empty
    const currentAttrs = project.subcontractAttributes || [];
    const initializedAttrs = Array.from({ length: 10 }, (_, i) => {
      const id = (i + 1).toString().padStart(2, '0');
      const existing = currentAttrs.find(a => a.id === id);
      return existing || { id, title: '', values: [] };
    });
    setAttributes(initializedAttrs);
  }, [project.subcontractAttributes]);

  const handleGlobalSave = async (updatedAttrs: ProjectAttribute[]) => {
    try {
      await updateDoc(doc(db, 'projects', project.id), { subcontractAttributes: updatedAttrs });
    } catch (error) {
      console.error('Error saving subcontract attributes:', error);
      toast.error('Failed to save changes.');
    }
  };

  const updateAttributeTitle = async (id: string, newTitle: string) => {
    const newAttrs = attributes.map(attr => attr.id === id ? { ...attr, title: newTitle } : attr);
    setAttributes(newAttrs);
    await handleGlobalSave(newAttrs);
  };

  const handleSaveValue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditingValue || !valueFormData.id) return;

    const newAttrs = attributes.map(attr => {
      if (attr.id === isEditingValue.attrId) {
        let newValues = [...attr.values];
        if (isEditingValue.valueId === null) {
          // Add new
          if (newValues.some(v => v.id === valueFormData.id)) {
            toast.error('A value with this ID already exists.');
            return attr;
          }
          newValues.push(valueFormData);
        } else {
          // Update existing
          newValues = newValues.map(v => v.id === isEditingValue.valueId ? valueFormData : v);
        }
        return { ...attr, values: newValues };
      }
      return attr;
    });

    setAttributes(newAttrs);
    await handleGlobalSave(newAttrs);
    setIsEditingValue(null);
    setValueFormData({ id: '', description: '', sortOrder: 1 });
  };

  const removeAttributeValue = async (attrId: string, valueId: string) => {
    const newAttrs = attributes.map(attr => {
      if (attr.id === attrId) {
        return { ...attr, values: attr.values.filter(v => v.id !== valueId) };
      }
      return attr;
    });
    setAttributes(newAttrs);
    await handleGlobalSave(newAttrs);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(valueId);
      return next;
    });
  };

  const bulkDeleteAttributeValues = async (attrId: string) => {
    const newAttrs = attributes.map(attr => {
      if (attr.id === attrId) {
        return { ...attr, values: attr.values.filter(v => !selectedIds.has(v.id)) };
      }
      return attr;
    });
    setAttributes(newAttrs);
    await handleGlobalSave(newAttrs);
    setSelectedIds(new Set());
  };

  const handleImport = async (file: File, attrId: string) => {
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const newAttrs = attributes.map(attr => {
          if (attr.id === attrId) {
            const newValues = [...attr.values];
            data.forEach(row => {
              if (row.id && row.description) {
                const existingIndex = newValues.findIndex(v => v.id === String(row.id));
                const newValue: ProjectAttributeValue = {
                  id: String(row.id),
                  description: String(row.description),
                  sortOrder: row.sortOrder ? Number(row.sortOrder) : newValues.length + 1
                };
                
                if (existingIndex >= 0) {
                  newValues[existingIndex] = newValue;
                } else {
                  newValues.push(newValue);
                }
              }
            });
            return { ...attr, values: newValues };
          }
          return attr;
        });

        setAttributes(newAttrs);
        await handleGlobalSave(newAttrs);
        toast.success('Imported successfully');
      } catch (error) {
        console.error('Error importing attribute values:', error);
        toast.error('Failed to import attribute values. Please check the file format.');
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsBinaryString(file);
  };

  const handleExport = (attrId: string) => {
    const attr = attributes.find(a => a.id === attrId);
    if (!attr) return;

    const ws = XLSX.utils.json_to_sheet(attr.values);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Attribute ${attr.id}`);
    XLSX.writeFile(wb, `${project.projectCode}_SubcontractAttr_${attr.id}.xlsx`);
  };

  const selectedAttr = attributes.find(a => a.id === selectedAttrId);
  
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
      field: 'id', 
      headerName: 'ID', 
      width: 120, 
      pinned: 'left',
      fontFamily: 'monospace'
    },
    { field: 'description', headerName: 'Description', flex: 1, minWidth: 200 },
    { 
      field: 'sortOrder', 
      headerName: 'Sort Order', 
      width: 120,
      valueFormatter: (params) => params.value?.toString().padStart(2, '0')
    },
    {
      headerName: '',
      width: 80,
      pinned: 'right',
      cellRenderer: (params: any) => (
        <div className="flex items-center justify-end gap-1">
          <button 
            onClick={() => {
              setValueFormData(params.data);
              setIsEditingValue({ attrId: selectedAttrId!, valueId: params.data.id });
            }}
            className="p-1.5 text-gray-400 hover:text-black dark:hover:text-white rounded-lg transition-all"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button 
            onClick={() => removeAttributeValue(selectedAttrId!, params.data.id)}
            className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )
    }
  ], [selectedAttrId]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#141414]">
      <div className="flex-1 flex gap-8 p-8 min-h-0">
        {/* Left Sidebar: 10 Static Rows */}
        <div className="w-80 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-sm">
          <div className="p-4 border-b border-gray-100 dark:border-white/10">
            <div className="relative">
              <Plus className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                type="text"
                placeholder="Search attributes..."
                value={attrSearch}
                onChange={e => setAttrSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-xs focus:outline-none dark:text-white"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-black">
                <tr className="border-b border-white/10">
                  <th className="p-2 text-[10px] font-bold uppercase tracking-widest text-white w-12 text-center">#</th>
                  <th className="p-2 text-[10px] font-bold uppercase tracking-widest text-white">Title</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {attributes.filter(a => a.title.toLowerCase().includes(attrSearch.toLowerCase()) || a.id.includes(attrSearch)).map((attr) => (
                  <tr 
                    key={attr.id}
                    onClick={() => setSelectedAttrId(attr.id)}
                    className={`cursor-pointer transition-colors ${selectedAttrId === attr.id ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/5'}`}
                  >
                    <td className="p-2 text-xs font-bold text-black dark:text-white text-center">{attr.id}</td>
                    <td className="p-2">
                      <AttributeTitleInput 
                        attr={attr} 
                        onSave={updateAttributeTitle} 
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Side: Value List Editor */}
        <div className="flex-1 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-sm">
          <AnimatePresence mode="wait">
            {selectedAttrId ? (
              <motion.div
                key={selectedAttrId}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 flex flex-col min-h-0"
              >
                <DataGridModule
                  title={`Subcontract Attribute ${selectedAttrId}${selectedAttr?.title ? `: ${selectedAttr.title}` : ''}`}
                  description="Manage the list of allowed values for this attribute."
                  rowData={selectedAttr?.values || []}
                  columnDefs={columnDefs}
                  onImport={() => fileInputRef.current?.click()}
                  onExport={() => handleExport(selectedAttrId)}
                  extraToolbarActions={
                    <>
                      {selectedIds.size > 0 && (
                        <button 
                          onClick={() => bulkDeleteAttributeValues(selectedAttrId)}
                          className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete ({selectedIds.size})
                        </button>
                      )}
                      <button 
                        onClick={() => {
                          setValueFormData({ id: '', description: '', sortOrder: (selectedAttr?.values?.length || 0) + 1 });
                          setIsEditingValue({ attrId: selectedAttrId, valueId: null });
                        }}
                        className="flex items-center gap-2 bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-all shadow-lg shadow-black/10"
                      >
                        <Plus className="w-4 h-4" />
                        Add
                      </button>
                    </>
                  }
                  gridProps={{
                    rowSelection: 'multiple',
                    onSelectionChanged: (event) => {
                      const selectedNodes = event.api.getSelectedNodes();
                      setSelectedIds(new Set(selectedNodes.map(node => node.data.id)));
                    }
                  }}
                />
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex flex-col items-center justify-center p-12 text-center"
              >
                <div className="w-16 h-16 bg-gray-50 dark:bg-white/5 rounded-full flex items-center justify-center mb-6">
                  <ChevronRight className="w-8 h-8 text-gray-300" />
                </div>
                <h3 className="text-lg font-bold dark:text-white mb-2">Select an Attribute</h3>
                <p className="text-sm text-gray-900 dark:text-gray-400 max-w-xs">Choose one of the 10 static attributes from the left sidebar to manage its values.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept=".xlsx,.xls,.csv"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && selectedAttrId) handleImport(file, selectedAttrId);
        }}
      />

      {/* Modals */}
      <AnimatePresence>
        {isEditingValue && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-200 dark:border-white/10"
            >
              <div className="p-6 border-b border-gray-100 dark:border-white/10 flex justify-between items-center">
                <h3 className="text-xl font-bold dark:text-white">{isEditingValue.valueId ? 'Edit Value' : 'Add New Value'}</h3>
                <button onClick={() => setIsEditingValue(null)} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-colors">
                  <Plus className="w-5 h-5 text-gray-400 rotate-45" />
                </button>
              </div>
              <form onSubmit={handleSaveValue} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Value ID</label>
                    <input 
                      required
                      disabled={!!isEditingValue.valueId}
                      value={valueFormData.id}
                      onChange={e => setValueFormData({ ...valueFormData, id: e.target.value })}
                      className="w-full px-4 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black dark:focus:ring-white dark:text-white disabled:opacity-50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Sort Order</label>
                    <input 
                      type="number"
                      required
                      value={valueFormData.sortOrder}
                      onChange={e => setValueFormData({ ...valueFormData, sortOrder: parseInt(e.target.value) || 0 })}
                      className="w-full px-4 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black dark:focus:ring-white dark:text-white"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Description</label>
                  <input 
                    required
                    value={valueFormData.description}
                    onChange={e => setValueFormData({ ...valueFormData, description: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black dark:focus:ring-white dark:text-white"
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setIsEditingValue(null)} className="flex-1 px-6 py-2.5 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-bold dark:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">Cancel</button>
                  <button type="submit" className="flex-1 px-6 py-2.5 bg-black dark:bg-white text-white dark:text-black rounded-xl text-sm font-bold hover:opacity-90 transition-opacity">
                    Save Value
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SubcontractAttributes;
