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
  fetchLatestCloudModel,
  storeActiveCloudModelId,
} from "./cloudModelClient";

export interface CloudModelBootstrapResult {
  flatLoaded: string | null;
  allSpinLoaded: string | null;
  errors: string[];
}

export async function bootstrapCloudModels(): Promise<CloudModelBootstrapResult> {
  const result: CloudModelBootstrapResult = {
    flatLoaded: null,
    allSpinLoaded: null,
    errors: [],
  };

  if (!readStoredHeuristicProfileSync()) {
    try {
      const model = await fetchLatestCloudModel("flat");
      if (model) {
        if (model.payloadFormat !== HEURISTIC_PROFILE_FORMAT) {
          throw new Error(`Latest Flat model uses ${model.payloadFormat}`);
        }
        await writeStoredHeuristicProfile(parseHeuristicWeightProfile(model.payload));
        storeActiveCloudModelId("flat", model.modelId);
        result.flatLoaded = model.modelId;
      }
    } catch (error) {
      result.errors.push(`Flat: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!readStoredAllSpinProfileSync()) {
    try {
      const model = await fetchLatestCloudModel("allspin");
      if (model) {
        if (model.payloadFormat !== ALLSPIN_PROFILE_FORMAT) {
          throw new Error(`Latest All-Spin model uses ${model.payloadFormat}`);
        }
        await writeStoredAllSpinProfile(parseAllSpinWeightProfile(model.payload));
        storeActiveCloudModelId("allspin", model.modelId);
        result.allSpinLoaded = model.modelId;
      }
    } catch (error) {
      result.errors.push(`All-Spin: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}
