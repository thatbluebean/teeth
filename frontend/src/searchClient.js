import { validate, schemas, ProtocolError } from "./protocol.js";

export class SearchError extends Error {
  constructor(message, { status = 0, detail } = {}) {
    super(message);
    this.name = "SearchError";
    this.status = status;
    this.detail = detail;
  }
}

export class SearchClient {
  #baseUrl;
  #timeoutMs;

  constructor(baseUrl, { timeoutMs = 10_000 } = {}) {
    this.#baseUrl = baseUrl;
    this.#timeoutMs = timeoutMs;
  }

  async search(query, { limit = 10, offset = 0 } = {}) {
    const url = new URL("/search", this.#baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    return this.#get(schemas.SearchResponse, url);
  }

  async document(id) {
    const url = new URL(`/doc/${encodeURIComponent(id)}`, this.#baseUrl);
    return this.#get(schemas.Document, url);
  }

  async health() {
    return this.#get(schemas.Health, new URL("/health", this.#baseUrl));
  }

  async #get(schema, url) {
    let res;
    try {
      res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      throw new SearchError(`search engine unreachable: ${err.message ?? err}`, { status: 0 });
    }

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      throw new SearchError(body?.title ?? `search engine returned ${res.status}`, {
        status: res.status,
        detail: body?.detail,
      });
    }

    try {
      return validate(schema, body);
    } catch (err) {
      if (err instanceof ProtocolError) {
        throw new SearchError(`malformed response from search engine: ${err.message}`, {
          status: res.status,
        });
      }
      throw err;
    }
  }
}
