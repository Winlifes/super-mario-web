# 马里奥网页游戏

在线试玩：<https://game.winlife.fun/mario/>（阿里云 ECS）。

源码仓库：[Winlifes/super-mario-web](https://github.com/Winlifes/super-mario-web)。推送和拉取请求会自动运行测试与静态构建检查。

基于 [Super Mario Phaser](https://github.com/pablogozalvez/Super-Mario-Phaser)，保留单人随机关卡，增加第一世界 1-1～1-4、公开大厅和服务端统一计算的 2–4 人合作闯关。

## 开始游玩

在大厅快速加入公开房间，或创建公开/私密房间，把邀请链接或六位房间码发给朋友。全员完成资源加载并准备后，房主开始闯关。任一队友抵达旗杆即团队过关，随后自动进入下一关。城堡需越过酷霸王、触碰斧头并找到奇诺比奥。

电脑使用 A/D 或方向键移动、空格跳跃、S/↓蹲下或入管、Shift 奔跑、Q 发射火球；手机使用屏幕按键。联机模式每人三条命，支持检查点复活和45秒断线重连。固定关卡支持单人挑战和联机合作，包含龟壳连击、隐藏金币房、星星、绿蘑菇、升降台与城堡机关。当前是第一世界四关，后续世界尚未开放。

## 本地开发

需要 Node.js 24 LTS 或更新版本：

```sh
npm ci
npm test
npm run build
npm start
```

默认打开 `http://127.0.0.1:2678/`。公网四客户端验证命令：

```sh
node scripts/smoke-online.mjs https://game.winlife.fun/mario/
```

图片、音频、字体、游戏脚本和 Phaser 已接入阿里云 OSS `mac-cat`，页面、大厅、联机服务及样式表由 ECS 提供。开发构建默认使用本地资源，生产构建通过 `ASSET_BASE_URL` 指定 OSS 版本目录。

[部署和运行说明](docs/DEPLOYMENT.md) · [原版功能补齐计划](docs/ROADMAP.md) · [来源与差异对照](docs/SOURCE_AUDIT.md) · [上游原始说明](docs/UPSTREAM_README.md)

房间保存在进程内存中，服务器重启后需重新建房。代码和资源说明见 [第三方声明](THIRD_PARTY_NOTICES.md)；上游MIT许可证保留于 [LICENSE](LICENSE)。
