/*=====================================================================
  configuration.js – Configuration page logic
=====================================================================*/

// Import utility functions
const { getApiData, postApiData } = window.DFDApp || {};

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Configuration page loaded');
  
  // DOM elements
  const tabButtons = $$('.tab-button');
  const weeklyTab = $('#weekly-tab');
  const emailTab = $('#email-tab');
  const checkTypeSelect = $('#check-type');
  const dueWeekdaySelect = $('#due-weekday');
  const saveScheduleBtn = $('#save-schedule');
  const emailGroupSelect = $('#email-group');
  const stationIdSelect = $('#station-id');
  const emailRecipientsTextarea = $('#email-recipients');
  const saveEmailsBtn = $('#save-emails');
  const adminBtn = $('#btn-admin');
  
  // Tab switching
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Remove active class from all buttons
      tabButtons.forEach(btn => btn.classList.remove('active'));
      
      // Hide all tab content
      weeklyTab.classList.add('hidden');
      emailTab.classList.add('hidden');
      
      // Show selected tab
      const tab = button.dataset.tab;
      if (tab === 'weekly') {
        weeklyTab.classList.remove('hidden');
        button.classList.add('active');
      } else if (tab === 'email') {
        emailTab.classList.remove('hidden');
        button.classList.add('active');
        loadEmailConfig();
      }
    });
  });
  
  // Load weekly configuration
  async function loadWeeklyConfig() {
    try {
      const response = await getApiData('getweeklyconfig');
      // Set default values based on current config
      // This would normally populate the form with existing values
      console.log('Weekly config loaded:', response.weeklyConfig);
    } catch (error) {
      console.error('Failed to load weekly config:', error);
    }
  }
  
  // Load email configuration
  async function loadEmailConfig() {
    try {
      const response = await getApiData('getemailconfig');
      // This would normally populate the email form with existing values
      console.log('Email config loaded:', response.emails);
    } catch (error) {
      console.error('Failed to load email config:', error);
    }
  }
  
  // Save weekly schedule
  async function saveWeeklySchedule() {
    const checkType = checkTypeSelect.value;
    const weekday = dueWeekdaySelect.value;
    const adminName = 'Configuration UI'; // Could be from a form field
    
    try {
      const response = await postApiData('setweeklyday', {
        checkKey: checkType,
        weekday: weekday,
        user: adminName
      });
      
      alert('Weekly schedule saved successfully!');
      console.log('Weekly schedule saved:', response);
    } catch (error) {
      console.error('Failed to save weekly schedule:', error);
      alert('Failed to save weekly schedule: ' + error.message);
    }
  }
  
  // Save email configuration
  async function saveEmailConfig() {
    const kind = emailGroupSelect.value;
    const stationId = stationIdSelect.value;
    const emails = emailRecipientsTextarea.value
      .split('\n')
      .map(email => email.trim())
      .filter(email => email);
    const adminName = 'Configuration UI'; // Could be from a form field
    
    try {
      const response = await postApiData('setemailconfig', {
        kind: kind,
        stationId: stationId,
        emails: emails,
        user: adminName
      });
      
      alert('Email configuration saved successfully!');
      console.log('Email config saved:', response);
    } catch (error) {
      console.error('Failed to save email config:', error);
      alert('Failed to save email configuration: ' + error.message);
    }
  }
  
  // Event listeners
  if (saveScheduleBtn) {
    saveScheduleBtn.addEventListener('click', saveWeeklySchedule);
  }
  
  if (saveEmailsBtn) {
    saveEmailsBtn.addEventListener('click', saveEmailConfig);
  }
  
  if (adminBtn) {
    adminBtn.addEventListener('click', () => {
      window.location.href = 'administration.html';
    });
  }
  
  // Initialize
  loadWeeklyConfig();
});
