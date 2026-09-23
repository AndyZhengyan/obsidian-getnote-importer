# springrain1/get-to-obsidian 对标分析与竞争规划

> 对比日期：2026-09-23  
> 调研对象：
> - **我方** `AndyZhengyan/obsidian-getnote-importer` / Dedao Brain Sync v1.6.2
> - **对方** `springrain1/get-to-obsidian` v4.0.1
> - **补充信息**：对方插件 UI 已确认存在独立的 **Plus 功能授权**，采用“设备序列号 + 注册码”方式激活

---

## 0. TL;DR

这次结论和 2026-06-11 的旧版已经有明显变化。

1. **我方已经补齐旧文档里很多“待做能力”**：语义 Recall、搜索 UI、选中文字搜索、知识库同步、全部订阅知识库、订阅博主、附件分类、配额熔断、同步历史、Web 自动登录与 Token 静默续期等都已经落地。
2. **对方也从“Playwright + ZIP 导入器”明显演进成“OpenAPI + Web 私有 API + 商业 Plus”**。尤其 v3.9 / v4.0 之后，Web 私有 API 已经成为重要同步通道。
3. 对方当前真正有竞争力、且被拿来收费的核心不是“拉取”，而是：
   - **非 PRO 用户的 Web 批量 Push**
   - **Web Update / Force Update**
   - **Markdown → Get 富文本渲染**
   - **本地图片上传**
4. 我方目前更强的方向是：
   - Web Token 静默续期
   - 持续增量同步
   - 同步范围控制
   - 知识库 / 订阅博主
   - Recall 搜索
   - 同步历史
   - 附件体系
   - 测试与源码透明度
5. **下一阶段不需要全面追竞品功能。P0 应直接补齐：**
   - Web Update
   - Rich Markdown Renderer
   - Local Image Upload
6. Canvas / Moments、远端删除、三栏冲突合并等可以继续观察，但不应排在上述三项之前。

一句话总结：

> **不要全面追 springrain；优先打掉其 Plus 的核心付费差异点，同时继续强化我方“长期稳定同步基础设施”的定位。**

---

## 1. 先澄清：Free / Plus / 得到 PRO 是三层不同东西

这是旧版对标里完全缺失的一层。

### 1.1 springrain Free

公开免费能力主要覆盖：

- Web / ZIP / OpenAPI 等多通道拉取
- 个人笔记同步
- Web 增量拉取
- 单篇 Push
- 自动同步
- 附件导入
- Canvas / Moments
- 基础可视化
- 一部分 Web 私有 API 能力

### 1.2 springrain Plus

从插件“授权”页已经确认，Plus 是**插件作者自己的商业授权**，不是得到大脑 PRO。

已明确写出的 Plus 能力包括：

- 非 PRO 用户通过 **Web 私有 API 批量推送**
- 内置高级 Markdown 渲染器
- 支持图片、标签、代码块、数学公式等 Obsidian 格式高保真推送
- 支持修改后的二次推送
- 设备序列号 + 注册码激活
- 存在试用机制

这意味着 springrain 的商业定位本质上是：

> **用 Plus 为非 PRO 用户提供一部分接近 OpenAPI 双向写回的能力。**

### 1.3 得到大脑 PRO

PRO 是得到大脑官方会员层，对方插件通过 OpenAPI 使用：

- 更完整的双向同步
- 知识库 / 订阅内容
- 语义 Recall
- 配额
- 远端删除
- 父子关系
- 冲突合并等能力

因此不能再把“PRO”和“Plus”混在一起。

---

## 2. 竞争矩阵：最新状态

> 说明：下面更关注**用户实际可感知能力**，而不是仅比较代码模块。

