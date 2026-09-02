// task-commander v3.3 · Host half
//
// Plain JavaScript function body intended to be passed as
// `code.host` to `cordis_define`. The body returns a Cordis plugin
// object whose `apply(ctx)` registers two dynamic Tools:
//
//   * `task_plan`  - decompose a complex/long objective into a
//                     two-layer plan (milestones + step nodes), with
//                     adaptive complexity buckets, and auto-inject a
//                     "covering failure patterns" milestone when
//                     patterns trigger.
//   * `task_review` - "trust but verify" audit. Re-checks the plan
//                      structurally and against the failure-pattern
//                      catalog (built-in 6 + externally editable),
//                      marks recurring gaps with a ⚠ badge.
//
// All five rules R1..R5 from the "Claude Code Guide For Startups"
// are encoded across both tools. See README.md and docs/rules.md.

const FAILURE_PATTERNS = [
  {
    id: 'rollback', label: '回滚方案',
    gap_note: '目标含破坏性改动关键词，但计划没有出现「回滚/回退/rollback」相关步骤：失败时如何回到改之前？',
    triggerText: function (o) { return /(重构|迁移|全量|灰度|分阶段|回滚)/.test(o); },
    addressedText: function (s) { return /(回滚|回退|rollback|revert|undo)/.test(s); }
  },
  {
    id: 'perf', label: '性能基线',
    gap_note: '目标涉及性能，但没有对比基线或压测步骤：怎么证明「变快了/没变慢」？',
    triggerText: function (o) { return /(性能|压测|优化|延迟|吞吐|响应时间|qps|tps)/.test(o); },
    addressedText: function (s) { return /(基线|对比|压测|baseline|p95|p99|benchmark)/.test(s); }
  },
  {
    id: 'memory', label: '资源护栏',
    gap_note: '目标涉及内存/小机器/OOM，但没有峰值或护栏测量步骤：怎么证明不 OOM？',
    triggerText: function (o) { return /(OOM|2GB|内存|小机器|RSS|内存占用|内存峰值)/.test(o); },
    addressedText: function (s) { return /(内存|RSS|护栏|峰值|peak|监控|monit)/.test(s); }
  },
  {
    id: 'contract', label: '契约验证',
    gap_note: '目标跨系统/集成，但没有契约/接口测试：上下游改了怎么办？',
    triggerText: function (o) { return /(跨系统|集成|接口|API|上游|下游|对接)/.test(o); },
    addressedText: function (s) { return /(契约|接口测试|mock|contract|集成测试|schema)/.test(s); }
  },
  {
    id: 'security', label: '安全审计',
    gap_note: '目标涉及安全/合规/权限，但没有审计/复核步骤：谁负责安全放行？',
    triggerText: function (o) { return /(安全|合规|审计|权限|越权|脱敏|加密|合规性)/.test(o); },
    addressedText: function (s) { return /(审计|复核|扫描|审核|合规|sast|渗透)/.test(s); }
  },
  {
    id: 'grayscale', label: '灰度阈值',
    gap_note: '目标含灰度/分阶段，但没有回滚阈值/停止条件：什么数值触发回退？',
    triggerText: function (o) { return /(灰度|分阶段|逐步放量|放量)/.test(o); },
    addressedText: function (s) { return /(阈值|百分比|回滚条件|停止条件|告警阈值)/.test(s); }
  }
];

async function readJsonFile(fs, path) {
  try {
    const target = await fs.resolve(path, {});
    const text = await fs.readText(target);
    if (typeof text !== 'string') return null;
    return JSON.parse(text);
  } catch (e) { return null; }
}

async function writeJsonFile(fs, path, data) {
  try {
    const target = await fs.resolve(path, {});
    const text = JSON.stringify(data, null, 2);
    await fs.writeText(target, text);
    return true;
  } catch (e) { return false; }
}

function compileExternalPattern(p) {
  if (!p || typeof p !== 'object') return null;
  if (typeof p.id !== 'string' || !p.id) return null;
  if (typeof p.label !== 'string') return null;
  if (typeof p.gap_note !== 'string') return null;
  if (!Array.isArray(p.triggers) || !Array.isArray(p.addresses)) return null;
  for (let i = 0; i < p.triggers.length + p.addresses.length; i++) {
    const arr = i < p.triggers.length ? p.triggers : p.addresses;
    const r = arr[i < p.triggers.length ? i : i - p.triggers.length];
    if (typeof r !== 'string') return null;
    try { new RegExp(r); } catch (e) { return null; }
  }
  return {
    id: p.id, label: p.label, gap_note: p.gap_note,
    triggerText(o) {
      for (let i = 0; i < p.triggers.length; i++) {
        try { if (new RegExp(p.triggers[i]).test(o)) return true; } catch (e) {}
      }
      return false;
    },
    addressedText(s) {
      for (let i = 0; i < p.addresses.length; i++) {
        try { if (new RegExp(p.addresses[i]).test(s)) return true; } catch (e) {}
      }
      return false;
    }
  };
}

