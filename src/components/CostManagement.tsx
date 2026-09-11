import React, { useState, useEffect } from 'react';
import { Project, Enterprise } from '../types';
import { DollarSign, Tag, List, ChevronLeft, Menu, Settings, Hash, Database, Calendar, Target, ClipboardList } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useNarrowScreen, FOLD_MODULE_SIDEBAR } from '../lib/useNarrowScreen';
import ProjectCostCodeAttributes from './ProjectCostCodeAttributes';
import ProjectResourceRates from './ProjectResourceRates';
import CostReportingPeriod from './CostReportingPeriod';
import CostCodes from './CostCodes';
import ActualCost from './ActualCost';
import BaselineBudget from './BaselineBudget';
import GlobalTimephasing from './GlobalTimephasing';
import BulkEtcDetails from './BulkEtcDetails';
import { useProjectRole } from '../lib/useProjectRole';

interface CostManagementProps {
  project: Project;
  enterprise: Enterprise;
  setIsSidebarCollapsed?: (c: boolean) => void;
}

type CostTab = 'costCodes' | 'timephasing' | 'actualCost' | 'baselineBudget' | 'etcDetails' | 'costElements' | 'costCodeAttributes' | 'reportingPeriod' | 'resourceRates';

const CostManagement: React.FC<CostManagementProps> = ({ 
  project, 
  enterprise,
  setIsSidebarCollapsed
}) => {
  const navigate = useNavigate();
  const { projectId, subModuleId } = useParams();
  const activeTab = (subModuleId as CostTab) || 'costCodes';
  const [expandedSections, setExpandedSections] = useState<string[]>(['overview', 'settings']);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // This sidebar is a list of tabs, so it is the first thing to fold when the
  // window is too narrow to show it and a grid at once. The icon rail still
  // says where you are, and the toggle still works.
  const narrow = useNarrowScreen(FOLD_MODULE_SIDEBAR);
  useEffect(() => { setIsSidebarOpen(!narrow); }, [narrow]);

  // From the database, not from a map on the project object and not from a
  // hardcoded email address. The two map lookups this replaces read Firestore
  // document shapes that no longer exist, so they were always undefined --
  // which left one hardcoded address as the only thing granting admin.
  const { isProjectAdmin, loading: roleLoading } = useProjectRole(projectId);

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => 
      prev.includes(sectionId) 
        ? prev.filter(id => id !== sectionId) 
        : [...prev, sectionId]
    );
  };

  const handleTabClick = (id: string) => {
    navigate(`/project/${projectId}/cost/${id}`);
  };

  const sections = [
    {
      id: 'overview',
      label: 'Overview',
      items: [
        { id: 'costCodes', label: 'Cost Codes', icon: <List className="w-4 h-4" /> },
        { id: 'timephasing', label: 'Timephasing', icon: <Calendar className="w-4 h-4" /> },
      ]
    },
    {
      id: 'settings',
      label: 'Cost Module Settings',
      visible: isProjectAdmin,
      items: [
        { id: 'reportingPeriod', label: 'Cost Reporting Period', icon: <Calendar className="w-4 h-4" /> },
        { id: 'costCodeAttributes', label: 'Cost Code Attributes', icon: <Database className="w-4 h-4" /> },
        { id: 'resourceRates', label: 'Project Resource Rates', icon: <DollarSign className="w-4 h-4" /> },
        { id: 'baselineBudget', label: 'Baseline Budget', icon: <Target className="w-4 h-4" /> },
        { id: 'actualCost', label: 'Actual Cost', icon: <DollarSign className="w-4 h-4" /> },
        { id: 'etcDetails', label: 'ETC Details', icon: <ClipboardList className="w-4 h-4" /> },
      ]
    }
  ];

  const filteredSections = sections.filter(s => s.visible !== false);

  const isSettingsTab = ['baselineBudget', 'etcDetails', 'costElements', 'costCodeAttributes', 'reportingPeriod', 'resourceRates'].includes(activeTab);

  const currentPeriod = project.reportingPeriods?.periods.find(p => p.id === project.reportingPeriods?.currentPeriodId);

  return (
    <div className="flex h-full bg-gray-50 dark:bg-[#0a0a0a] transition-colors duration-300 overflow-hidden">
      {/* Sidebar Navigation */}
      <div className={`${isSidebarOpen ? 'w-72' : 'w-16'} bg-white dark:bg-[#141414] border-r border-gray-200 dark:border-white/10 flex flex-col h-full shrink-0 transition-all duration-300`}>
        <div className="p-6 border-b border-gray-200 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black dark:bg-white rounded-xl flex items-center justify-center shadow-lg shadow-black/10 dark:shadow-white/10">
              <Settings className="w-6 h-6 text-white dark:text-black" />
            </div>
            {isSidebarOpen && (
              <div className="min-w-0">
                <h2 className="text-sm font-bold dark:text-white truncate">Cost Management</h2>
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
                isSidebarOpen ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" : "bg-transparent text-orange-500"
              )}>
                {isSidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </div>
            </button>
          </div>

          {filteredSections.map(section => (
            <div key={section.id} className="space-y-1">
              {isSidebarOpen && (
                <h3 className="px-5 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-2">
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
      <div className="flex-1 overflow-auto">
        <div className="h-full flex flex-col min-h-0">
          {/* The sidebar hides the settings section from non-admins, but a URL
              can be typed or bookmarked, so the content is gated too. The
              database refuses the writes either way -- this is so the screen
              says no rather than offering controls that will fail. */}
          {isSettingsTab && !roleLoading && !isProjectAdmin ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="max-w-sm text-center">
                <h2 className="text-lg font-semibold mb-2 dark:text-white">Project administrators only</h2>
                <p className="text-sm text-gray-500">
                  These settings change cost data across every cost code in the
                  project, so they are limited to project administrators. Ask a
                  project administrator if you need a change made here.
                </p>
              </div>
            </div>
          ) : (
          <>
          {activeTab === 'costCodes' && (
            <div className="flex-1 flex flex-col overflow-hidden p-8">
              <CostCodes 
                project={project} 
                enterprise={enterprise}
              />
            </div>
          )}
          {activeTab === 'timephasing' && (
            <div className="flex-1 flex flex-col overflow-hidden p-8">
              <GlobalTimephasing 
                project={project} 
                enterprise={enterprise}
              />
            </div>
          )}
          {activeTab === 'actualCost' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <ActualCost project={project} enterprise={enterprise} />
            </div>
          )}
          {activeTab === 'baselineBudget' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <BaselineBudget project={project} enterprise={enterprise} />
            </div>
          )}
          {activeTab === 'etcDetails' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <BulkEtcDetails project={project} enterprise={enterprise} />
            </div>
          )}
          {activeTab === 'costCodeAttributes' && <div className="flex-1 flex flex-col overflow-hidden"><ProjectCostCodeAttributes project={project} /></div>}
          {activeTab === 'resourceRates' && <div className="flex-1 flex flex-col overflow-hidden"><ProjectResourceRates project={project} /></div>}
          {activeTab === 'reportingPeriod' && <div className="flex-1 flex flex-col overflow-hidden"><CostReportingPeriod project={project} /></div>}
          </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CostManagement;
