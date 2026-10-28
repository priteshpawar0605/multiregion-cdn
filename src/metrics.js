/**
 * Performance and request metrics collector.
 */
class Metrics {
  constructor() {
    this.reset();
  }

  /**
   * Resets all internal metric states.
   */
  reset() {
    this.totalRequests = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.failoverEvents = 0;
    this.latencies = [];
    this.regionRequests = {
      mumbai: 0,
      frankfurt: 0,
      virginia: 0
    };
    this.logs = [];
  }

  /**
   * Records a request into metrics.
   * @param {Object} param0
   * @param {string} param0.filename
   * @param {string} param0.region
   * @param {'HIT'|'MISS'} param0.cache
   * @param {number} param0.latency
   * @param {boolean} param0.failover
   * @param {string|null} param0.failoverFrom
   * @param {'success'|'error'} param0.status
   */
  record({ filename, region, cache, latency, failover, failoverFrom = null, status = 'success' }) {
    this.totalRequests += 1;

    if (cache === 'HIT') {
      this.cacheHits += 1;
    } else if (cache === 'MISS') {
      this.cacheMisses += 1;
    }

    if (failover) {
      this.failoverEvents += 1;
    }

    if (typeof latency === 'number') {
      this.latencies.push(latency);
    }

    if (region && Object.prototype.hasOwnProperty.call(this.regionRequests, region)) {
      this.regionRequests[region] += 1;
    } else if (region) {
      this.regionRequests[region] = (this.regionRequests[region] || 0) + 1;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      filename,
      region,
      cache,
      latency,
      failover: Boolean(failover),
      failoverFrom: failoverFrom || null,
      status
    };

    this.logs.unshift(logEntry);
    if (this.logs.length > 200) {
      this.logs = this.logs.slice(0, 200);
    }
  }

  /**
   * Summarizes metrics.
   * @returns {{ totalRequests: number, cacheHits: number, cacheMisses: number, hitRate: string, avgLatency: string, failoverEvents: number, regionRequests: Object, recentLogs: Array }}
   */
  getMetrics() {
    const cacheTotal = this.cacheHits + this.cacheMisses;
    const hitRate = cacheTotal === 0 ? '0%' : `${((this.cacheHits / cacheTotal) * 100).toFixed(1)}%`;

    let avgLatency = '0ms';
    if (this.latencies.length > 0) {
      const sum = this.latencies.reduce((acc, curr) => acc + curr, 0);
      avgLatency = `${(sum / this.latencies.length).toFixed(1)}ms`;
    }

    return {
      totalRequests: this.totalRequests,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      hitRate,
      avgLatency,
      failoverEvents: this.failoverEvents,
      regionRequests: { ...this.regionRequests },
      recentLogs: this.logs.slice(0, 50)
    };
  }
}

module.exports = Metrics;
