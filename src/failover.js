const fs = require('fs');
const path = require('path');

const REGIONS = {
  mumbai: { name: 'Mumbai', location: 'India', latency: 20 },
  frankfurt: { name: 'Frankfurt', location: 'Europe', latency: 120 },
  virginia: { name: 'Virginia', location: 'North America', latency: 180 }
};

class FailoverManager {
  constructor() {
    this.status = {
      mumbai: { ...REGIONS.mumbai, healthy: true },
      frankfurt: { ...REGIONS.frankfurt, healthy: true },
      virginia: { ...REGIONS.virginia, healthy: true }
    };
  }

  /**
   * Returns current status for all regions.
   * @returns {Object}
   */
  getRegions() {
    return JSON.parse(JSON.stringify(this.status));
  }

  /**
   * Checks if a region is healthy.
   * @param {string} region
   * @returns {boolean}
   */
  isHealthy(region) {
    if (!this.status[region]) {
      return false;
    }
    return this.status[region].healthy === true;
  }

  /**
   * Simulates an outage for the specified region.
   * @param {string} region
   */
  simulateOutage(region) {
    if (!this.status[region]) {
      throw new Error(`Invalid region: ${region}`);
    }
    this.status[region].healthy = false;
  }

  /**
   * Restores health status for the specified region.
   * @param {string} region
   */
  restoreRegion(region) {
    if (!this.status[region]) {
      throw new Error(`Invalid region: ${region}`);
    }
    this.status[region].healthy = true;
  }

  /**
   * Returns list of currently healthy region identifiers.
   * @returns {string[]}
   */
  getHealthyRegions() {
    return Object.keys(this.status).filter(region => this.status[region].healthy);
  }

  /**
   * Resolves the best available region containing the requested file.
   * @param {string} filename
   * @param {string} preferredRegion
   * @param {string} storageBasePath
   * @returns {{ region: string, failover: boolean, failoverFrom: string|null }}
   */
  resolve(filename, preferredRegion, storageBasePath) {
    const safeFilename = path.basename(filename);

    // 1. Try preferred region if healthy
    if (this.isHealthy(preferredRegion)) {
      const preferredPath = path.join(storageBasePath, preferredRegion, safeFilename);
      if (fs.existsSync(preferredPath)) {
        return {
          region: preferredRegion,
          failover: false,
          failoverFrom: null
        };
      }
    }

    // 2. Try other healthy regions sorted by latency ascending
    const backupCandidates = this.getHealthyRegions()
      .filter(region => region !== preferredRegion)
      .sort((a, b) => this.status[a].latency - this.status[b].latency);

    for (const backupRegion of backupCandidates) {
      const backupPath = path.join(storageBasePath, backupRegion, safeFilename);
      if (fs.existsSync(backupPath)) {
        return {
          region: backupRegion,
          failover: true,
          failoverFrom: preferredRegion
        };
      }
    }

    // 3. No healthy region has the file
    throw new Error('Asset not available in any region');
  }
}

module.exports = FailoverManager;
