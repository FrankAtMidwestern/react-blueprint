import { useEffect, useRef } from 'react';

type AsyncEffect = (
  isMounted: () => boolean,
  cancel: () => void,
  signal: AbortSignal
) => void | Promise<void>;

/**
 * useSafeAsyncEffect
 *
 * A safe version of useEffect for asynchronous operations. It passes three arguments to the effect callback:
 * - isMounted: a function that returns true if the component is still mounted.
 * - cancel: a function that aborts the asynchronous operation.
 * - signal: an AbortSignal that can be used to handle cancellation.
 *
 * The effect should use the provided signal to handle cancellation.
 *
 * @param effect An async effect callback that receives (isMounted, cancel, signal) and returns void or a promise.
 * @param deps Dependency array for the effect.
 */
export function useSafeAsyncEffect(effect: AsyncEffect, deps: any[] = []) {
  const isMounted = useRef(true);

  useEffect(() => {
    // Mark as mounted for this run.
    isMounted.current = true;

    // Create a new AbortController for each effect run.
    const abortController = new AbortController();
    const cancel = () => {
      abortController.abort();
    };
    const signal = abortController.signal;

    // Execute the effect.
    const maybePromise = effect(() => isMounted.current, cancel, signal);

    // Cleanup on unmount or dependency change.
    return () => {
      isMounted.current = false;
      abortController.abort();

      // If the effect returned a promise with a cancel method, call it.
      if (maybePromise && typeof (maybePromise as any).cancel === 'function') {
        (maybePromise as any).cancel();
      }
    };

    // You might want to adjust your dependency array or lint rules accordingly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
