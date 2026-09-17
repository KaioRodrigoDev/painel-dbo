import "server-only";
import { createHash } from "node:crypto";

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { ensureAdminSchema, getAccountPool, getCharacterPool } from "@/lib/db";
import { loadCashShopItemMappings, loadItemCatalog } from "@/lib/item-catalog";
import { hasVipExpiryColumn } from "@/lib/vip-schema";
import { describeMailPackage, getMailPackage } from "@/lib/mail-packages";

export type AdminMailRequest = { requestKey: string; accountId: number; itemTblidx: number; quantity: number; channel: "cashshop" | "mail"; charId?: number; message?: string; sealItem?: boolean };

export class AdminMailError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

async function resolveCashShopItem(itemTblidx: number, quantity: number) {
  const [catalog, mappings] = await Promise.all([loadItemCatalog(), loadCashShopItemMappings()]);
  const item = catalog.items.find(entry => entry.tblidx === itemTblidx);
  if (!item?.valid) throw new AdminMailError("Item inexistente ou inválido no catálogo do servidor.");
  const mapping = mappings.get(itemTblidx);
  if (!mapping) throw new AdminMailError("Este item não possui uma entrada na tabela do Cash Shop.", 409);
  const maxStack = Math.max(1, item.maxStack);
  if (quantity > maxStack) throw new AdminMailError(`Este item permite no máximo ${maxStack} por pilha.`);
  return { item, mapping };
}

const activeVipSql = (expirySupported: boolean) => expirySupported
  ? "vip=? AND (vip_expires_at IS NULL OR vip_expires_at > UTC_TIMESTAMP())"
  : "vip=?";

