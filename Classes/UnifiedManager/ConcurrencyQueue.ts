import { AbortManager } from "./AbortManager";
import { PriorityQueue } from "./PriorityQueue";
import { DebouncerManager } from "./DebouncerManager";

/**
 * Enum representing the status of a task.
 */
export enum TaskStatus {
  Pending = "Pending",
  Processing = "Processing",
  Completed = "Completed",
  Failed = "Failed",
  Aborted = "Aborted",
  Cancelled = "Cancelled",
}

/**
 * Metadata stored for each completed task.
 * Note that we're storing minimal fields to reduce memory usage.
 */
interface CompletedTaskMetadata {
  id: string;
  priority?: number;
  addedAt?: Date;
  status?: TaskStatus;
  attempts?: number;
}

/**
 * The record we store for each completed task.
 * - `taskMetadata`: minimal identifying info about the task
 * - `result` or `error`: indicates how the task ended
 * - `completedAt`: timestamp of completion
 */
interface CompletedTaskRecord<T> {
  taskMetadata: CompletedTaskMetadata;
  result?: T;
  error?: string;
  completedAt: Date;
}

/**
 * Interface for each queue task.
 */
export interface QueueTask<T> {
  /** Unique task identifier (must be a non-empty string) */
  id: string;
  /**
   * The function to run when the task is processed.
   * Must return a Promise.
   */
  run: (signal: AbortSignal) => Promise<T>;
  /** Optional priority (higher numbers run first; default is 0) */
  priority?: number;
  /** Date the task was added (populated internally) */
  addedAt?: Date;
  /** Optional timeout in milliseconds */
  timeout?: number;
  /** Number of retries allowed (if the task fails) */
  retries?: number;
  /**
   * If false, the task will not run when offline.
   * Defaults to true.
   */
  offlineAllowed?: boolean;
  /** Internal: current status */
  status?: TaskStatus;
  /** Internal: number of attempts made */
  attempts?: number;
  /** Internal: AbortController for cancelling the task */
  abortController?: AbortController;
  /**
   * Internal: Promise resolve function.
   * (Do not set manually; used by the queue.)
   */
  _resolve?: (result: T) => void;
  /**
   * Internal: Promise reject function.
   * (Do not set manually; used by the queue.)
   */
  _reject?: (error: any) => void;
}

/**
 * Options to configure the ConcurrencyQueue.
 */
export interface ConcurrencyQueueOptions {
  /** Maximum number of tasks to run concurrently (must be >= 1) */
  concurrency: number;
  /** If true, the queue starts processing automatically */
  autoStart?: boolean;
  /** Initial paused state */
  paused?: boolean;
  /**
   * Callback that receives state updates.
   * Useful for integration with external stores (e.g. Redux).
   */
  stateUpdateCallback?: (state: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  }) => void;
  /**
   * Optional function to check if the device/app is offline.
   * When provided, tasks with offlineAllowed===false will wait.
   */
  isOffline?: () => boolean;
  /**
   * Optional getter for an external cache/service.
   * For example, this could be used to integrate with an LRU or TTL system.
   */
  getCache?: () => any;
  /**
   * Optional setter to update external state/cache.
   */
  setCache?: (data: any) => void;
  /**
   * Optional callback fired on task success.
   */
  onTaskSuccess?: (task: QueueTask<any>, result: any) => void;
  /**
   * Optional callback fired on task failure.
   */
  onTaskFailure?: (task: QueueTask<any>, error: any) => void;
  /**
   * Optional maximum number of pending tasks.
   * If set, attempts to add tasks beyond this will be rejected.
   */
  maxPendingTasks?: number;
  /**
   * Optional maximum number of completed tasks stored in memory.
   * Setting this to 0 disables storing completed tasks altogether.
   */
  maxCompletedTasks?: number;
  /**
   * Optional maximum age (in ms) for completed tasks.
   * Tasks older than this are removed.  Example: 5 * 60 * 1000 for 5 minutes.
   */
  maxCompletedTaskAge?: number;
  /**
   * Debounce delay (in ms) for state updates.
   */
  stateUpdateDebounceDelay?: number;
}

