import React, { ComponentType } from 'react';
import {useSafeMemo} from '../Hooks';

export interface User {
  roles?: string[];
  permissions?: string[];
}

export interface WithAuthorizationOptions {
  fallback?: ComponentType<any>;
  requiredRoles?: string[];
  requiredPermissions?: string[];
  getUser?: () => User | null;
  isAuthorized?: (
    requiredRoles?: string[],
    requiredPermissions?: string[],
    user?: User | null
  ) => boolean;
}

/**
 * Default authorization logic:
 * - Returns false if no user is provided.
 * - If `requiredRoles` is specified, checks that the user has at least one of those roles.
 * - If `requiredPermissions` is specified, checks that the user has at least one of those permissions.
 * - If both are specified, the user must satisfy both conditions.
 */
const defaultIsAuthorized = (
  requiredRoles?: string[],
  requiredPermissions?: string[],
  user?: User | null
): boolean => {
  if (!user) return false;

  const roleAuthorized = requiredRoles?.length
    ? user.roles?.some((role) => requiredRoles.includes(role)) ?? false
    : true;

  const permissionAuthorized = requiredPermissions?.length
    ? user.permissions?.some((permission) => requiredPermissions.includes(permission)) ?? false
    : true;

  return roleAuthorized && permissionAuthorized;
};

/**
 * Higher-Order Component that enforces authorization on the wrapped component.
 *
 * @param WrappedComponent The component to wrap.
 * @param options          Options for roles, permissions, user retrieval, and fallback.
 * @returns                A new component that renders either the wrapped component or a fallback.
 */
export function withAuthorization<P>(
  WrappedComponent: ComponentType<P>,
  {
    fallback: FallbackComponent,
    requiredRoles,
    requiredPermissions,
    getUser,
    isAuthorized = defaultIsAuthorized,
  }: WithAuthorizationOptions = {}
): React.FC<P> {
  const AuthorizedComponent: React.FC<P> = (props) => {
   
    const user = useSafeMemo(() => (getUser ? getUser() : null), [getUser]);

    const authorized = useSafeMemo(
      () => isAuthorized(requiredRoles, requiredPermissions, user),
      [isAuthorized, requiredRoles, requiredPermissions, user]
    );

    return authorized ? (
      <WrappedComponent {...props} />
    ) : FallbackComponent ? (
      <FallbackComponent {...props} />
    ) : null;
  };

  AuthorizedComponent.displayName = `withAuthorization(${
    WrappedComponent.displayName || WrappedComponent.name || 'Component'
  })`;

  return React.memo(AuthorizedComponent);
}
