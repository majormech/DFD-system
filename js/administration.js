/*=====================================================================
  administration.js – Administration page logic
=====================================================================*/

// Import utility functions
const { getApiData, formatDate } = window.DFDApp || {};

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Administration page loaded');
  
  // DOM elements
  const stationFilter = $('#station-filter');
  const adminNameInput = $('#admin-name');
  const statusGrid = $('#status-grid');
  const issuesList = $('#issues-list');
  const refreshBtn = $('#btn-refresh');
  
  // Load saved preferences
  function loadPreferences() {
    const savedStation = localStorage.getItem('dfd_admin_station') || 'all';
    const savedName = localStorage.getItem('dfd_admin_name') || '';
    
    if (stationFilter) stationFilter.value = savedStation;
    if (adminNameInput) adminNameInput.value = savedName;
  }
  
  // Save preferences
  function savePreferences() {
    if (stationFilter) localStorage.setItem('dfd_admin_station', stationFilter.value);
    if (adminNameInput) localStorage.setItem('dfd_admin_name', adminNameInput.value);
  }
  
  // Load admin status
  async function loadAdminStatus() {
    try {
      const response = await getApiData('getadminstatus');
      renderStatusDashboard(response.status);
    } catch (error) {
      console.error('Failed to load admin status:', error);
      statusGrid.innerHTML = '<p class="error">Failed to load status data</p>';
    }
  }
  
  // Load active issues
  async function loadActiveIssues() {
    try {
      const stationId = stationFilter ? stationFilter.value : 'all';
      const response = await getApiData('getactiveissues', { 
        stationId: stationId === 'all' ? '' : stationId 
      });
      renderIssues(response.issues);
    } catch (error) {
      console.error('Failed to load issues:', error);
      issuesList.innerHTML = '<p class="error">Failed to load issues</p>';
    }
  }
  
  // Render status dashboard
  function renderStatusDashboard(statusData) {
    if (!statusGrid) return;
    
    let html = '';
    
    // Group by station
    const stations = {};
    statusData.rows.forEach(row => {
      if (!stations[row.stationId]) {
        stations[row.stationId] = {
          stationName: row.stationName,
          apparatus: []
        };
      }
      stations[row.stationId].apparatus.push(row);
    });
    
    // Render each station
    Object.entries(stations).forEach(([stationId, station]) => {
      html += `
        <div class="status-card">
          <h3>${station.stationName}</h3>
          <div class="status-items">
      `;
      
      station.apparatus.forEach(app => {
        html += `
          <div class="status-item">
            <span>${app.apparatusId}</span>
            <span class="${getStatusClass(app.checks.apparatusDaily)}">Daily</span>
            <span class="${getStatusClass(app.checks.medicalDaily)}">Medical</span>
            <span class="${getStatusClass(app.checks.scbaWeekly)}">SCBA</span>
            <span class="${getStatusClass(app.checks.pumpWeekly)}">Pump</span>
            <span class="${getStatusClass(app.checks.aerialWeekly)}">Aerial</span>
            <span class="${getStatusClass(app.checks.sawWeekly)}">Saws</span>
            <span class="${getStatusClass(app.checks.batteriesWeekly)}">Batt</span>
          </div>
        `;
      });
      
      html += '</div></div>';
    });
    
    statusGrid.innerHTML = html;
  }
  
  // Get status class based on check status
  function getStatusClass(check) {
    if (check === null) return 'status-na'; // Not applicable
    return check.ok ? 'status-ok' : 'status-error';
  }
  
  // Render issues
  function renderIssues(issues) {
    if (!issuesList) return;
    
    if (issues.length === 0) {
      issuesList.innerHTML = '<p>No active issues</p>';
      return;
    }
    
    let html = '';
    issues.forEach(issue => {
      const statusClass = `status-${issue.status.toLowerCase()}`;
      html += `
        <div class="issue-item">
          <div class="issue-content">
            <h4>${escapeHtml(issue.apparatusId)} - ${escapeHtml(issue.issueText)}</h4>
            ${issue.note ? `<p>${escapeHtml(issue.note)}</p>` : ''}
          </div>
          <span class="issue-status ${statusClass}">${issue.status}</span>
        </div>
      `;
    });
    
    issuesList.innerHTML = html;
  }
  
  // Event listeners
  if (stationFilter) {
    stationFilter.addEventListener('change', () => {
      savePreferences();
      loadActiveIssues();
    });
  }
  
  if (adminNameInput) {
    adminNameInput.addEventListener('change', savePreferences);
  }
  
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await loadAdminStatus();
      await loadActiveIssues();
    });
  }
  
  // Initialize
  loadPreferences();
  loadAdminStatus();
  loadActiveIssues();
});
