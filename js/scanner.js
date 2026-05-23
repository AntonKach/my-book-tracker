// js/scanner.js

export function processAndCompressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const image = new Image();
      image.onload = () => {
        const MAX_WIDTH = 300;
        const MAX_HEIGHT = 300;
        let width = image.width;
        let height = image.height;

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

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, width, height);

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

let html5QrcodeScanner = null;

export async function startBarcodeScanner(onSuccess, onScanError, readerId = "reader") {
  if (html5QrcodeScanner) {
    await stopBarcodeScanner();
  }

  if (typeof Html5QrcodeScanner === 'undefined') {
    throw new Error('Html5QrcodeScanner is not loaded.');
  }

  html5QrcodeScanner = new Html5QrcodeScanner(
    readerId,
    { 
      fps: 10,
      qrbox: { width: 250, height: 150 },
      aspectRatio: 1.0
    },
    /* verbose= */ false
  );
  
  html5QrcodeScanner.render(onSuccess, onScanError);
}

export async function stopBarcodeScanner(readerWrapper) {
  if (html5QrcodeScanner) {
    try {
      await html5QrcodeScanner.clear();
    } catch (err) {
      console.error('Failed to clear scanner:', err);
    }
    html5QrcodeScanner = null;
  }
  if (readerWrapper) {
    readerWrapper.classList.add('hidden');
  }
}
