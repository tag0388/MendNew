import React, { useState, useEffect } from 'react';
import { 
  Layout, 
  Briefcase, 
  FileText, 
  Settings, 
  Shield, 
  ChevronRight, 
  LogOut, 
  ChevronLeft, 
  Sun, 
  Moon, 
  Menu, 
  CalendarCheck2,
  DollarSign,
  RefreshCw,
  Users as UsersIcon,
  Receipt,
  PieChart,
  ClipboardList,
  ShieldAlert,
  ShoppingCart,
  Activity,
  GanttChartSquare
} from 'lucide-react';
import { useNavigate, useLocation, useParams, matchPath } from 'react-router-dom';
import { Enterprise, Project, Sheet } from '../types';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface SidebarProps {
  enterprise: Enterprise | null;
  userEmail?: string | null;
  userId?: string | null;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
}

export default function Sidebar({ 
  enterprise, 
  userEmail,
  userId,
  theme,
  setTheme,
  isCollapsed,
  setIsCollapsed,
}: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Manually extract parameters since Sidebar is outside Routes
  const projectMatch = matchPath({ path: '/project/:projectId', end: false }, location.pathname);
  const projectId = projectMatch?.params.projectId;

  const sheetMatch = matchPath({ path: '/project/:projectId/sheet/:sheetId', end: false }, location.pathname);
  const sheetId = sheetMatch?.params.sheetId;

  const moduleMatch = matchPath({ path: '/project/:projectId/:moduleId', end: false }, location.pathname);
  let moduleId = moduleMatch?.params.moduleId;
  if (moduleId === 'sheet') moduleId = undefined;

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

  const isSystemAdmin = userEmail?.toLowerCase() === 'tarek.guindy@gmail.com' || userEmail?.toLowerCase() === 'tarek_guindy@hotmail.com';
  const isEnterpriseAdmin = userId && enterprise?.users?.[userId]?.role === 'Enterprise System Admin';
  const isProjectAdmin = userId && (isEnterpriseAdmin || project?.users?.[userId] === 'Project Admin');

  const enterpriseItems = [
    { id: 'enterprise', label: 'Enterprise', icon: Layout, disabled: !enterprise },
  ];

  const projectModules = [
    { id: 'dashboard', label: 'Project Dashboard', icon: Layout },
    { id: 'project-admin', label: 'Project Admin', icon: Settings, visible: !!project && (isProjectAdmin || isSystemAdmin) },
    { id: 'cost', label: 'Cost Management', icon: DollarSign },
    { id: 'change', label: 'Change Management', icon: RefreshCw },
    { id: 'risk', label: 'Risk Management', icon: ShieldAlert },
    { id: 'subcontract', label: 'Sub-Contract Management', icon: UsersIcon },
    { id: 'procurement', label: 'Procurement Progress', icon: ShoppingCart },
    { id: 'progress', label: 'Commodity Tracking', icon: Activity },
    { id: 'schedule', label: 'Time Schedule', icon: GanttChartSquare },
  ];

  const adminItems = [
    { id: 'system-admin', label: 'System Admin', icon: Shield, visible: isSystemAdmin },
    { id: 'enterprise-admin', label: 'Enterprise Admin', icon: Settings, visible: isEnterpriseAdmin || isSystemAdmin },
  ];

  const handleNavClick = (id: string) => {
    if (id === 'enterprise') navigate('/');
    else navigate(`/${id}`);
  };

  const handleModuleClick = (id: string) => {
    if (projectId) {
      navigate(`/project/${projectId}/${id}`);
    }
  };

  return (
    <div className={cn(
      "bg-white dark:bg-[#141414] text-black dark:text-white flex flex-col h-full border-r border-gray-200 dark:border-white/10 transition-all duration-300 ease-in-out relative",
      isCollapsed ? "w-20" : "w-64"
    )}>
      <Button 
        variant="ghost"
        size="icon"
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -right-3 top-10 w-6 h-6 bg-[#FF6321] rounded-full flex items-center justify-center text-white dark:text-black shadow-lg z-50 hover:scale-110 transition-transform p-0 hover:bg-[#FF6321]/90"
      >
        {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </Button>

      <div className="p-6 overflow-hidden flex-1 flex flex-col min-h-0">
        <div className={cn("flex items-center gap-2 mb-8 shrink-0", isCollapsed && "justify-center")}>
          {enterprise?.logoURL ? (
            <div className="shrink-0 w-8 h-8 rounded overflow-hidden border border-gray-200 dark:border-white/10">
              <img src={enterprise.logoURL} alt={enterprise.name} className="w-full h-full object-contain bg-white" referrerPolicy="no-referrer" />
            </div>
          ) : (
            <div className="shrink-0 w-8 h-8 bg-[#FF6321] rounded flex items-center justify-center font-bold text-white dark:text-black text-sm">
              <CalendarCheck2 className="w-4 h-4" />
            </div>
          )}
          {!isCollapsed && <span className="font-bold tracking-tight text-sm whitespace-nowrap dark:text-white">{enterprise?.name || 'Mend'}</span>}
        </div>

        <ScrollArea className="flex-1 pr-2 -mr-2">
          <div className="space-y-6">
            {/* Enterprise Section */}
            <div>
              {!isCollapsed && <p className="px-3 text-[10px] font-bold text-gray-900 dark:text-white/20 uppercase tracking-widest mb-2">Enterprise</p>}
              <nav className="space-y-1">
                {enterpriseItems.map((item) => (
                  <Button
                    key={item.id}
                    variant={location.pathname === '/' ? "default" : "ghost"}
                    disabled={item.disabled}
                    onClick={() => handleNavClick(item.id)}
                    className={cn(
                      "w-full justify-start gap-3 px-3 py-2 h-auto font-normal",
                      location.pathname !== '/' && "text-black dark:text-white/40 hover:text-black dark:hover:text-white/70",
                      isCollapsed && "justify-center px-0"
                    )}
                    title={isCollapsed ? item.label : ""}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    {!isCollapsed && <span className="flex-1 text-left whitespace-nowrap">{item.label}</span>}
                  </Button>
                ))}
              </nav>
            </div>

            {/* Project Modules Section */}
            {project && (
              <div>
                {!isCollapsed && (
                  <div className="px-3 mb-2">
                    <p className="text-[10px] font-bold text-gray-900 dark:text-white/20 uppercase tracking-widest">Project Modules</p>
                    <p className="text-[9px] text-blue-500 font-mono truncate mt-0.5">{project.projectName}</p>
                  </div>
                )}
                <nav className="space-y-1">
                  {projectModules.filter(i => i.visible !== false).map((item) => {
                    const isActive = (moduleId || 'dashboard') === item.id;
                    return (
                      <Button
                        key={item.id}
                        variant={isActive ? "default" : "ghost"}
                        onClick={() => handleModuleClick(item.id)}
                        className={cn(
                          "w-full justify-start gap-3 px-3 py-2 h-auto font-normal",
                          !isActive && "text-black dark:text-white/40 hover:text-black dark:hover:text-white/70",
                          isCollapsed && "justify-center px-0"
                        )}
                        title={isCollapsed ? item.label : ""}
                      >
                        <item.icon className="w-4 h-4 shrink-0" />
                        {!isCollapsed && <span className="flex-1 text-left whitespace-nowrap">{item.label}</span>}
                      </Button>
                    );
                  })}
                  {/* Forecast Sheet Link if active */}
                  {sheet && (
                    <Button
                      variant={sheetId ? "default" : "ghost"}
                      onClick={() => navigate(`/project/${projectId}/sheet/${sheetId}`)}
                      className={cn(
                        "w-full justify-start gap-3 px-3 py-2 h-auto font-normal",
                        !sheetId && "text-black dark:text-white/40 hover:text-black dark:hover:text-white/70",
                        isCollapsed && "justify-center px-0"
                      )}
                      title={isCollapsed ? "Forecast Sheet" : ""}
                    >
                      <FileText className="w-4 h-4 shrink-0" />
                      {!isCollapsed && <span className="flex-1 text-left whitespace-nowrap">Forecast Sheet</span>}
                    </Button>
                  )}
                </nav>
              </div>
            )}

            {/* Administration Section */}
            <div>
              {!isCollapsed && <p className="px-3 text-[10px] font-bold text-gray-900 dark:text-white/20 uppercase tracking-widest mb-2">Administration</p>}
              <nav className="space-y-1">
                {adminItems.filter(i => i.visible).map((item) => (
                  <Button
                    key={item.id}
                    variant={location.pathname === `/${item.id}` ? "default" : "ghost"}
                    onClick={() => handleNavClick(item.id)}
                    className={cn(
                      "w-full justify-start gap-3 px-3 py-2 h-auto font-normal",
                      location.pathname !== `/${item.id}` && "text-black dark:text-white/40 hover:text-black dark:hover:text-white/70",
                      isCollapsed && "justify-center px-0"
                    )}
                    title={isCollapsed ? item.label : ""}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    {!isCollapsed && <span className="flex-1 text-left whitespace-nowrap">{item.label}</span>}
                  </Button>
                ))}
              </nav>
            </div>

            {/* User Section */}
            <div>
              {!isCollapsed && <p className="px-3 text-[10px] font-bold text-gray-900 dark:text-white/20 uppercase tracking-widest mb-2">User</p>}
              <nav className="space-y-1">
                <Button
                  variant={location.pathname === '/profile' ? "default" : "ghost"}
                  onClick={() => handleNavClick('profile')}
                  className={cn(
                    "w-full justify-start gap-3 px-3 py-2 h-auto font-normal",
                    location.pathname !== '/profile' && "text-black dark:text-white/40 hover:text-black dark:hover:text-white/70",
                    isCollapsed && "justify-center px-0"
                  )}
                  title={isCollapsed ? "My Profile" : ""}
                >
                  <UsersIcon className="w-4 h-4 shrink-0" />
                  {!isCollapsed && <span className="flex-1 text-left whitespace-nowrap">My Profile</span>}
                </Button>
              </nav>
            </div>
          </div>
        </ScrollArea>
      </div>

      <div className="mt-auto p-6 space-y-4">
        <div className="pt-4 border-t border-gray-100 dark:border-white/10 space-y-2">
          <Button 
            variant="ghost"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={cn(
              "w-full justify-start gap-3 px-3 py-2 h-auto font-normal text-black dark:text-white/40 hover:text-black dark:hover:text-white/70",
              isCollapsed && "justify-center px-0"
            )}
            title={isCollapsed ? `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode` : ""}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
            {!isCollapsed && <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>}
          </Button>

          <Button 
            variant="ghost"
            onClick={() => signOut(auth)}
            className={cn(
              "w-full justify-start gap-3 px-3 py-2 h-auto font-normal text-red-400 hover:text-red-300 hover:bg-red-400/10",
              isCollapsed && "justify-center px-0"
            )}
            title={isCollapsed ? "Sign Out" : ""}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!isCollapsed && <span>Sign Out</span>}
          </Button>
        </div>
        
        {!isCollapsed && (
          <div className="px-3 pt-2">
            <div className="flex items-center justify-between text-[10px] font-mono text-gray-900 dark:text-white/20 uppercase tracking-widest">
              <span>Version</span>
              <span>1.0.0</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

