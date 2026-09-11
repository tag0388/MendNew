import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, subscribeToTable } from '../lib/supabase';
import { updateProject, fetchProjectMembers, assignProjectMember, removeProjectMember } from '../lib/projects';
import { fetchEnterpriseUsers, type ProjectRole } from '../lib/session';
import { Project, Enterprise } from '../types';
import { 
  Calendar as CalendarIcon, 
  Users, 
  Settings, 
  Save, 
  Layout, 
  Database, 
  Table, 
  ChevronLeft,
  DollarSign,
  Clock,
  RefreshCw,
  Briefcase,
  FileText,
  Menu,
  Image as ImageIcon,
  FileSearch,
  User,
  Tag,
  Upload,
  Trash2,
  Edit2,
  Check,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { toast } from 'sonner';
import CalendarManager from './CalendarManager';
import ProjectLineItemAttributes from './ProjectLineItemAttributes';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ProjectAdminProps {
  project: Project;
  enterprise: Enterprise;
}

type AdminTab = 
  | 'general' 
  | 'calendar' 
  | 'costMgmt' 
  | 'scheduleMgmt' 
  | 'changeMgmt' 
  | 'riskMgmt'
  | 'subContractMgmt' 
  | 'invoicing' 
  | 'access'
  | 'lineItemAttributes'
  | 'attributes';

export default function ProjectAdmin({ project, enterprise }: ProjectAdminProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('general');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  const [formData, setFormData] = useState({
    projectName: project.projectName,
    projectCode: project.projectCode,
    projectBudget: project.projectBudget,
    startDate: project.startDate,
    endDate: project.endDate,
    cutoffDate: project.cutoffDate,
    categories: project.categories || [],
    controlAccounts: project.controlAccounts || [],
    orderNumbers: project.orderNumbers || [],
    photoURL: project.photoURL || '',
    scopeDescription: project.scopeDescription || '',
    clientName: project.clientName || '',
    projectManagerName: project.projectManagerName || '',
    status: project.status || 'Active',
    attributes: project.attributes || {}
  });

  const [isReplaceIdModalOpen, setIsReplaceIdModalOpen] = useState(false);
  const [newProjectCode, setNewProjectCode] = useState('');
  const [isReplacing, setIsReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState('');
  const [isDuplicate, setIsDuplicate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check if it's an image
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload a valid image file (JPG, PNG, etc.)');
      return;
    }

    // Check file size (800KB limit for Firestore document safety)
    if (file.size > 800 * 1024) {
      toast.error('File is too large. Please upload an image smaller than 800KB.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setFormData(prev => ({ ...prev, photoURL: base64String }));
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const checkDuplicate = async () => {
      if (!newProjectCode.trim() || newProjectCode.trim() === project.projectCode) {
        setIsDuplicate(false);
        return;
      }
      
      try {
        // (enterprise_id, project_code) is unique in the database, so this
        // check is a courtesy -- a duplicate is refused on write either way.
        const { count, error } = await supabase
          .from('projects')
          .select('id', { count: 'exact', head: true })
          .eq('enterprise_id', project.enterpriseId)
          .eq('project_code', newProjectCode.trim());
        if (error) throw error;
        setIsDuplicate((count ?? 0) > 0);
      } catch (error) {
        console.error('Error checking duplicate ID:', error);
      }
    };

    const timer = setTimeout(checkDuplicate, 500);
    return () => clearTimeout(timer);
  }, [newProjectCode, project.enterpriseId, project.projectCode]);

  // Sync formData if project prop changes (e.g. from another user's update)
  useEffect(() => {
    setFormData({
      projectName: project.projectName,
      projectCode: project.projectCode,
      projectBudget: project.projectBudget,
      startDate: project.startDate,
      endDate: project.endDate,
      cutoffDate: project.cutoffDate,
      categories: project.categories || [],
      controlAccounts: project.controlAccounts || [],
      orderNumbers: project.orderNumbers || [],
      photoURL: project.photoURL || '',
      scopeDescription: project.scopeDescription || '',
      clientName: project.clientName || '',
      projectManagerName: project.projectManagerName || '',
      status: project.status || 'Active',
      attributes: project.attributes || {}
    });
  }, [project]);

  const handleDateChange = (field: 'startDate' | 'endDate' | 'cutoffDate', value: string) => {
    if (!value) return;
    const date = parseISO(value);
    let adjustedValue = value;

    if (field === 'startDate') {
      adjustedValue = format(startOfMonth(date), 'yyyy-MM-dd');
    } else if (field === 'endDate' || field === 'cutoffDate') {
      adjustedValue = format(endOfMonth(date), 'yyyy-MM-dd');
    }

    setFormData(prev => ({ ...prev, [field]: adjustedValue }));
  };

  const handleSave = useCallback(async (dataToSave: typeof formData) => {
    setSaving(true);
    try {
      if (!project.id) throw new Error('Project ID is missing');

      await updateProject(project.id, {
        ...dataToSave,
        dateLastModified: new Date().toISOString(),
      } as any);
      setLastSaved(new Date().toLocaleTimeString());
    } catch (error) {
      console.error('Update failed', error);
    } finally {
      setSaving(false);
    }
  }, [project.id]);

  // Auto-save logic
  const lastDataRef = useRef(formData);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Deep comparison to avoid unnecessary saves
    const hasChanged = JSON.stringify(formData) !== JSON.stringify(lastDataRef.current);
    
    if (hasChanged) {
      const timer = setTimeout(() => {
        handleSave(formData);
        lastDataRef.current = formData;
      }, 1500); // 1.5s debounce

      return () => clearTimeout(timer);
    }
  }, [formData, handleSave]);

  const handleReplaceId = async () => {
    if (!newProjectCode.trim()) {
      setReplaceError('Please enter a new Project ID.');
      return;
    }
    if (newProjectCode.trim() === project.projectCode) {
      setReplaceError('New ID must be different from current ID.');
      return;
    }

    setIsReplacing(true);
    setReplaceError('');

    try {
      // (enterprise_id, project_code) is unique, so a duplicate is refused by
      // the database. The check up front turns that into a clear message
      // rather than a constraint violation, but it is not what enforces it.
      await updateProject(project.id, {
        projectCode: newProjectCode.trim(),
        dateLastModified: new Date().toISOString(),
      } as any);

      setIsReplaceIdModalOpen(false);
      setNewProjectCode('');
      // The parent component should ideally refresh the project data
    } catch (error: any) {
      console.error('Replace ID failed', error);
      setReplaceError(
        /duplicate|unique/i.test(error?.message || '')
          ? 'This Project ID already exists in the enterprise.'
          : `Failed to replace Project ID: ${error?.message || 'Unknown error'}`
      );
    } finally {
      setIsReplacing(false);
    }
  };

  /**
   * Who is on the project, and who could be.
   *
   * Both lists used to be read from maps embedded on the project and
   * enterprise documents -- `project.users[uid]` and `enterprise.users` --
   * which is a Firestore shape with no equivalent here. Membership is rows:
   * project_members, whose composite foreign key to enterprise_members is what
   * enforces "assigned from the list of Enterprise users", so somebody outside
   * the enterprise cannot be added to one of its projects.
   */
  const [members, setMembers] = useState<Record<string, ProjectRole>>({});
  const [enterpriseUsers, setEnterpriseUsers] = useState<
    Array<{ userId: string; email: string; role: string }>
  >([]);

  const reloadMembers = useCallback(async () => {
    try {
      const rows = await fetchProjectMembers(project.id);
      const byId: Record<string, ProjectRole> = {};
      rows.forEach(r => { byId[r.userId] = r.role as ProjectRole; });
      setMembers(byId);
    } catch (error) {
      console.error('ProjectAdmin: project members fetch error:', error);
    }
  }, [project.id]);

  useEffect(() => {
    void reloadMembers();
    return subscribeToTable('project_members', `project_id=eq.${project.id}`, () => void reloadMembers());
  }, [reloadMembers, project.id]);

  useEffect(() => {
    if (!project.enterpriseId) return;
    let active = true;
    const load = async () => {
      try {
        const rows = await fetchEnterpriseUsers(project.enterpriseId);
        if (active) setEnterpriseUsers(rows.map(r => ({ userId: r.userId, email: r.email, role: r.role })));
      } catch (error) {
        console.error('ProjectAdmin: enterprise users fetch error:', error);
      }
    };
    void load();
    const unsubscribe = subscribeToTable('enterprise_members', `enterprise_id=eq.${project.enterpriseId}`, () => void load());
    return () => { active = false; unsubscribe(); };
  }, [project.enterpriseId]);

  const toggleUser = async (uid: string) => {
    try {
      if (members[uid]) {
        // cost_code_users cascades, so unassigning from the project also drops
        // that person's cost code assignments.
        await removeProjectMember(project.id, uid);
      } else {
        await assignProjectMember(project.id, project.enterpriseId, uid, 'Project User');
      }
      await reloadMembers();
    } catch (error: any) {
      console.error('Failed to change project access', error);
      alert(`Failed to change project access: ${error?.message || 'Unknown error'}`);
    }
  };

  const setUserRole = async (uid: string, role: ProjectRole) => {
    try {
      await assignProjectMember(project.id, project.enterpriseId, uid, role);
      await reloadMembers();
    } catch (error: any) {
      console.error('Failed to change project role', error);
      alert(`Failed to change project role: ${error?.message || 'Unknown error'}`);
    }
  };

  const adminItems = [
    { id: 'general', label: 'General Info', icon: <Layout className="w-4 h-4" /> },
    { id: 'lineItemAttributes', label: 'Line-Item Attributes', icon: <Table className="w-4 h-4" /> },
    { id: 'attributes', label: 'Project Attributes', icon: <Tag className="w-4 h-4" /> },
    { id: 'calendar', label: 'Project Calendars', icon: <CalendarIcon className="w-4 h-4" /> },
    { id: 'access', label: 'Access Control', icon: <Users className="w-4 h-4" /> },
  ];

  return (
    <div className="flex h-full bg-gray-50 dark:bg-[#0a0a0a] transition-colors duration-300">
      {/* Sidebar Navigation */}
      <div className={`${isSidebarOpen ? 'w-72' : 'w-16'} bg-white dark:bg-[#141414] border-r border-gray-200 dark:border-white/10 flex flex-col h-full shrink-0 transition-all duration-300`}>
        <div className="p-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between">
          {isSidebarOpen && (
            <div>
              <h1 className="text-xl font-bold dark:text-white">Project Admin</h1>
              <p className="text-xs text-gray-900 mt-1 truncate">{project.projectName}</p>
            </div>
          )}
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors text-gray-500 dark:text-gray-400"
          >
            {isSidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        
        <nav className="flex-1 py-4 space-y-2 overflow-y-auto custom-scrollbar">
          <div className="px-4 space-y-2">
            {adminItems.map(item => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id as AdminTab);
                  if (!isSidebarOpen) setIsSidebarOpen(true);
                }}
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
        </nav>
        {isSidebarOpen && (
          <div className="p-4 border-t border-gray-200 dark:border-white/10">
            <div className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">
              {saving ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                  <span>Saving changes...</span>
                </>
              ) : lastSaved ? (
                <>
                  <Check className="w-3 h-3 text-emerald-500" />
                  <span>Last saved at {lastSaved}</span>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          {activeTab === 'general' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="bg-white dark:bg-[#141414] p-8 rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm">
                <h2 className="text-lg font-bold mb-6 dark:text-white">General Information</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-900 dark:text-gray-400">Project ID (Code)</label>
                      <button 
                        onClick={() => setIsReplaceIdModalOpen(true)}
                        className="text-[10px] font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 uppercase tracking-widest flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Replace ID
                      </button>
                    </div>
                    <input 
                      type="text" 
                      value={formData.projectCode}
                      readOnly
                      className="w-full p-3 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm text-gray-500 dark:text-gray-400 cursor-not-allowed outline-none"
                    />
                    <p className="mt-1 text-[9px] text-gray-400 font-medium italic">
                      Project ID is a permanent identifier. Use "Replace ID" for corrections.
                    </p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-900 dark:text-gray-400 mb-2">Project Status</label>
                    <select 
                      value={formData.status}
                      onChange={e => setFormData({...formData, status: e.target.value as any})}
                      className="w-full p-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="Active">Active</option>
                      <option value="On Hold">On Hold</option>
                      <option value="Closed">Closed</option>
                      <option value="Archived">Archived</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-900 dark:text-gray-400 mb-2">Project Name</label>
                    <input 
                      type="text" 
                      value={formData.projectName}
                      onChange={e => setFormData({...formData, projectName: e.target.value})}
                      className="w-full p-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-900 dark:text-gray-400 mb-2">Client Name</label>
                    <div className="relative">
                      <Briefcase className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input 
                        type="text" 
                        value={formData.clientName}
                        onChange={e => setFormData({...formData, clientName: e.target.value})}
                        className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="Enter client name"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-900 dark:text-gray-400 mb-2">Project Manager</label>
                    <div className="relative">
                      <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input 
                        type="text" 
                        value={formData.projectManagerName}
                        onChange={e => setFormData({...formData, projectManagerName: e.target.value})}
                        className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="Enter project manager name"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-[#141414] p-8 rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm">
                <h2 className="text-lg font-bold mb-6 dark:text-white">Project Details</h2>
                <div className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-900 dark:text-gray-400 mb-2">Project Photo</label>
                    <div className="flex items-center gap-4">
                      <input 
                        type="file"
                        ref={fileInputRef}
                        onChange={handlePhotoUpload}
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        className="hidden"
                      />
                      <button 
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-medium dark:text-white hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                      >
                        <Upload className="w-4 h-4 text-blue-600" />
                        Upload Photo
                      </button>
                      {formData.photoURL && (
                        <button 
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, photoURL: '' }))}
                          className="flex items-center gap-2 px-4 py-2.5 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-xl text-sm font-medium text-red-600 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          Remove
                        </button>
                      )}
                    </div>
                    {formData.photoURL && (
                      <div className="mt-4 relative w-32 h-32 rounded-xl overflow-hidden border border-gray-200 dark:border-white/10 group">
                        <img src={formData.photoURL} alt="Project" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button 
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="p-2 bg-white rounded-full text-black hover:scale-110 transition-transform"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-900 dark:text-gray-400 mb-2">Project Scope Description</label>
                    <div className="relative">
                      <FileSearch className="w-4 h-4 absolute left-3 top-4 text-gray-400" />
                      <textarea 
                        value={formData.scopeDescription}
                        onChange={e => setFormData({...formData, scopeDescription: e.target.value})}
                        rows={4}
                        className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                        placeholder="Describe the project scope..."
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'lineItemAttributes' && (
            <div className="flex-1 flex flex-col h-[calc(100vh-64px)] animate-in fade-in slide-in-from-bottom-4 duration-300">
               <ProjectLineItemAttributes project={project} />
            </div>
          )}

          {activeTab === 'attributes' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              {/* Project Attributes */}
              <div className="bg-white dark:bg-[#141414] p-8 rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm">
                <h2 className="text-lg font-bold mb-2 dark:text-white">Project Attributes</h2>
                <p className="text-sm text-gray-900 dark:text-gray-400 mb-6">Assign values to enterprise-defined project attributes for analysis and reporting.</p>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-white/10">
                        <th className="py-4 px-4 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 w-24">ID</th>
                        <th className="py-4 px-4 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Attribute Title</th>
                        <th className="py-4 px-4 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Assigned Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(enterprise.projectAttributes || [])
                        .filter(attr => attr.title && attr.title.trim() !== '')
                        .map(attr => (
                        <tr key={attr.id} className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50/50 dark:hover:bg-white/5 transition-colors">
                          <td className="py-4 px-4">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded bg-gray-100 dark:bg-white/5 text-xs font-bold text-gray-500 dark:text-gray-400">
                              {attr.id}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span className="text-sm font-medium dark:text-white">{attr.title}</span>
                          </td>
                          <td className="py-4 px-4">
                            <select 
                              value={formData.attributes[attr.id] || ''}
                              onChange={(e) => setFormData({
                                ...formData,
                                attributes: {
                                  ...formData.attributes,
                                  [attr.id]: e.target.value
                                }
                              })}
                              className="w-full max-w-xs bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">-- Select Value --</option>
                              {attr.values.map(val => (
                                <option key={val.id} value={val.id}>{val.id} | {val.description}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'calendar' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <CalendarManager 
                projectId={project.id} 
                enterpriseId={enterprise.id}
                title="Project Calendars"
                description="Define working days, weekends, and holidays for phasing calculations."
                allowImport={true}
              />
            </div>
          )}
          {activeTab === 'access' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="bg-white dark:bg-[#141414] p-8 rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm">
                <h2 className="text-lg font-bold mb-2 dark:text-white">Project Access</h2>
                <p className="text-sm text-gray-900 dark:text-gray-400 mb-6">Select users from the enterprise to grant project access.</p>
                <div className="space-y-2">
                  {enterpriseUsers.map(({ userId: uid, email, role }) => (
                    <div key={uid} className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl transition-colors border border-transparent hover:border-gray-200 dark:hover:border-white/10">
                      <div className="flex items-center gap-4">
                        <input 
                          type="checkbox" 
                          checked={!!members[uid]}
                          onChange={() => toggleUser(uid)}
                          className="w-5 h-5 rounded border-gray-300 dark:border-white/10 text-blue-600 focus:ring-blue-500 bg-transparent"
                        />
                        <div>
                          <p className="text-sm font-bold dark:text-white">{email}</p>
                          <p className="text-[10px] text-gray-900 dark:text-gray-400 uppercase tracking-widest font-bold">{role}</p>
                        </div>
                      </div>
                      {members[uid] && (
                        <select 
                          value={members[uid]}
                          onChange={(e) => void setUserRole(uid, e.target.value as ProjectRole)}
                          className="text-xs bg-gray-100 dark:bg-white/5 border-none rounded-lg px-3 py-1.5 font-bold uppercase tracking-widest text-gray-900 dark:text-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="Project User">User</option>
                          <option value="Project Admin">Admin</option>
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Replace ID Modal */}
      {isReplaceIdModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1a1a1a] w-full max-w-md rounded-2xl shadow-2xl border border-gray-200 dark:border-white/10 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-200 dark:border-white/10">
              <h3 className="text-xl font-bold dark:text-white flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-blue-600" />
                Replace Project ID
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                This will update the unique identifier for <span className="font-bold text-gray-900 dark:text-white">{project.projectName}</span>.
              </p>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Current ID</label>
                <div className="p-3 bg-gray-100 dark:bg-white/5 rounded-xl text-sm font-mono text-gray-500">
                  {project.projectCode}
                </div>
              </div>
              
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">New Project ID</label>
                <input 
                  type="text"
                  value={newProjectCode}
                  onChange={(e) => setNewProjectCode(e.target.value.toUpperCase())}
                  placeholder="E.G. PRJ-2024-001"
                  className={cn(
                    "w-full p-3 bg-gray-50 dark:bg-white/5 border rounded-xl text-sm font-mono dark:text-white focus:ring-2 outline-none",
                    isDuplicate 
                      ? "border-red-500 focus:ring-red-500/20" 
                      : "border-gray-200 dark:border-white/10 focus:ring-blue-500"
                  )}
                  autoFocus
                />
                {isDuplicate && (
                  <p className="text-[10px] text-red-500 mt-1 font-bold uppercase tracking-widest">This Project ID already exists!</p>
                )}
              </div>

              {replaceError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-xl text-xs text-red-600 dark:text-red-400 font-medium">
                  {replaceError}
                </div>
              )}

              <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl border border-amber-200 dark:border-amber-900/30">
                <p className="text-[10px] text-amber-800 dark:text-amber-400 leading-relaxed">
                  <span className="font-bold uppercase">Warning:</span> Replacing the Project ID may affect external integrations or reports that rely on this specific code. Ensure all stakeholders are notified.
                </p>
              </div>
            </div>

            <div className="p-6 bg-gray-50 dark:bg-white/5 flex gap-3">
              <button 
                onClick={() => {
                  setIsReplaceIdModalOpen(false);
                  setNewProjectCode('');
                  setReplaceError('');
                }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
              >
                CANCEL
              </button>
              <button 
                onClick={handleReplaceId}
                disabled={isReplacing || !newProjectCode.trim() || isDuplicate}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all"
              >
                {isReplacing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    REPLACING...
                  </>
                ) : (
                  'CONFIRM REPLACE'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
