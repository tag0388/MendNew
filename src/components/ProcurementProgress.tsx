import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  writeBatch, 
  orderBy 
} from 'firebase/firestore';
import { Project, Enterprise, ProcurementStepDefinition, ProcurementItem, Calendar as ProjectCalendar } from '../types';
import { AgGridReact } from 'ag-grid-react';
import { ColDef, ColGroupDef, ValueFormatterParams, CellValueChangedEvent } from 'ag-grid-community';
import { 
  Plus, 
  Search, 
  Download, 
  Upload,
  Trash2, 
  Calendar as CalendarIcon,
  Clock,
  CheckCircle2,
  Activity,
  ShoppingCart,
  Calculator,
  ShieldCheck
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { recalculatePlannedDates, recalculateForecastDates } from '../lib/procurementUtils';
import { handleFirestoreError, OperationType } from '../lib/errorHandlers';

import CreatePackageModal from './CreatePackageModal';

interface ProcurementProgressProps {
  project: Project;
  enterprise: Enterprise;
  setIsSidebarCollapsed?: (collapsed: boolean) => void;
  hideTabs?: boolean;
}

export default function ProcurementProgress({ project, enterprise, hideTabs = false }: ProcurementProgressProps) {
  const [items, setItems] = useState<ProcurementItem[]>([]);
  const [stepDefinitions, setStepDefinitions] = useState<ProcurementStepDefinition[]>([]);
  const [calendars, setCalendars] = useState<ProjectCalendar[]>([]);
  const [quickFilterText, setQuickFilterText] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const gridRef = useRef<AgGridReact>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Data Fetching
  useEffect(() => {
    if (!project.id) return;
    
    // Fetch Project Steps
    const stepsQuery = query(
      collection(db, 'procurementStepDefinitions'), 
      where('projectId', '==', project.id),
      orderBy('order', 'asc')
    );
    const unsubSteps = onSnapshot(stepsQuery, (snapshot) => {
      setStepDefinitions(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ProcurementStepDefinition)));
    }, (error) => {
      console.error("Firestore Error fetching steps:", error);
    });

    // Fetch Packages
    const itemsQuery = query(collection(db, 'procurementItems'), where('projectId', '==', project.id));
    const unsubItems = onSnapshot(itemsQuery, (snapshot) => {
      setItems(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ProcurementItem)));
    }, (error) => {
       console.error("Firestore Error fetching items:", error);
    });

    // Fetch Calendars
    const calendarsQuery = query(collection(db, 'calendars'), where('projectId', '==', project.id));
    const unsubCalendars = onSnapshot(calendarsQuery, (snapshot) => {
      setCalendars(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ProjectCalendar)));
    }, (error) => {
       console.error("Firestore Error fetching calendars:", error);
    });

    return () => {
      unsubSteps();
      unsubItems();
      unsubCalendars();
    };
  }, [project.id]);

  // 1.5 Sync Engine: Recalculate on load
  const hasSyncedInitialRef = useRef(false);
  useEffect(() => {
    if (items.length > 0 && stepDefinitions.length > 0 && calendars.length > 0 && !hasSyncedInitialRef.current) {
      hasSyncedInitialRef.current = true;
      
      const syncItems = async () => {
        const batch = writeBatch(db);
        let hasChanges = false;

        items.forEach(item => {
          const calendar = calendars.find(c => c.id === item.calendarId) || calendars[0] || { weekends: [0, 6], holidays: [] } as any;
          let updatedStepData = { ...item.stepData };
          
          const stepDataWithPlanned = recalculatePlannedDates(updatedStepData, stepDefinitions, calendar);
          const finalStepData = recalculateForecastDates(stepDataWithPlanned, stepDefinitions, calendar, project.cutoffDate);
          
          // Only update if data actually changed
          if (JSON.stringify(item.stepData) !== JSON.stringify(finalStepData)) {
            batch.update(doc(db, 'procurementItems', item.id), {
              stepData: finalStepData,
              updatedAt: new Date().toISOString()
            });
            hasChanges = true;
          }
        });

        if (hasChanges) {
          try {
            await batch.commit();
            toast.success('Procurement schedule synchronized');
          } catch (e) {
            console.error('Initial sync failed:', e);
          }
        }
      };

      syncItems();
    }
  }, [items.length, stepDefinitions.length, calendars.length, calendars, stepDefinitions, items]);

  // 2. ColDefs Construction
  const columnDefs = useMemo<ColDef[]>(() => {
    const baseCols: ColDef[] = [
      {
        headerName: '',
        width: 50,
        checkboxSelection: true,
        headerCheckboxSelection: true,
        pinned: 'left',
        lockPosition: true,
      },
      { field: 'packageId', headerName: 'Package ID', width: 130, pinned: 'left', editable: true, cellClass: 'font-mono' },
      { field: 'description', headerName: 'Description', width: 250, pinned: 'left', editable: true },
      { 
        field: 'calendarId', 
        headerName: 'Calendar', 
        width: 150, 
        pinned: 'left', 
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: {
          values: calendars.map(c => c.id),
        },
        valueFormatter: (params) => calendars.find(c => c.id === params.value)?.name || params.value
      },
    ];

    const enterpriseAttrCols: ColDef[] = (enterprise.procurementAttributes || [])
      .filter(attr => attr.title && attr.values && attr.values.length > 0)
      .map(attr => ({
      headerName: attr.title,
      field: `enterpriseAttributes.${attr.id}`,
      width: 150,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: {
        values: attr.values?.map(v => v.id) || [],
      },
      valueFormatter: (params) => attr.values?.find(v => v.id === params.value)?.description || params.value
    }));

    const projectAttrCols: ColDef[] = (project.procurementAttributes || [])
      .filter(attr => attr.title && attr.values && attr.values.length > 0)
      .map(attr => ({
      headerName: attr.title,
      field: `projectAttributes.${attr.id}`,
      width: 150,
      editable: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: {
        values: attr.values?.map(v => v.id) || [],
      },
      valueFormatter: (params) => attr.values?.find(v => v.id === params.value)?.description || params.value
    }));

    const formatDate = (val: any) => {
      if (!val) return '';
      let date: Date;
      if (val instanceof Date) {
        date = val;
      } else if (val && typeof val === 'object' && 'seconds' in val) {
        date = new Date(val.seconds * 1000);
      } else {
        date = new Date(val);
      }
      if (isNaN(date.getTime())) return val;
      const d = String(date.getDate()).padStart(2, '0');
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const y = date.getFullYear();
      return `${d}/${m}/${y}`;
    };

    const effectiveCutoffStr = project.cutoffDate || new Date().toISOString().split('T')[0];

    const stepCols: (ColGroupDef | ColDef)[] = stepDefinitions.map(step => ({
      headerName: step.name,
      headerClass: 'procurement-step-header',
      children: [
        {
          headerName: 'Planned',
          field: `stepData.${step.id}.plannedDate`,
          width: 110,
          editable: (params) => {
            const steps = stepDefinitions || [];
            return steps.length > 0 && step.id === steps[steps.length - 1].id;
          },
          cellEditor: 'agDateCellEditor',
          valueGetter: (params) => {
            const val = params.data.stepData?.[step.id]?.plannedDate;
            if (!val) return null;
            const d = val && typeof val === 'object' && 'seconds' in val ? new Date(val.seconds * 1000) : new Date(val);
            return isNaN(d.getTime()) ? null : d;
          },
          valueFormatter: (p: ValueFormatterParams) => formatDate(p.value),
          valueParser: (params) => {
            const val = params.newValue as any;
            if (val instanceof Date) {
              return val.toISOString().split('T')[0];
            }
            return params.newValue;
          },
          cellClass: (params) => {
            const steps = stepDefinitions || [];
            const isLast = steps.length > 0 && step.id === steps[steps.length - 1].id;
            const stepData = params.data.stepData?.[step.id] || {};
            
            // params.value is the Date object from valueGetter
            const plannedDate = params.value instanceof Date ? params.value : null;
            const hasActual = !!stepData.actualDate;
            const isDelayed = plannedDate && !hasActual && plannedDate.toISOString().split('T')[0] < effectiveCutoffStr;
            
            return cn(
              'text-gray-500 bg-gray-50/30',
              isLast && 'font-bold text-black dark:text-white cursor-pointer',
              isDelayed && 'bg-red-100 text-red-700 font-bold'
            );
          },
          cellStyle: (params) => {
            const stepData = params.data.stepData?.[step.id] || {};
            const plannedDate = params.value instanceof Date ? params.value : null;
            const hasActual = !!stepData.actualDate;
            const isDelayed = plannedDate && !hasActual && plannedDate.toISOString().split('T')[0] < effectiveCutoffStr;
            
            if (isDelayed) {
              return { backgroundColor: '#fee2e2' }; // Red color
            }
            return null;
          }
        },
        {
          headerName: 'Forecast',
          field: `stepData.${step.id}.forecastDate`,
          width: 110,
          valueFormatter: (p: ValueFormatterParams) => formatDate(p.value),
          cellClass: (params) => {
            const stepData = params.data.stepData?.[step.id] || {};
            const forecastDateStr = stepData.forecastDate;
            const hasActual = !!stepData.actualDate;
            const needsUpdate = forecastDateStr && !hasActual && forecastDateStr < effectiveCutoffStr;
            
            return cn(
              'font-semibold text-blue-600',
              needsUpdate && 'bg-amber-100 text-amber-700'
            );
          },
          cellStyle: (params) => {
            const stepData = params.data.stepData?.[step.id] || {};
            const forecastDateStr = stepData.forecastDate;
            const hasActual = !!stepData.actualDate;
            const needsUpdate = forecastDateStr && !hasActual && forecastDateStr < effectiveCutoffStr;
            
            if (needsUpdate) {
              return { backgroundColor: '#fef3c7' }; // Yellow color
            }
            return null;
          }
        },
        {
          headerName: 'Actual',
          field: `stepData.${step.id}.actualDate`,
          width: 110,
          editable: true,
          cellEditor: 'agDateCellEditor',
          valueGetter: (params) => {
            const val = params.data.stepData?.[step.id]?.actualDate;
            if (!val) return null;
            const d = val && typeof val === 'object' && 'seconds' in val ? new Date(val.seconds * 1000) : new Date(val);
            return isNaN(d.getTime()) ? null : d;
          },
          valueFormatter: (p: ValueFormatterParams) => formatDate(p.value),
          valueParser: (params) => {
            const val = params.newValue as any;
            if (val instanceof Date) {
              return val.toISOString().split('T')[0];
            }
            return params.newValue;
          },
        },
        {
          headerName: 'Dur',
          field: `stepData.${step.id}.planDuration`,
          width: 60,
          editable: true,
          headerClass: 'procurement-duration-header',
          valueParser: (params) => Number(params.newValue) || 0
        },
        {
          headerName: 'F.Dur',
          field: `stepData.${step.id}.forecastDuration`,
          width: 60,
          editable: true,
          headerClass: 'procurement-duration-header bg-blue-50/10',
          valueParser: (params) => Number(params.newValue) || 0
        }
      ]
    }));

    return [...baseCols, ...enterpriseAttrCols, ...projectAttrCols, ...stepCols] as ColDef[];
  }, [stepDefinitions, calendars]);

  const handleCellValueChanged = async (event: CellValueChangedEvent) => {
    const { data, colDef, newValue } = event;
    const field = colDef.field;
    if (!field) return;

    // Use a fresh copy to avoid stale closures and ensure correct nested property handling
    let updatedStepData = JSON.parse(JSON.stringify(data.stepData || {}));
    
    // Explicitly handle nested property update for Ag-Grid if it didn't update the object correctly
    if (field.startsWith('stepData.')) {
      const parts = field.split('.');
      if (parts.length === 3) {
        const [_, stepId, key] = parts;
        if (!updatedStepData[stepId]) updatedStepData[stepId] = {};
        
        let processedValue = newValue;
        if (key.includes('Duration')) {
          processedValue = Number(newValue) || 0;
        } else if (key.includes('Date')) {
          if (newValue instanceof Date) {
            processedValue = newValue.toISOString().split('T')[0];
          }
        }
        updatedStepData[stepId][key] = processedValue;
      }
    }

    const calendar = calendars.find(c => c.id === data.calendarId) || calendars[0] || { weekends: [0, 6], holidays: [] } as any;

    const lastStepId = stepDefinitions[stepDefinitions.length - 1]?.id;
    const isPlanDurationChange = field.includes('planDuration');
    const isLastStepPlannedDateChange = field === `stepData.${lastStepId}.plannedDate`;
    const isForecastDurationChange = field.includes('forecastDuration');
    const isActualDateChange = field.includes('actualDate');
    const isCalendarChange = field === 'calendarId';

    const needsPlanRecalc = isPlanDurationChange || isLastStepPlannedDateChange || isCalendarChange;
    const needsForecastRecalc = isActualDateChange || isForecastDurationChange || needsPlanRecalc;

    if (needsPlanRecalc) {
      updatedStepData = recalculatePlannedDates(updatedStepData, stepDefinitions, calendar);
    }
    
    if (needsForecastRecalc) {
      updatedStepData = recalculateForecastDates(updatedStepData, stepDefinitions, calendar, project.cutoffDate);
    }

    try {
      await updateDoc(doc(db, 'procurementItems', data.id), {
        stepData: updatedStepData,
        calendarId: data.calendarId || '',
        updatedAt: new Date().toISOString()
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `procurementItems/${data.id}`);
    }
  };

  const handleCreatePackage = async (packageId: string, description: string) => {
    // Uniqueness check
    if (items.some(item => item.packageId.toLowerCase() === packageId.toLowerCase())) {
      toast.error('Package ID already exists in this project');
      return;
    }

    try {
      const defaults = project.procurementDefaults;
      const initialStepData: Record<string, any> = {};
      
      const calendar = calendars.find(c => c.id === (defaults?.calendarId || (calendars.length > 0 ? calendars[0].id : ''))) || calendars[0] || { weekends: [0, 6], holidays: [] } as any;

      stepDefinitions.forEach(s => {
        const defaultDur = defaults?.stepDurations?.[s.id] ?? 5;
        initialStepData[s.id] = {
          planDuration: defaultDur,
          forecastDuration: defaultDur
        };
      });

      // Recalculate scheduled dates immediately
      const initialStepDataWithPlanned = recalculatePlannedDates(initialStepData, stepDefinitions, calendar);
      const finalInitialStepData = recalculateForecastDates(initialStepDataWithPlanned, stepDefinitions, calendar, project.cutoffDate);

      const now = new Date().toISOString();
      const path = 'procurementItems';
      await addDoc(collection(db, path), {
        projectId: project.id,
        packageId: packageId,
        description: description,
        calendarId: calendar.id || '',
        enterpriseAttributes: defaults?.attributeValues || {},
        projectAttributes: {},
        stepData: finalInitialStepData,
        createdAt: now,
        updatedAt: now
      });
      toast.success('Package added successfully');
      setIsCreateModalOpen(false);
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'procurementItems');
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.size} packages?`)) return;

    try {
      const batch = writeBatch(db);
      selectedIds.forEach(id => {
        batch.delete(doc(db, 'procurementItems', id));
      });
      await batch.commit();
      setSelectedIds(new Set());
      toast.success('Packages deleted');
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete packages');
    }
  };

  const handleCutoffDateChange = async (newDate: string) => {
    try {
      await updateDoc(doc(db, 'projects', project.id), {
        cutoffDate: newDate,
        dateLastModified: new Date().toISOString()
      });
      // Trigger a batch update for all items to recalculate based on new cutoff
      await handleRecalculateAll(newDate);
      toast.success('Cut-off date updated and schedule recalculated');
    } catch (e) {
      console.error(e);
      toast.error('Failed to update cut-off date');
    }
  };

  const handleRecalculateAll = async (cutoffOverride?: string) => {
    const targetCutoff = cutoffOverride || project.cutoffDate || new Date().toISOString().split('T')[0];
    const batch = writeBatch(db);
    let hasChanges = false;
    
    items.forEach(item => {
      const calendar = calendars.find(c => c.id === item.calendarId) || calendars[0] || { weekends: [0, 6], holidays: [] } as any;
      const stepDataWithPlanned = recalculatePlannedDates(item.stepData, stepDefinitions, calendar);
      const finalStepData = recalculateForecastDates(stepDataWithPlanned, stepDefinitions, calendar, targetCutoff);
      
      if (JSON.stringify(item.stepData) !== JSON.stringify(finalStepData)) {
        batch.update(doc(db, 'procurementItems', item.id), {
          stepData: finalStepData,
          updatedAt: new Date().toISOString()
        });
        hasChanges = true;
      }
    });

    if (hasChanges) {
      try {
        await batch.commit();
        if (!cutoffOverride) toast.success('All schedules recalculated');
      } catch (e) {
        console.error(e);
        toast.error('Failed to recalculate items');
      }
    } else if (!cutoffOverride) {
      toast.info('No changes detected in schedules');
    }
  };

  const handleExportExcel = () => {
    try {
      const allAttributes = [
        ...(enterprise.procurementAttributes || []),
        ...(project.procurementAttributes || [])
      ].filter(attr => attr.title);

      const exportData = items.map(item => {
        const row: Record<string, any> = {
          'Package ID': item.packageId,
          'Description': item.description,
          'Calendar': calendars.find(c => c.id === item.calendarId)?.name || item.calendarId
        };

        // Attributes
        allAttributes.forEach(attr => {
          const valId = item.enterpriseAttributes?.[attr.id] || item.projectAttributes?.[attr.id];
          row[attr.title] = attr.values?.find(v => v.id === valId)?.description || valId || '';
        });

        // Steps
        stepDefinitions.forEach(step => {
          const sd = item.stepData?.[step.id] || {};
          row[`${step.name} - Planned`] = sd.plannedDate || '';
          row[`${step.name} - Forecast`] = sd.forecastDate || '';
          row[`${step.name} - Actual`] = sd.actualDate || '';
          row[`${step.name} - Dur`] = sd.planDuration || '';
          row[`${step.name} - F.Dur`] = sd.forecastDuration || '';
        });

        return row;
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Procurement');
      XLSX.writeFile(wb, `Procurement_${project.projectName}_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('Excel file exported');
    } catch (e) {
      console.error(e);
      toast.error('Export failed');
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        if (data.length === 0) {
          toast.error('No data found in Excel sheet');
          return;
        }

        const batch = writeBatch(db);
        const now = new Date().toISOString();
        const allAttributes = [
          ...(enterprise.procurementAttributes || []),
          ...(project.procurementAttributes || [])
        ].filter(attr => attr.title);

        let updateCount = 0;
        let createCount = 0;

        for (const row of data) {
          const packageId = row['Package ID'] || row['packageId'];
          if (!packageId) continue;

          const description = row['Description'] || row['description'] || '';
          const calendarName = row['Calendar'] || row['calendar'];
          const calendarId = calendars.find(c => c.name === calendarName || c.id === calendarName)?.id || project.procurementDefaults?.calendarId || (calendars.length > 0 ? calendars[0].id : '');
          
          const existingItem = items.find(i => i.packageId === packageId);
          
          // Map Attributes
          const enterpriseAttributes: Record<string, string> = { ...existingItem?.enterpriseAttributes };
          const projectAttributes: Record<string, string> = { ...existingItem?.projectAttributes };

          allAttributes.forEach(attr => {
            const excelVal = row[attr.title];
            if (excelVal !== undefined) {
              const matchedVal = attr.values?.find(v => v.description === excelVal || v.id === excelVal)?.id || excelVal;
              if (enterprise.procurementAttributes?.some(ea => ea.id === attr.id)) {
                enterpriseAttributes[attr.id] = matchedVal;
              } else {
                projectAttributes[attr.id] = matchedVal;
              }
            }
          });

          // Map Step Data
          const stepData: Record<string, any> = { ...existingItem?.stepData };
          stepDefinitions.forEach(step => {
            if (!stepData[step.id]) stepData[step.id] = {};
            
            const planned = row[`${step.name} - Planned`];
            const forecast = row[`${step.name} - Forecast`];
            const actual = row[`${step.name} - Actual`];
            const dur = row[`${step.name} - Dur`];
            const fdur = row[`${step.name} - F.Dur`];

            if (planned !== undefined) stepData[step.id].plannedDate = planned;
            if (forecast !== undefined) stepData[step.id].forecastDate = forecast;
            if (actual !== undefined) stepData[step.id].actualDate = actual;
            if (dur !== undefined) stepData[step.id].planDuration = Number(dur) || 0;
            if (fdur !== undefined) stepData[step.id].forecastDuration = Number(fdur) || 0;
          });

          // Recalculate
          const cal = calendars.find(c => c.id === calendarId) || calendars[0] || { weekends: [0, 6], holidays: [] } as any;
          const afterPlanned = recalculatePlannedDates(stepData, stepDefinitions, cal);
          const finalSD = recalculateForecastDates(afterPlanned, stepDefinitions, cal, project.cutoffDate);

          if (existingItem) {
            batch.update(doc(db, 'procurementItems', existingItem.id), {
              description,
              calendarId,
              enterpriseAttributes,
              projectAttributes,
              stepData: finalSD,
              updatedAt: now
            });
            updateCount++;
          } else {
            const newItemRef = doc(collection(db, 'procurementItems'));
            batch.set(newItemRef, {
              projectId: project.id,
              packageId,
              description,
              calendarId,
              enterpriseAttributes,
              projectAttributes,
              stepData: finalSD,
              createdAt: now,
              updatedAt: now
            });
            createCount++;
          }
        }

        await batch.commit();
        toast.success(`Import complete: ${createCount} added, ${updateCount} updated`);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (e) {
        console.error(e);
        toast.error('Import failed - check console for details');
      }
    };
    reader.readAsBinaryString(file);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-white/10 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
              <ShoppingCart className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight dark:text-white">Procurement Tracking</h1>
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">{project.projectName}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 rounded-xl mr-2">
            <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-tight">Cut-Off:</span>
            <input 
              type="date" 
              value={project.cutoffDate || new Date().toISOString().split('T')[0]} 
              onChange={(e) => handleCutoffDateChange(e.target.value)}
              className="bg-transparent text-xs font-bold text-amber-900 dark:text-amber-200 focus:outline-none cursor-pointer"
            />
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              type="text" 
              placeholder="Filter packages..." 
              value={quickFilterText}
              onChange={(e) => setQuickFilterText(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-xs w-64 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:text-white transition-all shadow-sm"
            />
          </div>
          
          <div className="h-8 w-px bg-gray-200 dark:bg-white/10 mx-1" />

          <button 
            onClick={() => handleRecalculateAll()}
            className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-500 hover:text-blue-600 transition-all shadow-sm group"
            title="Recalculate All"
          >
            <Calculator className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-tight hidden lg:inline">Calculate</span>
          </button>

          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-400 hover:text-emerald-600 transition-all shadow-sm group"
            title="Import Excel"
          >
            <Upload className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-tight hidden lg:inline">Import</span>
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImportExcel} 
            accept=".xlsx, .xls" 
            className="hidden" 
          />

          <button 
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-gray-400 hover:text-blue-600 transition-all shadow-sm"
            title="Export Excel"
          >
            <Download className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-tight hidden lg:inline">Export</span>
          </button>
          {selectedIds.size > 0 && (
            <button 
              onClick={handleDeleteSelected}
              className="flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 border border-red-100 rounded-xl text-xs font-bold hover:bg-red-100 transition-all shadow-sm"
            >
              <Trash2 className="w-4 h-4" />
              Delete ({selectedIds.size})
            </button>
          )}
          <button 
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-6 py-2.5 bg-black dark:bg-white text-white dark:text-black rounded-xl text-xs font-bold hover:bg-black/90 dark:hover:bg-white/90 transition-all shadow-xl shadow-black/10"
          >
            <Plus className="w-4 h-4" />
            Add Package
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 p-4 overflow-hidden bg-gray-50 dark:bg-black/20">
        <div className="h-full rounded-2xl border border-gray-200 dark:border-white/10 overflow-hidden ag-theme-quartz shadow-2xl relative">
          <AgGridReact
            ref={gridRef}
            rowData={items}
            columnDefs={columnDefs}
            quickFilterText={quickFilterText}
            rowSelection="multiple"
            suppressRowClickSelection={true}
            onCellValueChanged={handleCellValueChanged}
            onSelectionChanged={() => {
              const nodes = gridRef.current?.api.getSelectedNodes();
              setSelectedIds(new Set(nodes?.map(n => n.data.id) || []));
            }}
            defaultColDef={{
              sortable: true,
              filter: true,
              resizable: true,
            }}
            gridOptions={{
              headerHeight: 48,
              groupHeaderHeight: 40,
            }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest px-6 shrink-0">
        <div className="flex gap-8">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            <span>Total: {items.length} Packages</span>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="w-3 h-3 text-blue-500" />
            <span>Defined Steps: {stepDefinitions.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-3 h-3 text-amber-500" />
            <span>Project Calendars: {calendars.length}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-3 h-3" />
          <span>Sync OK: {new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <style>{`
        .procurement-step-header {
          background-color: #000 !important;
          color: #fff !important;
          font-weight: 800 !important;
          font-size: 11px !important;
          text-transform: uppercase !important;
          letter-spacing: 0.05em !important;
        }
        .procurement-duration-header {
          background-color: #f8fafc !important;
          border-left: 2px solid #e2e8f0 !important;
        }
        .dark .procurement-duration-header {
          background-color: rgba(255, 255, 255, 0.03) !important;
          border-left: 2px solid rgba(255, 255, 255, 0.05) !important;
        }
      `}</style>

      <CreatePackageModal 
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreatePackage}
      />
    </div>
  );
}
