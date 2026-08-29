import React from 'react';

interface State { err: Error | null }
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { err: null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('App error:', err, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="p-6 max-w-3xl mx-auto">
          <h2 className="text-lg font-bold text-destructive mb-2">页面渲染出错</h2>
          <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded overflow-auto max-h-96">
            {String(this.state.err.stack || this.state.err.message || this.state.err)}
          </pre>
          <button
            className="mt-3 px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm"
            onClick={() => { this.setState({ err: null }); location.reload(); }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
