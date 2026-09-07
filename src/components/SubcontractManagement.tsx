import React, { useState } from 'react';
import { Project, Enterprise } from '../types';
import { Briefcase, Receipt, ChevronLeft, Menu, Settings, List } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { cn } from '../lib/utils';
import { auth } from '../firebase';
import Subcontracts from './Subcontracts';
import Invoicing from './Invoicing';
import BulkSubcontractInvoices from './BulkSubcontractInvoices';
import BulkSubcontractInvoiceItems from './BulkSubcontractInvoiceItems';
import BulkSubcontractItems from './BulkSubcontractItems';
import SubcontractAttributes from './SubcontractAttributes';

interface SubcontractManagementProps {
  project: Project;
  enterprise: Enterprise;
  user: any;
  setIsSidebarCollapsed?: (c: boolean) => void;
  theme?: 'light' | 'dark';
}

type SubcontractTab = 'subcontracts' | 'subcontracts-attributes' | 'subcontract-items' | 'subcontract-invoices' | 'subcontract-invoice-items' | 'invoicing';

const SubcontractManagement: React.FC<SubcontractManagementProps> = ({ 
  project, 
  enterprise,
  user,
  setIsSidebarCollapsed,
  theme = 'light'
}) => {
  const navigate = useNavigate();
  const { projectId, subModuleId } = useParams();
  const activeTab = (subModuleId as SubcontractTab) || 'subcontracts';
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const userId = auth.currentUser?.uid;
  const userEmail = auth.currentUser?.email;
  const isSystemAdmin = userEmail?.toLowerCase() === 'tarek.guindy@gmail.com' || userEmail?.toLowerCase() === 'tarek_guindy@hotmail.com';
  const isEnterpriseAdmin = userId && enterprise?.users?.[userId]?.role === 'Enterprise System Admin';
  const isProjectAdmin = userId && (isEnterpriseAdmin || project?.users?.[userId] === 'Project Admin' || isSystemAdmin);

  const handleTabClick = (id: string) => {
    navigate(`/project/${projectId}/subcontract/${id}`);
  };

  const sections = [
    {
      id: 'overview',
      label: 'Procurement & Subcontracts',
      items: [
        { id: 'subcontracts', label: 'Subcontracts', icon: <Briefcase className="w-4 h-4" /> }
      ]
    }
  ];

  if (isProjectAdmin) {
    sections.push({
      id: 'bulk-updates',
      label: 'Bulk Updates',
      items: [
        { id: 'subcontract-items', label: 'Bulk Subcontract Items', icon: <List className="w-4 h-4" /> },
        { id: 'subcontract-invoices', label: 'Bulk Subcontract Invoices', icon: <Receipt className="w-4 h-4" /> },
      ]
    });

    sections.push({
      id: 'settings',
      label: 'Subcontract Settings',
      items: [
        { id: 'subcontracts-attributes', label: 'Subcontract Attributes', icon: <Settings className="w-4 h-4" /> },
      ]
    });
  }

  return (
    <div className="flex w-full h-full bg-gray-50 dark:bg-[#0a0a0a] transition-colors duration-300 overflow-hidden">
      {/* Sidebar Navigation */}
      <div className={`${isSidebarOpen ? 'w-72' : 'w-16'} bg-white dark:bg-[#141414] border-r border-gray-200 dark:border-white/10 flex flex-col h-full shrink-0 transition-all duration-300`}>
        <div className="p-6 border-b border-gray-200 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black dark:bg-white rounded-xl flex items-center justify-center shadow-lg shadow-black/10 dark:shadow-white/10">
              <Briefcase className="w-6 h-6 text-white dark:text-black" />
            </div>
            {isSidebarOpen && (
              <div className="min-w-0">
                <h2 className="text-sm font-bold dark:text-white truncate">Sub-Contract Mgmt</h2>
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

          {sections.map(section => (
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
          {activeTab === 'subcontracts' && (
            <div className="flex-1 flex flex-col overflow-hidden p-8">
              <Subcontracts 
                project={project} 
                enterprise={enterprise}
                user={user}
                theme={theme}
              />
            </div>
          )}
          {activeTab === 'invoicing' && (
            <div className="flex-1 flex flex-col overflow-hidden p-8">
              <Invoicing 
                project={project} 
                enterprise={enterprise}
                user={user}
                theme={theme}
              />
            </div>
          )}
          {activeTab === 'subcontracts-attributes' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <SubcontractAttributes project={project} />
            </div>
          )}
          {activeTab === 'subcontract-items' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <BulkSubcontractItems project={project} enterprise={enterprise} />
            </div>
          )}
          {activeTab === 'subcontract-invoices' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <BulkSubcontractInvoices project={project} enterprise={enterprise} />
            </div>
          )}
          {activeTab === 'subcontract-invoice-items' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <BulkSubcontractInvoiceItems project={project} enterprise={enterprise} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SubcontractManagement;
