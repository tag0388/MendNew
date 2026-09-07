import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, Navigate, useLocation } from 'react-router-dom';
import { auth, db } from './firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, User, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import { collection, query, where, onSnapshot, addDoc, doc, updateDoc, getDoc, getDocs, limit } from 'firebase/firestore';
import { Enterprise, Project, Sheet } from './types';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import EnterpriseDashboard from './components/EnterpriseDashboard';
import ProjectDashboard from './components/ProjectDashboard';
import ForecastGrid from './components/ForecastGrid';
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
  const [currentSheet, setCurrentSheet] = useState<Sheet | null>(null);
  const [currentModule, setCurrentModule] = useState<string>('dashboard');
  const [view, setView] = useState<'enterprise' | 'project' | 'sheet' | 'system-admin' | 'enterprise-admin' | 'project-admin' | 'profile'>('enterprise');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [isInIframe, setIsInIframe] = useState(false);
  const [systemOwnerEnterpriseId, setSystemOwnerEnterpriseId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('systemOwnerEnterpriseId');
    } catch (e) {
      return null;
    }
  });

  const isSystemOwner = user?.email?.toLowerCase() === 'tarek.guindy@gmail.com' || user?.email?.toLowerCase() === 'tarek_guindy@hotmail.com';

  useEffect(() => {
    try {
      if (systemOwnerEnterpriseId) {
        localStorage.setItem('systemOwnerEnterpriseId', systemOwnerEnterpriseId);
      } else {
        localStorage.removeItem('systemOwnerEnterpriseId');
      }
    } catch (e) {
      console.warn('LocalStorage access failed', e);
    }
    // Reset current project and sheet when switching enterprises
    setCurrentProject(null);
    setCurrentSheet(null);
    setView('enterprise');
  }, [systemOwnerEnterpriseId]);
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
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      
      // Handle invitation if present in URL
      if (u) {
        handlePendingInvitation(u);
      }
    });
    return () => unsubscribe();
  }, []);

  const handlePendingInvitation = async (u: User) => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (token) {
      try {
        // 1. Find the invitation by token
        const q = query(collection(db, 'invitations'), where('token', '==', token), where('status', '==', 'pending'), limit(1));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
          const inviteDoc = snapshot.docs[0];
          const inviteData = inviteDoc.data();
          
          // 2. Security Check: Email must match (if provided in invite)
          if (inviteData.email && u.email?.toLowerCase() !== inviteData.email.toLowerCase()) {
            setAuthError(`This invitation was sent to ${inviteData.email}. Please sign in with that account.`);
            return;
          }

          // 3. Security Check: Token expiration
          if (new Date(inviteData.expiresAt) < new Date()) {
            setAuthError('This invitation has expired. Please ask for a new one.');
            return;
          }

          // 4. Add user to Enterprise
          const enterpriseRef = doc(db, 'enterprises', inviteData.enterpriseId);
          const enterpriseSnap = await getDoc(enterpriseRef);
          
          if (enterpriseSnap.exists()) {
            const data = enterpriseSnap.data();
            const users = data.users || {};
            
            if (!users[u.uid]) {
              await updateDoc(enterpriseRef, {
                [`users.${u.uid}`]: {
                  name: u.displayName || u.email?.split('@')[0] || 'New User',
                  email: u.email,
                  role: 'Enterprise User',
                  joinedAt: new Date().toISOString()
                },
                adminUsers: [...(data.adminUsers || []), u.uid]
              });
            }

            // 5. Mark invitation as accepted
            await updateDoc(inviteDoc.ref, {
              status: 'accepted',
              acceptedAt: new Date().toISOString(),
              acceptedBy: u.uid
            });

            // 6. Clear URL params
            window.history.replaceState({}, document.title, window.location.pathname);
            alert(`Welcome! You've been added to ${data.name}.`);
          }
        }
      } catch (error) {
        console.error('Failed to process invitation:', error);
      }
    }
  };

  useEffect(() => {
    if (!user) return;

    // Fetch Enterprise
    const enterpriseQuery = isSystemOwner && systemOwnerEnterpriseId
      ? query(collection(db, 'enterprises'), where('__name__', '==', systemOwnerEnterpriseId))
      : query(collection(db, 'enterprises'), where('adminUsers', 'array-contains', user.uid));

    const unsubscribe = onSnapshot(enterpriseQuery, (snapshot) => {
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        const data = { ...doc.data() as Enterprise, id: doc.id };
        setCurrentEnterprise(data);
        
        // Fetch projects for this enterprise
        const qProjects = query(collection(db, 'projects'), where('enterpriseId', '==', doc.id));
        getDocs(qProjects).then(projSnap => {
          setProjects(projSnap.docs.map(d => ({ ...d.data() as Project, id: d.id })));
        });
      } else {
        setCurrentEnterprise(null);
      }
    }, (error) => {
      console.error("Enterprise fetch error:", error);
    });
    return () => unsubscribe();
  }, [user, systemOwnerEnterpriseId]);

  useEffect(() => {
    if (!user || 
        (user.email?.toLowerCase() !== 'tarek.guindy@gmail.com' && 
         user.email?.toLowerCase() !== 'tarek_guindy@hotmail.com')) return;

    // Check if any enterprise exists
    const q = query(collection(db, 'enterprises'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      if (snapshot.empty) {
        try {
          await addDoc(collection(db, 'enterprises'), {
            name: 'Global Construction Corp',
            adminUsers: [user.uid],
            settings: { theme: 'dark' },
            users: {
              [user.uid]: {
                name: 'Tarek Guindy',
                role: 'Enterprise System Admin'
              }
            }
          });
        } catch (error) {
          console.error('Bootstrap failed', error);
        }
      }
    }, (error) => {
      console.error("Bootstrap check error:", error);
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user || !currentProject?.id) return;

    const unsubscribe = onSnapshot(doc(db, 'projects', currentProject.id), (snapshot) => {
      if (snapshot.exists()) {
        setCurrentProject({ ...snapshot.data() as Project, id: snapshot.id });
      }
    }, (error) => {
      console.error("Current project fetch error:", error);
    });
    return () => unsubscribe();
  }, [user, currentProject?.id]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    setAuthError(null);
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Login failed', error);
      if (error.code === 'auth/popup-blocked') {
        setAuthError('The login popup was blocked. Please click "Open in New Tab" below to sign in.');
      } else if (error.message?.includes('cookie')) {
        setAuthError('Your browser is blocking security cookies. Please click "Open in New Tab" below.');
      } else {
        setAuthError('Authentication failed. Please try opening the app in a new tab.');
      }
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      if (isRegistering) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(userCredential.user);
        alert('A verification email has been sent. Please check your inbox to complete registration.');
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error: any) {
      console.error('Email auth failed', error);
      if (error.code === 'auth/email-already-in-use') {
        setAuthError('This email is already registered. Try signing in instead.');
      } else if (error.code === 'auth/weak-password') {
        setAuthError('Password should be at least 6 characters.');
      } else if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        setAuthError('Invalid email or password.');
      } else if (error.code === 'auth/too-many-requests') {
        setAuthError('Too many failed attempts. Please try again later.');
      } else {
        setAuthError('Authentication failed. Please try again.');
      }
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
        systemOwnerEnterpriseId={systemOwnerEnterpriseId}
        setSystemOwnerEnterpriseId={setSystemOwnerEnterpriseId}
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
  systemOwnerEnterpriseId: string | null;
  setSystemOwnerEnterpriseId: (id: string | null) => void;
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
  systemOwnerEnterpriseId, setSystemOwnerEnterpriseId, theme, setTheme,
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

  if (user && !user.emailVerified && !isSystemOwner) {
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
              onClick={() => sendEmailVerification(user).then(() => alert('Verification email resent!'))}
              className="w-full py-3 bg-black text-white rounded-lg font-medium hover:bg-black/90 transition-colors"
            >
              Resend Verification Email
            </button>
            <button 
              onClick={() => auth.signOut()}
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
                if (name) {
                  try {
                    await addDoc(collection(db, 'enterprises'), {
                      name,
                      adminUsers: [user.uid],
                      users: {
                        [user.uid]: {
                          name: user.displayName || user.email?.split('@')[0] || 'Admin',
                          email: user.email,
                          role: 'Enterprise System Admin',
                          joinedAt: new Date().toISOString()
                        }
                      }
                    });
                  } catch (e) {
                    alert('Failed to create enterprise. Please try again.');
                  }
                }
              }}
              className="w-full py-3 bg-black text-white rounded-lg font-medium hover:bg-black/90 transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create New Enterprise
            </button>
            <button 
              onClick={() => auth.signOut()}
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
        userId={user.uid}
        theme={theme}
        setTheme={setTheme}
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
      />
      <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#0A0A0A] transition-colors duration-300">
        <Header 
          user={user} 
          enterprise={currentEnterprise} 
        />
        <main className="flex-1 flex flex-col overflow-hidden bg-[#F5F5F4] dark:bg-[#0A0A0A] transition-colors duration-300">
          <Routes>
            <Route path="/" element={
              <EnterpriseDashboard 
                enterprise={currentEnterprise} 
                userId={user.uid}
                isSystemOwner={isSystemOwner}
              />
            } />
            <Route path="/project/:projectId" element={<ProjectView enterprise={currentEnterprise} user={user} setIsSidebarCollapsed={setIsSidebarCollapsed} />} />
            <Route path="/project/:projectId/:moduleId" element={<ProjectView enterprise={currentEnterprise} user={user} setIsSidebarCollapsed={setIsSidebarCollapsed} />} />
            <Route path="/project/:projectId/:moduleId/:subModuleId" element={<ProjectView enterprise={currentEnterprise} user={user} setIsSidebarCollapsed={setIsSidebarCollapsed} />} />
            <Route path="/project/:projectId/sheet/:sheetId" element={<ProjectView enterprise={currentEnterprise} user={user} theme={theme} setIsSidebarCollapsed={setIsSidebarCollapsed} />} />
            
            <Route path="/system-admin" element={
              <SystemAdmin 
                currentEnterpriseId={currentEnterprise?.id}
                onSwitchEnterprise={(id) => {
                  setSystemOwnerEnterpriseId(id);
                  navigate('/');
                }} 
              />
            } />
            <Route path="/enterprise-admin" element={
              currentEnterprise ? <EnterpriseAdmin enterprise={currentEnterprise} setIsSidebarCollapsed={setIsSidebarCollapsed} /> : <Navigate to="/" />
            } />
            <Route path="/profile" element={
              currentEnterprise ? <UserProfile userId={user.uid} enterprise={currentEnterprise} /> : <Navigate to="/" />
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
  const { projectId, moduleId, subModuleId, sheetId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  useEffect(() => {
    if (!projectId) return;
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

  if (!project || !enterprise) return null;

  if (sheetId && sheet) {
    return <ForecastGrid sheet={sheet} project={project} enterprise={enterprise} theme={theme || 'light'} />;
  }

  if (moduleId === 'project-admin') {
    return <ProjectAdmin project={project} enterprise={enterprise} />;
  }

  return (
    <ProjectDashboard 
      project={project} 
      enterprise={enterprise}
      currentModule={moduleId || 'dashboard'}
      subModuleId={subModuleId}
      onSelectSheet={(sheet) => window.location.href = `/project/${project.id}/sheet/${sheet.id}`}
      setIsSidebarCollapsed={setIsSidebarCollapsed}
      user={user}
      theme={theme}
    />
  );
}
