/* ============================================================================
   CAMPANHAS DE INCENTIVO — regra única, usada por três telas
   ----------------------------------------------------------------------------
   O admin (dispo.html) cadastra, o dashboard apura e a vitrine dos Repasses
   mostra ao vendedor o próprio número. Se cada um contasse do seu jeito, os
   três mostrariam valores diferentes para a mesma campanha — e a conversa no
   fim do mês seria sobre qual tela está certa.

   A campanha, como ela é gravada em data/campanhas.json:

   {
     id: 'c1759400000000',
     nome: 'Nuvem & Challenger',
     valor: 5,                  // R$ por par repassado
     inicio: '2026-10-01',      // AAAA-MM-DD, inclusive
     fim: '2026-10-31',         // AAAA-MM-DD, inclusive
     produtos: ['NUVEM','CHALLENGER'],   // nome do modelo, sem cor
     cores: [],                 // vazio = todas as cores do modelo
     vendedores: [],            // vazio = todos; senão, códigos de preposto
     conta: 'aprovado',         // 'aprovado' | 'tudo'
     teto: 0,                   // R$; 0 = sem teto
     mostrarPosicao: true,      // na tela do vendedor
     mostrarValor: true,        // false = só pares, sem R$, para o vendedor
     pausada: false,
     criadaEm: '2026-10-02T...'
   }
   ========================================================================== */