function mergePatterns(builtin, external) {
  const map = new Map();
  for (let i = 0; i < builtin.length; i++) map.set(builtin[i].id, builtin[i]);
  for (let i = 0; i < external.length; i++) {
    if (!external[i]) continue;
    map.set(external[i].id, external[i]);
  }
  const out = [];
  map.forEach(function (v) { out.push(v); });
  return out;
}

function runPatternScan(objective, milestones, constraints, progress, patterns, history) {
  const obj = objective || '';
  const cst = constraints || '';
  const prg = progress || '';
  const triggersAll = obj + ' ' + cst + ' ' + prg;
  const parts = [obj, cst, prg];
  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    parts.push(m.title || '', m.done || '', m.verify || '');
    const steps = Array.isArray(m.steps) ? m.steps : [];
    let stepText = '';
    for (let j = 0; j < steps.length; j++) {
      stepText += (steps[j].title || '') + ' ' + (steps[j].done || '') + ' ' + (steps[j].verify || '') + ' ';
    }
    parts.push(stepText);
  }
  const allText = parts.join(' ');
  const out = [];
  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i];
    const applies = p.triggerText(triggersAll);
    const addressed = applies ? p.addressedText(allText) : false;
    const item = {
      id: p.id, label: p.label,
      applies: !!applies, addressed: !!addressed,
      gap: !!(applies && !addressed), gap_note: p.gap_note
    };
    if (history && history.patterns && history.patterns[p.id]) {
      item.recurring = true;
      item.recurrences = history.patterns[p.id].occurrences || 1;
      item.last_seen_at = history.patterns[p.id].last_seen_at;
    }
    out.push(item);
  }
  return out;
}

function recordGapsInHistory(history, scanResults) {
  const now = Date.now();
  for (let i = 0; i < scanResults.length; i++) {
    const p = scanResults[i];
    if (!p.gap) continue;
    const e = history.patterns[p.id];
    if (e) {
      e.occurrences = (e.occurrences || 1) + 1;
      e.last_seen_at = now;
      e.label = p.label;
      e.gap_note = p.gap_note;
    } else {
      history.patterns[p.id] = { label: p.label, gap_note: p.gap_note, occurrences: 1, first_seen_at: now, last_seen_at: now };
    }
  }
  return history;
}

function normText(v) { return typeof v === 'string' ? v.trim() : ''; }

function measurable(text) {
  if (text === '') return false;
  return /[0-9０-９一二三四五六七八九十百千万]/.test(text)
    || /(通过|完成|生成|输出|删除|修复|合并|提交|上线|清空|达到|消失|产出|返回)/.test(text);
}

function normStep(s, index) {
  const src = (s !== null && typeof s === 'object' && !Array.isArray(s)) ? s : {};
  const title = normText(src.title) || ('步骤 ' + (index + 1));
  const done = normText(src.done);
  const verify = normText(src.verify);
  const fanOut = src.fan_out === true || src.fan_out === 'true';
  return { title: title, done: done, verify: verify, fan_out: fanOut, complete: done !== '' && verify !== '' };
}

const KW = {
  high: ['重构','迁移','全量','合规','性能','安全','跨系统','端到端','多团队','数据迁移','回滚','灰度','分阶段','限流','降级','分布式','多租户','审计','跨域','多语言','集群','重构为'],
  medium: ['实现','开发','完善','改造','优化','集成','接入','上线','部署','配置','调试','回归','文档','培训','对接','梳理','汇总','拆分']
};

function classifyText(text) {
  const t = normText(text);
  let score = 0;
  const hits = [];
  for (let i = 0; i < KW.high.length; i++) { if (t.indexOf(KW.high[i]) >= 0) { score += 2; hits.push(KW.high[i]); } }
  for (let i = 0; i < KW.medium.length; i++) { if (t.indexOf(KW.medium[i]) >= 0) { score += 1; hits.push(KW.medium[i]); } }
  const clauses = (t.match(/[，,；;、]/g) || []).length;
  if (clauses >= 3) { score += 1; hits.push('multi-clause(' + (clauses + 1) + ')'); }
  if (t.length >= 80) { score += 1; hits.push('len(' + t.length + ')'); }
  let bucket = 'low';
  if (score >= 6) bucket = 'high';
  else if (score >= 2) bucket = 'medium';
  return { score: score, bucket: bucket, hits: hits };
}

