# CJK 字形回归夹具

`cjk-outline.ttf` 是 Noto Sans SC 的 59 字形测试子集，使用 SIL Open Font License 1.1，见 [OFL.txt](./OFL.txt)。字体版权为 © 2014–2021 Adobe，原始版权和许可元数据保留在字体内；此许可独立于 MachReport 源码许可证。

- 上游：[NotoSansSC-VF.ttf](https://github.com/notofonts/noto-cjk/blob/main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf)。
- 原始可变字体 SHA-256：`d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964`。
- 此测试子集 SHA-256：`e111eef7df8c6485237c78cd5e2d763597c70b21a1e0359b6fbee5997400fbbf`。
- 生成：fontTools 4.66.1，将可变字体实例化为 `wght=400`，随后按下面的字符集裁剪；字体家族重命名为 `MachReport CJK Regression`。
- 用途：验证 TrueType 原始轮廓完整嵌入 PDF，避免 fontkit 子集重写后出现文字可提取但字形不可见的回归。OTF/CFF 使用仓库既有的 `examples/minimal/public/fonts/mach-report-demo.otf` 另行验证。
- 常规安装、构建和测试无需下载字体或安装 Python 工具。夹具仅供测试，不能作为生产中文字库。

字符集：

```text
炼钢报表 电炉日报 产量统计 中文测试 0123456789 English不锈钢生产晨会报表 原始数值 0.000 90.12%ASCII
```
