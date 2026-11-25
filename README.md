# 马里奥网页游戏

在线试玩：<https://game.winlife.fun/mario/>（阿里云 ECS）。

源码仓库：[Winlifes/super-mario-web](https://github.com/Winlifes/super-mario-web)。推送和拉取请求会自动运行测试与静态构建检查。

基于 [Super Mario Phaser](https://github.com/pablogozalvez/Super-Mario-Phaser)，保留单人随机关卡，增加八大世界 1-1～8-4 共32关、本地单人连续闯关、公开大厅和 2–4 人合作闯关。

## 开始游玩

在大厅快速加入公开房间，或创建公开/私密房间，把邀请链接或六位房间码发给朋友。全员完成资源加载并准备后，房主开始闯关。任一队友抵达旗杆即团队过关，经历滑旗、进城、余时转分、烟花和升旗后进入下一关。城堡触斧后逐段断桥，角色自动走向奇诺比奥；8-4 迎来公主救援和最终对话。

电脑使用 A/D 或方向键移动、空格跳跃、S/↓蹲下或入管、Shift 奔跑、Q 发射火球；手机使用屏幕按键。水下反复按跳跃游泳，藤蔓处按 ↑ / 跳跃向上爬。联机模式每人三条命，支持检查点复活和45秒断线重连。包含全部源奖励区域、原位置跳关水管、天平、下落平台、弹簧、新敌人及城堡迷宫。支持从32关中任意一关开始，通关后可按 B 返回选择世界。

单人连续闯关以60Hz在浏览器本地计算，资源加载完成后，游戏过程不依赖服务器往返；P / Esc 或右上角按钮暂停，切到后台自动暂停。合作模式使用同一套运动代码进行本机预测，服务器每秒20次校准位置，敌人、道具、伤害与过关仍由服务器判定。起步、松键减速、反向刹车和奔跑动画依据固定版本 FullScreenMario 源码校准；当前没有 NES ROM 逐帧对照，不能视为原机手感完全一致。详见[操作手感验收](docs/CONTROLS_AUDIT.md)。

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

[部署和运行说明](docs/DEPLOYMENT.md) · [原版功能补齐计划](docs/ROADMAP.md) · [来源与差异对照](docs/SOURCE_AUDIT.md) · [八世界和过场验收](docs/CAMPAIGN_AUDIT.md) · [上游原始说明](docs/UPSTREAM_README.md)

房间保存在进程内存中，服务器重启后需重新建房。代码和资源说明见 [第三方声明](THIRD_PARTY_NOTICES.md)；上游MIT许可证保留于 [LICENSE](LICENSE)。
