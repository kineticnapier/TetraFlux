import { bootstrapCloudModels } from "../models/bootstrapCloudModels";

async function startGamePage(): Promise<void> {
  await bootstrapCloudModels();
  await import("../main");
}

void startGamePage();
