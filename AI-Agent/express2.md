项目开发需求文档 (PRD): DevLog Pro - 开发者知识管理平台
1. 项目概述

项目名称：DevLog Pro
项目目标：构建一个基于 Web 的个人知识库与技术博客系统，允许用户注册、登录，并使用 Markdown 格式撰写、管理和分享技术文章。
开发模式：全栈开发 (Frontend + Backend + Database)。
2. 技术栈要求

    前端：
        框架：React (18+)
        构建工具：Vite
        路由：React Router v6
        UI 组件库：Ant Design (v5) 或 Tailwind CSS (任选其一)
        HTTP 客户端：Axios
        Markdown 渲染：react-markdown
    后端：
        运行时：Node.js
        Web 框架：Express.js
        身份验证：jsonwebtoken (JWT)
    数据库：
        数据库：MongoDB
        ORM：Mongoose

3. 目录结构规范

AI Agent 需要遵循以下基本项目结构：

text
      

devlog-pro/
├── client/                 # 前端 React 项目
│   ├── src/
│   │   ├── components/     # 公共组件 (Header, AuthGuard等)
│   │   ├── pages/          # 页面组件 (Login, Dashboard, Editor)
│   │   ├── context/        # 全局状态 (AuthContext)
│   │   ├── services/       # API 接口封装
│   │   └── App.jsx
├── server/                 # 后端 Node 项目
│   ├── config/             # 数据库连接配置
│   ├── controllers/        # 业务逻辑控制器
│   ├── middleware/         # 中间件 (authMiddleware, errorMiddleware)
│   ├── models/             # Mongoose 模型 Schema
│   ├── routes/             # 路由定义
│   └── index.js            # 入口文件
└── README.md

4. 数据库设计 (MongoDB Schema)
4.1 Users (用户集合)
字段名 	类型 	描述 	验证规则
username 	String 	用户名 	唯一，必填
email 	String 	邮箱 	唯一，必填
password 	String 	密码 	必填 (存 Hash 值)
createdAt 	Date 	创建时间 	默认当前时间
4.2 Posts (文章集合)
字段名 	类型 	描述 	验证规则
title 	String 	文章标题 	必填
content 	String 	Markdown 内容 	必填
author 	ObjectId 	关联 User 	ref: 'User'
tags 	[String] 	标签数组 	例如 ["React", "Node"]
isPublished 	Boolean 	是否发布 	默认为 false (草稿)
updatedAt 	Date 	更新时间 	自动更新
5. API 接口规范 (RESTful)
5.1 认证模块 (/api/auth)

    POST /register: 用户注册。接收 {username, email, password}。
    POST /login: 用户登录。接收 {email, password}。返回 { token, user }。

5.2 文章模块 (/api/posts)

    GET /: 获取文章列表。
        支持查询参数：?page=1&limit=10 (分页)。
        支持查询参数：?tag=React (按标签筛选)。
        注意：未登录用户只能看到 isPublished: true 的文章；登录用户可以看到自己的所有文章。
    GET /:id: 获取单篇文章详情。
    POST /: 创建新文章 (需要 Auth Token)。
    PUT /:id: 更新文章 (需要 Auth Token，且必须是作者)。
    DELETE /:id: 删除文章 (需要 Auth Token，且必须是作者)。

6. 前端功能需求
6.1 页面规划

    登录/注册页：
        表单验证。
        登录成功后将 Token 存储在 localStorage，并跳转至首页。
    首页 (文章列表)：
        展示文章卡片（标题、摘要、标签、作者）。
        提供“只看我的文章”切换开关（仅登录可见）。
        标签筛选栏。
    文章编辑器 (核心功能)：
        左右分栏布局：左侧为 Markdown 输入框，右侧为实时预览区域。
        输入框需支持基本的 Markdown 语法高亮（可选）。
        底部有“保存草稿”和“发布”按钮。
    文章详情页：
        渲染后的 Markdown 内容展示。
        如果是作者本人，显示“编辑”和“删除”按钮。

6.2 状态管理

    使用 React Context API 管理用户信息 (user) 和登录状态 (isAuthenticated)。
    实现一个 PrivateRoute 组件，拦截未登录用户访问编辑器页面。

7. 开发流程指令 (Prompt for Agent)

请 AI Agent 按照以下步骤执行开发任务：

    环境搭建：初始化 server 和 client 目录，安装必要的依赖（如 express, mongoose, cors, dotenv, bcryptjs 等后端库；react-router-dom, axios, antd, react-markdown 等前端库）。
    后端开发：
        连接 MongoDB。
        定义 Schema。
        实现注册/登录逻辑（含 JWT 签发）。
        实现 CRUD 接口，重点测试分页和权限验证中间件。
    前端开发：
        配置路由和 Axios 拦截器（自动在 Header 中携带 Token）。
        完成 Auth Context。
        开发 Markdown 编辑器组件。
        完成列表页与详情页的数据对接。
    联调与优化：
        确保前后端运行在不同端口（如 3000 和 5000），并处理好跨域 (CORS) 问题。
  全部开发完成后，自动安装对应依赖，并且运行命令启动服务器与前端应用。
  最后在根目录下给出一个文档说明如何手动启动项目。
