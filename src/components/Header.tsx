import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { Enterprise, Project, Sheet } from '../types';
import { Bell, Search, User as UserIcon, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useNavigate, useLocation, useParams, matchPath } from 'react-router-dom';
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';

interface HeaderProps {
  user: User;
  enterprise: Enterprise | null;
}

export default function Header({ user, enterprise }: HeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Manually extract parameters since Header is outside Routes
  const projectMatch = matchPath({ path: '/project/:projectId', end: false }, location.pathname);
  const projectId = projectMatch?.params.projectId;

  const sheetMatch = matchPath({ path: '/project/:projectId/sheet/:sheetId', end: false }, location.pathname);
  const sheetId = sheetMatch?.params.sheetId;

  const [project, setProject] = useState<Project | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }
    const unsubscribe = onSnapshot(doc(db, 'projects', projectId), (snapshot) => {
      if (snapshot.exists()) {
        setProject({ ...snapshot.data() as Project, id: snapshot.id });
      }
    });
    return () => unsubscribe();
  }, [projectId]);

  useEffect(() => {
    if (!sheetId) {
      setSheet(null);
      return;
    }
    const unsubscribe = onSnapshot(doc(db, 'sheets', sheetId), (snapshot) => {
      if (snapshot.exists()) {
        setSheet({ ...snapshot.data() as Sheet, id: snapshot.id });
      }
    });
    return () => unsubscribe();
  }, [sheetId]);

  const isProjectView = location.pathname.startsWith('/project/');
  const isSheetView = location.pathname.includes('/sheet/');

  return (
    <header className="h-16 bg-white dark:bg-[#0A0A0A] border-b border-gray-200 dark:border-white/10 flex items-center justify-between px-6 z-10 transition-colors duration-300">
      <div className="flex items-center gap-2 text-sm">
        <Button 
          variant="ghost"
          size="sm"
          onClick={() => window.location.href = '/'}
          className="flex items-center gap-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors px-2"
        >
          {enterprise?.logoURL && (
            <img src={enterprise.logoURL} className="w-5 h-5 object-contain bg-white rounded-sm" alt="" referrerPolicy="no-referrer" />
          )}
          {enterprise?.name || 'Enterprise'}
        </Button>
        
        {isProjectView && project && (
          <>
            <ChevronRight className="w-3 h-3 text-gray-300 dark:text-gray-600" />
            <Button 
              variant="ghost"
              size="sm"
              onClick={() => window.location.href = `/project/${projectId}`}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors px-2"
            >
              {project.projectName}
            </Button>
          </>
        )}

        {isSheetView && sheet && (
          <>
            <ChevronRight className="w-3 h-3 text-gray-300 dark:text-gray-600" />
            <span className="font-medium text-gray-900 dark:text-white px-2">{sheet.sheetName}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-6">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 z-10" />
          <Input 
            type="text" 
            placeholder="Search workspace..." 
            className="pl-9 pr-4 py-1.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-black/5 dark:focus:ring-white/5 w-64 dark:text-white h-8"
          />
        </div>

        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors relative">
            <Bell className="w-4 h-4" />
            <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-[#FF6321] rounded-full border border-white dark:border-[#0A0A0A]"></span>
          </Button>
          
          <div className="flex items-center gap-3 pl-4 border-l border-gray-100 dark:border-white/10">
            <div className="text-right">
              <p className="text-xs font-semibold text-gray-900 dark:text-white leading-none mb-1">{user.displayName || 'Cost Engineer'}</p>
              <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest leading-none">Project Controller</p>
            </div>
            <Avatar className="w-8 h-8 border border-gray-200 dark:border-white/10">
              <AvatarImage src={user.photoURL || undefined} alt="Profile" referrerPolicy="no-referrer" />
              <AvatarFallback className="bg-gray-100 dark:bg-white/5 text-gray-400">
                <UserIcon className="w-4 h-4" />
              </AvatarFallback>
            </Avatar>
          </div>
        </div>
      </div>
    </header>
  );
}
