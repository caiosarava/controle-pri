/* Controle da Pri — lógica do app (sem dependências) */
(() => {
  'use strict';

  // ---------------- Constantes ----------------
  const TIPOS = {
    combustivel: { label: 'Combustível', emoji: '⛽', color: '#E99AB9' },
    alimentacao: { label: 'Alimentação', emoji: '🍽️', color: '#F2B48C' },
    manutencao: { label: 'Manutenção', emoji: '🔧', color: '#A98BD6' },
    outros: { label: 'Outros', emoji: '✨', color: '#8FC9B5' },
  };
  const APPS = { Uber: '🚘', '99': '🟡', Outro: '📱' };
  const DEFAULTS = { nome: 'Pri', valorVeiculo: '0', depAnual: '10', manutPct: '10' };
  const K = { db: 'pri:db', queue: 'pri:queue', api: 'pri:api', ui: 'pri:ui' };

  // ---------------- Utilitários ----------------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem espaço */ } },
  };
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const money = (n) => brl.format(Math.round((Number(n) || 0) * 100) / 100);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isoMonth = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const parseDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const startOfWeek = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); };
  const monthName = (d, opts = { month: 'long', year: 'numeric' }) => { const s = d.toLocaleDateString('pt-BR', opts); return s.charAt(0).toUpperCase() + s.slice(1); };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Campo de dinheiro: digita só números, formata como centavos
  function bindMoney(input) {
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9);
      input.dataset.cents = digits || '0';
      input.value = digits ? money(Number(digits) / 100) : '';
      input.dispatchEvent(new Event('moneychange'));
    });
  }
  const getMoney = (input) => Number(input.dataset.cents || 0) / 100;
  const setMoney = (input, v) => {
    const cents = Math.round((Number(v) || 0) * 100);
    input.dataset.cents = String(cents);
    input.value = cents ? money(cents / 100) : '';
  };

  // ---------------- Estado ----------------
  let db = store.get(K.db, { gastos: [], ganhos: [], config: {} });
  let queue = store.get(K.queue, []);
  // A conexão fixa (config.js) vale sempre que existir; os Ajustes só servem de reserva
  const FIXED = window.PRI_CONFIG && window.PRI_CONFIG.API_URL ? { url: window.PRI_CONFIG.API_URL, token: window.PRI_CONFIG.TOKEN || '' } : null;
  let api = FIXED || store.get(K.api, { url: '', token: '' });
  const ui = Object.assign({ period: 'mes', filter: 'todos', lastTipo: 'combustivel', lastApp: 'Uber' }, store.get(K.ui, {}));
  let ref = new Date();

  const cfg = (k) => (db.config[k] !== undefined && db.config[k] !== '' && !(k === 'nome' && db.config[k] === '0') ? db.config[k] : DEFAULTS[k]);
  const cfgNum = (k) => Number(String(cfg(k)).replace(',', '.')) || 0;
  const saveDb = () => store.set(K.db, db);
  const saveQueue = () => store.set(K.queue, queue);
  const saveUi = () => store.set(K.ui, { period: ui.period, filter: ui.filter, lastTipo: ui.lastTipo, lastApp: ui.lastApp });

  function applyLocal(op) {
    const list = op.sheet === 'Gastos' ? db.gastos : op.sheet === 'Ganhos' ? db.ganhos : null;
    if (op.op === 'upsert') {
      const i = list.findIndex((r) => r.id === op.row.id);
      if (i >= 0) list[i] = { ...op.row }; else list.push({ ...op.row });
    } else if (op.op === 'delete') {
      const i = list.findIndex((r) => r.id === op.id);
      if (i >= 0) list.splice(i, 1);
    } else if (op.op === 'setConfig') {
      if (op.value === '' || op.value == null) delete db.config[op.key]; else db.config[op.key] = String(op.value);
    }
  }

  function commit(...ops) {
    ops.forEach((op) => { applyLocal(op); queue.push(op); });
    saveDb(); saveQueue(); render();
    sync({ silent: true });
  }

  // ---------------- Sincronização com a planilha ----------------
  async function call(body) {
    const res = await fetch(api.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS no Apps Script
      body: JSON.stringify({ ...body, token: api.token }),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json().catch(() => { throw new Error('Resposta inválida. Confira o link e se a implantação está como "Qualquer pessoa".'); });
    if (!json.ok) throw new Error(json.error || 'Erro na planilha');
    return json.data;
  }

  let syncing = false;
  let syncAgain = false;
  async function sync({ silent = false } = {}) {
    if (!api.url) return setStatus('local');
    if (!navigator.onLine) return setStatus('offline');
    if (syncing) { syncAgain = true; return; }
    syncing = true; setStatus('syncing');
    try {
      const sending = queue.slice();
      if (sending.length) {
        await call({ action: 'batch', ops: sending });
        queue.splice(0, sending.length);
        saveQueue();
      }
      const data = await call({ action: 'list' });
      const config = {};
      Object.entries(data.config || {}).forEach(([k, v]) => { config[k] = String(v); });
      // Versões antigas do script devolviam textos da Config como 0: mantém o valor do celular
      if (config.nome === '0' && db.config.nome && db.config.nome !== '0') config.nome = db.config.nome;
      db = { gastos: data.gastos || [], ganhos: data.ganhos || [], config };
      queue.forEach(applyLocal); // o que foi lançado durante o envio
      saveDb(); render();
      setStatus(queue.length ? 'pending' : 'ok');
      if (!silent) toast('Planilha sincronizada 💗');
    } catch (err) {
      setStatus('error');
      if (!silent) toast('Não deu para sincronizar: ' + err.message);
      console.warn(err);
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; sync({ silent: true }); }
    }
  }

  function setStatus(s) {
    const labels = { local: 'Só no celular', offline: 'Sem internet', syncing: 'Salvando…', ok: 'Salvo', pending: `${queue.length} pendente(s)`, error: 'Erro ao salvar' };
    const st = s === 'ok' && queue.length ? 'pending' : s;
    $('#sync-dot').className = 'dot ' + st;
    $('#sync-text').textContent = labels[st];
    $('#setup-banner').hidden = !!api.url;
  }

  // ---------------- Cálculos ----------------
  function periodRange(period, d) {
    if (period === 'semana') { const s = startOfWeek(d); return { start: s, end: addDays(s, 6) }; }
    if (period === 'ano') return { start: new Date(d.getFullYear(), 0, 1), end: new Date(d.getFullYear(), 11, 31) };
    return { start: new Date(d.getFullYear(), d.getMonth(), 1), end: new Date(d.getFullYear(), d.getMonth() + 1, 0) };
  }

  const ganhosDoMes = (mes) => db.ganhos.filter((g) => g.mes === mes).reduce((s, g) => s + Number(g.valor || 0), 0);

  function summary(period, d) {
    const { start, end } = periodRange(period, d);
    const a = isoDate(start), b = isoDate(end);
    const gastos = db.gastos.filter((g) => g.data >= a && g.data <= b);
    const porTipo = {};
    gastos.forEach((g) => { porTipo[g.tipo] = (porTipo[g.tipo] || 0) + Number(g.valor || 0); });
    const totalGastos = gastos.reduce((s, g) => s + Number(g.valor || 0), 0);

    let ganhos = 0;
    let estimado = false;
    if (period === 'mes') ganhos = ganhosDoMes(isoMonth(start));
    else if (period === 'ano') ganhos = db.ganhos.filter((g) => g.mes.startsWith(String(start.getFullYear()))).reduce((s, g) => s + Number(g.valor || 0), 0);
    else {
      // ganho é mensal: na semana usamos a parte proporcional de cada dia
      for (let i = 0; i < 7; i++) {
        const day = addDays(start, i);
        ganhos += ganhosDoMes(isoMonth(day)) / daysInMonth(day.getFullYear(), day.getMonth());
      }
      estimado = ganhos > 0;
    }

    const depAno = cfgNum('valorVeiculo') * cfgNum('depAnual') / 100;
    const dep = period === 'ano' ? depAno : period === 'mes' ? depAno / 12 : depAno / 52;
    const man = Math.max(0, ganhos) * cfgNum('manutPct') / 100;
    const lucro = ganhos - totalGastos;
    return { start, end, ganhos, estimado, totalGastos, porTipo, lucro, dep, man, lucroReal: lucro - dep - man };
  }

  // ---------------- Render ----------------
  function render() { renderHome(); renderHistory(); }

  function renderHome() {
    const h = new Date().getHours();
    const saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    $('#hello').textContent = `${saud}, ${cfg('nome')} 💗`;

    // Lembrete do mês atual (sempre visível)
    const now = new Date();
    const mesAtual = summary('mes', now);
    const keyDone = 'reserva:' + isoMonth(now);
    const done = db.config[keyDone] === '1';
    $('#reserve-month').textContent = monthName(now, { month: 'long' }).toLowerCase();
    $('#reserve-total').textContent = money(mesAtual.dep + mesAtual.man);
    $('#reserve-dep').textContent = money(mesAtual.dep);
    $('#reserve-man').textContent = money(mesAtual.man);
    $('#reserve').classList.toggle('done', done);
    const btnDone = $('#reserve-done');
    btnDone.setAttribute('aria-pressed', String(done));
    btnDone.textContent = done ? '✓ Separado' : 'Separei';
    const hints = [];
    if (!cfgNum('valorVeiculo')) hints.push('Informe o valor do carro em Ajustes para calcular a depreciação.');
    if (!mesAtual.ganhos) hints.push('A reserva de manutenção aparece quando você registrar o ganho do mês.');
    if (!hints.length) hints.push(`Depreciação de ${cfg('depAnual')}% ao ano + ${cfg('manutPct')}% dos ganhos para manutenção.`);
    $('#reserve-hint').textContent = hints.join(' ');

    // Período selecionado
    $$('[data-period]').forEach((b) => { const on = b.dataset.period === ui.period; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    const s = summary(ui.period, ref);
    let label;
    if (ui.period === 'semana') {
      const o = { day: '2-digit', month: 'short' };
      label = `${s.start.toLocaleDateString('pt-BR', o)} – ${s.end.toLocaleDateString('pt-BR', o)}`.replace(/\./g, '');
    } else if (ui.period === 'ano') label = String(s.start.getFullYear());
    else label = monthName(s.start);
    $('#period-label').textContent = label;
    const isCurrent = periodRange(ui.period, new Date()).start.getTime() === s.start.getTime();
    $('#next').disabled = isCurrent;
    $('#next').style.opacity = isCurrent ? 0.35 : 1;

    $('#profit').textContent = money(s.lucro);
    $('#profit').classList.toggle('neg', s.lucro < 0);
    $('#income').textContent = money(s.ganhos);
    $('#income-note').textContent = s.estimado ? 'proporcional ao ganho do mês' : (!s.ganhos ? 'nenhum ganho lançado' : '');
    $('#expenses').textContent = money(s.totalGastos);
    $('#profit-after').textContent = money(s.lucroReal);

    const bk = $('#breakdown');
    const entries = Object.keys(TIPOS).map((k) => [k, s.porTipo[k] || 0]).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
    if (!entries.length) {
      bk.innerHTML = '<div class="empty"><b>🌸</b>Nenhum gasto neste período.</div>';
    } else {
      bk.innerHTML = entries.map(([k, v]) => {
        const t = TIPOS[k] || TIPOS.outros;
        const pct = s.totalGastos ? Math.round((v / s.totalGastos) * 100) : 0;
        return `<div class="bk-row"><span class="emo">${t.emoji}</span><span class="name">${t.label} <small class="muted">· ${pct}%</small></span><span class="val">${money(v)}</span><div class="bar"><i style="width:${pct}%;background:${t.color}"></i></div></div>`;
      }).join('');
    }
  }

  function renderHistory() {
    $$('[data-filter]').forEach((b) => b.classList.toggle('on', b.dataset.filter === ui.filter));
    const items = [];
    if (ui.filter !== 'ganhos') db.gastos.forEach((g) => items.push({ kind: 'gasto', mes: g.data.slice(0, 7), sort: g.data + (g.criadoEm || ''), r: g }));
    if (ui.filter !== 'gastos') db.ganhos.forEach((g) => items.push({ kind: 'ganho', mes: g.mes, sort: g.mes + '-99' + (g.criadoEm || ''), r: g }));
    items.sort((a, b) => (a.sort < b.sort ? 1 : -1));

    const el = $('#history-list');
    if (!items.length) {
      el.innerHTML = '<div class="card empty"><b>📝</b>Nada por aqui ainda.<br/>Toque no <strong>+</strong> para lançar.</div>';
      return;
    }
    const groups = new Map();
    items.forEach((it) => { if (!groups.has(it.mes)) groups.set(it.mes, []); groups.get(it.mes).push(it); });
    el.innerHTML = [...groups.entries()].map(([mes, list]) => {
      const inc = list.filter((i) => i.kind === 'ganho').reduce((s, i) => s + Number(i.r.valor), 0);
      const out = list.filter((i) => i.kind === 'gasto').reduce((s, i) => s + Number(i.r.valor), 0);
      const sub = [inc ? '+' + money(inc) : '', out ? '−' + money(out) : ''].filter(Boolean).join(' · ');
      return `<section class="month-group"><div class="month-head"><h3>${monthName(parseDate(mes + '-01'))}</h3><span>${sub}</span></div><div class="list">${list.map(itemHtml).join('')}</div></section>`;
    }).join('');
  }

  function itemHtml(it) {
    const r = it.r;
    if (it.kind === 'gasto') {
      const t = TIPOS[r.tipo] || TIPOS.outros;
      const dt = parseDate(r.data).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, '');
      return `<button type="button" class="item" data-edit="gasto" data-id="${esc(r.id)}"><span class="ico">${t.emoji}</span><span><div class="t">${t.label}</div><div class="s">${esc(dt)}${r.obs ? ' · ' + esc(r.obs) : ''}</div></span><span class="v out">−${money(r.valor)}</span></button>`;
    }
    return `<button type="button" class="item" data-edit="ganho" data-id="${esc(r.id)}"><span class="ico">${APPS[r.app] || '💵'}</span><span><div class="t">Ganho ${esc(r.app)}</div><div class="s">Mês inteiro${r.obs ? ' · ' + esc(r.obs) : ''}</div></span><span class="v in">+${money(r.valor)}</span></button>`;
  }

  // ---------------- Navegação ----------------
  function go(name) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    $$('.tabbar [data-go]').forEach((b) => b.classList.toggle('on', b.dataset.go === name));
    if (name === 'settings') fillSettings();
    window.scrollTo({ top: 0 });
  }

  // ---------------- Folha de lançamento ----------------
  let editing = null; // { kind, id }

  function buildChoices() {
    $('#g-tipos').innerHTML = Object.entries(TIPOS).map(([k, t]) => `<button type="button" class="choice" role="radio" data-tipo="${k}" aria-checked="false"><b>${t.emoji}</b>${t.label}</button>`).join('');
    $('#r-apps').innerHTML = Object.entries(APPS).map(([k, e]) => `<button type="button" class="choice" role="radio" data-app="${k}" aria-checked="false"><b>${e}</b>${k}</button>`).join('');
  }
  const pick = (container, attr, value) => $$(`[data-${attr}]`, container).forEach((b) => b.setAttribute('aria-checked', String(b.dataset[attr] === value)));
  const picked = (container, attr) => { const b = $(`[aria-checked="true"]`, container); return b ? b.dataset[attr] : ''; };

  function setKind(kind) {
    $$('#kind-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.kind === kind));
    $('#form-gasto').hidden = kind !== 'gasto';
    $('#form-ganho').hidden = kind !== 'ganho';
    if (!editing) $('#sheet-title').textContent = kind === 'gasto' ? 'Novo gasto' : 'Ganho do mês';
    setTimeout(() => (kind === 'gasto' ? $('#g-valor') : $('#r-valor')).focus(), 250);
    validate();
  }

  function setDay(iso) {
    $('#g-data').value = iso;
    const today = isoDate(new Date()), yest = isoDate(addDays(new Date(), -1));
    $$('[data-day]').forEach((b) => b.classList.toggle('on', (b.dataset.day === '0' && iso === today) || (b.dataset.day === '-1' && iso === yest)));
  }

  function openSheet(kind, record) {
    editing = record ? { kind, id: record.id } : null;
    $('#kind-tabs').hidden = !!record;
    $('#g-del').hidden = $('#r-del').hidden = !record;
    $('#sheet-title').textContent = record ? (kind === 'gasto' ? 'Editar gasto' : 'Editar ganho') : '';

    if (kind === 'gasto') {
      setMoney($('#g-valor'), record ? record.valor : 0);
      pick($('#g-tipos'), 'tipo', record ? record.tipo : ui.lastTipo);
      setDay(record ? record.data : isoDate(new Date()));
      $('#g-obs').value = record ? record.obs || '' : '';
      $('#g-save').textContent = record ? 'Salvar alterações' : 'Salvar gasto';
    } else {
      setMoney($('#r-valor'), record ? record.valor : 0);
      pick($('#r-apps'), 'app', record ? record.app : ui.lastApp);
      $('#r-mes').value = record ? record.mes : isoMonth(new Date());
      $('#r-obs').value = record ? record.obs || '' : '';
      $('#r-save').textContent = record ? 'Salvar alterações' : 'Salvar ganho';
    }
    $('#sheet').hidden = false;
    document.body.style.overflow = 'hidden';
    setKind(kind);
  }

  function closeSheet() {
    $('#sheet').hidden = true;
    document.body.style.overflow = '';
    editing = null;
  }

  function validate() {
    $('#g-save').disabled = !(getMoney($('#g-valor')) > 0 && picked($('#g-tipos'), 'tipo') && $('#g-data').value);
    const mes = $('#r-mes').value, app = picked($('#r-apps'), 'app');
    $('#r-save').disabled = !(getMoney($('#r-valor')) > 0 && app && mes);
    const dup = db.ganhos.find((g) => g.mes === mes && g.app === app && (!editing || g.id !== editing.id));
    const w = $('#r-warn');
    w.hidden = !dup;
    if (dup) w.textContent = `Você já lançou ${money(dup.valor)} do ${app} em ${monthName(parseDate(mes + '-01'), { month: 'long' })}. Se salvar, os dois valores serão somados. Para corrigir, edite o lançamento no Histórico.`;
  }

  function findRecord(kind, id) { return (kind === 'gasto' ? db.gastos : db.ganhos).find((r) => r.id === id); }

  function removeRecord(kind, id) {
    const rec = findRecord(kind, id);
    if (!rec) return;
    const sheet = kind === 'gasto' ? 'Gastos' : 'Ganhos';
    commit({ op: 'delete', sheet, id });
    toast('Lançamento excluído', 'Desfazer', () => commit({ op: 'upsert', sheet, row: rec }));
  }

  // ---------------- Ajustes ----------------
  function fillSettings() {
    $('#cfg-nome').value = cfg('nome');
    setMoney($('#cfg-valor'), cfgNum('valorVeiculo'));
    $('#cfg-dep').value = cfg('depAnual');
    $('#cfg-man').value = cfg('manutPct');
    $('#api-url').value = api.url;
    $('#api-token').value = api.token;
    $('#form-api').hidden = !!FIXED;
    previewSettings();
  }
  function previewSettings() {
    const v = getMoney($('#cfg-valor')), d = Number($('#cfg-dep').value) || 0;
    const anual = v * d / 100;
    $('#cfg-preview').textContent = v && d ? `Seu carro perde cerca de ${money(anual)} por ano — ${money(anual / 12)} por mês para guardar.` : '';
  }

  // ---------------- Toast ----------------
  let toastTimer;
  function toast(text, actionLabel, action) {
    const t = $('#toast'), btn = $('#toast-action');
    $('#toast-text').textContent = text;
    btn.hidden = !actionLabel;
    btn.textContent = actionLabel || '';
    btn.onclick = () => { t.hidden = true; action && action(); };
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), actionLabel ? 5000 : 2800);
  }

  // ---------------- Eventos ----------------
  function bind() {
    $$('.money').forEach(bindMoney);
    buildChoices();

    document.addEventListener('click', (e) => {
      const goBtn = e.target.closest('[data-go]');
      if (goBtn) return go(goBtn.dataset.go);
      const nb = e.target.closest('[data-new]');
      if (nb) return openSheet(nb.dataset.new);
      const ed = e.target.closest('[data-edit]');
      if (ed) { const r = findRecord(ed.dataset.edit, ed.dataset.id); if (r) openSheet(ed.dataset.edit, r); }
    });

    $$('[data-period]').forEach((b) => b.addEventListener('click', () => { ui.period = b.dataset.period; ref = new Date(); saveUi(); renderHome(); }));
    const shift = (n) => {
      const d = new Date(ref);
      if (ui.period === 'semana') d.setDate(d.getDate() + 7 * n);
      else if (ui.period === 'ano') d.setFullYear(d.getFullYear() + n);
      else { d.setDate(1); d.setMonth(d.getMonth() + n); }
      ref = d; renderHome();
    };
    $('#prev').addEventListener('click', () => shift(-1));
    $('#next').addEventListener('click', () => shift(1));
    $('#period-label').addEventListener('click', () => { ref = new Date(); renderHome(); });

    $('#reserve-done').addEventListener('click', () => {
      const key = 'reserva:' + isoMonth(new Date());
      const done = db.config[key] === '1';
      commit({ op: 'setConfig', key, value: done ? '' : '1' });
      if (!done) toast('Muito bem! Dinheiro guardado 🌷');
    });

    $$('[data-filter]').forEach((b) => b.addEventListener('click', () => { ui.filter = b.dataset.filter; saveUi(); renderHistory(); }));
    $('#sync-btn').addEventListener('click', () => (api.url ? sync() : go('settings')));

    // Folha
    $('#sheet-close').addEventListener('click', closeSheet);
    $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
    $$('#kind-tabs button').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)));
    $('#g-tipos').addEventListener('click', (e) => { const b = e.target.closest('[data-tipo]'); if (b) { pick($('#g-tipos'), 'tipo', b.dataset.tipo); validate(); } });
    $('#r-apps').addEventListener('click', (e) => { const b = e.target.closest('[data-app]'); if (b) { pick($('#r-apps'), 'app', b.dataset.app); validate(); } });
    $$('[data-day]').forEach((b) => b.addEventListener('click', () => { setDay(isoDate(addDays(new Date(), Number(b.dataset.day)))); validate(); }));
    $('#g-data').addEventListener('change', () => { setDay($('#g-data').value); validate(); });
    $('#r-mes').addEventListener('change', validate);
    $$('#g-valor, #r-valor').forEach((i) => i.addEventListener('moneychange', validate));

    $('#form-gasto').addEventListener('submit', (e) => {
      e.preventDefault();
      if ($('#g-save').disabled) return;
      const old = editing && findRecord('gasto', editing.id);
      const row = {
        id: old ? old.id : uid(),
        data: $('#g-data').value,
        tipo: picked($('#g-tipos'), 'tipo'),
        valor: getMoney($('#g-valor')),
        obs: $('#g-obs').value.trim(),
        criadoEm: old ? old.criadoEm : new Date().toISOString(),
      };
      ui.lastTipo = row.tipo; saveUi();
      commit({ op: 'upsert', sheet: 'Gastos', row });
      closeSheet();
      toast(old ? 'Gasto atualizado' : `${TIPOS[row.tipo].emoji} Gasto de ${money(row.valor)} salvo`);
    });

    $('#form-ganho').addEventListener('submit', (e) => {
      e.preventDefault();
      if ($('#r-save').disabled) return;
      const old = editing && findRecord('ganho', editing.id);
      const row = {
        id: old ? old.id : uid(),
        mes: $('#r-mes').value,
        app: picked($('#r-apps'), 'app'),
        valor: getMoney($('#r-valor')),
        obs: $('#r-obs').value.trim(),
        criadoEm: old ? old.criadoEm : new Date().toISOString(),
      };
      ui.lastApp = row.app; saveUi();
      commit({ op: 'upsert', sheet: 'Ganhos', row });
      closeSheet();
      toast(old ? 'Ganho atualizado' : `💵 Ganho de ${money(row.valor)} salvo`);
    });

    $('#g-del').addEventListener('click', () => { const id = editing.id; closeSheet(); removeRecord('gasto', id); });
    $('#r-del').addEventListener('click', () => { const id = editing.id; closeSheet(); removeRecord('ganho', id); });

    // Ajustes
    ['#cfg-valor', '#cfg-dep'].forEach((s) => { $(s).addEventListener('input', previewSettings); $(s).addEventListener('moneychange', previewSettings); });
    $('#form-settings').addEventListener('submit', (e) => {
      e.preventDefault();
      const vals = {
        nome: $('#cfg-nome').value.trim() || DEFAULTS.nome,
        valorVeiculo: String(getMoney($('#cfg-valor'))),
        depAnual: String(Math.min(100, Math.max(0, Number($('#cfg-dep').value) || 0))),
        manutPct: String(Math.min(100, Math.max(0, Number($('#cfg-man').value) || 0))),
      };
      const ops = Object.entries(vals).filter(([k, v]) => db.config[k] !== v).map(([key, value]) => ({ op: 'setConfig', key, value }));
      if (ops.length) commit(...ops);
      toast('Ajustes salvos ✨');
      go('home');
    });

    $('#form-api').addEventListener('submit', (e) => {
      e.preventDefault();
      api = { url: $('#api-url').value.trim(), token: $('#api-token').value.trim() };
      store.set(K.api, api);
      $('#api-status').textContent = api.url ? 'Conectando…' : 'Planilha desconectada. Os dados ficam só no celular.';
      // Envia o que já existe no celular para a planilha nova
      if (api.url && !queue.length && (db.gastos.length || db.ganhos.length)) {
        db.gastos.forEach((row) => queue.push({ op: 'upsert', sheet: 'Gastos', row }));
        db.ganhos.forEach((row) => queue.push({ op: 'upsert', sheet: 'Ganhos', row }));
        Object.entries(db.config).forEach(([key, value]) => queue.push({ op: 'setConfig', key, value }));
        saveQueue();
      }
      sync().then(() => { $('#api-status').textContent = $('#sync-dot').classList.contains('error') ? 'Não conectou. Confira o link e a senha.' : 'Conectado ✓'; });
    });

    $('#api-test').addEventListener('click', async () => {
      const prev = api;
      api = { url: $('#api-url').value.trim(), token: $('#api-token').value.trim() };
      $('#api-status').textContent = 'Testando…';
      try { await call({ action: 'ping' }); $('#api-status').textContent = 'Tudo certo! A planilha respondeu ✓ (toque em "Salvar e conectar")'; }
      catch (err) { $('#api-status').textContent = 'Falhou: ' + err.message; }
      api = prev;
    });

    window.addEventListener('online', () => sync({ silent: true }));
    window.addEventListener('offline', () => setStatus('offline'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); sync({ silent: true }); } });
  }

  // ---------------- Início ----------------
  bind();
  render();
  setStatus(api.url ? (queue.length ? 'pending' : 'ok') : 'local');
  sync({ silent: true });

  // Atalhos do ícone (segurar o ícone no Android)
  const novo = new URLSearchParams(location.search).get('novo');
  if (novo === 'gasto' || novo === 'ganho') { history.replaceState(null, '', '/'); openSheet(novo); }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
