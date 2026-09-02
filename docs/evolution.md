# Evolution · v1 → v3.3

| Version | Date | Headline | Key change |
|---|---|---|---|
| v1.0 | 2026-09-02 | First cut | Two tools (`task_plan`, `task_review`); flat milestone list with `done` + `verify`; 5 R- tags surfaced as labels |
| v2.0 | 2026-09-02 | Layered plan | Each milestone must **expand into step nodes**; `task_review` audits step-level completeness too |
| v3.0 | 2026-09-02 | **schema bug fix** | `output.schema.complexity` was missing `additionalProperties: false`; tool activation failed until added |
| v3.1 | 2026-09-02 | Adaptive complexity | Milestone count and per-milestone step count follow an objective-derived bucket (low/medium/high) |
| v3.2 | 2026-09-02 | Failure-pattern scan | `task_review` runs an internal 6-pattern catalog (回滚/性能基线/资源护栏/契约/安全/灰度) and surfaces ✓/✗ for each |
| v3.3 | 2026-09-02 | Learnable catalog | (a) External `.dsh/task-patterns.json` merges with the built-in catalog; (b) `task_plan` auto-injects a "covering failure patterns" milestone when gaps exist; (c) `.dsh/task-history.json` tracks recurring patterns across calls and surfaces ⚠ badges |

## Why the bumps

- **v1 → v2** (user feedback): "设里程碑不够，每个里程碑都要做展开分步节点"
- **v2 → v3.1** (user feedback): "里程碑和节点数是动态的吧，根据工作复杂程度"
- **v3.1 → v3.2** (planned): done/verify 容易沦为口号，加失败模式反查 → R3 更尖锐
- **v3.2 → v3.3** (user feedback + iteration): 把"可学习的失败模式"真做出来——外部模式目录 + task_plan 主动追加 + 跨调用记忆

## Forward-looking

- 把 `.dsh/task-history.json` 的 recurring 数据通过 `goals` service 挂钩到会话目标，让长任务 agent 周期自检时直接拿到反查报告
- 内置目录的 6 条可由 yhbd 团队内部规范扩成 10-15 条，并把 .dsh/task-patterns.json 改成 `.dsh/yhbd-patterns.json` 做品牌化
- 在 cordis 注册时挂 `invariants` 贡献者，把 R3 / R4 写成不可改的 wire-level 不变量（一旦违反即中止工具调用）