import React, { ComponentType, useContext } from 'react';

export interface WithThemeOptions<TTheme = any> {
  ThemeContext?: React.Context<TTheme>;
  mapThemeToProps?: (theme: TTheme) => { [key: string]: any };
  defaultTheme?: TTheme;
}

/**
 * A Higher-Order Component that injects theming/styling props into the wrapped component.
 *
 * This abstraction allows you to adapt to any theming system—from plain CSS to React Native style sheets,
 * or even custom user-defined theming solutions.
 *
 * @param WrappedComponent The component to wrap.
 * @param options          Configuration options to customize theme retrieval and mapping.
 * @returns                A component with injected theming/styling props.
 */
export function withTheme<P, TTheme = any>(
  WrappedComponent: ComponentType<P & { theme: TTheme }>,
  options: WithThemeOptions<TTheme> = {}
): React.FC<P> {
  const { ThemeContext, mapThemeToProps, defaultTheme } = options;

  const WithTheme: React.FC<P> = (props) => {
    // Try to get the theme from the provided context (if any).
    const themeFromContext = ThemeContext ? useContext(ThemeContext) : undefined;
    const theme = themeFromContext !== undefined ? themeFromContext : defaultTheme;

    const themeProps = mapThemeToProps ? mapThemeToProps(theme as TTheme) : { theme };

    return <WrappedComponent {...props} {...themeProps} />;
  };

  WithTheme.displayName = `withTheme(${
    WrappedComponent.displayName || WrappedComponent.name || 'Component'
  })`;

  return WithTheme;
}
