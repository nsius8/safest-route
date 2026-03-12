import { Component, type ReactNode } from 'react'

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('App error:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div style={{
          padding: '2rem',
          maxWidth: '600px',
          margin: '0 auto',
          fontFamily: 'system-ui, sans-serif',
          background: '#1a1a1a',
          color: '#e8e8e8',
          minHeight: '100vh',
        }}>
          <h1 style={{ color: '#e74c3c', marginBottom: '1rem' }}>Something went wrong</h1>
          <p style={{ marginBottom: '0.5rem' }}>{this.state.error.message}</p>
          {import.meta.env.DEV ? (
            <pre style={{
              background: '#252525',
              padding: '1rem',
              overflow: 'auto',
              fontSize: '0.875rem',
              borderRadius: '8px',
            }}>
              {this.state.error.stack}
            </pre>
          ) : (
            <p style={{ color: '#999' }}>An unexpected error occurred. Please try again.</p>
          )}
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: undefined })}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              background: '#3498db',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
