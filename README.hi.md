<div align="center">

# dsh-memento
- **1024 स्टोर चैनल**: एक बार `npm i -g dsh1024`, फिर `dsh1024 plugin --profile web add dsh-memento` ([deepseek1024.com](https://deepseek1024.com) इंस्टॉल रैंकिंग में गिना जाता है)।

**DeepSeek Harness के लिए परिबद्ध, स्तरित, अनुमोदन-द्वारी, लेखा-परीक्षण-योग्य क्रॉस-सेशन मेमोरी।**

*एक टाइप्ड `ctx.memory` सीम, एक लेखन-अनुमोदन द्वार जिसे मॉडल का कोई मार्ग नहीं टाल सकता, और सत्र लॉग से पुनर्निर्माण-योग्य ऑडिट ट्रेल।*

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
| Harness | DeepSeek Harness `0.1.2-alpha.5` (2026-09-02 को अनुकूलित): सत्र लिफ़ाफ़ा अपना ignorable फ़ील्ड केवल संग्रहीत-लॉग पठन संगतता के लिए रखता है - Session.append अभी भी इसे स्टैम्प नहीं कर सकता, इसलिए गेट व्यवहार अपरिवर्तित है। |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | Windows / macOS / Linux (केवल host; कोई नेटिव कोड नहीं, कोई नेटवर्क नहीं) |
| Model | कोई भी |

## What you get

`dsh-memento` एक क्षमता-सीम है, कोई दूसरा भंडार नहीं: एक टाइप्ड `ctx.memory` सेवा, एक स्थानीय SQLite प्रदाता (`node:sqlite`, WAL, `0600`, `$DSH_HOME/dsh-memento/memory.db` पर) और उसके उपभोक्ता — `memory` टूल और सिस्टम प्रॉम्प्ट में इंजेक्ट किया गया फ़्रोज़न स्नैपशॉट।

- **अनुमोदन द्वार को टाला नहीं जा सकता।** हर लेखन पथ (`add` / `replace` / `remove` / `seed`) सेवा के भीतर अनुमोदन वॉटरफ़ॉल से होकर गुज़रता है, टूल परत से नहीं। `writePolicy: ask | auto | off` मॉडल के लिए अदृश्य विन्यास है; `replace` / `remove` / `consolidate` अनुमोदन पेलोड में बदली जाने वाली प्रविष्टियों का पूरा पाठ ले जाते हैं, और अस्वीकृत लेखन भी एक `*-denied` ऑडिट पंक्ति छोड़ता है।
- **मॉडल-दृश्य ⟺ लॉग किया गया।** इंजेक्ट किया गया स्नैपशॉट `request/header.system` में शब्दशः पहुँचता है; हर लेखन `approval/asked` + `approval/decided` + प्लगइन की अपनी ऑडिट तालिका से पुनर्निर्माण-योग्य है।
- **परिबद्ध और ईमानदार।** प्रति-ट्रैक/प्रति-परत कठोर अक्षर बजट (डिफ़ॉल्ट user 2000 / agent 4000)। भरा हुआ भंडार संरचित त्रुटि से विफल होता है (उपयोग + सीमा) — कभी काटा नहीं, कभी स्वतः संकुचित नहीं।

दो ट्रैक × दो परतें × प्रति-एजेंट कुंजी: एक `user` ट्रैक (उपयोगकर्ता के बारे में तथ्य) और एक `agent` ट्रैक (पर्यावरण तथ्य और परंपराएँ), प्रत्येक `user-global` और `workspace` परतों में बँटा, `agentPreset` के अनुसार पृथक। स्नैपशॉट पहले प्रॉम्प्ट संयोजन पर प्रति-सत्र एक बार फ़्रीज़ होता है और सत्र के बीच कभी नहीं बदलता।

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

- **git चैनल** (नवीनतम `main`): `dsh plugin --profile web add git+https://github.com/PerryLink/dsh-memento.git`.
- **npm चैनल** (प्रकाशित रिलीज़): `dsh plugin --profile web add dsh-memento`.
- **tarball चैनल**: इस रेपो में `npm pack`, फिर `dsh plugin --profile web add ./dsh-memento-<version>.tgz`.
- **uninstall**: `dsh plugin --profile web remove dsh-memento` (मेमोरी डेटाबेस और सत्र लॉग रखे जाते हैं)।

## Configuration

सभी ट्यूनेबल Schemastery `Config` फ़ील्ड हैं (cordis.yml से बदले जा सकते हैं)। अमान्य मान लोड पर ज़ोर से विफल होते हैं। `memento` पंक्ति के अंतर्गत ओवरराइड करें।

**सेटिंग्स पैनल।** DSH सेटिंग्स सेवा माउंट होने पर नीचे के सभी फ़ील्ड (`enabled` को छोड़कर) DSH सेटिंग्स साइडबार की प्लगइन **`dsh-memento` प्रविष्टि** से संपादित होते हैं (General या Plugins जैसा एक शीर्ष-स्तरीय खंड); बदलाव सेटिंग्स यूज़र लेयर (`settings.yaml`) में जाते हैं, फ़ाइल छूने की ज़रूरत नहीं। लगभग सब लाइव लागू होते हैं (राइट पॉलिसी, भाषा, बजट, सीमाएँ, प्रस्ताव, पैनल; `dbPath` / `auditRetentionDays` स्टोर पुनः खोलकर; `retrieval.vector` रिट्रीवर बदलकर) — केवल `snapshotOrder` को DSH रीलोड चाहिए। सेटिंग्स सेवा के अभाव में सब कुछ संयुक्त cordis कॉन्फ़िग पर लौटता है, पहले जैसा। फ़्लोटिंग पैनल बटन उसी पृष्ठ से छिपाया जा सकता है (`panel.enabled`)।

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | मुख्य स्विच; `false` सेवा, टूल, स्नैपशॉट, कमांड, पैनल और answerer हटा देता है (सेटिंग्स पृष्ठ से संपादन योग्य नहीं — अक्षम प्लगइन की कोई सेटिंग्स प्रविष्टि नहीं) |
| `panel.enabled` | `true` | वेब पैनल का फ़्लोटिंग बटन दिखाएँ; सेटिंग्स पृष्ठ से `false` सेव करने पर 🧠 प्रविष्टि तुरंत छिप जाती है, रीलोड की ज़रूरत नहीं (सेटिंग्स पृष्ठ अप्रभावित) |
| `dbPath` | `''` → `$DSH_HOME/dsh-memento/memory.db` | निरपेक्ष, या `$DSH_HOME` के सापेक्ष (Windows पर `~/.dsh` पर फ़ॉलबैक) |
| `budgets.user.userGlobal` | `2000` | user ट्रैक की user-global परत का कठोर अक्षर बजट |
| `budgets.user.workspace` | `2000` | user ट्रैक की workspace परत का कठोर अक्षर बजट |
| `budgets.agent.userGlobal` | `4000` | agent ट्रैक की user-global परत का कठोर अक्षर बजट |
| `budgets.agent.workspace` | `4000` | agent ट्रैक की workspace परत का कठोर अक्षर बजट |
| `writePolicy` | `'ask'` | डिफ़ॉल्ट लेखन नीति: `ask` / `auto` / `off` (मॉडल-अदृश्य) |
| `writePolicies` | `{}` | प्रति-ट्रैक/स्कोप या प्रति-स्रोत ओवरराइड (जैसे `user/workspace`, `source:claude`) |
| `language` | `'en'` | मॉडल-दृश्य और कमांड आउटपुट भाषा: `en` / `zh` |
| `snapshotOrder` | `-50` | स्नैपशॉट अनुभाग क्रम (harness पहचान के बाद, persona से पहले) |
| `maxEntriesPerQuery` | `20` | डिफ़ॉल्ट प्रति-क्वेरी परिणाम सीमा (कठोर सीमा 1000) |
| `commandListLimit` | `50` | प्रति `/memory list` / `query` प्रदर्शित प्रविष्टियाँ |
| `commandAuditLimit` | `10` | प्रति `/memory audit` प्रदर्शित ऑडिट पंक्तियाँ |
| `recall.historyLimitDefault` | `8` | `memory_recall` द्वारा डिफ़ॉल्ट स्कैन किए गए सत्र |
| `recall.snippetCap` | `5` | `memory_recall` में प्रति-सत्र स्निपेट |
| `recall.snippetChars` | `300` | `memory_recall` स्निपेट अक्षर |
| `recall.windowDays` | `30` | `memory_recall` की दिनों में हाल-समय विंडो |
| `retrieval.vector` | `false` | सिमेंटिक रिकॉल स्विच: `true` से `memory_recall` वेक्टर रिकॉल (फ़ेक हैश एम्बेडिंग) सक्षम होता है जब कोई एम्बेडिंग प्रदाता उपलब्ध हो; अन्यथा सबस्ट्रिंग पर डिग्रेड होता है |
| `panelEntriesLimit` | `200` | वेब पैनल प्रविष्टि पृष्ठ आकार |
| `panelAuditLimit` | `20` | वेब पैनल डिफ़ॉल्ट ऑडिट पंक्तियाँ |
| `auditRetentionDays` | `0` | ऑडिट अवधारण (0 = हमेशा रखें) |
| `proposals.enabled` | `true` | हर सफल संघनन के बाद स्वतः एक मेमोरी प्रस्ताव कैप्चर करें |
| `proposals.maxChars` | `2000` | प्रस्ताव अक्षर सीमा |
| `proposals.maxPending` | `8` | लंबित प्रस्ताव सीमा |

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `memory` | tool | Save/Skip मार्गदर्शन के साथ add/replace/remove/consolidate/query; लेखन अनुमोदन द्वार से गुज़रता है |
| `memory_recall` | tool | परिबद्ध मेमोरी मिलान + हाल के सत्र-इतिहास मिलान |
| `/memory` | command | `list` · `query` · `add` · `remove` · `consolidate` · `proposals` · `budgets` · `audit` · `export` · `import <path>` · `adapters` |
| web panel | client drawer | केवल-पठन: प्रविष्टियाँ ब्राउज़ करें, खोजें, बजट बार, ऑडिट पूँछ; फ़्लोटिंग बटन छिपाया जा सकता है (`panel.enabled`) |
| settings section | DSH सेटिंग्स साइडबार → `dsh-memento` | फ़ाइल छुए सभी कॉन्फ़िग फ़ील्ड संपादित करें (`enabled` को छोड़कर); लाइव/रीलोड समय पृष्ठ पर अंकित |

## MCP server

`dsh-memento` एक केवल-पठन stdio **MCP सर्वर** (`dsh-memento-mcp`) भी देता है ताकि बाहरी MCP क्लाइंट (Claude, Codex, …) बिना harness के मेमोरी स्टोर खोज सकें। यह newline-delimited JSON (NDJSON) पर JSON-RPC 2.0 बोलता है — प्रति पंक्ति एक JSON ऑब्जेक्ट, कोई `Content-Length` फ़्रेमिंग नहीं।

**केवल-पठन।** डेटाबेस `node:sqlite` के `readOnly: true` से खुलता है (कोई माइग्रेशन नहीं, कोई WAL लेखन नहीं, recall-count में वृद्धि नहीं); अगर फ़ाइल मौजूद नहीं है तो क्रैश के बजाय खाली परिणाम मिलते हैं।

| टूल | उद्देश्य |
|---|---|
| `memory_search` | `{query, limit?}` → क्रमबद्ध प्रविष्टियाँ (retrieval Provider seam से केस-इनसेंसिटिव सबस्ट्रिंग) |
| `memory_stats` | `{}` → `{total, namespaces}` प्रविष्टि गणना + track/scope अवलोकन |

सीधे चलाएँ:

```sh
node bin/mcp-server.mjs
# या, npm install के बाद: npx dsh-memento-mcp
```

डेटाबेस पथ `$DSH_MEMENTO_DB_PATH` है (निरपेक्ष, या `$DSH_HOME` के सापेक्ष); डिफ़ॉल्ट `$DSH_HOME/dsh-memento/memory.db`।

Claude Desktop (`claude_desktop_config.json`) उदाहरण:

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

सर्वर केवल-पठन है: कोई नेटवर्क नहीं, कोई लेखन नहीं, कोई अनुमोदन द्वार नहीं — केवल खोज और आँकड़े।

## How it's different

| Plugin | यह क्या है | dsh-memento का अंतर |
|---|---|---|
| dsh-memory-evolve | मेमोरी वेयरहाउस / इवोल्यूशन लूप | टाइप्ड सेवा सीम, अनुमोदन द्वार और सत्र-लॉग ऑडिट; कोई वेयरहाउस महत्वाकांक्षा नहीं |
| dsh-mnemon | मेमोरी स्टोर सहायक | प्रोटोकॉल + द्वार + ऑडिट, कोई दूसरा स्टोर नहीं |
| dsh-kb-sieve | ज्ञान-आधार छानना | कोई रिट्रीवल इंजीनियरिंग नहीं: छोटे-कोर्पस सबस्ट्रिंग खोज, `session_search`/`sessionQuery` से क्रॉस-सेशन रिकॉल |
| dsh-tdai-memory | कार्य-संचालित मेमोरी टूलिंग | बजट प्रति track×परत और सेवा में लागू, न कि सर्वोत्तम-प्रयास |
| claude-bridge | Claude Code ब्रिजिंग | DSH-नेटिव; भविष्य का `seed(source:'claude')` पथ एक ब्रिज को वही स्टोर भरने देता है |
| dsh-external/Recall | बाहरी एजेंट मेमोरी | स्थानीय-प्रथम, शून्य-नेटवर्क, DSH की अपनी अनुमोदन सीम पर चलता है |
| Official MCP memory examples | DSH की घोषित "मेमोरी = बाहरी MCP" स्थिति | **नेटिव फर्स्ट-पार्टी** पूरक: समान लक्ष्य, कोई बाहरी सर्वर नहीं; दोनों सह-अस्तित्व |

नाम **`dsh-memento`** है (npm और GitHub पर प्रकाशित)। `dsh-recall` नहीं (dsh-external/Recall से भ्रमित होने वाला), न ही हटाया गया विरासत नाम `dsh-memory`।

## dsh-memory-protocol v1

`dsh-memento` DSH मेमोरी प्रोटोकॉल का सामुदायिक पूर्वाभ्यास है — एक आधिकारिक `ctx.memory` सीम के लिए उम्मीदवार आकार। यह प्रोटोकॉल इस प्लगइन की सीम को एक क्रॉस-प्लगइन अनुबंध में सामान्य करता है:

- **Entry spec** — दो ट्रैक × दो परतें × प्रति-एजेंट कुंजी, साथ ही छोटे `tags` (≤16 × ≤32 अक्षर) और प्रति-प्रविष्टि `version` जो हर `replace` पर बढ़ता है।
- **Write semantics** — इडेम्पोटेंट अद्वितीय-सबस्ट्रिंग सशर्त लेखन; जो-दिखे-वही-स्वीकृत पेलोड (`replace` / `remove` / `consolidate` बदले जाने वाला पूरा पाठ ले जाते हैं)।
- **Audit contract** — हर लेखन `approval/asked` + `approval/decided` + प्रदाता खाता-बही से पुनर्निर्माण-योग्य।
- **Budget model** — `BUDGET_EXCEEDED` / `AMBIGUOUS_MATCH` अर्थविज्ञान।
- **Schema versioning** — ज़ोरदार संस्करण जाँच वाले प्रवासन नियम।

- **Spec** — [docs/protocol-v1.md](docs/protocol-v1.md) (中文: [protocol-v1.zh.md](docs/protocol-v1.zh.md)); मानक JSON Schema [docs/schemas/dsh-memory-protocol-v1.schema.json](docs/schemas/dsh-memory-protocol-v1.schema.json) पर।

**Adapter registry** — `ctx.memoryAdapters` (`register` / `list` / `adapt` / `export`) तृतीय-पक्ष मेमोरी प्लगइन को एक शुद्ध डेटा कन्वर्टर पंजीकृत करके प्रोटोकॉल बोलने देता है (उत्क्रमणीय `register()`; आयात अनुमोदन-द्वारी `seed` पर चलता है, निर्यात केवल-पठन है)। ऑनबोर्डिंग: [docs/adapters-guide.md](docs/adapters-guide.md) (中文: [adapters-guide.zh.md](docs/adapters-guide.zh.md))।

| Built-in adapter | External format | Notes |
|---|---|---|
| `mem0` | mem0 तथ्य संग्रह (`{facts: [{memory, metadata?}]}`) | `metadata.category` / `metadata.tags` tags बनते हैं; कच्चे `messages` ऐरे अस्वीकृत — एडेप्टर परिवर्तित करते हैं, कभी निष्कर्षण नहीं |
| `hermes-memory-md` | Hermes `memory.md` (`## section` + बुलेट) | अनुभाग नाम tags बनते हैं; बिना बुलेट वाला गद्य ज़ोर से विफल होता है |
| `claude-code-memory-md` | `CLAUDE.md`-शैली markdown (शीर्षक, बुलेट, अनुच्छेद) | बुलेट और अनुच्छेद प्रविष्टियाँ बनते हैं; अनुभाग नाम tags बनते हैं |

**Conformance suite** — [test/protocol-conformance/](test/protocol-conformance/README.md): एक वितरण-योग्य केस-सेट जिसे संगतता का दावा करने वाला कोई भी प्रदाता चलाता है (`node test/protocol-conformance/run.mjs --provider ./your-factory.mjs`); इस रेपो का CI इसे अपने प्रदाता के विरुद्ध स्वर्ण संदर्भ के रूप में चलाता है (`npm run test:conformance`)।

- **Upstream proposal** — [docs/upstream-proposal.md](docs/upstream-proposal.md) (中文: [upstream-proposal.zh.md](docs/upstream-proposal.zh.md)): आधिकारिक `ctx.memory` सीम को प्रोटोकॉल क्यों अपनाना चाहिए, अंतर और प्रवासन पथ।

## Permissions & data

- **Permissions**: workshop मैनिफ़ेस्ट `harness:tool`, `filesystem:read`, `filesystem:write` और `network:none` / `subprocess:none` / `shell:none` / `python:none` / `credentials:none` घोषित करता है। लेखन अनुमोदन आधिकारिक अनुमोदन सीम पर चलता है।
- **Data**: स्थानीय SQLite डेटाबेस (`0600`), शून्य नेटवर्क, शून्य क्रेडेंशियल।
- **Session log**: ऑडिट पूर्णता अनुमोदन जोड़ी (`approval/asked` + `approval/decided`) और प्लगइन की अपनी ऑडिट तालिका से आती है।

## Security boundaries

- **केवल सार्वजनिक सेवाएँ।** `tools`, `systemPrompt` और अनुमोदन सीम का उपभोग करता है; engine / agent-loop / apiproxy / आधिकारिक UI में कोई बदलाव नहीं।
- **शून्य नेटवर्क, शून्य क्रेडेंशियल।** POSIX फ़ाइल मोड `0600` वाला स्थानीय डेटाबेस।
- **ज़ोर से विफल।** दूषित DB, नया स्कीमा या अमान्य विन्यास लोड पर विफल होता है; भरे बजट और अस्पष्ट सबस्ट्रिंग मिलान संरचित त्रुटियों से विफल होते हैं।
- **एक प्रक्रिया, एक भंडार।** कई सत्र SQLite भंडार साझा करते हैं; एक ही `$DSH_HOME` साझा करने वाली दो प्रक्रियाएँ एक ही फ़ाइल लिखती हैं (SQLite लॉकिंग के तहत अंतिम-लेखक-जीत)।

## Known limitations

- **सत्र घटनाएँ घोषित हैं, अभी उत्सर्जित नहीं (rc.2)।** `memory/added|updated|removed|recalled|snapshot` मर्ज-घोषित हैं, परंतु rc.2 में रेपो-बाहर घटना प्रकारों के लिए कोई पंजीकरण सतह नहीं है; harness बिल्ड उन्हें पंजीकृत करते ही उत्सर्जन चालू हो जाता है।
- **`ask` नीति को answerer चाहिए।** बिना UI/ACP answerer के, लेखन बंद-विफल होते हैं।
- **कोई FTS5 अनुक्रमण नहीं।** सबस्ट्रिंग खोज केस-असंवेदी `instr` पर चलती है (CJK के लिए सही)।

## What we learned from the terminal memories

`dsh-memento` Claude Code, Codex या Hermes का पोर्ट नहीं है — लेकिन इसके डिज़ाइन ने जान-बूझकर वह अपनाया जो प्रत्येक ने सही किया, और वह अस्वीकार किया जो नुकसान करता था:

| Terminal memory | क्या सही किया | dsh-memento ने क्या अपनाया |
|---|---|---|
| **Claude Code** — `CLAUDE.md` | पदानुक्रमित सादा-पाठ मेमोरी फ़ाइलें (उपयोगकर्ता-स्तर → परियोजना-स्तर), मानव-पठनीय और संपादन-योग्य, हर सत्र में स्वतः मर्ज | सादा-पाठ प्रविष्टियाँ; `user-global` / `workspace` परतें प्रति-सत्र मर्ज; एक भंडार जिसे आप ब्राउज़, `export` और ऑडिट कर सकते हैं — पारदर्शिता एक विशेषता के रूप में |
| **Codex** — `AGENTS.md` | प्रति-निर्देशिका स्कोप्ड निर्देश स्वतः खोजे और शून्य मॉडल घर्षण से इंजेक्ट | सत्र cwd से अनुक्रमित `workspace` परत (Windows केस-असंवेदी); सत्र आरंभ पर स्वतः इंजेक्ट फ़्रोज़न स्नैपशॉट |
| **Hermes** — `memory.md` | सक्रिय मेमोरी सेव और यह सुरक्षा सबक कि केवल टूल परत पर लागू द्वार देर से टूल-इंजेक्शन से टाला जा सकता है | Save/Skip मार्गदर्शन वाला `memory` टूल + अनुमोदन-द्वारी स्वतः-कैप्चर प्रस्ताव; द्वार `ctx.memory` के लेखन तरीकों के भीतर रहता है, टूल परत में नहीं |

स्रोत: [Claude Code memory](https://code.claude.com/docs/en/memory) · [Codex AGENTS.md](https://developers.openai.com/codex/cli/agents-md) · [Hermes memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md) · [Hermes #48181](https://github.com/NousResearch/hermes-agent/issues/48181)।

और जान-बूझकर अस्वीकार किए गए भाग: मॉडल-निजी स्थिति में छिपा स्व-सारांशीकरण (यहाँ संघनन सारांश **लंबित प्रस्ताव** बनते हैं जो मानव approve/dismiss की प्रतीक्षा करते हैं), भंडार/वेक्टर-स्टोर महत्वाकांक्षाएँ, और बिना मानव-दृश्य अनुमोदन या ऑडिट ट्रेल वाला कोई भी लेखन। यह भी अपनाया गया: Hermes की दस्तावेज़ित चेतावनी कि एक ही होम निर्देशिका साझा करने वाली दो प्रक्रियाएँ एक ही मेमोरी फ़ाइल लिखती हैं — Security boundaries देखें।

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

`lib/` में शून्य DSH निर्भरता है (केवल node: बिल्टइन); DSH आयात केवल `index.mjs` में मौजूद हैं।

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `memory`, `agent-memory`, `approval`, `audit`, `sqlite`, `cordis`, `llm`

## Contributors

- [@Niuniu-Sir](https://github.com/Niuniu-Sir) — [issue #1](https://github.com/PerryLink/dsh-memento/issues/1) में बूट-क्रैश रिपोर्ट, जिससे 0.3.1 में `~/.dsh` फ़ॉलबैक आया।

## PerryLink DSH Plugin Family

यह प्रोजेक्ट [PerryLink](https://github.com/PerryLink) द्वारा अनुरक्षित [33 DeepSeek Harness प्लगइनों](https://github.com/PerryLink) में से एक है। अगर यह आपकी मदद करता है, तो बाकी भी करेंगे:

| Plugin | One-liner |
|---|---|
| **[dsh-dsh-auto-review](https://github.com/PerryLink/dsh-dsh-auto-review)** | अनुमोदन श्रृंखला पर द्वितीय-मॉडल स्वतः-समीक्षा, डिफ़ॉल्ट रूप से विफल-बंद | |
| **[dsh-dsh-background-agents](https://github.com/PerryLink/dsh-dsh-background-agents)** | वेब UI साइडबार, संदेश और अवरोधन के साथ टिकाऊ पृष्ठभूमि चाइल्ड एजेंट | |
| **[dsh-dsh-budget](https://github.com/PerryLink/dsh-dsh-budget)** | DeepSeek Harness के लिए लागत प्रशासन: बजट, कार्बन और विलंबता एक पैनल में। | |
| **[dsh-dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-dsh-checkpoint-rewind)** | Claude Code /rewind-समतुल्य: स्नैपशॉट, सत्र फ़ॉर्क, एक-बार पुनर्स्थापना | |
| **[dsh-dsh-claude-move](https://github.com/PerryLink/dsh-dsh-claude-move)** | Claude Code सत्र, मेमोरी, कौशल और CLAUDE.md को DSH में स्थानांतरित करें | |
| **[dsh-dsh-click](https://github.com/PerryLink/dsh-dsh-click)** | DeepSeek Harness के लिए क्रॉस-प्लेटफ़ॉर्म नेटिव डेस्कटॉप नियंत्रण — Windows पहले। | |
| **[dsh-dsh-composer-history](https://github.com/PerryLink/dsh-dsh-composer-history)** | वेब कंपोज़र के लिए टर्मिनल-शैली इनपुट इतिहास: तीर, Ctrl+R खोज | |
| **[dsh-dsh-data-quality](https://github.com/PerryLink/dsh-dsh-data-quality)** | डेटासेट गुणवत्ता जाँच व उद्धरण सत्यापन (यहाँ उपभोग किया गया वैकल्पिक संख्या-सेतु) | |
| **[dsh-dsh-defend](https://github.com/PerryLink/dsh-dsh-defend)** | DeepSeek Harness के लिए प्रॉम्प्ट-इंजेक्शन, जेलब्रेक और सीक्रेट-लीक रक्षा। | |
| **[dsh-dsh-doublecheck](https://github.com/PerryLink/dsh-dsh-doublecheck)** | इंजीनियरिंग-अनुशासन रक्षक: आवश्यकताओं की पूछताछ, परीक्षण द्वार, प्रतिद्वंद्वी समीक्षा | |
| **[dsh-dsh-draw](https://github.com/PerryLink/dsh-dsh-draw)** | DeepSeek Harness के लिए एकीकृत स्थैतिक-छवि निर्माण रूटिंग। | |
| **[dsh-dsh-fast](https://github.com/PerryLink/dsh-dsh-fast)** | DeepSeek Harness के लिए रीड-ओनली प्रदर्शन डायग्नोस्टिक्स। | |
| **[dsh-dsh-fund-research](https://github.com/PerryLink/dsh-dsh-fund-research)** | चीनी सार्वजनिक म्यूचुअल फंड के लिए नियतात्मक अनुसंधान रिपोर्ट | |
| **[dsh-dsh-github](https://github.com/PerryLink/dsh-dsh-github)** | DSH के लिए GitHub PR/issues एकीकरण, हर लेखन अनुमोदन-द्वारित | |
| **[dsh-dsh-industry-research](https://github.com/PerryLink/dsh-dsh-industry-research)** | उद्योग-अनुसंधान ऑर्केस्ट्रेशन जो इस प्लगिन के `ctx.researchReport.assemble` से डिलीवरेबल सील करता है | |
| **[dsh-dsh-library](https://github.com/PerryLink/dsh-dsh-library)** | DeepSeek Harness के लिए स्थानीय दस्तावेज़ ज्ञानकोश। | |
| **[dsh-dsh-local-ai](https://github.com/PerryLink/dsh-dsh-local-ai)** | DeepSeek Harness के लिए स्थानीय-मॉडल (Ollama) एकीकरण। | |
| **[dsh-dsh-lsp-actions](https://github.com/PerryLink/dsh-dsh-lsp-actions)** | भाषा सर्वरों पर LSP निदान, फ़ॉर्मेटिंग, पूर्णता, कोड क्रियाएँ और नाम बदलना | |
| **[dsh-dsh-mask](https://github.com/PerryLink/dsh-dsh-mask)** | PII मास्किंग मिडलवेयर: मॉडल सीमा पर अनाम करें, डिस्प्ले लेयर पर पुनर्स्थापित करें | |
| **[dsh-dsh-mcp-panel](https://github.com/PerryLink/dsh-dsh-mcp-panel)** | केवल-पढ़ने वाला MCP रनटाइम पैनल: /mcp कमांड + स्थिति, टूल और त्रुटियों वाला Settings टैब | |
| **[dsh-dsh-observe](https://github.com/PerryLink/dsh-dsh-observe)** | DeepSeek Harness के लिए OpenTelemetry और Langfuse अवलोकनीयता निर्यातक। | |
| **[dsh-dsh-output-styles](https://github.com/PerryLink/dsh-dsh-output-styles)** | Claude Code outputStyles-समतुल्य रनटाइम शैली बदलाव | |
| **[dsh-dsh-permission-rules](https://github.com/PerryLink/dsh-dsh-permission-rules)** | ऑडिट के साथ Claude Code-शैली घोषणात्मक allow/deny/ask अनुमति नियम | |
| **[dsh-dsh-plugin-guide](https://github.com/PerryLink/dsh-dsh-plugin-guide)** | माँग पर एजेंट कौशल के रूप में प्लगइन-विकास ज्ञान आधार | |
| **[dsh-dsh-research-report](https://github.com/PerryLink/dsh-dsh-research-report)** | सामग्री-पता साक्ष्य और सीलबंद संस्करणों वाला सत्यापन-योग्य अनुसंधान-रिपोर्ट इंजन | |
| **[dsh-dsh-score](https://github.com/PerryLink/dsh-dsh-score)** | DeepSeek Harness प्लगिनों की बहु-आयामी गुणवत्ता स्कोरिंग। | |
| **[dsh-dsh-session-pin](https://github.com/PerryLink/dsh-dsh-session-pin)** | टिकाऊ क्रम के साथ वेब साइडबार में सत्र पिन करें | |
| **[dsh-dsh-session-sync](https://github.com/PerryLink/dsh-dsh-session-sync)** | DeepSeek Harness के लिए क्रॉस-डिवाइस सत्र सिंक — आपके सत्र स्टोर का एक समर्पित git मिरर। | |
| **[dsh-dsh-skill-pack-security](https://github.com/PerryLink/dsh-dsh-skill-pack-security)** | सुरक्षा-ऑडिट कौशल पैक: गुप्त स्कैन, निर्भरता और आपूर्ति-श्रृंखला समीक्षा | |
| **[dsh-dsh-talk](https://github.com/PerryLink/dsh-dsh-talk)** | DeepSeek Harness के लिए आवाज़-प्रथम सत्र लूप: बोलें और उत्तर सुनें। | |
| **[dsh-dsh-test-drive](https://github.com/PerryLink/dsh-dsh-test-drive)** | DeepSeek Harness प्लगिनों के लिए पृथक इंस्टॉल-एंड-स्मोक टेस्ट ड्राइव। | |
| **[dsh-dsh-translate](https://github.com/PerryLink/dsh-dsh-translate)** | DeepSeek Harness के लिए वेंडर पैरामीटर अनुवाद और नियतात्मक JSON मरम्मत। | |

## License

[Apache License 2.0](LICENSE) © 2026 dsh-memento contributors
