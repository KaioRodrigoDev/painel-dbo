export type VipChange = {
  requestId: string;
  operation: "edit" | "renew";
  level: number;
  duration: "15" | "30" | "60" | "date" | "keep";
  date?: string;
};

export function vipExpiry(change: VipChange, current: string | null, now = new Date()): string | null {
  if (!Number.isInteger(change.level) || change.level < 0 || change.level > 3) throw new Error("Nível VIP inválido.");
  if (change.level === 0) {
    if (change.operation === "renew") throw new Error("Selecione um nível para renovar.");
    return null;
  }
  const old = current ? new Date(current).getTime() : 0;
  let end: number;
  if (change.duration === "keep") {
    if (change.operation === "renew" || old <= now.getTime()) throw new Error("Selecione uma nova validade.");
    end = old;
  } else if (change.duration === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(change.date ?? "")) throw new Error("Data inválida.");
    const midnight = new Date(`${change.date}T00:00:00Z`);
    if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== change.date) throw new Error("Data inválida.");
    const nextDay = midnight.getTime() + 86400000;
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", timeZoneName: "shortOffset" }).formatToParts(new Date(nextDay));
    const offset = parts.find(part => part.type === "timeZoneName")?.value.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
    if (!offset) throw new Error("Não foi possível converter o fuso da data.");
    const offsetMinutes = (Number(offset[2]) * 60 + Number(offset[3] ?? 0)) * (offset[1] === "+" ? 1 : -1);
    end = nextDay - offsetMinutes * 60000;
    if (end <= now.getTime() || (change.operation === "renew" && end <= old)) throw new Error("A nova validade deve ser posterior à atual e ao momento presente.");
  } else {
    if (!["15", "30", "60"].includes(change.duration)) throw new Error("Prazo inválido.");
    end = (change.operation === "renew" ? Math.max(old, now.getTime()) : now.getTime()) + Number(change.duration) * 86400000;
  }
  if (end > Date.UTC(9999, 11, 31)) throw new Error("Data fora do limite.");
  return new Date(end).toISOString();
}

export function vipStatus(level: number, expiry: string | null, now = Date.now()) {
  if (level === 0) return "none";
  if (![1, 2, 3].includes(level)) return "invalid";
  if (!expiry) return "legacy";
  const remaining = Date.parse(expiry) - now;
  return remaining <= 0 ? "expired" : remaining <= 7 * 86400000 ? "expiring" : "active";
}
