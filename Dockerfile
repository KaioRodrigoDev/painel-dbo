# Painel administrativo (Next.js) para rodar na VPS atrás do Traefik.
#
# Usa o `output: 'standalone'` do next.config.ts: a imagem final leva o servidor gerado, não o
# node_modules nem o código-fonte.
#
# Os arquivos do jogo NÃO entram na imagem. As tabelas .rdf e os packs do cliente são montados
# como volume e achados pelas variáveis DBOW_EXECUTION_ENV e CLIENT_PACK_DIRECTORY. Publicar
# uma edição reescreve o .rdf montado, então esse volume precisa de escrita.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Rascunhos, backups dos .rdf e o log de auditoria são gravados em ./data (caminho fixo em
# src/lib/audit.ts e nos publicadores). Vira volume no compose; a pasta é criada aqui já com
# o dono certo, porque o processo não roda como root.
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["node", "server.js"]
