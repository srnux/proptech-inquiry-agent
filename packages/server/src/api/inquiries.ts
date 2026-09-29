import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { connectInProcess } from "../agent/connect.js";
import { type AgentLimits, type ModelClient, runInquiry } from "@proptech/core";
import type { ServerDeps } from "../mcp/server.js";

const Body = z.object({ inquiry: z.string().trim().min(3).max(2000) });

export interface InquiryDeps {
  model: ModelClient;
  server: ServerDeps;
  limits?: Partial<AgentLimits>;
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * POST /inquiries {"inquiry": "..."}: runs the agent and streams `trace` events as tools run, then one
 * `result` event (reply, citations, hand-offs, trace, usage, outcome). A failure is one `error` event.
 */
export async function handleInquiry(body: unknown, res: ServerResponse, deps: InquiryDeps): Promise<void> {
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: 'Body must be {"inquiry": string} with 3 to 2000 characters.' }));
    return;
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const mcp = await connectInProcess(deps.server);
  try {
    const result = await runInquiry(
      {
        model: deps.model,
        mcp,
        limits: deps.limits,
        onEvent: (e) =>
          res.write(e.type === "trace" ? frame("trace", e.entry) : frame("guard", { violations: e.violations, repairing: e.repairing })),
      },
      parsed.data.inquiry,
    );
    res.write(frame("result", result));
  } catch (e) {
    console.error("Inquiry failed:", e);
    res.write(frame("error", { message: "The inquiry could not be processed. Please try again." }));
  } finally {
    await mcp.close();
    res.end();
  }
}

export async function readJson(req: IncomingMessage, limitBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limitBytes) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  if (!size) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
