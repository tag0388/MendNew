import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc, getDocs, writeBatch, collectionGroup } from 'firebase/firestore';
import { Project, Sheet, Enterprise, ForecastRow } from '../types';
import CostManagement from './CostManagement';
import ChangeManagementSubPane from './ChangeManagementSubPane';
import RiskManagementSubPane from './RiskManagementSubPane';
import SubcontractManagement from './SubcontractManagement';
import ProcurementManagementSubPane from './ProcurementManagementSubPane';
import ProgressManagementSubPane from './ProgressManagementSubPane';
import TimeSchedule from './TimeSchedule';
import Invoicing from './Invoicing';
import ErrorBoundary from './ErrorBoundary';
import { cn } from '../lib/utils';
import { 
  Plus, 
  FileText, 
  Calendar, 
  Lock, 
  Unlock, 
  ChevronRight, 
  Filter, 
  Download, 
  Trash2, 
  AlertTriangle, 
  X,
  PieChart,
  DollarSign,
  TrendingUp,
  Activity,
  Users as UsersIcon,
  Receipt,
  RefreshCw,
  Briefcase,
  ShieldAlert
} from 'lucide-react';

interface ProjectDashboardProps {
  project: Project;
  enterprise: Enterprise;
  currentModule: string;
  subModuleId?: string;
  onSelectSheet: (sheet: Sheet) => void;
  setIsSidebarCollapsed?: (c: boolean) => void;
  user: any;
  theme?: 'light' | 'dark';
}

