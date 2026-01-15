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

// tabelas por faixa (carregadas após login)
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

// faixa fixa (retorna fee)
function amountByRangeFlat(tableArr, x){
  return feeByRange(tableArr, x);
}

// faixa por m² (retorna (fee_por_m2 * area))
function amountByRangePerM2(tableArr, area){
  const rate = feeByRange(tableArr, area);
  return rate * num(area);
}

// ======= CÁLCULO COMPLETO =======
function calcTotal(payload, config){
  const area = num(payload.area_m2);
  const padrao = payload.padrao;

  // m² por padrão
  const m2C = num(config.PADRAO_C_M2);
  const m2B = num(config.PADRAO_B_M2);
  const m2A = num(config.PADRAO_A_M2);
  const lajeAd = num(config.LAJE_ADIC_M2);

  const valorM2 = (padrao === 'C' ? m2C : (padrao === 'B' ? m2B : m2A));
  const custoBase = area * valorM2;
  const laje = (payload.laje === 'SIM') ? (area * lajeAd) : 0;

  // Projetos (somente um deve entrar)
  const projSem = (payload.projeto === 'SEM_ESTRUTURAL') ? (area * num(config.PROJ_SEM_ESTR_M2)) : 0;
  const projCom = (payload.projeto === 'COM_ESTRUTURAL') ? (area * num(config.PROJ_COM_ESTR_M2)) : 0;

  // Valor da obra (para exibir / averbação)
  const valorObra = custoBase + laje;

  // Terreno entra quando: Terreno+Construção e não é terreno próprio
  const terrenoProprio = payload.terreno_proprio === 'SIM';
  const operacaoTerrenoConstrucao = payload.operacao === 'TERRENO_E_CONSTRUCAO';
  const valorTerrenoCalc = (!terrenoProprio && operacaoTerrenoConstrucao) ? num(payload.valor_terreno) : 0;

  // Total base do imóvel (Terreno + Construção) => SEMPRE base do financiamento (como você definiu)
  const totalTerrenoConstrucao = valorTerrenoCalc + valorObra;

  // Simulador Caixa
  const entrada = num(payload.entrada);
  const subsidio = num(payload.subsidio);
  const porFora = num(payload.valor_por_fora);

  let valorAFinanciar = totalTerrenoConstrucao - entrada - subsidio - porFora;
  if (valorAFinanciar < 0) valorAFinanciar = 0;

  // Se o corretor também preencheu "valor financiado" manualmente, usamos o calculado como prioridade
  const valorFinInput = num(payload.valor_financiado);
  const valorFinBase = valorAFinanciar > 0 ? valorAFinanciar : valorFinInput;

  // Taxa de financiamento (porcentual do valor financiado)
  const taxaFin = (payload.tipo_financiamento === 'MCMV') ? num(config.TAXA_FIN_MCMV) : num(config.TAXA_FIN_OUTROS);
  const taxaFinR = valorFinBase * taxaFin;

  // ITBI (apenas quando Terreno+Construção e NÃO é terreno próprio)
  let itbi = 0;
  if (!terrenoProprio && operacaoTerrenoConstrucao){
    if (payload.cidade === 'BOA_VISTA'){
      const limiteSM = num(config.LIMITE_ISENCAO_SM);
      const salarioMin = num(config.SALARIO_MINIMO);
      const renda = num(payload.renda_bruta_familiar);
      const isento = renda > 0 && renda <= (limiteSM * salarioMin);
      itbi = isento ? 0 : (valorTerrenoCalc * num(config.ITBI_BV_TAXA));
    } else {
      itbi = valorTerrenoCalc * num(config.ITBI_OUTROS_TAXA);
    }
  }

  // Vistoria (aplica/nao)
  const vistoria = (payload.vistoria_aplica === 'SIM') ? num(config.VISTORIA_CAIXA_FIXO) : 0;

  // TAO (MCMV: % do financiado; Outros: fixo)
  const tao = (payload.tipo_financiamento === 'MCMV')
    ? (valorFinBase * num(config.TAO_MCMV))
    : num(config.TAO_OUTROS_FIXO);

  // Calçada (Boa Vista, se não tem)
  let calcada = 0;
  if (payload.cidade === 'BOA_VISTA' && payload.possui_calcada === 'NAO'){
    const ml = num(payload.calcada_metros_lineares);
    calcada = ml * num(config.CALCADA_PRECO_METRO_LINEAR);
  }

  // ===== Tabelas por faixa =====
  const t = FEE_TABLES || {};

  // CREA = valor fixo por faixa de área
  const crea = amountByRangeFlat(t['CREA_Faixas_Area'], area);

  // ALVARÁ = tarifa por m² × área (faixa define o preço do m²)
  const alvara = (payload.cidade === 'BOA_VISTA')
    ? amountByRangePerM2(t['Alvara_BV_Faixas_Area'], area)
    : (payload.cidade === 'CANTA')
      ? amountByRangePerM2(t['Alvara_Canta_Faixas_Area'], area)
      : 0;

  // Registro Alienação = valor fixo por faixa do valor financiado
  const regAlienacao = amountByRangeFlat(t['Registro_Alienacao_Faixas_Valor'], valorFinBase);

  // Habite-se = tarifa por m² × área
  const habite = (payload.cidade === 'BOA_VISTA')
    ? amountByRangePerM2(t['HabiteSe_BV_Faixas_Area'], area)
    : (payload.cidade === 'CANTA')
      ? amountByRangePerM2(t['HabiteSe_Canta_Faixas_Area'], area)
      : 0;

  // CNO (após Habite-se, só se >70m²)
  let cno = 0;
  if (area > 70){
    const cnoPerc = num(config.CNO_PERC); // ex: 0.015
    const cnoFixo = num(config.CNO_FIXO); // ex: 0
    cno = cnoPerc > 0 ? (valorFinBase * cnoPerc) : cnoFixo;
  }

  // Averbação = valor fixo por faixa do VALOR DA OBRA (não do financiado)
  const averbacao = amountByRangeFlat(t['Registro_Averbacao_Faixas_Valor'], valorObra);

  // Total geral (custas/documentos + construção/projetos)
  const totalCustas = (
    projSem + projCom +
    crea + alvara + vistoria + taxaFinR + itbi + regAlienacao +
    tao + calcada + habite + cno + averbacao
  );

  const totalGeral = valorObra + valorTerrenoCalc + totalCustas;

  return {
    // bases
    area,
    valorM2,
    custoBase,
    laje,
    projSem,
    projCom,
    valorObra,
    valorTerrenoCalc,
    totalTerrenoConstrucao,

    // financiamento
    entrada,
    subsidio,
    porFora,
    valorAFinanciar,
    valorFinBase,

    // custas/documentos
    crea,
    alvara,
    vistoria,
    taxaFinR,
    itbi,
    regAlienacao,
    tao,
    calcada,
    habite,
    cno,
    averbacao,

    totalCustas,
    totalGeral
  };
}
