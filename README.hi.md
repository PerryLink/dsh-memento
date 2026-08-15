# dsh-memento

**DeepSeek Harness के लिए परिबद्ध, स्तरित, अनुमोदन-द्वारी, लेखा-परीक्षण-योग्य क्रॉस-सेशन मेमोरी।**

[![license](https://img.shields.io/badge/license-Apache--2.0-3a7d44)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-4e51e8)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933)](https://nodejs.org/)
[![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()
[![no build step](https://img.shields.io/badge/build-none%20%28pure%20ESM%29-8a6d3b)]()

[English](README.md) · [中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

> अन्य मेमोरी प्लगइन एक **गोदाम (warehouse)** बेचते हैं। dsh-memento **सीम (seam)** बेचता है: एक टाइप्ड `ctx.memory` सेवा, एक लेखन-अनुमोदन द्वार जिसे कोई मॉडल पथ बायपास नहीं कर सकता, और ऑडिट ट्रेल जिन्हें आप सेशन लॉग से पुनर्निर्मित कर सकते हैं। DeepSeek Harness के लिए नेटिव-फर्स्ट मेमोरी — प्रोटोकॉल + ट्रस्ट गेट + ऑडिट, शून्य नेटवर्क और शून्य क्रेडेंशियल के साथ।

## ✨ dsh-memento क्यों?

- **यह एक क्षमता सीम (capability seam) है, कोई और स्टोर नहीं।** सर्विस डेफ़िनिशन (`ctx.memory`), लोकल SQLite प्रोवाइडर (`node:sqlite`, WAL, `0600`), और कंज़्यूमर (`memory` टूल + फ़्रोज़न स्नैपशॉट इंजेक्शन)। कोई भी भविष्य का प्लगइन — एक `dsh-claude-move` सीड इंटीग्रेशन, एक ब्रिज, एक पैनल — **उसी स्टोर को उसी द्वार के माध्यम से** पढ़ता और लिखता है।
- **द्वार को बायपास नहीं किया जा सकता।** हर लेखन पथ (`add`/`replace`/`remove`/`seed`) **सेवा के अंदर** अनुमोदन वॉटरफॉल से गुज़रता है, टूल लेयर में नहीं। `writePolicy: ask | auto | off` ऐसा कॉन्फ़िगरेशन है जिसे मॉडल न तो देख सकता है और न ही बदल सकता है; एक सेशन-स्तरीय `never` रुख फिर भी सब कुछ पहले ही रोक देता है। `replace`/`remove`/`consolidate` अनुमोदन पेलोड में बदली जाने वाली प्रविष्टियों का पूरा पाठ ले जाते हैं — आप जो अनुमोदित करते हैं वही देखते हैं, और अस्वीकृत लेखन भी `*-denied` ऑडिट पंक्ति दर्ज करता है।
- **Model-visible ⟺ logged.** इंजेक्ट किया गया स्नैपशॉट `request/header.system` में शब्दशः उतरता है; हर लेखन `approval/asked` (पूर्ण पेलोड) + `approval/decided` (परिणाम) + प्लगइन की अपनी ऑडिट टेबल से पुनर्निर्मित किया जा सकता है।
- **परिबद्ध और ईमानदार।** हर-ट्रैक/हर-लेयर कठोर वर्ण बजट (डिफ़ॉल्ट user 2000 / agent 4000)। भरा हुआ स्टोर **संरचित त्रुटि के साथ विफल** होता है (उपयोग + सीमा) — मॉडल समेकित करके पुनः प्रयास करता है। कभी काटा नहीं जाता, कभी स्वतः-कॉम्पैक्ट नहीं होता।

## ⚡ त्वरित शुरुआत

```sh
# requires Node ^22.19 || >=24 and DSH 0.1.0-rc.6
dsh plugin --profile web add dsh-memento      # or ./dsh-memento / a tarball / a GitHub URL
dsh --profile web --dump-config               # expect a "# == dsh-memento" layer, no FAILED at startup
```

फिर, Web UI में: मॉडल से कुछ याद रखने को कहें → लेखन को अनुमोदित करें → एक **नया सेशन** शुरू करें और पूछें कि उसे क्या याद है। बस यही पूरा डेमो है।

```yaml
# optional override in the profile's cordis.patch.yml
- id: memento
  config:
    writePolicy: ask        # ask (default) | auto | off — model-invisible
    budgets:
      user: { userGlobal: 4000, workspace: 2000 }   # Chinese-heavy memory: raise + note why
      agent: { userGlobal: 4000, workspace: 4000 }
```

## 🧠 यह क्या करता है

| | घटक | आपको क्या मिलता है |
| --- | --- | --- |
| 🧩 Service Definition | `ctx.memory` — `add` / `replace` / `remove` / `query` / `seed` / `budgets()` | टाइप्ड, merge-घोषित सेवा; लेखन विधियाँ द्वार को आंतरिक रूप से लागू करती हैं |
| 💾 Provider | `lib/store.mjs` — `node:sqlite` एकल फ़ाइल (`$DSH_HOME/dsh-memento/memory.db`, WAL) | शून्य निर्भरता, शून्य नेटवर्क; एंट्री + ऑडिट टेबल; यूनीक-सबस्ट्रिंग मिलान |
| 🛠 Consumers | `memory` टूल · फ़्रोज़न स्नैपशॉट इंजेक्शन (system-prompt सेक्शन, क्रम `-50`) · `memory_recall` टूल · `/memory` कमांड · रीड-ओनली Web पैनल | मॉडल-मुखी लेखन/पठन, बजट-शीर्ष फ़्रोज़न स्नैपशॉट, दो-भाग रिकॉल, यूज़र-साइड कमांड, ब्राउज़र ड्रॉअर |

**दो ट्रैक × दो लेयर × प्रति-एजेंट कुंजी।** `user` ट्रैक = उपयोगकर्ता के बारे में तथ्य (प्राथमिकताएँ, संचार शैली, संवेदनशील बिंदु); `agent` ट्रैक = पर्यावरण तथ्य, प्रोजेक्ट परंपराएँ, सीखे गए पाठ। हर ट्रैक में `user-global` (क्रॉस-वर्कस्पेस) और `workspace` (प्रति-सेशन cwd) लेयर होती हैं — Codex-शैली मर्ज्ड लेयरिंग, Hermes-शैली केवल-ग्लोबल नहीं। एक तीसरा आयाम सत्र के `agentPreset` से प्रविष्टियों को अलग करता है (प्रति-एजेंट स्कोप); बिना preset वाली प्रविष्टियाँ सबको दिखने वाली साझा लेयर में रहती हैं। सेशन-स्कोप्ड पठन और लेखन-लक्ष्यीकरण उसी दृश्यता का पालन करते हैं: एक सत्र केवल साझा प्रविष्टियाँ + अपने एजेंट की प्रविष्टियाँ देखता है (और `replace`/`remove` केवल उन्हें छू सकता है), तथा `workspace` प्रविष्टियाँ केवल अपने cwd के लिए। प्रबंधन सतहें (`/memory`, पैनल) पूर्ण क्रॉस-एजेंट दृश्य रखती हैं।

**फ़्रोज़न स्नैपशॉट।** स्नैपशॉट हर सेशन में पहली प्रॉम्प्ट असेंबली पर एक बार रेंडर होता है (सिंक्रोनस SQLite रीड + प्रति-सेशन कैश) और सेशन के बीच कभी नहीं बदलता — निर्माण से ही प्रीफ़िक्स-कैश स्थिर। सेशन-आंतरिक परिवर्तन केवल डिस्क + ऑडिट में स्थायी होते हैं।

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

## 🧰 इंस्टॉल और अनइंस्टॉल

```sh
dsh plugin --profile <name> add ./dsh-memento        # local checkout (no build step)
dsh plugin --profile <name> add dsh-memento          # npm पैकेज (0.2.0 से प्रकाशित)
dsh plugin --profile <name> add git+https://github.com/PerryLink/dsh-memento.git   # GitHub इंस्टॉल
dsh plugin --profile <name> remove dsh-memento       # uninstall: DB + session logs are kept
```

अनइंस्टॉल के बाद मेमोरी डेटाबेस और वे सेशन लॉग, जिन्होंने मेमोरी गतिविधि रिकॉर्ड की थी, बचे रहते हैं; पुराने सेशन लोड होने योग्य बने रहते हैं।

## ⚙️ कॉन्फ़िगरेशन

हर फ़ील्ड एक मान्यीकृत Schemastery `Config` है; अमान्य मान लोड के समय ज़ोर से विफल होते हैं। cordis.yml में `memento` पंक्ति के अंतर्गत ओवरराइड करें।

| फ़ील्ड | डिफ़ॉल्ट | अर्थ |
| --- | --- | --- |
| `enabled` | `true` | `false` सेवा, टूल, स्नैपशॉट, कमांड, पैनल और उत्तरदाता को पूरी तरह हटा देता है (कोई अधूरी स्थिति नहीं) |
| `dbPath` | `''` → `$DSH_HOME/dsh-memento/memory.db` | निरपेक्ष, या `$DSH_HOME` के सापेक्ष |
| `budgets.user.userGlobal` / `budgets.user.workspace` | `2000` / `2000` | user ट्रैक की हर लेयर का कठोर वर्ण बजट |
| `budgets.agent.userGlobal` / `budgets.agent.workspace` | `4000` / `4000` | agent ट्रैक की हर लेयर का कठोर वर्ण बजट |
| `writePolicy` | `'ask'` | `'ask'` = उपयोगकर्ता अनुमोदन; `'auto'` = अनुमति दें (अनुमोदन स्रोत रिकॉर्ड किया गया); `'off'` = अस्वीकार करें। मॉडल-अदृश्य |
| `writePolicies` | `{}` | प्रति-ट्रैक/स्कोप या प्रति-स्रोत ओवरराइड: कुंजियाँ `user/workspace`, `agent/user-global`, `source:claude`, … → `ask`/`auto`/`off`; बेमेल `writePolicy` पर गिरता है |
| `language` | `'en'` | मॉडल-दृश्य पाठ और कमांड आउटपुट की भाषा: `'en'` (डिफ़ॉल्ट) या `'zh'` — टूल विवरण, फ्रोज़न स्नैपशॉट, `/memory` कमांड और वेब पैनल सभी इसका अनुसरण करते हैं |
| `snapshotOrder` | `-50` | स्नैपशॉट सेक्शन क्रम: harness आइडेंटिटी (`-100`) के बाद, persona (`0`) से पहले |
| `maxEntriesPerQuery` | `20` | प्रति-क्वेरी परिणाम की डिफ़ॉल्ट सीमा (स्पष्ट `limit` अनुमत, कठोर सीमा 1000) |
| `commandListLimit` | `50` | प्रति `/memory list` / `query` कमांड दिखाई गई प्रविष्टियाँ |
| `commandAuditLimit` | `10` | प्रति `/memory audit` कमांड दिखाई गई ऑडिट पंक्तियाँ |
| `recall.historyLimitDefault` / `recall.snippetCap` / `recall.snippetChars` / `recall.windowDays` | `8` / `5` / `300` / `30` | `memory_recall` इतिहास डिफ़ॉल्ट: स्कैन किए सेशन, प्रति सेशन स्निपेट, स्निपेट वर्ण, दिनों की विंडो |
| `panelEntriesLimit` | `200` | वेब पैनल प्रविष्टि पृष्ठ आकार (और सीमा) |
| `panelAuditLimit` | `20` | वेब पैनल ऑडिट पंक्तियाँ डिफ़ॉल्ट (सीमा 200) |
| `auditRetentionDays` | `0` | ऑडिट अवधारण: 0 = हमेशा, >0 = स्टोर खुलने पर पुरानी पंक्तियाँ हटाएँ |
| `proposals.enabled` / `proposals.maxChars` / `proposals.maxPending` | `true` / `2000` / `8` | ऑटो-कैप्चर: हर सफल कॉम्पैक्शन के बाद लंबित मेमोरी प्रस्ताव (काटा गया, प्रति सेशन एक); बंद करें या सीमाएँ बदलें |

## 🛠 टूल और सतहें

- **`memory`** — विवरण में अंतर्निहित Save/Skip मार्गदर्शन के साथ add/replace/remove/consolidate/query (उपयोगकर्ता प्राथमिकताएँ, सुधार, पर्यावरण तथ्य, परंपराएँ, सबक सहेजें; तुच्छ बातें, पुनः-व्युत्पन्न तथ्य, डंप, एक-बार के पथ छोड़ें)। लेखन अनुमोदन द्वार से गुज़रते हैं; पठन निःशुल्क हैं; replace/remove एक **यूनीक सबस्ट्रिंग** को लक्षित करते हैं (अस्पष्ट मिलान उम्मीदवार सूची के साथ विफल होते हैं); consolidate एक अनुमोदन और एक परमाणु लेखन से 1..20 प्रविष्टियों को एक में मिलाता है।
- **`memory_recall`** — दो-भाग रिकॉल: परिबद्ध मेमोरी मिलान **और साथ में** `ctx.sessionQuery` के माध्यम से हाल के सेशन-इतिहास मिलान (जहाँ सेवा अनुपस्थित हो वहाँ केवल-मेमोरी पर सहजता से गिरता है)।
- **`/memory`** — उपयोगकर्ता-ट्रिगर कमांड (मॉडल टर्न नहीं): `list` · `query <word>` · `add [--track=user|agent] [--scope=user-global|workspace] <text>` · `remove [flags] <substring>` · `consolidate [flags] <substring...> => <text>` · `proposals [approve|dismiss <id>]` · `budgets` · `audit` · `export` · `import <path>`। कमांड लेखन उसी वॉटरफॉल + नीति से गुज़रते हैं; ऑडिट प्लगइन ऑडिट टेबल + `command/done` में दर्ज होता है। `export` रीड-ओनली है और सभी प्रविष्टियाँ + बजट एक JSON दस्तावेज़ के रूप में निकालता है; `import` उसे वापस लाता है (फ़ाइल पथ या इनलाइन JSON, एक अनुमोदन, बजट पूर्व-जाँच) — पूर्ण बैकअप/माइग्रेशन चक्र। आयातित प्रविष्टियों को नए id व टाइमस्टैम्प मिलते हैं; प्रस्ताव, ऑडिट पंक्तियाँ और रिकॉल गणनाएँ माइग्रेट नहीं होतीं।
- **ऑटो-कैप्चर प्रस्ताव** — सफल सेशन कॉम्पैक्शन के बाद सारांश एक लंबित मेमोरी प्रस्ताव (`agent/workspace`) बन जाता है; approve उसे अनुमोदन द्वार से लिखता है, dismiss उसे हटाता है। लंबित प्रस्ताव फ्रोज़न स्नैपशॉट और पैनल में दिखते हैं।
- **Web पैनल** — शून्य-बिल्ड `dsh.client` ड्रॉअर: ट्रैक/लेयर के अनुसार एंट्री ब्राउज़ करें, खोजें, बजट बार, ऑडिट टेल। डिज़ाइन से रीड-ओनली: लेखन और अनुमोदन `memory` टूल और बिल्ट-इन अनुमोदन UI के माध्यम से होते हैं।

## 🎓 टर्मिनल मेमोरियों से हमने क्या सीखा

dsh-memento Claude Code, Codex या Hermes का पोर्ट नहीं है — पर इसके डिज़ाइन ने जान-बूझकर उनका सही हिस्सा आत्मसात किया और नुकसानदेह हिस्सों को ठुकराया:

| टर्मिनल मेमोरी | उसने क्या सही किया | dsh-memento ने क्या अपनाया |
| --- | --- | --- |
| **Claude Code** — `CLAUDE.md` | पदानुक्रमित **सादा-पाठ मेमोरी फ़ाइलें** (उपयोगकर्ता स्तर → प्रोजेक्ट स्तर), जिन्हें इंसान पढ़-संपादित कर सकता है, और हर सेशन में अपने-आप मर्ज होती हैं — ऐसी मेमोरी जिसे आप खुद पढ़ और ठीक कर सकते हैं | सादा-पाठ प्रविष्टियाँ; प्रति सेशन मर्ज होने वाली `user-global` / `workspace` लेयरें; एक स्टोर जिसे आप ब्राउज़, `export` और ऑडिट कर सकते हैं — पारदर्शिता ही फ़ीचर है |
| **Codex** — `AGENTS.md` | **प्रति-निर्देशिका स्कोप्ड निर्देश** अपने-आप खोजे और बिना किसी मॉडल-घर्षण के इंजेक्ट होते हैं — स्थानीयता मात्रा से बड़ी चीज़ है; मेमोरी "लोड" करने के लिए कोई टूल-कॉल नहीं चाहिए | सेशन के cwd से बँधी `workspace` लेयर (Windows में केस-इनसेंसिटिव); फ्रोज़न स्नैपशॉट सेशन शुरू होते ही अपने-आप इंजेक्ट होता है |
| **Hermes** — `memory.md` | **सक्रिय मेमोरी सेव** (save/update/delete) और [issue #48181](https://github.com/NousResearch/hermes-agent/issues/48181) की सुरक्षा सीख: केवल टूल लेयर पर लगाया गया द्वार देर से हुए टूल-इंजेक्शन से बायपास हो सकता है — द्वार वहाँ लगाओ जहाँ हर लेखन पथ मिलता है | स्पष्ट Save/Skip मार्गदर्शन वाला `memory` टूल + अनुमोदन-द्वारित ऑटो-कैप्चर प्रस्ताव; अनुमोदन द्वार **`ctx.memory` के लेखन मेथड्स के अंदर** रहता है, टूल लेयर में नहीं |

स्रोत: [Claude Code मेमोरी](https://code.claude.com/docs/en/memory) · [Codex AGENTS.md](https://developers.openai.com/codex/cli/agents-md) · [Hermes मेमोरी](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md) · [Hermes #48181](https://github.com/NousResearch/hermes-agent/issues/48181)।

और जिन हिस्सों को हमने जान-बूझकर ठुकराया: मॉडल के निजी स्टेट में छिपी ऑटो-समरीकरण (यहाँ कॉम्पैक्शन सारांश **लंबित प्रस्ताव** बनते हैं जो इंसानी approve/dismiss की प्रतीक्षा करते हैं), वेयरहाउस/वेक्टर-स्टोर महत्वाकांक्षाएँ, और ऐसा कोई भी लेखन जिसमें इंसान को दिखने वाला अनुमोदन या ऑडिट-ट्रेल न हो। साथ ही Hermes की दस्तावेज़ित चेतावनी अपनाई: एक ही home निर्देशिका साझा करने वाले दो प्रोसेस एक ही मेमोरी फ़ाइल लिखते हैं — सुरक्षा सीमाएँ देखें।

## 🆚 यह कैसे अलग है

| प्लगइन | यह क्या है | dsh-memento का अंतर |
| --- | --- | --- |
| dsh-memory-evolve | मेमोरी वेयरहाउस / इवोल्यूशन लूप | एक टाइप्ड सेवा सीम, अनुमोदन द्वार, और सेशन-लॉग ऑडिट; कोई वेयरहाउस महत्वाकांक्षा नहीं |
| dsh-mnemon | मेमोरी स्टोर सहायक | प्रोटोकॉल + द्वार + ऑडिट, कोई और स्टोर नहीं |
| dsh-kb-sieve | नॉलेज-बेस छानना | कोई रिट्रीवल इंजीनियरिंग नहीं: छोटे-कॉर्पस सबस्ट्रिंग खोज, `session_search`/`sessionQuery` के माध्यम से क्रॉस-सेशन रिकॉल |
| dsh-tdai-memory | कार्य-चालित मेमोरी टूलिंग | बजट प्रति ट्रैक×लेयर होते हैं और सेवा में लागू होते हैं, बेस्ट-एफ़र्ट नहीं |
| claude-bridge | Claude Code ब्रिजिंग | DSH-नेटिव; भविष्य का `seed(source:'claude')` पथ ब्रिज को उसी स्टोर में फ़ीड करने देता है |
| dsh-external/Recall | बाहरी एजेंट मेमोरी | लोकल-फर्स्ट, शून्य-नेटवर्क, DSH के अपने अनुमोदन सीम पर चलता है |
| Official MCP memory examples | DSH की घोषित "memory = external MCP" स्थिति | **नेटिव फर्स्ट-पार्टी** पूरक: समान लक्ष्य, कोई बाहरी सर्वर नहीं; दोनों सह-अस्तित्व में रहते हैं |

नाम **`dsh-memento`** है (npm और GitHub पर प्रकाशित)। `dsh-recall` नहीं (dsh-external/Recall से भ्रमित होने वाला), और न ही हटाया गया पुराना नाम `dsh-memory`।

## 🔒 सुरक्षा सीमाएँ

- **केवल सार्वजनिक सेवाएँ** (`tools`, `systemPrompt`, अनुमोदन सीम)। कोई engine / agent-loop / apiproxy / official-UI परिवर्तन नहीं।
- **शून्य नेटवर्क, शून्य क्रेडेंशियल।** स्थानीय डेटाबेस; POSIX फ़ाइल मोड `0600`।
- **ज़ोर से विफल होता है।** दूषित DB या नया schema लोड पर विफल होता है; भरे हुए बजट और अस्पष्ट सबस्ट्रिंग मिलान संरचित त्रुटियों के साथ विफल होते हैं। कुछ भी चुपचाप निगला या काटा नहीं जाता।
- **एक प्रोसेस, एक स्टोर।** एक प्रोसेस में कई सेशन SQLite स्टोर साझा करते हैं (क्रमबद्ध लेखन, प्रति-सेशन ऑडिट)। एक ही `$DSH_HOME` साझा करने वाली दो **प्रोसेस** एक ही फ़ाइल लिखती हैं: SQLite लॉकिंग के तहत last-writer-wins — यदि आपको क्रॉस-प्रोसेस स्थिरता चाहिए तो एक `$DSH_HOME` पर दो harness इंस्टेंस न चलाएँ (वही चेतावनी जो Hermes प्रोजेक्ट दस्तावेज़ित करता है)।

## ⚠️ ज्ञात सीमाएँ

- **सेशन ईवेंट शब्दावली घोषित है, अभी उत्सर्जित नहीं (rc.6)।** `memory/added|updated|removed|recalled|snapshot` `types.d.ts` में merge-घोषित हैं, लेकिन rc.6 में रेपो-बाह्य ईवेंट प्रकारों के लिए कोई पंजीकरण सतह नहीं है (अपंजीकृत append स्थायी सेशन को अनलोड-अयोग्य बना देते)। ऑडिट पूर्णता अनुमोदन जोड़ी + ऑडिट टेबल से आती है; जैसे ही कोई harness बिल्ड प्रकारों को पंजीकृत करता है, उत्सर्जन स्वतः चालू हो जाता है। देखें [ARCHITECTURE.md](ARCHITECTURE.md) निर्णय 4।
- **`ask` नीति को एक उत्तरदाता चाहिए।** कोई UI/ACP उत्तरदाता रचित न होने पर, लेखन बंद-स्थिति में विफल होते हैं (`unavailable`) — डिज़ाइन से, अनुमोदन सीम का fail-closed रुख।
- **कोई FTS5 इंडेक्स नहीं।** सबस्ट्रिंग खोज केस-इनसेंसिटिव `instr` से चलती है (CJK के लिए सही); रिकॉल रैंकिंग प्रति-एंट्री हिट गणना का उपयोग करती है। FTS5 का trigram टोकनाइज़र एकल-वर्ण CJK वर्णों को इंडेक्स नहीं कर सकता, इसलिए इसका उपयोग नहीं होता — देखें [ARCHITECTURE.md](ARCHITECTURE.md) निर्णय 10।

## 🧪 विकास

```sh
npm install
npm test                # node --test: 115 tests — budget, unique-substring, gate policy, store, snapshot, mock-ctx integration (S2/S3 invariants), V2 command/recall/panel/import
npm run typecheck       # index.mjs / lib / scripts पर tsc --checkJs द्वार
npm run check:coverage  # लाइन-कवरेज द्वार: lib ≥90%, index.mjs ≥85%, सभी ≥90%
npm run check:readmes   # पाँच-भाषा README संगति द्वार
```

`lib/` शून्य-DSH-निर्भरता है (केवल node: बिल्ट-इन); DSH आयात केवल `index.mjs` में मौजूद हैं। पूर्ण अनुशासन [AGENTS.md](AGENTS.md) में; डिज़ाइन निर्णय [ARCHITECTURE.md](ARCHITECTURE.md) में।

## 🏷 विषय

सुझाए गए GitHub विषय: `dsh` · `dsh-plugin` · `deepseek-harness` · `memory` · `agent-memory` · `approval` · `audit` · `sqlite` · `cordis` · `llm`

## 📄 लाइसेंस

Apache License 2.0 — देखें [LICENSE](LICENSE)। कोई तृतीय-पक्ष कोड पुनर्वितरित नहीं किया जाता; देखें [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)।
