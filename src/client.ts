/**
 * HTTP client for the NooviChat REST API.
 *
 * Auth: NooviChat (and Chatwoot upstream) accept the API token via the
 * custom `api_access_token` header — NOT `Authorization: Bearer`.
 *
 * The client is a thin wrapper around native `fetch` (Node 20+) that
 * handles base URL composition, query params, error extraction, 204
 * empty-body responses, and an optional timeout via AbortController.
 */

export interface NooviChatClientOptions {
  baseUrl: string;
  apiToken: string;
  timeoutMs?: number;
}

export class NooviChatApiError extends Error {
  public readonly status: number;
  public readonly errors: string[];
  public readonly path: string;

  constructor(message: string, status: number, errors: string[], path: string) {
    super(message);
    this.name = "NooviChatApiError";
    this.status = status;
    this.errors = errors;
    this.path = path;
  }
}

type Body = Record<string, unknown> | unknown[] | undefined;
type QueryParams = Record<string, string | number | boolean | string[] | undefined> | undefined;

export class NooviChatClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;

  constructor(options: NooviChatClientOptions) {
    if (!options.baseUrl) throw new Error("baseUrl is required");
    if (!options.apiToken) throw new Error("apiToken is required");

    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiToken = options.apiToken;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  get<T = unknown>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>("GET", path, undefined, params);
  }

  post<T = unknown>(path: string, body?: Body, params?: QueryParams): Promise<T> {
    return this.request<T>("POST", path, body, params);
  }

  patch<T = unknown>(path: string, body?: Body, params?: QueryParams): Promise<T> {
    return this.request<T>("PATCH", path, body, params);
  }

  put<T = unknown>(path: string, body?: Body, params?: QueryParams): Promise<T> {
    return this.request<T>("PUT", path, body, params);
  }

  delete<T = unknown>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>("DELETE", path, undefined, params);
  }

  private buildUrl(path: string, params?: QueryParams): string {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const v of value) url.searchParams.append(`${key}[]`, String(v));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Body,
    params?: QueryParams,
  ): Promise<T> {
    const url = this.buildUrl(path, params);

    const headers = new Headers({
      "api_access_token": this.apiToken,
      "Accept": "application/json",
    });

    let payload: BodyInit | undefined;
    if (body !== undefined) {
      headers.set("Content-Type", "application/json");
      payload = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      const reason = err instanceof Error ? err.message : String(err);
      throw new NooviChatApiError(`Request failed: ${reason}`, 0, [reason], path);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const data = isJson ? await response.json().catch(() => null) : await response.text();

    if (!response.ok) {
      const errors = this.extractErrors(data);
      const message = errors[0] ?? `NooviChat API error: ${response.status} ${response.statusText}`;
      throw new NooviChatApiError(message, response.status, errors, path);
    }

    return data as T;
  }

  private extractErrors(data: unknown): string[] {
    if (!data) return [];
    if (typeof data === "string") return [data];
    if (typeof data !== "object") return [];

    const obj = data as Record<string, unknown>;

    if (Array.isArray(obj.errors)) {
      return obj.errors.map((e) => (typeof e === "string" ? e : JSON.stringify(e)));
    }
    if (typeof obj.error === "string") return [obj.error];
    if (typeof obj.message === "string") return [obj.message];

    return [];
  }
}
