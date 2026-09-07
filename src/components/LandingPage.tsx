import React from 'react';
import { Shield, BarChart3, Users, Zap, ArrowRight, CheckCircle2, Building2, CalendarCheck2, TrendingUp, Activity, PieChart } from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
  onLogin: () => void;
}

export default function LandingPage({ onGetStarted, onLogin }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-white text-black selection:bg-[#FF6321] selection:text-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 h-20 bg-white/80 backdrop-blur-md z-50 border-b border-gray-100">
        <div className="max-w-7xl mx-auto h-full px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#FF6321] rounded flex items-center justify-center font-bold text-black">
              <CalendarCheck2 className="w-5 h-5" />
            </div>
            <span className="font-bold tracking-tight text-xl">Mend</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-500">
            <a href="#features" className="hover:text-black transition-colors">Features</a>
            <a href="#solutions" className="hover:text-black transition-colors">Solutions</a>
            <a href="#security" className="hover:text-black transition-colors">Security</a>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={onLogin}
              className="px-4 py-2 text-sm font-medium hover:text-[#FF6321] transition-colors"
            >
              Sign In
            </button>
            <button 
              onClick={onGetStarted}
              className="px-6 py-2.5 bg-black text-white rounded-full text-sm font-bold hover:bg-black/90 transition-all shadow-lg shadow-black/10"
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-40 pb-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-widest mb-8">
              <Building2 className="w-3 h-3" />
              Enterprise Project Controls
            </div>
            <h1 className="text-7xl md:text-8xl font-light tracking-tighter leading-[0.9] mb-8">
              Precision <br />
              <span className="italic font-serif text-[#FF6321]">project controls.</span>
            </h1>
            <p className="text-xl text-gray-500 mb-12 leading-relaxed max-w-xl">
              Mend is the integrated platform for enterprise construction performance. Track cost, schedule, risk, and procurement in one unified reporting environment.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <button 
                onClick={onGetStarted}
                className="px-8 py-4 bg-[#FF6321] text-black rounded-full font-bold text-lg hover:scale-105 transition-all shadow-xl shadow-[#FF6321]/20 flex items-center justify-center gap-3 group"
              >
                Start Free Trial
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              <button className="px-8 py-4 border border-gray-200 rounded-full font-bold text-lg hover:bg-gray-50 transition-all">
                Request Demo
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Stats/Social Proof */}
      <section className="py-12 border-y border-gray-100 bg-gray-50/50">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-12">
          {[
            { label: 'Project Value Managed', value: '$12.4B+' },
            { label: 'Active Enterprises', value: '450+' },
            { label: 'Forecast Accuracy', value: '99.2%' },
            { label: 'Time Saved', value: '40%' },
          ].map((stat, i) => (
            <div key={i}>
              <p className="text-3xl font-bold mb-1">{stat.value}</p>
              <p className="text-xs text-gray-400 uppercase tracking-widest font-bold">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,#fff,rgba(255,255,255,0.6))] -z-10" />
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-12">
            <div className="group p-8 bg-white border border-gray-100 rounded-3xl hover:shadow-2xl hover:shadow-black/5 transition-all duration-500">
              <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center text-white mb-6 group-hover:scale-110 transition-transform">
                <TrendingUp className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold mb-4">Performance Analytics</h3>
              <p className="text-gray-500 leading-relaxed">
                Visualize monthly movement and trends for all your KPIs. See exactly how your projects are performing over time with high-fidelity analytics.
              </p>
            </div>
            <div className="group p-8 bg-white border border-gray-100 rounded-3xl hover:shadow-2xl hover:shadow-black/5 transition-all duration-500">
              <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center text-white mb-6 group-hover:scale-110 transition-transform">
                <PieChart className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold mb-4">Integrated Modules</h3>
              <p className="text-gray-500 leading-relaxed">
                Cost, Schedule, Risk, and Safety—all interlinked and integrated for a complete project health overview across your entire portfolio.
              </p>
            </div>
            <div className="group p-8 bg-white border border-gray-100 rounded-3xl hover:shadow-2xl hover:shadow-black/5 transition-all duration-500">
              <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center text-white mb-6 group-hover:scale-110 transition-transform">
                <CalendarCheck2 className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold mb-4">Enterprise Reporting</h3>
              <p className="text-gray-500 leading-relaxed">
                Streamline your reporting cycles. Standardize data collection and automate performance summaries for executive-level visibility.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section id="security" className="py-24 px-6 bg-black text-white rounded-[3rem] mx-6 mb-24 overflow-hidden relative">
        <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-[#FF6321]/20 to-transparent pointer-events-none" />
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="max-w-2xl">
            <h2 className="text-5xl font-bold mb-8">Enterprise-Grade <br /> Security by Default</h2>
            <div className="grid sm:grid-cols-2 gap-8">
              {[
                'SOC2 Type II Compliant',
                '256-bit AES Encryption',
                'Multi-Factor Authentication',
                'Role-Based Access Control',
                'Audit Logging',
                'Daily Backups'
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#FF6321]" />
                  <span className="text-white/80 font-medium">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-gray-100 bg-gray-50/30">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[#FF6321] rounded flex items-center justify-center font-bold text-black text-xs">
              <CalendarCheck2 className="w-4 h-4" />
            </div>
            <span className="font-bold tracking-tight text-sm">Mend</span>
          </div>
          <div className="flex gap-8 text-xs text-gray-400 font-medium">
            <a href="#" className="hover:text-black transition-colors">Privacy</a>
            <a href="#" className="hover:text-black transition-colors">Terms</a>
            <a href="#" className="hover:text-black transition-colors">Contact</a>
          </div>
          <p className="text-xs text-gray-400">© 2026 Mend. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
