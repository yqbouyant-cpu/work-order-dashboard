# GitHub Pages + Supabase 发布说明

这份项目已经可以作为“GitHub Pages 静态网页 + Supabase Free 共享数据库”的试跑版本发布。

目标访问地址类似：

```text
https://yqbouyant-cpu.github.io/work-order-dashboard/
```

## 1. 当前方案

- 前端网页：GitHub Pages 托管。
- 共享数据库：Supabase Free。
- 页面读写：前端读取 `src/config.js`，使用 Supabase URL 和 Publishable/anon key 写入 Supabase。
- 不使用 Render，不依赖 `localhost`。
- 不接飞书 API。

当前保留的业务规则：

- 只过滤 `单据状态=已结束`。
- `工单状态` 只参与统计，不参与过滤。
- 每日导入只更新 `base_tickets`。
- 每日导入不会覆盖 `manual_fields`。
- 人工填写的风险原因、备注、未结案原因、当前卡点、下一步规划、预计闭环时间、最新进展会保留。

## 2. Supabase 安全说明

可以放在前端 `src/config.js` 里的内容：

- Supabase Project URL。
- Supabase Publishable key / anon public key。

绝对不要放在前端、GitHub、截图、企业微信群里的内容：

- Supabase `service_role` key。
- 飞书 `app_secret`。
- 飞书 `tenant_access_token`。
- Cookie。
- 数据库密码。
- 客户手机号、地址等敏感真实数据。

当前是最快试跑版本，Supabase RLS 会允许 anon/publishable key 读写这几张业务表。知道网页链接的人都可以编辑数据。后续如果要做权限控制，再升级登录或后端 API。

## 3. Supabase 建表和权限

在 Supabase 项目里打开 `SQL Editor`。

第一次建表时，执行：

```text
db/schema.sql
```

如果表已经存在，或者需要开放 GitHub Pages 试跑读写权限，执行：

```text
db/github-pages-trial-rls.sql
```

执行后确认有这四张表：

- `base_tickets`
- `manual_fields`
- `project_followups`
- `import_logs`

其中 `manual_fields.ticket_key` 必须有唯一约束或唯一索引，因为页面保存使用的是：

```text
on_conflict=ticket_key
```

## 4. 配置 Supabase

打开：

```text
src/config.js
```

填写：

```js
window.WORKORDER_SUPABASE_CONFIG = {
  supabaseUrl: "https://你的项目.supabase.co",
  supabaseAnonKey: "你的 publishable / anon key",
};
```

不要填写 `service_role` key。

## 5. 应该上传到 GitHub 的文件

建议上传项目根目录下这些内容：

```text
index.html
src/
data/
db/
docs/
README.md
README_先读我.md
config.example.js
.env.example
.gitignore
package.json
package-lock.json
server.js
run-dashboard.cmd
start-dashboard.cmd
```

说明：

- `index.html`、`src/`、`data/` 是 GitHub Pages 实际打开网页需要的。
- `db/` 是 Supabase 建表和 RLS SQL。
- `docs/` 是部署说明。
- `server.js` 和两个 `.cmd` 是本地测试用，GitHub Pages 不会运行它们，但保留方便本机验证。

## 6. 不要上传到 GitHub 的文件

不要上传：

```text
.env
.env.*
.data/
node_modules/
*.log
*.zip
```

当前 `.gitignore` 已经排除了：

```text
.env
.env.*
!.env.example
.data/
node_modules/
*.log
```

如果项目目录里有 zip 包，也不要提交。

## 7. 上传 GitHub

仓库名建议：

```text
work-order-dashboard
```

如果使用 GitHub Desktop：

1. 打开 GitHub Desktop。
2. 选择 `Add local repository`。
3. 选择本项目文件夹。
4. Commit 当前文件。
5. Publish repository。

如果使用命令行：

```powershell
git init
git add .
git commit -m "Deploy work order dashboard with Supabase"
git branch -M main
git remote add origin https://github.com/yqbouyant-cpu/work-order-dashboard.git
git push -u origin main
```

## 8. 开启 GitHub Pages

在 GitHub 仓库页面：

1. 进入 `Settings`。
2. 左侧进入 `Pages`。
3. Source 选择 `Deploy from a branch`。
4. Branch 选择 `main`。
5. Folder 选择 `/root`。
6. 保存。

这里应该选择 `/root`，不是 `/docs`。

等待 1 到 3 分钟，生成的地址一般是：

```text
https://yqbouyant-cpu.github.io/work-order-dashboard/
```

如果仓库名不同，最后一段也会不同。

## 9. GitHub Pages 路径检查

当前 `index.html` 使用相对路径：

```html
./src/styles.css
./src/config.js
./data/embedded-data.js
./src/import-parser.js
./src/storage.js
./src/app.js
```

这种写法适合 GitHub Pages 子路径，例如：

```text
https://yqbouyant-cpu.github.io/work-order-dashboard/
```

发布后可以打开下面地址确认配置是否加载成功：

```text
https://yqbouyant-cpu.github.io/work-order-dashboard/src/config.js
```

能看到 Supabase URL 和 Publishable key，就说明 GitHub Pages 读到了配置。

## 10. 多人协作验证

上线后这样验收：

1. A 打开 GitHub Pages 链接。
2. A 在高风险工单明细里填写 `未结案原因 / 当前卡点 / 下一步规划 / 最新进展`。
3. 页面显示 `已保存`。
4. 打开 Supabase 的 `manual_fields` 表，确认有新增记录。
5. B 打开同一个 GitHub Pages 链接，或刷新页面。
6. B 能看到 A 刚填写的内容。
7. A 进入 `数据导入/刷新`，导入新的 Excel 或 CSV。
8. `单据状态=已结束` 的工单不再展示。
9. 已经手动维护过的 `manual_fields` 内容仍然保留。

## 11. 常见问题

### 页面可以打开，但保存失败

先执行：

```text
db/github-pages-trial-rls.sql
```

再刷新页面重试。

### 页面提示 Supabase 未连接

检查：

- `src/config.js` 是否已经上传到 GitHub。
- GitHub Pages 上的 `/src/config.js` 是否能打开。
- `supabaseUrl` 是否是 `https://xxxxx.supabase.co`。
- `supabaseAnonKey` 是否是 Publishable/anon key，不是 service_role key。

### 保存成功，但同事看不到

让同事刷新页面，或点击页面里的 `刷新协作数据`。

### 不想让陌生人编辑

当前是免费试跑版，先跑通多人共享。正式使用前建议加登录权限，或改成后端 API 代理写 Supabase。
