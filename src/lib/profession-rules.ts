/**
 * Regras das receitas das oficinas de profissão (tabela profession_forge_recipe do mdbo_char),
 * copiadas do servidor do MDBO para o painel recusar antes de gravar o que o QueryServer recusaria:
 * - ForgeRecipeValid (DboShared/NtlShared2/NtlProfessionForge.h);
 * - ForgeSupportedRecipe e ForgeBatchAllowed (NtlProfessionForgePacket.h);
 * - ForgeMinerIdentity e o catálogo compilado (NtlMinerRecipes.h).
 *
 * O QueryServer só carrega as receitas habilitadas destes IDs, e uma receita habilitada inválida faz
 * o forgerecipesreload falhar inteiro (ProfessionForgeRepository::ReloadRecipeCache). Pelo banco
 * muda só nível, tempo, XP, quantidade produzida, quantidade de cada material e se está ativa.
 * Item produzido, materiais e profissão são a identidade compilada no servidor e no cliente: mudam
 * no tools/professions/miner-catalog.json, que gera o NtlMinerRecipes.h, e valem depois do build
 * (lib/profession-catalog.ts).
 *
 * Arquivo sem "server-only": o editor usa as mesmas funções para mostrar os lotes ao digitar.
 */

import type { ProfessionCatalogDraft, ProfessionCatalogInfo, ProfessionCatalogItemKind } from "@/lib/types";

export const PROFESSION_LIMITS = {
  /** PROFESSION_MAX_PROFICIENCY (NtlProfession.h). */
  maxLevel: 100,
  /** ForgeRecipeValid: até 7 dias. */
  maxSeconds: 604800,
  maxInputs: 4,
  /** FORGE_MAX_STACKS: pilhas de material numa ordem. */
  maxStacks: 8,
  maxByte: 255,
  /** XP × 10 cabe num DWORD (ForgeBatchAllowed com o lote de 10). */
  maxExperience: Math.floor(0xffffffff / 10),
  batches: [1, 5, 10] as const,
};

export const PROFESSION_BASE_NAMES: Record<number, string> = { 1: "Minerador", 2: "Coletor" };
export const PROFESSION_SPECIALIZATION_NAMES: Record<number, string> = {
  0: "", 1: "Armeiro", 2: "Armadureiro", 3: "Alquimista", 4: "Caçador", 5: "Micro engenheiro", 6: "Ferreiro", 7: "Runeiro",
};
/** Bancada que atende a receita (ForgeRecipeForBench). */
export const PROFESSION_BENCH_NAMES: Record<number, string> = { 1: "Oficina do Ferreiro", 2: "Oficina do Coletor" };

/** O que um ID tem de ser para o servidor aceitar a linha do banco (durabilidade null = não confere). */
export type ProfessionIdentity = {
  base: number; specialization: number; output: number; durability: number | null; outputCountFixed: boolean; inputs: number[];
};

/** Receitas fixas no código (ForgeSupportedRecipe), fora do catálogo. */
export const FIXED_IDENTITIES: ReadonlyMap<number, ProfessionIdentity> = new Map([
  // ForgeTestRecipe: a durabilidade é a máxima da picareta (ProfessionToolDefinition), não conferida aqui.
  [1, { base: 1, specialization: 6, output: 99000010, durability: null, outputCountFixed: true, inputs: [99000001] }],
  // CollectorTestRecipe.
  [2, { base: 2, specialization: 0, output: 99000022, durability: 0, outputCountFixed: true, inputs: [99000020] }],
]);

/** IDs reservados às receitas do catálogo (compileCatalog em miner-catalog.mjs). */
export const CATALOG_RECIPE_IDS = { min: 1001, max: 1999 } as const;
/** Especializações que a Oficina do Ferreiro aceita: Minerador puro ou Ferreiro (ForgeRecipeValid). */
export const CATALOG_SPECIALIZATIONS = [0, 6] as const;
/**
 * A migração gerada 20261029_blacksmith_pickaxes.sql exige as picaretas de Ferro e de Aço no
 * Ferreiro (blacksmithSql em miner-catalog.mjs); trocar a profissão delas quebra o gerador.
 */
const BLACKSMITH_PICKAXES = new Set([1002, 1003]);

const KIND_NAMES: Record<ProfessionCatalogItemKind, string> = {
  material: "material", tool: "ferramenta", tool_repair: "kit de ferramentas", equipment_repair: "kit de reparos",
};

