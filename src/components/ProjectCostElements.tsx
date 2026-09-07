import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Project, Enterprise, ProjectCostElement, SavedView } from '../types';
import { db, auth } from '../firebase';
import { doc, updateDoc, onSnapshot, collection, query, where, addDoc, deleteDoc } from 'firebase/firestore';
import { 
  Search, 
  Plus, 
  Trash2, 
  Edit2, 
  Save, 
  X, 
  Upload, 
  Download, 
  Filter, 
  Layout, 
  Lock, 
  Unlock, 
  Hash, 
  Eye, 
  MoreVertical,
  PieChart,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

interface ProjectCostElementsProps {
  project: Project;
}

export default function ProjectCostElements({ project }: ProjectCostElementsProps) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [elements, setElements] = useState<ProjectCostElement[]>(project.costElements || []);
  
  // Table State
  const [search, setSearch] = useState('');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ field: keyof ProjectCostElement; direction: 'asc' | 'desc' }>({ field: 'sortCode', direction: 'asc' });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(['id', 'description', 'sortCode', 'enterpriseCostElementId']);
  const [isFrozen, setIsFrozen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // UI State
  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);
  const [isSavedViewMenuOpen, setIsSavedViewMenuOpen] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [newViewName, setNewViewName] = useState('');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState<{ id: string | null; insertIndex?: number } | null>(null);
  const [formData, setFormData] = useState<ProjectCostElement>({ id: '', description: '', sortCode: '', enterpriseCostElementId: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'single' | 'bulk'; id?: string; name?: string; count?: number } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load Enterprise Data
  useEffect(() => {
    if (!project.enterpriseId) return;
    const unsub = onSnapshot(doc(db, 'enterprises', project.enterpriseId), (doc) => {
      if (doc.exists()) {
        setEnterprise({ id: doc.id, ...doc.data() } as Enterprise);
      }
    });
    return () => unsub();
  }, [project.enterpriseId]);

  // Sync with project prop
  useEffect(() => {
    setElements(project.costElements || []);
  }, [project.costElements]);

  // Load Saved Views from Firestore
  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(
      collection(db, 'savedViews'), 
      where('userId', '==', auth.currentUser.uid),
      where('tableId', '==', `projectCostElements_${project.id}`)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const views = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as SavedView));
      setSavedViews(views);
    });
    return () => unsub();
  }, [project.id, auth.currentUser?.uid]);

  const saveView = async (name: string) => {
    if (!name.trim() || !auth.currentUser) return;
    try {
      const newView: Omit<SavedView, 'id'> = {
        name,
        tableId: `projectCostElements_${project.id}`,
        columns: visibleColumns,
        userId: auth.currentUser.uid,
        createdAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'savedViews'), newView);
      setNewViewName('');
      setIsSavedViewMenuOpen(false);
      toast.success('View saved successfully.');
    } catch (error) {
      console.error('Error saving view:', error);
      toast.error('Failed to save view.');
    }
  };

  const applyView = (view: SavedView) => {
    setVisibleColumns(view.columns);
    setIsSavedViewMenuOpen(false);
  };

  const deleteView = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'savedViews', id));
      toast.success('View deleted.');
    } catch (error) {
      console.error('Error deleting view:', error);
      toast.error('Failed to delete view.');
    }
  };

  const clearAllFilters = () => {
    setSearch('');
    setColumnFilters({});
    setSort({ field: 'sortCode', direction: 'asc' });
  };

  const handleGlobalSave = async (updatedElements: ProjectCostElement[]) => {
    try {
      await updateDoc(doc(db, 'projects', project.id), { 
        costElements: updatedElements,
        dateLastModified: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error saving cost elements:', error);
      toast.error('Failed to save changes to database.');
    }
  };

  const costElementIdExists = !isEditing?.id && elements.some(el => el.id === formData.id);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (!formData.id) {
      toast.error('ID is required.');
      return;
    }

    setIsSaving(true);
    try {
      let newElements = [...elements];
      
      if (isEditing?.id) {
        // Editing existing
        newElements = newElements.map(el => el.id === isEditing.id ? formData : el);
      } else {
        // Adding new
        if (newElements.some(el => el.id === formData.id)) {
          toast.error('A cost element with this ID already exists.');
          setIsSaving(false);
          return;
        }
        
        if (typeof isEditing?.insertIndex === 'number') {
          newElements.splice(isEditing.insertIndex, 0, formData);
        } else {
          newElements.push(formData);
        }
      }

      setElements(newElements);
      // Reset editing state immediately to prevent "ID already exists" flicker
      setIsEditing(null);
      setFormData({ id: '', description: '', sortCode: '', enterpriseCostElementId: '' });
      
      await handleGlobalSave(newElements);
      toast.success('Changes saved successfully.');
    } catch (error) {
      console.error('Error in handleSave:', error);
      toast.error('An unexpected error occurred.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;

    let newElements = [...elements];
    if (deleteConfirm.type === 'single' && deleteConfirm.id) {
      newElements = newElements.filter(el => el.id !== deleteConfirm.id);
    } else if (deleteConfirm.type === 'bulk') {
      newElements = newElements.filter(el => !selectedIds.has(el.id));
    }

    setElements(newElements);
    await handleGlobalSave(newElements);
    setSelectedIds(new Set());
    setDeleteConfirm(null);
    toast.success('Deleted successfully.');
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

        const newElements = [...elements];
        data.forEach(row => {
          const id = row.id || row.ID || row['Element ID'];
          const description = row.description || row.Description || '';
          const sortCode = row.sortCode || row.SortCode || row['Sort Code'] || '';
          const mapping = row.enterpriseCostElementId || row.EnterpriseMapping || row['Enterprise Mapping'] || '';

          if (id) {
            const existingIndex = newElements.findIndex(el => el.id === String(id));
            const newElement: ProjectCostElement = {
              id: String(id),
              description: String(description),
              sortCode: String(sortCode),
              enterpriseCostElementId: String(mapping)
            };
            
            if (existingIndex >= 0) {
              newElements[existingIndex] = newElement;
            } else {
              newElements.push(newElement);
            }
          }
        });

        setElements(newElements);
        await handleGlobalSave(newElements);
        toast.success('Import successful. Changes saved.');
      } catch (error) {
        console.error('Error importing cost elements:', error);
        toast.error('Failed to import cost elements. Please check the file format.');
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsBinaryString(file);
  };

  const handleExport = () => {
    const ws = XLSX.utils.json_to_sheet(elements);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cost Elements');
    XLSX.writeFile(wb, `${project.projectCode}_CostElements.xlsx`);
  };

  // Filter and Sort Logic
  const filteredElements = elements
    .filter(el => {
      // Global Search
      const searchMatch = !search || 
        el.id.toLowerCase().includes(search.toLowerCase()) ||
        el.description.toLowerCase().includes(search.toLowerCase()) ||
        el.sortCode.toLowerCase().includes(search.toLowerCase());
      
      if (!searchMatch) return false;

      // Column Filters
      return Object.entries(columnFilters).every(([field, value]) => {
        if (!value) return true;
        const fieldValue = String(el[field as keyof ProjectCostElement] || '').toLowerCase();
        return fieldValue.includes(value.toLowerCase());
      });
    })
    .sort((a, b) => {
      const aVal = String(a[sort.field] || '');
      const bVal = String(b[sort.field] || '');
      return sort.direction === 'asc' 
        ? aVal.localeCompare(bVal, undefined, { numeric: true }) 
        : bVal.localeCompare(aVal, undefined, { numeric: true });
    });

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden">
      {/* Header / Toolbar */}
      <div className="p-6 border-b border-gray-100 dark:border-white/10 flex justify-between items-center bg-gray-50/50 dark:bg-white/5 shrink-0">
        <div>
          <h3 className="text-xl font-bold dark:text-white">Project Cost Elements</h3>
          <p className="text-sm text-gray-900 dark:text-gray-400">Define project-specific cost elements and map them to enterprise standards.</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              type="text" 
              placeholder="Search cost elements..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none w-64 dark:text-white"
            />
          </div>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept=".xlsx,.xls,.csv"
            onChange={handleImport}
          />
          
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
            title="Import"
          >
            <Upload className="w-5 h-5" />
          </button>
          
          <button 
            onClick={handleExport}
            className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
            title="Export"
          >
            <Download className="w-5 h-5" />
          </button>

          <button 
            onClick={clearAllFilters}
            className="p-2 text-gray-400 hover:text-red-600 transition-colors flex items-center gap-1 text-xs font-medium"
            title="Clear All Filters"
          >
            <Filter className="w-4 h-4" /> Clear Filters
          </button>

          {/* Views Menu */}
          <div className="relative">
            <button 
              onClick={() => setIsSavedViewMenuOpen(!isSavedViewMenuOpen)}
              className="p-2 text-gray-400 hover:text-black dark:hover:text-white flex items-center gap-1 text-sm font-medium transition-colors"
            >
              <Layout className="w-5 h-5" /> Views
            </button>
            <AnimatePresence>
              {isSavedViewMenuOpen && (
                <motion.div 
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 mt-2 w-64 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl shadow-xl z-50 p-3"
                >
                  <div className="mb-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Save Current View</p>
                    <div className="flex gap-2">
                      <input 
                        type="text"
                        placeholder="View name..."
                        value={newViewName}
                        onChange={e => setNewViewName(e.target.value)}
                        className="flex-1 px-2 py-1 text-xs bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded outline-none dark:text-white"
                      />
                      <button 
                        onClick={() => saveView(newViewName)}
                        className="px-2 py-1 bg-black dark:bg-white text-white dark:text-black text-[10px] font-bold rounded"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Saved Views</p>
                    {savedViews.map(view => (
                      <div key={view.id} className="flex items-center justify-between group p-1.5 hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg cursor-pointer">
                        <span onClick={() => applyView(view)} className="text-xs dark:text-white flex-1">{view.name}</span>
                        <button onClick={() => deleteView(view.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600 transition-opacity">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {savedViews.length === 0 && (
                      <p className="text-[10px] text-gray-400 italic p-2">No saved views</p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Column Menu */}
          <div className="relative">
            <button 
              onClick={() => setIsColumnMenuOpen(!isColumnMenuOpen)} 
              className="p-2 text-gray-400 hover:text-black dark:hover:text-white flex items-center gap-1 text-sm font-medium transition-colors"
            >
              <Eye className="w-5 h-5" /> Columns
            </button>
            <AnimatePresence>
              {isColumnMenuOpen && (
                <motion.div 
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 mt-2 w-48 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl shadow-xl z-50 p-2"
                >
                  {['id', 'description', 'sortCode', 'enterpriseCostElementId'].map(col => (
                    <label key={col} className="flex items-center gap-2 p-2 hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg cursor-pointer">
                      <input 
                        type="checkbox"
                        checked={visibleColumns.includes(col)}
                        onChange={() => setVisibleColumns(prev => 
                          prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
                        )}
                        className="rounded border-gray-300 dark:border-white/10 text-black focus:ring-black"
                      />
                      <span className="text-xs dark:text-white uppercase tracking-widest font-bold">
                        {col === 'enterpriseCostElementId' ? 'Mapping' : col}
                      </span>
                    </label>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button 
            onClick={() => setIsFrozen(!isFrozen)} 
            className={cn(
              "p-2 flex items-center gap-1 text-sm font-medium transition-colors",
              isFrozen ? "text-blue-600" : "text-gray-400 hover:text-black dark:hover:text-white"
            )}
          >
            {isFrozen ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />} 
            {isFrozen ? 'Frozen' : 'Freeze'}
          </button>

          {selectedIds.size > 0 && (
            <button 
              onClick={() => setDeleteConfirm({ type: 'bulk', count: selectedIds.size })}
              className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
            >
              <Trash2 className="w-4 h-4" />
              Delete ({selectedIds.size})
            </button>
          )}

          <button 
            onClick={() => {
              setFormData({ id: '', description: '', sortCode: '', enterpriseCostElementId: '' });
              setIsEditing({ id: null });
            }}
            className="flex items-center gap-2 bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/90 dark:hover:bg-white/90 transition-all shadow-lg shadow-black/10"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </div>

      {/* Table Area */}
      <div className="flex-1 overflow-auto custom-scrollbar min-h-0 pb-48">
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead className="bg-black dark:bg-gray-100 sticky top-0 z-20">
            <tr className="border-b border-white/10 dark:border-black/10">
              <th className={cn(
                "p-3 w-12",
                isFrozen && "sticky left-0 z-30 bg-black dark:bg-gray-100 border-r border-white/10 dark:border-black/10"
              )}>
                <input 
                  type="checkbox" 
                  className="rounded border-gray-300 dark:border-black/20 bg-transparent"
                  checked={filteredElements.length > 0 && filteredElements.every(e => selectedIds.has(e.id))}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(new Set(filteredElements.map(e => e.id)));
                    } else {
                      setSelectedIds(new Set());
                    }
                  }}
                />
              </th>
              {visibleColumns.includes('id') && (
                <th 
                  onClick={() => setSort(prev => ({ field: 'id', direction: prev.field === 'id' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                  className={cn(
                    "p-3 w-32 text-[10px] font-bold uppercase tracking-widest text-white dark:text-black cursor-pointer hover:text-gray-300 dark:hover:text-gray-600 transition-colors",
                    isFrozen && "sticky left-12 z-30 bg-black dark:bg-gray-100 border-r border-white/10 dark:border-black/10"
                  )}
                >
                  ID {sort.field === 'id' && (sort.direction === 'asc' ? '↑' : '↓')}
                </th>
              )}
              {visibleColumns.includes('description') && (
                <th 
                  className="p-3 text-[10px] font-bold uppercase tracking-widest text-white dark:text-black cursor-pointer hover:text-gray-300 dark:hover:text-gray-600 transition-colors"
                  onClick={() => setSort(prev => ({ field: 'description', direction: prev.field === 'description' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                >
                  Description {sort.field === 'description' && (sort.direction === 'asc' ? '↑' : '↓')}
                </th>
              )}
              {visibleColumns.includes('sortCode') && (
                <th 
                  className="p-3 w-32 text-[10px] font-bold uppercase tracking-widest text-white dark:text-black cursor-pointer hover:text-gray-300 dark:hover:text-gray-600 transition-colors"
                  onClick={() => setSort(prev => ({ field: 'sortCode', direction: prev.field === 'sortCode' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                >
                  Sort Code {sort.field === 'sortCode' && (sort.direction === 'asc' ? '↑' : '↓')}
                </th>
              )}
              {visibleColumns.includes('enterpriseCostElementId') && (
                <th 
                  className="p-3 w-48 text-[10px] font-bold uppercase tracking-widest text-white dark:text-black cursor-pointer hover:text-gray-300 dark:hover:text-gray-600 transition-colors"
                  onClick={() => setSort(prev => ({ field: 'enterpriseCostElementId', direction: prev.field === 'enterpriseCostElementId' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                >
                  Enterprise Mapping {sort.field === 'enterpriseCostElementId' && (sort.direction === 'asc' ? '↑' : '↓')}
                </th>
              )}
              <th className="p-3 w-12 text-[10px] font-bold uppercase tracking-widest text-white dark:text-black sticky right-0 z-30 bg-black dark:bg-gray-100 border-l border-white/10 dark:border-black/10 text-center">...</th>
            </tr>
            {/* Filter Row */}
            <tr className="bg-gray-100/50 dark:bg-white/2 border-b border-gray-200 dark:border-white/10">
              <th className={cn(
                "p-2",
                isFrozen && "sticky left-0 z-30 bg-gray-100/50 dark:bg-[#1a1a1a] border-r border-gray-200 dark:border-white/10"
              )}></th>
              {visibleColumns.includes('id') && (
                <th className={cn(
                  "p-2 w-32",
                  isFrozen && "sticky left-12 z-30 bg-gray-100/50 dark:bg-[#1a1a1a] border-r border-gray-200 dark:border-white/10"
                )}>
                  <input 
                    type="text"
                    placeholder="Filter ID..."
                    value={columnFilters.id || ''}
                    onChange={(e) => setColumnFilters(prev => ({ ...prev, id: e.target.value }))}
                    className="w-full px-2 py-1 text-[10px] bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded focus:ring-1 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </th>
              )}
              {visibleColumns.includes('description') && (
                <th className="p-2">
                  <input 
                    type="text"
                    placeholder="Filter Description..."
                    value={columnFilters.description || ''}
                    onChange={(e) => setColumnFilters(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full px-2 py-1 text-[10px] bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded focus:ring-1 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </th>
              )}
              {visibleColumns.includes('sortCode') && (
                <th className="p-2 w-32">
                  <input 
                    type="text"
                    placeholder="Filter Sort..."
                    value={columnFilters.sortCode || ''}
                    onChange={(e) => setColumnFilters(prev => ({ ...prev, sortCode: e.target.value }))}
                    className="w-full px-2 py-1 text-[10px] bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded focus:ring-1 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </th>
              )}
              {visibleColumns.includes('enterpriseCostElementId') && (
                <th className="p-2 w-48">
                  <input 
                    type="text"
                    placeholder="Filter Mapping..."
                    value={columnFilters.enterpriseCostElementId || ''}
                    onChange={(e) => setColumnFilters(prev => ({ ...prev, enterpriseCostElementId: e.target.value }))}
                    className="w-full px-2 py-1 text-[10px] bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded focus:ring-1 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </th>
              )}
              <th className="p-2 sticky right-0 z-30 bg-gray-100/50 dark:bg-[#1a1a1a] border-l border-gray-200 dark:border-white/10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-white/5">
            {filteredElements.map((element, index) => {
              const idx = elements.findIndex(e => e.id === element.id);
              return (
                <tr 
                  key={element.id} 
                  className={cn(
                    "hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group",
                    selectedIds.has(element.id) && "bg-blue-50/50 dark:bg-blue-500/5"
                  )}
                >
                  <td className={cn(
                    "p-2",
                    isFrozen && "sticky left-0 z-10 bg-inherit border-r border-gray-100 dark:border-white/10"
                  )}>
                    <input 
                      type="checkbox" 
                      className="rounded border-gray-300 dark:border-white/20 bg-transparent"
                      checked={selectedIds.has(element.id)}
                      onChange={() => {
                        const newSelected = new Set(selectedIds);
                        if (newSelected.has(element.id)) newSelected.delete(element.id);
                        else newSelected.add(element.id);
                        setSelectedIds(newSelected);
                      }}
                    />
                  </td>
                  
                  {visibleColumns.includes('id') && (
                    <td className={cn(
                      "p-2 w-32 text-xs font-mono dark:text-white",
                      isFrozen && "sticky left-12 z-10 bg-inherit border-r border-gray-100 dark:border-white/10"
                    )}>
                      {element.id}
                    </td>
                  )}
                  {visibleColumns.includes('description') && (
                    <td className="p-2 text-xs font-bold dark:text-white truncate max-w-[400px]" title={element.description}>
                      {element.description}
                    </td>
                  )}
                  {visibleColumns.includes('sortCode') && (
                    <td className="p-2 w-32 text-xs text-gray-500 dark:text-gray-400">
                      {element.sortCode}
                    </td>
                  )}
                  {visibleColumns.includes('enterpriseCostElementId') && (
                    <td className="p-2 w-48 text-xs text-gray-500 dark:text-gray-400">
                      {element.enterpriseCostElementId ? (
                        <span className="flex items-center gap-2">
                          <Hash className="w-3 h-3" />
                          {enterprise?.costElements?.find(ce => ce.id === element.enterpriseCostElementId)?.description || element.enterpriseCostElementId}
                        </span>
                      ) : (
                        <span className="text-gray-400 italic">Unmapped</span>
                      )}
                    </td>
                  )}
                  <td className={cn(
                    "p-2 sticky right-0 bg-inherit border-l border-gray-100 dark:border-white/10",
                    activeMenuId === element.id ? "z-40" : "z-10"
                  )}>
                    <div className="flex justify-end gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                      <div className="relative">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(activeMenuId === element.id ? null : element.id);
                          }}
                          className={cn(
                            "p-1.5 rounded-lg transition-all",
                            activeMenuId === element.id 
                              ? "bg-black text-white dark:bg-white dark:text-black" 
                              : "text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5"
                          )}
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                        
                        <AnimatePresence>
                          {activeMenuId === element.id && (
                            <>
                              <div 
                                className="fixed inset-0 z-40" 
                                onClick={() => setActiveMenuId(null)}
                              />
                              <motion.div 
                                initial={{ opacity: 0, scale: 0.95, x: 10 }}
                                animate={{ opacity: 1, scale: 1, x: 0 }}
                                exit={{ opacity: 0, scale: 0.95, x: 10 }}
                                className={cn(
                                  "absolute right-full mr-2 w-48 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl shadow-xl z-50 p-2",
                                  index > filteredElements.length - 4 && index >= 3 ? "bottom-0 mb-0" : "top-0 mt-0"
                                )}
                              >
                                <button 
                                  onClick={() => {
                                    setFormData({ id: '', description: '', sortCode: '', enterpriseCostElementId: '' });
                                    setIsEditing({ id: null, insertIndex: idx });
                                    setActiveMenuId(null);
                                  }}
                                  className="w-full text-left p-2 text-xs dark:text-white hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg flex items-center gap-2"
                                >
                                  <Plus className="w-3 h-3" /> Insert Above
                                </button>
                                <button 
                                  onClick={() => {
                                    setFormData({ id: '', description: '', sortCode: '', enterpriseCostElementId: '' });
                                    setIsEditing({ id: null, insertIndex: idx + 1 });
                                    setActiveMenuId(null);
                                  }}
                                  className="w-full text-left p-2 text-xs dark:text-white hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg flex items-center gap-2"
                                >
                                  <Plus className="w-3 h-3" /> Insert Below
                                </button>
                                <hr className="my-1 border-gray-100 dark:border-white/10" />
                                <button 
                                  onClick={() => {
                                    setFormData(element);
                                    setIsEditing({ id: element.id });
                                    setActiveMenuId(null);
                                  }}
                                  className="w-full text-left p-2 text-xs dark:text-white hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg flex items-center gap-2"
                                >
                                  <Edit2 className="w-3 h-3" /> Edit
                                </button>
                                <button 
                                  onClick={() => {
                                    setDeleteConfirm({ type: 'single', id: element.id, name: element.description });
                                    setActiveMenuId(null);
                                  }}
                                  className="w-full text-left p-2 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg flex items-center gap-2"
                                >
                                  <Trash2 className="w-3 h-3" /> Delete
                                </button>
                              </motion.div>
                            </>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}

            {filteredElements.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 2} className="p-12 text-center">
                  <div className="w-16 h-16 bg-gray-50 dark:bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                    <PieChart className="w-8 h-8 text-gray-300" />
                  </div>
                  <p className="text-gray-900 dark:text-gray-400 text-sm">No cost elements found matching your search.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {isEditing && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <div className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-lg shadow-2xl border border-gray-200 dark:border-white/10 animate-in zoom-in-95 duration-200">
            <h2 className="text-xl font-bold mb-6 dark:text-white">{isEditing.id ? 'Edit' : 'Add'} Project Cost Element</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                  Element ID <span className="text-red-500">*</span>
                </label>
                <input 
                  required
                  disabled={!!isEditing.id}
                  type="text"
                  maxLength={10}
                  value={formData.id}
                  onChange={e => setFormData({ ...formData, id: e.target.value.toUpperCase() })}
                  className={cn(
                    "w-full p-4 bg-gray-50 dark:bg-white/5 border rounded-2xl text-sm focus:outline-none focus:ring-2 dark:text-white disabled:opacity-50 transition-all",
                    costElementIdExists 
                      ? "border-red-500 focus:ring-red-500/20" 
                      : "border-gray-200 dark:border-white/10 focus:ring-black/5"
                  )}
                />
                {costElementIdExists && (
                  <p className="text-[10px] text-red-500 mt-1 font-bold uppercase tracking-widest">This ID already Exists!</p>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Description</label>
                <input 
                  type="text"
                  maxLength={100}
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="e.g. Project Specific Labor"
                  className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Enterprise Mapping</label>
                <select 
                  value={formData.enterpriseCostElementId}
                  onChange={e => setFormData({ ...formData, enterpriseCostElementId: e.target.value })}
                  className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                >
                  <option value="">Select Enterprise Element...</option>
                  {enterprise?.costElements?.map(ce => (
                    <option key={ce.id} value={ce.id}>{ce.id} - {ce.description}</option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-1 italic">Map this project element to an enterprise standard for consolidated reporting.</p>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Sort Code</label>
                <input 
                  type="text"
                  value={formData.sortCode}
                  onChange={e => {
                    let val = e.target.value;
                    if (/^\d+$/.test(val)) val = val.padStart(2, '0');
                    setFormData({ ...formData, sortCode: val });
                  }}
                  placeholder="e.g. 01"
                  className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                />
              </div>
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsEditing(null)}
                  className="flex-1 px-6 py-4 bg-gray-100 dark:bg-white/5 text-gray-900 dark:text-white rounded-2xl text-sm font-bold hover:bg-gray-200 dark:hover:bg-white/10 transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={costElementIdExists || isSaving}
                  className="flex-1 px-6 py-4 bg-black dark:bg-white text-white dark:text-black rounded-2xl text-sm font-bold hover:bg-black/90 dark:hover:bg-white/90 transition-all shadow-lg shadow-black/10 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSaving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    isEditing.id ? 'Save Changes' : 'Add Element'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1a1a1a] w-full max-w-md rounded-2xl shadow-2xl border border-gray-200 dark:border-white/10 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-200 dark:border-white/10">
              <h3 className="text-xl font-bold dark:text-white flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-600" />
                {deleteConfirm.type === 'bulk' ? 'Delete Cost Elements?' : 'Delete Cost Element?'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {deleteConfirm.type === 'bulk' 
                  ? `Are you sure you want to delete ${deleteConfirm.count} selected cost elements?`
                  : `Are you sure you want to delete "${deleteConfirm.name}"?`
                } This action cannot be undone.
              </p>
            </div>
            <div className="p-6 bg-gray-50 dark:bg-white/5 flex gap-3">
              <button 
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
              >
                CANCEL
              </button>
              <button 
                onClick={handleDelete}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
              >
                CONFIRM DELETE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
