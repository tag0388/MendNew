import React, { useState, useMemo, useRef, useEffect } from 'react';
import { db } from '../firebase';
import { collection, addDoc, deleteDoc, doc, serverTimestamp, updateDoc, query, where, onSnapshot } from 'firebase/firestore';
import { Project, Enterprise, ProcurementStepDefinition, Calendar as ProjectCalendar } from '../types';
import { Plus, Trash2, Save, Settings, Calendar as CalendarIcon, Tag, Info } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { AgGridReact } from 'ag-grid-react';
import { ColDef, GridReadyEvent, CellValueChangedEvent } from 'ag-grid-community';

interface ProcurementStepConfigProps {
  project: Project;
  enterprise: Enterprise;
  currentSteps: ProcurementStepDefinition[];
  enterpriseSteps: ProcurementStepDefinition[];
}

export default function ProcurementStepConfig({ project, enterprise, currentSteps, enterpriseSteps }: ProcurementStepConfigProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newStepName, setNewStepName] = useState('');
  const [calendars, setCalendars] = useState<ProjectCalendar[]>([]);
  const [defaults, setDefaults] = useState(project.procurementDefaults || {
    calendarId: '',
    stepDurations: {},
    attributeValues: {}
  });
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);
  
  const gridRef = useRef<AgGridReact>(null);

  useEffect(() => {
    if (!project.id) return;
    const calQuery = query(collection(db, 'calendars'), where('projectId', '==', project.id));
    const unsubCal = onSnapshot(calQuery, (snapshot) => {
      setCalendars(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ProjectCalendar)));
    });
    return () => unsubCal();
  }, [project.id]);

  const handleAddStep = async () => {
    if (!newStepName) return;
    try {
      const maxOrder = currentSteps.length > 0 ? Math.max(...currentSteps.map(s => s.order || 0)) : 0;
      await addDoc(collection(db, 'procurementStepDefinitions'), {
        projectId: project.id,
        name: newStepName,
        order: maxOrder + 1,
        defaultDurationDays: 5,
        isEnterpriseStandard: false,
        createdAt: serverTimestamp()
      });
      setNewStepName('');
      setIsAdding(false);
      toast.success('Procurement step added');
    } catch (e) {
      console.error(e);
      toast.error('Failed to add step');
    }
  };

  const onCellValueChanged = async (params: CellValueChangedEvent) => {
    const { data } = params;
    try {
      await updateDoc(doc(db, 'procurementStepDefinitions', data.id), {
        name: data.name,
        order: Number(data.order) || 0,
        defaultDurationDays: Number(data.defaultDurationDays) || 0,
        enterpriseStepId: data.enterpriseStepId || ''
      });
      toast.success('Step updated');
    } catch (e) {
      console.error(e);
      toast.error('Failed to update step');
    }
  };

  const handleSaveDefaults = async () => {
    try {
      setIsSavingDefaults(true);
      await updateDoc(doc(db, 'projects', project.id), {
        procurementDefaults: defaults
      });
      toast.success('Project settings updated');
    } catch (e) {
      console.error(e);
      toast.error('Failed to update settings');
    } finally {
      setIsSavingDefaults(false);
    }
  };

  const columnDefs = useMemo<ColDef[]>(() => [
    { 
      headerName: 'Step Order', 
      field: 'order', 
      width: 120, 
      editable: true,
      sort: 'asc',
      cellEditor: 'agNumberCellEditor',
      cellStyle: { fontWeight: 'bold', display: 'flex', alignItems: 'center' }
    },
    { 
      headerName: 'Step Name', 
      field: 'name', 
      flex: 1, 
      editable: true,
      cellStyle: { fontWeight: '500', display: 'flex', alignItems: 'center' }
    },
    { 
      headerName: 'Step Default Duration (days)', 
      field: 'defaultDurationDays', 
      width: 220, 
      editable: true,
      cellEditor: 'agNumberCellEditor',
      cellStyle: { display: 'flex', alignItems: 'center' },
      valueFormatter: (params) => params.value !== undefined ? `${params.value} days` : '0 days'
    },
    { 
      headerName: 'Enterprise Step Mapping', 
      field: 'enterpriseStepId', 
      flex: 1, 
      editable: true,
      cellEditor: 'agRichSelectCellEditor',
      cellStyle: { display: 'flex', alignItems: 'center' },
      cellEditorParams: {
        values: ['', ...enterpriseSteps.map(s => s.id)],
        valueFormatter: (params: any) => {
          if (!params.value) return 'Not Mapped';
          const step = enterpriseSteps.find(s => s.id === params.value);
          return step ? (step.order?.toString() || params.value) : params.value;
        },
        searchType: 'matchAny',
        allowTyping: true,
        filterList: true
      },
      valueFormatter: (params) => {
        if (!params.value) return 'Not Mapped';
        const step = enterpriseSteps.find(s => s.id === params.value);
        return step ? (step.order?.toString() || params.value) : params.value;
      }
    },
    {
      headerName: '',
      width: 70,
      suppressMenu: true,
      sortable: false,
      cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
      cellRenderer: (params: any) => (
        <button 
          onClick={async () => {
            if (confirm(`Delete step "${params.data.name}"?`)) {
              await deleteDoc(doc(db, 'procurementStepDefinitions', params.data.id));
              toast.success('Step deleted');
            }
          }}
          className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )
    }
  ], [enterpriseSteps]);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    filter: true,
    resizable: true
  }), []);

  const sortedSteps = useMemo(() => {
    return [...currentSteps].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [currentSteps]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-8 space-y-8"
    >
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold tracking-tight dark:text-white">Procurement Configuration</h2>
          <p className="text-sm text-gray-500 mt-1">Configure project tracking steps, durations, and enterprise mapping.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-6 py-2.5 bg-black dark:bg-white text-white dark:text-black rounded-xl text-xs font-bold hover:bg-black/90 dark:hover:bg-white/90 transition-all shadow-lg"
          >
            <Plus className="w-4 h-4" />
            Add Project Step
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* Main Configuration Table */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-6">
              <Settings className="w-5 h-5 text-blue-600" />
              <h3 className="text-lg font-bold dark:text-white">Tracking Step Configuration</h3>
            </div>
            
            <div className="h-[500px] w-full ag-theme-alpine dark:ag-theme-alpine-dark rounded-xl overflow-hidden border border-gray-200 dark:border-white/10">
              <AgGridReact
                ref={gridRef}
                rowData={sortedSteps}
                columnDefs={columnDefs}
                defaultColDef={defaultColDef}
                onCellValueChanged={onCellValueChanged}
                animateRows={true}
                headerHeight={44}
                rowHeight={44}
                suppressCellFocus={true}
              />
            </div>
            
            <div className="mt-4 flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-500/5 rounded-xl text-[10px] text-blue-600 dark:text-blue-400 font-medium">
              <Info className="w-3.5 h-3.5" />
              Changes to row data are saved automatically as you edit.
            </div>
          </div>
        </div>
      </div>

      {/* Add Dialog */}
      {isAdding && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-[#141414] w-full max-w-md rounded-3xl p-8 shadow-2xl border border-gray-200 dark:border-white/10"
          >
            <h3 className="text-xl font-bold dark:text-white mb-2">New Procurement Step</h3>
            <p className="text-sm text-gray-500 mb-6">Add a milestone tracking row to your project configuration.</p>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Step Name</label>
                <input 
                  autoFocus
                  className="w-full h-12 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl px-5 text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="e.g., Internal Approval"
                  value={newStepName}
                  onChange={e => setNewStepName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddStep()}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button 
                onClick={() => setIsAdding(false)}
                className="flex-1 py-3 text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 rounded-2xl transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={handleAddStep}
                className="flex-1 py-3 bg-blue-600 text-white text-sm font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
              >
                Add Step
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}

