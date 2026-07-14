interface CacheEntry<Value> {
  value: Value;
  bytes: number;
}

/** A small weighted LRU cache bounded by both entry count and retained bytes. */
export class WeightedLruCache<Value> {
  private readonly entries = new Map<string, CacheEntry<Value>>();
  private retainedBytes = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) {}

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: Value, bytes: number): void {
    const previous = this.entries.get(key);
    if (previous) {
      this.retainedBytes -= previous.bytes;
      this.entries.delete(key);
    }

    const normalizedBytes = Math.max(0, Math.floor(bytes));
    this.entries.set(key, { value, bytes: normalizedBytes });
    this.retainedBytes += normalizedBytes;
    this.evict();
  }

  clear(): void {
    this.entries.clear();
    this.retainedBytes = 0;
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.retainedBytes;
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries || this.retainedBytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey)!;
      this.retainedBytes -= oldest.bytes;
      this.entries.delete(oldestKey);
    }
  }
}
