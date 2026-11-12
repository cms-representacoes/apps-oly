/* ============================================================================
   AVISO DE CARTEIRA — "esse cliente já não tem esse par chegando?"
   ----------------------------------------------------------------------------
   Um cliente reclamou de receber produto repassado que já estava na carteira
   dele. Acontece porque a tela de repasse só olhava os outros repasses: o que
   o cliente comprou pelo pedido normal, no EBM, ela não via. Então o vendedor
   repassava de boa-fé um par que já ia chegar de outro jeito.

   Aqui a conferência é feita contra a carteira de verdade, a da Detalhada:
   antes de enviar, se o cliente já tem aquele artigo na mesma cor em carteira
   — ou se recebeu nos últimos 90 dias —, o vendedor vê produto, GCI e data de
   faturamento e decide. Ele pode enviar mesmo assim: a conferência avisa, não
   proíbe. Quem decide é quem conhece a loja.

   Também aparecem, como contexto, as outras cores do mesmo artigo. Cor
   diferente não é duplicidade e por isso não dispara o aviso sozinha, mas
   quem está decidindo quer saber.

   A base é data/carteira-aberta.json, derivada da Detalhada pelo worker na
   publicação diária (~180 KB na rede, contra os 5 MB da base inteira). Baixa
   uma vez por sessão, no primeiro envio.

   Uso, nos dois apps:

     const r = await CarteiraAviso.conferir({
       cliente: '12345',
       itens: [{ codigo:'43447473', produto:'CORRE VENTO 3', cor:'PTO/CH', pares:36 }]
     });
     if (r === 'revisar') return;            // o vendedor voltou para a sacola
     if (r === 'enviar') pedido.avisoCarteira = true;   // viu o aviso e mandou

   'livre' = nada parecido na carteira (ou cliente sem carteira nenhuma).
   ========================================================================== */