| 能力 | springrain Free | springrain Plus | springrain + 得到 PRO | 我方 v1.6.2 |
|---|---|---|---|---|
| 个人笔记拉取 | ✅ Web / ZIP | ✅ | ✅ OpenAPI | ✅ Web + OpenAPI |
| 真增量拉取 | ✅ Web 游标 | ✅ | ✅ | ✅ |
| 启动自动同步 | ✅ | ✅ | ✅ | ✅ |
| 定时自动同步 | ✅ | ✅ | ✅ | ✅ |
| Web 登录 | ✅ | ✅ | — | ✅ |
| Web Token 自动续期 | 未见明确证据 | 未见明确证据 | — | **✅ 静默刷新** |
| 指定日期范围 | 有限 | 有限 | ✅ | **✅** |
| 指定单篇同步 | ✅ | ✅ | ✅ | **✅** |
| 指定知识库同步 | 有限 | 有限 | ✅ | **✅** |
| 全部订阅知识库 | 有限 | 有限 | ✅ | **✅** |
| 订阅博主内容 | ❌ / 有限 | ❌ / 有限 | ✅ | **✅** |
| Obsidian → Get 新建 | ✅ 单篇 | **✅ 批量** | ✅ | **✅ 多文件** |
| Web 批量新建 | ❌ / 有限 | **✅** | — | **✅** |
| Web 修改已有笔记 | ❌ | **✅** | — | **❌ 当前主要跳过** |
| Web Force Update | ❌ | **✅** | — | ❌ |
| 自动回传修改 | 有限 | ✅ | ✅ | **✅ OpenAPI** |
| Markdown 富文本转换 | 基础 | **✅ 高级 Renderer** | ✅ | ⚠️ 基础 |
| 高亮 / Task / 代码 / 公式高保真写回 | ❌ | **✅** | 较强 | ⚠️ |
| 本地图片上传 Get | ❌ | **✅** | ✅ | ❌ / 不完整 |
| 语义 Recall | ❌ | ❌ | ✅ | **✅** |
| 搜索 UI | ❌ | ❌ | ✅ | **✅** |
| 选中文字搜索 | ❌ | ❌ | ✅ | **✅** |
| 搜索结果一键同步 | ❌ | ❌ | ✅ | **✅** |
| 图片 / 音频 / 视频 / 文档下载 | ✅ | ✅ | ✅ | **✅ 四类独立控制** |
| 录音转写 | ✅ | ✅ | ✅ | **✅** |
| 防止转写 / 附件误上传 | 未见明确 | 未见明确 | 有 | **✅** |
| 远端删除同步 | ❌ | ❌ | **✅** | ❌ |
| 父子笔记关系 | ❌ | ❌ | **✅** | ⚠️ 有 children API，未完整产品化 |
| 三栏冲突合并 UI | ❌ | ❌ | **✅** | ❌ |
| 配额耗尽识别 | ❌ | ❌ | ✅ | **✅** |
| 配额 UI | ❌ | ❌ | **✅ 较完整** | ⚠️ 有状态 / 熔断，展示较轻 |
| 同步历史 | 基础 | 基础 | ✅ | **✅ 30 天 + 逐篇结果** |
| Canvas | **✅** | ✅ | ✅ | ❌ |
| Moments 时间线 | **✅** | ✅ | ✅ | ❌ |
| 移动端 | Web/Playwright 有限制 | 有限制 | ✅ OpenAPI | **✅ OpenAPI** |
| i18n | ✅ | ✅ | ✅ | ✅ |
| 自动化测试 | ⚠️ 较少 / 不透明 | ⚠️ | ⚠️ | **✅ 系统化** |
| 源码透明度 | ⚠️ | **⚠️ Plus 逻辑未完整公开** | ⚠️ | **✅ 基本完整开源** |
| 插件自身收费 | 免费 | **💰 收费** | 插件免费但 Get PRO 收费 | **免费** |

---

## 3. 我方当前已经形成的真实优势

### 3.1 Web Token 自动静默续期

这是目前一个非常实在、而且旧版对标里完全没有体现的优势。

当前链路已经是：

```text
API 请求
  ↓
发现 Web Token 401 / 403
  ↓
WebTokenRefreshCoordinator
  ↓
使用持久 Electron Session 静默打开得到大脑
  ↓
监听 Authorization 请求头
  ↓
截获新 Bearer Token
  ↓
校验
  ↓
持久化
  ↓
自动重试原请求
```

对应实现主要在：

- `src/desktop-web-auth.ts`
- `src/web-token-refresh.ts`
- `src/api.ts`

这使得 Web 模式越来越接近“配置一次，长期使用”，而不是反复复制 Token。

### 3.2 Recall 搜索已经落地，不再是缺口

旧版文档里写“我方没有 RAG / Recall”，已经过时。

当前已经存在：

- OpenAPI `/resource/recall`
- Recall 结果标准化
- 搜索 UI
- 搜索命令
- 选中文字搜索
- 已同步结果直接打开
- 未同步结果一键同步

核心实现包括：

- `src/api-clients/openapi-client.ts`
- `src/api.ts`
- `src/ui/search-view.tsx`
- `src/main.tsx`

所以“语义搜索”已经不是 springrain 的独占优势。

### 3.3 知识库 / 订阅博主已经形成完整链路

我方现在已经支持：

- 自建知识库
- 订阅知识库
- 指定知识库同步
- 全部订阅知识库
- Topic 内容分页
- 订阅博主内容
- Web / OpenAPI 双路径适配

相关实现已经覆盖：

- `fetchSubscribedTopics`
- `fetchSubscribedKnowledgeNotes`
- `fetchTopicBloggers`
- `fetchTopicContentPreviewPage`
- `blogger_post`

这比旧版“只有知识库基础同步”已经前进很多。

### 3.4 附件体系已经补齐

旧版文档中的“附件分类开关是待做项”已经失效。

当前已有：

- image
- audio
- video
- document
- other

