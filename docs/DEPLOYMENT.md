# 运行与部署

## 本地

Node.js 24 LTS（或更新版本），运行：

```sh
npm ci
npm test
npm run build
npm start
```

默认地址为 `http://127.0.0.1:2678`。可通过 `HOST`、`PORT` 修改监听位置。未设置 `ASSET_BASE_URL` 时，构建保留同域本地资源，适合开发和离线预览。

## 阿里云 ECS

- 公网入口：`https://game.winlife.fun/mario/`。
- 内部监听：`127.0.0.1:2678`；WebSocket：`/ws`，经 Caddy 的 `/mario/*` 路由转发。
- 独立系统用户与服务：`mario-web`、`mario-web.service`。
- 发行目录：`/opt/mario-web/releases/<release-id>`，`current` 指向当前发行。
- Node.js 运行时：`/opt/mario-web/runtime/bin/node`。
- 环境变量：`/etc/mario-web.env`；凭据不进入仓库或发行包。
- 每房间最多4人，全站默认最多16名连接中的玩家、8个房间。
- 新版切换脚本发现在线玩家会停止发布；启动后健康检查失败时尝试恢复旧版。

房间码不需要登录；随机重连令牌只存在当前浏览器标签页的会话存储中。断线席位保留45秒。房间和对局状态保存在服务端进程内存中，服务重启不会恢复进行中的对局。

```sh
systemctl status mario-web.service
journalctl -u mario-web.service -n 50 --no-pager
curl http://127.0.0.1:2678/api/health
bash /opt/mario-web/releases/RELEASE_ID/deploy/activate.sh RELEASE_ID
```

运行包必须包含 `dist/`、`server/`、`shared/`、`data/`、`node_modules/ws/`、package 文件、LICENSE 和 THIRD_PARTY_NOTICES.md。`data/campaign.json`、`campaign-patterns.json`、`campaign-sprites.json` 和 `campaign-corrections.json` 由服务端加载，不能遗漏。

`/api/lobby` 返回公开房间摘要，不返回重连令牌或私密房间码。公开房间仅在等待且有席位时可加入；快速加入会寻找空房，找不到则创建公开房间。私密房间仍通过邀请链接/房间码加入。网页单人连续闯关在浏览器本地运行，不创建房间；服务端保留旧客户端的私密单人房协议兼容。

固定关卡数据和实现差异见 `docs/SOURCE_AUDIT.md`。服务器换关时广播新的地图版本，所有玩家使用同一阶段；奖励房允许队友分区游玩，共享金币和砖块状态。


## OSS 资源分发

当前使用北京的 `mac-cat` bucket。图片、字体和音频从 `mario/20261124-controls-v2/` 读取，JavaScript 从 `mario/20261124-coin-v1/` 读取。HTML、两份 CSS、大厅 API 和 WebSocket 由 ECS 提供。资源仍保留在发行包中，以便回滚为本地模式。

构建与校验：

```sh
ASSET_BASE_URL=https://mac-cat.oss-cn-beijing.aliyuncs.com/mario/NEW-VERSION/ npm run build
node scripts/prepare-oss-upload.mjs
# 在 OSS 控制台 mario/ 目录中“扫描文件夹”，选择上一步输出的 NEW-VERSION 文件夹并上传。
node scripts/verify-assets.mjs dist/asset-manifest.json docs/verification-oss.json
```

只更新 JavaScript 时，保留现有 `ASSET_BASE_URL`，同时设置同一 OSS 域名下的新版 `ASSET_SCRIPT_BASE_URL`。上传脚本只收集 JavaScript，公网校验会检查两个目录中的所有活动资源。

每次更新脚本或素材时使用新的版本目录，先上传并校验，再切换 ECS 发行。AccessKey 不进入前端、构建参数或仓库。现有 bucket 的公共读和 GET/HEAD 跨域规则已满足要求，本次未改动 bucket ACL、CORS 或其他项目的对象。

`dist/asset-manifest.json` 记录资源的 URL 基址、交付位置、大小和 SHA-256。服务端从该清单读取 OSS 源并生成 CSP，只为该 HTTPS 源增加脚本、图片、音频、字体和请求权限。健康检查的 `assetBaseURL` 可用于确认当前发行。

CSS 背景图片与 Phaser XHR 纹理请求不能共用无 CORS 响应的浏览器缓存。生产 CSS 将资源 URL 转成绝对 OSS 地址并加 `mario-use=css`；Phaser 使用普通 OSS URL 和匿名 CORS。两类请求使用不同缓存键。CSS 自身由 ECS 提供，并带内容哈希查询参数。OSS 对象保留其 ETag / Last-Modified，当前未强制设置长期 Cache-Control。

验收包括全部活动对象的大小/SHA-256、脚本和 CSS MIME、跨域响应及音频 Range 请求；`tests/assets.test.mjs` 校验配置、构建引用、缓存键分离和服务端 CSP。
