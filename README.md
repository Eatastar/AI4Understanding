## AI 辅助个人阅读与知识整理 / AI-assisted reading and personal knowledge management

<img src="./outputs/client/public/assets/ai4u-logo.svg" alt="AI4U" width="80" height="80" align="right">

**AI4Understanding** 是一个正在开发的开源项目，基于「AI 嵌入式论文 PDF 阅读器」。我想做一款适合精读的工具。读到一句没懂的话，可以停在原处问清楚，顺着回答继续追问，再把想明白的东西用自己的话写进个人 Wiki。

**AI4Understanding** is an open-source project in development, built on AI-Embedded Paper PDF Reader. I’m building it for close reading. When a sentence stops you, you can ask about it right there, follow up on the part of the answer that still puzzles you, and put what you’ve learned into your own words in a personal wiki.

几年前，大模型有时连一个单词里某个字母出现了几次都数不准。2026 年 11 月，数学家 Levent Alpöge 公布了他与 Claude 合作得到的黎曼猜想证明，Lean FRO 与 Mathlib Initiative 随后核验了这份形式化证明。这样的进展让我想起一个更切身的问题。面对书上自己读不懂的一步，AI 能怎样帮我真正弄懂它？[作者手记][rh-note] · [形式化核验说明][rh-check]

Only a few years ago, language models could stumble over counting the occurrences of a letter in a word. In November 2026, mathematician Levent Alpöge published a proof of the Riemann hypothesis that he had found with Claude. The Lean FRO and the Mathlib Initiative subsequently verified the formal proof. That progress brings me back to a question closer to home. When I get stuck on a step in a book, how can AI help me understand it for myself? [Alpöge’s account][rh-note] · [Formal verification][rh-check]

我珍惜的是亲自想明白一件事的那一刻。有时是读到一个公式，突然看懂了熟悉的自然现象，有时是翻回几页重读定义，终于知道证明里的那一步为什么成立。自然的规律总会引出下一个值得追问的「为什么」。我希望读者能把时间花在这些问题上，也能留下自己一路走来的思路。

Some of my most rewarding moments as a reader come when a formula makes a familiar pattern in nature click, or when I turn back a few pages to a definition and finally see why a step in a proof works. There’s always another “why” worth asking. I want readers to have time for those questions and a way to keep the reasoning that led them to an answer.

我短暂试用过 LLM for Zotero 和 AtlasWork，也初步了解过 Heptabase 和阿里巴巴达摩院的相关工作。这些探索给了我不少整理文献和笔记的思路。我在精读时尤其在意一个细节。问题进了右侧聊天栏，对话一长，再读到同一行时，我往往得先翻聊天记录，才想得起当初为什么卡在这里。我希望问题和讨论就留在那行原文旁边，下次翻回来还能接着想。这也是我做 AI4Understanding 的初衷。它的目标是在阅读体验、来源可追溯性和长期可靠性上达到商用水准。

I spent a little time with LLM for Zotero and AtlasWork, and took an initial look at Heptabase and related work from Alibaba’s DAMO Academy. They gave me ideas for organizing papers and notes. In my own reading, one small detail kept getting in the way. When a question went into a chat sidebar on the right, I’d return to the same line in the paper only to find myself scrolling through a long conversation to remember what had puzzled me. I wanted to find the discussion beside that line and pick up the thought where I’d left it. That’s why I started AI4Understanding. My goal is a tool that meets commercial standards for ease of reading, traceable sources, and long-term reliability.

## Windows 试用版 / Windows preview

**[下载 Windows x64 试用版（v0.1.46-preview.69，ZIP）][windows-zip]**。下载后右键点击 ZIP，选择「全部解压」，打开解压后的文件夹，双击 **`AI4Understanding.exe`** 启动。

**[Download the Windows x64 preview (v0.1.46-preview.69, ZIP)][windows-zip]**. Right-click the ZIP file and choose **Extract All**, then open the extracted folder and double-click **`AI4Understanding.exe`**.

首次打开可以先试用本地演示模式。要让 AI 回答自己的问题，在工作台右上角打开模型菜单，选择「配置 API」，添加自己的模型连接。目前提供 Windows x64 试用包，待产品成熟后会发布 macOS 和 Linux 版本。[发布说明与 SHA-256 校验文件][release]

You can explore the app in local demo mode. To ask your own questions, open the model menu in the upper-right corner of the workbench and choose **Configure API** to connect your model provider. The preview is available for 64-bit Windows. I plan to release macOS and Linux versions once the app is more mature. [Release notes and SHA-256 checksum][release]

## 目前可以做什么 / What you can try

这个试用版和原版 AI 阅读器在功能上差别还不大，许多交互细节仍比较粗糙。

The preview still shares much of its feature set with the original AI reader, and many of the interactions need more polish.

- **聊天**时可以自由提问，也可以选中回答中的一句话，针对这句话继续追问。<br>
  In **chat**, you can ask an open-ended question or select one sentence in a reply and follow up on that point.
- **阅读**本地 PDF 或电子书时，可以在原文旁问 AI、翻译选区或写批注。问题会保留在当时阅读的位置。<br>
  While **reading** a local PDF or ebook, you can ask AI about a passage, translate it, or annotate it. Your question stays attached to the passage where it arose.
- 在**个人 Wiki** 中，可以把聊天回答、原文选区和批注整理进条目，编辑文字和公式、链接其他条目，再点来源返回原文。<br>
  In your **personal wiki**, you can bring together chat replies, passages, and annotations. Edit the text and equations, link related entries, and follow a citation back to the original passage.

[rh-note]: https://alpo.ge/remark.pdf
[rh-check]: https://leanprover-community.github.io/blog/posts/riemann-hypothesis/
[windows-zip]: https://github.com/Eatastar/AI4Understanding/releases/download/v0.1.46-preview.69/AI4Understanding-0.1.46-preview.69-Windows-x64.zip
[release]: https://github.com/Eatastar/AI4Understanding/releases/tag/v0.1.46-preview.69
