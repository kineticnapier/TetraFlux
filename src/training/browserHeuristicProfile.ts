import { setDefaultLearnedProfileProvider } from "../ai/registry";
import {
  PROFILE_STORE_NAME,
  deleteDbRecord,
  readDbRecord,
  writeDbRecord,
} from "../storage/browserDatabase";
import {
  parseHeuristicWeightProfile,
  type HeuristicWeightProfileV1,
} from "./heuristicWeights";

export const HEURISTIC_CHECKPOINT_STORAGE_KEY = "tetraflux:heuristicTrainingCheckpoint:v1";
export const HEURISTIC_PROFILE_STORAGE_KEY = "tetraflux:heuristicWeightProfile:v1";
export const HEURISTIC_PROFILE_CHANGED_EVENT = "tetraflux:heuristic-profile-change";

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

async function readIndexedProfile(): Promise<HeuristicWeightProfileV1 | null> {
  const record = await readDbRecord<StoredProfileRecord>(PROFILE_STORE_NAME, PROFILE_RECORD_KEY);
  if (!record?.profile) return null;
  try {
    return parseHeuristicWeightProfile(record.profile);
  } catch {
    return null;
  }
}

async function writeIndexedProfile(profile: HeuristicWeightProfileV1): Promise<void> {
  await writeDbRecord(PROFILE_STORE_NAME, {
    key: PROFILE_RECORD_KEY,
    profile,
    savedAt: new Date().toISOString(),
  } satisfies StoredProfileRecord);
}

async function deleteIndexedProfile(): Promise<void> {
  await deleteDbRecord(PROFILE_STORE_NAME, PROFILE_RECORD_KEY);
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
