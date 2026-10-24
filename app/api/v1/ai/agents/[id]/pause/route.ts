import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/ai/agents/:id/pause (admin)
 *
 * Spec 10 §4.3. Grava só `paused_at`: a versão segue publicada e
 * `published_version_id` fica (nada vira 'superseded'). Quem cala o agente
 * pausado é quem lê `paused_at` — `lib/ai/agents/no-ar.ts` e o turno
 * (`inbound-turn.ts`, `pausedAt`).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { createAdminClient } from "@/lib/supabase/admin";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });

  const authz = await resolveAuthDual(req, { requestId, resource: "ai_agents", role: "admin", tokenRole: "admin", scope: "config:write" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.idioma ?? "pt-BR");
  const activeOrg = { orgId: authz.organizationId };
  const teto = await tetoDeEscritaDoToken(authz, "ai_agents_pause", requestId);
  if (teto) return teto;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("ai_agents")
    .select("id, published_version_id, archived_at")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (!existing) return fail("not_found", t("Agent não encontrado."), 404, { requestId });
  if (existing.archived_at) {
    return fail("state_conflict", "Agent arquivado.", 409, { requestId });
  }

  const previousVersionId = existing.published_version_id as string | null;

  const { error } = await admin
    .from("ai_agents")
    .update({ paused_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId);

  if (error) return fail("internal_error", "Erro ao pausar agent.", 500, { requestId });

  void audit({
    action: "ai_agent.paused",
    actorUserId: authz.actor.type === "user" ? authz.actor.id : null,
    actorApiTokenId: authz.apiTokenId ?? null,
    organizationId: activeOrg.orgId,
    resourceType: "ai_agent",
    resourceId: id,
    requestId,
    metadata: { previous_version_id: previousVersionId },
  });

  return ok(
    { id, published_version_id: previousVersionId, paused_at: new Date().toISOString() },
    { requestId },
  );
}
