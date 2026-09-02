# task-commander · task_plan

A [DeepSeek Harness](https://github.com/yhbd-top) dynamic Cordis plugin
that helps the agent handle complex tasks by extracting the five operating
rules from [_Claude Code Guide For Startups_][guide] and turning them into
two model-visible tools:

[guide]: ../claude-code-guide-v3

- **`task_plan`** — decompose a complex/long objective into a two-layer plan
  (milestones → step nodes), with adaptive complexity buckets, and
  auto-inject a "covering failure patterns" milestone whenever the
  pattern scan finds gaps.
- **`task_review`** — *trust, but verify* audit. Re-checks the plan
  structurally and against the failure-pattern catalog (built-in 6 +
  externally editable), marks recurring gaps with a ⚠ badge.

## Why this exists

Most agent failure modes on complex work come from skipping the
boring discipline:

| Rule | Common failure | How this plugin enforces it |
|---|---|---|
| **R1 Everyone ships** | A single 30-step plan no one can own | Forces decomposition into milestones (each a delivery boundary) |
| **R2 Automate the tedium** | Everything serially queued → blows context budget | `fan_out` per milestone + per step; subagent/workflow fan-out |
| **R3 Trust, but verify** | "Looks done" but `done` is "做完了" | Forces `done` + `verify` at **both** milestone and step layer; measurability check |
| **R4 Build for rebuilding** | No rollback plan, no constraints | `constraints` + rollback-pattern scan |
| **R5 Prototype → dogfood → productionize** | Big-bang delivery | Auto-scaffolds minimum-closed-loop milestones first |

Plus the "可学习的失败模式" trick: a built-in **failure-pattern catalog** of
6 commonly-missed risks (回滚方案/性能基线/资源护栏/契约验证/安全审计/灰度
阈值) that runs against every plan. Patterns that triggered-and-weren't-covered
are flagged as gaps; patterns that triggered in earlier turns come back with
a ⚠ badge so you actually fix the principle instead of repeating the same
omission.

## Install

This plugin ships in two halves (host + client) which are loaded together
by `cordis_define`. Copy `src/host.js` and `src/client.js` into a cordis
plugin directory (or inline them into your own package) and define:

```js
await cordis_define({
  plugin: { kind: 'existing', pluginId: 'taskc-1' },  // or 'new' + idPrefix: 'taskc'
  name: 'task-commander',
  purpose: '复杂任务计划与审计工具（task_plan + task_review）',
  code: { host: <src/host.js body>, client: <src/client.js body> }
});
await cordis_run({ pluginId, packageId, mode: 'run' });
```

> Both `src/*.js` files are **plain JavaScript function bodies** (not full
> modules). Concatenate them into your cordis package as-is.

## Tools

### `task_plan`

| Parameter | Type | Description |
|---|---|---|
| `objective` | string | The complex task (required) |
| `constraints` | string | "What must not change" — architecture/security/scope rules |
| `complexity` | `"low"` \| `"medium"` \| `"high"` \| `"auto"` | Force a bucket, or let auto-detection score it |
| `max_rounds` | number | Optional cap for goal-tool rounds |
| `milestones` | array | Optional user-supplied milestones (each with title/done/verify/fan_out/steps) |

When `milestones` is omitted, the tool generates a scaffold whose breadth and
step-count track the objective complexity bucket:

| Bucket | Milestones | Steps per milestone | Triggers |
|---|---|---|---|
| `low` | 1–2 | 2 (实施 + 自检收口) | score < 2 |
| `medium` | 3 | 3 (确认输入 → 实施 → 自检) | score 2–5 |
| `high` | 4–5 | 5–6 (含边界/拆分/金标/复核) | score ≥ 6 |

Score = `Σ high-keyword (+2) + Σ medium-keyword (+1) + clauses≥3 (+1) +
len≥80 (+1)`, capped at the user override.

If any failure pattern applies but isn't covered, a final milestone
"应对反查命中的失败模式 (N 条)" is appended automatically with one
empty `覆盖：{label}` step per gap.

### `task_review`

| Parameter | Type | Description |
|---|---|---|
| `objective` | string | The task being audited (required) |
| `constraints` | string | Same field used by pattern triggers |
| `progress` | string | Free-text progress; presence is rewarded in R3 audit |
| `milestones` | array | Milestones from `task_plan` or hand-written |

Emits a `verdict` (`ready` / `needs-work`), a flat `checks[]`, a
`pattern_summary`, and `patterns[]` (each with `applies`, `addressed`,
`gap`, `recurring`).

## Pattern catalog (built-in)

| ID | Triggers | Gap message (when triggered but not addressed) |
|---|---|---|
| `rollback` | 重构/迁移/全量/灰度/分阶段/回滚 | 失败时如何回到改之前？ |
| `perf` | 性能/压测/优化/延迟/吞吐/响应时间/qps/tps | 怎么证明「变快了/没变慢」？ |
| `memory` | OOM/2GB/内存/小机器/RSS/内存占用/内存峰值 | 怎么证明不 OOM？ |
| `contract` | 跨系统/集成/接口/API/上游/下游/对接 | 上下游改了怎么办？ |
| `security` | 安全/合规/审计/权限/越权/脱敏/加密/合规性 | 谁负责安全放行？ |
| `grayscale` | 灰度/分阶段/逐步放量/放量 | 什么数值触发回退？ |

Each pattern's triggers/addresses are JS regexes over the objective text
plus every milestone + step node's `title`/`done`/`verify` (joined).

## Externalizing patterns

Drop a JSON file at `.dsh/task-patterns.json` (resolved relative to the
session cwd) shaped like:

```json
[
  {
    "id": "build_dist",
    "label": "构建产物可分发性",
    "gap_note": "涉及分发但没明确产物形态/接收方/传输方式，谁拿？怎么验？",
    "triggers": ["发布", "上线", "分发", "部署", "打包", "构建产物"],
    "addresses": ["产物", "dist", "artifact", "上传", "镜像", "压缩包", "tarball"]
  }
]
```

On apply, the plugin loads this file, compiles each entry (regex
validation happens at load time), and merges with the built-in 6 patterns
(`external.id` wins on collision). If the file is missing, unreadable,
or has a malformed entry, it silently falls back to the built-in catalog.

See `examples/task-patterns.json` for a starter.

## Cross-call history (the "可学习" part)

After each tool run, any pattern that **triggered-and-wasn't-covered**
is appended to `.dsh/task-history.json`:

```json
{
  "patterns": {
    "rollback": {
      "label": "回滚方案", "gap_note": "...",
      "occurrences": 3, "first_seen_at": 1734..., "last_seen_at": 1735...
    }
  }
}
```

Next call to `task_plan` / `task_review` loads this file and tags any
already-flagged pattern with `recurring: true` and a count. The client
card renders recurring items with a ⚠ orange badge (`已出现 N 次`) —
that's the "修复原则而非样例" feedback loop the guide calls out.

If the workspace filesystem is read-only or `fs` isn't available, the
plugin falls back to in-memory history (session-scoped only).

## Files

```
.
├── LICENSE                       # MIT (inherited from initial repo commit)
├── README.md                     # this file
├── .gitignore
├── src/
│   ├── host.js                   # task_plan + task_review logic, file I/O, history
│   └── client.js                 # conversation toolcard renderer
├── examples/
│   ├── task-patterns.json        # external pattern catalog example
│   └── task-history.json         # populated history example
└── docs/
    ├── rules.md                  # 5-rule mapping details
    ├── complexity.md             # bucket scoring rules
    ├── failure-patterns.md       # how to write your own patterns
    └── evolution.md              # v1 → v3.3 changelog
```

## License

MIT.