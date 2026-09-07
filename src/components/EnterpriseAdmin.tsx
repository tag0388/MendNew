import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, auth } from '../firebase';
import { doc, updateDoc, collection, query, where, onSnapshot, deleteDoc, getDocs, addDoc, writeBatch } from 'firebase/firestore';
import { Enterprise, Project, Sheet, ProjectAttribute, ProjectAttributeValue, SavedView } from '../types';
import { Users, Briefcase, Settings, Plus, Trash2, Tag, Search, X, ChevronRight, ChevronDown, UserPlus, ExternalLink, AlertTriangle, Edit2, Download, Upload, Eye, Lock, Unlock, MoreVertical, Bookmark, Filter, Layout, CheckCircle2, PieChart, DollarSign, RefreshCw, Receipt, Calendar, Hash, Menu, ChevronLeft, Building2, ShieldAlert, ShoppingCart, Activity } from 'lucide-react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AgGridReact } from 'ag-grid-react';
import CalendarManager from './CalendarManager';
import DataGridModule from './DataGridModule';
import EnterpriseProcurementSteps from './EnterpriseProcurementSteps';

const RESOURCE_CATEGORIES = ['Labour', 'Plant', 'Material', 'Subcontractor', 'Sundries', 'Staff'];
const RESOURCE_UNITS = [
  // International
  'm', 'm2', 'm3', 'ton', 'kg', 'no', 'item', 'hour', 'week', 'month',
  // American
  'ft', 'ft2', 'ft3', 'lb', 'gal', 'yd', 'yd2', 'yd3', 'in', 'in2', 'in3'
];

const getAvailableUnits = (category: string) => {
  if (category === 'Labour' || category === 'Plant') {
    return ['hour', 'week', 'month', 'no', 'item'];
  }
  return RESOURCE_UNITS;
};

const AttributeTitleInput = ({ attr, type, onSave }: { attr: any, type: any, onSave: any }) => {
  const [val, setVal] = useState(attr.title || '');
  
  useEffect(() => {
    setVal(attr.title || '');
  }, [attr.title]);

  return (
    <input 
      type="text"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => onSave(type, attr.id, val)}
      placeholder="Assign Title..."
      className="w-full bg-transparent border-none p-0 text-sm font-medium focus:ring-0 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600"
      onClick={(e) => e.stopPropagation()}
    />
  );
};

interface EnterpriseAdminProps {
  enterprise: Enterprise;
  setIsSidebarCollapsed?: (c: boolean) => void;
}

