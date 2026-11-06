# 心灵之窗 · dsh-camera-window

接入摄像头，让你的大肥鱼看看你的样子和外面的世界。

装上它之后，agent 就有了「眼睛」——可以直接拍一张，而不是只能看你屏幕上的截图。

## 它给 agent 两个工具

| 工具 | 作用 |
|---|---|
| `camera_grab` | 拍一张照片，返回 JPEG 绝对路径（拿到后用 `read_image` 打开看） |
| `camera_list` | 列出可用摄像头（索引 + 分辨率），打不开时先查它 |

## 依赖

抓帧需要一个 Python 解释器 + OpenCV：

- **Python 3.9+**
- **opencv-python**（或 `opencv-python-headless`）

装一次就行：

```bash
python -m pip install opencv-python-headless
```

插件会自动探测解释器（`python` / `python3` / `py` / `DSH_PYTHON` 环境变量），也可以在配置里写死 `pythonPath`。

> 抓帧脚本内联在 `index.js` 里，运行时才写到 `<outDir>/camera-grab.v3.py` 再执行。
> 所以**不依赖包内文件位置**——装在哪儿都能跑。

## 装完记得重启 DSH

**重要**：装完插件后请**重启一次 DeepSeek Harness**。

不重启的话，DSH 内存里可能还是旧模块，会去找旧路径而报「找不到 camera-grab.py」。重启后加载新模块就正常了。

## 配置

| 字段 | 说明 | 默认 |
|---|---|---|
| `pythonPath` | Python 解释器绝对路径 | 自动探测 |
| `outDir` | 抓帧与脚本的存放目录 | `~/.dsh/camera-window` |
| `defaultIndex` | 默认摄像头索引 | `0` |

## 常见问题

**打不开摄像头？**
- 被微信、相机 App 之类占用了，先关掉它们
- USB 口供电不足，换机箱后面的口
- 用 `camera_list` 确认系统认没认到

**「设备描述符请求失败」？**
这是 USB 枚举失败，不是插件的问题。换口、换线、别用 Hub。

**画面一片黑？**
摄像头刚插上时前几帧常是黑的，插件已经会丢弃预热帧；还黑就换个光源或者等一下。

**提示缺 opencv？**
`python -m pip install opencv-python-headless`，装完不用重启 DSH。

## 隐私

- 照片只写到你本机的 `outDir`，不上传任何地方
- 只有 agent 主动调用才会拍，不会后台一直拍
- 用完的照片你可以随时删

## License

MIT
