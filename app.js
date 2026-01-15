const API_URL = "https://script.google.com/macros/s/AKfycbwmhQ54wjTLCtllmBV708dCc_i58WZS0qRKMTC6WgsTg02eFB0ZeMmO-8UK41iLaMl1NA/exec";

function $(id){ return document.getElementById(id); }

// num() robusto (pt-BR e ponto decimal)
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
      // 1.234,56 -> 1234.56
      s = s.replace(/\./g,'').replace(',', '.');
    } else {
      // 1,234.56 -> 1234.56
      s = s.replace(/,/g,'');
    }
  } else if (hasComma && !hasDot) {
    // 0,025 -> 0.025
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatBRL(v){
  const n = Number(num(v)||0);
  return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}

function formatPct(p){
  return (num(p)*100).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + '%';
}

function formatDateBR(d){
  try{
    const dt = (d instanceof Date) ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString('pt-BR');
  }catch(_){ return '—'; }
}

function addDays(date, days){
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function todayISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

// POST sem preflight (evita CORS)
async function apiPost(payload){
  const formData = new URLSearchParams();
  formData.append('data', JSON.stringify(payload));
  const res = await fetch(API_URL, { method:'POST', body: formData });
  const txt = await res.text();
  return JSON.parse(txt);
}

// sessão
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

// ======= API helpers =======
async function getConfig(token){ return apiPost({ action:'getConfig', token }); }
async function getCompany(token){ return apiPost({ action:'getCompany', token }); }
async function getBroker(token){ return apiPost({ action:'getBroker', token }); }

// CRM
async function listLeads(token){ return apiPost({ action:'listLeads', token }); } // backend deve filtrar por perfil
async function saveLead(token, payload){ return apiPost({ action:'saveLead', token, payload }); }

// tabelas por faixa
let FEE_TABLES = null;
async function getFeeTables(token){ return apiPost({ action:'getFeeTables', token }); }

function feeByRange(tableArr, x){
  if(!Array.isArray(tableArr)) return 0;
  const v = num(x);
  for(const r of tableArr){
    const min = num(r.min);
    const max = num(r.max);
    const fee = num(r.fee);
    if (v >= min && v <= max) return fee;
  }
  return 0;
}
function amountByRangeFlat(tableArr, x){ return feeByRange(tableArr, x); }
function amountByRangePerM2(tableArr, area){
  const rate = feeByRange(tableArr, area);
  return rate * num(area);
}

// ==== Padrões (descrição transparente) ====
function getPadraoInfo(padrao, config){
  const map = {
    C: {
      label: 'Padrão Básico (Tipo C)',
      desc: 'Piso cerâmico, forro em PVC, laterais e fundo externo lixado e pintado.',
      m2: num(config.PADRAO_C_M2),
    },
    B: {
      label: 'Padrão Intermediário (Tipo B)',
      desc: 'Porcelanato e gesso acartonado OU gesso e emassado externo (laterais/fundo) OU porcelanato e emassado externo.',
      m2: num(config.PADRAO_B_M2),
    },
    A: {
      label: 'Padrão Normal (Tipo A)',
      desc: 'Porcelanato, forro em gesso acartonado, emassada por dentro e por fora.',
      m2: num(config.PADRAO_A_M2),
    }
  };
  return map[padrao] || map.A;
}

// ======= CÁLCULO COMPLETO =======
function calcTotal(payload, config){
  const area = num(payload.area_m2);
  const padrao = payload.padrao;

  const padraoInfo = getPadraoInfo(padrao, config);

  // Laje
  const temLaje = (payload.laje === 'SIM');
  const lajeAd = num(config.LAJE_ADIC_M2);
  const laje = temLaje ? (area * lajeAd) : 0;

  // Construção base
  const custoBase = area * padraoInfo.m2;

  // Regra: sem laje => projeto SEM estrutural; com laje => projeto COM estrutural
  const projetoTipo = temLaje ? 'COM_ESTRUTURAL' : 'SEM_ESTRUTURAL';
  const projetoRateM2 = (projetoTipo === 'COM_ESTRUTURAL') ? num(config.PROJ_COM_ESTR_M2) : num(config.PROJ_SEM_ESTR_M2);
  const projetoValor = area * projetoRateM2;

  // Valor da obra (para exibir / averbação)
  const valorObra = custoBase + laje;

  // Terreno (Terreno+Construção e não próprio)
  const terrenoProprio = payload.terreno_proprio === 'SIM';
  const operacaoTerrenoConstrucao = payload.operacao === 'TERRENO_E_CONSTRUCAO';
  const valorTerrenoCalc = (!terrenoProprio && operacaoTerrenoConstrucao) ? num(payload.valor_terreno) : 0;

  // Total do imóvel (Terreno + Construção) = BASE SEMPRE para o cálculo do financiamento (como você definiu)
  const totalTerrenoConstrucao = valorTerrenoCalc + valorObra;

  // Simulador Caixa
  const entrada = num(payload.entrada);
  const subsidio = num(payload.subsidio);
  const porFora = num(payload.valor_por_fora);

  let valorAFinanciar = totalTerrenoConstrucao - entrada - subsidio - porFora;
  if (valorAFinanciar < 0) valorAFinanciar = 0;

  // Se usuário preencheu "valor_financiado", usamos como fallback
  const valorFinInput = num(payload.valor_financiado);
  const valorFinBase = (valorAFinanciar > 0) ? valorAFinanciar : valorFinInput;

  // Taxa financiamento (MCMV 2,5% / Outros 2%)
  const taxaFinPerc = (payload.tipo_financiamento === 'MCMV') ? num(config.TAXA_FIN_MCMV) : num(config.TAXA_FIN_OUTROS);
  const taxaFinR = valorFinBase * taxaFinPerc;

  // ITBI
  let itbi = 0;
  let itbiIsentoBV = false;
  let itbiPercAplicada = 0;

  if (!terrenoProprio && operacaoTerrenoConstrucao){
    if (payload.cidade === 'BOA_VISTA'){
      const limiteSM = num(config.LIMITE_ISENCAO_SM);    // 7
      const salarioMin = num(config.SALARIO_MINIMO);     // vigente
      const renda = num(payload.renda_bruta_familiar);
      itbiIsentoBV = (renda > 0 && renda <= (limiteSM * salarioMin));
      itbiPercAplicada = num(config.ITBI_BV_TAXA);       // 0.015, por exemplo
      itbi = itbiIsentoBV ? 0 : (valorTerrenoCalc * itbiPercAplicada);
    } else {
      itbiPercAplicada = num(config.ITBI_OUTROS_TAXA);   // 0.015
      itbi = valorTerrenoCalc * itbiPercAplicada;
    }
  }

  // Vistoria (automática sempre)
  const vistoria = num(config.VISTORIA_CAIXA_FIXO);

  // TAO (MCMV: % financiado; Outros: fixo 1600)
  const taoPerc = num(config.TAO_MCMV);
  const taoFixo = num(config.TAO_OUTROS_FIXO);
  const tao = (payload.tipo_financiamento === 'MCMV') ? (valorFinBase * taoPerc) : taoFixo;

  // Calçada
  const calcadaPrecoML = num(config.CALCADA_PRECO_METRO_LINEAR);
  let calcada = 0;
  if (payload.cidade === 'BOA_VISTA' && payload.possui_calcada === 'NAO'){
    const ml = num(payload.calcada_metros_lineares);
    calcada = ml * calcadaPrecoML;
  }

  // ===== Tabelas por faixa =====
  const t = FEE_TABLES || {};
  const crea = amountByRangeFlat(t['CREA_Faixas_Area'], area);

  // ALVARÁ = tarifa por m² × área
  const alvaraRate = (payload.cidade === 'BOA_VISTA')
    ? feeByRange(t['Alvara_BV_Faixas_Area'], area)
    : (payload.cidade === 'CANTA')
      ? feeByRange(t['Alvara_Canta_Faixas_Area'], area)
      : 0;
  const alvara = alvaraRate * area;

  // Registro Alienação = faixa por valor financiado
  const regAlienacao = amountByRangeFlat(t['Registro_Alienacao_Faixas_Valor'], valorFinBase);

  // Habite-se = tarifa por m² × área
  const habiteRate = (payload.cidade === 'BOA_VISTA')
    ? feeByRange(t['HabiteSe_BV_Faixas_Area'], area)
    : (payload.cidade === 'CANTA')
      ? feeByRange(t['HabiteSe_Canta_Faixas_Area'], area)
      : 0;
  const habite = habiteRate * area;

  // CNO (após Habite-se, só se >70m²)
  let cno = 0;
  if (area > 70){
    const cnoPerc = num(config.CNO_PERC);
    const cnoFixo = num(config.CNO_FIXO);
    cno = cnoPerc > 0 ? (valorFinBase * cnoPerc) : cnoFixo;
  }

  // Averbação = faixa por VALOR DA OBRA
  const averbacao = amountByRangeFlat(t['Registro_Averbacao_Faixas_Valor'], valorObra);

  // Custas previstas (sem contar terreno+obra)
  const custasPrevistas =
    projetoValor + crea + alvara + vistoria + taxaFinR + itbi + regAlienacao + tao + calcada + habite + cno + averbacao;

  // Total geral (imóvel + custas)
  const totalGeral = totalTerrenoConstrucao + custasPrevistas;

  // Datas
  const dataSim = payload.data_simulacao ? new Date(payload.data_simulacao) : new Date();
  const validadeDias = num(payload.validade_dias) || num(config.VALIDADE_PROPOSTA_DIAS) || 0;
  const dataVal = validadeDias ? addDays(dataSim, validadeDias) : null;

  return {
    // bases
    area,
    padraoInfo,
    custoBase,
    temLaje,
    lajeAd,
    laje,
    valorObra,
    terrenoProprio,
    valorTerrenoCalc,
    totalTerrenoConstrucao,

    // projeto
    projetoTipo,
    projetoRateM2,
    projetoValor,

    // financiamento
    entrada,
    subsidio,
    porFora,
    valorAFinanciar,
    valorFinBase,

    // itens / custas
    crea,
    alvaraRate,
    alvara,
    vistoria,
    taxaFinPerc,
    taxaFinR,
    itbi,
    itbiIsentoBV,
    itbiPercAplicada,
    regAlienacao,
    taoPerc,
    taoFixo,
    tao,
    calcadaPrecoML,
    calcada,
    habiteRate,
    habite,
    cno,
    averbacao,

    custasPrevistas,
    totalGeral,

    // datas
    dataSim,
    validadeDias,
    dataVal
  };
}

// ======= Utilitário: UUID simples =======
function uuid(){
  // suficiente para lead_id
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
    const r = Math.random()*16|0;
    const v = c==='x'? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

// ======= Lead “carregar no simulador” via localStorage =======
function setLeadToLoad(lead){
  localStorage.setItem('lead_to_load', JSON.stringify(lead));
}
function getLeadToLoad(){
  const raw = localStorage.getItem('lead_to_load');
  if(!raw) return null;
  try { return JSON.parse(raw); } catch(_){ return null; }
}
function clearLeadToLoad(){
  localStorage.removeItem('lead_to_load');
}