并支持按类型控制是否下载。

相关实现：

- `src/utils/attachments.ts`
- `src/types.ts`
- `src/settings/index.tsx`
- `src/sync.ts`

### 3.5 同步历史比对方更工程化

我方已经保留：

- 最近 30 天历史
- 每次同步范围
- 总体状态
- created / updated / skipped / failed
- 逐篇结果
- 部分失败展示

这已经明显超出“只显示上次同步时间 / 数量”的基础体验。

---

## 4. springrain 现在真正领先我方的地方

不要再用“他功能很多”来描述。

真正需要重视的差距，集中在：

# 非 PRO 用户的高质量 Web 写回

### 4.1 Web Update

我方当前在 Web 模式下，对已存在远端笔记的主要策略仍然偏保守：

```text
remote exists
  ↓
skip
```

springrain Plus 已经明确做到了：

```text
remote exists
  ↓
compare / identify
  ↓
same → skip
changed → update
```

并继续提供：

- Force Update
- 幂等判断
- 批量 Session
- Debug

这是第一优先级差距。

### 4.2 Markdown → Get Rich Renderer

我方目前的写回处理更偏“安全降级”：

- 保留正文
- 图片 Markdown 目前更多转成普通链接 / 基础表达
- 重点保证不污染远端

而 springrain Plus 明确把“高保真渲染”作为收费卖点：

- 图片
- 标签
- 代码块
- 数学公式
- Obsidian 格式转换
- 二次推送

这意味着它已经不是简单上传 Markdown 字符串，而是在做：

> **Obsidian Markdown → Get 编辑器语义结构**

这是第二优先级差距。

### 4.3 本地图片上传

Rich Renderer 如果没有图片上传，体验是不完整的。

用户希望：

```markdown
## 架构设计

![[architecture.png]]

==重点==

$E = mc^2$
```

Push 后仍然在 Get 中保持：

- 图片可见
- 高亮有效
- 公式可读
- 代码结构不乱

springrain Plus 已经把这一点包装为产品能力。

这是第三优先级差距。

---

## 5. springrain 的商业模式：本质是“PRO 平替”

正常路线：

```text
用户
  ↓
得到大脑 PRO
  ↓
OpenAPI
  ↓
完整双向能力
```

springrain 的 Plus 路线：

```text
免费得到用户
  ↓
Web 私有 API
  ↓
springrain Plus
  ↓
批量 Push / Update / Rich Renderer / 图片上传
```

所以 Plus 的购买动机不是：

> “我要一个更高级的 Obsidian 插件。”

而是：

> **“我不想为了 API 买得到大脑 PRO，但我又想从 Obsidian 高质量写回 Get。”**

这决定了我们下一步最应该打的点不是 Canvas、Moments，而是 Web 写回。

---

## 6. 新的优先级建议

### P0：直接打掉 Plus 核心差异

#### P0-1 Web Update

目标：

- 已有关联远端笔记不再直接 skip
- 对正文 / title / tags 计算当前状态
- 相同内容 skip
- 有变化 update
- 明确区分普通 Update / Force Update
- 继续保持幂等与冲突保护

建议落点：

- `src/api-clients/webapi-client.ts`
- `src/api.ts`
- `src/reverse-sync.ts`
- `src/bidirectional-sync.ts`

#### P0-2 Rich Markdown Renderer

建议先支持 80/20 高频格式：

1. heading
2. bold
3. italic
4. highlight
5. unordered / ordered list
6. task list
7. quote
8. inline code
9. code block
10. link
11. image
12. math block / inline math

不要一开始追求完整 Obsidian Markdown 兼容。

核心原则：

> **优先定义稳定的“内部 Rich AST”，然后由 Web / OpenAPI 两种 writer 分别转换。不要把 Get 私有 JSON 格式直接散落在 Markdown parser 里。**

#### P0-3 Local Image Upload

需要和 Renderer 同时设计：

- 解析 Obsidian embed
- 读取本地附件
- 上传
- 获取远端 URL / asset id
- 去重
- 写入 Rich AST
- 最后生成 Get payload

建议顺便加内容 hash / asset hash，避免每次重复上传。

---

## 7. P1：继续加强“长期同步基础设施”优势

### 7.1 把 Token 自动续期做成显性卖点

当前已经实现，但 README 中仍然比较低调。

建议明确表达：

> **Web 模式支持自动登录与 Token 静默续期，正常情况下无需反复复制临时 Token。**

这是用户非常能感知的价值。

### 7.2 配额可视化

目前已经具备：

- quota state
- quota exceeded
- 自动暂停 / 熔断

可以补一个轻量 UI：

- 今日剩余
- 月度剩余
- 距离重置
- 当前是否熔断

不需要做成很重的 dashboard。

### 7.3 父子关系

