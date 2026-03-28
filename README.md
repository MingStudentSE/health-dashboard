# Health Dashboard

[English README](./README.en.md)

一个可独立运行的本地健康数据流水线项目，用来把健康导出的 JSON 数据整理成：

- 增量 SQLite 归档
- 多日健康汇总数据
- 带轻量分析的静态网页看板
- 带日志与每日反馈的本地日更页面

项目适合这样的使用场景：

`Google Drive -> JSON 归档 -> SQLite -> 网页看板`

## 使用前提

这个项目不是通用健康数据采集器。使用前，你需要先把 Apple Health 的数据稳定导出到 Google Drive。

- 使用 iPhone 或其他支持 Apple Health 的苹果设备
- 在设备上使用 Apple 自带的 `Health` App 记录或汇总健康数据
- 安装 `Health Auto Export` App
- 购买并启用 `Health Auto Export` 的高级订阅，用于本项目采用的自动化同步流程
- 在 `Health Auto Export` 中配置 Google Drive 自动同步，让健康数据持续导出为 JSON 文件

官方配置参考：

- [Health Auto Export: Sync Apple Health Data to Google Drive](https://help.healthyapps.dev/en/health-auto-export/automations/google-drive/)

本仓库默认假设你已经完成上面的配置，并且拿到了一个可以访问到导出 JSON 文件的 Google Drive 文件夹链接。

## 功能概览

- 从公开 Google Drive 文件夹中只下载新增 JSON
- 将原始 JSON 长期保存在本地 `json/`
- 只把新增或变更过的文件导入 SQLite
- 基于本地归档数据生成静态网页
- 每次同步追加一条轻量日志

## 输出产物

执行完整同步后，主要产物有：

- `data/health.sqlite`
- `web/data/health-dashboard.json`
- `web/health-dashboard-standalone.html`

如果以本地应用模式启动，还会额外使用：

- `data/daily-notes/<date>.json`
- `/api/days/:date/note`
- `/api/days/:date/feedback`

其中 `web/health-dashboard-standalone.html` 可以直接双击打开，不依赖本地服务。

## 隐私与 Git 提交

仓库默认只提交源码和目录骨架，不提交个人健康数据或本地密钥。

- `health.config.json` 不提交
- `json/` 中的原始健康导出不提交
- `data/` 中的 SQLite、同步日志、每日日志不提交
- `web/data/health-dashboard.json` 和 `web/health-dashboard-standalone.html` 不提交

这样你可以持续迭代这个开源项目，同时把自己的真实健康数据留在本地。

## 目录结构

```text
health/
├─ json/                         # 原始健康 JSON 归档
├─ data/                         # 运行期产物（默认不提交）
├─ scripts/
│  └─ public_drive_json_reader.py
├─ src/
│  ├─ archiveDriveJsonToSqlite.mjs
│  ├─ importHealthToSqlite.mjs
│  ├─ buildDashboardData.mjs
│  └─ buildStandaloneDashboard.mjs
├─ web/
│  ├─ index.html
│  ├─ styles.css
│  ├─ app.js
│  └─ data/health-dashboard.json
├─ health.config.example.json
└─ package.json
```

## 运行要求

- Node.js 18+
- Python 3
- `sqlite3`

先检查本机环境：

```bash
node --version
python3 --version
sqlite3 --version
```

## 快速开始

1. 克隆仓库

```bash
git clone <your-repo-url>
cd health
```

2. 创建本地配置文件

```bash
cp health.config.example.json health.config.json
```

3. 编辑 `health.config.json`，把 `driveFolder` 改成你自己的公开 Google Drive 文件夹链接或 folder ID

示例：

```json
{
  "driveFolder": "https://drive.google.com/drive/folders/YOUR_FOLDER_ID"
}
```

4. 运行完整流水线

```bash
npm run sync:drive
```

5. 打开生成后的网页

```text
web/health-dashboard-standalone.html
```

如果你要使用“每日专属页面 + 写日志 + 自动反馈”，请启动本地服务：

```bash
npm run start
```

或者直接双击仓库根目录下的 `run.command`。

如果你希望先自动检查 Google Drive 有没有新增导出，再决定是否同步并启动应用，可以双击 `sync-and-run.command`。

然后访问：

```text
http://127.0.0.1:3030
```

## 常用命令

执行完整增量同步：

```bash
npm run sync:drive
```

显式指定文件夹：

```bash
npm run sync:drive -- --folder "https://drive.google.com/drive/folders/..."
```

只下载最新一个 JSON：

```bash
npm run sync:drive -- --latest-only
```

同步数据但跳过网页重建：

```bash
npm run sync:drive -- --skip-dashboard
```

只执行 SQLite 增量导入：

```bash
npm run import:sqlite
```

只重建网页：

```bash
npm run build:standalone
```

启动本地应用：

```bash
npm run start
```

或运行：

```bash
./run.command
```

如果要先检查并同步新增数据，再启动本地应用：

```bash
./sync-and-run.command
```

## 增量规则

项目默认避免重复工作：

- 已存在的同名 JSON 不会重复下载，除非显式使用 `--overwrite`
- 已入库且内容哈希未变化的 JSON 不会重复导入
- 每次同步都会追加一条日志到 `data/sync-log.jsonl`

## SQLite 结构

主要表和视图：

- `imported_files`
- `metric_records`
- `daily_metric_totals`
- `daily_sleep_summary`

查询示例：

查看每日步数：

```bash
sqlite3 data/health.sqlite "
SELECT day, total_qty AS steps
FROM daily_metric_totals
WHERE metric_name = 'step_count'
ORDER BY day;
"
```

查看每日心率摘要：

```bash
sqlite3 data/health.sqlite "
SELECT day, avg_avg_value AS avg_heart_rate, max_value AS max_heart_rate
FROM daily_metric_totals
WHERE metric_name = 'heart_rate'
ORDER BY day;
"
```

查看每日睡眠摘要：

```bash
sqlite3 data/health.sqlite "
SELECT day, in_bed_hours, asleep_hours, deep_hours, rem_hours, sleep_start, sleep_end
FROM daily_sleep_summary
ORDER BY day;
"
```

## 网页看板

生成后的静态网页会基于本地数据展示：

- 最近状态分析
- 趋势图与趋势判断
- 报告日历
- 某一天的摘要弹窗入口

## 每日反馈页

除了总览页，项目现在还提供每日专属页面：

- 从总览页的报告日历进入某一天
- 查看当天的专业分析、完整指标和图表
- 给当天写一段日志
- 基于当天数据和日志生成一份反馈

日志会本地保存到：

```text
data/daily-notes/YYYY-MM-DD.json
```

## OpenAI 兼容接口

每日反馈支持接入 OpenAI 兼容的大模型接口。

在 `health.config.json` 中填写：

```json
{
  "driveFolder": "",
  "openaiCompatible": {
    "baseUrl": "https://your-api-base-url",
    "apiKey": "your-api-key",
    "model": "your-model-name"
  }
}
```

如果没有配置模型接口，系统会自动退回到本地启发式反馈，项目仍然可以完整运行。

## 注意事项

- 本项目面向个人数据归档与回顾，不是医疗诊断工具
- 网页中的分析属于启发式描述，不构成临床建议
- 若要使用内置 Google Drive 读取脚本，目标文件夹必须是公开可读的

## GitHub 发布默认约定

项目已经按公开仓库的方式收好了默认规则：

- `health.config.json` 已忽略
- `data/*.sqlite` 已忽略
- `data/sync-log.jsonl` 已忽略
- `data/daily-notes/` 已忽略

你可以自行决定是否保留 `json/` 中的样例数据用于演示。
