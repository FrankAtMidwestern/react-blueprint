import React, { ComponentType } from 'react';

export interface WithAuthenticationOptions {
  fallback?: ComponentType<any>;
  isAuthenticated?: () => boolean;
}

/**
 * Higher-Order Component that renders the wrapped component only if the user is authenticated.
 * Otherwise, it renders the fallback component (if provided) or null.
 *
 * @param WrappedComponent The component to wrap.
 * @param options Optional settings including the isAuthenticated check and fallback component.
 * @returns A new component that checks authentication before rendering.
 */
export function withAuthentication<P>(
  WrappedComponent: ComponentType<P>,
  options: WithAuthenticationOptions = {}
): React.FC<P> {
  const { fallback: FallbackComponent, isAuthenticated = () => false } = options;

  const AuthenticatedComponent: React.FC<P> = (props) => {
    if (isAuthenticated()) {
      return <WrappedComponent {...props} />;
    }
    return FallbackComponent ? <FallbackComponent {...props} /> : null;
  };

  AuthenticatedComponent.displayName = `withAuthentication(${
    WrappedComponent.displayName || WrappedComponent.name || 'Component'
  })`;

  return AuthenticatedComponent;
}
