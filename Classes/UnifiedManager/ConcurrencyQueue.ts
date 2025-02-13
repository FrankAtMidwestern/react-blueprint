import { AbortManager } from "./AbortManager"

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
 *
 * The task function receives an AbortSignal so that it can listen
 * for cancellation or timeout events.
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

  // Tasks waiting to be processed (ordered by priority).
  private pendingQueue: QueueTask<T>[] = [];
  // Tasks currently processing.
  private processingQueue: Map<string, QueueTask<T>> = new Map();
  // Completed tasks stored with their result or error.
  private completedTasks: Map<string, CompletedTaskRecord<T>> = new Map();
  // To track the order of completed tasks (for cleanup).
  private completedTaskOrder: string[] = [];

  // Instance of AbortManager to handle AbortController logic.
  private abortManager: AbortManager = new AbortManager();

  // A flag to indicate the queue is destroyed.
  private destroyed: boolean = false;

  /**
   * Create a new ConcurrencyQueue.
   * @param options Configuration options.
   */
  constructor(options: ConcurrencyQueueOptions) {
    // Validate required options.
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
    // Default to 1000 completed tasks if not provided.
    this.maxCompletedTasks =
      options.maxCompletedTasks !== undefined && options.maxCompletedTasks > 0
        ? options.maxCompletedTasks
        : 1000;
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
      | "addedAt"
      | "status"
      | "attempts"
      | "abortController"
      | "_resolve"
      | "_reject"
    >
  ): Promise<T> {
    if (this.destroyed) {
      return Promise.reject(new Error("Queue has been destroyed."));
    }

    return new Promise((resolve, reject) => {
      // Validate task id.
      if (!task.id || typeof task.id !== "string" || task.id.trim() === "") {
        return reject(new Error("Task 'id' must be a non-empty string."));
      }
      // Check for duplicate task id in any queue.
      if (
        this.pendingQueue.some((t) => t.id === task.id) ||
        this.processingQueue.has(task.id) ||
        this.completedTasks.has(task.id)
      ) {
        return reject(
          new Error(
            `A task with id '${task.id}' already exists in the queue. Please use a unique id.`
          )
        );
      }
      // Validate the run function.
      if (typeof task.run !== "function") {
        return reject(new Error("Task 'run' must be a function that returns a Promise."));
      }
      // Validate optional properties.
      if (task.timeout !== undefined && (typeof task.timeout !== "number" || task.timeout <= 0)) {
        return reject(new Error("Task 'timeout', if provided, must be a positive number."));
      }
      if (
        task.retries !== undefined &&
        (typeof task.retries !== "number" || task.retries < 0 || !Number.isInteger(task.retries))
      ) {
        return reject(new Error("Task 'retries', if provided, must be a non-negative integer."));
      }
      // Check pending queue length if a limit is set.
      if (this.maxPendingTasks !== undefined && this.pendingQueue.length >= this.maxPendingTasks) {
        return reject(new Error("Maximum pending tasks reached. Cannot add more tasks."));
      }

      // Create a full task object with default internal properties.
      const fullTask: QueueTask<T> = {
        ...task,
        addedAt: new Date(),
        status: TaskStatus.Pending,
        attempts: 0,
        offlineAllowed: task.offlineAllowed !== false, // default true
      };

      // Attach the promise handlers to the task.
      fullTask._resolve = resolve;
      fullTask._reject = reject;

      // Add the task to the pending queue (sorted by priority).
      this.enqueueTask(fullTask);

      // Auto-start processing if enabled.
      if (this.autoStart && !this.paused) {
        this.processQueue();
      }
    });
  }

  /**
   * Enqueues a task into the pending queue, sorted by priority.
   * @param task The task to enqueue.
   */
  private enqueueTask(task: QueueTask<T>) {
    task.priority = typeof task.priority === "number" ? task.priority : 0;
    let inserted = false;
    // Insert task so that higher priority tasks come first.
    for (let i = 0; i < this.pendingQueue.length; i++) {
      if ((this.pendingQueue[i].priority ?? 0) < task.priority!) {
        this.pendingQueue.splice(i, 0, task);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.pendingQueue.push(task);
    }
    this.updateState();
  }

  /**
   * Pauses the processing of tasks.
   */
  public pause() {
    this.paused = true;
  }

  /**
   * Resumes processing of tasks.
   */
  public resume() {
    if (!this.paused) return;
    this.paused = false;
    this.processQueue();
  }

  /**
   * Cancels a task by its ID.
   *
   * If the task is pending, it is removed from the queue.
   * If it is processing, its AbortController is signaled via the AbortManager.
   * @param taskId The unique ID of the task.
   */
  public cancelTask(taskId: string) {
    if (this.destroyed) return;

    // Cancel pending tasks.
    const index = this.pendingQueue.findIndex((task) => task.id === taskId);
    if (index !== -1) {
      const [task] = this.pendingQueue.splice(index, 1);
      task.status = TaskStatus.Cancelled;
      const errorMsg = "Task cancelled";
      task._reject && task._reject(new Error(errorMsg));
      this.addToCompleted(taskId, { task, error: errorMsg });
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
      // Continue processing subsequent tasks.
      this.processQueue();
    }
  }

  /**
   * Processes tasks from the pending queue, honoring the concurrency limit.
   */
  private async processQueue() {
    // Do not process if paused or destroyed.
    if (this.paused || this.destroyed) return;

    while (
      !this.paused &&
      this.processingQueue.size < this.concurrency &&
      this.pendingQueue.length > 0
    ) {
      // If offline-check is provided, only process tasks that are allowed offline.
      if (this.isOffline && this.isOffline()) {
        const nextTask = this.pendingQueue[0];
        if (!nextTask.offlineAllowed) {
          // If the next task is not allowed offline, pause processing.
          break;
        }
      }
      // Dequeue the next task.
      const task = this.pendingQueue.shift()!;
      this.runTask(task);
    }
  }

  /**
   * Runs a single task with timeout, retry, and error handling.
   * @param task The task to run.
   */
  private async runTask(task: QueueTask<T>) {
    if (this.destroyed) return;

    // Mark task as processing.
    task.status = TaskStatus.Processing;
    task.attempts = (task.attempts ?? 0) + 1;
    // Create and register an AbortController using the AbortManager.
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

    // Setup a timeout if specified.
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (task.timeout) {
      timeoutId = setTimeout(() => {
        try {
          this.abortManager.abortById(task.id);
        } catch (err) {
          // Log error if abort fails.
          console.error(`Timeout abort failed for task ${task.id}:`, err);
        }
      }, task.timeout);
    }

    try {
      // Run the task using the signal from AbortManager.
      const result = await task.run(abortController.signal);
      task.status = TaskStatus.Completed;
      if (timeoutId) clearTimeout(timeoutId);
      this.processingQueue.delete(task.id);
      // Clean up the AbortController for the task.
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
      // Clean up the AbortController.
      this.abortManager.removeController(task.id);

      // Retry logic: if the task has remaining retries, re-enqueue it.
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
      // Always check for additional tasks after processing one.
      if (!this.paused && !this.destroyed) {
        this.processQueue();
      }
    }
  }

  /**
   * Adds a record to the completed tasks map and cleans up if necessary.
   * @param taskId The unique task identifier.
   * @param record The record to store.
   */
  private addToCompleted(taskId: string, record: CompletedTaskRecord<T>) {
    this.completedTasks.set(taskId, record);
    this.completedTaskOrder.push(taskId);
    // Clean up old completed tasks if we exceed maxCompletedTasks.
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

  /**
   * Returns the current status of a task by ID.
   * @param taskId The unique ID of the task.
   */
  public getStatus(taskId: string): TaskStatus | undefined {
    if (this.processingQueue.has(taskId)) {
      return this.processingQueue.get(taskId)!.status;
    }
    const pendingTask = this.pendingQueue.find((task) => task.id === taskId);
    if (pendingTask) return pendingTask.status;
    const completed = this.completedTasks.get(taskId);
    return completed?.task.status;
  }

  /**
   * Returns a summary of the queue state.
   */
  public getQueueState() {
    return {
      pending: this.pendingQueue.length,
      processing: this.processingQueue.size,
      completed: this.completedTasks.size,
      failed: Array.from(this.completedTasks.values()).filter(
        (item) => item.error
      ).length,
    };
  }

  /**
   * Updates external state or cache if callbacks are provided.
   */
  private updateState() {
    const state = this.getQueueState();
    if (this.stateUpdateCallback && typeof this.stateUpdateCallback === "function") {
      try {
        this.stateUpdateCallback(state);
      } catch (error) {
        // Ensure that stateUpdateCallback errors do not crash the queue.
        console.error("Error in stateUpdateCallback:", error);
      }
    }
    if (this.setCache && typeof this.setCache === "function") {
      try {
        // Save queue details to an external cache.
        this.setCache({
          pending: [...this.pendingQueue],
          processing: Array.from(this.processingQueue.values()),
          completed: Array.from(this.completedTasks.values()),
        });
      } catch (error) {
        console.error("Error in setCache callback:", error);
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
    // Abort all tasks via AbortManager.
    this.abortManager.abortAll();
    // Clear pending tasks and reject their promises.
    this.pendingQueue.forEach((task) => {
      const errorMsg = "Queue destroyed; task cancelled";
      task.status = TaskStatus.Cancelled;
      task._reject && task._reject(new Error(errorMsg));
    });
    this.pendingQueue = [];
    // Abort any processing tasks.
    this.processingQueue.forEach((task) => {
      task.abortController?.abort();
      const errorMsg = "Queue destroyed; task aborted";
      task.status = TaskStatus.Aborted;
      task._reject && task._reject(new Error(errorMsg));
    });
    this.processingQueue.clear();
    // Clear completed tasks.
    this.completedTasks.clear();
    this.completedTaskOrder = [];
    this.updateState();
  }
}
