import React, { Component, ComponentType, ErrorInfo } from 'react';

/**
 * Higher-Order Component that catches JavaScript errors in the component tree.
 *
 * @param WrappedComponent The component to wrap.
 * @param FallbackComponent Optional custom fallback component.
 */
export function withErrorBoundary<P>(
  WrappedComponent: ComponentType<P>,
  FallbackComponent?: ComponentType
) {
  return class ErrorBoundary extends Component<P, { hasError: boolean }> {
    state = { hasError: false };

    static getDerivedStateFromError(error: Error) {
      return { hasError: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
      console.error('Error caught in Error Boundary:', error, info);
    }

    render() {
      if (this.state.hasError) {
        const Fallback = FallbackComponent;
        return <Fallback />;
      }
      return <WrappedComponent {...this.props} />;
    }
  };
}
