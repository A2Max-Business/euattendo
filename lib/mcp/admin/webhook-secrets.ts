import type { RuleActionInput } from "@/lib/webhooks/secrets";
import { configurationUrlReference, isConfigurationUrlReference } from "./url-reference";

/** Read responses omit ciphertext. Preserve it by exact destination, not array
 * position: editing/reordering an unrelated action must not silently remove HMAC.
 * Never accept client-selected ciphertext or carry a saved key to a new URL.
 */
export function preserveWebhookSecrets(
  incoming: RuleActionInput[], saved: RuleActionInput[],
): RuleActionInput[] {
  const secrets = new Map<string, Set<string>>();
  const urls = new Map<string, string>();
  function visit(actions: RuleActionInput[]) {
    for (const action of actions) {
      const config = action.config ?? {};
      if (action.type === "call_webhook" && typeof config.url === "string")
        urls.set(configurationUrlReference(config.url), config.url);
      if (action.type === "call_webhook" && typeof config.url === "string" && typeof config.secret_enc === "string") {
        const values = secrets.get(config.url) ?? new Set<string>();
        values.add(config.secret_enc);
        secrets.set(config.url, values);
      }
      if (action.type === "ai_decide" && Array.isArray(config.opcoes))
        for (const option of config.opcoes) if (option?.acao) visit([option.acao]);
    }
  }
  visit(saved);
  function merge(action: RuleActionInput): RuleActionInput {
    const config = { ...action.config };
    if (action.type === "call_webhook") {
      if (typeof config.url === "string" && isConfigurationUrlReference(config.url)) {
        const original = urls.get(config.url);
        if (!original) throw new Error("A referência de URL não pertence a esta regra. Consulte a regra novamente.");
        config.url = original;
      }
      if (config.secret_enc !== undefined) throw new Error("Não envie segredos cifrados. Informe um novo segredo ou omita para preservar.");
      if (config.secret !== undefined) return { ...action, config };
      const values = typeof config.url === "string" ? secrets.get(config.url) : undefined;
      if (values && values.size > 1) throw new Error("Há segredos diferentes para esta URL. Informe explicitamente o segredo da ação.");
      if (values?.size === 1) return { ...action, config: { ...config, secret_enc: [...values][0] } };
      return { ...action, config };
    }
    if (action.type === "ai_decide" && Array.isArray(config.opcoes)) return {
      ...action, config: { ...config, opcoes: config.opcoes.map(option => option?.acao
        ? { ...option, acao: merge(option.acao) } : option) },
    };
    return action;
  }
  return incoming.map(merge);
}
