import {
  buildBrowserAiEntries as buildEntries,
  createBuiltinAi as createCoreBuiltinAi,
  createBuiltinAiFactories,
  listBrowserAiOptions as listOptions,
  randomBuiltinAi as randomCoreBuiltinAi,
  type AiFactorySpec,
  type AiLike,
  type AiRegistryEntry,
} from "./registry";
import {
  readStoredHeuristicProfile,
  readStoredHeuristicProfileSync,
} from "../training/browserHeuristicProfile";

const learnedProfileProvider = () => readStoredHeuristicProfileSync() ?? undefined;

export const BUILTIN_AI_FACTORIES: AiFactorySpec[] = createBuiltinAiFactories(learnedProfileProvider);

export function createBuiltinAi(id: string): AiRegistryEntry {
  return createCoreBuiltinAi(id, learnedProfileProvider);
}

export function randomBuiltinAi(): AiRegistryEntry {
  return randomCoreBuiltinAi(learnedProfileProvider);
}

export async function buildBrowserAiEntries(ids?: string[], baseUrl = "/"): Promise<AiRegistryEntry[]> {
  const profile = await readStoredHeuristicProfile();
  return await buildEntries(ids, baseUrl, profile ?? undefined);
}

export async function listBrowserAiOptions(baseUrl = "/"): Promise<Array<{ id: string; name: string }>> {
  const profile = await readStoredHeuristicProfile();
  return await listOptions(baseUrl, profile ?? undefined);
}

export type { AiFactorySpec, AiLike, AiRegistryEntry };
