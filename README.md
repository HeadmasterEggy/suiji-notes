# 随记

可以安装到手机主屏幕的笔记 App（PWA）。iPhone 和 Mac 登录同一个账号后会自动同步。

- 前端：纯 HTML/JS，不需要框架（`public/`）
- 同步：Supabase（Postgres 加 Realtime），行级安全保证每个人只能看到自己的笔记
- 离线：改动先存在本机，联网后自动上传；冲突时以最后修改的为准
- 部署：Vercel

## 部署

```bash
npx vercel link --yes --project suiji-notes
npx vercel integration add supabase --yes --no-claim
npx vercel env pull .env.local --yes
npm install
npm run db:setup
npx vercel deploy --prod
```

## Mac 文件夹自动同步

选中的文件夹（包括子文件夹）会自动上传到随记的「文件」里。新增和修改的文件会上传，本地删除的文件云端也会删除。隐藏文件和 node_modules、.git 会跳过，单个文件最大 50 MB。

```bash
npm run sync login       # 登录随记账号
npm run sync add         # 弹出窗口选文件夹，立即上传
npm run sync install     # 设为登录 Mac 后自动在后台运行
npm run sync status      # 查看状态
npm run sync remove ~/某个文件夹   # 停止同步（云端文件保留）
npm run sync uninstall   # 取消后台运行
```

配置和日志在 `~/.suiji/`（日志：`~/.suiji/sync.log`）。

## 安装到手机

- iPhone：用 Safari 打开部署地址，点分享按钮，再点「添加到主屏幕」。
- Mac：用 Safari 打开，菜单「文件 → 添加到程序坞」；用 Chrome 的话点地址栏里的安装图标。
