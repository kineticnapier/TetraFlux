import { bootstrapLocalModels } from "../models/bootstrapLocalModels";

async function startGamePage(): Promise<void> {
  await bootstrapLocalModels();
  await import("../main");
}

void startGamePage();
