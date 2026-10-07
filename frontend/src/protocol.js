// Runtime mirror of search/openapi.yaml.
// The OpenAPI document is the source of truth; keep this in sync with it.

export class ProtocolError extends Error {
  constructor(message, path) {
    super(`${path}: ${message}`);
    this.name = "ProtocolError";
    this.path = path;
  }
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const check = (value, schema, path = "$") => {
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") throw new ProtocolError("expected string", path);
      if (schema.enum && !schema.enum.includes(value))
        throw new ProtocolError(`expected one of ${schema.enum.join(", ")}`, path);
      if (schema.minLength !== undefined && value.length < schema.minLength)
        throw new ProtocolError(`shorter than ${schema.minLength}`, path);
      if (schema.maxLength !== undefined && value.length > schema.maxLength)
        throw new ProtocolError(`longer than ${schema.maxLength}`, path);
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new ProtocolError("expected finite number", path);
      if (schema.minimum !== undefined && value < schema.minimum)
        throw new ProtocolError(`below minimum ${schema.minimum}`, path);
      if (schema.maximum !== undefined && value > schema.maximum)
        throw new ProtocolError(`above maximum ${schema.maximum}`, path);
      return value;
    case "integer":
      if (!Number.isInteger(value)) throw new ProtocolError("expected integer", path);
      return value;
    case "boolean":
      if (typeof value !== "boolean") throw new ProtocolError("expected boolean", path);
      return value;
    case "array": {
      if (!Array.isArray(value)) throw new ProtocolError("expected array", path);
      return value.map((item, i) => check(item, schema.items, `${path}[${i}]`));
    }
    case "object": {
      if (!isObject(value)) throw new ProtocolError("expected object", path);
      for (const key of schema.required ?? []) {
        if (value[key] === undefined) throw new ProtocolError(`missing required "${key}"`, path);
      }
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (value[key] !== undefined) check(value[key], sub, `${path}.${key}`);
      }
      return value;
    }
    default:
      throw new ProtocolError(`unsupported schema type ${schema.type}`, path);
  }
};

const SearchResult = {
  type: "object",
  required: ["id", "title", "score"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    score: { type: "number", minimum: 0, maximum: 1 },
    snippet: { type: "string" },
    url: { type: "string" },
  },
};

const SearchResponse = {
  type: "object",
  required: ["query", "took_ms", "total", "results"],
  properties: {
    query: { type: "string" },
    took_ms: { type: "number", minimum: 0 },
    total: { type: "integer", minimum: 0 },
    results: { type: "array", items: SearchResult },
  },
};

const Document = {
  type: "object",
  required: ["id", "title", "text"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    text: { type: "string" },
    url: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        required: ["heading", "text"],
        properties: { heading: { type: "string" }, text: { type: "string" } },
      },
    },
  },
};

const Health = {
  type: "object",
  required: ["status", "index"],
  properties: {
    status: { type: "string", enum: ["ok"] },
    index: {
      type: "object",
      required: ["documents", "embeddings"],
      properties: {
        documents: { type: "integer" },
        embeddings: { type: "integer" },
        build_time: { type: "string" },
      },
    },
  },
};

export const schemas = { SearchResponse, Document, Health };

export const validate = (schema, value) => check(value, schema);
