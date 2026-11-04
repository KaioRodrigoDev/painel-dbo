import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveClientPackDirectory, resolveExecutionEnv } from "@/lib/game-paths";
import { describePackPassword, detectPackPassword } from "@/lib/pack-format";

/**
 * Escreve no console, ao subir o servidor, onde o painel achou o jogo. Quem recebe o
 * painel pronto confere ali se ele leu a pasta certa, antes de abrir qualquer aba.
 */
export async function reportGameFolders() {
  const pack = resolveClientPackDirectory();
  const tbl = path.join(pack, "tbl.pak");
  if (!existsSync(/* turbopackIgnore: true */ tbl)) {
    console.warn(`[painel] cliente: nenhum encontrado (procurei ${pack}). Ícones e árvores de skill não vão abrir.`);
  } else {
    try {
      const password = detectPackPassword(await readFile(/* turbopackIgnore: true */ tbl));
      console.log(`[painel] cliente: ${path.dirname(pack)} (senha do pack: ${describePackPassword(password)})`);
    } catch (error) {
      console.warn(`[painel] cliente: ${path.dirname(pack)} -- ${(error as Error).message}`);
    }
  }

  const executionEnv = resolveExecutionEnv();
  if (existsSync(/* turbopackIgnore: true */ executionEnv)) {
    console.log(`[painel] servidor: ${executionEnv}`);
  } else {
    console.warn(`[painel] servidor: nenhum encontrado (procurei ${executionEnv}). Catálogos de itens, skills e mobs não vão abrir.`);
  }
}
