/*=====================================================================
  daily_check.js – Daily check page logic
=====================================================================*/

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Daily check page loaded');
  
  // DOM elements
  const crewMemberInput = $('#crew-member');
  const stationSelect = $('#station');
  const apparatusSelect = $('#apparatus');
  const checkTypeSelect = $('#check-type');
  const checkFieldsDiv = $('#check-fields');
  const issueTextInput = $('#issue-text');
  const issueNoteInput = $('#issue-note');
  const saveCheckBtn = $('#save-check');
  const resetFormBtn = $('#reset-form');
  const adminBtn = $('#btn-admin');
  
  // Load apparatus options when station changes
  stationSelect.addEventListener('change', async () => {
    const stationId = stationSelect.value;
    if (stationId) {
      await loadApparatusForStation(stationId);
    }
  });
  
  // Load check fields when check type changes
  checkTypeSelect.addEventListener('change', () => {
    const checkType = checkTypeSelect.value;
    if (checkType) {
      loadCheckFields(checkType);
    }
  });
  
  // Load apparatus for selected station
  async function loadApparatusForStation(stationId) {
    try {
      const response = await fetch(`/api?action=getapparatus&stationId=${stationId}`);
      const data = await response.json();
      
      if (data.ok) {
        apparatusSelect.innerHTML = '<option value="">Select Apparatus</option>';
        data.apparatus.forEach(app => {
          const option = document.createElement('option');
          option.value = app.apparatusId;
          option.textContent = app.apparatusName || app.apparatusId;
          apparatusSelect.appendChild(option);
        });
      }
    } catch (error) {
      console.error('Failed to load apparatus:', error);
    }
  }
  
  // Load check fields based on check type
  function loadCheckFields(checkType) {
    let html = '';
    
    switch(checkType) {
      case 'apparatusDaily':
        html = `
          <h3>Apparatus Daily Check</h3>
          
          <div class="form-group">
            <label>Mileage:</label>
            <input type="number" id="mileage" min="0">
          </div>
          
          <div class="form-group">
            <label>Engine Hours:</label>
            <input type="number" id="engine-hours" min="0" step="0.1">
          </div>
          
          <div class="form-group">
            <label>Fuel %:</label>
            <input type="number" id="fuel-percent" min="0" max="100">
          </div>
          
          <div class="form-group">
            <label>DEF %:</label>
            <input type="number" id="def-percent" min="0" max="100">
          </div>
          
          <div class="form-group">
            <label>Tank Water %:</label>
            <input type="number" id="tank-water-percent" min="0" max="100">
          </div>
          
          <h4>Checklist Items</h4>
          
          <div class="check-item">
            <label>Knox Box Keys:</label>
            <select id="knox-pass-fail">
              <option value="Pass">Pass</option>
              <option value="Fail">Fail</option>
            </select>
            <input type="text" id="knox-notes" placeholder="Notes">
          </div>
          
          <div class="check-item">
            <label>Portable Radios (4):</label>
            <select id="radios-pass-fail">
              <option value="Pass">Pass</option>
              <option value="Fail">Fail</option>
            </select>
            <input type="text" id="radios-notes" placeholder="Notes">
          </div>
          
          <!-- Add more checklist items as needed -->
        `;
        break;
        
      case 'medicalDaily':
        html = `
          <h3>Medical Daily Check</h3>
          
          <div class="form-group">
            <label>O2 Bottle Level (0-2000):</label>
            <input type="number" id="o2-level" min="0" max="2000">
          </div>
          
          <div class="form-group">
            <label>Airway Equipment:</label>
            <select id="airway-pass-fail">
              <option value="Pass">Pass</option>
              <option value="Fail">Fail</option>
            </select>
            <input type="text" id="airway-notes" placeholder="Notes">
          </div>
          
          <h4>Medications</h4>
          <div id="medications-list">
            <!-- Medications will be loaded here -->
          </div>
        `;
        loadMedications();
        break;
        
      // Add cases for other check types...
      default:
        html = '<p>Select a check type to begin</p>';
    }
    
    checkFieldsDiv.innerHTML = html;
  }
  
  // Load medications for medical daily check
  async function loadMedications() {
    try {
      const response = await fetch('/api?action=getconfig');
      const data = await response.json();
      
      if (data.ok) {
        const medicationsList = $('#medications-list');
        if (medicationsList) {
          let html = '';
          data.config.drugs.forEach(drug => {
            html += `
              <div class="medication-item">
                <label>${drug}:</label>
                <input type="number" placeholder="Qty" class="drug-qty" data-drug="${drug}">
                <input type="date" placeholder="Exp Date" class="drug-exp" data-drug="${drug}">
              </div>
            `;
          });
          medicationsList.innerHTML = html;
        }
      }
    } catch (error) {
      console.error('Failed to load medications:', error);
    }
  }
  
  // Save check
  async function saveCheck() {
    const crewMember = crewMemberInput.value.trim();
    const stationId = stationSelect.value;
    const apparatusId = apparatusSelect.value;
    const checkType = checkTypeSelect.value;
    
    if (!crewMember || !stationId || !apparatusId || !checkType) {
      alert('Please fill in all required fields');
      return;
    }
    
    try {
      // Prepare check payload based on check type
      const checkPayload = prepareCheckPayload(checkType);
      
      // Prepare issue data
      const newIssueText = issueTextInput.value.trim();
      const newIssueNote = issueNoteInput.value.trim();
      
      // Send to backend
      const response = await fetch('/api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'savecheck',
          stationId: stationId,
          apparatusId: apparatusId,
          submitter: crewMember,
          checkType: checkType,
          checkPayload: checkPayload,
          newIssueText: newIssueText,
          newIssueNote: newIssueNote
        })
      });
      
      const data = await response.json();
      
      if (data.ok) {
        alert('Check saved successfully!');
        resetForm();
      } else {
        throw new Error(data.error || 'Failed to save check');
      }
    } catch (error) {
      console.error('Failed to save check:', error);
      alert('Failed to save check: ' + error.message);
    }
  }
  
  // Prepare check payload based on check type
  function prepareCheckPayload(checkType) {
    const payload = {};
    
    switch(checkType) {
      case 'apparatusDaily':
        payload.mileage = $('#mileage')?.value || 0;
        payload.engineHours = $('#engine-hours')?.value || 0;
        payload.fuel = $('#fuel-percent')?.value || 0;
        payload.def = $('#def-percent')?.value || 0;
        payload.tank = $('#tank-water-percent')?.value || 0;
        
        payload.knox = {
          passFail: $('#knox-pass-fail')?.value || 'Pass',
          notes: $('#knox-notes')?.value || ''
        };
        
        payload.radios = {
          passFail: $('#radios-pass-fail')?.value || 'Pass',
          notes: $('#radios-notes')?.value || ''
        };
        // Add more fields as needed
        break;
        
      case 'medicalDaily':
        payload.o2 = $('#o2-level')?.value || 0;
        payload.airwayPassFail = $('#airway-pass-fail')?.value || 'Pass';
        payload.airwayNotes = $('#airway-notes')?.value || '';
        
        // Collect medication data
        const drugs = [];
        $$('.medication-item').forEach(item => {
          const drugName = item.querySelector('.drug-qty').dataset.drug;
          const qty = item.querySelector('.drug-qty').value;
          const exp = item.querySelector('.drug-exp').value;
          if (drugName && qty && exp) {
            drugs.push({ name: drugName, qty: parseInt(qty), exp: exp });
          }
        });
        payload.drugs = drugs;
        break;
        
      // Add cases for other check types...
    }
    
    return payload;
  }
  
  // Reset form
  function resetForm() {
    crewMemberInput.value = '';
    stationSelect.value = '';
    apparatusSelect.innerHTML = '<option value="">Select Apparatus</option>';
    checkTypeSelect.value = '';
    checkFieldsDiv.innerHTML = '';
    issueTextInput.value = '';
    issueNoteInput.value = '';
  }
  
  // Event listeners
  if (saveCheckBtn) {
    saveCheckBtn.addEventListener('click', saveCheck);
  }
  
  if (resetFormBtn) {
    resetFormBtn.addEventListener('click', resetForm);
  }
  
  if (adminBtn) {
    adminBtn.addEventListener('click', () => {
      window.location.href = 'administration.html';
    });
  }
  
  // Load saved crew member name
  const savedCrewMember = localStorage.getItem('dfd_crew_member');
  if (savedCrewMember) {
    crewMemberInput.value = savedCrewMember;
  }
  
  // Save crew member name
  crewMemberInput.addEventListener('change', () => {
    localStorage.setItem('dfd_crew_member', crewMemberInput.value);
  });
});
