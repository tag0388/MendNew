import React, { useState, useEffect } from 'react';
import { Calendar as ProjectCalendar } from '../types';
import { db, auth } from '../firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDocs
} from 'firebase/firestore';
import { 
  Plus, 
  Trash2, 
  Edit2, 
  Save, 
  X, 
  Calendar as CalendarIcon,
  Check,
  Download,
  ChevronRight,
  Info
} from 'lucide-react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';

interface CalendarManagerProps {
  projectId?: string;
  enterpriseId?: string;
  title: string;
  description: string;
  allowImport?: boolean;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const DAYS = [
  { id: 0, label: 'Sun' },
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' }
];

export default function CalendarManager({ projectId, enterpriseId, title, description, allowImport }: CalendarManagerProps) {
  const [calendars, setCalendars] = useState<ProjectCalendar[]>([]);
  const [enterpriseCalendars, setEnterpriseCalendars] = useState<ProjectCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [formData, setFormData] = useState<Partial<ProjectCalendar>>({
    name: '',
    weekends: [0, 6],
    holidays: []
  });
  
  // Multi-select state for holidays
  const [selectedHolidays, setSelectedHolidays] = useState<Date[]>([]);

  useEffect(() => {
    const q = query(
      collection(db, 'calendars'),
      where(projectId ? 'projectId' : 'enterpriseId', '==', projectId || enterpriseId)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectCalendar));
      setCalendars(data);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.GET, 'calendars');
    });
    return () => unsub();
  }, [projectId, enterpriseId]);

  useEffect(() => {
    if (allowImport && projectId && enterpriseId) {
      // Fetch enterprise calendars for importing
      const fetchEnterpriseCalendars = async () => {
        try {
          const q = query(
            collection(db, 'calendars'), 
            where('enterpriseId', '==', enterpriseId)
          );
          const snapshot = await getDocs(q);
          const data = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as ProjectCalendar));
          setEnterpriseCalendars(data);
        } catch (error) {
          console.error('Error fetching enterprise calendars:', error);
        }
      };
      fetchEnterpriseCalendars();
    }
  }, [allowImport, projectId, enterpriseId]);

  const handleSave = async () => {
    if (!formData.name) {
      toast.error('Calendar name is required');
      return;
    }

    // Check for duplicate names
    const isDuplicate = calendars.some(c => 
      c.name.toLowerCase() === formData.name?.toLowerCase() && c.id !== isEditing
    );

    if (isDuplicate) {
      toast.error(`A calendar with the name "${formData.name}" already exists.`);
      return;
    }

    try {
      const dataToSave = {
        ...formData,
        holidays: selectedHolidays.map(d => {
          const year = d.getFullYear();
          const month = (d.getMonth() + 1).toString().padStart(2, '0');
          const day = d.getDate().toString().padStart(2, '0');
          return `${year}-${month}-${day}`;
        }).sort(),
        createdAt: formData.createdAt || new Date().toISOString()
      };

      if (isEditing) {
        await updateDoc(doc(db, 'calendars', isEditing), dataToSave);
        toast.success('Calendar updated');
      } else {
        await addDoc(collection(db, 'calendars'), {
          ...dataToSave,
          projectId: projectId || null,
          enterpriseId: enterpriseId || null,
        });
        toast.success('Calendar created');
      }
      resetForm();
    } catch (error) {
      handleFirestoreError(error, isEditing ? OperationType.UPDATE : OperationType.CREATE, 'calendars');
    }
  };

  const handleImport = async (cal: ProjectCalendar) => {
    const importedName = `${cal.name} (Imported)`;
    
    // Check for duplicate names
    const isDuplicate = calendars.some(c => 
      c.name.toLowerCase() === importedName.toLowerCase()
    );

    if (isDuplicate) {
      toast.error(`A calendar with the name "${importedName}" already exists in this project.`);
      return;
    }

    try {
      await addDoc(collection(db, 'calendars'), {
        name: importedName,
        weekends: cal.weekends,
        holidays: cal.holidays,
        projectId: projectId,
        createdAt: new Date().toISOString()
      });
      toast.success('Calendar imported from Enterprise');
      setIsImporting(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'calendars');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this calendar?')) return;
    try {
      await deleteDoc(doc(db, 'calendars', id));
      toast.success('Calendar deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `calendars/${id}`);
    }
  };

  const resetForm = () => {
    setIsEditing(null);
    setIsAdding(false);
    setFormData({
      name: '',
      weekends: [0, 6],
      holidays: []
    });
    setSelectedHolidays([]);
  };

  const toggleWeekend = (dayId: number) => {
    const current = formData.weekends || [];
    if (current.includes(dayId)) {
      setFormData({ ...formData, weekends: current.filter(d => d !== dayId) });
    } else {
      setFormData({ ...formData, weekends: [...current, dayId] });
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading calendars...</div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-gray-100 dark:border-white/10 flex justify-between items-center bg-gray-50/50 dark:bg-white/5 shrink-0">
        <div>
          <h3 className="text-xl font-bold dark:text-white">{title}</h3>
          <p className="text-sm text-gray-500">{description}</p>
        </div>
        <div className="flex gap-2">
          {allowImport && (
            <button 
              onClick={() => setIsImporting(true)}
              className="flex items-center gap-2 bg-white dark:bg-white/5 text-black dark:text-white border border-gray-200 dark:border-white/10 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-50 dark:hover:bg-white/10 transition-all"
            >
              <Download className="w-4 h-4" />
              Import from Enterprise
            </button>
          )}
          <button 
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded-xl text-sm font-bold hover:bg-black/90 dark:hover:bg-white/90 transition-all shadow-lg shadow-black/10"
          >
            <Plus className="w-4 h-4" />
            Add Calendar
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
        {calendars.length === 0 && !isAdding && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 bg-gray-50 dark:bg-white/5 rounded-full flex items-center justify-center mb-4">
              <CalendarIcon className="w-8 h-8 text-gray-300" />
            </div>
            <p className="text-gray-500 text-sm">No calendars defined yet.</p>
            <p className="text-gray-400 text-xs mt-1">Add a calendar to start considering holidays in phasing.</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {calendars.map(cal => (
            <div key={cal.id} className="p-5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl hover:border-black dark:hover:border-white transition-all group">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h4 className="font-bold dark:text-white">{cal.name}</h4>
                  <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold mt-1">
                    {cal.weekends.length} Weekends • {cal.holidays.length} Holidays
                  </p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => {
                      setFormData(cal);
                      setSelectedHolidays((cal.holidays || []).map(d => {
                        const [year, month, day] = d.split('-').map(Number);
                        return new Date(year, month - 1, day);
                      }));
                      setIsEditing(cal.id);
                    }}
                    className="p-2 text-gray-400 hover:text-black dark:hover:text-white hover:bg-white dark:hover:bg-white/10 rounded-lg transition-all"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => handleDelete(cal.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-white dark:hover:bg-white/10 rounded-lg transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Weekends</p>
                  <div className="flex gap-1">
                    {DAYS.map(day => (
                      <div 
                        key={day.id}
                        className={cn(
                          "w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold border transition-all",
                          cal.weekends.includes(day.id)
                            ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600"
                            : "bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-400"
                        )}
                      >
                        {day.label[0]}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {(isAdding || isEditing) && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[100] p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-4xl shadow-2xl border border-gray-200 dark:border-white/10 overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold dark:text-white">{isEditing ? 'Edit' : 'Add'} Calendar</h2>
                <button onClick={resetForm} className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Calendar Name</label>
                    <input 
                      type="text"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Standard 5-Day, Site Calendar..."
                      className="w-full p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Non-Working Days (Weekends)</label>
                    <div className="flex flex-wrap gap-2">
                      {DAYS.map(day => (
                        <button
                          key={day.id}
                          onClick={() => toggleWeekend(day.id)}
                          className={cn(
                            "px-4 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-2",
                            formData.weekends?.includes(day.id)
                              ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600"
                              : "bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-500 hover:border-black dark:hover:border-white"
                          )}
                        >
                          {formData.weekends?.includes(day.id) && <Check className="w-3 h-3" />}
                          {day.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 rounded-2xl flex gap-3">
                    <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-blue-700 dark:text-blue-400 mb-1">How to add holidays</p>
                      <p className="text-[10px] text-blue-600/80 dark:text-blue-400/60 leading-relaxed">
                        Select multiple dates on the calendar to mark them as public holidays. These days will be skipped during auto-phasing calculations.
                      </p>
                    </div>
                  </div>

                  <div className="pt-4">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Selected Holidays ({selectedHolidays.length})</label>
                    <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                      {selectedHolidays.sort((a, b) => a.getTime() - b.getTime()).map(date => (
                        <div key={date.toISOString()} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg">
                          <span className="text-[10px] font-bold dark:text-white">{date.toLocaleDateString('en-GB')}</span>
                          <button 
                            onClick={() => setSelectedHolidays(prev => prev.filter(d => d.toISOString() !== date.toISOString()))}
                            className="text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      {selectedHolidays.length === 0 && (
                        <p className="text-[10px] text-gray-400 italic">No holidays selected.</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-3xl p-6 flex flex-col items-center">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-4 self-start">Select Holidays</label>
                  <div className="calendar-container dark:text-white">
                    <DayPicker
                      mode="multiple"
                      selected={selectedHolidays}
                      onSelect={(days) => setSelectedHolidays(days || [])}
                      className="border-none"
                      modifiers={{
                        weekend: (date) => formData.weekends?.includes(date.getDay()) || false
                      }}
                      modifiersClassNames={{
                        weekend: 'rdp-day_weekend'
                      }}
                      styles={{
                        day: { margin: '2px' },
                        selected: { backgroundColor: 'black', color: 'white', borderRadius: '12px' }
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t border-gray-100 dark:border-white/10 mt-6">
                <button onClick={resetForm} className="px-6 py-3 text-sm font-bold text-gray-500 hover:text-black dark:hover:text-white transition-colors">Cancel</button>
                <button 
                  onClick={handleSave}
                  className="px-8 py-3 bg-black dark:bg-white text-white dark:text-black rounded-2xl text-sm font-bold hover:bg-black/90 dark:hover:bg-white/90 transition-all shadow-xl shadow-black/10"
                >
                  <Save className="w-4 h-4 inline-block mr-2" />
                  {isEditing ? 'Update' : 'Create'} Calendar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isImporting && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[100] p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-[#141414] rounded-3xl p-8 w-full max-w-2xl shadow-2xl border border-gray-200 dark:border-white/10 overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-xl font-bold dark:text-white">Import Enterprise Calendar</h2>
                  <p className="text-sm text-gray-500">Select a standard calendar to copy to this project.</p>
                </div>
                <button onClick={() => setIsImporting(false)} className="p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3">
                {enterpriseCalendars.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-gray-500 text-sm italic">No enterprise calendars available to import.</p>
                  </div>
                ) : (
                  enterpriseCalendars.map(cal => (
                    <div 
                      key={cal.id} 
                      className="p-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl flex items-center justify-between hover:border-black dark:hover:border-white transition-all group"
                    >
                      <div>
                        <h4 className="font-bold dark:text-white">{cal.name}</h4>
                        <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold mt-1">
                          {cal.weekends.length} Weekends • {cal.holidays.length} Holidays
                        </p>
                      </div>
                      <button 
                        onClick={() => handleImport(cal)}
                        className="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-xl text-xs font-bold hover:bg-black/90 dark:hover:bg-white/90 transition-all flex items-center gap-2"
                      >
                        <Download className="w-3 h-3" />
                        Import
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .calendar-container .rdp {
          --rdp-cell-size: 40px;
          --rdp-accent-color: #000;
          --rdp-background-color: #f3f4f6;
          margin: 0;
        }
        .dark .calendar-container .rdp {
          --rdp-accent-color: #fff;
          --rdp-background-color: rgba(255, 255, 255, 0.1);
        }
        .calendar-container .rdp-day_selected {
          background-color: var(--rdp-accent-color) !important;
          color: var(--rdp-background-color) !important;
          font-weight: bold;
          border-radius: 10px;
        }
        .calendar-container .rdp-button:hover:not([disabled]):not(.rdp-day_selected) {
          background-color: var(--rdp-background-color);
          border-radius: 10px;
        }
        .calendar-container .rdp-day_weekend:not(.rdp-day_selected) {
          background-color: #f3f4f6 !important;
          color: #9ca3af !important;
          border-radius: 10px;
        }
        .dark .calendar-container .rdp-day_weekend:not(.rdp-day_selected) {
          background-color: rgba(255, 255, 255, 0.05) !important;
          color: #4b5563 !important;
        }
      `}</style>
    </div>
  );
}
