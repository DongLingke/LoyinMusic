# 落音 LoyinMusic

Web 音乐播放器，支持本地音乐库管理和在线音源播放。部署在服务器上，通过浏览器远程访问。

与 [日迹 DayNote](https://github.com/DongLingke/DayNote) 同属一个系列，共享相同的视觉设计语言。

## 功能

- **本地音乐** — 扫描服务器上的音频文件，自动读取元数据和封面
- **在线搜索** — 内置 5 大平台搜索（酷我/网易云/QQ音乐/酷狗/咪咕）+ iTunes
- **洛雪音源兼容** — 支持导入洛雪音乐自定义源 `.js` 脚本，通过 musicUrl 解析播放链接
- **标签系统** — 手动标签 + 智能标签（按规则自动匹配）
- **歌单管理** — 创建歌单、拖拽排序、混合本地/在线曲目
- **播放历史** — 日历视图，按日期查看播放记录
- **歌词同步** — LRC 解析 + 翻译歌词，实时滚动高亮
- **主题定制** — 4 种界面风格 × 13 种配色方案、14 张壁纸、毛玻璃卡片参数调节
- **数据备份** — JSON 导出/导入全部数据

## 技术栈

- **后端**: Python / Flask / SQLite
- **前端**: 原生 JS SPA，无框架依赖
- **音源沙箱**: iframe 隔离 + CryptoJS + Pako（兼容加密/压缩音源脚本）

## 快速开始

```bash
# 克隆
git clone git@github.com:DongLingke/LoyinMusic.git
cd LoyinMusic

# 安装依赖
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 启动
python app.py
# 访问 http://localhost:5088
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `5088` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `LOYIN_DATA` | `./data` | 数据目录（数据库 + 封面缓存） |

## 键盘快捷键

| 按键 | 功能 |
|------|------|
| `空格` | 播放 / 暂停 |
| `Cmd/Ctrl + →` | 下一首 |
| `Cmd/Ctrl + ←` | 上一首 |
| `Cmd/Ctrl + ↑` | 音量增加 |
| `Cmd/Ctrl + ↓` | 音量减少 |
| `Cmd/Ctrl + M` | 静音切换 |

## 许可

MIT
