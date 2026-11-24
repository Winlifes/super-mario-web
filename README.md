# 马里奥网页游戏

已部署到用户自己的阿里云 ECS：<https://game.winlife.fun/mario/>。

基于 [Super Mario Phaser](https://github.com/pablogozalvez/Super-Mario-Phaser)，保留单人随机关卡，增加服务端统一计算的 2–4 人合作闯关。

## 开始游玩

创建房间，把邀请链接或六位房间码发给朋友。全员完成资源加载并准备后，房主开始闯关。任一队友抵达旗杆即团队通关。

电脑使用 A/D 或方向键移动、空格跳跃、Shift 奔跑、Q 发射火球；手机使用屏幕按键。联机模式每人三条命，支持检查点复活和45秒断线重连。联机当前提供“合作草地”，尚未还原原版32关。

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

[部署和运行说明](docs/DEPLOYMENT.md) · [原版功能补齐计划](docs/ROADMAP.md) · [上游原始说明](docs/UPSTREAM_README.md)

房间保存在进程内存中，服务器重启后需重新建房。代码和资源说明见 [第三方声明](THIRD_PARTY_NOTICES.md)；上游MIT许可证保留于 [LICENSE](LICENSE)。
