import React from 'react';
import { Project, Sheet } from '../types';
import { CheckCircle2, Clock, AlertCircle, MessageSquare, ArrowRight, Filter, Search, Plus } from 'lucide-react';

interface CostTasksProps {
  project: Project;
  sheets: Sheet[];
}

const CostTasks: React.FC<CostTasksProps> = ({ project, sheets }) => {
  const tasks = [
    {
      id: '1',
      title: 'Approve Monthly Cost Report - March 2026',
      description: 'Review and approve the final cost report for the month of March.',
      priority: 'high',
      status: 'pending',
      dueDate: '2026-03-31',
      category: 'Reporting',
      assignee: 'Tarek Guindy'
    },
    {
      id: '2',
      title: 'Update Forecasting Sheet: Civil Works',
      description: 'The Civil Works sheet requires an update based on the latest field quantities.',
      priority: 'medium',
      status: 'in-progress',
      dueDate: '2026-04-05',
      category: 'Forecasting',
      assignee: 'John Doe'
    },
    {
      id: '3',
      title: 'Review Variance: Structural Steel',
      description: 'A variance of >5% has been detected in the Structural Steel cost element.',
      priority: 'high',
      status: 'pending',
      dueDate: '2026-03-28',
      category: 'Analysis',
      assignee: 'Jane Smith'
    },
    {
      id: '4',
      title: 'Finalize Budget Allocation: MEP Services',
      description: 'Allocate the remaining budget for MEP services for the next quarter.',
      priority: 'low',
      status: 'completed',
      dueDate: '2026-03-20',
      category: 'Budgeting',
      assignee: 'Tarek Guindy'
    }
  ];

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'text-red-600 bg-red-50 dark:bg-red-900/20';
      case 'medium': return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20';
      case 'low': return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20';
      default: return 'text-gray-600 bg-gray-50 dark:bg-gray-900/20';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case 'in-progress': return <Clock className="w-5 h-5 text-amber-500" />;
      case 'pending': return <AlertCircle className="w-5 h-5 text-red-500" />;
      default: return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-gray-50/50 dark:bg-[#0a0a0a]">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold dark:text-white">Cost Tasks</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Manage and track cost-related actions and approvals.</p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg shadow-blue-500/20">
          <Plus className="w-4 h-4" />
          New Task
        </button>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[300px] relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
          <input 
            type="text" 
            placeholder="Search tasks, assignees, or categories..."
            className="w-full bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 rounded-2xl pl-11 pr-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 transition-all dark:text-white"
          />
        </div>
        <button className="flex items-center gap-2 bg-white dark:bg-[#141414] border border-gray-200 dark:border-white/10 px-4 py-3 rounded-2xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-white/5 transition-all dark:text-white">
          <Filter className="w-4 h-4" />
          Filters
        </button>
      </div>

      {/* Task List */}
      <div className="grid grid-cols-1 gap-4">
        {tasks.map((task) => (
          <div key={task.id} className="bg-white dark:bg-[#141414] p-6 rounded-3xl border border-gray-200 dark:border-white/10 shadow-sm hover:shadow-md transition-all group cursor-pointer">
            <div className="flex items-start gap-6">
              <div className="mt-1">
                {getStatusIcon(task.status)}
              </div>
              <div className="flex-1 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-bold dark:text-white group-hover:text-blue-600 transition-colors">{task.title}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{task.description}</p>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getPriorityColor(task.priority)}`}>
                    {task.priority} Priority
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-gray-100 dark:border-white/5">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px] font-bold text-blue-600">
                      {task.assignee.split(' ').map(n => n[0]).join('')}
                    </div>
                    <span className="text-xs text-gray-600 dark:text-gray-400">{task.assignee}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <Clock className="w-3.5 h-3.5" />
                    Due {new Date(task.dueDate).toLocaleDateString()}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <Filter className="w-3.5 h-3.5" />
                    {task.category}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <MessageSquare className="w-3.5 h-3.5" />
                    3 Comments
                  </div>
                </div>
              </div>
              <div className="flex items-center self-center opacity-0 group-hover:opacity-100 transition-opacity">
                <ArrowRight className="w-5 h-5 text-blue-600" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CostTasks;
