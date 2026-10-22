# 合租生活管家

把室友之间说好的规矩写成公约：费用 AA 分摊、清洁值日排班、公共物品登记与补货提醒、室友公约管理，都按公约自动执行。

在线版本：

- 完整版（多人共享数据、AI、服务端持久化）：https://yuhaipei.cn/hezuguanjia/
- GitHub Pages 演示版（数据只存在本机浏览器，室友不同步，无 AI）：https://hanhanrin.github.io/hezuguanjia/

## 它解决什么

- 费用说不清：金额按“分”精确计算，最大余数法取整，分摊合计严格等于总额；水电按在住人天，离家和访客按公约条款计算，每一笔都能展开算式。
- 值日不公平：按家务积分均衡排班；离家自动改派；漏做、代做的差额结转到下个周期。
- 公共物品断档：轮流补货、按采购间隔预测用完时间、提前提醒下一位采购人；大额采购先表决。
- 有话不好说：提醒只发给当事人，同一事项每天最多一次，静默时段顺延；AI 可以把话改得平和，但不匿名、不自动发送。
- 规则怎么改：发起修订先看“影响预览”——改了以后每人差多少钱、多少分；48 小时过半通过，旧账不重算。

## 功能

- 房间与邀请码、应用自带轻量身份（httpOnly Cookie，180 天会话，8 位换设备口令）
- 账单：均摊、按权重、固定金额、按在住人天；异议、修改（乐观锁）、作废、凭证图片
- 还款：我已转账 / 确认收款 / 没收到 / 撤回；余额与最少笔数结算建议
- 值日：可配置家务模板（每天 / 每 N 天 / 每周几，1–5 分）、本周日历、完成 / 补做 / 代做 / 换班、离家与访客登记
- 物品：物品清单、轮流或指定补货、采购记录、用完预测、大额采购预审
- 公约：推荐模板或自定义首版、签署、修订表决、影响预览、历史版本与动态记录
- 通知：站内通知中心、每日 08:00 幂等任务（服务端也可由外部 cron 调 `POST /api/cron/daily`，需 `CRON_SECRET`）
- AI（可关）：随口记账（含小票图片）、和气提醒、公约起草；只出草稿，不算钱、不裁判、不自动发送

## 技术栈

- 零运行时依赖的 Node 服务：Node 22 内置 `http` + `node:sqlite`（SQLite 3.51）
- React 18 + Vite 6，同一份核心规则同时供服务端和纯前端演示版使用
- 核心规则是纯函数 + 房间文档（JSON），验收用例直接对它做单元测试
- AI 走 OpenAI 兼容接口（部署里用 DeepSeek，视觉模型 deepseek-flash），密钥只在服务端

## 本地运行

需要 Node 22.13 以上（用到内置 SQLite）。

```bash
npm install
npm test                 # T1–T17 验收用例 + 服务端冒烟
npm run dev              # 前端（自动代理到 4330）
npm run dev:server       # 另开一个终端：起 API 和静态文件
# 打开 http://localhost:5173/hezuguanjia/
```

生产构建：

```bash
npm run build:server     # dist/：Node 服务端提供
npm run build:static     # dist-pages/：GitHub Pages 纯前端演示版，base=/hezuguanjia/
PORT=4330 BASE_PATH=/hezuguanjia node server/index.js
```

## 环境变量（服务端）

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `PORT` / `HOST` | 监听地址 | 4330 / 127.0.0.1 |
| `BASE_PATH` | 子路径 | `/hezuguanjia` |
| `DATA_DIR` | SQLite 数据目录 | `./data` |
| `COOKIE_SECURE` | 上 HTTPS 后设为 1 | 关 |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | OpenAI 兼容模型；不配置则 AI 关闭但其余功能正常 | 空 |
| `AI_VISION_MODEL` | 识别小票的多模态模型 | 空 |
| `AI_DISABLE_THINKING` | DeepSeek 思考模型设为 1 可关掉思考 | 关 |
| `AI_DAILY_LIMIT` / `AI_DEMO_DAILY_LIMIT` / `AI_GLOBAL_DAILY_LIMIT` | AI 每日次数 | 50 / 10 / 600 |
| `CRON_SECRET` | 配置后可 `POST /api/cron/daily` 做外部定时 | 空（应用打开时也会补算） |
| `MAX_ROOMS` / `MAX_DEMO_ROOMS` | 房间数量上限 | 300 / 300 |

## 部署

服务器（yuhaipei.cn 子路径，PM2 + nginx）：

```bash
bash deploy/push-from-mac.sh
```

脚本会在本机构建、打包零依赖生产文件，服务器只解压并启动：4330 端口、nginx 把 `/hezuguanjia/` 反代过去，主站 3000 端口的作品集不受影响；首次部署会自动复用服务器上已有的 DeepSeek 密钥。

GitHub Pages：推送到 `main` 后 Actions 自动把 `dist-pages` 发布到 `/hezuguanjia/` 子路径（见 `.github/workflows/deploy.yml`）。

## 验收

`tests/acceptance.test.js` 覆盖提示词里的 T1–T17（金额取整、在住人天、访客、结算、值日均衡、离家改派、结转、用完预测、表决门槛、静默时段等），`tests/api-smoke.mjs` 覆盖服务端会话、加入、账单、异议、乐观锁、换设备口令、AI 降级和演示房间。演示数据固定为“绿洲公寓 702”，余额与排班数字可逐项复算。

## 明确不做

不接真实支付、不做罚款 / 排行榜、不做群聊、不收集收入与手机号；不处理房东或中介、合同管理、智能电表。
