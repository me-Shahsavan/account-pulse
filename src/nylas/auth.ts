import { NylasClient } from "./client.js";

// Nylas v3 Hosted Auth (OAuth 2.0):
//   1. Redirect the user to /v3/connect/auth
//   2. Provider consent -> callback with ?code=
//   3. Exchange the code at /v3/connect/token -> grant_id
// All later data calls are scoped to that grant: /v3/grants/{grant_id}/...
// Note: in v3 the token exchange's client_secret is the Nylas API key.

export function buildAuthUrl(options: {
  apiUri: string;
  clientId: string;
  redirectUri: string;
  provider?: "google" | "microsoft" | "imap";
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: "code",
    access_type: "online",
  });
  if (options.provider) params.set("provider", options.provider);
  return `${options.apiUri}/v3/connect/auth?${params.toString()}`;
}

export interface TokenExchangeResult {
  grantId: string;
  email: string;
}

export async function exchangeCodeForGrant(
  client: NylasClient,
  options: { clientId: string; apiKey: string; redirectUri: string; code: string },
): Promise<TokenExchangeResult> {
  // /v3/connect/token returns a flat body (no {data} envelope).
  const body = await client.requestRaw("/v3/connect/token", {
    method: "POST",
    body: {
      client_id: options.clientId,
      client_secret: options.apiKey,
      grant_type: "authorization_code",
      code: options.code,
      redirect_uri: options.redirectUri,
      code_verifier: "nylas",
    },
  });

  if (!body.grant_id) {
    throw new Error("Token exchange succeeded but no grant_id in response.");
  }
  return { grantId: body.grant_id, email: body.email ?? "" };
}

// Sanity check used after auth: GET /v3/grants/{id}
export async function getGrant(client: NylasClient, grantId: string) {
  const res = await client.request<{
    id: string;
    email: string;
    provider: string;
    grant_status: string;
  }>(`/v3/grants/${grantId}`);
  return res.data;
}
