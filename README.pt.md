# dsh-memento

**Memória entre sessões limitada, em camadas, protegida por aprovação e auditável para o DeepSeek Harness.**

[![license](https://img.shields.io/badge/license-Apache--2.0-3a7d44)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-4e51e8)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933)](https://nodejs.org/)
[![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()
[![no build step](https://img.shields.io/badge/build-none%20%28pure%20ESM%29-8a6d3b)]()

[English](README.md) · [中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

> Outros plugins de memória vendem um **armazém**. O dsh-memento vende a **emenda (seam)**: um serviço tipado `ctx.memory`, um portão de aprovação de escrita que nenhum caminho de modelo pode contornar e trilhas de auditoria que você pode reconstruir a partir do log da sessão. Memória nativa em primeiro lugar para o DeepSeek Harness — protocolo + portão de confiança + auditoria, com zero rede e zero credenciais.

## ✨ Por que dsh-memento?

- **É uma emenda de capacidade, não mais um armazenamento.** Service Definition (`ctx.memory`), Provider local em SQLite (`node:sqlite`, WAL, `0600`) e Consumers (ferramenta `memory` + injeção de snapshot congelado). Qualquer plugin futuro — uma integração de semente `dsh-claude-move`, uma ponte, um painel — alimenta e lê o **mesmo armazenamento através do mesmo portão**.
- **O portão não pode ser contornado.** Todo caminho de escrita (`add`/`replace`/`remove`/`seed`) é forçado pela cascata de aprovação **dentro do serviço**, não na camada da ferramenta. `writePolicy: ask | auto | off` é uma configuração que o modelo não pode ver nem alterar; uma postura `never` em nível de sessão ainda antecipa tudo.
- **Visível ao modelo ⟺ registrado em log.** O snapshot injetado cai literalmente em `request/header.system`; toda escrita é reconstruível a partir de `approval/asked` (carga completa) + `approval/decided` (resultado) + a própria tabela de auditoria do plugin.
- **Limitado e honesto.** Orçamentos rígidos de caracteres por trilha/camada (padrão usuário 2000 / agente 4000). Um armazenamento cheio **falha com um erro estruturado** (uso + limite) — o modelo consolida e tenta novamente. Nunca truncado, nunca auto-compactado.

## ⚡ Início rápido

```sh
# requer Node ^22.19 || >=24 e DSH 0.1.0-rc.6
dsh plugin --profile web add dsh-memento      # ou ./dsh-memento / um tarball / uma URL do GitHub
dsh --profile web --dump-config               # espere uma camada "# == dsh-memento", sem FAILED na inicialização
```

Depois, na Web UI: peça ao modelo para lembrar algo → aprove a escrita → inicie uma **nova sessão** e pergunte o que ele lembra. Essa é a demonstração inteira.

```yaml
# substituição opcional no cordis.patch.yml do perfil
- id: memento
  config:
    writePolicy: ask        # ask (padrão) | auto | off — invisível ao modelo
    budgets:
      user: { userGlobal: 4000, workspace: 2000 }   # memória com muito chinês: aumente + anote o porquê
      agent: { userGlobal: 4000, workspace: 4000 }
```

## 🧠 O que ele faz

| | Componente | O que você recebe |
| --- | --- | --- |
| 🧩 Service Definition | `ctx.memory` — `add` / `replace` / `remove` / `query` / `seed` / `budgets()` | Serviço tipado, declarado por merge; os métodos de escrita impõem o portão internamente |
| 💾 Provider | `lib/store.mjs` — `node:sqlite` arquivo único (`$DSH_HOME/dsh-memento/memory.db`, WAL) | Zero dependências, zero rede; tabelas de entrada + auditoria; correspondência por substring única |
| 🛠 Consumers | ferramenta `memory` · injeção de snapshot congelado (seção de system-prompt, ordem `-50`) · ferramenta `memory_recall` · comando `/memory` · painel Web somente leitura | Escritas/leituras voltadas ao modelo, snapshot congelado com cabeçalho de orçamento, recuperação em duas partes, comando do usuário, gaveta do navegador |

**Duas trilhas × duas camadas × chave por agente.** Trilha `user` = fatos sobre o usuário (preferências, estilo de comunicação, pontos sensíveis); trilha `agent` = fatos do ambiente, convenções do projeto, lições aprendidas. Cada trilha tem camadas `user-global` (entre workspaces) e `workspace` (cwd por sessão) — camadas mescladas no estilo Codex, não global-apenas no estilo Hermes. Uma terceira dimensão isola entradas pelo `agentPreset` da sessão (escopo por agente); entradas sem preset ficam na camada compartilhada visível para todos.

**Snapshots congelados.** O snapshot é renderizado uma vez por sessão na primeira montagem do prompt (leitura síncrona do SQLite + cache por sessão) e nunca muda no meio da sessão — estável por cache de prefixo por construção. Mudanças internas da sessão persistem apenas em disco + auditoria.

```
Consumer: memory tool          Consumer: frozen snapshot (systemPrompt section, order -50)
   add/replace/remove/query       per-session freeze, budget-headed
        │ writes (agent+callId)   │ reads (sync, session cwd)
        ▼                          ▼
Service Definition: ctx.memory — budgets/add/replace/remove/query/seed
   every write: budget precheck → ctx.approval.request (approval waterfall) → budget recheck → persist → audit
        │
        ▼
Provider: lib/store.mjs — node:sqlite (WAL, 0600), entries + audit tables, unique-substring match
```

## 🧰 Instalar e desinstalar

```sh
dsh plugin --profile <name> add ./dsh-memento        # checkout local (sem etapa de build)
dsh plugin --profile <name> add git+https://github.com/PerryLink/dsh-memento.git   # GitHub; npm após o primeiro release
dsh plugin --profile <name> remove dsh-memento       # desinstalar: o BD + os logs de sessão são mantidos
```

Após desinstalar, o banco de dados de memória e os logs de sessão que registraram a atividade de memória permanecem; sessões antigas continuam carregáveis.

## ⚙️ Configuração

Todo campo é um `Config` Schemastery validado; valores inválidos falham ruidosamente no carregamento. Substitua no cordis.yml sob a linha `memento`.

| Campo | Padrão | Significado |
| --- | --- | --- |
| `enabled` | `true` | `false` remove o serviço, as ferramentas, o snapshot, o comando, o painel e o answerer por completo (sem estado parcial) |
| `dbPath` | `''` → `$DSH_HOME/dsh-memento/memory.db` | absoluto, ou relativo a `$DSH_HOME` |
| `budgets.user.userGlobal` / `budgets.user.workspace` | `2000` / `2000` | orçamento rígido de caracteres por camada da trilha user |
| `budgets.agent.userGlobal` / `budgets.agent.workspace` | `4000` / `4000` | orçamento rígido de caracteres por camada da trilha agent |
| `writePolicy` | `'ask'` | `'ask'` = aprovação do usuário; `'auto'` = permite passar (fonte da aprovação registrada); `'off'` = rejeita. Invisível ao modelo |
| `writePolicies` | `{}` | substituições por trilha/camada ou por fonte: chaves `user/workspace`, `agent/user-global`, `source:claude`, … → `ask`/`auto`/`off`; sem correspondência cai para `writePolicy` |
| `snapshotOrder` | `-50` | ordem da seção do snapshot: depois da identidade do harness (`-100`), antes da persona (`0`) |
| `maxEntriesPerQuery` | `20` | limite padrão de resultados por consulta (`limit` explícito permitido, teto rígido 1000) |
| `commandListLimit` | `50` | entradas exibidas por comando `/memory list` / `query` |
| `commandAuditLimit` | `10` | linhas de auditoria exibidas por comando `/memory audit` |
| `recall.historyLimitDefault` / `recall.snippetCap` / `recall.snippetChars` / `recall.windowDays` | `8` / `5` / `300` / `30` | padrões de histórico do `memory_recall`: sessões escaneadas, trechos por sessão, caracteres por trecho, janela em dias |
| `panelEntriesLimit` | `200` | tamanho da página de entradas do painel web (e teto) |
| `panelAuditLimit` | `20` | linhas de auditoria do painel web por padrão (teto 200) |
| `auditRetentionDays` | `0` | retenção de auditoria: 0 = para sempre, >0 = poda ao abrir a loja |
| `proposals.enabled` / `proposals.maxChars` / `proposals.maxPending` | `true` / `2000` / `8` | auto-captura: proposta de memória pendente após cada compactação bem-sucedida (truncada, uma por sessão); desativar ou ajustar limites |

## 🛠 Ferramentas e superfícies

- **`memory`** — add/replace/remove/consolidate/query com orientação de Salvar/Pular embutida na descrição (salve preferências do usuário, correções, fatos do ambiente, convenções, lições; pule trivialidades, fatos rederiváveis, despejos, caminhos de uso único). Escritas passam pelo portão de aprovação; leituras são livres; replace/remove miram uma **substring única** (correspondências ambíguas falham com a lista de candidatos); consolidate mescla 1..20 entradas em uma com uma única aprovação e uma escrita atômica.
- **`memory_recall`** — recuperação em duas partes: correspondências de memória limitadas **mais** correspondências recentes do histórico da sessão via `ctx.sessionQuery` (degrada graciosamente para somente memória onde o serviço está ausente).
- **`/memory`** — comando acionado pelo usuário (não um turno do modelo): `list` · `query <word>` · `add [--track=user|agent] [--scope=user-global|workspace] <text>` · `remove [flags] <substring>` · `consolidate [flags] <substring...> => <text>` · `proposals [approve|dismiss <id>]` · `budgets` · `audit`. Escritas por comando passam pela mesma cascata + política; a auditoria cai na tabela de auditoria do plugin + `command/done`.
- **Propostas auto-capturadas** — após uma compactação de sessão bem-sucedida, o resumo vira uma proposta de memória pendente (`agent/workspace`); aprovar a escreve pelo portão de aprovação, descartar a remove. Propostas pendentes aparecem no snapshot congelado e no painel.
- **Painel Web** — gaveta `dsh.client` sem build: navegue pelas entradas por trilha/camada, pesquise, veja barras de orçamento e o fim da auditoria. Somente leitura por design: escritas e aprovação acontecem pela ferramenta `memory` e pela UI de aprovação embutida.

## 🆚 Como ele é diferente

| Plugin | O que é | A diferença do dsh-memento |
| --- | --- | --- |
| dsh-memory-evolve | armazém de memória / loops de evolução | uma emenda de serviço tipada, portão de aprovação e auditoria de log de sessão; sem ambição de armazém |
| dsh-mnemon | helper de armazenamento de memória | protocolo + portão + auditoria, não mais um armazenamento |
| dsh-kb-sieve | peneiramento de base de conhecimento | sem engenharia de recuperação: busca por substring em corpus pequeno, recuperação entre sessões via `session_search`/`sessionQuery` |
| dsh-tdai-memory | ferramentas de memória orientadas a tarefas | orçamentos são por trilha×camada e impostos no serviço, não best-effort |
| claude-bridge | ponte para o Claude Code | nativo de DSH; um futuro caminho `seed(source:'claude')` permite que uma ponte alimente o mesmo armazenamento |
| dsh-external/Recall | memória de agente externo | local em primeiro lugar, zero rede, usa a própria emenda de aprovação do DSH |
| Exemplos oficiais de memória MCP | a posição declarada do DSH de "memória = MCP externo" | o complemento **nativo de primeira parte**: mesmo objetivo, sem servidor externo; ambos coexistem |

O nome é **`dsh-memento`** (livre no npm e no GitHub). Não `dsh-recall` (confundível com dsh-external/Recall), não o nome legado excluído `dsh-memory`.

## 🔒 Limites de segurança

- **Somente serviços públicos** (`tools`, `systemPrompt`, a emenda de aprovação). Sem mudanças em engine / agent-loop / apiproxy / UI oficial.
- **Zero rede, zero credenciais.** Banco de dados local; modo de arquivo POSIX `0600`.
- **Falhar ruidosamente.** Banco de dados corrompido ou schema mais novo falha no carregamento; orçamentos cheios e correspondências de substring ambíguas falham com erros estruturados. Nada é silenciosamente engolido ou truncado.
- **Um processo, um armazenamento.** Múltiplas sessões em um processo compartilham o armazenamento SQLite (escritas serializadas, auditoria por sessão). Dois **processos** compartilhando um `$DSH_HOME` gravam o mesmo arquivo: vence o último gravador sob o locking do SQLite — não execute duas instâncias do harness em um `$DSH_HOME` se você precisa de consistência entre processos (a mesma ressalva que o projeto Hermes documenta).

## ⚠️ Limitações conhecidas

- **O vocabulário de eventos de sessão é declarado, ainda não emitido (rc.6).** `memory/added|updated|removed|recalled|snapshot` são declarados por merge em `types.d.ts`, mas o rc.6 não tem superfície de registro para tipos de evento fora do repositório (appends não registrados tornariam sessões persistidas incapazes de carregar). A completude da auditoria vem do par de aprovação + a tabela de auditoria; a emissão liga automaticamente assim que um build do harness registra os tipos. Veja [ARCHITECTURE.md](ARCHITECTURE.md) decisão 4.
- **A política `ask` precisa de um answerer.** Sem um answerer de UI/ACP composto, as escritas falham fechado (`unavailable`) — por design, a postura fail-closed da emenda de aprovação.
- **Sem índice FTS5.** A busca por substring usa `instr` insensível a maiúsculas (correto para CJK); o ranking de recuperação usa contadores de acertos por entrada. O tokenizador trigram do FTS5 não indexa caracteres CJK de um único caractere, então não é usado — veja [ARCHITECTURE.md](ARCHITECTURE.md), decisão 10.

## 🧪 Desenvolvimento

```sh
npm install
npm test                # node --test: 74 testes — orçamento, substring única, política do portão, armazenamento, snapshot, integração com mock-ctx (invariantes S2/S3), comando/recuperação/painel V2
npm run typecheck       # portão tsc --checkJs sobre index.mjs / lib / scripts
npm run check:coverage  # portão de cobertura de linhas: lib ≥90%, index.mjs ≥85%, todos ≥90%
npm run check:readmes   # portão de coerência dos cinco README
```

`lib/` tem zero dependência de DSH (somente builtins do node:); imports de DSH existem apenas em `index.mjs`. Disciplina completa em [AGENTS.md](AGENTS.md); decisões de design em [ARCHITECTURE.md](ARCHITECTURE.md).

## 🏷 Tópicos

Tópicos sugeridos para o GitHub: `dsh` · `dsh-plugin` · `deepseek-harness` · `memory` · `agent-memory` · `approval` · `audit` · `sqlite` · `cordis` · `llm`

## 📄 Licença

Apache License 2.0 — veja [LICENSE](LICENSE). Nenhum código de terceiros é redistribuído; veja [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
