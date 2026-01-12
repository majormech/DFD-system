/*=====================================================================
  search.js – Search page logic
=====================================================================*/

// Import utility functions
const { getApiData, formatDate } = window.DFDApp || {};

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Search page loaded');
  
  // DOM elements
  const categorySelect = $('#category');
  const stationIdSelect = $('#station-id');
  const apparatusIdSelect = $('#apparatus-id');
  const dateFromInput = $('#date-from');
  const dateToInput = $('#date-to');
  const searchQueryInput = $('#search-query');
  const limitSelect = $('#limit');
  const searchBtn = $('#btn-search');
  const resetBtn = $('#btn-reset');
  const printBtn = $('#btn-print');
  const exportCsvBtn = $('#btn-export-csv');
  const reportHeaderInput = $('#report-header');
  const resultsCountSpan = $('#results-count');
  const resultsBody = $('#results-body');
  const adminBtn = $('#btn-admin');
  
  // Set default date range (last 30 days)
  function setDefaultDates() {
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    if (dateFromInput) {
      dateFromInput.value = thirtyDaysAgo.toISOString().split('T')[0];
    }
    if (dateToInput) {
      dateToInput.value = today.toISOString().split('T')[0];
    }
  }
  
  // Perform search
  async function performSearch() {
    const params = {
      category: categorySelect.value,
      stationId: stationIdSelect.value,
      apparatusId: apparatusIdSelect.value,
      from: dateFromInput.value,
      to: dateToInput.value,
      q: searchQueryInput.value,
      limit: limitSelect.value
    };
    
    try {
      resultsBody.innerHTML = '<tr><td colspan="6">Searching...</td></tr>';
      
      const response = await getApiData('searchrecords', params);
      renderResults(response.results);
    } catch (error) {
      console.error('Search failed:', error);
      resultsBody.innerHTML = `<tr><td colspan="6">Search failed: ${error.message}</td></tr>`;
    }
  }
  
  // Render search results
  function renderResults(results) {
    if (!resultsBody) return;
    
    resultsCountSpan.textContent = `${results.length} results found`;
    
    if (results.length === 0) {
      resultsBody.innerHTML = '<tr><td colspan="6">No results found</td></tr>';
      return;
    }
    
    let html = '';
    results.forEach(result => {
      html += `
        <tr>
          <td>${formatDate(result.timestamp)}</td>
          <td>${escapeHtml(result.stationId || '')}</td>
          <td>${escapeHtml(result.apparatusId || '')}</td>
          <td>${escapeHtml(result.category || '')}</td>
          <td>${escapeHtml(result.submitter || '')}</td>
          <td>${escapeHtml(result.summary || '')}</td>
        </tr>
      `;
    });
    
    resultsBody.innerHTML = html;
  }
  
  // Reset form
  function resetForm() {
    categorySelect.value = 'all';
    stationIdSelect.value = 'all';
    apparatusIdSelect.value = 'all';
    searchQueryInput.value = '';
    reportHeaderInput.value = '';
    setDefaultDates();
  }
  
  // Print results
  function printResults() {
    window.print();
  }
  
  // Export to CSV
  function exportToCSV() {
    const header = reportHeaderInput.value || 'DFD Search Results';
    const rows = [['Timestamp', 'Station', 'Apparatus', 'Category', 'Submitter', 'Summary']];
    
    // Add data rows
    $$('tbody tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length === 6) {
        rows.push([
          cells[0].textContent,
          cells[1].textContent,
          cells[2].textContent,
          cells[3].textContent,
          cells[4].textContent,
          cells[5].textContent
        ]);
      }
    });
    
    // Convert to CSV
    const csvContent = rows.map(row => 
      row.map(field => `"${field.replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `dfd_search_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  
  // Event listeners
  if (searchBtn) {
    searchBtn.addEventListener('click', performSearch);
  }
  
  if (resetBtn) {
    resetBtn.addEventListener('click', resetForm);
  }
  
  if (printBtn) {
    printBtn.addEventListener('click', printResults);
  }
  
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', exportToCSV);
  }
  
  if (adminBtn) {
    adminBtn.addEventListener('click', () => {
      window.location.href = 'administration.html';
    });
  }
  
  // Initialize
  setDefaultDates();
});
