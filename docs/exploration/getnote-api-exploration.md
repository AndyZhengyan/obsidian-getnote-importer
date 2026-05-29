# 得到大脑（原Get笔记）API 探索文档

> 探索时间：2026-05-04
> 目的：确定音频附件的下载方式，为「音频同步」功能提供方案依据

---

## 已知 API 端点

### 1. 笔记列表
```
GET /resource/note/list?since_id=<cursor>&limit=<n>
```

- 认证：`Authorization: Bearer <token>` + `X-Client-ID: <clientId>`
- 响应：`{ success, data: { notes: [], has_more, next_cursor } }`
- 按 `updated_at` DESC 排序
- 大整数字段（id, note_id 等）需做字符串化处理：
  ```ts
  text.replace(/"(id|note_id|parent_id|follow_id|live_id|user_id|client_id|file_id|resource_id)"\s*:\s*(\d+)/g, '"$1":"$2"')
  ```

### 2. 笔记详情（重要发现！）
```
GET /resource/note/detail?id=<numeric_id>
```
- 参数名是 **`id`**（不是 `note_id`）
- `note_id` 路径参数返回「参数错误」
- 详情接口 **会返回** `attachments` 数组和完整的 `audio` 字段（原始转写）
- 列表接口 **不返回** 这些字段，必须单独调用详情接口

### 3. 不存在的端点（已验证）
- `GET /resource/note/<note_id>` → 404
- `POST /resource/note/detail` → 404
- `POST /resource/attachment/list` → 404
- `POST /resource/audio/list` → 404
- `POST /resource/audio/info` → 404
- `POST /resource/file/list` → 404

---

## 音频笔记数据结构

### 列表接口返回（音频类型 note_type）
```ts
{
  id: "1908723638246504120",
  note_id: "1908723638246504120",
  title: "基于本体和大模型的风控场景应用讨论",
  content: "### 📑 智能总结\n\n#### 录音信息\n- **录音时间**：2026-04-30 12:45:24 ~ 2026-04-30 13:00:07\n- **时长**：约 0小时14分钟\n- **参与人数**：约 3 人\n...",   // AI 生成的文字摘要
  note_type: "recorder_audio",  // recorder_audio | recorder_flash_audio | immediate_audio | audio_long | local_audio
  source: "app",
  tags: [...],
  children_count: 0,
  children_ids: [],
  topics: [],
  is_child_note: false,
  // ⚠️ 注意：列表接口不返回 attachments 和 audio
}
```

### 详情接口返回（新增字段）
```ts
{
  id: "1908723638246504120",
  note_id: "1908723638246504120",
  title: "...",
  content: "...",           // 同列表
  note_type: "recorder_audio",
  // ... 其他字段同列表 ...

  attachments: [
    {
      type: "audio",                                // 固定为 "audio"
      url: "https://mediacdn.umiwi.com/voicenotes%2F...mp3?Expires=1778291785&OSSAccessKeyId=...&Signature=...",  // OSS 签名 URL
      title: "",                                     // 标题（可空）
      duration: 883920                               // 时长（毫秒）
    }
  ],

  audio: {
    // 说话人分段的原始转写文本（Markdown 格式）
    "🟢 说话人1 [00:00:01]\n我觉得这个。\n\n🟣 说话人2 [00:00:02]\n然后另一个不能被矫正。\n..."
  },

  version: 0,
  created_at: "2026-04-30 12:45:24",
  updated_at: "2026-04-30 13:00:07"   // 注意：详情接口 updated_at 是录音结束时间，列表是最后更新时间
}
```

---

## 音频下载 URL 分析

签名 URL 格式：
```
https://mediacdn.umiwi.com/voicenotes%2F202605011810%2Fnotesaudio_1a7d1f0780028560YTzqG19p.mp3
  ?Expires=1778291785
  &OSSAccessKeyId=LTAI5tHHz6xkMSPLAPECfqTM
  &Signature=ZlKxkLDvs5yVj0JQ8YVgo5yAn1c%3D
```

- 域名为 `mediacdn.umiwi.com`（阿里云 OSS CDN）
- `Expires` 是 Unix 时间戳（秒），签名 URL 过期时间
- `Signature` 是 HMAC 签名
- 文件格式：`mp3`

---

## 音频文件下载策略

### 签名 URL 的生命周期
- URL 带有 `Expires` 时间戳，当前测试的 URL 过期时间为 `1778291785`（约 2026 年中）
- 同一笔记详情接口每次调用可能返回不同的签名（未验证）
- **风险**：签名 URL 可能每次刷新都变化；旧的签名会过期

### 建议方案
1. 同步时，对 `note_type` 为音频类型的笔记，**额外调用详情接口**获取 `attachments`
2. 下载音频文件到 `{vault}/{folderName}/录音长录/{noteTitle}.mp3`
3. 将 `audio` 字段（原始转写）的说话人时间戳内容也保存为同名的 `{noteTitle}.md` 的一部分
4. 将 `attachments[0].url` 作为 Markdown 链接嵌入笔记：`[🔊 录音](audio.mp3)`

---

## API 限额信息

从 429 响应中提取的 rate limit：

| 类型 | 粒度 | 限额 | 已用 | 剩余 |
|------|------|------|------|------|
| read | daily | 20,000 | ~700+ | ~19,000 |
| read | monthly | 200,000 | ~28,000 | ~172,000 |
| write | daily | 2,000 | 0 | 2,000 |
| write_note | daily | 100 | 0 | 100 |

超出限额会触发 `qps_bucket_exceeded` 或 `qps_global_exceeded`。

---

## 方案设计提示

- 音频笔记的 `attachments` 是数组，但实际只看到一个 audio 对象
- `duration: 883920` 毫秒 ≈ 14.7 分钟，符合「录音长录」
- 详情接口需要用 **numeric `id`** 而不是 `note_id`
- 详情接口返回的 `audio` 字段是完整的说话人时间戳转写，比 `content` 的 AI 摘要更详细
- 建议同步时将 `audio` 字段内容追加到笔记正文，或作为单独章节

---

## 待进一步验证

- [ ] 同一笔记的签名 URL 每次详情接口调用是否相同
- [ ] 签名过期后是否需要重新调用详情接口刷新 URL
- [ ] `local_audio` 类型是否有不同的附件结构
- [ ] `immediate_audio` 类型的音频是否有不同的存储位置
- [ ] 是否支持其他附件类型（图片、文件）
