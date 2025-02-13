import { AbortManager } from "./AbortManager";
import { DebouncerManager } from "./DebouncerManager";
import { CongestionManager, CongestionManagerOptions } from "./CongestionManager";
import { ConcurrencyQueue, ConcurrencyQueueOptions } from "./ConcurrencyQueue";

/**
 * Options for configuring the UnifiedManager integration layer.
 */
export interface UnifiedManagerOptions {
  /**
   * Options for the underlying concurrency queue.
   * For example, concurrency, pending limits, and state callbacks.
   */
  concurrencyOptions?: ConcurrencyQueueOptions;
  /**
   * Options for the congestion manager (exponential backoff).
   */
  congestionOptions?: CongestionManagerOptions;
  /**
   * Default options for debouncing.
   */
  debounceOptions?: {
    delay: number;
    immediate?: boolean;
  };
}

/**
 * UnifiedManager
 *
 * This class integrates AbortManager, DebouncerManager, CongestionManager,
 * and ConcurrencyQueue into a single, easy-to-use API.
 *
 * It allows you to execute tasks in a controlled way (with rate limiting, retries,
 * concurrency control, and cancellation) as well as create debounced functions.
 *
 * Users can import this UnifiedManager for the complete solution,
 * or they can import individual managers as needed.
 */
export class UnifiedManager {
  public concurrencyQueue: ConcurrencyQueue<any>;
  public congestionManager: CongestionManager;
  public abortManager: AbortManager;
  // Save default debouncing options for creating debounced functions.
  public defaultDebounceOptions?: {
    delay: number;
    immediate?: boolean;
  };

  constructor(options?: UnifiedManagerOptions) {
    // Create a ConcurrencyQueue instance with provided or default options.
    this.concurrencyQueue = new ConcurrencyQueue({
      // Provide a default concurrency of 5 if none is specified.
      concurrency: options?.concurrencyOptions?.concurrency || 5,
      stateUpdateCallback: options?.concurrencyOptions?.stateUpdateCallback,
      isOffline: options?.concurrencyOptions?.isOffline,
      getCache: options?.concurrencyOptions?.getCache,
      setCache: options?.concurrencyOptions?.setCache,
      onTaskSuccess: options?.concurrencyOptions?.onTaskSuccess,
      onTaskFailure: options?.concurrencyOptions?.onTaskFailure,
      maxPendingTasks: options?.concurrencyOptions?.maxPendingTasks,
      maxCompletedTasks: options?.concurrencyOptions?.maxCompletedTasks,
    });
    // Create a CongestionManager instance with provided or default options.
    this.congestionManager = new CongestionManager({
      initialDelay: options?.congestionOptions?.initialDelay ?? 500,
      maxDelay: options?.congestionOptions?.maxDelay ?? 5000,
      factor: options?.congestionOptions?.factor ?? 2,
      maxAttempts: options?.congestionOptions?.maxAttempts ?? 5,
    });
    // Create a single AbortManager instance to support cancellation across managers.
    this.abortManager = new AbortManager();
    // Save default debounce options.
    if (options?.debounceOptions) {
      this.defaultDebounceOptions = options.debounceOptions;
    }
  }

  /**
   * Executes a task through the integrated managers.
   *
   * The task is wrapped with congestion management (exponential backoff),
   * enqueued in the concurrency queue, and registered for cancellation via AbortManager.
   *
   * @param id Unique identifier for the task.
   * @param task A function that receives an AbortSignal and returns a Promise (or a synchronous value).
   * @param options Optional configuration for the task (timeout, retries, useCongestion).
   * @returns A Promise resolving to the task's result.
   */
  public executeTask<T>(
    id: string,
    task: (signal: AbortSignal) => Promise<T> | T,
    options?: { timeout?: number; retries?: number; useCongestion?: boolean }
  ): Promise<T> {
    // Always wrap the user's task in Promise.resolve so that the return type is Promise<T>.
    let wrappedTask: (signal: AbortSignal) => Promise<T> = (signal: AbortSignal) =>
      Promise.resolve(task(signal));

    if (options?.useCongestion) {
      wrappedTask = (signal: AbortSignal) =>
        this.congestionManager.execute<T>(
          () => Promise.resolve(task(signal)),
          undefined,
          signal
        );
    }
    return this.concurrencyQueue.addTask({
      id,
      run: wrappedTask,
      timeout: options?.timeout,
      retries: options?.retries,
    });
  }

  /**
   * Creates a debounced version of the provided function using DebouncerManager.
   *
   * @param fn The function to debounce.
   * @param delay Optional debounce delay. If not provided, uses the default debounce delay.
   * @param immediate Optional immediate flag. If not provided, uses the default debounce immediate value.
   * @returns A DebouncerManager instance wrapping the function.
   */
  public createDebouncedFunction<TArgs extends any[], TResult>(
    fn: (...args: TArgs) => TResult | Promise<TResult>,
    delay?: number,
    immediate?: boolean
  ): DebouncerManager<TArgs, TResult> {
    const useDelay = delay ?? this.defaultDebounceOptions?.delay ?? 300;
    const useImmediate =
      immediate ?? this.defaultDebounceOptions?.immediate ?? false;
    return new DebouncerManager<TArgs, TResult>(fn, useDelay, useImmediate);
  }

  /**
   * Cancels a task across the integrated managers using the AbortManager.
   *
   * @param id The unique identifier of the task to cancel.
   */
  public cancelTask(id: string): void {
    // Cancel the task in the concurrency queue...
    this.concurrencyQueue.cancelTask(id);
    // ...and use the abort manager as an extra layer for cancellation.
    try {
      this.abortManager.abortById(id);
    } catch (error) {
      console.error(`UnifiedManager: Error cancelling task ${id}:`, error);
    }
  }

  /**
   * Cancels all tasks across the integrated managers.
   */
  public cancelAll(): void {
    this.concurrencyQueue.destroy();
    this.abortManager.abortAll();
  }

  /**
   * Returns the status of a task by its ID from the concurrency queue.
   *
   * @param id The unique identifier of the task.
   * @returns The task's status.
   */
  public getTaskStatus(id: string) {
    return this.concurrencyQueue.getStatus(id);
  }

  /**
   * Destroys the integration manager and all underlying managers to prevent memory leaks.
   */
  public destroy(): void {
    this.concurrencyQueue.destroy();
    this.abortManager.destroy();
    // (If other managers require cleanup, do so here.)
  }
}
