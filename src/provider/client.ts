// Thin typed wrapper over the the v3 email API REST API using plain fetch.
// The official Node SDK exists, but hand-rolling the client keeps the
// API contract visible (params, pagination, error envelope) — which is
// the point of this prototype. See README "DX notes".

export type Query = Record<string, string | number | boolean | undefined>;

export interface ApiResponse<T> {
  data: T;
  requestId?: string;
  nextCursor?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly requestId?: string,
    readonly errorType?: string,
  ) {
    super(`the email API API ${status}: ${message}${requestId ? ` (request_id: ${requestId})` : ""}`);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  apiKey: string;
  apiUri?: string;
  // Injectable for tests; defaults to global fetch.
  fetchImpl?: typeof fetch;
}

export function buildQueryString(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export class ApiClient {
  private readonly apiKey: string;
  private readonly apiUri: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.apiKey = options.apiKey;
    this.apiUri = (options.apiUri ?? "https://api.us.provider.com").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  // Most v3 endpoints wrap results as {request_id, data, next_cursor}.
  async request<T>(
    path: string,
    init: { method?: string; query?: Query; body?: unknown } = {},
  ): Promise<ApiResponse<T>> {
    const json = await this.requestRaw(path, init);
    return {
      data: json.data as T,
      requestId: json.request_id,
      nextCursor: json.next_cursor,
    };
  }

  // A few endpoints (e.g. /v3/connect/token) return a flat object instead
  // of the {data: ...} envelope — this returns the parsed body as-is.
  async requestRaw(
    path: string,
    init: { method?: string; query?: Query; body?: unknown } = {},
  ): Promise<any> {
    const url = `${this.apiUri}${path}${buildQueryString(init.query)}`;
    const response = await this.fetchImpl(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const text = await response.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      // Non-JSON error body (e.g. gateway HTML); surface raw text below.
    }

    if (!response.ok) {
      throw new ApiError(
        response.status,
        json?.error?.message ?? json?.message ?? text ?? "Unknown error",
        json?.request_id,
        json?.error?.type,
      );
    }

    return json;
  }

  // Follows next_cursor via the page_token param until exhausted or
  // maxItems collected. the email API caps limit at 200 per page.
  async listAll<T>(path: string, query: Query = {}, maxItems = 200): Promise<T[]> {
    const items: T[] = [];
    let pageToken: string | undefined;

    do {
      const page = await this.request<T[]>(path, {
        query: { ...query, page_token: pageToken },
      });
      items.push(...(page.data ?? []));
      pageToken = page.nextCursor;
    } while (pageToken && items.length < maxItems);

    return items.slice(0, maxItems);
  }
}
