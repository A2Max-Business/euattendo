import { describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ store: new Map<string, unknown>(), unavailable: false }));
vi.mock("@/lib/env", () => ({
  env: { UPSTASH_REDIS_REST_URL: "http://redis", UPSTASH_REDIS_REST_TOKEN: "test" },
}));
vi.mock("@upstash/redis", () => ({
  Redis: class {
    async set(k: string, v: unknown) {
      if (state.unavailable) throw new Error("offline");
      if (state.store.has(k)) return null;
      state.store.set(k, v);
      return "OK";
    }
    async get(k: string) {
      if (state.unavailable) throw new Error("offline");
      return state.store.get(k) ?? null;
    }
    async getdel(k: string) {
      if (state.unavailable) throw new Error("offline");
      const v = state.store.get(k) ?? null;
      state.store.delete(k);
      return v;
    }
  },
}));
import { guardarOAuth, consumirOAuth, chaveOAuth } from "./estado";
describe("estado OAuth compartilhado", () => {
  it("consome o código uma vez mesmo com trocas concorrentes", async () => {
    await guardarOAuth("code", "secret-code", { organizationId: "a" }, 300);
    const results = await Promise.all([
      consumirOAuth("code", "secret-code"),
      consumirOAuth("code", "secret-code"),
    ]);
    expect(results.filter(Boolean)).toEqual([{ organizationId: "a" }]);
    expect(chaveOAuth("code", "secret-code")).not.toContain("secret-code");
  });
  it("falha fechada quando Redis está indisponível", async () => {
    state.unavailable = true;
    await expect(guardarOAuth("code", "x", {}, 300)).rejects.toThrow();
    await expect(consumirOAuth("code", "x")).rejects.toThrow();
    state.unavailable = false;
  });
});
