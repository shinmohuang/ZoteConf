<p align="center">
  <img src="content/icons/icon.svg" width="96" height="96" alt="ZoteConf">
</p>

<h1 align="center">ZoteConf</h1>

<p align="center">
  把 Zotero 里的 arXiv 预印本，自动换成它正式发表的那个版本。<br>
  <sub>A Zotero plugin that finds where an arXiv preprint was actually published and updates the item in place.</sub>
</p>

---

从 arXiv 存进 Zotero 的论文，很多其实早就发表在 ICML、ACL、CVPR 上了，但条目还是“预印本”，引用时还得自己去查。ZoteConf 在你**添加条目的那一刻**就去查它的正式发表信息，查到就把条目原地更新成会议论文或期刊文章；暂时没发表的，之后定期自动重查。

## 功能

- **添加即查**：新加入的 arXiv 预印本几秒后自动查找，查到就转换，右下角提示 `标题 → ICML 2025`。
- **原地更新**：只改条目类型和元数据，PDF、笔记、标注、标签、分类全部保留；arXiv 号保留在 Extra（`arXiv: 2010.11929`）。
- **没发表的自动重查**：记入待查列表，每篇最多每 7 天查一次，直到查到为止。
- **存量批量处理**：选中任意多个条目，右键“查找正式发表版本”，带进度条。
- **丢了 arXiv 号也能查**：被别的工具转错、手动改回“预印本”的条目，或直接从 OpenReview 存的稿子，会按标题和作者反查。
- **会议名写成评级插件认得的形式**：`ICML2026`、`NeurIPS2024`，方便 Ethereal Style 等插件显示 CCF 等级。
- **宁可漏，不可错**：按标题匹配的数据源必须标题和作者都对上；workshop、投稿中、被拒的版本不算发表。

## 安装

