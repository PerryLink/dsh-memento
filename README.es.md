# dsh-memento

**Memoria entre sesiones acotada, por capas, con puerta de aprobación y auditable para DeepSeek Harness.**

[![license](https://img.shields.io/badge/license-Apache--2.0-3a7d44)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-4e51e8)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933)](https://nodejs.org/)
[![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()
[![no build step](https://img.shields.io/badge/build-none%20%28pure%20ESM%29-8a6d3b)]()

[English](README.md) · [中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

> Otros plugins de memoria venden un **almacén**. dsh-memento vende la **costura**: un servicio tipado `ctx.memory`, una puerta de aprobación de escritura que ninguna ruta del modelo puede eludir y pistas de auditoría que puedes reconstruir desde el registro de sesión. Memoria nativa de primera clase para DeepSeek Harness: protocolo + puerta de confianza + auditoría, con cero red y cero credenciales.

## ✨ ¿Por qué dsh-memento?

- **Es una costura de capacidad, no otro almacén.** Definición de Servicio (`ctx.memory`), Proveedor SQLite local (`node:sqlite`, WAL, `0600`) y Consumidores (herramienta `memory` + inyección de instantánea congelada). Cualquier plugin futuro —una integración semilla `dsh-claude-move`, un puente, un panel— alimenta y lee el **mismo almacén a través de la misma puerta**.
- **La puerta no se puede eludir.** Toda ruta de escritura (`add`/`replace`/`remove`/`seed`) se fuerza a través de la cascada de aprobación **dentro del servicio**, no en la capa de herramientas. `writePolicy: ask | auto | off` es configuración que el modelo no puede ver ni cambiar; una postura `never` a nivel de sesión sigue prevaleciendo sobre todo. `replace`/`remove`/`consolidate` llevan el texto completo de las entradas que cambiarán en el payload de aprobación — lo que apruebas es lo que ves, y una escritura denegada deja igualmente una fila de auditoría `*-denied`.
- **Visible para el modelo ⟺ registrado.** La instantánea inyectada llega textualmente a `request/header.system`; cada escritura es reconstruible a partir de `approval/asked` (carga útil completa) + `approval/decided` (resultado) + la propia tabla de auditoría del plugin.
- **Acotada y honesta.** Presupuestos estrictos de caracteres por pista y por capa (por defecto usuario 2000 / agente 4000). Un almacén lleno **falla con un error estructurado** (uso + límite): el modelo consolida y reintenta. Nunca se trunca, nunca se compacta automáticamente.

## ⚡ Inicio rápido

```sh
# requires Node ^22.19 || >=24 and DSH 0.1.0-rc.6
dsh plugin --profile web add dsh-memento      # or ./dsh-memento / a tarball / a GitHub URL
dsh --profile web --dump-config               # expect a "# == dsh-memento" layer, no FAILED at startup
```

Luego, en la interfaz web: pide al modelo que recuerde algo → aprueba la escritura → inicia una **sesión nueva** y pregúntale qué recuerda. Esa es toda la demostración.

```yaml
# optional override in the profile's cordis.patch.yml
- id: memento
  config:
    writePolicy: ask        # ask (default) | auto | off — model-invisible
    budgets:
      user: { userGlobal: 4000, workspace: 2000 }   # Chinese-heavy memory: raise + note why
      agent: { userGlobal: 4000, workspace: 4000 }
```

## 🧠 Qué hace

| | Componente | Qué obtienes |
| --- | --- | --- |
| 🧩 Definición de Servicio | `ctx.memory` — `add` / `replace` / `remove` / `query` / `seed` / `budgets()` | Servicio tipado y declarado por fusión; los métodos de escritura aplican la puerta internamente |
| 💾 Proveedor | `lib/store.mjs` — un solo archivo `node:sqlite` (`$DSH_HOME/dsh-memento/memory.db`, WAL) | Cero dependencias, cero red; tablas de entradas + auditoría; coincidencia por subcadena única |
| 🛠 Consumidores | herramienta `memory` · inyección de instantánea congelada (sección del system prompt, orden `-50`) · herramienta `memory_recall` · comando `/memory` · panel web de solo lectura | Escrituras/lecturas orientadas al modelo, instantánea congelada encabezada por presupuesto, recuperación en dos partes, comando del lado del usuario, panel lateral en el navegador |

**Dos pistas × dos capas × clave por agente.** La pista `user` = hechos sobre el usuario (preferencias, estilo de comunicación, temas delicados); la pista `agent` = hechos del entorno, convenciones del proyecto, lecciones aprendidas. Cada pista tiene capas `user-global` (entre espacios de trabajo) y `workspace` (cwd por sesión): capas fusionadas al estilo Codex, no solo global al estilo Hermes. Una tercera dimensión aísla entradas por el `agentPreset` de la sesión (ámbito por agente); las entradas sin preset quedan en la capa compartida visible para todos. Las lecturas y la localización de escritura con ámbito de sesión siguen la misma visibilidad: una sesión ve — y `replace`/`remove` solo puede tocar — entradas compartidas más las de su propio agente, y entradas `workspace` solo de su propio cwd. Las superficies de gestión (`/memory`, el panel) conservan la vista completa entre agentes.

**Instantáneas congeladas.** La instantánea se renderiza una vez por sesión en el primer ensamblado del prompt (lectura síncrona de SQLite + caché por sesión) y nunca cambia a mitad de sesión: estable en caché de prefijo por construcción. Los cambios internos de la sesión persisten solo a disco + auditoría.

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

## 🧰 Instalación y desinstalación

```sh
dsh plugin --profile <name> add ./dsh-memento        # local checkout (no build step)
dsh plugin --profile <name> add git+https://github.com/PerryLink/dsh-memento.git   # GitHub; npm tras el primer release
dsh plugin --profile <name> remove dsh-memento       # uninstall: DB + session logs are kept
```

Tras la desinstalación, la base de datos de memoria y los registros de sesión que guardaron la actividad de memoria permanecen; las sesiones antiguas siguen siendo cargables.

## ⚙️ Configuración

Cada campo es un `Config` de Schemastery validado; los valores inválidos fallan de forma explícita al cargar. Sobrescríbelos en cordis.yml bajo la fila `memento`.

| Campo | Valor por defecto | Significado |
| --- | --- | --- |
| `enabled` | `true` | `false` elimina por completo el servicio, las herramientas, la instantánea, el comando, el panel y el contestador (sin estados a medias) |
| `dbPath` | `''` → `$DSH_HOME/dsh-memento/memory.db` | absoluto, o relativo a `$DSH_HOME` |
| `budgets.user.userGlobal` / `budgets.user.workspace` | `2000` / `2000` | presupuesto estricto de caracteres por capa de la pista de usuario |
| `budgets.agent.userGlobal` / `budgets.agent.workspace` | `4000` / `4000` | presupuesto estricto de caracteres por capa de la pista de agente |
| `writePolicy` | `'ask'` | `'ask'` = aprobación del usuario; `'auto'` = dejar pasar (se registra el origen de la aprobación); `'off'` = rechazar. Invisible para el modelo |
| `writePolicies` | `{}` | anulaciones por pista/capa o por fuente: claves `user/workspace`, `agent/user-global`, `source:claude`, … → `ask`/`auto`/`off`; sin coincidencia cae a `writePolicy` |
| `language` | `'en'` | idioma del texto visible para el modelo y de la salida del comando: `'en'` (por defecto) o `'zh'` — descripciones de herramientas, instantánea congelada, comando `/memory` y panel web lo siguen |
| `snapshotOrder` | `-50` | orden de la sección de la instantánea: después de la identidad del harness (`-100`), antes de la persona (`0`) |
| `maxEntriesPerQuery` | `20` | tope de resultados por consulta por defecto (`limit` explícito permitido, tope duro 1000) |
| `commandListLimit` | `50` | entradas mostradas por comando `/memory list` / `query` |
| `commandAuditLimit` | `10` | filas de auditoría mostradas por comando `/memory audit` |
| `recall.historyLimitDefault` / `recall.snippetCap` / `recall.snippetChars` / `recall.windowDays` | `8` / `5` / `300` / `30` | valores por defecto de historial de `memory_recall`: sesiones escaneadas, fragmentos por sesión, caracteres por fragmento, ventana de días |
| `panelEntriesLimit` | `200` | tamaño de página de entradas del panel web (y tope) |
| `panelAuditLimit` | `20` | filas de auditoría del panel web por defecto (tope 200) |
| `auditRetentionDays` | `0` | retención de auditoría: 0 = para siempre, >0 = poda al abrir la tienda |
| `proposals.enabled` / `proposals.maxChars` / `proposals.maxPending` | `true` / `2000` / `8` | auto-captura: propuesta de memoria pendiente tras cada compactación exitosa (truncada, una por sesión); desactivar o ajustar topes |

## 🛠 Herramientas y superficies

- **`memory`** — add/replace/remove/consolidate/query con guía Guardar/Omitir incrustada en la descripción (guarda preferencias del usuario, correcciones, hechos del entorno, convenciones, lecciones; omite trivialidades, hechos re-derivables, volcados, rutas de un solo uso). Las escrituras pasan por la puerta de aprobación; las lecturas son libres; replace/remove apuntan a una **subcadena única** (las coincidencias ambiguas fallan con la lista de candidatos); consolidate fusiona 1..20 entradas en una con una sola aprobación y una escritura atómica.
- **`memory_recall`** — recuperación en dos partes: coincidencias acotadas de memoria **más** coincidencias recientes del historial de sesión vía `ctx.sessionQuery` (se degrada con elegancia a solo memoria donde el servicio está ausente).
- **`/memory`** — comando activado por el usuario (no es un turno del modelo): `list` · `query <word>` · `add [--track=user|agent] [--scope=user-global|workspace] <text>` · `remove [flags] <substring>` · `consolidate [flags] <substring...> => <text>` · `proposals [approve|dismiss <id>]` · `budgets` · `audit` · `export`. Las escrituras del comando pasan por la misma cascada + política; la auditoría se registra en la tabla de auditoría del plugin + `command/done`. `export` es de solo lectura y vuelca todas las entradas + presupuestos como un documento JSON (copia de seguridad / migración).
- **Propuestas auto-capturadas** — tras una compactación de sesión exitosa, el resumen se registra como propuesta de memoria pendiente (`agent/workspace`); aprobarla la escribe a través de la puerta de aprobación, descartarla la elimina. Las propuestas pendientes aparecen en la instantánea congelada y en el panel.
- **Panel web** — panel lateral `dsh.client` sin compilación: navega por entradas por pista/capa, busca, barras de presupuesto, cola de auditoría. De solo lectura por diseño: las escrituras y la aprobación ocurren a través de la herramienta `memory` y la interfaz de aprobación integrada.

## 🎓 Lo que aprendimos de las memorias de terminal

dsh-memento no es un port de Claude Code, Codex ni Hermes — pero su diseño absorbió deliberadamente las partes que cada uno hizo bien y rechazó las que hacen daño:

| Memoria de terminal | Qué hizo bien | Qué adoptó dsh-memento |
| --- | --- | --- |
| **Claude Code** — `CLAUDE.md` | **archivos de memoria en texto plano** jerárquicos (nivel usuario → nivel proyecto), legibles y editables por humanos, y combinados automáticamente en cada sesión — memoria que puedes leer y corregir tú mismo | entradas en texto plano; capas `user-global` / `workspace` combinadas por sesión; un almacén que puedes navegar, `export` y auditar — la transparencia como característica |
| **Codex** — `AGENTS.md` | **instrucciones con alcance por directorio** autodescubiertas e inyectadas sin fricción del modelo — la localidad importa más que el volumen; no hace falta llamada de herramienta para "cargar" memoria | capa `workspace` vinculada al cwd de la sesión (insensible a mayúsculas en Windows); la instantánea congelada se inyecta automáticamente al inicio de la sesión |
| **Hermes** — `memory.md` | **guardados de memoria proactivos** (guardar/actualizar/borrar) y, en el [issue #48181](https://github.com/NousResearch/hermes-agent/issues/48181), la lección de seguridad de que una puerta impuesta solo en la capa de herramientas es eludible mediante inyección tardía de herramientas — hay que imponerla donde convergen todas las rutas de escritura | la herramienta `memory` con guía explícita Guardar/Omitir + propuestas de auto-captura con puerta de aprobación; la puerta de aprobación vive **dentro** de los métodos de escritura de `ctx.memory`, no en la capa de herramientas |

Fuentes: [memoria de Claude Code](https://code.claude.com/docs/en/memory) · [AGENTS.md de Codex](https://developers.openai.com/codex/cli/agents-md) · [memoria de Hermes](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md) · [Hermes #48181](https://github.com/NousResearch/hermes-agent/issues/48181).

Y las partes que rechazamos deliberadamente: la auto-resumición oculta en estado privado del modelo (aquí los resúmenes de compactación se convierten en **propuestas pendientes** que esperan un aprobar/descartar humano), las ambiciones de almacén/vectorial, y cualquier escritura sin aprobación o rastro de auditoría visible para el humano. También adoptamos la advertencia documentada de Hermes: dos procesos que comparten un directorio home escriben el mismo archivo de memoria — véase Límites de seguridad.

## 🆚 En qué se diferencia

| Plugin | Qué es | La diferencia de dsh-memento |
| --- | --- | --- |
| dsh-memory-evolve | almacén de memoria / bucles de evolución | una costura de servicio tipado, puerta de aprobación y auditoría del registro de sesión; sin ambición de almacén |
| dsh-mnemon | asistente de almacén de memoria | protocolo + puerta + auditoría, no otro almacén |
| dsh-kb-sieve | cribado de base de conocimiento | sin ingeniería de recuperación: búsqueda por subcadena sobre un corpus pequeño, recuperación entre sesiones vía `session_search`/`sessionQuery` |
| dsh-tdai-memory | herramientas de memoria dirigidas por tareas | los presupuestos son por pista×capa y se aplican en el servicio, no a mejor esfuerzo |
| claude-bridge | puente con Claude Code | nativo de DSH; una futura ruta `seed(source:'claude')` permite que un puente alimente el mismo almacén |
| dsh-external/Recall | memoria externa de agente | local primero, cero red, se apoya en la propia costura de aprobación de DSH |
| Ejemplos oficiales de memoria MCP | la postura declarada de DSH de "memoria = MCP externo" | el complemento **nativo de primera parte**: mismo objetivo, sin servidor externo; ambos coexisten |

El nombre es **`dsh-memento`** (libre en npm y GitHub). No `dsh-recall` (confundible con dsh-external/Recall), ni el nombre heredado eliminado `dsh-memory`.

## 🔒 Límites de seguridad

- **Solo servicios públicos** (`tools`, `systemPrompt`, la costura de aprobación). Sin cambios en el motor / agent-loop / apiproxy / UI oficial.
- **Cero red, cero credenciales.** Base de datos local; modo de archivo POSIX `0600`.
- **Falla de forma explícita.** Una base de datos corrupta o un esquema más nuevo falla al cargar; los presupuestos llenos y las coincidencias ambiguas de subcadena fallan con errores estructurados. Nada se traga ni se trunca en silencio.
- **Un proceso, un almacén.** Varias sesiones en un proceso comparten el almacén SQLite (escrituras serializadas, auditoría por sesión). Dos **procesos** que comparten un `$DSH_HOME` escriben el mismo archivo: gana el último escritor bajo el bloqueo de SQLite — no ejecutes dos instancias del harness sobre un mismo `$DSH_HOME` si necesitas coherencia entre procesos (la misma advertencia que documenta el proyecto Hermes).

## ⚠️ Limitaciones conocidas

- **El vocabulario de eventos de sesión está declarado, pero aún no se emite (rc.6).** `memory/added|updated|removed|recalled|snapshot` están declarados por fusión en `types.d.ts`, pero rc.6 no tiene superficie de registro para tipos de eventos fuera del repositorio (los appends no registrados harían que las sesiones persistidas no se pudieran cargar). La completitud de la auditoría proviene del par de aprobación + la tabla de auditoría; la emisión se activa automáticamente en cuanto una compilación del harness registre los tipos. Véase [ARCHITECTURE.md](ARCHITECTURE.md), decisión 4.
- **La política `ask` necesita un contestador.** Sin un contestador de UI/ACP compuesto, las escrituras fallan en modo cerrado (`unavailable`): por diseño, la postura de fallo cerrado de la costura de aprobación.
- **Sin índice FTS5.** La búsqueda por subcadena usa `instr` insensible a mayúsculas (correcto para CJK); el ranking de recuperación usa contadores de aciertos por entrada. El tokenizador trigram de FTS5 no puede indexar caracteres CJK de un solo carácter, así que no se usa — véase [ARCHITECTURE.md](ARCHITECTURE.md), decisión 10.

## 🧪 Desarrollo

```sh
npm install
npm test                # node --test: 103 tests — budget, unique-substring, gate policy, store, snapshot, mock-ctx integration (S2/S3 invariants), V2 command/recall/panel
npm run typecheck       # puerta tsc --checkJs sobre index.mjs / lib / scripts
npm run check:coverage  # puerta de cobertura de líneas: lib ≥90 %, index.mjs ≥85 %, todos ≥90 %
npm run check:readmes   # puerta de coherencia de los cinco README
```

`lib/` no tiene dependencias de DSH (solo builtins de node:); las importaciones de DSH solo existen en `index.mjs`. Disciplina completa en [AGENTS.md](AGENTS.md); decisiones de diseño en [ARCHITECTURE.md](ARCHITECTURE.md).

## 🏷 Temas

Temas sugeridos para GitHub: `dsh` · `dsh-plugin` · `deepseek-harness` · `memory` · `agent-memory` · `approval` · `audit` · `sqlite` · `cordis` · `llm`

## 📄 Licencia

Licencia Apache 2.0 — véase [LICENSE](LICENSE). No se redistribuye código de terceros; véase [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
