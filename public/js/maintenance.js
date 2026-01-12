/*=====================================================================
  maintenance.js – Maintenance page logic
=====================================================================*/

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Maintenance page loaded');
  
  // Load maintenance statistics
  async function loadMaintenanceStats() {
    try {
      // Load counts for each maintenance group
      const stats = await Promise.all([
        getMaintenanceItemCount('Maintenance_Small_Engine'),
        getMaintenanceItemCount('Maintenance_Gas_Monitor'),
        getMaintenanceItemCount('Maintenance_SCBA'),
        getMaintenanceItemCount('Maintenance_Dive_SCBA'),
        getMaintenanceItemCount('Maintenance_Garage')
      ]);
      
      updateMaintenanceStats(stats);
    } catch (error) {
      console.error('Failed to load maintenance stats:', error);
    }
  }
  
  // Get count of items in maintenance group
  async function getMaintenanceItemCount(tabName) {
    try {
      const response = await fetch(`/api?action=getinventoryitems&tab=${tabName}`);
      const data = await response.json();
      if (data.ok) {
        return data.items ? data.items.length : 0;
      }
      return 0;
    } catch (error) {
      console.error(`Failed to get count for ${tabName}:`, error);
      return 0;
    }
  }
  
  // Update UI with maintenance stats
  function updateMaintenanceStats(counts) {
    const statCards = document.querySelectorAll('.group-card');
    const labels = ['Small Engine', 'Gas Monitor', 'SCBA', 'Dive SCBA', 'Garage'];
    
    statCards.forEach((card, index) => {
      const countElement = card.querySelector('.count');
      if (countElement) {
        countElement.textContent = counts[index] || 0;
      }
    });
  }
  
  // Initialize
  loadMaintenanceStats();
  
  // Auto-refresh every 5 minutes
  setInterval(loadMaintenanceStats, 5 * 60 * 1000);
});
