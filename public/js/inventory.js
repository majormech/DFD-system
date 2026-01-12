/*=====================================================================
  inventory.js – Inventory management logic
=====================================================================*/

// Import utility functions
const { getApiData, postApiData } = window.DFDApp || {};

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Inventory page loaded');
  
  // DOM elements
  const tabButtons = $$('.tab-button');
  const tabContents = $$('.tab-content');
  const stationSelect = $('#station-select');
  const addItemBtns = $$('.add-item');
  const removeItemBtns = $$('.remove-item');
  const refreshBtns = $$('.refresh');
  const adminBtn = $('#btn-admin');
  
  // Tab switching
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Remove active class from all buttons
      tabButtons.forEach(btn => btn.classList.remove('active'));
      
      // Hide all tab content
      tabContents.forEach(content => content.classList.add('hidden'));
      
      // Show selected tab
      button.classList.add('active');
      const tabId = button.dataset.tab + '-tab';
      const tabContent = $('#' + tabId);
      if (tabContent) {
        tabContent.classList.remove('hidden');
        loadTabData(button.dataset.tab);
      }
    });
  });
  
  // Load data for specific tab
  async function loadTabData(tab) {
    try {
      console.log(`Loading data for ${tab} tab`);
      
      // Different logic for each tab type
      switch(tab) {
        case 'master':
          await loadMasterInventory();
          break;
        case 'station':
          if (stationSelect) {
            await loadStationInventory(stationSelect.value);
          }
          break;
        // Add cases for other tabs
      }
    } catch (error) {
      console.error(`Failed to load ${tab} data:`, error);
    }
  }
  
  // Load master inventory
  async function loadMasterInventory() {
    try {
      // This would call the backend API to get master inventory data
      console.log('Loading master inventory...');
      // const response = await getApiData('getinventoryitems', { tab: 'Inventory_Master' });
      // renderInventoryTable('master-inventory-body', response.items);
    } catch (error) {
      console.error('Failed to load master inventory:', error);
    }
  }
  
  // Load station inventory
  async function loadStationInventory(stationId) {
    try {
      // This would call the backend API to get station inventory data
      console.log(`Loading inventory for station ${stationId}`);
      // const response = await getApiData('getinventoryitems', { tab: `Inventory_Station_${stationId}` });
      // renderInventoryTable('station-inventory-body', response.items);
    } catch (error) {
      console.error(`Failed to load station ${stationId} inventory:`, error);
    }
  }
  
  // Render inventory table
  function renderInventoryTable(tableBodyId, items) {
    const tableBody = $('#' + tableBodyId);
    if (!tableBody) return;
    
    if (!items || items.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="13">No items found</td></tr>';
      return;
    }
    
    let html = '';
    items.forEach(item => {
      html += `
        <tr>
          <td><input type="checkbox" data-item-id="${item.itemId}"></td>
          <td>${escapeHtml(item.itemId || '')}</td>
          <td>${escapeHtml(item.category || '')}</td>
          <td>${escapeHtml(item.type || '')}</td>
          <td>${escapeHtml(item.identifier || '')}</td>
          <td>${escapeHtml(item.description || '')}</td>
          <td>${escapeHtml(item.stationId || '')}</td>
          <td>${escapeHtml(item.unit || '')}</td>
          <td>${escapeHtml(item.slot || '')}</td>
          <td>${escapeHtml(item.status || '')}</td>
          <td>${formatDate(item.lastUpdated)}</td>
          <td>${escapeHtml(item.updatedBy || '')}</td>
          <td>${escapeHtml(item.notes || '')}</td>
        </tr>
      `;
    });
    
    tableBody.innerHTML = html;
  }
  
  // Add inventory item
  async function addInventoryItem(tab) {
    const itemName = prompt('Enter item name:');
    if (!itemName) return;
    
    try {
      // This would call the backend API to add an item
      console.log(`Adding item to ${tab}:`, itemName);
      // const response = await postApiData('addinventoryitem', {
      //   tab: getTabName(tab),
      //   itemData: { name: itemName }
      // });
      // 
      // if (response.ok) {
      //   alert('Item added successfully!');
      //   loadTabData(tab);
      // } else {
      //   throw new Error(response.error);
      // }
    } catch (error) {
      console.error('Failed to add item:', error);
      alert('Failed to add item: ' + error.message);
    }
  }
  
  // Remove inventory item
  async function removeInventoryItem(tab) {
    const checkedBoxes = $$(`#${tab}-inventory-body input[type="checkbox"]:checked`);
    if (checkedBoxes.length === 0) {
      alert('Please select at least one item to remove');
      return;
    }
    
    if (!confirm(`Are you sure you want to remove ${checkedBoxes.length} item(s)?`)) {
      return;
    }
    
    try {
      // This would call the backend API to remove items
      for (const checkbox of checkedBoxes) {
        const itemId = checkbox.dataset.itemId;
        console.log(`Removing item ${itemId} from ${tab}`);
        // const response = await postApiData('removeinventoryitem', {
        //   tab: getTabName(tab),
        //   itemId: itemId
        // });
        // 
        // if (!response.ok) {
        //   throw new Error(response.error);
        // }
      }
      
      alert('Items removed successfully!');
      loadTabData(tab);
    } catch (error) {
      console.error('Failed to remove items:', error);
      alert('Failed to remove items: ' + error.message);
    }
  }
  
  // Get tab name for API calls
  function getTabName(tab) {
    switch(tab) {
      case 'master': return 'Inventory_Master';
      case 'station': return `Inventory_Station_${stationSelect.value}`;
      // Add other cases
      default: return tab;
    }
  }
  
  // Refresh tab data
  function refreshTabData(tab) {
    loadTabData(tab);
  }
  
  // Event listeners
  if (stationSelect) {
    stationSelect.addEventListener('change', () => {
      loadTabData('station');
    });
  }
  
  addItemBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.id.replace('-item', '').replace('add-', '');
      addInventoryItem(tab);
    });
  });
  
  removeItemBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.id.replace('-item', '').replace('remove-', '');
      removeInventoryItem(tab);
    });
  });
  
  refreshBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.id.replace('-item', '').replace('refresh-', '');
      refreshTabData(tab);
    });
  });
  
  if (adminBtn) {
    adminBtn.addEventListener('click', () => {
      window.location.href = 'administration.html';
    });
  }
  
  // Initialize first tab
  if (tabButtons.length > 0) {
    tabButtons[0].click();
  }
});
