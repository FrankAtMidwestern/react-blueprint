import { ComponentType } from 'react';

export type InferableComponentEnhancer<TProps> = (
  component: ComponentType<TProps>
) => ComponentType<TProps>;

/**
 * Composes multiple HOCs into a single HOC.
 *
 * The HOCs are applied from right-to-left, meaning that the last HOC in the list
 * will be applied first.
 *
 * @example
 * const enhance = compose(
 *   withErrorBoundary,
 *   withTheme({ ThemeContext: MyThemeContext, defaultTheme }),
 *   withAuthorization({ requiredRoles: ['admin'], fallback: Unauthorized }),
 *   withAuthentication({ isAuthenticated: checkAuth })
 * );
 *
 * export default enhance(MyComponent);
 *
 * @param hocs The HOCs to compose.
 * @returns A function that takes a component and returns the enhanced component.
 */
export function compose<TProps>(
  ...hocs: Array<InferableComponentEnhancer<TProps>>
): InferableComponentEnhancer<TProps> {
  if (hocs.length === 0) {
    return (component: ComponentType<TProps>) => component;
  }
  if (hocs.length === 1) {
    return hocs[0];
  }
  return hocs.reduceRight(
    (acc, hoc) => (component: ComponentType<TProps>) => hoc(acc(component))
  );
}
