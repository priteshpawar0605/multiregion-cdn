const express = require('express');
const path = require('path');
const fs = require('fs');
const { replicateFile, replicateToAll } = require('./replication');

/**
 * Simulates network or origin latency.
 * @param {number} ms Milliseconds to delay
 * @returns {Promise<void>}
 */
async function simulateLatency(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determines content type from filename extension.
 * @param {string} filename
 * @returns {string}
 */
function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.md': 'text/markdown',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.csv': 'text/csv',
    '.zip': 'application/zip',
    '.mp4': 'video/mp4',
    '.webp': 'image/webp'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Creates the main CDN API router.
 * @param {import('./cache')} cache
 * @param {import('./failover')} failoverManager
 * @param {import('./metrics')} metrics
 * @param {string} storageBase
 * @returns {express.Router}
 */
module.exports = function createRouter(cache, failoverManager, metrics, storageBase) {
  const router = express.Router();

  /**
   * GET /api/content/:filename
   * The core CDN content delivery pipeline.
   */
  router.get('/content/:filename', async (req, res) => {
    const startTime = Date.now();
    const rawFilename = req.params.filename;
    const safeFilename = path.basename(rawFilename);
    const region = (req.query.region || 'mumbai').toLowerCase();
    const noCache = req.query.noCache === 'true' || req.query.noCache === true;

    const cacheKey = `${region}:${safeFilename}`;
    const allRegions = failoverManager.getRegions();
    const regionConfig = allRegions[region] || { latency: 20 };

    try {
      const isPrimaryHealthy = failoverManager.isHealthy(region);

      // 1. If primary region is healthy and cache not bypassed, check primary edge cache
      if (isPrimaryHealthy && !noCache) {
        const cached = cache.get(cacheKey);
        if (cached && cached.hit) {
          // Edge cache hit: simulate edge latency (fast regional edge cache)
          const edgeLatency = Math.max(5, Math.round(regionConfig.latency * 0.15));
          await simulateLatency(edgeLatency);

          const totalLatency = Date.now() - startTime;
          metrics.record({
            filename: safeFilename,
            region,
            cache: 'HIT',
            latency: totalLatency,
            failover: false,
            failoverFrom: null,
            status: 'success'
          });

          return res.json({
            success: true,
            data: cached.data.content,
            filename: safeFilename,
            region,
            cache: 'HIT',
            latency: totalLatency,
            failover: false,
            failoverFrom: null,
            contentType: cached.data.contentType || getContentType(safeFilename)
          });
        }
      }

      // 2. Either primary region is OFFLINE or primary cache was a MISS -> Resolve via FailoverManager
      const resolved = failoverManager.resolve(safeFilename, region, storageBase);
      const resolvedRegionConfig = allRegions[resolved.region] || { latency: 50 };
      const resolvedCacheKey = `${resolved.region}:${safeFilename}`;

      // 2b. If failover occurred and cache not bypassed, check if the backup region has it in edge cache
      if (resolved.failover && !noCache) {
        const backupCached = cache.get(resolvedCacheKey);
        if (backupCached && backupCached.hit) {
          const edgeLatency = Math.max(10, Math.round(resolvedRegionConfig.latency * 0.2));
          await simulateLatency(edgeLatency);

          const totalLatency = Date.now() - startTime;
          metrics.record({
            filename: safeFilename,
            region: resolved.region,
            cache: 'HIT',
            latency: totalLatency,
            failover: true,
            failoverFrom: resolved.failoverFrom,
            status: 'success'
          });

          return res.json({
            success: true,
            data: backupCached.data.content,
            filename: safeFilename,
            region: resolved.region,
            cache: 'HIT',
            latency: totalLatency,
            failover: true,
            failoverFrom: resolved.failoverFrom,
            contentType: backupCached.data.contentType || getContentType(safeFilename)
          });
        }
      }

      // 3. Read file from storage in resolved region
      const filePath = path.join(storageBase, resolved.region, safeFilename);
      if (!fs.existsSync(filePath)) {
        throw new Error('Asset not available in any region');
      }

      const contentType = getContentType(safeFilename);
      const isText = contentType.startsWith('text/') || 
                     contentType === 'application/json' || 
                     contentType === 'application/javascript' ||
                     contentType === 'image/svg+xml';

      let fileContent = '';
      if (isText) {
        fileContent = fs.readFileSync(filePath, 'utf-8');
      } else {
        const fileStat = fs.statSync(filePath);
        fileContent = `[Binary Asset: ${safeFilename} | Size: ${(fileStat.size / 1024).toFixed(1)} KB | MIME: ${contentType} | Edge Delivered Successfully]`;
      }

      // 4. Simulate origin / network latency for resolved region
      await simulateLatency(resolvedRegionConfig.latency);

      const totalLatency = Date.now() - startTime;

      // 5. Store in cache under the resolved region's cache key
      if (!noCache) {
        cache.set(resolvedCacheKey, {
          content: fileContent,
          contentType,
          resolvedRegion: resolved.region
        }, {
          origin: resolved.region,
          cachedAt: new Date().toISOString()
        });
      }

      // 6. Record metrics
      metrics.record({
        filename: safeFilename,
        region: resolved.region,
        cache: 'MISS',
        latency: totalLatency,
        failover: resolved.failover,
        failoverFrom: resolved.failoverFrom,
        status: 'success'
      });

      return res.json({
        success: true,
        data: fileContent,
        filename: safeFilename,
        region: resolved.region,
        cache: 'MISS',
        latency: totalLatency,
        failover: resolved.failover,
        failoverFrom: resolved.failoverFrom,
        contentType
      });
    } catch (error) {
      const totalLatency = Date.now() - startTime;
      metrics.record({
        filename: safeFilename,
        region,
        cache: 'MISS',
        latency: totalLatency,
        failover: false,
        failoverFrom: null,
        status: 'error'
      });

      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/regions
   * Returns current health and configuration for all regions.
   */
  router.get('/regions', (req, res) => {
    try {
      res.json(failoverManager.getRegions());
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/regions/:region/outage
   * Simulates an outage in the specified region.
   */
  router.post('/regions/:region/outage', (req, res) => {
    try {
      const region = req.params.region.toLowerCase();
      failoverManager.simulateOutage(region);

      // Evict any cached assets tied to this offline region
      if (cache && cache.store) {
        for (const key of Array.from(cache.store.keys())) {
          if (key.startsWith(`${region}:`)) {
            cache.delete(key);
          }
        }
      }

      res.json({
        success: true,
        message: `Outage simulated for region ${region}`,
        region
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/regions/:region/restore
   * Restores healthy status for the specified region.
   */
  router.post('/regions/:region/restore', (req, res) => {
    try {
      const region = req.params.region.toLowerCase();
      failoverManager.restoreRegion(region);
      res.json({
        success: true,
        message: `Region ${region} restored to healthy status`,
        region
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/cache/stats
   * Returns cache metrics (size, hits, misses, hit rate).
   */
  router.get('/cache/stats', (req, res) => {
    try {
      res.json(cache.stats());
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/cache/clear
   * Purges all cache keys and resets hit/miss counters.
   */
  router.post('/cache/clear', (req, res) => {
    try {
      cache.clear();
      res.json({
        success: true,
        message: 'Cache cleared successfully'
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/replicate
   * Replicates an asset to another region or to all other regions.
   */
  router.post('/replicate', (req, res) => {
    try {
      const { filename, from, to } = req.body;
      if (!filename || !from || !to) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: filename, from, to'
        });
      }

      if (to === 'all') {
        const result = replicateToAll(filename, from.toLowerCase(), storageBase);
        return res.json(result);
      } else {
        const result = replicateFile(filename, from.toLowerCase(), to.toLowerCase(), storageBase);
        return res.json({
          success: true,
          message: result.message,
          replicated: [to.toLowerCase()]
        });
      }
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/metrics
   * Returns overall CDN performance metrics.
   */
  router.get('/metrics', (req, res) => {
    try {
      res.json(metrics.getMetrics());
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/benchmark
   * Runs comparative benchmark tests for caching and failover resilience.
   */
  router.post('/benchmark', async (req, res) => {
    try {
      const filename = path.basename(req.body.filename || 'sample.txt');
      const region = (req.body.region || 'mumbai').toLowerCase();
      const rawIterations = parseInt(req.body.iterations, 10);
      const iterations = isNaN(rawIterations) || rawIterations < 1 ? 10 : Math.min(rawIterations, 30);

      const allRegions = failoverManager.getRegions();
      const originLatency = (allRegions[region] && allRegions[region].latency) || 50;
      const edgeLatency = Math.max(5, Math.round(originLatency * 0.15));

      // 1. Benchmark Cache Enabled
      // Clear cache first for consistency
      cache.clear();
      const cacheEnabledLatencies = [];
      let cacheHits = 0;
      let cacheMisses = 0;

      for (let i = 0; i < iterations; i++) {
        const iterStart = Date.now();
        const cacheKey = `${region}:${filename}`;
        const cached = cache.get(cacheKey);

        if (cached && cached.hit) {
          cacheHits++;
          await simulateLatency(edgeLatency);
        } else {
          cacheMisses++;
          // First request resolves and stores
          const resolved = failoverManager.resolve(filename, region, storageBase);
          const rLatency = (allRegions[resolved.region] && allRegions[resolved.region].latency) || originLatency;
          await simulateLatency(rLatency);
          cache.set(cacheKey, { content: 'benchmark_data' });
        }
        cacheEnabledLatencies.push(Date.now() - iterStart);
      }

      const sumEnabled = cacheEnabledLatencies.reduce((a, b) => a + b, 0);
      const cacheEnabledResult = {
        avgLatency: Math.round(sumEnabled / iterations),
        minLatency: Math.min(...cacheEnabledLatencies),
        maxLatency: Math.max(...cacheEnabledLatencies),
        hits: cacheHits,
        misses: cacheMisses
      };

      // 2. Benchmark Cache Disabled (Origin only)
      const cacheDisabledLatencies = [];
      for (let i = 0; i < iterations; i++) {
        const iterStart = Date.now();
        const resolved = failoverManager.resolve(filename, region, storageBase);
        const rLatency = (allRegions[resolved.region] && allRegions[resolved.region].latency) || originLatency;
        await simulateLatency(rLatency);
        cacheDisabledLatencies.push(Date.now() - iterStart);
      }

      const sumDisabled = cacheDisabledLatencies.reduce((a, b) => a + b, 0);
      const cacheDisabledResult = {
        avgLatency: Math.round(sumDisabled / iterations),
        minLatency: Math.min(...cacheDisabledLatencies),
        maxLatency: Math.max(...cacheDisabledLatencies)
      };

      // 3. Benchmark Failover
      const foStart = Date.now();
      let failoverSuccess = false;
      try {
        failoverManager.simulateOutage(region);
        const foResolved = failoverManager.resolve(filename, region, storageBase);
        const foLatency = (allRegions[foResolved.region] && allRegions[foResolved.region].latency) || originLatency;
        await simulateLatency(foLatency);
        failoverSuccess = true;
      } catch (foErr) {
        failoverSuccess = false;
      } finally {
        failoverManager.restoreRegion(region);
      }
      const failoverDuration = Date.now() - foStart;

      return res.json({
        cacheEnabled: cacheEnabledResult,
        cacheDisabled: cacheDisabledResult,
        failover: {
          avgLatency: failoverDuration,
          successRate: failoverSuccess ? '100%' : '0%'
        }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};
