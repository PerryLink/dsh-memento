<div align="center">

# dsh-memento

**Memoria entre sesiones acotada, por capas, con puerta de aprobación y auditable para DeepSeek Harness.**

*Una costura tipada `ctx.memory`, una puerta de aprobación de escritura que ninguna ruta del modelo puede eludir y pistas de auditoría reconstruibles desde el registro de sesión.*

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
| Harness | DeepSeek Harness `0.1.0-rc.6` |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | Windows / macOS / Linux (solo host; sin código nativo, sin red) |
| Model | Cualquiera |

## What you get

`dsh-memento` es una costura de capacidad, no otro almacén: un servicio tipado `ctx.memory`, un proveedor SQLite local (`node:sqlite`, WAL, `0600`, en `$DSH_HOME/dsh-memento/memory.db`) y sus consumidores — la herramienta `memory` y una instantánea congelada inyectada en el prompt del sistema.

- **La puerta no se puede eludir.** Toda ruta de escritura (`add` / `replace` / `remove` / `seed`) se fuerza a través de la cascada de aprobación dentro del servicio, no en la capa de herramientas. `writePolicy: ask | auto | off` es configuración invisible para el modelo; `replace` / `remove` / `consolidate` llevan el texto completo de las entradas que cambian en el payload de aprobación, y una escritura denegada deja igualmente una fila de auditoría `*-denied`.
- **Visible para el modelo ⟺ registrado.** La instantánea inyectada llega textualmente a `request/header.system`; cada escritura es reconstruible a partir de `approval/asked` + `approval/decided` + la propia tabla de auditoría del plugin.
- **Acotada y honesta.** Presupuestos estrictos de caracteres por pista y por capa (por defecto usuario 2000 / agente 4000). Un almacén lleno falla con un error estructurado (uso + límite): nunca se trunca, nunca se compacta automáticamente.

Dos pistas × dos capas × clave por agente: una pista `user` (hechos sobre el usuario) y una pista `agent` (hechos de entorno y convenciones), cada una dividida en capas `user-global` y `workspace`, aisladas por `agentPreset`. La instantánea se congela una vez por sesión en el primer ensamblado del prompt y nunca cambia a mitad de sesión.

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
- **canal npm** (versiones publicadas): `dsh plugin --profile web add dsh-memento`.
- **canal tarball**: `npm pack` en este repo, luego `dsh plugin --profile web add ./dsh-memento-<version>.tgz`.
- **desinstalar**: `dsh plugin --profile web remove dsh-memento` (la base de datos de memoria y los registros de sesión se conservan).

## Configuration

Todos los parámetros son campos Schemastery `Config` (modificables desde cordis.yml). Los valores inválidos fallan de forma ruidosa al cargar. Se sobrescriben bajo la fila `memento`.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Interruptor maestro; `false` elimina servicio, herramientas, instantánea, comando, panel y answerer |
| `dbPath` | `''` → `$DSH_HOME/dsh-memento/memory.db` | Absoluto, o relativo a `$DSH_HOME` (en Windows cae a `~/.dsh`) |
| `budgets.user.userGlobal` | `2000` | Presupuesto estricto de caracteres de la capa user-global de la pista user |
| `budgets.user.workspace` | `2000` | Presupuesto estricto de caracteres de la capa workspace de la pista user |
| `budgets.agent.userGlobal` | `4000` | Presupuesto estricto de caracteres de la capa user-global de la pista agent |
| `budgets.agent.workspace` | `4000` | Presupuesto estricto de caracteres de la capa workspace de la pista agent |
| `writePolicy` | `'ask'` | Política de escritura por defecto: `ask` / `auto` / `off` (invisible para el modelo) |
| `writePolicies` | `{}` | Sobrescrituras por pista/ámbito o por origen (p. ej. `user/workspace`, `source:claude`) |
| `language` | `'en'` | Idioma del texto visible y la salida del comando: `en` / `zh` |
| `snapshotOrder` | `-50` | Orden de la sección de instantánea (tras la identidad del harness, antes de persona) |
| `maxEntriesPerQuery` | `20` | Tope de resultados por consulta por defecto (límite duro 1000) |
| `commandListLimit` | `50` | Entradas mostradas por `/memory list` / `query` |
| `commandAuditLimit` | `10` | Filas de auditoría mostradas por `/memory audit` |
| `recall.historyLimitDefault` | `8` | Sesiones escaneadas por `memory_recall` por defecto |
| `recall.snippetCap` | `5` | Fragmentos por sesión en `memory_recall` |
| `recall.snippetChars` | `300` | Caracteres de fragmento en `memory_recall` |
| `recall.windowDays` | `30` | Ventana de antigüedad en días de `memory_recall` |
| `panelEntriesLimit` | `200` | Tamaño de página de entradas del panel web |
| `panelAuditLimit` | `20` | Filas de auditoría del panel web por defecto |
| `auditRetentionDays` | `0` | Retención de auditoría (0 = conservar para siempre) |
| `proposals.enabled` | `true` | Capturar automáticamente una propuesta de memoria tras cada compactación exitosa |
| `proposals.maxChars` | `2000` | Tope de caracteres de la propuesta |
| `proposals.maxPending` | `8` | Tope de propuestas pendientes |

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `memory` | tool | add/replace/remove/consolidate/query con guía Save/Skip; las escrituras pasan por la puerta de aprobación |
| `memory_recall` | tool | Coincidencias acotadas de memoria más coincidencias recientes del historial de sesión |
| `/memory` | command | `list` · `query` · `add` · `remove` · `consolidate` · `proposals` · `budgets` · `audit` · `export` · `import <path>` · `adapters` |
| web panel | client drawer | Solo lectura: explorar entradas, buscar, barras de presupuesto, cola de auditoría |

