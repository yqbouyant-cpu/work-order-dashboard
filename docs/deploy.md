# 工单五模块管理看板：多人协作部署说明

## 本地运行

1. 进入项目目录。
2. 运行：

```powershell
node server.js
```

3. 浏览器打开：

```text
http://localhost:3000
```

如果没有配置 Supabase，服务会自动使用服务器本地 `.data/shared-store.json` 作为临时共享存储。这个模式适合本机或局域网测试，不适合长期线上部署。

## Supabase 建表

1. 打开 Supabase 项目。
2. 进入 SQL Editor。
3. 执行项目内的 `db/schema.sql`。

会创建两张表：

- `ticket_manual_fields`
- `project_followups`

注意：前端不要直连这两张表，本项目通过后端 API 使用 service role key 读写。

## 环境变量

复制 `.env.example` 为 `.env`，填写：

```env
PORT=3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ALLOWED_ORIGINS=http://localhost:3000
```

线上部署时只在平台后台配置这些环境变量，不要写进前端代码。

## API

- `GET /api/health`
- `GET /api/manual-fields`
- `POST /api/manual-fields`
- `GET /api/project-followups`
- `POST /api/project-followups`
- `DELETE /api/project-followups/:id`

## 部署建议

推荐优先部署到 Render 或 Railway：

1. 新建 Node Web Service。
2. 根目录选择当前项目目录。
3. Start Command 填：

```text
node server.js
```

4. 配置 Supabase 环境变量。
5. 部署完成后，把平台生成的网址发给同事。

同事打开同一个网址后，填写的风险原因、备注、当前卡点、项目阶段等会保存到共享数据库。其他人刷新页面即可看到。

## 后续接飞书

后续可以在后端新增 FeishuAdapter：

- 前端仍然只调用当前 `/api/*` 接口。
- 后端从环境变量读取飞书密钥。
- 后端再调用飞书多维表格 API。

不要把 `app_id`、`app_secret`、`tenant_access_token`、cookie 写到前端。
