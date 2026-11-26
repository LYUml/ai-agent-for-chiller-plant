# 冷站 WhatsApp 测试群 Demo
Node.js 24+，SQLite 模拟策略记录、控制回执和设备点位。资料在 docs/reference，流程图在 docs/design。src/plant.js 管理对话与模拟设备；src/whatsapp.js 对接群聊。首版使用明确短语和引用解析，不需要模型密钥。

## 本地回放
运行 npm ci、npm test 和 npm run demo。回放使用内存数据库，不连接 WhatsApp。

## 测试群
1. npm start，使用专用测试账号在 WhatsApp 的关联设备中扫码。默认只在终端列出可见群和 ID。
2. 设置 TEST_GROUP_ID 后重启，让工程师在测试群发一条普通消息。从终端取得发送人 ID。无需授权操作员即可发现 ID。
3. 重新启动，例如：
```sh
TEST_GROUP_ID='实际群ID@g.us' OPERATOR_IDS='实际发送人ID' npm start
```
多位操作员用逗号分隔。从另一账号发测试消息。macOS 默认尝试系统 Chrome，其他环境可设置 CHROME_PATH 为 Chrome 可执行文件路径。
4. 程序终端输入 strategy，向指定群推送模拟建议。在群内引用建议回复「为什么」「暂缓」「拒绝」「改成 3 号机」或「确认」。也可输入「确认 Sxxxxxxxx」，以真实编号替换。另可独立发送「启动 2 号机」「停止 3 号机」「查询 2 号机」「报告」。仅支持 2、3 号模拟冷机。
5. 重启保留会话和模拟记录。断线需重启，尚未实现离线消息补拉或发送失败补偿。设备读数随模拟命令同步更新。报告为当前快照与命令计数。

## 上游参考
WhatsApp 接入直接使用 [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) 的 Client、LocalAuth、二维码登录和消息事件。审批流程借鉴 [LangGraph 人工审核示例](https://docs.langchain.com/oss/python/langgraph/interrupts)，此版由 SQLite 保存操作状态。真实控制、InfluxDB 与开放式语言理解属于后续对接。
