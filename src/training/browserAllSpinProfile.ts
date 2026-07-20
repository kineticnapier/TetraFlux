import { setDefaultAllSpinProfileProvider } from "../ai/registry";
import {
  parseAllSpinWeightProfile,
  type AllSpinWeightProfileV1,
} from "./allspinWeights";

export const ALLSPIN_CHECKPOINT_STORAGE_KEY = "tetraflux:allSpinTrainingCheckpoint:v1";
export const ALLSPIN_PROFILE_STORAGE_KEY = "tetraflux:allSpinWeightProfile:v1";
export const ALLSPIN_PROFILE_CHANGED_EVENT = "tetraflux:allspin-profile-change";

const DB_NAME = "tetraflux-ai";
const DB_VERSION = 1;
const STORE_NAME = "profiles";
const PROFILE_RECORD_KEY = "allspin-derived-flat14-10-v1";

type StoredProfileRecord = {
  key: string;
  profile: AllSpinWeightProfileV1;
  savedAt: string;
};

function browserStorage(): Storage | null {
  try {
    return (globalThis as unknown as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function indexedDbApi(): IDBFactory | null {
  try {
    return (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB ?? null;
  } catch {
    return null;
  }
}

function openProfileDb(): Promise<IDBDatabase | null> {
  const api = indexedDbApi();
  if (!api) return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = api.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function readIndexedProfile(): Promise<AllSpinWeightProfileV1 | null> {
  const db = await openProfileDb();
  if (!db) return null;
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(PROFILE_RECORD_KEY);
      request.onsuccess = () => {
        try {
          const record = request.result as StoredProfileRecord | undefined;
          resolve(record?.profile ? parseAllSpinWeightProfile(record.profile) : null);
        } catch {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

async function writeIndexedProfile(profile: AllSpinWeightProfileV1): Promise<void> {
  const db = await openProfileDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({
        key: PROFILE_RECORD_KEY,
        profile,
        savedAt: new Date().toISOString(),
      } satisfies StoredProfileRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

async function deleteIndexedProfile(): Promise<void> {
  const db = await openProfileDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(PROFILE_RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

function dispatchChanged(profile: AllSpinWeightProfileV1 | null): void {
  try {
    globalThis.dispatchEvent?.(new CustomEvent(ALLSPIN_PROFILE_CHANGED_EVENT, { detail: profile }));
  } catch {
    // Workers and tests may not expose CustomEvent.
  }
}

export function readStoredAllSpinProfileSync(): AllSpinWeightProfileV1 | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(ALLSPIN_PROFILE_STORAGE_KEY);
    return raw ? parseAllSpinWeightProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function readStoredAllSpinProfile(): Promise<AllSpinWeightProfileV1 | null> {
  const local = readStoredAllSpinProfileSync();
  if (local) {
    void writeIndexedProfile(local);
    return local;
  }
  const indexed = await readIndexedProfile();
  if (indexed) {
    try {
      browserStorage()?.setItem(ALLSPIN_PROFILE_STORAGE_KEY, JSON.stringify(indexed));
    } catch {
      // IndexedDB is sufficient inside workers.
    }
  }
  return indexed;
}

export async function writeStoredAllSpinProfile(input: unknown): Promise<AllSpinWeightProfileV1> {
  const profile = parseAllSpinWeightProfile(input);
  try {
    browserStorage()?.setItem(ALLSPIN_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // IndexedDB remains available.
  }
  await writeIndexedProfile(profile);
  dispatchChanged(profile);
  return profile;
}

export async function clearStoredAllSpinProfile(): Promise<void> {
  try {
    browserStorage()?.removeItem(ALLSPIN_PROFILE_STORAGE_KEY);
  } catch {
    // no-op
  }
  await deleteIndexedProfile();
  dispatchChanged(null);
}

export function describeStoredAllSpinProfile(profile: AllSpinWeightProfileV1 | null): string {
  if (!profile) return "Learned All-Spin: none";
  const generation = profile.training?.generation;
  const fitness = profile.training?.fitness;
  const details = [
    generation === undefined ? "" : `generation=${generation}`,
    fitness === undefined ? "" : `fitness=${Number(fitness).toFixed(2)}`,
    `base=${profile.baseHeuristic.profileId}`,
  ].filter(Boolean).join(" ");
  return `Learned All-Spin: ${profile.profileId}${details ? ` (${details})` : ""}`;
}

setDefaultAllSpinProfileProvider(() => readStoredAllSpinProfileSync() ?? undefined);