function classifyObjective(o) { return classifyText(o); }
function classifyMilestoneTitle(t) { return classifyText(t); }

function stepTemplate(bucket, milestoneTitle) {
  const t = milestoneTitle;
  if (bucket === 'low') {
    return [normStep({ title: '实施 · ' + t }, 0), normStep({ title: '按 verify 自检收口 · ' + t }, 1)];
  }
  if (bucket === 'medium') {
    return [normStep({ title: '确认输入与现状 · ' + t }, 0), normStep({ title: '实施 · ' + t }, 1), normStep({ title: '按 verify 自检收口 · ' + t }, 2)];
  }
  return [
    normStep({ title: '确认输入、边界与依赖 · ' + t }, 0),
    normStep({ title: '拆分子任务与并行计划 · ' + t }, 1),
    normStep({ title: '实施 · ' + t }, 2),
    normStep({ title: '对照金标 / 回测 · ' + t }, 3),
    normStep({ title: '复核与回归 · ' + t }, 4),
    normStep({ title: '自检收口 · ' + t }, 5)
  ];
}

function milestoneScaffold(bucket) {
  if (bucket === 'low') {
    return [{ title: '实现', done: '', verify: '', fan_out: false }, { title: '验证与收口', done: '', verify: '', fan_out: false }];
  }
  if (bucket === 'medium') {
    return [
      { title: '澄清目标与事实基线', done: '', verify: '', fan_out: false },
      { title: '最小闭环实现（先跑通再铺开）', done: '', verify: '', fan_out: false },
      { title: '验证、补漏与收尾', done: '', verify: '', fan_out: false }
    ];
  }
  return [
    { title: '澄清目标、边界与依赖', done: '', verify: '', fan_out: false },
    { title: '拆分任务与并行计划', done: '', verify: '', fan_out: false },
    { title: '最小闭环实现', done: '', verify: '', fan_out: false },
    { title: '全量改造与迁移', done: '', verify: '', fan_out: false },
    { title: '验证、收尾与文档', done: '', verify: '', fan_out: false }
  ];
}

function normMilestone(m, index, expand, stepBucket) {
  const src = (m !== null && typeof m === 'object' && !Array.isArray(m)) ? m : {};
  const title = normText(src.title) || ('里程碑 ' + (index + 1));
  const done = normText(src.done);
  const verify = normText(src.verify);
  const fanOut = src.fan_out === true || src.fan_out === 'true';
  const rawSteps = Array.isArray(src.steps) ? src.steps : [];
  const autoExpanded = (expand === true) && rawSteps.length === 0;
  let steps;
  let resolvedBucket = null;
  if (rawSteps.length > 0) {
    steps = [];
    for (let i = 0; i < rawSteps.length; i++) steps.push(normStep(rawSteps[i], i));
  } else if (autoExpanded) {
    const b = stepBucket || classifyMilestoneTitle(title).bucket;
    resolvedBucket = b;
    steps = stepTemplate(b, title);
  } else {
    steps = [];
  }
  return {
    title: title, done: done, verify: verify, fan_out: fanOut,
    steps: steps, steps_expanded: autoExpanded, steps_bucket: resolvedBucket,
    complete: done !== '' && verify !== ''
  };
}

const RULES = [
  { key: 'R1', name: 'Everyone ships', idea: '人人可交付' },
  { key: 'R2', name: 'Automate the tedium', idea: '自动化繁琐' },
  { key: 'R3', name: 'Trust, but verify', idea: '信任但验证' },
  { key: 'R4', name: 'Build for rebuilding', idea: '为重建而构建' },
  { key: 'R5', name: 'Prototype, dogfood, productionize', idea: '原型→内测→产品化' }
];

