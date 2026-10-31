import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0B0F17] text-slate-100 p-6 font-sans">
          <div className="max-w-lg w-full bg-[#0F1623] border border-slate-800 rounded-lg p-6 space-y-4">
            <h1 className="text-lg font-bold text-white">
              SpecSync Workspace Recovery
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              An unexpected runtime error occurred while rendering the workspace:
            </p>
            <pre className="p-3 bg-[#090D14] border border-slate-800 rounded text-xs font-mono text-rose-400 overflow-auto">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.removeItem('specsync-theme');
                } catch {}
                window.location.reload();
              }}
              className="px-4 py-2 bg-sky-400 hover:bg-sky-300 text-slate-950 text-xs font-semibold rounded transition-colors"
            >
              Reload SpecSync Workspace
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);