## dsh-memory-protocol v1

`dsh-memento` es el ensayo comunitario del protocolo de memoria DSH — una forma candidata para una costura oficial `ctx.memory`. El protocolo normaliza la costura de este plugin en un contrato entre plugins:

- **Entry spec** — dos pistas × dos capas × clave por agente, más `tags` cortos (≤16 × ≤32 caracteres) y un `version` por entrada que se incrementa en cada `replace`.
- **Write semantics** — escrituras condicionales idempotentes por subcadena única; payloads de aprobar-lo-que-se-ve (`replace` / `remove` / `consolidate` llevan el texto completo que cambian).
- **Audit contract** — cada escritura reconstruible desde `approval/asked` + `approval/decided` + el libro mayor del proveedor.
- **Budget model** — semántica `BUDGET_EXCEEDED` / `AMBIGUOUS_MATCH`.
- **Schema versioning** — reglas de migración con verificaciones de versión ruidosas.

- **Spec** — [docs/protocol-v1.md](docs/protocol-v1.md) (中文: [protocol-v1.zh.md](docs/protocol-v1.zh.md)); JSON Schema normativo en [docs/schemas/dsh-memory-protocol-v1.schema.json](docs/schemas/dsh-memory-protocol-v1.schema.json).

**Registro de adaptadores** — `ctx.memoryAdapters` (`register` / `list` / `adapt` / `export`) permite a plugins de memoria de terceros hablar el protocolo registrando un convertidor de datos puro (`register()` reversible; la importación usa el `seed` con puerta de aprobación, la exportación es de solo lectura). Incorporación: [docs/adapters-guide.md](docs/adapters-guide.md) (中文: [adapters-guide.zh.md](docs/adapters-guide.zh.md)).

| Built-in adapter | External format | Notes |
|---|---|---|
| `mem0` | colecciones de hechos mem0 (`{facts: [{memory, metadata?}]}`) | `metadata.category` / `metadata.tags` se convierten en tags; los arrays `messages` crudos se rechazan — los adaptadores convierten, nunca extraen |
| `hermes-memory-md` | `memory.md` de Hermes (`## section` + viñetas) | los nombres de sección se convierten en tags; la prosa sin viñetas falla ruidosamente |
| `claude-code-memory-md` | markdown estilo `CLAUDE.md` (encabezados, viñetas, párrafos) | las viñetas y párrafos se convierten en entradas; los nombres de sección se convierten en tags |

**Suite de conformidad** — [test/protocol-conformance/](test/protocol-conformance/README.md): un conjunto de casos distribuible que cualquier proveedor que reclame compatibilidad ejecuta (`node test/protocol-conformance/run.mjs --provider ./your-factory.mjs`); el CI de este repo lo ejecuta contra su propio proveedor como referencia dorada (`npm run test:conformance`).

- **Upstream proposal** — [docs/upstream-proposal.md](docs/upstream-proposal.md) (中文: [upstream-proposal.zh.md](docs/upstream-proposal.zh.md)): por qué la costura oficial `ctx.memory` debería adoptar el protocolo, las diferencias y la ruta de migración.

## Permissions & data

- **Permissions**: el manifiesto de workshop declara `harness:tool`, `filesystem:read`, `filesystem:write` y `network:none` / `subprocess:none` / `shell:none` / `python:none` / `credentials:none`. La aprobación de escritura usa la costura oficial de aprobación.
- **Data**: base de datos SQLite local (`0600`), cero red, cero credenciales.
- **Session log**: la completitud de auditoría proviene del par de aprobación (`approval/asked` + `approval/decided`) más la tabla de auditoría del plugin.

