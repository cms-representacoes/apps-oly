/* O que está disponível de cada produto: estoque (pronta entrega), lotes de repasse e produção.
   Uma conta só, usada pelo Showroom (vitrine/index.html) e pelo Nexo (assistente/index.html):
   se cada um calculasse o seu, o Nexo diria "tem" onde a tela diz "não tem".
   Desconta o que já foi pedido, respeita a cota do rateio, os ocultos, os exclusivos e o mínimo
   de pares. Quem chama diz quem é o vendedor (souCms, meu); os trechos vieram do Showroom como estavam. */
window.DISPONIVEL = (() => {
  const MIN_PARES = 48;
  const norm = v => String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
  const corArquivo = c => norm(c).replace(/[\/\-]+/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');
  const chave = (artigo, cor) => norm(artigo) + '|' + corArquivo(cor);
  const SELO_PADRAO = 'Forecast';

  // Algumas planilhas chegam com Código e Produto trocados: o código traz o nome
  // e o produto traz a referência. A referência é sempre numérica e o nome nunca.
  const ehRef = v => /^\d+$/.test(String(v==null?'':v).replace(/\s+/g,''));
  function desinverte(cod, prod){
    const c = String(cod||'').trim(), p = String(prod||'').trim();
    return (c && p && !ehRef(c) && ehRef(p)) ? [p, c] : [c, p];
  }

  const MES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const SIGLA = { JAN:'Jan', FEV:'Fev', MAR:'Mar', ABR:'Abr', MAI:'Mai', JUN:'Jun',
                  JUL:'Jul', AGO:'Ago', SET:'Set', OUT:'Out', NOV:'Nov', DEZ:'Dez' };
  // A fonte so manda 2Q hoje, e todo mundo sabe disso — entao o rotulo e so o
  // mes. Se um dia vier 1Q, ele volta a diferenciar em vez de mentir que sao
  // a mesma quinzena.
  function rotuloQuinzena(k){                      // '2Q_DEZ' → 'Dez'
    const [q, m] = String(k||'').split('_');
    const mes = SIGLA[m] || m || '';
    return q === '2Q' ? mes : '1ª ' + mes;
  }
  // Quantos meses faltam ate esse mes, contando de hoje. Dezembro visto em
  // janeiro da 11, nao -11.
  const MES_HOJE = new Date().getMonth();
  function distanciaMes(m){
    const i = MES.indexOf(m);
    return i < 0 ? 99 : (i - MES_HOJE + 12) % 12;
  }
  function mesDaData(br){                          // '01/11/2026' → 'NOV'
    const m = String(br||'').match(/^(\d{2})\/(\d{2})\//);
    return m ? MES[Number(m[2])-1] || '' : '';
  }

  function cotasDoLote(rateio, num){
    const r = rateio && typeof rateio === 'object' ? rateio[String(num).trim()] : null;
    return (r && typeof r === 'object') ? r : null;
  }
  function loteERateado(cotas){
    return !!cotas && Object.keys(cotas).some(k => k !== '_selo' && Number(cotas[k]) > 0);
  }
  function nomeDoSelo(cotas){
    const n = cotas && typeof cotas._selo === 'string' ? cotas._selo.trim() : '';
    return n || SELO_PADRAO;
  }

  // Quanto o próprio vendedor já pediu de cada Nº: a cota desconta o que ele
  // mesmo já tirou, senão ele pediria a cota inteira de novo a cada pedido.
  function reservasDoVendedor(pedidos, codigo){
    const r = new Map();
    const cod = String(codigo || '').trim();
    if(!cod) return r;
    const contam = new Set(['PENDENTE','EM ANALISE','APROVADO','ATENDIDO PARCIALMENTE']);
    for(const p of (pedidos || [])){
      if(p && p.archived) continue;
      if(!contam.has(norm(p && p.status || 'Pendente'))) continue;
      if(String(p.preposto && p.preposto.codigo || '').trim() !== cod) continue;
      for(const it of (p.items || [])){
        const num = String(it && it.num || '').trim();
        if(!num) continue;
        r.set(num, (r.get(num) || 0) + (Number(it.totalUnits) || 0));
      }
    }
    return r;
  }

  function reservasPorNum(pedidos){
    const r = new Map();
    // norm() tira o acento: com 'EM ANÁLISE' aqui, esse status nunca reservava.
    const contam = new Set(['PENDENTE','EM ANALISE','APROVADO','ATENDIDO PARCIALMENTE']);
    for(const p of (pedidos||[])){
      if(p && p.archived) continue;
      if(!contam.has(norm(p && p.status || 'Pendente'))) continue;
      for(const it of (p.items || [])){
        const num = String(it && it.num || '').trim();
        if(!num) continue;
        r.set(num, (r.get(num) || 0) + (Number(it.totalUnits) || 0));
      }
    }
    return r;
  }

  // As chaves são as mesmas que os dois painéis gravam — copiar o formato errado
  // aqui faria o filtro passar batido sem erro nenhum.
  const chaveLote = r => `${String(r.codigo || '').trim().toUpperCase()}|` +
    `${String(r.cor || '').trim().toUpperCase()}|${String(r.gci || '').trim()}`;
  const chaveProduto = i => `${String(i.artigo || '').trim().toUpperCase()}|` +
    `${String(i.cor || '').trim().toUpperCase()}`;

  const ESCALA_TAM = ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', '2GG', '3GG', 'U'];
  function posTamanho(t){
    const x = String(t || '').trim().toUpperCase();
    const n = x.match(/^\d+/);            // 34, e também o 33 de "33/34"
    if(n) return Number(n[0]);
    const i = ESCALA_TAM.indexOf(x);
    return i >= 0 ? 1000 + i : 2000;      // o que não se conhece vai para o fim
  }
  function faixaDeGrade(tamanhos){
    const ts = [...new Set((tamanhos || []).map(t => String(t || '').trim().toUpperCase()).filter(Boolean))]
      .sort((a, b) => posTamanho(a) - posTamanho(b));
    if(!ts.length) return '';
    return ts.length === 1 ? ts[0] : `${ts[0]}–${ts[ts.length - 1]}`;
  }

  // O que o painel esconde. Exclusivo e oculto barram o mesmo produto: um conjunto só resolve os dois.
  function bloqueiosDe({ ocultos, ocultosDisp, exclusivos, rateio }){
    return {
      // Rateio: o lote dividido por vendedor. Cada Nº traz as cotas em pares e,
      // opcionalmente, o nome do selo que aparece no card.
      rateio: (rateio && typeof rateio === 'object' && !Array.isArray(rateio)) ? rateio : {},
      lotes: new Set(Array.isArray(ocultos) ? ocultos : []),
      produtos: new Set([
        ...(Array.isArray(ocultosDisp) ? ocultosDisp : []),
        ...(exclusivos && typeof exclusivos === 'object' && !Array.isArray(exclusivos) ? Object.keys(exclusivos) : [])
      ])
    };
  }

  function montar({ dispo, disponib, produtos, pedidos, oculto, souCms, meu }){
    const bloq = oculto || { lotes:new Set(), produtos:new Set() };
    const mapa = new Map();
    const refCor = new Map();   // artigo|cor — a linha exata
    const refArt = new Map();   // artigo — só para o que não muda com a cor
    for(const p of (produtos || [])){
      refCor.set(chave(p.codigo, p.cor || p.corCodigo), p);
      if(!refArt.has(norm(p.codigo))) refArt.set(norm(p.codigo), p);
    }

    const pega = (artigo, cor) => {
      const k = chave(artigo, cor);
      if(!mapa.has(k)) mapa.set(k, {
        k, artigo:norm(artigo), cor:String(cor||'').trim().toUpperCase(),
        nome:'', marca:'', pdv:0, categoria:'', genero:'', imagem:'', fabrica:'',
        sub:'', faixa:'', camp:[], chega:[], campanhas:[],
        pronta:null, repasse:null, meta:null
      });
      return mapa.get(k);
    };

    // 1) disponibilidades: pronta entrega e meta produtiva
    for(const i of (disponib || [])){
      if(bloq.produtos.has(chaveProduto(i))) continue;
      // O admin marca o que ainda nao tem foto, e a vitrine de disponibilidades
      // ja respeitava isso. Aqui a marcacao passava batido: o card saia com o
      // buraco branco no lugar da imagem, porque o arquivo nao existe mesmo.
      if(i._aguardandoImagem || i._oculto) continue;
      const o = pega(i.artigo, i.cor);
      o.nome      = o.nome      || String(i.descricao || '').trim();
      o.marca     = o.marca     || String(i.marca || '').toLowerCase();
      o.pdv       = o.pdv       || Number(i.pdv || 0);
      o.categoria = o.categoria || String(i.categoriaProduto || '').toUpperCase();
      o.genero    = o.genero    || String(i.genero || '').toUpperCase();
      o.imagem  = o.imagem  || String(i.imagem || '').trim();
      o.fabrica = o.fabrica || String(i.empresa || '').trim().toUpperCase();
      // 70 linhas da Olympikus trazem DUAS campanhas, e a segunda (E4822, MKP
      // 2,8) nunca aparecia porque só a primeira era guardada. O produto pode
      // estar em mais de uma promoção ao mesmo tempo.
      if(!o.campanhas.length){
        const te = Array.isArray(i.tabelasEspeciais) ? i.tabelasEspeciais : [];
        o.campanhas = te.length ? te.slice()
          : (i.codigoTabela ? [{ codigoTabela:i.codigoTabela, mkp:i.mkp, custo:i.custo }] : []);
      }
      if(i._meta){
        const q = Object.entries(i.quinzenas || {}).filter(([,v]) => Number(v) >= MIN_PARES);
        if(q.length) o.meta = { quinzenas:q
          .map(([k,v]) => ({ rot:rotuloQuinzena(k),
                             mes:SIGLA[String(k).split('_')[1]] || '', v:Number(v) }))
          .sort((a, b) => distanciaMes(a.mes) - distanciaMes(b.mes)) };
      }else{
        const g = {};
        for(const [t,v] of Object.entries(i.grade || {})) if(Number(v) > 0) g[t] = Number(v);
        const total = Object.values(g).reduce((s,v) => s+v, 0);
        if(total >= MIN_PARES) o.pronta = { total, grade:g };
      }
    }

    // 2) dispo: lotes de repasse, um por Nº
    const reservas = reservasPorNum(pedidos);
    const rateio = (oculto && oculto.rateio) || {};
      const jaPedi = souCms ? new Map() : reservasDoVendedor(pedidos, meu);
    for(const r of (dispo || [])){
      const [cod, nome] = desinverte(r.codigo, r.produto);
      if(!cod) continue;
      // O painel esconde LOTE, não produto: o CHALLENGER tem seis entregas e
      // cinco delas estão ocultas. Filtrar o produto inteiro tiraria a sexta
      // junto, e ignorar a lista somava as seis no saldo do card.
      if(bloq.lotes.has(chaveLote(r))) continue;
      const o = pega(cod, r.cor);
      const pc = refCor.get(chave(cod, r.cor));      // mesma cor
      const p  = pc || refArt.get(norm(cod));         // qualquer cor do artigo
      o.nome      = o.nome      || nome || String(p && p.produto || '').trim();
      o.pdv       = o.pdv       || Number(p && p.preco || 0);
      o.categoria = o.categoria || String(p && p.categoria || '').toUpperCase();
      o.genero    = o.genero    || String(p && p.genero || '').toUpperCase();
      // A foto sai SÓ da cor exata. Nome e preço podem vir de outra cor do mesmo
      // artigo sem prejuízo; a foto não — ela passaria a cor errada pro cliente.
      o.imagem    = o.imagem    || String(pc && pc.imagem || '').trim();
      // Sem marca no dispo.json: se o produto não veio das disponibilidades,
      // assume Olympikus — hoje o repasse é todo Oly.
      o.marca = o.marca || 'oly';

      const num   = String(r.num || '').trim();
      let saldo = Math.max(0, Number(r.saldo || 0) - (reservas.get(num) || 0));

      // Lote rateado: o vendedor vê só a própria cota (menos o que já pediu) e,
      // sem cota, o lote nem aparece para ele. A CMS vê o total, só para
      // acompanhar.
      const cotas = cotasDoLote(rateio, num);
      const rateado = loteERateado(cotas);
      let soAcompanhar = false, selo = '';
      if(rateado){
        selo = nomeDoSelo(cotas);
        if(souCms){
          soAcompanhar = true;
        }else{
          const cota = Number(cotas[meu] || 0);
          if(cota <= 0) continue;
          saldo = Math.min(saldo, Math.max(0, cota - (jaPedi.get(num) || 0)));
        }
      }
      if(saldo <= 0) continue;
      const g = {};
      for(const [t,v] of Object.entries(r.grade || {})) if(Number(v) > 0) g[t] = Number(v);
      if(!o.repasse) o.repasse = { total:0, lotes:[], mes:'' };
      o.repasse.total += saldo;
      o.repasse.lotes.push({ num, gci:String(r.gci||'').trim(),
                             data:String(r.dataEntrega||'').trim(), saldo, grade:g,
                             rateado, selo, soAcompanhar });
      if(rateado){ o.rateado = true; o.selo = o.selo || selo; o.soAcompanhar = soAcompanhar; }
    }

    // mês mais próximo entre os lotes, para a faixa do card
    for(const o of mapa.values()){
      if(!o.repasse) continue;
      o.repasse.lotes.sort((a,b) => String(a.data).split('/').reverse().join('')
                                    .localeCompare(String(b.data).split('/').reverse().join('')));
      o.repasse.mes = mesDaData(o.repasse.lotes[0].data);
    }
    return mapa;
  }

  return { MIN_PARES, montar, bloqueiosDe, desinverte, distanciaMes, mesDaData, posTamanho, faixaDeGrade };
})();
