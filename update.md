## need to do 

生产部署不可用
当前 build 通过但 production serve 失败，不能上架。先修 Next 产物问题，并把 typecheck + lint + build + next start smoke test 放进 CI。



数据层不能公开使用
现在所有项目读写同一个本地 JSON 文件：projects-store.ts (line 10)。这适合 demo，不适合独立站：没有用户隔离、并发写保护、备份、迁移、权限。建议换 Supabase/Postgres 或类似托管数据库，并加 userId/project ownership。



没有鉴权和滥用防护
/api/projects 直接读写全部项目：route.ts (line 14)。创建节点会直接调用 DeepSeek：nodes/route.ts (line 53)。公开后任何人都能刷你的 API 成本。需要登录、rate limit、输入长度限制、每日额度、失败重试、超时、敏感错误脱敏。


核心差异化还没完整落地
PRD 里的“选中某段文本然后 Branch Right”还没有真正做成用户体验；API 有 sourceText，但 UI 没有文本选择到分支的稳定流程。这个功能是 BranchMind 区分普通聊天的关键，应优先补。



缺少上架必需的信任与合规
需要 Privacy Policy、Terms、数据删除、导出、账号注销。你的产品会保存用户学习/研究 prompt，这不是可选项。

首页：
放上你可以外包思考，但是无法外包理解。


## 5.7
取消prompt done
适配不同尺寸的ui
右侧边栏添加笔记，可编辑   done
接入数据库，添加注册、登录界面.
更改主页page
添加付费功能

## 5.9
让ai学会调用工具，阅读给的链接以后输出大纲
学会阅读pdf，提取大纲