function buildPlan(args, patterns, history) {
  const objective = normText(args.objective) || '（未命名目标）';
  const constraints = normText(args.constraints);
  const maxRounds = (typeof args.max_rounds === 'number' && isFinite(args.max_rounds) && args.max_rounds >= 1) ? Math.floor(args.max_rounds) : null;
  const userComplexity = args.complexity;
  let objClass, objBucket;
  if (userComplexity === 'low' || userComplexity === 'medium' || userComplexity === 'high') {
    objBucket = userComplexity;
    objClass = { score: 0, bucket: userComplexity, hits: ['user-set:' + userComplexity] };
  } else {
    objClass = classifyObjective(objective);
    objBucket = objClass.bucket;
  }
  const given = Array.isArray(args.milestones) ? args.milestones : [];
  const autoScaffold = given.length === 0;
  const warnings = [];

  function perMilestone(raw, idx) {
    const titleGuess = (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && normText(raw.title)) || ('里程碑 ' + (idx + 1));
    return { ms: normMilestone(raw, idx, true, classifyMilestoneTitle(titleGuess).bucket), bucket: classifyMilestoneTitle(titleGuess).bucket };
  }
  let processed;
  if (!autoScaffold) {
    processed = [];
    for (let i = 0; i < given.length; i++) processed.push(perMilestone(given[i], i));
    if (objBucket === 'high' && given.length < 3) warnings.push('目标档位 high（复杂）但只给了 ' + given.length + ' 个里程碑；建议至少 3-4 个阶段门。');
  } else {
    const scaffold = milestoneScaffold(objBucket);
    processed = [];
    for (let i = 0; i < scaffold.length; i++) processed.push(perMilestone(scaffold[i], i));
  }
  const milestones = [];
  const stepBuckets = [];
  for (let i = 0; i < processed.length; i++) {
    milestones.push(processed[i].ms);
    stepBuckets.push(processed[i].bucket);
  }
  let stepsTotal = 0;
  for (let i = 0; i < milestones.length; i++) stepsTotal += milestones[i].steps.length;

  if (autoScaffold) warnings.push('没有提供 milestones，已按目标档位 ' + objBucket + ' 生成 ' + milestones.length + ' 段式脚手架（每段自动展开分步节点）。开工前请把每个里程碑与分步节点的 done/verify 补全。');
  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    const miss = (m.done === '' && m.verify === '') ? 'done 与 verify' : m.done === '' ? 'done' : m.verify === '' ? 'verify' : '';
    if (miss !== '') warnings.push('里程碑 ' + (i + 1) + '「' + m.title + '」缺少 ' + miss + '（阶段收口条件）。');
    if (m.steps_expanded) warnings.push('里程碑 ' + (i + 1) + '「' + m.title + '」的分步节点为自动展开（' + m.steps_bucket + ' 档 ' + m.steps.length + ' 步），请细化为具体动作并逐条补 done/verify。');
    for (let j = 0; j < m.steps.length; j++) {
      const s = m.steps[j];
      const sMiss = (s.done === '' && s.verify === '') ? 'done 与 verify' : s.done === '' ? 'done' : s.verify === '' ? 'verify' : '';
      if (sMiss !== '') warnings.push('里程碑 ' + (i + 1) + ' · 步骤 ' + (j + 1) + '「' + s.title + '」缺少 ' + sMiss + '。');
    }
  }

  const planPatterns = runPatternScan(objective, milestones, constraints, '', patterns, history);
  const planGaps = [];
  for (let i = 0; i < planPatterns.length; i++) if (planPatterns[i].applies && !planPatterns[i].addressed) planGaps.push(planPatterns[i]);
  let autoInjected = false;
  if (planGaps.length > 0) {
    const gapSteps = [];
    for (let i = 0; i < planGaps.length; i++) {
      gapSteps.push(normStep({ title: '覆盖：' + planGaps[i].label, done: '', verify: '', fan_out: false }, i));
    }
    milestones.push({
      title: '应对反查命中的失败模式（' + planGaps.length + ' 条）',
      done: '所有失败模式都有具体应对方案并经人工复核',
      verify: '再次调用 task_review，反查 gaps=0',
      fan_out: false,
      steps: gapSteps,
      steps_expanded: false,
      steps_bucket: null,
      complete: false,
      auto_injected: true
    });
    stepsTotal += gapSteps.length;
    autoInjected = true;
    warnings.push('已根据「失败模式反查」自动追加里程碑（' + planGaps.length + ' 条失败模式待覆盖），请把每条覆盖步骤的 done/verify 补全；再次跑 task_review 验证。');
  }

  const fanNodes = [];
  for (let i = 0; i < milestones.length; i++) {
    if (milestones[i].fan_out) fanNodes.push('M' + (i + 1));
    for (let j = 0; j < milestones[i].steps.length; j++) {
      if (milestones[i].steps[j].fan_out) fanNodes.push('M' + (i + 1) + '.' + (j + 1));
    }
  }
  const phaseOk = milestones.every(function (m) { return m.done !== '' && m.verify !== ''; });
  const stepsOk = milestones.every(function (m) {
    for (let j = 0; j < m.steps.length; j++) if (!m.steps[j].complete) return false;
    return true;
  });
  const complete = phaseOk && stepsOk;

  const rules = [];
  for (let i = 0; i < RULES.length; i++) {
    const r = RULES[i];
    let applied = true;
    let note = '';
    if (r.key === 'R1') {
      const hitsList = objClass.hits.slice(0, 4).join('、');
      note = '目标档位 ' + objBucket + '，已拆解为 ' + milestones.length + ' 个里程碑、' + stepsTotal + ' 个分步节点（命中：' + hitsList + (objClass.hits.length > 4 ? '…' : '') + '）。';
    } else if (r.key === 'R2') {
      if (fanNodes.length > 0) note = '已标注 ' + fanNodes.length + ' 个可并行节点（里程碑/分步），可用 subagent/workflow 扇出。';
      else { applied = false; note = '暂无并行项；相互独立的里程碑或分步节点应标 fan_out=true。'; }
    } else if (r.key === 'R3') {
      if (complete) note = '每个里程碑与分步节点都有 done + verify。';
      else { applied = false; note = '存在缺 done/verify 的里程碑或分步节点——先补全再执行。'; }
    } else if (r.key === 'R4') {
      if (constraints !== '') note = '已记录不可变约束，便于回滚/重建决策。';
      else { applied = false; note = '未记录"什么不能变"；建议补充 constraints，失败时修原则而非打补丁。'; }
    } else if (r.key === 'R5') {
      note = '按"最小闭环 → 内测 → 扩展"推进，先完成里程碑 1 的步骤再铺开。';
    }
    rules.push({ key: r.key, name: r.name, idea: r.idea, applied: applied, note: note });
  }

  return {
    kind: 'plan',
    objective: objective, constraints: constraints, max_rounds: maxRounds,
    complexity: { objective: objClass, objective_bucket: objBucket, step_buckets: stepBuckets },
    auto_scaffold: autoScaffold, rules: rules,
    milestones: milestones, steps_total: stepsTotal, fan_nodes: fanNodes,
    warnings: warnings,
    patterns: planPatterns,
    pattern_summary: { scanned: planPatterns.length, applied: planPatterns.filter(function (p) { return p.applies; }).length, gaps: planGaps.length },
    auto_injected_patterns: autoInjected ? planGaps.length : 0,
    verdict: warnings.length === 0 ? 'ready' : 'needs-work'
  };
}

