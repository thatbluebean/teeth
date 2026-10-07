const num = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const required = (value, name) => {
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value.replace(/\/+$/, "");
};

export const config = {
  port: num(process.env.PORT, 3000),
  searchBaseUrl: (process.env.SEARCH_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, ""),
  llm: {
    baseUrl: required(process.env.LLM_BASE_URL, "LLM_BASE_URL"),
    apiKey: process.env.LLM_API_KEY || null,
    model: process.env.LLM_MODEL ?? "",
    timeoutMs: num(process.env.LLM_TIMEOUT_MS, 120000),
  },
};
