import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { findClientPackNextToPanel, findExecutionEnvNextToPanel } from "@/lib/game-folders.mjs";

/**
 * Onde o painel encontra os arquivos do jogo.
 *
 * O painel nasceu dentro da pasta `dbow/`, ao lado de `DboServer/` e
 * `ClientRuntime_RealBase/`, e por isso os caminhos padrao sao relativos a
 * `process.cwd()/..`. Quem recebe o painel pronto quase nunca tem esse arranjo: a
 * instalacao do jogo esta em outro disco, com outro nome de pasta.
 *
 * Para esse caso existe DBOW_GAME_ROOT -- uma variavel so, apontando para a pasta que
 * contem `DboServer/` e `ClientRuntime_RealBase/`. Todo o resto e derivado dela.
 *
 * A ordem de precedencia e sempre a mesma, do mais especifico para o mais geral:
 *
 *   1. a variavel daquele arquivo (ex.: SKILL_TABLE_PATH)  -- ajuste pontual
 *   2. DBOW_GAME_ROOT                                      -- instalacao fora do repo
 *   3. o que estiver ao lado do painel (game-folders.mjs)  -- pasta do cliente com
 *      qualquer nome, ou o arranjo historico dentro do dbow/
 *   4. o caminho relativo historico, mesmo sem existir     -- para a mensagem de erro
 *                                                             mostrar onde ele procurou
 *
 * Manter (1) acima de (2) importa: quem tem a tabela de skill num lugar fora do padrao
 * continua conseguindo apontar so ela, sem abrir mao da raiz para o resto.
 */

const SUBPASTA_TABELAS = ["resource", "server_data", "table", "rdf"] as const;

/** Pasta ExecutionEnv do servidor, onde ficam os .exe, as configs e as tabelas. */
export function resolveExecutionEnv() {
  if (process.env.DBOW_EXECUTION_ENV) {
    return path.resolve(process.env.DBOW_EXECUTION_ENV);
  }

  if (process.env.DBOW_GAME_ROOT) {
    return path.resolve(process.env.DBOW_GAME_ROOT, "DboServer", "ExecutionEnv");
  }

  return findExecutionEnvNextToPanel() ?? path.resolve(process.cwd(), "..", "DboServer", "ExecutionEnv");
}

/**
 * Acha o arquivo mesmo quando so as maiusculas diferem.
 *
 * O painel nasceu no Windows, onde `table_text_all_data.rdf` e `Table_Text_All_Data.rdf` sao o
 * mesmo arquivo. No Linux nao sao, e os nomes gravados no codigo nem sempre batem com os da
 * instalacao. So varre a pasta quando o nome exato falha: em quem ja esta certo nao custa nada.
 */
function acharIgnorandoCaixa(pasta: string, nomeDoArquivo: string) {
  const exato = path.join(pasta, nomeDoArquivo);
  if (existsSync(/* turbopackIgnore: true */ exato)) return exato;

  try {
    const alvo = nomeDoArquivo.toLowerCase();
    const achado = readdirSync(/* turbopackIgnore: true */ pasta).find((item) => item.toLowerCase() === alvo);
    if (achado) return path.join(pasta, achado);
  } catch {
    // Pasta inexistente ou sem permissao: devolve o caminho exato, e quem for ler
    // produz a mensagem de erro com o caminho que procurou.
  }
  return exato;
}

/**
 * Uma tabela .rdf do servidor, pelo nome do arquivo.
 *
 * `variavelDeAjuste` e o nome da variavel de ambiente que sobrescreve so esta tabela.
 */
export function resolveServerTable(nomeDoArquivo: string, variavelDeAjuste?: string) {
  const ajuste = variavelDeAjuste ? process.env[variavelDeAjuste] : undefined;
  if (ajuste) return path.resolve(ajuste);

  return acharIgnorandoCaixa(path.join(/* turbopackIgnore: true */ resolveExecutionEnv(), ...SUBPASTA_TABELAS), nomeDoArquivo);
}

/** Pasta `pack` do cliente, onde ficam tbl.pak, gui.pak, tex.pak e as unidades. */
export function resolveClientPackDirectory() {
  if (process.env.CLIENT_PACK_DIRECTORY) {
    return path.resolve(process.env.CLIENT_PACK_DIRECTORY);
  }

  // ITEM_ICON_PACK_DIRECTORY veio antes de CLIENT_PACK_DIRECTORY e apontava para a
  // mesma pasta. Continua valendo para nao quebrar quem ja configurou so ela.
  if (process.env.ITEM_ICON_PACK_DIRECTORY) {
    return path.resolve(process.env.ITEM_ICON_PACK_DIRECTORY);
  }

  if (process.env.DBOW_GAME_ROOT) {
    return path.resolve(process.env.DBOW_GAME_ROOT, "ClientRuntime_RealBase", "pack");
  }

  return findClientPackNextToPanel() ?? path.resolve(process.cwd(), "..", "ClientRuntime_RealBase", "pack");
}
