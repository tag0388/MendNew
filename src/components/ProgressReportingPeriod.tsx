import React, { useState, useEffect } from 'react';
import { Project } from '../types';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { 
  doc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { Calendar, Save, Calculator, Trash2, Lock, Unlock, Plus, AlertTriangle, RefreshCw, Eye, FileText, CheckCircle2 } from 'lucide-react';
import { addMonths, addWeeks, subDays, format, parseISO, isWithinInterval } from 'date-fns';
import { toast } from 'sonner';
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProgressReportingPeriodProps {
  project: Project;
  isAdmin?: boolean;
}

interface Period {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'open' | 'closed';
}

const ProgressReportingPeriod: React.FC<ProgressReportingPeriodProps> = ({ project, isAdmin: isAdminProp }) => {
  const [baseDate, setBaseDate] = useState(project.progressPeriods?.baseDate || '');
  const [duration, setDuration] = useState<'week' | 'month'>(project.progressPeriods?.duration || 'week');
  const [numberOfPeriods, setNumberOfPeriods] = useState<number>(project.progressPeriods?.numberOfPeriods || 12);
  const [periods, setPeriods] = useState<Period[]>(project.progressPeriods?.periods || []);
  const [currentPeriodId, setCurrentPeriodId] = useState<string | undefined>(project.progressPeriods?.currentPeriodId);
  const [saving, setSaving] = useState(false);
  const [isRollingOver, setIsRollingOver] = useState(false);
  const [isRollOverConfirmOpen, setIsRollOverConfirmOpen] = useState(false);

  const isAdmin = isAdminProp ?? (project.users?.[auth.currentUser?.uid || ''] === 'Project Admin' || (auth.currentUser?.email?.toLowerCase() === 'tarek.guindy@gmail.com'));
  const hasClosedPeriods = periods.some(p => p.status === 'closed');

  useEffect(() => {
    if (project.progressPeriods) {
      setBaseDate(project.progressPeriods.baseDate || '');
      setDuration(project.progressPeriods.duration || 'week');
      setNumberOfPeriods(project.progressPeriods.numberOfPeriods || 12);
      setPeriods((project.progressPeriods.periods || []).map((p: any) => ({
        ...p,
        status: p.status || 'open'
      })));
      setCurrentPeriodId(project.progressPeriods.currentPeriodId);
    }
  }, [project.progressPeriods]);

  // Migration from legacy collection if project field is empty
  useEffect(() => {
    const migrateLegacyPeriods = async () => {
      if (!project.progressPeriods?.periods || project.progressPeriods.periods.length === 0) {
        try {
          const q = query(collection(db, 'progressReportingPeriods'), where('projectId', '==', project.id));
          const snap = await getDocs(q);
          if (!snap.empty) {
            const legacyPeriods = snap.docs.map(docSnap => {
              const data = docSnap.data();
              return {
                id: docSnap.id,
                name: data.periodName || data.name,
                startDate: data.startDate,
                endDate: data.endDate,
                status: data.status || 'open'
              } as Period;
            }).sort((a, b) => a.startDate.localeCompare(b.startDate));
            
            if (legacyPeriods.length > 0) {
              const first = legacyPeriods[0];
              await handleSave(legacyPeriods, first.startDate, 'week', legacyPeriods.length, first.id);
            }
          }
        } catch (error) {
          console.error("Migration error:", error);
        }
      }
    };
    migrateLegacyPeriods();
  }, [project.id]);

  const handleCalculate = async () => {
    if (!baseDate || numberOfPeriods <= 0) {
      toast.error('Please select a valid base date and number of periods.');
      return;
    }

    const newPeriods: Period[] = [];
    let currentStartDate = parseISO(baseDate);

    for (let i = 1; i <= numberOfPeriods; i++) {
      let currentEndDate;
      if (duration === 'month') {
        currentEndDate = subDays(addMonths(currentStartDate, 1), 1);
      } else {
        currentEndDate = subDays(addWeeks(currentStartDate, 1), 1);
      }

      newPeriods.push({
        id: i.toString(),
        name: `P${i}`,
        startDate: format(currentStartDate, 'yyyy-MM-dd'),
        endDate: format(currentEndDate, 'yyyy-MM-dd'),
        status: 'open'
      });

      currentStartDate = duration === 'month' ? addMonths(currentStartDate, 1) : addWeeks(currentStartDate, 1);
    }

    const today = new Date();
    const current = newPeriods.find(p => {
      const start = parseISO(p.startDate);
      const end = parseISO(p.endDate);
      return isWithinInterval(today, { start, end });
    });

    const newCurrentId = current?.id || (newPeriods.length > 0 ? newPeriods[0].id : undefined);
    
    setPeriods(newPeriods);
    setCurrentPeriodId(newCurrentId);
    await handleSave(newPeriods, baseDate, duration, numberOfPeriods, newCurrentId);
    toast.success('Periods calculated and saved.');
  };

  const handleExtendPeriod = async () => {
    if (periods.length === 0) {
      handleCalculate();
      return;
    }

    const lastPeriod = periods[periods.length - 1];
    let currentStartDate = duration === 'month' 
      ? addMonths(parseISO(lastPeriod.startDate), 1)
      : addWeeks(parseISO(lastPeriod.startDate), 1);
    
    let currentEndDate = duration === 'month'
      ? subDays(addMonths(currentStartDate, 1), 1)
      : subDays(addWeeks(currentStartDate, 1), 1);

    const nextId = (periods.length + 1).toString();
    const newPeriod: Period = {
      id: nextId,
      name: `P${nextId}`,
      startDate: format(currentStartDate, 'yyyy-MM-dd'),
      endDate: format(currentEndDate, 'yyyy-MM-dd'),
      status: 'open'
    };

    const newPeriods = [...periods, newPeriod];
    const newNum = newPeriods.length;
    setPeriods(newPeriods);
    setNumberOfPeriods(newNum);
    await handleSave(newPeriods, baseDate, duration, newNum, currentPeriodId);
    toast.success('Period extended and saved.');
  };

  const handleDeleteLastPeriod = async () => {
    if (periods.length === 0) return;
    const lastPeriod = periods[periods.length - 1];
    if (lastPeriod.status === 'closed') {
      toast.error('Cannot delete a closed period.');
      return;
    }
    const newPeriods = periods.slice(0, -1);
    const newNum = newPeriods.length;
    let newCurrentId = currentPeriodId;
    if (currentPeriodId === lastPeriod.id) {
      newCurrentId = newPeriods.length > 0 ? newPeriods[newPeriods.length - 1].id : undefined;
    }
    
    setPeriods(newPeriods);
    setNumberOfPeriods(newNum);
    setCurrentPeriodId(newCurrentId);
    await handleSave(newPeriods, baseDate, duration, newNum, newCurrentId);
    toast.success('Last period deleted and changes saved.');
  };

  const handleRollOver = async () => {
    if (!isAdmin) {
      toast.error('Only Project Admins can roll over periods.');
      return;
    }

    const openPeriods = periods.filter(p => p.status === 'open');
    if (openPeriods.length === 0) {
      toast.error('No open periods to roll over.');
      return;
    }

    setIsRollingOver(true);
    setIsRollOverConfirmOpen(false);
    const toastId = toast.loading('Rolling over period and capturing progress actuals...');
    try {
      const firstOpenPeriod = openPeriods[0];
      
      // Store actuals for all progress items before closing the period
      // Note: the app uses 'progressItems' collection for commodities
      const itemsSnap = await getDocs(query(collection(db, 'progressItems'), where('projectId', '==', project.id)));
      
      if (itemsSnap.empty) {
        toast.loading('No progress items to process. Proceeding with period update...', { id: toastId });
      } else {
        toast.loading(`Processing ${itemsSnap.size} items...`, { id: toastId });
      }
      
      const rocSnap = await getDocs(query(collection(db, 'rulesOfCredit'), where('projectId', '==', project.id)));
      const rocs = rocSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      let batch = writeBatch(db);
      let opCount = 0;

      if (!itemsSnap.empty) {
        for (const docSnap of itemsSnap.docs) {
          const item = docSnap.data();
          const roc = rocs.find(r => r.id === item.ruleOfCreditId || r.ruleId === item.ruleOfCreditId);
          
          let earned = 0;
          if (roc?.steps) {
            const progress = item.ruleOfCreditProgress || {};
            const percent = roc.steps.reduce((sum: number, step: any) => {
              const stepProgress = progress[step.id] || 0;
              return sum + (stepProgress * step.weight / 100);
            }, 0);
            earned = (percent / 100) * (item.totalQty || 0);
          }

          const prevEarned = item.earnedQtyPrevious || 0;
          const currentActual = Math.max(0, earned - prevEarned);

          const actualPeriodValues = { ...(item.actualPeriodValues || {}) };
          actualPeriodValues[firstOpenPeriod.id] = currentActual;

          batch.update(docSnap.ref, {
            actualPeriodValues,
            earnedQtyPrevious: earned,
            updatedAt: new Date().toISOString()
          });
          
          opCount++;
          if (opCount >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            opCount = 0;
          }
        }
        await batch.commit();
      }

      const nextOpenPeriod = openPeriods[1];

      const newPeriods = periods.map(p => 
        p.id === firstOpenPeriod.id ? { ...p, status: 'closed' as const } : p
      );
      
      let newCurrentId = currentPeriodId;
      if (nextOpenPeriod) {
        newCurrentId = nextOpenPeriod.id;
      } else {
        newCurrentId = undefined;
      }

      // Update project document
      toast.loading('Saving period updates to project...', { id: toastId });
      await updateDoc(doc(db, 'projects', project.id), {
        progressPeriods: {
          baseDate: baseDate,
          duration: duration,
          numberOfPeriods: numberOfPeriods,
          periods: newPeriods,
          currentPeriodId: newCurrentId || null
        }
      });
      
      setPeriods(newPeriods);
      setCurrentPeriodId(newCurrentId);

      if (nextOpenPeriod) {
        toast.success(`${firstOpenPeriod.name} closed. Current period is now ${nextOpenPeriod.name}.`, { id: toastId });
      } else {
        toast.success(`${firstOpenPeriod.name} closed. No more open periods.`, { id: toastId });
      }
    } catch (error: any) {
      console.error('Error during roll over:', error);
      // Catch permission errors or other critical Firestore failures for diagnosis
      const shouldLog = error.code === 'permission-denied' || 
                        error.code === 'invalid-argument' || 
                        error.code === 'resource-exhausted' ||
                        (error.message && error.message.includes('permissions'));
      if (shouldLog) {
        try {
          handleFirestoreError(error, OperationType.WRITE, 'progress_roll_over');
        } catch (e) {
          // ensure we still show the toast
        }
      }
      toast.error(`Failed to roll over period: ${error.message || 'Unknown error'}`, { id: toastId });
    } finally {
      setIsRollingOver(false);
    }
  };

  const handleSave = async (
    updatedPeriods = periods,
    updatedBaseDate = baseDate,
    updatedDuration = duration,
    updatedNum = numberOfPeriods,
    updatedCurrent = currentPeriodId
  ) => {
    if (!project.id) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'projects', project.id), {
        progressPeriods: {
          baseDate: updatedBaseDate,
          duration: updatedDuration,
          numberOfPeriods: updatedNum,
          periods: updatedPeriods,
          currentPeriodId: updatedCurrent || null
        }
      });
    } catch (error) {
      console.error('Error saving progress periods:', error);
      toast.error('Failed to save changes to database. Please check your permissions.');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (periods.some(p => p.status === 'closed')) {
      toast.error('Cannot clear periods because some are already closed.');
      return;
    }
    setPeriods([]);
    setCurrentPeriodId(undefined);
    await handleSave([], baseDate, duration, numberOfPeriods, undefined);
    toast.info('All periods cleared and saved.');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#141414] overflow-hidden">
      <div className="p-6 border-b border-gray-100 dark:border-white/10 flex justify-between items-center bg-gray-50/50 dark:bg-white/5 shrink-0">
        <div>
          <h3 className="text-xl font-bold dark:text-white">Progress Reporting Period</h3>
          <p className="text-sm text-gray-900 dark:text-gray-400">Define the periodic reporting intervals for progress tracking.</p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => setIsRollOverConfirmOpen(true)}
            disabled={periods.length === 0 || !periods.some(p => p.status === 'open') || !isAdmin || isRollingOver}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50 border-none"
          >
            <Lock className="w-4 h-4" />
            {isRollingOver ? 'Rolling Over...' : 'Roll Over / Close Period'}
          </Button>
        </div>
      </div>

      {/* Roll Over Confirmation Dialog */}
      <Dialog open={isRollOverConfirmOpen} onOpenChange={setIsRollOverConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Confirm Period Roll Over
            </DialogTitle>
            <DialogDescription className="pt-2">
              Are you sure you want to close the current period: <span className="font-bold text-gray-900 dark:text-white">{periods.find(p => p.status === 'open')?.name}</span>?
              <br /><br />
              This will:
              <ul className="list-disc pl-5 mt-2 space-y-1 text-xs">
                <li>Capture and lock current physical progress for all items</li>
                <li>Archive the period and move to the next reporting interval</li>
                <li>This action <strong>cannot be undone</strong></li>
              </ul>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6 flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsRollOverConfirmOpen(false)}
              className="rounded-xl font-bold"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRollOver}
              className="bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl font-bold shadow-lg shadow-emerald-600/20 px-8"
              disabled={isRollingOver}
            >
              {isRollingOver ? 'Rolling Over...' : 'Yes, Roll Over Period'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Configuration Form */}
          <div className="bg-white dark:bg-[#1a1a1a] p-6 rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm transition-all duration-300">
            <h4 className="text-sm font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-6">Period Configuration</h4>
            
            {hasClosedPeriods && (
              <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 rounded-xl flex gap-3">
                <Lock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-400">Configuration Locked</p>
                  <p className="text-[10px] text-amber-600/80 dark:text-amber-400/60 leading-relaxed">
                    Reporting periods have been locked (closed). You can no longer change initial configuration. You can still extend the schedule or delete the last open period.
                  </p>
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-900 dark:text-gray-400 mb-2">Base Date</label>
                <input 
                  type="date" 
                  value={baseDate}
                  disabled={hasClosedPeriods}
                  onChange={e => {
                    setBaseDate(e.target.value);
                    handleSave(periods, e.target.value, duration, numberOfPeriods, currentPeriodId);
                  }}
                  className="w-full p-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-900 dark:text-gray-400 mb-2">Duration</label>
                <select
                  value={duration}
                  disabled={hasClosedPeriods}
                  onChange={e => {
                    const val = e.target.value as 'week' | 'month';
                    setDuration(val);
                    handleSave(periods, baseDate, val, numberOfPeriods, currentPeriodId);
                  }}
                  className="w-full p-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50 transition-all cursor-pointer"
                >
                  <option value="week">Weekly</option>
                  <option value="month">Monthly</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-900 dark:text-gray-400 mb-2">Number of Periods</label>
                <input 
                  type="number" 
                  min="1"
                  max="520"
                  value={numberOfPeriods}
                  disabled={hasClosedPeriods}
                  onChange={e => {
                    const val = Number(e.target.value);
                    setNumberOfPeriods(val);
                    handleSave(periods, baseDate, duration, val, currentPeriodId);
                  }}
                  className="w-full p-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50 transition-all shadow-sm"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex gap-2 w-full sm:w-auto">
                <Button 
                  onClick={handleExtendPeriod}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-gray-100 dark:bg-white/5 text-gray-900 dark:text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-200 dark:hover:bg-white/10 transition-all border-none"
                >
                  <Plus className="w-4 h-4" />
                  Extend Period
                </Button>
                <Button 
                  onClick={handleDeleteLastPeriod}
                  disabled={periods.length === 0}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-red-50 dark:bg-red-500/10 text-red-600 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-red-100 dark:hover:bg-red-500/20 transition-all border-none disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Last
                </Button>
              </div>
              <Button 
                onClick={handleCalculate}
                disabled={hasClosedPeriods || saving}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-black dark:bg-white text-white dark:text-black px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-black/90 dark:hover:bg-white/90 transition-all shadow-lg shadow-black/10 disabled:opacity-50 border-none"
              >
                <Calculator className="w-4 h-4" />
                {saving ? 'Saving...' : 'Calculate & Populate Periods'}
              </Button>
            </div>
          </div>

          {/* Generated Periods Table */}
          {periods.length > 0 ? (
            <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 flex justify-between items-center">
                <h4 className="font-bold dark:text-white flex items-center gap-2">
                  Generated Periods 
                  <span className="px-2 py-0.5 bg-gray-200 dark:bg-white/10 rounded text-[10px] text-gray-500 dark:text-gray-400">{periods.length}</span>
                </h4>
                <button 
                  onClick={handleClear}
                  disabled={hasClosedPeriods}
                  className="text-red-500 hover:text-red-600 text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear All
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-100 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Name</th>
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Start Date</th>
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">End Date</th>
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Status & Current</th>
                      <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                    {periods.map(period => (
                      <tr key={period.id} className={cn("transition-colors hover:bg-gray-50 dark:hover:bg-white/5", currentPeriodId === period.id && "bg-blue-50/50 dark:bg-blue-500/5")}>
                        <td className="p-4">
                          <input 
                            type="text" 
                            disabled={period.status === 'closed'}
                            value={period.name}
                            onChange={(e) => {
                              const newName = e.target.value;
                              const newPeriods = periods.map(p => p.id === period.id ? { ...p, name: newName } : p);
                              setPeriods(newPeriods);
                            }}
                            onBlur={() => handleSave(periods, baseDate, duration, numberOfPeriods, currentPeriodId)}
                            className="w-full p-2 bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-white/10 focus:border-blue-500 focus:bg-white dark:focus:bg-[#1a1a1a] rounded-lg text-sm outline-none dark:text-white transition-all disabled:opacity-50"
                          />
                        </td>
                        <td className="p-4 text-xs font-mono dark:text-white">{period.startDate}</td>
                        <td className="p-4 text-xs font-mono dark:text-white">{period.endDate}</td>
                        <td className="p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn(
                              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                              period.status === 'closed' 
                                ? 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400' 
                                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                            )}>
                              {period.status === 'closed' ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                              {period.status}
                            </span>
                            {currentPeriodId === period.id && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 text-[10px] font-bold uppercase tracking-wider animate-pulse">
                                <CheckCircle2 className="w-3 h-3" />
                                Current
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          {/* Actions removed - roll over only */}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-16 text-center bg-gray-50/50 dark:bg-white/5 rounded-3xl border-2 border-dashed border-gray-200 dark:border-white/10 transition-all duration-300">
              <div className="w-20 h-20 bg-gray-100 dark:bg-white/5 rounded-full flex items-center justify-center mb-6">
                <Calendar className="w-10 h-10 text-gray-300 dark:text-gray-600" />
              </div>
              <h3 className="text-xl font-bold dark:text-white mb-2">No Periods Generated</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                Configure your project timeline by selecting a base date and duration, then calculate your reporting periods.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProgressReportingPeriod;
