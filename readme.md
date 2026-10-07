# Teeth

An fully offline knowledge system: search a local Wikipedia dump semantically, then chat with a local LLM about what it finds.

Everything runs on your own machines. No cloud, no external APIs, no internet required after setup.

## The point

Take a Wikipedia download, embed it once, and give yourself a private search + question-answering tool over that data. You type a query, the search engine returns the most relevant articles/passages using word embeddings (so meaning, not just keyword matching), and an LLM hosted on a separate machine explains, summarises, or answers questions using those results as context.

## Architecture

Four parts, three directories:

```
┌───────────┐     ┌────────────────┐     ┌──────────────────┐
│ frontend  │────▶│ search (Rust)  │     │ llm (OpenAI-     │
│ (Node.js) │────▶│ HTTP API       │     │  compatible API) │
└───────────┘     └───────┬────────┘     └────────▲─────────┘
                          │                       │
                          ▼                       │
                    ┌───────────┐                 │
                    │   data/   │   ──────────────┘
                    │ Wikipedia │   (frontend sends retrieved
                    │ + embeds  │    context to the LLM)
                    └───────────┘
```

### `search/` — Rust search engine

A Rust service exposing an HTTP API. It indexes and queries the contents of `data/`, ranking results with pre-calculated word embeddings rather than plain keyword matching.

The frontend talks to this and only to this for retrieval; no other component reads `data/` directly.

#### Protocol: HTTP + JSON, defined by `search/openapi.yaml`

The contract is an OpenAPI 3.1 document at [`search/openapi.yaml`](search/openapi.yaml). The Rust service must implement it (and ideally validate its own responses against it); the frontend validates everything it receives with a runtime mirror of the schemas in `frontend/src/protocol.js`. Keep the two in sync.

| Endpoint | Purpose |
|---|---|
| `GET /search?q=...&limit=...&offset=...` | Semantic search → ranked `SearchResponse` |
| `GET /doc/{id}` | Full `Document` text by ID |
| `GET /health` | Liveness + index stats |

Conventions:

- Scores are floats in `[0, 1]`, higher is better, results sorted best-first
- Errors are RFC 9457 problem details (`application/problem+json`): `{type, title, status, detail?}`
- Everything is JSON over plain HTTP so it can be curl'd by hand while developing

### `llm/` — locally hosted LLM

An OpenAI-compatible API (`/v1/chat/completions`, `/v1/models`) hosted on a **separate machine that can actually run the model**. Config is handled outside this repo — the frontend only needs a base URL and an API key (or none).

Point the frontend at it via environment variables:

```
LLM_BASE_URL=http://<llm-host>:<port>/v1
LLM_API_KEY=...
LLM_MODEL=<model-name>
```

### `frontend/` — Node.js server

The user-facing piece: a zero-dependency Node (>= 20) server that serves a plain HTML/CSS/JS UI and proxies/orchestrates the other two services. It is the only component that knows about both of them.

```
frontend/
  openapi consumer:  src/protocol.js      runtime mirror of search/openapi.yaml
  search client:     src/searchClient.js  fetch + response validation
  llm client:        src/llmClient.js     OpenAI-compatible SSE streaming
  server:            src/server.js        routing, static files, prompts
  ui:                public/              index.html, style.css, app.js
  dev helper:        test/mock-search.mjs toy search engine (delete when Rust lands)
```

Endpoints it exposes:

| Endpoint | Behaviour |
|---|---|
| `GET /` | The UI |
| `GET /api/search?q=&limit=&offset=` | Proxies to the Rust `GET /search`, validated |
| `POST /api/ask` `{q}` | Searches, takes the top 3 docs as context, streams the LLM answer back as Server-Sent Events |
| `GET /api/health` | Reports search + LLM status |

SSE events on `/api/ask`, in order:

1. `results` — `{query, total, results}` straight from the search engine
2. `token` — `{text}` one LLM delta at a time
3. `done` — `{model, cited:[{id,title,url}]}` citation list for the footer
4. `error` — `{message}` if anything upstream fails

Run it:

```sh
cd frontend
npm run mock:search &          # toy search engine, until search/ is real
PORT=3456 LLM_BASE_URL=http://<llm-host>:<port>/v1 LLM_MODEL=<name> npm start
```

### `data/` — Wikipedia dump + embeddings

A Wikipedia download with pre-calculated word embeddings, checked into place (or mounted) locally. This is the entire corpus the search engine indexes.

## Offline requirement

Once the Wikipedia dump and embeddings are downloaded and the model is in place, the system must run with no network access. That means:

- Search engine, frontend, and data all on the local machine(s)
- LLM on its own local machine, reachable only over the LAN
- No calls to external APIs, CDNs, package registries at runtime

## Getting started

Nothing is scaffolded yet. Rough order of work:

1. **data** — download the Wikipedia dump and its embeddings into `data/`, decide on the on-disk format
2. **search** — `cargo init` in `search/`, load the embeddings, implement `search/openapi.yaml`
3. **frontend** — done; run it against `npm run mock:search` until the Rust engine exists
4. **llm** — bring up the OpenAI-compatible server on the second machine, point `LLM_BASE_URL` at it

## Configuration

| Variable | Used by | Meaning |
|---|---|---|
| `SEARCH_BASE_URL` | frontend | Rust search API base URL |
| `LLM_BASE_URL` | frontend | OpenAI-compatible API base URL |
| `LLM_API_KEY` | frontend | Key for the LLM API, if it requires one |
| `LLM_MODEL` | frontend | Model name to request |
| `PORT` | frontend | Port the frontend listens on |
