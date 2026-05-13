# Obsidian GetNote Importer - 开发规范

## 项目路径
`/Users/zhengyan/Projects/ai-project/obsidian-getnote-importer`

## 发布流程

### 发版步骤（仅通过 tag 触发 Release）

1. 修改代码 + 更新版本号
   - 更新 `manifest.json` 和 `package.json` 中的 version 字段
2. 本地验证：`npm run build`
3. 提交代码：`git add -A && git commit -m "xxx" && git push origin main`
4. 打 tag 并推送：`git tag x.y.z && git push origin x.y.z`
5. GitHub Actions 自动检测 tag → 创建 Release（包含 main.js, manifest.json, styles.css）

### 版本号规范

- 使用 `x.y.z` 格式，不带 `v` 前缀
- 示例：`1.0.5`、`0.5.22`
- Release workflow 只监听 `[0-9]*` pattern，不触发带 `v` 前缀的标签

### 本地测试

- Build 产物在 `main.js`、`manifest.json`、`styles.css`
- 这些文件在 `.gitignore` 中，不会被提交
- 如需本地测试插件：使用 `npm run build` 后手动复制到 vault 插件目录

## 本地部署（可选）

仅用于开发调试，不参与正式发布：

```bash
npm run build && cp main.js manifest.json styles.css "/Users/zhengyan/Downloads/同步空间/9_个人笔记/郑大师的笔记本/.obsidian/plugins/obsidian-getnote-importer/"
```

## 技术栈

- Runtime: Bun
- Framework: Preact + Obsidian API
- 构建: esbuild

## API 注意事项

- GetNote API 使用 64 位整数作为 ID
- 解析 JSON 时需将 `id`、`note_id`、`cursor` 等字段转为 string，防止精度丢失
- API base: `https://openapi.biji.com/open/api/v1/`
- 列表分页参数：`since_id`、`limit`（最大 20）