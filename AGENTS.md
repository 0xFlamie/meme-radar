# 项目规则

- 上游为 nhovongoc0-max/meme-radar，保留扫描与交易禁用边界。
- 部署配置位于 deploy/；先本机验证，再 commit/push，服务器 Git 获取版本后部署。
- 密钥、认证配置、state、logs 不进仓库，不读出用户凭证。
- 修改代理必须运行 `node deploy/verify-proxy.mjs`，覆盖认证和跨站请求边界。
- 新版集成测试需要回环监听；若沙箱报 listen EPERM，使用允许本机监听的工具权限运行，不能视为应用回归。服务器源码审计在不含 state 的隔离 Git 工作树进行，避免审计工具读取生产凭证。

## 当前状态

- 2026-10-01 00:28:35+08：按用户授权升级v0.1.12，应用提交 `af5b56848acac334e18c46898f9221e17eae87f8`（合并上游7ecd342），服务器 `/opt/meme-radar`，远端 `0xFlamie/meme-radar`。
- 新版AVE-only，移除GMGN客户端/公钥配置；全局5分钟最多一条链请求，默认禁用逐币深审和新增/回补影子样本。当前 `AVE_AUTH_REQUIRED`，待用户在网页配置AVE行情Key；官方入口 `https://cloud.ave.ai/login`，无需Agent公钥。
- `https://meme.polymeow.com` 经 Cloudflare、Caddy 独立 Basic Auth 转发 `127.0.0.1:3791`；用户名 meme，密码不入库。专用 systemd 已 enabled/active，半核 CPU/384MiB 内存限制。
- 本机/服务器各449测试、源码审计、AVE配置实际Caddy反代回归通过。服务器测试依赖zip已补齐。公开HTTPS登录/版本/AVE状态及恶意、缺失Origin拒绝通过；隔离Chrome实测页面和AVE表单正常、脚本异常0。
- 00:30验收active、NRestarts0、约21MB；DN/rhlit HTTP200。用户未配置Key，尚未验证真实AVE扫描或扫描峰值；无Telegram。旧服务9/24曾exit1，历史日志已不可用，本轮重启旧版即正常，原根因未确定。
- 升级前state备份 `/var/backups/meme-radar/state-before-v0112-20261001T002832.tar.gz`（仅root），旧代码 `9c29ac8`。回滚时先停止并保留新版state，再按Git恢复旧版和备份状态，不能混用迁移后的状态；不得读取或输出凭证。隔离验证工作树 `/opt/meme-radar-verify-v0112` 保留。
- Caddy 初始回滚备份 `/etc/caddy/Caddyfile.before-meme-20260921`。回滚只撤销本项目 import 并停止 meme-radar；若其他站点后续更新，不得整份覆盖旧 Caddy 配置。
