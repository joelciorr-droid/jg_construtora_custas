// ======================================================
//  JG SIMULADOR - app.js (COMPLETO)
//  Cole este arquivo inteiro no seu app.js do GitHub
// ======================================================

// 1) COLE AQUI a URL do WebApp do Apps Script (termina com /exec)
const API_URL = "https://script.google.com/macros/s/AKfycbyBV_4JklA8sfMbNWOnDMXxmBqvcKyb60MxOKb8X2-CBqnMW5jK7JMiVSyNCR89_O_yYQ/exec";

// ===== util DOM =====
function $(id){ return document.getElementById(id); }

// ===== números e moeda =====
function num(v){
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  let s = String(v).trim();
  if (!s) return 0;

  s = s.replace(/\s/g, "");
  s = s.replace(/[^\d.,-]/g, "");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    s = s.replace(",", ".");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatBRL(v){
  const n = Number(num(v) || 0);
  return n.toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
}

function formatPct(p){
  const n = num(p) * 100;
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%";
}

// ===== datas =====
function todayISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function addDaysISO(iso, days){
  const d = new Date(iso || todayISO());
  d.setDate(d.getDate() + Number(days||0));
  return d.toISOString().slice(0,10);
}
function formatDateBR(x){
  if(!x) return "—";
  const d = new Date(x);
  if(Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

// ===== uuid simples =====
function uuid(){
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c=>{
    const r = Math.random()*16|0;
    const v = c==="x" ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

// ===== sessão =====
function setSession(token, user){
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
}
function getSession(){
  const token = localStorage.getItem("token");
  const userRaw = localStorage.getItem("user");
  return { token, user: userRaw ? JSON.parse(userRaw) : null };
}
function clearSession(){
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

// ===== "passar lead do CRM pro simulador" =====
const LEAD_TO_LOAD_KEY = "jg_lead_to_load";
function setLeadToLoad(lead){
  localStorage.setItem(LEAD_TO_LOAD_KEY, JSON.stringify(lead));
}
function getLeadToLoad(){
  const raw = localStorage.getItem(LEAD_TO_LOAD_KEY);
  return raw ? JSON.parse(raw) : null;
}
function clearLeadToLoad(){
  localStorage.removeItem(LEAD_TO_LOAD_KEY);
}

// ===== API POST (sem preflight) =====
async function apiPost(payload){
  if(!API_URL || API_URL.includes("COLE_AQUI")){
    throw new Error("API_URL não configurada no app.js (cole a URL do WebApp /exec).");
  }

  const form = new URLSearchParams();
  form.append("data", JSON.stringify(payload));

  const res = await fetch(API_URL, { method:"POST", body: form });
  const txt = await res.text();

  try {
    return JSON.parse(txt);
  } catch {
    throw new Error("Resposta não-JSON do WebApp. Verifique implantação/permissões. Trecho: " + txt.slice(0,180));
  }
}

// ===== endpoints =====
async function getConfig(token){ return apiPost({ action:"getConfig", token }); }
async function getCompany(token){ return apiPost({ action:"getCompany", token }); }
async function getBroker(token){ return apiPost({ action:"getBroker", token }); }
async function getFeeTables(token){ return apiPost({ action:"getFeeTables", token }); }
async function saveLead(token, payload){ return apiPost({ action:"saveLead", token, payload }); }
async function listLeads(token, filter){ return apiPost({ action:"listLeads", token, filter: filter||{} }); }

// ===== tabelas carregadas =====
let FEE_TABLES = null;

// ===== faixa fixa (robusto) =====
function pickAny(obj, keys){
  if(!obj || typeof obj !== "object") return undefined;
  for(const k of keys){
    if(Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  const lowerMap = {};
  for(const kk of Object.keys(obj)) lowerMap[kk.toLowerCase()] = obj[kk];
  for(const k of keys){
    const v = lowerMap[String(k).toLowerCase()];
    if(v !== undefined) return v;
  }
  return undefined;
}

function normalizeRow(r){
  if(Array.isArray(r)) return { min: r[0], max: r[1], fee: r[2] };
  if(!r || typeof r !== "object") return { min: 0, max: 0, fee: 0 };
  return {
    min: pickAny(r, ["min","Min","MIN","minimo","Minimo","MINIMO"]),
    max: pickAny(r, ["max","Max","MAX","maximo","Maximo","MAXIMO"]),
    fee: pickAny(r, ["fee","Fee","FEE","valor","Valor","VALOR","value","Value","VALUE"])
  };
}

function feeByRange(tableArr, x){
  if(!Array.isArray(tableArr)) return 0;
  const v = num(x);
  for(const raw of tableArr){
    const r = normalizeRow(raw);
    const min = num(r.min);
    const max = num(r.max);
    const fee = num(r.fee);
    if(!Number.isFinite(min) || !Number.isFinite(max)) continue;
    if(v >= min && v <= max) return fee;
  }
  return 0;
}

function amountByRangeFlat(tableArr, x){
  return feeByRange(tableArr, x);
}

// ===== Padrões (descrição) =====
function padraoInfo(padrao, config){
  if(padrao === "C"){
    return {
      label: "Padrão Básico (Tipo C)",
      m2: num(config.PADRAO_C_M2),
      desc: "Piso cerâmico, forro em PVC, laterais e fundo externo apenas lixado e pintado."
    };
  }
  if(padrao === "B"){
    return {
      label: "Padrão Intermediário (Tipo B)",
      m2: num(config.PADRAO_B_M2),
      desc: "Piso em porcelanato e forro em gesso acartonado OU gesso + emassamento externo parcial, conforme especificação."
    };
  }
  return {
    label: "Padrão Normal (Tipo A)",
    m2: num(config.PADRAO_A_M2),
    desc: "Piso em porcelanato, forro em gesso acartonado e toda emassada dentro e fora."
  };
}

// ======================================================
//  CÁLCULO PRINCIPAL (CONSTRUÇÃO + VENDA DE IMÓVEL)
// ======================================================
function calcTotal(payload, config){
  const t = FEE_TABLES || {};
  const tipoSim = payload.tipo_simulacao || "CONSTRUCAO";
  const isVenda = (tipoSim === "VENDA");
  const isProprio = (payload.tipo_financiamento === "PROPRIO");

  // -------------------------
  // VENDA DE IMÓVEL (NOVO/USADO) - FIX
  // -------------------------
  if(isVenda){
    const valorImovel = num(payload.valor_imovel);
    const entrada = num(payload.entrada);

    const subsidio = isProprio ? 0 : num(payload.subsidio);
    const porFora  = isProprio ? 0 : num(payload.valor_por_fora);

    // VALOR A FINANCIAR (sempre calculado)
    let valorAFinanciar = valorImovel - entrada - subsidio - porFora;
    if(valorAFinanciar < 0) valorAFinanciar = 0;

    // Recursos próprios: saldo a negociar = valorImovel - entrada
    const saldoNegociar = isProprio ? Math.max(0, valorImovel - entrada) : 0;

    // Base de cálculo bancária = valorAFinanciar (quando banco)
    const valorFinBase = (!isProprio) ? valorAFinanciar : 0;

    // Bancários (somente quando há banco)
    const vistoria = isProprio ? 0 : num(config.VISTORIA_CAIXA_FIXO);

    const taxaFinPerc = isProprio ? 0
      : ((payload.tipo_financiamento === "MCMV") ? num(config.TAXA_FIN_MCMV) : num(config.TAXA_FIN_OUTROS));

    const taxaFinR = isProprio ? 0 : (valorFinBase * taxaFinPerc);

    // ITBI (imóvel novo/usado)
    let itbi = 0, itbiIsentoBV = false, itbiPercAplicada = 0;
    const cidade = payload.cidade;
    const renda = num(payload.renda_bruta_familiar);
    const primeiro = (payload.primeiro_imovel === "SIM");

    if(cidade === "BOA_VISTA"){
      const limiteSM = num(config.LIMITE_ISENCAO_SM);
      const salarioMin = num(config.SALARIO_MINIMO);
      const isento = primeiro && renda > 0 && renda <= (limiteSM * salarioMin);
      if(isento){
        itbiIsentoBV = true;
        itbi = 0;
      } else {
        itbiPercAplicada = num(config.ITBI_BV_TAXA);
        itbi = valorImovel * itbiPercAplicada;
      }
    } else {
      itbiPercAplicada = num(config.ITBI_OUTROS_TAXA);
      itbi = valorImovel * itbiPercAplicada;
    }

    // Registro alienação (somente banco)
    const regAlienacao = isProprio ? 0 : amountByRangeFlat(t["Registro_Alienacao_Faixas_Valor"], valorFinBase);

    const dataSim = payload.data_simulacao || todayISO();
    const validadeDias = num(payload.validade_dias) || num(config.VALIDADE_PADRAO_DIAS) || 7;
    const dataVal = addDaysISO(dataSim, validadeDias);

    // Custas previstas (venda)
    const custasPrevistas = (vistoria + taxaFinR + itbi + regAlienacao);

    // Total geral = valor do imóvel + custas
    const totalGeral = valorImovel + custasPrevistas;

    return {
      tipo_simulacao: "VENDA",
      isVenda: true,
      isProprio,

      valorImovel,
      totalTerrenoConstrucao: valorImovel,

      entrada,
      subsidio,
      porFora,
      valorAFinanciar,
      saldoNegociar,
      valorFinBase,

      vistoria,
      taxaFinPerc,
      taxaFinR,

      itbi,
      itbiIsentoBV,
      itbiPercAplicada,

      regAlienacao,

      // campos "não usados" para não quebrar render
      area: 0,
      padraoInfo: null,
      custoBase: 0,
      temLaje: false,
      lajeAd: 0,
      laje: 0,
      projetoTipo: "",
      projetoRateM2: 0,
      projetoValor: 0,
      crea: 0,
      alvaraRate: 0,
      alvara: 0,
      canta_autent: 0,
      canta_execucao: 0,
      canta_legalizacao: 0,
      habiteRate: 0,
      habite: 0,
      calcadaPrecoML: 0,
      calcada: 0,
      cno: 0,
      averbacao: 0,
      taoPerc: 0,
      taoFixo: 0,
      tao: 0,
      valorObra: 0,
      valorTerrenoCalc: 0,

      dataSim,
      dataVal,
      validadeDias,

      custasPrevistas,
      totalGeral
    };
  }

  // -------------------------
  // CONSTRUÇÃO (já existente)
  // -------------------------
  const area = num(payload.area_m2);
  const pInfo = padraoInfo(payload.padrao, config);

  // base
  const custoBase = area * pInfo.m2;

  // laje
  const lajeAd = num(config.LAJE_ADIC_M2);
  const temLaje = (payload.laje === "SIM");
  const laje = temLaje ? (area * lajeAd) : 0;

  // projeto automático
  const projetoTipo = temLaje ? "COM_ESTRUTURAL" : "SEM_ESTRUTURAL";
  const projetoRateM2 = (projetoTipo === "COM_ESTRUTURAL")
    ? num(config.PROJ_COM_ESTR_M2)
    : num(config.PROJ_SEM_ESTR_M2);
  const projetoValor = area * projetoRateM2;

  // valor obra
  const valorObra = custoBase + laje;

  // terreno
  const terrenoProprio = (payload.terreno_proprio === "SIM") || isProprio;
  const operacaoTerrenoConstrucao = (!isProprio && payload.operacao === "TERRENO_E_CONSTRUCAO");
  const valorTerrenoCalc = (!terrenoProprio && operacaoTerrenoConstrucao) ? num(payload.valor_terreno) : 0;

  const totalTerrenoConstrucao = valorTerrenoCalc + valorObra;

  // composição
  const entrada = num(payload.entrada);
  const subsidio = isProprio ? 0 : num(payload.subsidio);
  const porFora = isProprio ? 0 : num(payload.valor_por_fora);

  let valorAFinanciar = totalTerrenoConstrucao - entrada - subsidio - porFora;
  if(valorAFinanciar < 0) valorAFinanciar = 0;

  const saldoNegociar = isProprio ? Math.max(0, totalTerrenoConstrucao - entrada) : 0;

  // base financiamento quando banco
  const valorFinBase = (!isProprio) ? valorAFinanciar : 0;

  // CREA
  const creaTable = t["CREA_Faixas_Area"] || t["CREA"] || null;
  const crea = amountByRangeFlat(creaTable, area);

  // ===== Alvará / Habite-se =====
  let alvaraRate = 0, alvara = 0;
  let habiteRate = 0, habite = 0;
  let canta_autent = 0, canta_execucao = 0, canta_legalizacao = 0;

  if(payload.cidade === "CANTA"){
    const tarifa = num(config.CANTA_ALVARA_TARIFA);
    const qtdAut = num(config.CANTA_ALVARA_AUTENT_QTDE) || 20;
    const fatorLeg = num(config.CANTA_ALVARA_LEGALIZACAO_FATOR) || 0.5;

    canta_autent = tarifa * qtdAut;
    canta_execucao = tarifa * area;
    canta_legalizacao = canta_execucao * fatorLeg;

    alvaraRate = tarifa;
    alvara = canta_autent + canta_execucao + canta_legalizacao;

    habiteRate = num(config.CANTA_HABITESE_TARIFA) || tarifa;
    habite = habiteRate * area;

  } else if(payload.cidade === "BOA_VISTA"){
    alvaraRate = feeByRange(t["Alvara_BV_Faixas_Area"], area);
    alvara = alvaraRate * area;

    habiteRate = feeByRange(t["HabiteSe_BV_Faixas_Area"], area);
    habite = habiteRate * area;
  }

  // CNO > 70m²
  let cno = 0;
  if(area > 70){
    const cnoPerc = num(config.CNO_PERC);
    const cnoFixo = num(config.CNO_FIXO);
    const baseCno = isProprio ? totalTerrenoConstrucao : valorFinBase;
    cno = cnoPerc > 0 ? (baseCno * cnoPerc) : cnoFixo;
  }

  // Averbação faixa pelo valor da obra
  const averbacao = amountByRangeFlat(t["Registro_Averbacao_Faixas_Valor"], valorObra);

  // Calçada
  const calcadaPrecoML = num(config.CALCADA_PRECO_METRO_LINEAR);
  let calcada = 0;
  if(payload.cidade === "BOA_VISTA" && payload.possui_calcada === "NAO"){
    calcada = num(payload.calcada_metros_lineares) * calcadaPrecoML;
  }

  // Bancários (zerados em PROPRIO)
  const vistoria = isProprio ? 0 : num(config.VISTORIA_CAIXA_FIXO);

  const taxaFinPerc = isProprio ? 0
    : ((payload.tipo_financiamento === "MCMV") ? num(config.TAXA_FIN_MCMV) : num(config.TAXA_FIN_OUTROS));

  const taxaFinR = isProprio ? 0 : (valorFinBase * taxaFinPerc);

  // ITBI (terreno): só quando compra terreno (terreno+construção) e não é próprio
  let itbi = 0, itbiIsentoBV = false, itbiPercAplicada = 0;
  if(!isProprio && !terrenoProprio && operacaoTerrenoConstrucao){
    if(payload.cidade === "BOA_VISTA"){
      const limiteSM = num(config.LIMITE_ISENCAO_SM);
      const salarioMin = num(config.SALARIO_MINIMO);
      const renda = num(payload.renda_bruta_familiar);
      const isento = renda > 0 && renda <= (limiteSM * salarioMin);
      if(isento){
        itbiIsentoBV = true;
        itbi = 0;
      } else {
        itbiPercAplicada = num(config.ITBI_BV_TAXA);
        itbi = valorTerrenoCalc * itbiPercAplicada;
      }
    } else {
      itbiPercAplicada = num(config.ITBI_OUTROS_TAXA);
      itbi = valorTerrenoCalc * itbiPercAplicada;
    }
  }

  // Registro de alienação (só banco)
  const regAlienacao = isProprio ? 0 : amountByRangeFlat(t["Registro_Alienacao_Faixas_Valor"], valorFinBase);

  // TAO (só banco)
  const taoPerc = num(config.TAO_MCMV);
  const taoFixo = num(config.TAO_OUTROS_FIXO);
  const tao = isProprio ? 0 : ((payload.tipo_financiamento === "MCMV") ? (valorFinBase * taoPerc) : taoFixo);

  // datas
  const dataSim = payload.data_simulacao || todayISO();
  const validadeDias = num(payload.validade_dias) || num(config.VALIDADE_PADRAO_DIAS) || 7;
  const dataVal = addDaysISO(dataSim, validadeDias);

  // custas previstas
  const custasPrevistas = (
    projetoValor +
    crea +
    alvara +
    vistoria + taxaFinR + itbi + regAlienacao + tao +
    calcada + habite + cno + averbacao
  );

  const totalGeral = totalTerrenoConstrucao + custasPrevistas;

  return {
    tipo_simulacao: "CONSTRUCAO",
    isVenda: false,
    isProprio,

    area,
    padraoInfo: pInfo,

    custoBase,
    temLaje,
    lajeAd,
    laje,

    projetoTipo,
    projetoRateM2,
    projetoValor,

    valorObra,
    valorTerrenoCalc,
    totalTerrenoConstrucao,

    entrada,
    subsidio,
    porFora,
    valorAFinanciar,
    saldoNegociar,
    valorFinBase,

    crea,

    alvaraRate,
    alvara,
    canta_autent,
    canta_execucao,
    canta_legalizacao,

    habiteRate,
    habite,

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

    cno,
    averbacao,

    dataSim,
    dataVal,
    validadeDias,

    custasPrevistas,
    totalGeral
  };
}
