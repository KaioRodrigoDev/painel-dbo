// Chamado uma vez quando o servidor do Next sobe (dev e produção).
//
// O import fica DENTRO do `if`, não depois de um `return` antecipado: o bundler substitui
// `process.env.NEXT_RUNTIME` por uma constante em cada compilação e descarta o ramo morto com
// tudo que ele importa. Com um `return` antes, o import continua no corpo da função e é
// rastreado também na compilação do navegador, onde nenhum `node:` resolve -- o painel passa
// a responder 500 em todas as páginas com `UnhandledSchemeError`, e só com `next dev
// --webpack`, que é como este projeto roda (ver ATIVIDADE_CATALOGO_SKILLS_PAINEL_ADMIN.md).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportGameFolders } = await import("@/lib/startup-report");
    await reportGameFolders().catch((error: unknown) => console.warn("[painel] não consegui conferir as pastas do jogo:", error));
  }
}