export async function requestAdminMail(input: AdminMailRequest, administrator: string) {
  await ensureAdminSchema();
  const pool = getAccountPool();
  const [{ item, mapping }, [accounts]] = await Promise.all([
    resolveCashShopItem(input.itemTblidx, input.quantity),
    pool.execute<(RowDataPacket & { Username: string })[]>(
      "SELECT Username FROM accounts WHERE AccountID=? LIMIT 1", [input.accountId]),
  ]);
  const account = accounts[0];
  if (!account) throw new AdminMailError("Conta não encontrada.", 404);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute<(RowDataPacket & { Id: number; Status: string; AccountID: number; ItemTblidx: number; StackCount: number })[]>(
      "SELECT Id,Status,AccountID,ItemTblidx,StackCount FROM admin_cashshop_items WHERE RequestKey=? LIMIT 1 FOR UPDATE", [input.requestKey]);
    if (existing[0]) {
      const same = existing[0].AccountID === input.accountId && existing[0].ItemTblidx === input.itemTblidx && existing[0].StackCount === input.quantity;
      if (!same) throw new AdminMailError("Identificador de envio já utilizado com outros dados.", 409);
      await connection.commit();
      return { id: existing[0].Id, status: existing[0].Status, duplicate: true };
    }
    const [result] = await connection.execute<ResultSetHeader>(`INSERT INTO admin_cashshop_items
      (RequestKey,AccountID,ItemTblidx,HLSitemTblidx,ItemName,StackCount,RequestedBy)
      VALUES (?,?,?,?,?,?,?)`, [input.requestKey, input.accountId, item.tblidx, mapping.tblidx,
      item.name.slice(0, 100), input.quantity, administrator.slice(0, 64)]);
    await connection.commit();
    return { id: result.insertId, status: "pending", duplicate: false, accountName: account.Username, itemName: item.name };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function previewVipMailGroup(level: number) {
  const pool = getAccountPool();
  const expirySupported = await hasVipExpiryColumn(pool);
  const [rows] = await pool.execute<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) total FROM accounts WHERE ${activeVipSql(expirySupported)}`, [level]);
  const total = Number(rows[0]?.total ?? 0);
  return { total, fullMailboxes: 0, eligible: total };
}

export async function requestVipGroupMail(input: { batchKey: string; vipLevel: number; itemTblidx: number; quantity: number }, administrator: string) {
  await ensureAdminSchema();
  const pool = getAccountPool();
  const expirySupported = await hasVipExpiryColumn(pool);
  const { item, mapping } = await resolveCashShopItem(input.itemTblidx, input.quantity);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute<(RowDataPacket & { Id: number; VipLevel: number; ItemTblidx: number; StackCount: number; RecipientCount: number })[]>(
      "SELECT Id,VipLevel,ItemTblidx,StackCount,RecipientCount FROM admin_cashshop_batches WHERE BatchKey=? FOR UPDATE", [input.batchKey]);
    if (existing[0]) {
      const same = existing[0].VipLevel === input.vipLevel && existing[0].ItemTblidx === input.itemTblidx && existing[0].StackCount === input.quantity;
      if (!same) throw new AdminMailError("Identificador de lote já utilizado com outros dados.", 409);
      await connection.commit();
      return { batchId: existing[0].Id, recipients: existing[0].RecipientCount, skipped: 0, duplicate: true };
    }
    const [accounts] = await connection.execute<(RowDataPacket & { AccountID: number })[]>(
      `SELECT AccountID FROM accounts WHERE ${activeVipSql(expirySupported)} FOR UPDATE`, [input.vipLevel]);
    if (accounts.length === 0) throw new AdminMailError("Nenhuma conta elegível neste grupo VIP.", 409);
    const [batch] = await connection.execute<ResultSetHeader>(`INSERT INTO admin_cashshop_batches
      (BatchKey,VipLevel,ItemTblidx,HLSitemTblidx,ItemName,StackCount,RequestedBy,RecipientCount)
      VALUES (?,?,?,?,?,?,?,?)`, [input.batchKey, input.vipLevel, item.tblidx, mapping.tblidx,
      item.name.slice(0, 100), input.quantity, administrator.slice(0, 64), accounts.length]);
    for (const account of accounts) {
      await connection.execute(`INSERT INTO admin_cashshop_items
        (RequestKey,AccountID,ItemTblidx,HLSitemTblidx,ItemName,StackCount,RequestedBy)
        VALUES (UUID(),?,?,?,?,?,?)`, [account.AccountID, item.tblidx, mapping.tblidx,
        item.name.slice(0, 100), input.quantity, administrator.slice(0, 64)]);
    }
    await connection.commit();
    return { batchId: batch.insertId, recipients: accounts.length, skipped: 0, duplicate: false };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

async function resolveMailItem(itemTblidx: number, quantity: number) {
  const catalog = await loadItemCatalog();
  const item = catalog.items.find(entry => entry.tblidx === itemTblidx);
  if (!item?.valid) throw new AdminMailError("Item inexistente ou inválido no catálogo do servidor.");
  if (quantity > Math.max(1, item.maxStack)) throw new AdminMailError(`Este item permite no máximo ${item.maxStack} por pilha.`);
  return item;
}

export async function requestCharacterMail(input: AdminMailRequest & { charId: number; message: string }, administrator: string) {
  await ensureAdminSchema();
  const item = await resolveMailItem(input.itemTblidx, input.quantity);
  const pool = getCharacterPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [character] = await connection.execute<(RowDataPacket & { CharName: string })[]>(
      "SELECT CharName FROM characters WHERE AccountID=? AND CharID=? LIMIT 1", [input.accountId, input.charId]);
    if (!character[0]) throw new AdminMailError("Personagem não pertence a esta conta.", 404);
    const [existing] = await connection.execute<(RowDataPacket & { Id: number; Status: string; AccountID: number; CharID: number; ItemTblidx: number; StackCount: number; Message: string; SealItem: number })[]>(
      "SELECT Id,Status,AccountID,CharID,ItemTblidx,StackCount,Message,SealItem FROM admin_mail_items WHERE RequestKey=? FOR UPDATE", [input.requestKey]);
    if (existing[0]) {
      const same = existing[0].AccountID === input.accountId && existing[0].CharID === input.charId && existing[0].ItemTblidx === input.itemTblidx && existing[0].StackCount === input.quantity && existing[0].Message === input.message && Boolean(existing[0].SealItem) === Boolean(input.sealItem);
      if (!same) throw new AdminMailError("Identificador de envio já utilizado com outros dados.", 409);
      await connection.commit();
      return { id: existing[0].Id, status: existing[0].Status, duplicate: true };
    }
    const [mailCount] = await connection.execute<(RowDataPacket & { total: number })[]>(
      "SELECT COUNT(*) total FROM mail WHERE CharID=?", [input.charId]);
    if (Number(mailCount[0]?.total ?? 0) >= 30) throw new AdminMailError("A caixa de correio está cheia (30 mensagens).", 409);
    const [result] = await connection.execute<ResultSetHeader>(`INSERT INTO admin_mail_items
      (RequestKey,AccountID,CharID,ItemTblidx,ItemName,StackCount,ItemRank,Durability,
       BattleAttribute,OptionTblidx,DurationType,UseDurationMax,Message,RequestedBy,SealItem)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [input.requestKey, input.accountId, input.charId,
      item.tblidx, item.name.slice(0, 100), input.quantity, item.rank, item.durability,
      item.battleAttribute, item.itemOptionTblidx, item.durationType, item.useDurationMax,
      input.message, administrator.slice(0, 64), input.sealItem ? 1 : 0]);
    await connection.execute(`INSERT INTO admin_mail_recipient_preferences (AccountID,CharID,UpdatedBy)
      VALUES (?,?,?) ON DUPLICATE KEY UPDATE CharID=VALUES(CharID),UpdatedBy=VALUES(UpdatedBy)`,
      [input.accountId, input.charId, administrator.slice(0, 64)]);
    await connection.commit();
    return { id: result.insertId, status: "pending", duplicate: false, characterName: character[0].CharName, itemName: item.name };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function listVipMailRecipients(level: number) {
  await ensureAdminSchema();
  const accountPool = getAccountPool();
  const expirySupported = await hasVipExpiryColumn(accountPool);
  const [accounts] = await accountPool.execute<(RowDataPacket & { AccountID: number; Username: string })[]>(
    `SELECT AccountID,Username FROM accounts WHERE ${activeVipSql(expirySupported)} ORDER BY Username`, [level]);
  if (!accounts.length) return [];
  const ids = accounts.map(account => account.AccountID);
  const [characters] = await getCharacterPool().query<(RowDataPacket & { AccountID: number; CharID: number; CharName: string; Level: number; PreferredCharID: number | null; MailCount: number; QueuedCount: number })[]>(`
    SELECT c.AccountID,c.CharID,c.CharName,c.Level,p.CharID PreferredCharID,
      (SELECT COUNT(*) FROM mail m WHERE m.CharID=c.CharID) MailCount,
      (SELECT COUNT(*) FROM admin_mail_items q WHERE q.CharID=c.CharID AND q.Status IN ('pending','processing')) QueuedCount
    FROM characters c LEFT JOIN admin_mail_recipient_preferences p ON p.AccountID=c.AccountID
    WHERE c.AccountID IN (?) ORDER BY c.AccountID,c.CharID`, [ids]);
  return accounts.map(account => {
    const choices = characters.filter(character => character.AccountID === account.AccountID);
    const slots = (character: typeof choices[number]) => Math.max(0, 30 - Number(character.MailCount) - Number(character.QueuedCount));
    const preferred = choices.find(character => character.CharID === character.PreferredCharID && slots(character) > 0);
    const firstAvailable = choices.find(character => slots(character) > 0);
    return { accountId: account.AccountID, username: account.Username,
      selectedCharId: preferred?.CharID ?? firstAvailable?.CharID ?? null,
      characters: choices.map(character => ({ charId: character.CharID, name: character.CharName, level: Number(character.Level), availableSlots: slots(character), mailboxFull: slots(character) <= 0 })) };
  });
}

