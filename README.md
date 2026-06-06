# 落音 LoyinMusic

Web 音乐播放器，支持本地音乐库管理和在线音源播放。部署在服务器上，通过浏览器远程访问。

与 [日迹 DayNote](https://github.com/DongLingke/DayNote) 同属一个系列，共享相同的视觉设计语言。

## 功能

**播放**
- 本地音乐扫描 + 在线 5 大平台搜索（酷我/网易云/QQ音乐/酷狗/咪咕/iTunes）
- 洛雪音源兼容（iframe 沙箱 + CryptoJS/Pako）
- 音质自动降级（flac → 320k → 128k）
- 倍速播放（0.5x ~ 2x）、交叉淡入淡出
- 歌词同步 + 翻译歌词、音频频谱可视化
- 随机/循环/队列、断点续播、MediaSession

**管理**
- 标签系统（手动 + 智能规则）、❤️ 一键喜欢
- 歌单（拖拽排序、导入/导出 m3u）
- 播放历史日历、听歌统计（Top 艺人/曲目、30 天趋势）
- 重复曲目检测、全局搜索（Cmd+K）

**外观**
- 4 风格 × 13 配色、14 张壁纸 + 自定义 URL
- 毛玻璃卡片参数调节（模糊/透明度/饱和度/圆角等）
- 6 种字体、深色/浅色主题

**部署**
- Docker 一键部署、nginx 反向代理配置模板
- 密码保护（LOYIN_TOKEN）、PWA 支持

## 快速开始

```bash
git clone git@github.com:DongLingke/LoyinMusic.git
cd LoyinMusic
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py
# → http://localhost:5088
```

### Docker 部署

```bash
docker compose up -d
# 或者单独构建：
docker build -t loyin . && docker run -d -p 5088:5088 -v loyin_data:/app/data loyin
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `5088` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `LOYIN_DATA` | `./data` | 数据目录 |
| `LOYIN_TOKEN` | *(空)* | 设置后启用密码保护 |

### nginx 反向代理

参考 `deploy/nginx.conf`，修改域名后软链到 `/etc/nginx/sites-enabled/`。

## 键盘快捷键

| 按键 | 功能 |
|------|------|
| `空格` | 播放 / 暂停 |
| `Cmd/Ctrl + K` | 全局搜索 |
| `Cmd/Ctrl + →` | 下一首 |
| `Cmd/Ctrl + ←` | 上一首 |
| `Cmd/Ctrl + ↑/↓` | 音量增减 |
| `Cmd/Ctrl + M` | 静音切换 |

## 移动端

- 播放栏左右滑动切歌
- PWA 支持，可添加到主屏幕

## 技术栈

- **后端**: Python / Flask / SQLite（WAL）
- **前端**: 原生 JS SPA，零框架依赖
- **音源沙箱**: iframe 隔离 + CryptoJS + Pako
- **API**: 47 个 RESTful 端点，前后端分离

## 许可

MIT
