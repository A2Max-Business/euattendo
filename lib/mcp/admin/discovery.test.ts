import { expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { allTools } from "../tools";
import { createAdminTools } from "./tools";
import type { McpAuthResult } from "../auth";

it("discovers the operational and administrative catalog through the MCP SDK", async () => {
  const auth: McpAuthResult = {
    organizationId: "org-a", apiTokenId: "token-a", role: "admin",
    actor: { type: "api_token", id: "token-a" },
    scopes: ["mcp:read", "mcp:write", "config:read", "config:write"],
  };
  const tools = [...allTools, ...createAdminTools(auth)];
  const server = new McpServer({ name: "discovery-regression", version: "1" });
  for (const tool of tools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema },
      async () => ({ content: [] }));
  }
  const client = new Client({ name: "discovery-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.listTools();
    expect(result.tools.map(tool => tool.name).sort()).toEqual(tools.map(tool => tool.name).sort());
    expect(result.tools.find(tool => tool.name === "crm_admin_create_automation")?.inputSchema.type).toBe("object");
  } finally {
    await client.close();
    await server.close();
  }
});
