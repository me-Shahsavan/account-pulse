import { describe, it, expect, vi } from "vitest";
import { NylasClient, NylasApiError, buildQueryString } from "./client.js";

// Unit tests for the client wrapper only (param building, pagination,
// error mapping) with mocked HTTP. The demo path itself runs against the
// real Nylas sandbox — no mocked Nylas responses there.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("buildQueryString", () => {
  it("serializes defined params and skips undefined", () => {
    expect(
      buildQueryString({ any_email: "a@b.com", limit: 50, page_token: undefined }),
    ).toBe("?any_email=a%40b.com&limit=50");
  });

  it("returns empty string for no params", () => {
    expect(buildQueryString()).toBe("");
    expect(buildQueryString({ x: undefined })).toBe("");
  });
});

describe("NylasClient.request", () => {
  it("sends bearer auth and unwraps the data envelope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ request_id: "req_1", data: [{ id: "t1" }], next_cursor: "c2" }),
    );
    const client = new NylasClient({ apiKey: "key", fetchImpl });

    const res = await client.request<{ id: string }[]>("/v3/grants/g1/threads", {
      query: { any_email: "a@b.com" },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.us.nylas.com/v3/grants/g1/threads?any_email=a%40b.com",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer key" }),
      }),
    );
    expect(res.data).toEqual([{ id: "t1" }]);
    expect(res.requestId).toBe("req_1");
    expect(res.nextCursor).toBe("c2");
  });

  it("maps error responses to NylasApiError with status and request_id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        { request_id: "req_err", error: { type: "invalid_request_error", message: "bad grant" } },
        400,
      ),
    );
    const client = new NylasClient({ apiKey: "key", fetchImpl });

    const err = await client.request("/v3/grants/nope").catch((e) => e);
    expect(err).toBeInstanceOf(NylasApiError);
    expect(err.status).toBe(400);
    expect(err.requestId).toBe("req_err");
    expect(err.message).toContain("bad grant");
    expect(err.message).toContain("req_err");
  });
});

describe("NylasClient.listAll pagination", () => {
  it("follows next_cursor via page_token until exhausted", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 1 }, { id: 2 }], next_cursor: "p2" }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 3 }] })); // no next_cursor
    const client = new NylasClient({ apiKey: "key", fetchImpl });

    const items = await client.listAll<{ id: number }>("/v3/grants/g1/threads", { limit: 2 });

    expect(items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondUrl = fetchImpl.mock.calls[1][0] as string;
    expect(secondUrl).toContain("page_token=p2");
  });

  it("stops at maxItems even when more pages exist", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse({ data: [{ id: 1 }, { id: 2 }], next_cursor: "always-more" }),
      );
    const client = new NylasClient({ apiKey: "key", fetchImpl });

    const items = await client.listAll("/v3/grants/g1/messages", {}, 3);

    expect(items).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
