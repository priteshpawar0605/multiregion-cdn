/**
 * Multi-Region Serverless CDN Dashboard Client Logic
 * Plain Vanilla JavaScript implementation interfacing with Express API
 */

// ============================================================================
// (A) STATE MANAGEMENT
// ============================================================================
let charts = {
  latency: null,
  cache: null,
  region: null
};

let latencyHistory = []; // Array of { time: string, latency: number }
const MAX_LATENCY_POINTS = 30;
const REFRESH_INTERVAL_MS = 3000;
let refreshTimer = null;

// ============================================================================
// (B) INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  attachEventListeners();

  // Initial page selection based on URL hash
  const initialPage = (window.location.hash || '').replace('#', '') || 'dashboard';
  switchPage(initialPage);

  // Initial load
  loadDashboard();

  // Periodic Auto-refresh
  refreshTimer = setInterval(loadDashboard, REFRESH_INTERVAL_MS);
});

async function loadDashboard() {
  try {
    const [metrics, regions, cacheStats, assets] = await Promise.all([
      fetchMetrics(),
      fetchRegions(),
      fetchCacheStats(),
      fetchAssets()
    ]);

    if (metrics) {
      updateStats(metrics);
      updateLatencyChart(metrics);
      updateCacheChart(metrics);
      updateRegionChart(metrics);
      if (metrics.recentLogs) {
        updateRequestLogs(metrics.recentLogs);
      }
    }

    if (regions) {
      updateRegionCards(regions);
    }

    if (cacheStats) {
      updateCacheStats(cacheStats);
    }

    if (assets && assets.assets) {
      updateAssetTable(assets.assets);
    }
  } catch (err) {
    console.error('Error during dashboard periodic refresh:', err);
  }
}

// ============================================================================
// (C) API FUNCTIONS
// ============================================================================

/**
 * Fetch general metrics including request counts, latency, and log history.
 */
async function fetchMetrics() {
  try {
    const res = await fetch('/api/metrics');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Failed to fetch metrics:', err.message);
    return null;
  }
}

/**
 * Fetch status, health, and latency for all edge regions.
 */
async function fetchRegions() {
  try {
    const res = await fetch('/api/regions');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Failed to fetch regions:', err.message);
    return null;
  }
}

/**
 * Fetch cache storage statistics (hits, misses, size, hit rate).
 */
async function fetchCacheStats() {
  try {
    const res = await fetch('/api/cache/stats');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Failed to fetch cache stats:', err.message);
    return null;
  }
}

/**
 * Fetch list of assets registered across regions.
 */
async function fetchAssets() {
  try {
    const res = await fetch('/api/assets');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Failed to fetch assets:', err.message);
    return null;
  }
}

/**
 * Request content from a given region with optional cache bypass.
 */
async function fetchContent(filename, region, noCache = false) {
  const query = new URLSearchParams({
    region: region,
    noCache: noCache ? 'true' : 'false'
  });
  const res = await fetch(`/api/content/${encodeURIComponent(filename)}?${query.toString()}`);
  return await res.json();
}

/**
 * Trigger edge cache purge.
 */