function planText(value) {
  const L = [];
  L.push('## 任务计划：' + value.objective);
  if (value.constraints !== '') L.push('不可变约束：' + value.constraints);
  if (value.max_rounds !== null) L.push('轮次上限：' + value.max_rounds);
  const cplx = value.complexity;
  if (cplx && cplx.objective) {
    const o = cplx.objective;
    L.push('复杂度档位：' + o.bucket + '（score ' + o.score + '，命中：' + (o.hits.length > 0 ? o.hits.join('、') : '—') + '）');
  }
  L.push('');
  L.push('执行纪律（Claude Code for Startups 提炼）');
  for (let i = 0; i < value.rules.length; i++) {
    const r = value.rules[i];
    L.push('- [' + (r.applied ? 'x' : ' ') + '] ' + r.key + ' ' + r.idea + '：' + r.note);
  }
  L.push('');
  L.push('里程碑与分步节点：');
  for (let i = 0; i < value.milestones.length; i++) {
    const m = value.milestones[i];
    L.push((i + 1) + '. ' + m.title + (m.fan_out ? ' 〔里程碑可并行〕' : '') + (m.steps_bucket ? ' 〔分步档位 ' + m.steps_bucket + '〕' : '') + (m.auto_injected ? ' 〔反查自动追加〕' : ''));
    L.push('   done   ：' + (m.done || '⚠ 待补全'));
    L.push('   verify ：' + (m.verify || '⚠ 待补全'));
    if (m.steps.length > 0) {
      L.push('   分步节点：');
      for (let j = 0; j < m.steps.length; j++) {
        const s = m.steps[j];
        L.push('   ' + (i + 1) + '.' + (j + 1) + ' ' + s.title + (s.fan_out ? ' 〔可并行〕' : ''));
        L.push('        done  ：' + (s.done || '⚠ 待补全'));
        L.push('        verify：' + (s.verify || '⚠ 待补全'));
      }
    }
  }
  if (value.fan_nodes.length > 0) {
    L.push('');
    L.push('并行节点：' + value.fan_nodes.join('、') + ' 相互独立，可同时分给多个 subagent。');
  }
  if (value.patterns && value.patterns.length > 0) {
    const ps = value.pattern_summary;
    L.push('');
    L.push('🔍 失败模式反查（scanned ' + ps.scanned + ' · applied ' + ps.applied + ' · gaps ' + ps.gaps + '）');
    for (let i = 0; i < value.patterns.length; i++) {
      const p = value.patterns[i];
      if (!p.applies) continue;
      L.push((p.gap ? '- ✗ ' : '- ✓ ') + p.label + (p.recurring ? ' 〔⚠ 已出现 ' + (p.recurrences || 1) + ' 次〕' : '') + (p.gap ? ' —— ' + p.gap_note : ' —— 已覆盖'));
    }
    if (value.auto_injected_patterns > 0) {
      L.push('');
      L.push('已自动追加最后一个里程碑「应对反查命中的失败模式」，请补 done/verify 并重跑 task_review。');
    }
  }
  if (value.warnings.length > 0) {
    L.push('');
    L.push('⚠ 开工前必读（先补全再动手）：');
    const cap = 8;
    const ws = value.warnings;
    const show = Math.min(cap, ws.length);
    for (let i = 0; i < show; i++) L.push('- ' + ws[i]);
    if (ws.length > cap) L.push('- …还有 ' + (ws.length - cap) + ' 条类似警告，全部已计入 warnings 字段。');
  }
  L.push('');
  L.push('落地方式：里程碑写进 todo_write；分步节点按 1.1 → 1.2 → 1.3 顺序逐条推进；长任务先 create_goal 锁定目标；每个节点完成后先按 verify 自检、满足 done 再进入下一步。');
  return L.join('\n');
}

