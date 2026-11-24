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

完整源码基于上游提交 `6b9918d92b07d9a7ac25aa61b8878879ad1f8072`。单人保留上游随机关卡；联机新增独立的统一关卡和服务端模拟。联机合作草地不是原版1-1的逐像素还原。
