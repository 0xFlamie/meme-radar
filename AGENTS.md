# 项目规则

- 上游为 nhovongoc0-max/meme-radar，保留扫描与交易禁用边界。
- 部署配置位于 deploy/；先本机验证，再 commit/push，服务器 Git 获取版本后部署。
- 密钥、认证配置、state、logs 不进仓库，不读出用户凭证。
- 修改代理必须运行 `node deploy/verify-proxy.mjs`，覆盖认证和跨站请求边界。
- 新版集成测试需要回环监听；若沙箱报 listen EPERM，使用允许本机监听的工具权限运行，不能视为应用回归。服务器源码审计在不含 state 的隔离 Git 工作树进行，避免审计工具读取生产凭证。

## 当前状态

- 2026-10-01只读核查：上游最新v0.1.12（`7ecd342`，9月30日发布），服务器仍`9c29ac8`/v0.1.8；未合并或升级。服务failed，退出码1、NRestarts6，9月24日17:37:59进入失败状态，现有journal查询无原因记录，根因未确定。
- 新版是AVE-only免费模式，移除GMGN客户端/公钥配置；全局5分钟最多一条链请求，默认禁用逐币深审和新增/回补影子样本。升级需验证现有代理及持久状态兼容，并由用户配置AVE Key；不能沿用旧版深审/实时性描述。
- 2026-09-21 21:09+08：已按用户授权部署 txvps，应用提交 `a1a502499efa583b0609f899753bf94bfe9cf9e4`，远端 `0xFlamie/meme-radar`。
- `https://meme.polymeow.com` 经 Cloudflare、Caddy 独立 Basic Auth 转发 `127.0.0.1:3791`；用户名 meme，密码不入库。专用 systemd 已 enabled/active，半核 CPU/384MiB 内存限制。
- 本机及服务器 135 项测试、发布审计、真实 Caddy 反代测试均通过；公开 HTTPS 正确登录200、无登录/错误密码401、恶意/缺失Origin写入403。DN 与 rhlit HTTP200，零重启；未配置API时服务内存约19MB，不能代表扫描峰值。
- 当前 `GMGN_AUTH_REQUIRED`，待用户在网页创建 Agent 公钥并绑定只读 GMGN API；密钥将保存在服务器 state/，不包含 Telegram。
- Caddy 初始回滚备份 `/etc/caddy/Caddyfile.before-meme-20260921`。回滚只撤销本项目 import 并停止 meme-radar；若其他站点后续更新，不得整份覆盖旧 Caddy 配置。
