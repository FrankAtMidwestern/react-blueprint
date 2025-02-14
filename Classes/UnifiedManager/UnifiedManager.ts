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
   * For example, concurrency, pending limits, state callbacks, etc.
   */
  concurrencyOptions?: ConcurrencyQueueOptions & {
    // (Optionally add typed hints if you want, e.g.:
    // maxCompletedTaskAge?: number;
    // stateUpdateDebounceDelay?: number;
  };

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
 * Integrates AbortManager, DebouncerManager, CongestionManager,
 * and ConcurrencyQueue into a single API.
 */
export class UnifiedManager {
  public concurrencyQueue: ConcurrencyQueue<any>;
  public congestionManager: CongestionManager;
  public abortManager: AbortManager;
  public defaultDebounceOptions?: {
    delay: number;
    immediate?: boolean;
  };

  constructor(options?: UnifiedManagerOptions) {
    // (NEW) Create the AbortManager first so we can pass it into ConcurrencyQueue
    this.abortManager = new AbortManager();

    // Create the ConcurrencyQueue instance with provided or default options.
    this.concurrencyQueue = new ConcurrencyQueue(
      {
        concurrency: options?.concurrencyOptions?.concurrency ?? 5,
        stateUpdateCallback: options?.concurrencyOptions?.stateUpdateCallback,
        isOffline: options?.concurrencyOptions?.isOffline,
        getCache: options?.concurrencyOptions?.getCache,
        setCache: options?.concurrencyOptions?.setCache,
        onTaskSuccess: options?.concurrencyOptions?.onTaskSuccess,
        onTaskFailure: options?.concurrencyOptions?.onTaskFailure,
        maxPendingTasks: options?.concurrencyOptions?.maxPendingTasks,
        maxCompletedTasks: options?.concurrencyOptions?.maxCompletedTasks,
        maxCompletedTaskAge: options?.concurrencyOptions?.maxCompletedTaskAge,
        stateUpdateDebounceDelay: options?.concurrencyOptions?.stateUpdateDebounceDelay,
      },
      this.abortManager
    );

    // Create a CongestionManager instance with provided or default options.
    this.congestionManager = new CongestionManager({
      initialDelay: options?.congestionOptions?.initialDelay ?? 500,
      maxDelay: options?.congestionOptions?.maxDelay ?? 5000,
      factor: options?.congestionOptions?.factor ?? 2,
      maxAttempts: options?.congestionOptions?.maxAttempts ?? 5,
    });

    // Save default debounce options.
    if (options?.debounceOptions) {
      this.defaultDebounceOptions = options.debounceOptions;
    }
  }

  /**
   * Executes a task through the integrated managers.
   *
   * If `useCongestion` is true, the task is wrapped in exponential backoff
   * before enqueuing in the concurrency queue.
   */
  public executeTask<T>(
    id: string,
    task: (signal: AbortSignal) => Promise<T> | T,
    options?: { timeout?: number; retries?: number; useCongestion?: boolean }
  ): Promise<T> {
    let wrappedTask: (signal: AbortSignal) => Promise<T> = (signal: AbortSignal) =>
      Promise.resolve(task(signal));

    if (options?.useCongestion) {
      wrappedTask = (signal: AbortSignal) => {
        return this.congestionManager.execute<T>(
          () => Promise.resolve(task(signal)),
          /* optional retryCondition */ undefined,
          signal
        );
      };
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
   */
  public createDebouncedFunction<TArgs extends any[], TResult>(
    fn: (...args: TArgs) => TResult | Promise<TResult>,
    delay?: number,
    immediate?: boolean
  ): DebouncerManager<TArgs, TResult> {
    const useDelay = delay ?? this.defaultDebounceOptions?.delay ?? 300;
    const useImmediate = immediate ?? this.defaultDebounceOptions?.immediate ?? false;
    return new DebouncerManager<TArgs, TResult>(fn, useDelay, useImmediate);
  }

  /**
   * Cancels a task by its unique ID.
   */
  public cancelTask(id: string): void {
    this.concurrencyQueue.cancelTask(id);
    try {
      this.abortManager.abortById(id);
    } catch (error) {
      console.error(`UnifiedManager: Error cancelling task ${id}:`, error);
    }
  }

  /**
   * Cancels all tasks across the managers.
   */
  public cancelAll(): void {
    this.concurrencyQueue.destroy();
    this.abortManager.abortAll();
  }

  /**
   * Returns the status of a task by its ID from the concurrency queue.
   */
  public getTaskStatus(id: string) {
    return this.concurrencyQueue.getStatus(id);
  }

  /**
   * Destroys the UnifiedManager (and all underlying managers).
   */
  public destroy(): void {
    this.concurrencyQueue.destroy();
    this.abortManager.destroy();
    // If other managers require cleanup, do so here.
  }
}
