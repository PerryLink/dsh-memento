<div align="center">

# dsh-memento
- **1024 स्टोर चैनल**: एक बार `npm i -g dsh1024`, फिर `dsh1024 plugin --profile web add dsh-memento` ([deepseek1024.com](https://deepseek1024.com) इंस्टॉल रैंकिंग में गिना जाता है)।

**DeepSeek Harness के लिए परिबद्ध, स्तरित, अनुमोदन-द्वारी, लेखा-परीक्षण-योग्य क्रॉस-सेशन मेमोरी।**

*एक टाइप्ड `ctx.memory` सीम, एक राइट-अनुमोदन द्वार जिसे मॉडल का कोई रास्ता बायपास नहीं कर सकता, और एक पुनर्निर्मेय ऑडिट — अनुमोदन जोड़ी और प्लगइन की अपनी ऑडिट तालिका से, सेशन लॉग की कमी को खुलकर बताते हुए।*

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
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-memento?metric=downloads&lang=hi)](https://dshfind.com/hi/plugins/PerryLink/dsh-memento?ref=badge)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

</div>

---

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.1.7-alpha.1` (2026-09-22 को अनुकूलित): `0.1.7` लाइन ने पूरी सेटिंग्स पंजीकरण सतह (`installSettingsSection` / `SettingsProvider.installSection` / `SettingsNamespace` / `SettingsScope`) को लाइव कॉन्फ़िग फ़ॉर्म से बदल दिया, इसलिए दोनों आधे नया अनुबंध अपनाते हैं — फ़ॉर्म का namespace प्रोफ़ाइल प्रविष्टि की id (`memento`) है, संपादन-योग्य फ़ील्ड `.volatile()` वाले हैं, और स्वीकृत संपादन प्लगइन को रीमाउंट करने के बजाय **चल रहे प्लगइन में** लागू होता है। ब्राउज़र आधा वही फ़ॉर्म `ctx.configForms.get(entryId)` से पढ़ता है (`ctx.settingsScope` सेवा हट चुकी है)। दोनों आधे `installSection` / `settingsScope` शाखाएँ उन `0.1.2-rc.1`, `0.1.5-alpha.1` और `0.1.6-0` लाइनों के लिए बनाए रखते हैं जिन्हें peer रेंज अब भी घोषित करती है, और नई `>=0.1.7-0 <0.2.0` शर्त ही लक्ष्य होस्ट को स्थापित-योग्य बनाती है (पुरानी रेंज semver के प्रीरिलीज़ नियम से उसे बाहर कर देती थी)। प्लगइन इवेंट पंजीकरण सतह अब भी नहीं है — `KNOWN_SESSION_EVENT_TYPES` में `memory/*` नहीं है, और `Session.append` का तीसरा तर्क केवल सरफ़ेस-योग्य प्रकारों के लिए `SurfaceIntent` ले जाता है, इसलिए ऑडिट द्वार अनुकूली रहता है और पहले जैसे छोड़ देता है (यह प्रति प्रोसेस एक बार और `/memory audit` में बताता है)। टाइप प्रमाण तीन फ़ेस से आता है: स्थानीय checkout के बने टाइप, `node_modules` में पिन की गई प्रकाशित लाइन, और DOM लाइब्रेरी के अंतर्गत ब्राउज़र आधा। |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | Windows / macOS / Linux (केवल host; कोई नेटिव कोड नहीं, कोई नेटवर्क नहीं) |
| Model | कोई भी |

## What you get

`dsh-memento` एक क्षमता-सीम है, कोई दूसरा भंडार नहीं: एक टाइप्ड `ctx.memory` सेवा, एक स्थानीय SQLite प्रदाता (`node:sqlite`, WAL, `0600`, `$DSH_HOME/dsh-memento/memory.db` पर) और उसके उपभोक्ता — `memory` टूल और सिस्टम प्रॉम्प्ट में इंजेक्ट किया गया फ़्रोज़न स्नैपशॉट।

- **अनुमोदन द्वार को टाला नहीं जा सकता।** हर लेखन पथ (`add` / `replace` / `remove` / `seed`) सेवा के भीतर अनुमोदन वॉटरफ़ॉल से होकर गुज़रता है, टूल परत से नहीं। `writePolicy: ask | auto | off` मॉडल के लिए अदृश्य विन्यास है; `replace` / `remove` / `consolidate` अनुमोदन पेलोड में बदली जाने वाली प्रविष्टियों का पूरा पाठ ले जाते हैं, और अस्वीकृत लेखन भी एक `*-denied` ऑडिट पंक्ति छोड़ता है।
- **मॉडल-दृश्य ⟺ लॉग किया गया।** इंजेक्ट किया गया स्नैपशॉट `system/message` में शब्दशः पहुँचता है; हर लेखन `approval/asked` + `approval/decided` + प्लगइन की अपनी ऑडिट तालिका से पुनर्निर्माण-योग्य है।
- **सीमित और ईमानदार।** प्रति ट्रैक/परत कड़े कैरेक्टर बजट (डिफ़ॉल्ट user 2000 / agent 4000)। भरा हुआ स्टोर संरचित त्रुटि देता है (उपयोग + सीमा) — कभी काटता नहीं, कभी स्वतः संकुचित नहीं करता।
- **ऑडिट की कमी दिखती है।** `/memory audit` प्लगइन की ऑडिट तालिका दिखाता है और जब सेशन लॉग वाला पक्ष नहीं लिखा जाता तो एक पंक्ति जोड़ता है: यह होस्ट `memory/*` सेशन इवेंट प्रकार नहीं जानता, और अज्ञात प्रकार जोड़ने से वह सेशन दोबारा लोड ही नहीं होगा, इसलिए लेख `approval/asked` + `approval/decided` और प्लगइन की तालिका से ऑडिट होते हैं। द्वार अनुकूली है — होस्ट इन प्रकारों को जानते ही यह पंक्ति स्वयं हट जाती है।

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

**सेटिंग्स पैनल।** `0.1.7` लाइन पर प्लगइन का अपना `Config` ही उसका सेटिंग्स पृष्ठ **है**: फ़ॉर्म का namespace प्रोफ़ाइल प्रविष्टि की id (`memento`, यानी इस bundle की पंक्ति का `id:`) है, संपादन-योग्य फ़ील्ड ठीक वही हैं जिन्हें प्लगइन `.volatile()` घोषित करता है (नीचे के सभी कुंजी, `enabled` को छोड़कर), और स्वीकृत संपादन प्रोफ़ाइल की प्लगइन पंक्ति में मिल जाता है और चल रहे प्लगइन में लागू होता है — फ़ाइल छूने या पुनः आरंभ की ज़रूरत नहीं। लगभग सब लाइव लागू होते हैं (राइट पॉलिसी, भाषा, बजट, सीमाएँ, प्रस्ताव, पैनल; `dbPath` / `auditRetentionDays` स्टोर पुनः खोलकर; `retrieval.vector` रिट्रीवर बदलकर); लोड के समय पंजीकृत चीज़ें (`snapshotOrder`, टूल विवरण) रीलोड पर पढ़ी जाती हैं और पृष्ठ उन फ़ील्ड पर निशान लगाता है। संख्यात्मक सीमाएँ schema में भी घोषित हैं, इसलिए सीमा से बाहर का संपादन लिखने के समय ही अस्वीकार हो जाता है, बजाय एक अनुपयोगी कॉन्फ़िग छोड़ने के। पुरानी लाइनों (`0.1.2-rc.1`, `0.1.5-alpha.1`, `0.1.6-0`) पर वही कार्ड `dsh-memento` सेटिंग्स namespace संपादित करता है, पहले जैसा; सेटिंग्स सेवा पूरी तरह अनुपस्थित हो तो सब कुछ संयुक्त cordis कॉन्फ़िग पर लौटता है। फ़्लोटिंग पैनल बटन उसी पृष्ठ से छिपाया जा सकता है (`panel.enabled`)।

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
| settings section | DSH सेटिंग्स साइडबार → `dsh-memento` | फ़ाइल छुए बिना सभी कॉन्फ़िग फ़ील्ड संपादित करें (`enabled` को छोड़कर; `0.1.7` लाइन पर namespace = `memento` प्रोफ़ाइल प्रविष्टि, उससे पहले `dsh-memento` सेटिंग्स namespace); लाइव/रीलोड समय पृष्ठ पर अंकित |

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
- **Session log**: ऑडिट पूर्णता अनुमोदन जोड़ी (`approval/asked` + `approval/decided`) और प्लगइन की अपनी ऑडिट तालिका से आती है; सेशन लॉग वाली कमी `/memory audit` में घोषित होती है और होस्ट के `memory/*` दर्ज करते ही हट जाती है।

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
npm test                 # node --test: 187 टेस्ट
npm run lint             # oxlint
npm run test:conformance # dsh-memory-protocol v1 conformance suite
npm run typecheck        # होस्ट फ़ेस × स्थानीय D:\deepseek-harness checkout (checkout न हो तो «सत्यापन असंभव» छापकर exit 0)
npm run typecheck:ci     # होस्ट फ़ेस × node_modules में पिन की गई प्रकाशित लाइन
npm run check:client     # ब्राउज़र आधा (DOM लाइब्रेरी) टाइप गेट
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

### DSH Desktop मार्केट से इंस्टॉल करें

सभी PerryLink प्लगइन DSH Desktop के बिल्ट-इन मार्केट में देखे जा सकते हैं: **Market → Sources → add source → पेस्ट करें** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ चुनें**। इंस्टॉलेशन मार्केट के npm-identity सत्यापन और आपकी पुष्टि से ही होता है।
