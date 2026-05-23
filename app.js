/* ==========================================================================
   MY BOOK TRACKER - MAIN ES6 CONTROLLER (MODULE)
   ========================================================================== */

import { loadBooks, saveBooks, loadCredentials, saveCredentials, getOfflineQueue, addToOfflineQueue, clearOfflineQueue } from './js/storage.js';
import { fetchBookDetailsFromGemini, fetchBookDetailsFromGeminiText, resolveISBN, syncBookToGoogleScript } from './js/api.js';
import { processAndCompressImage, startBarcodeScanner, stopBarcodeScanner } from './js/scanner.js';

document.addEventListener('DOMContentLoaded', () => {
  // --- State Variables ---
  let books = loadBooks();
  let { apiKey, dbScriptUrl } = loadCredentials();
  let activeFilter = 'all';
  let searchQuery = '';

  // --- DOM Elements ---
  const keyConfigSection = document.getElementById('key-config-section');
  const toggleKeyBtn = document.getElementById('toggle-key-btn');
  const geminiKeyInput = document.getElementById('gemini-key-input');
  const toggleVisibleKeyBtn = document.getElementById('toggle-visible-key-btn');
  const dbScriptUrlInput = document.getElementById('db-script-url-input');
  const toggleVisibleDbUrlBtn = document.getElementById('toggle-visible-db-url-btn');
  const saveKeyBtn = document.getElementById('save-key-btn');
  const keyStatusMsg = document.getElementById('key-status-msg');

  const cameraInput = document.getElementById('camera-input');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loaderTitle = document.getElementById('loader-title');
  const loaderSubtitle = document.getElementById('loader-subtitle');

  const btnScanBarcode = document.getElementById('btn-scan-barcode');
  const readerWrapper = document.getElementById('reader-wrapper');
  const btnStopBarcode = document.getElementById('btn-stop-barcode');

  const searchInput = document.getElementById('search-input');
  const filterTabs = document.querySelectorAll('.filter-tab');
  const booksGrid = document.getElementById('books-grid');
  const emptyState = document.getElementById('empty-state');
  const shelfCountText = document.getElementById('shelf-count-text');

  // Stats Counters
  const statsTotal = document.getElementById('stats-total');
  const statsRead = document.getElementById('stats-read');
  const statsCategories = document.getElementById('stats-categories');

  // --- Service Worker Registration ---
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then((reg) => console.log('[PWA] Service Worker registered successfully', reg.scope))
        .catch((err) => console.error('[PWA] Service Worker registration failed', err));
    });
  }

  // --- Initialize App State ---
  initApp();

  /**
   * Initializes the application state upon startup.
   * Automatically pre-fills deployment keys from localStorage (via js/storage.js)
   * and configures the active state so the user can scan/sync immediately.
   */
  function initApp() {
    // 1. Immediately fetch saved credentials from the storage module
    const savedCredentials = loadCredentials();
    apiKey = savedCredentials.apiKey || '';
    dbScriptUrl = savedCredentials.dbScriptUrl || '';

    // 2. UI Auto-Fill: If saved credentials exist, pre-fill their input values
    if (apiKey) {
      geminiKeyInput.value = apiKey;
    }
    if (dbScriptUrl) {
      dbScriptUrlInput.value = dbScriptUrl;
    }

    // 3. Active State: Configure UI messaging and state immediately upon boot
    if (apiKey) {
      showStatusMessage(keyStatusMsg, 'Οι ρυθμίσεις έχουν αποθηκευτεί τοπικά!', 'success');
    } else {
      // If keys are missing, reveal the configuration section to guide the user
      keyConfigSection.classList.remove('hidden');
      showStatusMessage(keyStatusMsg, 'Παρακαλώ εισάγετε ένα Gemini API Key.', 'error');
    }

    // Render the library shelf
    renderLibrary();
    
    // Set up all DOM event listeners
    setupEventListeners();

    // Check and sync any offline-queued books on startup
    if (navigator.onLine) {
      syncOfflineBooks();
    }
  }

  // --- Event Listeners Setup ---
  function setupEventListeners() {
    toggleKeyBtn.addEventListener('click', () => {
      keyConfigSection.classList.toggle('hidden');
    });

    toggleVisibleKeyBtn.addEventListener('click', () => {
      const type = geminiKeyInput.type === 'password' ? 'text' : 'password';
      geminiKeyInput.type = type;
      toggleVisibleKeyBtn.querySelector('span').textContent = type === 'password' ? 'visibility' : 'visibility_off';
    });

    toggleVisibleDbUrlBtn.addEventListener('click', () => {
      const type = dbScriptUrlInput.type === 'password' ? 'text' : 'password';
      dbScriptUrlInput.type = type;
      toggleVisibleDbUrlBtn.querySelector('span').textContent = type === 'password' ? 'visibility' : 'visibility_off';
    });

    saveKeyBtn.addEventListener('click', () => {
      const keyVal = geminiKeyInput.value.trim();
      const urlVal = dbScriptUrlInput.value.trim();
      
      if (!keyVal) {
        showStatusMessage(keyStatusMsg, 'Το κλειδί Gemini δεν μπορεί να είναι κενό!', 'error');
        return;
      }
      
      apiKey = keyVal;
      dbScriptUrl = urlVal;
      
      saveCredentials(apiKey, dbScriptUrl);
      
      showStatusMessage(keyStatusMsg, 'Οι ρυθμίσεις αποθηκεύτηκαν επιτυχώς!', 'success');
      setTimeout(() => {
        keyConfigSection.classList.add('hidden');
      }, 1500);
    });

    cameraInput.addEventListener('change', handleCameraCapture);

    btnScanBarcode.addEventListener('click', () => {
      if (!apiKey) {
        alert('Παρακαλώ καταχωρήστε ένα έγκυρο Gemini API Key για να συνεχίσετε στη σάρωση Barcode.');
        keyConfigSection.classList.remove('hidden');
        keyConfigSection.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      
      readerWrapper.classList.remove('hidden');
      startBarcodeScanner(onScanSuccess, onScanError);
    });

    btnStopBarcode.addEventListener('click', () => {
      stopBarcodeScanner(readerWrapper);
    });

    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderLibrary();
    });

    filterTabs.forEach((tab) => {
      tab.addEventListener('click', (e) => {
        filterTabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        activeFilter = tab.dataset.filter;
        renderLibrary();
      });
    });

    window.addEventListener('online', syncOfflineBooks);
  }

  // --- Camera Scan Handling ---
  async function handleCameraCapture(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!apiKey) {
      alert('Παρακαλώ καταχωρήστε ένα έγκυρο Gemini API Key για να συνεχίσετε στη σάρωση.');
      keyConfigSection.classList.remove('hidden');
      keyConfigSection.scrollIntoView({ behavior: 'smooth' });
      cameraInput.value = '';
      return;
    }

    try {
      showLoader('Φόρτωση εικόνας...', 'Προετοιμασία φωτογραφίας εξωφύλλου');
      const compressedImageBase64 = await processAndCompressImage(file);
      
      showLoader('Ανάλυση εξωφύλλου...', 'Το Gemini AI διαβάζει τα στοιχεία');
      const bookMetadata = await fetchBookDetailsFromGemini(compressedImageBase64, apiKey);

      const newBook = {
        id: 'book_' + Date.now(),
        title: bookMetadata.title || 'Άγνωστος Τίτλος',
        author: bookMetadata.author || 'Άγνωστος Συγγραφέας',
        category: bookMetadata.category || 'Γενικό',
        summary: bookMetadata.summary || 'Δεν βρέθηκε σύνοψη για αυτό το βιβλίο.',
        coverThumbnail: compressedImageBase64,
        isbn: '',
        isRead: false,
        addedAt: new Date().toLocaleDateString('el-GR', { day: 'numeric', month: 'long', year: 'numeric' })
      };

      await saveBook(newBook);

      cameraInput.value = '';
      hideLoader();
    } catch (error) {
      console.error('Scan handling failed:', error);
      hideLoader();
      alert('Παρουσιάστηκε σφάλμα κατά την επεξεργασία: ' + error.message);
      cameraInput.value = '';
    }
  }

  // --- Barcode Success/Error Callbacks ---
  async function onScanSuccess(decodedText, decodedResult) {
    console.log("Barcode detected:", decodedText);
    
    await stopBarcodeScanner(readerWrapper);
    showLoader('Αναζήτηση ISBN...', `Αναζήτηση στοιχείων για το barcode: ${decodedText}`);

    try {
      // 1. Resolve ISBN via 3-step fallback chain
      const { title, authors, coverUrl, isbn } = await resolveISBN(decodedText);

      // 2. Call Gemini API to get Greek summary and category
      showLoader('Ανάλυση AI...', 'Το Gemini AI δημιουργεί τη σύνοψη στα Ελληνικά');
      const geminiData = await fetchBookDetailsFromGeminiText(title, authors, apiKey);

      // 3. Construct new book object
      const newBook = {
        id: 'book_' + Date.now(),
        title: geminiData.title || title,
        author: geminiData.author || authors,
        category: geminiData.category || 'Γενικό',
        summary: geminiData.summary || 'Δεν βρέθηκε σύνοψη.',
        coverThumbnail: coverUrl,
        isbn: isbn || decodedText.trim(),
        isRead: false,
        addedAt: new Date().toLocaleDateString('el-GR', { day: 'numeric', month: 'long', year: 'numeric' })
      };

      await saveBook(newBook);
      hideLoader();
    } catch (err) {
      console.error('Barcode processing failed:', err);
      hideLoader();
      alert('Σφάλμα κατά την επεξεργασία του Barcode: ' + err.message);
    }
  }

  function onScanError(errorMessage) {
    // Suppress console spam
  }

  // --- Render Library Shelf ---
  function renderLibrary() {
    const filteredBooks = books.filter((book) => {
      const matchesSearch = 
        book.title.toLowerCase().includes(searchQuery) ||
        book.author.toLowerCase().includes(searchQuery) ||
        book.category.toLowerCase().includes(searchQuery);

      if (!matchesSearch) return false;

      if (activeFilter === 'read') return book.isRead === true;
      if (activeFilter === 'reading') return book.isRead === false;
      return true; // 'all'
    });

    booksGrid.innerHTML = '';

    if (filteredBooks.length === 0) {
      emptyState.classList.remove('hidden');
      booksGrid.classList.add('hidden');
    } else {
      emptyState.classList.add('hidden');
      booksGrid.classList.remove('hidden');

      filteredBooks.forEach((book, index) => {
        const bookCard = createBookCardElement(book, index);
        booksGrid.appendChild(bookCard);
      });
    }

    updateStatsDashboard();
  }

  // --- Create Single Card DOM Element ---
  function createBookCardElement(book, index) {
    const card = document.createElement('article');
    card.className = 'book-card glass-panel';
    card.style.animationDelay = `${index * 0.05}s`;

    const catClass = getCategoryStyleClass(book.category);

    card.innerHTML = `
      <div class="book-cover-wrapper">
        ${book.coverThumbnail ? 
          `<img src="${book.coverThumbnail}" class="book-cover" alt="Εξώφυλλο του ${book.title}" loading="lazy">` : 
          `<div class="book-cover-placeholder">
            <span class="material-icons-round">book</span>
            <p>${book.title.substring(0, 20)}</p>
           </div>`
        }
      </div>
      <div class="book-info">
        <div class="book-category-row">
          <span class="category-badge ${catClass}">${book.category}</span>
        </div>
        <h3 class="book-title" title="${book.title}">${book.title}</h3>
        <p class="book-author">${book.author}</p>
        <p class="book-summary">${book.summary}</p>
        
        <div class="book-card-actions">
          <span class="book-date">${book.addedAt}</span>
          <div class="card-action-buttons">
            <button class="card-btn card-btn-read ${book.isRead ? 'read' : ''}" data-id="${book.id}">
              <span class="material-icons-round">${book.isRead ? 'task_alt' : 'radio_button_unchecked'}</span>
              <span>${book.isRead ? 'Διαβάστηκε' : 'Προς Ανάγνωση'}</span>
            </button>
            <button class="card-btn card-btn-delete" data-id="${book.id}" aria-label="Διαγραφή ${book.title}">
              <span class="material-icons-round">delete_outline</span>
            </button>
          </div>
        </div>
      </div>
    `;

    const readToggleBtn = card.querySelector('.card-btn-read');
    readToggleBtn.addEventListener('click', () => {
      toggleBookReadStatus(book.id);
    });

    const deleteBtn = card.querySelector('.card-btn-delete');
    deleteBtn.addEventListener('click', () => {
      deleteBookFromCollection(book.id, book.title);
    });

    return card;
  }

  // --- Dynamic Category Style Mapper ---
  function getCategoryStyleClass(category) {
    const cat = category.toLowerCase();
    if (cat.includes('fiction') || cat.includes('λογοτεχνία') || cat.includes('μυθιστόρημα')) return 'fiction';
    if (cat.includes('science') || cat.includes('επιστήμη') || cat.includes('tech') || cat.includes('engineering')) return 'science';
    if (cat.includes('history') || cat.includes('ιστορία') || cat.includes('biography') || cat.includes('βιογραφία')) return 'history';
    if (cat.includes('business') || cat.includes('οικονομία') || cat.includes('finance') || cat.includes('management') || cat.includes('self')) return 'business';
    if (cat.includes('philosophy') || cat.includes('φιλοσοφία') || cat.includes('poetry') || cat.includes('ποίηση') || cat.includes('art')) return 'philosophy';
    return '';
  }

  // --- Book Operations Actions ---
  function toggleBookReadStatus(bookId) {
    books = books.map((book) => {
      if (book.id === bookId) {
        return { ...book, isRead: !book.isRead };
      }
      return book;
    });
    saveBooks(books);
    renderLibrary();
  }

  function deleteBookFromCollection(bookId, bookTitle) {
    if (confirm(`Είστε σίγουροι ότι θέλετε να διαγράψετε το βιβλίο «${bookTitle}» από τη συλλογή σας;`)) {
      books = books.filter((book) => book.id !== bookId);
      saveBooks(books);
      renderLibrary();
    }
  }

  async function saveBook(bookData) {
    books.unshift(bookData);
    saveBooks(books);
    renderLibrary();

    if (dbScriptUrl) {
      if (navigator.onLine) {
        await syncBookToGoogleScript(bookData, dbScriptUrl);
      } else {
        addToOfflineQueue(bookData);
        alert(`Η εφαρμογή είναι εκτός σύνδεσης! Το βιβλίο «${bookData.title}» αποθηκεύτηκε τοπικά και θα συγχρονιστεί αυτόματα μόλις επανέλθει το διαδίκτυο.`);
      }
    }
  }

  async function syncOfflineBooks() {
    if (!navigator.onLine) return;
    
    const offlineBooks = getOfflineQueue();
    if (offlineBooks.length === 0) return;

    console.log(`[Offline Sync] Internet connection restored! Syncing ${offlineBooks.length} books...`);
    showStatusMessage(keyStatusMsg, `Σύνδεση αποκαταστάθηκε! Συγχρονισμός ${offlineBooks.length} βιβλίων...`, 'success');

    const syncPromises = offlineBooks.map(book => syncBookToGoogleScript(book, dbScriptUrl));
    await Promise.all(syncPromises);

    clearOfflineQueue();
    console.log('[Offline Sync] All offline books have been synced successfully.');
    showStatusMessage(keyStatusMsg, 'Ολοκληρώθηκε ο συγχρονισμός των εκτός σύνδεσης βιβλίων!', 'success');
    
    setTimeout(() => {
      keyStatusMsg.textContent = '';
      keyStatusMsg.className = 'status-message';
    }, 3000);
  }

  // --- Stats Dashboard Computations ---
  function updateStatsDashboard() {
    statsTotal.textContent = books.length;
    
    const readCount = books.filter((book) => book.isRead).length;
    statsRead.textContent = readCount;

    const categoriesSet = new Set(books.map((book) => book.category.trim().toLowerCase()));
    statsCategories.textContent = books.length > 0 ? categoriesSet.size : 0;

    shelfCountText.textContent = `${books.length} ${books.length === 1 ? 'βιβλίο' : 'βιβλία'}`;
  }

  // --- Helper UI Utilities ---
  function showStatusMessage(element, text, type) {
    element.textContent = text;
    element.className = 'status-message';
    element.classList.add(type === 'success' ? 'status-success' : 'status-error');
  }

  function showLoader(title, subtitle) {
    loaderTitle.textContent = title;
    loaderSubtitle.textContent = subtitle;
    loadingOverlay.classList.remove('hidden');
    loadingOverlay.setAttribute('aria-hidden', 'false');
  }

  function hideLoader() {
    loadingOverlay.classList.add('hidden');
    loadingOverlay.setAttribute('aria-hidden', 'true');
  }
});
