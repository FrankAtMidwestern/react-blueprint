import { useCallback, useRef, useEffect } from 'react';

/**
 * useSafeCallback
 *
 * Returns a memoized callback that only executes if the component is mounted.
 */
export function useSafeCallback<T extends (...args: any[]) => any>(callback: T): T {
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  return useCallback((...args: any[]) => {
    if (isMounted.current) {
      return callback(...args);
    } else {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('Attempted to invoke a callback on an unmounted component.');
      }
      return;
    }
  }, [callback]) as T;
}