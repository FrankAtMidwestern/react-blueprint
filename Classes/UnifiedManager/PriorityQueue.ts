/**
 * A generic binary heap–based priority queue.
 *
 * The comparator should return a positive value when item A has higher
 * priority than item B, zero if they are equal, and a negative value otherwise.
 *
 * In this case, we assume tasks with higher `priority` values are processed first.
 */
export class PriorityQueue<T> {
    private heap: T[] = [];
    private comparator: (a: T, b: T) => number;
  
    constructor(comparator: (a: T, b: T) => number) {
      this.comparator = comparator;
    }
  
    public size(): number {
      return this.heap.length;
    }
  
    public isEmpty(): boolean {
      return this.heap.length === 0;
    }
  
    public peek(): T | undefined {
      return this.heap[0];
    }
  
    public push(item: T): void {
      this.heap.push(item);
      this.bubbleUp(this.heap.length - 1);
    }
  
    public pop(): T | undefined {
      if (this.heap.length === 0) return undefined;
      const top = this.heap[0];
      const end = this.heap.pop();
      if (this.heap.length > 0 && end !== undefined) {
        this.heap[0] = end;
        this.bubbleDown(0);
      }
      return top;
    }
  
    /**
     * Removes an item matching the predicate.
     * Note: This operation is O(n) in the worst-case since it must scan the heap.
     */
    public remove(predicate: (item: T) => boolean): boolean {
      const index = this.heap.findIndex(predicate);
      if (index === -1) return false;
      const end = this.heap.pop();
      if (index < this.heap.length && end !== undefined) {
        this.heap[index] = end;
        this.bubbleUp(index);
        this.bubbleDown(index);
      }
      return true;
    }
  
    public toArray(): T[] {
      return [...this.heap];
    }
  
    private bubbleUp(index: number) {
      const item = this.heap[index];
      while (index > 0) {
        const parentIndex = Math.floor((index - 1) / 2);
        const parent = this.heap[parentIndex];
        // If item has lower or equal priority than its parent, we're done.
        if (this.comparator(item, parent) <= 0) break;
        this.heap[index] = parent;
        index = parentIndex;
      }
      this.heap[index] = item;
    }
  
    private bubbleDown(index: number) {
      const length = this.heap.length;
      const item = this.heap[index];
      while (true) {
        const leftIndex = 2 * index + 1;
        const rightIndex = 2 * index + 2;
        let swapIndex = -1;
  
        if (leftIndex < length) {
          const left = this.heap[leftIndex];
          if (this.comparator(left, item) > 0) {
            swapIndex = leftIndex;
          }
        }
  
        if (rightIndex < length) {
          const right = this.heap[rightIndex];
          if (
            this.comparator(right, swapIndex === -1 ? item : this.heap[swapIndex]) > 0
          ) {
            swapIndex = rightIndex;
          }
        }
  
        if (swapIndex === -1) break;
  
        this.heap[index] = this.heap[swapIndex];
        index = swapIndex;
      }
      this.heap[index] = item;
    }
  }
  