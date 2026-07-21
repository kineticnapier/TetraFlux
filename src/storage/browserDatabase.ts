export const TETRAFLUX_DB_NAME = "tetraflux-ai";
export const TETRAFLUX_DB_VERSION = 2;
export const PROFILE_STORE_NAME = "profiles";
export const MODEL_STORE_NAME = "models";
export const META_STORE_NAME = "meta";

function indexedDbApi(): IDBFactory | null {
  try {
    return (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB ?? null;
  } catch {
    return null;
  }
}

export function openTetrafluxDb(): Promise<IDBDatabase | null> {
  const api = indexedDbApi();
  if (!api) return Promise.resolve(null);

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = api.open(TETRAFLUX_DB_NAME, TETRAFLUX_DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROFILE_STORE_NAME)) {
        db.createObjectStore(PROFILE_STORE_NAME, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(MODEL_STORE_NAME)) {
        const models = db.createObjectStore(MODEL_STORE_NAME, { keyPath: "modelId" });
        models.createIndex("family", "family", { unique: false });
        models.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function readDbRecord<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
  const db = await openTetrafluxDb();
  if (!db) return null;
  try {
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export async function readAllDbRecords<T>(storeName: string): Promise<T[]> {
  const db = await openTetrafluxDb();
  if (!db) return [];
  try {
    return await new Promise<T[]>((resolve) => {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result as T[] : []);
      request.onerror = () => resolve([]);
      tx.onabort = () => resolve([]);
    });
  } finally {
    db.close();
  }
}

export async function writeDbRecord(storeName: string, value: unknown): Promise<boolean> {
  const db = await openTetrafluxDb();
  if (!db) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } finally {
    db.close();
  }
}

export async function writeDbRecords(storeName: string, values: unknown[]): Promise<boolean> {
  const db = await openTetrafluxDb();
  if (!db) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      for (const value of values) store.put(value);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } finally {
    db.close();
  }
}

export async function deleteDbRecord(storeName: string, key: IDBValidKey): Promise<boolean> {
  const db = await openTetrafluxDb();
  if (!db) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } finally {
    db.close();
  }
}

export async function clearDbStore(storeName: string): Promise<boolean> {
  const db = await openTetrafluxDb();
  if (!db) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } finally {
    db.close();
  }
}
