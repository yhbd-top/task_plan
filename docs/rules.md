# 5-Rule Mapping

This is how the five rules from [_Claude Code Guide For Startups_][guide]
land in `task-commander` v3.3.

[guide]: ../claude-code-guide-v3

## R1 — Everyone ships

> "Agentic coding lowers the barrier to entry for non-technical employees
> to build products."

**Failure mode**: the agent writes a 30-step single-list "plan" that no one
can own or check.

**Enforcement**:

- `task_plan` always returns a list of **milestones**, never a flat step list.
- Each milestone has `title` / `done` / `verify`. Empty values trigger a
  warning that the plan is `needs-work`.
- When the model passes no `milestones`, the tool generates a scaffold so a
  non-engineer can still get a structured plan out.

## R2 — Automate the tedium

> "Everyone's racing to build AI products. Far fewer are rebuilding how
> their company actually runs."

**Failure mode**: every step is serial → context budget exhausted before the
work is half done; or the agent forgets parallelizable subtasks entirely.

**Enforcement**:

- `task_plan` returns `fan_nodes: ["M2.1", "M3", ...]` — every milestone and
  step that the model flagged `fan_out: true` becomes an explicit
  fan-out target.
- `task_review` emits the check `机械性并行已标注（里程碑/分步）`: it counts
  parallelizable nodes (`fan_out === true`) and fails the check when
  `stepsTotal > 1 && fanNodes === 0`.

## R3 — Trust, but verify

> "You can't automate a process, unless you have a reliable means of
> monitoring and verifying the outcome."

**Failure mode**: agent says "重构完成" but `done: "重构做完了"` — a tautology
the user can't verify; or `done` is a vague noun ("稳定/良好/可用").

**Enforcement** (the strictest of the five):

- Every milestone **and** every step node carries `done` + `verify`.
- `task_review`'s `measurable()` heuristic rejects `done` strings that have
  neither digits/units nor a verifiable verb:
  `/[0-9０-９一二三四五六七八九十百千万]/` or
  `/(通过|完成|生成|输出|删除|修复|合并|提交|上线|清空|达到|消失|产出|返回)/`.
- Empty `done` or `verify` at either layer fails the audit.
- **Plus** a built-in 6-pattern `failure-pattern` catalog re-checks common
  gaps (回滚方案/性能基线/资源护栏/契约验证/安全审计/灰度阈值) — see
  [failure-patterns.md](./failure-patterns.md).

## R4 — Build for rebuilding

> "Model capability keeps shifting underneath these teams, so very little
> is treated as permanent."

**Failure mode**: an agent commits to an architecture without recording
what cannot change → when the model rewrites half the codebase next week,
nobody knows which invariants to defend.

**Enforcement**:

- `task_plan` accepts a `constraints` field ("不可变约束"). When present,
  the R4 rule is marked `applied: true`; when missing, the audit surfaces
  "未记录'什么不能变'; 建议补充 constraints, 失败时修原则而非打补丁".
- The built-in `rollback` pattern auto-triggers for any task whose
  objective mentions 重构/迁移/全量/灰度/分阶段/回滚. If the plan doesn't
  mention a rollback step, it's flagged as a gap.

## R5 — Prototype → dogfood → productionize

> "Build an internal agent with Claude Code, use internally (dogfood), and
> depending on the response, promote to a customer-facing product often
> using the Claude API, SDK, or Claude Managed Agents."

**Failure mode**: the agent tries to do everything at once — the first
release is also the global launch.

**Enforcement**:

- The medium-bucket scaffold starts with *"最小闭环实现（先跑通再铺开）"*
  as its second milestone, forcing the agent to ship the smallest viable
  thing before scaling.
- When `complexity === 'high'` is forced on a small objective, or
  `milestones.length < 3` for a high-bucket task, a warning nudges
  "目标档位 high 但只给了 N 个里程碑；建议至少 3-4 个阶段门".