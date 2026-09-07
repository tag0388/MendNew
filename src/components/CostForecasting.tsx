import React, { useState } from 'react';
import { Project, Sheet } from '../types';
import { Plus, Search, Filter, MoreVertical, Trash2, Edit2, ExternalLink, FileText, Calendar, TrendingUp, DollarSign } from 'lucide-react';

interface CostForecastingProps {
  project: Project;
  sheets: Sheet[];
  onAddSheet: (name: string) => void;
  onDeleteSheet: (id: string) => void;
  onOpenSheet: (sheet: Sheet) => void;
  sheetStats: Record<string, { eac: number, etc: number }>;
}

const CostForecasting: React.FC<CostForecastingProps> = ({ 
  project, 
  sheets, 
  onAddSheet, 
  onDeleteSheet, 
  onOpenSheet,
  sheetStats
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSheetName, setNewSheetName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSheets = sheets.filter(sheet => 
    sheet.sheetName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAdd = () => {
    if (newSheetName.trim()) {
      onAddSheet(newSheetName);
      setNewSheetName('');
      setShowAddModal(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-gray-50/50 dark:bg-[#0a0a0a]">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold dark:text-white">Forecasting Sheets</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Manage and update detailed cost forecasting sheets for each project element.</p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg shadow-blue-500/20"
        >
          <Plus className="w-4 h-4" />
          New Sheet
        </button>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[300px] relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
          <input 
            type="text" 
            placeholder="Search sheets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl pl-11 pr-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 transition-all dark:text-white"
          />
        </div>
        <button className="flex items-center gap-2 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 px-4 py-3 rounded-2xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-white/5 transition-all dark:text-white">
          <Filter className="w-4 h-4" />
          Filters
        </button>
      </div>

      {/* Sheet Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredSheets.map((sheet) => (
          <div 
            key={sheet.id} 
            className="bg-white dark:bg-[#141414] p-6 rounded-3xl border border-gray-200 dark:border-white/10 shadow-sm hover:shadow-xl transition-all group relative overflow-hidden"
          >
            {/* Background Accent */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>

            <div className="flex justify-between items-start mb-6">
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl text-blue-600 group-hover:scale-110 transition-transform">
                <FileText className="w-6 h-6" />
              </div>
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => onOpenSheet(sheet)}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg text-gray-400 hover:text-blue-600 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => onDeleteSheet(sheet.id)}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg text-gray-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-bold dark:text-white group-hover:text-blue-600 transition-colors">{sheet.sheetName}</h3>
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-1">
                  <Calendar className="w-3.5 h-3.5" />
                  Last updated: {new Date(sheet.updatedAt).toLocaleDateString()}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100 dark:border-white/5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Total EAC</p>
                  <div className="flex items-center gap-1 text-sm font-bold dark:text-white">
                    <TrendingUp className="w-3.5 h-3.5 text-blue-500" />
                    ${(sheetStats[sheet.id]?.eac || 0).toLocaleString()}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Total ETC</p>
                  <div className="flex items-center gap-1 text-sm font-bold dark:text-white">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
                    ${(sheetStats[sheet.id]?.etc || 0).toLocaleString()}
                  </div>
                </div>
              </div>

              <button 
                onClick={() => onOpenSheet(sheet)}
                className="w-full bg-gray-50 dark:bg-white/5 hover:bg-blue-600 hover:text-white text-gray-600 dark:text-gray-300 py-2.5 rounded-xl text-xs font-bold transition-all"
              >
                Open Forecasting Sheet
              </button>
            </div>
          </div>
        ))}

        {/* Empty State / Add New */}
        <div 
          onClick={() => setShowAddModal(true)}
          className="bg-gray-50/50 dark:bg-white/5 border-2 border-dashed border-gray-200 dark:border-white/10 rounded-3xl p-8 flex flex-col items-center justify-center gap-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/10 hover:border-blue-500/50 transition-all group"
        >
          <div className="w-12 h-12 rounded-full bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 flex items-center justify-center text-gray-400 group-hover:text-blue-600 group-hover:scale-110 transition-all">
            <Plus className="w-6 h-6" />
          </div>
          <div className="text-center">
            <p className="text-sm font-bold dark:text-white">Create New Sheet</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Add a new forecasting sheet to track costs.</p>
          </div>
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white dark:bg-[#141414] w-full max-w-md rounded-3xl shadow-2xl border border-gray-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-8 space-y-6">
              <div className="space-y-2">
                <h3 className="text-xl font-bold dark:text-white">Create New Sheet</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Enter a name for the new forecasting sheet.</p>
              </div>
              
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Sheet Name</label>
                <input 
                  type="text" 
                  value={newSheetName}
                  onChange={(e) => setNewSheetName(e.target.value)}
                  placeholder="e.g., Civil Works, MEP Services..."
                  className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 transition-all dark:text-white"
                  autoFocus
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAdd}
                  disabled={!newSheetName.trim()}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-3 rounded-xl text-sm font-bold transition-all shadow-lg shadow-blue-500/20"
                >
                  Create Sheet
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CostForecasting;
