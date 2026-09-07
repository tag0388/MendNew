import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { Enterprise } from '../types';
import { Plus, Trash2, Edit2, Building2, Shield, Search, AlertTriangle, X, Download, Upload, Filter, Eye, EyeOff, Lock, Unlock, Check, ChevronDown, CheckCircle2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SystemAdminProps {
  onSwitchEnterprise?: (id: string) => void;
  currentEnterpriseId?: string;
}

export default function SystemAdmin({ onSwitchEnterprise, currentEnterpriseId }: SystemAdminProps) {
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEnterprise, setEditingEnterprise] = useState<Enterprise | null>(null);
  const [formData, setFormData] = useState({ name: '', enterpriseId: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showImportSuccessModal, setShowImportSuccessModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string | string[], name: string, type: 'single' | 'bulk' } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'name' | 'enterpriseId' | 'createdAt'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(['enterpriseId', 'name', 'createdAt', 'admins']);
  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [isFrozen, setIsFrozen] = useState(true);
  const [importPreview, setImportPreview] = useState<any[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const idExists = !isSubmitting && !editingEnterprise && enterprises.some(e => e.enterpriseId === formData.enterpriseId);

  const columns = [
    { id: 'enterpriseId', label: 'Enterprise ID' },
    { id: 'name', label: 'Enterprise Name' },
    { id: 'createdAt', label: 'Date Created' },
    { id: 'admins', label: 'Admins' }
  ];

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'enterprises'), (snapshot) => {
      setEnterprises(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Enterprise)));
    }, (error) => {
      console.error("Enterprises fetch error:", error);
    });
    return () => unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.enterpriseId.length > 10) {
      alert('Enterprise ID must be maximum 10 characters.');
      return;
    }
    if (formData.name.length > 50) {
      alert('Enterprise Name must be maximum 50 characters.');
      return;
    }

    try {
      setIsSubmitting(true);
      const finalName = formData.name.trim() || 'Enterprise Name';
      if (editingEnterprise) {
        await updateDoc(doc(db, 'enterprises', editingEnterprise.id), {
          name: finalName,
          enterpriseId: formData.enterpriseId,
        });
      } else {
        // Check for uniqueness again on submit
        if (enterprises.some(e => e.enterpriseId === formData.enterpriseId)) {
          alert('This ID already Exists!');
          setIsSubmitting(false);
          return;
        }

        // Initialize 10 static attributes for both project and line items
        const defaultAttributes = Array.from({ length: 10 }, (_, i) => ({
          id: (i + 1).toString().padStart(2, '0'),
          title: '',
          values: []
        }));

        await addDoc(collection(db, 'enterprises'), {
          name: finalName,
          enterpriseId: formData.enterpriseId,
          adminUsers: [], 
          users: {},
          projectAttributes: defaultAttributes,
          lineItemAttributes: defaultAttributes,
          createdAt: new Date().toISOString()
        });
      }
      setIsModalOpen(false);
      setEditingEnterprise(null);
      setFormData({ name: '', enterpriseId: '' });
    } catch (error) {
      console.error('Operation failed', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string | string[]) => {
    if (Array.isArray(id)) {
      await Promise.all(id.map(i => deleteDoc(doc(db, 'enterprises', i))));
      setSelectedIds([]);
    } else {
      await deleteDoc(doc(db, 'enterprises', id));
      setSelectedIds(prev => prev.filter(i => i !== id));
    }
    setDeleteConfirm(null);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredEnterprises.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredEnterprises.map(e => e.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const filteredEnterprises = enterprises
    .filter(ent => 
      ent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ent.enterpriseId?.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      const valA = a[sortBy] || '';
      const valB = b[sortBy] || '';
      if (sortOrder === 'asc') return valA > valB ? 1 : -1;
      return valA < valB ? 1 : -1;
    });

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const exportToExcel = () => {
    const dataToExport = filteredEnterprises.map(ent => ({
      'Enterprise ID': ent.enterpriseId || '',
      'Enterprise Name': ent.name,
      'Date Created': ent.createdAt ? new Date(ent.createdAt).toLocaleDateString() : '',
      'Admins Count': ent.adminUsers?.length || 0
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Enterprises');
    XLSX.writeFile(wb, 'Enterprises.xlsx');
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const bstr = event.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws);
      setImportPreview(data);
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const completeImport = async () => {
    if (!importPreview) return;

    const batch = writeBatch(db);
    const defaultAttributes = Array.from({ length: 10 }, (_, i) => ({
      id: (i + 1).toString().padStart(2, '0'),
      title: '',
      values: []
    }));

    for (const row of importPreview) {
      const entId = row['Enterprise ID']?.toString() || '';
      const name = row['Enterprise Name']?.toString() || '';
      
      if (!name) continue;

      const existing = enterprises.find(e => e.enterpriseId === entId);
      if (existing) {
        batch.update(doc(db, 'enterprises', existing.id), {
          name,
          enterpriseId: entId
        });
      } else {
        const newDocRef = doc(collection(db, 'enterprises'));
        batch.set(newDocRef, {
          name,
          enterpriseId: entId,
          adminUsers: [],
          users: {},
          projectAttributes: defaultAttributes,
          lineItemAttributes: defaultAttributes,
          createdAt: new Date().toISOString()
        });
      }
    }

    await batch.commit();
    setImportPreview(null);
    setShowImportSuccessModal(true);
  };

  return (
    <div className="p-8 w-full transition-colors duration-300">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 dark:text-white">
            <Shield className="w-6 h-6 text-red-600" />
            System Administration
          </h1>
          <p className="text-gray-900 dark:text-gray-400 text-sm">
            Manage global enterprises and system-wide settings. 
            <span className="ml-2 font-bold text-black dark:text-white">Total: {enterprises.length}</span>
          </p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={exportToExcel}
            className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
            title="Export to Excel"
          >
            <Download className="w-5 h-5" />
          </button>
          <button 
            onClick={handleImportClick}
            className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
            title="Import from Excel"
          >
            <Upload className="w-5 h-5" />
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={onFileChange} 
            accept=".xlsx, .xls" 
            className="hidden" 
          />
          {selectedIds.length > 0 && (
            <button 
              onClick={() => setDeleteConfirm({ 
                id: selectedIds, 
                name: `${selectedIds.length} selected enterprises`,
                type: 'bulk'
              })}
              className="bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-red-100 dark:hover:bg-red-500/20 transition-all"
            >
              <Trash2 className="w-4 h-4" />
              Delete Selected ({selectedIds.length})
            </button>
          )}
          <button 
            onClick={() => {
              setEditingEnterprise(null);
              setFormData({ name: '', enterpriseId: '' });
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/90 dark:hover:bg-white/90 transition-all shadow-lg shadow-black/10"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </div>

      <div className="mb-6 flex justify-between items-center gap-4">
        <div className="relative max-w-md flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input 
            type="text"
            placeholder="Search enterprises..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button 
              onClick={() => setIsColumnMenuOpen(!isColumnMenuOpen)}
              className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors flex items-center gap-1 text-xs font-medium"
            >
              <Eye className="w-4 h-4" />
              Columns
              <ChevronDown className="w-3 h-3" />
            </button>
            {isColumnMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl shadow-xl z-50 p-2">
                {columns.map(col => (
                  <label key={col.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg cursor-pointer">
                    <input 
                      type="checkbox"
                      checked={visibleColumns.includes(col.id)}
                      onChange={() => {
                        setVisibleColumns(prev => 
                          prev.includes(col.id) ? prev.filter(c => c !== col.id) : [...prev, col.id]
                        );
                      }}
                      className="rounded border-gray-300 dark:border-white/10 text-black focus:ring-black"
                    />
                    <span className="text-xs dark:text-white">{col.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <button 
            onClick={() => setIsFrozen(!isFrozen)}
            className={`p-2 transition-colors flex items-center gap-1 text-xs font-medium ${isFrozen ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 hover:text-black dark:hover:text-white'}`}
          >
            {isFrozen ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            {isFrozen ? 'Frozen' : 'Freeze ID'}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-[#141414] rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden transition-colors">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
            <tr>
              <th className={`px-4 py-2 w-10 sticky left-0 z-20 bg-gray-50 dark:bg-[#1a1a1a] ${isFrozen ? 'border-r border-gray-200 dark:border-white/10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]' : ''}`}>
                <input 
                  type="checkbox"
                  checked={selectedIds.length === filteredEnterprises.length && filteredEnterprises.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300 dark:border-white/10 text-black focus:ring-black"
                />
              </th>
              {visibleColumns.includes('enterpriseId') && (
                <th 
                  className={`px-4 py-2 font-semibold text-gray-600 dark:text-gray-400 cursor-pointer hover:text-black dark:hover:text-white transition-colors text-xs ${isFrozen ? 'sticky left-10 z-20 bg-gray-50 dark:bg-[#1a1a1a] border-r border-gray-200 dark:border-white/10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]' : ''}`}
                  onClick={() => handleSort('enterpriseId')}
                >
                  Enterprise ID {sortBy === 'enterpriseId' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
              )}
              {visibleColumns.includes('name') && (
                <th 
                  className="px-4 py-2 font-semibold text-gray-600 dark:text-gray-400 cursor-pointer hover:text-black dark:hover:text-white transition-colors text-xs"
                  onClick={() => handleSort('name')}
                >
                  Enterprise Name {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
              )}
              {visibleColumns.includes('createdAt') && (
                <th 
                  className="px-4 py-2 font-semibold text-gray-600 dark:text-gray-400 cursor-pointer hover:text-black dark:hover:text-white transition-colors text-xs"
                  onClick={() => handleSort('createdAt')}
                >
                  Date Created {sortBy === 'createdAt' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
              )}
              {visibleColumns.includes('admins') && (
                <th className="px-4 py-2 font-semibold text-gray-600 dark:text-gray-400 text-xs">Admins</th>
              )}
              <th className="px-4 py-2 w-12 font-semibold text-gray-600 dark:text-gray-400 text-center text-xs">...</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/5">
            {filteredEnterprises.map((ent) => (
              <tr key={ent.id} className={`hover:bg-gray-50 dark:hover:bg-white/5 transition-colors ${ent.id === currentEnterpriseId ? 'bg-blue-50/50 dark:bg-blue-500/5' : ''}`}>
                <td className={`px-4 py-2 sticky left-0 z-10 bg-inherit ${isFrozen ? 'border-r border-gray-200 dark:border-white/10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]' : ''}`}>
                  <input 
                    type="checkbox"
                    checked={selectedIds.includes(ent.id)}
                    onChange={() => toggleSelect(ent.id)}
                    className="rounded border-gray-300 dark:border-white/10 text-black focus:ring-black"
                  />
                </td>
                {visibleColumns.includes('enterpriseId') && (
                  <td className={`px-4 py-2 font-mono text-[10px] dark:text-gray-400 ${isFrozen ? 'sticky left-10 z-10 bg-inherit border-r border-gray-200 dark:border-white/10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]' : ''}`}>
                    {ent.enterpriseId || '-'}
                  </td>
                )}
                {visibleColumns.includes('name') && (
                  <td className="px-4 py-2 flex items-center gap-3">
                    <Building2 className="w-3 h-3 text-gray-400" />
                    <span className="font-medium dark:text-white text-xs">{ent.name}</span>
                    {ent.id === currentEnterpriseId && (
                      <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 text-[8px] font-bold uppercase rounded">Current</span>
                    )}
                  </td>
                )}
                {visibleColumns.includes('createdAt') && (
                  <td className="px-4 py-2 text-gray-500 dark:text-gray-400 text-xs">
                    {ent.createdAt ? new Date(ent.createdAt).toLocaleDateString() : '-'}
                  </td>
                )}
                {visibleColumns.includes('admins') && (
                  <td className="px-4 py-2 text-gray-500 dark:text-gray-400 text-xs">
                    {ent.adminUsers?.length || 0} Admins
                  </td>
                )}
                <td className="px-4 py-2 text-right space-x-1">
                  {onSwitchEnterprise && (
                    <button 
                      disabled={ent.id === currentEnterpriseId}
                      onClick={() => onSwitchEnterprise(ent.id)}
                      className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${
                        ent.id === currentEnterpriseId 
                          ? 'bg-gray-100 dark:bg-white/5 text-gray-400 cursor-not-allowed' 
                          : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                      }`}
                    >
                      {ent.id === currentEnterpriseId ? 'Active' : 'Switch To'}
                    </button>
                  )}
                  <button 
                    onClick={() => {
                      setEditingEnterprise(ent);
                      setFormData({ name: ent.name, enterpriseId: ent.enterpriseId || '' });
                      setIsModalOpen(true);
                    }}
                    className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button 
                    onClick={() => setDeleteConfirm({ id: ent.id, name: ent.name, type: 'single' })}
                    className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
            {filteredEnterprises.length === 0 && (
              <tr>
                <td colSpan={3} className="px-6 py-12 text-center text-gray-900 dark:text-gray-400">
                  No enterprises found matching your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {importPreview && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[110] p-4">
          <div className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-2xl shadow-2xl border border-gray-200 dark:border-white/10 animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
            <h2 className="text-2xl font-bold mb-4 dark:text-white">Review Import</h2>
            <p className="text-gray-900 dark:text-gray-400 mb-6 text-sm">
              The following records will be imported. Existing IDs will be updated.
            </p>
            <div className="flex-1 overflow-auto border border-gray-200 dark:border-white/10 rounded-xl mb-6">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 dark:bg-white/5 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Enterprise ID</th>
                    <th className="px-4 py-2 font-semibold">Enterprise Name</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                  {importPreview.map((row, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 dark:text-white">{row['Enterprise ID']}</td>
                      <td className="px-4 py-2 dark:text-white">{row['Enterprise Name']}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-4">
              <button 
                onClick={() => setImportPreview(null)}
                className="flex-1 py-4 border border-gray-200 dark:border-white/10 rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-white/5 transition-colors dark:text-white"
              >
                Cancel
              </button>
              <button 
                onClick={completeImport}
                className="flex-1 py-4 bg-black dark:bg-white text-white dark:text-black rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-black/90 dark:hover:bg-white/90 transition-colors shadow-lg"
              >
                Complete Import
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <div className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-md shadow-2xl border border-gray-200 dark:border-white/10 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-red-50 dark:bg-red-500/10 rounded-full flex items-center justify-center mb-6 mx-auto">
              <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="text-2xl font-bold mb-2 text-center dark:text-white">
              {deleteConfirm.type === 'bulk' ? 'Delete Enterprises?' : 'Delete Enterprise?'}
            </h2>
            <p className="text-gray-900 dark:text-gray-400 text-center mb-8">
              You are about to delete <span className="font-bold text-black dark:text-white">{deleteConfirm.name}</span>.
              <br />This action cannot be undone and will remove all associated data.
            </p>
            <div className="flex gap-4">
              <button 
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-4 border border-gray-200 dark:border-white/10 rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-white/5 transition-colors dark:text-white"
              >
                Cancel
              </button>
              <button 
                onClick={() => handleDelete(deleteConfirm.id)}
                className="flex-1 py-4 bg-red-600 text-white rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white dark:bg-[#141414] rounded-2xl p-8 w-full max-w-md shadow-2xl border dark:border-white/10">
            <h2 className="text-xl font-bold mb-6 dark:text-white">{editingEnterprise ? 'Edit' : 'Add'} Enterprise</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">
                  Enterprise ID (Max 10 chars) <span className="text-red-500">*</span>
                </label>
                <input 
                  required
                  type="text" 
                  maxLength={10}
                  value={formData.enterpriseId}
                  onChange={e => setFormData({...formData, enterpriseId: e.target.value})}
                  placeholder="e.g. ENT-001"
                  className={cn(
                    "w-full p-3 bg-gray-50 dark:bg-white/5 border rounded-xl focus:outline-none focus:ring-2 dark:text-white transition-all",
                    idExists 
                      ? "border-red-500 focus:ring-red-500/20" 
                      : "border-gray-200 dark:border-white/10 focus:ring-black/5 dark:focus:ring-white/5"
                  )}
                />
                {idExists && (
                  <p className="text-[10px] text-red-500 mt-1 font-bold uppercase tracking-widest">This ID already Exists!</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Enterprise Name (Max 50 chars)</label>
                <input 
                  type="text" 
                  maxLength={50}
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  placeholder="e.g. Acme Corporation"
                  className="w-full p-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/5 dark:focus:ring-white/5 dark:text-white"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-white/5 transition-colors dark:text-white"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={!formData.enterpriseId || idExists}
                  className="flex-1 py-3 bg-black dark:bg-white text-white dark:text-black rounded-xl text-sm font-medium hover:bg-black/90 dark:hover:bg-white/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {editingEnterprise ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* System Information Section */}
      <div className="mt-12 pt-8 border-t border-gray-200 dark:border-white/10">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-white/20 mb-6">System Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-[#141414] p-6 rounded-2xl border border-gray-200 dark:border-white/10">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Application Version</p>
            <p className="text-lg font-bold dark:text-white">v1.0.0</p>
            <p className="text-[10px] text-gray-900 mt-2">Stable Production Release</p>
          </div>
          <div className="bg-white dark:bg-[#141414] p-6 rounded-2xl border border-gray-200 dark:border-white/10">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Environment</p>
            <p className="text-lg font-bold dark:text-white">Cloud Production</p>
            <p className="text-[10px] text-gray-900 mt-2">Region: asia-east1</p>
          </div>
          <div className="bg-white dark:bg-[#141414] p-6 rounded-2xl border border-gray-200 dark:border-white/10">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Database Status</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              <p className="text-lg font-bold dark:text-white">Connected</p>
            </div>
            <p className="text-[10px] text-gray-900 mt-2">Firebase Firestore (Multi-Region)</p>
          </div>
        </div>
      </div>
      {showImportSuccessModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white dark:bg-[#1a1a1a] rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-gray-100 dark:border-white/10"
          >
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Import Successful</h3>
              <p className="text-sm text-gray-900 dark:text-gray-400 mb-6">
                Your data has been imported successfully into the system.
              </p>
              <button
                onClick={() => setShowImportSuccessModal(false)}
                className="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
              >
                Got it
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
