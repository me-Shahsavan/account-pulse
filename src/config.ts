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

export const config = {
  nylasApiKey: required("NYLAS_API_KEY"),
  nylasClientId: required("NYLAS_CLIENT_ID"),
  nylasApiUri: process.env.NYLAS_API_URI ?? "https://api.us.nylas.com",
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  callbackUri: process.env.CALLBACK_URI ?? "http://localhost:3000/auth/callback",
  port: Number(process.env.PORT ?? 3000),
  userTimezone: process.env.USER_TIMEZONE ?? "UTC",
};
