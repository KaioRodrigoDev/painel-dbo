import "server-only";

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { ensureAdminSchema, getAccountPool, getCharacterPool } from "@/lib/db";
import { loadItemCatalog } from "@/lib/item-catalog";
import { getAccountDatabaseConfig } from "@/lib/env";

export type AdminMailRequest = {
  requestKey: string;
  accountId: number;
  itemTblidx: number;
  quantity: number;
  message: string;
};

export class AdminMailError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function requestAdminMail(input: AdminMailRequest, administrator: string) {
  await ensureAdminSchema();
  const accountPool = getAccountPool();
  const characterPool = getCharacterPool();
  const [[accountRows], [characterRows], catalog] = await Promise.all([
    accountPool.execute<(RowDataPacket & { vip: number; vip_expires_at: Date | null })[]>(
      "SELECT vip, vip_expires_at FROM accounts WHERE AccountID=? LIMIT 1", [input.accountId]),
    characterPool.execute<(RowDataPacket & { CharID: number; CharName: string })[]>(
      "SELECT CharID, CharName FROM characters WHERE AccountID=? ORDER BY CharID ASC LIMIT 1", [input.accountId]),
    loadItemCatalog(),
  ]);
  const account = accountRows[0];
  if (!account) throw new AdminMailError("Conta não encontrada.", 404);
  if (account.vip < 1 || account.vip > 3 || (account.vip_expires_at && account.vip_expires_at.getTime() <= Date.now())) {
    throw new AdminMailError("O envio pelo correio está disponível somente para contas VIP vigentes.", 409);
  }
  const character = characterRows[0];
  if (!character) throw new AdminMailError("Esta conta não possui personagem para receber o item.", 404);
  const item = catalog.items.find(entry => entry.tblidx === input.itemTblidx);
  if (!item?.valid) throw new AdminMailError("Item inexistente ou inválido no catálogo do servidor.");
  const maxStack = Math.max(1, item.maxStack);
  if (input.quantity > maxStack) throw new AdminMailError(`Este item permite no máximo ${maxStack} por pilha.`);

  const connection = await characterPool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute<(RowDataPacket & { Id: number; Status: string; AccountID: number; CharID: number; ItemTblidx: number; StackCount: number; Message: string })[]>(
      "SELECT Id,Status,AccountID,CharID,ItemTblidx,StackCount,Message FROM admin_mail_items WHERE RequestKey=? LIMIT 1 FOR UPDATE", [input.requestKey]);
    if (existing[0]) {
      const sameRequest = existing[0].AccountID === input.accountId && existing[0].CharID === character.CharID &&
        existing[0].ItemTblidx === input.itemTblidx && existing[0].StackCount === input.quantity && existing[0].Message === input.message;
      if (!sameRequest) throw new AdminMailError("Identificador de envio já utilizado com outros dados.", 409);
      await connection.commit();
      return { id: existing[0].Id, status: existing[0].Status, duplicate: true };
    }
    const [mailCount] = await connection.execute<(RowDataPacket & { total: number })[]>(
      "SELECT COUNT(*) total FROM mail WHERE CharID=?", [character.CharID]);
    if (Number(mailCount[0]?.total ?? 0) >= 30) throw new AdminMailError("A caixa de correio deste personagem está cheia (30 mensagens).", 409);
    const [result] = await connection.execute<ResultSetHeader>(`INSERT INTO admin_mail_items
      (RequestKey,AccountID,CharID,ItemTblidx,ItemName,StackCount,ItemRank,Durability,
       BattleAttribute,OptionTblidx,DurationType,UseDurationMax,Message,RequestedBy)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      input.requestKey, input.accountId, character.CharID, item.tblidx, item.name.slice(0, 100),
      input.quantity, item.rank, item.durability, item.battleAttribute, item.itemOptionTblidx,
      item.durationType, item.useDurationMax, input.message, administrator.slice(0, 64),
    ]);
    await connection.commit();
    return { id: result.insertId, status: "pending", duplicate: false, characterName: character.CharName, itemName: item.name };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

const activeVipSql = "a.vip=? AND (a.vip_expires_at IS NULL OR a.vip_expires_at > UTC_TIMESTAMP())";

export async function previewVipMailGroup(level: number) {
  await ensureAdminSchema();
  const accountDatabase = getAccountDatabaseConfig().database.replace(/`/g, "``");
  const [rows] = await getCharacterPool().execute<(RowDataPacket & { total: number; fullMailboxes: number })[]>(`
    SELECT COUNT(*) total,
      COALESCE(SUM((SELECT COUNT(*) FROM mail m WHERE m.CharID=c.CharID) >= 30),0) fullMailboxes
    FROM characters c
    JOIN (SELECT AccountID, MIN(CharID) CharID FROM characters GROUP BY AccountID) first_character
      ON first_character.AccountID=c.AccountID AND first_character.CharID=c.CharID
    JOIN \`${accountDatabase}\`.accounts a ON a.AccountID=c.AccountID
    WHERE ${activeVipSql}`, [level]);
  const total = Number(rows[0]?.total ?? 0);
  const fullMailboxes = Number(rows[0]?.fullMailboxes ?? 0);
  return { total, fullMailboxes, eligible: total - fullMailboxes };
}

