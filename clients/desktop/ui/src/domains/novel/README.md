# novel 域

小说业务数据（spec 3.2），5 个子域：

| 子域 | store | 说明 |
|---|---|---|
| `overview` | `NovelOverviewStore` | 计数/novelId；label 暂用 novelId 占位 |
| `outline` | `StoryOutlineTreeStore` | 大纲树 + 展开/选中；blocked 由 pending+blockState 派生 |
| `manuscript` | `ManuscriptStructureStore` | 章节 + block 摘要；正文全文由详情懒加载 |
| `character` | `CharacterStore` | 列表/详情缓存/选中 |
| `location` | `LocationStore` | 同 character；locState 暂统一 filed |

## 约定

- 请求走 core `canonicalNovelQueryScope`；loadWorkspace(id) 只做 UI 上下文记录
- `relatedUnits`/`role`/`profile` 等为映射字段，待 core 契约补充后完善
