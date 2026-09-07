import React from 'react';
import { Project, Sheet } from '../types';
import { PieChart, TrendingUp, DollarSign, AlertCircle, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart as RePie, Pie } from 'recharts';

interface CostDashboardProps {
  project: Project;
  sheets: Sheet[];
  sheetStats: Record<string, { eac: number, etc: number }>;
}

const CostDashboard: React.FC<CostDashboardProps> = ({ project, sheets, sheetStats }) => {
  // Calculate total metrics
  const totalEAC = Object.values(sheetStats).reduce((sum, stat) => sum + stat.eac, 0);
  const totalETC = Object.values(sheetStats).reduce((sum, stat) => sum + stat.etc, 0);
  
  // Mock budget for visualization (in a real app, this would come from the project data)
  const totalBudget = 15000000; 
  const variance = totalBudget - totalEAC;
  const variancePercent = (variance / totalBudget) * 100;

  const stats = [
    { 
      label: 'Total Budget', 
      value: totalBudget, 
      icon: <DollarSign className="w-5 h-5 text-blue-600" />,
      change: '+2.5%',
      trend: 'up'
    },
    { 
      label: 'Total EAC', 
      value: totalEAC, 
      icon: <TrendingUp className="w-5 h-5 text-purple-600" />,
      change: '-1.2%',
      trend: 'down'
    },
    { 
      label: 'Total ETC', 
      value: totalETC, 
      icon: <PieChart className="w-5 h-5 text-emerald-600" />,
      change: '+0.8%',
      trend: 'up'
    },
    { 
      label: 'Variance', 
      value: variance, 
      icon: <AlertCircle className={`w-5 h-5 ${variance >= 0 ? 'text-emerald-600' : 'text-red-600'}`} />,
      change: `${variancePercent.toFixed(1)}%`,
      trend: variance >= 0 ? 'up' : 'down'
    }
  ];

  const chartData = sheets.map(sheet => ({
    name: sheet.sheetName,
    eac: sheetStats[sheet.id]?.eac || 0,
    etc: sheetStats[sheet.id]?.etc || 0
  }));

  const COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444'];

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-gray-50/50 dark:bg-[#0a0a0a]">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold dark:text-white">Cost Dashboard</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Real-time financial performance and forecasting overview.</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 bg-white dark:bg-[#141414] px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          Live Updates Enabled
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-white dark:bg-[#141414] p-6 rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm hover:shadow-md transition-all group">
            <div className="flex justify-between items-start mb-4">
              <div className="p-3 bg-gray-50 dark:bg-white/5 rounded-xl group-hover:scale-110 transition-transform">
                {stat.icon}
              </div>
              <div className={`flex items-center gap-1 text-xs font-bold ${stat.trend === 'up' ? 'text-emerald-600' : 'text-red-600'}`}>
                {stat.change}
                {stat.trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              </div>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">{stat.label}</p>
            <p className="text-2xl font-bold dark:text-white">${stat.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-[#141414] p-8 rounded-3xl border border-gray-200 dark:border-white/10 shadow-sm">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-lg font-bold dark:text-white">Forecasting by Sheet</h3>
            <select className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs outline-none dark:text-white">
              <option>Last 6 Months</option>
              <option>Last Year</option>
              <option>Project Lifetime</option>
            </select>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" opacity={0.5} />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickFormatter={(value) => `$${(value / 1000000).toFixed(1)}M`}
                />
                <Tooltip 
                  cursor={{ fill: '#f3f4f6', opacity: 0.4 }}
                  contentStyle={{ 
                    backgroundColor: '#fff', 
                    borderRadius: '12px', 
                    border: '1px solid #e5e7eb',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                  }}
                />
                <Bar dataKey="eac" name="EAC" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="etc" name="ETC" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Distribution Chart */}
        <div className="bg-white dark:bg-[#141414] p-8 rounded-3xl border border-gray-200 dark:border-white/10 shadow-sm">
          <h3 className="text-lg font-bold dark:text-white mb-8">Budget Distribution</h3>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RePie>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="eac"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </RePie>
            </ResponsiveContainer>
          </div>
          <div className="space-y-3 mt-4">
            {chartData.map((entry, index) => (
              <div key={index} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                  <span className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-[120px]">{entry.name}</span>
                </div>
                <span className="text-xs font-bold dark:text-white">{((entry.eac / totalEAC) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CostDashboard;
