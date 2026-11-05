import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera um servidor com só o que o painel importa, em vez de depender do node_modules
  // inteiro -- é o que permite a imagem da VPS ficar pequena. As tabelas .rdf e os packs do
  // cliente continuam sendo lidos em tempo de execução, pelos caminhos das variáveis de
  // ambiente (ver src/lib/game-paths.ts); o rastreamento do build não os inclui, e não deve.
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
