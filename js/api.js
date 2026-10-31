import {normalizeISBN, classify, safeImage} from './domain.js';
async function json(url,options={}) {
 const response=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`Η υπηρεσία επέστρεψε σφάλμα ${response.status}.`);
 return response.json();
}
export async function resolveISBN(value) {
 const isbn=normalizeISBN(value);if(!isbn)throw new Error('Συμπληρώστε ISBN.');
 try {
  const data=await json(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  const exact=data.items?.find(item=>item.volumeInfo?.industryIdentifiers?.some(x=>{try{return normalizeISBN(x.identifier)===isbn}catch{return false}}));
  if(exact){const v=exact.volumeInfo;return {title:v.title,author:(v.authors||[]).join(', '),isbn,publisher:v.publisher||'',year:v.publishedDate||'',language:v.language||'',pageCount:v.pageCount||0,summary:v.description||'',coverUrl:safeImage((v.imageLinks?.thumbnail||'').replace(/^http:/,'https:')),...classify(v.categories?.[0]||'Άλλο'),sources:[{name:'Google Books',url:v.infoLink||'',fetchedAt:new Date().toISOString()}]};}
 }catch{ /* A second catalog may have this edition. */ }
 try{
  const data=await json(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`);const v=data[`ISBN:${isbn}`];
  if(v?.title)return {title:v.title,author:(v.authors||[]).map(a=>a.name).join(', '),isbn,publisher:(v.publishers||[]).map(p=>p.name).join(', '),year:v.publish_date||'',pageCount:v.number_of_pages||0,coverUrl:safeImage(v.cover?.medium),category:'Άλλο',sources:[{name:'Open Library',url:v.url||'',fetchedAt:new Date().toISOString()}]};
 }catch{ /* Manual entry always remains available. */ }
 throw new Error('Δεν βρέθηκε επιβεβαιωμένη έκδοση. Μπορείτε να καταχωρίσετε το βιβλίο χειροκίνητα.');
}
export async function fetchBookDetailsFromGemini(base64DataUrl,apiKey){
 if(!apiKey)throw new Error('Προσθέστε προσωπικό κλειδί Gemini στις ρυθμίσεις για αναγνώριση εξωφύλλου.');
 const categories=['Λογοτεχνία','Φιλοσοφία','Ιστορία','Επιστήμη','Μουσική','Τέχνη','Δίκαιο','Πρακτικά & προσωπική ανάπτυξη','Άλλο'];
 const data=await json('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',{
  method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify({contents:[{parts:[{text:`Extract only visible title, author and ISBN from this book cover. Preserve original spelling. Unknown values must be empty strings. Suggest a category from ${categories.join(', ')} and optional subcategory. Do NOT invent a synopsis or bibliographic facts. Return JSON keys title, author, isbn, category, subcategory, summary (empty).`},{inlineData:{mimeType:'image/jpeg',data:base64DataUrl.split(',')[1]}}]}],generationConfig:{responseMimeType:'application/json'}})
 });
 const value=JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text||'{}');
 if(!value.title)throw new Error('Δεν αναγνωρίστηκε τίτλος. Δοκιμάστε καθαρότερη φωτογραφία ή χειροκίνητη καταχώριση.');
 return {...value,summary:'',sources:[{name:'Gemini · πρόταση από εξώφυλλο, προς έλεγχο',url:'',fetchedAt:new Date().toISOString()}]};
}
