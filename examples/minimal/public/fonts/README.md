# 示例中文字体

`mach-report-demo.otf` 是供 MachReport 示例与端到端测试使用的字符子集，包含示例源文件中的字符及基本 ASCII；不适合作为任意业务数据的完整中文字库。生产项目通过 `pdfFontUrl` 配置覆盖实际字符的字体。

- 原字体：Noto Sans SC Regular（Noto CJK）
- 固定上游提交：`f8d157532fbfaeda587e826d4cd5b21a49186f7c`
- 源文件：[NotoSansSC-Regular.otf](https://github.com/notofonts/noto-cjk/blob/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf)
- 版权：字体元数据保留原始版权声明；授权见 [OFL.txt](./OFL.txt)。此字体及其修改版遵循 SIL Open Font License 1.1，独立于 MachReport 源码许可证。
- 修改：裁剪到示例字符集，字体家族名改为 `MachReport Demo Sans`。

生成脚本按固定顺序读取 `examples/minimal/src` 中全部 `.ts` / `.vue` / `.json`，新增样例也会进入字符集。该子集只含 Regular 字面；粗体/斜体 PDF 会保留样式保真提示，生产完整字体方案应提供对应字面。

更新示例字符后可用 `fonttools==4.66.1` 重建：

```bash
python3 scripts/subset-demo-font.py /path/to/NotoSansSC-Regular.otf
```

常规安装、构建和测试直接使用已入库的字体，无需下载字体或安装 Python 工具。
