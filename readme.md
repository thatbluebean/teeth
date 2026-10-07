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

Suggested endpoints:

- `GET /search?q=...&limit=...` — semantic search, returns ranked articles/passages with scores
- `GET /doc/{id}` — fetch a full document by ID
- `GET /health` — liveness check

The frontend talks to this and only to this for retrieval; no other component reads `data/` directly.

### `llm/` — locally hosted LLM

An OpenAI-compatible API (`/v1/chat/completions`, `/v1/models`) hosted on a **separate machine that can actually run the model**. Config is handled outside this repo — the frontend only needs a base URL and an API key (or none).

Point the frontend at it via environment variables:

```
LLM_BASE_URL=http://<llm-host>:<port>/v1
LLM_API_KEY=...
LLM_MODEL=<model-name>
```

### `frontend/` — Node.js server

The user-facing piece. It:

1. Receives the user's query from the browser
2. Calls the Rust search API to retrieve relevant passages from `data/`
3. Builds a prompt from those passages and calls the OpenAI-compatible LLM API
4. Streams the answer back to the browser, citations to the retrieved documents included

It is the only component that knows about both of the others.

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
2. **search** — `cargo init` in `search/`, load the embeddings, expose the HTTP API
3. **frontend** — `npm init` in `frontend/`, wire up the search and LLM base URLs
4. **llm** — bring up the OpenAI-compatible server on the second machine

## Configuration

| Variable | Used by | Meaning |
|---|---|---|
| `SEARCH_BASE_URL` | frontend | Rust search API base URL |
| `LLM_BASE_URL` | frontend | OpenAI-compatible API base URL |
| `LLM_API_KEY` | frontend | Key for the LLM API, if it requires one |
| `LLM_MODEL` | frontend | Model name to request |
| `PORT` | frontend | Port the frontend listens on |
