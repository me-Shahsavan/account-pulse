import { config } from "../config.js";
import { NylasClient } from "../nylas/client.js";
import { runPulse, PulseResult } from "./pulse.js";
import { runPulseOpenRouter } from "./openrouter.js";

// Provider dispatch: Anthropic direct when ANTHROPIC_API_KEY is set,
// otherwise OpenRouter (same Claude Sonnet 4.6 model either way).

export async function runPulseAuto(options: {
  nylas: NylasClient;
  grantId: string;
  ownerEmail: string;
  contactEmail: string;
  daysBack?: number;
  onProgress?: (note: string) => void;
}): Promise<PulseResult> {
  const common = { ...options, timezone: config.userTimezone };

  if (config.anthropicApiKey) {
    return runPulse({ ...common, anthropicApiKey: config.anthropicApiKey });
  }
  if (config.openrouterApiKey) {
    return runPulseOpenRouter({
      ...common,
      openrouterApiKey: config.openrouterApiKey,
      model: config.openrouterModel,
    });
  }
  throw new Error(
    "No LLM key configured. Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY in .env.",
  );
}
