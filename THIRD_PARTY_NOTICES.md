# Third-party notices

dsh-memento reuses no third-party source code.

Runtime dependencies are the Node.js built-in modules only (`node:sqlite`,
`node:fs`, `node:path`, `node:crypto`, `node:os`). The DeepSeek Harness
packages listed in `peerDependencies` (`@deepseek-ai/cordis`,
`@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-session`,
`@deepseek-ai/schemastery`) are provided by the harness installation itself
and are not bundled or redistributed here.

The memory Save/Skip guidance embedded in the `memory` tool description
follows the editorial structure of the public memory-usage guidance from the
Hermes project's MEMORY.md (used as a behavioral reference only; no code or
text was copied).