function reviewPlan(args, patterns, history) {
  const objective = normText(args.objective);
  const progress = normText(args.progress);
  const constraints = normText(args.constraints);
  const given = Array.isArray(args.milestones) ? args.milestones : [];
  const milestones = [];
  for (let i = 0; i < given.length; i++) milestones.push(normMilestone(given[i], i, false));
  const checks = [];
  function check(label, pass, detail) { checks.push({ label: label, pass: !!pass, detail: detail }); }
  check('目标清晰、可判定', objective.length >= 8, objective.length >= 8 ? '目标可用于对照"是否做完了"。' : '目标缺失或太短（不足 8 字），完成与否无法判定，容易漂移。');
  check('已拆解为里程碑', milestones.length > 0, milestones.length > 0 ? milestones.length + ' 个里程碑。' : '尚未拆解：复杂任务必须先切成里程碑再执行。');
  let stepsTotal = 0;
  for (let i = 0; i < milestones.length; i++) stepsTotal += milestones[i].steps.length;
  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    const mi = i + 1;
    if (m.done === '') check('里程碑 ' + mi + '「' + m.title + '」有阶段收口条件', false, 'done 缺失：没有停止条件。');
    else check('里程碑 ' + mi + ' 阶段收口条件可度量', measurable(m.done), measurable(m.done) ? m.done : 'done 太抽象（没有数量或可验证动作/产物）。');
    if (m.verify === '') check('里程碑 ' + mi + '「' + m.title + '」有阶段验证方式', false, 'verify 缺失：如何证明该阶段 done 为真？');
    else check('里程碑 ' + mi + '「' + m.title + '」阶段验证明确', true, m.verify);
    if (m.steps.length === 0) check('里程碑 ' + mi + '「' + m.title + '」已展开分步节点', false, '仅设里程碑不够：把该阶段拆成可执行步骤节点，每步也配 done/verify。');
    else {
      check('里程碑 ' + mi + '「' + m.title + '」已展开分步节点', true, m.steps.length + ' 个分步节点');
      for (let j = 0; j < m.steps.length; j++) {
        const s = m.steps[j];
        const label = '里程碑 ' + mi + ' · 步骤 ' + (j + 1) + '「' + s.title + '」';
        if (s.done === '') check(label + ' 有完成条件', false, '分步 done 缺失：这一步做到什么算完？');
        else check(label + ' 完成条件可度量', measurable(s.done), measurable(s.done) ? s.done : '分步 done 太抽象，补数量或可验证动作。');
        if (s.verify === '') check(label + ' 有验证方式', false, '分步 verify 缺失：怎么证明这一步做对了？');
      }
    }
  }
  let fanNodes = 0;
  for (let i = 0; i < milestones.length; i++) if (milestones[i].fan_out) fanNodes++;
  for (let i = 0; i < milestones.length; i++) for (let j = 0; j < milestones[i].steps.length; j++) if (milestones[i].steps[j].fan_out) fanNodes++;
  const serialOnly = stepsTotal > 1 && fanNodes === 0;
  check('机械性并行已标注（里程碑/分步）', !serialOnly,
    serialOnly ? '多个节点全串行：把相互独立的分步节点交给 subagent 并行，别让繁琐步骤排队烧上下文。'
      : fanNodes > 0 ? fanNodes + ' 个节点可并行扇出。' : '节点不多，串行可接受。');
  check('进展对照（防提前宣布完成）', true,
    progress !== '' ? '已记录进展，按里程碑与分步节点逐项核对后再宣告完成。' : '未提供进展；长任务建议用 get_goal/update_goal 锁定目标并回填进度。');

  const scanResult = runPatternScan(objective, milestones, constraints, progress, patterns, history);
  const gapList = [];
  for (let i = 0; i < scanResult.length; i++) if (scanResult[i].applies && !scanResult[i].addressed) gapList.push(scanResult[i]);
  for (let i = 0; i < scanResult.length; i++) {
    const p = scanResult[i];
    if (!p.applies) continue;
    const recurNote = p.recurring ? '（本次是第 ' + (p.recurrences || 1) + ' 次出现）' : '';
    check('模式反查：' + p.label + recurNote, p.addressed, p.addressed ? '计划已覆盖该模式。' : p.gap_note);
  }

  const gaps = [];
  for (let i = 0; i < checks.length; i++) if (!checks[i].pass) gaps.push(checks[i].label);
  return {
    kind: 'review',
    objective: objective,
    checks: checks,
    patterns: scanResult,
    pattern_summary: { scanned: scanResult.length, applied: scanResult.filter(function (p) { return p.applies; }).length, gaps: gapList.length },
    gaps: gaps,
    issue_count: gaps.length,
    verdict: gaps.length === 0 ? 'ready' : 'needs-work',
    progress: progress
  };
}