export async function requestVipGroupMail(input: {
  batchKey: string; vipLevel: number; itemTblidx: number; quantity: number; message: string;
}, administrator: string) {
  await ensureAdminSchema();
  const catalog = await loadItemCatalog();
  const item = catalog.items.find(entry => entry.tblidx === input.itemTblidx);
  if (!item?.valid) throw new AdminMailError("Item inexistente ou inválido no catálogo do servidor.");
  const maxStack = Math.max(1, item.maxStack);
  if (input.quantity > maxStack) throw new AdminMailError(`Este item permite no máximo ${maxStack} por pilha.`);
  const accountDatabase = getAccountDatabaseConfig().database.replace(/`/g, "``");
  const connection = await getCharacterPool().getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute<(RowDataPacket & { Id: number; VipLevel: number; ItemTblidx: number; StackCount: number; Message: string; RecipientCount: number; SkippedCount: number })[]>(
      "SELECT Id,VipLevel,ItemTblidx,StackCount,Message,RecipientCount,SkippedCount FROM admin_mail_batches WHERE BatchKey=? FOR UPDATE", [input.batchKey]);
    if (existing[0]) {
      const same = existing[0].VipLevel === input.vipLevel && existing[0].ItemTblidx === input.itemTblidx && existing[0].StackCount === input.quantity && existing[0].Message === input.message;
      if (!same) throw new AdminMailError("Identificador de lote já utilizado com outros dados.", 409);
      await connection.commit();
      return { batchId: existing[0].Id, recipients: existing[0].RecipientCount, skipped: existing[0].SkippedCount, duplicate: true };
    }
    const preview = await previewVipMailGroup(input.vipLevel);
    if (preview.eligible === 0) throw new AdminMailError("Nenhum personagem elegível neste grupo VIP.", 409);
    const [batch] = await connection.execute<ResultSetHeader>(`INSERT INTO admin_mail_batches
      (BatchKey,VipLevel,ItemTblidx,ItemName,StackCount,Message,RequestedBy,RecipientCount,SkippedCount)
      VALUES (?,?,?,?,?,?,?,?,?)`, [input.batchKey, input.vipLevel, item.tblidx, item.name.slice(0, 100), input.quantity, input.message, administrator.slice(0, 64), preview.eligible, preview.fullMailboxes]);
    await connection.execute(`INSERT INTO admin_mail_items
      (RequestKey,AccountID,CharID,ItemTblidx,ItemName,StackCount,ItemRank,Durability,
       BattleAttribute,OptionTblidx,DurationType,UseDurationMax,Message,RequestedBy)
      SELECT UUID(),c.AccountID,c.CharID,?,?,?,?,?,?,?,?,?,?,?
      FROM characters c
      JOIN (SELECT AccountID, MIN(CharID) CharID FROM characters GROUP BY AccountID) first_character
        ON first_character.AccountID=c.AccountID AND first_character.CharID=c.CharID
      JOIN \`${accountDatabase}\`.accounts a ON a.AccountID=c.AccountID
      WHERE ${activeVipSql} AND (SELECT COUNT(*) FROM mail m WHERE m.CharID=c.CharID) < 30`, [
      item.tblidx, item.name.slice(0, 100), input.quantity, item.rank, item.durability,
      item.battleAttribute, item.itemOptionTblidx, item.durationType, item.useDurationMax,
      input.message, administrator.slice(0, 64), input.vipLevel,
    ]);
    await connection.commit();
    return { batchId: batch.insertId, recipients: preview.eligible, skipped: preview.fullMailboxes, duplicate: false };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
