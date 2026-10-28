const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { REGION_NAMES } = require('./replication');

const ALLOWED_EXTENSIONS = [
  'txt', 'json', 'html', 'css', 'js', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'md',
  'pptx', 'ppt', 'pdf', 'docx', 'doc', 'xls', 'xlsx', 'csv', 'zip', 'mp4', 'webp', 'xml'
];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * Creates the asset management router.
 * @param {string} storageBase Base path to regional storage
 * @returns {express.Router}
 */
module.exports = function createAssetsRouter(storageBase) {
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE }
  });

  /**
   * GET /api/assets
   * List all assets across all regions, deduplicated by filename with regions array.
   */
  router.get('/', (req, res) => {
    try {
      const assetMap = new Map();

      for (const region of REGION_NAMES) {
        const regionDir = path.join(storageBase, region);
        if (fs.existsSync(regionDir)) {
          const files = fs.readdirSync(regionDir);
          for (const file of files) {
            const filePath = path.join(regionDir, file);
            try {
              const stat = fs.statSync(filePath);
              if (stat.isFile()) {
                if (!assetMap.has(file)) {
                  assetMap.set(file, {
                    filename: file,
                    regions: [],
                    size: stat.size
                  });
                }
                const entry = assetMap.get(file);
                if (!entry.regions.includes(region)) {
                  entry.regions.push(region);
                }
              }
            } catch (err) {
              // Ignore inaccessible file
            }
          }
        }
      }

      res.json({ assets: Array.from(assetMap.values()) });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/assets/upload
   * Upload an asset to a specific region (default: 'mumbai').
   */
  router.post('/upload', (req, res) => {
    upload.single('file')(req, res, err => {
      try {
        if (err) {
          return res.status(400).json({ success: false, error: err.message });
        }

        if (!req.file) {
          return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const safeFilename = path.basename(req.file.originalname);
        const ext = path.extname(safeFilename).toLowerCase().replace('.', '');

        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          return res.status(400).json({
            success: false,
            error: `File type .${ext} is not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
          });
        }

        const region = req.body && req.body.region ? req.body.region.toLowerCase() : 'mumbai';
        if (!REGION_NAMES.includes(region)) {
          return res.status(400).json({
            success: false,
            error: `Invalid region: ${region}. Allowed regions: ${REGION_NAMES.join(', ')}`
          });
        }

        const targetDir = path.join(storageBase, region);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const destPath = path.join(targetDir, safeFilename);
        fs.writeFileSync(destPath, req.file.buffer);

        return res.json({
          success: true,
          filename: safeFilename,
          region,
          size: req.file.size
        });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });
  });

  /**
   * DELETE /api/assets/:filename
   * Delete an asset from all storage regions.
   */
  router.delete('/:filename', (req, res) => {
    try {
      const safeFilename = path.basename(req.params.filename);
      const deletedFrom = [];

      for (const region of REGION_NAMES) {
        const filePath = path.join(storageBase, region, safeFilename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deletedFrom.push(region);
        }
      }

      res.json({
        success: true,
        message: `Deleted ${safeFilename} from ${deletedFrom.length} regions`,
        deletedFrom
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};
