import { describe, expect, it } from "vitest";
import { preserveWebhookSecrets } from "./webhook-secrets";
import { redactConfiguration } from "./configuration-tools";
const hook = (url: string, config = {}) => ({ type: "call_webhook", config: { url, ...config } });
describe("configuração sem devolver segredos", () => {
  it("preserva segredo salvo ao reenviar ações sem ciphertext e após reordenação", () => {
    const result = preserveWebhookSecrets([hook("https://b.test"), hook("https://a.test")],
      [hook("https://a.test", { secret_enc: "a" }), hook("https://b.test", { secret_enc: "b" })]);
    expect(result).toEqual([hook("https://b.test", { secret_enc: "b" }), hook("https://a.test", { secret_enc: "a" })]);
  });
  it("preserva dentro de opções de decisão e permite remover explicitamente", () => {
    const wrap = (acao: unknown) => ({ type: "ai_decide", config: { opcoes: [{ id: "opt", acao }] } });
    expect(preserveWebhookSecrets([wrap(hook("https://a.test"))], [wrap(hook("https://a.test", { secret_enc: "a" }))]))
      .toEqual([wrap(hook("https://a.test", { secret_enc: "a" }))]);
    expect(preserveWebhookSecrets([hook("https://a.test", { secret: "" })], [hook("https://a.test", { secret_enc: "a" })]))
      .toEqual([hook("https://a.test", { secret: "" })]);
  });
  it("recusa ciphertext fornecido externamente e segredo ambíguo", () => {
    expect(() => preserveWebhookSecrets([hook("https://a.test", { secret_enc: "forged" })], [])).toThrow();
    expect(() => preserveWebhookSecrets([hook("https://a.test")], [hook("https://a.test", { secret_enc: "a" }), hook("https://a.test", { secret_enc: "b" })])).toThrow();
  });
  it("não copia um segredo salvo para outra URL", () => {
    expect(preserveWebhookSecrets([hook("https://b.test")], [hook("https://a.test", { secret_enc: "a" })]))
      .toEqual([hook("https://b.test")]);
  });
  it("oculta credenciais em URL e restaura apenas referência da mesma regra", () => {
    const original = [hook("https://user:pass@hooks.test/secret-path?token=private", { secret_enc: "saved" })];
    const visible = redactConfiguration(original) as typeof original;
    expect(JSON.stringify(visible)).not.toMatch(/private|secret-path|user:pass|saved/);
    expect(preserveWebhookSecrets(visible, original)).toEqual(original);
    expect(() => preserveWebhookSecrets(visible, [])).toThrow(/não pertence/);
  });
});
