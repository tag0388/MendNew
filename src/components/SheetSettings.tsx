import React, { useState } from 'react';
import { db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { Sheet, Project } from '../types';
import { Users, Save, X } from 'lucide-react';

interface SheetSettingsProps {
  sheet: Sheet;
  project: Project;
  onClose: () => void;
}

export default function SheetSettings({ sheet, project, onClose }: SheetSettingsProps) {
  const [selectedUsers, setSelectedUsers] = useState<string[]>(sheet.users || []);

  const handleSave = async () => {
    try {
      await updateDoc(doc(db, 'sheets', sheet.id), {
        users: selectedUsers
      });
      onClose();
    } catch (error) {
      console.error('Update failed', error);
    }
  };

  const toggleUser = (uid: string) => {
    setSelectedUsers(prev => 
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white dark:bg-[#141414] rounded-2xl p-8 w-full max-w-md shadow-2xl transition-colors">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold flex items-center gap-2 dark:text-white">
            <Users className="w-5 h-5" />
            Sheet Access Control
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Select users from the project team to grant access to this specific sheet.
        </p>

        <div className="space-y-2 max-h-64 overflow-y-auto mb-8 pr-2">
          {Object.keys(project.users).map(uid => (
            <div key={uid} className="flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl transition-colors">
              <input 
                type="checkbox" 
                checked={selectedUsers.includes(uid)}
                onChange={() => toggleUser(uid)}
                className="rounded border-gray-300 dark:border-white/10 text-black dark:text-white focus:ring-black dark:focus:ring-white bg-transparent"
              />
              <div className="flex-1">
                <p className="text-sm font-medium dark:text-white">User {uid.slice(0, 8)}...</p>
                <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">{project.users[uid]}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button 
            onClick={onClose}
            className="flex-1 py-3 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-white/5 transition-colors dark:text-white"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            className="flex-1 py-3 bg-black dark:bg-white text-white dark:text-black rounded-xl text-sm font-medium hover:bg-black/90 dark:hover:bg-white/90 transition-all flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            Save Access
          </button>
        </div>
      </div>
    </div>
  );
}
