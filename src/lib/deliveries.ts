import "server-only";

import type { RowDataPacket } from "mysql2/promise";

import { ensureAdminSchema, getAccountPool, getCharacterPool } from "@/lib/db";
import type { DeliveryEntry, DeliveriesResponse } from "@/lib/types";

type MailRow = RowDataPacket & {
  Id: number; AccountID: number; CharID: number; CharName: string | null;
  ItemTblidx: number; ItemName: string; StackCount: number; RequestedBy: string;
  Status: string; ItemID: string | number | null; MailID: number | null;
  ErrorMessage: string | null; CreatedAt: Date; UpdatedAt: Date;
  ClaimedAt: Date | null; ClaimedByCharID: number | null;
};

type CashRow = RowDataPacket & {
  Id: number; AccountID: number; Username: string | null; ItemTblidx: number;
  ItemName: string; StackCount: number; RequestedBy: string; Status: string;
  ProductID: string | number | null; ErrorMessage: string | null;
  CreatedAt: Date; UpdatedAt: Date;
};

export async function listDeliveries(input: {
  channel: "all" | "mail" | "cashshop";
  status: "all" | "pending" | "processing" | "applied" | "claimed" | "failed";
  search: string;
  page: number;
  pageSize: number;
}): Promise<DeliveriesResponse> {
  await ensureAdminSchema();
  const accountPool = getAccountPool();
  const characterPool = getCharacterPool();
  const [mailRows, cashRows] = await Promise.all([
    input.channel === "cashshop" ? Promise.resolve([] as MailRow[]) : characterPool.query<MailRow[]>(`SELECT
      q.Id,q.AccountID,q.CharID,c.CharName,q.ItemTblidx,q.ItemName,q.StackCount,q.RequestedBy,
      q.Status,q.ItemID,q.MailID,q.ErrorMessage,q.CreatedAt,q.UpdatedAt,q.ClaimedAt,q.ClaimedByCharID
      FROM admin_mail_items q LEFT JOIN characters c ON c.CharID=q.CharID ORDER BY q.Id DESC LIMIT 5000`).then(([rows]) => rows),
    input.channel === "mail" ? Promise.resolve([] as CashRow[]) : accountPool.query<CashRow[]>(`SELECT
      q.Id,q.AccountID,a.Username,q.ItemTblidx,q.ItemName,q.StackCount,q.RequestedBy,q.Status,
      q.ProductID,q.ErrorMessage,q.CreatedAt,q.UpdatedAt
      FROM admin_cashshop_items q LEFT JOIN accounts a ON a.AccountID=q.AccountID ORDER BY q.Id DESC LIMIT 5000`).then(([rows]) => rows),
  ]);

  const missingAccountIds = [...new Set(mailRows.map((row) => row.AccountID))];
  const usernames = new Map<number, string>();
  if (missingAccountIds.length) {
    const placeholders = missingAccountIds.map(() => "?").join(",");
    const [rows] = await accountPool.query<(RowDataPacket & { AccountID: number; Username: string })[]>(
      `SELECT AccountID,Username FROM accounts WHERE AccountID IN (${placeholders})`, missingAccountIds,
    );
    rows.forEach((row) => usernames.set(row.AccountID, row.Username));
  }

  const deliveries: DeliveryEntry[] = [
    ...mailRows.map((row) => ({
      id: row.Id, channel: "mail" as const, accountId: row.AccountID,
      username: usernames.get(row.AccountID) ?? null, characterId: row.CharID,
      characterName: row.CharName, itemTblidx: row.ItemTblidx, itemName: row.ItemName,
      quantity: row.StackCount, requestedBy: row.RequestedBy, status: row.Status,
      deliveryId: row.MailID, itemInstanceId: row.ItemID === null ? null : String(row.ItemID),
      errorMessage: row.ErrorMessage, createdAt: row.CreatedAt.toISOString(),
      updatedAt: row.UpdatedAt.toISOString(), claimedAt: row.ClaimedAt?.toISOString() ?? null,
      claimedByCharacterId: row.ClaimedByCharID,
    })),
    ...cashRows.map((row) => ({
      id: row.Id, channel: "cashshop" as const, accountId: row.AccountID,
      username: row.Username, characterId: null, characterName: null,
      itemTblidx: row.ItemTblidx, itemName: row.ItemName, quantity: row.StackCount,
      requestedBy: row.RequestedBy, status: row.Status,
      deliveryId: row.ProductID === null ? null : Number(row.ProductID), itemInstanceId: null,
      errorMessage: row.ErrorMessage, createdAt: row.CreatedAt.toISOString(),
      updatedAt: row.UpdatedAt.toISOString(), claimedAt: null, claimedByCharacterId: null,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const needle = input.search.toLocaleLowerCase("pt-BR");
  const filtered = deliveries.filter((entry) => {
    if (input.status !== "all" && entry.status !== input.status) return false;
    if (!needle) return true;
    return [entry.username, entry.characterName, entry.itemName, entry.accountId, entry.characterId, entry.itemTblidx]
      .some((value) => String(value ?? "").toLocaleLowerCase("pt-BR").includes(needle));
  });
  const counts = filtered.reduce((result, entry) => {
    result.total += 1;
    if (entry.status === "claimed") result.claimed += 1;
    if (entry.status === "applied") result.available += 1;
    if (entry.status === "failed") result.failed += 1;
    return result;
  }, { total: 0, claimed: 0, available: 0, failed: 0 });
  const totalPages = Math.max(1, Math.ceil(filtered.length / input.pageSize));
  const page = Math.min(input.page, totalPages);
  return { deliveries: filtered.slice((page - 1) * input.pageSize, page * input.pageSize), page,
    pageSize: input.pageSize, total: filtered.length, totalPages, counts };
}
