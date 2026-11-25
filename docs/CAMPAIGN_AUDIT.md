# 八世界与过场对照

目标：在现有 Phaser 网页合作移植上接入《Super Mario Bros.》1-1～8-4 的源关卡及完整关卡过场。源版本仍固定为 FullScreenMario `dc7db1fdea151684d78425bd1152ff680c7047d6`，不是 ROM 模拟器。

| 范围 | 源函数、数据与调用链 | 工程位置 | 本批核对 |
| --- | --- | --- | --- |
| 32 关及分区 | `settings/maps/1-1.js`～`8-4.js`；locations / entrance / transport / exit | `data/campaign.json`、`shared/level.mjs` | 保留所有原命令和来源哈希；转换器拒绝未知玩法命令 |
| 天空、游泳、藤蔓 | `mapEntranceVine` → `movePlayerVine`；Underwater、gravity / 2.8；Vine block contents | `shared/level.mjs`、`server/world.mjs`、`javascript/multiplayer.js` | 出入口、按键、浮力、奖励区域回程 |
| 迷宫 | `activateSectionBefore/Stretch/After`、`SectionPass/Fail/Decider` | `shared/level.mjs`、`server/world.mjs` | 4-4、7-4 高度路线与失败重走；8-4 错管返回和水下出口 |
| 新敌人、平台 | objects.js、`moveBlooper`、`moveCheepCheep`、`spawnHammerBro`、`spawnCannon`、`movePlatformScale` | `server/world.mjs`、`assets/campaign/` | 水下敌人、飞鱼、炮弹、锤子、刺龟、天平、弹簧 |
| 旗杆与城堡 | scenes.js Flagpole；`cutsceneFlagpoleStartSlidingDown/HitBottom/Countdown/Fireworks`；`numberOfFireworks`、`scorePlayerFlag` | `server/world.mjs`、`javascript/multiplayer.js` | 滑旗、翻身、自动入城、逐时转分、尾数 1/3/6 烟花、升旗、换关 |
| 断桥与救援 | BowserVictory；`cutsceneBowserVictoryCastleBridgeOpen/BowserFalls/Dialog`；`macroEndInsideCastle` | 同上 | 桥从右逐段消失、落下、自动走向 NPC、分行对话、世界推进、8-4 Peach 结局 |
| 素材和声音 | settings/sprites.js 的 palette/RLE；Sounds/Themes 与 Sounds/Sounds | `scripts/import-campaign.mjs`、`data/campaign-source.json` | 源像素解码、动画帧尺寸、音频事件 |

合作规则延续现有独立生命、全队共享关卡和计分。任一玩家触发过场时由服务端统一冻结关卡并广播时间线，分区队友跟随当前过场，避免独立计时、重复奖励或分歧。跳关为全队跳转。关卡几何及路线按原命令转换；服务端 60Hz 浮点物理和网络插值继续属于网页移植差异，不能据此声称 NES 逐帧完全一致。

32关和全部传送图、全部关卡过场推进的隔离检查通过。10个代表关卡从正常出生点、初始3条命出发，只使用移动/跳跃/下蹲按键，均未损命，含4-4、7-4、8-4；保存于 `input-route-*.json`，可用 `node scripts/verify-campaign.mjs` 重放。8-4完整走过五个区域并触发公主结局。输入搜索仅分支复制模拟以选择按键，最终回放从全新世界运行，不写坐标、生命、道具或完成状态。

源数据修正：7-2 水下终点横管漏写 `transport`。该关定义了地面入口2，且同布局的2-2终点横管使用目标2，故在 `campaign-corrections.json` 显式补为2，原始导入文件不改写。迷宫的 stretch 使用320px游戏坐标视口，before/after保留原坐标与分支。

源公式核对：`math.decreasePlayerJumpingYvel` 按2px单位换算，奔跑上限162px/s。源水面为 Scenery，不能当作顶部即死的实体；移动平台贴水面时继续承载，沉入水/岩浆或掉出关卡才死亡。水平加速、接触判定、独立生命与检查点、计时单位和网络插值仍是网页改编差异。

浏览器已在本地真实60Hz回放中走到8-4公主结局，核对水下机关、最终对话、结局布局及B返回选世界。公网 Safari 确认32关入口、208个OSS资源加载、8-4出生和键盘移动；公网4个WebSocket客户端确认8-4同地图、同快照、移动、人数上限和重连。39项测试通过，原生控制台显示208/208上传成功。发布为 `20261124-campaign-v3`，详情见 `verification-campaign-2026-11-24.json` 和 `verification-oss-campaign-2026-11-24.json`。

夹具验证不冒充自然通关，10关代表回放不宣称32关逐一人工通关。原版ROM逐帧画面与声音对比尚未进行。
