# txvps 部署

入口为 `https://meme.polymeow.com`，上游仅监听 `127.0.0.1:3791`。
Caddy 校验登录及原始 Origin 后转换回环头，保留 Sec-Fetch-Site 和缺失 Origin。
v0.1.12 仅使用 AVE 行情 API；配置保存在服务器 `state/`，不在访问者电脑，由用户自行填写。
旧 GMGN 配置原样留存但新版不加载；无需 Agent 公钥，不连接钱包或下单。

- Node：官方 `v24.21.0` Linux x64，安装目录 `/opt/node-v24.21.0-linux-x64`。
- 程序：`/opt/meme-radar`；专用用户和 systemd 服务 `meme-radar`。
- 限额：半核 CPU，384 MiB 内存，128 MiB swap。
- 密码哈希：服务器 `/etc/caddy/meme-radar-auth.caddy`，只含独立 `basic_auth` 块，不进入 Git。
- Caddy 主配置只增加本项目配置的 import，保留已有站点。

## 验证与发布

1. 本机 `npm run setup`、`npm test`，调用 `scripts/release-audit.mjs` 导出的 `auditSourceTree()` 审计源码；findings 必须为空。本项目不发布桌面 ZIP，因此不执行要求双平台资产的完整 release:audit CLI。
2. `CADDY_BIN=/path/to/caddy node deploy/verify-proxy.mjs`；验证真实反代的认证及跨站边界。
3. 审查 diff、提交并推送远端仓库；服务器仅通过 Git 获取已提交版本。
4. 服务器在无用户状态的独立 Git 工作树重复测试与源码审计；停服务后将旧 state 备份至仅 root 可访问的服务器目录，再快进正式 Git 目录。新版无第三方运行依赖，现有 node_modules 不参与运行。
5. 校验 systemd 与 Caddy，再启动独立服务；仅代理配置改变时 reload Caddy。
6. 检查 HTTPS、未登录 401、正确登录 200、恶意 Origin 403、AVE 配置入口、服务资源和其他站点。

上游无独立 lint/type/build 命令，使用 Node 语法检查与完整测试。缺少 AVE Key 时服务可用而扫描未就绪。
保留 `state/`；升级回滚用 Git 切回上一个已验证提交后安装锁定依赖并重启。
首次部署回滚为停止新服务、移除新增 Caddy import 后校验及 reload；不删除状态或改动其他站点。
