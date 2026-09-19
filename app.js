// app.js — хранение, рендер, диалоги, обработчики. Вся арифметика — в engine.js.
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
    commit(next) {
      const before = milestones(this.state);
      this.state = next;
      this.save();
      render();
      const after = milestones(next);
      for (const g of next.goals) {
        if ((after[g.id] || 0) > (before[g.id] || 0) && after[g.id] > 0) queueMilestone(`Веха: «${g.title}» — ${after[g.id] * 25} %`);
      }
    },
    clear() {
      try { localStorage.removeItem(KEY); } catch (_) { /* нечего делать */ }
      this.state = Engine.defaultState(); this.corrupt = false; setUnlocked(false); render();
    },
  };
  function milestones(s) {
    const m = {};
    if (!s) return m;
    for (const g of s.goals) m[g.id] = Math.min(4, Math.floor(Engine.calc.goalProjection(s, g, today()).progress * 4));
    return m;
  }
  const fmt = (minor, opts) => Engine.money.format(minor, store.state.profile.currency, opts);
  const fmtWhole = (minor) => fmt(Math.floor(minor / 100) * 100); // дневные суммы — в целых единицах, вниз
  const fnum = (minor) => Engine.money.formatNumber(minor);
  const fdate = (ymd) => Engine.dates.format(ymd, { today: today() });
  const ftime = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
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

  // ---------- тост с отменой; вехи целей подклеиваются к ближайшему тосту ----------
  let toastTimer = null, toastUndo = null, pendingMilestone = null, milestoneTimer = null;
  function toast(text, { undo, action, sticky = false } = {}) {
    const t = $('#toast'), u = $('#toast-undo');
    let msg = text;
    if (pendingMilestone) { msg += ' · ' + pendingMilestone; pendingMilestone = null; clearTimeout(milestoneTimer); }
    $('#toast-text').textContent = msg;
    toastUndo = action ? action.fn : (undo || null);
    u.textContent = action ? action.label : 'Отменить';
    u.hidden = !toastUndo;
    t.hidden = false;
    requestAnimationFrame(() => t.classList.add('is-visible'));
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(hideToast, 5000);
  }
  function queueMilestone(text) {
    pendingMilestone = text;
    clearTimeout(milestoneTimer);
    milestoneTimer = setTimeout(() => { if (pendingMilestone) { const m = pendingMilestone; pendingMilestone = null; toast(m); } }, 400);
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
    const locked = isLocked();
    document.body.classList.toggle('is-locked', locked);
    if (locked) {
      for (const v of $$('.view')) v.hidden = v.id !== 'view-lock';
      $('#corrupt-banner').hidden = true;
      clearRendered();
      renderLock();
      return;
    }
    const onboarding = !s.profile.onboarded;
    const tab = onboarding ? 'onboarding' : s.ui.tab;
    for (const v of $$('.view')) v.hidden = v.id !== 'view-' + tab;
    $('#sidebar-logout').hidden = onboarding;
    for (const n of $$('.nav-item, .tab-item')) {
      if (n.dataset.tab === tab) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
    }
    $('#fab').hidden = false;
    document.body.classList.toggle('is-onboarding', onboarding);
    $('#corrupt-banner').hidden = !store.corrupt;
    for (const c of $$('.cur')) c.textContent = Engine.money.CURRENCIES[s.profile.currency];
    ({ dashboard: renderDashboard, history: renderHistory, obligations: renderObligations, settings: renderSettings, onboarding: renderOnboarding })[tab]();
  }
  // Системная кнопка «Назад» (телефон, браузер): вкладки, шторки и шаги настройки — в истории браузера
  let navBusy = false;
  // История браузера держится плоской: [главная] → [раздел] → [шторка].
  // Системная «Назад»: закрыть шторку → вернуться на главную → выйти из приложения.
  function showTab(tab, { push = true } = {}) {
    store.commit(Engine.ops.setTab(store.state, tab));
    window.scrollTo(0, 0);
    if (!push) return;
    try {
      const st = history.state || {};
      if (tab === 'dashboard') {
        if (st.level === 1) history.back();
        else history.replaceState({ tab: 'dashboard', level: 0 }, '', '#dashboard');
      } else if (st.level === 1) {
        history.replaceState({ tab, level: 1 }, '', '#' + tab);
      } else {
        history.pushState({ tab, level: 1 }, '', '#' + tab);
      }
    } catch (_) { /* file:// */ }
  }
  window.addEventListener('popstate', (e) => {
    const st = e.state || {};
    const open = $$('dialog').filter(d => d.open);
    if (open.length) { navBusy = true; for (const d of open) d.close(); navBusy = false; }
    if (st.onb && !store.state.profile.onboarded) { onb.step = st.onb; render(); return; }
    if (st.tab && store.state.profile.onboarded && Engine.TABS.includes(st.tab) && st.tab !== store.state.ui.tab) showTab(st.tab, { push: false });
  });
  document.addEventListener('click', (e) => {
    const n = e.target.closest('[data-tab]');
    if (!n) return;
    e.preventDefault();
    if (!store.state.profile.onboarded) return;
    showTab(n.dataset.tab);
  });
  $('#fab').addEventListener('click', () => openTxDialog({ mode: 'expense' }));
  $('#fab-income').addEventListener('click', () => openTxDialog({ mode: 'income' }));
  $('#sidebar-add').addEventListener('click', () => openTxDialog({ mode: 'expense' }));
  $('#sidebar-income').addEventListener('click', () => openTxDialog({ mode: 'income' }));
  $('#dash-add-expense').addEventListener('click', () => openTxDialog({ mode: 'expense' }));
  $('#dash-add-income').addEventListener('click', () => openTxDialog({ mode: 'income' }));

  // ---------- главная ----------
  const HERO_CLASS = { HEALTHY: 'ok', WARNING: 'warn', CRITICAL: 'bad', PAYDAY: 'payday' };
  function renderDashboard() {
    const s = store.state, t = today(), f = Engine.calc.forecast(s, t);
    const streak = Engine.calc.coverageStreak(s, t);
    $('#h-dashboard').textContent = capitalize(new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }));
    const st = $('#dash-streak');
    st.hidden = streak.days < 2;
    st.textContent = `${streak.days} дн. под контролем`;
    st.title = 'Дней подряд, за которые известны траты';
    renderHero(f);
    renderStats(f);
    renderFirstSteps(streak);
    renderDue();
    $('#dash-goals').replaceChildren(...Engine.calc.activeGoals(s).map(g => goalCard(g, { compact: true })));
    const txs = s.transactions.filter(x => x.date === t).sort((a, b) => b.at - a.at).slice(0, 5);
    $('#dash-recent').replaceChildren(...(txs.length ? txs.map(x => txRow(x, { compact: true }))
      : [el('div', { class: 'empty' }, [el('span', { text: 'Сегодня трат ещё не было' }), el('button', { type: 'button', class: 'btn btn--small btn--ghost', text: 'Записать трату', onclick: () => openTxDialog({ mode: 'expense' }) })])]));
    $('#checkin').hidden = streak.todayKnown || f.status === 'PAYDAY' || new Date().getHours() < 17;
    renderAfford();
  }

  function heroFoot(f) {
    const s = store.state, t = today();
    const link = el('button', { type: 'button', class: 'link', text: 'Как посчитано?', onclick: () => openInfo(f) });
    let text = f.subtitle, cls = '';
    if (f.status === 'HEALTHY') {
      const pace = Engine.calc.pace(s, t);
      if (pace && pace.runOutDate) { text = `При текущем темпе (${fmtWhole(pace.avgDaily)} в день) деньги закончатся ${fdate(pace.runOutDate)} — до зарплаты не хватит`; cls = 'is-late'; }
      else if (pace && pace.leftoverAtPayday > 0) text = `При текущем темпе к зарплате останется ≈ ${fmtWhole(pace.leftoverAtPayday)}`;
    } else if (f.status === 'WARNING') {
      text = f.daysRemaining > 1 ? `Завтра — по ${fmtWhole(Math.floor(f.free / (f.daysRemaining - 1)))} в день` : 'Завтра зарплата — новый цикл';
    } else if (f.status === 'CRITICAL') {
      text = `До зарплаты ${f.daysRemaining} дн. · ${fdate(f.nextIncomeDate)}`;
    }
    return el('div', { class: 'hero__foot' }, [el('span', { class: cls, text }), link]);
  }

  function renderHero(f) {
    const s = store.state, t = today();
    const hero = $('#hero');
    hero.replaceChildren();
    hero.className = 'hero hero--' + (f.status === 'CRITICAL' && f.gapKind === 'soft' ? 'soft' : HERO_CLASS[f.status]);
    if (f.status === 'PAYDAY') {
      const dateInput = el('input', { type: 'date', class: 'field', min: Engine.dates.addDays(t, 1), 'aria-label': 'Новая дата зарплаты' });
      hero.append(
        el('div', { class: 'hero__head' }, [el('span', { class: 'label-caps', text: 'Зарплата' }), el('span', { class: 'badge badge--ok', text: f.daysRemaining === 0 ? 'Сегодня' : 'Была ' + fdate(f.nextIncomeDate) })]),
        el('h2', { class: 'hero__title', text: f.title }),
        el('p', { class: 'hero__sub', text: 'Подтвердите — и я посчитаю новый цикл' }),
        el('div', { class: 'hero__actions' }, [
          el('button', { class: 'btn btn--primary', type: 'button', text: s.profile.expectedIncome ? `Получил(а) ${fmt(s.profile.expectedIncome)}` : 'Получил(а) зарплату', onclick: () => openTxDialog({ mode: 'payday' }) }),
        ]),
        el('div', { class: 'hero__late' }, [
          el('span', { text: 'Задерживается? Новая дата:' }),
          dateInput,
          el('button', { class: 'btn btn--small btn--ghost', type: 'button', text: 'Сохранить', onclick: () => {
            const d = dateInput.value;
            if (!Engine.dates.isValid(d) || d <= t) { toast('Укажите дату позже сегодняшней'); return; }
            store.commit(Engine.ops.setProfile(store.state, { nextIncomeDate: d })); toast(`Зарплата перенесена на ${fdate(d)}`);
          } }),
          el('button', { class: 'btn btn--small btn--ghost', type: 'button', text: 'Завтра', onclick: () => { store.commit(Engine.ops.postponePayday(store.state, t)); toast('Перенесено на завтра'); } }),
        ]),
      );
      return;
    }
    if (f.status === 'CRITICAL') {
      const soft = f.gapKind === 'soft';
      const plan = Engine.calc.deficitPlan(s, t);
      const labelFor = (o) => o.type === 'postponeObligation' ? `Перенести «${o.title}» после зарплаты`
        : o.type === 'skipGoal' ? `Пропустить взнос в «${o.title}» в этом цикле` : 'Использовать запас';
      const actFor = (o) => () => {
        if (o.type === 'postponeObligation') { store.commit(Engine.ops.postponeObligation(store.state, o.id)); toast(`«${o.title}» перенесён после зарплаты`); }
        else if (o.type === 'skipGoal') { store.commit(Engine.ops.skipGoalCycle(store.state, o.id)); toast(`Взнос в «${o.title}» пропущен в этом цикле`); }
        else { const prev = store.state.profile.safetyBuffer; store.commit(Engine.ops.setProfile(store.state, { safetyBuffer: 0 })); toast('Запас разморожен', { undo: () => { store.commit(Engine.ops.setProfile(store.state, { safetyBuffer: prev })); toast('Запас восстановлен'); } }); }
      };
      hero.append(
        el('div', { class: 'hero__head' }, [el('span', { class: 'label-caps', text: soft ? 'Не хватает на цели и запас' : 'Не хватает до зарплаты' }), el('span', { class: 'badge', text: soft ? 'Платежи в порядке' : 'Дефицит' })]),
        el('div', { class: 'hero__value', text: fmtWhole(f.cashGap) }),
        el('div', { class: 'hero__sub', text: f.subtitle }),
        el('div', { class: 'hero__bar', role: 'progressbar', 'aria-label': 'Дефицит', 'aria-valuenow': 100, 'aria-valuemin': 0, 'aria-valuemax': 100 }, el('div', { class: 'hero__fill', style: 'width:100%' })),
      );
      if (plan && plan.options.length) {
        hero.append(el('div', { class: 'plan' }, [
          el('span', { class: 'plan__title', text: 'Что можно сделать' }),
          ...plan.options.slice(0, 3).map(o => el('button', { type: 'button', class: 'plan__btn', onclick: actFor(o) }, [el('span', { text: labelFor(o) }), el('b', { text: '+' + fnum(o.effect) })])),
          el('button', { type: 'button', class: 'plan__btn', onclick: () => openTxDialog({ mode: 'income' }) }, [el('span', { text: 'Записать доход' }), icon('chevron-right')]),
          el('span', { class: 'hint', text: `Или тратить на ${fmtWhole(plan.dailyCut)} в день меньше до зарплаты` }),
        ]));
      }
      hero.append(heroFoot(f));
      return;
    }
    const label = 'Осталось на сегодня';
    const value = f.status === 'WARNING' ? 0 : f.remainingToday;
    const badge = { HEALTHY: 'Всё по плану', WARNING: 'На сегодня всё' }[f.status];
    const pct = f.status === 'HEALTHY' && f.budgetToday > 0 ? Math.min(100, Math.round(f.spentToday / f.budgetToday * 100)) : 100;
    const sub = f.status === 'HEALTHY' ? `из ${fmtWhole(f.budgetToday)} · потрачено ${fmt(f.spentToday)}`
      : `Потрачено ${fmt(f.spentToday)} из ${fmtWhole(f.budgetToday)} — на ${fmt(f.overspentToday)} больше`;
    hero.append(
      el('div', { class: 'hero__head' }, [el('span', { class: 'label-caps', text: label }), el('span', { class: 'badge', text: badge })]),
      el('div', { class: 'hero__value', text: fmtWhole(value) }),
      el('div', { class: 'hero__sub', text: sub }),
      el('div', { class: 'hero__bar', role: 'progressbar', 'aria-label': 'Потрачено сегодня', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuetext': `потрачено ${fmt(f.spentToday)} из ${fmtWhole(f.budgetToday)}` }, el('div', { class: 'hero__fill', style: `width:${pct}%` })),
      heroFoot(f),
    );
  }

  function renderStats(f) {
    const s = store.state;
    const saved = s.goals.reduce((a, g) => a + Math.max(0, Engine.calc.goalSaved(s, g) - (g.initialSaved || 0)), 0);
    const parts = [];
    if (f.obligationsReserve) parts.push(`платежи ${fnum(f.obligationsReserve)}`);
    if (f.goalsReserve) parts.push(`цели ${fnum(f.goalsReserve)}`);
    if (f.buffer) parts.push(`запас ${fnum(f.buffer)}`);
    const cycle = Engine.calc.cycleSummary(s, today());
    const moneySub = cycle.income > 0 ? `получено за цикл +${fnum(cycle.income)}` : (saved ? `без накоплений (${fnum(saved)} в целях)` : 'на жизнь');
    $('#stats').replaceChildren(
      stat('Всего денег', fmt(f.balance), moneySub),
      f.free < 0 ? stat('Не хватает', fmt(-f.free), 'до зарплаты', true) : stat('Можно тратить', fmt(f.free), 'до зарплаты'),
      stat('Отложено', fmt(f.reserved + f.buffer), parts.join(' · ') || 'платежи и цели'),
      stat('До зарплаты', f.daysRemaining > 0 ? `${f.daysRemaining} дн.` : '—', f.nextIncomeDate ? fdate(f.nextIncomeDate) : null),
    );
  }
  const stat = (label, value, sub, bad = false) => el('div', { class: 'stat' }, [
    el('span', { class: 'stat__label', text: label }),
    el('span', { class: 'stat__value num' + (bad ? ' is-bad' : ''), text: value }),
    sub ? el('span', { class: 'stat__sub', text: sub }) : null,
  ]);

  function renderFirstSteps(streak) {
    const s = store.state;
    const steps = [
      { title: 'Добавьте обязательные платежи', sub: 'Аренда, кредит, связь — иначе цифра на день завышена', done: s.obligations.length > 0, btn: 'Добавить', act: () => openObDialog(null) },
      { title: 'Запишите первую трату', sub: 'Кнопка «Трата» внизу экрана', done: s.transactions.some(t => t.type === 'EXPENSE'), btn: 'Записать', act: () => openTxDialog({ mode: 'expense' }) },
      { title: 'Вечером — одна цифра за день', sub: 'Два вечера подряд — и привычка есть', done: streak.days >= 2, btn: null },
      { title: 'Есть цель? Добавьте её', sub: 'Покажу, к какой дате накопите (необязательно)', done: s.goals.length > 0, btn: 'Добавить', act: () => openGoalDialog(null) },
    ];
    const requiredDone = steps.slice(0, 3).filter(x => x.done).length;
    const card = $('#first-steps');
    card.hidden = requiredDone === 3;
    if (card.hidden) return;
    $('#steps-count').textContent = `${requiredDone} из 3`;
    $('#steps-list').replaceChildren(...steps.map((x, i) => el('li', { class: 'step' + (x.done ? ' is-done' : '') }, [
      el('span', { class: 'step__mark' }, x.done ? icon('check') : String(i + 1)),
      el('div', { class: 'step__body' }, [el('span', { class: 'step__title', text: x.title }), el('span', { class: 'step__sub', text: x.sub })]),
      !x.done && x.btn ? el('button', { type: 'button', class: 'btn btn--small btn--ghost', text: x.btn, onclick: x.act }) : null,
    ])));
  }

  function dueBadge(o) {
    const t = today();
    const d = Engine.dates.daysBetween(t, o.dueDate);
    if (d < 0) return el('span', { class: 'badge badge--bad', text: d === -1 ? 'просрочен на 1 день' : `просрочен на ${-d} дн.` });
    if (d === 0) return el('span', { class: 'badge badge--warn', text: 'сегодня' });
    if (d === 1) return el('span', { class: 'badge badge--warn', text: 'завтра' });
    if (d <= 3) return el('span', { class: 'badge badge--warn', text: `через ${d} дн.` });
    return null;
  }
  function renderDue() {
    const s = store.state;
    const sec = $('#due');
    sec.hidden = s.obligations.length === 0;
    if (sec.hidden) return;
    const obs = Engine.calc.reservedObligations(s).slice(0, 3);
    $('#dash-obligations').replaceChildren(...(obs.length ? obs.map(o => obligationRow(o, { compact: true }))
      : [el('div', { class: 'empty' }, [el('span', { text: 'До зарплаты платежей нет — следующие после неё' })])]));
  }

  // ---------- строки списков ----------
  function deleteTx(id) {
    const { state, removed } = Engine.ops.deleteTransaction(store.state, id);
    if (!removed) return;
    store.commit(state);
    toast('Запись удалена', { undo: () => { store.commit(Engine.ops.restoreTransaction(store.state, removed)); toast('Запись восстановлена'); } });
  }
  function txRow(t, { compact = false } = {}) {
    const isIn = t.type === 'INCOME', isAdj = t.type === 'ADJUSTMENT', isSaving = t.type === 'SAVING';
    const inflow = isIn || (isSaving && t.amount < 0);
    const title = isSaving ? (t.amount > 0 ? `Взнос в «${t.note}»` : `Из цели «${t.note}»`) : (t.note || t.category);
    const sub = isAdj ? 'Корректировка баланса' : isSaving ? 'Накопление' : `${t.note ? t.category + ' · ' : ''}${ftime(t.at)}`;
    const amount = isAdj || isIn ? fmt(t.amount, { sign: true }) : isSaving ? fmt(-t.amount, { sign: true }) : fmt(-t.amount);
    return el('div', { class: 'row' + (compact ? ' row--compact' : '') }, [
      el('span', { class: 'row__icon' + (inflow ? ' row__icon--in' : '') }, icon(isIn ? 'arrow-in' : isAdj ? 'settings' : isSaving ? 'sparkle' : t.obligationId ? 'repeat' : 'receipt')),
      el('div', { class: 'row__body' }, [el('span', { class: 'row__title', text: title }), el('span', { class: 'row__sub', text: sub })]),
      el('span', { class: 'row__amount money' + (inflow ? ' is-in' : ''), text: amount }),
      compact ? null : el('div', { class: 'row__actions' }, el('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Удалить запись', onclick: () => deleteTx(t.id) }, icon('trash'))),
    ]);
  }
  function payOb(o) {
    store.commit(Engine.ops.payObligation(store.state, o.id, { date: today(), at: now() }));
    const tx = store.state.transactions[0];
    toast(`«${o.title}» отмечен оплаченным`, { undo: () => { const r = Engine.ops.deleteTransaction(store.state, tx.id); store.commit(r.state); toast('Отменено'); } });
  }
  const obMoreOpen = new Set();
  function obligationRow(o, { compact = false } = {}) {
    const s = store.state, t = today();
    const reserved = s.profile.nextIncomeDate && o.dueDate < s.profile.nextIncomeDate;
    const due = dueBadge(o);
    if (compact) {
      return el('div', { class: 'row row--compact' }, [
        el('div', { class: 'row__body' }, [
          el('span', { class: 'row__title', text: o.title }),
          el('span', { class: 'row__sub' }, [el('b', { class: 'num', text: fmt(o.amount) }), due || el('span', { text: `срок ${fdate(o.dueDate)}` })]),
        ]),
        el('div', { class: 'row__actions' }, el('button', { type: 'button', class: 'btn btn--small', text: 'Оплатил(а)', onclick: () => payOb(o) })),
      ]);
    }
    const statusBadge = o.status === 'DONE' ? el('span', { class: 'badge badge--muted', text: 'Завершён' })
      : due || (reserved ? el('span', { class: 'badge badge--muted', text: 'Учтён' }) : el('span', { class: 'badge badge--muted', text: 'После зарплаты' }));
    const paidAt = s.transactions.filter(x => x.obligationId === o.id && x.date >= (s.profile.cycleStartDate || '')).sort((a, b) => b.at - a.at).map(x => x.date)[0] || null;
    const more = obMoreOpen.has(o.id);
    const actions = o.status === 'DONE'
      ? [el('button', { type: 'button', class: 'btn btn--small btn--ghost', text: 'Вернуть', onclick: () => { store.commit(Engine.ops.reactivateObligation(store.state, o.id)); toast('Платёж снова активен'); } }),
         el('span', { class: 'spacer' }),
         el('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Удалить платёж', onclick: () => removeOb(o) }, icon('trash'))]
      : [el('button', { type: 'button', class: 'btn btn--small btn--primary', text: 'Оплатил(а)', onclick: () => payOb(o) }),
         el('button', { type: 'button', class: 'btn btn--small btn--ghost', text: 'Пропустить', onclick: async () => {
           if (await confirmDialog(`Пропустить «${o.title}» в этот раз? Срок сдвинется на следующий, без списания.`, { ok: 'Пропустить', danger: false })) { store.commit(Engine.ops.skipObligation(store.state, o.id)); toast('Платёж пропущен'); }
         } }),
         el('span', { class: 'spacer' }),
         el('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Ещё действия', 'aria-expanded': more ? 'true' : 'false', onclick: () => { if (more) obMoreOpen.delete(o.id); else obMoreOpen.add(o.id); renderObligations(); } }, icon('more'))];
    return el('div', { class: 'ob' + (o.status === 'DONE' ? ' is-done' : '') }, [
      el('span', { class: 'ob__title', text: o.title }),
      el('span', { class: 'ob__amount', text: fmt(o.amount) }),
      el('span', { class: 'ob__meta' }, [
        statusBadge,
        el('span', { text: `срок ${fdate(o.dueDate)}` }),
        el('span', { text: '·' }),
        el('span', { text: o.frequency === 'MONTHLY' ? 'каждый месяц' : 'один раз' }),
        paidAt ? el('span', { text: '·' }) : null,
        paidAt ? el('span', { class: 'ob__paid', text: `оплачен ${fdate(paidAt)}` }) : null,
      ]),
      el('div', { class: 'ob__actions' }, actions),
      more && o.status !== 'DONE' ? el('div', { class: 'ob__more' }, [
        el('button', { type: 'button', class: 'btn btn--small btn--ghost', text: 'Изменить', onclick: () => openObDialog(o.id) }),
        el('button', { type: 'button', class: 'btn btn--small btn--danger', text: 'Удалить', onclick: () => removeOb(o) }),
      ]) : null,
    ]);
  }
  async function removeOb(o) {
    if (await confirmDialog(`Удалить «${o.title}»? История оплат сохранится.`)) {
      obMoreOpen.delete(o.id);
      store.commit(Engine.ops.deleteObligation(store.state, o.id)); toast('Платёж удалён');
    }
  }

  // ---------- цели ----------
  function goalCard(g, { compact = false } = {}) {
    const s = store.state, t = today();
    const p = Engine.calc.goalProjection(s, g, t);
    const done = p.remaining === 0;
    const late = !done && g.deadline && p.onTrack === false;
    const milestone = Math.min(4, Math.floor(p.progress * 4));
    const meta = [];
    if (done) meta.push(el('span', { class: 'is-ok', text: 'Цель достигнута' }));
    else if (p.projectedDate) {
      meta.push(el('span', { text: `При ${fmt(g.perCycle)} с каждой зарплаты — к ${fdate(p.projectedDate)}` }));
      if (g.deadline) meta.push(late
        ? el('span', { class: 'is-late', text: `К ${fdate(g.deadline)} не успеть — нужно ${fmt(p.requiredPerCycle)} с каждой зарплаты` })
        : el('span', { class: 'is-ok', text: `Успеваете к ${fdate(g.deadline)}` }));
    } else if (g.deadline && p.requiredPerCycle != null) {
      meta.push(el('span', { class: g.perCycle ? 'is-late' : '', text: `Чтобы успеть к ${fdate(g.deadline)} — нужно ${fmt(p.requiredPerCycle)} с каждой зарплаты` }));
    } else {
      meta.push(el('span', { text: 'Укажите, сколько откладывать с зарплаты — покажу дату' }));
    }
    if (!done && g.perCycle > 0) meta.push(el('span', { text: p.pending > 0 ? `С этой зарплаты осталось отложить ${fmt(p.pending)}` : (g.skippedCycle === s.profile.cycleStartDate ? 'Взнос в этом цикле пропущен' : 'Взнос с этой зарплаты сделан') }));
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
        el('div', { class: 'row__body' }, [
          el('span', { class: 'goal__title', text: g.title }),
          el('span', { class: 'goal__amounts' }, [el('b', { text: fnum(p.saved) }), ` из ${fmt(g.target)}`]),
        ]),
        milestone > 0 && !done ? el('span', { class: 'badge badge--ok', text: `${milestone * 25} %` }) : null,
      ]),
      el('div', { class: 'goal__bar', role: 'progressbar', 'aria-label': `Цель «${g.title}»`, 'aria-valuenow': Math.round(p.progress * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 },
        el('div', { class: 'goal__fill', style: `width:${Math.round(p.progress * 100)}%` })),
      el('div', { class: 'goal__meta' }, meta),
      actions.length ? el('div', { class: 'goal__actions' }, actions) : null,
    ]);
  }
  async function removeGoal(g) {
    const net = store.state.transactions.filter(t => t.type === 'SAVING' && t.goalId === g.id).reduce((a, t) => a + t.amount, 0);
    const text = net > 0 ? `Удалить «${g.title}»? Отложенные через приложение ${fmt(net)} вернутся в деньги на жизнь.` : `Удалить «${g.title}»?`;
    if (await confirmDialog(text)) {
      store.commit(Engine.ops.deleteGoal(store.state, g.id, { date: today(), at: now() }));
      toast('Цель удалена');
    }
  }

  // ---------- «Могу ли я?» ----------
  let affordAmount = null;
  const AFFORD_CLASS = { YES: 'ok', YES_BUT: 'warn', NO_BUFFER: 'bad', NO: 'bad', CRITICAL: 'bad', PAYDAY: 'muted' };
  function renderAfford() {
    const box = $('#afford-result');
    $('#afford-clear').hidden = !$('#afford-amount').value;
    if (affordAmount == null) { box.hidden = true; return; }
    const r = Engine.calc.canAfford(store.state, today(), affordAmount);
    box.className = 'callout callout--' + AFFORD_CLASS[r.verdict];
    $('#afford-lines').replaceChildren(...r.lines.map(l => el('p', { text: l })));
    const rec = $('#afford-record');
    rec.hidden = r.verdict === 'PAYDAY';
    rec.textContent = r.verdict === 'YES' || r.verdict === 'YES_BUT' ? 'Записать как трату' : 'Всё равно записать';
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
  $('#afford-amount').addEventListener('input', () => {
    $('#afford-clear').hidden = !$('#afford-amount').value;
    if (affordAmount != null && !Engine.money.parse($('#afford-amount').value)) { affordAmount = null; renderAfford(); }
  });
  $('#afford-record').addEventListener('click', () => { if (affordAmount) openTxDialog({ mode: 'expense', amount: affordAmount }); });
  $('#afford-clear').addEventListener('click', () => { affordAmount = null; $('#afford-amount').value = ''; renderAfford(); $('#afford-amount').focus(); });

  // ---------- вечерний итог ----------
  $('#checkin').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#checkin-amount');
    const v = Engine.money.parse(input.value);
    if (!v) return setError(input, 'Введите сумму или нажмите «Сегодня без трат»');
    store.commit(Engine.ops.addTransaction(store.state, { type: 'EXPENSE', amount: v, category: 'День', note: 'Итог дня', date: today(), at: now() }));
    input.value = '';
    toast(`Записано ${fmt(v)} за сегодня`);
  });
  $('#checkin-amount').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#checkin').requestSubmit(); } });
  $('#checkin-zero').addEventListener('click', () => { store.commit(Engine.ops.markNoSpend(store.state, today())); toast('Отмечено: сегодня без трат'); });

  // ---------- «Как посчитано?» ----------
  function openInfo(f) {
    const rows = [];
    const add = (k, v, total) => rows.push(el('dt', { class: total ? 'is-total' : '', text: k }), el('dd', { class: total ? 'is-total' : '', text: v }));
    add('Всего денег', fmt(f.balance));
    if (f.obligationsReserve) add('− платежи до зарплаты', fmt(f.obligationsReserve));
    if (f.goalsReserve) add('− взносы в цели', fmt(f.goalsReserve));
    if (f.buffer) add('− запас', fmt(f.buffer));
    add('= можно тратить до зарплаты', fmt(f.free), true);
    if (f.daysRemaining > 0) {
      add('÷ дней до зарплаты (с сегодняшним)', String(f.daysRemaining));
      add('= на день', fmtWhole(f.budgetToday), true);
      add('− потрачено сегодня', fmt(f.spentToday));
      add('= осталось на сегодня', fmtWhole(f.remainingToday), true);
    }
    $('#info-lines').replaceChildren(...rows);
    openDialog($('#dlg-info'));
  }

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
      $('#onb-result').textContent = f.status === 'HEALTHY' ? `Сегодня можно потратить ${fmtWhole(f.budgetToday)}` : f.title;
    }
  }
  $('#onb-currency').addEventListener('click', (e) => { const b = e.target.closest('[data-currency]'); if (!b) return; onb.currency = b.dataset.currency; renderOnboarding(); });
  function onbGo(step) { onb.step = step; render(); try { history.pushState({ onb: step }, ''); } catch (_) { /* file:// */ } }
  $('#onb-next-1').addEventListener('click', () => { onbGo(2); $('#onb-balance').focus(); });
  $('#onb-demo').addEventListener('click', () => { store.commit(Engine.demoState(today())); toast('Это пример. Начать заново: Настройки → Удалить все данные'); });
  $('#onb-next-2').addEventListener('click', () => {
    if (!validate($('#onb-balance'), Engine.money.parse, 'Введите сумму больше нуля')) return;
    onbGo(3); $('#onb-date').focus();
  });
  $('#onb-back-2').addEventListener('click', () => onbGo(1));
  $('#onb-back-3').addEventListener('click', () => onbGo(2));
  $('#onb-back-4').addEventListener('click', () => onbGo(3));
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
    onbGo(4);
  });
  function finishOnboarding(tab) {
    store.state.profile.onboarded = true;
    onb.step = 1;
    store.commit(Engine.ops.setTab(store.state, tab));
    window.scrollTo(0, 0);
    try { history.replaceState({ tab, level: 0 }, '', '#' + tab); } catch (_) { /* file:// */ }
  }
  $('#onb-finish').addEventListener('click', () => { finishOnboarding('dashboard'); toast('Готово. Вечером спрошу, сколько потратили'); });
  $('#onb-to-obligations').addEventListener('click', () => { finishOnboarding('obligations'); openObDialog(null); });

  // ---------- диалоги: общее, свайп вниз закрывает шторку ----------
  function openDialog(dlg) {
    if (dlg.open) return;
    dlg.showModal();
    try { history.pushState({ ...(history.state || {}), dialog: dlg.id }, ''); } catch (_) { /* file:// */ }
    document.body.style.overflow = 'hidden';
    const first = dlg.querySelector('input:not([type=hidden]):not([disabled]):not([type=checkbox]), select, textarea');
    if (first) setTimeout(() => first.focus(), 60);
  }
  function closeDialog(dlg) { if (dlg.open) dlg.close(); }
  for (const dlg of $$('dialog')) {
    dlg.addEventListener('close', () => {
      document.body.style.overflow = '';
      if (!navBusy && history.state && history.state.dialog === dlg.id) history.back(); // закрыли кнопкой — убрать запись из истории
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(dlg); });
    for (const b of $$('[data-close]', dlg)) b.addEventListener('click', () => closeDialog(dlg));
    let startY = null;
    const grip = (e) => e.target.closest('.sheet__handle, .sheet__head');
    dlg.addEventListener('touchstart', (e) => { startY = grip(e) ? e.touches[0].clientY : null; }, { passive: true });
    dlg.addEventListener('touchmove', (e) => { if (startY != null && e.touches[0].clientY - startY > 80) { startY = null; closeDialog(dlg); } }, { passive: true });
    dlg.addEventListener('touchend', () => { startY = null; });
  }

  // ---------- диалог траты / дохода / зарплаты ----------
  const tx = { mode: 'expense', type: 'EXPENSE', category: 'Продукты', match: null, matchDismissed: false, day: 'today' };
  let paydayGoals = [], paydayLeftover = 0;
  function openTxDialog({ mode, amount = null }) {
    const dlg = $('#dlg-tx'), s = store.state;
    tx.mode = mode;
    tx.type = mode === 'expense' ? 'EXPENSE' : 'INCOME';
    tx.match = null; tx.matchDismissed = false; tx.day = 'today';
    tx.category = mode === 'payday' ? Engine.SPECIAL.SALARY : Engine.CATEGORIES[tx.type][0];
    $('#tx-title').textContent = mode === 'payday' ? 'Зарплата получена' : mode === 'income' ? 'Внести доход' : 'Новая трата';
    $('#tx-type').hidden = mode === 'payday';
    $('#tx-date').hidden = mode === 'payday';
    $('#tx-categories').hidden = mode === 'payday';
    $('#tx-note-wrap').hidden = mode === 'payday';
    $('#tx-amount').value = mode === 'payday' ? toInput(s.profile.expectedIncome) : toInput(amount);
    $('#tx-note').value = '';
    $('#tx-payday').hidden = mode !== 'payday';
    $('#tx-cycle').hidden = mode !== 'payday';
    if (mode === 'payday') {
      const sum = Engine.calc.cycleSummary(s, today());
      $('#tx-cycle-text').textContent = `За ${sum.days} дн. потрачено ${fmt(sum.spent)}. ${sum.leftover > 0 ? `Не потрачено ${fmt(sum.leftover)} — сверх платежей следующего цикла` : sum.leftover < 0 ? `Не хватает ${fmt(-sum.leftover)} на платежи следующего цикла` : 'Остатка нет'}.`;
      const next = Engine.calc.nextIncomeAfter(s.profile);
      $('#tx-next-date').value = next || '';
      $('#tx-next-date').min = Engine.dates.addDays(today(), 1);
      paydayGoals = Engine.calc.activeGoals(s).filter(g => g.perCycle > 0)
        .map(g => ({ id: g.id, title: g.title, amount: Math.min(g.perCycle, Math.max(0, g.target - Engine.calc.goalSaved(s, g))) })).filter(x => x.amount > 0);
      $('#tx-goals').hidden = !paydayGoals.length;
      $('#tx-goals-check').checked = true;
      $('#tx-goals-text').textContent = `Отложить в цели: ${paydayGoals.map(x => `«${x.title}» ${fmt(x.amount)}`).join(', ')}`;
      paydayLeftover = Math.max(0, sum.leftover);
      const goal = Engine.calc.activeGoals(s)[0];
      $('#tx-leftover').hidden = paydayLeftover <= 0;
      $('#tx-leftover-check').checked = false; // по желанию: большой остаток лучше не замораживать молча
      $('#tx-leftover-text').textContent = goal ? `Остаток ${fmt(paydayLeftover)} → отложить в «${goal.title}»` : `Остаток ${fmt(paydayLeftover)} → в запас`;
    }
    $('#tx-submit').textContent = mode === 'payday' ? 'Подтвердить зарплату' : mode === 'income' ? 'Внести доход' : 'Записать трату';
    [$('#tx-amount'), $('#tx-next-date')].forEach(clearError);
    renderTxType(); renderTxDay(); renderTxCategories(); renderTxMatch(); renderPaydayPreview();
    openDialog(dlg);
  }
  function renderTxType() {
    for (const b of $$('#tx-type [data-type]')) b.classList.toggle('is-active', b.dataset.type === tx.type);
    $('#tx-submit').textContent = tx.mode === 'payday' ? 'Подтвердить зарплату' : tx.type === 'INCOME' ? 'Внести доход' : 'Записать трату';
    $('#tx-title').textContent = tx.mode === 'payday' ? 'Зарплата получена' : tx.type === 'INCOME' ? 'Внести доход' : 'Новая трата';
  }
  function renderTxDay() { for (const b of $$('#tx-date [data-date]')) b.classList.toggle('is-active', b.dataset.date === tx.day); }
  function renderTxCategories() {
    $('#tx-categories').replaceChildren(...Engine.CATEGORIES[tx.type].map(c =>
      el('button', { type: 'button', class: 'chip' + (c === tx.category ? ' is-active' : ''), text: c, 'aria-pressed': c === tx.category ? 'true' : 'false',
        onclick: () => { tx.category = c; renderTxCategories(); } })));
  }
  function renderTxMatch() {
    const amount = Engine.money.parse($('#tx-amount').value);
    tx.match = tx.type === 'EXPENSE' && tx.mode !== 'payday' && !tx.matchDismissed && amount ? Engine.calc.findMatchingObligation(store.state, amount) : null;
    $('#tx-match').hidden = !tx.match;
    $('#tx-match').classList.remove('callout--bad');
    if (tx.match) $('#tx-match-title').textContent = tx.match.title;
  }
  function paydayState() {
    const s = store.state, t = today();
    const amount = Engine.money.parse($('#tx-amount').value) || 0;
    const next = $('#tx-next-date').value;
    if (!Engine.dates.isValid(next) || next <= t) return null;
    let n = Engine.ops.confirmPayday(s, { amount, nextIncomeDate: next, date: t, at: now() });
    if ($('#tx-goals-check').checked) for (const x of paydayGoals) n = Engine.ops.contributeToGoal(n, x.id, x.amount, { date: t, at: now() });
    if (!$('#tx-leftover').hidden && $('#tx-leftover-check').checked && paydayLeftover > 0) {
      const goal = Engine.calc.activeGoals(s)[0];
      n = goal ? Engine.ops.contributeToGoal(n, goal.id, paydayLeftover, { date: t, at: now() }) : Engine.ops.setProfile(n, { safetyBuffer: (n.profile.safetyBuffer || 0) + paydayLeftover });
    }
    return n;
  }
  function renderPaydayPreview() {
    if (tx.mode !== 'payday') return;
    const n = paydayState();
    const p = $('#tx-preview');
    if (!n) { p.textContent = ''; return; }
    const f = Engine.calc.forecast(n, today());
    p.textContent = f.status === 'HEALTHY' || f.status === 'WARNING'
      ? `После этого до ${fdate(f.nextIncomeDate)} — по ${fmtWhole(f.budgetToday)} в день (${fmt(f.free)} свободно)`
      : f.title;
  }
  $('#tx-type').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]'); if (!b) return;
    tx.type = b.dataset.type; tx.category = Engine.CATEGORIES[tx.type][0]; tx.matchDismissed = false;
    renderTxType(); renderTxCategories(); renderTxMatch();
  });
  $('#tx-date').addEventListener('click', (e) => { const b = e.target.closest('[data-date]'); if (!b) return; tx.day = b.dataset.date; renderTxDay(); });
  $('#tx-amount').addEventListener('input', () => { tx.matchDismissed = false; renderTxMatch(); renderPaydayPreview(); });
  $('#tx-next-date').addEventListener('change', renderPaydayPreview);
  $('#tx-goals-check').addEventListener('change', renderPaydayPreview);
  $('#tx-leftover-check').addEventListener('change', renderPaydayPreview);
  $('#tx-match-yes').addEventListener('click', () => { const o = tx.match; if (!o) return; closeDialog($('#dlg-tx')); payOb(o); });
  $('#tx-match-no').addEventListener('click', () => { tx.matchDismissed = true; renderTxMatch(); });
  $('#dlg-tx form').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = Engine.money.parse($('#tx-amount').value);
    if (!amount) return setError($('#tx-amount'), 'Введите сумму больше нуля');
    if (tx.match) { $('#tx-match').classList.add('callout--bad'); $('#tx-match-yes').focus(); return; } // нужен явный ответ
    const note = $('#tx-note').value.trim().slice(0, 80);
    if (tx.mode === 'payday') {
      const next = $('#tx-next-date').value;
      if (!Engine.dates.isValid(next) || next <= today()) return setError($('#tx-next-date'), 'Укажите дату позже сегодняшней');
      const n = paydayState();
      store.commit(n);
      closeDialog($('#dlg-tx'));
      const f = Engine.calc.forecast(n, today());
      toast(f.daysRemaining > 0 ? `Новый цикл до ${fdate(next)}: по ${fmtWhole(f.budgetToday)} в день` : `Новый цикл до ${fdate(next)}`);
      return;
    }
    const date = tx.day === 'yesterday' ? Engine.dates.addDays(today(), -1) : today();
    store.commit(Engine.ops.addTransaction(store.state, { type: tx.type, amount, category: tx.category, note, date, at: tx.day === 'yesterday' ? now() - 86400000 : now() }));
    closeDialog($('#dlg-tx'));
    const f = Engine.calc.forecast(store.state, today());
    toast(tx.type === 'EXPENSE'
      ? (tx.day === 'yesterday' ? `Записано за вчера: ${fmt(amount)}` : f.status === 'HEALTHY' ? `Записано. На сегодня осталось ${fmtWhole(f.remainingToday)}` : `Записано ${fmt(amount)}`)
      : (f.status === 'HEALTHY' ? `Доход ${fmt(amount)} внесён. На день теперь ${fmtWhole(f.budgetToday)}` : `Доход ${fmt(amount)} внесён`));
  });

  // ---------- диалог платежа ----------
  let obEditId = null;
  function openObDialog(id) {
    const dlg = $('#dlg-ob');
    obEditId = id;
    const o = id ? store.state.obligations.find(x => x.id === id) : null;
    $('#ob-title-h').textContent = o ? 'Изменить платёж' : 'Обязательный платёж';
    $('#ob-name').value = o ? o.title : '';
    $('#ob-amount').value = o ? toInput(o.amount) : '';
    $('#ob-date').value = o ? o.dueDate : Engine.dates.addMonthsKeepDay(today(), 1, Engine.dates.dayOf(today()));
    $('#ob-frequency').value = o ? o.frequency : 'MONTHLY';
    $('#ob-submit').textContent = o ? 'Сохранить' : 'Добавить платёж';
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
    const before = Engine.calc.forecast(store.state, today());
    store.commit(obEditId ? Engine.ops.updateObligation(store.state, obEditId, data) : Engine.ops.addObligation(store.state, data));
    closeDialog($('#dlg-ob'));
    const after = Engine.calc.forecast(store.state, today());
    if (obEditId) toast('Платёж обновлён');
    else if (after.status === 'HEALTHY' && after.budgetToday !== before.budgetToday) toast(`«${title}» добавлен. На день теперь ${fmtWhole(after.budgetToday)}`);
    else if (after.status === 'HEALTHY') toast(`«${title}» добавлен — срок после зарплаты, цифра на день не изменилась`);
    else toast(`«${title}» добавлен`);
  });
  $('#ob-add').addEventListener('click', () => openObDialog(null));

  // ---------- диалог цели ----------
  let goalEditId = null;
  function goalFormValues() {
    const savedRaw = $('#goal-saved').value.trim(), perRaw = $('#goal-per-cycle').value.trim();
    return {
      title: $('#goal-name').value.trim().slice(0, 60),
      target: Engine.money.parse($('#goal-target').value),
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
    else if (store.state.profile.incomeFrequency === 'ONCE') parts.push('При разовом доходе дату посчитать нельзя — укажите, как часто приходят деньги, в настройках.');
    else {
      if (v.perCycle > 0 && p.projectedDate) parts.push(`При ${fmt(v.perCycle)} с каждой зарплаты — к ${fdate(p.projectedDate)}.`);
      if (v.deadline && p.requiredPerCycle != null) parts.push(`Чтобы успеть к ${fdate(v.deadline)} — нужно ${fmt(p.requiredPerCycle)} с каждой зарплаты.`);
      if (!v.perCycle && !v.deadline) parts.push('Укажите взнос или дату — посчитаю, когда накопите.');
      if (v.perCycle > 0) parts.push('Взнос откладывается из цифры на день заранее.');
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
    if (!v.target) return setError($('#goal-target'), 'Введите, сколько нужно');
    if (v.savedRaw && v.initialSaved == null) return setError($('#goal-saved'), 'Введите сумму или оставьте пустым');
    if (v.perRaw && v.perCycle == null) return setError($('#goal-per-cycle'), 'Введите сумму или оставьте пустым');
    if (v.deadline && (!Engine.dates.isValid(v.deadline) || v.deadline <= today())) return setError($('#goal-deadline'), 'Укажите дату позже сегодняшней');
    const data = { title: v.title, target: v.target, initialSaved: v.initialSaved || 0, perCycle: v.perCycle || 0, deadline: v.deadline };
    const before = Engine.calc.forecast(store.state, today());
    store.commit(goalEditId ? Engine.ops.updateGoal(store.state, goalEditId, data) : Engine.ops.addGoal(store.state, data));
    closeDialog($('#dlg-goal'));
    const after = Engine.calc.forecast(store.state, today());
    if (goalEditId) toast('Цель обновлена');
    else if (after.status === 'CRITICAL') toast(`Цель добавлена, но взнос больше свободных денег — смотрите план на главной`);
    else if (after.goalsReserve > before.goalsReserve) toast(`Цель добавлена. ${fmt(after.goalsReserve - before.goalsReserve)} отложены из лимита — на день теперь ${fmtWhole(after.budgetToday)}`);
    else toast(`Цель «${v.title}» добавлена`);
  });
  $('#goal-add').addEventListener('click', () => openGoalDialog(null));

  // ---------- диалог взноса / возврата ----------
  const contrib = { id: null, mode: 'deposit' };
  function openContribDialog(id, mode) {
    const g = store.state.goals.find(x => x.id === id); if (!g) return;
    contrib.id = id; contrib.mode = mode;
    const p = Engine.calc.goalProjection(store.state, g, today());
    $('#contrib-title').textContent = mode === 'deposit' ? `Отложить в «${g.title}»` : `Взять из «${g.title}»`;
    $('#contrib-sub').textContent = mode === 'deposit'
      ? (p.pending > 0 ? `Взнос с этой зарплаты: ${fmt(p.pending)}. Он уже отложен из лимита — цифра на день не изменится.` : 'Сверх плана: уменьшит деньги на жизнь в этом цикле.')
      : `Накоплено ${fmt(p.saved)}. Сумма вернётся в деньги на жизнь.`;
    $('#contrib-amount').value = mode === 'deposit' ? toInput(p.pending || g.perCycle) : '';
    $('#contrib-submit').textContent = mode === 'deposit' ? 'Отложить' : 'Вернуть';
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
    toast(contrib.mode === 'deposit' ? `Отложено ${fmt(amount)}` : `${fmt(amount)} возвращены`);
  });

  // ---------- диалог подтверждения ----------
  function confirmDialog(text, { ok = 'Удалить', danger = true, cancel = 'Отмена' } = {}) {
    const dlg = $('#dlg-confirm');
    $('#confirm-text').textContent = text;
    $('#confirm-cancel').textContent = cancel;
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
      setTimeout(() => $('#confirm-cancel').focus(), 60); // Enter не должен удалять
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
      root.append(el('div', { class: 'card empty' }, [
        el('span', { text: historyFilter === 'all' ? 'Записей пока нет' : 'В этом фильтре записей нет' }),
        el('button', { type: 'button', class: 'btn btn--small btn--ghost', text: 'Записать трату', onclick: () => openTxDialog({ mode: 'expense' }) }),
      ]));
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

  // ---------- платежи и цели ----------
  function renderObligations() {
    const s = store.state;
    const active = s.obligations.filter(o => o.status === 'ACTIVE').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const done = s.obligations.filter(o => o.status === 'DONE');
    $('#ob-list').replaceChildren(...(active.length ? active.map(o => obligationRow(o))
      : [el('div', { class: 'empty' }, [
        el('span', { text: 'Платежей пока нет. Аренда, кредит, связь — всё, что точно придётся заплатить до зарплаты.' }),
        el('button', { type: 'button', class: 'btn btn--small btn--primary', text: 'Добавить платёж', onclick: () => openObDialog(null) }),
      ])]));
    $('#ob-done').hidden = !done.length;
    $('#ob-done-list').replaceChildren(...done.map(o => obligationRow(o)));
    const f = Engine.calc.forecast(s, today());
    $('#ob-total').textContent = fmt(f.reserved + f.buffer);
    const activeGoals = Engine.calc.activeGoals(s);
    const doneGoals = s.goals.filter(g => Engine.calc.goalDone(s, g));
    $('#goal-list').replaceChildren(...(activeGoals.length ? activeGoals.map(g => goalCard(g))
      : [el('div', { class: 'card empty' }, [
        el('span', { text: 'Целей пока нет. Квартира, той, машина, отпуск — посчитаю дату и буду откладывать с каждой зарплаты.' }),
        el('button', { type: 'button', class: 'btn btn--small btn--ghost', text: 'Добавить цель', onclick: () => openGoalDialog(null) }),
      ])]));
    $('#goal-done').hidden = !doneGoals.length;
    $('#goal-done-list').replaceChildren(...doneGoals.map(g => goalCard(g)));
  }

  // ---------- PIN и выход ----------
  const UNLOCK_KEY = 'finforecast.unlocked', LOGOUT_KEY = 'finforecast.loggedOut';
  function isLocked() {
    if (!store.state.profile.onboarded) return false;
    try {
      if (store.state.profile.pinHash) return sessionStorage.getItem(UNLOCK_KEY) !== '1';
      return localStorage.getItem(LOGOUT_KEY) === '1';
    } catch (_) { return false; }
  }
  function setUnlocked(v) {
    try {
      if (v) { sessionStorage.setItem(UNLOCK_KEY, '1'); localStorage.removeItem(LOGOUT_KEY); }
      else { sessionStorage.removeItem(UNLOCK_KEY); localStorage.setItem(LOGOUT_KEY, '1'); }
    } catch (_) { /* приватный режим */ }
  }
  async function hashPin(pin, salt) {
    const data = new TextEncoder().encode(`${salt}:${pin}`);
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      try { const buf = await crypto.subtle.digest('SHA-256', data); return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''); }
      catch (_) { /* небезопасный контекст — запасной вариант ниже */ }
    }
    let h = 2166136261;
    for (const b of data) { h ^= b; h = Math.imul(h, 16777619) >>> 0; }
    return 'fnv:' + h.toString(16);
  }
  const validPin = (v) => /^\d{4,6}$/.test(v);
  // Полный выход: заблокировать, убрать данные с экрана и уйти на страницу «Вы вышли».
  // При следующем открытии приложения — вход кнопкой или PIN-кодом.
  async function logout() {
    const p = store.state.profile;
    if (!p.pinHash && !p.pinOffered) {
      const want = await confirmDialog('Задать PIN-код? Тогда после выхода никто не откроет приложение без кода. Спрашиваю один раз.', { ok: 'Задать PIN', danger: false, cancel: 'Выйти без PIN' });
      store.state = Engine.ops.setProfile(store.state, { pinOffered: true }); store.save();
      if (want) { pinDlg.thenLogout = true; openPinDialog('set'); return; }
    }
    finishLogout();
  }
  function finishLogout() {
    setUnlocked(false);
    try { localStorage.setItem(KEY, JSON.stringify(store.state)); } catch (_) { /* уже сохранено */ }
    navBusy = true; for (const d of $$('dialog')) if (d.open) d.close(); navBusy = false;
    clearRendered();
    // небольшая пауза: даём закрыться диалогу подтверждения, чтобы переход не отменился откатом истории
    setTimeout(() => { try { location.href = 'exit.html'; } catch (_) { render(); window.scrollTo(0, 0); } }, 250);
  }
  // Очистить всё, что было нарисовано из данных пользователя (на случай, если страница останется открытой)
  function clearRendered() {
    for (const id of ['hero', 'stats', 'dash-obligations', 'dash-goals', 'dash-recent', 'steps-list', 'afford-lines', 'history-list', 'ob-list', 'ob-done-list', 'goal-list', 'goal-done-list', 'security-actions', 'info-lines']) {
      const n = document.getElementById(id); if (n) n.replaceChildren();
    }
    $('#afford-amount').value = ''; $('#afford-result').hidden = true; affordAmount = null;
    $('#settings-balance').textContent = ''; $('#dash-streak').hidden = true;
  }
  $('#sidebar-logout').addEventListener('click', logout);
  for (const b of $$('.logout-btn')) b.addEventListener('click', logout);
  function renderLock() {
    const hasPin = !!store.state.profile.pinHash;
    $('#h-lock').textContent = hasPin ? 'Введите PIN-код' : 'Вы вышли';
    $('#lock-text').textContent = hasPin ? 'Финансовый Прогноз закрыт. Данные остаются на этом устройстве.' : 'Финансовый Прогноз закрыт. Данные остаются на этом устройстве — нажмите «Войти», чтобы продолжить.';
    $('#lock-pin-wrap').hidden = !hasPin;
    $('#lock-hint').hidden = hasPin;
    $('#lock-forgot').hidden = !hasPin;
    if (hasPin) setTimeout(() => $('#lock-pin').focus(), 60);
  }
  $('#lock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = store.state.profile;
    if (p.pinHash) {
      const input = $('#lock-pin');
      const pin = input.value.trim();
      if (!validPin(pin)) return setError(input, 'PIN — от 4 до 6 цифр');
      const h = await hashPin(pin, p.pinSalt || '');
      if (h !== p.pinHash) { input.value = ''; return setError(input, 'Неверный PIN'); }
      input.value = '';
    }
    setUnlocked(true);
    render();
  });
  $('#lock-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#lock-form').requestSubmit(); } });
  $('#lock-forgot').addEventListener('click', async () => {
    if (await confirmDialog('PIN восстановить нельзя. Удалить все данные и начать заново?', { ok: 'Удалить данные' })) { setUnlocked(false); store.clear(); toast('Данные удалены'); }
  });
  const pinDlg = { mode: 'set', thenLogout: false };
  function openPinDialog(mode) {
    pinDlg.mode = mode;
    const hasPin = !!store.state.profile.pinHash;
    $('#pin-title').textContent = mode === 'remove' ? 'Убрать PIN-код' : mode === 'change' ? 'Изменить PIN-код' : 'Задать PIN-код';
    $('#pin-sub').textContent = mode === 'remove' ? 'После этого приложение будет открываться без кода.'
      : 'Код спросят при каждом новом открытии приложения и после «Выйти». Восстановить забытый PIN нельзя — только удалить данные.';
    $('#pin-current-wrap').hidden = !hasPin;
    $('#pin-new-wrap').hidden = mode === 'remove';
    $('#pin-repeat-wrap').hidden = mode === 'remove';
    $('#pin-submit').textContent = mode === 'remove' ? 'Убрать PIN' : 'Сохранить';
    for (const id of ['pin-current', 'pin-new', 'pin-repeat']) { $('#' + id).value = ''; clearError($('#' + id)); }
    openDialog($('#dlg-pin'));
  }
  $('#dlg-pin form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = store.state.profile;
    if (p.pinHash) {
      const cur = $('#pin-current').value.trim();
      if (!validPin(cur)) return setError($('#pin-current'), 'Введите текущий PIN');
      if (await hashPin(cur, p.pinSalt || '') !== p.pinHash) return setError($('#pin-current'), 'Неверный PIN');
    }
    if (pinDlg.mode === 'remove') {
      store.commit(Engine.ops.setPin(store.state, null));
      closeDialog($('#dlg-pin')); toast('PIN-код убран');
      return;
    }
    const pin = $('#pin-new').value.trim();
    if (!validPin(pin)) return setError($('#pin-new'), 'PIN — от 4 до 6 цифр');
    if ($('#pin-repeat').value.trim() !== pin) return setError($('#pin-repeat'), 'Коды не совпадают');
    const salt = Engine.newId();
    const hash = await hashPin(pin, salt);
    setUnlocked(true); // до commit: иначе render покажет экран входа
    store.commit(Engine.ops.setPin(store.state, hash, salt));
    closeDialog($('#dlg-pin'));
    if (pinDlg.thenLogout) { pinDlg.thenLogout = false; finishLogout(); return; }
    toast(pinDlg.mode === 'change' ? 'PIN-код изменён' : 'PIN-код задан: теперь вход по коду');
  });
  function renderSecurity() {
    const hasPin = !!store.state.profile.pinHash;
    $('#security-text').textContent = hasPin
      ? 'PIN-код включён: приложение спрашивает код при каждом открытии. «Выйти» закрывает приложение до следующего ввода кода.'
      : '«Выйти» закрывает приложение; при следующем открытии — кнопка «Войти». Чтобы вход был по коду, задайте PIN.';
    $('#security-actions').replaceChildren(...(hasPin
      ? [el('button', { type: 'button', class: 'btn btn--primary', onclick: logout }, [icon('logout'), el('span', { text: 'Выйти' })]),
         el('button', { type: 'button', class: 'btn btn--ghost', text: 'Изменить PIN', onclick: () => openPinDialog('change') }),
         el('button', { type: 'button', class: 'btn btn--ghost', text: 'Убрать PIN', onclick: () => openPinDialog('remove') })]
      : [el('button', { type: 'button', class: 'btn btn--primary', onclick: logout }, [icon('logout'), el('span', { text: 'Выйти' })]),
         el('button', { type: 'button', class: 'btn btn--ghost', onclick: () => openPinDialog('set') }, [icon('lock'), el('span', { text: 'Задать PIN-код' })])]));
  }

  // ---------- настройки ----------
  function renderSettings() {
    renderSecurity();
    const s = store.state, p = s.profile, f = Engine.calc.forecast(s, today());
    const form = $('#settings-form');
    form.nextIncomeDate.value = p.nextIncomeDate || '';
    form.incomeFrequency.value = p.incomeFrequency;
    form.expectedIncome.value = toInput(p.expectedIncome);
    form.safetyBuffer.value = toInput(p.safetyBuffer);
    form.currency.value = p.currency;
    $('#settings-buffer-hint').textContent = p.safetyBuffer ? `Сейчас: ${fmt(p.safetyBuffer)} не входят в цифру на день` : 'Сейчас: без запаса';
    $('#settings-balance').textContent = fmt(f.balance);
    const saved = s.goals.reduce((a, g) => a + Math.max(0, Engine.calc.goalSaved(s, g) - (g.initialSaved || 0)), 0);
    $('#settings-balance-note').textContent = saved ? `— это деньги на жизнь, без ${fmt(saved)}, отложенных в цели` : '— деньги на жизнь';
    $('#adjust-form').newBalance.value = '';
  }
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
    toast(pct ? `Запас ${pct} %: ${fmt(store.state.profile.safetyBuffer)}` : 'Запас отключён');
  });
  $('#adjust-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.currentTarget.newBalance;
    const raw = input.value.trim().replace(/[\s ]/g, '').replace(',', '.');
    const negative = raw.startsWith('-');
    const body = negative ? raw.slice(1) : raw;
    const v = Engine.money.parse(body);
    if (v == null && !/^0([.,]0{1,2})?$/.test(body)) return setError(input, 'Введите, сколько денег на самом деле');
    const target = v == null ? 0 : (negative ? -v : v);
    store.commit(Engine.ops.adjustBalance(store.state, target, { date: today(), at: now() }));
    toast(`Баланс обновлён: ${fmt(target)}`);
  });

  // ---------- данные ----------
  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(store.state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `finforecast-${today()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Копия данных сохранена в загрузки');
  });
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let next;
    try { next = Engine.migrate(JSON.parse(await file.text())); }
    catch (_) { return toast('Файл не похож на копию данных приложения'); }
    if (await confirmDialog('Заменить текущие данные данными из копии?', { ok: 'Заменить' })) {
      store.corrupt = false; store.commit(next); toast('Данные восстановлены');
    }
  });
  $('#btn-demo').addEventListener('click', async () => {
    if (await confirmDialog('Заменить все данные примером?', { ok: 'Показать пример' })) {
      store.commit(Engine.demoState(today())); showTab('dashboard'); toast('Это пример. Свои данные: Настройки → Удалить все данные');
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
    if (!typing && /^[nNтТ]$/.test(e.key) && store.state.profile.onboarded && !isLocked()) { e.preventDefault(); openTxDialog({ mode: 'expense' }); }
  });

  // ---------- новая версия на сайте: обновиться самим, не дожидаясь кэша ----------
  const APP_VERSION = (document.querySelector('meta[name="app-version"]') || {}).content || 'dev';
  let updateOffered = false;
  async function checkForUpdate() {
    if (APP_VERSION === 'dev' || updateOffered || location.protocol === 'file:') return;
    let live = '';
    try {
      const r = await fetch('version.txt?ts=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      live = (await r.text()).trim();
    } catch (_) { return; }
    if (!live || live === APP_VERSION) return;
    const busy = $$('dialog').some(d => d.open) || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement ? document.activeElement.tagName : '');
    if (!busy) { location.reload(); return; }
    updateOffered = true;
    toast('Вышла новая версия приложения', { sticky: true, action: { label: 'Обновить', fn: () => location.reload() } });
  }
  setTimeout(checkForUpdate, 1500);
  setInterval(checkForUpdate, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });

  // ---------- смена дня при открытой вкладке ----------
  function tick() { if (today() !== renderedToday) render(); }
  setInterval(tick, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

  // ---------- запуск ----------
  store.load();
  const hashTab = location.hash.replace('#', '');
  if (store.state.profile.onboarded && Engine.TABS.includes(hashTab) && hashTab !== store.state.ui.tab) store.state = Engine.ops.setTab(store.state, hashTab);
  try { history.replaceState(store.state.profile.onboarded ? { tab: store.state.ui.tab, level: 0 } : { onb: 1 }, '', store.state.profile.onboarded ? '#' + store.state.ui.tab : location.pathname + location.search); } catch (_) { /* file:// */ }
  render();
})();
