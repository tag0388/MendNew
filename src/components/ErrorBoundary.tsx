import React from 'react';
import { ShieldAlert, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    const { hasError, error } = this.state;
    const { children } = this.props;

    if (hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F5F5F4] p-6">
          <div className="max-w-md w-full bg-white p-12 rounded-3xl shadow-sm text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <ShieldAlert className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-2xl font-bold mb-4">Something went wrong</h2>
            <p className="text-sm text-gray-500 mb-8 leading-relaxed">
              {(() => {
                try {
                  if (error?.message) {
                    const parsed = JSON.parse(error.message);
                    if (parsed.error && parsed.operationType) {
                      if (parsed.error.includes('Missing or insufficient permissions')) {
                        return "You don't have permission to perform this action. Please check your project access rights.";
                      }
                      return `Database Error: ${parsed.error} (${parsed.operationType} on ${parsed.path})`;
                    }
                  }
                } catch (e) {
                  // Not a JSON error
                }
                return "The application encountered an unexpected error. This might be due to a data mismatch or a temporary connection issue.";
              })()}
            </p>
            <div className="bg-red-50 p-4 rounded-xl mb-8 text-left overflow-auto max-h-32">
              <p className="text-[10px] font-mono text-red-800 break-all">
                {error?.message || 'Unknown error'}
              </p>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-black text-white rounded-lg font-medium hover:bg-black/90 transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return children;
  }
}
