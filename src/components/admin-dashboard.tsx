"use client";

import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { Icon, type IconName } from "@/components/icons";
import { ServerManagerPanel } from "@/components/server-manager-panel";
import { ItemCatalogPanel } from "@/components/item-catalog-panel";
import { SkillCatalogPanel } from "@/components/skill-catalog-panel";
import { SkillTreePanel } from "@/components/skill-tree-panel";
import { MobCatalogPanel } from "@/components/mob-catalog-panel";
import { RecipePanel } from "@/components/recipe-panel";
import { ProfessionRecipePanel } from "@/components/profession-recipe-panel";
import { BattlePassPanel } from "@/components/battle-pass-panel";
import { PlayersOverview, VipBadge, VipEditor, vipDate, type VipAccount } from "@/components/vip-panel";
import { AdminMailEditor, VipGroupMailEditor } from "@/components/admin-mail-editor";
import { DeliveryHistoryPanel } from "@/components/delivery-history-panel";
import { CrashReportPanel } from "@/components/crash-report-panel";
import { Pagination } from "@/components/pagination";

import type {
  AccountsResponse,
  CharacterSummary,
  EditableCharacterFields,
  GameIntegrations,
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

type View = "overview" | "players" | "deliveries" | "battlePass" | "items" | "skills" | "skillTree" | "mobs" | "recipes" | "professions" | "servers" | "crashes";
type Section = {
  id: View;
  label: string;
  group: string;
  icon: IconName;
  eyebrow: string;
  title: string;
  description: string;
  note: { title: string; text: string } | null;
};

// Uma fonte só para o menu lateral, o cabeçalho de cada página e a busca rápida.
const SECTIONS: Section[] = [
  { id: "overview", label: "Visão geral", group: "Jogadores", icon: "overview", eyebrow: "GESTÃO DE JOGADORES", title: "Visão geral", description: "Acompanhe suas contas, jogadores online e assinaturas VIP.", note: null },
  { id: "players", label: "Jogadores", group: "Jogadores", icon: "players", eyebrow: "GESTÃO DE JOGADORES", title: "Contas e personagens", description: "O QueryServer coordena o salvamento, a saída e a limpeza de cache.", note: { title: "Modo seguro", text: "Raça e classe são somente leitura neste MVP" } },
  { id: "deliveries", label: "Envios", group: "Jogadores", icon: "deliveries", eyebrow: "RASTREABILIDADE", title: "Envios de itens", description: "Acompanhe a fila, a entrega e a retirada dos itens enviados aos jogadores.", note: { title: "Comprovante permanente", text: "O resgate continua registrado mesmo após o correio ser apagado" } },
  // Configuração do passe no banco de personagens; o servidor só relê com @bp reload.
  { id: "battlePass", label: "Battle Pass", group: "Eventos", icon: "ticket", eyebrow: "EVENTOS DO JOGO", title: "Battle Pass", description: "Temporadas, missões e recompensas do passe, gravadas nas tabelas que o servidor lê.", note: { title: "Vale após @bp reload", text: "O jogo relê a configuração quando você roda @bp reload em cada canal" } },
  { id: "items", label: "Itens", group: "Catálogo do jogo", icon: "items", eyebrow: "CATÁLOGO DO JOGO", title: "Itens do MDBO", description: "Consulte os dados carregados de Table_Item_Data.rdf sem modificar o servidor.", note: { title: "Somente leitura", text: "Esta aba não altera nem entrega itens a jogadores" } },
  // A aba lista em modo de consulta, mas "Editar" abre o rascunho que publica no RDF.
  // Prometer somente leitura aqui contradiz o próprio botão.
  { id: "skills", label: "Skills", group: "Catálogo do jogo", icon: "skills", eyebrow: "CATÁLOGO DO JOGO", title: "Skills do MDBO", description: "Consulte requisitos, efeitos, progressão e ícones de Table_Skill_Data.rdf.", note: { title: "Edita com rascunho", text: "Nada muda até você revisar e publicar; não ensina skills a jogadores" } },
  { id: "skillTree", label: "Árvore de skills", group: "Catálogo do jogo", icon: "skillTree", eyebrow: "LAYOUT DO CLIENTE", title: "Árvore de skills", description: "Reorganize a grade que o jogador vê, arrastando os ícones entre as células.", note: { title: "Grava no cliente", text: "Publicar regrava o gui.pak; o jogador precisa reabrir o cliente" } },
  // Os atributos de combate continuam só de leitura, mas drops e skills passaram a ser
  // editáveis e publicáveis daqui -- dizer "somente leitura" aqui viraria promessa falsa.
  { id: "mobs", label: "Mobs", group: "Catálogo do jogo", icon: "mobs", eyebrow: "CATÁLOGO DO JOGO", title: "Mobs do MDBO", description: "Atributos, drops e skills de Table_MOB_Data.rdf e das tabelas de grupo e bag.", note: { title: "Drops e skills editáveis", text: "Atributos de combate são só leitura; drops e skills publicam no RDF com backup" } },
  { id: "recipes", label: "Receitas", group: "Catálogo do jogo", icon: "recipes", eyebrow: "HOIPOI MIX", title: "Receitas de fabricação", description: "Até 5 materiais e 3 resultados por receita, os mesmos limites que o jogo usa.", note: { title: "Edita com rascunho", text: "Criar ou mudar só vale depois de revisar e publicar; o RDF sai com backup" } },
  // Receitas das oficinas no banco de personagens; o QueryServer só relê com forgerecipesreload.
  { id: "professions", label: "Profissões", group: "Catálogo do jogo", icon: "scroll", eyebrow: "OFICINAS DE PROFISSÃO", title: "Receitas das profissões", description: "Nível, tempo, XP e quantidades vão direto para o banco. Profissão, produto, materiais e receitas novas vão para o catálogo compilado e pedem build.", note: { title: "Vale após forgerecipesreload", text: "Digite forgerecipesreload no console do QueryServer (ou reinicie) depois de gravar" } },
  // Crash do cliente: o launcher manda o Client.RPT para a API de contas (tabela launcher_crash_reports).
  { id: "crashes", label: "Erros do jogo", group: "Infraestrutura", icon: "bug", eyebrow: "ESTABILIDADE DO CLIENTE", title: "Erros do jogo", description: "Crashes do cliente enviados pelo launcher, agrupados pelo lugar do código onde o jogo quebrou.", note: { title: "Só leitura do jogo", text: "Marcar como visto ou corrigido muda só o painel; nada é enviado ao jogador" } },
  { id: "servers", label: "Servidores", group: "Infraestrutura", icon: "servers", eyebrow: "INFRAESTRUTURA LOCAL", title: "Servidores do MDBO", description: "Inicie, finalize e acompanhe cada processo sem abrir vários terminais.", note: { title: "Lista controlada", text: "Backups e executáveis desconhecidos nunca são iniciados" } },
];
const SECTION_GROUPS = [...new Set(SECTIONS.map((section) => section.group))];
const VIEW_IDS = new Set<string>(SECTIONS.map((section) => section.id));

// A aba ativa mora no hash da URL: recarregar mantém a aba e o "voltar" do navegador
// volta para a aba anterior.
function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
const readHash = () => window.location.hash.slice(1);
const readServerHash = () => "";

// Menu recolhido é preferência deste navegador; sem localStorage, o menu só fica aberto.
const SIDEBAR_KEY = "mdbo-admin-sidebar";
const sidebarListeners = new Set<() => void>();
function subscribeToSidebar(onChange: () => void) {
  sidebarListeners.add(onChange);
  return () => { sidebarListeners.delete(onChange); };
}
function readSidebarCollapsed() {
  try { return window.localStorage.getItem(SIDEBAR_KEY) === "collapsed"; } catch { return false; }
}
function writeSidebarCollapsed(collapsed: boolean) {
  try { window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "open"); } catch { /* fica só nesta sessão */ }
  sidebarListeners.forEach((listener) => listener());
}

