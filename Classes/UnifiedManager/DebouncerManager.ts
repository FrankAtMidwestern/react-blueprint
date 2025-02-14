/**
 * DebouncerManager
 *
 * A debouncer that can handle both synchronous and asynchronous functions.
 * It supports debounced execution with a specified delay, an optional immediate (leading edge)
 * execution mode, cancellation, flushing (executing a pending call immediately), and error handling.
 *
 * @template TArgs The type of the arguments for the function.
 * @template TResult The type of the result of the function.
 *
 * @example
 * // Create a debouncer that waits 300ms after the last call before executing the function.
 * const debouncer = new DebouncerManager(
 *   (val: string) => {
 *     console.log("Function executed with:", val);
 *     return val.toUpperCase();
 *   },
 *   300,      // delay in milliseconds
 *   false     // immediate: false means trailing edge (execute after delay)
 * );
 *
 * // Call the debounced function:
 * debouncer.call("hello")
 *   .then(result => console.log("Result:", result))
 *   .catch(err => console.error("Error:", err.message));
 *
 * // If you need to cancel a pending call:
 * debouncer.cancel();
 *
 * // If you want to flush (immediately execute) a pending call (trailing mode only):
 * debouncer.flush()?.then(result => console.log("Flushed result:", result));
 *
 * // Wait for the debounce delay without triggering the function:
 * debouncer.waitFor().then(() => console.log("Debounce period elapsed"));
 */
export class DebouncerManager<TArgs extends any[], TResult> {
    private fn: (...args: TArgs) => TResult | Promise<TResult>;
    private delay: number;
    private immediate: boolean;
    private timer: ReturnType<typeof setTimeout> | null;
    private lastPromise: Promise<TResult> | null;
    private lastReject: ((error: Error) => void) | null;
    private lastArgs: TArgs | null;
  
    /**
     * Constructs a new DebouncerManager.
     *
     * @param fn The function to debounce. Must be a function that returns a value or a Promise.
     * @param delay The debounce delay in milliseconds. Must be a non-negative, finite number.
     * @param immediate If true, the function is executed immediately on the leading edge.
     *                  Subsequent calls within the delay period return the same result.
     *                  Defaults to false (trailing edge execution).
     * @throws Error if the provided function is not a function or if delay is invalid.
     */
    constructor(
      fn: (...args: TArgs) => TResult | Promise<TResult>,
      delay: number,
      immediate: boolean = false
    ) {
      if (typeof fn !== "function") {
        throw new Error("DebouncerManager: Provided 'fn' is not a function.");
      }
      if (typeof delay !== "number" || delay < 0 || !Number.isFinite(delay)) {
        throw new Error(
          "DebouncerManager: 'delay' must be a non-negative, finite number."
        );
      }
      this.fn = fn;
      this.delay = delay;
      this.immediate = immediate;
      this.timer = null;
      this.lastPromise = null;
      this.lastReject = null;
      this.lastArgs = null;
    }
  
    /**
     * Calls the debounced function with the provided arguments.
     *
     * In immediate mode (leading edge), if no call is in progress, the function is executed
     * immediately and its result is cached for the delay period. If a call is already in progress,
     * the cached promise is returned.
     *
     * In trailing mode (immediate === false), any pending call is cancelled and the timer is reset.
     * The function is executed only after the debounce delay.
     *
     * @param args The arguments to pass to the debounced function.
     * @returns A promise that resolves (or rejects) with the function's result.
     */
    public call(...args: TArgs): Promise<TResult> {
      if (this.immediate) {
        // Immediate (leading edge) mode.
        if (!this.timer) {
          try {
            const result = this.fn(...args);
            this.lastPromise = Promise.resolve(result);
          } catch (error) {
            this.lastPromise = Promise.reject(error);
          }
          // Start timer to prevent subsequent calls until delay expires.
          this.timer = setTimeout(() => {
            this.timer = null;
            this.lastPromise = null;
          }, this.delay);
          return this.lastPromise!;
        } else {
          // A call is already in progress; return the cached promise.
          return this.lastPromise
            ? this.lastPromise
            : Promise.reject(
                new Error(
                  "DebouncerManager: Function call already in progress and no result is available."
                )
              );
        }
      } else {
        // Trailing edge mode.
        this.lastArgs = args;
        // If a timer is already running, cancel it and reject the previous promise.
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
          if (this.lastReject) {
            this.lastReject(
              new Error(
                "DebouncerManager: Debounced call cancelled due to subsequent call."
              )
            );
            this.lastReject = null;
          }
        }
        this.lastPromise = new Promise<TResult>((resolve, reject) => {
          this.lastReject = reject;
          this.timer = setTimeout(async () => {
            this.timer = null;
            this.lastArgs = null;
            try {
              const result = await this.fn(...args);
              resolve(result);
            } catch (error) {
              reject(error);
            }
          }, this.delay);
        });
        return this.lastPromise;
      }
    }
  
    /**
     * Cancels any pending debounced function call.
     *
     * If a call is cancelled, its associated promise is rejected with a cancellation error.
     */
    public cancel(): void {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
        if (this.lastReject) {
          this.lastReject(new Error("DebouncerManager: Debounced function call cancelled."));
          this.lastReject = null;
        }
        this.lastPromise = null;
        this.lastArgs = null;
      }
    }
  
    /**
     * Immediately flushes any pending debounced call by executing the function immediately.
     * This method is only applicable in trailing mode (immediate === false).
     *
     * @returns A promise that resolves with the function's result if there was a pending call,
     *          or undefined if there was no pending call.
     */
    public flush(): Promise<TResult> | undefined {
      if (this.immediate) {
        // In immediate mode, flush is not applicable.
        return undefined;
      }
      if (this.timer && this.lastArgs) {
        clearTimeout(this.timer);
        this.timer = null;
        const args = this.lastArgs;
        this.lastArgs = null;
        try {
          const result = this.fn(...args);
          const promiseResult = Promise.resolve(result);
          this.lastPromise = promiseResult;
          return promiseResult;
        } catch (error) {
          return Promise.reject(error);
        }
      }
      return undefined;
    }
  
    /**
     * Returns a promise that resolves after the debounce delay.
     *
     * This is useful if you want to wait for the debounce period to finish without executing the function.
     *
     * @returns A promise that resolves after the specified delay.
     */
    public waitFor(): Promise<void> {
      return new Promise((resolve) => {
        setTimeout(resolve, this.delay);
      });
    }
  }
  