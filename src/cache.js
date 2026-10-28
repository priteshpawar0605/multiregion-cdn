/**
 * In-memory Cache implementation with TTL support.
 */
class Cache {
  /**
   * @param {number} defaultTTL Default Time-to-Live in milliseconds (default: 60000)
   */
  constructor(defaultTTL = 60000) {
    this.defaultTTL = defaultTTL;
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Retrieves an entry from cache.
   * @param {string} key
   * @returns {{ hit: true, data: any, meta: object, age: number } | { hit: false }}
   */
  get(key) {
    const entry = this.store.get(key);

    if (!entry) {
      this.misses += 1;
      return { hit: false };
    }

    const now = Date.now();
    const age = now - entry.createdAt;

    // Check expiration
    if (age > entry.ttl) {
      this.store.delete(key);
      this.misses += 1;
      return { hit: false };
    }

    this.hits += 1;
    return {
      hit: true,
      data: entry.data,
      meta: entry.meta,
      age
    };
  }

  /**
   * Stores an entry into the cache.
   * @param {string} key
   * @param {any} data
   * @param {object} [meta={}]
   * @param {number|null} [ttl=null]
   */
  set(key, data, meta = {}, ttl = null) {
    this.store.set(key, {
      data,
      meta: meta || {},
      createdAt: Date.now(),
      ttl: ttl !== null && ttl !== undefined ? ttl : this.defaultTTL
    });
  }

  /**
   * Checks if an unexpired key exists in cache without modifying hit/miss metrics.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }

    const now = Date.now();
    if (now - entry.createdAt > entry.ttl) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Deletes a key from the cache.
   * @param {string} key
   * @returns {boolean}
   */
  delete(key) {
    return this.store.delete(key);
  }

  /**
   * Clears all cache entries and resets hit/miss counters.
   */
  clear() {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Returns cache statistics.
   * @returns {{ size: number, hits: number, misses: number, hitRate: string }}
   */
  stats() {
    // Purge expired keys before reporting size
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now - entry.createdAt > entry.ttl) {
        this.store.delete(key);
      }
    }

    const total = this.hits + this.misses;
    const hitRate = total === 0 ? '0%' : `${((this.hits / total) * 100).toFixed(1)}%`;

    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate
    };
  }

  /**
   * Sets default TTL.
   * @param {number} ms
   */
  setDefaultTTL(ms) {
    this.defaultTTL = ms;
  }
}

module.exports = Cache;