function reviewText(value) {
  const L = [];
  L.push('## 任务审计（信任但验证）：' + (value.objective !== '' ? value.objective : '（未命名）'));
  L.push('结论：' + (value.verdict === 'ready' ? '✅ 通过，可开工' : '⚠ 有 ' + value.issue_count + ' 项缺口，先补全'));
  L.push('');
  for (let i = 0; i < value.checks.length; i++) {
    const c = value.checks[i];
    L.push((c.pass ? '- ✓ ' : '- ✗ ') + c.label + (c.detail !== '' ? ' —— ' + c.detail : ''));
  }
  const ps = value.pattern_summary;
  if (ps && ps.scanned > 0) {
    L.push('');
    L.push('失败模式反查（scanned ' + ps.scanned + ' · applied ' + ps.applied + ' · gaps ' + ps.gaps + '）');
    for (let i = 0; i < value.patterns.length; i++) {
      const p = value.patterns[i];
      if (!p.applies) continue;
      L.push((p.gap ? '- ✗ ' : '- ✓ ') + p.label + (p.recurring ? ' 〔⚠ 已出现 ' + (p.recurrences || 1) + ' 次〕' : '') + (p.gap ? ' —— ' + p.gap_note : ' —— 已覆盖'));
    }
  }
  if (value.gaps.length > 0) {
    L.push('');
    L.push('待补全：');
    for (let i = 0; i < value.gaps.length; i++) L.push('- ' + value.gaps[i]);
  }
  L.push('');
  L.push('原则：修复原则而非样例（fix the principle, not the example）；逐节点 verify 通过后再进入下一步。');
  return L.join('\n');
}