(function (raiz) {
  'use strict';

  const ARQUIVO = 'carteira-aberta.json';
  // Acima disso a base está velha o bastante para o aviso poder estar errado,
  // e o rodapé do modal diz isso em vez de deixar o vendedor supor.
  const DIAS_BASE_VELHA = 4;

  let CAMINHO = '../data/';
  let base = null;         // o arquivo, como veio
  let indice = null;       // cliente → { cart:Map(ref→linhas), fat:Map(ref→linhas) }
  let baixando = null;     // promessa em voo, para dois envios não baixarem duas vezes

  const chave = v => String(v == null ? '' : v).trim().toUpperCase();
  const nf = n => Number(n || 0).toLocaleString('pt-BR');
  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* Datas viajam como dias inteiros desde 1970-01-01, igual na Detalhada
     (-1 = vazio). Os getters são UTC de propósito: com os locais, no Brasil
     toda data voltaria um dia. */
  function diaBR(d) {
    if (d == null || d < 0) return '';
    const dt = new Date(d * 86400000);
    return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`;
  }
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function diaCurto(d) {
    if (d == null || d < 0) return '';
    const dt = new Date(d * 86400000);
    return `${String(dt.getUTCDate()).padStart(2, '0')}/${MESES[dt.getUTCMonth()]}`;
  }

  /* ── a base ──────────────────────────────────────────────────────────── */

  function montarIndice(b) {
    const refs = (b.ref || []).map(p => [chave(p && p[0]), String((p && p[1]) || '')]);
    const cores = (b.cor || []).map(chave);
    const porCliente = new Map();
    const lado = (nome, mapa) => {
      for (const cli of Object.keys(mapa || {})) {
        const cod = chave(cli);
        let reg = porCliente.get(cod);
        if (!reg) porCliente.set(cod, reg = { cart: new Map(), fat: new Map() });
        for (const linha of mapa[cli] || []) {
          const [iRef, iCor, gci, dia, pares] = linha;
          const ref = refs[iRef];
          if (!ref) continue;
          const item = { ref: ref[0], produto: ref[1], cor: cores[iCor] || '', gci: gci || 0, dia: dia, pares: pares || 0 };
          const lista = reg[nome].get(ref[0]);
          if (lista) lista.push(item); else reg[nome].set(ref[0], [item]);
        }
      }
    };
    lado('cart', b.cart);
    lado('fat', b.fat);
    return porCliente;
  }

  /** Baixa a base uma vez por sessão. Devolve false se não deu — quem chama
   *  decide o que fazer; aqui ninguém fica preso. */
  function carregar() {
    if (indice) return Promise.resolve(true);
    if (baixando) return baixando;
    baixando = (async () => {
      try {
        const r = await fetch(CAMINHO + ARQUIVO + '?t=' + Math.floor(Date.now() / 3600000), { cache: 'no-cache' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const b = await r.json();
        if (!b || typeof b !== 'object' || !b.cart) throw new Error('arquivo inesperado');
        base = b;
        indice = montarIndice(b);
        return true;
      } catch (e) {
        console.warn('Carteira do cliente: não deu para ler a base.', e);
        base = null; indice = null;
        return false;
      } finally {
        baixando = null;
      }
    })();
    return baixando;
  }

  /** Dias desde a geração da base. null quando não se sabe. */
  function idadeDaBase() {
    const t = Date.parse((base && base.gerado) || '');
    if (!t) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }

  /* ── a regra ─────────────────────────────────────────────────────────── */

  /** O que o cliente já tem de cada item da sacola. */
  function analisar(cliente, itens) {
    const reg = indice && indice.get(chave(cliente));
    const alertas = [], contexto = [];
    if (!reg) return { alertas, contexto };

    // A sacola pode ter dois lotes do mesmo artigo e cor, com datas
    // diferentes. Para o aviso é um produto só: os pares somam e o cliente
    // aparece uma vez.
    const juntos = new Map();
    for (const it of itens || []) {
      const k = chave(it.codigo) + '|' + chave(it.cor);
      const ja = juntos.get(k);
      if (ja) ja.pares += Number(it.pares || 0);
      else juntos.set(k, { codigo: it.codigo, cor: it.cor, produto: it.produto || it.nome, pares: Number(it.pares || 0) });
    }

    for (const it of juntos.values()) {
      const ref = chave(it.codigo);
      const cor = chave(it.cor);
      if (!ref) continue;
      const cart = reg.cart.get(ref) || [];
      const fat = reg.fat.get(ref) || [];
      const linha = {
        produto: it.produto || it.nome || ref,
        codigo: ref,
        cor,
        pares: Number(it.pares || 0),
        cart: cart.filter(x => x.cor === cor),
        fat: fat.filter(x => x.cor === cor),
        outrasCart: cart.filter(x => x.cor !== cor),
        outrasFat: fat.filter(x => x.cor !== cor)
      };
      // Dispara só a mesma cor: é o par que chega igual na loja. Cor diferente
      // entra como contexto, nunca como motivo do aviso.
      if (linha.cart.length || linha.fat.length) alertas.push(linha);
      else if (linha.outrasCart.length || linha.outrasFat.length) contexto.push(linha);
    }
    return { alertas, contexto };
  }

  /* ── a tela ──────────────────────────────────────────────────────────── */

  const CSS = `
  .cav-fundo{position:fixed;inset:0;z-index:120;background:rgba(15,23,42,.58);display:flex;
    align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .15s}
  .cav-fundo.show{opacity:1}
  .cav-folha{background:#fff;color:#0f172a;border-radius:20px;width:100%;max-width:560px;
    max-height:min(88vh,760px);display:flex;flex-direction:column;overflow:hidden;
    box-shadow:0 24px 60px rgba(15,23,42,.35);font-family:inherit;
    transform:translateY(8px) scale(.98);transition:transform .15s}
  .cav-fundo.show .cav-folha{transform:none}
  .cav-topo{display:flex;gap:12px;align-items:flex-start;padding:18px 20px 16px;
    background:#fffbeb;border-bottom:1px solid #fde68a}
  .cav-ico{width:40px;height:40px;flex:none;border-radius:12px;display:flex;align-items:center;
    justify-content:center;background:#fef3c7;color:#b45309}
  .cav-chapeu{margin:0;font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#b45309}
  .cav-tit{margin:2px 0 0;font-size:18px;font-weight:800;line-height:1.25;color:#78350f}
  .cav-sub{margin:4px 0 0;font-size:13px;font-weight:600;color:#92400e}
  .cav-corpo{padding:14px 20px 4px;overflow-y:auto;overscroll-behavior:contain;flex:1}
  .cav-intro{margin:0 0 12px;font-size:13.5px;line-height:1.5;color:#475569}
  .cav-item{border:1px solid #e2e8f0;border-radius:14px;padding:12px 14px;margin-bottom:10px}
  .cav-item + .cav-rodape-ctx{margin-top:14px}
  .cav-nome{margin:0;font-size:14.5px;font-weight:800;line-height:1.3}
  .cav-nome span{font-weight:700;color:#64748b}
  .cav-rep{margin:3px 0 0;font-size:12px;font-weight:700;color:#0d9488}
  .cav-linhas{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
  .cav-linhas li{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;font-size:12.5px;
    line-height:1.4;padding:7px 9px;border-radius:10px;background:#f8fafc;border:1px solid #eef2f6}
  .cav-linhas li.cav-l-cart{background:#eff6ff;border-color:#dbeafe}
  .cav-linhas li.cav-l-fat{background:#f0fdf4;border-color:#dcfce7}
  .cav-linhas li.cav-mais{background:#fff;border-style:dashed;color:#475569}
  .cav-tag{font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;
    padding:2px 7px;border-radius:999px;background:#1d4ed8;color:#fff}
  .cav-l-fat .cav-tag{background:#15803d}
  .cav-dado{font-weight:700;color:#0f172a}
  .cav-dado small{font-weight:600;color:#64748b}
  .cav-outras{margin:9px 0 0;font-size:12px;line-height:1.45;color:#475569}
  .cav-outras b{color:#334155}
  .cav-rodape-ctx{border-top:1px dashed #e2e8f0;padding-top:12px;font-size:12.5px;line-height:1.5;color:#475569}
  .cav-rodape-ctx b{color:#334155}
  .cav-pe{border-top:1px solid #e2e8f0;background:#f8fafc;padding:12px 20px calc(14px + env(safe-area-inset-bottom))}
  .cav-base{margin:0 0 10px;font-size:11.5px;font-weight:600;color:#64748b}
  .cav-base.velha{color:#b45309;font-weight:700}
  .cav-bts{display:flex;gap:8px;justify-content:flex-end}
  .cav-bts button{height:42px;padding:0 16px;border-radius:12px;font-family:inherit;
    font-size:13.5px;font-weight:800;cursor:pointer;border:1px solid #e2e8f0;background:#fff;color:#334155}
  .cav-bts button:hover{background:#f1f5f9}
  .cav-bts .cav-ok{border:0;background:#d97706;color:#fff}
  .cav-bts .cav-ok:hover{background:#b45309}
  .cav-bts button:focus-visible{outline:2px solid #0d9488;outline-offset:2px}
  @media (max-width:560px){
    .cav-fundo{align-items:flex-end;padding:0}
    .cav-folha{max-width:none;border-radius:18px 18px 0 0;max-height:92vh}
    .cav-topo{padding:16px 15px 14px}
    .cav-tit{font-size:16.5px}
    .cav-corpo{padding:12px 15px 4px}
    .cav-item{padding:11px 12px}
    .cav-pe{padding:12px 15px calc(14px + env(safe-area-inset-bottom))}
    .cav-bts{flex-direction:column-reverse}
    .cav-bts button{width:100%;height:46px}
  }
  @media (prefers-reduced-motion:reduce){
    .cav-fundo,.cav-folha{transition:none}
  }`;

  const ICO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>' +
    '<path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

  let cssPosto = false;
  function garantirCss() {
    if (cssPosto) return;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    cssPosto = true;
  }

  const linhaHtml = (item, tipo) =>
    `<li class="cav-l-${tipo}"><span class="cav-tag">${tipo === 'cart' ? 'Em carteira' : 'Faturado'}</span>` +
    `<span class="cav-dado">GCI ${esc(item.gci || '—')}</span>` +
    `<span class="cav-dado"><small>${tipo === 'cart' ? 'fatura em' : 'saiu em'}</small> ${esc(diaBR(item.dia) || '—')}</span>` +
    `<span class="cav-dado">${nf(item.pares)} ${item.pares === 1 ? 'par' : 'pares'}</span></li>`;

  /* Um cliente grande tem seis, oito encomendas do mesmo par em meses
     seguidos. Listar todas empurra o botão para fora da tela do celular: as
     três primeiras (as mais próximas de faturar) aparecem inteiras e o resto
     vira uma linha de resumo. */
  const LIMITE_LINHAS = 3;
  function blocoHtml(lista, tipo) {
    if (!lista.length) return '';
    const mostra = lista.slice(0, LIMITE_LINHAS), resto = lista.slice(LIMITE_LINHAS);
    let html = mostra.map(x => linhaHtml(x, tipo)).join('');
    if (resto.length) {
      const pares = resto.reduce((a, x) => a + Number(x.pares || 0), 0);
      const datas = resto.map(x => x.dia).filter(d => d > 0);
      html += `<li class="cav-l-${tipo} cav-mais"><span class="cav-dado">+ ${nf(resto.length)} ` +
        `${resto.length === 1 ? 'encomenda' : 'encomendas'}</span>` +
        `<span class="cav-dado">${nf(pares)} ${pares === 1 ? 'par' : 'pares'}</span>` +
        (datas.length ? `<span class="cav-dado"><small>${tipo === 'cart' ? 'até' : 'desde'}</small> ` +
          `${esc(diaBR(tipo === 'cart' ? Math.max(...datas) : Math.min(...datas)))}</span>` : '') + '</li>';
    }
    return html;
  }

  /* Contexto, não aviso: uma cor por vez, com os pares somados e a data mais
     próxima. Seis cabem na linha; o resto é contado. */
  const LIMITE_CORES = 6;
  function outrasHtml(lista, rotulo) {
    if (!lista.length) return '';
    const porCor = new Map();
    for (const x of lista) {
      const r = porCor.get(x.cor);
      if (r) { r.pares += Number(x.pares || 0); if (x.dia > 0 && (r.dia < 0 || x.dia < r.dia)) r.dia = x.dia; }
      else porCor.set(x.cor, { cor: x.cor, pares: Number(x.pares || 0), dia: x.dia });
    }
    const cores = [...porCor.values()].sort((a, b) => (a.dia || 0) - (b.dia || 0));
    const mostra = cores.slice(0, LIMITE_CORES);
    const sobra = cores.length - mostra.length;
    return `<p class="cav-outras"><b>${rotulo}:</b> ` +
      mostra.map(x => `${esc(x.cor)} <small>(${esc(diaCurto(x.dia))} · ${nf(x.pares)})</small>`).join(' · ') +
      (sobra ? ` · <small>e ${nf(sobra)} ${sobra === 1 ? 'outra cor' : 'outras cores'}</small>` : '') + '</p>';
  }

  function corpoHtml(res) {
    const itens = res.alertas.map(a => {
      const outras = outrasHtml(a.outrasCart, 'Outras cores em carteira') +
                     outrasHtml(a.outrasFat, 'Outras cores já faturadas');
      return `<article class="cav-item">
        <p class="cav-nome">${esc(a.produto)} <span>· ${esc(a.cor)}</span></p>
        ${a.pares ? `<p class="cav-rep">neste repasse: ${nf(a.pares)} ${a.pares === 1 ? 'par' : 'pares'}</p>` : ''}
        <ul class="cav-linhas">
          ${blocoHtml(a.cart, 'cart')}
          ${blocoHtml(a.fat, 'fat')}
        </ul>
        ${outras}
      </article>`;
    }).join('');

    // Os demais itens do repasse que o cliente tem só em outra cor: não são
    // duplicidade, mas quem está decidindo o repasse quer ver.
    const ctx = res.contexto.length
      ? `<div class="cav-rodape-ctx"><b>Do mesmo repasse, o cliente já tem em outras cores:</b><br>` +
        res.contexto.map(c => `${esc(c.produto)} — ` +
          [...c.outrasCart, ...c.outrasFat].map(x => `${esc(x.cor)} <small>(${esc(diaCurto(x.dia))})</small>`).join(' · ')
        ).join('<br>') + '</div>'
      : '';

    return itens + ctx;
  }

  /** O modal. Resolve 'enviar' ou 'revisar'. */
  function mostrar(res, cliente) {
    garantirCss();
    const n = res.alertas.length;
    const idade = idadeDaBase();
    const velha = idade != null && idade > DIAS_BASE_VELHA;
    const antes = document.activeElement;

    const f = document.createElement('div');
    f.className = 'cav-fundo';
    f.innerHTML = `<div class="cav-folha" role="alertdialog" aria-modal="true" aria-labelledby="cav-tit">
      <header class="cav-topo">
        <div class="cav-ico">${ICO}</div>
        <div>
          <p class="cav-chapeu">Confira antes de enviar</p>
          <h2 class="cav-tit" id="cav-tit">${n === 1 ? 'O cliente já tem este produto' : `O cliente já tem ${nf(n)} destes produtos`}</h2>
          <p class="cav-sub">Cliente ${esc(cliente)}</p>
        </div>
      </header>
      <div class="cav-corpo">
        <p class="cav-intro">${n === 1 ? 'Este par já está' : 'Estes pares já estão'} na carteira do cliente ou saíram para ele
          nos últimos ${esc((base && base.janela) || 90)} dias. Enviar o repasse pode fazer a loja receber o mesmo produto duas vezes.</p>
        ${corpoHtml(res)}
      </div>
      <footer class="cav-pe">
        <p class="cav-base${velha ? ' velha' : ''}">Carteira da Detalhada de ${esc(diaBR(base && base.dataDia) || '—')}` +
        `${velha ? ` · a base está com ${nf(idade)} dias; o que entrou depois não aparece aqui` : ''}</p>
        <div class="cav-bts">
          <button type="button" class="cav-nao">Revisar o pedido</button>
          <button type="button" class="cav-ok">Enviar mesmo assim</button>
        </div>
      </footer>
    </div>`;
    document.body.appendChild(f);
    requestAnimationFrame(() => f.classList.add('show'));

    const btOk = f.querySelector('.cav-ok'), btNao = f.querySelector('.cav-nao');
    // O foco começa em "Revisar": o caminho seguro é o padrão.
    btNao.focus();

    return new Promise(resolve => {
      const fim = r => {
        window.removeEventListener('keydown', tecla, true);
        f.remove();
        if (antes && antes.focus) { try { antes.focus(); } catch (_) {} }
        resolve(r);
      };
      // Captura antes das telas de trás: o Esc aqui só fecha este modal.
      const tecla = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fim('revisar'); }
        else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === btOk ? btNao : btOk).focus(); }
      };
      window.addEventListener('keydown', tecla, true);
      btOk.onclick = () => fim('enviar');
      btNao.onclick = () => fim('revisar');
      // Clicar fora é voltar, nunca enviar.
      f.addEventListener('click', e => { if (e.target === f) fim('revisar'); });
    });
  }

  /** Base indisponível: o vendedor escolhe, mas sabendo que ninguém conferiu. */
  function mostrarSemBase() {
    garantirCss();
    const antes = document.activeElement;
    const f = document.createElement('div');
    f.className = 'cav-fundo';
    f.innerHTML = `<div class="cav-folha" role="alertdialog" aria-modal="true" aria-labelledby="cav-tit" style="max-width:420px">
      <header class="cav-topo">
        <div class="cav-ico">${ICO}</div>
        <div>
          <p class="cav-chapeu">Sem conferência</p>
          <h2 class="cav-tit" id="cav-tit">Não deu para ver a carteira do cliente</h2>
        </div>
      </header>
      <div class="cav-corpo">
        <p class="cav-intro">A base da Detalhada não respondeu agora, então ninguém conferiu se o cliente
          já tem estes pares chegando. Dá para enviar assim mesmo — ou voltar e tentar em instantes.</p>
      </div>
      <footer class="cav-pe">
        <div class="cav-bts">
          <button type="button" class="cav-nao">Voltar</button>
          <button type="button" class="cav-ok">Enviar sem conferir</button>
        </div>
      </footer>
    </div>`;
    document.body.appendChild(f);
    requestAnimationFrame(() => f.classList.add('show'));
    const btOk = f.querySelector('.cav-ok'), btNao = f.querySelector('.cav-nao');
    btNao.focus();
    return new Promise(resolve => {
      const fim = r => {
        window.removeEventListener('keydown', tecla, true);
        f.remove();
        if (antes && antes.focus) { try { antes.focus(); } catch (_) {} }
        resolve(r);
      };
      const tecla = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fim('revisar'); }
        else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === btOk ? btNao : btOk).focus(); }
      };
      window.addEventListener('keydown', tecla, true);
      btOk.onclick = () => fim('enviar');
      btNao.onclick = () => fim('revisar');
      f.addEventListener('click', e => { if (e.target === f) fim('revisar'); });
    });
  }

  /* ── a porta de entrada ──────────────────────────────────────────────── */

  /** 'livre' (nada parecido) · 'enviar' (viu o aviso e mandou) · 'revisar'. */
  async function conferir({ cliente, itens } = {}) {
    const cod = chave(cliente);
    if (!cod || !Array.isArray(itens) || !itens.length) return 'livre';
    const temBase = await carregar();
    if (!temBase) return await mostrarSemBase();
    const res = analisar(cod, itens);
    if (!res.alertas.length) return 'livre';
    return await mostrar(res, cod);
  }

  raiz.CarteiraAviso = {
    conferir,
    carregar,
    analisar,
    definirCaminho(p) { CAMINHO = String(p || '../data/'); },
    get base() { return base; }
  };
})(window);