/**
 * Por que o gerador do catálogo (compileCatalog) recusaria esta receita. O gerador confere de novo
 * ao gravar; aqui é para o editor mostrar enquanto a pessoa escolhe. `balance`: nível, tempo e XP
 * também vão para o catálogo (receita que ainda não está no banco).
 */
export function catalogDraftIssues(draft: ProfessionCatalogDraft, catalog: Pick<ProfessionCatalogInfo, "items" | "recipes">,
  { balance }: { balance: boolean }): string[] {
  const issues: string[] = [];
  const kinds = new Map(catalog.items.map((item) => [item.tblidx, item]));
  const L = PROFESSION_LIMITS;
  if (!(CATALOG_SPECIALIZATIONS as readonly number[]).includes(draft.specialization)) issues.push("Profissão: Minerador ou Ferreiro.");
  if (draft.id !== null && BLACKSMITH_PICKAXES.has(draft.id) && draft.specialization !== 6)
    issues.push("As picaretas de Ferro e de Aço (1002 e 1003) ficam no Ferreiro: a migração já gerada delas exige isso.");
  if (!draft.outputItem) issues.push("Escolha o item produzido.");
  const output = kinds.get(draft.outputItem);
  if (output?.kind === "tool" && draft.outputCount !== 1) issues.push("Ferramenta sai sempre 1 por receita.");
  if (!Number.isInteger(draft.outputCount) || draft.outputCount < 1 || draft.outputCount > L.maxByte)
    issues.push(`Quantidade produzida entre 1 e ${L.maxByte}.`);
  if (!draft.inputs.length || draft.inputs.length > L.maxInputs) issues.push(`De 1 a ${L.maxInputs} materiais.`);
  const seen = new Set<number>();
  draft.inputs.forEach((input, index) => {
    if (!input.item) issues.push(`Material ${index + 1}: escolha o item.`);
    else if (input.item === draft.outputItem) issues.push(`Material ${index + 1} é o próprio produto.`);
    else if (seen.has(input.item)) issues.push(`Material ${index + 1} repetido.`);
    seen.add(input.item);
    const kind = kinds.get(input.item)?.kind;
    if (kind && kind !== "material") issues.push(`Material ${index + 1} é ${KIND_NAMES[kind]} no catálogo; só material entra na receita.`);
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > L.maxByte) issues.push(`Material ${index + 1}: quantidade entre 1 e ${L.maxByte}.`);
  });
  const twin = catalog.recipes.find((recipe) => recipe.id !== draft.id && recipe.output === draft.outputItem);
  if (draft.outputItem && twin) issues.push(`A receita #${twin.id} já produz este item; cada item tem uma receita só no catálogo.`);
  // Ciclo (o gerador recusa): algum material, direta ou indiretamente, é feito a partir deste produto.
  const recipes = new Map(catalog.recipes.filter((recipe) => recipe.id !== draft.id).map((recipe) => [recipe.output, recipe.inputs]));
  recipes.set(draft.outputItem, draft.inputs.map((input) => input.item));
  const visiting = new Set<number>();
  const loops = (item: number): boolean => {
    if (visiting.has(item)) return item === draft.outputItem;
    visiting.add(item);
    const found = (recipes.get(item) ?? []).some(loops);
    visiting.delete(item);
    return found;
  };
  if (draft.outputItem && loops(draft.outputItem)) issues.push("Ciclo: um dos materiais é feito, direta ou indiretamente, a partir deste produto.");
  if (balance) {
    if (output?.kind === "tool" && output.requiredLevel !== null && draft.requiredLevel !== output.requiredLevel)
      issues.push(`Esta ferramenta é de nível ${output.requiredLevel}; a receita nova tem de exigir o mesmo nível.`);
    if (!Number.isInteger(draft.requiredLevel) || draft.requiredLevel < 1 || draft.requiredLevel > L.maxLevel) issues.push(`Nível exigido entre 1 e ${L.maxLevel}.`);
    if (!Number.isInteger(draft.durationSeconds) || draft.durationSeconds < 1 || draft.durationSeconds > L.maxSeconds)
      issues.push(`Tempo entre 1 segundo e ${L.maxSeconds / 86400} dias.`);
    if (!Number.isInteger(draft.experience) || draft.experience < 0 || draft.experience > L.maxExperience)
      issues.push(`XP entre 0 e ${L.maxExperience.toLocaleString("pt-BR")}.`);
  }
  return issues;
}

/** Uma receita como o servidor a lê: identidade + valores editáveis. */
export type ProfessionRecipeShape = {
  id: number;
  base: number;
  specialization: number;
  requiredLevel: number;
  durationSeconds: number;
  experience: number;
  outputItem: number;
  outputCount: number;
  outputDurability: number;
  inputItems: number[];
  amounts: number[];
};

