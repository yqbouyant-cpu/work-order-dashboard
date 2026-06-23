# 工单五模块管理看板：最快公网部署指南

本指南用于把当前本地看板部署成公网可访问版本。上线后同事和领导打开同一个网址，看到同一份 Supabase 共享数据。

## 1. 当前推荐方案

- 代码托管：GitHub private 私有仓库
- 线上部署：Render Web Service
- 共享数据库：Supabase PostgreSQL
- 前端访问：Render 提供的公网网址
- 数据访问：前端只调用本项目自己的 `/api/*`，不直接连接 Supabase

不要使用 GitHub Pages。GitHub Pages 只能托管静态网页，本项目需要 `server.js` 后端 API、导入接口、共享保存接口。

## 2. 哪些文件要提交到 GitHub

建议提交：

- `index.html`
- `server.js`
- `package.json`
- `package-lock.json`
- `.gitignore`
- `.env.example`
- `src/`
- `data/`
- `db/schema.sql`
- `docs/`
- `README.md`
- `start-dashboard.cmd`

不要提交：

- `.env`
- `.env.local`
- `.data/`
- `node_modules/`
- `*.log`
- 任何真实 Supabase 密钥、飞书 token、cookie、数据库密码

项目已在 `.gitignore` 中排除这些文件。

## 3. 先创建 Supabase 数据库

1. 打开 Supabase，创建一个新项目。
2. 进入 `SQL Editor`。
3. 复制本项目的 `db/schema.sql` 全部内容。
4. 粘贴执行。
5. 确认创建了四张表：
   - `base_tickets`
   - `manual_fields`
   - `project_followups`
   - `import_logs`

这四张表分别保存基础工单、人工维护字段、项目专项跟进、导入记录。

## 4. Supabase 需要准备的环境变量

在 Supabase 项目里找到：

- `SUPABASE_URL`
  - Project Settings -> API -> Project URL
- `SUPABASE_SERVICE_ROLE_KEY`
  - Project Settings -> API -> service_role key

注意：`service_role key` 只能放在 Render 后端环境变量里，不能写进前端代码，不能提交到 GitHub。

`.env.example` 里有这些变量名，但没有真实密钥。

## 5. 上传到 GitHub

在项目目录里执行：

```powershell
git init
git add .
git commit -m "Prepare online collaborative dashboard"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

建议仓库设置为 `private`。如果还没有装 GitHub Desktop，也可以用 GitHub Desktop 选择本项目文件夹后发布 private 仓库。

## 6. Render 部署步骤

1. 打开 Render。
2. New -> Web Service。
3. 连接你的 GitHub private 仓库。
4. Runtime 选择 Node。
5. Build Command 填：

```bash
npm install
```

6. Start Command 填：

```bash
npm start
```

7. Environment Variables 添加：

```text
SUPABASE_URL=你的 Supabase Project URL
SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service_role key
ALLOWED_ORIGINS=
```

`PORT` 不需要手动填，Render 会自动提供。项目代码里已经使用 `process.env.PORT || 3000`。

8. 点击 Deploy。
9. 部署成功后，Render 会给一个公网地址，例如：

```text
https://workorder-dashboard-xxxx.onrender.com
```

把这个地址发给同事和领导即可。

## 7. 本地运行

本地开发可以继续使用：

```powershell
npm install
npm start
```

打开：

```text
http://localhost:3000
```

如果没有配置 Supabase，本地会使用 `.data/shared-store.json` 作为开发兜底。正式多人协作必须配置 Supabase。

## 8. 线上 API

部署后这些接口由 Render 同一个域名提供：

- `GET /api/tickets`
- `POST /api/import-tickets`
- `GET /api/manual-fields`
- `POST /api/manual-fields`
- `GET /api/project-followups`
- `POST /api/project-followups`
- `GET /api/import-logs`

前端只访问这些接口，不直接访问 Supabase。

## 9. 业务规则

上线后仍保持当前规则：

- 只过滤 `单据状态=已结束`
- `工单状态` 不参与过滤，只参与统计
- 每日导入只更新 `base_tickets`
- 每日导入不会覆盖 `manual_fields`
- 昨天填过的风险原因、备注、当前卡点、下一步规划、预计闭环时间、最新进展，今天重新导入后仍保留
- 多人分别导入时，按 `工单类型::工单号` 合并，A 导入不会清空 B 的数据

## 10. 多人协作验收

上线后这样验证：

1. A 打开 Render 公网网址。
2. A 在高风险工单里填写“风险原因”并保存。
3. B 打开同一个网址，刷新页面。
4. B 能看到 A 填写的“风险原因”。
5. A 进入“数据导入/刷新”，导入新工单表。
6. `单据状态=已结束` 的工单自动不显示。
7. 已经手动填写过的风险原因、备注、当前卡点、下一步规划、最新进展仍然存在。
8. 在 Supabase 的 `import_logs` 表里能看到导入记录。

## 11. 后续飞书预留

后续接飞书时也应该通过后端代理实现：

- 前端继续只调用 `/api/*`
- 飞书 app_id、app_secret、tenant_access_token、cookie 都只放后端环境变量
- 不把任何飞书密钥写进前端或 GitHub