(function (raiz) {
  'use strict';

  const texto = v => String(v == null ? '' : v).trim().toUpperCase();

  /** "2026-10-01" → data local no começo do dia. Sem isso o navegador lê a
   *  string como UTC e, no Brasil, a campanha começa às 21h do dia anterior. */
  function diaLocal(iso, fimDoDia) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (fimDoDia) d.setHours(23, 59, 59, 999);
    return d;
  }

  /** agendada · ativa · pausada · encerrada — na ordem em que importam. */
  function statusCampanha(c, agora) {
    const hoje = agora || new Date();
    const ini = diaLocal(c && c.inicio), fim = diaLocal(c && c.fim, true);
    if (!ini || !fim) return 'rascunho';
    if (hoje > fim) return 'encerrada';
    if (c.pausada) return 'pausada';
    if (hoje < ini) return 'agendada';
    return 'ativa';
  }

  const campanhaVale = (c, agora) => statusCampanha(c, agora) === 'ativa';

  /** Dias que ainda faltam (0 quando já acabou). */
  function diasRestantes(c, agora) {
    const fim = diaLocal(c && c.fim, true);
    if (!fim) return 0;
    return Math.max(0, Math.ceil((fim - (agora || new Date())) / 864e5));
  }

  /** O item do pedido entra nesta campanha?
   *  Compara pelo NOME do modelo. A cor só entra na conta quando a campanha
   *  listou cores — campanha de modelo premia o modelo inteiro. */
  function itemDaCampanha(c, item) {
    if (!c || !item) return false;
    const prods = (c.produtos || []).map(texto).filter(Boolean);
    if (!prods.length) return false;
    const nome = texto(item.produto);
    if (!nome || !prods.includes(nome)) return false;
    const cores = (c.cores || []).map(texto).filter(Boolean);
    return !cores.length || cores.includes(texto(item.cor));
  }

  /** Que papel este pedido tem na campanha:
   *
   *    'conta'    → entra no prêmio;
   *    'pendente' → é do período e do produto, mas ainda espera aprovação,
   *                 e a campanha só conta aprovado;
   *    'fora'     → não é desta campanha (período, vendedor ou cancelado).
   *
   *  O 'pendente' existe porque sumir em silêncio foi o que aconteceu na
   *  primeira campanha: oito repasses do dia não apareciam em lugar nenhum,
   *  e de fora parecia que a campanha não tinha enxergado o que já fora
   *  repassado. Agora o número aparece ao lado, dizendo que ainda não conta.
   */
  function papelDoPedido(c, pedido) {
    if (!c || !pedido || pedido.archived) return 'fora';
    const ini = diaLocal(c.inicio), fim = diaLocal(c.fim, true);
    if (!ini || !fim) return 'fora';
    const quando = new Date(pedido.createdAt || pedido.updatedAt || 0);
    if (isNaN(quando) || quando < ini || quando > fim) return 'fora';

    // 'faturado' não existe como status de pedido — o que há é Aprovado,
    // Pendente e Cancelado. Cancelado nunca conta, em nenhum modo.
    const st = texto(pedido.status);
    if (st === 'CANCELADO' || st === 'CANCELADA') return 'fora';

    const quem = (c.vendedores || []).map(x => String(x).trim()).filter(Boolean);
    if (quem.length) {
      const cod = String((pedido.preposto && pedido.preposto.codigo) || '').trim();
      if (!quem.includes(cod)) return 'fora';
    }

    const aprovado = ['APROVADO', 'FINALIZADO', 'FATURADO'].includes(st);
    if ((c.conta || 'aprovado') === 'aprovado' && !aprovado) return 'pendente';
    return 'conta';
  }

  /** O pedido conta? Período, status e — se a campanha restringiu — vendedor. */
  const pedidoDaCampanha = (c, pedido) => papelDoPedido(c, pedido) === 'conta';

  const paresDoItem = item => {
    const t = Number((item && item.totalUnits) || 0);
    if (t > 0) return t;
    const g = (item && item.grade) || {};
    const porCaixa = Object.values(g).reduce((s, v) => s + (Number(v) || 0), 0);
    return porCaixa * Math.max(1, Number((item && item.amount) || 1));
  };

  /** Apura a campanha sobre a lista de pedidos.
   *
   *  Devolve o total e um mapa por vendedor, já com o prêmio calculado e com
   *  o que entrou hoje e nos últimos 7 dias — é o que o ranking mostra.
   *  O teto, quando existe, corta o prêmio TOTAL, não o de cada um: quem
   *  decide como dividir o que passou do teto é quem paga.
   */
  function apurarCampanha(c, pedidos, agora) {
    const hoje = agora || new Date();
    const inicioDeHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const seteDias = new Date(inicioDeHoje.getTime() - 6 * 864e5);
    const porVendedor = new Map();
    let pares = 0, pedidosContados = 0, paresPendentes = 0, pedidosPendentes = 0;
    const detalhe = [];

    for (const p of (pedidos || [])) {
      const papel = papelDoPedido(c, p);
      if (papel === 'fora') continue;
      let doPedido = 0;
      for (const it of (p.items || [])) {
        if (!itemDaCampanha(c, it)) continue;
        doPedido += paresDoItem(it);
      }
      if (doPedido <= 0) continue;

      const conta = papel === 'conta';
      const nome = (p.preposto && (p.preposto.nome || p.preposto.codigo)) || '—';
      const cod = String((p.preposto && p.preposto.codigo) || '').trim();
      if (!porVendedor.has(nome)) porVendedor.set(nome,
        { nome, codigo: cod, pares: 0, hoje: 0, semana: 0, pedidos: 0, pendentes: 0 });
      const v = porVendedor.get(nome);

      if (conta) {
        pares += doPedido;
        pedidosContados++;
        v.pares += doPedido;
        v.pedidos++;
        const quando = new Date(p.createdAt || p.updatedAt || 0);
        if (quando >= inicioDeHoje) v.hoje += doPedido;
        if (quando >= seteDias) v.semana += doPedido;
      } else {
        paresPendentes += doPedido;
        pedidosPendentes++;
        v.pendentes += doPedido;
      }
      detalhe.push({ id: p.id, data: p.createdAt, cliente: p.clienteNome || '', status: p.status,
                     pares: doPedido, vendedor: nome, codigo: cod, conta });
    }

    const valor = Number((c && c.valor) || 0);
    const teto = Number((c && c.teto) || 0);
    const bruto = pares * valor;
    const premio = teto > 0 ? Math.min(bruto, teto) : bruto;

    const lista = [...porVendedor.values()]
      .map(v => ({ ...v, premio: v.pares * valor, premioPendente: v.pendentes * valor }))
      .sort((a, b) => (b.pares - a.pares) || (b.pendentes - a.pendentes));

    return { pares, premio, bruto, teto, estourouTeto: teto > 0 && bruto > teto,
             pedidos: pedidosContados, vendedores: lista, detalhe,
             paresPendentes, pedidosPendentes, premioPendente: paresPendentes * valor };
  }

  /** O que um vendedor fez na campanha, com a posição dele. */
  function minhaParteNaCampanha(c, pedidos, codigo, agora) {
    const ap = apurarCampanha(c, pedidos, agora);
    const cod = String(codigo || '').trim();
    const i = ap.vendedores.findIndex(v => v.codigo === cod);
    const eu = i >= 0 ? ap.vendedores[i]
      : { nome: '', codigo: cod, pares: 0, hoje: 0, semana: 0, pedidos: 0, premio: 0,
          pendentes: 0, premioPendente: 0 };
    return { ...eu, posicao: i >= 0 ? i + 1 : 0, participantes: ap.vendedores.length,
             totalPares: ap.pares, detalhe: ap.detalhe.filter(d => d.codigo === cod) };
  }

  /** A campanha vale para este vendedor? (lista vazia = todos) */
  function campanhaDoVendedor(c, codigo) {
    const quem = (c && c.vendedores || []).map(x => String(x).trim()).filter(Boolean);
    return !quem.length || quem.includes(String(codigo || '').trim());
  }

  /** A campanha ativa que cobre este produto — é ela que vira selo no card. */
  function campanhaDoProduto(campanhas, item, codigoVendedor, agora) {
    for (const c of (campanhas || [])) {
      if (!campanhaVale(c, agora)) continue;
      if (codigoVendedor && !campanhaDoVendedor(c, codigoVendedor)) continue;
      if (itemDaCampanha(c, item)) return c;
    }
    return null;
  }

  const dinheiro = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR',
    { minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2, maximumFractionDigits: 2 });

  raiz.INCENTIVO = {
    statusCampanha, campanhaVale, diasRestantes, itemDaCampanha, pedidoDaCampanha, papelDoPedido,
    paresDoItem, apurarCampanha, minhaParteNaCampanha, campanhaDoVendedor,
    campanhaDoProduto, dinheiro, diaLocal,
  };
})(window);
