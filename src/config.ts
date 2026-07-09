import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  // Treat obvious placeholders as unset.
  if (!value || value.includes("REPLACE_ME")) return undefined;
  return value;
}

export const config = {
  nylasApiKey: required("NYLAS_API_KEY"),
  nylasClientId: required("NYLAS_CLIENT_ID"),
  nylasApiUri: process.env.NYLAS_API_URI ?? "https://api.us.nylas.com",
  // LLM provider: Anthropic direct, or OpenRouter (same Claude model).
  // At least one must be set to run a pulse; raw mode needs neither.
  anthropicApiKey: optional("ANTHROPIC_API_KEY"),
  openrouterApiKey: optional("OPENROUTER_API_KEY"),
  callbackUri: process.env.CALLBACK_URI ?? "http://localhost:3000/auth/callback",
  port: Number(process.env.PORT ?? 3000),
  userTimezone: process.env.USER_TIMEZONE ?? "UTC",
};
