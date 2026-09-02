# Writing Your Own Failure Patterns

The built-in 6-pattern catalog (回滚/性能基线/资源护栏/契约验证/安全审计/灰度
阈值) covers the common AI-coding failure modes mentioned in
_CClaude Code Guide For Startups_. To add team-specific ones, drop a JSON
file at `.dsh/task-patterns.json`:

```json
[
  {
    "id": "your_pattern_id",
    "label": "人类可读的名字",
    "gap_note": "命中但没覆盖时的告警文本（告诉模型怎么补）",
    "triggers":   ["regex1", "regex2"],
    "addresses":  ["regex3", "regex4"]
  }
]
```

## Semantics

For every `task_plan` or `task_review` call, every pattern is evaluated:

1. **`triggerText(obj)`** — concat `objective + constraints + progress`,
   run each `triggers` regex; pattern **applies** if any one matches.
2. **`addressedText(text)`** — concat every milestone + every step node's
   `title + done + verify`, run each `addresses` regex; pattern is
   **addressed** if any one matches.
3. **Gap** = `applies && !addressed`. Reported as a ✗ check in
   `task_review` and as the trigger to auto-inject a milestone in
   `task_plan`.

Patterns that don't trigger are not surfaced at all (noise filtering).

## Validation

`compileExternalPattern()` rejects malformed entries at load time:

- `id`, `label`, `gap_note` must be non-empty strings
- `triggers` and `addresses` must be string arrays
- Each regex string must compile via `new RegExp(r)` — typos fail silently
  per-entry (others still load)

Bad entries are dropped, the rest still loads.

## Regex gotchas

The trigger/address texts are concatenated with spaces — multiple regexes
in `triggers`/`addresses` use OR semantics (any match → applies). Anchor
patterns if you need whole-word matches:

```json
"triggers": ["\\b发布\\b", "\\b部署\\b"]
```

`obj.indexOf` is used for the built-in keyword lists (faster, exact
substring), but external patterns use `RegExp.test()` which scans anywhere.
Prefer `\\b` boundaries to avoid unintended hits (e.g. `兼容` matching
inside `兼容性`).

## Examples

See `../examples/task-patterns.json` for a starter that adds:
- `build_dist` (构建产物可分发性)
- `manual_review_gate` (人工复核关卡)
- `data_migration` (数据迁移一致性)

Cross-check yours with `task_review` after writing — the audit will tell
you whether they trigger as expected.