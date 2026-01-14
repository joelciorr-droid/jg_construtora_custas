const API_URL = "https://script.google.com/macros/s/AKfycbx4xJEoVymcBt8muOp_uEVxIinPl8WL1jGE_iDB3Rx1vU-MWKytDJhymcFWTFSjG0cziw/exec";

function $(id){ return document.getElementById(id); }

function num(v){
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;

  let s = String(v).trim();
  if (!s) return 0;

  s = s.replace(/\s/g,'').replace('%','');

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      s = s.replace(/\./g,'').replace(',', '.'); // pt-BR
    } else {
      s = s.replace(/,/g,''); // 1,234.56
    }
  } else if (hasComma && !hasDot) {
    s = s.replace(',', '.'); // 0,025 -> 0.025
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatBRL(v){
  const n = Number(num(v)||0);
  return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}

// POST sem preflight (CORS ok)
async function apiPost(payload){
  const formData = new URLSearchParams();
  formData.append('data', JSON.stringify(payload));
  const res = await fetch(API_URL, { method:'POST', body: formData });
  const txt = await res.text();
  return JSON.parse(txt);
}

function setSession(token, user){
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}
function getSession(){
  const token = localStorage.getItem('token');
  const userRaw = localStorage.getItem('user');
  return { token, user: userRaw ? JSON.parse(userRaw) : null };
}
function clearSession(){
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

// Helpers API
async function getConfig(token){ return apiPost({ action:'getConfig', token }); }
async function getCompany(token){ return apiPost({ action:'getCompany', token }); }
async function getBroker(token){ return apiPost({ action:'getBroker', token }); }
async function listLeads(token){ return apiPost({ action:'listLeads', token }); }
async function updateLead(token, rowNumber, patch){ return apiPost({ action:'updateLead', token, rowNumber, patch }); }

// Cálculo: mantém seu MVP + (aqui depois vamos incluir faixas)
function calcTotal(payload, config){
  const area = num(payload.area_m2);
  const padrao = payload.padrao;

  const m2C = num(config.PADRAO_C_M2);
  const m2B = num(config.PADRAO_B_M2);
  const m2A = num(config.PADRAO_A_M2);
  const lajeAd = num(config.LAJE_ADIC_M2);

  let valorM2 = padrao === 'C' ? m2C : padrao === 'B' ? m2B : m2A;
  const custoBase = area * valorM2;
  const laje = payload.laje === 'SIM' ? area * lajeAd : 0;

  const projSem = payload.projeto === 'SEM_ESTRUTURAL' ? area * num(config.PROJ_SEM_ESTR_M2) : 0;
  const projCom = payload.projeto === 'COM_ESTRUTURAL' ? area * num(config.PROJ_COM_ESTR_M2) : 0;

  const valorFin = num(payload.valor_financiado);
  const taxaFin = payload.tipo_financiamento === 'MCMV' ? num(config.TAXA_FIN_MCMV) : num(config.TAXA_FIN_OUTROS);
  const taxaFinR = valorFin * taxaFin;

  const valorTerreno = num(payload.valor_terreno);
  let itbi = 0;
  if (payload.operacao !== 'CONSTRUCAO_APENAS'){
    if (payload.cidade === 'BOA_VISTA'){
      const limiteSM = num(config.LIMITE_ISENCAO_SM);
      const salarioMin = num(config.SALARIO_MINIMO);
      const renda = num(payload.renda_bruta_familiar);
      const isento = renda > 0 && renda <= (limiteSM * salarioMin);
      itbi = isento ? 0 : (valorTerreno * num(config.ITBI_BV_TAXA));
    } else {
      itbi = valorTerreno * num(config.ITBI_OUTROS_TAXA);
    }
  }

  const vistoria = num(config.VISTORIA_CAIXA_FIXO);

  const tao = payload.tipo_financiamento === 'MCMV'
    ? (valorFin * num(config.TAO_MCMV))
    : num(config.TAO_OUTROS_FIXO);

  let calcada = 0;
  if (payload.cidade === 'BOA_VISTA' && payload.possui_calcada === 'NAO'){
    const ml = num(payload.calcada_metros_lineares);
    calcada = ml * num(config.CALCADA_PRECO_METRO_LINEAR);
  }

  const total = custoBase + laje + projSem + projCom + taxaFinR + itbi + vistoria + tao + calcada;
  return { custoBase, laje, projSem, projCom, taxaFinR, itbi, vistoria, tao, calcada, total };
}