1. 到 [Releases](https://github.com/shinmohuang/ZoteConf/releases/latest) 下载 `zoteconf-x.y.z.xpi`（Firefox 用户请右键“链接另存为”）。
2. Zotero → 工具 → 插件 → 右上角齿轮 → Install Plugin From File…，选择下载的文件。

需要 Zotero 8–10。装好后无需配置。

> 如果同时装着 [arXiv Workflow](https://github.com/AllanChain/zotero-arxiv-workflow) 之类会改同一批条目的插件，建议只留一个开着自动处理。

## 使用

| 场景 | 做法 |
|---|---|
| 新添加的 arXiv 论文 | 什么都不用做 |
| 库里已有的预印本 | 选中（可多选）→ 右键 → **查找正式发表版本** |
| 被转错的条目 | 把“条目类型”改回“预印本”，再右键查找 |

右键菜单只在选中项里有“预印本”类型的条目时出现。

### 转换后条目长什么样

| 字段 | 内容 |
|---|---|
| 条目类型 | 会议论文 / 期刊文章 |
| 作者 | 正式发表版的作者列表 |
| 会议名称 | `ICML2026` 这类简称（规则见下） |
| 论文集标题 / 期刊 | 完整名称 |
| 日期、页码、DOI、出版社 | 正式发表版的 |
| URL | 正式版链接（DOI 或 OpenReview） |
| Extra | 加一行 `arXiv: <编号>`，原有内容保留 |
| 标题、摘要 | 原来有就不动 |

## 会议名称的规则

“会议名称”字段是 Ethereal Style 等插件用来查 CCF 等级的（它们把这个字段原样发给 easyScholar），所以统一写成能被识别的形式：

| 情况 | 写法 |
|---|---|
| 一般会议 | 简称+年份，无空格：`ICML2026`、`NeurIPS2024`、`CVPR2025` |
| ICLR | `International Conference on Learning Representations`（easyScholar 不认 `ICLR` 的简称写法） |
| ACL 系 Findings | `Findings of the Association for Computational Linguistics: EMNLP 2024`，避免被算成主会 |
| 认不出简称 | IEEE 的 DOI 里带简称就用它（`10.1109/ITSC45102.…` → `ITSC2020`），否则填论文集全名 |

另外：

- **论文集按会议处理**。`Proceedings of the 41st IEEE/ACM International Conference on Automated Software Engineering` 这类名字，即使数据源把它标成期刊文章，也会转成会议论文并写成 `ASE2026`。真正叫 Proceedings 的期刊（PNAS、Proceedings of the IEEE、PVLDB、PACMPL 等）不受影响。
- DBLP 里的 `NIPS` 统一写成 `NeurIPS`。
- 没有 DOI 的期刊（JMLR、TMLR）会把 DBLP 的缩写展开成全称。

简称对照表在 [`src/core.js`](src/core.js) 的 `KNOWN_CONFERENCES`，欢迎提 PR 补充。

## 数据从哪来

按顺序查，命中即停：

| # | 数据源 | 怎么查 |
|---|---|---|
| 1 | [DBLP](https://dblp.org)（SPARQL 端点） | 用 arXiv DOI 精确定位，再找同作者同标题的非 CoRR 记录 |
| 2 | [arXiv](https://arxiv.org) | 作者自己填的 DOI |
| 3 | [Semantic Scholar](https://www.semanticscholar.org) | 按 arXiv ID；遇到 429 退避重试 |
| 4 | [OpenAlex](https://openalex.org) | 按标题，只采信自带 DOI 的发表记录 |
| 5 | [Crossref](https://www.crossref.org) | 按标题 |
| 6 | [OpenReview](https://openreview.net) | 按标题，能查到刚录用、别处还没收录的论文 |

查到正式 DOI 时，用 Zotero 自带的 DOI 翻译器取完整元数据；没有 DOI 的（ICLR、NeurIPS、COLM 等）用数据源自己的会议名、论文集名、年份、页码。

插件只向以上公开 API 发送论文的 arXiv 号、标题和第一作者姓氏，不收集任何数据，也不需要注册账号。

## 设置

暂时没有设置面板，在 设置 → 高级 → 配置编辑器 里修改：

| 首选项 | 默认 | 说明 |
|---|---|---|
| `extensions.zoteconf.autoOnAdd` | `true` | 添加条目时自动查找 |
| `extensions.zoteconf.recheckDays` | `7` | 未发表条目的重查间隔（天） |
| `extensions.zoteconf.s2ApiKey` | 空 | [Semantic Scholar API key](https://www.semanticscholar.org/product/api#api-key-form)，可选 |

Semantic Scholar 对匿名请求限流很严，经常返回 429。不填 key 也能用（多数论文在第 1 步就命中了），填了能多一个数据源。

## 已知限制

- 发表时改了标题的论文，如果 DBLP 和 Semantic Scholar 都没有把它和 arXiv 版本关联起来，就查不到。
- 只在主会和期刊里找，不会把 workshop 版本当作正式发表。
- 自动查找只针对带 arXiv 号的新条目；其他预印本需要手动右键。
- 没有一键撤销；转错了可以把条目类型改回预印本再重查。
- 会议简称靠一张对照表加规则识别，冷门会议可能只填得上全名。

遇到查错或查不到的论文，欢迎带上 arXiv 号提 [issue](https://github.com/shinmohuang/ZoteConf/issues)。调试日志在 帮助 → 调试输出记录，搜 `ZoteConf:`。

## 开发

纯 JavaScript，没有依赖，也没有构建工具链。

```sh
npm test                           # 单元测试（node:test）
npm run build                      # 生成 build/zoteconf-<version>.xpi
node scripts/live-check.js         # 用真实 API 跑一遍查找链
scripts/e2e.sh /tmp/zoteconf-e2e   # 在独立的临时 Zotero 实例里端到端验证（macOS，不碰你的文库）
```

| 路径 | 内容 |
|---|---|
| `src/core.js` | 不依赖 Zotero 的纯逻辑：识别条目、解析各数据源、查找链、会议名规则、生成条目更新 |
| `src/plugin.js` | Zotero 胶水层：触发时机、写条目、待查列表、菜单、进度条。依赖全部注入，可在 Node 下用假 Zotero 测试 |
| `test/fixtures/` | 各 API 的真实响应（`*.synthetic.json` 为手写） |

修 bug 的流程：先把出问题的论文的真实 API 响应存成 fixture，写一个失败的测试，再改代码。

## 致谢

思路来自 [zotero-arxiv-workflow](https://github.com/AllanChain/zotero-arxiv-workflow)。感谢 DBLP、arXiv、Semantic Scholar、OpenAlex、Crossref、OpenReview 提供开放的数据接口。

## License

[MIT](LICENSE)
