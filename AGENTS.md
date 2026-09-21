# 项目规则

- 上游为 nhovongoc0-max/meme-radar，保留扫描与交易禁用边界。
- 部署配置位于 deploy/；先本机验证，再 commit/push，服务器 Git 获取版本后部署。
- 密钥、认证配置、state、logs 不进仓库，不读出用户凭证。
- 修改代理必须运行 `node deploy/verify-proxy.mjs`，覆盖认证和跨站请求边界。

## 当前状态

- 2026-09-21：用户授权部署 txvps 与 meme.polymeow.com，并指定登录凭证；原始 135 项测试通过。
- 新增独立 systemd、Caddy 及反代验收，待本机检查和服务器上线；不包含 Telegram。