export default function ProjectDashboard({ project, enterprise, currentModule, subModuleId, onSelectSheet, setIsSidebarCollapsed, user, theme = 'light' }: ProjectDashboardProps) {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetStats, setSheetStats] = useState<Record<string, { eac: number, etc: number }>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newSheet, setNewSheet] = useState({ name: '', method: 'commitment' as const });
  const [sheetToDelete, setSheetToDelete] = useState<Sheet | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'sheets'), where('projectId', '==', project.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const s = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Sheet));
      setSheets(s);
      
      // Fetch stats for each sheet
      s.forEach(async (sheet) => {
        const rowsQuery = query(collection(db, `sheets/${sheet.id}/rows`));
        const rowsSnapshot = await getDocs(rowsQuery);
        const rows = rowsSnapshot.docs.map(doc => doc.data() as ForecastRow);
        
        let totalEac = 0;
        let totalEtc = 0;
        
        rows.forEach(r => {
          const eac = sheet.forecastMethod === 'commitment' 
            ? (r.qty || 0) * (r.rate || 0) 
            : (r.actualCostToDate || 0) + (r.costToGo || 0);
          const etc = Math.max(0, eac - (r.actualCostToDate || 0));
          
          totalEac += eac;
          totalEtc += etc;
        });
        
        setSheetStats(prev => ({
          ...prev,
          [sheet.id]: { eac: totalEac, etc: totalEtc }
        }));
      });
    }, (error) => {
      console.error("Sheets fetch error:", error);
    });
    return () => unsubscribe();
  }, [project]);

  const handleCreateSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'sheets'), {
        projectId: project.id,
        sheetName: newSheet.name,
        forecastMethod: newSheet.method,
        version: 'v1.0',
        lockedStatus: false,
        createdBy: 'System',
        createdAt: new Date().toISOString()
      });
      setIsModalOpen(false);
      setNewSheet({ name: '', method: 'commitment' });
    } catch (error) {
      console.error('Failed to create sheet', error);
    }
  };

  const handleDeleteSheet = async () => {
    if (!sheetToDelete) return;
    setIsDeleting(true);
    try {
      const batch = writeBatch(db);
      
      // 1. Find all rows for this sheet
      const rowsQuery = query(collection(db, `sheets/${sheetToDelete.id}/rows`));
      const rowsSnapshot = await getDocs(rowsQuery);
      rowsSnapshot.docs.forEach(rowDoc => {
        batch.delete(rowDoc.ref);
      });
      
      // 2. Delete the sheet
      batch.delete(doc(db, 'sheets', sheetToDelete.id));
      
      await batch.commit();
      setSheetToDelete(null);
    } catch (error) {
      console.error('Failed to delete sheet', error);
      alert('Failed to delete sheet. Check console for details.');
    } finally {
      setIsDeleting(false);
    }
  };

  const renderModuleContent = () => {
    switch (currentModule) {
      case 'dashboard':
        return (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { label: 'Total EAC', value: `$${(Object.values(sheetStats).reduce((acc, s) => acc + s.eac, 0) / 1e6).toFixed(1)}M`, icon: DollarSign, color: 'text-blue-600' },
                { label: 'Total ETC', value: `$${(Object.values(sheetStats).reduce((acc, s) => acc + s.etc, 0) / 1e6).toFixed(1)}M`, icon: TrendingUp, color: 'text-emerald-600' },
                { label: 'Active Sheets', value: sheets.length, icon: FileText, color: 'text-amber-600' },
                { label: 'Performance Index', value: '1.04', icon: Activity, color: 'text-[#FF6321]' },
              ].map((stat, i) => (
                <div key={i} className="bg-white dark:bg-[#141414] p-6 rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm transition-colors">
                  <div className="flex justify-between items-start mb-4">
                    <div className={`p-2 rounded-lg bg-gray-50 dark:bg-white/5 ${stat.color}`}>
                      <stat.icon className="w-5 h-5" />
                    </div>
                  </div>
                  <p className="text-gray-900 dark:text-gray-400 text-xs uppercase tracking-widest font-semibold mb-1">{stat.label}</p>
                  <p className="text-2xl font-bold dark:text-white">{stat.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-[#141414] p-6 rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm">
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-6">Recent Activity</h3>
                <div className="space-y-4">
                  {sheets.slice(0, 5).map((sheet, i) => (
                    <div key={i} className="flex items-center gap-4 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors cursor-pointer" onClick={() => onSelectSheet(sheet)}>
                      <div className="w-8 h-8 bg-blue-50 dark:bg-blue-500/10 rounded-lg flex items-center justify-center text-blue-600 dark:text-blue-400">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold dark:text-white">{sheet.sheetName} updated</p>
                        <p className="text-[10px] text-gray-400 uppercase tracking-widest">{new Date(sheet.createdAt).toLocaleDateString()}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white dark:bg-[#141414] p-6 rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm">
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-6">Module Status</h3>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Cost Mgmt', status: 'Active', icon: DollarSign, color: 'text-emerald-500' },
                    { label: 'Change Mgmt', status: 'Active', icon: RefreshCw, color: 'text-emerald-500' },
                    { label: 'Risk Mgmt', status: 'Active', icon: ShieldAlert, color: 'text-amber-500' },
                    { label: 'Sub-Contract', status: 'Active', icon: Briefcase, color: 'text-blue-500' },
                    { label: 'Invoicing', status: 'Active', icon: Receipt, color: 'text-purple-500' },
                  ].map((m, i) => (
                    <div key={i} className="p-4 rounded-xl border border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-white/5">
                      <div className="flex items-center gap-2 mb-2">
                        <m.icon className={`w-4 h-4 ${m.color}`} />
                        <span className="text-xs font-bold dark:text-white">{m.label}</span>
                      </div>
                      <span className="text-[9px] uppercase tracking-widest text-gray-400 font-bold">{m.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      case 'cost':
        return (
          <CostManagement 
            project={project} 
            enterprise={enterprise}
            sheets={sheets}
            sheetStats={sheetStats}
            onSelectSheet={onSelectSheet}
            onDeleteSheet={setSheetToDelete}
            onCreateSheet={() => setIsModalOpen(true)}
            setIsSidebarCollapsed={setIsSidebarCollapsed}
          />
        );
      case 'change':
        return (
          <ChangeManagementSubPane 
            project={project} 
            enterprise={enterprise}
            setIsSidebarCollapsed={setIsSidebarCollapsed}
          />
        );
      case 'risk':
        return (
          <RiskManagementSubPane 
            project={project} 
            enterprise={enterprise}
            setIsSidebarCollapsed={setIsSidebarCollapsed}
          />
        );
      case 'subcontract':
        return (
          <SubcontractManagement 
            project={project} 
            enterprise={enterprise}
            user={user}
            theme={theme}
            setIsSidebarCollapsed={setIsSidebarCollapsed}
          />
        );
      case 'procurement':
        return (
          <ProcurementManagementSubPane 
            project={project} 
            enterprise={enterprise}
            setIsSidebarCollapsed={setIsSidebarCollapsed}
          />
        );
      case 'progress':
        return (
          <ProgressManagementSubPane 
            project={project} 
            enterprise={enterprise}
            user={user}
            theme={theme}
            setIsSidebarCollapsed={setIsSidebarCollapsed}
          />
        );
      case 'schedule':
        return (
          <TimeSchedule 
            project={project}
            enterprise={enterprise}
            theme={theme}
          />
        );
      default:
        return (
          <div className="flex-1 flex flex-col items-center justify-center p-12 bg-white dark:bg-[#141414] rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm">
            <div className="w-16 h-16 bg-blue-50 dark:bg-blue-500/10 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400 mb-6">
              <Activity className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold dark:text-white mb-2">{currentModule.charAt(0).toUpperCase() + currentModule.slice(1)} Management</h2>
            <p className="text-gray-900 dark:text-gray-400 text-sm text-center max-w-md">
              This module is currently under development and will be available in a future update.
            </p>
          </div>
        );
    }
  };

  return (
    <div className={cn(
      "flex-1 flex flex-col w-full h-full transition-colors duration-300",
      (currentModule === 'cost' || currentModule === 'change' || currentModule === 'subcontract' || currentModule === 'risk' || currentModule === 'procurement' || currentModule === 'progress' || currentModule === 'schedule') ? "p-0 overflow-hidden" : "p-4 md:p-8 overflow-auto"
    )}>
      <div className={cn(
        "w-full flex-1 flex flex-col min-h-0",
        (currentModule === 'cost' || currentModule === 'change' || currentModule === 'subcontract' || currentModule === 'bulk-change-records' || currentModule === 'risk' || currentModule === 'procurement' || currentModule === 'progress' || currentModule === 'schedule') ? "" : "max-w-[1600px] mx-auto"
      )}>
        {/* Project Hero Section */}
        {project.photoURL && currentModule !== 'cost' && currentModule !== 'change' && currentModule !== 'subcontract' && currentModule !== 'bulk-change-records' && currentModule !== 'schedule' && (
          <div className="relative h-64 w-full rounded-3xl overflow-hidden shadow-2xl group mb-10 shrink-0">
            <img 
              src={project.photoURL} 
              alt={project.projectName} 
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-8">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-400 mb-2">Active Project</p>
                  <h1 className="text-4xl font-bold text-white tracking-tight">{project.projectName}</h1>
                  <p className="text-sm text-gray-300 mt-2 font-mono">{project.projectCode}</p>
                </div>
                <div className="flex gap-4">
                  <div className="px-4 py-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl text-center">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Status</p>
                    <p className="text-sm font-bold text-white">{project.status || 'Active'}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentModule !== 'cost' && currentModule !== 'change' && currentModule !== 'subcontract' && currentModule !== 'risk' && currentModule !== 'procurement' && currentModule !== 'schedule' && (
          <div className="flex justify-between items-start mb-10 shrink-0">
            <div>
              {!project.photoURL && (
                <>
                  <div className="flex items-center gap-2 text-xs font-mono text-gray-400 uppercase tracking-widest mb-2">
                    <span>{currentModule.charAt(0).toUpperCase() + currentModule.slice(1)}</span>
                    <ChevronRight className="w-3 h-3" />
                    <span>{project.projectCode}</span>
                  </div>
                  <h1 className="text-3xl font-bold tracking-tight dark:text-white">{project.projectName}</h1>
                </>
              )}
            </div>
            <div className="flex gap-3">
              <button className="flex items-center gap-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-white/10 transition-all dark:text-white">
                <Download className="w-4 h-4" />
                Export Report
              </button>
            </div>
          </div>
        )}

        <div className={cn(
          "flex-1 flex flex-col min-h-0",
          (currentModule === 'cost' || currentModule === 'subcontract') ? "h-full" : ""
        )}>
          {renderModuleContent()}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {sheetToDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60]">
          <div className="bg-white dark:bg-[#141414] rounded-2xl p-8 w-full max-w-md shadow-2xl border dark:border-white/10">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertTriangle className="w-6 h-6" />
              <h2 className="text-xl font-bold">Delete Sheet?</h2>
            </div>
            <p className="text-gray-900 dark:text-gray-400 text-sm mb-6">
              Are you sure you want to delete <span className="font-bold text-gray-900 dark:text-white">"{sheetToDelete.sheetName}"</span>? 
              This action is permanent and will delete all associated forecast data.
            </p>
            <div className="flex gap-3">
              <button 
                disabled={isDeleting}
                onClick={() => setSheetToDelete(null)}
                className="flex-1 py-3 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-white/5 transition-colors dark:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button 
                disabled={isDeleting}
                onClick={handleDeleteSheet}
                className="flex-1 py-3 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Deleting...
                  </>
                ) : 'Delete Sheet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white dark:bg-[#141414] rounded-2xl p-8 w-full max-w-md shadow-2xl border dark:border-white/10">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold dark:text-white">Create New Sheet</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateSheet} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Sheet Name</label>
                <input 
                  required
                  type="text" 
                  value={newSheet.name}
                  onChange={e => setNewSheet({...newSheet, name: e.target.value})}
                  className="w-full p-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/5 dark:focus:ring-white/5 dark:text-white"
                  placeholder="e.g. Structural Steel Forecast"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Forecast Method</label>
                <select 
                  value={newSheet.method}
                  onChange={e => setNewSheet({...newSheet, method: e.target.value as any})}
                  className="w-full p-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/5 dark:focus:ring-white/5 dark:text-white"
                >
                  <option value="commitment">Commitment Based (Subcontractors)</option>
                  <option value="time-based">Time-Based (Labour/Self-Perform)</option>
                </select>
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
                  className="flex-1 py-3 bg-black dark:bg-white text-white dark:text-black rounded-xl text-sm font-medium hover:bg-black/90 dark:hover:bg-white/90 transition-colors"
                >
                  Create Sheet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