async function clearCache() {
  const res = await fetch('/api/cache/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  return await res.json();
}

/**
 * Simulate an outage on a designated region.
 */
async function simulateOutage(region) {
  const res = await fetch(`/api/regions/${encodeURIComponent(region)}/outage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  return await res.json();
}

/**
 * Restore an offline region back to healthy state.
 */
async function restoreRegion(region) {
  const res = await fetch(`/api/regions/${encodeURIComponent(region)}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  return await res.json();
}

/**
 * Upload an asset file with target primary region.
 */
async function uploadAsset(formData) {
  const res = await fetch('/api/assets/upload', {
    method: 'POST',
    body: formData
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Server error (${res.status})`);
  }
  return data;
}

/**
 * Delete an asset across all regions.
 */
async function deleteAsset(filename) {
  const res = await fetch(`/api/assets/${encodeURIComponent(filename)}`, {
    method: 'DELETE'
  });
  return await res.json();
}

/**
 * Replicate an asset from one origin region to another.
 */
async function replicateAsset(filename, from, to) {
  const res = await fetch('/api/replicate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, from, to })
  });
  return await res.json();
}

/**
 * Run multi-iteration performance benchmark test.
 */
async function runBenchmark(filename, region, iterations) {
  const res = await fetch('/api/benchmark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, region, iterations: parseInt(iterations, 10) })
  });
  return await res.json();
}

// ============================================================================
// (D) UI UPDATE FUNCTIONS
// ============================================================================

/**
 * Update the 6 top overview stat cards.
 */
function updateStats(metrics) {
  setTextWithAnimation('stat-total-requests', metrics.totalRequests ?? 0);

  const hitRateFormatted = typeof metrics.hitRate === 'number' 
    ? `${metrics.hitRate.toFixed(1)}%` 
    : (metrics.hitRate || '0%');
  setTextWithAnimation('stat-hit-rate', hitRateFormatted);

  setTextWithAnimation('stat-hits-misses', `${metrics.cacheHits ?? 0} / ${metrics.cacheMisses ?? 0}`);
  setTextWithAnimation('stat-avg-latency', `${Math.round(metrics.avgLatency ?? 0)} ms`);
  setTextWithAnimation('stat-failover-events', metrics.failoverEvents ?? 0);
}

function setTextWithAnimation(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const strVal = String(value);
  if (el.textContent !== strVal) {
    el.textContent = strVal;
    el.classList.remove('value-updated');
    void el.offsetWidth; // trigger reflow
    el.classList.add('value-updated');
  }
}

/**
 * Update Region card badges, latencies, and request counters.
 */
function updateRegionCards(regions) {
  let activeCount = 0;
  let totalCount = 0;

  for (const [key, reg] of Object.entries(regions)) {
    totalCount++;
    const isHealthy = reg.healthy !== false;
    if (isHealthy) activeCount++;

    const badge = document.getElementById(`badge-${key}`);
    const latencyEl = document.getElementById(`latency-val-${key}`);
    const cardEl = document.getElementById(`card-region-${key}`);

    if (badge) {
      if (isHealthy) {
        badge.textContent = 'Online';
        badge.className = 'badge bg-success status-badge';
      } else {
        badge.textContent = 'Offline';
        badge.className = 'badge bg-danger status-badge';
      }
    }

    if (latencyEl && reg.latency !== undefined) {
      latencyEl.textContent = `~${reg.latency} ms`;
    }

    if (cardEl) {
      if (isHealthy) {
        cardEl.classList.remove('is-offline');
      } else {
        cardEl.classList.add('is-offline');
      }
    }
  }

  const activeRegionsEl = document.getElementById('stat-active-regions');
  if (activeRegionsEl) {
    activeRegionsEl.textContent = `${activeCount} / ${totalCount}`;
  }
}

/**
 * Update cache stats panel (size, hits, misses, hit rate).
 */
function updateCacheStats(stats) {
  const sizeEl = document.getElementById('cache-size-val');
  const hitsEl = document.getElementById('cache-hits-val');
  const missesEl = document.getElementById('cache-misses-val');
  const rateEl = document.getElementById('cache-rate-val');
  const barEl = document.getElementById('cache-progress-bar');

  if (sizeEl) sizeEl.textContent = stats.size ?? 0;
  if (hitsEl) hitsEl.textContent = stats.hits ?? 0;
  if (missesEl) missesEl.textContent = stats.misses ?? 0;

  const hitRateNum = typeof stats.hitRate === 'number' ? stats.hitRate : parseFloat(stats.hitRate) || 0;
  const displayRate = `${hitRateNum.toFixed(1)}%`;

  if (rateEl) rateEl.textContent = displayRate;
  if (barEl) barEl.style.width = `${Math.min(100, Math.max(0, hitRateNum))}%`;
}

/**
 * Rebuild Asset Store table with replication controls and delete buttons.
 */
function updateAssetTable(assets) {
  const tbody = document.getElementById('assets-table-body');
  if (!tbody) return;

  if (!assets || assets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">No assets found in edge storage. Upload one above!</td></tr>`;
    return;
  }

  const allKnownRegions = ['mumbai', 'frankfurt', 'virginia'];

  tbody.innerHTML = assets.map(asset => {
    const assetRegions = asset.regions || [];
    const badges = assetRegions.map(r => {
      let flag = '🌐';
      if (r === 'mumbai') flag = '🇮🇳';
      if (r === 'frankfurt') flag = '🇪🇺';
      if (r === 'virginia') flag = '🇺🇸';
      return `<span class="badge bg-primary-subtle text-primary border border-primary-subtle me-1">${flag} ${r}</span>`;
    }).join('');

    // Available target regions to replicate into (regions where asset does NOT exist yet)
    const availableTargets = allKnownRegions.filter(r => !assetRegions.includes(r));
    const originRegion = assetRegions[0] || 'mumbai';

    let replicateOptionsHtml = '';
    if (availableTargets.length > 0) {
      replicateOptionsHtml = availableTargets.map(t => `<option value="${t}">To: ${t}</option>`).join('');
    }

    return `
      <tr data-filename="${escapeHtml(asset.filename)}">
        <td class="fw-semibold text-dark">
          <i class="bi bi-file-earmark-code me-2 text-primary"></i>${escapeHtml(asset.filename)}
        </td>
        <td class="text-secondary">${formatBytes(asset.size || 0)}</td>
        <td>${badges}</td>
        <td class="text-end">
          <div class="d-inline-flex align-items-center gap-1">
            ${availableTargets.length > 0 ? `
              <select class="form-select form-select-sm d-inline-block w-auto rep-target-select" style="min-width: 110px;">
                ${replicateOptionsHtml}
              </select>
              <button class="btn btn-sm btn-outline-primary btn-replicate-single" 
                      data-filename="${escapeHtml(asset.filename)}" 
                      data-from="${originRegion}" 
                      title="Replicate to selected region">
                <i class="bi bi-arrows-angle-expand"></i> Replicate
              </button>
            ` : `
              <span class="badge bg-success-subtle text-success me-1"><i class="bi bi-check-all"></i> Fully Replicated</span>
            `}

            <button class="btn btn-sm btn-outline-danger btn-delete-asset" 
                    data-filename="${escapeHtml(asset.filename)}" 
                    title="Delete file">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Render real-time request log table.
 */
function updateRequestLogs(logs) {
  const tbody = document.getElementById('logs-table-body');
  const countBadge = document.getElementById('log-count-badge');
  if (!tbody) return;

  if (!logs || logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No request history recorded yet.</td></tr>`;
    if (countBadge) countBadge.textContent = '0 requests';
    return;
  }

  if (countBadge) countBadge.textContent = `${logs.length} requests`;

  // Display logs up to 50 rows
  const displayLogs = logs.slice(0, 50);

  tbody.innerHTML = displayLogs.map(log => {
    const isHit = String(log.cache).toUpperCase() === 'HIT';
    const cacheBadgeClass = isHit ? 'badge-hit' : 'badge-miss';
    const isFailover = Boolean(log.failover);
    const isError = log.status >= 400;

    let rowClass = '';
    if (isError) rowClass = 'row-error';
    else if (isFailover) rowClass = 'row-failover';

    return `
      <tr class="${rowClass}">
        <td class="text-muted small">${formatTime(log.timestamp)}</td>
        <td class="fw-semibold">${escapeHtml(log.filename || '-')}</td>
        <td><span class="badge bg-light text-dark border">${escapeHtml(log.region || '-')}</span></td>
        <td><span class="badge ${cacheBadgeClass}">${escapeHtml(log.cache || '-')}</span></td>
        <td>${Math.round(log.latency || 0)} ms</td>
        <td>
          ${isFailover 
            ? `<span class="badge badge-failover"><i class="bi bi-arrow-repeat"></i> Failover</span>` 
            : `<span class="text-muted small">Direct</span>`}
        </td>
        <td>
          <span class="badge ${isError ? 'bg-danger' : 'bg-success'}">
            ${log.status || 200}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Append latest latency point to line chart.
 */
function updateLatencyChart(metrics) {
  if (!charts.latency) return;

  const now = new Date();
  const timeLabel = formatTime(now);
  const latency = Math.round(metrics.avgLatency || 0);

  latencyHistory.push({ time: timeLabel, latency });
  if (latencyHistory.length > MAX_LATENCY_POINTS) {
    latencyHistory.shift();
  }

  charts.latency.data.labels = latencyHistory.map(p => p.time);
  charts.latency.data.datasets[0].data = latencyHistory.map(p => p.latency);
  charts.latency.update('none'); // silent update without reset
}

/**
 * Update Doughnut hit/miss ratio chart.
 */
function updateCacheChart(metrics) {
  if (!charts.cache) return;

  const hits = metrics.cacheHits || 0;
  const misses = metrics.cacheMisses || 0;

  charts.cache.data.datasets[0].data = [hits, misses];
  charts.cache.update();
}

/**
 * Update bar chart with regional traffic distribution.
 */
function updateRegionChart(metrics) {
  if (!charts.region) return;

  const regReq = metrics.regionRequests || {};
  const mumbaiCount = regReq.mumbai || 0;
  const frankfurtCount = regReq.frankfurt || 0;
  const virginiaCount = regReq.virginia || 0;

  // Also update numbers on the region cards
  const mumbaiReqEl = document.getElementById('requests-val-mumbai');
  const frankfurtReqEl = document.getElementById('requests-val-frankfurt');
  const virginiaReqEl = document.getElementById('requests-val-virginia');
  if (mumbaiReqEl) mumbaiReqEl.textContent = mumbaiCount;
  if (frankfurtReqEl) frankfurtReqEl.textContent = frankfurtCount;
  if (virginiaReqEl) virginiaReqEl.textContent = virginiaCount;

  charts.region.data.datasets[0].data = [mumbaiCount, frankfurtCount, virginiaCount];
  charts.region.update();
}

// ============================================================================
// (E) EVENT HANDLERS & LISTENERS
// ============================================================================

function attachEventListeners() {
  // Manual refresh button
  const btnRefresh = document.getElementById('btn-manual-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      loadDashboard();
      showToast('Dashboard refreshed manually', 'info');
    });
  }

  // Content Request Form
  const fetchForm = document.getElementById('fetch-content-form');
  if (fetchForm) {
    fetchForm.addEventListener('submit', handleFetchContent);
  }

  // Clear Cache Button
  const btnClearCache = document.getElementById('btn-clear-cache');
  if (btnClearCache) {
    btnClearCache.addEventListener('click', handleClearCache);
  }

  // Asset Upload Form
  const uploadForm = document.getElementById('upload-form');
  if (uploadForm) {
    uploadForm.addEventListener('submit', handleUpload);
  }

  // Refresh Assets Button
  const btnRefreshAssets = document.getElementById('btn-refresh-assets');
  if (btnRefreshAssets) {
    btnRefreshAssets.addEventListener('click', async () => {
      const data = await fetchAssets();
      if (data && data.assets) updateAssetTable(data.assets);
      showToast('Asset list refreshed', 'info');
    });
  }

  // Benchmark Form
  const benchmarkForm = document.getElementById('benchmark-form');
  if (benchmarkForm) {
    benchmarkForm.addEventListener('submit', handleBenchmark);
  }

  // Region Outage & Restore Buttons (delegation or direct)
  document.querySelectorAll('.btn-outage').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const region = e.currentTarget.getAttribute('data-region');
      handleOutage(region);
    });
  });

  document.querySelectorAll('.btn-restore').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const region = e.currentTarget.getAttribute('data-region');
      handleRestore(region);
    });
  });

  // Table Action Delegation (Replicate & Delete)
  const assetTableBody = document.getElementById('assets-table-body');
  if (assetTableBody) {
    assetTableBody.addEventListener('click', (e) => {
      const targetBtn = e.target.closest('button');
      if (!targetBtn) return;

      if (targetBtn.classList.contains('btn-replicate-single')) {
        const filename = targetBtn.getAttribute('data-filename');
        const from = targetBtn.getAttribute('data-from');
        const select = targetBtn.parentElement.querySelector('.rep-target-select');
        const to = select ? select.value : null;
        if (filename && from && to) {
          handleReplicate(filename, from, to);
        }
      } else if (targetBtn.classList.contains('btn-delete-asset')) {
        const filename = targetBtn.getAttribute('data-filename');
        if (filename) {
          handleDelete(filename);
        }
      }
    });
  }

  // Multi-Page Switching for sidebar links
  document.querySelectorAll('.sidebar-nav .nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const pageId = (link.getAttribute('href') || '').replace('#', '');
      window.location.hash = pageId;
      switchPage(pageId);
    });
  });

  // Support Browser Back/Forward navigation between pages
  window.addEventListener('hashchange', () => {
    const pageId = (window.location.hash || '').replace('#', '') || 'dashboard';
    switchPage(pageId);
  });
}

const PAGE_TITLES = {
  dashboard: { title: 'Dashboard Overview', subtitle: 'Real-time edge metrics, latency trends, and traffic analytics' },
  regions: { title: 'Regions & Content Delivery', subtitle: 'Edge node status, simulated geographic routing, and live asset fetch' },
  cache: { title: 'Edge Cache Manager', subtitle: 'In-memory TTL cache telemetry, hit/miss performance, and purge control' },
  assets: { title: 'Asset Store & Replication', subtitle: 'Multi-region file management, upload, and cross-region replication' },
  benchmark: { title: 'Performance Benchmarking', subtitle: 'Comparative latency bursts testing Edge vs Origin vs Failover' },
  logs: { title: 'Real-Time Request Logs', subtitle: 'Live telemetry logs of all incoming client requests and failover events' }
};

/**
 * Switch active page/view in the single-page application.
 * @param {string} pageId Section id to display
 */
function switchPage(pageId) {
  if (!pageId || !PAGE_TITLES[pageId]) {
    pageId = 'dashboard';
  }

  // Hide all sections, display the active page section
  document.querySelectorAll('.app-page').forEach(sec => {
    sec.classList.remove('active-page');
  });
  const targetSec = document.getElementById(pageId);
  if (targetSec) {
    targetSec.classList.add('active-page');
  }

  // Update active status on sidebar links
  document.querySelectorAll('.sidebar-nav .nav-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href === `#${pageId}`) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Update header title and subtitle
  const pageInfo = PAGE_TITLES[pageId];
  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-subtitle');
  if (titleEl && pageInfo) titleEl.textContent = pageInfo.title;
  if (subEl && pageInfo) subEl.textContent = pageInfo.subtitle;

  // Resize Chart.js canvases if returning to dashboard
  if (pageId === 'dashboard') {
    setTimeout(() => {
      if (charts.latency) charts.latency.resize();
      if (charts.cache) charts.cache.resize();
      if (charts.region) charts.region.resize();
    }, 60);
  }

  // Scroll to top smoothly
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Handle Content Request form submission
 */
async function handleFetchContent(e) {
  e.preventDefault();
  const region = document.getElementById('req-region').value;
  const filename = document.getElementById('req-filename').value.trim();
  const noCache = document.getElementById('req-nocache').checked;
  const submitBtn = document.getElementById('btn-fetch-content');

  if (!filename) {
    showToast('Please enter a valid filename', 'warning');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Fetching...';

  try {
    const result = await fetchContent(filename, region, noCache);
    const resultBox = document.getElementById('fetch-result-box');
    resultBox.classList.remove('d-none');

    // Populate response fields
    const cacheBadge = document.getElementById('fetch-cache-badge');
    const isHit = result.cache === 'HIT';
    cacheBadge.className = `badge ${isHit ? 'badge-hit' : 'badge-miss'}`;
    cacheBadge.textContent = `Cache: ${result.cache || 'NONE'}`;

    document.getElementById('res-served-region').textContent = result.region || region;
    document.getElementById('res-latency').textContent = `${result.latency || 0} ms`;
    document.getElementById('res-failover').textContent = result.failover ? `Yes (from ${result.failoverFrom})` : 'No';
    document.getElementById('res-content-type').textContent = result.contentType || 'text/plain';

    const payloadEl = document.getElementById('res-payload');
    if (typeof result.data === 'object') {
      payloadEl.textContent = JSON.stringify(result.data, null, 2);
    } else {
      payloadEl.textContent = result.data || result.message || JSON.stringify(result);
    }

    showToast(`Fetched ${filename} (${result.cache}) in ${result.latency}ms`, isHit ? 'success' : 'info');
    loadDashboard();
  } catch (err) {
    showToast(`Error fetching content: ${err.message}`, 'danger');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="bi bi-send me-1"></i> Fetch Content';
  }
}

/**
 * Handle Clear Cache Action
 */
async function handleClearCache() {
  const btn = document.getElementById('btn-clear-cache');
  btn.disabled = true;
  try {
    const res = await clearCache();
    if (res.success) {
      showToast(res.message || 'Edge cache successfully purged', 'success');
      loadDashboard();
    } else {
      showToast(res.message || 'Failed to clear cache', 'warning');
    }
  } catch (err) {
    showToast(`Failed to clear cache: ${err.message}`, 'danger');
  } finally {
    btn.disabled = false;
  }
}

/**
 * Handle Region Outage Simulation
 */
async function handleOutage(region) {
  try {
    const res = await simulateOutage(region);
    showToast(res.message || `Outage triggered on ${region}`, 'danger');
    loadDashboard();
  } catch (err) {
    showToast(`Error triggering outage: ${err.message}`, 'danger');
  }
}

/**
 * Handle Region Restoration
 */
async function handleRestore(region) {
  try {
    const res = await restoreRegion(region);
    showToast(res.message || `Region ${region} restored to online`, 'success');
    loadDashboard();
  } catch (err) {
    showToast(`Error restoring region: ${err.message}`, 'danger');
  }
}

/**
 * Handle Asset Upload
 */
async function handleUpload(e) {
  e.preventDefault();
  const fileInput = document.getElementById('upload-file');
  const regionSelect = document.getElementById('upload-region');
  const submitBtn = document.getElementById('btn-upload');

  if (!fileInput.files || fileInput.files.length === 0) {
    showToast('Please select a file to upload', 'warning');
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('region', regionSelect.value);

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Uploading...';

  try {
    const res = await uploadAsset(formData);
    if (res.success) {
      showToast(`Asset "${res.filename}" uploaded to ${res.region || regionSelect.value}`, 'success');
      fileInput.value = '';
      loadDashboard();
    } else {
      showToast(res.error || res.message || 'Upload failed', 'danger');
    }
  } catch (err) {
    showToast(`Upload error: ${err.message}`, 'danger');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="bi bi-upload me-1"></i> Upload to Edge';
  }
}

/**
 * Handle Asset Deletion
 */
async function handleDelete(filename) {
  if (!confirm(`Are you sure you want to delete "${filename}" from all edge regions?`)) {
    return;
  }

  try {
    const res = await deleteAsset(filename);
    if (res.success) {
      showToast(res.message || `Asset "${filename}" deleted`, 'success');
      loadDashboard();
    } else {
      showToast(res.message || 'Failed to delete asset', 'danger');
    }
  } catch (err) {
    showToast(`Delete error: ${err.message}`, 'danger');
  }
}

/**
 * Handle Asset Replication
 */
async function handleReplicate(filename, from, to) {
  try {
    const res = await replicateAsset(filename, from, to);
    if (res.success) {
      showToast(`Replicated "${filename}" from ${from} to ${to}`, 'success');
      loadDashboard();
    } else {
      showToast(res.message || 'Replication failed', 'warning');
    }
  } catch (err) {
    showToast(`Replication error: ${err.message}`, 'danger');
  }
}

/**
 * Handle Performance Benchmark Test
 */
async function handleBenchmark(e) {
  e.preventDefault();
  const filename = document.getElementById('bench-filename').value.trim();
  const region = document.getElementById('bench-region').value;
  const iterations = document.getElementById('bench-iterations').value;
  const btn = document.getElementById('btn-run-benchmark');

  if (!filename) {
    showToast('Please specify a filename for benchmark', 'warning');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Benchmarking...';

  try {
    const data = await runBenchmark(filename, region, iterations);

    // Populate comparison table
    const cacheAvg = data.cacheEnabled?.avgLatency !== undefined ? `${Math.round(data.cacheEnabled.avgLatency)} ms` : '-';
    const cacheMin = data.cacheEnabled?.minLatency !== undefined ? `${Math.round(data.cacheEnabled.minLatency)} ms` : '-';
    const cacheMax = data.cacheEnabled?.maxLatency !== undefined ? `${Math.round(data.cacheEnabled.maxLatency)} ms` : '-';
    const cacheRate = (data.cacheEnabled?.hits !== undefined) 
      ? `${data.cacheEnabled.hits} hits / ${data.cacheEnabled.misses || 0} misses` 
      : '-';

    const noCacheAvg = data.cacheDisabled?.avgLatency !== undefined ? `${Math.round(data.cacheDisabled.avgLatency)} ms` : '-';
    const noCacheMin = data.cacheDisabled?.minLatency !== undefined ? `${Math.round(data.cacheDisabled.minLatency)} ms` : '-';
    const noCacheMax = data.cacheDisabled?.maxLatency !== undefined ? `${Math.round(data.cacheDisabled.maxLatency)} ms` : '-';

    const foAvg = data.failover?.avgLatency !== undefined ? `${Math.round(data.failover.avgLatency)} ms` : '-';
    const foSuccess = data.failover?.successRate !== undefined ? `${(data.failover.successRate * 100).toFixed(0)}%` : '-';

    document.getElementById('bench-cache-avg').textContent = cacheAvg;
    document.getElementById('bench-cache-min').textContent = cacheMin;
    document.getElementById('bench-cache-max').textContent = cacheMax;
    document.getElementById('bench-cache-hits').textContent = cacheRate;

    document.getElementById('bench-nocache-avg').textContent = noCacheAvg;
    document.getElementById('bench-nocache-min').textContent = noCacheMin;
    document.getElementById('bench-nocache-max').textContent = noCacheMax;
    document.getElementById('bench-nocache-misses').textContent = '100% Origin Misses';

    document.getElementById('bench-fo-avg').textContent = foAvg;
    document.getElementById('bench-fo-success').textContent = foSuccess;

    showToast(`Benchmark completed across ${iterations} iterations!`, 'success');
    loadDashboard();
  } catch (err) {
    showToast(`Benchmark failed: ${err.message}`, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-play-fill me-1"></i> Benchmark';
  }
}

// ============================================================================
// (F) CHART INITIALIZATION
// ============================================================================

function initCharts() {
  // 1. Latency Line Chart
  const ctxLatency = document.getElementById('latencyChart');
  if (ctxLatency) {
    charts.latency = new Chart(ctxLatency, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Response Latency (ms)',
          data: [],
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Latency (ms)', font: { size: 11 } },
            grid: { color: 'rgba(0,0,0,0.05)' }
          },
          x: {
            grid: { display: false },
            ticks: { maxTicksLimit: 8 }
          }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }

  // 2. Cache Doughnut Chart
  const ctxCache = document.getElementById('cacheChart');
  if (ctxCache) {
    charts.cache = new Chart(ctxCache, {
      type: 'doughnut',
      data: {
        labels: ['Cache Hits', 'Cache Misses'],
        datasets: [{
          data: [0, 0],
          backgroundColor: ['#10b981', '#f59e0b'],
          hoverBackgroundColor: ['#059669', '#d97706'],
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, font: { size: 12 } }
          }
        }
      }
    });
  }

  // 3. Region Bar Chart
  const ctxRegion = document.getElementById('regionChart');
  if (ctxRegion) {
    charts.region = new Chart(ctxRegion, {
      type: 'bar',
      data: {
        labels: ['Mumbai 🇮🇳', 'Frankfurt 🇪🇺', 'Virginia 🇺🇸'],
        datasets: [{
          label: 'Requests',
          data: [0, 0, 0],
          backgroundColor: ['#3b82f6', '#10b981', '#f59e0b'],
          borderRadius: 6,
          barPercentage: 0.5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            grid: { color: 'rgba(0,0,0,0.05)' }
          },
          x: {
            grid: { display: false }
          }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }
}

/**
 * Initialize Mermaid diagram rendering.
 */
function initMermaid() {
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      securityLevel: 'loose',
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis'
      }
    });
  }
}

// ============================================================================
// (G) HELPER FUNCTIONS
// ============================================================================

/**
 * Format timestamp or date object into HH:MM:SS.
 */
function formatTime(timestamp) {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '-';
  return d.toTimeString().split(' ')[0];
}

/**
 * Show a dismissable toast notification on the top right.
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const bgClasses = {
    info: 'bg-primary text-white',
    success: 'bg-success text-white',
    warning: 'bg-warning text-dark',
    danger: 'bg-danger text-white'
  };

  const bgClass = bgClasses[type] || 'bg-secondary text-white';

  const toastDiv = document.createElement('div');
  toastDiv.className = `toast align-items-center ${bgClass} border-0 custom-toast show mb-2`;
  toastDiv.setAttribute('role', 'alert');
  toastDiv.setAttribute('aria-live', 'assertive');
  toastDiv.setAttribute('aria-atomic', 'true');

  toastDiv.innerHTML = `
    <div class="d-flex">
      <div class="toast-body d-flex align-items-center gap-2">
        <i class="bi ${type === 'success' ? 'bi-check-circle-fill' : type === 'danger' ? 'bi-x-circle-fill' : 'bi-info-circle-fill'}"></i>
        <span>${escapeHtml(message)}</span>
      </div>
      <button type="button" class="btn-close ${type !== 'warning' ? 'btn-close-white' : ''} me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>
  `;

  container.appendChild(toastDiv);

  // Auto-remove after 3.5 seconds
  setTimeout(() => {
    toastDiv.classList.remove('show');
    setTimeout(() => toastDiv.remove(), 300);
  }, 3500);
}

/**
 * Format raw byte size into human readable string.
 */
function formatBytes(bytes) {
  if (!+bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Escape HTML strings to protect against XSS injection.
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