## Security boundaries

- **Solo servicios públicos.** Consume `tools`, `systemPrompt` y la costura de aprobación; sin cambios en engine / agent-loop / apiproxy / UI oficial.
- **Cero red, cero credenciales.** Base de datos local con modo de archivo POSIX `0600`.
- **Fallo ruidoso.** Base de datos corrupta, esquema más nuevo o configuración inválida falla al cargar; presupuestos llenos y coincidencias de subcadena ambiguas fallan con errores estructurados.
- **Un proceso, un almacén.** Varias sesiones comparten el almacén SQLite; dos procesos que comparten un `$DSH_HOME` escriben el mismo archivo (último escritor gana bajo el bloqueo de SQLite).

## Known limitations

- **Los eventos de sesión están declarados, aún no emitidos (rc.6).** `memory/added|updated|removed|recalled|snapshot` están declarados por fusión, pero rc.6 no tiene superficie de registro para tipos de evento fuera del repo; la emisión se activa cuando una build del harness los registre.
- **La política `ask` necesita un answerer.** Sin un answerer UI/ACP compuesto, las escrituras fallan cerradas.
- **Sin indexado FTS5.** La búsqueda por subcadena usa `instr` insensible a mayúsculas (correcto para CJK).

## What we learned from the terminal memories

`dsh-memento` no es un port de Claude Code, Codex o Hermes — pero su diseño absorbió deliberadamente las partes que cada uno hizo bien, y rechazó las que dañaban:

| Terminal memory | Lo que hizo bien | Lo que dsh-memento adoptó |
|---|---|---|
| **Claude Code** — `CLAUDE.md` | archivos de memoria en texto plano jerárquicos (nivel usuario → nivel proyecto), legibles y editables por humanos, fusionados automáticamente en cada sesión | entradas en texto plano; capas `user-global` / `workspace` fusionadas por sesión; un almacén que puedes explorar, `export` y auditar — transparencia como característica |
| **Codex** — `AGENTS.md` | instrucciones con ámbito por directorio auto-descubiertas e inyectadas con fricción cero para el modelo | la capa `workspace` indexada por el cwd de la sesión (insensible a mayúsculas en Windows); la instantánea congelada inyectada automáticamente al iniciar la sesión |
| **Hermes** — `memory.md` | guardados de memoria proactivos y la lección de seguridad de que una puerta aplicada solo en la capa de herramientas es eludible por inyección tardía de herramientas | la herramienta `memory` con guía Save/Skip + propuestas de auto-captura con puerta de aprobación; la puerta vive dentro de los métodos de escritura de `ctx.memory`, no en la capa de herramientas |

Fuentes: [Claude Code memory](https://code.claude.com/docs/en/memory) · [Codex AGENTS.md](https://developers.openai.com/codex/cli/agents-md) · [Hermes memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md) · [Hermes #48181](https://github.com/NousResearch/hermes-agent/issues/48181).

Y las partes deliberadamente rechazadas: la auto-resumación oculta hacia estado privado del modelo (los resúmenes de compactación aquí se convierten en **propuestas pendientes** que esperan un approve/dismiss humano), las ambiciones de almacén/vector-store, y cualquier escritura sin aprobación o rastro de auditoría visible para humanos. También adoptado: la advertencia documentada de Hermes de que dos procesos que comparten un directorio home escriben el mismo archivo de memoria — véase Security boundaries.

## Development

```sh
npm install              # node ^22.19 || >=24
npm test                 # node --test: 133 tests
npm run test:conformance # dsh-memory-protocol v1 conformance suite
npm run typecheck        # tsc --checkJs gate
npm run check:coverage   # line-coverage gate
npm run check:readmes    # five-language README consistency gate
```

`lib/` tiene cero dependencias de DSH (solo builtins de node:); las importaciones de DSH solo existen en `index.mjs`.

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `memory`, `agent-memory`, `approval`, `audit`, `sqlite`, `cordis`, `llm`

## Contributors

- [@Niuniu-Sir](https://github.com/Niuniu-Sir) — el informe de fallo de arranque en [issue #1](https://github.com/PerryLink/dsh-memento/issues/1) que llevó al fallback `~/.dsh` incluido en 0.3.1.

## PerryLink DSH Plugin Family

Este proyecto es uno de los [15 plugins de DeepSeek Harness](https://github.com/PerryLink) mantenidos por [PerryLink](https://github.com/PerryLink). Si este te ayuda, los demás probablemente también:

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
