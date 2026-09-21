# txvps 部署

入口为 `https://meme.polymeow.com`，上游仅监听 `127.0.0.1:3791`。
Caddy 校验登录及原始 Origin 后转换回环头，保留 Sec-Fetch-Site 和缺失 Origin。
GMGN、AVE 配置及 Agent 认证私钥保存在服务器 `state/`，不在访问者电脑；仅用户自行填写只读 API。

- Node：官方 `v24.21.0` Linux x64，安装目录 `/opt/node-v24.21.0-linux-x64`。
- 程序：`/opt/meme-radar`；专用用户和 systemd 服务 `meme-radar`。
- 限额：半核 CPU，384 MiB 内存，128 MiB swap。
- 密码哈希：服务器 `/etc/caddy/meme-radar-auth.caddy`，只含独立 `basic_auth` 块，不进入 Git。
- Caddy 主配置只增加本项目配置的 import，保留已有站点。

## 验证与发布

1. 本机 `npm run setup`、`npm test`、`npm run release:audit`。
2. `CADDY_BIN=/path/to/caddy node deploy/verify-proxy.mjs`；验证真实反代的认证及跨站边界。
3. 审查 diff、提交并推送远端仓库；服务器仅通过 Git 获取已提交版本。
4. 服务器安装锁定依赖、重复测试、校验 systemd 与 Caddy，再启动独立服务并 reload Caddy。
5. 检查 HTTPS、未登录 401、正确登录 200、恶意 Origin 403、服务资源和其他站点。

上游无独立 lint/type/build 命令，使用 Node 语法检查与完整测试。缺少 GMGN Key 时服务可用而扫描未就绪。
保留 `state/`；升级回滚用 Git 切回上一个已验证提交后安装锁定依赖并重启。
首次部署回滚为停止新服务、移除新增 Caddy import 后校验及 reload；不删除状态或改动其他站点。
