# Web API Fallback 设计文档

**日期**: 2026-05-15
**状态**: 已完成
**负责人**: Andy Zheng

---

## 1. 背景与目标

### 问题
- OpenAPI 仅对 Get笔记 PRO 会员开放
- 免费用户无法使用 Obsidian 插件
- 限制了插件的普及性

### 目标
- 让免费用户也能使用插件（通过网页 API 获取笔记）
- PRO 会员继续使用 OpenAPI（功能更完整）
- 当 OpenAPI 返回 10201 错误时，自动切换到网页 API

---

## 2. 用户旅程

### 场景 A：免费用户（无 PRO 会员）

```
1. 用户安装插件，打开设置页面
   → 显示橙色提示条：OpenAPI 需 PRO 会员，免费用户请使用网页版 API

2. 用户滚动到设置下方，找到"网页版 API 配置"区域
   → 看到引导文案：
     "在 Chrome 中打开 biji.com 并登录
      按 F12 打开开发者工具 → Network 标签
      刷新页面 → 找任意请求，复制以下两个值"

3. 用户按照步骤操作：
   → 复制 Authorization（Bearer xxx）
   → 复制 xi-csrf-token（xxx）
   → 粘贴到插件输入框

4. 用户点击"保存并测试连接"
   → 插件调用网页 API 测试连接
   → 显示"连接成功 ✅"

5. 用户点击"同步笔记"
   → 插件使用网页 API 获取笔记
   → 笔记同步到 Obsidian vault
```

### 场景 B：PRO 会员

```
1. 用户安装插件，打开设置页面
   → 看到 OAuth 登录按钮

2. 用户点击"登录"按钮
   → 自动跳转到授权页面
   → 用户输入验证码
   → 返回设置页面，token 已自动填入

3. 用户点击"同步笔记"
   → 插件使用 OpenAPI（功能完整）
```

### 场景 C：OpenAPI 报 10201 错误

```
1. 用户已配置 OpenAPI 凭证（apiToken + clientId）
2. 用户点击"同步笔记"
3. OpenAPI 返回 403 / code: 10201
4. 插件检测到错误，自动切换到网页 API
5. 如果用户已配置网页 API token → 继续同步
6. 如果用户未配置网页 API token → 提示用户配置
```

---

## 3. 技术架构

### 3.1 API 端点对比

| 方面 | OpenAPI | 网页 API |
|------|---------|----------|
| Base URL | `https://openapi.biji.com/open/api/v1` | `https://get-notes.luojilab.com/voicenotes/web` |
| 认证 | OAuth Device Flow | JWT Bearer Token |
| Token 有效期 | 永久 | ~8 天 |
| 凭证字段 | `apiToken` + `clientId` | `webApiToken` + `webCsrfToken` |
| 分页 | `since_id` cursor | `since_id` cursor |
| 数据结构 | 高度兼容 | 高度兼容 |

### 3.2 新增 API 函数

```typescript
// src/api.ts

// 网页 API 笔记列表
export async function fetchNotesWebApi(
  webToken: string,
  csrfToken: string,
  sinceId: string = '',
  limit: number = 20,
  signal?: AbortSignal
): Promise<{ notes: GetNoteNote[]; hasMore: boolean }>

// 网页 API 笔记详情
export async function fetchNoteDetailWebApi(
  noteId: string,
  webToken: string,
  csrfToken: string,
  signal?: AbortSignal
): Promise<Partial<GetNoteNote>>

// 网页 API 全量获取生成器
export async function* fetchAllNotesWebApi(
  webToken: string,
  csrfToken: string,
  signal?: AbortSignal,
  startCursor?: string | null
): AsyncGenerator<GetNoteNote[]>

// 确定使用哪种 API 模式
export function getEffectiveApiMode(settings: {
  apiToken: string;
  clientId: string;
  webApiToken: string;
}): EffectiveApiMode
```

### 3.3 Settings 类型改动

```typescript
// src/types.ts

export interface Settings {
  // 现有字段
  apiToken: string;
  clientId: string;

  // 新增字段
  webApiToken: string;    // 网页版 JWT token
  webCsrfToken: string;   // 网页版 xi-csrf-token

  // ... 其他字段不变
}
```

### 3.4 API 选择逻辑

