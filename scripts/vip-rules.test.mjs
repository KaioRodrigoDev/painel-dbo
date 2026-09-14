import test from "node:test";
import assert from "node:assert/strict";
import { vipExpiry, vipStatus } from "../src/lib/vip-rules.ts";
const now = new Date("2026-09-05T12:00:00Z");
const change = { requestId: "test", operation: "edit", level: 1, duration: "30" };
test("concessão: todos os níveis e prazos", () => {
  for (const level of [1, 2, 3]) for (const duration of ["15", "30", "60"]) {
    assert.equal(Date.parse(vipExpiry({ ...change, level, duration }, null, now)) - now.getTime(), Number(duration) * 86400000);
  }
});
test("renovação preserva dias e recomeça após vencimento", () => {
  assert.equal(vipExpiry({ ...change, operation: "renew" }, "2026-09-15T12:00:00Z", now), "2026-10-15T12:00:00.000Z");
  assert.equal(vipExpiry({ ...change, operation: "renew" }, "2026-09-01T12:00:00Z", now), "2026-10-05T12:00:00.000Z");
});
test("data personalizada cobre todo o dia em São Paulo", () => {
  assert.equal(vipExpiry({ ...change, duration: "date", date: "2026-09-30" }, null, now), "2026-10-01T03:00:00.000Z");
  assert.throws(() => vipExpiry({ ...change, duration: "date", date: "2026-02-30" }, null, now));
  assert.throws(() => vipExpiry({ ...change, duration: "date", date: "2026-09-04" }, null, now));
});
test("renovação personalizada não reduz o prazo", () => {
  assert.throws(() => vipExpiry({ ...change, operation: "renew", duration: "date", date: "2026-09-10" }, "2026-09-15T12:00:00Z", now));
});
test("troca de nível preserva validade; remover limpa a data", () => {
  assert.equal(vipExpiry({ ...change, duration: "keep", level: 3 }, "2026-09-15T12:00:00Z", now), "2026-09-15T12:00:00.000Z");
  assert.equal(vipExpiry({ ...change, level: 0 }, "2026-09-15T12:00:00Z", now), null);
  assert.throws(() => vipExpiry({ ...change, duration: "keep" }, null, now));
  assert.throws(() => vipExpiry({ ...change, level: 4 }, null, now));
  assert.throws(() => vipExpiry({ ...change, level: 1.5 }, null, now));
});
test("estado usa limite exclusivo e distingue legado de expirado", () => {
  assert.equal(vipStatus(1, now.toISOString(), now.getTime()), "expired");
  assert.equal(vipStatus(1, "2026-09-05T12:00:01Z", now.getTime()), "expiring");
  assert.equal(vipStatus(2, null, now.getTime()), "legacy");
  assert.equal(vipStatus(0, null, now.getTime()), "none");
  assert.equal(vipStatus(5, null, now.getTime()), "invalid");
});
