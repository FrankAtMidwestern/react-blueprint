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
 * Internal interface for storing completed task data.
 */
interface CompletedTaskRecord<T> {
  task: QueueTask<T>;
  result?: T;
  error?: string;
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
   * Older completed tasks will be automatically removed.
   */
  maxCompletedTasks?: number;
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

  // --- New: Debouncer for state updates ---
  private debouncedUpdateState?: DebouncerManager<[], void>;
  // You can adjust the debounce delay as needed (default is 100ms)
  private stateUpdateDebounceDelay: number = 100;

  constructor(options: ConcurrencyQueueOptions, abortManager?: AbortManager) {
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
    this.abortManager = abortManager || new AbortManager();
    this.maxCompletedTasks =
      options.maxCompletedTasks !== undefined && options.maxCompletedTasks > 0
        ? options.maxCompletedTasks
        : 1000;

    // Initialize the pendingQueue as a max-heap.
    // Higher priority tasks (larger numbers) come out first.
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
        false // trailing edge execution
      );
    }
  }

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
      if (this.isOffline && this.isOffline()) {
        // Look for a task that is allowed offline.
        const pendingArray = this.pendingQueue.toArray();
        const taskIndex = pendingArray.findIndex(task => task.offlineAllowed);
        if (taskIndex === -1) break;
        // Remove that task using our remove method.
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
   * Enqueues a task into the pending queue.
   */
  private enqueueTask(task: QueueTask<T>) {
    this.pendingQueue.push(task);
    this.updateState();
  }

  public cancelTask(taskId: string) {
    if (this.destroyed) return;

    // Attempt to remove the task from the pending queue.
    const removed = this.pendingQueue.remove(task => task.id === taskId);
    if (removed) {
      const errorMsg = "Task cancelled";
      this.addToCompleted(taskId, { task: { id: taskId } as QueueTask<T>, error: errorMsg });
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
      this.addToCompleted(taskId, { task, error: "Task aborted" });
      this.updateState();
      this.processQueue();
    }
  }

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
      this.addToCompleted(task.id, { task, result });
      task._resolve && task._resolve(result);
      if (this.onTaskSuccess) this.onTaskSuccess(task, result);
      this.updateState();
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);
      let errorMsg = "";
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
        task.status = TaskStatus.Pending;
        this.enqueueTask(task);
      } else {
        this.addToCompleted(task.id, { task, error: errorMsg });
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

  private addToCompleted(taskId: string, record: CompletedTaskRecord<T>) {
    this.completedTasks.set(taskId, record);
    this.completedTaskOrder.push(taskId);
    if (this.completedTaskOrder.length > this.maxCompletedTasks) {
      const removeCount = this.completedTaskOrder.length - this.maxCompletedTasks;
      for (let i = 0; i < removeCount; i++) {
        const oldTaskId = this.completedTaskOrder.shift();
        if (oldTaskId) {
          this.completedTasks.delete(oldTaskId);
        }
      }
    }
  }

  public getStatus(taskId: string): TaskStatus | undefined {
    if (this.processingQueue.has(taskId)) {
      return this.processingQueue.get(taskId)!.status;
    }
    if (this.pendingQueue.toArray().find(task => task.id === taskId)) return TaskStatus.Pending;
    const completed = this.completedTasks.get(taskId);
    return completed?.task.status;
  }

  public getQueueState() {
    return {
      pending: this.pendingQueue.size(),
      processing: this.processingQueue.size,
      completed: this.completedTasks.size,
      failed: Array.from(this.completedTasks.values()).filter(item => item.error).length,
    };
  }

  /**
   * Updates the external state.
   *
   * If a debouncer is set up (because stateUpdateCallback or setCache is provided),
   * this method calls the debounced function. Otherwise, it updates immediately.
   */
  private updateState() {
    if (this.debouncedUpdateState) {
      // Schedule the debounced state update.
      this.debouncedUpdateState.call();
    } else {
      // Fallback: update immediately.
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

  public destroy() {
    this.paused = true;
    this.destroyed = true;
    this.abortManager.abortAll();
    this.pendingQueue.toArray().forEach(task => {
      const errorMsg = "Queue destroyed; task cancelled";
      task.status = TaskStatus.Cancelled;
      task._reject && task._reject(new Error(errorMsg));
    });
    // Clear pending tasks from the heap.
    while (!this.pendingQueue.isEmpty()) {
      this.pendingQueue.pop();
    }
    this.processingQueue.forEach(task => {
      task.abortController?.abort();
      const errorMsg = "Queue destroyed; task aborted";
      task.status = TaskStatus.Aborted;
      task._reject && task._reject(new Error(errorMsg));
    });
    this.processingQueue.clear();
    this.completedTasks.clear();
    this.completedTaskOrder = [];
    this.updateState();
  }
}
