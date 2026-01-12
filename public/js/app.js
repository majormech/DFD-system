/*=====================================================================
  app.js – Main application logic
=====================================================================*/

const API_BASE_URL = '/api'; // Update with your actual API URL

// Utility functions
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// API functions
async function apiCall(endpoint, options = {}) {
  try {
    const url = `${API_BASE_URL}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    };
    
    const response = await fetch(url, config);
    const data = await response.json();
    
    if (!data.ok) {
      throw new Error(data.error || 'API request failed');
    }
    
    return data;
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}

async function getApiData(action, params = {}) {
  const queryString = new URLSearchParams({ action, ...params }).toString();
  return await apiCall(`?${queryString}`);
}

async function postApiData(action, data = {}) {
  return await apiCall('', {
    method: 'POST',
    body: JSON.stringify({ action, ...data }),
  });
}

// App initialization
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DFD App initialized');
  
  // Check for service worker
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js');
      console.log('Service Worker registered with scope:', registration.scope);
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  }
  
  // Set up offline functionality
  window.addEventListener('online', () => {
    console.log('Online');
    // Could sync any pending changes here
  });
  
  window.addEventListener('offline', () => {
    console.log('Offline');
    // Could show offline notification
  });
});

// Export functions for use in other modules
window.DFDApp = {
  apiCall,
  getApiData,
  postApiData,
  formatDate,
  escapeHtml
};
