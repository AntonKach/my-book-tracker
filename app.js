/* ==========================================================================
   MY BOOK TRACKER - THIN CLIENT ES6 CONTROLLER (MODULE)
   ========================================================================== */

import { loadCredentials, saveCredentials, getOfflineQueue, addToOfflineQueue, removeFromOfflineQueue } from './js/storage.js';
import { fetchBookDetailsFromGemini, fetchBookDetailsFromGeminiText, resolveISBN, syncBookToGoogleScript } from './js/api.js';
import { processAndCompressImage, startBarcodeScanner, stopBarcodeScanner } from './js/scanner.js';

document.addEventListener('DOMContentLoaded', () => {
  // --- State Variables ---
  let apiKey = '';
  let dbScriptUrl = '';

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

    // Set up all DOM event listeners
    setupEventListeners();

    // Check and sync any offline-queued books on startup
    if (navigator.onLine && dbScriptUrl) {
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
        coverThumbnail: '', // Removed base64 cover saving for pure Thin Client
        isbn: '',
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

  // --- Sync / Save Action ---
  async function saveBook(bookData) {
    if (!dbScriptUrl) {
      alert(`Το βιβλίο «${bookData.title}» αναγνωρίστηκε, αλλά οι ρυθμίσεις της βάσης (Google Script URL) δεν έχουν καθοριστεί!`);
      return;
    }

    if (navigator.onLine) {
      try {
        await syncBookToGoogleScript(bookData, dbScriptUrl);
        alert(`Το βιβλίο «${bookData.title}» στάλθηκε στη βάση!`);
        return;
      } catch (error) {
        console.error('[Database Sync] Dispatch failed; queueing locally.', error);
      }
    }

    addToOfflineQueue(bookData);
    alert(`Το βιβλίο «${bookData.title}» αποθηκεύτηκε τοπικά και θα συγχρονιστεί αυτόματα όταν είναι διαθέσιμη η σύνδεση.`);
  }

  async function syncOfflineBooks() {
    if (!navigator.onLine || !dbScriptUrl) return;

    const offlineBooks = getOfflineQueue();
    if (offlineBooks.length === 0) return;

    console.log(`[Offline Sync] Syncing ${offlineBooks.length} queued books...`);
    showStatusMessage(keyStatusMsg, `Συγχρονισμός ${offlineBooks.length} βιβλίων...`, 'success');

    let syncedCount = 0;

    for (const book of offlineBooks) {
      try {
        await syncBookToGoogleScript(book, dbScriptUrl);
        removeFromOfflineQueue(book.id);
        syncedCount += 1;
      } catch (error) {
        console.error('[Offline Sync] Keeping failed item in queue:', book.id, error);
      }
    }

    const remainingCount = getOfflineQueue().length;

    if (remainingCount === 0) {
      showStatusMessage(keyStatusMsg, `Ολοκληρώθηκε ο συγχρονισμός ${syncedCount} βιβλίων!`, 'success');
    } else {
      showStatusMessage(
        keyStatusMsg,
        `Συγχρονίστηκαν ${syncedCount}. Παραμένουν ${remainingCount} βιβλία στην ουρά.`,
        'error'
      );
    }

    setTimeout(() => {
      keyStatusMsg.textContent = '';
      keyStatusMsg.className = 'status-message';
    }, 4000);
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
