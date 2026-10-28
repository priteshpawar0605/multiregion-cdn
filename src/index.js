const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const Cache = require('./cache');
const Metrics = require('./metrics');
const FailoverManager = require('./failover');
const createRouter = require('./router');
const createAssetsRouter = require('./assets');

const STORAGE_BASE = path.join(__dirname, '..', 'storage');

// Regional seed samples configuration
const REGION_SEEDS = {
  mumbai: 'This is a sample asset stored in the Mumbai (India) origin region.\nFile: sample.txt\nRegion: Mumbai\nCreated for CDN simulation testing.',
  frankfurt: 'This is a sample asset stored in the Frankfurt (Europe) origin region.\nFile: sample.txt\nRegion: Frankfurt\nCreated for CDN simulation testing.',
  virginia: 'This is a sample asset stored in the Virginia (North America) origin region.\nFile: sample.txt\nRegion: Virginia\nCreated for CDN simulation testing.'
};

// Ensure regional storage directories and seed sample.txt files exist
Object.entries(REGION_SEEDS).forEach(([region, content]) => {
  const regionDir = path.join(STORAGE_BASE, region);
  if (!fs.existsSync(regionDir)) {
    fs.mkdirSync(regionDir, { recursive: true });
  }

  const samplePath = path.join(regionDir, 'sample.txt');
  if (!fs.existsSync(samplePath)) {
    fs.writeFileSync(samplePath, content, 'utf-8');
  }
});

// Instantiate core modules
const cache = new Cache(60000);
const failoverManager = new FailoverManager();
const metrics = new Metrics();

// Create Express application
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount routes
app.use('/api', createRouter(cache, failoverManager, metrics, STORAGE_BASE));
app.use('/api/assets', createAssetsRouter(STORAGE_BASE));

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error('Unhandled application error:', err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CDN Server running on http://localhost:${PORT}`);
  });
}

module.exports = {
  app,
  cache,
  failoverManager,
  metrics
};
