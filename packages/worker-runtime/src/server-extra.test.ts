import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

const mockQuery = vi.mocked(query);

async function* makeStream(messages: object[]) {
  for (const m of messages) yield m;
}

const SUCCESS = { type: "result", subtype: "success", is_error: false, total_cost_usd: 0, stop_reason: "end_turn" };

async function startServer(): Promise<{ url: string; server: Server }> {
  const { makeHandler } = await import("./server.js");
  const server = createServer(makeHandler());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server };
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

async function parseSSE(res: Response): Promise<object[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l: string) => l.startsWith("data:"))
    .map((l: string) => JSON.parse(l.slice(5)) as object);
}

let url: string;
let server: Server;

beforeEach(async () => {
  vi.resetModules();
  mockQuery.mockReset();
  ({ url, server } = await startServer());
});

afterEach(async () => {
  await stopServer(server);
});

describe("POST /dispatch — model tier mapping", () => {
  it.each([
    ["opus", "claude-opus-4-6"],
    ["sonnet", "claude-sonnet-4-6"],
    ["haiku", "claude-haiku-4-5"],
  ])("maps tier %s to model %s", async (tier, expectedModel) => {
    mockQuery.mockReturnValue(makeStream([SUCCESS]) as ReturnType<typeof query>);

    await fetch(`${url}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "work", modelTier: tier }),
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ model: expectedModel }),
      }),
    );
  });

  it("defaults to sonnet for missing modelTier", async () => {
    mockQuery.mockReturnValue(makeStream([SUCCESS]) as ReturnType<typeof query>);

    await fetch(`${url}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "work" }),
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ model: "claude-sonnet-4-6" }),
      }),
    );
  });
});

describe("POST /dispatch — request validation", () => {
  it("returns 400 for invalid JSON", async () => {
    const res = await fetch(`${url}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json {{{",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty prompt string", async () => {
    const res = await fetch(`${url}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "", modelTier: "haiku" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown route", async () => {
    const res = await fetch(`${url}/unknown`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for GET /dispatch", async () => {
    const res = await fetch(`${url}/dispatch`);
    expect(res.status).toBe(404);
  });
});

describe("POST /dispatch — session ID in subsequent events", () => {
  it("session event carries a consistent ID across calls", async () => {
    mockQuery.mockReturnValue(makeStream([SUCCESS]) as ReturnType<typeof query>);

    const res = await fetch(`${url}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "work", modelTier: "haiku" }),
    });

    const events = await parseSSE(res);
    const session = events[0] as { type: string; sessionId: string };
    expect(session.type).toBe("session");
    // UUID format
    expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("echoes back provided sessionId", async () => {
    mockQuery.mockReturnValue(makeStream([SUCCESS]) as ReturnType<typeof query>);

    const res = await fetch(`${url}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "work", modelTier: "haiku", sessionId: "my-session-123" }),
    });

    const events = await parseSSE(res);
    const session = events[0] as { type: string; sessionId: string };
    expect(session.sessionId).toBe("my-session-123");
  });

  it("generates new sessionId when newSession=true", async () => {
    mockQuery.mockReturnValue(makeStream([SUCCESS]) as ReturnType<typeof query>);

    const res = await fetch(`${url}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "work", modelTier: "haiku", sessionId: "old-id", newSession: true }),
    });

    const events = await parseSSE(res);
    const session = events[0] as { type: string; sessionId: string };
    expect(session.sessionId).not.toBe("old-id");
    expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("POST /dispatch — Linear MCP", () => {
  it("wires Linear MCP when LINEAR_API_KEY is set", async () => {
    const original = process.env.LINEAR_API_KEY;
    process.env.LINEAR_API_KEY = "test-key-abc";

    mockQuery.mockReturnValue(makeStream([SUCCESS]) as ReturnType<typeof query>);

    await fetch(`${url}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "work", modelTier: "haiku" }),
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          mcpServers: expect.objectContaining({
            "linear-server": expect.objectContaining({ command: "npx" }),
          }),
        }),
      }),
    );

    process.env.LINEAR_API_KEY = original;
  });

  it("omits mcpServers when LINEAR_API_KEY is absent", async () => {
    const original = process.env.LINEAR_API_KEY;
    delete process.env.LINEAR_API_KEY;

    mockQuery.mockReturnValue(makeStream([SUCCESS]) as ReturnType<typeof query>);

    await fetch(`${url}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "work", modelTier: "haiku" }),
    });

    const callOpts = mockQuery.mock.calls[0][0].options as Record<string, unknown>;
    expect(callOpts.mcpServers).toBeUndefined();

    process.env.LINEAR_API_KEY = original;
  });
});
