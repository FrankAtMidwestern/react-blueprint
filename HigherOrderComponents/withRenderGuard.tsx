import React, { useRef, useEffect } from 'react';

interface RenderGuardConfig {
  enabled?: boolean;          
  deepComparison?: boolean;    
  ignoreProps?: string[];      
  reRenderThreshold?: number;
}

const defaultConfig: RenderGuardConfig = {
  enabled: true,
  deepComparison: false,
  ignoreProps: [],
  reRenderThreshold: 10,
};

/**
 * A simple deep equality check function.
 * Handles primitives, arrays, plain objects, and Date objects.
 */
function isEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;

  // Handle arrays
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => isEqual(item, b[i]));
  }

  // Handle Date objects
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  // Handle plain objects
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(key =>
    Object.prototype.hasOwnProperty.call(b, key) && isEqual(a[key], b[key])
  );
}

/**
 * Higher-Order Component that wraps a component with render guard functionality.
 *
 * @param WrappedComponent The component to wrap.
 * @param componentName    An optional display name for logging.
 * @param config           Optional configuration for the render guard.
 * @returns                A component wrapped with render guard logic.
 */
export function withRenderGuard<P>(
  WrappedComponent: React.ComponentType<P>,
  componentName?: string,
  config: RenderGuardConfig = {}
): React.FC<P> {
  const displayName =
    componentName ||
    WrappedComponent.displayName ||
    WrappedComponent.name ||
    'Component';
  // Merge once since config is static for the HOC.
  const mergedConfig = { ...defaultConfig, ...config };

  const RenderGuard: React.FC<P> = (props) => {
    // If disabled or in production mode, render the wrapped component directly.
    if (!mergedConfig.enabled || process.env.NODE_ENV !== 'development') {
      return <WrappedComponent {...props} />;
    }

    const prevPropsRef = useRef<P>(props);
    const renderCountRef = useRef<number>(0);

    useEffect(() => {
      renderCountRef.current++;
      const changedProps: Record<string, { from: any; to: any }> = {};

      Object.entries(props).forEach(([key, currentValue]) => {
        if (mergedConfig.ignoreProps?.includes(key)) return;
        const prevValue = (prevPropsRef.current as any)[key];
        const hasChanged = mergedConfig.deepComparison
          ? !isEqual(prevValue, currentValue)
          : prevValue !== currentValue;
        if (hasChanged) {
          changedProps[key] = { from: prevValue, to: currentValue };
        }
      });

      if (Object.keys(changedProps).length > 0) {
        console.log(
          `[RenderGuard] ${displayName} re-render #${renderCountRef.current} with changed props:`,
          changedProps
        );
      }

      if (renderCountRef.current >= mergedConfig.reRenderThreshold!) {
        console.warn(
          `[RenderGuard] ${displayName} has re-rendered ${renderCountRef.current} times. Consider optimizing this component.`
        );
      }

      // Update previous props for next comparison
      prevPropsRef.current = props;
    });

    return <WrappedComponent {...props} />;
  };

  RenderGuard.displayName = `withRenderGuard(${displayName})`;
  return RenderGuard;
}