// js/storage.js

export function loadCredentials() {
  return {
    apiKey: localStorage.getItem('my_book_tracker_gemini_key') || '',
    dbScriptUrl: localStorage.getItem('my_book_tracker_db_url') || ''
  };
}

export function saveCredentials(apiKey, dbScriptUrl) {
  localStorage.setItem('my_book_tracker_gemini_key', apiKey);
  localStorage.setItem('my_book_tracker_db_url', dbScriptUrl);
}

// --- Offline Caching Queue Helpers ---
export function getOfflineQueue() {
  return JSON.parse(localStorage.getItem('my_book_tracker_offline_queue')) || [];
}

export function addToOfflineQueue(book) {
  const queue = getOfflineQueue();
  queue.push(book);
  localStorage.setItem('my_book_tracker_offline_queue', JSON.stringify(queue));
}

export function removeFromOfflineQueue(bookId) {
  const remaining = getOfflineQueue().filter((book) => book.id !== bookId);
  localStorage.setItem('my_book_tracker_offline_queue', JSON.stringify(remaining));
}

export function clearOfflineQueue() {
  localStorage.removeItem('my_book_tracker_offline_queue');
}
