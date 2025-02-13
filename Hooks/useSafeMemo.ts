import { useMemo, useRef, useEffect } from 'react';

/**
 * useSafeMemo
 *
 * Memoizes a value and only recalculates it if the component is still mounted.
 */
export function useSafeMemo<T>(factory: () => T, deps: any[]): T {
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  return useMemo(() => {
    if (isMounted.current) {
      return factory();
    }
    // Return undefined if unmounted; adjust as needed.
    return undefined as unknown as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