```typescript
// sync.ts 或 api.ts

function selectApiMode(settings: Settings): EffectiveApiMode {
  // 优先级 1：OpenAPI 凭证存在
  if (settings.apiToken && settings.clientId) {
    return 'openapi';
  }

  // 优先级 2：网页 API 凭证存在
  if (settings.webApiToken && settings.webCsrfToken) {
    return 'webapi';
  }

  // 默认返回 openapi（会因凭证缺失而失败）
  return 'openapi';
}

// 在同步过程中处理 10201 错误
async function safeSync(settings: Settings, ...) {
  // 尝试 OpenAPI
  if (settings.apiToken) {
    try {
      return await syncWithOpenApi(settings, ...);
    } catch (err) {
      if (isMemberOnlyError(err)) {
        // 切换到网页 API
        if (settings.webApiToken) {
          return await syncWithWebApi(settings, ...);
        }
        throw new Error('OpenAPI 需要会员，请升级或配置网页 API token');
      }
      throw err;
    }
  }

  // 没有 OpenAPI 凭证，直接用网页 API
  return await syncWithWebApi(settings, ...);
}
```

---

## 4. 错误处理

### 4.1 OpenAPI 错误代码

| Code | HTTP 状态 | 含义 | 处理 |
|------|-----------|------|------|
| 10201 | 403 | OpenAPI 仅对会员开放 | 切换到网页 API |
| 10202 | 429 | 请求频率超限 | 重试等待 |
| 401 | 401 | Token 无效 | 提示用户重新授权 |

### 4.2 网页 API 错误

| 情况 | 处理 |
|------|------|
| 401 Unauthorized | 提示用户 token 过期，需要重新复制 |
| 429 Rate Limit | 重试等待 |
| 网络错误 | 重试 3 次后提示用户 |

---

## 5. UI 改动

### 5.1 设置页面布局

```
设置页面
├── 标题区
├── 橙色提示条（OpenAPI 需会员）
├── ─────────────────────────
├── OpenAPI 凭证区（PRO 会员）
│   ├── clientId 输入框
│   ├── apiToken 输入框
│   ├── OAuth 登录按钮
│   └── 测试连接按钮
├── ─────────────────────────
├── 网页版 API 配置区（免费用户）
│   ├── 引导文案（如何获取 token）
│   ├── Authorization 输入框
│   ├── xi-csrf-token 输入框
│   ├── 保存并测试连接按钮
│   └── 说明：token 有效期约 8 天
└── 其他设置（文件夹、前缀等）
```

### 5.2 错误提示

| 场景 | 提示文案 |
|------|----------|
| OpenAPI 返回 10201 | "OpenAPI 需要 PRO 会员。免费用户请在下方配置网页 API token" |
| 网页 API 401 | "网页 API token 已过期，请在 Chrome 中重新获取并粘贴" |
| 网页 API token 未配置 | "请先配置网页 API token，详见上方说明" |

---

## 6. 数据持久化

### 6.1 Settings 存储

- `webApiToken`: 网页 API JWT token（明文存储在 DataStorage）
- `webCsrfToken`: xi-csrf-token

### 6.2 注意

- 这些 token 与 OpenAPI token 一样，存储在 Obsidian 的插件数据文件中
- token 有效期约 8 天，过期后用户需要重新复制

---

## 7. 测试计划

### 7.1 单元测试

```typescript
// tests/api.spec.ts

// 测试 API 模式选择
test('优先使用 OpenAPI 凭证', () => {
  const mode = getEffectiveApiMode({
    apiToken: 'xxx',
    clientId: 'yyy',
    webApiToken: '',
  });
  expect(mode).toBe('openapi');
});

test('OpenAPI 凭证缺失时使用网页 API', () => {
  const mode = getEffectiveApiMode({
    apiToken: '',
    clientId: '',
    webApiToken: 'zzz',
  });
  expect(mode).toBe('webapi');
});

// 测试 10201 错误识别
test('识别 OpenAPI 会员限制错误', () => {
  expect(isMemberOnlyError({ error: { code: 10201 } })).toBe(true);
});
```

### 7.2 集成测试

- 测试网页 API 笔记获取
- 测试 OpenAPI 到网页 API 的自动切换
- 测试 token 过期错误提示

---

## 8. 实现步骤

### Phase 1: 基础架构（本文档范围）
1. [ ] 添加 Settings 新字段
2. [ ] 实现 `fetchNotesWebApi` / `fetchNoteDetailWebApi`
3. [ ] 实现 `getEffectiveApiMode` 函数
4. [ ] 更新 UI 添加网页 API 配置区域

### Phase 2: 自动切换
5. [ ] 在同步引擎中实现 10201 检测和自动切换
6. [ ] 添加错误提示文案

### Phase 3: 测试
7. [ ] 添加单元测试
8. [ ] 手动测试完整流程

---

## 9. 附录：网页 API 请求示例

```
GET https://get-notes.luojilab.com/voicenotes/web/notes?limit=20&since_id=&sort=create_desc

Headers:
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  xi-csrf-token: i_aSjNGkTyxTe5ooJLW4O9p6
  x-request-id: 1778808870010
  Content-Type: application/json
  Accept: application/json
```

响应数据结构与 OpenAPI 高度兼容，可复用现有解析逻辑。