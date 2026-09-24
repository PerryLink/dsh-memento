<div align="center">

# dsh-memento
- **Canal 1024 store**: `npm i -g dsh1024` uma vez, depois `dsh1024 plugin --profile web add dsh-memento` (conta para o ranking de instalações do [deepseek1024.com](https://deepseek1024.com)).

**Memória entre sessões limitada, em camadas, com porta de aprovação e auditável para o DeepSeek Harness.**

*Uma costura tipada `ctx.memory`, uma porta de aprovação de escrita que nenhum caminho do modelo pode contornar e uma auditoria reconstruível — do par de aprovação mais a tabela de auditoria do plugin, com a lacuna do log de sessão dita em voz alta.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Gitee](https://img.shields.io/badge/Gitee-mirror-c71d23?logo=gitee)](https://gitee.com/perrylink/dsh-memento)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![dsh-doctor](https://raw.githubusercontent.com/PerryLink/dsh-plugin-doctor/main/badges/PerryLink__dsh-memento.svg)](https://github.com/PerryLink/dsh-plugin-doctor#verified-徽章)
[![DSH Market](https://raw.githubusercontent.com/2BingLing/dsh-market/master/assets/readme/badge-top-rated.svg)](https://dsh.market/)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-memento/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-memento/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-memento?label=version)](https://github.com/PerryLink/dsh-memento/releases)
[![npm version](https://img.shields.io/npm/v/dsh-memento)](https://www.npmjs.com/package/dsh-memento)
[![npm downloads](https://img.shields.io/npm/dm/dsh-memento)](https://www.npmjs.com/package/dsh-memento)
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-memento?metric=downloads&lang=pt)](https://dshfind.com/pt/plugins/PerryLink/dsh-memento?ref=badge)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

</div>

---


<!-- star-cta -->
## ⭐ 如果它帮到了你

Este plugin faz parte da [família de plugins DSH](https://github.com/PerryLink) (mais de 40, todos Apache-2.0). Se for útil, **deixe uma estrela**: não desbloqueia nada, mas ajuda a próxima pessoa a encontrá-lo.

*English:* part of a 40+ plugin family for DeepSeek Harness. If it is useful, **a star helps the next person find it** — nothing is gated behind it.
## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.1.7-rc.1` (adaptado em 2026-09-22): a linha `0.1.7` substituiu toda a superfície de registro de configurações (`installSettingsSection` / `SettingsProvider.installSection` / `SettingsNamespace` / `SettingsScope`) por formulários de config ao vivo, então as duas metades seguem o contrato novo — o namespace de um formulário é o id da entrada do perfil (`memento`), seus campos editáveis são os marcados `.volatile()` e uma edição aceita é confirmada **dentro do plugin em execução** em vez de remontá-lo. A metade de navegador lê esse formulário por `ctx.configForms.get(entryId)` (o serviço `ctx.settingsScope` deixou de existir). As duas metades mantêm seus ramos `installSection` / `settingsScope` para as linhas `0.1.2-rc.1`, `0.1.5-alpha.1` e `0.1.6-0` que o intervalo de peers ainda anuncia, e a nova cláusula `>=0.1.7-0 <0.2.0` é o que torna o próprio host alvo instalável (o intervalo antigo o excluía pela regra de semver para versões preliminares). Ainda não há superfície de registro de eventos para plugins — `KNOWN_SESSION_EVENT_TYPES` não inclui `memory/*` e o terceiro argumento de `Session.append` só carrega um `SurfaceIntent` para tipos de superfície, então a porta de auditoria continua adaptativa e pula como antes (diz isso uma vez por processo e em `/memory audit`). A evidência de tipos vem de três faces: os tipos já compilados do checkout local, a linha publicada fixada em `node_modules` e a metade de navegador sob uma lib DOM. |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | Windows / macOS / Linux (somente host; sem código nativo, sem rede) |
| Model | Qualquer |

## What you get

O `dsh-memento` é uma costura de capacidade, não outro armazém: um serviço tipado `ctx.memory`, um provedor SQLite local (`node:sqlite`, WAL, `0600`, em `$DSH_HOME/dsh-memento/memory.db`) e seus consumidores — a ferramenta `memory` e um snapshot congelado injetado no prompt do sistema.

- **A porta não pode ser contornada.** Todo caminho de escrita (`add` / `replace` / `remove` / `seed`) passa pela cascata de aprovação dentro do serviço, não na camada de ferramentas. `writePolicy: ask | auto | off` é configuração invisível para o modelo; `replace` / `remove` / `consolidate` carregam o texto completo das entradas que alteram no payload de aprovação, e uma escrita negada ainda gera uma linha de auditoria `*-denied`.
- **Visível para o modelo ⟺ registrado.** O snapshot injetado chega textualmente a `system/message`; toda escrita é reconstruível a partir de `approval/asked` + `approval/decided` + a própria tabela de auditoria do plugin.
- **Limitado e honesto.** Orçamentos rígidos de caracteres por trilha e por camada (padrão usuário 2000 / agente 4000). Um armazém cheio falha com erro estruturado (uso + limite) — nunca trunca, nunca compacta automaticamente.
- **A lacuna de auditoria é visível.** `/memory audit` lista a tabela de auditoria do plugin e acrescenta uma linha quando o lado do log de sessão não é escrito: este host não conhece os tipos de evento `memory/*`, e acrescentar tipos desconhecidos deixaria a sessão ilegível, então as escritas são auditadas por `approval/asked` + `approval/decided` e pela tabela do plugin. A porta é adaptativa: a linha desaparece sozinha quando o host conhece esses tipos.

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

**Painel de configurações.** Na linha `0.1.7` o próprio `Config` do plugin **é** a sua página de configurações: o namespace do formulário é o id da entrada do perfil (`memento`, ou seja o `id:` da linha deste bundle), os campos editáveis são exatamente os que o plugin declara `.volatile()` (todas as chaves abaixo exceto `enabled`), e uma edição aceita é mesclada na linha do plugin no perfil e confirmada dentro do plugin em execução — sem editar arquivos nem reiniciar. Quase tudo se aplica ao vivo (políticas de escrita, idioma, orçamentos, limites, propostas, painel; `dbPath` / `auditRetentionDays` reabrindo o armazém; `retrieval.vector` trocando o recuperador); o que o plugin registra ao carregar (`snapshotOrder`, as descrições das ferramentas) é relido na recarga, e a página marca esses campos. Os limites numéricos também estão declarados no schema, então uma edição fora da faixa é recusada no momento da escrita em vez de deixar uma configuração inutilizável. Nas linhas antigas (`0.1.2-rc.1`, `0.1.5-alpha.1`, `0.1.6-0`) o mesmo cartão edita o namespace de configurações `dsh-memento`, como antes; sem nenhum serviço de configurações, tudo volta à configuração composta. O botão flutuante do painel pode ser ocultado na mesma página (`panel.enabled`).

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Interruptor mestre; `false` remove serviço, ferramentas, snapshot, comando, painel e answerer (não editável na página de configurações: um plugin desabilitado não tem entrada de configurações) |
| `panel.enabled` | `true` | Mostrar o botão flutuante do painel web; ao salvar `false` na página de configurações, a entrada 🧠 é ocultada imediatamente, sem recarregar (a página de configurações não é afetada) |
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
| `retrieval.vector` | `false` | Interruptor de recuperação semântica: `true` ativa a recuperação vetorial do `memory_recall` (embedding de hash falso) quando há um provedor de embedding; caso contrário degrada para substring |
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
| web panel | client drawer | Somente leitura: navegar entradas, buscar, barras de orçamento, cauda de auditoria; o botão flutuante pode ser ocultado (`panel.enabled`) |
| settings section | Barra lateral de configurações do DSH → `dsh-memento` | Edita todos os campos de configuração (exceto `enabled`) sem tocar em arquivos (na linha `0.1.7` o namespace é a entrada de perfil `memento`; antes era o namespace de configurações `dsh-memento`); o momento de aplicação (ao vivo ou após recarga) é indicado na página |

## MCP server

O `dsh-memento` inclui um **servidor MCP** stdio somente-leitura (`dsh-memento-mcp`) para que clientes MCP externos (Claude, Codex, …) pesquisem o armazenamento de memória sem o harness. Ele fala JSON-RPC 2.0 sobre JSON delimitado por novas linhas (NDJSON): um objeto JSON por linha, sem enquadramento `Content-Length`.

**Somente leitura.** O banco é aberto com `readOnly: true` do `node:sqlite` (sem migrações, sem gravações WAL, sem incremento do contador de recall); um banco ausente retorna resultados vazios em vez de falhar.

| Ferramenta | Propósito |
|---|---|
| `memory_search` | `{query, limit?}` → entradas ordenadas (substring sem distinção de maiúsculas via o seam do Provider de recuperação) |
| `memory_stats` | `{}` → `{total, namespaces}` contagem de entradas + visão geral por track/scope |

Execução direta:

```sh
node bin/mcp-server.mjs
# ou, após npm install: npx dsh-memento-mcp
```

O caminho do banco é `$DSH_MEMENTO_DB_PATH` (absoluto, ou relativo a `$DSH_HOME`); padrão `$DSH_HOME/dsh-memento/memory.db`.

Exemplo para o Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "dsh-memento": {
      "command": "npx",
      "args": ["-y", "dsh-memento-mcp"],
      "env": {
        "DSH_MEMENTO_DB_PATH": "/home/you/.dsh/dsh-memento/memory.db"
      }
    }
  }
}
```

O servidor é somente-leitura: sem rede, sem gravações, sem porta de aprovação — apenas busca e estatísticas.

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
- **Session log**: a completude da auditoria vem do par de aprovação (`approval/asked` + `approval/decided`) mais a tabela de auditoria do plugin; a lacuna do lado do log de sessão é declarada em `/memory audit` e desaparece quando o host registra `memory/*`.

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
npm test                 # node --test: 187 testes
npm run lint             # oxlint
npm run test:conformance # dsh-memory-protocol v1 conformance suite
npm run typecheck        # face host × checkout local D:\deepseek-harness (imprime «não verificável» e sai 0 sem checkout)
npm run typecheck:ci     # face host × linha publicada fixada em node_modules
npm run check:client     # metade de navegador (lib DOM)
npm run check:coverage   # line-coverage gate
npm run check:readmes    # five-language README consistency gate
npm run verify:self-contained # reject out-of-repo dependency specs
npm run verify:artifacts # artifact presence + syntax + import
```

`lib/` tem zero dependências de DSH (somente builtins de node:); importações de DSH existem apenas em `index.mjs`.

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `memory`, `agent-memory`, `approval`, `audit`, `sqlite`, `cordis`, `llm`

## Contributors

- [@Niuniu-Sir](https://github.com/Niuniu-Sir) — o relato de falha de inicialização na [issue #1](https://github.com/PerryLink/dsh-memento/issues/1) que levou ao fallback `~/.dsh` incluído na 0.3.1.

## PerryLink DSH Plugin Family

This project is one of the **45 DeepSeek Harness plugins** maintained by [PerryLink](https://github.com/PerryLink). If this one helps you, the others likely will too:

| Plugin | One-liner |
|---|---|
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default | |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command | |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | |
| **[dsh-catalog](https://github.com/PerryLink/dsh-catalog)** | DSH Desktop Market standard catalog source for the PerryLink family | |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence | |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore | |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. | |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search | |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) | |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review | |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. | |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds | |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval | |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` | |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** | Laya typed decisions (`noul`/`choice`/`score`) as a first-class Cordis service and model-visible tools | |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** | Local document knowledge base for DeepSeek Harness. | |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. | |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions and rename over language servers | |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer | |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors | |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool | |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. | |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching | |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit | |
| **[dsh-plugin-certification](https://github.com/PerryLink/dsh-plugin-certification)** | Community certification registry with repro-checkable grades and badges | |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | Zero-dependency static + sandbox smoke detector for DSH plugins | |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill | |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | Shared zero-runtime-dependency toolkit for the PerryLink DSH plugins | |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | One-package, one-corridor-index plugin upgrade skill: routes a repository to the matching closed corridor card | |
| **[dsh-plugin-upgrade-015](https://github.com/PerryLink/dsh-plugin-upgrade-015)** | Merged `0.1.3-alpha.1` → `0.1.5-rc.1` upgrade corridor card plus a zero-dependency seam scanner | |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions | |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. | |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. | |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review | |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. | |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. | |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools | |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. | |


## License

[Apache License 2.0](LICENSE) © 2026 dsh-memento contributors

### Instalar a partir do mercado do DSH Desktop

Todos os plugins PerryLink podem ser explorados no mercado integrado do DSH Desktop: **Market → Sources → add source → colar** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ selecionar**. A instalação continua passando pela verificação de identidade npm do mercado e pela sua confirmação.
