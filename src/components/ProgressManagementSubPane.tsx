import React, { useState } from 'react';
import { Project, Enterprise } from '../types';
import { Activity, Settings, Tag, Calendar, ChevronLeft, Menu, Hash, FileText } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { cn } from '../lib/utils';
import { auth } from '../firebase';
import ProgressTracking from './ProgressTracking';
import ProgressReportingPeriod from './ProgressReportingPeriod';
import ProgressAttributes from './ProgressAttributes';
import RulesOfCredit from './RulesOfCredit';
import BulkRulesOfCredit from './BulkRulesOfCredit';
import ErrorBoundary from './ErrorBoundary';

interface ProgressManagementSubPaneProps {
  project: Project;
  enterprise: Enterprise;
  user: any;
  theme?: 'light' | 'dark';
  setIsSidebarCollapsed?: (c: boolean) => void;
}

type ProgressTab = 'tracking' | 'periods' | 'attributes' | 'rules' | 'bulk-rules';

const ProgressManagementSubPane: React.FC<ProgressManagementSubPaneProps> = ({ 
  project, 
  enterprise,
  user,
  theme = 'light',
  setIsSidebarCollapsed
}) => {
  const navigate = useNavigate();
  const { projectId, subModuleId } = useParams();
  const activeTab = (subModuleId as ProgressTab) || 'tracking';
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const userId = auth.currentUser?.uid;
  const userEmail = auth.currentUser?.email;
  const isSystemAdmin = userEmail?.toLowerCase() === 'tarek.guindy@gmail.com' || userEmail?.toLowerCase() === 'tarek_guindy@hotmail.com';
  const isEnterpriseAdmin = userId && enterprise?.users?.[userId]?.role === 'Enterprise System Admin';
  const isProjectAdmin = userId && (isEnterpriseAdmin || project?.users?.[userId] === 'Project Admin' || isSystemAdmin);

  const handleTabClick = (id: string) => {
    navigate(`/project/${projectId}/progress/${id}`);
  };

  const sections = [
    {
      id: 'main',
      label: 'Commodity Tracking',
      items: [
        { id: 'tracking', label: 'Commodity Tracking', icon: <Activity className="w-4 h-4" /> },
      ]
    },
    {
      id: 'settings',
      label: 'Module Settings (Admin)',
      visible: isProjectAdmin,
      items: [
        { id: 'periods', label: 'Setup Reporting Periods', icon: <Calendar className="w-4 h-4" /> },
        { id: 'attributes', label: 'Project Commodity Attributes', icon: <Tag className="w-4 h-4" /> },
        { id: 'rules', label: 'Setup Rules of Credit', icon: <Hash className="w-4 h-4" /> },
        { id: 'bulk-rules', label: 'Bulk Rules of Credit', icon: <FileText className="w-4 h-4" /> },
      ]
    }
  ];

  const filteredSections = sections.filter(s => s.visible !== false);

  return (
    <div className="flex h-full bg-gray-50 dark:bg-[#0a0a0a] transition-colors duration-300 overflow-hidden">
      {/* Sidebar Navigation */}
      <div className={`${isSidebarOpen ? 'w-72' : 'w-16'} bg-white dark:bg-[#141414] border-r border-gray-200 dark:border-white/10 flex flex-col h-full shrink-0 transition-all duration-300 shadow-sm z-10`}>
        <div className="p-6 border-b border-gray-200 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-600/20">
              <Activity className="w-6 h-6 text-white" />
            </div>
            {isSidebarOpen && (
              <div className="min-w-0">
                <h2 className="text-sm font-bold dark:text-white truncate">Commodity Tracking</h2>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Project Controls</p>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 space-y-2 custom-scrollbar">
          <div className="px-4 mb-4">
            <button 
              onClick={() => {
                const newState = !isSidebarOpen;
                setIsSidebarOpen(newState);
                if (!newState && setIsSidebarCollapsed) {
                  setIsSidebarCollapsed(true);
                }
              }}
              className={`w-full flex items-center ${isSidebarOpen ? 'justify-between' : 'justify-center'} p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors text-gray-500 dark:text-gray-400`}
            >
              {isSidebarOpen && <span className="text-xs font-medium">Collapse Menu</span>}
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300",
                isSidebarOpen ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20" : "bg-transparent text-emerald-600"
              )}>
                {isSidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </div>
            </button>
          </div>

          {filteredSections.map(section => (
            <div key={section.id} className="space-y-1">
              {isSidebarOpen && (
                <h3 className="px-5 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-2 mt-4">
                  {section.label}
                </h3>
              )}
              
              <div className="space-y-1 px-4">
                {section.items.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleTabClick(item.id)}
                    title={!isSidebarOpen ? item.label : undefined}
                    className={`w-full flex items-center ${isSidebarOpen ? 'gap-3 px-4' : 'justify-center px-0'} py-2.5 rounded-xl text-sm font-medium transition-all ${
                      activeTab === item.id 
                        ? 'bg-black dark:bg-white text-white dark:text-black shadow-lg shadow-black/10 dark:shadow-white/10' 
                        : 'text-gray-900 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    {item.icon}
                    {isSidebarOpen && item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto bg-white dark:bg-[#0a0a0a]">
        <div className="h-full flex flex-col min-h-0">
          <ErrorBoundary>
            {activeTab === 'tracking' && (
              <ProgressTracking 
                project={project} 
                enterprise={enterprise}
                user={user}
                theme={theme}
                isAdmin={isProjectAdmin}
                setIsSidebarCollapsed={setIsSidebarCollapsed}
              />
            )}
            {activeTab === 'periods' && (
              <ProgressReportingPeriod 
                project={project} 
                isAdmin={isProjectAdmin}
              />
            )}
            {activeTab === 'attributes' && (
              <ProgressAttributes 
                project={project} 
              />
            )}
            {activeTab === 'rules' && (
              <RulesOfCredit 
                project={project}
                theme={theme}
              />
            )}
            {activeTab === 'bulk-rules' && (
              <BulkRulesOfCredit 
                project={project}
                theme={theme}
              />
            )}
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
};

export default ProgressManagementSubPane;
