# 项目规则

- 上游为 nhovongoc0-max/meme-radar，保留扫描与交易禁用边界。
- 部署配置位于 deploy/；先本机验证，再 commit/push，服务器 Git 获取版本后部署。
- 密钥、认证配置、state、logs 不进仓库，不读出用户凭证。
- 修改代理必须运行 `node deploy/verify-proxy.mjs`，覆盖认证和跨站请求边界。

## 当前状态

- 2026-09-21 21:09+08：已按用户授权部署 txvps，应用提交 `a1a502499efa583b0609f899753bf94bfe9cf9e4`，远端 `0xFlamie/meme-radar`。
- `https://meme.polymeow.com` 经 Cloudflare、Caddy 独立 Basic Auth 转发 `127.0.0.1:3791`；用户名 meme，密码不入库。专用 systemd 已 enabled/active，半核 CPU/384MiB 内存限制。
- 本机及服务器 135 项测试、发布审计、真实 Caddy 反代测试均通过；公开 HTTPS 正确登录200、无登录/错误密码401、恶意/缺失Origin写入403。DN 与 rhlit HTTP200，零重启；未配置API时服务内存约19MB，不能代表扫描峰值。
- 当前 `GMGN_AUTH_REQUIRED`，待用户在网页创建 Agent 公钥并绑定只读 GMGN API；密钥将保存在服务器 state/，不包含 Telegram。
- Caddy 初始回滚备份 `/etc/caddy/Caddyfile.before-meme-20260921`。回滚只撤销本项目 import 并停止 meme-radar；若其他站点后续更新，不得整份覆盖旧 Caddy 配置。