const normalizeSearch = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

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
  const hash = useSyncExternalStore(subscribeToHash, readHash, readServerHash);
  const activeView: View = VIEW_IDS.has(hash) ? (hash as View) : "overview";
  const setActiveView = useCallback((view: View) => { window.location.hash = view; }, []);
  const sidebarCollapsed = useSyncExternalStore(subscribeToSidebar, readSidebarCollapsed, () => false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [vipLevel, setVipLevel] = useState("all");
  const [vipState, setVipState] = useState("all");
  const [vipEditing, setVipEditing] = useState<{ account: VipAccount; renew: boolean } | null>(null);
  const [mailingAccount, setMailingAccount] = useState<AccountsResponse["accounts"][number] | null>(null);
  const [groupMailLevel, setGroupMailLevel] = useState<number | null>(null);
  const [groupMailIntegrations, setGroupMailIntegrations] = useState<GameIntegrations | undefined>(undefined);
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

  function navigate(view: View) {
    setActiveView(view);
    setMenuOpen(false);
    setPaletteOpen(false);
  }

  // Ctrl+K (ou Cmd+K) abre a busca de seções de qualquer lugar; Esc fecha o menu do celular.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const section = SECTIONS.find((entry) => entry.id === activeView) ?? SECTIONS[0];

  return (
    <main className={`dashboardShell${sidebarCollapsed ? " sidebarCollapsed" : ""}${menuOpen ? " menuOpen" : ""}`}>
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="sidebarBrand">
          <Image src="/images/DB_1ST.png" alt="" width={36} height={36} priority className="brandOrb" />
          <div><strong>MDBO</strong><span>Painel admin</span></div>
        </div>
        <nav className="sidebarNav">
          {SECTION_GROUPS.map((group) => (
            <div className="navGroup" key={group}>
              <span className="navGroupLabel">{group}</span>
              {SECTIONS.filter((entry) => entry.group === group).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`navItem${entry.id === activeView ? " active" : ""}`}
                  aria-current={entry.id === activeView ? "page" : undefined}
                  title={sidebarCollapsed ? entry.label : undefined}
                  onClick={() => navigate(entry.id)}
                >
                  <Icon name={entry.icon} />
                  <span>{entry.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebarFooter">
          <div className="adminIdentity">
            <span className="avatar small">{administrator.slice(0, 2).toUpperCase()}</span>
            <div><strong>{administrator}</strong><small><span className="statusDot" /> Conectado</small></div>
          </div>
          <button type="button" className="iconButton" onClick={logout} title="Sair" aria-label="Sair"><Icon name="logout" /></button>
        </div>
      </aside>
      {menuOpen && <div className="sidebarScrim" aria-hidden="true" onClick={() => setMenuOpen(false)} />}

      <div className="appMain">
        <header className="appHeader">
          <button type="button" className="iconButton menuButton" onClick={() => setMenuOpen(true)} aria-label="Abrir menu"><Icon name="menu" /></button>
          <button
            type="button"
            className="iconButton collapseButton"
            onClick={() => writeSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
            title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
          >
            <Icon name="sidebar" />
          </button>
          <nav className="breadcrumb" aria-label="Você está em">
            <span>{section.group}</span>
            <span aria-hidden="true">/</span>
            <strong>{section.label}</strong>
          </nav>
          <button type="button" className="quickJump" onClick={() => setPaletteOpen(true)}>
            <Icon name="search" size={15} />
            <span>Ir para seção…</span>
            <kbd>Ctrl K</kbd>
          </button>
        </header>

        <div className="viewStage" key={activeView}>
      <section className="heroPanel">
        <div><div className="eyebrow">{section.eyebrow}</div><h1>{section.title}</h1><p>{section.description}</p></div>
        {section.note && <div className="safetyCard"><Icon name="shield" size={20} /><div><strong>{section.note.title}</strong><small>{section.note.text}</small></div></div>}
      </section>

      {activeView === "overview" ? <><PlayersOverview key={overviewVersion} onAccounts={(state = "all", level = "all") => { setVipState(state); setVipLevel(level); setPage(1); setSearch(""); setDraftSearch(""); setActiveView("players"); }} onRenew={account => setVipEditing({ account, renew: true })} onBulkMail={(level, integrations) => { setGroupMailLevel(level); setGroupMailIntegrations(integrations); }} />{actionMessage && <div className="successBanner" role="status">{actionMessage}</div>}</> : activeView === "players" ? <section className="contentPanel">
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
        {loading && <div className="loadingState"><span className="spinner" /> Consultando bancos do MDBO...</div>}
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
                  <div className="vipAccountActions"><span>Validade VIP: <strong>{account.vip === 0 ? "Sem VIP" : data.vipExpirySupported ? vipDate(account.vipExpiresAt) : "Indisponível neste banco"}</strong></span><button className="mailVipButton" disabled={!(data.integrations.mail || data.integrations.cashShop)} title={data.integrations.mail || data.integrations.cashShop ? undefined : "O QueryServer do MDBO ainda não entrega itens enviados pelo painel (correio e Cash Shop)"} onClick={() => setMailingAccount(account)}>✉ Enviar item</button><button className="secondaryButton" onClick={() => setVipEditing({ account, renew: false })}>Gerenciar VIP</button>{data.vipExpirySupported && <button className="secondaryButton" onClick={() => setVipEditing({ account, renew: true })}>Renovar VIP</button>}</div>
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
                          disabled={Boolean(character.pendingUpdate) || !data.integrations.characterEdits}
                          title={!data.integrations.characterEdits ? "O QueryServer do MDBO ainda não aplica edições feitas pelo painel; a solicitação ficaria pendente para sempre" : character.pendingUpdate ? "Aguarde o QueryServer concluir a solicitação" : "Editar personagem"}
                          onClick={() => setEditing({ character, cash: account.mallPoints })}
                        >
                          {!data.integrations.characterEdits ? "Edição indisponível no MDBO" : character.pendingUpdate ? "Processamento pendente" : character.online ? "Editar e enviar à seleção" : "Editar personagem"}
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

        {data && <Pagination page={data.page} totalPages={data.totalPages} disabled={loading} onChange={setPage} label="Paginação das contas" />}
      </section> : activeView === "deliveries" ? <section className="contentPanel"><DeliveryHistoryPanel /></section> : activeView === "battlePass" ? <section className="contentPanel"><BattlePassPanel /></section> : activeView === "items" ? <section className="contentPanel"><ItemCatalogPanel /></section> : activeView === "skills" ? <section className="contentPanel"><SkillCatalogPanel /></section> : activeView === "skillTree" ? <section className="contentPanel"><SkillTreePanel /></section> : activeView === "mobs" ? <section className="contentPanel"><MobCatalogPanel /></section> : activeView === "recipes" ? <section className="contentPanel"><RecipePanel /></section> : activeView === "professions" ? <section className="contentPanel"><ProfessionRecipePanel /></section> : activeView === "crashes" ? <section className="contentPanel"><CrashReportPanel /></section> : <section className="contentPanel"><ServerManagerPanel /></section>}
        </div>
      </div>

      {paletteOpen && <CommandPalette onSelect={navigate} onClose={() => setPaletteOpen(false)} />}
      {vipEditing && <VipEditor account={vipEditing.account} renew={vipEditing.renew} expirySupported={data?.vipExpirySupported ?? true} onClose={() => setVipEditing(null)} onSaved={message => { setVipEditing(null); setActionMessage(message); setOverviewVersion(value => value + 1); if (activeView === "players") void loadAccounts(); }} />}
      {mailingAccount && <AdminMailEditor account={mailingAccount} integrations={data?.integrations} onClose={() => setMailingAccount(null)} onSaved={message => { setMailingAccount(null); setActionMessage(message); }} />}
      {groupMailLevel && <VipGroupMailEditor initialLevel={groupMailLevel} integrations={groupMailIntegrations} onClose={() => setGroupMailLevel(null)} onSaved={message => { setGroupMailLevel(null); setActionMessage(message); }} />}
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

function CommandPalette({ onSelect, onClose }: { onSelect: (view: View) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const termo = normalizeSearch(query.trim());
  const results = SECTIONS.filter((entry) => normalizeSearch(`${entry.label} ${entry.title} ${entry.group}`).includes(termo));
  const active = Math.min(cursor, Math.max(results.length - 1, 0));

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && results.length) { event.preventDefault(); setCursor((active + 1) % results.length); }
    else if (event.key === "ArrowUp" && results.length) { event.preventDefault(); setCursor((active - 1 + results.length) % results.length); }
    else if (event.key === "Enter" && results[active]) { event.preventDefault(); onSelect(results[active].id); }
    else if (event.key === "Escape") { event.preventDefault(); onClose(); }
  }

  return (
    <div className="modalBackdrop paletteBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="commandPalette" role="dialog" aria-modal="true" aria-label="Ir para seção">
        <div className="paletteSearch">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
            onKeyDown={onKeyDown}
            placeholder="Ir para seção…"
            aria-label="Buscar seção"
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="paletteResults" role="listbox" aria-label="Seções">
          {results.map((entry, index) => (
            <li key={entry.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className={index === active ? "active" : ""}
                onMouseEnter={() => setCursor(index)}
                onClick={() => onSelect(entry.id)}
              >
                <Icon name={entry.icon} />
                <span><strong>{entry.label}</strong><small>{entry.group}</small></span>
                {index === active && <Icon name="enter" size={14} />}
              </button>
            </li>
          ))}
          {!results.length && <li className="paletteEmpty">Nenhuma seção encontrada.</li>}
        </ul>
      </div>
    </div>
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
