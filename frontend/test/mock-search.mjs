// Placeholder search engine that implements search/openapi.yaml with
// in-memory toy data. Exists so the frontend can be developed before the
// Rust engine is written. Delete once `search/` is real.

import http from "node:http";

const DOCS = [
  {
    id: "ada-lovelace",
    title: "Ada Lovelace",
    url: "https://en.wikipedia.org/wiki/Ada_Lovelace",
    text: "Ada Lovelace was an English mathematician and writer, chiefly known for her work on Charles Babbage's proposed mechanical computer, the Analytical Engine. She is often regarded as the first computer programmer.",
    sections: [],
  },
  {
    id: "analytical-engine",
    title: "Analytical Engine",
    url: "https://en.wikipedia.org/wiki/Analytical_Engine",
    text: "The Analytical Engine was a proposed mechanical computer designed by Charles Babbage in 1837. It incorporated an arithmetic logic unit, control flow in the form of conditional branching and loops, and integrated memory, making it a general-purpose computer.",
    sections: [],
  },
  {
    id: "word-embedding",
    title: "Word embedding",
    url: "https://en.wikipedia.org/wiki/Word_embedding",
    text: "A word embedding is a representation of a word in a dense vector space such that semantically similar words are close together. Common methods include Word2Vec and GloVe, which are trained on large text corpora.",
    sections: [],
  },
  {
    id: "wikipedia",
    title: "Wikipedia",
    url: "https://en.wikipedia.org/wiki/Wikipedia",
    text: "Wikipedia is a free online encyclopedia written and maintained by a community of volunteers. It is one of the most visited websites in the world and is available in hundreds of languages.",
    sections: [],
  },
];

const norm = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const score = (doc, queryTerms) => {
  const terms = new Set(norm(doc.title));
  for (const t of norm(doc.text)) terms.add(t);
  let hits = 0;
  for (const q of queryTerms) if (terms.has(q)) hits += 1;
  return hits / Math.max(1, queryTerms.length);
};

const problem = (res, status, title, detail) => {
  const body = JSON.stringify({ type: "/search", title, status, detail });
  res.writeHead(status, { "content-type": "application/problem+json" });
  res.end(body);
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (url.pathname === "/health") {
      return res.end(
        JSON.stringify({ status: "ok", index: { documents: DOCS.length, embeddings: DOCS.length } }),
      );
    }

    if (url.pathname === "/search") {
      const q = url.searchParams.get("q");
      if (!q) return problem(res, 400, "Bad request", "missing q");
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 10)));
      const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
      const terms = norm(q);

      const ranked = DOCS.map((d) => ({ doc: d, score: score(d, terms) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score);

      const results = ranked.slice(offset, offset + limit).map(({ doc, score: s }) => ({
        id: doc.id,
        title: doc.title,
        score: Number(s.toFixed(4)),
        snippet: doc.text.slice(0, 180),
        url: doc.url,
      }));

      return res.end(
        JSON.stringify({ query: q, took_ms: 1.5, total: ranked.length, results }),
      );
    }

    if (url.pathname.startsWith("/doc/")) {
      const id = decodeURIComponent(url.pathname.slice(5));
      const doc = DOCS.find((d) => d.id === id);
      if (!doc) return problem(res, 404, "Not found", `no document ${id}`);
      return res.end(JSON.stringify(doc));
    }

    problem(res, 404, "Not found", url.pathname);
  })
  .listen(8080, "127.0.0.1", () => console.log("mock search on http://127.0.0.1:8080"));