已有 `fetchNoteChildren` 和相关底层能力，可以逐步把它产品化为：

- 远端层级 → 本地目录 / frontmatter
- 本地层级 → 远端 parent id

但要晚于 Web Update。

---

## 8. 暂时不要追的功能

### 8.1 Canvas / Moments

对方有，我方没有。

但它们属于：

> “同步完以后怎么展示”

而不是：

> “同步本身能不能长期稳定运行”

当前不是 P0。

### 8.2 远端删除同步

价值有，但风险也最高。

一个误判可能直接变成：

> 云端删除 → 本地知识库被删

当前“不传播删除”的保守策略是合理的。

后续若做，默认应该是：

- notify
- archive
- trash

而不是 hard delete。

### 8.3 三栏 Conflict Merge

高级但低频。

在 Web Update 与 Rich Renderer 还没补齐前，不值得抢资源。

---

## 9. 最新路线建议

### Milestone A：Web 双向闭环

目标：

- Web Create
- Web Update
- Web Force Update
- Web 自动 Token 续期
- 幂等
- 同步历史

完成后：

> 免费得到用户也可以稳定地长期双向使用。

### Milestone B：Rich Push

目标：

- Markdown AST
- 高亮 / 列表 / Task / Code / Math
- 本地图片上传
- Rich payload writer

完成后：

> springrain Plus 的主要收费价值基本被覆盖。

### Milestone C：同步基础设施深化

目标：

- quota UI
- parent / child
- 更精细冲突策略
- 可选删除同步

---

## 10. 对 springrain 仓库开源状态的判断

需要比旧版写得更谨慎。

已经能确认：

- 仓库是 MIT
- README 宣称免费开源
- 但插件 UI 中存在独立 Plus 商业授权
- Plus 使用设备序列号 + 注册码
- 截图中可见 Plus 试用状态
- 公开仓库搜索不到：
  - `Plus 功能`
  - `注册码`
  - `获取序列号`
  - 授权邮箱字符串
- 因此 **Plus 授权逻辑并没有完整出现在当前公开源码中**

另外，Release 产物与仓库源码在体积 / 内容上存在差异，因此：

> 对方更准确的描述应该是 **“基础能力 MIT 开源 + 部分商业 Plus 能力未完整公开源码”**。

不再使用旧版中“CHANGELOG 都不可信”“全部只是营销话术”这种过度绝对的表述。

因为到 4.0.x，已经有足够产品 UI 和 Release 行为证明其中一部分能力确实存在，只是实现未完整开源。

---

## 11. 我方定位建议

springrain 更像：

> **Feature-rich + Commercial Plus**

核心卖点：

> **让免费 Get 用户通过 Web 私有 API 获得接近 PRO 的高级写回能力。**

我方应该继续强化：

> **Engineering-first + Long-running Sync Infrastructure**

核心卖点：

- 真增量
- 稳定自动同步
- Web Token 静默续期
- OpenAPI / Web 双模式
- Recall
- 知识库 / 订阅博主
- 同步范围
- 同步历史
- 附件体系
- 完整测试
- 完整开源

最终产品定位可以逐步从：

> “Importer”

升级到：

> **“得到大脑 ↔ Obsidian 长期双向同步基础设施”**

---

## 12. 当前决策

### 必做

- [ ] Web Update
- [ ] Web Force Update / 幂等策略
- [ ] Rich Markdown Renderer
- [ ] Local Image Upload

### 建议随后做

- [ ] quota 轻量可视化
- [ ] parent / child 产品化
- [ ] README 强化 Web 自动续期卖点

### 暂缓

- [ ] Canvas
- [ ] Moments
- [ ] Remote Delete
- [ ] 三栏 Conflict Merge

---

## 13. 关键代码入口

### 我方

- `src/api.ts`
- `src/api-clients/openapi-client.ts`
- `src/api-clients/webapi-client.ts`
- `src/reverse-sync.ts`
- `src/bidirectional-sync.ts`
- `src/desktop-web-auth.ts`
- `src/web-token-refresh.ts`
- `src/ui/search-view.tsx`
- `src/ui/topic-picker-modal.tsx`
- `src/sync.ts`
- `src/utils/attachments.ts`
- `src/types.ts`

### 对方

- `README.md`
- `CHANGELOG.md`
- `CHANGELOG_cn.md`
- v3.9.x / v4.0.x Releases
- Plus 授权 UI

---

## 14. 后续复盘规则

以后更新这份竞品文档时，不再只看 README / CHANGELOG，需要同时核对：

1. README
2. CHANGELOG
3. Release assets
4. 当前源码
5. 实际插件 UI
6. Issues
7. 能力是否需要 Get PRO
8. 能力是否属于插件自身 Plus

这样可以避免再次把：

- Get PRO
- 插件 Plus
- README 宣称
- 实际实现

混成一件事。
