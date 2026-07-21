import { ALLSPIN_PROFILE_FORMAT, parseAllSpinWeightProfile } from "../training/allspinWeights";
import {
  readStoredAllSpinProfileSync,
  writeStoredAllSpinProfile,
} from "../training/browserAllSpinProfile";
import {
  readStoredHeuristicProfileSync,
  writeStoredHeuristicProfile,
} from "../training/browserHeuristicProfile";
import { HEURISTIC_PROFILE_FORMAT, parseHeuristicWeightProfile } from "../training/heuristicWeights";
import {
  getLocalModel,
  readActiveLocalModelId,
} from "./localModelLibrary";

export interface LocalModelBootstrapResult {
  flatLoaded: string | null;
  allSpinLoaded: string | null;
  errors: string[];
}

export async function bootstrapLocalModels(): Promise<LocalModelBootstrapResult> {
  const result: LocalModelBootstrapResult = {
    flatLoaded: null,
    allSpinLoaded: null,
    errors: [],
  };

  if (!readStoredHeuristicProfileSync()) {
    try {
      const modelId = await readActiveLocalModelId("flat");
      const model = modelId ? await getLocalModel(modelId) : null;
      if (model) {
        if (model.family !== "flat" || model.payloadFormat !== HEURISTIC_PROFILE_FORMAT) {
          throw new Error(`Active Flat model uses ${model.payloadFormat}`);
        }
        await writeStoredHeuristicProfile(parseHeuristicWeightProfile(model.payload));
        result.flatLoaded = model.modelId;
      }
    } catch (error) {
      result.errors.push(`Flat: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!readStoredAllSpinProfileSync()) {
    try {
      const modelId = await readActiveLocalModelId("allspin");
      const model = modelId ? await getLocalModel(modelId) : null;
      if (model) {
        if (model.family !== "allspin" || model.payloadFormat !== ALLSPIN_PROFILE_FORMAT) {
          throw new Error(`Active All-Spin model uses ${model.payloadFormat}`);
        }
        await writeStoredAllSpinProfile(parseAllSpinWeightProfile(model.payload));
        result.allSpinLoaded = model.modelId;
      }
    } catch (error) {
      result.errors.push(`All-Spin: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}
