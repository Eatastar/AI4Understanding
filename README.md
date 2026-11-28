# <img src="./outputs/client/public/assets/ai4u-logo.svg" alt="AI4U" width="80" height="80" align="middle"> AI4Understanding

1. **[下载 Windows x64 试用版（v0.1.46-preview.69，ZIP）][windows-zip]**。<br>
   **[Download the Windows x64 preview (v0.1.46-preview.69, ZIP)][windows-zip]**.
2. 右键点击下载的 ZIP，选择「全部解压」。<br>
   Right-click the downloaded ZIP file and choose **Extract All**.
3. 打开解压后的文件夹，双击 **`AI4Understanding.exe`** 启动。<br>
   Open the extracted folder and double-click **`AI4Understanding.exe`** to launch the app.

[发布说明与 SHA-256 校验文件 / Release notes and SHA-256 checksum][release]

目前只提供 **Windows x64** 试用包。待产品成熟后，我们会发布 macOS 和 Linux 版本。

This preview is available for **64-bit Windows (x64)**. We plan to release macOS and Linux versions once the app is more mature.

首次打开可以先试用本地演示模式。要让 AI 回答自己的问题，在工作台右上角打开模型菜单，点「配置 API」添加自己的模型连接。

You can start in local demo mode. To get answers from a live model, open the model menu in the upper-right corner of the workbench and choose **Configure API** to connect your model provider.

## AI 辅助个人阅读与知识整理 / AI-assisted reading and personal knowledge management

AI4Understanding 是一款基于「AI 嵌入式论文 PDF 阅读器」（AI-Embedded Paper PDF Reader）的新产品，目前仍在开发中。读者可以围绕论文或书中的一段原文向 AI 提问，核对回答引用的段落，再把自己的理解整理进个人知识库。

AI4Understanding is a new reading app built on AI-Embedded Paper PDF Reader. In the current preview, you can ask AI about a passage in a paper or book, check its answer against the text it cites, and write up what you’ve learned in your personal wiki.

我们的目标是打造一套开源的 AI 辅助个人阅读与知识整理体系，在易用性、来源可追溯性和长期使用的稳定性上达到商用水准。

Our goal is to build an open-source tool for AI-assisted reading and personal knowledge management. To meet commercial standards, it needs to be easy to use, let you trace notes back to their sources, and work reliably over time.

## 目前可以做什么 / What you can try

这个试用版和原版 AI 阅读器在功能上差别还不大，大部分功能的交互和细节也比较粗糙。

The feature set is much the same as in the original AI reader, and most interactions still need polish.

- **聊天**时可以自由提问，也可以选中回答中的一句话，针对这句话继续追问。<br>
  In **chat**, you can ask open-ended questions or select a sentence in a reply to follow up on that specific point.
- **阅读**本地 PDF 或电子书时，可以在原文旁问 AI、翻译选区或写批注，保留问题对应的原文位置。<br>
  While **reading** a PDF or ebook from your computer, select a passage to ask AI about it, translate it, or add a note. Your question stays linked to that spot in the text.
- 在**个人 Wiki** 中，可以把聊天回答、原文选区和批注整理进条目，编辑文字和公式、链接其他条目，再点来源返回原文。<br>
  Bring chat replies, selected passages, and annotations into your **personal wiki**. You can edit text and equations, link entries to one another, and follow a source link back to the original passage.

[windows-zip]: https://github.com/Eatastar/AI4Understanding/releases/download/v0.1.46-preview.69/AI4Understanding-0.1.46-preview.69-Windows-x64.zip
[release]: https://github.com/Eatastar/AI4Understanding/releases/tag/v0.1.46-preview.69
