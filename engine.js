// engine.js — чистая логика приложения «Финансовый Прогноз». Без DOM.
// В браузере: глобальный объект Engine. В Node: module.exports (для тестов).
const Engine = (() => {
  'use strict';
  const pad2 = (n) => String(n).padStart(2, '0');
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  // ---------- dates: только строки YYYY-MM-DD в локальном времени ----------
  function parseYmd(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return { y, m: mo, d };
  }
  function daysInMonth(y, m1) { return new Date(Date.UTC(y, m1, 0)).getUTCDate(); }
  function toYmd(y, m1, d) { return `${y}-${pad2(m1)}-${pad2(d)}`; }
  function utcMs(ymd) {
    const p = parseYmd(ymd);
    if (!p) throw new Error('bad date ' + ymd);
    return Date.UTC(p.y, p.m - 1, p.d);
  }
  const dates = {
    today(now = new Date()) { return toYmd(now.getFullYear(), now.getMonth() + 1, now.getDate()); },
    isValid(s) { return parseYmd(s) !== null; },
    daysInMonth,
    // b − a в календарных днях; не зависит от часового пояса и перевода часов
    daysBetween(a, b) { return Math.round((utcMs(b) - utcMs(a)) / 86400000); },
    addDays(ymd, n) {
      const d = new Date(utcMs(ymd) + n * 86400000);
      return toYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    },
    // тот же день месяца `day`; если в месяце столько нет — последний день месяца
    addMonthsKeepDay(ymd, n, day) {
      const p = parseYmd(ymd);
      let m0 = p.m - 1 + n;
      const y = p.y + Math.floor(m0 / 12);
      m0 = ((m0 % 12) + 12) % 12;
      const want = day == null ? p.d : day;
      return toYmd(y, m0 + 1, Math.min(want, daysInMonth(y, m0 + 1)));
    },
    dayOf(ymd) { return parseYmd(ymd).d; },
    format(ymd, { today } = {}) {
      if (today) {
        const diff = dates.daysBetween(today, ymd);
        if (diff === 0) return 'сегодня';
        if (diff === 1) return 'завтра';
        if (diff === -1) return 'вчера';
      }
      const p = parseYmd(ymd);
      const ty = today ? parseYmd(today).y : new Date().getFullYear();
      return `${p.d} ${MONTHS_GEN[p.m - 1]}${p.y !== ty ? ' ' + p.y : ''}`;
    },
  };

  // ---------- money: целые в минимальных единицах ----------
  const CURRENCIES = { KGS: 'сом', RUB: '₽', KZT: '₸', USD: '$', EUR: '€' };
  const NBSP = ' ';
  function groupThousands(intStr) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP); }
  const money = {
    CURRENCIES,
    // "1 250,50" → 125050; ноль, отрицательные и мусор → null
    parse(str) {
      const s = String(str == null ? '' : str).replace(/[\s  ]/g, '').replace(',', '.');
      if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return null;
      const [int, frac = ''] = s.split('.');
      const minor = parseInt(int, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
      return minor > 0 ? minor : null;
    },
    // Число без символа валюты — для пар вида «128 000 из 1 500 000 сом»
    formatNumber(minor) { return money.format(minor, '').replace(/\u00A0$/, ''); },
    format(minor, currency, { sign = false } = {}) {
      const neg = minor < 0;
      const abs = Math.abs(minor);
      const int = groupThousands(String(Math.floor(abs / 100)));
      const frac = abs % 100;
      const num = frac ? `${int},${pad2(frac)}` : int;
      const prefix = neg ? '−' : (sign && minor > 0 ? '+' : '');
      return `${prefix}${num}${NBSP}${CURRENCIES[currency] || currency}`;
    },
  };

  // ---------- constants ----------
  const CATEGORIES = {
    EXPENSE: ['Продукты', 'Кафе', 'Транспорт', 'Покупки', 'Дом', 'Здоровье', 'Развлечения', 'Другое'],
    INCOME: ['Зарплата', 'Фриланс', 'Подарок', 'Другое'],
  };
  const SPECIAL = { OBLIGATION: 'Обязательный платёж', ADJUSTMENT: 'Корректировка', SALARY: 'Зарплата', SAVING: 'Накопление' };
  const TABS = ['dashboard', 'history', 'obligations', 'settings'];

  // ---------- state ----------
  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) { try { return crypto.randomUUID(); } catch (_) { /* file:// без secure context */ } }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function defaultProfile() {
    return { currency: 'KGS', initialBalance: 0, nextIncomeDate: '', incomeDay: 1, incomeFrequency: 'MONTHLY',
      expectedIncome: null, safetyBuffer: 0, cycleStartDate: '', cycleStartFree: null, onboarded: false };
  }
  function defaultState() {
    return { version: 1, profile: defaultProfile(), transactions: [], obligations: [], goals: [], checkins: [], ui: { tab: 'dashboard' } };
  }
  // Демо-данные относительно `today`, чтобы не устаревали
  function demoState(today) {
    const s = defaultState();
    const d = dates;
    const at = (daysAgo, h) => Date.UTC(2000, 0, 1) + (1000 - daysAgo) * 86400000 + h * 3600000; // монотонно, без привязки к TZ
    const payday = d.addDays(today, 10);
    Object.assign(s.profile, { onboarded: true, nextIncomeDate: payday, incomeDay: d.dayOf(payday),
      expectedIncome: 5000000, cycleStartDate: d.addDays(today, -20) });
    const rentDue = d.addDays(today, 5), netDue = d.addDays(today, 8);
    s.obligations = [
      { id: newId(), title: 'Аренда квартиры', amount: 1500000, dueDate: rentDue, dueDay: d.dayOf(rentDue), frequency: 'MONTHLY', status: 'ACTIVE', createdAt: at(20, 9) },
      { id: newId(), title: 'Интернет и связь', amount: 100000, dueDate: netDue, dueDay: d.dayOf(netDue), frequency: 'MONTHLY', status: 'ACTIVE', createdAt: at(20, 9) },
    ];
    s.transactions = [
      { id: newId(), type: 'EXPENSE', amount: 70000, category: 'Продукты', note: 'Супермаркет', date: today, at: at(0, 12) },
      { id: newId(), type: 'EXPENSE', amount: 25000, category: 'Кафе', note: 'Кофе на вынос', date: today, at: at(0, 9) },
      { id: newId(), type: 'EXPENSE', amount: 32000, category: 'Транспорт', note: 'Такси в офис', date: d.addDays(today, -1), at: at(1, 8) },
      { id: newId(), type: 'INCOME', amount: 1200000, category: 'Фриланс', note: 'Выплата за проект', date: d.addDays(today, -2), at: at(2, 15) },
    ];
    s.goals = [
      { id: newId(), title: 'Квартира — первый взнос', target: 60000000, initialSaved: 12000000, perCycle: 800000, deadline: null, createdAt: at(20, 9) },
    ];
    // initialBalance подобран так, чтобы расчётный баланс был ровно 40 000
    s.profile.initialBalance = 4000000 - 1200000 + 70000 + 25000 + 32000;
    return s;
  }
  // Приводит сырой JSON из хранилища/импорта к текущей форме; бросает при чужом формате
  function migrate(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('unsupported');
    if ((raw.version || 1) > 1) throw new Error('unsupported');
    const s = defaultState();
    s.profile = Object.assign(defaultProfile(), raw.profile && typeof raw.profile === 'object' ? raw.profile : {});
    s.transactions = Array.isArray(raw.transactions)
      ? raw.transactions.filter(t => t && t.id && t.type && Number.isInteger(t.amount)) : [];
    s.obligations = Array.isArray(raw.obligations)
      ? raw.obligations.filter(o => o && o.id && Number.isInteger(o.amount)).map(o => ({
        status: 'ACTIVE', frequency: 'MONTHLY',
        dueDay: o.dueDate && dates.isValid(o.dueDate) ? dates.dayOf(o.dueDate) : 1, createdAt: 0, ...o,
      })) : [];
    s.goals = Array.isArray(raw.goals)
      ? raw.goals.filter(g => g && g.id && Number.isInteger(g.target)).map(g => ({ initialSaved: 0, perCycle: 0, deadline: null, skippedCycle: null, createdAt: 0, ...g }))
      : [];
    s.checkins = Array.isArray(raw.checkins) ? raw.checkins.filter(d => dates.isValid(d)) : [];
    s.ui = { tab: raw.ui && TABS.includes(raw.ui.tab) ? raw.ui.tab : 'dashboard' };
    return s;
  }

  // ---------- calc ----------
  const calc = {
    // Баланс не хранится: initial + доходы − расходы + корректировки
    // SAVING уходит из «денег на жизнь» в цель (возврат — со знаком минус)
    balance(s) {
      return s.transactions.reduce((acc, t) =>
        t.type === 'INCOME' ? acc + t.amount : t.type === 'EXPENSE' || t.type === 'SAVING' ? acc - t.amount : acc + t.amount,
      s.profile.initialBalance);
    },
    // В резерве: активные со сроком строго до зарплаты (просроченные тоже)
    reservedObligations(s) {
      const next = s.profile.nextIncomeDate;
      return s.obligations
        .filter(o => o.status === 'ACTIVE' && next && o.dueDate < next)
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
    },
    reserved(s) { return calc.reservedObligations(s).reduce((a, o) => a + o.amount, 0); },
    // Траты дня без оплат обязательств — они уже были в резерве
    spentToday(s, today) {
      return s.transactions
        .filter(t => t.type === 'EXPENSE' && t.date === today && !t.obligationId)
        .reduce((a, t) => a + t.amount, 0);
    },
    nextIncomeAfter(p) {
      if (!p.nextIncomeDate || !dates.isValid(p.nextIncomeDate)) return null;
      switch (p.incomeFrequency) {
        case 'MONTHLY': return dates.addMonthsKeepDay(p.nextIncomeDate, 1, p.incomeDay || dates.dayOf(p.nextIncomeDate));
        case 'BIWEEKLY': return dates.addDays(p.nextIncomeDate, 14);
        case 'WEEKLY': return dates.addDays(p.nextIncomeDate, 7);
        default: return null;
      }
    },
    findMatchingObligation(s, amount) { return calc.reservedObligations(s).find(o => o.amount === amount) || null; },

    // ----- цели -----
    goalSaved(s, g) {
      return (g.initialSaved || 0) + s.transactions.filter(t => t.type === 'SAVING' && t.goalId === g.id).reduce((a, t) => a + t.amount, 0);
    },
    goalContributedThisCycle(s, g) {
      const start = s.profile.cycleStartDate || '';
      return s.transactions.filter(t => t.type === 'SAVING' && t.goalId === g.id && t.amount > 0 && t.date >= start).reduce((a, t) => a + t.amount, 0);
    },
    goalDone(s, g) { return calc.goalSaved(s, g) >= g.target; },
    activeGoals(s) { return s.goals.filter(g => !calc.goalDone(s, g)).sort((a, b) => a.createdAt - b.createdAt); },
    // Взнос текущего цикла, ещё не сделанный: резервируется как обязательство перед собой
    goalPending(s, g) {
      if (g.skippedCycle && g.skippedCycle === s.profile.cycleStartDate) return 0; // взнос пропущен в этом цикле
      const remaining = Math.max(0, g.target - calc.goalSaved(s, g));
      const pending = Math.max(0, (g.perCycle || 0) - calc.goalContributedThisCycle(s, g));
      return Math.min(pending, remaining);
    },
    goalsReserve(s) { return s.goals.reduce((a, g) => a + calc.goalPending(s, g), 0); },
    cycleLengthDays(p) {
      switch (p.incomeFrequency) {
        case 'MONTHLY': return 30;
        case 'BIWEEKLY': return 14;
        case 'WEEKLY': return 7;
        default: {
          const d = p.cycleStartDate && p.nextIncomeDate && dates.isValid(p.cycleStartDate) && dates.isValid(p.nextIncomeDate)
            ? dates.daysBetween(p.cycleStartDate, p.nextIncomeDate) : 0;
          return d > 0 ? d : 30;
        }
      }
    },
    // На сколько дней отодвинется цель, если сумму взять из взноса
    goalDelayDays(s, g, amount) {
      if (!(g.perCycle > 0)) return null;
      return Math.round(amount / (g.perCycle / calc.cycleLengthDays(s.profile)));
    },
    goalProjection(s, g, today) {
      const p = s.profile;
      const saved = calc.goalSaved(s, g);
      const remaining = Math.max(0, g.target - saved);
      const pending = calc.goalPending(s, g);
      const progress = g.target > 0 ? Math.min(1, saved / g.target) : 1;
      let projectedDate = null, requiredPerCycle = null, onTrack = null;
      const canProject = !!p.nextIncomeDate && dates.isValid(p.nextIncomeDate) && p.incomeFrequency !== 'ONCE';
      const step = (d) => calc.nextIncomeAfter({ ...p, nextIncomeDate: d });
      if (remaining > 0 && canProject) {
        const afterPending = Math.max(0, remaining - pending);
        if (afterPending === 0) projectedDate = today;
        else if (g.perCycle > 0) {
          const n = Math.ceil(afterPending / g.perCycle);
          if (n <= 1200) { let d = p.nextIncomeDate; for (let i = 1; i < n; i++) d = step(d); projectedDate = d; }
        }
        if (g.deadline && dates.isValid(g.deadline)) {
          let n = 0, d = p.nextIncomeDate;
          while (d && d <= g.deadline && n < 1200) { n++; d = step(d); }
          const slots = n + (calc.goalContributedThisCycle(s, g) > 0 ? 0 : 1);
          requiredPerCycle = slots > 0 ? Math.ceil(remaining / slots / 100) * 100 : remaining; // вверх до целых единиц
          onTrack = projectedDate ? projectedDate <= g.deadline : false;
        }
      } else if (remaining > 0 && g.deadline) {
        requiredPerCycle = remaining;
      }
      return { saved, remaining, pending, progress, projectedDate, requiredPerCycle, onTrack };
    },

    // ----- «Могу ли я?» — только расчёт, ничего не записывает -----
    canAfford(s, today, amount) {
      const f = calc.forecast(s, today);
      const fm = (v) => money.format(v, s.profile.currency);
      const fmDay = (v) => money.format(Math.floor(v / 100) * 100, s.profile.currency); // дневные суммы — в целых единицах
      const r = { amount, verdict: 'YES', lines: [], remainingAfterToday: null, dailyAfter: null,
        daysLeft: Math.max(0, f.daysRemaining - 1), shortfall: 0, goalHint: null, afterPayday: f.nextIncomeDate };
      if (f.status === 'PAYDAY') { r.verdict = 'PAYDAY'; r.lines.push('Сначала подтвердите зарплату — тогда посчитаю точно.'); return r; }
      if (f.status === 'CRITICAL') {
        r.verdict = 'CRITICAL';
        r.lines.push(`Сейчас дефицит ${fm(f.cashGap)}. Покупка увеличит его до ${fm(f.cashGap + amount)}.`);
        return r;
      }
      if (amount <= f.remainingToday) {
        r.remainingAfterToday = f.remainingToday - amount;
        r.lines.push(`Да. На сегодня останется ${fm(r.remainingAfterToday)}.`);
        return r;
      }
      const paydayLine = `После зарплаты ${dates.format(f.nextIncomeDate, { today })} — из нового бюджета.`;
      if (amount <= f.free) {
        r.verdict = 'YES_BUT';
        r.lines.push(`Да, но ${fmDay(amount - f.remainingToday)} сверх цифры на сегодня.`);
        if (r.daysLeft >= 1) {
          r.dailyAfter = Math.floor((f.free - amount) / r.daysLeft);
          r.lines.push(`Остальные ${r.daysLeft} дн. — по ${fmDay(r.dailyAfter)} в день вместо ${fmDay(f.budgetToday)}.`);
        } else {
          r.lines.push(`До зарплаты останется ${fm(f.free - amount)}.`);
        }
        const g = calc.activeGoals(s).find(x => x.perCycle > 0);
        const delay = g ? calc.goalDelayDays(s, g, amount) : null;
        if (g && delay) {
          r.goalHint = { id: g.id, title: g.title, delayDays: delay };
          r.lines.push(`Если сократить взнос в «${g.title}» — цель отодвинется на ~${delay} дн.`);
        }
        return r;
      }
      r.shortfall = amount - f.free;
      if (f.buffer > 0 && amount <= f.free + f.buffer) {
        r.verdict = 'NO_BUFFER';
        const left = f.free + f.buffer - amount;
        r.lines.push(`Не хватит ${fm(r.shortfall)} до зарплаты.`);
        r.lines.push(r.daysLeft >= 1
          ? `Можно разморозить буфер ${fm(f.buffer)}: тогда остальные ${r.daysLeft} дн. — по ${fmDay(Math.floor(left / r.daysLeft))} в день.`
          : `Можно разморозить буфер ${fm(f.buffer)}: до зарплаты останется ${fm(left)}.`);
        r.lines.push(paydayLine);
        return r;
      }
      r.verdict = 'NO';
      const needs = [];
      if (f.obligationsReserve > 0) needs.push('обязательства');
      if (f.goalsReserve > 0) needs.push('цели');
      if (f.buffer > 0) needs.push('буфер');
      r.lines.push(needs.length
        ? `Не хватит ${fm(r.shortfall)}: деньги нужны на ${needs.join(', ')}.`
        : `Не хватит ${fm(r.shortfall)} — столько свободных денег нет до зарплаты.`);
      r.lines.push(paydayLine);
      return r;
    },

    // ----- уровень 1: покрытие дней, итог цикла, дефицит, темп -----
    // Серия дней подряд, за которые известны траты (операция или отметка «без трат»)
    coverageStreak(s, today) {
      const known = new Set(s.transactions.map(t => t.date));
      for (const d of s.checkins || []) known.add(d);
      const todayKnown = known.has(today);
      let d = todayKnown ? today : dates.addDays(today, -1);
      let days = 0;
      while (known.has(d) && days < 3650) { days++; d = dates.addDays(d, -1); }
      return { days, todayKnown };
    },
    cycleSummary(s, today) {
      const start = s.profile.cycleStartDate && dates.isValid(s.profile.cycleStartDate) ? s.profile.cycleStartDate : today;
      const spent = s.transactions
        .filter(t => t.type === 'EXPENSE' && !t.obligationId && t.date >= start && t.date <= today)
        .reduce((a, t) => a + t.amount, 0);
      // Остаток — то, что не понадобится и на платежи следующего цикла (их оплатит новая зарплата)
      const p = s.profile;
      const nextAfter = calc.nextIncomeAfter(p);
      const nextCycleObs = p.nextIncomeDate && nextAfter
        ? s.obligations.filter(o => o.status === 'ACTIVE' && o.dueDate >= p.nextIncomeDate && o.dueDate < nextAfter).reduce((a, o) => a + o.amount, 0)
        : 0;
      return { start, days: Math.max(1, dates.daysBetween(start, today) + 1), spent,
        planned: Number.isInteger(p.cycleStartFree) ? p.cycleStartFree : null,
        leftover: calc.forecast(s, today).free - nextCycleObs };
    },
    // Варианты закрыть дефицит; первым — тот, что закрывает его целиком и стоит меньше всего
    deficitPlan(s, today) {
      const f = calc.forecast(s, today);
      if (f.status !== 'CRITICAL') return null;
      const gap = f.cashGap;
      const options = [];
      for (const o of calc.reservedObligations(s)) options.push({ type: 'postponeObligation', id: o.id, title: o.title, effect: o.amount });
      for (const g of calc.activeGoals(s)) { const pend = calc.goalPending(s, g); if (pend > 0) options.push({ type: 'skipGoal', id: g.id, title: g.title, effect: pend }); }
      if (f.buffer > 0) options.push({ type: 'buffer', effect: f.buffer });
      // При «мягком» дефиците (виноваты цели/запас) сначала предлагаем их, а не перенос платежей
      const rank = (o) => f.gapKind === 'soft'
        ? { skipGoal: 0, buffer: 1, postponeObligation: 2 }[o.type]
        : { postponeObligation: 0, buffer: 1, skipGoal: 2 }[o.type];
      options.sort((a, b) => {
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        const aOk = a.effect >= gap, bOk = b.effect >= gap;
        if (aOk !== bOk) return aOk ? -1 : 1;
        return aOk ? a.effect - b.effect : b.effect - a.effect;
      });
      return { gap, options, dailyCut: f.daysRemaining > 0 ? Math.ceil(gap / f.daysRemaining) : gap };
    },
    // Темп трат за последние дни против оставшихся денег
    pace(s, today) {
      const start = s.profile.cycleStartDate && dates.isValid(s.profile.cycleStartDate) ? s.profile.cycleStartDate : today;
      const windowDays = Math.min(7, Math.max(1, dates.daysBetween(start, today) + 1));
      if (windowDays < 3) return null;
      const f = calc.forecast(s, today);
      if (f.daysRemaining <= 0) return null;
      const from = dates.addDays(today, -(windowDays - 1));
      const spent = s.transactions
        .filter(t => t.type === 'EXPENSE' && !t.obligationId && t.date >= from && t.date <= today)
        .reduce((a, t) => a + t.amount, 0);
      const avgDaily = Math.round(spent / windowDays);
      const daysOfMoney = avgDaily > 0 ? Math.floor(Math.max(0, f.free) / avgDaily) : Infinity;
      const runOut = daysOfMoney < f.daysRemaining;
      return {
        windowDays, avgDaily,
        runOutDate: runOut ? dates.addDays(today, daysOfMoney) : null,
        leftoverAtPayday: runOut ? null : f.free - avgDaily * f.daysRemaining,
      };
    },

    forecast(s, today) {
      const p = s.profile;
      const balance = calc.balance(s), buffer = p.safetyBuffer || 0;
      const obligationsReserve = calc.reserved(s), goalsReserve = calc.goalsReserve(s);
      const reserved = obligationsReserve + goalsReserve;
      const free = balance - reserved - buffer;
      const spent = calc.spentToday(s, today);
      const D = p.nextIncomeDate && dates.isValid(p.nextIncomeDate) ? dates.daysBetween(today, p.nextIncomeDate) : 0;
      const r = { today, nextIncomeDate: p.nextIncomeDate, daysRemaining: D, balance, reserved, obligationsReserve, goalsReserve, buffer, free, spentToday: spent,
        budgetToday: 0, remainingToday: 0, overspentToday: 0, cashGap: 0, gapKind: null, status: 'HEALTHY', title: '', subtitle: '' };
      const fm = (v) => money.format(v, p.currency);
      if (D <= 0) {
        r.status = 'PAYDAY';
        r.title = D === 0 ? 'Сегодня день зарплаты' : `Зарплата была ${dates.format(p.nextIncomeDate, { today })}`;
        r.subtitle = 'Подтвердите доход, чтобы начать новый цикл';
      } else if (free < 0) {
        r.status = 'CRITICAL';
        r.cashGap = -free;
        // «Мягкий» дефицит: на платежи хватает, не хватает только на взносы в цели и запас
        r.gapKind = balance - obligationsReserve >= 0 ? 'soft' : 'hard';
        if (r.gapKind === 'soft') {
          const parts = [];
          if (goalsReserve > 0) parts.push('взносы в цели');
          if (buffer > 0) parts.push('запас');
          r.title = `На платежи хватает, на ${parts.join(' и ')} — нет`;
          r.subtitle = `Не хватает ${fm(r.cashGap)}. Уменьшите взнос или запас — или подождите зарплаты`;
        } else {
          r.title = 'Денег может не хватить до зарплаты';
          r.subtitle = `Платежи до зарплаты больше, чем есть денег, на ${fm(Math.min(r.cashGap, obligationsReserve - balance))}`;
        }
      } else {
        // Бюджет дня стабилен в течение дня: сегодняшние траты возвращаются в числитель
        r.budgetToday = Math.floor((free + spent) / D);
        r.remainingToday = Math.max(0, r.budgetToday - spent);
        r.overspentToday = Math.max(0, spent - r.budgetToday);
        if (r.overspentToday > 0) {
          r.status = 'WARNING';
          r.title = 'Лимит на сегодня исчерпан';
          r.subtitle = `Перерасход ${fm(r.overspentToday)}. Новые траты уменьшат бюджет следующих дней`;
        } else {
          r.title = 'Всё идёт по плану';
          r.subtitle = `Денег хватает до ${dates.format(p.nextIncomeDate, { today })} · ${D} дн.`;
        }
      }
      return r;
    },
  };

  // ---------- ops: чистые функции state → state ----------
  const clone = (s) => (typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s)));
  const findOb = (s, id) => s.obligations.find(o => o.id === id);
  // Ежемесячный платёж после оплаты/пропуска уходит на месяц вперёд, разовый — завершается
  function advance(o) {
    if (o.frequency === 'MONTHLY') o.dueDate = dates.addMonthsKeepDay(o.dueDate, 1, o.dueDay || dates.dayOf(o.dueDate));
    else o.status = 'DONE';
  }
  const ops = {
    addTransaction(s, { type, amount, category, note = '', date, at, obligationId, obligationDueDate, goalId }) {
      const n = clone(s);
      const tx = { id: newId(), type, amount, category, note, date, at };
      if (obligationId) { tx.obligationId = obligationId; tx.obligationDueDate = obligationDueDate; }
      if (goalId) tx.goalId = goalId;
      n.transactions.unshift(tx);
      return n;
    },
    // ----- цели -----
    addGoal(s, { title, target, initialSaved = 0, perCycle = 0, deadline = null }) {
      const n = clone(s);
      n.goals.push({ id: newId(), title, target, initialSaved, perCycle, deadline: deadline || null, createdAt: Date.now() });
      return n;
    },
    updateGoal(s, id, patch) {
      const n = clone(s);
      const g = n.goals.find(x => x.id === id);
      if (g) Object.assign(g, patch, patch.deadline === undefined ? {} : { deadline: patch.deadline || null });
      return n;
    },
    // Удаление цели возвращает в баланс всё, что было внесено через приложение
    deleteGoal(s, id, { date, at }) {
      const g = s.goals.find(x => x.id === id);
      if (!g) return clone(s);
      const net = s.transactions.filter(t => t.type === 'SAVING' && t.goalId === id).reduce((a, t) => a + t.amount, 0);
      let n = net > 0
        ? ops.addTransaction(s, { type: 'SAVING', amount: -net, category: SPECIAL.SAVING, note: g.title, date, at, goalId: id })
        : clone(s);
      n.goals = n.goals.filter(x => x.id !== id);
      return n;
    },
    contributeToGoal(s, id, amount, { date, at }) {
      const g = s.goals.find(x => x.id === id);
      if (!g || !(amount > 0)) return clone(s);
      return ops.addTransaction(s, { type: 'SAVING', amount, category: SPECIAL.SAVING, note: g.title, date, at, goalId: id });
    },
    withdrawFromGoal(s, id, amount, { date, at }) {
      const g = s.goals.find(x => x.id === id);
      if (!g || !(amount > 0)) return clone(s);
      if (amount > calc.goalSaved(s, g)) throw new Error('amount exceeds saved');
      return ops.addTransaction(s, { type: 'SAVING', amount: -amount, category: SPECIAL.SAVING, note: g.title, date, at, goalId: id });
    },
    deleteTransaction(s, id) {
      const n = clone(s);
      const index = n.transactions.findIndex(t => t.id === id);
      if (index === -1) return { state: n, removed: null };
      const [tx] = n.transactions.splice(index, 1);
      let obligationBefore = null;
      const o = tx.obligationId ? findOb(n, tx.obligationId) : null;
      if (o) {
        obligationBefore = clone(o);
        if (o.frequency === 'MONTHLY') {
          // Откатываем срок только если удаляется последняя оплата
          const expectedNext = dates.addMonthsKeepDay(tx.obligationDueDate, 1, o.dueDay || dates.dayOf(tx.obligationDueDate));
          if (o.dueDate === expectedNext) o.dueDate = tx.obligationDueDate;
        } else {
          o.status = 'ACTIVE';
        }
      }
      return { state: n, removed: { tx, index, obligationBefore } };
    },
    restoreTransaction(s, removed) {
      if (!removed) return s;
      const n = clone(s);
      n.transactions.splice(Math.min(removed.index, n.transactions.length), 0, removed.tx);
      if (removed.obligationBefore) {
        const i = n.obligations.findIndex(o => o.id === removed.obligationBefore.id);
        if (i !== -1) n.obligations[i] = clone(removed.obligationBefore);
      }
      return n;
    },
    payObligation(s, id, { date, at }) {
      const o = findOb(s, id);
      if (!o || o.status !== 'ACTIVE') return s;
      const n = ops.addTransaction(s, { type: 'EXPENSE', amount: o.amount, category: SPECIAL.OBLIGATION, note: o.title,
        date, at, obligationId: id, obligationDueDate: o.dueDate });
      advance(findOb(n, id));
      return n;
    },
    skipObligation(s, id) {
      const n = clone(s);
      const o = findOb(n, id);
      if (o && o.status === 'ACTIVE') advance(o);
      return n;
    },
    addObligation(s, { title, amount, dueDate, frequency }) {
      const n = clone(s);
      n.obligations.push({ id: newId(), title, amount, dueDate, dueDay: dates.dayOf(dueDate), frequency, status: 'ACTIVE', createdAt: Date.now() });
      return n;
    },
    updateObligation(s, id, { title, amount, dueDate, frequency }) {
      const n = clone(s);
      const o = findOb(n, id);
      if (o) Object.assign(o, { title, amount, dueDate, dueDay: dates.dayOf(dueDate), frequency });
      return n;
    },
    deleteObligation(s, id) { const n = clone(s); n.obligations = n.obligations.filter(o => o.id !== id); return n; },
    reactivateObligation(s, id) { const n = clone(s); const o = findOb(n, id); if (o) o.status = 'ACTIVE'; return n; },
    // Перенос платежа на день зарплаты: выходит из резерва этого цикла, вернётся в следующем
    postponeObligation(s, id) {
      const n = clone(s);
      const o = findOb(n, id);
      if (o && n.profile.nextIncomeDate && dates.isValid(n.profile.nextIncomeDate)) o.dueDate = n.profile.nextIncomeDate;
      return n;
    },
    markNoSpend(s, date) {
      const n = clone(s);
      if (!n.checkins.includes(date)) n.checkins.push(date);
      return n;
    },
    skipGoalCycle(s, id) {
      const n = clone(s);
      const g = n.goals.find(x => x.id === id);
      if (g) g.skippedCycle = n.profile.cycleStartDate || null;
      return n;
    },
    // Ручная правка баланса — транзакция ADJUSTMENT на разницу, история остаётся детерминированной
    adjustBalance(s, newBalance, { date, at }) {
      const diff = newBalance - calc.balance(s);
      if (diff === 0) return clone(s);
      return ops.addTransaction(s, { type: 'ADJUSTMENT', amount: diff, category: SPECIAL.ADJUSTMENT, note: '', date, at });
    },
    confirmPayday(s, { amount, nextIncomeDate, date, at }) {
      if (!dates.isValid(nextIncomeDate) || nextIncomeDate <= date) throw new Error('nextIncomeDate must be after date');
      const n = amount > 0
        ? ops.addTransaction(s, { type: 'INCOME', amount, category: SPECIAL.SALARY, note: '', date, at })
        : clone(s);
      Object.assign(n.profile, { nextIncomeDate, incomeDay: dates.dayOf(nextIncomeDate), cycleStartDate: date });
      for (const g of n.goals) g.skippedCycle = null; // новый цикл — пропуски прошлого не действуют
      n.profile.cycleStartFree = calc.forecast(n, date).free; // план цикла — свободные деньги на его старте
      return n;
    },
    postponePayday(s, today) {
      const n = clone(s);
      n.profile.nextIncomeDate = dates.addDays(today, 1);
      n.profile.incomeDay = dates.dayOf(n.profile.nextIncomeDate);
      return n;
    },
    setProfile(s, patch) {
      const n = clone(s);
      Object.assign(n.profile, patch);
      if (patch.nextIncomeDate && dates.isValid(patch.nextIncomeDate)) n.profile.incomeDay = dates.dayOf(patch.nextIncomeDate);
      return n;
    },
    // Первый онбординг задаёт initialBalance; повторный поверх истории — корректировку
    completeOnboarding(s, { currency, balance, nextIncomeDate, expectedIncome, incomeFrequency, date, at }) {
      let n = clone(s);
      if (n.transactions.length === 0) n.profile.initialBalance = balance;
      else n = ops.adjustBalance(n, balance, { date, at });
      Object.assign(n.profile, { currency, nextIncomeDate, incomeDay: dates.dayOf(nextIncomeDate), expectedIncome: expectedIncome || null,
        incomeFrequency, cycleStartDate: n.profile.cycleStartDate || date, onboarded: true });
      n.profile.cycleStartFree = calc.forecast(n, date).free;
      return n;
    },
    setTab(s, tab) { const n = clone(s); n.ui.tab = TABS.includes(tab) ? tab : 'dashboard'; return n; },
  };

  return { dates, money, calc, ops, CATEGORIES, SPECIAL, TABS, newId, defaultState, demoState, migrate };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
