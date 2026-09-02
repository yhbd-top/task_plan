// task-commander v3.3 · Client half
//
// Plain JavaScript function body intended to be passed as
// `code.client` to `cordis_define`. The body returns a Cordis
// plugin object whose `apply(ctx)` registers two tool-call views
// (`task_plan`, `task_review`) into the conversation toolcard slot,
// plus a package-scoped stylesheet.

return {
  name: 'task-commander-ui',
  inject: ['slots'],
  apply(ctx) {
    styles.insert(`
.tc-card { border: 1px solid var(--dsh-border, rgba(128,128,128,0.30)); background: var(--dsh-surface-2, rgba(128,128,128,0.06)); border-radius: 10px; padding: 10px 12px; margin: 2px 0 6px; font-size: 13px; line-height: 1.55; color: inherit; }
.tc-title { font-weight: 600; margin-bottom: 6px; }
.tc-muted { opacity: 0.55; }
.tc-rules { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.tc-rule { font-size: 11px; padding: 0 7px; border-radius: 999px; border: 1px solid currentColor; opacity: 0.6; }
.tc-rule.ok { opacity: 1; }
.tc-rule.warn { color: #e6a23c; border-color: #e6a23c; }
.tc-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.tc-milestone { border-left: 3px solid var(--dsh-accent, #4a9eff); padding-left: 8px; }
.tc-milestone.auto { border-left-color: #e6a23c; }
.tc-mtitle { font-weight: 600; margin-bottom: 1px; }
.tc-tag { font-size: 10px; border: 1px solid currentColor; border-radius: 999px; padding: 0 5px; margin-left: 6px; opacity: 0.8; }
.tc-tag.auto { color: #e6a23c; border-color: #e6a23c; }
.tc-line { opacity: 0.92; }
.tc-line b { display: inline-block; min-width: 52px; opacity: 0.62; font-weight: 500; }
.tc-line.miss { color: #e6a23c; }
.tc-steps { margin: 6px 0 0 2px; padding: 0 0 0 12px; list-style: none; display: flex; flex-direction: column; gap: 5px; border-left: 1px dashed var(--dsh-border, rgba(128,128,128,0.3)); }
.tc-step-title { font-weight: 600; font-size: 12px; }
.tc-warn { margin-top: 7px; color: #e6a23c; font-size: 12px; }
.tc-info { margin-top: 7px; color: var(--dsh-accent, #4a9eff); font-size: 12px; }
.tc-verdict { font-weight: 700; margin-bottom: 6px; }
.tc-verdict.ok { color: #67c23a; }
.tc-verdict.warn { color: #e6a23c; }
.tc-checks { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 5px; }
.tc-checks li { display: flex; gap: 8px; align-items: flex-start; }
.tc-checks li.fail { color: #e6a23c; }
.tc-checks .tc-mark { flex: 0 0 auto; font-weight: 700; }
.tc-cplx { font-size: 11px; opacity: 0.7; margin-bottom: 6px; }
.tc-cplx b { font-weight: 600; opacity: 1; }
.tc-pat-head { font-weight: 600; margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--dsh-border, rgba(128,128,128,0.25)); font-size: 12px; opacity: 0.9; }
.tc-pat-head .tc-pat-count { opacity: 0.55; font-weight: 400; margin-left: 6px; }
.tc-pat-list { margin: 4px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.tc-pat-list li { display: flex; gap: 8px; align-items: flex-start; }
.tc-pat-list li.fail { color: #e6a23c; }
.tc-pat-list .tc-mark { flex: 0 0 auto; font-weight: 700; }
.tc-recurring { font-size: 10px; color: #e6a23c; border: 1px solid #e6a23c; border-radius: 4px; padding: 0 4px; margin-left: 6px; vertical-align: 1px; }
`);

    function readMeta(block) {
      if (typeof block !== 'object' || block === null) return null;
      if (!('kind' in block)) return null;
      const meta = block.meta;
      return (meta !== null && typeof meta === 'object' && !Array.isArray(meta)) ? meta : null;
    }

    function renderSteps(m, mi) {
      const steps = Array.isArray(m.steps) ? m.steps : [];
      if (steps.length === 0) return null;
      return React.createElement('ul', { className: 'tc-steps' },
        steps.map(function (s, j) {
          const head = React.createElement('div', { className: 'tc-step-title' },
            String(mi) + '.' + String(j + 1) + ' ' + String(s.title !== undefined ? s.title : ''),
            s.fan_out ? React.createElement('span', { className: 'tc-tag' }, '并行') : null);
          const d = React.createElement('div', { className: 'tc-line' + (s.done ? '' : ' miss') },
            React.createElement('b', null, 'done'), String(s.done || '待补全'));
          const v = React.createElement('div', { className: 'tc-line' + (s.verify ? '' : ' miss') },
            React.createElement('b', null, 'verify'), String(s.verify || '待补全'));
          return React.createElement('li', { key: 'st-' + j }, head, d, v);
        }));
    }

    function renderPlan(meta) {
      const milestones = Array.isArray(meta.milestones) ? meta.milestones : [];
      const rules = Array.isArray(meta.rules) ? meta.rules : [];
      const warnings = Array.isArray(meta.warnings) ? meta.warnings : [];
      const cplx = meta.complexity;
      const ps = meta.pattern_summary;
      const children = [];
      children.push(React.createElement('div', { key: 't', className: 'tc-title' },
        '任务计划 · ' + String(meta.objective !== undefined && meta.objective !== '' ? meta.objective : '（未命名）')));
      if (cplx && cplx.objective) {
        const o = cplx.objective;
        const hits = Array.isArray(o.hits) ? o.hits.join('、') : '';
        children.push(React.createElement('div', { key: 'cplx', className: 'tc-cplx' },
          React.createElement('b', null, '复杂度档位'),
          ' ' + String(o.bucket || '') + '（score ' + String(o.score !== undefined ? o.score : 0) +
          '，命中：' + (hits !== '' ? hits : '—') + '）'));
      }
      if (rules.length > 0) {
        children.push(React.createElement('div', { key: 'r', className: 'tc-rules' },
          rules.map(function (r, i) {
            return React.createElement('span', { key: 'rule-' + i, className: 'tc-rule' + (r.applied ? ' ok' : ' warn') },
              String(r.key || ''));
          })));
      }
      if (milestones.length > 0) {
        children.push(React.createElement('ol', { key: 'm', className: 'tc-list' },
          milestones.map(function (m, i) {
            const head = React.createElement('div', { className: 'tc-mtitle' },
              String(i + 1) + '. ' + String(m.title !== undefined ? m.title : ''),
              m.fan_out ? React.createElement('span', { className: 'tc-tag' }, '里程碑可并行') : null,
              m.auto_injected ? React.createElement('span', { className: 'tc-tag auto' }, '反查自动追加') : null);
            const line1 = React.createElement('div', { className: 'tc-line' + (m.done ? '' : ' miss') },
              React.createElement('b', null, 'done'), String(m.done || '待补全'));
            const line2 = React.createElement('div', { className: 'tc-line' + (m.verify ? '' : ' miss') },
              React.createElement('b', null, 'verify'), String(m.verify || '待补全'));
            return React.createElement('li', { key: 'ms-' + i, className: 'tc-milestone' + (m.auto_injected ? ' auto' : '') }, head, line1, line2, renderSteps(m, i + 1));
          })));
      }
      if (ps && ps.scanned > 0) {
        children.push(React.createElement('div', { key: 'pat', className: 'tc-info' },
          '🔍 失败模式反查（scanned ' + String(ps.scanned) + ' · applied ' + String(ps.applied) +
          ' · gaps ' + String(ps.gaps) + '）' + (ps.gaps > 0 ? '，命中缺口已自动追加里程碑，请在每条覆盖步骤补 done/verify。' : '')));
      }
      if (warnings.length > 0) {
        children.push(React.createElement('div', { key: 'w', className: 'tc-warn' },
          '⚠ ' + String(warnings.length) + ' 处待补全（已同步给模型，开工前先补）'));
      }
      return React.createElement('div', { className: 'tc-card' }, children);
    }

    function renderPatterns(patterns) {
      if (!Array.isArray(patterns)) return null;
      const applied = patterns.filter(function (p) { return p && p.applies === true; });
      if (applied.length === 0) return null;
      const recurringCount = applied.filter(function (p) { return p.recurring === true; }).length;
      const head = React.createElement('div', { className: 'tc-pat-head' },
        '失败模式反查',
        React.createElement('span', { className: 'tc-pat-count' },
          '（共扫描 ' + String(patterns.length) + ' 条，触发 ' + String(applied.length) +
          ' 条；' + (recurringCount > 0 ? '已出现过的 ' + String(recurringCount) + ' 条加了 ⚠' : '本次新增') + '）'));
      const list = React.createElement('ul', { className: 'tc-pat-list' },
        applied.map(function (p, i) {
          return React.createElement('li', { key: 'p-' + i, className: p.gap ? 'fail' : 'pass' },
            React.createElement('span', { className: 'tc-mark' }, p.gap ? '✗' : '✓'),
            React.createElement('div', null,
              React.createElement('div', null,
                String(p.label || ''),
                p.recurring === true ? React.createElement('span', { className: 'tc-recurring' }, ' ⚠ 已出现 ' + String(p.recurrences || 1) + ' 次') : null),
              React.createElement('div', { className: 'tc-muted' },
                String(p.gap ? (p.gap_note || '') : '已覆盖'))));
        }));
      return React.createElement(React.Fragment, null, head, list);
    }

    function renderReview(meta) {
      const checks = Array.isArray(meta.checks) ? meta.checks : [];
      const patterns = Array.isArray(meta.patterns) ? meta.patterns : [];
      const children = [];
      children.push(React.createElement('div', { key: 't', className: 'tc-title' },
        '任务审计 · ' + String(meta.objective !== undefined && meta.objective !== '' ? meta.objective : '（未命名）')));
      const verdictOk = meta.verdict === 'ready';
      children.push(React.createElement('div', { key: 'v', className: 'tc-verdict ' + (verdictOk ? 'ok' : 'warn') },
        verdictOk ? '✅ 通过，可开工' : '⚠ 有 ' + String(meta.issue_count !== undefined ? meta.issue_count : 0) + ' 项缺口，先补全'));
      if (checks.length > 0) {
        children.push(React.createElement('ul', { key: 'c', className: 'tc-checks' },
          checks.map(function (c, i) {
            return React.createElement('li', { key: 'ck-' + i, className: c.pass ? 'pass' : 'fail' },
              React.createElement('span', { className: 'tc-mark' }, c.pass ? '✓' : '✗'),
              React.createElement('div', null,
                React.createElement('div', null, String(c.label)),
                c.detail ? React.createElement('div', { className: 'tc-muted' }, String(c.detail)) : null));
          })));
      }
      const patBlock = renderPatterns(patterns);
      if (patBlock !== null) children.push(React.createElement('div', { key: 'pat' }, patBlock));
      return React.createElement('div', { className: 'tc-card' }, children);
    }

    function TaskCard(props) {
      const meta = readMeta(props.block);
      const title = props.toolName === 'task_review' ? '任务审计' : '任务计划';
      if (meta === null) {
        return React.createElement('div', { className: 'tc-card' },
          React.createElement('div', { className: 'tc-title' }, title),
          React.createElement('div', { className: 'tc-muted' }, '处理中…'));
      }
      if (meta.kind === 'plan') return renderPlan(meta);
      if (meta.kind === 'review') return renderReview(meta);
      return React.createElement('div', { className: 'tc-card' }, title);
    }

    ctx.slots.inject('tool.call.toolview', function () {
      return ctx.slots.register({ name: 'tool.call.toolview', key: 'task_plan' }, TaskCard);
    });
    ctx.slots.inject('tool.call.toolview', function () {
      return ctx.slots.register({ name: 'tool.call.toolview', key: 'task_review' }, TaskCard);
    });
  }
};