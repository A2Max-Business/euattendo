import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { resolveConfigurationAuth } from "@/lib/api/configuration-auth";
import { mfaEmDivida } from "@/lib/auth/server";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  PairingCodeError,
  pairingPhoneSchema,
  requestChannelPairingCode,
} from "@/lib/channels/pairing-code";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";
const input = z.object({ phone_number: pairingPhoneSchema }).strict();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const headers = { "Cache-Control": "no-store, max-age=0" };
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await resolveConfigurationAuth(req, "admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  if (authz.via === "session" && await mfaEmDivida())
    return fail("mfa_required", "Confirme a verificação em duas etapas.", 403, {
      requestId,
      headers,
    });
  const t = (text: string) => traduzir(text, authz.idioma);
  const path = z.object({ id: z.string().uuid() }).safeParse(await params);
  const body = input.safeParse(await req.json().catch(() => null));
  if (!path.success || !body.success)
    return fail(
      "validation_error",
      t("Informe o telefone completo com código do país e DDD."),
      400,
      { requestId, headers },
    );
  try {
    const result = await requestChannelPairingCode(
      await authz.getClient(),
      authz.organizationId,
      path.data.id,
      body.data.phone_number,
    );
    void audit({
      action: "channel.pairing_code_requested",
      actorUserId: authz.actorUserId,
    actorApiTokenId: authz.apiTokenId,
      organizationId: authz.organizationId,
      resourceType: "channel_session",
      resourceId: path.data.id,
      requestId,
    });
    return ok(result, { requestId, headers });
  } catch (error) {
    if (error instanceof PairingCodeError)
      return fail(error.code, t(error.message), error.status, {
        requestId,
        headers: { ...headers, ...(error.status === 429 ? { "Retry-After": "30" } : {}) },
      });
    return fail(
      "pairing_unavailable",
      t("Não foi possível gerar o código. Tente novamente."),
      502,
      { requestId, headers },
    );
  }
}
