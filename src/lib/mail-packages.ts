import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { loadItemCatalog } from "@/lib/item-catalog";

const directory = path.join(process.cwd(), "data", "mail-packages");
const uuid = z.string().uuid();
export const packageItemsSchema = z.array(z.object({ itemTblidx: z.number().int().positive(), quantity: z.number().int().min(1).max(254) }).strict()).min(1).max(20);
export const packageInputSchema = z.object({ name: z.string().trim().min(1).max(80), items: packageItemsSchema }).strict();
const storedSchema = packageInputSchema.extend({ id: uuid, createdAt: z.string(), updatedAt: z.string(), createdBy: z.string() }).strict();
export type MailPackage = z.infer<typeof storedSchema>;

function fileFor(id: string) {
  if (!uuid.safeParse(id).success) throw new Error("Identificador de pacote inválido.");
  return path.join(directory, `${id}.json`);
}

async function validateItems(items: z.infer<typeof packageItemsSchema>) {
  if (new Set(items.map(item => item.itemTblidx)).size !== items.length) throw new Error("O pacote contém itens repetidos.");
  const catalog = await loadItemCatalog();
  const itemMap = new Map(catalog.items.map(item => [item.tblidx, item]));
  return items.map(entry => {
    const item = itemMap.get(entry.itemTblidx);
    if (!item?.valid) throw new Error(`Item ${entry.itemTblidx} não existe no catálogo.`);
    if (entry.quantity > Math.max(1, item.maxStack)) throw new Error(`O item ${item.name} permite no máximo ${Math.max(1, item.maxStack)} por pilha.`);
    return { ...entry, item };
  });
}

export async function listMailPackages() {
  await mkdir(directory, { recursive: true });
  const files = (await readdir(directory)).filter(file => /^[a-f0-9-]+\.json$/i.test(file));
  const packages: MailPackage[] = [];
  for (const file of files) {
    try { packages.push(storedSchema.parse(JSON.parse(await readFile(path.join(directory, file), "utf8")))); }
    catch (error) { console.error(`Pacote inválido: ${file}`, error); }
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function getMailPackage(id: string) {
  try { return storedSchema.parse(JSON.parse(await readFile(fileFor(id), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function saveMailPackage(input: z.infer<typeof packageInputSchema>, administrator: string, id?: string) {
  const parsed = packageInputSchema.parse(input);
  await validateItems(parsed.items);
  await mkdir(directory, { recursive: true });
  const previous = id ? await getMailPackage(id) : null;
  if (id && !previous) throw new Error("Pacote não encontrado.");
  const now = new Date().toISOString();
  const result: MailPackage = { ...parsed, id: previous?.id ?? randomUUID(), createdAt: previous?.createdAt ?? now,
    updatedAt: now, createdBy: previous?.createdBy ?? administrator.slice(0, 64) };
  const target = fileFor(result.id);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(result, null, 2) + "\n", { encoding: "utf8", flag: "wx" }); await rename(temporary, target); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  return result;
}

export async function deleteMailPackage(id: string) {
  const existing = await getMailPackage(id);
  if (!existing) throw new Error("Pacote não encontrado.");
  await unlink(fileFor(id));
  return existing;
}

export async function describeMailPackage(pkg: MailPackage) { return validateItems(pkg.items); }
