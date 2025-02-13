import React, { ComponentType } from 'react';

export interface WithFeatureFlagOptions {
  fallback?: ComponentType<any>;
  isEnabled?: (flag: string) => boolean;
}

/**
 * Higher-Order Component that conditionally renders a component based on a feature flag.
 *
 * @param WrappedComponent The component to wrap.
 * @param featureFlag The key for the feature flag to check.
 * @param options Optional settings:
 *   - fallback: A fallback component to render if the feature flag is disabled.
 *   - isEnabled: A function that checks if the flag is enabled.
 *
 * @returns A new component that renders conditionally based on the feature flag.
 */
export function withFeatureFlag<P>(
  WrappedComponent: ComponentType<P>,
  featureFlag: string,
  options: WithFeatureFlagOptions = {}
): React.FC<P> {
  const { fallback: FallbackComponent, isEnabled = () => true } = options;

  const FeatureFlagComponent: React.FC<P> = (props) => {
    if (isEnabled(featureFlag)) {
      return <WrappedComponent {...props} />;
    } else if (FallbackComponent) {
      return <FallbackComponent {...props} />;
    }
    return null;
  };

  FeatureFlagComponent.displayName = `withFeatureFlag(${
    WrappedComponent.displayName || WrappedComponent.name || 'Component'
  })`;

  return FeatureFlagComponent;
}
