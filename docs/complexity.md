# Complexity Bucket Scoring

`task_plan` infers (or accepts an override for) one of three complexity
buckets, which determines both the milestone scaffold and the per-milestone
step template.

## Score

```
score = Σ(high-keyword hit × 2)
      + Σ(medium-keyword hit × 1)
      + (clauses ≥ 3        ? 1 : 0)
      + (objective.length ≥ 80 ? 1 : 0)
```

where `clauses` is the count of separators `，` `,` `；` `;` `、` in the
objective text.

### Keyword lists (built-in)

**High (×2)**:
`重构 迁移 全量 合规 性能 安全 跨系统 端到端 多团队 数据迁移 回滚 灰度
分阶段 限流 降级 分布式 多租户 审计 跨域 多语言 集群 重构为`

**Medium (×1)**:
`实现 开发 完善 改造 优化 集成 接入 上线 部署 配置 调试 回归 文档 培训
对接 梳理 汇总 拆分`

## Buckets

| Score | Bucket | Default scaffold (no user milestones) | Per-milestone steps |
|---|---|---|---|
| `< 2` | `low`    | 2 milestones: 实现 / 验证与收口 | 2 |
| `2–5` | `medium` | 3 milestones: 澄清基线 / 最小闭环 / 验证收尾 | 3 |
| `≥ 6` | `high`   | 5 milestones: 澄清边界 / 拆分计划 / 最小闭环 / 全量改造 / 验证收尾 | 5–6 |

## Override

Pass `complexity: "low" | "medium" | "high"` to force a bucket regardless of
keyword scoring. The override is reflected in the output as
`complexity.objective_bucket === "user-set:<bucket>"` and the rule note
("目标档位 high" with `hits: ['user-set:high']`).

## Per-milestone step templates

| Bucket | Steps |
|---|---|
| `low` | 实施 / 按 verify 自检收口 |
| `medium` | 确认输入与现状 / 实施 / 按 verify 自检收口 |
| `high` | 确认输入、边界与依赖 / 拆分子任务与并行计划 / 实施 / 对照金标 / 回测 / 复核与回归 / 自检收口 |

When the user supplies their own `milestones` (with or without `steps`), the
bucket still applies **per-milestone**: each milestone's title is scored
independently and expanded to its tier's template when `steps` is empty.
This is what makes the tool "dynamic" — a 6-step "全量迁移" milestone gets
more scaffold than a 2-step "修复文档 typo" one.