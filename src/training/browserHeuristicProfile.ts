import { setDefaultLearnedProfileProvider } from "../ai/registry";
import {
  parseHeuristicWeightProfile,
  type HeuristicWeightProfileV1,
} from "./heuristicWeights";

export const HEURISTIC_CHECKPOINT_STORAGE_KEY = "tetraflux:heuristicTrainingCheckpoint:v1";
export const HEURISTIC_PROFILE_STORAGE_KEY = "tetraflux:heuristicWeightProfile:v1";
export const HEURISTIC_PROFILE_CHANGED_EVENT = "tetraflux:heuristic-profile-change";

const DB_NAME = "tetraflux-ai";
const DB_VERSION = 1;
const STORE_NAME = "profiles";
const PROFILE_RECORD_KEY = "heuristic-flat-14-v1";

type StoredProfileRecord = {
  key: string;
  profile: HeuristicWeightProfileV1;
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

async function readIndexedProfile(): Promise<HeuristicWeightProfileV1 | null> {
  const db = await openProfileDb();
  if (!db) return null;

  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(PROFILE_RECORD_KEY);
      request.onsuccess = () => {
        try {
          const record = request.result as StoredProfileRecord | undefined;
          resolve(record?.profile ? parseHeuristicWeightProfile(record.profile) : null);
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

async function writeIndexedProfile(profile: HeuristicWeightProfileV1): Promise<void> {
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

function dispatchProfileChanged(profile: HeuristicWeightProfileV1 | null): void {
  try {
    globalThis.dispatchEvent?.(new CustomEvent(HEURISTIC_PROFILE_CHANGED_EVENT, { detail: profile }));
  } catch {
    // Workers and non-browser tests may not expose CustomEvent.
  }
}

export function readStoredHeuristicProfileSync(): HeuristicWeightProfileV1 | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(HEURISTIC_PROFILE_STORAGE_KEY);
    return raw ? parseHeuristicWeightProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function readStoredHeuristicProfile(): Promise<HeuristicWeightProfileV1 | null> {
  const local = readStoredHeuristicProfileSync();
  if (local) {
    void writeIndexedProfile(local);
    return local;
  }

  const indexed = await readIndexedProfile();
  if (indexed) {
    try {
      browserStorage()?.setItem(HEURISTIC_PROFILE_STORAGE_KEY, JSON.stringify(indexed));
    } catch {
      // A worker cannot access localStorage; IndexedDB is sufficient there.
    }
  }
  return indexed;
}

export async function writeStoredHeuristicProfile(profileInput: unknown): Promise<HeuristicWeightProfileV1> {
  const profile = parseHeuristicWeightProfile(profileInput);
  try {
    browserStorage()?.setItem(HEURISTIC_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // IndexedDB remains available to workers even if localStorage is unavailable.
  }
  await writeIndexedProfile(profile);
  dispatchProfileChanged(profile);
  return profile;
}

export async function clearStoredHeuristicProfile(): Promise<void> {
  try {
    browserStorage()?.removeItem(HEURISTIC_PROFILE_STORAGE_KEY);
  } catch {
    // no-op
  }
  await deleteIndexedProfile();
  dispatchProfileChanged(null);
}

export function describeStoredHeuristicProfile(profile: HeuristicWeightProfileV1 | null): string {
  if (!profile) return "Learned profile: none (falls back to default HeuristicAI weights)";
  const generation = profile.training?.generation;
  const fitness = profile.training?.fitness;
  const suffix = [
    generation === undefined ? "" : `generation=${generation}`,
    fitness === undefined ? "" : `fitness=${Number(fitness).toFixed(2)}`,
  ].filter(Boolean).join(" ");
  return `Learned profile: ${profile.profileId}${suffix ? ` (${suffix})` : ""}`;
}

setDefaultLearnedProfileProvider(() => readStoredHeuristicProfileSync() ?? undefined);
