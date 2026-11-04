import "server-only";

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { resolveClientPackDirectory, resolveExecutionEnv } from "@/lib/game-paths";
import { CATALOG_RECIPE_IDS, catalogDraftIssues } from "@/lib/profession-rules";
import type { ProfessionBuildPart, ProfessionCatalogDraft, ProfessionCatalogInfo, ProfessionCatalogItemKind } from "@/lib/types";

/**
 * Catálogo das receitas da Oficina do Ferreiro no código do MDBO.
 *
 * Fonte: tools/professions/miner-catalog.json. O gerador (miner-catalog.mjs --write) produz o
 * DboShared/NtlShared2/NtlMinerRecipes.h, que o cliente, o GameServer e o QueryServer compilam, e as
 * migrações SQL. Por isso trocar produto, material ou profissão é: gravar o catálogo aqui → build
 * (dbobuildsubserver e dbobuildsubclient) → aplicar no banco. O painel sabe que falta build quando o
 * NtlMinerRecipes.h é mais novo que os executáveis.
 */

export class ProfessionCatalogError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

const CATALOG = ["tools", "professions", "miner-catalog.json"];
const GENERATOR = ["tools", "professions", "miner-catalog.mjs"];
const HEADER = ["DboShared", "NtlShared2", "NtlMinerRecipes.h"];
/** O que miner-catalog.mjs --write reescreve: voltam como estavam se o gerador recusar. */
const GENERATED = [
  HEADER,
  ["DboServer", "Database", "migrations", "20261023_miner_recipe_catalog.sql"],
  ["DboServer", "Database", "migrations", "20261028_activate_miner_recipes.sql"],
  ["DboServer", "Database", "migrations", "20261028_miner_recipes.sql"],
  ["DboServer", "Database", "migrations", "20261029_blacksmith_pickaxes.sql"],
];

type CatalogItem = {
  key: string; id: number; name: string; kind: ProfessionCatalogItemKind; existing?: boolean;
  maximumDurability?: number; requiredLevel?: number; [field: string]: unknown;
};
type CatalogRecipe = {
  id: number; key: string; category: "refining" | "component" | "tool" | "kit"; specialization?: number; level: number;
  output: string; outputCount: number; seconds?: number; experience?: number; inputs: { item: string; count: number }[];
  [field: string]: unknown;
};
type CatalogFile = {
  specialization: number; defaults: Record<string, { seconds: number; experience: number }>;
  items: CatalogItem[]; recipes: CatalogRecipe[]; [field: string]: unknown;
};

/** Uma receita como está no NtlMinerRecipes.h (sFORGE_RECIPE). */
export type CompiledRecipe = {
  id: number; base: number; specialization: number; level: number; seconds: number; experience: number;
  output: number; outputCount: number; durability: number; inputs: { item: number; count: number }[];
};

export type CatalogSnapshot = {
  root: string;
  file: CatalogFile;
  version: string;
  compiled: CompiledRecipe[];
  sourceChangedAt: Date;
  build: ProfessionBuildPart[];
};

/** Pasta do código do MDBO (a que tem tools/ e DboShared/): MDBO_SOURCE_ROOT ou dois níveis acima do ExecutionEnv. */
function resolveSourceRoot() {
  const candidates = [process.env.MDBO_SOURCE_ROOT, path.resolve(/* turbopackIgnore: true */ resolveExecutionEnv(), "..", "..")];
  return candidates.find((root): root is string => !!root &&
    existsSync(path.join(/* turbopackIgnore: true */ root, ...CATALOG)) && existsSync(path.join(/* turbopackIgnore: true */ root, ...HEADER))) ?? null;
}

const file = (root: string, parts: string[]) => path.join(/* turbopackIgnore: true */ root, ...parts);

export function parseRuntimeHeader(text: string): CompiledRecipe[] {
  const recipes: CompiledRecipe[] = [];
  const pattern = /\{(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),\{((?:\{\d+,\d+\},?)*)\}\}/g;
  for (const match of text.matchAll(pattern)) {
    const n = match.slice(1, 11).map(Number);
    const inputs = [...match[11]!.matchAll(/\{(\d+),(\d+)\}/g)].map((input) => ({ item: Number(input[1]), count: Number(input[2]) }));
    if (inputs.length !== n[9]) throw new ProfessionCatalogError(`NtlMinerRecipes.h: a receita #${n[0]} declara ${n[9]} materiais e lista ${inputs.length}.`, 500);
    recipes.push({ id: n[0]!, base: n[1]!, specialization: n[2]!, level: n[3]!, seconds: n[4]!, experience: n[5]!,
      output: n[6]!, outputCount: n[7]!, durability: n[8]!, inputs });
  }
  const declared = Number(/FORGE_MINER_RECIPE_COUNT\s*=\s*(\d+)/.exec(text)?.[1]);
  if (declared !== recipes.length) throw new ProfessionCatalogError(`NtlMinerRecipes.h: ${recipes.length} receitas lidas, o arquivo declara ${declared}.`, 500);
  return recipes;
}

