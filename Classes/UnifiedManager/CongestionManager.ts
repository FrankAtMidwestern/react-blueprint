export interface CongestionManagerOptions {
    initialDelay: number;
    maxDelay: number;
    factor?: number;
    maxAttempts: number;
  }
  
  /**
   * CongestionManager
   *
   * A rate limiting utility that uses exponential backoff to
   * retry an operation in the face of congestion, transient errors, or rate limits.
   *
   * The manager can be used standalone or integrated with other managers
   * (such as DebouncerManager, ConcurrencyQueue, and AbortManager) to help ensure
   * a balanced load, consistent cleanup, and optimal performance in your app.
   *
   * @example
   * // Create an instance with an initial delay of 500ms, a maximum delay of 5000ms,
   * // doubling the delay on each retry, and allowing up to 5 attempts.
   * const congestionManager = new CongestionManager({
   *   initialDelay: 500,
   *   maxDelay: 5000,
   *   factor: 2,
   *   maxAttempts: 5,
   * });
   *
   * // Define a function to be executed (e.g. a network call).
   * async function fetchData() {
   *   // Imagine this returns a Promise that might fail due to congestion.
   * }
   *
   * // Execute the function with exponential backoff.
   * congestionManager.execute(fetchData, (error) => {
   *   // Retry only if the error indicates a transient failure (for example, a 429 error).
   *   return error && error.code === 429;
   * })
   * .then(result => {
   *   console.log("Operation succeeded:", result);
   * })
   * .catch(error => {
   *   console.error("Operation failed after retries:", error.message);
   * });
   */
  export class CongestionManager {
    private initialDelay: number;
    private maxDelay: number;
    private factor: number;
    private maxAttempts: number;
  
    constructor(options: CongestionManagerOptions) {
      if (typeof options.initialDelay !== "number" || options.initialDelay < 0 || !Number.isFinite(options.initialDelay)) {
        throw new Error("CongestionManager: 'initialDelay' must be a non-negative finite number.");
      }
      if (typeof options.maxDelay !== "number" || options.maxDelay < options.initialDelay || !Number.isFinite(options.maxDelay)) {
        throw new Error("CongestionManager: 'maxDelay' must be a finite number greater than or equal to 'initialDelay'.");
      }
      if (typeof options.maxAttempts !== "number" || options.maxAttempts < 1 || !Number.isInteger(options.maxAttempts)) {
        throw new Error("CongestionManager: 'maxAttempts' must be an integer greater than or equal to 1.");
      }
      this.initialDelay = options.initialDelay;
      this.maxDelay = options.maxDelay;
      this.factor = options.factor !== undefined ? options.factor : 2;
      if (typeof this.factor !== "number" || this.factor < 1 || !Number.isFinite(this.factor)) {
        throw new Error("CongestionManager: 'factor' must be a finite number greater than or equal to 1.");
      }
      this.maxAttempts = options.maxAttempts;
    }
  
    /**
     * Executes a given function with exponential backoff.
     *
     * If the function throws or rejects, and the optional retryCondition (if provided)
     * returns true for the error, the function is retried up to maxAttempts times.
     *
     * @param fn A function that returns a Promise or a synchronous value.
     * @param retryCondition An optional predicate that determines if a caught error is retryable.
     *                       If omitted, all errors will be retried until maxAttempts is reached.
     * @param signal Optional AbortSignal to cancel the retries.
     * @returns A Promise resolving with the function’s result if successful,
     *          or rejecting with the last encountered error.
     */
    public async execute<T>(
      fn: () => Promise<T> | T,
      retryCondition?: (error: any) => boolean,
      signal?: AbortSignal
    ): Promise<T> {
      let attempt = 0;
      let delay = this.initialDelay;
      let lastError: any;
  
      while (attempt < this.maxAttempts) {
        if (signal?.aborted) {
          throw new Error("CongestionManager: Operation aborted.");
        }
        try {
          const result = await fn();
          return result;
        } catch (error) {
          lastError = error;
          // If a retryCondition is provided, use it to decide whether to retry.
          if (retryCondition && !retryCondition(error)) {
            throw error;
          }
          attempt++;
          if (attempt >= this.maxAttempts) {
            break;
          }
          // Wait for the computed delay (with exponential backoff) before retrying.
          await this.wait(delay, signal);
          delay = Math.min(delay * this.factor, this.maxDelay);
        }
      }
      throw new Error(
        `CongestionManager: Operation failed after ${this.maxAttempts} attempts. Last error: ${lastError?.message || lastError}`
      );
    }
  
    /**
     * Returns a promise that resolves after the specified number of milliseconds,
     * unless the provided abort signal cancels the wait.
     *
     * @param ms The number of milliseconds to wait.
     * @param signal Optional AbortSignal to cancel the wait.
     * @returns A Promise that resolves after the delay or rejects if aborted.
     */
    private wait(ms: number, signal?: AbortSignal): Promise<void> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (signal) {
            signal.removeEventListener("abort", onAbort);
          }
          resolve();
        }, ms);
  
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error("CongestionManager: Wait aborted."));
        };
  
        if (signal) {
          if (signal.aborted) {
            clearTimeout(timer);
            return reject(new Error("CongestionManager: Wait aborted."));
          }
          signal.addEventListener("abort", onAbort);
        }
      });
    }
  }
  