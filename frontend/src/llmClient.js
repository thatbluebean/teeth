export class LlmError extends Error {
  constructor(message, { status = 0 } = {}) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

export class LlmClient {
  #baseUrl;
  #apiKey;
  #model;
  #timeoutMs;

  constructor({ baseUrl, apiKey, model, timeoutMs }) {
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#apiKey = apiKey;
    this.#model = model;
    this.#timeoutMs = timeoutMs;
  }

  get model() {
    return this.#model;
  }

  /**
   * Stream a chat completion. Yields text deltas as they arrive.
   * @param {{role: string, content: string}[]} messages
   * @param {{signal?: AbortSignal}} [options]
   */
  async *chat(messages, { signal } = {}) {
    let res;
    try {
      res = await fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          ...(this.#apiKey ? { authorization: `Bearer ${this.#apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.#model,
          messages,
          stream: true,
          temperature: 0.2,
        }),
        signal: signal ?? AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      throw new LlmError(`LLM unreachable: ${err.message ?? err}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new LlmError(`LLM returned ${res.status}: ${detail.slice(0, 300)}`, {
        status: res.status,
      });
    }
    if (!res.body) throw new LlmError("LLM returned an empty body");

    for await (const line of splitLines(res.body)) {
      if (signal?.aborted) return;
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;

      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) yield delta;
    }
  }
}

async function* splitLines(stream) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) yield line;
    }
  }
  if (buffer.trim().length > 0) yield buffer;
}