async function modifiedAt(target: string) {
  return stat(/* turbopackIgnore: true */ target).then((info) => info.mtime, () => null);
}

/** Cada parte que compila o catálogo, com o executável mais antigo dela comparado ao NtlMinerRecipes.h. */
async function buildStatus(sourceChangedAt: Date): Promise<ProfessionBuildPart[]> {
  const executionEnv = resolveExecutionEnv();
  const client = path.resolve(/* turbopackIgnore: true */ resolveClientPackDirectory(), "..", "Client.exe");
  const parts = [
    { label: "Servidores", command: "dbobuildsubserver", files: ["QueryServer.exe", "GameServer.exe"].map((name) => path.join(/* turbopackIgnore: true */ executionEnv, name)) },
    { label: "Cliente", command: "dbobuildsubclient", files: [client] },
  ];
  return Promise.all(parts.map(async (part) => {
    const times = await Promise.all(part.files.map(modifiedAt));
    const oldest = times.some((time) => time === null) ? null : new Date(Math.min(...times.map((time) => time!.getTime())));
    return { ...part, builtAt: oldest?.toISOString() ?? null, stale: !oldest || oldest < sourceChangedAt };
  }));
}

export async function readProfessionCatalog(): Promise<CatalogSnapshot | { reason: string }> {
  const root = resolveSourceRoot();
  if (!root) return { reason: "Código do MDBO não encontrado (tools/professions/miner-catalog.json e DboShared/NtlShared2/NtlMinerRecipes.h). Aponte MDBO_SOURCE_ROOT no .env.local para a pasta MDBO." };
  const [text, header, headerInfo] = await Promise.all([
    readFile(file(root, CATALOG), "utf8"), readFile(file(root, HEADER), "utf8"), stat(file(root, HEADER)),
  ]);
  const catalog = JSON.parse(text) as CatalogFile;
  return {
    root, file: catalog, version: createHash("sha256").update(text).digest("hex"),
    compiled: parseRuntimeHeader(header), sourceChangedAt: headerInfo.mtime, build: await buildStatus(headerInfo.mtime),
  };
}

/** O resumo do catálogo que o editor usa (sem receitas pendentes: essas dependem do banco). */
export function catalogInfo(snapshot: CatalogSnapshot | { reason: string }): Omit<ProfessionCatalogInfo, "pendingIds" | "applyReady"> {
  if (!("root" in snapshot)) return { available: false, reason: snapshot.reason, version: "", items: [], recipes: [], sourceChangedAt: null, build: [], buildNeeded: false };
  const ids = new Map(snapshot.file.items.map((item) => [item.key, item.id]));
  return {
    available: true, reason: "", version: snapshot.version,
    items: snapshot.file.items.map((item) => ({ tblidx: item.id, kind: item.kind, requiredLevel: item.kind === "tool" ? item.requiredLevel ?? null : null })),
    recipes: snapshot.file.recipes.map((recipe) => ({ id: recipe.id, output: ids.get(recipe.output) ?? 0, inputs: recipe.inputs.map((input) => ids.get(input.item) ?? 0) })),
    sourceChangedAt: snapshot.sourceChangedAt.toISOString(),
    build: snapshot.build,
    buildNeeded: snapshot.build.some((part) => part.stale),
  };
}

/**
 * ForgeMinerIdentity: o servidor aceita `recipe` (linha do banco ou ordem congelada) para este ID?
 * Uma ordem iniciada antes de a receita passar ao Ferreiro (especialização 0) continua valendo.
 */
export function identityAccepts(expected: Pick<CompiledRecipe, "base" | "specialization" | "output" | "durability" | "inputs">,
  recipe: { base: number; specialization: number; output: number; durability: number; outputCount: number; inputs: number[] }, frozenOrder: boolean) {
  const legacyRole = frozenOrder && expected.specialization === 6 && recipe.specialization === 0;
  return recipe.base === expected.base && (recipe.specialization === expected.specialization || legacyRole) &&
    recipe.output === expected.output && recipe.durability === expected.durability &&
    recipe.inputs.length === expected.inputs.length && !(expected.durability && recipe.outputCount !== 1) &&
    expected.inputs.every((input, index) => recipe.inputs[index] === input.item);
}

