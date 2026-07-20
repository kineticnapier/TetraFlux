import { bootstrapCloudModels } from "../models/bootstrapCloudModels";

await bootstrapCloudModels();
await import("../main");
