/**
 * セッション（録音 Blob 込み）を IndexedDB に保存する。
 * 端末の外には一切出さない。
 */

const DB_NAME = '432recorder';
const DB_VERSION = 1;
const STORE = 'sessions';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result;
    try {
      result = fn(store);
    } catch (err) {
      transaction.abort();
      reject(err);
      return;
    }
    transaction.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

export function putSession(session) {
  return tx('readwrite', store => store.put(session));
}

export function getSession(id) {
  return tx('readonly', store => store.get(id));
}

export function deleteSession(id) {
  return tx('readwrite', store => store.delete(id));
}

export function clearSessions() {
  return tx('readwrite', store => store.clear());
}

/** 新しい順にすべてのセッションを返す。 */
export async function listSessions() {
  const all = await tx('readonly', store => store.getAll());
  return (all || []).sort((a, b) => b.createdAt - a.createdAt);
}

export async function estimateUsage() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage } = await navigator.storage.estimate();
    return usage ?? null;
  } catch {
    return null;
  }
}
