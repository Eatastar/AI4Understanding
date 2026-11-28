## AI 辅助个人阅读与知识整理 / AI-assisted reading and personal knowledge management

<img src="./outputs/client/public/assets/ai4u-logo.svg" alt="AI4U" width="80" height="80" align="right">

AI4Understanding 是基于「AI 嵌入式论文 PDF 阅读器」开发的开源项目，希望把个人精读和知识整理的体验做到商用水准。

AI4Understanding is an open-source project built on AI-Embedded Paper PDF Reader. Our goal is a tool for close reading and personal knowledge management that meets commercial standards.

几年前，大模型连数数都可能出错。2026 年 11 月，数学家 Levent Alpöge 公布了与 Claude 合作完成的黎曼猜想证明，随后通过了 Lean 形式化核验。[作者手记][rh-note] · [核验说明][rh-check]

A few years ago, language models could stumble over simple counting. In November 2026, mathematician Levent Alpöge published a proof of the Riemann hypothesis developed with Claude and subsequently verified in Lean. [Alpöge’s account][rh-note] · [Verification][rh-check]

我想个人对知识的理解是作为人类而言最宝贵的体验与财富，我们总是会被自然本质的魅力所吸引，而不住地想去理解它，这款产品就是以此为目标诞生的。

I believe the understanding we gain for ourselves is one of the most precious experiences we can have, and one of the most valuable things we can call our own. The beauty of how nature works keeps drawing us in and makes us want to understand it. That impulse is why I built this tool.

我短暂试用过 LLM for Zotero 和 AtlasWork，也初步了解过 Heptabase 和阿里巴巴达摩院的相关工作。这些工具给了我整理文献和笔记的思路。精读时，我更希望能在卡住的那一行提问，重读时就在原处找到讨论，省去翻找右侧长对话的工夫。

I briefly tried LLM for Zotero and AtlasWork, and looked into Heptabase and related work from Alibaba’s DAMO Academy. They gave me ideas for organizing papers and notes. When I’m reading closely, I want to ask a question beside the line that puzzled me and find the discussion there when I return, without scrolling back through a long sidebar chat.

顺便吐槽一句，GPT-6.2 真难用。

And for the record, GPT-6.2 is a real pain to use.

## Windows 试用版 / Windows preview

**[下载 Windows x64 试用版（.69，ZIP）][windows-zip]**。右键选择「全部解压」，打开解压后的文件夹，双击 **`AI4Understanding.exe`**。

**[Download the Windows x64 preview (.69, ZIP)][windows-zip]**. Right-click the ZIP, choose **Extract All**, then open the extracted folder and double-click **`AI4Understanding.exe`**.

首次打开可试用本地演示，或在工作台右上角的模型菜单选择「配置 API」连接自己的模型。当前仅提供 Windows 版，待产品成熟后会发布 macOS 和 Linux 版。[发布说明与校验文件][release]

Try the local demo or choose **Configure API** in the workbench’s upper-right model menu to connect your provider. The preview is Windows-only. macOS and Linux releases are planned once the app matures. [Release notes and checksum][release]

## 目前可以做什么 / What you can try

当前试用版与原版 AI 阅读器功能相近，许多交互细节仍较粗糙。

This early preview is close to the original AI reader in scope, and many interactions still need polish.

- **聊天**时可以自由讨论，选中回答中的一句话继续追问。<br>
  **Chat** freely or select a sentence in a reply to ask a follow-up.
- **阅读**本地 PDF 或电子书时，可以在原文旁提问、翻译和批注。<br>
  **Read** a local PDF or ebook and ask questions, translate passages, or add notes right beside the text.
- 在**个人 Wiki** 中整理回答、选区和批注，编辑公式、链接条目、点击引用返回原文。<br>
  **Build a personal wiki** from replies, passages, and annotations. Edit equations, link entries, and follow citations back to the text.

[rh-note]: https://alpo.ge/remark.pdf
[rh-check]: https://leanprover-community.github.io/blog/posts/riemann-hypothesis/
[windows-zip]: https://github.com/Eatastar/AI4Understanding/releases/download/v0.1.46-preview.69/AI4Understanding-0.1.46-preview.69-Windows-x64.zip
[release]: https://github.com/Eatastar/AI4Understanding/releases/tag/v0.1.46-preview.69
