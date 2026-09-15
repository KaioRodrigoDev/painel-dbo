"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ServerManagerPanel } from "@/components/server-manager-panel";
import { ItemCatalogPanel } from "@/components/item-catalog-panel";
import { SkillCatalogPanel } from "@/components/skill-catalog-panel";
import { SkillTreePanel } from "@/components/skill-tree-panel";
import { MobCatalogPanel } from "@/components/mob-catalog-panel";
import { PlayersOverview, VipBadge, VipEditor, vipDate, type VipAccount } from "@/components/vip-panel";
import { AdminMailEditor, VipGroupMailEditor } from "@/components/admin-mail-editor";
import { vipStatus } from "@/lib/vip-rules";

import type {
  AccountsResponse,
  CharacterSummary,
  EditableCharacterFields,
} from "@/lib/types";

type Props = {
  administrator: string;
  maxCharacterLevel: number;
};

function formatDate(value: string | null) {
  if (!value) return "Nunca";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function identityLabel(character: CharacterSummary) {
  return `Raça ${character.race ?? "-"} · Classe ${character.characterClass ?? "-"} · Gênero ${character.gender ?? "-"}`;
}

export function AdminDashboard({ administrator, maxCharacterLevel }: Props) {
  const router = useRouter();
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [editing, setEditing] = useState<{ character: CharacterSummary; cash: number } | null>(null);
  const [activeView, setActiveView] = useState<"overview" | "players" | "items" | "skills" | "skillTree" | "mobs" | "servers">("overview");
  const [vipLevel, setVipLevel] = useState("all");
  const [vipState, setVipState] = useState("all");
  const [vipEditing, setVipEditing] = useState<{ account: VipAccount; renew: boolean } | null>(null);
  const [mailingAccount, setMailingAccount] = useState<AccountsResponse["accounts"][number] | null>(null);
  const [groupMailLevel, setGroupMailLevel] = useState<number | null>(null);
  const [overviewVersion, setOverviewVersion] = useState(0);

  const loadAccounts = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), vipLevel, vipState });
    if (search) params.set("search", search);

    try {
      const response = await fetch(`/api/accounts?${params}`, {
        signal,
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as
        | AccountsResponse
        | { error?: string };
      if (!response.ok) {
        if (response.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("error" in body ? body.error : "Falha ao carregar contas.");
      }
      setData(body as AccountsResponse);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Falha ao carregar contas.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, router, search, vipLevel, vipState]);

  useEffect(() => {
    if (activeView !== "players") return;
    const controller = new AbortController();
    const request = window.setTimeout(() => {
      void loadAccounts(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(request);
      controller.abort();
    };
  }, [loadAccounts, activeView]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(draftSearch.trim());
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="dashboardShell">
      <header className="topbar">
        <div className="brandCompact">
          <div className="miniBall">★</div>
          <div><strong>Dbo World</strong><span>ADMIN CONTROL</span></div>
        </div>
        <nav className="dashboardNav" aria-label="Seções administrativas">
          <button className={activeView === "overview" ? "active" : ""} onClick={() => setActiveView("overview")}>Visão geral</button>
          <button className={activeView === "players" ? "active" : ""} onClick={() => setActiveView("players")}>Jogadores</button>
          <button className={activeView === "items" ? "active" : ""} onClick={() => setActiveView("items")}>Itens</button>
          <button className={activeView === "skills" ? "active" : ""} onClick={() => setActiveView("skills")}>Skills</button>
          <button className={activeView === "skillTree" ? "active" : ""} onClick={() => setActiveView("skillTree")}>Árvore de skills</button>
          <button className={activeView === "mobs" ? "active" : ""} onClick={() => setActiveView("mobs")}>Mobs</button>
          <button className={activeView === "servers" ? "active" : ""} onClick={() => setActiveView("servers")}>Servidores</button>
        </nav>
        <div className="adminIdentity">
          <span className="statusDot" />
          <span>{administrator}</span>
          <button className="ghostButton" onClick={logout}>Sair</button>
        </div>
      </header>

      {activeView === "overview" ? <section className="heroPanel"><div><div className="eyebrow">GESTÃO DE JOGADORES</div><h1>Visão geral</h1><p>Acompanhe suas contas, jogadores online e assinaturas VIP.</p></div></section> : activeView === "players" ? <section className="heroPanel">
        <div>
          <div className="eyebrow">GESTÃO DE JOGADORES</div>
          <h1>Contas e personagens</h1>
          <p>O QueryServer coordena o salvamento, a saída e a limpeza de cache.</p>
        </div>
        <div className="safetyCard"><span>◆</span><div><strong>Modo seguro</strong><small>Raça e classe são somente leitura neste MVP</small></div></div>
      </section> : activeView === "items" ? <section className="heroPanel">
        <div>
          <div className="eyebrow">CATÁLOGO DO JOGO</div>
          <h1>Itens do Dbo World</h1>
          <p>Consulte os dados carregados de Table_Item_Data.rdf sem modificar o servidor.</p>
        </div>
        <div className="safetyCard"><span>◆</span><div><strong>Somente leitura</strong><small>Esta aba não altera nem entrega itens a jogadores</small></div></div>
      </section> : activeView === "skills" ? <section className="heroPanel">
        <div>
          <div className="eyebrow">CATÁLOGO DO JOGO</div>
          <h1>Skills do Dbo World</h1>
          <p>Consulte requisitos, efeitos, progressão e ícones de Table_Skill_Data.rdf.</p>
        </div>
        <div className="safetyCard"><span>◆</span><div><strong>Somente leitura</strong><small>Esta aba não aprende nem modifica skills</small></div></div>
      </section> : activeView === "skillTree" ? <section className="heroPanel">
        <div>
          <div className="eyebrow">LAYOUT DO CLIENTE</div>
          <h1>Árvore de skills</h1>
          <p>Reorganize a grade que o jogador vê, arrastando os ícones entre as células.</p>
        </div>
        <div className="safetyCard"><span>◆</span><div><strong>Grava no cliente</strong><small>Publicar regrava o gui.pak; o jogador precisa reabrir o cliente</small></div></div>
      </section> : activeView === "mobs" ? <section className="heroPanel">
        <div><div className="eyebrow">CATÁLOGO DO JOGO</div><h1>Mobs do Dbo World</h1><p>Consulte atributos de combate e recompensas de Table_MOB_Data.rdf.</p></div>
        <div className="safetyCard"><span>◆</span><div><strong>Somente leitura</strong><small>Esta aba não altera o RDF nem mobs ativos</small></div></div>
      </section> : <section className="heroPanel">
        <div>
          <div className="eyebrow">INFRAESTRUTURA LOCAL</div>
          <h1>Servidores do Dbo World</h1>
          <p>Inicie, finalize e acompanhe cada processo sem abrir vários terminais.</p>
        </div>
        <div className="safetyCard"><span>◆</span><div><strong>Lista controlada</strong><small>Backups e executáveis desconhecidos nunca são iniciados</small></div></div>
      </section>}

      {activeView === "overview" ? <><PlayersOverview key={overviewVersion} onAccounts={(state = "all", level = "all") => { setVipState(state); setVipLevel(level); setPage(1); setSearch(""); setDraftSearch(""); setActiveView("players"); }} onRenew={account => setVipEditing({ account, renew: true })} onBulkMail={level => setGroupMailLevel(level)} />{actionMessage && <div className="successBanner" role="status">{actionMessage}</div>}</> : activeView === "players" ? <section className="contentPanel">
        <form className="searchBar" onSubmit={submitSearch}>
          <div className="searchInputWrap">
            <span aria-hidden="true">⌕</span>
            <input
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="Buscar por usuário ou ID da conta"
              maxLength={32}
            />
          </div>
          <button className="primaryButton compact" type="submit">Buscar</button>
          {search && <button className="ghostButton" type="button" onClick={() => { setDraftSearch(""); setSearch(""); setPage(1); }}>Limpar</button>}
        </form>

        <div className="vipFilters">
          <label>Nível VIP<select value={vipLevel} onChange={event => { setVipLevel(event.target.value); setPage(1); }}><option value="all">Todos os níveis</option><option value="0">Sem VIP</option>{[1, 2, 3].map(level => <option key={level} value={level}>VIP {level}</option>)}</select></label>
          <label>Situação<select value={vipState} onChange={event => { setVipState(event.target.value); setPage(1); }}><option value="all">Todas</option><option value="current">VIP vigente (inclui sem validade)</option><option value="active">Com prazo ativo</option><option value="expiring">Vencendo em até 7 dias</option><option value="expired">Vencidos</option><option value="legacy">Sem validade cadastrada</option><option value="none">Sem VIP</option><option value="invalid">Nível inválido</option></select></label>
        </div>
        <div className="listHeader">
          <div><strong>{data ? formatNumber(data.total) : "—"}</strong><span> contas encontradas</span></div>
          <button className="refreshButton" onClick={() => void loadAccounts()} disabled={loading}>↻ Atualizar</button>
        </div>

        {error && <div className="errorBanner"><strong>Falha na consulta</strong><span>{error}</span></div>}
        {actionMessage && <div className="successBanner"><strong>Solicitação registrada</strong><span>{actionMessage}</span></div>}
        {loading && <div className="loadingState"><span className="spinner" /> Consultando bancos do Dbo World...</div>}
        {!loading && data?.accounts.length === 0 && <div className="emptyState">Nenhuma conta encontrada para essa busca.</div>}

        {!loading && data && (
          <div className="accountList">
            {data.accounts.map((account) => (
              <details className="accountCard" key={account.accountId}>
                <summary>
                  <div className="avatar">{account.username.slice(0, 2).toUpperCase()}</div>
                  <div className="accountMain"><strong>{account.username}</strong><span>Conta #{account.accountId} · {account.email}</span></div>
                  <span className={`statusBadge ${account.status}`}>{account.status}</span>
                  {account.gameMaster && <span className="gmBadge">GM</span>}
                  <VipBadge account={account} />
                  <div className="accountMeta"><strong>{account.characters.length}</strong><span>personagens</span></div>
                  <span className="chevron">⌄</span>
                </summary>
                <div className="accountDetails">
                  <div className="vipAccountActions"><span>Validade VIP: <strong>{account.vip === 0 ? "Sem VIP" : data.vipExpirySupported ? vipDate(account.vipExpiresAt) : "Indisponível neste banco"}</strong></span>{["active", "expiring", "legacy"].includes(vipStatus(account.vip, account.vipExpiresAt)) && <button className="mailVipButton" onClick={() => setMailingAccount(account)}>✉ Enviar item</button>}<button className="secondaryButton" onClick={() => setVipEditing({ account, renew: false })}>Gerenciar VIP</button>{data.vipExpirySupported && <button className="secondaryButton" onClick={() => setVipEditing({ account, renew: true })}>Renovar VIP</button>}</div>
                  <div className="accountFacts">
                    <span>Último login <strong>{formatDate(account.lastLogin)}</strong></span>
                    <span>Cash <strong>{formatNumber(account.mallPoints)}</strong></span>
                    <span>Nível admin <strong>{account.adminLevel}</strong></span>
                  </div>
                  <div className="characterGrid">
                    {account.characters.map((character) => (
                      <article className="characterCard" key={character.charId}>
                        <div className="characterHeader">
                          <div><strong>{character.name}</strong><span>Personagem #{character.charId}</span></div>
                          {character.pendingUpdate ? (
                            <span className="pendingBadge">Alteração pendente</span>
                          ) : (
                            <span className={character.online ? "onlineBadge" : "offlineBadge"}>{character.online ? "Online" : "Offline"}</span>
                          )}
                        </div>
                        <div className="characterStats">
                          <span><small>Nível</small><strong>{character.level}</strong></span>
                          <span><small>Zeni</small><strong>{formatNumber(character.money)}</strong></span>
                          <span><small>SP</small><strong>{formatNumber(character.skillPoints)}</strong></span>
                        </div>
                        <p className="identityLine">{identityLabel(character)}</p>
                        {character.pendingUpdate && (
                          <p className="pendingLine">
                            Solicitado: nível {character.pendingUpdate.level}, {formatNumber(character.pendingUpdate.money)} zeni, {formatNumber(character.pendingUpdate.cash)} cash
                          </p>
                        )}
                        <button
                          className="secondaryButton"
                          disabled={Boolean(character.pendingUpdate)}
                          title={character.pendingUpdate ? "Aguarde o QueryServer concluir a solicitação" : "Editar personagem"}
                          onClick={() => setEditing({ character, cash: account.mallPoints })}
                        >
                          {character.pendingUpdate ? "Processamento pendente" : character.online ? "Editar e enviar à seleção" : "Editar personagem"}
                        </button>
                      </article>
                    ))}
                    {account.characters.length === 0 && <p className="muted">Esta conta não possui personagens.</p>}
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}

        {data && data.totalPages > 1 && (
          <nav className="pagination" aria-label="Paginação">
            <button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>← Anterior</button>
            <span>Página <strong>{data.page}</strong> de {data.totalPages}</span>
            <button disabled={page >= data.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Próxima →</button>
          </nav>
        )}
      </section> : activeView === "items" ? <section className="contentPanel"><ItemCatalogPanel /></section> : activeView === "skills" ? <section className="contentPanel"><SkillCatalogPanel /></section> : activeView === "skillTree" ? <section className="contentPanel"><SkillTreePanel /></section> : activeView === "mobs" ? <section className="contentPanel"><MobCatalogPanel /></section> : <section className="contentPanel"><ServerManagerPanel /></section>}

      {vipEditing && <VipEditor account={vipEditing.account} renew={vipEditing.renew} expirySupported={data?.vipExpirySupported ?? true} onClose={() => setVipEditing(null)} onSaved={message => { setVipEditing(null); setActionMessage(message); setOverviewVersion(value => value + 1); if (activeView === "players") void loadAccounts(); }} />}
      {mailingAccount && <AdminMailEditor account={mailingAccount} onClose={() => setMailingAccount(null)} onSaved={message => { setMailingAccount(null); setActionMessage(message); }} />}
      {groupMailLevel && <VipGroupMailEditor initialLevel={groupMailLevel} onClose={() => setGroupMailLevel(null)} onSaved={message => { setGroupMailLevel(null); setActionMessage(message); }} />}
      {editing && (
        <CharacterEditor
          character={editing.character}
          cash={editing.cash}
          maxLevel={maxCharacterLevel}
          onClose={() => setEditing(null)}
          onSaved={(message) => { setEditing(null); setActionMessage(message); void loadAccounts(); }}
        />
      )}
    </main>
  );
}

function CharacterEditor({ character, cash, maxLevel, onClose, onSaved }: {
  character: CharacterSummary;
  cash: number;
  maxLevel: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [values, setValues] = useState<EditableCharacterFields>({
    level: character.level,
    experience: character.experience,
    skillPoints: character.skillPoints,
    money: character.money,
    cash,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function setNumber(field: keyof EditableCharacterFields, rawValue: string) {
    const number = Number(rawValue);
    setValues((current) => ({ ...current, [field]: Number.isFinite(number) ? number : 0 }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch(`/api/characters/${character.charId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!response.ok) {
      setError(body.error ?? "Não foi possível salvar.");
      setPending(false);
      return;
    }
    onSaved(body.message ?? "Alteração aplicada ao personagem offline.");
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="editorModal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="modalHeader">
          <div><div className="eyebrow">ALTERAÇÃO COORDENADA</div><h2 id="editor-title">{character.name}</h2><p>#{character.charId} · {identityLabel(character)}</p></div>
          <button className="closeButton" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <form onSubmit={save}>
          <div className="formGrid">
            <label>Nível<input type="number" min={1} max={maxLevel} value={values.level} onChange={(event) => setNumber("level", event.target.value)} required /></label>
            <label>Experiência<input type="number" min={0} max={4294967295} value={values.experience} onChange={(event) => setNumber("experience", event.target.value)} required /></label>
            <label>Pontos de habilidade<input type="number" min={0} max={4294967295} value={values.skillPoints} onChange={(event) => setNumber("skillPoints", event.target.value)} required /></label>
            <label>Zeni<input type="number" min={0} max={4294967295} value={values.money} onChange={(event) => setNumber("money", event.target.value)} required /></label>
            <label>Cash<input type="number" min={0} max={4294967295} value={values.cash} onChange={(event) => setNumber("cash", event.target.value)} required /></label>
          </div>
          {character.online && <div className="disconnectNotice"><strong>Personagem online</strong><span>Ao salvar, ele será enviado à seleção antes da alteração administrativa.</span></div>}
          <div className="readonlyNotice"><strong>Campos protegidos</strong><span>Raça, classe, gênero e estado adulto exigirão integração adicional e não são editados diretamente.</span></div>
          {error && <div className="formError" role="alert">{error}</div>}
          <div className="modalActions"><button type="button" className="ghostButton" onClick={onClose}>Cancelar</button><button className="primaryButton compact" disabled={pending}>{pending ? "Enviando..." : character.online ? "Salvar e enviar à seleção" : "Solicitar alteração"}</button></div>
        </form>
      </section>
    </div>
  );
}
