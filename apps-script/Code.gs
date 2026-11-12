/**
 * Controle da Pri — API da planilha (Google Apps Script)
 *
 * Como usar (passo a passo completo no README.md):
 * 1. Crie uma planilha no Google Drive.
 * 2. Menu Extensões > Apps Script. Apague o conteúdo e cole este arquivo.
 * 3. Troque o TOKEN abaixo por uma senha só sua (letras e números).
 * 4. Rode a função "setup" uma vez (botão ▶ Executar) e autorize.
 * 5. Implantar > Nova implantação > Tipo "App da Web"
 *      Executar como: Eu  |  Quem pode acessar: Qualquer pessoa
 * 6. Copie a URL que termina em /exec e cole no app (Ajustes > Planilha).
 */

const TOKEN = 'troque-esta-senha';

const SHEETS = {
  Ganhos: ['id', 'mes', 'app', 'valor', 'obs', 'criadoEm'],
  Gastos: ['id', 'data', 'tipo', 'valor', 'obs', 'criadoEm'],
  Config: ['chave', 'valor'],
};

// Colunas que precisam ficar como texto (evita o Sheets converter em data)
const TEXT_COLS = { Ganhos: 'A:C', Gastos: 'A:C', Config: 'A:B' };

function setup() {
  Object.keys(SHEETS).forEach(getSheet_);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const padrao = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (padrao && padrao.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(padrao);
}

function doGet(e) {
  return handle_((e && e.parameter) || {});
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'JSON inválido' });
  }
  return handle_(body);
}

function handle_(p) {
  try {
    if (TOKEN && p.token !== TOKEN) return json_({ ok: false, error: 'Senha (token) inválida' });

    if (p.action === 'ping') return json_({ ok: true, data: 'pong' });
    if (p.action === 'list') return json_({ ok: true, data: listAll_() });

    if (p.action === 'batch') {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        (p.ops || []).forEach(applyOp_);
      } finally {
        lock.releaseLock();
      }
      return json_({ ok: true, data: { applied: (p.ops || []).length } });
    }

    return json_({ ok: false, error: 'Ação desconhecida: ' + p.action });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function applyOp_(op) {
  if (op.op === 'upsert') return upsert_(op.sheet, op.row);
  if (op.op === 'delete') return remove_(op.sheet, op.id);
  if (op.op === 'setConfig') return setConfig_(op.key, op.value);
  throw new Error('Operação desconhecida: ' + op.op);
}

function getSheet_(name) {
  if (!SHEETS[name]) throw new Error('Aba inválida: ' + name);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(TEXT_COLS[name]).setNumberFormat('@');
    sh.appendRow(SHEETS[name]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, SHEETS[name].length)
      .setFontWeight('bold')
      .setBackground('#F6D9E6');
  }
  return sh;
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function upsert_(name, row) {
  if (!row || !row.id) throw new Error('Registro sem id');
  const sh = getSheet_(name);
  const headers = SHEETS[name];
  const values = headers.map(function (h) {
    if (h === 'valor') return Number(row[h]) || 0;
    return row[h] === undefined || row[h] === null ? '' : String(row[h]);
  });
  const r = findRow_(sh, row.id);
  if (r > 0) sh.getRange(r, 1, 1, headers.length).setValues([values]);
  else sh.appendRow(values);
}

function remove_(name, id) {
  const sh = getSheet_(name);
  const r = findRow_(sh, id);
  if (r > 0) sh.deleteRow(r);
}

function setConfig_(key, value) {
  const sh = getSheet_('Config');
  const r = findRow_(sh, key);
  if (value === null || value === undefined || value === '') {
    if (r > 0) sh.deleteRow(r);
    return;
  }
  if (r > 0) sh.getRange(r, 2).setValue(String(value));
  else sh.appendRow([String(key), String(value)]);
}

function readSheet_(name) {
  const sh = getSheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const headers = SHEETS[name];
  const tz = Session.getScriptTimeZone();
  return sh.getRange(2, 1, last - 1, headers.length).getValues()
    .filter(function (r) { return r[0] !== ''; })
    .map(function (r) {
      const o = {};
      headers.forEach(function (h, i) {
        let v = r[i];
        if (v instanceof Date) {
          v = Utilities.formatDate(v, tz, h === 'mes' ? 'yyyy-MM' : 'yyyy-MM-dd');
        }
        o[h] = h === 'valor' ? Number(v) || 0 : String(v);
      });
      return o;
    });
}

function listAll_() {
  const config = {};
  readSheet_('Config').forEach(function (c) { config[c.chave] = c.valor; });
  return { ganhos: readSheet_('Ganhos'), gastos: readSheet_('Gastos'), config: config };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
