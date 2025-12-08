项目开发需求文档：简易图书管理系统 (Simple Book Manager)

1. 项目概述

我们需要构建一个基于 Node.js 和 Express 的简易图书管理系统。该系统需要包含完整的 CRUD（增删改查）功能，连接 MongoDB 数据库，并通过一个简单的 HTML 前端界面进行交互。
目标：创建一个可运行的、代码结构清晰的 MVP（最小可行性产品）。2. 技术栈要求

请严格使用以下技术栈：

    后端：Node.js, Express.js
    数据库：MongoDB (配合 Mongoose ORM)
    前端模板：EJS (Embedded JavaScript templates) —— 为了简化，请使用服务端渲染
    样式：简单的原生 CSS 或 Bootstrap CDN（保持界面整洁即可）

3. 数据库设计 (Schema)

请在 MongoDB 中创建一个名为 books 的集合，数据模型如下：
字段名 类型 必填 描述
title String Yes 书名
author String Yes 作者
price Number Yes 价格
createdAt Date - 创建时间 (默认当前时间) 4. 功能与路由规划

我们需要实现以下路由和功能：
页面路由 (Frontend Views)

    GET /
        首页。
        从数据库获取所有图书列表并展示。
        页面顶部应有一个“添加新书”的按钮或表单。
        每本书旁边应有“编辑”和“删除”按钮。

    GET /edit/:id
        编辑页。
        根据 ID 查询图书详情，并填充到表单中供用户修改。

业务 API (Actions)

    POST /add
        接收表单数据，将新书保存到数据库。
        成功后重定向回首页 (/)。

    POST /update/:id
        接收表单数据，更新指定 ID 的图书信息。
        成功后重定向回首页 (/)。

    POST /delete/:id
        删除指定 ID 的图书。
        成功后重定向回首页 (/)。

5. 目录结构规范

请保持项目结构整洁，建议如下：
根目录：myespress
myexpress/
├── models/
│ └── book.js # Mongoose 模型
├── views/
│ ├── index.ejs # 首页 (列表 + 添加表单)
│ └── edit.ejs # 编辑页
├── app.js # 入口文件 (配置 Express, DB 连接, 路由)
├── package.json
└── .env # 数据库连接字符串

6. 特别指令 (对于 AI Agent)

   错误处理：请添加基础的 try-catch 块，防止数据库操作失败导致服务器崩溃。
   数据库连接：代码中请使用 process.env.MONGO_URI，并提供一个默认的本地连接字符串（如 mongodb://localhost:27017/book_app）以便直接运行。
   自动化启动：开发完成后，自动安装依赖并启动服务
