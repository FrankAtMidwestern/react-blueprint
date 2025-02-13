import {
    Dispatch,
    SetStateAction,
    useCallback,
    useEffect,
    useRef,
    useState,
  } from 'react';
  
  /**
   * useSafeState
   *
   * Behaves like useState but only updates state if the component is still mounted.
   */
  export function useSafeState<T>(initialState: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
    const isMounted = useRef(true);
    const [state, setState] = useState<T>(initialState);
  
    useEffect(() => {
      isMounted.current = true;
      return () => {
        isMounted.current = false;
      };
    }, []);
  
    const safeSetState = useCallback(
      (newState: T | ((prevState: T) => T)) => {
        if (isMounted.current) {
          setState(newState);
        } else if (process.env.NODE_ENV !== 'production') {
          console.warn('Attempted to update state on an unmounted component.');
        }
      },
      []
    );
    return [state, safeSetState];
  }
  
  