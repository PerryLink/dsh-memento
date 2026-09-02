<div align="center">

# dsh-memento
- **Canal 1024 store**: `npm i -g dsh1024` uma vez, depois `dsh1024 plugin --profile web add dsh-memento` (conta para o ranking de instalações do [deepseek1024.com](https://deepseek1024.com)).

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
| Harness | DeepSeek Harness `0.1.2-alpha.5` (adaptado em 2026-09-02): o envelope de sessão mantém seu campo ignorable apenas para compatibilidade de leitura de logs armazenados - o Session.append ainda não consegue estampá-lo, então o comportamento da porta não muda. |
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

**Painel de configurações.** Com o serviço de configurações do DSH montado, todos os campos abaixo (exceto `enabled`) são editáveis em **Configurações → Plugins → Plugin configuration** pelo próprio cartão do plugin; as alterações vão para a camada de usuário das configurações (`settings.yaml`) sem editar arquivos. A maioria aplica-se ao vivo (políticas de escrita, idioma, orçamentos, limites, propostas, painel); os campos marcados como recarregar (`dbPath`, `snapshotOrder`, `auditRetentionDays`, `retrieval.vector`) aplicam-se após recarregar o DSH. Sem o serviço de configurações, tudo volta à configuração composta, exatamente como antes. O botão flutuante do painel pode ser ocultado no mesmo cartão (`panel.enabled`).

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Interruptor mestre; `false` remove serviço, ferramentas, snapshot, comando, painel e answerer (não editável no cartão: um plugin desabilitado não tem cartão) |
| `panel.enabled` | `true` | Mostrar o botão flutuante do painel web; `false` oculta a entrada 🧠 (o cartão de configurações não é afetado) |
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
| settings card | Configurações do DSH → Plugins | Edita todos os campos de configuração (exceto `enabled`) sem tocar em arquivos; o momento de aplicação (ao vivo ou após recarga) é indicado no cartão |

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
npm test                 # node --test: 141 tests
npm run lint             # oxlint
npm run test:conformance # dsh-memory-protocol v1 conformance suite
npm run typecheck        # tsc --checkJs gate
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

Este projeto é um dos [33 plugins de DeepSeek Harness](https://github.com/PerryLink) mantidos por [PerryLink](https://github.com/PerryLink). Se este ajuda você, os outros provavelmente também:

| Plugin | One-liner |
|---|---|
| **[dsh-dsh-auto-review](https://github.com/PerryLink/dsh-dsh-auto-review)** | Auto-revisão de segundo modelo na cadeia de aprovação, com falha fechada por padrão | |
| **[dsh-dsh-background-agents](https://github.com/PerryLink/dsh-dsh-background-agents)** | Agentes filhos em segundo plano duráveis com barra lateral de UI web, mensagens e interrupção | |
| **[dsh-dsh-budget](https://github.com/PerryLink/dsh-dsh-budget)** | Governança de custos para DeepSeek Harness: orçamentos, carbono e latência em um painel. | |
| **[dsh-dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-dsh-checkpoint-rewind)** | Equivalente ao /rewind do Claude Code: instantâneos, bifurcações de sessão, restauração de uso único | |
| **[dsh-dsh-claude-move](https://github.com/PerryLink/dsh-dsh-claude-move)** | Migre sessões, memória, habilidades e CLAUDE.md do Claude Code para o DSH | |
| **[dsh-dsh-click](https://github.com/PerryLink/dsh-dsh-click)** | Controle de desktop nativo multiplataforma para DeepSeek Harness — Windows primeiro. | |
| **[dsh-dsh-composer-history](https://github.com/PerryLink/dsh-dsh-composer-history)** | Histórico de entrada estilo terminal para o compositor web: setas, busca Ctrl+R | |
| **[dsh-dsh-data-quality](https://github.com/PerryLink/dsh-dsh-data-quality)** | Verificações de qualidade de datasets e verificação de citações (a ponte numérica opcional consumida aqui) | |
| **[dsh-dsh-defend](https://github.com/PerryLink/dsh-dsh-defend)** | Defesa contra injeção de prompt, jailbreak e vazamento de segredos para DeepSeek Harness. | |
| **[dsh-dsh-doublecheck](https://github.com/PerryLink/dsh-dsh-doublecheck)** | Guardião de disciplina de engenharia: sabatina de requisitos, portões de teste, revisão adversária | |
| **[dsh-dsh-draw](https://github.com/PerryLink/dsh-dsh-draw)** | Roteamento unificado de geração de imagens estáticas para DeepSeek Harness. | |
| **[dsh-dsh-fast](https://github.com/PerryLink/dsh-dsh-fast)** | Diagnóstico de desempenho só de leitura para DeepSeek Harness. | |
| **[dsh-dsh-fund-research](https://github.com/PerryLink/dsh-dsh-fund-research)** | Relatórios de pesquisa deterministas para fundos mútuos públicos chineses | |
| **[dsh-dsh-github](https://github.com/PerryLink/dsh-dsh-github)** | Integração de PR/issues do GitHub para o DSH, cada escrita controlada por aprovação | |
| **[dsh-dsh-industry-research](https://github.com/PerryLink/dsh-dsh-industry-research)** | Orquestração de pesquisa setorial que sela as suas entregas através do `ctx.researchReport.assemble` deste plugin | |
| **[dsh-dsh-library](https://github.com/PerryLink/dsh-dsh-library)** | Base de conhecimento documental local para DeepSeek Harness. | |
| **[dsh-dsh-local-ai](https://github.com/PerryLink/dsh-dsh-local-ai)** | Integração de modelos locais (Ollama) para DeepSeek Harness. | |
| **[dsh-dsh-lsp-actions](https://github.com/PerryLink/dsh-dsh-lsp-actions)** | Diagnósticos, formatação, autocompletar, ações de código e renomeação LSP sobre servidores de linguagem | |
| **[dsh-dsh-mask](https://github.com/PerryLink/dsh-dsh-mask)** | Middleware de mascaramento de PII: anonimiza no limite do modelo, restaura na camada de exibição | |
| **[dsh-dsh-mcp-panel](https://github.com/PerryLink/dsh-dsh-mcp-panel)** | Painel de tempo de execução MCP somente leitura: comando /mcp + aba Settings com status, ferramentas e erros | |
| **[dsh-dsh-observe](https://github.com/PerryLink/dsh-dsh-observe)** | Exportador de observabilidade OpenTelemetry e Langfuse para DeepSeek Harness. | |
| **[dsh-dsh-output-styles](https://github.com/PerryLink/dsh-dsh-output-styles)** | Troca de estilo em tempo de execução equivalente ao outputStyles do Claude Code | |
| **[dsh-dsh-permission-rules](https://github.com/PerryLink/dsh-dsh-permission-rules)** | Regras de permissão declarativas allow/deny/ask estilo Claude Code com auditoria | |
| **[dsh-dsh-plugin-guide](https://github.com/PerryLink/dsh-dsh-plugin-guide)** | Base de conhecimento de desenvolvimento de plugins como habilidade de agente sob demanda | |
| **[dsh-dsh-research-report](https://github.com/PerryLink/dsh-dsh-research-report)** | Motor de relatórios de pesquisa verificáveis com evidência endereçada por conteúdo | |
| **[dsh-dsh-score](https://github.com/PerryLink/dsh-dsh-score)** | Pontuação de qualidade multidimensional para plugins de DeepSeek Harness. | |
| **[dsh-dsh-session-pin](https://github.com/PerryLink/dsh-dsh-session-pin)** | Fixe sessões na barra lateral web com ordenação durável | |
| **[dsh-dsh-session-sync](https://github.com/PerryLink/dsh-dsh-session-sync)** | Sincronização de sessões entre dispositivos para DeepSeek Harness — um espelho git dedicado do seu armazenamento de sessões. | |
| **[dsh-dsh-skill-pack-security](https://github.com/PerryLink/dsh-dsh-skill-pack-security)** | Pacote de habilidades de auditoria de segurança: varredura de segredos, revisão de dependências e cadeia de suprimentos | |
| **[dsh-dsh-talk](https://github.com/PerryLink/dsh-dsh-talk)** | Loop de sessão com voz para DeepSeek Harness: fale e ouça a resposta. | |
| **[dsh-dsh-test-drive](https://github.com/PerryLink/dsh-dsh-test-drive)** | Test drives isolados de instalação e smoke para plugins de DeepSeek Harness. | |
| **[dsh-dsh-translate](https://github.com/PerryLink/dsh-dsh-translate)** | Tradução de parâmetros entre fornecedores e reparo determinístico de JSON para DeepSeek Harness. | |

## License

[Apache License 2.0](LICENSE) © 2026 dsh-memento contributors
