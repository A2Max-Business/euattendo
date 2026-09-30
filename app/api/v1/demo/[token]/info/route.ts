import type { NextRequest, NextResponse } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { resolveDemoAgent } from "@/lib/demo/token-resolver";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ token: string }> };

export async function GET(_req: NextRequest, { params }: Context): Promise<NextResponse> {
  const { token } = await params;

  const result = await resolveDemoAgent(token);
  if (!result.ok) {
    if (result.reason === "invalid_token") {
      return fail("not_found", "Demonstração não encontrada ou token inválido.", 404);
    }
    return fail("service_unavailable", "Agente de demonstração temporariamente indisponível.", 503);
  }

  const agent = result.agent;

  return ok({
    agentName: agent.agentName,
    orgName: agent.orgName,
    welcomeMessage: agent.welcomeMessage,
    isDemo: true,
    isProvisional: agent.isProvisional,
  });
}