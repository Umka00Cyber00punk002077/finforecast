// app.js — хранение, рендер, диалоги, обработчики. Вся логика расчётов — в engine.js.
(() => {
  'use strict';
  const KEY = 'finforecast.v1';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const today = () => Engine.dates.today();
  const now = () => Date.now();

  // ---------- хранилище ----------
  const store = {
    state: null,
    corrupt: false,
    load() {
      let raw = null;
      try { raw = localStorage.getItem(KEY); } catch (_) { /* приватный режим */ }
      if (raw == null) { this.state = Engine.defaultState(); return; }
      try {
        this.state = Engine.migrate(JSON.parse(raw));
      } catch (_) {
        try { localStorage.setItem(KEY + '.corrupt', raw); } catch (_) { /* нечего делать */ }
        this.state = Engine.defaultState();
        this.corrupt = true;
      }
    },
    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); return true; }
      catch (_) { toast('Не удалось сохранить изменения'); return false; }
    },
    commit(next) { this.state = next; this.save(); render(); },
    clear() {
      try { localStorage.removeItem(KEY); } catch (_) { /* нечего делать */ }
      this.state = Engine.defaultState(); this.corrupt = false; render();
    },
  };
  const fmt = (minor, opts) => Engine.money.format(minor, store.state.profile.currency, opts);
  const fdate = (ymd) => Engine.dates.format(ymd, { today: today() });
  // Дневные суммы показываем в целых единицах, округляя вниз (осторожная оценка)
  const fmtWhole = (minor) => fmt(Math.floor(minor / 100) * 100);
  const toInput = (minor) => (minor ? String(minor / 100).replace('.', ',') : '');
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---------- DOM-хелперы (пользовательский текст только через textContent) ----------
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) {
      if (c != null) node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.append(use);
    return svg;
  }

  // ---------- валидация полей ----------
  function errorSlot(input) { const wrap = input.closest('.fw') || input.parentElement; return wrap ? wrap.querySelector('.field-error') : null; }
  function setError(input, msg) { input.classList.add('field--error'); const e = errorSlot(input); if (e) e.textContent = msg; input.focus(); return false; }
  function clearError(input) { input.classList.remove('field--error'); const e = errorSlot(input); if (e) e.textContent = ''; }
  function validate(input, parse, msg) { const v = parse(input.value); if (v == null) return setError(input, msg); clearError(input); return true; }
  document.addEventListener('input', (e) => { if (e.target.classList && e.target.classList.contains('field')) clearError(e.target); });

  // ---------- тост с отменой ----------
  let toastTimer = null, toastUndo = null;
  function toast(text, { undo } = {}) {
    const t = $('#toast'), u = $('#toast-undo');
    $('#toast-text').textContent = text;
    toastUndo = undo || null; u.hidden = !undo;
    t.hidden = false;
    requestAnimationFrame(() => t.classList.add('is-visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }
  function hideToast() {
    const t = $('#toast');
    t.classList.remove('is-visible');
    toastUndo = null;
    setTimeout(() => { if (!t.classList.contains('is-visible')) t.hidden = true; }, 250);
  }
  $('#toast-undo').addEventListener('click', () => { const u = toastUndo; hideToast(); if (u) u(); });

  // ---------- рендер ----------
  let renderedToday = today();
  function render() {
    renderedToday = today();
    const s = store.state;
    const onboarding = !s.profile.onboarded;
    const tab = onboarding ? 'onboarding' : s.ui.tab;
    for (const v of $$('.view')) v.hidden = v.id !== 'view-' + tab;
    for (const n of $$('[data-tab]')) {
      if (n.classList.contains('nav-item') || n.classList.contains('tab-item')) {
        if (n.dataset.tab === tab) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
      }
    }
    const fab = $('#fab');
    fab.hidden = onboarding || tab === 'settings';
    fab.dataset.action = tab === 'obligations' ? 'obligation' : 'transaction';
    fab.setAttribute('aria-label', tab === 'obligations' ? 'Добавить платёж' : 'Добавить операцию');
    document.body.classList.toggle('is-onboarding', onboarding);
    $('#corrupt-banner').hidden = !store.corrupt;
    for (const c of $$('.cur')) c.textContent = Engine.money.CURRENCIES[s.profile.currency];
    ({ dashboard: renderDashboard, history: renderHistory, obligations: renderObligations, settings: renderSettings, onboarding: renderOnboarding })[tab]();
  }
  function showTab(tab) { store.commit(Engine.ops.setTab(store.state, tab)); window.scrollTo(0, 0); }
  document.addEventListener('click', (e) => {
    const n = e.target.closest('[data-tab]');
    if (!n) return;
    e.preventDefault();
    if (!store.state.profile.onboarded) return;
    showTab(n.dataset.tab);
  });
  $('#fab').addEventListener('click', () => ($('#fab').dataset.action === 'obligation' ? openObDialog(null) : openTxDialog({ mode: 'expense' })));
  $('#sidebar-add').addEventListener('click', () => openTxDialog({ mode: 'expense' }));

  // ---------- главная ----------
  const HERO_CLASS = { HEALTHY: 'ok', WARNING: 'warn', CRITICAL: 'bad', PAYDAY: 'payday' };
  function renderDashboard() {
    const s = store.state, t = today(), f = Engine.calc.forecast(s, t);
    $('#dash-date').textContent = capitalize(new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }));
    const hero = $('#hero');
    hero.replaceChildren();
    hero.className = 'hero hero--' + HERO_CLASS[f.status];
    if (f.status === 'PAYDAY') {
      hero.append(
        el('div', { class: 'hero__head' }, [el('span', { class: 'label-caps', text: 'Зарплата' }), el('span', { class: 'badge badge--ok', text: `${f.daysRemaining === 0 ? 'Сегодня' : 'Была ' + fdate(f.nextIncomeDate)}` })]),
        el('h2', { class: 'hero__title', text: f.title }),
        el('p', { class: 'hero__sub', text: f.subtitle }),
        el('div', { class: 'hero__actions' }, [
          el('button', { class: 'btn btn--primary', type: 'button', text: s.profile.expectedIncome ? `Получил(а) ${fmt(s.profile.expectedIncome)}` : 'Получил(а) зарплату', onclick: () => openTxDialog({ mode: 'payday' }) }),
          el('button', { class: 'btn btn--ghost', type: 'button', text: 'Перенести на завтра', onclick: () => { store.commit(Engine.ops.postponePayday(store.state, today())); toast('Дата зарплаты перенесена на завтра'); } }),
        ]),
      );
    } else {
      const label = f.status === 'CRITICAL' ? 'Не хватает до зарплаты' : 'Осталось на сегодня';
      const value = f.status === 'CRITICAL' ? f.cashGap : f.status === 'WARNING' ? 0 : f.remainingToday;
      const badge = { HEALTHY: 'Всё по плану', WARNING: 'Лимит исчерпан', CRITICAL: 'Дефицит' }[f.status];
      const pct = f.status === 'HEALTHY' && f.budgetToday > 0 ? Math.min(100, Math.round(f.spentToday / f.budgetToday * 100)) : 100;
      const sub = f.status === 'HEALTHY' ? `из ${fmtWhole(f.budgetToday)} · потрачено ${fmt(f.spentToday)}`
        : f.status === 'WARNING' ? `перерасход ${fmt(f.overspentToday)} · потрачено ${fmt(f.spentToday)} из ${fmtWhole(f.budgetToday)}`
        : f.subtitle;
      const foot = f.status === 'HEALTHY' ? f.subtitle
        : f.status === 'WARNING' ? 'Новые траты уменьшат бюджет следующих дней'
        : `До зарплаты ${f.daysRemaining} дн. · ${fdate(f.nextIncomeDate)}`;
      hero.append(
        el('div', { class: 'hero__head' }, [el('span', { class: 'label-caps', text: label }), el('span', { class: 'badge', text: badge })]),
        el('div', { class: 'hero__value money', text: fmtWhole(value) }),
        el('div', { class: 'hero__sub', text: sub }),
        el('div', { class: 'hero__bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, el('div', { class: 'hero__fill', style: `width:${pct}%` })),
        el('div', { class: 'hero__foot', text: foot }),
      );
    }
    $('#stats').replaceChildren(
      stat('Баланс', fmt(f.balance)),
      stat('Свободно', fmt(f.free)),
      stat('Резерв', fmt(f.reserved), [f.goalsReserve ? `цели ${fmt(f.goalsReserve)}` : null, f.buffer ? `буфер ${fmt(f.buffer)}` : null].filter(Boolean).join(' · ') || null),
      stat('До зарплаты', f.daysRemaining > 0 ? `${f.daysRemaining} дн.` : '—', f.nextIncomeDate ? fdate(f.nextIncomeDate) : null),
    );
    const obs = Engine.calc.reservedObligations(s).slice(0, 3);
    $('#dash-obligations').replaceChildren(...(obs.length ? obs.map(o => obligationRow(o, { compact: true })) : [el('p', { class: 'empty', text: 'Нет платежей до зарплаты' })]));
    const txs = s.transactions.filter(x => x.date === t).sort((a, b) => b.at - a.at).slice(0, 5);
    $('#dash-recent').replaceChildren(...(txs.length ? txs.map(x => txRow(x, { compact: true })) : [el('p', { class: 'empty', text: 'Сегодня трат ещё не было' })]));
    $('#dash-hint').hidden = s.obligations.some(o => o.status === 'ACTIVE');
    const goals = Engine.calc.activeGoals(s);
    $('#dash-goals').replaceChildren(...goals.map(g => goalCard(g, { compact: true })));
    $('#dash-goal-hint').hidden = s.goals.length > 0;
    renderAfford();
  }
  const stat = (label, value, sub) => el('div', { class: 'stat card' }, [
    el('span', { class: 'label-caps', text: label }),
    el('span', { class: 'stat__value money', text: value }),
    sub ? el('span', { class: 'stat__sub', text: sub }) : null,
  ]);

  // ---------- строки списков ----------
  function deleteTx(id) {
    const { state, removed } = Engine.ops.deleteTransaction(store.state, id);
    if (!removed) return;
    store.commit(state);
    toast('Операция удалена', { undo: () => { store.commit(Engine.ops.restoreTransaction(store.state, removed)); toast('Операция восстановлена'); } });
  }
  function txRow(t, { compact = false } = {}) {
    const isIn = t.type === 'INCOME', isAdj = t.type === 'ADJUSTMENT', isSaving = t.type === 'SAVING';
    const inflow = isIn || (isSaving && t.amount < 0);
    const title = isSaving ? (t.amount > 0 ? `Взнос в «${t.note}»` : `Из цели «${t.note}»`) : (t.note || t.category);
    const sub = isAdj ? 'Корректировка баланса' : isSaving ? 'Накопление' : t.note ? t.category : (isIn ? 'Доход' : 'Расход');
    const amount = isAdj || isIn ? fmt(t.amount, { sign: true }) : isSaving ? fmt(-t.amount, { sign: true }) : fmt(-t.amount);
    return el('div', { class: 'row' + (compact ? ' row--compact' : '') }, [
      el('span', { class: 'row__icon' + (inflow ? ' row__icon--in' : '') }, icon(isIn ? 'arrow-in' : isAdj ? 'settings' : isSaving ? 'sparkle' : t.obligationId ? 'repeat' : 'receipt')),
      el('div', { class: 'row__body' }, [el('span', { class: 'row__title', text: title }), el('span', { class: 'row__sub', text: sub })]),
      el('span', { class: 'row__amount money' + (inflow ? ' is-in' : ''), text: amount }),
      compact ? null : el('div', { class: 'row__actions' }, el('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Удалить операцию', onclick: () => deleteTx(t.id) }, icon('trash'))),
    ]);
  }
  function obligationRow(o, { compact = false } = {}) {
    const s = store.state, t = today();
    const tag = o.status === 'DONE' ? 'Завершено' : o.dueDate < t ? 'Просрочено'
      : (s.profile.nextIncomeDate && o.dueDate < s.profile.nextIncomeDate) ? 'В резерве' : 'После зарплаты';
    const tagClass = { 'Просрочено': 'badge--bad', 'В резерве': 'badge--warn', 'После зарплаты': 'badge--muted', 'Завершено': 'badge--muted' }[tag];
    const pay = () => { store.commit(Engine.ops.payObligation(store.state, o.id, { date: today(), at: now() })); toast(`Оплачено: ${o.title}. Лимит не изменился`); };
    if (compact) {
      return el('div', { class: 'row row--compact' }, [
        el('div', { class: 'row__body' }, [el('span', { class: 'row__title', text: o.title }), el('span', { class: 'row__sub', text: `срок ${fdate(o.dueDate)}` })]),
        el('span', { class: 'row__amount money', text: fmt(o.amount) }),
        el('div', { class: 'row__actions' }, el('button', { type: 'button', class: 'btn btn--small', text: 'Оплатить', onclick: pay })),
      ]);
    }
    // Последняя оплата в текущем цикле — чтобы было видно, что этот месяц уже закрыт
    const paidAt = s.transactions
      .filter(x => x.obligationId === o.id && x.date >= (s.profile.cycleStartDate || ''))
      .sort((a, b) => b.at - a.at).map(x => x.date)[0] || null;
    const actions = o.status === 'DONE'
      ? [
        el('button', { type: 'button', class: 'btn btn--small btn--ghost', text: 'Вернуть', onclick: () => { store.commit(Engine.ops.reactivateObligation(store.state, o.id)); toast('Платёж снова активен'); } }),
        el('span', { class: 'spacer' }),
        el('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Удалить платёж', onclick: () => removeOb(o) }, icon('trash')),
      ]
      : [
        el('button', { type: 'button', class: 'btn btn--small btn--primary', text: 'Оплатить', onclick: pay }),
        el('button', { type: 'button', class: 'btn btn--small btn--ghost', text: 'Пропустить', onclick: async () => {
          if (await confirmDialog(`Пропустить «${o.title}» в этот раз? Срок сдвинется без списания.`, { ok: 'Пропустить', danger: false })) {
            store.commit(Engine.ops.skipObligation(store.state, o.id)); toast('Платёж пропущен');
          }
        } }),
        el('span', { class: 'spacer' }),
        el('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Изменить платёж', onclick: () => openObDialog(o.id) }, icon('edit')),
        el('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Удалить платёж', onclick: () => removeOb(o) }, icon('trash')),
      ];
    return el('div', { class: 'ob' + (o.status === 'DONE' ? ' is-done' : '') }, [
      el('span', { class: 'ob__title', text: o.title }),
      el('span', { class: 'ob__amount money', text: fmt(o.amount) }),
      el('span', { class: 'ob__meta' }, [
        el('span', { class: 'badge ' + tagClass, text: tag }),
        el('span', { text: `срок ${fdate(o.dueDate)}` }),
        el('span', { text: '·' }),
        el('span', { text: o.frequency === 'MONTHLY' ? 'ежемесячно' : 'разово' }),
        paidAt ? el('span', { text: '·' }) : null,
        paidAt ? el('span', { class: 'ob__paid', text: `оплачено ${fdate(paidAt)}` }) : null,
      ]),
      el('div', { class: 'ob__actions' }, actions),
    ]);
  }
  async function removeOb(o) {
    if (await confirmDialog(`Удалить «${o.title}»? История оплат сохранится.`)) {
      store.commit(Engine.ops.deleteObligation(store.state, o.id)); toast('Платёж удалён');
    }
  }

  // ---------- цели ----------
  function goalCard(g, { compact = false } = {}) {
    const s = store.state, t = today();
    const p = Engine.calc.goalProjection(s, g, t);
    const done = p.remaining === 0;
    const late = !done && g.deadline && p.onTrack === false;
    const meta = [];
    if (done) meta.push(el('span', { class: 'is-ok', text: 'Цель достигнута' }));
    else if (p.projectedDate) {
      meta.push(el('span', { text: `При ${fmt(g.perCycle)} за цикл — к ${fdate(p.projectedDate)}` }));
      if (g.deadline) meta.push(late
        ? el('span', { class: 'is-late', text: `К ${fdate(g.deadline)} не успеть — нужно ${fmt(p.requiredPerCycle)} за цикл` })
        : el('span', { class: 'is-ok', text: `Успеваете к ${fdate(g.deadline)}` }));
    } else if (g.deadline && p.requiredPerCycle != null) {
      meta.push(el('span', { class: g.perCycle ? 'is-late' : '', text: `Чтобы успеть к ${fdate(g.deadline)} — нужно ${fmt(p.requiredPerCycle)} за цикл` }));
    } else {
      meta.push(el('span', { text: 'Укажите взнос за цикл — покажу дату' }));
    }
    if (!done && g.perCycle > 0) meta.push(el('span', { text: p.pending > 0 ? `В этом цикле осталось отложить ${fmt(p.pending)}` : 'Взнос этого цикла сделан' }));
    const actions = [];
    if (!done && p.pending > 0) actions.push(el('button', { type: 'button', class: 'btn btn--small btn--primary', text: `Отложить ${fmt(p.pending)}`, onclick: () => openContribDialog(g.id, 'deposit') }));
    else if (!done && !compact) actions.push(el('button', { type: 'button', class: 'btn btn--small btn--ghost', text: 'Отложить ещё', onclick: () => openContribDialog(g.id, 'deposit') }));
    if (!compact) {
      if (p.saved > 0) actions.push(el('button', { type: 'button', class: 'btn btn--small btn--ghost', text: 'Взять из цели', onclick: () => openContribDialog(g.id, 'withdraw') }));
      actions.push(el('span', { class: 'spacer' }));
      actions.push(el('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Изменить цель', onclick: () => openGoalDialog(g.id) }, icon('edit')));
      actions.push(el('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Удалить цель', onclick: () => removeGoal(g) }, icon('trash')));
    }
    return el('div', { class: 'goal card' + (late ? ' goal--late' : '') + (done ? ' goal--done' : '') }, [
      el('div', { class: 'goal__head' }, [
        el('span', { class: 'goal__title', text: g.title }),
        el('span', { class: 'goal__amounts money' }, [el('b', { text: Engine.money.formatNumber(p.saved) }), ` из ${fmt(g.target)}`]),
      ]),
      el('div', { class: 'goal__bar', role: 'progressbar', 'aria-valuenow': Math.round(p.progress * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 },
        el('div', { class: 'goal__fill', style: `width:${Math.round(p.progress * 100)}%` })),
      el('div', { class: 'goal__meta' }, meta),
      actions.length ? el('div', { class: 'goal__actions' }, actions) : null,
    ]);
  }
  async function removeGoal(g) {
    const net = store.state.transactions.filter(t => t.type === 'SAVING' && t.goalId === g.id).reduce((a, t) => a + t.amount, 0);
    const text = net > 0 ? `Удалить «${g.title}»? Внесённые через приложение ${fmt(net)} вернутся в баланс.` : `Удалить «${g.title}»?`;
    if (await confirmDialog(text)) {
      store.commit(Engine.ops.deleteGoal(store.state, g.id, { date: today(), at: now() }));
      toast('Цель удалена');
    }
  }

  // ---------- «Могу ли я?» ----------
  let affordAmount = null;
  const AFFORD_CLASS = { YES: 'ok', YES_BUT: 'warn', NO_BUFFER: 'bad', NO: 'bad', CRITICAL: 'bad', PAYDAY: '' };
  function renderAfford() {
    const box = $('#afford-result');
    if (affordAmount == null) { box.hidden = true; return; }
    const r = Engine.calc.canAfford(store.state, today(), affordAmount);
    box.className = 'afford__result' + (AFFORD_CLASS[r.verdict] ? ' afford__result--' + AFFORD_CLASS[r.verdict] : '');
    $('#afford-lines').replaceChildren(...r.lines.map(l => el('p', { text: l })));
    $('#afford-record').hidden = r.verdict === 'PAYDAY';
    box.hidden = false;
  }
  $('#afford').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#afford-amount');
    const v = Engine.money.parse(input.value);
    if (!v) return setError(input, 'Введите сумму');
    affordAmount = v; renderAfford();
  });
  $('#afford-amount').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#afford').requestSubmit(); } });
  $('#afford-amount').addEventListener('input', () => { if (affordAmount != null && !Engine.money.parse($('#afford-amount').value)) { affordAmount = null; renderAfford(); } });
  $('#afford-record').addEventListener('click', () => { if (affordAmount) openTxDialog({ mode: 'expense', amount: affordAmount }); });
  $('#afford-clear').addEventListener('click', () => { affordAmount = null; $('#afford-amount').value = ''; renderAfford(); });

  // ---------- онбординг ----------
  const onb = { step: 1, currency: 'KGS' };
  function renderOnboarding() {
    for (let i = 1; i <= 4; i++) $('#onb-step-' + i).hidden = i !== onb.step;
    $('#onb-counter').textContent = `Шаг ${onb.step} из 4`;
    for (const b of $$('#onb-currency [data-currency]')) b.classList.toggle('is-active', b.dataset.currency === onb.currency);
    for (const c of $$('.cur')) c.textContent = Engine.money.CURRENCIES[onb.currency];
    if (onb.step === 3) $('#onb-date').min = Engine.dates.addDays(today(), 1);
    if (onb.step === 4) {
      const f = Engine.calc.forecast(store.state, today());
      $('#onb-result').textContent = f.status === 'HEALTHY' ? `Ваш лимит на сегодня — ${fmtWhole(f.budgetToday)}` : f.title;
    }
  }
  $('#onb-currency').addEventListener('click', (e) => {
    const b = e.target.closest('[data-currency]'); if (!b) return;
    onb.currency = b.dataset.currency; onb.step = 2; render();
    $('#onb-balance').focus();
  });
  $('#onb-next-2').addEventListener('click', () => {
    if (!validate($('#onb-balance'), Engine.money.parse, 'Введите сумму больше нуля')) return;
    onb.step = 3; render(); $('#onb-date').focus();
  });
  $('#onb-back-2').addEventListener('click', () => { onb.step = 1; render(); });
  $('#onb-back-3').addEventListener('click', () => { onb.step = 2; render(); });
  $('#onb-next-3').addEventListener('click', () => {
    const d = $('#onb-date').value;
    if (!Engine.dates.isValid(d) || d <= today()) return setError($('#onb-date'), 'Укажите дату позже сегодняшней');
    const expectedRaw = $('#onb-expected').value.trim();
    const expected = expectedRaw ? Engine.money.parse(expectedRaw) : null;
    if (expectedRaw && !expected) return setError($('#onb-expected'), 'Введите сумму или оставьте пустым');
    store.state = Engine.ops.completeOnboarding(store.state, {
      currency: onb.currency, balance: Engine.money.parse($('#onb-balance').value), nextIncomeDate: d,
      expectedIncome: expected, incomeFrequency: $('#onb-frequency').value, date: today(), at: now(),
    });
    store.state.profile.onboarded = false; // финальный экран показываем ещё внутри онбординга
    onb.step = 4; render();
  });
  function finishOnboarding(tab) {
    store.state.profile.onboarded = true;
    onb.step = 1;
    store.commit(Engine.ops.setTab(store.state, tab));
    window.scrollTo(0, 0);
    toast('Настройка завершена');
  }
  $('#onb-finish').addEventListener('click', () => finishOnboarding('dashboard'));
  $('#onb-to-obligations').addEventListener('click', () => finishOnboarding('obligations'));

  // ---------- диалоги: общее ----------
  function openDialog(dlg) {
    if (dlg.open) return;
    dlg.showModal();
    document.body.style.overflow = 'hidden';
    const first = dlg.querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
    if (first) setTimeout(() => first.focus(), 60);
  }
  function closeDialog(dlg) { if (dlg.open) dlg.close(); }
  for (const dlg of $$('dialog')) {
    dlg.addEventListener('close', () => { document.body.style.overflow = ''; });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(dlg); }); // тап по затемнению
    for (const b of $$('[data-close]', dlg)) b.addEventListener('click', () => closeDialog(dlg));
  }

  // ---------- диалог операции ----------
  const tx = { mode: 'expense', type: 'EXPENSE', category: 'Продукты', match: null };
  let paydayGoals = [];
  function openTxDialog({ mode, amount = null }) {
    const dlg = $('#dlg-tx'), s = store.state;
    tx.mode = mode;
    tx.type = mode === 'expense' ? 'EXPENSE' : 'INCOME';
    tx.match = null;
    tx.category = mode === 'payday' ? Engine.SPECIAL.SALARY : Engine.CATEGORIES[tx.type][0];
    $('#tx-title').textContent = mode === 'payday' ? 'Зарплата получена' : 'Новая операция';
    $('#tx-type').hidden = mode === 'payday';
    $('#tx-amount').value = mode === 'payday' ? toInput(s.profile.expectedIncome) : toInput(amount);
    // Взносы в цели на новый цикл — одной галочкой
    paydayGoals = mode === 'payday'
      ? Engine.calc.activeGoals(s).filter(g => g.perCycle > 0).map(g => ({ id: g.id, title: g.title, amount: Math.min(g.perCycle, Math.max(0, g.target - Engine.calc.goalSaved(s, g))) })).filter(x => x.amount > 0)
      : [];
    $('#tx-goals').hidden = !paydayGoals.length;
    $('#tx-goals-check').checked = true;
    $('#tx-goals-text').textContent = `Сразу отложить в цели: ${paydayGoals.map(x => `«${x.title}» ${fmt(x.amount)}`).join(', ')}`;
    $('#tx-note').value = '';
    $('#tx-payday').hidden = mode !== 'payday';
    if (mode === 'payday') {
      const next = Engine.calc.nextIncomeAfter(s.profile);
      $('#tx-next-date').value = next || '';
      $('#tx-next-date').min = Engine.dates.addDays(today(), 1);
    }
    $('#tx-submit').textContent = mode === 'payday' ? 'Подтвердить и начать новый цикл' : 'Записать';
    [$('#tx-amount'), $('#tx-next-date')].forEach(clearError);
    renderTxType(); renderTxCategories(); renderTxMatch();
    openDialog(dlg);
  }
  function renderTxType() { for (const b of $$('#tx-type [data-type]')) b.classList.toggle('is-active', b.dataset.type === tx.type); }
  function renderTxCategories() {
    $('#tx-categories').replaceChildren(...Engine.CATEGORIES[tx.type].map(c =>
      el('button', { type: 'button', class: 'chip' + (c === tx.category ? ' is-active' : ''), text: c, 'aria-pressed': c === tx.category ? 'true' : 'false',
        onclick: () => { tx.category = c; renderTxCategories(); } })));
  }
  function renderTxMatch() {
    const amount = Engine.money.parse($('#tx-amount').value);
    tx.match = tx.type === 'EXPENSE' && tx.mode !== 'payday' && amount ? Engine.calc.findMatchingObligation(store.state, amount) : null;
    $('#tx-match').hidden = !tx.match;
    if (tx.match) $('#tx-match-title').textContent = tx.match.title;
  }
  $('#tx-type').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]'); if (!b) return;
    tx.type = b.dataset.type; tx.category = Engine.CATEGORIES[tx.type][0];
    renderTxType(); renderTxCategories(); renderTxMatch();
  });
  $('#tx-amount').addEventListener('input', renderTxMatch);
  $('#tx-match-yes').addEventListener('click', () => {
    const o = tx.match; if (!o) return;
    store.commit(Engine.ops.payObligation(store.state, o.id, { date: today(), at: now() }));
    closeDialog($('#dlg-tx'));
    toast(`Оплачено: ${o.title}. Лимит не изменился`);
  });
  $('#dlg-tx form').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = Engine.money.parse($('#tx-amount').value);
    if (!amount) return setError($('#tx-amount'), 'Введите сумму больше нуля');
    const note = $('#tx-note').value.trim().slice(0, 80);
    if (tx.mode === 'payday') {
      const next = $('#tx-next-date').value;
      if (!Engine.dates.isValid(next) || next <= today()) return setError($('#tx-next-date'), 'Укажите дату позже сегодняшней');
      let next2 = Engine.ops.confirmPayday(store.state, { amount, nextIncomeDate: next, date: today(), at: now() });
      let saved = 0;
      if ($('#tx-goals-check').checked) {
        for (const x of paydayGoals) { next2 = Engine.ops.contributeToGoal(next2, x.id, x.amount, { date: today(), at: now() }); saved += x.amount; }
      }
      store.commit(next2);
      closeDialog($('#dlg-tx'));
      toast(saved ? `Новый цикл до ${fdate(next)}. Отложено ${fmt(saved)}` : `Новый цикл до ${fdate(next)}`);
      return;
    }
    store.commit(Engine.ops.addTransaction(store.state, { type: tx.type, amount, category: tx.category, note, date: today(), at: now() }));
    closeDialog($('#dlg-tx'));
    toast(tx.type === 'EXPENSE' ? `Расход ${fmt(amount)} записан` : `Доход ${fmt(amount)} записан`);
  });

  // ---------- диалог обязательства ----------
  let obEditId = null;
  function openObDialog(id) {
    const dlg = $('#dlg-ob');
    obEditId = id;
    const o = id ? store.state.obligations.find(x => x.id === id) : null;
    $('#ob-title-h').textContent = o ? 'Изменить платёж' : 'Новый обязательный платёж';
    $('#ob-name').value = o ? o.title : '';
    $('#ob-amount').value = o ? toInput(o.amount) : '';
    $('#ob-date').value = o ? o.dueDate : Engine.dates.addMonthsKeepDay(today(), 1, Engine.dates.dayOf(today()));
    $('#ob-frequency').value = o ? o.frequency : 'MONTHLY';
    $('#ob-submit').textContent = o ? 'Сохранить' : 'Добавить в резерв';
    [$('#ob-name'), $('#ob-amount'), $('#ob-date')].forEach(clearError);
    openDialog(dlg);
  }
  $('#dlg-ob form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#ob-name').value.trim().slice(0, 60);
    if (!title) return setError($('#ob-name'), 'Введите название');
    const amount = Engine.money.parse($('#ob-amount').value);
    if (!amount) return setError($('#ob-amount'), 'Введите сумму больше нуля');
    const dueDate = $('#ob-date').value;
    if (!Engine.dates.isValid(dueDate)) return setError($('#ob-date'), 'Укажите срок');
    const data = { title, amount, dueDate, frequency: $('#ob-frequency').value };
    store.commit(obEditId ? Engine.ops.updateObligation(store.state, obEditId, data) : Engine.ops.addObligation(store.state, data));
    closeDialog($('#dlg-ob'));
    toast(obEditId ? 'Платёж обновлён' : `«${title}» добавлен в резерв`);
  });

  // ---------- диалог цели ----------
  let goalEditId = null;
  function goalFormValues() {
    const targetRaw = $('#goal-target').value, savedRaw = $('#goal-saved').value.trim(), perRaw = $('#goal-per-cycle').value.trim();
    return {
      title: $('#goal-name').value.trim().slice(0, 60),
      target: Engine.money.parse(targetRaw),
      initialSaved: savedRaw ? Engine.money.parse(savedRaw) : 0,
      perCycle: perRaw ? Engine.money.parse(perRaw) : 0,
      deadline: $('#goal-deadline').value || null,
      savedRaw, perRaw,
    };
  }
  function renderGoalHint() {
    const v = goalFormValues(), hint = $('#goal-hint');
    if (!v.target) { hint.textContent = ''; return; }
    const tmp = { id: goalEditId || '__tmp__', title: v.title, target: v.target, initialSaved: v.initialSaved || 0, perCycle: v.perCycle || 0, deadline: v.deadline, createdAt: 0 };
    const p = Engine.calc.goalProjection(store.state, tmp, today());
    const parts = [];
    if (p.remaining === 0) parts.push('Цель уже достигнута.');
    else if (store.state.profile.incomeFrequency === 'ONCE') parts.push('При разовом доходе дату посчитать нельзя — укажите периодичность в настройках.');
    else {
      if (v.perCycle > 0 && p.projectedDate) parts.push(`При ${fmt(v.perCycle)} за цикл — к ${fdate(p.projectedDate)}.`);
      if (v.deadline && p.requiredPerCycle != null) parts.push(`Чтобы успеть к ${fdate(v.deadline)} — нужно ${fmt(p.requiredPerCycle)} за цикл.`);
      if (!v.perCycle && !v.deadline) parts.push('Укажите взнос за цикл или срок — посчитаю дату.');
    }
    hint.textContent = parts.join(' ');
  }
  function openGoalDialog(id) {
    const dlg = $('#dlg-goal');
    goalEditId = id;
    const g = id ? store.state.goals.find(x => x.id === id) : null;
    $('#goal-title-h').textContent = g ? 'Изменить цель' : 'Новая цель';
    $('#goal-name').value = g ? g.title : '';
    $('#goal-target').value = g ? toInput(g.target) : '';
    $('#goal-saved').value = g ? toInput(g.initialSaved) : '';
    $('#goal-per-cycle').value = g ? toInput(g.perCycle) : '';
    $('#goal-deadline').value = g && g.deadline ? g.deadline : '';
    $('#goal-deadline').min = Engine.dates.addDays(today(), 1);
    $('#goal-submit').textContent = g ? 'Сохранить' : 'Добавить цель';
    [$('#goal-name'), $('#goal-target'), $('#goal-saved'), $('#goal-per-cycle'), $('#goal-deadline')].forEach(clearError);
    renderGoalHint();
    openDialog(dlg);
  }
  $('#dlg-goal form').addEventListener('input', renderGoalHint);
  $('#dlg-goal form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = goalFormValues();
    if (!v.title) return setError($('#goal-name'), 'Введите название');
    if (!v.target) return setError($('#goal-target'), 'Введите сумму цели');
    if (v.savedRaw && v.initialSaved == null) return setError($('#goal-saved'), 'Введите сумму или оставьте пустым');
    if (v.perRaw && v.perCycle == null) return setError($('#goal-per-cycle'), 'Введите сумму или оставьте пустым');
    if (v.deadline && (!Engine.dates.isValid(v.deadline) || v.deadline <= today())) return setError($('#goal-deadline'), 'Укажите дату позже сегодняшней');
    const data = { title: v.title, target: v.target, initialSaved: v.initialSaved || 0, perCycle: v.perCycle || 0, deadline: v.deadline };
    store.commit(goalEditId ? Engine.ops.updateGoal(store.state, goalEditId, data) : Engine.ops.addGoal(store.state, data));
    closeDialog($('#dlg-goal'));
    toast(goalEditId ? 'Цель обновлена' : `Цель «${v.title}» добавлена`);
  });
  $('#goal-add').addEventListener('click', () => openGoalDialog(null));
  $('#dash-goal-add').addEventListener('click', () => openGoalDialog(null));

  // ---------- диалог взноса / возврата ----------
  const contrib = { id: null, mode: 'deposit' };
  function openContribDialog(id, mode) {
    const g = store.state.goals.find(x => x.id === id); if (!g) return;
    contrib.id = id; contrib.mode = mode;
    const p = Engine.calc.goalProjection(store.state, g, today());
    $('#contrib-title').textContent = mode === 'deposit' ? `Отложить в «${g.title}»` : `Взять из «${g.title}»`;
    $('#contrib-sub').textContent = mode === 'deposit'
      ? (p.pending > 0 ? `Взнос этого цикла: ${fmt(p.pending)}. Баланс уменьшится, лимит на день не изменится.` : 'Сверх плана: уменьшит свободные деньги этого цикла.')
      : `Накоплено ${fmt(p.saved)}. Сумма вернётся в баланс.`;
    $('#contrib-amount').value = mode === 'deposit' ? toInput(p.pending || g.perCycle) : '';
    $('#contrib-submit').textContent = mode === 'deposit' ? 'Отложить' : 'Вернуть в баланс';
    clearError($('#contrib-amount'));
    openDialog($('#dlg-contrib'));
  }
  $('#dlg-contrib form').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = Engine.money.parse($('#contrib-amount').value);
    if (!amount) return setError($('#contrib-amount'), 'Введите сумму больше нуля');
    try {
      store.commit(contrib.mode === 'deposit'
        ? Engine.ops.contributeToGoal(store.state, contrib.id, amount, { date: today(), at: now() })
        : Engine.ops.withdrawFromGoal(store.state, contrib.id, amount, { date: today(), at: now() }));
    } catch (_) { return setError($('#contrib-amount'), 'Больше, чем накоплено'); }
    closeDialog($('#dlg-contrib'));
    toast(contrib.mode === 'deposit' ? `Отложено ${fmt(amount)}. Лимит на день не изменился` : `${fmt(amount)} возвращены в баланс`);
  });

  // ---------- диалог подтверждения ----------
  function confirmDialog(text, { ok = 'Удалить', danger = true } = {}) {
    const dlg = $('#dlg-confirm');
    $('#confirm-text').textContent = text;
    const okBtn = $('#confirm-ok');
    okBtn.textContent = ok;
    okBtn.className = 'btn ' + (danger ? 'btn--danger' : 'btn--primary');
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (settled) return; settled = true; okBtn.onclick = null; dlg.removeEventListener('close', onClose); resolve(v); closeDialog(dlg); };
      const onClose = () => done(false);
      okBtn.onclick = () => done(true);
      dlg.addEventListener('close', onClose);
      openDialog(dlg);
      setTimeout(() => okBtn.focus(), 60);
    });
  }

  // ---------- история ----------
  let historyFilter = 'all';
  $('#history-filter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]'); if (!b) return;
    historyFilter = b.dataset.filter; renderHistory();
  });
  function renderHistory() {
    for (const b of $$('#history-filter [data-filter]')) {
      const active = b.dataset.filter === historyFilter;
      b.classList.toggle('is-active', active); b.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    const list = store.state.transactions
      .filter(t => historyFilter === 'all' || (historyFilter === 'expense' ? t.type === 'EXPENSE' : t.type === 'INCOME'))
      .slice().sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
    const root = $('#history-list');
    root.replaceChildren();
    if (!list.length) {
      root.append(el('p', { class: 'empty', text: historyFilter === 'all' ? 'История пуста' : 'Нет операций в этом фильтре' }));
      return;
    }
    let cur = null, group = null;
    for (const t of list) {
      if (t.date !== cur) {
        cur = t.date;
        const spent = list.filter(x => x.date === cur && x.type === 'EXPENSE').reduce((a, x) => a + x.amount, 0);
        root.append(el('div', { class: 'group__head' }, [
          el('span', { class: 'group__title', text: capitalize(fdate(cur)) }),
          spent ? el('span', { class: 'group__total money', text: fmt(-spent) }) : null,
        ]));
        group = el('div', { class: 'group card' });
        root.append(group);
      }
      group.append(txRow(t));
    }
  }

  // ---------- резервы ----------
  function renderObligations() {
    const s = store.state;
    const active = s.obligations.filter(o => o.status === 'ACTIVE').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const done = s.obligations.filter(o => o.status === 'DONE');
    $('#ob-list').replaceChildren(...(active.length ? active.map(o => obligationRow(o))
      : [el('p', { class: 'empty', text: 'Пока нет обязательных платежей. Добавьте аренду, кредит, связь — всё, что точно придётся заплатить до зарплаты.' })]));
    $('#ob-done').hidden = !done.length;
    $('#ob-done-list').replaceChildren(...done.map(o => obligationRow(o)));
    const obRes = Engine.calc.reserved(s), goalRes = Engine.calc.goalsReserve(s);
    $('#ob-total').textContent = goalRes ? `${fmt(obRes + goalRes)} (платежи ${fmt(obRes)} · цели ${fmt(goalRes)})` : fmt(obRes);
    const activeGoals = Engine.calc.activeGoals(s);
    const doneGoals = s.goals.filter(g => Engine.calc.goalDone(s, g));
    $('#goal-list').replaceChildren(...(activeGoals.length ? activeGoals.map(g => goalCard(g))
      : [el('p', { class: 'empty', text: 'Пока нет целей. Квартира, той, машина, отпуск — приложение посчитает дату и будет откладывать взнос с каждой зарплаты.' })]));
    $('#goal-done').hidden = !doneGoals.length;
    $('#goal-done-list').replaceChildren(...doneGoals.map(g => goalCard(g)));
  }
  $('#ob-add').addEventListener('click', () => openObDialog(null));

  // ---------- настройки ----------
  function renderSettings() {
    const s = store.state, p = s.profile, f = Engine.calc.forecast(s, today());
    const form = $('#settings-form');
    form.nextIncomeDate.value = p.nextIncomeDate || '';
    form.incomeFrequency.value = p.incomeFrequency;
    form.expectedIncome.value = toInput(p.expectedIncome);
    form.safetyBuffer.value = toInput(p.safetyBuffer);
    form.currency.value = p.currency;
    $('#settings-buffer-hint').textContent = p.safetyBuffer ? `Сейчас: ${fmt(p.safetyBuffer)} не участвуют в дневном лимите` : 'Сейчас: без буфера';
    $('#settings-balance').textContent = fmt(f.balance);
    $('#adjust-form').newBalance.value = '';
  }
  // Поля сохраняются сразу при изменении
  $('#settings-form').addEventListener('change', (e) => {
    const form = e.currentTarget, name = e.target.name, patch = {};
    if (name === 'nextIncomeDate') {
      if (!Engine.dates.isValid(form.nextIncomeDate.value)) return setError(form.nextIncomeDate, 'Укажите дату');
      patch.nextIncomeDate = form.nextIncomeDate.value;
    } else if (name === 'incomeFrequency') {
      patch.incomeFrequency = form.incomeFrequency.value;
    } else if (name === 'currency') {
      patch.currency = form.currency.value;
    } else if (name === 'expectedIncome') {
      const raw = form.expectedIncome.value.trim();
      const v = raw ? Engine.money.parse(raw) : null;
      if (raw && !v) return setError(form.expectedIncome, 'Введите сумму или оставьте пустым');
      patch.expectedIncome = v;
    } else if (name === 'safetyBuffer') {
      const raw = form.safetyBuffer.value.trim();
      const v = raw ? Engine.money.parse(raw) : 0;
      if (raw && v == null) return setError(form.safetyBuffer, 'Введите сумму или оставьте пустым');
      patch.safetyBuffer = v;
    } else {
      return;
    }
    store.commit(Engine.ops.setProfile(store.state, patch));
    toast('Сохранено');
  });
  $('#buffer-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pct]'); if (!b) return;
    const pct = Number(b.dataset.pct), bal = Math.max(0, Engine.calc.balance(store.state));
    store.commit(Engine.ops.setProfile(store.state, { safetyBuffer: Math.round(bal * pct / 100) }));
    toast(pct ? `Буфер ${pct} % от баланса: ${fmt(store.state.profile.safetyBuffer)}` : 'Буфер отключён');
  });
  $('#adjust-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.currentTarget.newBalance;
    const raw = input.value.trim().replace(/[\s ]/g, '').replace(',', '.');
    const negative = raw.startsWith('-');
    const body = negative ? raw.slice(1) : raw;
    const v = Engine.money.parse(body);
    if (v == null && !/^0([.,]0{1,2})?$/.test(body)) return setError(input, 'Введите фактический баланс');
    const target = v == null ? 0 : (negative ? -v : v);
    store.commit(Engine.ops.adjustBalance(store.state, target, { date: today(), at: now() }));
    toast(`Баланс скорректирован: ${fmt(target)}`);
  });

  // ---------- данные: экспорт, импорт, демо, сброс ----------
  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(store.state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `finforecast-${today()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Файл с данными скачан');
  });
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let next;
    try { next = Engine.migrate(JSON.parse(await file.text())); }
    catch (_) { return toast('Файл не похож на экспорт приложения'); }
    if (await confirmDialog('Заменить текущие данные данными из файла?', { ok: 'Заменить' })) {
      store.corrupt = false; store.commit(next); toast('Данные импортированы');
    }
  });
  $('#btn-demo').addEventListener('click', async () => {
    if (await confirmDialog('Заменить все данные демонстрационными?', { ok: 'Заменить' })) {
      store.commit(Engine.demoState(today())); showTab('dashboard'); toast('Демо-данные загружены');
    }
  });
  $('#btn-rerun').addEventListener('click', () => {
    onb.step = 1; onb.currency = store.state.profile.currency;
    store.state.profile.onboarded = false; // без сохранения: перезагрузка вернёт прежнее состояние
    render(); window.scrollTo(0, 0);
  });
  $('#btn-reset').addEventListener('click', async () => {
    if (await confirmDialog('Удалить все данные без возможности восстановления?')) { store.clear(); toast('Данные удалены'); }
  });

  // ---------- горячие клавиши ----------
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const openDialogs = $$('dialog').filter(d => d.open);
    if (e.key === 'Escape' && openDialogs.length) { e.preventDefault(); closeDialog(openDialogs[openDialogs.length - 1]); return; }
    const tag = document.activeElement ? document.activeElement.tagName : '';
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || openDialogs.length > 0;
    if (!typing && /^[nNтТ]$/.test(e.key) && store.state.profile.onboarded) { e.preventDefault(); openTxDialog({ mode: 'expense' }); }
  });

  // ---------- смена дня при открытой вкладке ----------
  function tick() { if (today() !== renderedToday) render(); }
  setInterval(tick, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

  // ---------- запуск ----------
  store.load();
  render();
})();
