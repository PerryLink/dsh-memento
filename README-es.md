<div align="center">

# dsh-memento
- **Canal 1024 store**: `npm i -g dsh1024` una vez, luego `dsh1024 plugin --profile web add dsh-memento` (cuenta para el ranking de instalaciones de [deepseek1024.com](https://deepseek1024.com)).

**Memoria entre sesiones acotada, por capas, con puerta de aprobación y auditable para DeepSeek Harness.**

*Una costura tipada `ctx.memory`, una puerta de aprobación de escritura que ninguna ruta del modelo puede eludir y una auditoría reconstruible — desde el par de aprobación más la tabla de auditoría del plugin, con la brecha del registro de sesión dicha en voz alta.*

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

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

</div>

---

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.1.7-alpha.1` (adaptado el 2026-09-22): la línea `0.1.7` sustituyó toda la superficie de registro de ajustes (`installSettingsSection` / `SettingsProvider.installSection` / `SettingsNamespace` / `SettingsScope`) por formularios de config en vivo, así que ambas mitades siguen el contrato nuevo — el namespace de un formulario es el id de la entrada del perfil (`memento`), sus campos editables son los marcados `.volatile()` y una edición aceptada se confirma **dentro del plugin en ejecución** en lugar de remontarlo. La mitad de navegador lee ese formulario con `ctx.configForms.get(entryId)` (el servicio `ctx.settingsScope` ya no existe). Ambas mitades conservan sus ramas `installSection` / `settingsScope` para las líneas `0.1.2-rc.1`, `0.1.5-alpha.1` y `0.1.6-0` que el rango de peers sigue anunciando, y la nueva cláusula `>=0.1.7-0 <0.2.0` es lo que hace instalable al propio host objetivo (el rango anterior lo excluía por la regla de semver sobre versiones preliminares). Sigue sin haber superficie de registro de eventos para plugins — `KNOWN_SESSION_EVENT_TYPES` no incluye `memory/*` y el tercer argumento de `Session.append` solo lleva un `SurfaceIntent` para tipos de superficie, así que la puerta de auditoría sigue siendo adaptativa y se salta igual (lo dice una vez por proceso y en `/memory audit`). La evidencia de tipos viene de tres caras: los tipos ya compilados del checkout local, la línea publicada fijada en `node_modules` y la mitad de navegador bajo una lib DOM. |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | Windows / macOS / Linux (solo host; sin código nativo, sin red) |
| Model | Cualquiera |

## What you get

`dsh-memento` es una costura de capacidad, no otro almacén: un servicio tipado `ctx.memory`, un proveedor SQLite local (`node:sqlite`, WAL, `0600`, en `$DSH_HOME/dsh-memento/memory.db`) y sus consumidores — la herramienta `memory` y una instantánea congelada inyectada en el prompt del sistema.

- **La puerta no se puede eludir.** Toda ruta de escritura (`add` / `replace` / `remove` / `seed`) se fuerza a través de la cascada de aprobación dentro del servicio, no en la capa de herramientas. `writePolicy: ask | auto | off` es configuración invisible para el modelo; `replace` / `remove` / `consolidate` llevan el texto completo de las entradas que cambian en el payload de aprobación, y una escritura denegada deja igualmente una fila de auditoría `*-denied`.
- **Visible para el modelo ⟺ registrado.** La instantánea inyectada llega textualmente a `system/message`; cada escritura es reconstruible a partir de `approval/asked` + `approval/decided` + la propia tabla de auditoría del plugin.
- **Acotada y honesta.** Presupuestos estrictos de caracteres por pista y por capa (por defecto usuario 2000 / agente 4000). Un almacén lleno falla con un error estructurado (uso + límite): nunca se trunca, nunca se compacta automáticamente.
- **La brecha de auditoría es visible.** `/memory audit` lista la tabla de auditoría del plugin y añade una línea cuando el lado del registro de sesión no se escribe: este host no conoce los tipos de evento `memory/*`, y añadir tipos desconocidos dejaría la sesión ilegible, así que las escrituras se auditan con `approval/asked` + `approval/decided` y la tabla del plugin. La puerta es adaptativa: la línea desaparece sola cuando el host conoce esos tipos.

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

**Panel de ajustes.** En la línea `0.1.7` el propio `Config` del plugin **es** su página de ajustes: el namespace del formulario es el id de la entrada del perfil (`memento`, es decir el `id:` de la fila de este bundle), los campos editables son exactamente los que el plugin declara `.volatile()` (todas las claves de abajo salvo `enabled`), y una edición aceptada se fusiona en la fila del plugin del perfil y se confirma dentro del plugin en ejecución — sin tocar archivos ni reiniciar. Casi todo se aplica en vivo (políticas de escritura, idioma, presupuestos, topes, propuestas, panel; `dbPath` / `auditRetentionDays` reabriendo el almacén; `retrieval.vector` cambiando el recuperador); lo que el plugin registra al cargar (`snapshotOrder`, las descripciones de las herramientas) se relee al recargar, y la página marca esos campos. Los límites numéricos también están declarados en el esquema, así que una edición fuera de rango se rechaza en el momento de escribir en lugar de dejar una configuración inservible. En las líneas antiguas (`0.1.2-rc.1`, `0.1.5-alpha.1`, `0.1.6-0`) la misma tarjeta edita el namespace de ajustes `dsh-memento`, igual que antes; sin ningún servicio de ajustes todo vuelve a la configuración compuesta. El botón flotante del panel puede ocultarse desde la misma página (`panel.enabled`).

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Interruptor maestro; `false` elimina servicio, herramientas, instantánea, comando, panel y answerer (no editable desde la página de ajustes: un plugin deshabilitado no tiene entrada de ajustes) |
| `panel.enabled` | `true` | Mostrar el botón flotante del panel web; al guardar `false` desde la página de ajustes, la entrada 🧠 se oculta al instante, sin recargar (la página de ajustes no se ve afectada) |
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
| `retrieval.vector` | `false` | Interruptor de recuperación semántica: `true` activa la recuperación vectorial de `memory_recall` (incrustación hash falsa) cuando hay un proveedor de incrustación; en caso contrario degrada a subcadena |
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
| web panel | client drawer | Solo lectura: explorar entradas, buscar, barras de presupuesto, cola de auditoría; el botón flotante puede ocultarse (`panel.enabled`) |
| settings section | Barra lateral de ajustes de DSH → `dsh-memento` | Edita todos los campos de configuración (salvo `enabled`) sin tocar archivos (en la línea `0.1.7` el namespace es la entrada de perfil `memento`; antes era el namespace de ajustes `dsh-memento`); el momento de aplicación (en vivo o tras recarga) se indica en la página |

## MCP server

`dsh-memento` incluye un **servidor MCP** stdio de solo lectura (`dsh-memento-mcp`) para que clientes MCP externos (Claude, Codex, …) consulten el almacén de memoria sin el harness. Habla JSON-RPC 2.0 sobre JSON delimitado por saltos de línea (NDJSON): un objeto JSON por línea, sin tramado `Content-Length`.

**Solo lectura.** La base de datos se abre con `readOnly: true` de `node:sqlite` (sin migraciones, sin escrituras WAL, sin incremento del contador de recuperación); si el archivo no existe, devuelve resultados vacíos en lugar de fallar.

| Herramienta | Propósito |
|---|---|
| `memory_search` | `{query, limit?}` → entradas ordenadas (subcadena insensible a mayúsculas vía el seam del Provider de recuperación) |
| `memory_stats` | `{}` → `{total, namespaces}` conteo de entradas + resumen por track/scope |

Ejecución directa:

```sh
node bin/mcp-server.mjs
# o, tras npm install: npx dsh-memento-mcp
```

La ruta de la base de datos es `$DSH_MEMENTO_DB_PATH` (absoluta, o relativa a `$DSH_HOME`); por defecto `$DSH_HOME/dsh-memento/memory.db`.

Ejemplo para Claude Desktop (`claude_desktop_config.json`):

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

El servidor es de solo lectura: sin red, sin escrituras, sin puerta de aprobación — solo búsqueda y estadísticas.

## How it's different

| Plugin | Qué es | La diferencia de dsh-memento |
|---|---|---|
| dsh-memory-evolve | almacén de memoria / bucles de evolución | una costura de servicio tipada, puerta de aprobación y auditoría de registro de sesión; sin ambición de almacén |
| dsh-mnemon | ayudante de almacén de memoria | protocolo + puerta + auditoría, no otro almacén |
| dsh-kb-sieve | tamizado de base de conocimiento | sin ingeniería de recuperación: búsqueda por subcadena en corpus pequeño, recall entre sesiones vía `session_search`/`sessionQuery` |
| dsh-tdai-memory | herramientas de memoria dirigidas por tarea | los presupuestos son por track×capa y se aplican en el servicio, no a mejor esfuerzo |
| claude-bridge | puente de Claude Code | nativo de DSH; una futura ruta `seed(source:'claude')` deja que un puente alimente el mismo almacén |
| dsh-external/Recall | memoria de agente externa | local primero, cero red, usa la propia costura de aprobación de DSH |
| Official MCP memory examples | la posición declarada de DSH de "memoria = MCP externo" | el complemento **nativo de primera parte**: mismo objetivo, sin servidor externo; ambos coexisten |

El nombre es **`dsh-memento`** (publicado en npm y GitHub). No `dsh-recall` (confundible con dsh-external/Recall), no el nombre heredado eliminado `dsh-memory`.

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
- **Session log**: la completitud de auditoría proviene del par de aprobación (`approval/asked` + `approval/decided`) más la tabla de auditoría del plugin; la brecha del lado del registro de sesión se declara en `/memory audit` y desaparece cuando el host registra `memory/*`.

## Security boundaries

- **Solo servicios públicos.** Consume `tools`, `systemPrompt` y la costura de aprobación; sin cambios en engine / agent-loop / apiproxy / UI oficial.
- **Cero red, cero credenciales.** Base de datos local con modo de archivo POSIX `0600`.
- **Fallo ruidoso.** Base de datos corrupta, esquema más nuevo o configuración inválida falla al cargar; presupuestos llenos y coincidencias de subcadena ambiguas fallan con errores estructurados.
- **Un proceso, un almacén.** Varias sesiones comparten el almacén SQLite; dos procesos que comparten un `$DSH_HOME` escriben el mismo archivo (último escritor gana bajo el bloqueo de SQLite).

## Known limitations

- **Los eventos de sesión están declarados, aún no emitidos (rc.2).** `memory/added|updated|removed|recalled|snapshot` están declarados por fusión, pero rc.2 no tiene superficie de registro para tipos de evento fuera del repo; la emisión se activa cuando una build del harness los registre.
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
npm test                 # node --test: 187 pruebas
npm run lint             # oxlint
npm run test:conformance # dsh-memory-protocol v1 conformance suite
npm run typecheck        # cara host × checkout local D:\deepseek-harness (imprime «no verificable» y sale 0 sin checkout)
npm run typecheck:ci     # cara host × línea publicada fijada en node_modules
npm run check:client     # mitad de navegador (lib DOM)
npm run check:coverage   # line-coverage gate
npm run check:readmes    # five-language README consistency gate
npm run verify:self-contained # reject out-of-repo dependency specs
npm run verify:artifacts # artifact presence + syntax + import
```

`lib/` tiene cero dependencias de DSH (solo builtins de node:); las importaciones de DSH solo existen en `index.mjs`.

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `memory`, `agent-memory`, `approval`, `audit`, `sqlite`, `cordis`, `llm`

## Contributors

- [@Niuniu-Sir](https://github.com/Niuniu-Sir) — el informe de fallo de arranque en [issue #1](https://github.com/PerryLink/dsh-memento/issues/1) que llevó al fallback `~/.dsh` incluido en 0.3.1.

## PerryLink DSH Plugin Family

Este proyecto es uno de los [42 complementos de DeepSeek Harness](https://github.com/PerryLink) mantenidos por [PerryLink](https://github.com/PerryLink). Si este te ayuda, probablemente los demás también:

| Plugin | One-liner |
|---|---|
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Auto-revisión de segundo modelo en la cadena de aprobación, con cierre en fallo por defecto | |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Agentes hijos en segundo plano durables con barra lateral de UI web, mensajería e interrupción | |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Gobernanza de costes para DeepSeek Harness: presupuestos, carbono y latencia en un panel. | |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Equivalente a /rewind de Claude Code: instantáneas, bifurcaciones de sesión, restauración de un solo uso | |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migra sesiones, memoria, habilidades y CLAUDE.md de Claude Code a DSH | |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Control de escritorio nativo multiplataforma para DeepSeek Harness — Windows primero. | |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Historial de entrada estilo terminal para el compositor web: flechas, búsqueda Ctrl+R | |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Comprobaciones de calidad de datasets y verificación de citas (el puente numérico opcional consumido aquí) | |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Defensa contra inyección de prompts, jailbreak y fuga de secretos para DeepSeek Harness. | |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Guardián de disciplina de ingeniería: interrogatorio de requisitos, puertas de pruebas, revisión adversaria | |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Enrutamiento unificado de generación de imágenes estáticas para DeepSeek Harness. | |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** | Diagnóstico de rendimiento de solo lectura para DeepSeek Harness. | |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** | Informes de investigación deterministas para fondos mutuos públicos chinos | |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** | Integración de PR/issues de GitHub para DSH, cada escritura controlada por aprobación | |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** | Orquestación de investigación sectorial que sella sus entregables mediante el `ctx.researchReport.assemble` de este plugin | |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** | Base de conocimiento documental local para DeepSeek Harness. | |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** | Integración de modelos locales (Ollama) para DeepSeek Harness. | |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | Diagnósticos, formato, autocompletado, acciones de código y renombrado LSP sobre servidores de lenguaje | |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** | Middleware de enmascaramiento de PII: anonimiza en el límite del modelo, restaura en la capa de visualización | |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** | Panel de tiempo de ejecución MCP de solo lectura: comando /mcp + pestaña Settings con estado, herramientas y errores | |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** | Exportador de observabilidad OpenTelemetry y Langfuse para DeepSeek Harness. | |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** | Cambio de estilo en tiempo de ejecución equivalente a outputStyles de Claude Code | |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Reglas de permisos declarativas allow/deny/ask estilo Claude Code con auditoría | |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** | Base de conocimiento de desarrollo de plugins como habilidad de agente bajo demanda | |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | Zero-dependency static + sandbox smoke detector for DSH plugins | |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Puente multicanal de aprobación/preguntas: WeChat/Telegram/Feishu, consola de sesión |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Motor de informes de investigación verificables con evidencia direccionada por contenido | |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Puntuación de calidad multidimensional para plugins de DeepSeek Harness. | |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Fija sesiones en la barra lateral web con orden durable | |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Sincronización de sesiones entre dispositivos para DeepSeek Harness — un espejo git dedicado de tu almacén de sesiones. | |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Paquete de habilidades de auditoría de seguridad: escaneo de secretos, revisión de dependencias y cadena de suministro | |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Bucle de sesión con voz para DeepSeek Harness: háblale y escucha su respuesta. | |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Pruebas de instalación y humo aisladas para plugins de DeepSeek Harness. | |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | Puente de tareas TickTick/Dida365: panel de cabecera de sesión + 11 herramientas |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Traducción de parámetros entre proveedores y reparación determinista de JSON para DeepSeek Harness. | |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command | |
| **[dsh-catalog](https://github.com/PerryLink/dsh-catalog)** | DSH Desktop Market standard catalog source for the PerryLink family | |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence | |
| **[dsh-kit](https://github.com/PerryLink/dsh-kit)** | One-command starter pack that installs the core family | |
| **[dsh-plugin-certification](https://github.com/PerryLink/dsh-plugin-certification)** | Community certification registry with repro-checkable grades and badges | |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | Shared zero-runtime-dependency toolkit for the PerryLink DSH plugins | |
| **[dsh-plugin-portal](https://github.com/PerryLink/dsh-plugin-portal)** | Zero-dependency static portal rendering the whole plugin family as one page | |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** | Laya typed decisions (`noul`/`choice`/`score`) as a first-class Cordis service and model-visible tools | |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | One-package, one-corridor-index plugin upgrade skill: routes a repository to the matching closed corridor card | |

## License

[Apache License 2.0](LICENSE) © 2026 dsh-memento contributors

### Instalar desde el mercado de DSH Desktop

Todos los plugins de PerryLink pueden explorarse en el mercado integrado de DSH Desktop: **Market → Sources → add source → pegar** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ seleccionarlo**. La instalación sigue pasando por la verificación de identidad npm del mercado y tu confirmación.
