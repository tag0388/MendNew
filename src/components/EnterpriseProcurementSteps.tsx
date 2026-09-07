import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { ProcurementStepDefinition } from '../types';
import { 
  Plus, 
  Trash2, 
  CheckCircle2,
  ShoppingCart,
  Save,
  X,
  Edit2
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

interface EnterpriseProcurementStepsProps {
  enterpriseId: string;
}

export default function EnterpriseProcurementSteps({ enterpriseId }: EnterpriseProcurementStepsProps) {
  const [steps, setSteps] = useState<ProcurementStepDefinition[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newStepName, setNewStepName] = useState('');
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editData, setEditData] = useState<{ name: string; order: number }>({ name: '', order: 0 });

  useEffect(() => {
    if (!enterpriseId) return;
    const q = query(
      collection(db, 'procurementStepDefinitions'),
      where('enterpriseId', '==', enterpriseId),
      orderBy('order', 'asc')
    );
    const unsub = onSnapshot(q, (snapshot) => {
      setSteps(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ProcurementStepDefinition)));
    });
    return () => unsub();
  }, [enterpriseId]);

  const handleAdd = async () => {
    if (!newStepName) return;
    try {
      const maxOrder = steps.length > 0 ? Math.max(...steps.map(s => s.order || 0)) : 0;
      await addDoc(collection(db, 'procurementStepDefinitions'), {
        enterpriseId,
        name: newStepName,
        order: maxOrder + 1,
        isEnterpriseStandard: true,
        createdAt: serverTimestamp()
      });
      setNewStepName('');
      setIsAdding(false);
      toast.success('Standard step added');
    } catch (e) {
      console.error(e);
      toast.error('Failed to add step');
    }
  };

  const handleUpdate = async (id: string) => {
    try {
      const order = Number(editData.order) || 0;
      // Check for duplicate order
      const isDuplicate = steps.some(s => s.id !== id && s.order === order);
      if (isDuplicate) {
        toast.error(`Step order ${order} already exists. Please use a unique ID.`);
        return;
      }

      await updateDoc(doc(db, 'procurementStepDefinitions', id), {
        name: editData.name,
        order: order
      });
      setEditingStepId(null);
      toast.success('Step updated');
    } catch (e) {
      console.error(e);
      toast.error('Failed to update step');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this standard step? Projects already using it will not be affected.')) return;
    try {
      await deleteDoc(doc(db, 'procurementStepDefinitions', id));
      toast.success('Standard step deleted');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-2xl font-bold dark:text-white flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-blue-600" />
            Standard Procurement Steps
          </h2>
          <p className="text-sm text-gray-500 mt-1">Define mandatory milestones that all projects should track. Use Sort Order to rearrange steps.</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
        >
          <Plus className="w-4 h-4" />
          Add Standard Step
        </button>
      </div>

      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {steps.map((step) => (
            <motion.div 
              key={step.id}
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="group p-4 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl flex items-center justify-between hover:border-blue-500/50 transition-all shadow-sm"
            >
              <div className="flex items-center gap-4 flex-1">
                {editingStepId === step.id ? (
                  <div className="flex-1 grid grid-cols-4 gap-4 items-center">
                    <div className="flex items-center gap-2">
                       <label className="text-[10px] font-bold text-gray-400 uppercase">Order</label>
                       <input 
                         type="number" 
                         className="flex-1 bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-lg px-2 py-1 text-xs font-bold focus:outline-none"
                         value={editData.order}
                         onChange={e => setEditData({ ...editData, order: Number(e.target.value) })}
                       />
                    </div>
                    <div className="col-span-3 flex items-center gap-2">
                       <label className="text-[10px] font-bold text-gray-400 uppercase">Name</label>
                       <input 
                         type="text" 
                         className="flex-1 bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-lg px-2 py-1 text-xs font-bold focus:outline-none"
                         value={editData.name}
                         onChange={e => setEditData({ ...editData, name: e.target.value })}
                         onKeyDown={e => e.key === 'Enter' && handleUpdate(step.id)}
                       />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="w-8 h-8 bg-gray-50 dark:bg-white/5 rounded-lg flex items-center justify-center text-[10px] font-black text-gray-400">
                      {step.order}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold dark:text-white">{step.name}</h4>
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1">
                {editingStepId === step.id ? (
                  <>
                    <button 
                      onClick={() => handleUpdate(step.id)}
                      className="p-2 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition-all"
                    >
                      <Save className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => setEditingStepId(null)}
                      className="p-2 text-gray-400 hover:bg-gray-50 dark:hover:bg-white/10 rounded-lg transition-all"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <button 
                      onClick={() => {
                        setEditingStepId(step.id);
                        setEditData({ name: step.name, order: step.order });
                      }}
                      className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleDelete(step.id)}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>


        {isAdding && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 border-2 border-dashed border-blue-200 dark:border-blue-500/20 rounded-2xl bg-blue-50/30 dark:bg-blue-500/5 flex items-center gap-4"
          >
            <input 
              autoFocus
              type="text" 
              placeholder="e.g. Contract Sign-off"
              value={newStepName}
              onChange={e => setNewStepName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              className="flex-1 bg-transparent border-none text-sm font-bold focus:ring-0 dark:text-white"
            />
            <div className="flex gap-2">
              <button 
                onClick={handleAdd}
                className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setIsAdding(false)}
                className="p-2 text-gray-400 hover:text-gray-600 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

        {steps.length === 0 && !isAdding && (
          <div className="py-20 text-center flex flex-col items-center">
            <div className="w-16 h-16 bg-gray-50 dark:bg-white/5 rounded-full flex items-center justify-center mb-4">
              <ShoppingCart className="w-8 h-8 text-gray-300" />
            </div>
            <p className="text-gray-500 text-sm">No enterprise standard steps defined.</p>
            <button 
              onClick={() => setIsAdding(true)}
              className="mt-4 text-blue-600 text-xs font-bold hover:underline"
            >
              Define the first step
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
