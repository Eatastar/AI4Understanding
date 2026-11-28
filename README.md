## AI 辅助个人阅读与知识整理 / AI-assisted reading and personal knowledge management

<img src="./outputs/client/public/assets/ai4u-logo.svg" alt="AI4U" width="80" height="80" align="right">

AI4Understanding 是基于「AI 嵌入式论文 PDF 阅读器」开发的开源项目，希望把个人精读和知识整理的体验做到商用水准。

AI4Understanding is an open-source project built on AI-Embedded Paper PDF Reader. Our goal is a tool for close reading and personal knowledge management that meets commercial standards.

如今ai的发展让我们的文献阅读越来越便捷，但是有时候，我们总还是想要慢下来，为了我们的好奇心和求知欲，为了我们的品味与审美，来认真阅读、学习一些东西。我想个人对知识的理解是我们作为人类而言最宝贵的体验与财富，我们总是会被自然本质的魅力所吸引，而不住地想去理解它，这款产品就是以此为目标诞生的。但目前市面上似乎没有好用的，能够加速个人的学习与理解的产品。开发者自己轻度试用了目前市面上类似的产品，包括llm-for-zetore, atlaswork等，也粗略了解了阿里达摩院，heptabase等产品，发现它们在整理文献、知识的方面有着很强大的功能，但是在个人精读方面的使用体验仍然不算丝滑，尤其是当前很多软件喜欢把ai聊天框简单放在右侧栏，就个人体验来说用起来有点别扭，并且仍然需要面临在长对话中反复翻找的困境。

AI has made reading research papers easier. Sometimes, though, we want to slow down and let curiosity, a love of learning, and our own sense of beauty guide what we study. To me, coming to understand something for ourselves is one of the most precious experiences we can have as human beings. That understanding is something we get to keep. The beauty of the natural world keeps drawing us in and makes us want to know how it works. That impulse is why I built this tool. I’ve struggled to find software that really helps me learn and make sense of things more quickly on my own. I briefly tried LLM for Zotero and AtlasWork, and took a quick look at Heptabase and related work from Alibaba’s DAMO Academy. These tools are powerful for organizing papers and notes. When I sit down to read a paper closely, the AI chat that so many apps put in a right-hand sidebar feels awkward to use, and finding an earlier answer still means scrolling back through a long conversation.

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

[windows-zip]: https://github.com/Eatastar/AI4Understanding/releases/download/v0.1.46-preview.69/AI4Understanding-0.1.46-preview.69-Windows-x64.zip
[release]: https://github.com/Eatastar/AI4Understanding/releases/tag/v0.1.46-preview.69
