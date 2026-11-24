# 运行与部署

## 本地

Node.js 24 LTS（或更新版本），运行：

```sh
npm ci
npm test
npm run build
npm start
```

默认地址为 `http://127.0.0.1:2678`。可通过 `HOST`、`PORT` 修改监听位置。所有运行素材、Phaser 和截图依赖均由本站提供。

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

运行包必须包含 `dist/`、`server/`、`shared/`、`data/`、`node_modules/ws/`、package 文件、LICENSE 和 THIRD_PARTY_NOTICES.md。`data/first-world.json` 由服务端加载，不能遗漏。

`/api/lobby` 返回公开房间摘要，不返回重连令牌或私密房间码。公开房间仅在等待且有席位时可加入；快速加入会寻找空房，找不到则创建公开房间。私密房间仍通过邀请链接/房间码加入。单人房为私密且最多1人。

固定关卡数据和实现差异见 `docs/SOURCE_AUDIT.md`。服务器换关时广播新的地图版本，所有玩家使用同一阶段；奖励房允许队友分区游玩，共享金币和砖块状态。
