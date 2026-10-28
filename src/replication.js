const fs = require('fs');
const path = require('path');

const REGION_NAMES = ['mumbai', 'frankfurt', 'virginia'];

/**
 * Replicates a single file from one region to another.
 * @param {string} filename
 * @param {string} from
 * @param {string} to
 * @param {string} storageBasePath
 * @returns {{ success: boolean, message: string }}
 */
function replicateFile(filename, from, to, storageBasePath) {
  if (!REGION_NAMES.includes(from)) {
    throw new Error(`Invalid source region: ${from}`);
  }
  if (!REGION_NAMES.includes(to)) {
    throw new Error(`Invalid destination region: ${to}`);
  }

  const safeFilename = path.basename(filename);
  if (!safeFilename) {
    throw new Error('Invalid filename');
  }

  const srcPath = path.join(storageBasePath, from, safeFilename);
  const destDir = path.join(storageBasePath, to);
  const destPath = path.join(destDir, safeFilename);

  if (!fs.existsSync(srcPath)) {
    throw new Error(`Source file ${safeFilename} does not exist in ${from}`);
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.copyFileSync(srcPath, destPath);

  return {
    success: true,
    message: `Replicated ${safeFilename} from ${from} to ${to}`
  };
}

/**
 * Replicates a file from one region to all other regions.
 * @param {string} filename
 * @param {string} from
 * @param {string} storageBasePath
 * @returns {{ success: boolean, message: string, replicated: string[] }}
 */
function replicateToAll(filename, from, storageBasePath) {
  if (!REGION_NAMES.includes(from)) {
    throw new Error(`Invalid source region: ${from}`);
  }

  const safeFilename = path.basename(filename);
  const targets = REGION_NAMES.filter(region => region !== from);
  const replicated = [];

  for (const to of targets) {
    replicateFile(safeFilename, from, to, storageBasePath);
    replicated.push(to);
  }

  return {
    success: true,
    message: `Replicated ${safeFilename} from ${from} to all other regions`,
    replicated
  };
}

module.exports = {
  replicateFile,
  replicateToAll,
  REGION_NAMES
};
