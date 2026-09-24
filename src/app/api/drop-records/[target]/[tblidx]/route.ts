import { NextResponse } from "next/server";
import { z } from "zod";

import { describeDropUsage, findDropRecord, MAX_BAGS_PER_GROUP, MAX_ITEMS_PER_BAG, type RawGroup } from "@/lib/drop-catalog";
import { toDraftValues } from "@/lib/drop-drafts";
import { loadItemCatalog } from "@/lib/item-catalog";
import { authorizeApiRequest } from "@/lib/security";
import type { DropRecordResponse } from "@/lib/types";

export const runtime = "nodejs";

const paramsSchema = z.object({
  target: z.enum(["group", "bag"]),
  tblidx: z.coerce.number().int().min(1).max(4294967294),
});

/** eGAMERULE_TYPE, repetido aqui só para rotular os campos que o editor não grava. */
const GAME_RULE_NAMES = [
  "Mundo normal", "Batalha de ranque", "Torneio Mudosa", "Dojo", "Raide",
  "Masmorra definitiva", "Time Quest", "Tutorial", "Budokai - eliminatoria",
  "Budokai - principal", "Budokai - final", "Budokai mundial", "TLQ", "DWC",
  "Masmorra CC", "Masmorra do ceu",
];

function bitNames(flag: number, names: string[]) {
  if (flag === 0) return "—";
  if (flag === 0xffffffff) return "Todos";
  const matched = names.filter((_, bit) => (flag & (1 << bit)) !== 0);
  return matched.length ? matched.join(", ") : String(flag);
}

export async function GET(request: Request, { params }: { params: Promise<{ target: string; tblidx: string }> }) {
  if (!(await authorizeApiRequest(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "Registro inválido." }, { status: 400 });

  try {
    const { target, tblidx } = parsed.data;
    const record = await findDropRecord(target, tblidx);
    if (!record) return NextResponse.json({ error: "Registro não encontrado na tabela." }, { status: 404 });

    const values = toDraftValues(target, record);
    const labels: DropRecordResponse["labels"] = [];
    if (target === "bag") {
      const catalog = await loadItemCatalog();
      for (const slot of values.slots) {
        const item = catalog.items.find((entry) => entry.tblidx === slot.tblidx);
        labels.push({ tblidx: slot.tblidx, name: item?.name ?? `Item #${slot.tblidx}`, iconName: item?.iconName ?? "" });
      }
    } else {
      for (const slot of values.slots) {
        const bag = await findDropRecord("bag", slot.tblidx);
        labels.push({ tblidx: slot.tblidx, name: bag?.name ?? `Bag #${slot.tblidx}`, iconName: "" });
      }
    }

    // Os campos de alcance aparecem para conferência mas não são graváveis: ver o comentário
    // de DROP_FIELDS em drop-drafts.ts.
    let readOnly: DropRecordResponse["readOnly"];
    if (target === "bag") {
      readOnly = [{ label: "Posições no registro", value: `${values.slots.length} de ${MAX_ITEMS_PER_BAG}` }];
    } else {
      const group = record as RawGroup;
      readOnly = [
        { label: "Mob exclusivo", value: group.mobIndex === 0xffffffff || group.mobIndex === 0 ? "—" : String(group.mobIndex) },
        { label: "Regra de mundo", value: bitNames(group.worldRule, GAME_RULE_NAMES) },
        { label: "Tipo de mob", value: group.mobType === 0 ? "—" : group.mobType === 0xffffffff ? "Todos" : String(group.mobType) },
        { label: "Posições no registro", value: `${values.slots.length} de ${MAX_BAGS_PER_GROUP}` },
      ];
    }

    const response: DropRecordResponse = {
      target, tblidx,
      name: record.name || `${target === "bag" ? "Bag" : "Grupo"} #${tblidx}`,
      values, labels,
      usage: await describeDropUsage(target, tblidx),
      readOnly,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Falha ao ler o registro de drop", error);
    return NextResponse.json({ error: "Não foi possível ler as tabelas de drop." }, { status: 503 });
  }
}
