/*=====================================================================
  service-worker.js – Service worker for offline functionality
=====================================================================*/

const CACHE_NAME = 'dfd-system-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/administration.html',
  '/configuration.html',
  '/search.html',
  '/maintenance.html',
  '/inventory.html',
  '/styles.css',
  '/js/app.js',
  '/js/administration.js',
  '/js/configuration.js',
  '/js/search.js',
  '/js/maintenance.js',
  '/js/inventory.js',
  '/manifest.webmanifest'
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
      })
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', event => {
  // Only cache GET requests
  if (event.request.method !== 'GET') {
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
              });
            
            return response;
          })
          .catch(error => {
            console.error('Fetch failed:', error);
            // Return a fallback response for critical resources
            if (event.request.destination === 'document') {
              return caches.match('/index.html');
            }
            throw error;
          });
      })
      .catch(error => {
        console.error('Cache match failed:', error);
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
              return caches.delete(cacheName);
            }
          })
        );
      })
      .catch(error => {
        console.error('Failed to delete old caches:', error);
      })
  );
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
}
