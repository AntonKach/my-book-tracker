// js/api.js

export async function fetchBookDetailsFromGemini(base64DataUrl, apiKey) {
  const base64Data = base64DataUrl.split(',')[1];
  
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

export async function fetchBookDetailsFromGeminiText(title, author, apiKey) {
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

export function fallbackRegexParse(text) {
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

export async function syncBookToGoogleScript(bookData, dbScriptUrl) {
  let endpoint;
  try {
    endpoint = new URL(dbScriptUrl);
  } catch {
    throw new Error('Το Google Script URL δεν είναι έγκυρο.');
  }

  const isGoogleWebApp =
    endpoint.protocol === 'https:' &&
    endpoint.hostname === 'script.google.com' &&
    /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint.pathname);

  if (!isGoogleWebApp) {
    throw new Error('Το URL πρέπει να είναι έγκυρο Google Apps Script Web App.');
  }

  console.log('[Database Sync] Sending book to Google Script:', bookData.title);

  try {
    // Apps Script web apps commonly require no-cors from a static client.
    // A resolved opaque response confirms dispatch, but cannot expose server status.
    await fetch(endpoint.toString(), {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(bookData)
    });

    return { dispatched: true, verified: false };
  } catch (error) {
    console.error('[Database Sync] Failed to dispatch book:', bookData.title, error);
    throw new Error('Η αποστολή στη βάση απέτυχε. Το βιβλίο θα παραμείνει στην ουρά συγχρονισμού.');
  }
}

export async function resolveISBN(decodedText) {
  let title = '';
  let authors = '';
  let coverUrl = '';
  let success = false;
  let errorLog = [];

  // --- Step 1: Attempt Google Books API ---
  try {
    console.log('[ISBN Search] Attempting Google Books API...');
    const googleBooksUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${decodedText.trim()}`;
    const response = await fetch(googleBooksUrl);
    
    if (!response.ok) {
      throw new Error(`Google Books HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.items || data.items.length === 0) {
      throw new Error('Google Books returned 0 results.');
    }

    const volumeInfo = data.items[0].volumeInfo;
    title = volumeInfo.title || 'Άγνωστος Τίτλος';
    authors = volumeInfo.authors ? volumeInfo.authors.join(', ') : 'Άγνωστος Συγγραφέας';
    
    let rawCover = volumeInfo.imageLinks?.thumbnail || volumeInfo.imageLinks?.smallThumbnail || '';
    if (rawCover && rawCover.startsWith('http://')) {
      coverUrl = rawCover.replace('http://', 'https://');
    } else {
      coverUrl = rawCover;
    }
    
    success = true;
    console.log('[ISBN Search] Successfully fetched from Google Books:', title);
  } catch (googleErr) {
    console.warn('[ISBN Search] Google Books API failed or rate-limited:', googleErr.message);
    errorLog.push(`Google Books: ${googleErr.message}`);
  }

  // --- Step 2: Scrape isbnsearch.org via CORS proxy ---
  if (!success) {
    try {
      console.log('[ISBN Search] Falling back to scraping isbnsearch.org via CORS proxy...');
      const scrapeUrl = `https://corsproxy.io/?` + encodeURIComponent(`https://isbnsearch.org/isbn/${decodedText.trim()}`);
      const response = await fetch(scrapeUrl);
      
      if (!response.ok) {
        throw new Error(`Scrape HTTP Error: ${response.status}`);
      }

      const htmlText = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');

      const h1 = doc.querySelector('h1');
      const scrapedTitle = h1 ? h1.textContent.trim() : '';

      let scrapedAuthor = '';
      const strongs = doc.querySelectorAll('strong');
      for (const strong of strongs) {
        if (strong.textContent.trim().toLowerCase().includes('author')) {
          const parentParagraph = strong.parentElement;
          if (parentParagraph) {
            scrapedAuthor = parentParagraph.textContent.replace(strong.textContent, '').trim();
            break;
          }
        }
      }

      if (!scrapedTitle || !scrapedAuthor || scrapedTitle.toLowerCase().includes('not found') || scrapedTitle.toLowerCase().includes('no results')) {
        throw new Error('Could not parse valid book Title or Author from isbnsearch.org.');
      }

      title = scrapedTitle;
      authors = scrapedAuthor;

      const img = doc.querySelector('.image img') || doc.querySelector('img');
      let rawCover = img ? img.getAttribute('src') : '';
      if (rawCover) {
        if (rawCover.startsWith('http://')) {
          coverUrl = rawCover.replace('http://', 'https://');
        } else if (rawCover.startsWith('//')) {
          coverUrl = 'https:' + rawCover;
        } else {
          coverUrl = rawCover;
        }
      }

      success = true;
      console.log('[ISBN Search] Successfully scraped from isbnsearch.org:', title);
    } catch (scrapeErr) {
      console.warn('[ISBN Search] Scraping isbnsearch.org failed:', scrapeErr.message);
      errorLog.push(`ISBN Search Scraper: ${scrapeErr.message}`);
    }
  }

  // --- Step 3: Fallback to Open Library API ---
  if (!success) {
    try {
      console.log('[ISBN Search] Falling back to Open Library API...');
      const openLibraryUrl = `https://openlibrary.org/search.json?q=${decodedText.trim()}`;
      const response = await fetch(openLibraryUrl);
      
      if (!response.ok) {
        throw new Error(`Open Library HTTP Error: ${response.status}`);
      }

      const data = await response.json();
      if (!data.docs || data.docs.length === 0) {
        throw new Error('Open Library returned 0 results.');
      }

      const doc = data.docs[0];
      title = doc.title || 'Άγνωστος Τίτλος';
      authors = doc.author_name ? doc.author_name.join(', ') : 'Άγνωστος Συγγραφέας';
      
      if (doc.cover_i) {
        coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
      }
      
      success = true;
      console.log('[ISBN Search] Successfully fetched from Open Library:', title);
    } catch (openLibraryErr) {
      console.error('[ISBN Search] Open Library API also failed:', openLibraryErr.message);
      errorLog.push(`Open Library: ${openLibraryErr.message}`);
    }
  }

  if (!success) {
    throw new Error(`Το βιβλίο με ISBN ${decodedText} δεν βρέθηκε στη Google Books, την IsbnSearch ή την Open Library.\nΣφάλματα: ${errorLog.join(', ')}`);
  }

  return { title, authors, coverUrl, isbn: decodedText.trim() };
}
