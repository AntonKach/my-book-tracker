// js/storage.js

export function loadBooks() {
  return JSON.parse(localStorage.getItem('my_book_tracker_books')) || [];
}

export function saveBooks(books) {
  localStorage.setItem('my_book_tracker_books', JSON.stringify(books));
}

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
