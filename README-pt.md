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

```sh
dsh plugin --profile <name> add dsh-memento
```


</div>

---


**📖 Base de conhecimento do ecossistema** — dados medidos, não marketing: [guia de desenvolvimento · dados de seleção · critérios de manutenção](https://perrylink.github.io/dsh-plugin-guide/).

<!-- star-cta -->
## Install & uninstall

- **canal git** (último `main`): `dsh plugin --profile web add git+https://github.com/PerryLink/dsh-memento.git`.
- **canal npm** (versões publicadas): `dsh plugin --profile web add dsh-memento`.
- **canal tarball**: `npm pack` neste repo, depois `dsh plugin --profile web add ./dsh-memento-<version>.tgz`.
- **desinstalar**: `dsh plugin --profile web remove dsh-memento` (o banco de memória e os logs de sessão são mantidos).

## ⭐ 如果它帮到了你

Este plugin faz parte da [família de plugins DSH](https://github.com/PerryLink) (mais de 40, todos Apache-2.0). Se for útil, **deixe uma estrela**: não desbloqueia nada, mas ajuda a próxima pessoa a encontrá-lo.

*English:* part of a 95 plugin family for DeepSeek Harness. If it is useful, **a star helps the next person find it** — nothing is gated behind it.

## What is dsh-memento?

Memória entre sessões limitada, em camadas, com porta de aprovação e auditável para o DeepSeek Harness.

Uma costura tipada `ctx.memory`, uma porta de aprovação de escrita que nenhum caminho do modelo pode contornar e uma auditoria reconstruível — do par de aprovação mais a tabela de auditoria do plugin, com a lacuna do log de sessão dita em voz alta.

![Demonstração de terminal do dsh-memento: dsh-memento — read-only stdio MCP server, tools/list over JSON-RPC](https://raw.githubusercontent.com/PerryLink/dsh-memento/main/docs/assets/dsh-memento-hero.png)

![Animated terminal demo of dsh-memento](https://raw.githubusercontent.com/PerryLink/dsh-memento/main/docs/assets/dsh-memento-demo.gif)

*A mesma execução, animada.*

[![Passo a passo em vídeo do dsh-memento — abre o arquivo MP4](https://raw.githubusercontent.com/PerryLink/dsh-memento/main/docs/assets/dsh-memento-demo-video.png)](https://github.com/PerryLink/dsh-memento/blob/main/docs/assets/dsh-memento-demo.mp4)

*▶ **Passo a passo narrado de 2 min 23 s** — a miniatura abre o arquivo MP4; se não reproduzir na página, use *Download raw file* lá ([MP4, 1,87 MB](https://github.com/PerryLink/dsh-memento/blob/main/docs/assets/dsh-memento-demo.mp4) · [download direto](https://raw.githubusercontent.com/PerryLink/dsh-memento/main/docs/assets/dsh-memento-demo.mp4)). O GitHub remove as tags `<video>` dos READMEs, então o vídeo é um arquivo a abrir, e não algo embutido.*

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.2.1-alpha.2` (adaptado em 2026-10-12; `0.2.1-alpha.1` desde 2026-10-04): a linha `0.1.7` substituiu toda a superfície de registro de configurações (`installSettingsSection` / `SettingsProvider.installSection` / `SettingsNamespace` / `SettingsScope`) por formulários de config ao vivo, então as duas metades seguem o contrato novo — o namespace de um formulário é o id da entrada do perfil (`memento`), seus campos editáveis são os marcados `.volatile()` e uma edição aceita é confirmada **dentro do plugin em execução** em vez de remontá-lo. A metade de navegador lê esse formulário por `ctx.configForms.get(entryId)` (o serviço `ctx.settingsScope` deixou de existir). As duas metades mantêm seus ramos `installSection` / `settingsScope` para as linhas `0.1.2-rc.1`, `0.1.5-alpha.1` e `0.1.6-0` que o intervalo de peers ainda anuncia, e a nova cláusula `>=0.1.7-0 <0.2.0` é o que torna o próprio host alvo instalável (o intervalo antigo o excluía pela regra de semver para versões preliminares). Ainda não há superfície de registro de eventos para plugins — `KNOWN_SESSION_EVENT_TYPES` não inclui `memory/*` e o terceiro argumento de `Session.append` só carrega um `SurfaceIntent` para tipos de superfície, então a porta de auditoria continua adaptativa e pula como antes (diz isso uma vez por processo e em `/memory audit`). A evidência de tipos vem de três faces: os tipos já compilados do checkout local, a linha publicada fixada em `node_modules` e a metade de navegador sob uma lib DOM. **Reverificado contra `0.2.1-alpha.2`:** todas as costuras do host que este pacote toca são **idênticas byte a byte** entre as duas etiquetas (`packages/settings/settings/src/**`, `packages/client/ui-settings/src/**`, `packages/client/ui-slots/src/**`, `packages/client/modules/src/**`, `packages/interaction/user-approval/**`, `vendor/loader/src/**`, `vendor/schemastery/src/**`, `packages/boot/app-boot/src/config-schema/**`), o formato de sessão continua sendo v4 sem migração v4→v5, e `KNOWN_SESSION_EVENT_TYPES` ganhou apenas um tipo de primeira parte — então a porta de auditoria adaptativa continua fechada e **nenhuma mudança de código foi necessária**. O que mudou foi a linha fixada de dev/test (`0.2.1-alpha.2`, mais suas entradas na lista de permitidos por idade de release do `pnpm-workspace.yaml`) e a linha de base de compatibilidade; `npm test` (201 casos, incluindo a suíte de composição com o Loader real), `typecheck:ci`, cobertura, artefatos, conformidade e os portões de cinco idiomas passam contra ela. O alpha.2 de fato adiciona um escritor `appendPluginRecord` no espaço de nomes `plugin:<name>/*`, mas o próprio `packages/core/session/README.md` do host proíbe plugins externos ao repositório de chamá-lo e o prefixo obrigatório `plugin:` não consegue expressar `memory/*`, então este pacote não o adota. |
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
dsh plugin --profile web add github:PerryLink/dsh-memento
```

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add github:PerryLink/dsh-memento

# or from npm (published releases)
dsh plugin --profile web add dsh-memento

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A3 'id: memento'
```

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

## Interoperability with other DSH plugins

Verificado contra **DSH `0.2.0-rc.2`** (o runtime para o qual este README é publicado) e o conjunto de plugins com mais estrelas pesquisado em 2026-10-05.

Este plugin **não interfere** em outros plugins, incluindo os de mais estrelas:

- **Sem colisão de nome de ferramenta.** Todas as ferramentas têm namespace; nenhuma ocupa um nome puro já pertencente a uma ferramenta embutida ou a outro plugin.
- **Sem colisão de chave de serviço.** Fornece apenas `memory`, `memoryAdapters`, `memoryEmbedding`, `memoryRetrieval`; essa chave não é uma costura embutida nem é fornecida por nenhum plugin de mais estrelas.
- **Sem colisão de slot.** Não registra nenhuma chave de slot de cliente, então não disputa um assento `shadows-shipped-ui`.
- **Sem colisão de rota HTTP.** Não registra nenhum prefixo `webServer`.
- **Sem colisão na camada de patch.** O patch do bundle apenas faz `insert` da própria linha; nunca sobrescreve o `config` de uma linha embutida.
- **Sem mutação global.** Não altera protótipos, não reescreve `process.env` nem substitui o dispatcher global de fetch.

**Listeners de eventos compartilhados não interferem por construção.** Observa os eventos sensíveis à ordem `approval/request` com `ctx.on()` — o registro de difusão do Cordis, onde cada listener executa e nenhum pode privar outro do turno. **Todos os listeners aqui delegam via `next()`**, então a cadeia nunca é curto-circuitada:

Evidência estática: `dsh-plugin-doctor` K10–K13 retornam `pass` em todas as verificações deste repositório.

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `memory`, `agent-memory`, `approval`, `audit`, `sqlite`, `cordis`, `llm`

## Contributors

- [@Niuniu-Sir](https://github.com/Niuniu-Sir) — o relato de falha de inicialização na [issue #1](https://github.com/PerryLink/dsh-memento/issues/1) que levou ao fallback `~/.dsh` incluído na 0.3.1.
- [@alex-debap](https://github.com/alex-debap) — **product manager**. Cuidou da forma do produto, não do seu código, ao longo de toda a linha de design desde o início: a tese da costura e não outro armazém (uma costura tipada `ctx.memory`, não outro armazém de memória), a exigência de que a porta de aprovação de escrita seja aplicada dentro do serviço, de modo que nenhum caminho do modelo possa contorná-la, em vez de ser uma convenção da camada de ferramentas, e a garantia de auditoria de que toda escrita seja reconstruível a partir do par de aprovação mais a tabela de auditoria do próprio plugin. Nomeou o modelo de recordação limitado e em camadas — duas trilhas × duas camadas, chave por agente, orçamentos de caracteres rígidos por trilha e por camada — e defendeu o armazenamento local primeiro e sem credenciais (`0600`, SQLite sob `$DSH_HOME`, sem rede e sem chaves). Levou o trabalho de protocolo como uma linha de produto: o ensaio público do `dsh-memory-protocol` v1, seu registro de adaptadores e sua suíte de conformidade. Sustentou a linha de escopo sobre o que este plugin deliberadamente não faz.

## PerryLink DSH Plugin Family

Este projeto é um dos **87 plugins ativamente mantidos** do DeepSeek Harness da [PerryLink](https://github.com/PerryLink). O registro da família tem **95** plugins — **5 congelados**, **3 retirados** — e fica recolhido abaixo para que cada README mantenha uma primeira tela curta. Expanda para ver cada linha, com o motivo na coluna Status.

<details>
<summary>Expandir os 95 plugins</summary>

| Plugin | Uma linha | Status |
|---|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** | 水产养殖投入品记录核对（按投入品用量、休药期与起捕间隔核对记录自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** | 档案归档完整性与保管期限核对（依据《档案法》及配套规定，仅提示差异，不作出定性结论） |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command |  |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | 🚫 RETIRADO — ver o README do repositório |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** | 投标文件符合性预检（按招标文件逐条核对响应情况，仅提示差异，不作出定性结论） |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** | 投标人资格条件核对（按资格条件与证明材料核对逐条响应，仅提示差异，不作出定性结论） |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |  |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** | 合同条款立场台账核对（按立场、风险等级与退让底线核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** | 报关单证一致性核对（按公开的报关单填制规范核对单证间字段一致性，仅提示差异，不作出定性结论） |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) |  |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** | 滞箱费台账核对（按免箱期与费率核对超期天数与金额的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review |  |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-drill-script-check](https://github.com/PerryLink/dsh-drill-script-check)** | 应急演练脚本核对（按阶段、响应分级、指挥与资源要素核对脚本齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-eia-guide-check](https://github.com/PerryLink/dsh-eia-guide-check)** | 环评导则适用性核对（按要素、导则名称与执行标准核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-emergency-plan](https://github.com/PerryLink/dsh-emergency-plan)** | 应急预案要素齐备性与条款级页码定位（依据 GB/T 29639-2020 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-essay-rubric-check](https://github.com/PerryLink/dsh-essay-rubric-check)** | 作文量表评分核对（按评分项、原文定位与分值算术核对评分自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-evidence-check](https://github.com/PerryLink/dsh-evidence-check)** | 证据清单齐备性核对（按待证事实与证据要素核对清单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-export-ctl-check](https://github.com/PerryLink/dsh-export-ctl-check)** | 出口管制物项核对（按管制清单、最终用途与许可证核对台账齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. |  |
| **[dsh-fmea-table-check](https://github.com/PerryLink/dsh-fmea-table-check)** | FMEA 分析表要素齐备性与风险顺序数一致性核对（按公开的 FMEA 方法标准核对表内自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-forecast-penalty](https://github.com/PerryLink/dsh-forecast-penalty)** | 预测准确率考核核对（按准确率、门槛与考核单价核对考核费用的算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds |  |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval |  |
| **[dsh-gongwen-flow-check](https://github.com/PerryLink/dsh-gongwen-flow-check)** | 公文流转与办理时限核对（按公开的公文处理规范核对环节完整性与时限，仅提示差异，不作出定性结论） |  |
| **[dsh-gongwen-word-check](https://github.com/PerryLink/dsh-gongwen-word-check)** | 公文格式要素核对（按公开的党政机关公文格式标准核对版头与主体要素，仅提示差异，不作出定性结论） |  |
| **[dsh-guard-plan-qc](https://github.com/PerryLink/dsh-guard-plan-qc)** | 劳动保护与安全防护用品配置表核对（按公开的配备标准核对品名规格与配置数量，仅提示差异，不作出定性结论） |  |
| **[dsh-hazchem-check](https://github.com/PerryLink/dsh-hazchem-check)** | 危险化学品临界量与重大危险源辨识核对（按储存量与临界量核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-hazplan-check](https://github.com/PerryLink/dsh-hazplan-check)** | HAZOP 分析表要素齐备性与偏差推导一致性核对（依据公开的危险与可操作性分析标准，仅提示差异，不作出定性结论） |  |
| **[dsh-hidden-risk-map](https://github.com/PerryLink/dsh-hidden-risk-map)** | 安全隐患台账→《工贸企业重大事故隐患判定标准》（应急管理部令第10号）条款映射提示（仅提示差异，不作出定性结论） |  |
| **[dsh-hs-classify](https://github.com/PerryLink/dsh-hs-classify)** | 商品归类层级一致性核对（按章、品目、子目与商品编号的层级关系核对自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-icd-rule-check](https://github.com/PerryLink/dsh-icd-rule-check)** | ICD 合并编码与星剑号配对提示（依据 GB/T 14396-2016 与公开的 ICD 使用说明，仅提示差异，不作出定性结论） |  |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` |  |
| **[dsh-lawcite-adapter](https://github.com/PerryLink/dsh-lawcite-adapter)** | 法条引用与文书要素核对（按名称、条号、原文与效力状态核对引用可核验性，仅提示差异，不作出定性结论） |  |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** | Laya typed decisions (`noul`/`choice`/`score`) as a first-class Cordis service and model-visible tools |  |
| **[dsh-lc-doc-check](https://github.com/PerryLink/dsh-lc-doc-check)** | 信用证单据条款核对（按单据种类、份数、期限与不符点核对交单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-learning-gap-check](https://github.com/PerryLink/dsh-learning-gap-check)** | 能力差距与培养计划核对（按能力等级差、培养措施与完成期限核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** | Local document knowledge base for DeepSeek Harness. |  |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. |  |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions and rename over language servers |  |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer |  |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors |  |
| **[dsh-medrec-qc](https://github.com/PerryLink/dsh-medrec-qc)** | 病案首页形式质控与逻辑矛盾提示（依据国卫办医发〔2016〕24号等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool |  |
| **[dsh-nsfc-form-check](https://github.com/PerryLink/dsh-nsfc-form-check)** | 国家自然科学基金申请书形式审查与匿名化提示（依据《国家自然科学基金条例》与申请人导入的当年指南，仅提示差异，不作出定性结论） |  |
| **[dsh-nurse-record-check](https://github.com/PerryLink/dsh-nurse-record-check)** | 护理记录时限、签名与评估表完整性校验（依据《病历书写基本规范》等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. |  |
| **[dsh-origin-rvc-check](https://github.com/PerryLink/dsh-origin-rvc-check)** | 原产地区域价值成分核对（按 RVC 定义式与门槛核对原产地判定自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-ota-review-check](https://github.com/PerryLink/dsh-ota-review-check)** | 在线点评回复台账核对（按回复时限、问题分类与整改状态核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching |  |
| **[dsh-paper-doc-adapter](https://github.com/PerryLink/dsh-paper-doc-adapter)** | 试卷解析结构核对（按题型、答案、分值与 yotta 标识核对试卷结构自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit |  |
| **[dsh-permit-report-check](https://github.com/PerryLink/dsh-permit-report-check)** | 行政许可办理核对（按申请材料、法定时限与决定记录核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-pipeline-check](https://github.com/PerryLink/dsh-pipeline-check)** | 项目全流程文件链条核对（按环节先后与金额口径核对链条自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-pleading-draft](https://github.com/PerryLink/dsh-pleading-draft)** | 起诉状要素齐备性核对（按诉请、事实、证据、法条四要素核对文书齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | Zero-dependency static + sandbox smoke detector for DSH plugins |  |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | Shared zero-runtime-dependency toolkit for the PerryLink DSH plugins |  |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | One-package, one-corridor-index plugin upgrade skill: routes a repository to the matching closed corridor card |  |
| **[dsh-policy-brief-draft](https://github.com/PerryLink/dsh-policy-brief-draft)** | 政策专报要素核对（按观点、依据、出处与建议核对专报齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-power-loss-split](https://github.com/PerryLink/dsh-power-loss-split)** | 线损电量拆分与考核表核对（依据公开的线损计算口径，仅提示差异，不作出定性结论） |  |
| **[dsh-power-ticket-check](https://github.com/PerryLink/dsh-power-ticket-check)** | 电力工作票要素齐备性与签发许可顺序核对（依据现行电力安全工作规程，仅提示差异，不作出定性结论） |  |
| **[dsh-ppap-check](https://github.com/PerryLink/dsh-ppap-check)** | PPAP 提交要素齐备性核对（按公开的 PPAP 手册与提交等级核对要素齐备与版本填写，仅提示差异，不作出定性结论） |  |
| **[dsh-protest-deadline](https://github.com/PerryLink/dsh-protest-deadline)** | 质疑与投诉期限核对（按公开的政府采购质疑投诉规定核对期限与台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-railway-window](https://github.com/PerryLink/dsh-railway-window)** | 铁路施工天窗台账核对（按时间窗、时长算术与命令号核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** | 维修工单结算核对（按项目金额、配件工时合计与结算总额核对算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** | 审稿意见逐条回应覆盖核对（按意见与回应一一对应核对覆盖完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** | 规则库文件自检核对（按条款引用纪律与效力上限核对规则库自身合规，仅提示差异，不作出定性结论） |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** | 安全技术交底记录要素齐备性与签字闭环核对（依据公开的安全生产法规与检查标准，仅提示差异，不作出定性结论） |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. |  |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | 🚫 RETIRADO — ver o README do repositório |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** | 监理日志跨日连续性与旁站覆盖提示（依据 GB/T 50319-2013 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** | 三重一大决策台账核对（按前置研究、会议审议与决议记录核对程序留痕，仅提示差异，不作出定性结论） |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** | 土壤与地下水监测台账核对（按点位、监测项目、限值与超标判定核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** | 作业规程与 FMEA／控制计划一致性核对（按编号与版本核对三份文件是否同步，仅提示差异，不作出定性结论） |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** | 控制图常数与过程能力指数核对（按 GB/T 4091 的常规控制图常数表核对控制限与 Cp/Cpk 的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. |  |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | 🚫 RETIRADO — ver o README do repositório |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** | 招标文件条款摘录核对（按出处与原文逐字核对摘录完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** | 评标因素评分矩阵核对（按分值上限与合计核对矩阵自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools |  |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** | 质保期与索赔金额核对（按质保期月数与里程、索赔金额算式核对自洽，仅提示差异，不作出定性结论） |  |

</details>

</details>

</details>

## License

[Apache License 2.0](LICENSE) © 2026 dsh-memento contributors

### Instalar a partir do mercado do DSH Desktop

Todos os plugins PerryLink podem ser explorados no mercado integrado do DSH Desktop: **Market → Sources → add source → colar** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ selecionar**. A instalação continua passando pela verificação de identidade npm do mercado e pela sua confirmação.
