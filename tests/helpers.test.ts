import { afterEach, describe, expect, it } from "vitest";
import { jsonText, resolveAccountId, safeHandler } from "../src/tools/_helpers.js";
import { NooviChatApiError } from "../src/client.js";

describe("resolveAccountId", () => {
  const original = process.env.NOOVICHAT_ACCOUNT_ID;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.NOOVICHAT_ACCOUNT_ID;
    } else {
      process.env.NOOVICHAT_ACCOUNT_ID = original;
    }
  });

  it("prefers the explicit value", () => {
    process.env.NOOVICHAT_ACCOUNT_ID = "99";
    expect(resolveAccountId(7)).toBe(7);
  });

  it("falls back to env var when explicit is undefined", () => {
    process.env.NOOVICHAT_ACCOUNT_ID = "42";
    expect(resolveAccountId(undefined)).toBe(42);
  });

  it("throws when neither is set", () => {
    delete process.env.NOOVICHAT_ACCOUNT_ID;
    expect(() => resolveAccountId(undefined)).toThrow(/account_id/);
  });

  it("rejects non-positive explicit values", () => {
    process.env.NOOVICHAT_ACCOUNT_ID = "5";
    expect(resolveAccountId(0)).toBe(5); // 0 falls back
    expect(resolveAccountId(-1)).toBe(5); // negative falls back
  });

  it("rejects malformed env values", () => {
    process.env.NOOVICHAT_ACCOUNT_ID = "garbage";
    expect(() => resolveAccountId(undefined)).toThrow();
  });
});

describe("jsonText", () => {
  it("wraps any value as MCP text content", () => {
    const result = jsonText({ a: 1, b: "x" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual({ a: 1, b: "x" });
  });

  it("handles null and primitive values", () => {
    expect(jsonText(null).content[0]?.text).toBe("null");
    expect(jsonText("hello").content[0]?.text).toBe("\"hello\"");
    expect(jsonText(42).content[0]?.text).toBe("42");
  });
});

describe("safeHandler", () => {
  it("wraps successful results as JSON text", async () => {
    const out = await safeHandler(async () => ({ ok: true }));
    expect(out.isError).toBeUndefined();
    expect(JSON.parse(out.content[0]?.text ?? "")).toEqual({ ok: true });
  });

  it("converts NooviChatApiError into a structured error payload", async () => {
    const err = new NooviChatApiError("Boom", 422, ["Field invalid"], "/api/x");
    const out = await safeHandler(async () => {
      throw err;
    });
    expect(out.isError).toBe(true);
    const payload = JSON.parse(out.content[0]?.text ?? "");
    expect(payload).toMatchObject({
      error: true,
      status: 422,
      path: "/api/x",
      message: "Boom",
      errors: ["Field invalid"],
    });
  });

  it("rethrows non-API errors (real bugs)", async () => {
    await expect(
      safeHandler(async () => {
        throw new Error("bug");
      }),
    ).rejects.toThrow("bug");
  });
});
