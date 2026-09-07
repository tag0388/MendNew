import React, { useState, useEffect } from 'react';
import { Project, Enterprise } from '../types';
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
  setIsSidebarCollapsed?: (c: boolean) => void;
  user: any;
  theme?: 'light' | 'dark';
}

export default function ProjectDashboard({ project, enterprise, currentModule, subModuleId, setIsSidebarCollapsed, user, theme = 'light' }: ProjectDashboardProps) {

  const renderModuleContent = () => {
    switch (currentModule) {
      case 'dashboard':
        return (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                // TODO(supabase-port): source these from cost_codes once the
                // data layer lands -- they were previously derived from the
                // forecast-sheet feature, which has been removed.
                { label: 'Total EAC', value: '--', icon: DollarSign, color: 'text-blue-600' },
                { label: 'Total ETC', value: '--', icon: TrendingUp, color: 'text-emerald-600' },
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

            <div className="grid grid-cols-1 gap-6">
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

    </div>
  );
}