return {
  name: 'task-commander',
  async apply(ctx) {
    let patterns = [];
    for (let i = 0; i < FAILURE_PATTERNS.length; i++) patterns.push(FAILURE_PATTERNS[i]);
    let history = { patterns: {} };
    const fs = (ctx.get && typeof ctx.get === 'function') ? ctx.get('fs') : undefined;
    if (fs) {
      const external = await readJsonFile(fs, '.dsh/task-patterns.json');
      if (Array.isArray(external)) {
        const compiled = [];
        for (let i = 0; i < external.length; i++) {
          const c = compileExternalPattern(external[i]);
          if (c !== null) compiled.push(c);
        }
        if (compiled.length > 0) {
          patterns = mergePatterns(FAILURE_PATTERNS, compiled);
          console.log('task-commander: 加载自定义模式 ' + compiled.length + ' 条');
        }
      }
      const hist = await readJsonFile(fs, '.dsh/task-history.json');
      if (hist && typeof hist === 'object' && hist.patterns && typeof hist.patterns === 'object') {
        history = hist;
        console.log('task-commander: 加载历史模式 ' + Object.keys(hist.patterns).length + ' 条');
      }
    }
    const PATTERNS = patterns;
    const HISTORY = history;
    const FS = fs;

    const planTool = harness.defineTool({
      name: 'task_plan',
      description: '把复杂/长任务拆为两层结构——里程碑(阶段门) + 分步节点(可执行动作)，复杂度档位自适应(low/medium/high)。自动跑失败模式反查(内置 6 条 + 可外部化 .dsh/task-patterns.json)，把命中缺口主动追加为独立里程碑。跨调用历史 .dsh/task-history.json 让反复出现的模式带 ⚠ 标记。',
      parameters: {
        type: 'object',
        properties: {
          objective: { type: 'string' },
          constraints: { type: 'string' },
          max_rounds: { type: 'number' },
          complexity: { type: 'string' },
          milestones: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                done: { type: 'string' },
                verify: { type: 'string' },
                fan_out: { type: 'boolean' },
                steps: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      done: { type: 'string' },
                      verify: { type: 'string' },
                      fan_out: { type: 'boolean' }
                    }
                  }
                }
              }
            }
          }
        },
        required: ['objective']
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            kind: { type: 'string' },
            objective: { type: 'string' },
            verdict: { type: 'string' },
            milestones: { type: 'array' },
            rules: { type: 'array' },
            warnings: { type: 'array' },
            fan_nodes: { type: 'array' },
            steps_total: { type: 'integer' },
            complexity: {
              type: 'object',
              additionalProperties: false,
              properties: {
                objective: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    score: { type: 'integer' },
                    bucket: { type: 'string' },
                    hits: { type: 'array' }
                  }
                },
                objective_bucket: { type: 'string' },
                step_buckets: { type: 'array' }
              }
            }
          }
        },
        render(args, value) { return [{ type: 'text', text: planText(value) }]; },
        presentationMeta(args, value) { return value; }
      },
      isConcurrencySafe() { return false; },
      async execute(args) {
        const result = buildPlan(args, PATTERNS, HISTORY);
        recordGapsInHistory(HISTORY, result.patterns || []);
        if (FS) await writeJsonFile(FS, '.dsh/task-history.json', HISTORY);
        return result;
      }
    });
    const reviewTool = harness.defineTool({
      name: 'task_review',
      description: '"信任但验证"审计：检查任务计划（或进度）结构完整性 + 按内置/外部失败模式目录做反向扫描。命中且未覆盖的模式标记为缺口，已覆盖 pass，不命中忽略；跨调用反复出现的模式加 ⚠ 标记（可学习）。',
      parameters: {
        type: 'object',
        properties: {
          objective: { type: 'string' },
          constraints: { type: 'string' },
          progress: { type: 'string' },
          milestones: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                done: { type: 'string' },
                verify: { type: 'string' },
                fan_out: { type: 'boolean' },
                steps: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      done: { type: 'string' },
                      verify: { type: 'string' },
                      fan_out: { type: 'boolean' }
                    }
                  }
                }
              }
            }
          }
        },
        required: ['objective']
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            kind: { type: 'string' },
            objective: { type: 'string' },
            verdict: { type: 'string' },
            issue_count: { type: 'integer' },
            checks: { type: 'array' },
            gaps: { type: 'array' },
            patterns: { type: 'array' },
            pattern_summary: {
              type: 'object',
              additionalProperties: false,
              properties: {
                scanned: { type: 'integer' },
                applied: { type: 'integer' },
                gaps: { type: 'integer' }
              }
            }
          }
        },
        render(args, value) { return [{ type: 'text', text: reviewText(value) }]; },
        presentationMeta(args, value) { return value; }
      },
      isConcurrencySafe() { return false; },
      async execute(args) {
        const result = reviewPlan(args, PATTERNS, HISTORY);
        recordGapsInHistory(HISTORY, result.patterns || []);
        if (FS) await writeJsonFile(FS, '.dsh/task-history.json', HISTORY);
        return result;
      }
    });
    ctx.effect(function () {
      const d1 = harness.registerTool(ctx, planTool);
      const d2 = harness.registerTool(ctx, reviewTool);
      return function () { d1(); d2(); };
    });
    console.log('task-commander v3.3 host ready');
  }
};