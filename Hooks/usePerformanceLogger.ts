import { useEffect } from 'react';

export function usePerformanceLogger(name: string) {
  useEffect(() => {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      console.log(`[Performance] ${name} unmounted after ${duration}ms`);
    };
  }, [name]);
}