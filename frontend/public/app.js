const $ = (id) => document.getElementById(id);

const form = $("search-form");
const queryInput = $("query");
const searchBtn = $("search-btn");
const askBtn = $("ask-btn");
const resultList = $("result-list");
const resultsMeta = $("results-meta");
const empty = $("empty");
const answerBox = $("answer");
const answerText = $("answer-text");
const answerMeta = $("answer-meta");
const citations = $("citations");
const status = $("status");

let askController = null;

form.addEventListener("submit", (e) => {
  e.preventDefault();
  runSearch();
});
searchBtn.addEventListener("click", runSearch);
askBtn.addEventListener("click", runAsk);

init();

async function init() {
  try {
    const health = await fetchJson("/api/health");
    const ok = health.status === "ok";
    status.textContent = ok
      ? `search: ${health.search?.index?.documents ?? "?"} docs · llm: ${health.llm?.model || "unset"}`
      : "search engine unreachable";
    status.className = `status ${ok ? "ok" : "bad"}`;
  } catch {
    status.textContent = "backend unreachable";
    status.className = "status bad";
  }
}

async function runSearch() {
  const q = queryInput.value.trim();
  if (!q) return;

  setSearchBusy(true);
  clearAnswer();
  try {
    const data = await fetchJson(`/api/search?q=${encodeURIComponent(q)}&limit=10`);
    renderResults(data);
  } catch (err) {
    renderError(err.message);
  } finally {
    setSearchBusy(false);
  }
}

async function runAsk() {
  const q = queryInput.value.trim();
  if (!q) return;

  if (askController) {
    askController.abort();
    askController = null;
    setAskBusy(false);
    return;
  }

  askController = new AbortController();
  setAskBusy(true);
  clearAnswer();
  answerBox.classList.remove("hidden");
  answerText.textContent = "";
  answerMeta.textContent = "searching…";
  setSearchBusy(true);

  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q }),
      signal: askController.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail ?? body?.title ?? `request failed (${res.status})`);
    }

    let started = false;
    for await (const event of parseSse(res.body)) {
      if (event.event === "results") {
        renderResults(event.data);
        answerMeta.textContent = `answering from ${event.data.results.length} results…`;
      } else if (event.event === "token") {
        if (!started) {
          started = true;
          answerMeta.textContent = "generating…";
          answerText.innerHTML = "";
        }
        answerText.insertAdjacentText("beforeend", event.data.text);
      } else if (event.event === "citations" || event.event === "done") {
        renderCitations(event.data.cited ?? []);
        answerMeta.textContent = `done · ${event.data.model ?? ""}`.trim();
      } else if (event.event === "error") {
        throw new Error(event.data.message);
      }
    }
    if (!started && !answerMeta.textContent.includes("done")) {
      answerMeta.textContent = "the model returned nothing";
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      answerMeta.textContent = "";
      answerText.innerHTML = "";
      renderError(err.message, answerText);
    }
  } finally {
    askController = null;
    setAskBusy(false);
    setSearchBusy(false);
  }
}

function renderResults(data) {
  resultList.innerHTML = "";
  resultsMeta.textContent = `${data.total} matches in ${Math.round(data.took_ms)} ms`;
  empty.classList.toggle("hidden", data.results.length > 0);

  for (const r of data.results) {
    const li = document.createElement("li");

    const title = document.createElement(r.url ? "a" : "span");
    title.className = "result-title";
    title.textContent = r.title;
    if (r.url) {
      title.href = r.url;
      title.target = "_blank";
      title.rel = "noreferrer";
    }

    const meta = document.createElement("span");
    meta.className = "result-meta";
    meta.textContent = r.score.toFixed(3);

    const head = document.createElement("div");
    head.append(title, meta);

    const snippet = document.createElement("p");
    snippet.className = "snippet";
    snippet.textContent = r.snippet ?? "";

    li.append(head, snippet);
    resultList.append(li);
  }
}

function renderCitations(cited) {
  citations.innerHTML = "";
  if (cited.length === 0) return;
  cited.forEach((doc, i) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `[${i + 1}] `;
    li.append(label);
    if (doc.url) {
      const a = document.createElement("a");
      a.href = doc.url;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = doc.title;
      li.append(a);
    } else {
      li.append(document.createTextNode(doc.title));
    }
    citations.append(li);
  });
}

function renderError(message, target) {
  const el = target ?? document.createElement("p");
  el.className = "error";
  el.textContent = message;
  if (target) target.append(el);
  else {
    resultsMeta.textContent = "";
    resultList.innerHTML = "";
    resultList.append(el);
  }
}

function clearAnswer() {
  answerBox.classList.add("hidden");
  answerText.textContent = "";
  answerMeta.textContent = "";
  citations.innerHTML = "";
}

function setSearchBusy(busy) {
  searchBtn.disabled = busy && !askController;
  queryInput.disabled = busy;
}

function setAskBusy(busy) {
  askBtn.textContent = busy ? "Stop" : "Ask LLM";
}

async function fetchJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? body?.title ?? `request failed (${res.status})`);
  return body;
}

async function* parseSse(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = parseBlock(block);
      if (event) yield event;
    }
  }
}

function parseBlock(block) {
  let event = "message";
  const dataLines = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}
