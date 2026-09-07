import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc, getDocs, writeBatch, updateDoc } from 'firebase/firestore';
import { Enterprise, Project } from '../types';
import { Plus, Briefcase, AlertTriangle, ArrowUpRight, Trash2, ArrowUp, ArrowDown, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import DataGridModule from './DataGridModule';
import { AgGridReact } from 'ag-grid-react';

interface EnterpriseDashboardProps {
  enterprise: Enterprise | null;
  userId: string;
  isSystemOwner: boolean;
}

export default function EnterpriseDashboard({ enterprise, userId, isSystemOwner }: EnterpriseDashboardProps) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', code: '' });
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [bulkUpdateData, setBulkUpdateData] = useState<{ attributes: Record<string, string> }>({ attributes: {} });
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'single' | 'bulk'; id?: string; count?: number } | null>(null);
  const [isGridCollapsed, setIsGridCollapsed] = useState(false);
  const [quickFilterText, setQuickFilterText] = useState('');
  const gridRef = useRef<AgGridReact>(null);

  const onSelectProject = (project: Project) => {
    window.location.href = `/project/${project.id}`;
  };

  const toggleAllCostCodeColumnGroups = (opened: boolean) => {
    if (!gridRef.current) return;
    const api = gridRef.current.api;
    const groups = api.getColumnGroupState();
    const newState = groups.map(g => ({
      groupId: g.groupId,
      open: opened
    }));
    api.setColumnGroupState(newState);
  };

  const codeExists = !isSubmitting && projects.some(p => p.projectCode === newProject.code);

  const isEnterpriseAdmin = isSystemOwner || enterprise?.users?.[userId]?.role === 'Enterprise System Admin' || enterprise?.adminUsers.includes(userId);

  useEffect(() => {
    if (!enterprise) return;

    const q = query(collection(db, 'projects'), where('enterpriseId', '==', enterprise.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allProjects = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Project));
      
      // Filter projects if not enterprise admin
      const filtered = isEnterpriseAdmin 
        ? allProjects 
        : allProjects.filter(p => p.users && p.users[userId]);
        
      setProjects(filtered);
    }, (error) => {
      console.error("Projects fetch error:", error);
    });
    return () => unsubscribe();
  }, [enterprise, isEnterpriseAdmin, userId]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enterprise) return;

    if (codeExists) {
      alert('This Project Code already exists!');
      return;
    }

    try {
      setIsSubmitting(true);
      const now = new Date().toISOString();
      const finalName = newProject.name.trim() || 'Project Name';
      await addDoc(collection(db, 'projects'), {
        enterpriseId: enterprise.id,
        projectName: finalName,
        projectCode: newProject.code,
        projectBudget: 0,
        startDate: now.split('T')[0],
        endDate: now.split('T')[0],
        cutoffDate: now.split('T')[0],
        users: { [userId]: 'Project Admin' },
        dateCreated: now,
        dateLastModified: now,
        firstCostReportingMonth: '',
        currentReportingMonth: '',
        lastReportingMonth: ''
      });
      setIsModalOpen(false);
      setNewProject({ name: '', code: '' });
    } catch (error) {
      console.error('Failed to create project', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectToDelete) return;
    setIsDeleting(true);
    try {
      const batch = writeBatch(db);
      
      // 1. Find all sheets for this project
      const sheetsQuery = query(collection(db, 'sheets'), where('projectId', '==', projectToDelete.id));
      const sheetsSnapshot = await getDocs(sheetsQuery);
      
      for (const sheetDoc of sheetsSnapshot.docs) {
        // 2. Find all rows for each sheet
        const rowsQuery = query(collection(db, `sheets/${sheetDoc.id}/rows`));
        const rowsSnapshot = await getDocs(rowsQuery);
        rowsSnapshot.docs.forEach(rowDoc => {
          batch.delete(rowDoc.ref);
        });
        // 3. Delete the sheet
        batch.delete(sheetDoc.ref);
      }
      
      // 4. Delete the project
      batch.delete(doc(db, 'projects', projectToDelete.id));
      
      await batch.commit();
      setProjectToDelete(null);
    } catch (error) {
      console.error('Failed to delete project', error);
      alert('Failed to delete project. Check console for details.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!deleteConfirm) return;
    try {
      if (deleteConfirm.type === 'bulk') {
        const batch = writeBatch(db);
        selectedIds.forEach(id => {
          batch.delete(doc(db, 'projects', id));
        });
        await batch.commit();
        toast.success(`Deleted ${selectedIds.size} projects.`);
      }
      setSelectedIds(new Set());
      setDeleteConfirm(null);
    } catch (error) {
      console.error('Failed to bulk delete projects', error);
      toast.error('Failed to delete projects.');
    }
  };

  const handleBulkUpdate = async () => {
    try {
      const batch = writeBatch(db);
      selectedIds.forEach(id => {
        const updateObj: any = { dateLastModified: new Date().toISOString() };
        const p = projects.find(p => p.id === id);
        if (p) {
          updateObj.attributes = { ...(p.attributes || {}), ...bulkUpdateData.attributes };
        }
        batch.update(doc(db, 'projects', id), updateObj);
      });
      await batch.commit();
      toast.success(`Updated ${selectedIds.size} projects.`);
      setIsBulkUpdating(false);
      setSelectedIds(new Set());
      setBulkUpdateData({ attributes: {} });
    } catch (error) {
      console.error('Failed to bulk update projects', error);
      toast.error('Failed to update projects.');
    }
  };

  const handleExport = () => {
    if (projects.length === 0) {
      toast.error('No data to export');
      return;
    }
    const data = projects.map(p => {
      const periods = p.reportingPeriods?.periods || [];
      const cpId = p.reportingPeriods?.currentPeriodId;
      
      const formatPeriodDate = (nameStr: string) => {
        // We already return the endDate strings from format routines instead of names, 
        // but just in case, we'll extract it straight from the object
        return nameStr;
      };

      const row: any = {
        'Project ID': p.projectCode,
        'Project Name': p.projectName,
        'First Cost Reporting Month': periods.length > 0 ? periods[0].endDate : '',
        'Current Reporting Month': cpId ? periods.find((x: any) => x.id === cpId)?.endDate || '' : '',
        'Last Reporting Month': periods.length > 0 ? periods[periods.length - 1].endDate : '',
        'Created Date': p.dateCreated ? new Date(p.dateCreated).toLocaleDateString() : '',
        'Modified Date': p.dateLastModified ? new Date(p.dateLastModified).toLocaleDateString() : '',
      };
      if (enterprise?.projectAttributes) {
        enterprise.projectAttributes.forEach((attr: any) => {
          if (attr.title) {
            const rawValue = p.attributes?.[attr.id];
            const valObj = attr.values?.find((v: any) => v.id === rawValue);
            row[attr.title] = valObj ? `${valObj.id} | ${valObj.description}` : (rawValue || '');
          }
        });
      }
      return row;
    });
    
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Projects');
    XLSX.writeFile(wb, `Projects_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const data = new Uint8Array(evt.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet);

          if (!rows || rows.length === 0) {
            toast.error("File is empty.");
            return;
          }

          let duplicateCount = 0;
          let addedCount = 0;
          const batch = writeBatch(db);

          const enterpriseAttributesMap = new Map();
          (enterprise?.projectAttributes || []).forEach(attr => {
             if (attr.title) {
               enterpriseAttributesMap.set(attr.title.toLowerCase(), attr);
             }
          });

          rows.forEach((row: any) => {
            const projectCode = row['Project ID'] || row['projectCode'];
            const projectName = row['Project Name'] || row['projectName'];

            if (!projectCode || !projectName) return;

            const attributes: Record<string, string> = {};
            Object.keys(row).forEach(key => {
               const attr = enterpriseAttributesMap.get(key.toLowerCase());
               if (attr) {
                 const rawVal = String(row[key]);
                 let finalVal = rawVal;
                 if (rawVal.includes(' | ')) {
                   finalVal = rawVal.split(' | ')[0].trim();
                 }
                 attributes[attr.id] = finalVal;
               }
            });

            // If it exists, only update Name and attributes
            const existingProject = projects.find(p => p.projectCode === projectCode);
            if (existingProject) {
              const ref = doc(db, 'projects', existingProject.id);
              batch.update(ref, {
                projectName: String(projectName),
                attributes: { ...(existingProject.attributes || {}), ...attributes },
                dateLastModified: new Date().toISOString()
              });
              duplicateCount++; // Tracking as updated duplicate
              return;
            }

            const newProjectData: any = {
              enterpriseId: enterprise?.id || '',
              projectCode: String(projectCode),
              projectName: String(projectName),
              projectBudget: 0,
              startDate: new Date().toISOString(),
              endDate: new Date().toISOString(),
              cutoffDate: new Date().toISOString(),
              users: {},
              attributes,
              dateCreated: new Date().toISOString(),
              dateLastModified: new Date().toISOString()
            };

            const ref = doc(collection(db, 'projects'));
            batch.set(ref, newProjectData);
            addedCount++;
          });

          if (addedCount > 0 || duplicateCount > 0) {
            await batch.commit();
            if (addedCount > 0) toast.success(`Imported ${addedCount} new projects.`);
            if (duplicateCount > 0) toast.success(`Updated ${duplicateCount} existing projects.`);
          }
        } catch (err) {
          console.error("Import error:", err);
          toast.error("Failed to import file.");
        }
      };
      reader.readAsArrayBuffer(file);
    };
    input.click();
  };

  const handleUpdateField = async (id: string, field: string, value: any) => {
    try {
      await updateDoc(doc(db, 'projects', id), {
        [field]: value,
        dateLastModified: new Date().toISOString()
      });
    } catch (e) {
      console.error(e);
    }
  };

  const [costAggregations, setCostAggregations] = useState<Record<string, any>>({});

  useEffect(() => {
    if (projects.length === 0) {
      setCostAggregations({});
      return;
    }

    const unsubscribes: (() => void)[] = [];
    
    // Firestore 'in' query supports max 10 values
    const chunkArray = (arr: any[], size: number) => 
      Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));
      
    const projectChunks = chunkArray(projects.map(p => p.id), 10);

    projectChunks.forEach(chunk => {
      const q = query(collection(db, 'costCodes'), where('projectId', 'in', chunk));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const aggs: Record<string, any> = {};
        chunk.forEach(id => {
          aggs[id] = {
            baselineBudget: 0,
            budgetChanges: 0,
            approvedBudget: 0,
            actualCost: 0,
            etc: 0,
            eac: 0
          };
        });

        snapshot.forEach(doc => {
          const data = doc.data();
          const pId = data.projectId;
          if (pId && aggs[pId]) {
            aggs[pId].baselineBudget += (data.baselineBudget || 0);
            aggs[pId].budgetChanges += (data.budgetChanges || 0);
            aggs[pId].approvedBudget += (data.approvedBudget || 0);
            aggs[pId].actualCost += (data.actualCostToDate || 0);
            aggs[pId].etc += (data.estimateToComplete || 0);
            aggs[pId].eac += (data.estimateAtCompletion || 0);
          }
        });

        setCostAggregations(prev => ({ ...prev, ...aggs }));
      });
      unsubscribes.push(unsubscribe);
    });

    return () => unsubscribes.forEach(unsub => unsub());
  }, [projects]);

  const projectColumnDefs = useMemo(() => {
    const canEdit = (data: any) => {
      if (!data) return false;
      return isEnterpriseAdmin || (data.users && data.users[userId] === 'Project Admin');
    };

    const baseColumns = [
      {
        headerName: '',
        width: 50,
        checkboxSelection: (params: any) => {
          if (params.node?.rowPinned) return false;
          return canEdit(params.data);
        },
        headerCheckboxSelection: true,
        headerCheckboxSelectionFilteredOnly: true,
        pinned: 'left',
        lockPosition: 'left',
        suppressMenu: true,
        suppressMovable: true,
        suppressColumnsToolPanel: true,
        headerClass: 'bg-gray-50 dark:bg-[#1a1a1a]',
        cellClass: 'bg-white dark:bg-[#141414]'
      },
      { 
        headerName: 'Project ID', 
        field: 'projectCode', 
        width: 150, 
        pinned: 'left',
        editable: false,
        cellClass: 'bg-[#f3f4f6] dark:bg-gray-800',
        cellRenderer: (params: any) => {
          return (
            <span 
              className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer font-mono uppercase text-xs font-bold"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (params.data) onSelectProject(params.data);
              }}
            >
              {params.value}
            </span>
          );
        }
      },
      { 
        headerName: 'Project Name', 
        field: 'projectName', 
        flex: 1,
        minWidth: 200,
        pinned: 'left',
        editable: (params: any) => canEdit(params.data),
        cellStyle: { fontWeight: 'bold' } 
      }
    ];

    const validAttributes = (enterprise?.projectAttributes || []).filter(attr => attr.title && attr.title.trim() !== '');
    
    const attributeColumns = validAttributes.length > 0 ? [{
      headerName: 'Enterprise Project Attributes',
      groupId: 'enterpriseProjectAttributes',
      openByDefault: true,
      children: validAttributes.map((attr, index) => ({
        headerName: attr.title,
        field: `attributes.${attr.id}`,
        width: 200,
        editable: (params: any) => canEdit(params.data),
        columnGroupShow: index === 0 ? undefined : 'open',
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: {
          values: (attr.values || []).map(v => v.id),
          valueListFormatter: (params: any) => {
            const val = attr.values?.find((v: any) => v.id === params.value);
            return val ? `${val.id} | ${val.description}` : params.value;
          }
        },
        valueFormatter: (params: any) => {
          if (!params.value) return '';
          const val = attr.values?.find(v => v.id === params.value);
          return val ? `${val.id} | ${val.description}` : params.value;
        },
        valueGetter: (params: any) => params.data.attributes?.[attr.id] || '',
        valueSetter: (params: any) => {
          const newAttrs = { ...(params.data.attributes || {}), [attr.id]: params.newValue };
          params.data.attributes = newAttrs;
          return true;
        }
      }))
    }] : [];

    const metaDateColumns = [
      { 
        headerName: 'Created Date', 
        field: 'dateCreated', 
        width: 150, 
        editable: false,
        valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleDateString() : '' 
      },
      { 
        headerName: 'Modified Date', 
        field: 'dateLastModified', 
        width: 150, 
        editable: false,
        valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleDateString() : '' 
      }
    ];

    const costColumns = [{
      headerName: 'Cost Management Module',
      groupId: 'costManagementGroup',
      openByDefault: true,
      children: [
        { 
          headerName: 'First Reporting Month', 
          field: 'firstCostReportingMonth',
          width: 210, 
          editable: false,
          columnGroupShow: undefined,
          valueGetter: (params: any) => {
            const periods = params.data.reportingPeriods?.periods;
            return periods && periods.length > 0 ? periods[0].endDate : '';
          }
        },
        { 
          headerName: 'Current Reporting Month', 
          field: 'currentReportingMonth',
          width: 210, 
          editable: false,
          columnGroupShow: 'open',
          valueGetter: (params: any) => {
            const cpId = params.data.reportingPeriods?.currentPeriodId;
            const periods = params.data.reportingPeriods?.periods;
            return (periods && cpId) ? periods.find((p: any) => p.id === cpId)?.endDate || '' : '';
          }
        },
        { 
          headerName: 'Last Reporting Month', 
          field: 'lastReportingMonth',
          width: 210, 
          editable: false,
          columnGroupShow: 'open',
          valueGetter: (params: any) => {
            const periods = params.data.reportingPeriods?.periods;
            return periods && periods.length > 0 ? periods[periods.length - 1].endDate : '';
          }
        },
        {
          headerName: 'Baseline Budget',
          colId: 'baselineBudget',
          width: 150,
          editable: false,
          columnGroupShow: 'open',
          type: 'numericColumn',
          valueGetter: (params: any) => params.node?.rowPinned ? params.data.baselineBudget : (costAggregations[params.data.id]?.baselineBudget || 0),
          valueFormatter: (params: any) => `$${(params.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        },
        {
          headerName: 'Budget Changes',
          colId: 'budgetChanges',
          width: 150,
          editable: false,
          columnGroupShow: 'open',
          type: 'numericColumn',
          valueGetter: (params: any) => params.node?.rowPinned ? params.data.budgetChanges : (costAggregations[params.data.id]?.budgetChanges || 0),
          valueFormatter: (params: any) => `$${(params.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        },
        {
          headerName: 'Approved Budget',
          colId: 'approvedBudget',
          width: 150,
          editable: false,
          columnGroupShow: 'open',
          type: 'numericColumn',
          valueGetter: (params: any) => params.node?.rowPinned ? params.data.approvedBudget : (costAggregations[params.data.id]?.approvedBudget || 0),
          valueFormatter: (params: any) => `$${(params.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        },
        {
          headerName: 'Actual Cost to Date',
          colId: 'actualCost',
          width: 160,
          editable: false,
          columnGroupShow: 'open',
          type: 'numericColumn',
          valueGetter: (params: any) => params.node?.rowPinned ? params.data.actualCost : (costAggregations[params.data.id]?.actualCost || 0),
          valueFormatter: (params: any) => `$${(params.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        },
        {
          headerName: 'ETC',
          colId: 'etc',
          width: 150,
          editable: false,
          columnGroupShow: 'open',
          type: 'numericColumn',
          valueGetter: (params: any) => params.node?.rowPinned ? params.data.etc : (costAggregations[params.data.id]?.etc || 0),
          valueFormatter: (params: any) => `$${(params.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        },
        {
          headerName: 'EAC',
          colId: 'eac',
          width: 150,
          editable: false,
          columnGroupShow: 'open',
          type: 'numericColumn',
          valueGetter: (params: any) => params.node?.rowPinned ? params.data.eac : (costAggregations[params.data.id]?.eac || 0),
          valueFormatter: (params: any) => `$${(params.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        },
        {
          headerName: 'Cost Variance',
          colId: 'costVariance',
          width: 150,
          editable: false,
          columnGroupShow: 'open',
          type: 'numericColumn',
          valueGetter: (params: any) => {
            const approved = params.node?.rowPinned ? params.data.approvedBudget : (costAggregations[params.data.id]?.approvedBudget || 0);
            const eac = params.node?.rowPinned ? params.data.eac : (costAggregations[params.data.id]?.eac || 0);
            return approved - eac;
          },
          cellRenderer: (params: any) => {
            if (params.value == null || params.value === 0) {
              return `$${(params.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
            const isPositive = params.value > 0;
            const colorClass = isPositive ? 'text-emerald-600' : 'text-red-600';
            return (
              <div className={`flex items-center gap-1 font-medium justify-end h-full ${colorClass}`}>
                {isPositive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                <span>${Math.abs(params.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            );
          }
        }
      ]
    }];

    const actionColumn = [{
      headerName: '',
      width: 120,
      pinned: 'right',
      editable: false,
      cellRenderer: (params: any) => {
        const ableToEdit = canEdit(params.data);
        return (
          <div className="flex justify-end items-center gap-1">
            <Button 
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onSelectProject(params.data);
              }}
              className="w-8 h-8 text-gray-500 hover:text-blue-600"
              title="Open Project"
            >
              <ArrowUpRight className="w-4 h-4" />
            </Button>
            {ableToEdit && (
              <Button 
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setProjectToDelete(params.data);
                }}
                className="w-8 h-8 text-gray-500 hover:text-red-600"
                title="Delete Project"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        );
      }
    }];

    return [...baseColumns, ...attributeColumns, ...metaDateColumns, ...costColumns, ...actionColumn];
  }, [enterprise, isEnterpriseAdmin, costAggregations]);

  const topPinnedRowData = useMemo(() => {
    if (projects.length === 0) return [];
    
    let totalBaseline = 0;
    let totalChanges = 0;
    let totalApproved = 0;
    let totalActual = 0;
    let totalEtc = 0;
    let totalEac = 0;

    projects.forEach(p => {
      const aggs = costAggregations[p.id] || {};
      totalBaseline += (aggs.baselineBudget || 0);
      totalChanges += (aggs.budgetChanges || 0);
      totalApproved += (aggs.approvedBudget || 0);
      totalActual += (aggs.actualCost || 0);
      totalEtc += (aggs.etc || 0);
      totalEac += (aggs.eac || 0);
    });

    return [{
      id: 'total-row',
      projectCode: 'TOTAL',
      projectName: `${projects.length} Project(s)`,
      baselineBudget: totalBaseline,
      budgetChanges: totalChanges,
      approvedBudget: totalApproved,
      actualCost: totalActual,
      etc: totalEtc,
      eac: totalEac
    }];
  }, [projects, costAggregations]);

  return (
    <div className="flex-1 flex flex-col bg-[#F5F5F4] dark:bg-[#0a0a0a] overflow-hidden">
      {/* Header Area */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-gray-100 dark:border-white/5 shrink-0">
        <div>
          <h1 className="text-xl font-bold dark:text-white">Active Projects</h1>
          <p className="text-xs text-gray-500">Manage all enterprise projects</p>
        </div>
        {isEnterpriseAdmin && (
          <Button onClick={() => setIsModalOpen(true)} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </Button>
        )}
      </div>

      {/* Grid Area */}
      <div className="flex-1 flex flex-col min-h-0 p-6">
        <div className="flex-1 flex flex-col min-h-0 relative w-full overflow-hidden">
          <DataGridModule 
            title="Projects"
            rowData={projects}
            columnDefs={projectColumnDefs}
            pinnedTopRowData={topPinnedRowData}
            quickFilterText={quickFilterText}
            onQuickFilterChange={setQuickFilterText}
            extraToolbarActions={
              <>
                <button 
                  onClick={() => toggleAllCostCodeColumnGroups(true)}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                  title="Expand All Groups"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => toggleAllCostCodeColumnGroups(false)}
                  className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                  title="Collapse All Groups"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
              </>
            }
            gridRef={gridRef}
            onCellValueChanged={(e) => {
              if (e.data && e.data.id) {
                if (e.colDef.field && e.colDef.field.startsWith('attributes.')) {
                  handleUpdateField(e.data.id, 'attributes', e.data.attributes);
                } else if (e.colDef.field) {
                  handleUpdateField(e.data.id, e.colDef.field, e.newValue);
                }
              }
            }}
            gridProps={{
              rowSelection: 'multiple',
              suppressRowClickSelection: true,
              onSelectionChanged: (e: any) => {
                const nodes = e.api.getSelectedNodes();
                setSelectedIds(new Set(nodes.map((n: any) => n.data.id)));
              }
            }}
            selectedCount={selectedIds.size}
            onBulkUpdate={() => setIsBulkUpdating(true)}
            onBulkDelete={() => setDeleteConfirm({ type: 'bulk', count: selectedIds.size })}
            onImport={handleImport}
            onExport={handleExport}
            isMainTableCollapsed={isGridCollapsed}
            onToggleMainTableCollapse={() => setIsGridCollapsed(!isGridCollapsed)}
          />
        </div>
      </div>

      {/* Bulk Update Modal */}
      <Dialog open={isBulkUpdating} onOpenChange={setIsBulkUpdating}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold dark:text-white">Bulk Update Projects</DialogTitle>
            <DialogDescription>
              Update values for {selectedIds.size} selected projects. Leave blank for no change.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
            {enterprise?.projectAttributes && enterprise.projectAttributes.some(a => a.title) ? (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">Enterprise Attributes</h3>
                <div className="grid grid-cols-2 gap-4">
                  {enterprise.projectAttributes.filter(a => a.title).map(attr => (
                    <div key={attr.id}>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{attr.title}</label>
                      <select 
                        value={bulkUpdateData.attributes[attr.id] || ''} 
                        onChange={e => setBulkUpdateData({ 
                          attributes: { ...bulkUpdateData.attributes, [attr.id]: e.target.value } 
                        })}
                        className="w-full p-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                      >
                        <option value="">No Change</option>
                        {(attr.values || []).map(v => <option key={v.id} value={v.id}>{v.description}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No updateable fields available.</p>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkUpdating(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleBulkUpdate} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white">Apply Updates</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={!!projectToDelete || !!deleteConfirm} onOpenChange={(open) => {
        if (!open) {
          setProjectToDelete(null);
          setDeleteConfirm(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3 text-red-600 mb-2">
              <AlertTriangle className="w-6 h-6" />
              <DialogTitle className="text-xl font-bold">
                {deleteConfirm?.type === 'bulk' ? 'Bulk Delete Projects?' : 'Delete Project?'}
              </DialogTitle>
            </div>
            <DialogDescription>
              {deleteConfirm?.type === 'bulk' ? (
                <>Are you sure you want to delete <span className="font-bold text-gray-900 dark:text-white">{deleteConfirm.count}</span> projects? This action is permanent and will delete all associated sheets and forecast data.</>
              ) : (
                <>Are you sure you want to delete <span className="font-bold text-gray-900 dark:text-white">"{projectToDelete?.projectName}"</span>? This action is permanent and will delete all associated sheets and forecast data.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button 
              disabled={isDeleting}
              variant="outline"
              onClick={() => {
                setProjectToDelete(null);
                setDeleteConfirm(null);
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button 
              disabled={isDeleting}
              variant="destructive"
              onClick={deleteConfirm?.type === 'bulk' ? handleBulkDelete : handleDeleteProject}
              className="flex-1"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Project Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Create New Project</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateProject} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">
                Project Code <span className="text-red-500">*</span>
              </label>
              <Input 
                required
                maxLength={20}
                value={newProject.code}
                onChange={e => setNewProject({...newProject, code: e.target.value})}
                className={cn(
                  codeExists && "border-red-500 focus-visible:ring-red-500/20"
                )}
                placeholder="e.g. BR-2024-001"
              />
              {codeExists && (
                <p className="text-[10px] text-red-500 mt-1 font-bold uppercase tracking-widest">This Project Code already exists!</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Project Name</label>
              <Input 
                maxLength={40}
                value={newProject.name}
                onChange={e => setNewProject({...newProject, name: e.target.value})}
                placeholder="e.g. Harbor View Mixed-Use"
              />
            </div>
            <DialogFooter className="pt-4">
              <Button 
                type="button"
                variant="outline"
                onClick={() => setIsModalOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                disabled={!newProject.code || codeExists || isSubmitting}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isSubmitting ? 'Creating...' : 'Create Project'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}


