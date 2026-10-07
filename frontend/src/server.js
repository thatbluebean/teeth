import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { SearchClient, SearchError } from "./searchClient.js";
import { LlmClient, LlmError } from "./llmClient.js";

const search = new SearchClient(config.searchBaseUrl);
const llm = new LlmClient(config.llm);

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "..", "public");

const MAX_CONTEXT_DOCS = 3;
const MAX_DOC_CHARS = 4000;
const SYSTEM_PROMPT = [
  "You are a research assistant over a local copy of Wikipedia.",
  "Answer the user's question using only the provided context passages.",
  "If the context does not contain the answer, say so plainly instead of guessing.",
  "Cite supporting passages inline as [1], [2], etc.",
].join(" ");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  try {
    if (url.pathname === "/api/search") return await handleSearch(req, res, url);
    if (url.pathname === "/api/ask") return await handleAsk(req, res, url);
    if (url.pathname === "/api/health") return await handleHealth(req, res);
    if (url.pathname.startsWith("/api/")) return sendJson(res, 404, problem("/api", "Not found", 404));
    return serveStatic(res, url.pathname);
  } catch (err) {
    if (err.name === "BadJson") {
      return sendJson(res, 400, problem("/api", "Invalid JSON body", 400));
    }
    if (err.name === "SearchError" || err.name === "LlmError") {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
      return sendJson(res, status, problem("/api/upstream", err.message, status, err.detail));
    }
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, problem("/api/internal", "Internal server error", 500));
    else res.end();
  }
});

async function handleSearch(req, res, url) {
  if (req.method !== "GET") return sendJson(res, 405, problem("/api/search", "Method not allowed", 405));

  const q = url.searchParams.get("q")?.trim();
  if (!q) return sendJson(res, 400, problem("/api/search", "Missing query parameter q", 400));

  const limit = clampInt(url.searchParams.get("limit"), 1, 50, 10);
  const offset = clampInt(url.searchParams.get("offset"), 0, 10_000, 0);

  const results = await search.search(q, { limit, offset });
  sendJson(res, 200, results);
}

async function handleAsk(req, res, url) {
  if (req.method !== "POST") return sendJson(res, 405, problem("/api/ask", "Method not allowed", 405));

  const body = await readJson(req);
  const q = typeof body.q === "string" ? body.q.trim() : "";
  if (!q) return sendJson(res, 400, problem("/api/ask", "Missing field q", 400));

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const abort = new AbortController();
  req.on("close", () => abort.abort());

  const emit = (event, data) => {
    if (res.writableEnded || abort.signal.aborted) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const searchResult = await search.search(q, { limit: 10 });
    emit("results", { query: searchResult.query, total: searchResult.total, results: searchResult.results });

    const top = searchResult.results.slice(0, MAX_CONTEXT_DOCS);
    const docs = (
      await Promise.all(
        top.map((r) =>
          search.document(r.id).catch((err) => {
            console.warn(`failed to fetch doc ${r.id}: ${err.message}`);
            return null;
          }),
        ),
      )
    ).filter(Boolean);

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `${buildContext(docs)}\n\nQuestion: ${q}` },
    ];

    for await (const delta of llm.chat(messages, { signal: abort.signal })) {
      emit("token", { text: delta });
    }
    emit("done", { model: llm.model, cited: docs.map((d) => ({ id: d.id, title: d.title, url: d.url })) });
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error(err);
      emit("error", { message: err.message ?? "generation failed" });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}

async function handleHealth(req, res) {
  let searchHealth;
  let searchOk = true;
  try {
    searchHealth = await search.health();
  } catch (err) {
    searchOk = false;
    searchHealth = { error: err.message };
  }

  sendJson(res, 200, {
    status: searchOk ? "ok" : "degraded",
    search: searchHealth,
    llm: { baseUrl: config.llm.baseUrl, model: config.llm.model },
  });
}

function buildContext(docs) {
  if (docs.length === 0) return "Context: (no relevant passages found)";
  return docs
    .map((d, i) => {
      const text = (d.text ?? "").slice(0, MAX_DOC_CHARS);
      return `[${i + 1}] ${d.title}\n${text}`;
    })
    .join("\n\n---\n\n");
}

async function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, problem("/", "Forbidden", 403));

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    sendJson(res, 404, problem("/", "Not found", 404));
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function problem(type, title, status, detail) {
  const p = { type, title, status };
  if (detail) p.detail = detail;
  return p;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("invalid JSON body"), { name: "BadJson" }));
      }
    });
    req.on("error", reject);
  });
}

function clampInt(raw, min, max, fallback) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

server.listen(config.port, () => {
  console.log(`frontend listening on http://127.0.0.1:${config.port}`);
  console.log(`  search -> ${config.searchBaseUrl}`);
  console.log(`  llm    -> ${config.llm.baseUrl} (${config.llm.model || "no model set"})`);
});