/** sFORGE_RECIPE de uma ordem (character_forge_job.definition_hex, #pragma pack(1)). */
export function decodeFrozenRecipe(hex: string) {
  const bytes = Buffer.from(hex, "hex");
  if (bytes.length < 23) return null;
  const inputCount = bytes.readUInt8(22);
  if (inputCount > 4 || bytes.length < 23 + inputCount * 5) return null;
  return {
    id: bytes.readUInt32LE(0), base: bytes.readUInt8(4), specialization: bytes.readUInt8(5),
    output: bytes.readUInt32LE(16), outputCount: bytes.readUInt8(20), durability: bytes.readUInt8(21),
    inputs: Array.from({ length: inputCount }, (_, index) => bytes.readUInt32LE(23 + index * 5)),
  };
}

const ASSERTIONS: [RegExp, string][] = [
  [/Duplicate product/, "Outra receita do catálogo já produz este item."],
  [/Duplicate\/self-referencing input/, "Material repetido ou igual ao produto."],
  [/Unknown\/non-material input/, "Só itens do tipo material entram como material."],
  [/Circular recipe dependency/, "Ciclo: um material é feito a partir deste produto."],
  [/Category\/product mismatch/, "O tipo do produto não combina com a categoria da receita."],
  [/One to four inputs required/, "De 1 a 4 materiais."],
  [/require_blacksmith|1002,6,10|deepStrictEqual/, "As picaretas de Ferro e de Aço (1002 e 1003) têm de continuar no Ferreiro, nos níveis 10 e 20."],
];

function generatorMessage(output: string) {
  const known = ASSERTIONS.find(([pattern]) => pattern.test(output));
  if (known) return known[1];
  const line = output.split(/\r?\n/).find((entry) => /Error|assert/i.test(entry))?.trim();
  return `O gerador do catálogo recusou: ${line?.slice(0, 300) || "erro sem mensagem"}.`;
}

let writing: Promise<unknown> = Promise.resolve();
/** Uma gravação de catálogo por vez neste processo (o gerador reescreve vários arquivos). */
function exclusive<T>(task: () => Promise<T>) {
  const next = writing.then(task, task);
  writing = next.catch(() => undefined);
  return next;
}

export type CatalogItemInfo = { tblidx: number; name: string; maxStack: number | null };

/**
 * Grava profissão, produto e materiais de uma receita no miner-catalog.json e roda o gerador.
 * Nada muda no banco nem no jogo: vale depois do build e de aplicar no banco. `expectedVersion` é o
 * sha256 do catálogo que o editor abriu; `takenIds` são IDs já usados no banco (receita nova não
 * reaproveita).
 */
