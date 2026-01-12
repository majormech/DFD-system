/*=====================================================================
  service-worker.js – Service worker for offline functionality
=====================================================================*/

const CACHE_NAME = 'dfd-system-v2'; // Increment version
const urlsToCache = [
  '/',
  '/index.html',
  '/administration.html',
  '/configuration.html',
  '/search.html',
  '/maintenance.html',
  '/inventory.html',
  '/daily_check.html',
  '/maintenance_small_engine.html',
  '/maintenance_gas_monitor.html',
  '/maintenance_scba.html',
  '/maintenance_dive_scba.html',
  '/maintenance_garage.html',
  '/scuba.html',
  '/hose_tower_station1.html',
  '/spare_hose_station2.html',
  '/cage_spare_supplies_station1.html',
  '/styles.css',
  '/js/app.js',
  '/js/administration.js',
  '/js/configuration.js',
  '/js/search.js',
  '/js/maintenance.js',
  '/js/inventory.js',
  '/js/daily_check.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Install event - cache static assets
self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch(error => {
        console.error('Failed to cache files:', error);
        // Don't fail the install - just log the error
      })
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', event => {
  // Only cache GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  // Don't cache API requests or dynamic content
  if (event.request.url.includes('/api') || 
      event.request.url.includes('nocache') ||
      event.request.url.includes('/dynamic')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached response if found
        if (response) {
          return response;
        }
        
        // Clone the request because it's a stream and can only be consumed once
        const fetchRequest = event.request.clone();
        
        // Fetch from network
        return fetch(fetchRequest)
          .then(response => {
            // Check if we received a valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            
            // Clone the response because it's a stream and can only be consumed once
            const responseToCache = response.clone();
            
            // Cache the response
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              })
              .catch(err => {
                console.warn('Could not cache:', event.request.url, err);
              });
            
            return response;
          })
          .catch(error => {
            console.error('Network fetch failed:', error);
            // Return a fallback response for critical resources
            if (event.request.destination === 'document') {
              return caches.match('/index.html');
            }
            throw error;
          });
      })
      .catch(error => {
        console.error('Cache match failed:', error);
        // If both cache and network fail, try to serve index.html for documents
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
        throw error;
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  
  const cacheWhitelist = [CACHE_NAME];
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheWhitelist.indexOf(cacheName) === -1) {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
            return null;
          }).filter(p => p) // Remove null promises
        );
      })
      .catch(error => {
        console.error('Failed to delete old caches:', error);
      })
  );
  
  // Claim clients to enable offline functionality immediately
  return self.clients.claim();
});

// Handle messages from clients
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Background sync (for future offline form submissions)
self.addEventListener('sync', event => {
  if (event.tag === 'sync-inventory-data') {
    event.waitUntil(syncInventoryData());
  }
});

// Function to sync inventory data when online
async function syncInventoryData() {
  // This would handle syncing any offline inventory changes
  console.log('Syncing inventory data...');
  // Implementation would depend on how you store offline data
  return Promise.resolve();
}
