# 源码与实现对照

目标为 NES《Super Mario Bros.》八大世界的网页合作改编；本次扩展见 [八世界和过场验收](CAMPAIGN_AUDIT.md)。复用选定的 Super Mario Phaser 工程、角色图片和音效，其随机关卡模式单独保留。固定关卡采用 FullScreenMario 的关卡重建数据，未把网页物理引擎宣称为 NES 逐帧模拟。

## 数据证据

- 原项目：pablogozalvez/Super-Mario-Phaser，6b9918d92b07d9a7ac25aa61b8878879ad1f8072。
- 地图和新增像素数据：[FullScreenMario](https://github.com/JFOC/FullScreenMario/tree/dc7db1fdea151684d78425bd1152ff680c7047d6)，固定提交 dc7db1fdea151684d78425bd1152ff680c7047d6。
- `data/first-world.json` 保留 1-1 至 1-4 原始创建命令；`data/first-world-source.json` 记录上游路径和 SHA-256。
- `scripts/import-first-world.mjs` 可从固定版本重新生成地图和像素素材。原图采用 palette/RLE 解码，无生成式重绘。
- `shared/level.mjs` 将每 8 单位转换为 16 像素，保留砖块、水管、敌人、奖励房、平台和城堡机关坐标。

## 功能对应

| 原始数据/规则位置 | 当前实现 | 验证 |
| --- | --- | --- |
| maps/1-1.js 至 1-4.js，Floor / Fill / Pipe / Tree / PlatformGenerator | 四关及其子区域；触旗自动换关，保存形态、生命、金币和分数 | 地图锚点测试、阶段保存测试、两客户端换关消息一致 |
| locations、transport、entrance | 1-1/1-2 地下金币房及原出口；1-2 地面入口和地面终点 | ↓ 入管、→ 出管与共享金币测试 |
| Koopa / jumping / smart；collideShell、moveShell | 踩龟、去翼、静止壳、踢壳、反弹、壳复苏、红龟避崖、连续击杀 | 服务端碰撞和连击测试 |
| contents Mushroom / Star / Mushroom1Up / Coin，hidden | 蘑菇/火焰花、无敌星、隐藏绿蘑菇、限时多金币砖 | 单次领取、形态受伤和无敌测试 |
| movePlatformSpawn / moveFloating / moveSliding | 垂直循环、往返升降和水平移动平台；载人由服务端计算 | 平台载人测试与同步快照 |
| CastleBlock.fireballs / EndInsideCastle / killBowser | 旋转火棒、岩浆、酷霸王跳跃与吐火、五次火球击败、斧头断桥、奇诺比奥终点 | 五次真实开火输入、断桥及终点规则测试 |
| sprites.js palette/RLE、Sounds | 酷霸王、火焰、食人花、星星、树台、桥、斧头和奇诺比奥；城堡和星星音乐 | 解码尺寸校验、浏览器载入和实际画面检查 |

## 合作改编与边界

2–4 人同局、独立生命、共享关卡变更与团队计分、检查点复活、45 秒重连、公开大厅和私密邀请是新增合作规则。单人挑战使用同一套关卡和碰撞逻辑，在浏览器本地运行。私密房间通过链接邀请且隐藏于大厅。

当前包含32关及全部源奖励区域。1-2 和4-2 的跳关出口已接到对应世界；藤蔓天空区、游泳、迷宫、完整旗杆及城堡过场、公主救援均已接入。原始32关命令保存在 `data/campaign.json`，7-2 源数据漏写出口的修正单列于 `data/campaign-corrections.json`。

行走、长短跳、火球和平台使用网页端共享的 60Hz 模拟。联机由服务端判定，客户端预测本机角色并插值显示队友。操作延迟、碰撞时间、敌人动作和过场帧数仍有网页实现与 NES 之间的差异，当前只验证了网页的控制和流程。

## 本轮修正与仍有差异的规则

- 下落时要从敌人上方接触才判定为踩踏。旗杆需要实际接触。低顶下吃到变身道具会先保留可活动的碰撞高度，有空间再站起来。循环平台重置时会放开搭乘的角色。
- 靠近水管时，尚未露头的食人花会等到下一次出管机会。蹲姿出管、死亡和复活会更新角色高度与动作状态，断线期间暂停角色交互，重连时可继续未完成的进管动作。第 100 枚团队金币发放的额外生命也能让已耗尽生命的队友复活。
- 问号方块及多金币砖每次有效顶击即时加 1 枚和 200 分，弹出的金币短暂展示后消失。场景中的金币在角色触碰时入账。[红白机玩法说明](https://www.nintendo.com/jp/famicom/software/smb1/index.html) · [原版程序的金币处理](https://6502disassembly.com/nes-smb/SuperMarioBros.html)
- 原版双人轮流操作。网页保留同局合作、共享计分、房间倒计时、检查点复活和重连。[任天堂对原版双人玩法的回顾](https://www.nintendo.com/en-gb/Iwata-Asks/Iwata-Asks-New-Super-Mario-Bros-Wii/Volume-3/3-With-His-Wife-on-His-Shoulders-/3-With-His-Wife-on-His-Shoulders--219541.html)

本轮新增 8 项针对上述碰撞和状态问题的回归测试，并重新验证了 10 个代表关卡的自然出生点按键回放。

`tests/` 中定位角色、敌人或推进关卡的代码是隔离测试夹具，不是公开游戏接口。`docs/input-route-*.json` 记录从正常出生点用按键输入运行的独立关卡回放；它们验证地形和流程可达性，不代表四名真人完成所有路线。生产 WebSocket 只接受控制输入，不接受坐标、道具或关卡完成指令。
