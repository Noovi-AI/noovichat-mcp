import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NooviChatApiError, NooviChatClient } from "../src/client.js";

describe("NooviChatClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("throws if baseUrl missing", () => {
    expect(() => new NooviChatClient({ baseUrl: "", apiToken: "x" })).toThrow();
  });

  it("throws if apiToken missing", () => {
    expect(() => new NooviChatClient({ baseUrl: "https://x", apiToken: "" })).toThrow();
  });

  it("strips trailing slashes from baseUrl", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = new NooviChatClient({
      baseUrl: "https://chat.example.com///",
      apiToken: "tok",
    });
    await client.get("/api/v1/accounts/1");

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toBe("https://chat.example.com/api/v1/accounts/1");
  });

  it("sends api_access_token header on every request", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = new NooviChatClient({
      baseUrl: "https://chat.example.com",
      apiToken: "secret-tok",
    });
    await client.get("/api/v1/accounts/1");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get("api_access_token")).toBe("secret-tok");
    expect(headers.get("Accept")).toBe("application/json");
  });

  it("encodes array query params with [] suffix", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = new NooviChatClient({
      baseUrl: "https://chat.example.com",
      apiToken: "tok",
    });
    await client.get("/api/v1/accounts/1/contacts", { tag_ids: ["a", "b"] });

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.searchParams.getAll("tag_ids[]")).toEqual(["a", "b"]);
  });

  it("returns undefined for 204 responses", async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof globalThis.fetch;

    const client = new NooviChatClient({
      baseUrl: "https://chat.example.com",
      apiToken: "tok",
    });
    const result = await client.delete("/api/v1/accounts/1/contacts/42");
    expect(result).toBeUndefined();
  });

  it("throws NooviChatApiError on non-2xx with parsed errors", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ errors: ["Title can't be blank"] }), {
        status: 422,
        statusText: "Unprocessable Entity",
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof globalThis.fetch;

    const client = new NooviChatClient({
      baseUrl: "https://chat.example.com",
      apiToken: "tok",
    });

    await expect(client.post("/api/v1/accounts/1/pipeline_cards", { title: "" }))
      .rejects.toMatchObject({
        name: "NooviChatApiError",
        status: 422,
        errors: ["Title can't be blank"],
        path: "/api/v1/accounts/1/pipeline_cards",
      });
  });

  it("falls back to `error` string when `errors` array missing", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        statusText: "Forbidden",
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof globalThis.fetch;

    const client = new NooviChatClient({
      baseUrl: "https://chat.example.com",
      apiToken: "tok",
    });

    try {
      await client.get("/api/v1/accounts/1");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NooviChatApiError);
      expect((err as NooviChatApiError).errors).toEqual(["Forbidden"]);
    }
  });

  it("aborts on timeout", async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      // Simulate a hang by waiting on the abort signal.
      const signal = (init as RequestInit | undefined)?.signal;
      await new Promise((_resolve, reject) => {
        if (!signal) return;
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
      return new Response("{}");
    }) as unknown as typeof globalThis.fetch;

    const client = new NooviChatClient({
      baseUrl: "https://chat.example.com",
      apiToken: "tok",
      timeoutMs: 50,
    });

    await expect(client.get("/slow")).rejects.toBeInstanceOf(NooviChatApiError);
  });
});