/**
 * Por que o servidor recusaria a receita (vazio = aceita). Só faz diferença com a receita habilitada:
 * o QueryServer nem lê as desativadas. `identity` é a do catálogo compilado para este ID: null = o
 * ID não está no catálogo; undefined = não dá para conferir (catálogo não encontrado ou troca
 * pendente de build).
 */
export function professionRecipeIssues(recipe: ProfessionRecipeShape, identity: ProfessionIdentity | null | undefined): string[] {
  const issues: string[] = [];
  if (identity === null) issues.push("O servidor não carrega este ID: só as receitas 1, 2 e as do catálogo compilado (NtlMinerRecipes.h) existem no jogo.");
  else if (identity) {
    if (recipe.base !== identity.base || recipe.specialization !== identity.specialization)
      issues.push("Profissão/especialização diferente da compilada no servidor.");
    if (recipe.outputItem !== identity.output) issues.push(`Item produzido diferente do compilado (#${identity.output}).`);
    if (identity.durability !== null && recipe.outputDurability !== identity.durability)
      issues.push(`Durabilidade diferente da compilada (${identity.durability}).`);
    if (recipe.inputItems.length !== identity.inputs.length || recipe.inputItems.some((item, index) => item !== identity.inputs[index]))
      issues.push("Materiais diferentes dos compilados no servidor.");
    if (identity.outputCountFixed && recipe.outputCount !== 1) issues.push("Esta receita produz sempre 1 unidade.");
  }
  const L = PROFESSION_LIMITS;
  if (!Number.isInteger(recipe.requiredLevel) || recipe.requiredLevel < 1 || recipe.requiredLevel > L.maxLevel)
    issues.push(`Nível exigido entre 1 e ${L.maxLevel}.`);
  if (!Number.isInteger(recipe.durationSeconds) || recipe.durationSeconds < 1 || recipe.durationSeconds > L.maxSeconds)
    issues.push(`Tempo entre 1 segundo e ${L.maxSeconds / 86400} dias.`);
  if (!Number.isInteger(recipe.experience) || recipe.experience < 0 || recipe.experience > L.maxExperience)
    issues.push(`XP entre 0 e ${L.maxExperience.toLocaleString("pt-BR")}.`);
  if (!Number.isInteger(recipe.outputCount) || recipe.outputCount < 1 || recipe.outputCount > L.maxByte)
    issues.push(`Quantidade produzida entre 1 e ${L.maxByte}.`);
  if (!recipe.inputItems.length || recipe.inputItems.length > L.maxInputs) issues.push(`De 1 a ${L.maxInputs} materiais.`);
  recipe.amounts.forEach((amount, index) => {
    if (!Number.isInteger(amount) || amount < 1 || amount > L.maxByte) issues.push(`Material ${index + 1}: quantidade entre 1 e ${L.maxByte}.`);
  });
  if (new Set(recipe.inputItems).size !== recipe.inputItems.length) issues.push("Material repetido.");
  return issues;
}

/**
 * Lotes (1x, 5x, 10x) que a bancada deixa iniciar, como ForgeBatchAllowed: lote maior que 1 só
 * para item sem durabilidade e empilhável, o produto do lote cabe numa pilha e os materiais do lote
 * cabem em até 8 pilhas. `stacks` = byMax_Stack do item (produto e cada material), null se o item
 * não está na tabela.
 */
export function allowedBatches(recipe: ProfessionRecipeShape, outputStack: number | null, inputStacks: (number | null)[]): number[] {
  if (outputStack === null || inputStacks.some((stack) => stack === null)) return [];
  return PROFESSION_LIMITS.batches.filter((quantity) => {
    if (!outputStack || (quantity !== 1 && (recipe.outputDurability || outputStack === 1))) return false;
    if (recipe.outputCount * quantity > outputStack || recipe.experience * quantity > 0xffffffff) return false;
    let stacks = 0;
    for (let index = 0; index < recipe.amounts.length; index++) {
      const stack = inputStacks[index]!;
      if (!stack) return false;
      stacks += Math.ceil((recipe.amounts[index]! * quantity) / stack);
    }
    return stacks <= PROFESSION_LIMITS.maxStacks;
  });
}

/** "1 min 30 s", "2 h", "1 dia 3 h". */
export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const parts: string[] = [];
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (days) parts.push(`${days} dia${days > 1 ? "s" : ""}`);
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  if (rest) parts.push(`${rest} s`);
  return parts.slice(0, 2).join(" ");
}
