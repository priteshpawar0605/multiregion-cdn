const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { app, cache, failoverManager, metrics } = require('../src/index');

const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const REGIONS = ['mumbai', 'frankfurt', 'virginia'];

describe('Multi-Region CDN Tests', () => {
  // Temporary test files tracking for safe cleanup
  const createdTestFiles = new Set();

  const trackTestFile = (filename) => {
    createdTestFiles.add(filename);
    return filename;
  };

  const cleanupTestFiles = () => {
    for (const file of createdTestFiles) {
      for (const region of REGIONS) {
        const filePath = path.join(STORAGE_DIR, region, file);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (err) {
            // Ignore deletion errors during cleanup
          }
        }
      }
    }
    createdTestFiles.clear();
  };

  beforeEach(() => {
    // 1. Clear cache
    if (cache && typeof cache.clear === 'function') {
      cache.clear();
    }

    // 2. Restore all regions to healthy
    if (failoverManager) {
      REGIONS.forEach((region) => {
        try {
          failoverManager.restoreRegion(region);
        } catch (e) {
          // ignore
        }
      });
    }

    // 3. Reset metrics if possible
    if (metrics && typeof metrics.reset === 'function') {
      metrics.reset();
    }
  });

  afterEach(() => {
    cleanupTestFiles();
    // Ensure default TTL is reset in case manipulated
    if (cache && typeof cache.setDefaultTTL === 'function') {
      cache.setDefaultTTL(60000);
    }
  });

  afterAll(() => {
    cleanupTestFiles();
  });

  // ==========================================
  // Asset Retrieval
  // ==========================================
  describe('Asset Retrieval', () => {
    test('should retrieve an existing asset successfully', async () => {
      const res = await request(app)
        .get('/api/content/sample.txt?region=mumbai')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(typeof res.body.data).toBe('string');
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.cache).toBe('MISS');
      expect(res.body.filename).toBe('sample.txt');
      expect(res.body.region).toBe('mumbai');
    });

    test('should return error for non-existent asset', async () => {
      const res = await request(app)
        .get('/api/content/nonexistent.txt?region=mumbai');

      expect([404, 500]).toContain(res.status);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });
  });

  // ==========================================
  // Cache Behavior
  // ==========================================
  describe('Cache Behavior', () => {
    test('first request should be a cache MISS', async () => {
      const res = await request(app)
        .get('/api/content/sample.txt?region=mumbai')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.cache).toBe('MISS');
    });

    test('repeated request should be a cache HIT', async () => {
      // First request (MISS, populates cache)
      const res1 = await request(app)
        .get('/api/content/sample.txt?region=mumbai')
        .expect(200);
      expect(res1.body.cache).toBe('MISS');

      // Second request (HIT)
      const res2 = await request(app)
        .get('/api/content/sample.txt?region=mumbai')
        .expect(200);

      expect(res2.body.success).toBe(true);
      expect(res2.body.cache).toBe('HIT');
      expect(res2.body.data).toBe(res1.body.data);
    });

    test('cache should respect noCache parameter', async () => {
      // First request caches the content
      const res1 = await request(app)
        .get('/api/content/sample.txt?region=mumbai')
        .expect(200);
      expect(res1.body.cache).toBe('MISS');

      // Second request bypasses cache with noCache=true
      const res2 = await request(app)
        .get('/api/content/sample.txt?region=mumbai&noCache=true')
        .expect(200);

      expect(res2.body.success).toBe(true);
      expect(res2.body.cache).toBe('MISS');
    });

    test('clearing cache should reset stats', async () => {
      // Populate cache
      await request(app)
        .get('/api/content/sample.txt?region=mumbai')
        .expect(200);

      // Verify cache has size >= 1
      const statsBefore = await request(app)
        .get('/api/cache/stats')
        .expect(200);
      expect(statsBefore.body.size).toBeGreaterThanOrEqual(1);

      // Clear cache
      const clearRes = await request(app)
        .post('/api/cache/clear')
        .expect(200);
      expect(clearRes.body.success).toBe(true);

      // Check stats again
      const statsAfter = await request(app)
        .get('/api/cache/stats')
        .expect(200);
      expect(statsAfter.body.size).toBe(0);
    });

    test('cache expiration should work', async () => {
      // Set very short TTL (100ms)
      cache.setDefaultTTL(100);

      // First request: MISS, cached with 100ms TTL
      const res1 = await request(app)
        .get('/api/content/sample.txt?region=mumbai')
        .expect(200);
      expect(res1.body.cache).toBe('MISS');

      // Wait 150ms for TTL expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Second request: Should be MISS again because entry expired
      const res2 = await request(app)
        .get('/api/content/sample.txt?region=mumbai')
        .expect(200);
      expect(res2.body.cache).toBe('MISS');

      // Restore default TTL
      cache.setDefaultTTL(60000);
    });
  });

  // ==========================================
  // Failover
  // ==========================================
  describe('Failover', () => {
    test('should serve from backup when primary is down', async () => {
      // Simulate outage in Mumbai
      const outageRes = await request(app)
        .post('/api/regions/mumbai/outage')
        .expect(200);
      expect(outageRes.body.success).toBe(true);

      // Fetch content requesting Mumbai
      const res = await request(app)
        .get('/api/content/sample.txt?region=mumbai')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.failover).toBe(true);
      expect(res.body.region).not.toBe('mumbai');
      expect(res.body.failoverFrom).toBe('mumbai');
    });

    test('should fail when all regions are down', async () => {
      // Outage all 3 regions
      await request(app).post('/api/regions/mumbai/outage').expect(200);
      await request(app).post('/api/regions/frankfurt/outage').expect(200);
      await request(app).post('/api/regions/virginia/outage').expect(200);

      const res = await request(app)
        .get('/api/content/sample.txt?region=mumbai');

      expect([404, 500]).toContain(res.status);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    test('should restore region after outage', async () => {
      // Outage Mumbai
      await request(app).post('/api/regions/mumbai/outage').expect(200);

      // Restore Mumbai
      const restoreRes = await request(app)
        .post('/api/regions/mumbai/restore')
        .expect(200);
      expect(restoreRes.body.success).toBe(true);

      // Verify health status via /api/regions
      const regionsRes = await request(app)
        .get('/api/regions')
        .expect(200);
      expect(regionsRes.body.mumbai.healthy).toBe(true);
    });
  });

  // ==========================================
  // Replication
  // ==========================================
  describe('Replication', () => {
    test('should replicate file between regions', async () => {
      const testFile = trackTestFile(`repl_test_${Date.now()}.txt`);
      const testContent = `Replication test payload ${Date.now()}`;

      // Create test file in mumbai storage
      const mumbaiPath = path.join(STORAGE_DIR, 'mumbai', testFile);
      const frankfurtPath = path.join(STORAGE_DIR, 'frankfurt', testFile);
      fs.writeFileSync(mumbaiPath, testContent, 'utf-8');

      // Trigger replication via API
      const res = await request(app)
        .post('/api/replicate')
        .send({
          filename: testFile,
          from: 'mumbai',
          to: 'frankfurt'
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(fs.existsSync(frankfurtPath)).toBe(true);

      const replicatedContent = fs.readFileSync(frankfurtPath, 'utf-8');
      expect(replicatedContent).toBe(testContent);
    });
  });

  // ==========================================
  // Asset Management
  // ==========================================
  describe('Asset Management', () => {
    test('should upload a file', async () => {
      const uploadFilename = trackTestFile(`upload_test_${Date.now()}.txt`);
      const fileBuffer = Buffer.from('Integration test file upload content');

      const res = await request(app)
        .post('/api/assets/upload')
        .attach('file', fileBuffer, uploadFilename)
        .field('region', 'mumbai')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.filename).toBe(uploadFilename);
      expect(res.body.region).toBe('mumbai');

      const targetPath = path.join(STORAGE_DIR, 'mumbai', uploadFilename);
      expect(fs.existsSync(targetPath)).toBe(true);
    });

    test('should list assets', async () => {
      const res = await request(app)
        .get('/api/assets')
        .expect(200);

      expect(res.body.assets).toBeDefined();
      expect(Array.isArray(res.body.assets)).toBe(true);
      const hasSample = res.body.assets.some((asset) => asset.filename === 'sample.txt');
      expect(hasSample).toBe(true);
    });

    test('should delete an asset', async () => {
      const deleteFilename = trackTestFile(`del_test_${Date.now()}.txt`);
      const uploadRes = await request(app)
        .post('/api/assets/upload')
        .attach('file', Buffer.from('Temp file to delete'), deleteFilename)
        .field('region', 'mumbai')
        .expect(200);
      expect(uploadRes.body.success).toBe(true);

      const delRes = await request(app)
        .delete(`/api/assets/${deleteFilename}`)
        .expect(200);

      expect(delRes.body.success).toBe(true);
      expect(delRes.body.deletedFrom).toContain('mumbai');

      const targetPath = path.join(STORAGE_DIR, 'mumbai', deleteFilename);
      expect(fs.existsSync(targetPath)).toBe(false);
    });

    test('should reject path traversal attempts', async () => {
      const res = await request(app)
        .get('/api/content/..%2F..%2Fetc%2Fpasswd?region=mumbai');

      // Must be safely rejected without exposing system files
      expect([400, 403, 404]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // Metrics
  // ==========================================
  describe('Metrics', () => {
    test('should track requests correctly', async () => {
      const initialMetrics = await request(app)
        .get('/api/metrics')
        .expect(200);
      const initialRequests = initialMetrics.body.totalRequests;

      await request(app)
        .get('/api/content/sample.txt?region=mumbai')
        .expect(200);

      const updatedMetrics = await request(app)
        .get('/api/metrics')
        .expect(200);

      expect(updatedMetrics.body.totalRequests).toBe(initialRequests + 1);
    });

    test('should track cache hits and misses', async () => {
      cache.clear();

      // MISS
      await request(app)
        .get('/api/content/sample.txt?region=mumbai')
        .expect(200);

      // HIT
      await request(app)
        .get('/api/content/sample.txt?region=mumbai')
        .expect(200);

      const metricsRes = await request(app)
        .get('/api/metrics')
        .expect(200);

      expect(metricsRes.body.cacheMisses).toBeGreaterThanOrEqual(1);
      expect(metricsRes.body.cacheHits).toBeGreaterThanOrEqual(1);
    });

    test('should record failover events', async () => {
      await request(app).post('/api/regions/mumbai/outage').expect(200);

      await request(app)
        .get('/api/content/sample.txt?region=mumbai')
        .expect(200);

      const metricsRes = await request(app)
        .get('/api/metrics')
        .expect(200);

      expect(metricsRes.body.failoverEvents).toBeGreaterThanOrEqual(1);

      // Restore Mumbai
      await request(app).post('/api/regions/mumbai/restore').expect(200);
    });
  });

  // ==========================================
  // Region Management
  // ==========================================
  describe('Region Management', () => {
    test('should return all regions with status', async () => {
      const res = await request(app)
        .get('/api/regions')
        .expect(200);

      expect(res.body.mumbai).toBeDefined();
      expect(res.body.frankfurt).toBeDefined();
      expect(res.body.virginia).toBeDefined();

      ['mumbai', 'frankfurt', 'virginia'].forEach((r) => {
        expect(res.body[r]).toHaveProperty('name');
        expect(res.body[r]).toHaveProperty('location');
        expect(res.body[r]).toHaveProperty('healthy');
        expect(res.body[r]).toHaveProperty('latency');
      });
    });

    test('should reject invalid region names', async () => {
      const res = await request(app)
        .post('/api/regions/invalid/outage');

      expect([400, 404]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });
  });
});
