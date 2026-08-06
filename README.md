# 机器人工程保研信息看板

一个面向机器人工程本科生的纯静态信息看板，用于整理和展示 985 高校在机器人、控制、自动化、机械、人工智能、计算机、电子信息、仪器、无人系统等方向发布的夏令营与预推免通知。

项目不使用服务器、数据库或付费服务。页面直接读取 `data/notices.json`，可从 GitHub Pages 长期公开访问。当前数据文件有意保持为空；收到并核验具体官方通知后再添加记录，避免用示例数据冒充真实信息。

## 功能

- 按学校和学院名称搜索
- 按夏令营、预推免以及报名状态筛选
- 按截止日期、机器人工程匹配度或发布时间排序
- 根据访问当天自动识别“报名中”“即将截止”和“已截止”
- 展示数据最后核验日期，并在新标签页打开官方通知
- 适配电脑和手机，零构建步骤、零运行时依赖

## 文件结构

```text
.
├── index.html              # 页面结构
├── styles.css              # 响应式样式
├── app.js                  # 数据加载、状态计算和交互
├── README.md               # 使用与部署说明
├── AGENTS.md               # 长期数据维护规则
├── data/
│   └── notices.json        # 已核验通知数据
└── scripts/
    └── check_links.py      # 数据格式与官方链接检查
```

## 本地查看

浏览器直接打开 `index.html` 时可能因安全策略无法读取 JSON，因此应在项目根目录启动一个本地静态服务器：

```bash
python -m http.server 8000
```

然后访问 [http://localhost:8000](http://localhost:8000)。停止服务器可按 `Ctrl+C`。

## 检查数据和链接

在项目根目录运行：

```bash
python scripts/check_links.py
```

脚本会检查必填字段、日期、标题年份、重复记录、状态是否与当前日期一致、链接是否指向具体的高校官方页面，并尝试访问官方链接。仅做离线格式检查时可运行：

```bash
python scripts/check_links.py --skip-network
```

详细收录标准和更新步骤见 [AGENTS.md](AGENTS.md)。

## 发布到 GitHub Pages

1. 在 GitHub 新建一个公开仓库，例如 `robotics-promotion-tracker`。
2. 将本目录内容提交并推送到仓库的 `main` 分支根目录。
3. 打开仓库的 **Settings → Pages**。
4. 在 **Build and deployment** 中选择 **Deploy from a branch**。
5. 分支选择 `main`，目录选择 `/ (root)`，点击 **Save**。
6. 等待 GitHub 完成发布。长期网址通常是：

   `https://<你的GitHub用户名>.github.io/robotics-promotion-tracker/`

本项目使用相对路径读取资源，不需要修改代码，也不需要 GitHub Actions。以后只要把更新推送到 `main`，GitHub Pages 会自动刷新。

## 后续让 Codex 更新通知

把需要整理的官方通知链接或通知正文发给 Codex，并明确要求它遵守本项目的 `AGENTS.md`。可直接使用下面的请求：

> 请核验这些高校通知，并按 AGENTS.md 的规则更新 data/notices.json。只收录 2026 年发布、面向 2027 级推免且机器人工程本科生可以合理申请的通知。完成后运行 python scripts/check_links.py，并说明新增、跳过和待核验的记录。

Codex 应先打开具体官方通知正文，核对发布时间、申请方向、申请资格和截止时间，再更新数据；不能仅凭搜索摘要、学院首页或第三方转载录入。

## 数据说明

`data/notices.json` 顶层是数组。每条记录必须完整包含以下字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 稳定且唯一的记录标识 |
| `university` | 高校名称 |
| `college` | 发布通知的学院或单位 |
| `category` | `夏令营` 或 `预推免` |
| `admissionYear` | 招生年份，本项目为 `2027` |
| `title` | 官方通知标题 |
| `directions` | 适合申请的相关方向数组 |
| `roboticsEligibility` | 机器人工程本科生可申请的正文依据或审慎判断 |
| `matchLevel` | `高`、`中` 或 `低` |
| `publishDate` | 官方发布日期，格式 `YYYY-MM-DD` |
| `deadline` | 报名截止日期；未公布时为空字符串 |
| `status` | 当前状态；维护规则见 `AGENTS.md` |
| `officialUrl` | 具体官方通知原始链接 |
| `lastVerified` | 最近一次人工核验日期，格式 `YYYY-MM-DD` |
| `notes` | 补充说明；没有时使用空字符串 |

## 免责声明

本项目仅整理公开申请信息，不替代高校官方通知。专业范围、申请条件和时间安排可能发生变化，提交申请前务必再次阅读原始通知正文。