export default function EnterpriseAdmin({ enterprise, setIsSidebarCollapsed }: EnterpriseAdminProps) {
  const [activeTab, setActiveTab] = useState<string>('users');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['General', 'Cost', 'Change', 'Risk', 'Sub-Contract', 'Procurement', 'Progress', 'Schedule']));
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const adminSections = [
    {
      title: 'General',
      icon: <Settings className="w-4 h-4" />,
      items: [
        { id: 'enterpriseSettings', label: 'Enterprise Settings', icon: <Settings className="w-4 h-4" /> },
        { id: 'users', label: 'Enterprise Users', icon: <Users className="w-4 h-4" /> },
        { id: 'projects', label: 'Enterprise Projects', icon: <Briefcase className="w-4 h-4" /> },
        { id: 'projectAttributes', label: 'Enterprise Project Attributes', icon: <Settings className="w-4 h-4" /> },
        { id: 'lineItemAttributes', label: 'Enterprise Line-Item Attributes', icon: <Tag className="w-4 h-4" /> },
        { id: 'enterpriseCalendars', label: 'Enterprise Calendars', icon: <Calendar className="w-4 h-4" /> },
      ]
    },
    {
      title: 'Cost',
      icon: <DollarSign className="w-4 h-4" />,
      items: [
        { id: 'costCodeAttributes', label: 'Enterprise Cost Code Attributes', icon: <Tag className="w-4 h-4" /> },
        { id: 'resourceRates', label: 'Enterprise Resources Rates', icon: <DollarSign className="w-4 h-4" /> },
      ]
    },
    {
      title: 'Change',
      icon: <RefreshCw className="w-4 h-4" />,
      items: [
        { id: 'changeAttributes', label: 'Enterprise Change Attributes', icon: <Tag className="w-4 h-4" /> },
      ]
    },
    {
      title: 'Risk',
      icon: <ShieldAlert className="w-4 h-4" />,
      items: [
        { id: 'riskAttributes', label: 'Enterprise Risk Attributes', icon: <Tag className="w-4 h-4" /> },
      ]
    },
    {
      title: 'Sub-Contract',
      icon: <Briefcase className="w-4 h-4" />,
      items: [
        { id: 'subcontractAttributes', label: 'Enterprise Sub-Contract Attributes', icon: <Tag className="w-4 h-4" /> },
        { id: 'vendors', label: 'Enterprise Vendors', icon: <Building2 className="w-4 h-4" /> },
      ]
    },
    {
      title: 'Procurement',
      icon: <ShoppingCart className="w-4 h-4" />,
      items: [
        { id: 'procurementAttributes', label: 'Enterprise Procurement Attributes', icon: <Tag className="w-4 h-4" /> },
        { id: 'procurementSteps', label: 'Standard Procurement Steps', icon: <ShoppingCart className="w-4 h-4" /> },
      ]
    },
    {
      title: 'Progress',
      icon: <Activity className="w-4 h-4" />,
      items: [
        { id: 'progressAttributes', label: 'Enterprise Progress Attributes', icon: <Tag className="w-4 h-4" /> },
      ]
    }
  ];

  const toggleSection = (title: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(title)) {
      newExpanded.delete(title);
    } else {
      newExpanded.add(title);
    }
    setExpandedSections(newExpanded);
  };
  const [projects, setProjects] = useState<Project[]>([]);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  
  // Search and Selection States
  const [userSearch, setUserSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [attrSearch, setAttrSearch] = useState('');
  const [valueSearch, setValueSearch] = useState('');
  const [resourceSearch, setResourceSearch] = useState('');
  const [costElementSearch, setCostElementSearch] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [selectedVendorIds, setSelectedVendorIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, type: 'user' | 'project' | 'attr-value' | 'rate' | 'costElement' | 'vendor', id: string } | null>(null);
  const [selectedAttrId, setSelectedAttrId] = useState<string>('01');
  const [selectedAttrValueIds, setSelectedAttrValueIds] = useState<Set<string>>(new Set());
  const [selectedRateIds, setSelectedRateIds] = useState<Set<string>>(new Set());
  const [selectedCostElementIds, setSelectedCostElementIds] = useState<Set<string>>(new Set());
  const [projectSort, setProjectSort] = useState<{ field: 'dateCreated' | 'dateLastModified' | 'projectName' | 'projectCode', direction: 'asc' | 'desc' }>({ field: 'dateCreated', direction: 'desc' });
  
  // Modal States
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'user' | 'bulk-user' | 'project' | 'bulk-project' | 'bulk-attr-value' | 'rate' | 'bulk-rate' | 'costElement' | 'bulk-costElement' | 'vendor' | 'bulk-vendor', id?: string, name?: string, count?: number } | null>(null);
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);

  const [isBulkUpdateModalOpen, setIsBulkUpdateModalOpen] = useState<{ type: 'rate' | 'project' | 'vendor', count: number } | null>(null);
  const [bulkUpdateFormData, setBulkUpdateFormData] = useState<Record<string, any>>({});

  const [isReplaceIdModalOpen, setIsReplaceIdModalOpen] = useState(false);
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);
  const [newProjectData, setNewProjectData] = useState({ name: '', code: '' });
  const [newProjectCode, setNewProjectCode] = useState('');
  const [isEditProjectDetailsOpen, setIsEditProjectDetailsOpen] = useState(false);
  const [projectToEdit, setProjectToEdit] = useState<Project | null>(null);
  const [editingProjectDetails, setEditingProjectDetails] = useState<Record<string, any>>({});
  const [isReplacing, setIsReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState('');
  const [projectToReplace, setProjectToReplace] = useState<Project | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [editingValueId, setEditingValueId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'description' | 'sortOrder' | null>(null);

  const [isEditingValue, setIsEditingValue] = useState<{ type: 'project' | 'lineItem' | 'costCode' | 'subcontract' | 'procurement' | 'change' | 'risk' | 'progress', attrId: string, valueId: string | null } | null>(null);
  const [isEditingResource, setIsEditingResource] = useState<{ id: string | null, insertIndex?: number } | null>(null);
  const [isEditingCostElement, setIsEditingCostElement] = useState<{ id: string | null, insertIndex?: number } | null>(null);
  const [isEditingVendor, setIsEditingVendor] = useState<{ id: string | null, insertIndex?: number } | null>(null);
  const [valueFormData, setValueFormData] = useState({ id: '', description: '', sortOrder: '' as any });
  const [costElementFormData, setCostElementFormData] = useState({ id: '', description: '', sortCode: '' });
  const [vendorFormData, setVendorFormData] = useState({ id: '', name: '', code: '', contactEmail: '', contactName: '' });
  const [resourceFormData, setResourceFormData] = useState({ 
    id: '', 
    name: '', 
    unit: '', 
    rate: 0, 
    category: '',
    udf1: '',
    udf2: '',
    udf3: ''
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectPhotoInputRef = useRef<HTMLInputElement>(null);
  const enterpriseLogoInputRef = useRef<HTMLInputElement>(null);
  
  // Grid Refs
  const usersGridRef = useRef<AgGridReact>(null);
  const projectsGridRef = useRef<AgGridReact>(null);
  const resourceRatesGridRef = useRef<AgGridReact>(null);
  const vendorsGridRef = useRef<AgGridReact>(null);
  const attrValueGridRef = useRef<AgGridReact>(null);

  // Table Control States
  const [visibleColumns, setVisibleColumns] = useState<Record<string, string[]>>({
    users: ['photo', 'name', 'email', 'joined', 'access'],
    projects: ['photo', 'name', 'code', 'created', 'users', 'sheets'],
    lineItemAttributes: ['id', 'description', 'sortOrder'],
    costCodeAttributes: ['id', 'description', 'sortOrder'],
    projectAttributes: ['id', 'description', 'sortOrder'],
    subcontractAttributes: ['id', 'description', 'sortOrder'],
    procurementAttributes: ['id', 'description', 'sortOrder'],
    changeAttributes: ['id', 'description', 'sortOrder'],
    riskAttributes: ['id', 'description', 'sortOrder'],
    resourceRates: ['id', 'name', 'category', 'unit', 'rate', 'udf1', 'udf2', 'udf3'],
    vendors: ['id', 'name', 'code', 'contactName', 'contactEmail']
  });
  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState<string | null>(null);
  const [isFrozen, setIsFrozen] = useState<Record<string, boolean>>({
    users: true,
    projects: true,
    lineItemAttributes: true,
    costCodeAttributes: true,
    projectAttributes: true,
    subcontractAttributes: true,
    changeAttributes: true,
    resourceRates: true,
    vendors: true
  });
  const [importPreview, setImportPreview] = useState<{ type: 'users' | 'projects' | 'lineItemAttributes' | 'costCodeAttributes' | 'projectAttributes' | 'resourceRates' | 'subcontractAttributes' | 'procurementAttributes' | 'changeAttributes' | 'riskAttributes' | 'progressAttributes' | 'vendors', data: any[], attrId?: string } | null>(null);
  const [userSort, setUserSort] = useState<{ field: string, direction: 'asc' | 'desc' }>({ field: 'name', direction: 'asc' });
  const [attrSort, setAttrSort] = useState<{ field: string, direction: 'asc' | 'desc' }>({ field: 'sortOrder', direction: 'asc' });
  const [resourceSort, setResourceSort] = useState<{ field: string, direction: 'asc' | 'desc' }>({ field: 'id', direction: 'asc' });
  const [costElementSort, setCostElementSort] = useState<{ field: string, direction: 'asc' | 'desc' }>({ field: 'id', direction: 'asc' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const isDuplicateVendorCode = useMemo(() => {
    if (!vendorFormData.id) return false;
    const currentVendors = enterprise.vendors || [];
    const updatedVendorId = isEditingVendor?.id;
    return currentVendors.some(v => v.id !== updatedVendorId && v.id.toLowerCase() === vendorFormData.id.toLowerCase());
  }, [vendorFormData.id, enterprise.vendors, isEditingVendor?.id]);
  const [showImportSuccessModal, setShowImportSuccessModal] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [isSavedViewMenuOpen, setIsSavedViewMenuOpen] = useState<string | null>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [columnFilters, setColumnFilters] = useState<Record<string, Record<string, string>>>({
    users: {},
    projects: {},
    lineItemAttributes: {},
    costCodeAttributes: {},
    projectAttributes: {},
    subcontractAttributes: {},
    changeAttributes: {},
    riskAttributes: {},
    resourceRates: {}
  });

  const clearAllFilters = (tableId: string) => {
    setColumnFilters(prev => ({ ...prev, [tableId]: {} }));
    if (tableId === 'resourceRates') setResourceSearch('');
    if (tableId === 'projects') setProjectSearch('');
    if (tableId === 'users') setUserSearch('');
    if (tableId === 'lineItemAttributes' || tableId === 'costCodeAttributes' || tableId === 'projectAttributes' || tableId === 'subcontractAttributes' || tableId === 'procurementAttributes' || tableId === 'changeAttributes') {
      setAttrSearch('');
      setValueSearch('');
    }
  };

  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(collection(db, 'savedViews'), where('userId', '==', auth.currentUser.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const views = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as SavedView));
      setSavedViews(views);
    }, (error) => {
      console.error("Saved views fetch error:", error);
    });
    return () => unsubscribe();
  }, [auth.currentUser?.uid]);

  const saveView = async (tableId: string, name: string) => {
    if (!name.trim() || !auth.currentUser) return;
    try {
      const newView: Omit<SavedView, 'id'> = {
        name,
        tableId,
        columns: visibleColumns[tableId],
        userId: auth.currentUser.uid,
        createdAt: new Date().toISOString(),
        config: {
          isFrozen: isFrozen[tableId],
          sort: tableId === 'users' ? userSort : 
                tableId === 'projects' ? projectSort : 
                tableId === 'resourceRates' ? resourceSort : 
                (tableId === 'lineItemAttributes' || tableId === 'costCodeAttributes' || tableId === 'projectAttributes' || tableId === 'subcontractAttributes' || tableId === 'changeAttributes') ? attrSort : {},
          columnFilters: columnFilters[tableId]
        }
      } as any;
      await addDoc(collection(db, 'savedViews'), newView);
      setNewViewName('');
      setIsSavedViewMenuOpen(null);
    } catch (error) {
      console.error('Failed to save view', error);
      alert('Failed to save view.');
    }
  };

  const applyView = (view: SavedView) => {
    setVisibleColumns(prev => ({
      ...prev,
      [view.tableId]: view.columns
    }));
    
    if ((view as any).config) {
      const config = (view as any).config;
      setIsFrozen(prev => ({ ...prev, [view.tableId]: config.isFrozen }));
      setColumnFilters(prev => ({ ...prev, [view.tableId]: config.columnFilters }));
      
      if (view.tableId === 'users') setUserSort(config.sort);
      else if (view.tableId === 'projects') setProjectSort(config.sort);
      else if (view.tableId === 'resourceRates') setResourceSort(config.sort);
      else if (view.tableId === 'resourceRates') setResourceSort(config.sort);
      else if (view.tableId === 'lineItemAttributes' || view.tableId === 'costCodeAttributes' || view.tableId === 'projectAttributes' || view.tableId === 'subcontractAttributes' || view.tableId === 'changeAttributes') setAttrSort(config.sort);
    }
    
    setIsSavedViewMenuOpen(null);
  };

  const deleteView = async (viewId: string) => {
    try {
      await deleteDoc(doc(db, 'savedViews', viewId));
    } catch (error) {
      console.error('Failed to delete view', error);
    }
  };

  const getAttributes = (type: 'project' | 'lineItem' | 'costCode' | 'subcontract' | 'procurement' | 'change' | 'risk' | 'progress') => {
    const field = type === 'project' ? 'projectAttributes' : type === 'costCode' ? 'costCodeAttributes' : type === 'subcontract' ? 'subcontractAttributes' : type === 'procurement' ? 'procurementAttributes' : type === 'change' ? 'changeAttributes' : type === 'risk' ? 'riskAttributes' : type === 'progress' ? 'progressAttributes' : 'lineItemAttributes';
    const attrs = (enterprise as any)[field] || [];
    
    // Legacy check: if it's an array of strings, convert to new structure
    if (attrs.length > 0 && typeof attrs[0] === 'string') {
      return Array.from({ length: 10 }, (_, i) => ({
        id: (i + 1).toString().padStart(2, '0'),
        title: attrs[i] || '',
        values: []
      }));
    }

    // New structure or empty
    const result = [...attrs];
    while (result.length < 10) {
      result.push({
        id: (result.length + 1).toString().padStart(2, '0'),
        title: '',
        values: []
      });
    }
    return result as ProjectAttribute[];
  };

  const resourceIdExists = !isSubmitting && !isEditingResource?.id && (enterprise.resourceRates || []).some(r => r.id === resourceFormData.id);
  const valueIdExists = !isSubmitting && !isEditingValue?.valueId && isEditingValue && (getAttributes(isEditingValue.type).find(a => a.id === isEditingValue.attrId)?.values || []).some(v => v.id === valueFormData.id);

  useEffect(() => {
    const q = query(collection(db, 'projects'), where('enterpriseId', '==', enterprise.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Project)));
    }, (error) => {
      console.error("Projects fetch error:", error);
    });
    return () => unsubscribe();
  }, [enterprise.id]);

  useEffect(() => {
    const q = query(collection(db, 'sheets'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSheets(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Sheet)));
    }, (error) => {
      console.error("Sheets fetch error:", error);
    });
    return () => unsubscribe();
  }, []);

  const bulkDeleteResourceRates = async () => {
    if (!enterprise.id || selectedRateIds.size === 0) return;
    try {
      const newRates = (enterprise.resourceRates || []).filter(r => !selectedRateIds.has(r.id));
      await updateDoc(doc(db, 'enterprises', enterprise.id), { resourceRates: newRates });
      setSelectedRateIds(new Set());
      setDeleteConfirm(null);
    } catch (error) {
      console.error('Bulk delete rates failed', error);
      alert('Failed to delete resource rates.');
    }
  };

  const saveVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enterprise.id || !vendorFormData.name || !vendorFormData.id) return;

    if (vendorFormData.id.length > 50) {
      alert('Vendor ID cannot be more than 50 characters.');
      return;
    }

    if (isDuplicateVendorCode) {
      alert(`Vendor ID "${vendorFormData.id}" is already in use.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const currentVendors = enterprise.vendors || [];
      const updatedVendorId = isEditingVendor?.id;
      
      let newVendors;
      if (updatedVendorId) {
        // When editing, preserve the original ID but update other fields
        newVendors = currentVendors.map(v => v.id === updatedVendorId ? { ...vendorFormData } : v);
      } else {
        // When adding new, use the inputed ID
        newVendors = [...currentVendors, { ...vendorFormData }];
      }
      await updateDoc(doc(db, 'enterprises', enterprise.id), { vendors: newVendors });
      setIsEditingVendor(null);
      setVendorFormData({ id: '', name: '', code: '', contactEmail: '', contactName: '' });
    } catch (error) {
      console.error('Save vendor failed', error);
      alert('Failed to save vendor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteVendor = async (id: string) => {
    if (!enterprise.id) return;
    try {
      const newVendors = (enterprise.vendors || []).filter(v => v.id !== id);
      await updateDoc(doc(db, 'enterprises', enterprise.id), { vendors: newVendors });
      setDeleteConfirm(null);
    } catch (error) {
      console.error('Delete vendor failed', error);
      alert('Failed to delete vendor.');
    }
  };

  const bulkDeleteVendors = async () => {
    if (!enterprise.id || selectedVendorIds.size === 0) return;
    try {
      const newVendors = (enterprise.vendors || []).filter(v => !selectedVendorIds.has(v.id));
      await updateDoc(doc(db, 'enterprises', enterprise.id), { vendors: newVendors });
      setSelectedVendorIds(new Set());
      setDeleteConfirm(null);
    } catch (error) {
      console.error('Bulk delete vendors failed', error);
      alert('Failed to delete vendors.');
    }
  };

  const toggleUserRole = async (uid: string) => {
    const user = enterprise.users?.[uid];
    if (!user) return;
    const newRole = user.role === 'Enterprise System Admin' ? 'Enterprise User' : 'Enterprise System Admin';
    await updateDoc(doc(db, 'enterprises', enterprise.id), {
      [`users.${uid}.role`]: newRole
    });
  };

  const deleteUser = async (uid: string) => {
    const newUsers = { ...enterprise.users };
    delete newUsers[uid];
    await updateDoc(doc(db, 'enterprises', enterprise.id), {
      users: newUsers
    });
    setDeleteConfirm(null);
    if (selectedUserId === uid) setSelectedUserId(null);
  };

  const bulkDeleteUsers = async () => {
    if (!enterprise.id || selectedUserIds.size === 0) return;
    try {
      const newUsers = { ...enterprise.users };
      selectedUserIds.forEach(uid => {
        delete newUsers[uid];
      });
      await updateDoc(doc(db, 'enterprises', enterprise.id), {
        users: newUsers
      });
      setSelectedUserIds(new Set());
      setDeleteConfirm(null);
      if (selectedUserId && selectedUserIds.has(selectedUserId)) setSelectedUserId(null);
    } catch (error) {
      console.error('Bulk delete users failed', error);
      alert('Failed to delete users.');
    }
  };

  const deleteProject = async (projectId: string) => {
    await deleteDoc(doc(db, 'projects', projectId));
    setDeleteConfirm(null);
    if (selectedProjectId === projectId) setSelectedProjectId(null);
    const newSelected = new Set(selectedProjectIds);
    newSelected.delete(projectId);
    setSelectedProjectIds(newSelected);
  };

  const handleResourceSort = (field: string) => {
    setResourceSort(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const filteredUsers = useMemo(() => {
    let result = Object.entries(enterprise.users || {})
      .map(([uid, data]) => ({ uid, ...data }))
      .filter(user => 
        (user.displayName || user.name || '').toLowerCase().includes(userSearch.toLowerCase()) ||
        user.email.toLowerCase().includes(userSearch.toLowerCase())
      );

    // Apply column filters
    const filters = columnFilters.users;
    Object.entries(filters).forEach(([field, value]) => {
      if (value) {
        result = result.filter(u => {
          const val = field === 'name' ? (u.displayName || u.name) : (u as any)[field];
          return String(val || '').toLowerCase().includes(value.toLowerCase());
        });
      }
    });

    return result.sort((a, b) => {
      const aVal = (a as any)[userSort.field] || '';
      const bVal = (b as any)[userSort.field] || '';
      if (userSort.direction === 'asc') return aVal > bVal ? 1 : -1;
      return aVal < bVal ? 1 : -1;
    });
  }, [enterprise.users, userSearch, userSort, columnFilters.users]);

  const sortedProjects = useMemo(() => {
    let result = [...projects]
      .filter(p => 
        p.projectName.toLowerCase().includes(projectSearch.toLowerCase()) ||
        p.projectCode.toLowerCase().includes(projectSearch.toLowerCase())
      );

    // Apply column filters
    const filters = columnFilters.projects;
    Object.entries(filters).forEach(([field, value]) => {
      if (value) {
        result = result.filter(p => {
          // Map 'name' to 'projectName' and 'code' to 'projectCode' if needed
          const actualField = field === 'name' ? 'projectName' : field === 'code' ? 'projectCode' : field;
          const val = (p as any)[actualField];
          return String(val || '').toLowerCase().includes(value.toLowerCase());
        });
      }
    });

    return result.sort((a, b) => {
      const aVal = (a as any)[projectSort.field] || '';
      const bVal = (b as any)[projectSort.field] || '';
      if (projectSort.direction === 'asc') return aVal > bVal ? 1 : -1;
      return aVal < bVal ? 1 : -1;
    });
  }, [projects, projectSearch, projectSort, columnFilters.projects]);

  const filteredResources = useMemo(() => {
    let result = (enterprise.resourceRates || [])
      .filter(r => 
        r.name.toLowerCase().includes(resourceSearch.toLowerCase()) ||
        r.id.toLowerCase().includes(resourceSearch.toLowerCase()) ||
        (r.category || '').toLowerCase().includes(resourceSearch.toLowerCase())
      );

    // Apply column filters
    const filters = columnFilters.resourceRates;
    Object.entries(filters).forEach(([field, value]) => {
      if (value) {
        result = result.filter(r => {
          const val = (r as any)[field];
          return String(val || '').toLowerCase().includes(value.toLowerCase());
        });
      }
    });

    return result.sort((a: any, b: any) => {
      const aVal = a[resourceSort.field];
      const bVal = b[resourceSort.field];
      if (resourceSort.direction === 'asc') return aVal > bVal ? 1 : -1;
      return aVal < bVal ? 1 : -1;
    });
  }, [enterprise.resourceRates, resourceSearch, resourceSort, columnFilters.resourceRates]);

  const [vendorSort, setVendorSort] = useState<{ field: string, direction: 'asc' | 'desc' }>({ field: 'name', direction: 'asc' });

  const filteredVendors = useMemo(() => {
    let result = (enterprise.vendors || [])
      .filter(v => 
        v.name.toLowerCase().includes(vendorSearch.toLowerCase()) ||
        (v.code || '').toLowerCase().includes(vendorSearch.toLowerCase()) ||
        (v.contactEmail || '').toLowerCase().includes(vendorSearch.toLowerCase())
      );

    // Apply column filters
    const filters = columnFilters.vendors || {};
    Object.entries(filters).forEach(([field, value]) => {
      if (value) {
        result = result.filter(v => {
          const val = (v as any)[field];
          return String(val || '').toLowerCase().includes(value.toLowerCase());
        });
      }
    });

    return result.sort((a: any, b: any) => {
      const aVal = a[vendorSort.field] || '';
      const bVal = b[vendorSort.field] || '';
      if (vendorSort.direction === 'asc') return aVal > bVal ? 1 : -1;
      return aVal < bVal ? 1 : -1;
    });
  }, [enterprise.vendors, vendorSearch, vendorSort, columnFilters.vendors]);

  const bulkDeleteProjects = async () => {
    const promises = Array.from(selectedProjectIds).map((id: string) => deleteDoc(doc(db, 'projects', id)));
    await Promise.all(promises);
    setSelectedProjectIds(new Set());
    setDeleteConfirm(null);
    setSelectedProjectId(null);
  };

  const bulkDeleteAttributeValues = async (type: 'project' | 'lineItem' | 'costCode' | 'subcontract' | 'procurement' | 'change' | 'risk' | 'progress', attrId: string) => {
    const field = type === 'project' ? 'projectAttributes' : type === 'costCode' ? 'costCodeAttributes' : type === 'subcontract' ? 'subcontractAttributes' : type === 'procurement' ? 'procurementAttributes' : type === 'change' ? 'changeAttributes' : type === 'risk' ? 'riskAttributes' : type === 'progress' ? 'progressAttributes' : 'lineItemAttributes';
    const currentAttrs = getAttributes(type);
    const newAttrs = currentAttrs.map(a => {
      if (a.id === attrId) {
        return { ...a, values: (a.values || []).filter(v => !selectedAttrValueIds.has(v.id)) };
      }
      return a;
    });
    await updateDoc(doc(db, 'enterprises', enterprise.id), {
      [field]: newAttrs
    });
    setSelectedAttrValueIds(new Set());
    setDeleteConfirm(null);
  };

  const deleteAttributeValue = async (type: 'project' | 'lineItem' | 'costCode' | 'subcontract' | 'procurement' | 'change' | 'risk' | 'progress', attrId: string, valueId: string) => {
    try {
      const field = type === 'project' ? 'projectAttributes' : type === 'costCode' ? 'costCodeAttributes' : type === 'subcontract' ? 'subcontractAttributes' : type === 'procurement' ? 'procurementAttributes' : type === 'change' ? 'changeAttributes' : type === 'risk' ? 'riskAttributes' : type === 'progress' ? 'progressAttributes' : 'lineItemAttributes';
      const currentAttrs = getAttributes(type);
      const newAttrs = currentAttrs.map(a => {
        if (a.id === attrId) {
          const values = (a.values || []).filter(v => v.id !== valueId);
          return { ...a, values };
        }
        return a;
      });
      await updateDoc(doc(db, 'enterprises', enterprise.id), {
        [field]: newAttrs
      });
      toast.success('Value deleted successfully');
    } catch (error) {
      console.error('Failed to delete attribute value', error);
      toast.error('Failed to delete value');
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || isInviting) return;
    
    setIsInviting(true);
    try {
      // 1. Generate a secure token
      const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      
      // 2. Create invitation document in Firestore
      await addDoc(collection(db, 'invitations'), {
        enterpriseId: enterprise.id,
        email: inviteEmail.toLowerCase().trim(),
        token: token,
        status: 'pending',
        invitedBy: auth.currentUser?.uid,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
      });

      // 3. Generate the secure link
      const inviteLink = `${window.location.origin}?token=${token}`;
      setGeneratedLink(inviteLink);

      // 4. Try to send real email via our backend
      await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          enterpriseName: enterprise.name,
          inviterName: auth.currentUser?.displayName || auth.currentUser?.email || 'A colleague',
          appUrl: inviteLink
        })
      }).catch(err => console.warn('Email sending failed, but link was generated:', err));

      // 5. Track pending invite in Enterprise doc
      const pendingInvites = (enterprise as any).pendingInvites || [];
      if (!pendingInvites.includes(inviteEmail)) {
        await updateDoc(doc(db, 'enterprises', enterprise.id), {
          pendingInvites: [...pendingInvites, inviteEmail]
        });
      }
      
      // We don't close the modal immediately so they can copy the link
    } catch (error) {
      console.error('Invitation failed:', error);
      alert(error instanceof Error ? error.message : 'Failed to generate invitation. Please try again.');
    } finally {
      setIsInviting(false);
    }
  };

  const copyInviteLink = () => {
    if (generatedLink) {
      navigator.clipboard.writeText(generatedLink);
      alert('Invitation link copied to clipboard!');
    }
  };

  const toggleProjectAccess = async (projectId: string, uid: string, currentRole?: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const newUsers = { ...project.users };
    if (currentRole) {
      delete newUsers[uid];
    } else {
      newUsers[uid] = 'Project User';
    }
    await updateDoc(doc(db, 'projects', projectId), { 
      users: newUsers,
      dateLastModified: new Date().toISOString()
    });
  };

  const updateProjectRole = async (projectId: string, uid: string, role: 'Project Admin' | 'Project User') => {
    await updateDoc(doc(db, 'projects', projectId), {
      [`users.${uid}`]: role,
      dateLastModified: new Date().toISOString()
    });
  };

  const handleUpdateProjectStatus = async (projectId: string, status: string) => {
    await updateDoc(doc(db, 'projects', projectId), {
      status,
      dateLastModified: new Date().toISOString()
    });
  };

  const handleUpdateProjectPhoto = async (projectId: string, photoURL: string) => {
    await updateDoc(doc(db, 'projects', projectId), {
      photoURL,
      dateLastModified: new Date().toISOString()
    });
  };

  const handleReplaceProjectId = async () => {
    if (!projectToReplace || !newProjectCode.trim()) {
      setReplaceError('Please enter a new Project ID.');
      return;
    }
    if (newProjectCode.trim() === projectToReplace.projectCode) {
      setReplaceError('New ID must be different from current ID.');
      return;
    }

    setIsReplacing(true);
    setReplaceError('');

    try {
      // Check for duplicates
      const q = query(
        collection(db, 'projects'),
        where('enterpriseId', '==', enterprise.id),
        where('projectCode', '==', newProjectCode.trim())
      );
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        setReplaceError('This Project ID already exists in the enterprise.');
        setIsReplacing(false);
        return;
      }

      await updateDoc(doc(db, 'projects', projectToReplace.id), {
        projectCode: newProjectCode.trim(),
        dateLastModified: new Date().toISOString()
      });

      setIsReplaceIdModalOpen(false);
      setNewProjectCode('');
      setProjectToReplace(null);
    } catch (error) {
      console.error('Replace ID failed', error);
      setReplaceError('Failed to replace Project ID.');
    } finally {
      setIsReplacing(false);
    }
  };

  const isNewProjectCodeDuplicate = useMemo(() => {
    if (!newProjectCode.trim()) return false;
    return projects.some(p => p.projectCode === newProjectCode.trim() && p.id !== projectToReplace?.id);
  }, [newProjectCode, projects, projectToReplace]);

  const handleBulkUpdate = async () => {
    if (!isBulkUpdateModalOpen) return;
    try {
      setIsSubmitting(true);
      const { type } = isBulkUpdateModalOpen;
      
      if (type === 'rate') {
        const currentResources = enterprise.resourceRates || [];
        const newResources = currentResources.map(r => {
          if (selectedRateIds.has(r.id)) {
            return { ...r, ...bulkUpdateFormData };
          }
          return r;
        });
        await updateDoc(doc(db, 'enterprises', enterprise.id), {
          resourceRates: newResources
        });
        setSelectedRateIds(new Set());
      } else if (type === 'project') {
        const batch = writeBatch(db);
        selectedProjectIds.forEach(id => {
          batch.update(doc(db, 'projects', id), {
            ...bulkUpdateFormData,
            dateLastModified: new Date().toISOString()
          });
        });
        await batch.commit();
        setSelectedProjectIds(new Set());
      } else if (type === 'vendor') {
        const currentVendors = enterprise.vendors || [];
        const newVendors = currentVendors.map(v => {
          if (selectedVendorIds.has(v.id)) {
            return { ...v, ...bulkUpdateFormData };
          }
          return v;
        });
        await updateDoc(doc(db, 'enterprises', enterprise.id), {
          vendors: newVendors
        });
        setSelectedVendorIds(new Set());
      }

      toast.success(`Bulk update successful for ${isBulkUpdateModalOpen.count} items.`);
      setIsBulkUpdateModalOpen(null);
      setBulkUpdateFormData({});
    } catch (error) {
      console.error("Bulk update error:", error);
      toast.error("Failed to perform bulk update.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateEnterprise = async (updates: Partial<Enterprise>) => {
    try {
      await updateDoc(doc(db, 'enterprises', enterprise.id), updates);
    } catch (error) {
      console.error('Enterprise update failed', error);
      alert('Failed to update enterprise settings.');
    }
  };

  const exportUsers = () => {
    const data = filteredUsers.map(user => ({
      Name: user.name || user.displayName || '',
      Email: user.email || '',
      Role: user.role || '',
      'Joined At': user.joinedAt ? new Date(user.joinedAt).toLocaleDateString() : ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    XLSX.writeFile(wb, 'Enterprise_Users.xlsx');
  };


  const handleUserSort = (field: string) => {
    setUserSort(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const exportProjectImportTemplate = () => {
    const activeAttrs = (enterprise.projectAttributes || []).filter(attr => attr.title);
    
    const data = projects.map(p => {
      const row: any = {
        'Project ID': p.projectCode,
        'Project Name': p.projectName
      };
      
      activeAttrs.forEach(attr => {
        row[attr.title] = p.attributes?.[attr.id] || '';
      });
      
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Import_Template');
    XLSX.writeFile(wb, 'Enterprise_Projects_Import_Template.xlsx');
    toast.success('Import template exported successfully.');
  };

  const handleBulkUpdateProjectsImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        
        if (rows.length === 0) {
          toast.error("The file is empty.");
          return;
        }

        setImportPreview({ type: 'projects', data: rows });
      } catch (error) {
        console.error("Bulk update import error:", error);
        toast.error("Failed to process the import file.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImportVendorsExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        
        if (rows.length === 0) {
          toast.error("The file is empty.");
          return;
        }

        setImportPreview({ type: 'vendors', data: rows });
      } catch (error) {
        console.error("Vendor import error:", error);
        toast.error("Failed to process the import file.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const exportVendorsExcel = () => {
    const data = (enterprise.vendors || []).map(v => ({
      'Vendor ID': v.id,
      'Vendor Name': v.name,
      'Code': v.code,
      'Contact Name': v.contactName,
      'Contact Email': v.contactEmail
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vendors');
    XLSX.writeFile(wb, 'Enterprise_Vendors.xlsx');
  };

  const exportProjects = () => {
    const data = filteredProjects.map(p => ({
      'Project Name': p.projectName,
      'Project Code': p.projectCode,
      'Date Created': p.dateCreated ? new Date(p.dateCreated).toLocaleDateString() : '',
      'Users Count': Object.keys(p.users || {}).length,
      'Sheets Count': sheets.filter(s => s.projectId === p.id).length
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Projects');
    XLSX.writeFile(wb, 'Enterprise_Projects.xlsx');
  };

  const handleProjectSort = (field: 'projectName' | 'projectCode' | 'dateCreated' | 'dateLastModified') => {
    setProjectSort(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const filteredProjects = sortedProjects;

  const selectedUser = selectedUserId ? enterprise.users?.[selectedUserId] : null;
  const selectedProject = selectedProjectId ? projects.find(p => p.id === selectedProjectId) : null;

  const toggleProjectSelection = (id: string) => {
    const newSelected = new Set(selectedProjectIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedProjectIds(newSelected);
  };

  const handleAttrSort = (field: string) => {
    setAttrSort(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const projectAttributes = useMemo(() => getAttributes('project'), [enterprise.projectAttributes]);
  const lineItemAttributes = useMemo(() => getAttributes('lineItem'), [enterprise.lineItemAttributes]);
  const costCodeAttributes = useMemo(() => getAttributes('costCode'), [enterprise.costCodeAttributes]);
  const subcontractAttributes = useMemo(() => getAttributes('subcontract'), [enterprise.subcontractAttributes]);
  const procurementAttributes = useMemo(() => getAttributes('procurement'), [enterprise.procurementAttributes]);
  const changeAttributes = useMemo(() => getAttributes('change'), [enterprise.changeAttributes]);
  const riskAttributes = useMemo(() => getAttributes('risk'), [enterprise.riskAttributes]);
  const progressAttributes = useMemo(() => getAttributes('progress'), [enterprise.progressAttributes]);

  const userColumnDefs = useMemo(() => [
    {
      headerName: 'Photo',
      field: 'photoURL',
      width: 80,
      cellRenderer: (params: any) => (
        <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center overflow-hidden">
          {params.value ? (
            <img src={params.value} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <Users className="w-4 h-4 text-gray-400" />
          )}
        </div>
      )
    },
    {
      headerName: 'Name',
      field: 'displayName',
      flex: 1,
      editable: true,
      cellRenderer: (params: any) => (
        <div className="flex flex-col">
          <span className="text-xs font-medium dark:text-white">{params.value || params.data.name || 'Anonymous'}</span>
          <span className="text-[10px] text-gray-400">ID: {params.data.uid.slice(0, 8)}...</span>
        </div>
      )
    },
    { headerName: 'Email', field: 'email', flex: 1.5, editable: true },
    {
      headerName: 'Joined',
      field: 'joinedAt',
      width: 120,
      valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleDateString() : 'N/A'
    },
    {
      headerName: 'Access',
      field: 'role',
      width: 180,
      cellRenderer: (params: any) => (
        <Badge variant="outline" className={cn(
          "text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5",
          params.value === 'Enterprise System Admin' ? "border-blue-200 text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/20" : "border-gray-200 text-gray-500 dark:border-white/10 dark:text-gray-400"
        )}>
          {params.value}
        </Badge>
      )
    },
    {
      headerName: '',
      width: 60,
      pinned: 'right',
      cellRenderer: (params: any) => {
        if (params.data.isSubtotal) return null;
        return (
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setContextMenu({ x: e.clientX, y: e.clientY, type: 'user', id: params.data.uid });
            }}
            className="p-1 text-gray-400 hover:text-black dark:hover:text-white"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        );
      }
    }
  ], []);

  const projectColumnDefs = useMemo(() => [
    { 
      headerName: 'Project Code', 
      field: 'projectCode', 
      width: 150, 
      pinned: 'left',
      lockPosition: 'left',
      cellStyle: { fontWeight: 'bold' },
      editable: false 
    },
    {
      headerName: 'Project Name',
      field: 'projectName',
      flex: 1,
      minWidth: 200,
      editable: true,
      cellStyle: (params: any) => ({ color: selectedProjectId === params.data.id ? '#2563eb' : undefined })
    },
    {
      headerName: 'Enterprise Project Attributes',
      openByDefault: true,
      children: (enterprise.projectAttributes || [])
        .filter(attr => attr.title)
        .map(attr => ({
          headerName: attr.title,
          field: `attributes.${attr.id}`,
          width: 200,
          editable: true,
          cellEditor: 'agRichSelectCellEditor',
          cellEditorParams: {
            values: (attr.values || [])
              .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
              .map(v => `${v.id} | ${v.description}`),
            searchType: 'matchAny',
            allowTyping: true,
            filterList: true
          },
          valueParser: (params: any) => {
            if (typeof params.newValue === 'string') {
              const val = params.newValue.split(' | ')[0].trim();
              return val;
            }
            return params.newValue;
          },
          valueSetter: (params: any) => {
            const val = params.newValue;
            if (!params.data.attributes) {
              params.data.attributes = {};
            }
            params.data.attributes[attr.id] = val;
            return true;
          },
          valueFormatter: (params: any) => {
            if (!params.value) return '';
            const match = attr.values?.find(v => v.id === params.value);
            return match ? `${match.id} | ${match.description}` : params.value;
          }
        }))
    },
    {
      headerName: 'System Columns',
      children: [
        {
          headerName: 'Status',
          field: 'status',
          width: 120,
          cellRenderer: (params: any) => (
            <select 
              value={params.value || 'Active'}
              onChange={(e) => handleUpdateProjectStatus(params.data.id, e.target.value)}
              className="text-[10px] font-bold uppercase tracking-widest bg-gray-100 dark:bg-white/5 border-none rounded-lg px-2 py-1 text-gray-700 dark:text-gray-300 focus:ring-1 focus:ring-blue-500 outline-none w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <option value="Active">Active</option>
              <option value="On Hold">On Hold</option>
              <option value="Closed">Closed</option>
              <option value="Archived">Archived</option>
            </select>
          )
        },
        {
          headerName: 'Created Date',
          field: 'dateCreated',
          width: 130,
          valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleDateString() : 'N/A'
        },
        {
          headerName: 'Created By',
          field: 'createdByEmail',
          width: 180,
          cellClass: 'text-gray-500'
        },
        {
          headerName: 'Modified Date',
          field: 'dateLastModified',
          width: 130,
          valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleDateString() : 'N/A'
        },
        {
          headerName: 'Modified By',
          field: 'modifiedByEmail',
          width: 180,
          cellClass: 'text-gray-500'
        },
        {
          headerName: 'Users',
          field: 'users',
          width: 80,
          valueGetter: (params: any) => Object.keys(params.value || {}).length
        }
      ]
    },
    {
      headerName: '',
      width: 60,
      pinned: 'right',
      cellRenderer: (params: any) => {
        if (params.data.isSubtotal) return null;
        return (
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setActiveMenuId(activeMenuId === `project-${params.data.id}` ? null : `project-${params.data.id}`);
            }}
            className="p-1 text-gray-400 hover:text-black dark:hover:text-white"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        );
      }
    }
  ], [selectedProjectId, activeMenuId, enterprise.projectAttributes]);

  const attributeValueColumnDefs = useMemo(() => [
    {
      headerName: 'ID',
      field: 'id',
      width: 120,
      pinned: 'left',
      lockPosition: 'left',
      cellStyle: { fontWeight: 'bold' },
      editable: false
    },
    {
      headerName: 'Description',
      field: 'description',
      flex: 1,
      editable: true
    },
    {
      headerName: 'Sort Order',
      field: 'sortOrder',
      width: 120,
      editable: true
    },
    {
      headerName: '',
      width: 60,
      pinned: 'right',
      cellRenderer: (params: any) => {
        if (params.data.isSubtotal) return null;
        return (
          <button 
            onClick={(e) => {
              e.stopPropagation();
              const type = activeTab === 'projectAttributes' ? 'project' : activeTab === 'costCodeAttributes' ? 'costCode' : activeTab === 'subcontractAttributes' ? 'subcontract' : activeTab === 'procurementAttributes' ? 'procurement' : activeTab === 'changeAttributes' ? 'change' : activeTab === 'riskAttributes' ? 'risk' : activeTab === 'progressAttributes' ? 'progress' : 'lineItem';
              deleteAttributeValue(type, selectedAttrId, params.data.id);
            }}
            className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        );
      }
    }
  ], [activeTab, selectedAttrId, enterprise]);

  const resourceRateColumnDefs = useMemo(() => [
    { 
      headerName: 'Resource ID', 
      field: 'id', 
      width: 150, 
      pinned: 'left',
      lockPosition: 'left',
      cellStyle: { fontWeight: 'bold' },
      editable: false 
    },
    { headerName: 'Resource Name', field: 'name', flex: 1, editable: true },
    { headerName: 'Category', field: 'category', width: 150, editable: true },
    { headerName: 'Unit', field: 'unit', width: 100, editable: true },
    {
      headerName: 'Rate ($)',
      field: 'rate',
      width: 120,
      type: 'numericColumn',
      editable: true,
      valueFormatter: (params: any) => params.value ? `$${params.value.toLocaleString()}` : '-'
    },
    { headerName: 'UDF 1', field: 'udf1', width: 120, editable: true },
    { headerName: 'UDF 2', field: 'udf2', width: 120, editable: true },
    { headerName: 'UDF 3', field: 'udf3', width: 120, editable: true },
    {
      headerName: '',
      width: 60,
      pinned: 'right',
      cellRenderer: (params: any) => {
        if (params.data.isSubtotal) return null;
        return (
          <div className="flex gap-1">
            <button 
              onClick={() => {
                setResourceFormData(params.data);
                setIsEditingResource({ id: params.data.id });
              }}
              className="p-1 text-gray-400 hover:text-black dark:hover:text-white"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setDeleteConfirm({ type: 'rate', id: params.data.id, name: params.data.name })}
              className="p-1 text-gray-400 hover:text-red-600"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      }
    }
  ], [activeMenuId]);

  const vendorColumnDefs = useMemo(() => [
    { headerName: 'Vendor ID', field: 'id', width: 150, editable: false },
    { headerName: 'Vendor Name', field: 'name', flex: 1, editable: true },
    { headerName: 'Contact Name', field: 'contactName', width: 150, editable: true },
    { headerName: 'Contact Email', field: 'contactEmail', width: 200, editable: true },
    {
      headerName: '',
      width: 100,
      pinned: 'right',
      cellRenderer: (params: any) => {
        if (params.data.isSubtotal) return null;
        return (
          <div className="flex gap-1">
            <button 
              onClick={() => {
                setVendorFormData(params.data);
                setIsEditingVendor({ id: params.data.id });
              }}
              className="p-1 text-gray-400 hover:text-black dark:hover:text-white"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setDeleteConfirm({ type: 'vendor', id: params.data.id, name: params.data.name })}
              className="p-1 text-gray-400 hover:text-red-600"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      }
    }
  ], []);

  const sortedAttrValues = useMemo(() => {
    const values = (activeTab === 'projectAttributes' ? projectAttributes : activeTab === 'costCodeAttributes' ? costCodeAttributes : activeTab === 'subcontractAttributes' ? subcontractAttributes : activeTab === 'procurementAttributes' ? procurementAttributes : activeTab === 'changeAttributes' ? changeAttributes : activeTab === 'riskAttributes' ? riskAttributes : activeTab === 'progressAttributes' ? progressAttributes : lineItemAttributes).find((a: any) => a.id === selectedAttrId)?.values || [];
    let result = [...values].filter(v => 
      v.description.toLowerCase().includes(valueSearch.toLowerCase()) ||
      v.id.toLowerCase().includes(valueSearch.toLowerCase())
    );

    // Apply column filters
    const filters = columnFilters[activeTab as keyof typeof columnFilters] || {};
    Object.entries(filters).forEach(([field, value]) => {
      if (value) {
        result = result.filter(v => {
          const val = (v as any)[field];
          return String(val || '').toLowerCase().includes(value.toLowerCase());
        });
      }
    });

    return result.sort((a: any, b: any) => {
      const aVal = a[attrSort.field];
      const bVal = b[attrSort.field];
      if (attrSort.direction === 'asc') return aVal > bVal ? 1 : -1;
      return aVal < bVal ? 1 : -1;
    });
  }, [selectedAttrId, projectAttributes, lineItemAttributes, costCodeAttributes, subcontractAttributes, changeAttributes, riskAttributes, progressAttributes, procurementAttributes, attrSort, activeTab, valueSearch, columnFilters.lineItemAttributes, columnFilters.projectAttributes, columnFilters.costCodeAttributes, columnFilters.subcontractAttributes, columnFilters.changeAttributes]);


  const updateAttributeTitle = async (type: 'project' | 'lineItem' | 'costCode' | 'subcontract' | 'procurement' | 'change' | 'risk' | 'progress', id: string, title: string) => {
    const field = type === 'project' ? 'projectAttributes' : type === 'costCode' ? 'costCodeAttributes' : type === 'subcontract' ? 'subcontractAttributes' : type === 'procurement' ? 'procurementAttributes' : type === 'change' ? 'changeAttributes' : type === 'risk' ? 'riskAttributes' : type === 'progress' ? 'progressAttributes' : 'lineItemAttributes';
    const currentAttrs = getAttributes(type);
    const newAttrs = currentAttrs.map(a => a.id === id ? { ...a, title } : a);
    
    // Check if the title actually changed to prevent purely redundant saves
    const currentAttr = currentAttrs.find(a => a.id === id);
    if (currentAttr && currentAttr.title === title) return;

    try {
      await updateDoc(doc(db, 'enterprises', enterprise.id), {
        [field]: newAttrs
      });
    } catch (e) {
      console.error(e);
      toast.error('Failed to update attribute title');
    }
  };

  const addAttributeValue = async (type: 'project' | 'lineItem' | 'costCode' | 'subcontract' | 'procurement' | 'change' | 'risk' | 'progress', attrId: string, value: ProjectAttributeValue) => {
    try {
      setIsSubmitting(true);
      const field = type === 'project' ? 'projectAttributes' : type === 'costCode' ? 'costCodeAttributes' : type === 'subcontract' ? 'subcontractAttributes' : type === 'procurement' ? 'procurementAttributes' : type === 'change' ? 'changeAttributes' : type === 'risk' ? 'riskAttributes' : type === 'progress' ? 'progressAttributes' : 'lineItemAttributes';
      const currentAttrs = getAttributes(type);
      const finalValue = {
        ...value,
        sortOrder: parseInt(value.sortOrder as any) || 0,
        description: value.description.trim() || 'Value Description'
      };
      const newAttrs = currentAttrs.map(a => {
        if (a.id === attrId) {
          const values = a.values || [];
          // Prevent duplicate ID
          if (values.some(v => v.id === value.id)) {
            alert(`Value ID "${value.id}" already exists for this attribute.`);
            return a;
          }
          return { ...a, values: [...values, finalValue] };
        }
        return a;
      });
      await updateDoc(doc(db, 'enterprises', enterprise.id), {
        [field]: newAttrs
      });
    } catch (error) {
      console.error('Failed to add attribute value', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateAttributeValue = async (type: 'project' | 'lineItem' | 'costCode' | 'subcontract' | 'procurement' | 'change' | 'risk' | 'progress', attrId: string, valueId: string, updates: Partial<ProjectAttributeValue>) => {
    const field = type === 'project' ? 'projectAttributes' : type === 'costCode' ? 'costCodeAttributes' : type === 'subcontract' ? 'subcontractAttributes' : type === 'procurement' ? 'procurementAttributes' : type === 'change' ? 'changeAttributes' : type === 'risk' ? 'riskAttributes' : type === 'progress' ? 'progressAttributes' : 'lineItemAttributes';
    const currentAttrs = getAttributes(type);
    const newAttrs = currentAttrs.map(a => {
      if (a.id === attrId) {
        return { 
          ...a, 
          values: (a.values || []).map(v => v.id === valueId ? { ...v, ...updates } : v) 
        };
      }
      return a;
    });
    await updateDoc(doc(db, 'enterprises', enterprise.id), {
      [field]: newAttrs
    });
  };

  const handleInlineUpdate = (valueId: string, field: 'description' | 'sortOrder', newValue: string) => {
    const type = activeTab === 'projectAttributes' ? 'project' : activeTab === 'costCodeAttributes' ? 'costCode' : activeTab === 'subcontractAttributes' ? 'subcontract' : activeTab === 'procurementAttributes' ? 'procurement' : activeTab === 'changeAttributes' ? 'change' : activeTab === 'riskAttributes' ? 'risk' : activeTab === 'progressAttributes' ? 'progress' : 'lineItem';
    const updates: Partial<ProjectAttributeValue> = {};
    if (field === 'sortOrder') {
      updates.sortOrder = Number(newValue);
    } else {
      updates.description = newValue;
    }
    updateAttributeValue(type, selectedAttrId, valueId, updates);
    setEditingValueId(null);
    setEditingField(null);
  };

  const handleExport = (type: 'project' | 'lineItem' | 'costCode' | 'resourceRates' | 'subcontract' | 'procurement' | 'change' | 'risk' | 'progress', attrId?: string) => {
    if (type === 'resourceRates') {
      const rates = enterprise.resourceRates || [];
      if (rates.length === 0) {
        alert('No resource rates to export.');
        return;
      }
      const data = rates.map(r => ({
        ID: r.id,
        Name: r.name,
        Category: r.category,
        Unit: r.unit,
        Rate: r.rate
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'ResourceRates');
      XLSX.writeFile(wb, `ResourceRates_${new Date().toISOString().split('T')[0]}.xlsx`);
      return;
    }

    const attrs = type === 'project' ? projectAttributes : type === 'costCode' ? costCodeAttributes : type === 'subcontract' ? subcontractAttributes : type === 'procurement' ? procurementAttributes : type === 'change' ? changeAttributes : type === 'risk' ? riskAttributes : type === 'progress' ? progressAttributes : lineItemAttributes;
    const attr = attrs.find(a => a.id === attrId);
    if (!attr || !attr.values || attr.values.length === 0) {
      alert('No values to export.');
      return;
    }

    const data = attr.values.map(v => ({
      ID: v.id,
      Description: v.description,
      'Sort Order': v.sortOrder
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Values');
    XLSX.writeFile(wb, `${type === 'project' ? 'Project' : type === 'costCode' ? 'CostCode' : type === 'subcontract' ? 'Subcontract' : type === 'change' ? 'Change' : 'LineItem'}_Attr_${attrId}_${attr.title || 'Untitled'}.xlsx`);
  };

  const handleImport = async (type: 'users' | 'projects' | 'lineItemAttributes' | 'costCodeAttributes' | 'projectAttributes' | 'subcontractAttributes' | 'procurementAttributes' | 'changeAttributes' | 'riskAttributes' | 'resourceRates', file: File, attrId?: string) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      setImportPreview({ type, data: jsonData, attrId });
    };
    reader.readAsArrayBuffer(file);
  };

  const completeImport = async () => {
    if (!importPreview) return;
    const { type, data, attrId } = importPreview;

    if ((type === 'lineItemAttributes' || type === 'costCodeAttributes' || type === 'projectAttributes' || type === 'subcontractAttributes' || type === 'procurementAttributes' || type === 'changeAttributes' || type === 'riskAttributes' || type === 'progressAttributes') && attrId) {
      const attrType = type === 'projectAttributes' ? 'project' : type === 'costCodeAttributes' ? 'costCode' : type === 'subcontractAttributes' ? 'subcontract' : type === 'procurementAttributes' ? 'procurement' : type === 'changeAttributes' ? 'change' : type === 'riskAttributes' ? 'risk' : type === 'progressAttributes' ? 'progress' : 'lineItem';
      const currentAttrs = getAttributes(attrType);
      
      const newAttrs = currentAttrs.map(a => {
        if (a.id === attrId) {
          const values = [...(a.values || [])];
          data.forEach(row => {
            const id = row.ID?.toString() || row.id?.toString();
            const description = row.Description?.toString() || row.description?.toString() || '';
            const sortOrder = parseInt(row['Sort Order'] || row.sortOrder) || (values.length + 1);
            if (!id) return;
            const existingIndex = values.findIndex(v => v.id === id);
            if (existingIndex > -1) {
              values[existingIndex] = { ...values[existingIndex], description, sortOrder };
            } else {
              values.push({ id, description, sortOrder });
            }
          });
          return { ...a, values };
        }
        return a;
      });
      await updateDoc(doc(db, 'enterprises', enterprise.id), { [type]: newAttrs });
    } else if (type === 'resourceRates') {
      const currentResources = [...(enterprise.resourceRates || [])];
      data.forEach(row => {
        const id = row.ID?.toString() || row.id?.toString();
        const name = row.Name?.toString() || row.name?.toString() || '';
        const category = row.Category?.toString() || row.category?.toString() || '';
        const unit = row.Unit?.toString() || row.unit?.toString() || '';
        const rate = parseFloat(row.Rate || row.rate) || 0;
        if (!id) return;
        const existingIndex = currentResources.findIndex(r => r.id === id);
        if (existingIndex > -1) {
          currentResources[existingIndex] = { ...currentResources[existingIndex], name, category, unit, rate };
        } else {
          currentResources.push({ id, name, category, unit, rate });
        }
      });
      await updateDoc(doc(db, 'enterprises', enterprise.id), { resourceRates: currentResources });
    } else if (type === 'users') {
      const currentUsers = { ...(enterprise.users || {}) };
      data.forEach(row => {
        const email = row.Email?.toString() || row.email?.toString();
        if (!email) return;
        const name = row.Name?.toString() || row.name?.toString() || row.DisplayName?.toString() || row.displayName?.toString() || '';
        const role = row.Role?.toString() || row.role?.toString() || 'Enterprise User';
        
        // Find existing user by email
        const existingUid = Object.keys(currentUsers).find(uid => currentUsers[uid].email.toLowerCase() === email.toLowerCase());
        if (existingUid) {
          currentUsers[existingUid] = { ...currentUsers[existingUid], displayName: name || currentUsers[existingUid].displayName, role };
        } else {
          // For new users via import, we can't create a real Firebase Auth user here easily, 
          // but we can add them to the enterprise users map. 
          // They'll need to sign up with that email to gain access.
          const tempUid = `imported_${Math.random().toString(36).substring(2, 9)}`;
          currentUsers[tempUid] = { email, displayName: name, role, joinedAt: new Date().toISOString() };
        }
      });
      await updateDoc(doc(db, 'enterprises', enterprise.id), { users: currentUsers });
    } else if (type === 'projects') {
      const activeAttrs = (enterprise.projectAttributes || []).filter(attr => attr.title);
      const batch = writeBatch(db);

      for (const row of data) {
        const code = row.Code?.toString() || row.code?.toString() || row.ProjectCode?.toString() || row.projectCode?.toString() || row['Project ID']?.toString();
        const name = row.Name?.toString() || row.name?.toString() || row.ProjectName?.toString() || row.projectName?.toString() || row['Project Name']?.toString() || '';
        if (!code) continue;

        const existingProject = projects.find(p => p.projectCode === code);
        const updates: any = {};
        if (name) updates.projectName = name;
        
        // Attributes
        const newAttributes: any = existingProject?.attributes ? { ...existingProject.attributes } : {};
        activeAttrs.forEach(attr => {
          if (row[attr.title] !== undefined) {
            newAttributes[attr.id] = row[attr.title].toString();
          }
        });
        updates.attributes = newAttributes;

        if (existingProject) {
          updates.dateLastModified = new Date().toISOString();
          batch.update(doc(db, 'projects', existingProject.id), updates);
        } else {
          const newProjRef = doc(collection(db, 'projects'));
          batch.set(newProjRef, {
            enterpriseId: enterprise.id,
            projectCode: code,
            projectName: name,
            attributes: newAttributes,
            dateCreated: new Date().toISOString(),
            dateLastModified: new Date().toISOString(),
            users: { [auth.currentUser?.uid || '']: 'Project Admin' },
            sheets: []
          });
        }
      }
      await batch.commit();
    } else if (type === 'vendors') {
      const currentVendors = [...(enterprise.vendors || [])];
      data.forEach(row => {
        const id = (row['Vendor ID'] || row.id || row.ID || row.Code || row.code)?.toString();
        const name = (row['Vendor Name'] || row.name || row.Name)?.toString() || '';
        const code = (row.Code || row.code || row['Vendor ID'] || row.id || row.ID)?.toString() || '';
        const contactName = (row['Contact Name'] || row.contactName || row.ContactName)?.toString() || '';
        const contactEmail = (row['Contact Email'] || row.contactEmail || row.ContactEmail)?.toString() || '';
        
        if (!id) return;
        
        const existingIndex = currentVendors.findIndex(v => v.id === id);
        if (existingIndex > -1) {
          currentVendors[existingIndex] = { id, name, code, contactName, contactEmail };
        } else {
          currentVendors.push({ id, name, code, contactName, contactEmail });
        }
      });
      await updateDoc(doc(db, 'enterprises', enterprise.id), { vendors: currentVendors });
    }

    setImportPreview(null);
    setShowImportSuccessModal(true);
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enterprise || !newProjectData.code.trim()) return;

    const codeExists = projects.some(p => p.projectCode === newProjectData.code);
    if (codeExists) {
      alert('This Project Code already exists!');
      return;
    }

    try {
      setIsSubmitting(true);
      const now = new Date().toISOString();
      const finalName = newProjectData.name.trim() || 'Project Name';
      const user = auth.currentUser;
      await addDoc(collection(db, 'projects'), {
        enterpriseId: enterprise.id,
        projectName: finalName,
        projectCode: newProjectData.code,
        projectBudget: 0,
        startDate: now.split('T')[0],
        endDate: now.split('T')[0],
        cutoffDate: now.split('T')[0],
        users: { [user?.uid || '']: 'Project Admin' },
        dateCreated: now,
        dateLastModified: now,
        createdBy: user?.uid || '',
        createdByEmail: user?.email || '',
        modifiedBy: user?.uid || '',
        modifiedByEmail: user?.email || '',
        sheets: [],
        status: 'Active'
      });
      setIsCreateProjectModalOpen(false);
      setNewProjectData({ name: '', code: '' });
    } catch (error) {
      console.error('Failed to create project', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addResourceRate = async (resource: any, index?: number) => {
    try {
      setIsSubmitting(true);
      const currentResources = [...(enterprise.resourceRates || [])];
      if (currentResources.some(r => r.id === resource.id)) {
        alert(`Resource ID "${resource.id}" already exists.`);
        setIsSubmitting(false);
        return;
      }
      const finalResource = {
        ...resource,
        name: resource.name.trim() || 'Resource Name'
      };
      
      if (typeof index === 'number') {
        currentResources.splice(index, 0, finalResource);
      } else {
        currentResources.push(finalResource);
      }

      await updateDoc(doc(db, 'enterprises', enterprise.id), {
        resourceRates: currentResources
      });
    } catch (error) {
      console.error('Failed to add resource rate', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateResourceRate = async (id: string, updates: any) => {
    const currentResources = enterprise.resourceRates || [];
    const newResources = currentResources.map(r => r.id === id ? { ...r, ...updates } : r);
    await updateDoc(doc(db, 'enterprises', enterprise.id), {
      resourceRates: newResources
    });
  };

  const updateVendor = async (id: string, updates: any) => {
    const currentVendors = enterprise.vendors || [];
    const newVendors = currentVendors.map(v => v.id === id ? { ...v, ...updates } : v);
    await updateDoc(doc(db, 'enterprises', enterprise.id), {
      vendors: newVendors
    });
  };

  const deleteResourceRate = async (id: string) => {
    const currentResources = enterprise.resourceRates || [];
    const newResources = currentResources.filter(r => r.id !== id);
    await updateDoc(doc(db, 'enterprises', enterprise.id), {
      resourceRates: newResources
    });
  };

  const { duplicateIds, hasImportDuplicates, systemDuplicateIds } = useMemo(() => {
    if (!importPreview) return { duplicateIds: [], hasImportDuplicates: false, systemDuplicateIds: [] };
    
    const idsInFile = new Set<string>();
    const fileDuplicates = new Set<string>();
    const sysDuplicates = new Set<string>();
    
    const currentVendors = enterprise.vendors || [];

    importPreview.data.forEach(row => {
      let id: string | undefined;
      
      if (importPreview.type === 'users') {
        id = row.Email?.toString() || row.email?.toString();
      } else if (importPreview.type === 'projects') {
        id = row.Code?.toString() || row.code?.toString() || row.ProjectCode?.toString() || row.projectCode?.toString() || row['Project ID']?.toString();
      } else if (importPreview.type === 'vendors') {
        id = (row['Vendor ID'] || row.id || row.ID || row.Code || row.code)?.toString();
        if (id && currentVendors.some(v => v.id === id)) {
          sysDuplicates.add(id.toString().trim());
        }
      } else {
        // Line items, cost codes, etc. usually use ID or id
        id = row.ID?.toString() || row.id?.toString();
        
        // Fallback for common ID fields if the standard ones aren't found
        if (!id) {
          const commonIdFields = ['Code', 'code', 'Project ID', 'ProjectCode', 'Identifier'];
          for (const field of commonIdFields) {
            if (row[field]) {
              id = row[field].toString();
              break;
            }
          }
        }
      }
      
      if (id) {
        const normalizedId = id.toString().trim().toLowerCase();
        if (idsInFile.has(normalizedId)) {
          fileDuplicates.add(id.toString().trim());
        }
        idsInFile.add(normalizedId);
      }
    });

    const duplicateList = Array.from(fileDuplicates);
    const systemDuplicateList = Array.from(sysDuplicates);
    return { 
      duplicateIds: duplicateList, 
      systemDuplicateIds: systemDuplicateList,
      hasImportDuplicates: duplicateList.length > 0 || (importPreview.type === 'vendors' && systemDuplicateList.length > 0)
    };
  }, [importPreview, enterprise.vendors]);

  return (
    <div className="flex h-full bg-gray-50 dark:bg-[#0a0a0a] overflow-hidden transition-colors duration-300">
      <div className={`${isSidebarOpen ? 'w-72' : 'w-16'} bg-white dark:bg-[#141414] border-r border-gray-200 dark:border-white/10 flex flex-col h-full shrink-0 transition-all duration-300`}>
        <div className="p-6 border-b border-gray-200 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black dark:bg-white rounded-xl flex items-center justify-center shadow-lg shadow-black/10 dark:shadow-white/10">
              <Settings className="w-6 h-6 text-white dark:text-black" />
            </div>
            {isSidebarOpen && (
              <div className="min-w-0">
                <h2 className="text-sm font-bold dark:text-white truncate">Enterprise Admin</h2>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Organization Console</p>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 space-y-4 custom-scrollbar">
          <div className="px-4 space-y-2">
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
                isSidebarOpen ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "bg-transparent text-emerald-500"
              )}>
                {isSidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </div>
            </button>

            {isSidebarOpen && (
              <div className="flex items-center gap-1 px-1">
                <button 
                  onClick={() => setExpandedSections(new Set(adminSections.map(s => s.title)))}
                  className="flex-1 py-1.5 text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 rounded-md transition-all border border-transparent hover:border-gray-200 dark:hover:border-white/10"
                >
                  Expand All
                </button>
                <button 
                  onClick={() => setExpandedSections(new Set())}
                  className="flex-1 py-1.5 text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 rounded-md transition-all border border-transparent hover:border-gray-200 dark:hover:border-white/10"
                >
                  Collapse All
                </button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {adminSections.map(section => (
              <div key={section.title} className="space-y-1">
                {isSidebarOpen && (
                  <button 
                    onClick={() => toggleSection(section.title)}
                    className={cn(
                      "w-full flex items-center justify-between px-5 py-3 text-[10px] font-black uppercase tracking-[0.15em] transition-all",
                      expandedSections.has(section.title)
                        ? "bg-slate-900 text-white dark:bg-white dark:text-black sticky top-0 z-10 shadow-lg shadow-black/10 dark:shadow-white/5"
                        : "bg-slate-800 text-slate-100 dark:bg-zinc-900 dark:text-slate-400 hover:bg-slate-700 dark:hover:bg-zinc-800 border-y border-white/5"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {section.icon}
                      {section.title}
                    </span>
                    <ChevronRight className={cn("w-3 h-3 transition-transform", expandedSections.has(section.title) && "rotate-90")} />
                  </button>
                )}
                
                <AnimatePresence initial={false}>
                  {(expandedSections.has(section.title) || !isSidebarOpen) && (
                    <motion.div 
                      initial={isSidebarOpen ? { height: 0, opacity: 0 } : undefined}
                      animate={isSidebarOpen ? { height: 'auto', opacity: 1 } : undefined}
                      exit={isSidebarOpen ? { height: 0, opacity: 0 } : undefined}
                      className={cn(
                        "space-y-1 px-4",
                        isSidebarOpen && expandedSections.has(section.title) && "py-2 bg-gray-50/50 dark:bg-white/[0.02]"
                      )}
                    >
                    {section.items.map(item => (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
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
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
          </div>
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!isSidebarOpen && (
          <div className="p-4 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-[#141414] flex items-center gap-4 shrink-0 lg:hidden">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors text-gray-500 dark:text-gray-400"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-bold dark:text-white">
              {adminSections.flatMap(s => s.items).find(i => i.id === activeTab)?.label || 'Administration'}
            </h2>
          </div>
        )}
        
        <div className="flex-1 flex flex-col min-h-0 p-8 overflow-hidden">
          <AnimatePresence mode="wait">
            {activeTab === 'enterpriseSettings' && (
              <motion.div 
                key="enterpriseSettings"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex-1 overflow-auto space-y-8 pr-2"
              >
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <Card className="lg:col-span-2">
                    <CardHeader>
                      <CardTitle>Enterprise Profile</CardTitle>
                      <CardDescription>Manage your organization's core identity and branding.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Enterprise Name</label>
                          <Input 
                            defaultValue={enterprise.name}
                            onBlur={(e) => handleUpdateEnterprise({ name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Primary Domain</label>
                          <Input 
                            placeholder="company.com"
                            defaultValue={(enterprise as any).domain}
                            onBlur={(e) => handleUpdateEnterprise({ domain: e.target.value } as any)}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Enterprise Logo</label>
                        <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-white/5 border border-dashed border-gray-200 dark:border-white/10 rounded-xl">
                          {enterprise.logoURL ? (
                            <img src={enterprise.logoURL} className="w-16 h-16 object-contain bg-white rounded-lg border border-gray-100" alt="Logo" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-16 h-16 bg-white dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/10 flex items-center justify-center text-gray-300">
                              <Building2 className="w-8 h-8" />
                            </div>
                          )}
                          <div className="flex-1">
                            <p className="text-xs text-gray-500 mb-2">Recommended size: 512x512px. PNG or SVG preferred.</p>
                            <Button variant="outline" size="sm" onClick={() => enterpriseLogoInputRef.current?.click()}>
                              Change Logo
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>System Status</CardTitle>
                      <CardDescription>Current enterprise health and usage metrics.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between p-3 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg">
                        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">System Status</span>
                        <Badge variant="outline" className="bg-emerald-500 text-white border-none">Operational</Badge>
                      </div>
                      <div className="space-y-3">
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500">Total Projects</span>
                          <span className="font-bold">{projects.length}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500">Active Users</span>
                          <span className="font-bold">{Object.keys(enterprise.users || {}).length}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500">Storage Used</span>
                          <span className="font-bold">12.4 GB</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </motion.div>
            )}

            {activeTab === 'users' && (
              <motion.div 
                key="users"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex-1 flex flex-col min-h-0"
              >
                <DataGridModule
                  title="Enterprise Users"
                  description="Manage users and their access levels within the enterprise."
                  onAdd={() => setInviteModal(true)}
                  gridRef={usersGridRef}
                  searchPlaceholder="Search users..."
                  quickFilterText={userSearch}
                  onQuickFilterChange={setUserSearch}
                  rowData={filteredUsers}
                  columnDefs={userColumnDefs}
                  theme={document.documentElement.classList.contains('dark') ? 'dark' : 'light'}
                  onCellValueChanged={async (event) => {
                    const { data, colDef, newValue } = event;
                    if (!data.uid) return;
                    await updateDoc(doc(db, 'enterprises', enterprise.id), {
                      [`users.${data.uid}.${colDef.field}`]: newValue
                    });
                  }}
                  gridProps={{
                    rowSelection: 'multiple',
                    onSelectionChanged: (params: any) => {
                      const selectedNodes = params.api.getSelectedNodes();
                      setSelectedUserIds(new Set(selectedNodes.map((node: any) => node.data.uid)));
                    }
                  }}
                  selectedCount={selectedUserIds.size}
                  onBulkDelete={() => setDeleteConfirm({ type: 'user', count: selectedUserIds.size })}
                />
              </motion.div>
            )}

          {activeTab === 'projects' && (
            <motion.div 
              key="projects"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col min-h-0"
            >
              <DataGridModule
                title="Enterprise Projects"
                description="Manage projects and their settings within the enterprise."
                onAdd={() => setIsCreateProjectModalOpen(true)}
                gridRef={projectsGridRef}
                extraToolbarActions={
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      onClick={exportProjectImportTemplate} 
                      className="text-xs font-bold gap-2 px-3 h-9 dark:border-white/10 dark:text-white"
                    >
                      <Download className="w-4 h-4" /> Import Template
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.xlsx,.xls';
                        input.onchange = (e: any) => {
                          const file = e.target.files?.[0];
                          if (file) handleBulkUpdateProjectsImport(file);
                        };
                        input.click();
                      }} 
                      className="text-xs font-bold gap-2 px-3 h-9 dark:border-white/10 dark:text-white"
                    >
                      <Upload className="w-4 h-4" /> Bulk Update (Import)
                    </Button>
                  </div>
                }
                searchPlaceholder="Search projects..."
                quickFilterText={projectSearch}
                onQuickFilterChange={setProjectSearch}
                rowData={sortedProjects}
                columnDefs={projectColumnDefs}
                theme={document.documentElement.classList.contains('dark') ? 'dark' : 'light'}
                onCellValueChanged={async (event) => {
                  const { data, colDef, newValue } = event;
                  if (!data.id) return;
                  await updateDoc(doc(db, 'projects', data.id), {
                    [colDef.field!]: newValue,
                    dateLastModified: new Date().toISOString()
                  });
                }}
                gridProps={{
                  rowSelection: 'multiple',
                  onSelectionChanged: (params: any) => {
                    const selectedNodes = params.api.getSelectedNodes();
                    setSelectedProjectIds(new Set(selectedNodes.map((node: any) => node.data.id)));
                  }
                }}
                selectedCount={selectedProjectIds.size}
                onBulkUpdate={() => {
                  setIsBulkUpdateModalOpen({ type: 'project', count: selectedProjectIds.size });
                }}
                onBulkDelete={() => setDeleteConfirm({ type: 'bulk-project', count: selectedProjectIds.size })}
              />
            </motion.div>
          )}

          {activeTab === 'procurementSteps' && (
            <motion.div 
              key="procurementSteps"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col min-h-0"
            >
              <EnterpriseProcurementSteps enterpriseId={enterprise.id} />
            </motion.div>
          )}

          {(activeTab === 'projectAttributes' || activeTab === 'lineItemAttributes' || activeTab === 'costCodeAttributes' || activeTab === 'subcontractAttributes' || activeTab === 'procurementAttributes' || activeTab === 'changeAttributes' || activeTab === 'riskAttributes' || activeTab === 'progressAttributes') && (
            <motion.div 
              key="attributes"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex gap-8 min-h-0"
            >
              {/* Left Sidebar: 10 Static Rows */}
              <div className="w-80 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl flex flex-col overflow-hidden">
                <div className="p-4 border-b border-gray-100 dark:border-white/10">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
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
                      {(activeTab === 'projectAttributes' ? projectAttributes : activeTab === 'costCodeAttributes' ? costCodeAttributes : activeTab === 'subcontractAttributes' ? subcontractAttributes : activeTab === 'procurementAttributes' ? procurementAttributes : activeTab === 'changeAttributes' ? changeAttributes : activeTab === 'riskAttributes' ? riskAttributes : activeTab === 'progressAttributes' ? progressAttributes : lineItemAttributes).filter((a: any) => a.title.toLowerCase().includes(attrSearch.toLowerCase()) || a.id.includes(attrSearch)).map((attr: any) => (
                        <tr 
                          key={attr.id}
                          onClick={() => setSelectedAttrId(attr.id)}
                          className={`cursor-pointer transition-colors ${selectedAttrId === attr.id ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/5'}`}
                        >
                          <td className="p-2 text-xs font-bold text-black dark:text-white text-center">{attr.id}</td>
                          <td className="p-2">
                            <AttributeTitleInput 
                              attr={attr} 
                              type={activeTab === 'projectAttributes' ? 'project' : activeTab === 'costCodeAttributes' ? 'costCode' : activeTab === 'subcontractAttributes' ? 'subcontract' : activeTab === 'procurementAttributes' ? 'procurement' : activeTab === 'changeAttributes' ? 'change' : activeTab === 'riskAttributes' ? 'risk' : activeTab === 'progressAttributes' ? 'progress' : 'lineItem'} 
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
              <div className="flex-1 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl flex flex-col overflow-hidden">
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
                        title={`Attribute ${selectedAttrId}: ${(activeTab === 'projectAttributes' ? projectAttributes : activeTab === 'costCodeAttributes' ? costCodeAttributes : activeTab === 'subcontractAttributes' ? subcontractAttributes : activeTab === 'procurementAttributes' ? procurementAttributes : activeTab === 'changeAttributes' ? changeAttributes : activeTab === 'riskAttributes' ? riskAttributes : activeTab === 'progressAttributes' ? progressAttributes : lineItemAttributes).find((a: any) => a.id === selectedAttrId)?.title || 'Untitled'}`}
                        description="Manage the list of allowed values for this attribute."
                        gridRef={attrValueGridRef}
                        onAdd={() => {
                          const currentAttr = (activeTab === 'projectAttributes' ? projectAttributes : activeTab === 'costCodeAttributes' ? costCodeAttributes : activeTab === 'subcontractAttributes' ? subcontractAttributes : activeTab === 'procurementAttributes' ? procurementAttributes : activeTab === 'changeAttributes' ? changeAttributes : activeTab === 'riskAttributes' ? riskAttributes : activeTab === 'progressAttributes' ? progressAttributes : lineItemAttributes).find((a: any) => a.id === selectedAttrId);
                          setValueFormData({ id: '', description: '', sortOrder: (currentAttr?.values?.length || 0) + 1 });
                          setIsEditingValue({ type: activeTab === 'projectAttributes' ? 'project' : activeTab === 'costCodeAttributes' ? 'costCode' : activeTab === 'subcontractAttributes' ? 'subcontract' : activeTab === 'procurementAttributes' ? 'procurement' : activeTab === 'changeAttributes' ? 'change' : activeTab === 'riskAttributes' ? 'risk' : activeTab === 'progressAttributes' ? 'progress' : 'lineItem', attrId: selectedAttrId, valueId: null });
                        }}
                        onImport={() => {
                          const type = activeTab === 'projectAttributes' ? 'projectAttributes' : activeTab === 'costCodeAttributes' ? 'costCodeAttributes' : activeTab === 'subcontractAttributes' ? 'subcontractAttributes' : activeTab === 'procurementAttributes' ? 'procurementAttributes' : activeTab === 'changeAttributes' ? 'changeAttributes' : activeTab === 'riskAttributes' ? 'riskAttributes' : activeTab === 'progressAttributes' ? 'progressAttributes' : 'lineItemAttributes';
                          fileInputRef.current?.click();
                          // Override the onchange for this specific context
                          if (fileInputRef.current) {
                            fileInputRef.current.onchange = (e: any) => {
                              const file = e.target.files?.[0];
                              if (file) handleImport(type as any, file, selectedAttrId);
                              e.target.value = ''; // Reset for same file re-selection
                            };
                          }
                        }}
                        searchPlaceholder="Search values..."
                        quickFilterText={valueSearch}
                        onQuickFilterChange={setValueSearch}
                        rowData={sortedAttrValues}
                        columnDefs={attributeValueColumnDefs}
                        theme={document.documentElement.classList.contains('dark') ? 'dark' : 'light'}
                        onCellValueChanged={(event) => {
                          const { data, colDef, newValue } = event;
                          if (!data.id) return;
                          handleInlineUpdate(data.id, colDef.field as any, newValue);
                        }}
                        gridProps={{
                          rowSelection: 'multiple',
                          onSelectionChanged: (params: any) => {
                            const selectedNodes = params.api.getSelectedNodes();
                            setSelectedAttrValueIds(new Set(selectedNodes.map((node: any) => node.data.id)));
                          }
                        }}
                        selectedCount={selectedAttrValueIds.size}
                        onBulkDelete={() => setDeleteConfirm({ type: 'bulk-attr-value', count: selectedAttrValueIds.size })}
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
            </motion.div>
          )}
        {activeTab === 'resourceRates' && (
            <motion.div 
              key="resourceRates"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col min-h-0"
            >
              <DataGridModule
                title="Resource Rates"
                description="Manage global resource rates and unit costs."
                onAdd={() => {
                  setResourceFormData({ id: '', name: '', unit: '', rate: 0, category: '', udf1: '', udf2: '', udf3: '' });
                  setIsEditingResource({ id: null });
                }}
                gridRef={resourceRatesGridRef}
                searchPlaceholder="Search resources..."
                quickFilterText={resourceSearch}
                onQuickFilterChange={setResourceSearch}
                rowData={enterprise.resourceRates || []}
                columnDefs={resourceRateColumnDefs}
                theme={document.documentElement.classList.contains('dark') ? 'dark' : 'light'}
                onCellValueChanged={(event) => {
                  const { data, colDef, newValue } = event;
                  if (!data.id) return;
                  updateResourceRate(data.id, { [colDef.field!]: newValue });
                }}
                gridProps={{
                  rowSelection: 'multiple',
                  onSelectionChanged: (params: any) => {
                    const selectedNodes = params.api.getSelectedNodes();
                    setSelectedRateIds(new Set(selectedNodes.map((node: any) => node.data.id)));
                  }
                }}
                selectedCount={selectedRateIds.size}
                onBulkUpdate={() => {
                  setIsBulkUpdateModalOpen({ type: 'rate', count: selectedRateIds.size });
                }}
                onBulkDelete={() => setDeleteConfirm({ type: 'bulk-rate', count: selectedRateIds.size })}
              />
            </motion.div>
          )}

          {activeTab === 'enterpriseCalendars' && (
            <motion.div 
              key="enterpriseCalendars"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden"
            >
              <CalendarManager 
                enterpriseId={enterprise.id} 
                title="Enterprise Calendars"
                description="Manage standard calendars that can be inherited by projects."
              />
            </motion.div>
          )}

          {activeTab === 'vendors' && (
            <motion.div 
              key="vendors"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col min-h-0"
            >
              <DataGridModule
                title="Vendors"
                description="Manage enterprise vendors and contact information."
                onAdd={() => {
                  setVendorFormData({ id: '', name: '', code: '', contactEmail: '', contactName: '' });
                  setIsEditingVendor({ id: null });
                }}
                gridRef={vendorsGridRef}
                onImportData={(data) => {
                  const currentVendors = [...(enterprise.vendors || [])];
                  data.forEach(row => {
                    const id = (row['Vendor ID'] || row.id || row.ID || row.Code || row.code)?.toString();
                    const name = (row['Vendor Name'] || row.name || row.Name)?.toString() || '';
                    if (!id || !name) return;
                    
                    const existingIndex = currentVendors.findIndex(v => v.id.toLowerCase() === id.toLowerCase());
                    const vendorData = {
                      id,
                      name,
                      contactName: (row['Contact Name'] || row.contactName || '')?.toString(),
                      contactEmail: (row['Contact Email'] || row.contactEmail || '')?.toString(),
                    };
                    
                    if (existingIndex > -1) {
                      currentVendors[existingIndex] = { ...currentVendors[existingIndex], ...vendorData };
                    } else {
                      currentVendors.push(vendorData);
                    }
                  });
                  updateDoc(doc(db, 'enterprises', enterprise.id), { vendors: currentVendors });
                  toast.success(`Imported ${data.length} vendors`);
                }}
                onQuickFilterChange={setVendorSearch}
                quickFilterText={vendorSearch}
                rowData={enterprise.vendors || []}
                selectedCount={selectedVendorIds.size}
                onCellValueChanged={(event) => {
                  const { data, colDef, newValue } = event;
                  if (!data.id) return;
                  const newVendors = (enterprise.vendors || []).map(v => v.id === data.id ? { ...v, [colDef.field!]: newValue } : v);
                  updateDoc(doc(db, 'enterprises', enterprise.id), { vendors: newVendors });
                }}
                onBulkUpdate={() => {
                  setIsBulkUpdateModalOpen({ type: 'vendor', count: selectedVendorIds.size });
                }}
                onBulkDelete={() => setDeleteConfirm({ type: 'bulk-vendor', count: selectedVendorIds.size })}
                columnDefs={vendorColumnDefs}
                gridProps={{
                  rowSelection: 'multiple',
                  onSelectionChanged: (params: any) => {
                    const selectedNodes = params.api.getSelectedNodes();
                    setSelectedVendorIds(new Set(selectedNodes.map((node: any) => node.data.id)));
                  }
                }}
              />
            </motion.div>
          )}

          </AnimatePresence>
        </div>
      </div>

      {/* Side Detail Panel */}
        <AnimatePresence>
          {(selectedUserId || selectedProjectId) && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="w-full lg:w-96 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-xl"
            >
            {/* Panel Header */}
            <div className="p-6 border-b border-gray-100 dark:border-white/10 flex justify-between items-start">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center border border-gray-200 dark:border-white/10 overflow-hidden">
                  {selectedUser ? (
                    selectedUser.photoURL ? <img src={selectedUser.photoURL} alt="" /> : <Users className="w-6 h-6 text-gray-400" />
                  ) : (
                    selectedProject?.photoURL ? <img src={selectedProject.photoURL} alt="" /> : <Briefcase className="w-6 h-6 text-gray-400" />
                  )}
                </div>
                <div>
                  <h3 className="font-bold dark:text-white">{selectedUser ? (selectedUser.displayName || selectedUser.email.split('@')[0]) : selectedProject?.projectName}</h3>
                  <p className="text-xs text-gray-400">{selectedUser ? selectedUser.email : selectedProject?.projectCode}</p>
                </div>
              </div>
              <button 
                onClick={() => { setSelectedUserId(null); setSelectedProjectId(null); }}
                className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors text-gray-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Panel Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {selectedUserId && selectedUser && (
                <div className="space-y-6">
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4">Project Assignments</h4>
                    <div className="space-y-2">
                      {projects.map(project => {
                        const userRole = project.users[selectedUserId];
                        return (
                          <div key={project.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/5">
                            <div className="flex-1 min-w-0 mr-4">
                              <p className="text-sm font-bold dark:text-white truncate">{project.projectName}</p>
                              <p className="text-[10px] text-gray-400 font-mono">{project.projectCode}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {userRole ? (
                                <>
                                  <select 
                                    value={userRole}
                                    onChange={(e) => updateProjectRole(project.id, selectedUserId, e.target.value as any)}
                                    className="text-[10px] font-bold uppercase tracking-widest bg-transparent border-none focus:ring-0 text-blue-600 dark:text-blue-400"
                                  >
                                    <option value="Project User">User</option>
                                    <option value="Project Admin">Admin</option>
                                  </select>
                                  <button 
                                    onClick={() => toggleProjectAccess(project.id, selectedUserId, userRole)}
                                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              ) : (
                                <button 
                                  onClick={() => toggleProjectAccess(project.id, selectedUserId)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-black dark:bg-white text-white dark:text-black rounded-lg text-[10px] font-bold uppercase tracking-widest hover:scale-105 transition-transform"
                                >
                                  <UserPlus className="w-3 h-3" />
                                  Add
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {selectedProjectId && selectedProject && (
                <div className="space-y-6">
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4">Project Settings</h4>
                    <div className="space-y-4 bg-gray-50 dark:bg-white/5 p-4 rounded-xl border border-gray-100 dark:border-white/5">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Project ID</label>
                          <button 
                            onClick={() => {
                              setProjectToReplace(selectedProject);
                              setNewProjectCode('');
                              setReplaceError('');
                              setIsReplaceIdModalOpen(true);
                            }}
                            className="text-[10px] font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1"
                          >
                            <RefreshCw className="w-3 h-3" />
                            Replace
                          </button>
                        </div>
                        <p className="text-xs font-mono dark:text-white">{selectedProject.projectCode}</p>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">Status</label>
                        <select 
                          value={selectedProject.status || 'Active'}
                          onChange={(e) => handleUpdateProjectStatus(selectedProject.id, e.target.value)}
                          className="w-full text-xs bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1.5 dark:text-white outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="Active">Active</option>
                          <option value="On Hold">On Hold</option>
                          <option value="Closed">Closed</option>
                          <option value="Archived">Archived</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4">Assigned Users</h4>
                    <div className="space-y-2">
                      {Object.entries(enterprise.users || {}).map(([uid, data]) => {
                        const userRole = selectedProject.users[uid];
                        return (
                          <div key={uid} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/5">
                            <div className="flex-1 min-w-0 mr-4">
                              <p className="text-sm font-bold dark:text-white truncate">{data.displayName || data.email.split('@')[0]}</p>
                              <p className="text-[10px] text-gray-400">{data.email}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {userRole ? (
                                <>
                                  <select 
                                    value={userRole}
                                    onChange={(e) => updateProjectRole(selectedProjectId, uid, e.target.value as any)}
                                    className="text-[10px] font-bold uppercase tracking-widest bg-transparent border-none focus:ring-0 text-blue-600 dark:text-blue-400"
                                  >
                                    <option value="Project User">User</option>
                                    <option value="Project Admin">Admin</option>
                                  </select>
                                  <button 
                                    onClick={() => toggleProjectAccess(selectedProjectId, uid, userRole)}
                                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              ) : (
                                <button 
                                  onClick={() => toggleProjectAccess(selectedProjectId, uid)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-black dark:bg-white text-white dark:text-black rounded-lg text-[10px] font-bold uppercase tracking-widest hover:scale-105 transition-transform"
                                >
                                  <UserPlus className="w-3 h-3" />
                                  Add
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isReplaceIdModalOpen && projectToReplace && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-[#1a1a1a] w-full max-w-md rounded-2xl shadow-2xl border border-gray-200 dark:border-white/10 overflow-hidden"
            >
            <div className="p-6 border-b border-gray-200 dark:border-white/10">
              <h3 className="text-xl font-bold dark:text-white flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-blue-600" />
                Replace Project ID
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Updating identifier for <span className="font-bold text-gray-900 dark:text-white">{projectToReplace.projectName}</span>.
              </p>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Current ID</label>
                <div className="p-3 bg-gray-100 dark:bg-white/5 rounded-xl text-sm font-mono text-gray-500">
                  {projectToReplace.projectCode}
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
                    isNewProjectCodeDuplicate 
                      ? "border-red-500 focus:ring-red-500/20" 
                      : "border-gray-200 dark:border-white/10 focus:ring-blue-500"
                  )}
                  autoFocus
                />
                {isNewProjectCodeDuplicate && (
                  <p className="text-[10px] text-red-500 mt-1 font-bold uppercase tracking-widest">This Project ID already exists!</p>
                )}
              </div>

              {replaceError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-xl text-xs text-red-600 dark:text-red-400 font-medium">
                  {replaceError}
                </div>
              )}
            </div>

            <div className="p-6 bg-gray-50 dark:bg-white/5 flex gap-3">
              <button 
                onClick={() => {
                  setIsReplaceIdModalOpen(false);
                  setNewProjectCode('');
                  setReplaceError('');
                  setProjectToReplace(null);
                }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
              >
                CANCEL
              </button>
              <button 
                onClick={handleReplaceProjectId}
                disabled={isReplacing || !newProjectCode.trim() || isNewProjectCodeDuplicate}
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
          </motion.div>
        </div>
      )}
      </AnimatePresence>

      <AnimatePresence>
        {importPreview && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[110] p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-2xl shadow-2xl border border-gray-200 dark:border-white/10 flex flex-col max-h-[80vh]"
            >
            <h2 className="text-2xl font-bold mb-4 dark:text-white">Review Import</h2>
            <p className="text-gray-900 dark:text-gray-400 mb-2 text-sm">
              The following records will be imported. Existing IDs will be updated.
            </p>
            {hasImportDuplicates && (
              <div className="mb-4 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl flex flex-col gap-2">
                <div className="flex items-center gap-3 text-red-600 dark:text-red-400 text-[10px] font-black uppercase tracking-[0.15em]">
                  <AlertTriangle className="w-4 h-4" />
                  Duplicate ID found
                </div>
                <div className="text-[10px] text-red-500/70 dark:text-red-400/70 font-medium break-all leading-relaxed">
                  {duplicateIds.length > 0 && (
                    <p>The following IDs appear multiple times in your excel: <span className="font-bold text-red-600 dark:text-red-400">{duplicateIds.join(', ')}</span>.</p>
                  )}
                  {systemDuplicateIds && systemDuplicateIds.length > 0 && (
                    <p>The following IDs already exist in the system and cannot be imported: <span className="font-bold text-red-600 dark:text-red-400">{systemDuplicateIds.join(', ')}</span>.</p>
                  )}
                  <p className="mt-2">Please resolve duplicates before importing.</p>
                </div>
              </div>
            )}
            <div className="flex-1 overflow-auto border border-gray-200 dark:border-white/10 rounded-xl mb-6">
              <table className="w-full text-left text-xs">
                <thead className="bg-black dark:bg-gray-100 sticky top-0">
                  <tr>
                    {Object.keys(importPreview.data[0] || {}).map(key => (
                      <th key={key} className={`px-4 py-2 font-bold text-white dark:text-black uppercase tracking-widest text-[10px] ${
                        key.toLowerCase().includes('id') || key.toLowerCase().includes('code') 
                          ? 'w-32' 
                          : key.toLowerCase().includes('sort') 
                            ? 'w-24' 
                            : ''
                      }`}>{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                  {importPreview.data.map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((val: any, j) => (
                        <td key={j} className="px-4 py-2 dark:text-white">{val?.toString()}</td>
                      ))}
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
                disabled={hasImportDuplicates}
                className="flex-1 py-4 bg-black dark:bg-white text-white dark:text-black rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-black/90 dark:hover:bg-white/90 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Complete Import
              </button>
            </div>
          </motion.div>
        </div>
      )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[100] p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-md shadow-2xl border border-gray-200 dark:border-white/10"
            >
            <div className="w-16 h-16 bg-red-50 dark:bg-red-500/10 rounded-full flex items-center justify-center mb-6 mx-auto">
              <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="text-2xl font-bold mb-2 text-center dark:text-white">
              {deleteConfirm.type === 'bulk-project' ? 'Delete Projects?' : 
               deleteConfirm.type === 'bulk-attr-value' ? 'Delete Attribute Values?' :
               deleteConfirm.type === 'bulk-rate' ? 'Delete Resource Rates?' :
               deleteConfirm.type === 'bulk-costElement' ? 'Delete Cost Elements?' :
               deleteConfirm.type === 'bulk-vendor' ? 'Delete Vendors?' :
               deleteConfirm.type === 'bulk-user' ? 'Delete Users?' :
               deleteConfirm.type === 'rate' ? 'Delete Resource Rate?' :
               deleteConfirm.type === 'costElement' ? 'Delete Cost Element?' :
               deleteConfirm.type === 'vendor' ? 'Delete Vendor?' :
               'Delete User?'}
            </h2>
            <p className="text-gray-900 dark:text-gray-400 text-center mb-8">
              {deleteConfirm.type === 'bulk-project' ? (
                <>You are about to delete <span className="font-bold text-black dark:text-white">{deleteConfirm.count}</span> projects. This action cannot be undone.</>
              ) : deleteConfirm.type === 'bulk-attr-value' ? (
                <>You are about to delete <span className="font-bold text-black dark:text-white">{deleteConfirm.count}</span> attribute values. This action cannot be undone.</>
              ) : deleteConfirm.type === 'bulk-rate' ? (
                <>You are about to delete <span className="font-bold text-black dark:text-white">{deleteConfirm.count}</span> resource rates. This action cannot be undone.</>
              ) : deleteConfirm.type === 'bulk-costElement' ? (
                <>You are about to delete <span className="font-bold text-black dark:text-white">{deleteConfirm.count}</span> cost elements. This action cannot be undone.</>
              ) : deleteConfirm.type === 'bulk-vendor' ? (
                <>You are about to delete <span className="font-bold text-black dark:text-white">{deleteConfirm.count}</span> vendors. This action cannot be undone.</>
              ) : deleteConfirm.type === 'bulk-user' ? (
                <>You are about to delete <span className="font-bold text-black dark:text-white">{deleteConfirm.count}</span> users. This action cannot be undone.</>
              ) : (
                <>You are about to remove <span className="font-bold text-black dark:text-white">{deleteConfirm.name}</span> from the enterprise.</>
              )}
            </p>
            <div className="flex gap-4">
              <button 
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-4 border border-gray-200 dark:border-white/10 rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-white/5 transition-colors dark:text-white"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  if (deleteConfirm.type === 'user') deleteUser(deleteConfirm.id!);
                  else if (deleteConfirm.type === 'bulk-user') bulkDeleteUsers();
                  else if (deleteConfirm.type === 'project') deleteProject(deleteConfirm.id!);
                  else if (deleteConfirm.type === 'bulk-project') bulkDeleteProjects();
                  else if (deleteConfirm.type === 'bulk-attr-value') bulkDeleteAttributeValues(activeTab === 'projectAttributes' ? 'project' : activeTab === 'costCodeAttributes' ? 'costCode' : activeTab === 'subcontractAttributes' ? 'subcontract' : activeTab === 'changeAttributes' ? 'change' : activeTab === 'riskAttributes' ? 'risk' : 'lineItem', selectedAttrId);
                  else if (deleteConfirm.type === 'rate') deleteResourceRate(deleteConfirm.id!);
                  else if (deleteConfirm.type === 'bulk-rate') bulkDeleteResourceRates();
                  else if (deleteConfirm.type === 'vendor') deleteVendor(deleteConfirm.id!);
                  else if (deleteConfirm.type === 'bulk-vendor') bulkDeleteVendors();
                  setDeleteConfirm(null);
                }}
                className="flex-1 py-4 bg-red-600 text-white rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
              >
                Delete
              </button>
            </div>
          </motion.div>
        </div>
      )}
      </AnimatePresence>

      <AnimatePresence>
        {isEditingVendor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6"
          >
            <h2 className="text-xl font-bold mb-6 dark:text-white">{isEditingVendor.id ? 'Edit' : 'Add'} Vendor</h2>
            <form onSubmit={saveVendor} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Vendor ID</label>
                    <Input 
                      value={vendorFormData.id}
                      onChange={e => setVendorFormData({ ...vendorFormData, id: e.target.value })}
                      placeholder="e.g. V-001"
                      maxLength={50}
                      disabled={!!isEditingVendor.id}
                      className={cn(
                        isDuplicateVendorCode ? "border-red-500 focus:ring-red-500" : "",
                        !!isEditingVendor.id && "bg-gray-50 dark:bg-white/5 cursor-not-allowed"
                      )}
                    />
                    {isDuplicateVendorCode && (
                      <p className="text-[10px] text-red-500 font-bold uppercase tracking-tighter">This ID already exists and must be unique</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Vendor Name</label>
                    <Input 
                      value={vendorFormData.name}
                      onChange={e => setVendorFormData({ ...vendorFormData, name: e.target.value })}
                      placeholder="e.g. Acme Corp"
                      required
                    />
                  </div>
                </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Contact Name</label>
                  <Input 
                    value={vendorFormData.contactName}
                    onChange={e => setVendorFormData({ ...vendorFormData, contactName: e.target.value })}
                    placeholder="John Doe"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Contact Email</label>
                  <Input 
                    type="email"
                    value={vendorFormData.contactEmail}
                    onChange={e => setVendorFormData({ ...vendorFormData, contactEmail: e.target.value })}
                    placeholder="john@acme.com"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="ghost" onClick={() => setIsEditingVendor(null)}>Cancel</Button>
                <Button 
                  type="submit" 
                  disabled={isSubmitting || isDuplicateVendorCode} 
                  className="bg-black dark:bg-white text-white dark:text-black"
                >
                  {isEditingVendor.id ? 'Update' : 'Add'} Vendor
                </Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {isEditingResource && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[100] p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-lg shadow-2xl border border-gray-200 dark:border-white/10"
            >
            <h2 className="text-xl font-bold mb-6 dark:text-white">{isEditingResource.id ? 'Edit' : 'Add'} Resource</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (isEditingResource.id) {
                updateResourceRate(isEditingResource.id, resourceFormData);
              } else {
                addResourceRate(resourceFormData, isEditingResource.insertIndex);
              }
              setIsEditingResource(null);
            }} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                    Resource ID <span className="text-red-500">*</span>
                  </label>
                  <input 
                    required
                    disabled={!!isEditingResource.id}
                    type="text"
                    maxLength={20}
                    value={resourceFormData.id}
                    onChange={e => setResourceFormData({ ...resourceFormData, id: e.target.value })}
                    className={cn(
                      "w-full p-4 bg-gray-50 dark:bg-white/5 border rounded-2xl text-sm focus:outline-none focus:ring-2 dark:text-white disabled:opacity-50 transition-all",
                      resourceIdExists 
                        ? "border-red-500 focus:ring-red-500/20" 
                        : "border-gray-200 dark:border-white/10 focus:ring-black/5"
                    )}
                  />
                  {resourceIdExists && (
                    <p className="text-[10px] text-red-500 mt-1 font-bold uppercase tracking-widest">This ID already Exists!</p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Resource Category</label>
                  <select 
                    value={resourceFormData.category}
                    onChange={e => setResourceFormData({ ...resourceFormData, category: e.target.value })}
                    className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                  >
                    <option value="">Select Category</option>
                    {RESOURCE_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Resource Name</label>
                <input 
                  type="text"
                  value={resourceFormData.name}
                  onChange={e => setResourceFormData({ ...resourceFormData, name: e.target.value })}
                  placeholder="e.g. Senior Engineer"
                  className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Unit <span className="text-red-500">*</span></label>
                  <input 
                    required
                    type="text"
                    value={resourceFormData.unit}
                    onChange={e => setResourceFormData({ ...resourceFormData, unit: e.target.value })}
                    placeholder="e.g. HR, DAY, M2"
                    className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Rate ($)</label>
                  <input 
                    type="number"
                    value={resourceFormData.rate}
                    onChange={e => setResourceFormData({ ...resourceFormData, rate: parseFloat(e.target.value) || 0 })}
                    className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">UDF 1</label>
                  <input 
                    type="text"
                    value={resourceFormData.udf1}
                    onChange={e => setResourceFormData({ ...resourceFormData, udf1: e.target.value })}
                    className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">UDF 2</label>
                  <input 
                    type="text"
                    value={resourceFormData.udf2}
                    onChange={e => setResourceFormData({ ...resourceFormData, udf2: e.target.value })}
                    className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">UDF 3</label>
                  <input 
                    type="text"
                    value={resourceFormData.udf3}
                    onChange={e => setResourceFormData({ ...resourceFormData, udf3: e.target.value })}
                    className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                  />
                </div>
              </div>
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsEditingResource(null)}
                  className="flex-1 py-4 border border-gray-200 dark:border-white/10 rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-white/5 transition-colors dark:text-white"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={!resourceFormData.id || resourceIdExists}
                  className="flex-1 py-4 bg-black dark:bg-white text-white dark:text-black rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-black/90 dark:hover:bg-white/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {isEditingResource.id ? 'Update' : 'Add'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      </AnimatePresence>
      <AnimatePresence>
        {inviteModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[100] p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-md shadow-2xl border border-gray-200 dark:border-white/10"
            >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold dark:text-white">Invite New User</h2>
              <button onClick={() => setInviteModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleInvite} className="space-y-4">
              <AnimatePresence mode="wait">
                {!generatedLink ? (
                  <motion.div
                    key="form"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-4"
                  >
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Email Address</label>
                      <input 
                        required
                        type="email"
                        value={inviteEmail}
                        onChange={e => setInviteEmail(e.target.value)}
                        placeholder="colleague@company.com"
                        className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                      />
                    </div>
                    <p className="text-xs text-gray-900 dark:text-gray-400">
                      Enter your colleague's email to generate a secure invitation link.
                    </p>
                    <div className="flex gap-4 pt-4">
                      <button 
                        type="button"
                        onClick={() => setInviteModal(false)}
                        className="flex-1 py-4 border border-gray-200 dark:border-white/10 rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-white/5 transition-colors dark:text-white"
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit"
                        disabled={isInviting}
                        className="flex-1 py-4 bg-black dark:bg-white text-white dark:text-black rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-black/90 dark:hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isInviting ? 'Generating...' : 'Generate Link'}
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div 
                    key="success"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 rounded-2xl">
                      <p className="text-sm text-emerald-800 dark:text-emerald-400 font-medium mb-1">Link Generated!</p>
                      <p className="text-xs text-emerald-700/70 dark:text-emerald-400/60">Copy the link below and send it to your colleague.</p>
                    </div>
                    
                    <div className="relative">
                      <input 
                        readOnly
                        value={generatedLink}
                        className="w-full p-4 pr-12 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-xs font-mono dark:text-white"
                      />
                      <button 
                        type="button"
                        onClick={copyInviteLink}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 hover:bg-gray-200 dark:hover:bg-white/10 rounded-lg transition-colors"
                      >
                        <Tag className="w-4 h-4 text-gray-500" />
                      </button>
                    </div>

                    <div className="flex gap-4">
                      <button 
                        type="button"
                        onClick={() => {
                          setGeneratedLink(null);
                          setInviteEmail('');
                          setInviteModal(false);
                        }}
                        className="flex-1 py-4 bg-black dark:bg-white text-white dark:text-black rounded-2xl text-sm font-bold uppercase tracking-widest hover:bg-black/90 dark:hover:bg-white/90 transition-colors"
                      >
                        Done
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </form>
          </motion.div>
        </div>
      )}
      </AnimatePresence>
      <AnimatePresence>
        {isEditingValue && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-[#1C1C1C] rounded-2xl w-full max-w-md shadow-2xl border border-gray-200 dark:border-white/10 overflow-hidden"
            >
            <div className="p-6 border-b border-gray-100 dark:border-white/10 flex justify-between items-center">
              <h3 className="text-xl font-bold dark:text-white">
                {isEditingValue.valueId ? 'Edit Value' : 'Add'}
              </h3>
              <button onClick={() => setIsEditingValue(null)} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-colors">
                <X className="w-5 h-5 dark:text-white" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                  Value ID <span className="text-red-500">*</span>
                </label>
                <input 
                  type="text"
                  maxLength={20}
                  value={valueFormData.id}
                  onChange={e => setValueFormData({ ...valueFormData, id: e.target.value })}
                  placeholder="e.g. V01"
                  className={cn(
                    "w-full p-3 bg-gray-50 dark:bg-white/5 border rounded-xl focus:outline-none focus:ring-2 dark:text-white transition-all",
                    valueIdExists 
                      ? "border-red-500 focus:ring-red-500/20" 
                      : "border-gray-200 dark:border-white/10 focus:ring-blue-500/20"
                  )}
                  disabled={!!isEditingValue.valueId}
                />
                {valueIdExists && (
                  <p className="text-[10px] text-red-500 mt-1 font-bold uppercase tracking-widest">This ID already Exists!</p>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Description</label>
                <input 
                  type="text"
                  value={valueFormData.description}
                  onChange={e => setValueFormData({ ...valueFormData, description: e.target.value })}
                  placeholder="e.g. High Priority"
                  className="w-full p-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Sort Order</label>
                <input 
                  type="text"
                  maxLength={5}
                  value={valueFormData.sortOrder}
                  onChange={e => {
                    const val = e.target.value;
                    if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                      setValueFormData({ ...valueFormData, sortOrder: val });
                    }
                  }}
                  placeholder="e.g. 1.0"
                  className="w-full p-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:text-white"
                />
              </div>
            </div>
            <div className="p-6 bg-gray-50 dark:bg-white/2 border-t border-gray-100 dark:border-white/10 flex justify-end gap-3">
              <button 
                onClick={() => setIsEditingValue(null)}
                className="px-6 py-2.5 text-sm font-bold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button 
                disabled={!valueFormData.id || valueIdExists}
                onClick={async () => {
                  if (!valueFormData.id) return;
                  if (isEditingValue.valueId) {
                    await updateAttributeValue(isEditingValue.type, isEditingValue.attrId, isEditingValue.valueId, valueFormData);
                  } else {
                    await addAttributeValue(isEditingValue.type, isEditingValue.attrId, valueFormData);
                  }
                  setIsEditingValue(null);
                }}
                className="px-8 py-2.5 bg-black dark:bg-white text-white dark:text-black rounded-xl text-sm font-bold hover:bg-black/90 dark:hover:bg-white/90 transition-colors shadow-lg shadow-black/10 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isEditingValue.valueId ? 'Save Changes' : 'Add'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      </AnimatePresence>

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <>
            <div 
              className="fixed inset-0 z-50" 
              onClick={() => setContextMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              style={{ left: contextMenu.x, top: contextMenu.y }}
              className="fixed z-[60] w-48 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl p-2"
            >
              {contextMenu.type === 'user' && (
                <>
                  <button 
                    onClick={() => {
                      toggleUserRole(contextMenu.id);
                      setContextMenu(null);
                    }}
                    className="w-full text-left p-2 text-xs dark:text-white hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg flex items-center gap-2"
                  >
                    <Lock className="w-3 h-3" /> Toggle Admin Role
                  </button>
                  <button 
                    onClick={() => {
                      setDeleteConfirm({ type: 'user', id: contextMenu.id, name: enterprise.users?.[contextMenu.id]?.email });
                      setContextMenu(null);
                    }}
                    className="w-full text-left p-2 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg flex items-center gap-2"
                  >
                    <Trash2 className="w-3 h-3" /> Delete User
                  </button>
                </>
              )}
              {contextMenu.type === 'project' && (
                <>
                  <button 
                    onClick={() => {
                      const project = projects.find(p => p.id === contextMenu.id);
                      if (project) {
                        setProjectToEdit(project);
                        setEditingProjectDetails({
                          projectName: project.projectName,
                          attributes: project.attributes || {}
                        });
                        setIsEditProjectDetailsOpen(true);
                      }
                      setContextMenu(null);
                    }}
                    className="w-full text-left p-2 text-xs dark:text-white hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg flex items-center gap-2"
                  >
                    <Edit2 className="w-3 h-3" /> Edit Details
                  </button>
                  <button 
                    onClick={() => {
                      const project = projects.find(p => p.id === contextMenu.id);
                      if (project) {
                        setProjectToReplace(project);
                        setNewProjectCode(project.projectCode);
                        setIsReplaceIdModalOpen(true);
                      }
                      setContextMenu(null);
                    }}
                    className="w-full text-left p-2 text-xs dark:text-white hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg flex items-center gap-2"
                  >
                    <RefreshCw className="w-3 h-3" /> Replace Project ID
                  </button>
                  <button 
                    onClick={() => {
                      const project = projects.find(p => p.id === contextMenu.id);
                      setDeleteConfirm({ type: 'project', id: contextMenu.id, name: project?.projectName });
                      setContextMenu(null);
                    }}
                    className="w-full text-left p-2 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg flex items-center gap-2"
                  >
                    <Trash2 className="w-3 h-3" /> Delete Project
                  </button>
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <Dialog open={isCreateProjectModalOpen} onOpenChange={setIsCreateProjectModalOpen}>
        <DialogContent className="sm:max-w-[425px] dark:bg-[#141414] dark:border-white/10">
          <DialogHeader>
            <DialogTitle className="dark:text-white">Create New Project</DialogTitle>
            <DialogDescription className="dark:text-gray-400">
              Enter the details for the new enterprise project.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateProject}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <label htmlFor="code" className="text-sm font-medium dark:text-gray-300">Project Code <span className="text-red-500">*</span></label>
                <Input
                  id="code"
                  value={newProjectData.code}
                  onChange={(e) => setNewProjectData({ ...newProjectData, code: e.target.value })}
                  placeholder="e.g. PRJ-001"
                  className={cn(
                    "dark:bg-[#1a1a1a] dark:border-white/10 dark:text-white",
                    !isSubmitting && projects.some(p => p.projectCode === newProjectData.code.trim()) && newProjectData.code.trim() !== '' && "border-red-500 focus-visible:ring-red-500"
                  )}
                  required
                />
                {!isSubmitting && projects.some(p => p.projectCode === newProjectData.code.trim()) && newProjectData.code.trim() !== '' && (
                  <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest">This Project Code already exists and must be unique!</p>
                )}
              </div>
              <div className="grid gap-2">
                <label htmlFor="name" className="text-sm font-medium dark:text-gray-300">Project Name <span className="text-red-500">*</span></label>
                <Input
                  id="name"
                  value={newProjectData.name}
                  onChange={(e) => setNewProjectData({ ...newProjectData, name: e.target.value })}
                  placeholder="e.g. Hospital Expansion"
                  className="dark:bg-[#1a1a1a] dark:border-white/10 dark:text-white"
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateProjectModalOpen(false)} className="dark:border-white/10 dark:text-white">Cancel</Button>
              <Button 
                type="submit" 
                disabled={isSubmitting || (projects.some(p => p.projectCode === newProjectData.code.trim()) && newProjectData.code.trim() !== '')} 
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isSubmitting ? 'Creating...' : 'Create Project'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditProjectDetailsOpen} onOpenChange={setIsEditProjectDetailsOpen}>
        <DialogContent className="sm:max-w-[500px] dark:bg-[#141414] dark:border-white/10 max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="dark:text-white">Edit Project Details</DialogTitle>
            <DialogDescription className="dark:text-gray-400">
              Update name and enterprise attributes for {projectToEdit?.projectCode}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-1 py-4 space-y-6">
            <div className="grid gap-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Project Name</label>
              <Input
                value={editingProjectDetails.projectName || ''}
                onChange={(e) => setEditingProjectDetails({ ...editingProjectDetails, projectName: e.target.value })}
                className="dark:bg-[#1a1a1a] dark:border-white/10 dark:text-white"
              />
            </div>

            <Separator className="dark:bg-white/10" />

            <div className="space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-widest text-gray-900 dark:text-white">Enterprise Project Attributes</h4>
              <div className="grid grid-cols-1 gap-4">
                {(enterprise.projectAttributes || [])
                  .filter(attr => attr.title)
                  .map(attr => (
                    <div key={attr.id} className="grid gap-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{attr.title}</label>
                      <select
                        value={editingProjectDetails.attributes?.[attr.id] || ''}
                        onChange={(e) => setEditingProjectDetails({
                          ...editingProjectDetails,
                          attributes: {
                            ...(editingProjectDetails.attributes || {}),
                            [attr.id]: e.target.value
                          }
                        })}
                        className="w-full p-2.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        <option value="">Select Value...</option>
                        {(attr.values || []).map(v => (
                          <option key={v.id} value={v.description}>{v.description}</option>
                        ))}
                      </select>
                    </div>
                  ))}
              </div>
            </div>
          </div>
          <DialogFooter className="pt-4 border-t border-gray-100 dark:border-white/10">
            <Button variant="outline" onClick={() => setIsEditProjectDetailsOpen(false)} className="dark:border-white/10 dark:text-white">Cancel</Button>
            <Button 
              disabled={isSubmitting}
              onClick={async () => {
                if (!projectToEdit) return;
                try {
                  setIsSubmitting(true);
                  const user = auth.currentUser;
                  await updateDoc(doc(db, 'projects', projectToEdit.id), {
                    projectName: editingProjectDetails.projectName,
                    attributes: editingProjectDetails.attributes,
                    dateLastModified: new Date().toISOString(),
                    modifiedBy: user?.uid || '',
                    modifiedByEmail: user?.email || ''
                  });
                  toast.success('Project details updated successfully');
                  setIsEditProjectDetailsOpen(false);
                } catch (error) {
                  console.error('Update failed', error);
                  toast.error('Failed to update project details');
                } finally {
                  setIsSubmitting(false);
                }
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AnimatePresence>
        {showImportSuccessModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
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
      </AnimatePresence>
      
      <Dialog open={!!isBulkUpdateModalOpen} onOpenChange={() => setIsBulkUpdateModalOpen(null)}>
        <DialogContent className="sm:max-w-[425px] dark:bg-[#1a1a1a] dark:border-white/10">
          <DialogHeader>
            <DialogTitle className="dark:text-white">Bulk Update {isBulkUpdateModalOpen?.type === 'rate' ? 'Resource Rates' : isBulkUpdateModalOpen?.type === 'project' ? 'Projects' : 'Vendors'}</DialogTitle>
            <DialogDescription className="dark:text-gray-400">
              Update {isBulkUpdateModalOpen?.count} selected items at once. Only fields you fill will be updated.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {isBulkUpdateModalOpen?.type === 'rate' && (
              <>
                <div className="grid gap-2">
                  <label className="text-sm font-medium dark:text-gray-300">Category</label>
                  <select
                    value={bulkUpdateFormData.category || ''}
                    onChange={(e) => setBulkUpdateFormData({ ...bulkUpdateFormData, category: e.target.value })}
                    className="w-full bg-gray-100 dark:bg-white/5 border-none rounded-lg px-3 py-2 text-gray-700 dark:text-gray-300 focus:ring-1 focus:ring-blue-500 outline-none"
                  >
                    <option value="">Select Category...</option>
                    {RESOURCE_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium dark:text-gray-300">Unit</label>
                  <Input 
                    value={bulkUpdateFormData.unit || ''} 
                    onChange={(e) => setBulkUpdateFormData({ ...bulkUpdateFormData, unit: e.target.value })}
                    className="dark:bg-[#141414] dark:border-white/10 dark:text-white"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium dark:text-gray-300">Rate ($)</label>
                  <Input 
                    type="number"
                    value={bulkUpdateFormData.rate || ''} 
                    onChange={(e) => setBulkUpdateFormData({ ...bulkUpdateFormData, rate: Number(e.target.value) })}
                    className="dark:bg-[#141414] dark:border-white/10 dark:text-white"
                  />
                </div>
              </>
            )}
            {isBulkUpdateModalOpen?.type === 'project' && (
              <div className="space-y-4 max-h-[400px] overflow-y-auto px-1">
                <div className="grid gap-2">
                  <label className="text-sm font-medium dark:text-gray-300">Status</label>
                  <select 
                    value={bulkUpdateFormData.status || ''}
                    onChange={(e) => setBulkUpdateFormData({ ...bulkUpdateFormData, status: e.target.value })}
                    className="w-full bg-gray-100 dark:bg-white/5 border-none rounded-lg px-3 py-2 text-gray-700 dark:text-gray-300 focus:ring-1 focus:ring-blue-500 outline-none"
                  >
                    <option value="">No Change</option>
                    <option value="Active">Active</option>
                    <option value="On Hold">On Hold</option>
                    <option value="Closed">Closed</option>
                    <option value="Archived">Archived</option>
                  </select>
                </div>
                {projectAttributes.filter(attr => attr.title).map(attr => (
                  <div key={attr.id} className="grid gap-2">
                    <label className="text-sm font-medium dark:text-gray-300">{attr.title}</label>
                    <select
                      value={bulkUpdateFormData[`attributes.${attr.id}`] || ''}
                      onChange={(e) => setBulkUpdateFormData({ ...bulkUpdateFormData, [`attributes.${attr.id}`]: e.target.value })}
                      className="w-full bg-gray-100 dark:bg-white/5 border-none rounded-lg px-3 py-2 text-gray-700 dark:text-gray-300 focus:ring-1 focus:ring-blue-500 outline-none"
                    >
                      <option value="">No Change</option>
                      {attr.values?.map(v => (
                        <option key={v.id} value={v.id}>{v.id} | {v.description}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
            {isBulkUpdateModalOpen?.type === 'vendor' && (
              <>
                <div className="grid gap-2">
                  <label className="text-sm font-medium dark:text-gray-300">Contact Name</label>
                  <Input 
                    value={bulkUpdateFormData.contactName || ''} 
                    onChange={(e) => setBulkUpdateFormData({ ...bulkUpdateFormData, contactName: e.target.value })}
                    className="dark:bg-[#141414] dark:border-white/10 dark:text-white"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkUpdateModalOpen(null)} className="dark:border-white/10 dark:text-white">Cancel</Button>
            <Button onClick={handleBulkUpdate} disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700 text-white">
              {isSubmitting ? 'Updating...' : 'Update All'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Hidden File Inputs */}
      <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls,.csv" />
      <input type="file" ref={projectPhotoInputRef} className="hidden" accept="image/*" />
      <input type="file" ref={enterpriseLogoInputRef} className="hidden" accept="image/*" />
    </div>
  );
}
