/* ==========================================================================
   MY BOOK TRACKER - CORE APPLICATION CONTROLLER (VANILLA JS)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // --- State Variables ---
  let books = JSON.parse(localStorage.getItem('my_book_tracker_books')) || [];
  let apiKey = localStorage.getItem('my_book_tracker_gemini_key') || '';
  let dbScriptUrl = localStorage.getItem('my_book_tracker_db_url') || '';
  let activeFilter = 'all';
  let searchQuery = '';
  let html5QrcodeScanner = null;

  // --- DOM Elements ---
  const keyConfigSection = document.getElementById('key-config-section');
  const toggleKeyBtn = document.getElementById('toggle-key-btn');
  const geminiKeyInput = document.getElementById('gemini-key-input');
  const toggleVisibleKeyBtn = document.getElementById('toggle-visible-key-btn');
  const dbScriptUrlInput = document.getElementById('db-script-url-input');
  const toggleVisibleDbUrlBtn = document.getElementById('toggle-visible-db-url-btn');
  const saveKeyBtn = document.getElementById('save-key-btn');
  const keyStatusMsg = document.getElementById('key-status-msg');
  
  const btnScanBarcode = document.getElementById('btn-scan-barcode');
  const readerWrapper = document.getElementById('reader-wrapper');
  const btnStopBarcode = document.getElementById('btn-stop-barcode');

  const cameraInput = document.getElementById('camera-input');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loaderTitle = document.getElementById('loader-title');
  const loaderSubtitle = document.getElementById('loader-subtitle');

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

  function initApp() {
    // Populate fields if they exist in localStorage
    if (apiKey) {
      geminiKeyInput.value = apiKey;
    }
    if (dbScriptUrl) {
      dbScriptUrlInput.value = dbScriptUrl;
    }

    if (apiKey) {
      showStatusMessage(keyStatusMsg, 'Οι ρυθμίσεις έχουν αποθηκευτεί τοπικά!', 'success');
    } else {
      // Prompt user visually by sliding down the config panel
      keyConfigSection.classList.remove('hidden');
      showStatusMessage(keyStatusMsg, 'Παρακαλώ εισάγετε ένα Gemini API Key.', 'error');
    }

    renderLibrary();
    setupEventListeners();
  }

  // --- Event Listeners Setup ---
  function setupEventListeners() {
    // API Key Section Toggling
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
      
      localStorage.setItem('my_book_tracker_gemini_key', apiKey);
      localStorage.setItem('my_book_tracker_db_url', dbScriptUrl);
      
      showStatusMessage(keyStatusMsg, 'Οι ρυθμίσεις αποθηκεύτηκαν επιτυχώς!', 'success');
      setTimeout(() => {
        keyConfigSection.classList.add('hidden');
      }, 1500);
    });

    // Camera Scan Triggering
    cameraInput.addEventListener('change', handleCameraCapture);

    // Barcode Scanning Buttons
    btnScanBarcode.addEventListener('click', () => {
      // Guard: Check API Key is set
      if (!apiKey) {
        alert('Παρακαλώ καταχωρήστε ένα έγκυρο Gemini API Key για να συνεχίσετε στη σάρωση Barcode.');
        keyConfigSection.classList.remove('hidden');
        keyConfigSection.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      
      // Show reader and start barcode scanning
      readerWrapper.classList.remove('hidden');
      startBarcodeScanner();
    });

    btnStopBarcode.addEventListener('click', stopBarcodeScanner);

    // Search and Filtering
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
  }

  // --- Camera Scan Handling ---
  async function handleCameraCapture(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Guard: Check API Key is set
    if (!apiKey) {
      alert('Παρακαλώ καταχωρήστε ένα έγκυρο Gemini API Key για να συνεχίσετε στη σάρωση.');
      keyConfigSection.classList.remove('hidden');
      keyConfigSection.scrollIntoView({ behavior: 'smooth' });
      // Reset input
      cameraInput.value = '';
      return;
    }

    try {
      showLoader('Φόρτωση εικόνας...', 'Προετοιμασία φωτογραφίας εξωφύλλου');

      // 1. Process and downscale cover image using canvas
      const compressedImageBase64 = await processAndCompressImage(file);
      
      // 2. Call Gemini Vision API
      showLoader('Ανάλυση εξωφύλλου...', 'Το Gemini AI διαβάζει τα στοιχεία');
      const bookMetadata = await fetchBookDetailsFromGemini(compressedImageBase64);

      // 3. Add to Collection
      const newBook = {
        id: 'book_' + Date.now(),
        title: bookMetadata.title || 'Άγνωστος Τίτλος',
        author: bookMetadata.author || 'Άγνωστος Συγγραφέας',
        category: bookMetadata.category || 'Γενικό',
        summary: bookMetadata.summary || 'Δεν βρέθηκε σύνοψη για αυτό το βιβλίο.',
        coverThumbnail: compressedImageBase64, // Compressed thumbnail saved directly to localStorage
        isRead: false,
        addedAt: new Date().toLocaleDateString('el-GR', { day: 'numeric', month: 'long', year: 'numeric' })
      };

      await saveBook(newBook);

      // Clear input
      cameraInput.value = '';
      hideLoader();
    } catch (error) {
      console.error('Scan handling failed:', error);
      hideLoader();
      alert('Παρουσιάστηκε σφάλμα κατά την επεξεργασία: ' + error.message);
      cameraInput.value = '';
    }
  }

  // --- Barcode Scanner Logic ---
  async function startBarcodeScanner() {
    // If an instance is already running, clean it up first
    if (html5QrcodeScanner) {
      await stopBarcodeScanner();
    }

    html5QrcodeScanner = new Html5QrcodeScanner(
      "reader",
      { 
        fps: 15,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128
        ],
        qrbox: (width, height) => {
          // Highly optimized wide and thin rectangle for 1D barcodes
          const boxWidth = Math.min(width * 0.85, 300);
          const boxHeight = Math.min(height * 0.3, 100);
          return { width: boxWidth, height: boxHeight };
        },
        aspectRatio: 1.0
      },
      /* verbose= */ false
    );
    
    html5QrcodeScanner.render(onScanSuccess, onScanError);
  }

  async function stopBarcodeScanner() {
    if (html5QrcodeScanner) {
      try {
        await html5QrcodeScanner.clear();
      } catch (err) {
        console.error('Failed to clear scanner:', err);
      }
      html5QrcodeScanner = null;
    }
    readerWrapper.classList.add('hidden');
  }

  function onScanError(errorMessage) {
    // Suppress scan spam errors in the console
  }

  async function onScanSuccess(decodedText, decodedResult) {
    console.log("Barcode detected:", decodedText);
    
    // Stop the scanner immediately
    await stopBarcodeScanner();

    // Show loading indicator
    showLoader('Αναζήτηση ISBN...', `Αναζήτηση στοιχείων για το barcode: ${decodedText}`);

    try {
      // 1. Fetch from Google Books API
      const googleBooksUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${decodedText.trim()}`;
      const response = await fetch(googleBooksUrl);
      if (!response.ok) {
        throw new Error(`Σφάλμα Google Books API: ${response.status}`);
      }
      
      const data = await response.json();
      if (!data.items || data.items.length === 0) {
        throw new Error(`Το βιβλίο με ISBN ${decodedText} δεν βρέθηκε στη βάση της Google Books API.`);
      }

      const volumeInfo = data.items[0].volumeInfo;
      const title = volumeInfo.title || 'Άγνωστος Τίτλος';
      const authors = volumeInfo.authors ? volumeInfo.authors.join(', ') : 'Άγνωστος Συγγραφέας';
      
      let coverUrl = volumeInfo.imageLinks?.thumbnail || volumeInfo.imageLinks?.smallThumbnail || '';
      if (coverUrl && coverUrl.startsWith('http://')) {
        coverUrl = coverUrl.replace('http://', 'https://');
      }

      // 2. Call Gemini API to get Greek summary and category
      showLoader('Ανάλυση AI...', 'Το Gemini AI δημιουργεί τη σύνοψη στα Ελληνικά');
      const geminiData = await fetchBookDetailsFromGeminiText(title, authors);

      // 3. Construct new book object
      const newBook = {
        id: 'book_' + Date.now(),
        title: geminiData.title || title,
        author: geminiData.author || authors,
        category: geminiData.category || 'Γενικό',
        summary: geminiData.summary || 'Δεν βρέθηκε σύνοψη.',
        coverThumbnail: coverUrl, // Using Google Books cover URL
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

  // --- HTML5 Canvas Resizing and Compression ---
  function processAndCompressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (readerEvent) => {
        const image = new Image();
        image.onload = () => {
          // Set maximum thumbnail bounds
          const MAX_WIDTH = 300;
          const MAX_HEIGHT = 300;
          let width = image.width;
          let height = image.height;

          // Scale maintaining aspect ratio
          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          // Create dynamic canvas
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(image, 0, 0, width, height);

          // Export as compressed JPEG (0.7 quality factor keeps it around ~10-15KB)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve(dataUrl);
        };
        image.onerror = (err) => reject(new Error('Αδυναμία φόρτωσης εικόνας.'));
        image.src = readerEvent.target.result;
      };
      reader.onerror = (err) => reject(new Error('Αδυναμία ανάγνωσης αρχείου.'));
      reader.readAsDataURL(file);
    });
  }

  // --- Gemini API REST Client ---
  async function fetchBookDetailsFromGemini(base64DataUrl) {
    // Remove the data URI scheme prefix ("data:image/jpeg;base64,") to get raw base64 data bytes
    const base64Data = base64DataUrl.split(',')[1];
    
    // Construct strict instructions forcing a structured JSON output
    const prompt = `Analyze this book cover image. Extract the book Title (in its original language, or translated to Greek/English as appropriate), the Author name, and a Category (choose one standard matching genre e.g. Fiction, Science, Biography, History, Business, Philosophy, Poetry, Art, or Self-Help in English). Write a high-quality 2-sentence summary of the book in Greek.

Return the result as a strict, single JSON object in the exact format shown below, with no markdown code block formatting, no triple backticks, and no wrapper text:
{
  "title": "extracted book title",
  "author": "extracted author name",
  "category": "extracted category",
  "summary": "exactly 2 sentences in Greek about the book's core premise"
}`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const requestBody = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const statusMsg = errorData.error?.message || `HTTP error! Status: ${response.status}`;
        throw new Error(`Σφάλμα Gemini API: ${statusMsg}`);
      }

      const responseData = await response.json();
      
      // Parse Gemini response text
      const candidates = responseData.candidates;
      if (!candidates || candidates.length === 0) {
        throw new Error('Δεν επιστράφηκε αποτέλεσμα από το μοντέλο Gemini AI.');
      }
      
      let rawText = candidates[0].content.parts[0].text.trim();
      
      // Clean up markdown block wrappers if model somehow returned backticks despite the instructions
      if (rawText.startsWith('```')) {
        rawText = rawText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      }

      try {
        const parsedData = JSON.parse(rawText);
        return parsedData;
      } catch (jsonErr) {
        console.warn('JSON parsing failed. Attempting fallback parse of text:', rawText);
        return fallbackRegexParse(rawText);
      }
    } catch (err) {
      console.error('REST Call failed:', err);
      throw err;
    }
  }

  async function fetchBookDetailsFromGeminiText(title, author) {
    const prompt = `I am logging a book titled '${title}' by '${author}'. Give me a 2-sentence summary in Greek and its genre/category. Return strictly a JSON object with keys: title, author, category, summary. Do not use markdown backticks.`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const requestBody = {
      contents: [
        {
          parts: [
            { text: prompt }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const statusMsg = errorData.error?.message || `HTTP error! Status: ${response.status}`;
      throw new Error(`Σφάλμα Gemini API: ${statusMsg}`);
    }

    const responseData = await response.json();
    const candidates = responseData.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error('Δεν επιστράφηκε αποτέλεσμα από το μοντέλο Gemini AI.');
    }
    
    let rawText = candidates[0].content.parts[0].text.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    }

    try {
      return JSON.parse(rawText);
    } catch (jsonErr) {
      console.warn('JSON parsing failed. Attempting fallback parse of text:', rawText);
      return fallbackRegexParse(rawText);
    }
  }

  // --- Fallback Regex Parser ---
  function fallbackRegexParse(text) {
    // Extreme fallback in case JSON structure is slightly off
    const titleMatch = text.match(/"title"\s*:\s*"([^"]+)"/);
    const authorMatch = text.match(/"author"\s*:\s*"([^"]+)"/);
    const categoryMatch = text.match(/"category"\s*:\s*"([^"]+)"/);
    const summaryMatch = text.match(/"summary"\s*:\s*"([^"]+)"/);

    return {
      title: titleMatch ? titleMatch[1] : 'Άγνωστο Βιβλίο',
      author: authorMatch ? authorMatch[1] : 'Άγνωστος Συγγραφέας',
      category: categoryMatch ? categoryMatch[1] : 'Γενικό',
      summary: summaryMatch ? summaryMatch[1] : 'Αδυναμία αυτόματης ανάλυσης της σύνοψης.'
    };
  }

  // --- Render Library Shelf ---
  function renderLibrary() {
    // 1. Filter books based on active view and search query
    const filteredBooks = books.filter((book) => {
      // Text Filter
      const matchesSearch = 
        book.title.toLowerCase().includes(searchQuery) ||
        book.author.toLowerCase().includes(searchQuery) ||
        book.category.toLowerCase().includes(searchQuery);

      if (!matchesSearch) return false;

      // Status Tabs Filter
      if (activeFilter === 'read') return book.isRead === true;
      if (activeFilter === 'reading') return book.isRead === false;
      return true; // 'all'
    });

    // 2. Clear Shelf Grid
    booksGrid.innerHTML = '';

    // 3. Toggle Empty State Layout
    if (filteredBooks.length === 0) {
      emptyState.classList.remove('hidden');
      booksGrid.classList.add('hidden');
    } else {
      emptyState.classList.add('hidden');
      booksGrid.classList.remove('hidden');

      // 4. Render Individual Book Cards
      filteredBooks.forEach((book, index) => {
        const bookCard = createBookCardElement(book, index);
        booksGrid.appendChild(bookCard);
      });
    }

    // 5. Update Statistics and count text
    updateStatsDashboard();
  }

  // --- Create Single Card DOM Element ---
  function createBookCardElement(book, index) {
    const card = document.createElement('article');
    card.className = 'book-card glass-panel';
    card.style.animationDelay = `${index * 0.05}s`;

    // Map Category standard strings to beautiful HSL theme classes
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

    // Attach Interactive Button Click Listeners directly inside card
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
    return ''; // Default badge
  }

  // --- Book Operations Actions ---
  function toggleBookReadStatus(bookId) {
    books = books.map((book) => {
      if (book.id === bookId) {
        return { ...book, isRead: !book.isRead };
      }
      return book;
    });
    saveBooksToStorage();
    renderLibrary();
  }

  function deleteBookFromCollection(bookId, bookTitle) {
    if (confirm(`Είστε σίγουροι ότι θέλετε να διαγράψετε το βιβλίο «${bookTitle}» από τη συλλογή σας;`)) {
      books = books.filter((book) => book.id !== bookId);
      saveBooksToStorage();
      renderLibrary();
    }
  }

  function saveBooksToStorage() {
    localStorage.setItem('my_book_tracker_books', JSON.stringify(books));
  }

  async function saveBook(bookData) {
    // 1. Save to local storage books array
    books.unshift(bookData);
    saveBooksToStorage();
    renderLibrary();

    // 2. Background Sync with Google Apps Script if URL is valid
    if (dbScriptUrl && dbScriptUrl.trim() !== '' && dbScriptUrl.startsWith('https://script.google.com')) {
      console.log('[Database Sync] Sending book to Google Script:', bookData.title);
      try {
        await fetch(dbScriptUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: {
            "Content-Type": "text/plain;charset=utf-8"
          },
          body: JSON.stringify(bookData)
        });

        console.log('[Database Sync] Successfully synced book (opaque response):', bookData.title);
      } catch (error) {
        console.error('[Database Sync] Failed to sync book:', bookData.title, error);
      }
    }
  }

  // --- Stats Dashboard Computations ---
  function updateStatsDashboard() {
    statsTotal.textContent = books.length;
    
    const readCount = books.filter((book) => book.isRead).length;
    statsRead.textContent = readCount;

    // Unique Categories
    const categoriesSet = new Set(books.map((book) => book.category.trim().toLowerCase()));
    statsCategories.textContent = books.length > 0 ? categoriesSet.size : 0;

    // Update shelf header count description label
    shelfCountText.textContent = `${books.length} ${books.length === 1 ? 'βιβλίο' : 'βιβλία'}`;
  }

  // --- Helper UI Utilities ---
  function showStatusMessage(element, text, type) {
    element.textContent = text;
    element.className = 'status-message'; // reset
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
