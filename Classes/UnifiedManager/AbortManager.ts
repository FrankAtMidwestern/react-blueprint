export class AbortManager {
    // Internal map to store AbortControllers keyed by a unique task ID.
    private controllers: Map<string, AbortController>;
  
    constructor() {
      this.controllers = new Map();
    }
  
    /**
     * Creates and registers a new AbortController for a given task ID.
     * @param id - A non-empty string uniquely identifying the task.
     * @returns The created AbortController.
     * @throws Error if the id is invalid or if a controller already exists for the id.
     */
    public createController(id: string): AbortController {
      if (!id || typeof id !== "string" || id.trim() === "") {
        throw new Error("AbortManager.createController: Task ID must be a non-empty string.");
      }
      if (this.controllers.has(id)) {
        throw new Error(
          `AbortManager.createController: An AbortController already exists for task ID "${id}".`
        );
      }
      const controller = new AbortController();
      this.controllers.set(id, controller);
      return controller;
    }
  
    /**
     * Retrieves the AbortSignal for the controller associated with the given task ID.
     * @param id - The unique task ID.
     * @returns The AbortSignal.
     * @throws Error if the id is invalid or no controller is found.
     */
    public getSignal(id: string): AbortSignal {
      if (!id || typeof id !== "string" || id.trim() === "") {
        throw new Error("AbortManager.getSignal: Task ID must be a non-empty string.");
      }
      const controller = this.controllers.get(id);
      if (!controller) {
        throw new Error(`AbortManager.getSignal: No AbortController found for task ID "${id}".`);
      }
      return controller.signal;
    }
  
    /**
     * Aborts the controller associated with the given task ID.
     * @param id - The unique task ID.
     * @throws Error if the id is invalid or no controller is found.
     */
    public abortById(id: string): void {
      if (!id || typeof id !== "string" || id.trim() === "") {
        throw new Error("AbortManager.abortById: Task ID must be a non-empty string.");
      }
      const controller = this.controllers.get(id);
      if (!controller) {
        throw new Error(`AbortManager.abortById: No AbortController found for task ID "${id}".`);
      }
      controller.abort();
      this.controllers.delete(id);
    }
  
    /**
     * Aborts all registered AbortControllers and clears the internal map.
     */
    public abortAll(): void {
      for (const [id, controller] of this.controllers) {
        controller.abort();
      }
      this.controllers.clear();
    }
  
    /**
     * Removes the AbortController associated with the given task ID from the manager.
     * This is useful for clean-up after a task completes successfully.
     * @param id - The unique task ID.
     */
    public removeController(id: string): void {
      if (!id || typeof id !== "string" || id.trim() === "") {
        throw new Error("AbortManager.removeController: Task ID must be a non-empty string.");
      }
      this.controllers.delete(id);
    }
  
    /**
     * Destroys the AbortManager by aborting all controllers and clearing internal state.
     */
    public destroy(): void {
      this.abortAll();
    }
  }
  