export function saveCatalogDraft(draft: ProfessionCatalogDraft, expectedVersion: string,
  describe: (tblidx: number) => CatalogItemInfo, takenIds: Set<number>,
  beforeWrite: (id: number, expected: Omit<CompiledRecipe, "id" | "level" | "seconds" | "experience" | "outputCount">) => Promise<void>) {
  return exclusive(async () => {
    const snapshot = await readProfessionCatalog();
    if (!("root" in snapshot)) throw new ProfessionCatalogError(snapshot.reason, 404);
    if (snapshot.version !== expectedVersion)
      throw new ProfessionCatalogError("O miner-catalog.json mudou depois que você abriu o editor (outra aba ou alguém editando o código). Atualize a lista e edite de novo.");
    const info = catalogInfo(snapshot);
    // Receita que ainda não está no banco leva nível, tempo e XP do catálogo; nas outras eles ficam no banco.
    const balance = draft.id === null || !takenIds.has(draft.id);
    const issues = catalogDraftIssues(draft, info, { balance });
    if (issues.length) throw new ProfessionCatalogError(issues.join(" "), 400);

    const catalog = snapshot.file;
    const itemFor = (tblidx: number) => {
      const existing = catalog.items.find((item) => item.id === tblidx);
      if (existing) return existing;
      const described = describe(tblidx);
      if (described.maxStack === null) throw new ProfessionCatalogError(`O item #${tblidx} não existe na Table_Item_Data.`, 400);
      let key = `item_${tblidx}`;
      while (catalog.items.some((item) => item.key === key)) key += "_";
      // Item que o jogo já tem, entra como material (o gerador não recria itens existentes).
      const added: CatalogItem = { key, id: tblidx, name: described.name.slice(0, 32) || `Item ${tblidx}`, kind: "material", existing: true };
      catalog.items.push(added);
      return added;
    };

    const output = itemFor(draft.outputItem);
    const inputs = draft.inputs.map((input) => ({ item: itemFor(input.item).key, count: input.count }));
    const category = output.kind === "tool" ? "tool" : output.kind === "material" ? null : "kit";
    let recipe = draft.id === null ? undefined : catalog.recipes.find((entry) => entry.id === draft.id);
    const previous = recipe ? structuredClone(recipe) : null;
    if (draft.id !== null && !recipe) throw new ProfessionCatalogError(`A receita #${draft.id} não está no miner-catalog.json.`, 404);

    if (!recipe) {
      const used = new Set([...catalog.recipes.map((entry) => entry.id), ...takenIds]);
      let id: number = CATALOG_RECIPE_IDS.min;
      while (used.has(id)) id++;
      if (id > CATALOG_RECIPE_IDS.max) throw new ProfessionCatalogError(`Não há ID livre de ${CATALOG_RECIPE_IDS.min} a ${CATALOG_RECIPE_IDS.max}.`);
      const kind = category ?? "refining";
      const defaults = catalog.defaults[kind];
      recipe = { id, key: output.key, category: kind, level: draft.requiredLevel, output: output.key, outputCount: draft.outputCount, inputs };
      if (draft.durationSeconds !== defaults?.seconds) recipe.seconds = draft.durationSeconds;
      if (draft.experience !== defaults?.experience) recipe.experience = draft.experience;
      catalog.recipes.push(recipe);
    } else {
      recipe.key = output.key;
      recipe.output = output.key;
      // Material produzido continua refino ou componente, como estava; ferramenta e kit têm a categoria do tipo.
      recipe.category = category ?? (recipe.category === "component" ? "component" : "refining");
      recipe.outputCount = output.kind === "tool" ? 1 : draft.outputCount;
      recipe.inputs = inputs;
      if (balance) {
        const defaults = catalog.defaults[recipe.category];
        recipe.level = draft.requiredLevel;
        if (draft.durationSeconds !== defaults?.seconds) recipe.seconds = draft.durationSeconds; else delete recipe.seconds;
        if (draft.experience !== defaults?.experience) recipe.experience = draft.experience; else delete recipe.experience;
      }
      if (output.kind === "tool" && output.requiredLevel) recipe.level = output.requiredLevel;
    }
    if (draft.specialization === catalog.specialization) delete recipe.specialization;
    else recipe.specialization = draft.specialization;

    await beforeWrite(recipe.id, {
      base: 1, specialization: draft.specialization, output: output.id,
      durability: output.kind === "tool" ? output.maximumDurability ?? 0 : 0, inputs: draft.inputs,
    });
    await writeCatalog(snapshot.root, catalog);
    return { id: recipe.id, previous, next: recipe };
  });
}

async function writeCatalog(root: string, catalog: CatalogFile) {
  const targets = [CATALOG, ...GENERATED].map((parts) => file(root, parts));
  const backups = await Promise.all(targets.map(async (target) => ({
    target, content: await readFile(/* turbopackIgnore: true */ target).catch(() => null), info: await stat(/* turbopackIgnore: true */ target).catch(() => null),
  })));
  const restore = () => Promise.all(backups.map(({ target, content }) => (content ? writeFile(/* turbopackIgnore: true */ target, content) : undefined)));

  await writeFile(/* turbopackIgnore: true */ file(root, CATALOG), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  try {
    await promisify(execFile)(process.execPath, [file(root, GENERATOR), "--write"], { cwd: path.dirname(file(root, GENERATOR)), timeout: 60_000, windowsHide: true });
  } catch (error) {
    await restore();
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    throw new ProfessionCatalogError(generatorMessage(`${failure.stderr ?? ""}\n${failure.stdout ?? ""}\n${failure.message ?? ""}`), 400);
  }
  // Header igual ao de antes (só mudou quantidade de material, por exemplo): mantém a data para o
  // painel não pedir um build que não muda nada.
  const header = backups[1]!;
  const now = await readFile(/* turbopackIgnore: true */ header.target).catch(() => null);
  if (header.content && header.info && now && header.content.equals(now)) await utimes(/* turbopackIgnore: true */ header.target, header.info.atime, header.info.mtime);
}