export async function requestVipGroupCharacterMail(input: {
  batchKey: string; vipLevel: number; itemTblidx: number; quantity: number; message: string; sealItem?: boolean;
  recipients: { accountId: number; charId: number }[];
}, administrator: string) {
  await ensureAdminSchema();
  const item = await resolveMailItem(input.itemTblidx, input.quantity);
  const eligible = await listVipMailRecipients(input.vipLevel);
  const choices = new Map(eligible.map(account => [account.accountId, account]));
  if (!input.recipients.length) throw new AdminMailError("Selecione ao menos um personagem.", 409);
  for (const recipient of input.recipients) {
    const account = choices.get(recipient.accountId);
    const character = account?.characters.find(choice => choice.charId === recipient.charId);
    if (!character || character.mailboxFull) throw new AdminMailError(`Personagem inválido ou caixa cheia na conta #${recipient.accountId}.`, 409);
    choices.delete(recipient.accountId);
  }
  const connection = await getCharacterPool().getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute<(RowDataPacket & { Id: number; VipLevel: number; ItemTblidx: number; StackCount: number; Message: string; RecipientCount: number; SealItem: number })[]>(
      "SELECT Id,VipLevel,ItemTblidx,StackCount,Message,RecipientCount,SealItem FROM admin_mail_batches WHERE BatchKey=? FOR UPDATE", [input.batchKey]);
    if (existing[0]) {
      const same = existing[0].VipLevel === input.vipLevel && existing[0].ItemTblidx === input.itemTblidx && existing[0].StackCount === input.quantity && existing[0].Message === input.message && Boolean(existing[0].SealItem) === Boolean(input.sealItem);
      if (!same) throw new AdminMailError("Identificador de lote já utilizado com outros dados.", 409);
      await connection.commit();
      return { batchId: existing[0].Id, recipients: existing[0].RecipientCount, duplicate: true };
    }
    const [batch] = await connection.execute<ResultSetHeader>(`INSERT INTO admin_mail_batches
      (BatchKey,VipLevel,ItemTblidx,ItemName,StackCount,Message,RequestedBy,RecipientCount,SealItem)
      VALUES (?,?,?,?,?,?,?,?,?)`, [input.batchKey, input.vipLevel, item.tblidx,
      item.name.slice(0, 100), input.quantity, input.message, administrator.slice(0, 64), input.recipients.length, input.sealItem ? 1 : 0]);
    for (const recipient of input.recipients) {
      await connection.execute(`INSERT INTO admin_mail_items
        (RequestKey,AccountID,CharID,ItemTblidx,ItemName,StackCount,ItemRank,Durability,
         BattleAttribute,OptionTblidx,DurationType,UseDurationMax,Message,RequestedBy,SealItem)
        VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [recipient.accountId, recipient.charId,
        item.tblidx, item.name.slice(0, 100), input.quantity, item.rank, item.durability,
        item.battleAttribute, item.itemOptionTblidx, item.durationType, item.useDurationMax,
        input.message, administrator.slice(0, 64), input.sealItem ? 1 : 0]);
      await connection.execute(`INSERT INTO admin_mail_recipient_preferences (AccountID,CharID,UpdatedBy)
        VALUES (?,?,?) ON DUPLICATE KEY UPDATE CharID=VALUES(CharID),UpdatedBy=VALUES(UpdatedBy)`,
        [recipient.accountId, recipient.charId, administrator.slice(0, 64)]);
    }
    await connection.commit();
    return { batchId: batch.insertId, recipients: input.recipients.length, duplicate: false };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function requestMailPackage(input: {
  dispatchKey: string; packageId: string; message: string; sealItem?: boolean;
  accountId?: number; charId?: number; vipLevel?: number;
  recipients?: { accountId: number; charId: number }[];
}, administrator: string) {
  await ensureAdminSchema();
  const pkg = await getMailPackage(input.packageId);
  if (!pkg) throw new AdminMailError("Pacote não encontrado no servidor.", 404);
  const items = await describeMailPackage(pkg);
  const recipients = input.recipients ?? (input.accountId && input.charId ? [{ accountId: input.accountId, charId: input.charId }] : []);
  if (!recipients.length || recipients.length > 1000) throw new AdminMailError("Selecione de 1 a 1000 personagens.");
  if (items.length * recipients.length > 10000) throw new AdminMailError("Este lote possui envios demais.");
  const signature = createHash("sha256").update(JSON.stringify({ packageId: pkg.id, items: pkg.items,
    recipients, message: input.message, vipLevel: input.vipLevel ?? null, sealItem: Boolean(input.sealItem) })).digest("hex");
  if (input.vipLevel !== undefined) {
    const eligible = await listVipMailRecipients(input.vipLevel);
    const choices = new Map(eligible.map(row => [row.accountId, row]));
    for (const recipient of recipients) {
      const choice = choices.get(recipient.accountId);
      if (!choice?.characters.some(character => character.charId === recipient.charId)) throw new AdminMailError(`Destinatário inválido na conta #${recipient.accountId}.`, 409);
      choices.delete(recipient.accountId);
    }
  }
  const pool = getCharacterPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute<(RowDataPacket & { Id: number; PackageID: string; Signature: string; RecipientCount: number; ItemCount: number })[]>(
      "SELECT Id,PackageID,Signature,RecipientCount,ItemCount FROM admin_mail_package_dispatches WHERE DispatchKey=? FOR UPDATE", [input.dispatchKey]);
    if (existing[0]) {
      if (existing[0].PackageID !== pkg.id || existing[0].Signature !== signature) throw new AdminMailError("Identificador de envio já utilizado com outros dados.", 409);
      await connection.commit();
      return { id: existing[0].Id, recipients: existing[0].RecipientCount, items: existing[0].ItemCount, duplicate: true };
    }
    const seen = new Set<number>();
    for (const recipient of recipients) {
      if (seen.has(recipient.accountId)) throw new AdminMailError("Conta repetida na lista de destinatários.", 409);
      seen.add(recipient.accountId);
      const [characters] = await connection.execute<(RowDataPacket & { CharName: string })[]>(
        "SELECT CharName FROM characters WHERE AccountID=? AND CharID=? LIMIT 1 FOR UPDATE", [recipient.accountId, recipient.charId]);
      if (!characters[0]) throw new AdminMailError(`Personagem não pertence à conta #${recipient.accountId}.`, 409);
      const [counts] = await connection.execute<(RowDataPacket & { mailCount: number; queuedCount: number })[]>(`
        SELECT (SELECT COUNT(*) FROM mail WHERE CharID=?) mailCount,
          (SELECT COUNT(*) FROM admin_mail_items WHERE CharID=? AND Status IN ('pending','processing')) queuedCount`,
        [recipient.charId, recipient.charId]);
      if (Number(counts[0]?.mailCount ?? 0) + Number(counts[0]?.queuedCount ?? 0) + items.length > 30)
        throw new AdminMailError(`O correio de ${characters[0].CharName} não tem ${items.length} vagas livres.`, 409);
    }
    const [dispatch] = await connection.execute<ResultSetHeader>(`INSERT INTO admin_mail_package_dispatches
      (DispatchKey,PackageID,Signature,RecipientCount,ItemCount) VALUES (?,?,?,?,?)`,
      [input.dispatchKey, pkg.id, signature, recipients.length, items.length]);
    for (const recipient of recipients) {
      for (const entry of items) {
        const item = entry.item;
        await connection.execute(`INSERT INTO admin_mail_items
          (RequestKey,AccountID,CharID,ItemTblidx,ItemName,StackCount,ItemRank,Durability,
           BattleAttribute,OptionTblidx,DurationType,UseDurationMax,Message,RequestedBy,SealItem)
          VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [recipient.accountId, recipient.charId,
          item.tblidx, item.name.slice(0, 100), entry.quantity, item.rank, item.durability,
          item.battleAttribute, item.itemOptionTblidx, item.durationType, item.useDurationMax,
          input.message, administrator.slice(0, 64), input.sealItem ? 1 : 0]);
      }
      await connection.execute(`INSERT INTO admin_mail_recipient_preferences (AccountID,CharID,UpdatedBy)
        VALUES (?,?,?) ON DUPLICATE KEY UPDATE CharID=VALUES(CharID),UpdatedBy=VALUES(UpdatedBy)`,
        [recipient.accountId, recipient.charId, administrator.slice(0, 64)]);
    }
    await connection.commit();
    return { id: dispatch.insertId, recipients: recipients.length, items: items.length, duplicate: false };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