/**
 * A high-performance concurrency queue for managing asynchronous tasks.
 * Now using a heap-based priority queue for pending tasks.
 *
 * This class supports:
 * - Priority-based scheduling
 * - Concurrency limits
 * - Abort/timeout/retry logic with clear error messages
 * - Integration with external state/cache layers
 * - Guards against duplicate tasks and memory leaks
 *
 * @example
 * const queue = new ConcurrencyQueue<MyResultType>({
 *   concurrency: 3,
 *   stateUpdateCallback: (state) => console.log(state),
 *   maxPendingTasks: 100,
 *   maxCompletedTasks: 1000,
 *   maxCompletedTaskAge: 300000, // 5 minutes
 *   stateUpdateDebounceDelay: 100,
 * });
 *
 * queue.addTask({
 *   id: 'unique-task-id',
 *   run: async (signal) => {
 *     // do something asynchronous, checking signal.aborted as needed
 *   },
 * });
 */
export class ConcurrencyQueue<T> {
  private concurrency: number;
  private autoStart: boolean;
  private paused: boolean;
  private stateUpdateCallback?: (state: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  }) => void;
  private isOffline?: () => boolean;
  private getCache?: () => any;
  private setCache?: (data: any) => void;
  private onTaskSuccess?: (task: QueueTask<T>, result: T) => void;
  private onTaskFailure?: (task: QueueTask<T>, error: any) => void;
  private maxPendingTasks?: number;
  private maxCompletedTasks: number;
  private maxCompletedTaskAge?: number;
  private stateUpdateDebounceDelay: number;

  // Using a heap-based priority queue for pending tasks.
  private pendingQueue: PriorityQueue<QueueTask<T>>;
  // Tasks currently processing.
  private processingQueue: Map<string, QueueTask<T>> = new Map();
  // Completed tasks stored with their result or error.
  private completedTasks: Map<string, CompletedTaskRecord<T>> = new Map();
  // To track the order of completed tasks (for cleanup).
  private completedTaskOrder: string[] = [];

  // Instance of AbortManager to handle AbortController logic.
  private abortManager: AbortManager;

  // A flag to indicate the queue is destroyed.
  private destroyed: boolean = false;

  // Debouncer for state updates
  private debouncedUpdateState?: DebouncerManager<[], void>;

  constructor(options: ConcurrencyQueueOptions, abortManager?: AbortManager) {
    // Validate concurrency
    if (
      typeof options.concurrency !== "number" ||
      options.concurrency < 1 ||
      !Number.isInteger(options.concurrency)
    ) {
      throw new Error("Option 'concurrency' must be an integer greater than 0.");
    }
    this.concurrency = options.concurrency;
    this.autoStart = options.autoStart ?? true;
    this.paused = options.paused ?? false;
    this.stateUpdateCallback = options.stateUpdateCallback;
    this.isOffline = options.isOffline;
    this.getCache = options.getCache;
    this.setCache = options.setCache;
    this.onTaskSuccess = options.onTaskSuccess;
    this.onTaskFailure = options.onTaskFailure;
    this.maxPendingTasks = options.maxPendingTasks;

    // Validate maxCompletedTasks
    if (
      options.maxCompletedTasks !== undefined &&
      (!Number.isInteger(options.maxCompletedTasks) || options.maxCompletedTasks < 0)
    ) {
      throw new Error("maxCompletedTasks must be a non-negative integer.");
    }
    this.maxCompletedTasks = options.maxCompletedTasks ?? 1000;

    // Validate maxCompletedTaskAge
    if (options.maxCompletedTaskAge !== undefined) {
      if (typeof options.maxCompletedTaskAge !== 'number' || options.maxCompletedTaskAge <= 0) {
        throw new Error("maxCompletedTaskAge must be a positive number.");
      }
    }
    this.maxCompletedTaskAge = options.maxCompletedTaskAge;

    // Debounce delay for state updates
    this.stateUpdateDebounceDelay = options.stateUpdateDebounceDelay ?? 100;

    // Use an existing AbortManager or create a new one
    this.abortManager = abortManager || new AbortManager();

    // Initialize the pendingQueue as a max-heap (higher priority = bigger number).
    this.pendingQueue = new PriorityQueue<QueueTask<T>>((a, b) => {
      const priorityA = typeof a.priority === "number" ? a.priority : 0;
      const priorityB = typeof b.priority === "number" ? b.priority : 0;
      return priorityA - priorityB;
    });

    // Set up the debounced state update if external callbacks are provided.
    if (this.stateUpdateCallback || this.setCache) {
      this.debouncedUpdateState = new DebouncerManager(
        () => {
          const state = this.getQueueState();
          if (this.stateUpdateCallback) {
            try {
              this.stateUpdateCallback(state);
            } catch (error) {
              console.error("Error in stateUpdateCallback:", error);
            }
          }
          if (this.setCache) {
            try {
              this.setCache({
                pending: this.pendingQueue.toArray(),
                processing: Array.from(this.processingQueue.values()),
                completed: Array.from(this.completedTasks.values()),
              });
            } catch (error) {
              console.error("Error in setCache callback:", error);
            }
          }
        },
        this.stateUpdateDebounceDelay,
        false // trailing
      );
    }
  }

  /**
   * Adds a new task to the queue.
   *
   * Validates the task properties and prevents duplicate task IDs.
   *
   * @param task Partial task details (the queue will add addedAt, status, etc.)
   * @returns A Promise that resolves or rejects with the task result.
   */
  public addTask(
    task: Omit<
      QueueTask<T>,
      "addedAt" | "status" | "attempts" | "abortController" | "_resolve" | "_reject"
    >
  ): Promise<T> {
    if (this.destroyed) {
      return Promise.reject(new Error("Queue has been destroyed."));
    }

    return new Promise((resolve, reject) => {
      if (!task.id || typeof task.id !== "string" || task.id.trim() === "") {
        return reject(new Error("Task 'id' must be a non-empty string."));
      }
      // Check for duplicate task id across all queues.
      if (
        this.pendingQueue.toArray().some((t) => t.id === task.id) ||
        this.processingQueue.has(task.id) ||
        this.completedTasks.has(task.id)
      ) {
        return reject(
          new Error(
            `A task with id '${task.id}' already exists in the queue. Please use a unique id.`
          )
        );
      }
      if (typeof task.run !== "function") {
        return reject(new Error("Task 'run' must be a function that returns a Promise."));
      }
      if (task.timeout !== undefined && (typeof task.timeout !== "number" || task.timeout <= 0)) {
        return reject(new Error("Task 'timeout', if provided, must be a positive number."));
      }
      if (
        task.retries !== undefined &&
        (typeof task.retries !== "number" || task.retries < 0 || !Number.isInteger(task.retries))
      ) {
        return reject(new Error("Task 'retries', if provided, must be a non-negative integer."));
      }
      if (this.maxPendingTasks !== undefined && this.pendingQueue.size() >= this.maxPendingTasks) {
        return reject(new Error("Maximum pending tasks reached. Cannot add more tasks."));
      }

      // Ensure a default priority of 0.
      task.priority = typeof task.priority === "number" ? task.priority : 0;
      const fullTask: QueueTask<T> = {
        ...task,
        addedAt: new Date(),
        status: TaskStatus.Pending,
        attempts: 0,
        offlineAllowed: task.offlineAllowed !== false,
      };

      fullTask._resolve = resolve;
      fullTask._reject = reject;

      // Use the heap-based priority queue.
      this.pendingQueue.push(fullTask);
      this.updateState();

      if (this.autoStart && !this.paused) {
        this.processQueue();
      }
    });
  }

  /**
   * Processes tasks from the pending queue, honoring the concurrency limit.
   */
  private async processQueue() {
    if (this.paused || this.destroyed) return;

    while (
      !this.paused &&
      this.processingQueue.size < this.concurrency &&
      this.pendingQueue.size() > 0
    ) {
      // If offline, skip tasks that are not offlineAllowed
      if (this.isOffline && this.isOffline()) {
        const pendingArray = this.pendingQueue.toArray();
        const taskIndex = pendingArray.findIndex((task) => task.offlineAllowed);
        if (taskIndex === -1) break;

        let task: QueueTask<T> | undefined;
        this.pendingQueue.remove((t) => {
          if (t.id === pendingArray[taskIndex].id) {
            task = t;
            return true;
          }
          return false;
        });
        if (task) {
          this.runTask(task);
        }
      } else {
        const task = this.pendingQueue.pop();
        if (task) {
          this.runTask(task);
        }
      }
    }
  }

  /**
   * Runs a single task with timeout, retry, and error handling.
   */
  private async runTask(task: QueueTask<T>) {
    if (this.destroyed) return;

    task.status = TaskStatus.Processing;
    task.attempts = (task.attempts ?? 0) + 1;

    let abortController: AbortController;
    try {
      abortController = this.abortManager.createController(task.id);
    } catch (error) {
      task._reject && task._reject(error);
      return;
    }
    task.abortController = abortController;
    this.processingQueue.set(task.id, task);
    this.updateState();

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (task.timeout) {
      timeoutId = setTimeout(() => {
        try {
          this.abortManager.abortById(task.id);
        } catch (err) {
          console.error(`Timeout abort failed for task ${task.id}:`, err);
        }
      }, task.timeout);
    }

    try {
      const result = await task.run(abortController.signal);
      task.status = TaskStatus.Completed;
      if (timeoutId) clearTimeout(timeoutId);
      this.processingQueue.delete(task.id);
      this.abortManager.removeController(task.id);

      this.addToCompleted(task.id, {
        taskMetadata: {
          id: task.id,
          priority: task.priority,
          addedAt: task.addedAt,
          status: task.status,
          attempts: task.attempts,
        },
        result,
      });
      task._resolve && task._resolve(result);
      if (this.onTaskSuccess) this.onTaskSuccess(task, result);
      this.updateState();
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);
      let errorMsg: string;
      if (abortController.signal.aborted) {
        errorMsg = "Task aborted or timed out";
        task.status = TaskStatus.Aborted;
      } else {
        errorMsg = error && error.message ? error.message : "Task failed";
        task.status = TaskStatus.Failed;
      }
      this.processingQueue.delete(task.id);
      this.abortManager.removeController(task.id);

      if (typeof task.retries === "number" && task.attempts <= task.retries) {
        // Clear any unneeded references/data before requeuing.
        this.enqueueTask({
          ...task,
          status: TaskStatus.Pending, // Reset status
        });
      } else {
        this.addToCompleted(task.id, {
          taskMetadata: {
            id: task.id,
            priority: task.priority,
            addedAt: task.addedAt,
            status: task.status,
            attempts: task.attempts,
          },
          error: errorMsg,
        });
        task._reject && task._reject(new Error(errorMsg));
        if (this.onTaskFailure) this.onTaskFailure(task, errorMsg);
      }
      this.updateState();
    } finally {
      if (!this.paused && !this.destroyed) {
        this.processQueue();
      }
    }
  }

  /**
   * Enqueues a task back to the pending queue (used for retries).
   */
  private enqueueTask(task: QueueTask<T>) {
    // Insert into pending heap
    this.pendingQueue.push(task);
    this.updateState();
  }

  /**
   * Cancels a task by its ID.
   *
   * If the task is pending, it is removed from the queue.
   * If it is processing, its AbortController is signaled via the AbortManager.
   */
  public cancelTask(taskId: string) {
    if (this.destroyed) return;

    // Attempt to remove the task from the pending queue.
    const removed = this.pendingQueue.remove((task) => task.id === taskId);
    if (removed) {
      this.addToCompleted(taskId, {
        taskMetadata: {
          id: taskId,
          status: TaskStatus.Cancelled,
        },
        error: "Task cancelled",
      });
      this.updateState();
      return;
    }

    // Cancel processing tasks.
    if (this.processingQueue.has(taskId)) {
      const task = this.processingQueue.get(taskId)!;
      try {
        this.abortManager.abortById(taskId);
      } catch (err) {
        console.error(`Error aborting task ${taskId}:`, err);
      }
      task.status = TaskStatus.Aborted;
      task._reject && task._reject(new Error("Task aborted"));
      this.processingQueue.delete(taskId);

      this.addToCompleted(taskId, {
        taskMetadata: {
          id: task.id,
          priority: task.priority,
          addedAt: task.addedAt,
          status: TaskStatus.Cancelled,
          attempts: task.attempts,
        },
        error: "Task aborted",
      });
      this.updateState();
      this.processQueue();
    }
  }

  /**
   * Adds a record to the completed tasks map and performs cleanup
   * based on maxCompletedTasks and maxCompletedTaskAge.
   */
  private addToCompleted(
    taskId: string,
    record: Omit<CompletedTaskRecord<T>, "completedAt">
  ) {
    const completedAt = new Date();
    const completedRecord: CompletedTaskRecord<T> = {
      ...record,
      completedAt,
    };

    // If storing completed tasks is disabled (maxCompletedTasks=0), simply return.
    if (this.maxCompletedTasks === 0) {
      return;
    }

    this.completedTasks.set(taskId, completedRecord);
    this.completedTaskOrder.push(taskId);

    // Enforce maxCompletedTasks
    if (this.maxCompletedTasks >= 0) {
      while (this.completedTaskOrder.length > this.maxCompletedTasks) {
        const oldTaskId = this.completedTaskOrder.shift();
        if (oldTaskId) {
          this.completedTasks.delete(oldTaskId);
        }
      }
    }

    // Enforce maxCompletedTaskAge
    if (this.maxCompletedTaskAge !== undefined) {
      const now = Date.now();
      const ageThreshold = now - this.maxCompletedTaskAge;
      while (this.completedTaskOrder.length > 0) {
        const oldestTaskId = this.completedTaskOrder[0];
        const oldestRecord = this.completedTasks.get(oldestTaskId);
        if (
          oldestRecord &&
          oldestRecord.completedAt.getTime() < ageThreshold
        ) {
          this.completedTaskOrder.shift();
          this.completedTasks.delete(oldestTaskId);
        } else {
          break;
        }
      }
    }
  }

  /**
   * Returns the current status of a task by ID.
   */
  public getStatus(taskId: string): TaskStatus | undefined {
    if (this.processingQueue.has(taskId)) {
      return this.processingQueue.get(taskId)!.status;
    }
    if (this.pendingQueue.toArray().find((task) => task.id === taskId)) {
      return TaskStatus.Pending;
    }
    const completed = this.completedTasks.get(taskId);
    return completed?.taskMetadata.status;
  }

  /**
   * Returns a summary of the queue state.
   */
  public getQueueState() {
    return {
      pending: this.pendingQueue.size(),
      processing: this.processingQueue.size,
      completed: this.completedTasks.size,
      failed: Array.from(this.completedTasks.values()).filter((item) => item.error).length,
    };
  }

  /**
   * Updates the external state.
   *
   * If a debouncer is set up (because stateUpdateCallback or setCache is provided),
   * this method calls the debounced function. Otherwise, it updates immediately.
   */
  private updateState(forceImmediate = false) {
    if (this.debouncedUpdateState) {
      if (forceImmediate) {
        this.debouncedUpdateState.flush();
      } else {
        this.debouncedUpdateState.call();
      }
    } else {
      // Fallback: update immediately
      const state = this.getQueueState();
      if (this.stateUpdateCallback) {
        try {
          this.stateUpdateCallback(state);
        } catch (error) {
          console.error("Error in stateUpdateCallback:", error);
        }
      }
      if (this.setCache) {
        try {
          this.setCache({
            pending: this.pendingQueue.toArray(),
            processing: Array.from(this.processingQueue.values()),
            completed: Array.from(this.completedTasks.values()),
          });
        } catch (error) {
          console.error("Error in setCache callback:", error);
        }
      }
    }
  }

  /**
   * Destroys the queue by stopping processing and clearing all internal data.
   *
   * This helps prevent memory leaks when the queue is no longer needed.
   */
  public destroy() {
    this.paused = true;
    this.destroyed = true;
    this.abortManager.abortAll();

    // Cancel all pending tasks
    this.pendingQueue.toArray().forEach((task) => {
      const errorMsg = "Queue destroyed; task cancelled";
      task.status = TaskStatus.Cancelled;
      task._reject && task._reject(new Error(errorMsg));
    });
    // Clear pending tasks from the heap
    while (!this.pendingQueue.isEmpty()) {
      this.pendingQueue.pop();
    }

    // Abort all processing tasks
    this.processingQueue.forEach((task) => {
      task.abortController?.abort();
      const errorMsg = "Queue destroyed; task aborted";
      task.status = TaskStatus.Aborted;
      task._reject && task._reject(new Error(errorMsg));
    });
    this.processingQueue.clear();

    // Clear completed tasks
    this.completedTasks.clear();
    this.completedTaskOrder = [];

    // Immediately flush any pending state update and cancel debouncer
    this.updateState(true);
    if (this.debouncedUpdateState) {
      this.debouncedUpdateState.cancel();
    }
  }
}
