/* Gera data/faixas.json: o de-para de artigo para faixa da fábrica
   (CORRE, CONF_FEM, MEIA OLY, CORRIDA/TREINO…), que a vitrine usa no filtro.

   A faixa não existe no cadastro de produtos: ela é calculada na Detalhada,
   do cruzamento FAIXA + CATEGORIA + GÊNERO da fábrica. A base da Detalhada
   tem 4 MB e a vitrine não vai carregá-la por causa de um campo, então este
   script a lê uma vez e guarda só o de-para — 9 KB.

   Rodar depois que a Detalhada do dia for publicada:
       node scripts/gerar_faixas.js

   Artigo sem venda ainda não aparece na Detalhada e fica sem faixa; é o
   esperado, e o filtro simplesmente não o lista. */
const fs = require('fs');
const path = require('path');

const WORKER = 'https://repasse-worker-cms.marcosrep-cms.workers.dev';
const C = { REF: 5, FAIXA: 14 };
const SAIDA = path.join(__dirname, '..', 'data', 'faixas.json');

async function doWorker(action, ms) {
  const corta = new AbortController();
  const t = setTimeout(() => corta.abort(), ms);
  try {
    const r = await fetch(WORKER, { method: 'PATCH', signal: corta.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

(async () => {
  const info = await doWorker('getDetalhadaInfo', 15000);
  if (!info || !info.gerado) { console.error('O worker não tem Detalhada publicada.'); process.exit(1); }
  console.log('base de', info.gerado, '·', info.linhas, 'linhas ·', info.origem);

  const b = await doWorker('getDetalhada', 120000);
  if (!b || !Array.isArray(b.l)) { console.error('Não consegui ler a base.'); process.exit(1); }
  const faixas = b.dic.faixa || [];
  if (!faixas.length) { console.error('Esta base não tem a coluna de faixa.'); process.exit(1); }

  // Um artigo pode aparecer com mais de uma faixa quando a fábrica
  // reclassifica no meio do ano; fica com a que mais aparece.
  const porRef = new Map();
  for (const r of b.l) {
    const ref = b.dic.ref[r[C.REF]];
    const fx = faixas[r[C.FAIXA]];
    if (!ref || !fx) continue;
    const k = String(ref[0]).trim();
    if (!k) continue;
    if (!porRef.has(k)) porRef.set(k, new Map());
    const m = porRef.get(k);
    m.set(fx, (m.get(fx) || 0) + 1);
  }

  const dep = {};
  let conflitos = 0;
  for (const [k, m] of porRef) {
    const ord = [...m.entries()].sort((a, c) => c[1] - a[1]);
    if (ord.length > 1) conflitos++;
    dep[k] = ord[0][0];
  }

  const saida = { gerado: b.gerado, origem: 'Detalhada', artigos: Object.keys(dep).length, faixa: dep };
  fs.writeFileSync(SAIDA, JSON.stringify(saida));
  console.log('data/faixas.json:', saida.artigos, 'artigos ·',
    (JSON.stringify(saida).length / 1024).toFixed(1), 'KB ·',
    conflitos, 'com mais de uma faixa na base');
})();
