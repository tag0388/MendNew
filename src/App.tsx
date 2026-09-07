import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, Navigate, useLocation } from 'react-router-dom';
import { supabase, subscribeToTable } from './lib/supabase';
import type { User } from '@supabase/supabase-js';
import { setCurrentUser, toCurrentUser, signOut } from './lib/currentUser';
import {
  loadSessionContext, fetchEnterprise, fetchProjects, acceptInvitation,
  type SessionContext,
} from './lib/session';
import { fetchProject } from './lib/projects';
import { Enterprise, Project } from './types';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import EnterpriseDashboard from './components/EnterpriseDashboard';
import ProjectDashboard from './components/ProjectDashboard';
import SystemAdmin from './components/SystemAdmin';
import EnterpriseAdmin from './components/EnterpriseAdmin';
import ProjectAdmin from './components/ProjectAdmin';
import UserProfile from './components/UserProfile';
import LandingPage from './components/LandingPage';
import { ExternalLink, ShieldAlert, Building2, Plus, ArrowRight, LogOut, CalendarCheck2 } from 'lucide-react';
import { Toaster } from 'sonner';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentEnterprise, setCurrentEnterprise] = useState<Enterprise | null>(null);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentModule, setCurrentModule] = useState<string>('dashboard');
  const [view, setView] = useState<'enterprise' | 'project' | 'system-admin' | 'enterprise-admin' | 'project-admin' | 'profile'>('enterprise');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [isInIframe, setIsInIframe] = useState(false);
  const [session, setSession] = useState<SessionContext | null>(null);
  const [activeEnterpriseId, setActiveEnterpriseId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('activeEnterpriseId');
    } catch (e) {
      return null;
    }
  });

  // Platform admin is a row in platform_admins, not a hardcoded email list.
  const isSystemOwner = session?.isPlatformAdmin ?? false;

  useEffect(() => {
    try {
      if (activeEnterpriseId) {
        localStorage.setItem('activeEnterpriseId', activeEnterpriseId);
      } else {
        localStorage.removeItem('activeEnterpriseId');
      }
    } catch (e) {
      console.warn('LocalStorage access failed', e);
    }
    // Reset the current project when switching enterprises
    setCurrentProject(null);
    setView('enterprise');
  }, [activeEnterpriseId]);
  useEffect(() => {
    // Check if the app is running in an iframe
    try {
      setIsInIframe(window.self !== window.top);
    } catch (e) {
      setIsInIframe(true);
    }
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    let active = true;

    const apply = async (u: User | null) => {
      if (!active) return;
      setUser(u);
      setCurrentUser(toCurrentUser(u));

      if (u) {
        try {
          const ctx = await loadSessionContext(u.id, u.email ?? '');
          if (!active) return;
          setSession(ctx);
          // Land on an enterprise the user is actually a member of.
          setActiveEnterpriseId((prev) =>
            prev && ctx.memberships.some((m) => m.enterpriseId === prev)
              ? prev
              : ctx.memberships[0]?.enterpriseId ?? null
          );
        } catch (err) {
          console.error('Failed to load session context', err);
          if (active) setSession(null);
        }
        await handlePendingInvitation();
      } else {
        setSession(null);
      }
      if (active) setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => apply(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      void apply(s?.user ?? null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  /**
   * Redeems an invite token from the URL.
   *
   * The Firestore version checked the email and expiry on the client, then
   * wrote the membership itself -- and pushed the accepting user into
   * `adminUsers` while labelling them an 'Enterprise User', so every invited
   * user silently became an enterprise admin. The whole redemption is now one
   * SECURITY DEFINER function that validates and grants the invited role.
   */
  const handlePendingInvitation = async () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) return;

    try {
      const enterpriseId = await acceptInvitation(token);
      window.history.replaceState({}, document.title, window.location.pathname);
      setActiveEnterpriseId(enterpriseId);
      // Pick up the membership the redemption just created.
      const u = (await supabase.auth.getUser()).data.user;
      if (u) setSession(await loadSessionContext(u.id, u.email ?? ''));
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'This invitation could not be used.');
    }
  };

  // Load the active enterprise and the projects the user may open.
  //
  // The Firestore version queried
  //   where('adminUsers', 'array-contains', user.id)
  // so an ordinary Enterprise User matched no enterprise and saw an empty app.
  // Membership now comes from enterprise_members, and RLS decides which
  // projects come back -- an admin gets all of the enterprise's, a normal user
  // only those they are assigned to.
  useEffect(() => {
    if (!user || !activeEnterpriseId) {
      setCurrentEnterprise(null);
      setProjects([]);
      return;
    }
    let active = true;

    const load = async () => {
      try {
        const [ent, projs] = await Promise.all([
          fetchEnterprise(activeEnterpriseId),
          fetchProjects(activeEnterpriseId),
        ]);
        if (!active) return;
        setCurrentEnterprise(ent);
        setProjects(projs);
      } catch (error) {
        console.error('Enterprise fetch error:', error);
        if (active) setCurrentEnterprise(null);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [user, activeEnterpriseId]);

  const handleLogin = async () => {
    setAuthError(null);
    // Redirect flow rather than a popup: popups are what the Firebase version
    // kept failing on in Safari and in the iframe.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      console.error('Login failed', error);
      setAuthError(
        error.message.includes('provider')
          ? 'Google sign-in is not enabled for this project yet. Use email and password, or enable the Google provider in Supabase.'
          : 'Authentication failed. Please try again.'
      );
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (isRegistering) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) {
        setAuthError(
          error.message.includes('already registered')
            ? 'This email is already registered. Try signing in instead.'
            : error.message
        );
        return;
      }
      // With email confirmation on, Supabase returns a user but no session.
      if (data.user && !data.session) {
        alert('A confirmation email has been sent. Please check your inbox to complete registration.');
      }
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthError(
        error.message.includes('Invalid login')
          ? 'Invalid email or password.'
          : error.message.includes('Email not confirmed')
            ? 'Please confirm your email address before signing in.'
            : error.message
      );
    }
  };

  const openInNewTab = () => {
    window.open(window.location.href, '_blank');
  };

  return (
    <BrowserRouter>
      <AuthenticatedApp 
        user={user} 
        loading={loading} 
        currentEnterprise={currentEnterprise}
        setCurrentEnterprise={setCurrentEnterprise}
        isSystemOwner={isSystemOwner}
        activeEnterpriseId={activeEnterpriseId}
        setActiveEnterpriseId={setActiveEnterpriseId}
        session={session}
        setSession={setSession}
        theme={theme}
        setTheme={setTheme}
        isSidebarCollapsed={isSidebarCollapsed}
        setIsSidebarCollapsed={setIsSidebarCollapsed}
        authError={authError}
        setAuthError={setAuthError}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        isRegistering={isRegistering}
        setIsRegistering={setIsRegistering}
        showLanding={showLanding}
        setShowLanding={setShowLanding}
        isInIframe={isInIframe}
        handleLogin={handleLogin}
        handleEmailAuth={handleEmailAuth}
        openInNewTab={openInNewTab}
        projects={projects}
      />
    </BrowserRouter>
  );
}

interface AuthenticatedAppProps {
  user: User | null;
  loading: boolean;
  currentEnterprise: Enterprise | null;
  setCurrentEnterprise: (e: Enterprise | null) => void;
  isSystemOwner: boolean;
  activeEnterpriseId: string | null;
  setActiveEnterpriseId: (id: string | null) => void;
  session: SessionContext | null;
  setSession: (s: SessionContext | null) => void;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (c: boolean) => void;
  authError: string | null;
  setAuthError: (e: string | null) => void;
  email: string;
  setEmail: (e: string) => void;
  password: string;
  setPassword: (p: string) => void;
  isRegistering: boolean;
  setIsRegistering: (r: boolean) => void;
  showLanding: boolean;
  setShowLanding: (s: boolean) => void;
  isInIframe: boolean;
  handleLogin: () => Promise<void>;
  handleEmailAuth: (e: React.FormEvent) => Promise<void>;
  openInNewTab: () => void;
  projects: Project[];
}

function AuthenticatedApp({
  user, loading, currentEnterprise, setCurrentEnterprise, isSystemOwner,
  activeEnterpriseId, setActiveEnterpriseId, session, setSession, theme, setTheme,
  isSidebarCollapsed, setIsSidebarCollapsed, authError, setAuthError,
  email, setEmail, password, setPassword, isRegistering, setIsRegistering,
  showLanding, setShowLanding, 
  isInIframe, handleLogin, handleEmailAuth, openInNewTab,
  projects
}: AuthenticatedAppProps) {
  const navigate = useNavigate();
  const location = useLocation();

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#F5F5F4]">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 bg-black rounded-full mb-4"></div>
          <p className="text-xs font-mono uppercase tracking-widest opacity-50">Initializing System...</p>
        </div>
      </div>
    );
  }

  if (user && !user.email_confirmed_at && !isSystemOwner) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#F5F5F4] p-6">
        <div className="max-w-md w-full bg-white p-12 rounded-3xl shadow-sm text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <ShieldAlert className="w-8 h-8 text-amber-600" />
          </div>
          <h2 className="text-2xl font-bold mb-4">Verify your email</h2>
          <p className="text-sm text-gray-900 mb-8 leading-relaxed">
            We've sent a verification email to <span className="font-bold text-black">{user.email}</span>. 
            Please verify your email address to access your enterprise workspace.
          </p>
          <div className="space-y-4">
            <button 
              onClick={async () => {
                const { error } = await supabase.auth.resend({ type: 'signup', email: user.email ?? '' });
                alert(error ? `Could not resend: ${error.message}` : 'Verification email resent!');
              }}
              className="w-full py-3 bg-black text-white rounded-lg font-medium hover:bg-black/90 transition-colors"
            >
              Resend Verification Email
            </button>
            <button 
              onClick={() => void signOut()}
              className="w-full py-3 border border-gray-200 hover:bg-gray-50 text-black rounded-lg font-medium transition-colors"
            >
              Sign Out
            </button>
          </div>
          <p className="mt-8 text-[10px] text-gray-600 uppercase tracking-widest">
            Refresh this page after verifying your email.
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    if (showLanding && !isInIframe) {
      return (
        <LandingPage 
          onGetStarted={() => {
            setIsRegistering(true);
            setShowLanding(false);
          }}
          onLogin={() => {
            setIsRegistering(false);
            setShowLanding(false);
          }}
        />
      );
    }

    return (
      <div className="h-screen w-screen flex flex-col lg:flex-row">
        <div className="flex-1 bg-[#141414] text-white p-12 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-12">
              <div className="w-8 h-8 bg-[#FF6321] rounded flex items-center justify-center font-bold text-black">
                <Building2 className="w-5 h-5" />
              </div>
              <span className="font-bold tracking-tight text-xl text-white">Mend</span>
            </div>
            <h1 className="text-6xl font-light tracking-tight leading-none mb-6">
              Precision <br />
              <span className="italic font-serif text-[#FF6321]">project controls.</span>
            </h1>
            <p className="text-white/60 max-w-md leading-relaxed">
              Mend is the integrated platform for enterprise construction performance. Track cost, schedule, risk, and procurement in one unified reporting environment.
            </p>
          </div>
          <div className="flex gap-8 text-[10px] font-mono uppercase tracking-widest opacity-40">
            <span>SOC2 Type II Compliant</span>
            <span>256-bit Encryption</span>
          </div>
        </div>
        <div className="flex-1 bg-white flex items-center justify-center p-12">
          <div className="w-full max-w-sm">
            {isInIframe ? (
              <div className="text-center">
                <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <ExternalLink className="w-8 h-8 text-amber-600" />
                </div>
                <h2 className="text-2xl font-bold mb-4">Launch App</h2>
                <p className="text-sm text-gray-900 mb-8 leading-relaxed">
                  To ensure a secure connection and fix login issues on iPhone/Safari, please launch the application in a new window.
                </p>
                  <button 
                    onClick={openInNewTab}
                    className="w-full py-4 bg-[#FF6321] text-black rounded-xl font-bold hover:bg-[#FF6321]/90 transition-all shadow-lg shadow-[#FF6321]/20 flex items-center justify-center gap-3"
                  >
                    <ExternalLink className="w-5 h-5" />
                    Launch Mend
                  </button>
                <p className="mt-6 text-[10px] text-gray-600 uppercase tracking-widest font-bold">
                  Secure Enterprise Access
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-bold mb-2">{isRegistering ? 'Create Account' : 'Sign In'}</h2>
                <p className="text-sm text-gray-900 mb-8">
                  {isRegistering ? 'Join your enterprise workspace.' : 'Enter your credentials to access your workspace.'}
                </p>
                
                {authError && (
                  <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex gap-3">
                    <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
                    <p className="text-xs text-amber-800 leading-relaxed">{authError}</p>
                  </div>
                )}

                <form onSubmit={handleEmailAuth} className="space-y-4 mb-6">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2">Email Address</label>
                    <input 
                      required
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="colleague@company.com"
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/5"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2">Password</label>
                    <input 
                      required
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/5"
                    />
                  </div>
                  <button 
                    type="submit"
                    className="w-full py-3 bg-black text-white rounded-lg font-medium hover:bg-black/90 transition-colors"
                  >
                    {isRegistering ? 'Register' : 'Sign In'}
                  </button>
                </form>

                <div className="relative mb-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-100"></div>
                  </div>
                  <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-bold text-gray-600">
                    <span className="bg-white px-4">Or continue with</span>
                  </div>
                </div>

                <button 
                  onClick={handleLogin}
                  className="w-full py-3 px-4 border border-gray-200 hover:bg-gray-50 text-black rounded-lg font-medium transition-colors flex items-center justify-center gap-2 mb-8"
                >
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5 bg-white rounded-full p-0.5" alt="Google" />
                  Sign in with Google
                </button>
                
                <div className="pt-8 border-t border-gray-100 flex flex-col gap-4">
                  <button 
                    onClick={() => setIsRegistering(!isRegistering)}
                    className="text-sm text-black hover:text-gray-700 transition-colors"
                  >
                    {isRegistering ? 'Already have an account? Sign In' : "Don't have an account? Register"}
                  </button>
                </div>
              </>
            )}
            
            <div className="mt-12 flex justify-between text-[10px] text-gray-600 uppercase tracking-widest font-medium">
              <span>Privacy Policy</span>
              <span>Terms of Service</span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                System Status: Operational
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#F5F5F4] p-6">
        <div className="max-w-md w-full bg-white p-12 rounded-3xl shadow-sm text-center">
          <h2 className="text-2xl font-bold mb-4">Session Expired</h2>
          <p className="text-sm text-gray-900 mb-8">Please refresh or navigate to the home page to sign in.</p>
          <button onClick={() => setShowLanding(true)} className="w-full py-3 bg-black text-white rounded-lg">Return to Home</button>
        </div>
      </div>
    );
  }

  if (!currentEnterprise && !loading && !isSystemOwner) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#F5F5F4] p-6">
        <div className="max-w-md w-full bg-white p-12 rounded-3xl shadow-sm text-center">
          <div className="w-16 h-16 bg-[#FF6321]/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Building2 className="w-8 h-8 text-[#FF6321]" />
          </div>
          <h2 className="text-2xl font-bold mb-4">Welcome to Mend</h2>
          <p className="text-sm text-gray-900 mb-8 leading-relaxed">
            You are not currently associated with an enterprise. Please contact your administrator or create a new enterprise workspace.
          </p>
          <div className="space-y-4">
            <button 
              onClick={async () => {
                const name = prompt('Enter your Enterprise Name:');
                if (!name) return;
                try {
                  // enterprises_grant_creator_admin() makes the creator an
                  // Enterprise System Admin, so the client never asserts its
                  // own role.
                  const { data, error } = await supabase
                    .from('enterprises')
                    .insert({ name, enterprise_code: name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 40) })
                    .select('id')
                    .single();
                  if (error) throw error;
                  const u = (await supabase.auth.getUser()).data.user;
                  if (u) setSession(await loadSessionContext(u.id, u.email ?? ''));
                  setActiveEnterpriseId(data.id);
                } catch (e) {
                  alert(e instanceof Error ? e.message : 'Failed to create enterprise. Please try again.');
                }
              }}
              className="w-full py-3 bg-black text-white rounded-lg font-medium hover:bg-black/90 transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create New Enterprise
            </button>
            <button 
              onClick={() => void signOut()}
              className="w-full py-3 border border-gray-200 hover:bg-gray-50 text-black rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-screen flex overflow-hidden ${theme === 'dark' ? 'dark' : ''}`}>
      <Sidebar 
        enterprise={currentEnterprise}
        userEmail={user.email}
        userId={user.id}
        theme={theme}
        setTheme={setTheme}
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
      />
      <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#0A0A0A] transition-colors duration-300">
        <Header 
          user={{ displayName: session?.displayName ?? null, photoURL: session?.photoUrl ?? null }} 
          enterprise={currentEnterprise} 
        />
        <main className="flex-1 flex flex-col overflow-hidden bg-[#F5F5F4] dark:bg-[#0A0A0A] transition-colors duration-300">
          <Routes>
            <Route path="/" element={
              <EnterpriseDashboard 
                enterprise={currentEnterprise} 
                userId={user.id}
                isSystemOwner={isSystemOwner}
              />
            } />
            <Route path="/project/:projectId" element={<ProjectView enterprise={currentEnterprise} user={user} setIsSidebarCollapsed={setIsSidebarCollapsed} />} />
            <Route path="/project/:projectId/:moduleId" element={<ProjectView enterprise={currentEnterprise} user={user} setIsSidebarCollapsed={setIsSidebarCollapsed} />} />
            <Route path="/project/:projectId/:moduleId/:subModuleId" element={<ProjectView enterprise={currentEnterprise} user={user} setIsSidebarCollapsed={setIsSidebarCollapsed} />} />
            
            <Route path="/system-admin" element={
              <SystemAdmin 
                currentEnterpriseId={currentEnterprise?.id}
                onSwitchEnterprise={(id) => {
                  setActiveEnterpriseId(id);
                  navigate('/');
                }} 
              />
            } />
            <Route path="/enterprise-admin" element={
              currentEnterprise ? <EnterpriseAdmin enterprise={currentEnterprise} setIsSidebarCollapsed={setIsSidebarCollapsed} /> : <Navigate to="/" />
            } />
            <Route path="/profile" element={
              currentEnterprise ? <UserProfile userId={user.id} enterprise={currentEnterprise} /> : <Navigate to="/" />
            } />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
      <Toaster position="top-right" richColors />
    </div>
  );
}

function ProjectView({ enterprise, user, theme, setIsSidebarCollapsed }: { enterprise: Enterprise | null, user: User, theme?: 'light' | 'dark', setIsSidebarCollapsed?: (c: boolean) => void }) {
  const { projectId, moduleId, subModuleId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void fetchProject(projectId).then((p) => {
      if (active) setProject(p);
    });
    // Re-fetch when this project row changes, so RLS still decides visibility.
    const unsubscribe = subscribeToTable('projects', `id=eq.${projectId}`, () => {
      void fetchProject(projectId).then((p) => {
        if (active) setProject(p);
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [projectId]);

  if (!project || !enterprise) return null;

  if (moduleId === 'project-admin') {
    return <ProjectAdmin project={project} enterprise={enterprise} />;
  }

  return (
    <ProjectDashboard 
      project={project} 
      enterprise={enterprise}
      currentModule={moduleId || 'dashboard'}
      subModuleId={subModuleId}
      setIsSidebarCollapsed={setIsSidebarCollapsed}
      user={user}
      theme={theme}
    />
  );
}
