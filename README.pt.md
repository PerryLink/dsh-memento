<div align="center">

# dsh-memento

**Memória entre sessões limitada, em camadas, com porta de aprovação e auditável para o DeepSeek Harness.**

*Uma costura tipada `ctx.memory`, uma porta de aprovação de escrita que nenhum caminho do modelo pode contornar e trilhas de auditoria reconstruíveis a partir do log de sessão.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-memento/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-memento/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-memento?label=version)](https://github.com/PerryLink/dsh-memento/releases)
[![npm version](https://img.shields.io/npm/v/dsh-memento)](https://www.npmjs.com/package/dsh-memento)
[![npm downloads](https://img.shields.io/npm/dm/dsh-memento)](https://www.npmjs.com/package/dsh-memento)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.1-rc.2` |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | Windows / macOS / Linux (somente host; sem código nativo, sem rede) |
| Model | Qualquer |

## What you get

O `dsh-memento` é uma costura de capacidade, não outro armazém: um serviço tipado `ctx.memory`, um provedor SQLite local (`node:sqlite`, WAL, `0600`, em `$DSH_HOME/dsh-memento/memory.db`) e seus consumidores — a ferramenta `memory` e um snapshot congelado injetado no prompt do sistema.

- **A porta não pode ser contornada.** Todo caminho de escrita (`add` / `replace` / `remove` / `seed`) passa pela cascata de aprovação dentro do serviço, não na camada de ferramentas. `writePolicy: ask | auto | off` é configuração invisível para o modelo; `replace` / `remove` / `consolidate` carregam o texto completo das entradas que alteram no payload de aprovação, e uma escrita negada ainda gera uma linha de auditoria `*-denied`.
- **Visível para o modelo ⟺ registrado.** O snapshot injetado chega textualmente a `request/header.system`; toda escrita é reconstruível a partir de `approval/asked` + `approval/decided` + a própria tabela de auditoria do plugin.
- **Limitado e honesto.** Orçamentos rígidos de caracteres por trilha e por camada (padrão usuário 2000 / agente 4000). Um armazém cheio falha com erro estruturado (uso + limite) — nunca trunca, nunca compacta automaticamente.

Duas trilhas × duas camadas × chave por agente: uma trilha `user` (fatos sobre o usuário) e uma trilha `agent` (fatos de ambiente e convenções), cada uma dividida em camadas `user-global` e `workspace`, isoladas por `agentPreset`. O snapshot é congelado uma vez por sessão na primeira montagem do prompt e nunca muda no meio da sessão.

## Quick start

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add "github:PerryLink/dsh-memento#main"

# or from npm (published releases)
dsh plugin --profile web add dsh-memento

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A3 'id: memento'
```

## Install & uninstall

- **canal git** (último `main`): `dsh plugin --profile web add git+https://github.com/PerryLink/dsh-memento.git`.
- **canal npm** (versões publicadas): `dsh plugin --profile web add dsh-memento`.
- **canal tarball**: `npm pack` neste repo, depois `dsh plugin --profile web add ./dsh-memento-<version>.tgz`.
- **desinstalar**: `dsh plugin --profile web remove dsh-memento` (o banco de memória e os logs de sessão são mantidos).

## Configuration

Todos os parâmetros são campos Schemastery `Config` (alteráveis pelo cordis.yml). Valores inválidos falham ruidosamente ao carregar. Sobrescreva na linha `memento`.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Interruptor mestre; `false` remove serviço, ferramentas, snapshot, comando, painel e answerer |
| `dbPath` | `''` → `$DSH_HOME/dsh-memento/memory.db` | Absoluto, ou relativo a `$DSH_HOME` (no Windows cai para `~/.dsh`) |
| `budgets.user.userGlobal` | `2000` | Orçamento rígido de caracteres da camada user-global da trilha user |
| `budgets.user.workspace` | `2000` | Orçamento rígido de caracteres da camada workspace da trilha user |
| `budgets.agent.userGlobal` | `4000` | Orçamento rígido de caracteres da camada user-global da trilha agent |
| `budgets.agent.workspace` | `4000` | Orçamento rígido de caracteres da camada workspace da trilha agent |
| `writePolicy` | `'ask'` | Política de escrita padrão: `ask` / `auto` / `off` (invisível para o modelo) |
| `writePolicies` | `{}` | Sobrescritas por trilha/escopo ou por origem (ex.: `user/workspace`, `source:claude`) |
| `language` | `'en'` | Idioma do texto visível e da saída do comando: `en` / `zh` |
| `snapshotOrder` | `-50` | Ordem da seção de snapshot (após a identidade do harness, antes de persona) |
| `maxEntriesPerQuery` | `20` | Limite de resultados por consulta (limite rígido 1000) |
| `commandListLimit` | `50` | Entradas exibidas por `/memory list` / `query` |
| `commandAuditLimit` | `10` | Linhas de auditoria exibidas por `/memory audit` |
| `recall.historyLimitDefault` | `8` | Sessões escaneadas pelo `memory_recall` por padrão |
| `recall.snippetCap` | `5` | Fragmentos por sessão no `memory_recall` |
| `recall.snippetChars` | `300` | Caracteres de fragmento no `memory_recall` |
| `recall.windowDays` | `30` | Janela de recência em dias do `memory_recall` |
| `panelEntriesLimit` | `200` | Tamanho de página de entradas do painel web |
| `panelAuditLimit` | `20` | Linhas de auditoria do painel web por padrão |
| `auditRetentionDays` | `0` | Retenção de auditoria (0 = manter para sempre) |
| `proposals.enabled` | `true` | Capturar automaticamente uma proposta de memória após cada compactação bem-sucedida |
| `proposals.maxChars` | `2000` | Limite de caracteres da proposta |
| `proposals.maxPending` | `8` | Limite de propostas pendentes |

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `memory` | tool | add/replace/remove/consolidate/query com orientação Save/Skip; escritas passam pela porta de aprovação |
| `memory_recall` | tool | Correspondências limitadas de memória mais correspondências recentes do histórico de sessão |
| `/memory` | command | `list` · `query` · `add` · `remove` · `consolidate` · `proposals` · `budgets` · `audit` · `export` · `import <path>` · `adapters` |
| web panel | client drawer | Somente leitura: navegar entradas, buscar, barras de orçamento, cauda de auditoria |

## How it's different

| Plugin | O que é | A diferença do dsh-memento |
|---|---|---|
| dsh-memory-evolve | armazém de memória / laços de evolução | costura de serviço tipada, porta de aprovação e auditoria de log de sessão; sem ambição de armazém |
| dsh-mnemon | auxiliar de armazenamento de memória | protocolo + porta + auditoria, não outro armazém |
| dsh-kb-sieve | peneiramento de base de conhecimento | sem engenharia de recuperação: busca por substring em corpus pequeno, recall entre sessões via `session_search`/`sessionQuery` |
| dsh-tdai-memory | ferramentas de memória dirigidas por tarefa | orçamentos são por track×camada e aplicados no serviço, não no melhor esforço |
| claude-bridge | ponte do Claude Code | nativo do DSH; uma futura rota `seed(source:'claude')` deixa uma ponte alimentar o mesmo armazém |
| dsh-external/Recall | memória de agente externa | local primeiro, zero rede, usa a própria costura de aprovação do DSH |
| Official MCP memory examples | a posição declarada do DSH de "memória = MCP externo" | o complemento **nativo de primeira parte**: mesmo objetivo, sem servidor externo; ambos coexistem |

O nome é **`dsh-memento`** (publicado no npm e no GitHub). Não `dsh-recall` (confundível com dsh-external/Recall), não o nome legado excluído `dsh-memory`.

## dsh-memory-protocol v1

O `dsh-memento` é o ensaio comunitário do protocolo de memória DSH — uma forma candidata para uma costura oficial `ctx.memory`. O protocolo normaliza a costura deste plugin em um contrato entre plugins:

- **Entry spec** — duas trilhas × duas camadas × chave por agente, mais `tags` curtos (≤16 × ≤32 caracteres) e um `version` por entrada que incrementa a cada `replace`.
- **Write semantics** — escritas condicionais idempotentes por substring única; payloads de aprovar-o-que-se-vê (`replace` / `remove` / `consolidate` carregam o texto completo que alteram).
- **Audit contract** — toda escrita reconstruível a partir de `approval/asked` + `approval/decided` + o livro-razão do provedor.
- **Budget model** — semântica `BUDGET_EXCEEDED` / `AMBIGUOUS_MATCH`.
- **Schema versioning** — regras de migração com verificações de versão ruidosas.

- **Spec** — [docs/protocol-v1.md](docs/protocol-v1.md) (中文: [protocol-v1.zh.md](docs/protocol-v1.zh.md)); JSON Schema normativo em [docs/schemas/dsh-memory-protocol-v1.schema.json](docs/schemas/dsh-memory-protocol-v1.schema.json).

**Registro de adaptadores** — `ctx.memoryAdapters` (`register` / `list` / `adapt` / `export`) permite que plugins de memória de terceiros falem o protocolo registrando um conversor de dados puro (`register()` reversível; a importação usa o `seed` com porta de aprovação, a exportação é somente leitura). Integração: [docs/adapters-guide.md](docs/adapters-guide.md) (中文: [adapters-guide.zh.md](docs/adapters-guide.zh.md)).

| Built-in adapter | External format | Notes |
|---|---|---|
| `mem0` | coleções de fatos mem0 (`{facts: [{memory, metadata?}]}`) | `metadata.category` / `metadata.tags` viram tags; arrays `messages` crus são rejeitados — adaptadores convertem, nunca extraem |
| `hermes-memory-md` | `memory.md` do Hermes (`## section` + marcadores) | nomes de seção viram tags; prosa sem marcadores falha ruidosamente |
| `claude-code-memory-md` | markdown estilo `CLAUDE.md` (títulos, marcadores, parágrafos) | marcadores e parágrafos viram entradas; nomes de seção viram tags |

**Suíte de conformidade** — [test/protocol-conformance/](test/protocol-conformance/README.md): um conjunto de casos distribuível que qualquer provedor que reivindique compatibilidade executa (`node test/protocol-conformance/run.mjs --provider ./your-factory.mjs`); o CI deste repo o executa contra seu próprio provedor como referência dourada (`npm run test:conformance`).

- **Upstream proposal** — [docs/upstream-proposal.md](docs/upstream-proposal.md) (中文: [upstream-proposal.zh.md](docs/upstream-proposal.zh.md)): por que a costura oficial `ctx.memory` deveria adotar o protocolo, as diferenças e o caminho de migração.

## Permissions & data

- **Permissions**: o manifesto de workshop declara `harness:tool`, `filesystem:read`, `filesystem:write` e `network:none` / `subprocess:none` / `shell:none` / `python:none` / `credentials:none`. A aprovação de escrita usa a costura oficial de aprovação.
- **Data**: banco de dados SQLite local (`0600`), zero rede, zero credenciais.
- **Session log**: a completude da auditoria vem do par de aprovação (`approval/asked` + `approval/decided`) mais a tabela de auditoria do plugin.

## Security boundaries

- **Somente serviços públicos.** Consome `tools`, `systemPrompt` e a costura de aprovação; sem alterações em engine / agent-loop / apiproxy / UI oficial.
- **Zero rede, zero credenciais.** Banco de dados local com modo de arquivo POSIX `0600`.
- **Falha ruidosa.** Banco corrompido, esquema mais novo ou configuração inválida falha ao carregar; orçamentos cheios e correspondências de substring ambíguas falham com erros estruturados.
- **Um processo, um armazém.** Várias sessões compartilham o armazém SQLite; dois processos que compartilham um `$DSH_HOME` escrevem o mesmo arquivo (último escritor vence sob o bloqueio do SQLite).

## Known limitations

- **Eventos de sessão declarados, ainda não emitidos (rc.2).** `memory/added|updated|removed|recalled|snapshot` são declarados por fusão, mas o rc.2 não tem superfície de registro para tipos de evento fora do repo; a emissão é ativada quando uma build do harness os registrar.
- **A política `ask` precisa de um answerer.** Sem um answerer UI/ACP composto, as escritas falham fechadas.
- **Sem indexação FTS5.** A busca por substring usa `instr` insensível a maiúsculas (correto para CJK).

## What we learned from the terminal memories

O `dsh-memento` não é um port do Claude Code, Codex ou Hermes — mas seu design absorveu deliberadamente as partes que cada um acertou, e recusou as que causavam dano:

| Terminal memory | O que acertou | O que o dsh-memento adotou |
|---|---|---|
| **Claude Code** — `CLAUDE.md` | arquivos de memória em texto puro hierárquicos (nível usuário → nível projeto), legíveis e editáveis por humanos, mesclados automaticamente em toda sessão | entradas em texto puro; camadas `user-global` / `workspace` mescladas por sessão; um armazém que você pode navegar, `export` e auditar — transparência como característica |
| **Codex** — `AGENTS.md` | instruções com escopo por diretório auto-descobertas e injetadas com atrito zero para o modelo | a camada `workspace` indexada pelo cwd da sessão (insensível a maiúsculas no Windows); o snapshot congelado injetado automaticamente no início da sessão |
| **Hermes** — `memory.md` | gravações de memória proativas e a lição de segurança de que uma porta aplicada só na camada de ferramentas é contornável por injeção tardia de ferramenta | a ferramenta `memory` com orientação Save/Skip + propostas de auto-captura com porta de aprovação; a porta vive dentro dos métodos de escrita de `ctx.memory`, não na camada de ferramentas |

Fontes: [Claude Code memory](https://code.claude.com/docs/en/memory) · [Codex AGENTS.md](https://developers.openai.com/codex/cli/agents-md) · [Hermes memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md) · [Hermes #48181](https://github.com/NousResearch/hermes-agent/issues/48181).

E as partes deliberadamente recusadas: a auto-resumização oculta em estado privado do modelo (os resumos de compactação aqui viram **propostas pendentes** que aguardam um approve/dismiss humano), as ambições de armazém/vector-store, e qualquer escrita sem aprovação ou trilha de auditoria visível para humanos. Também adotado: a ressalva documentada do Hermes de que dois processos que compartilham um diretório home escrevem o mesmo arquivo de memória — veja Security boundaries.

## Development

```sh
npm install              # node ^22.19 || >=24
npm test                 # node --test: 133 tests
npm run test:conformance # dsh-memory-protocol v1 conformance suite
npm run typecheck        # tsc --checkJs gate
npm run check:coverage   # line-coverage gate
npm run check:readmes    # five-language README consistency gate
```

`lib/` tem zero dependências de DSH (somente builtins de node:); importações de DSH existem apenas em `index.mjs`.

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `memory`, `agent-memory`, `approval`, `audit`, `sqlite`, `cordis`, `llm`

## Contributors

- [@Niuniu-Sir](https://github.com/Niuniu-Sir) — o relato de falha de inicialização na [issue #1](https://github.com/PerryLink/dsh-memento/issues/1) que levou ao fallback `~/.dsh` incluído na 0.3.1.

## PerryLink DSH Plugin Family

Este projeto é um dos [15 plugins do DeepSeek Harness](https://github.com/PerryLink) mantidos por [PerryLink](https://github.com/PerryLink). Se este te ajuda, os demais provavelmente também:

| Plugin | One-liner |
|---|---|
| [dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel) | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors |
| [dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck) | Engineering-discipline guard: requirements grill, test gates, adversary review |
| [dsh-background-agents](https://github.com/PerryLink/dsh-background-agents) | Durable background child agents with a Web UI sidebar, messaging and interrupt |
| [dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions) | LSP diagnostics, formatting, completion, code actions and rename over language servers |
| [dsh-output-styles](https://github.com/PerryLink/dsh-output-styles) | Claude Code outputStyles-equivalent runtime style switching |
| [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind) | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |
| [dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules) | Claude Code-style declarative allow/deny/ask permission rules with audit |
| [dsh-auto-review](https://github.com/PerryLink/dsh-auto-review) | Second-model auto-review on the approval chain, fail-closed by default |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool |
| [dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security) | Security-audit skill pack: secret scan, dependency and supply-chain review |
| [dsh-session-pin](https://github.com/PerryLink/dsh-session-pin) | Pin sessions in the Web sidebar with durable ordering |
| [dsh-composer-history](https://github.com/PerryLink/dsh-composer-history) | Terminal-style input history for the web composer: arrows, Ctrl+R search |
| [dsh-github](https://github.com/PerryLink/dsh-github) | GitHub PR/issues integration for DSH, every write gated by approval |
| [dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide) | Plugin-development knowledge base as an on-demand agent skill |
| [dsh-claude-move](https://github.com/PerryLink/dsh-claude-move) | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH |

## License

[Apache License 2.0](LICENSE) © 2026 dsh-memento contributors
