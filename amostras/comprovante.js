// Comprovante de pagamento das vendas de amostras.
// O arquivo vai para o Worker (KV), nunca para o repositório, que é público.
//   Comprovante.campo(host, { ativo })  → campo "Anexar comprovante" dentro de um modal de venda
//   Comprovante.escolher()              → abre o seletor e devolve { dados, nome } ou null
//   Comprovante.ver({ venda, worker, aoMudar }) → janela com o comprovante (baixar, trocar, remover)
(() => {
  const MAX_LADO = 1800, MAX_PDF = 6 * 1024 * 1024;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ICON_CLIP = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>';
  const ICON_PDF = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 15h8M8 18h5"/></svg>';

  const css = `
  .cp-campo{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .cp-add{display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 14px;border-radius:10px;border:1.5px dashed #cbd5e1;background:#f8fafc;color:#334155;font:700 14px 'Plus Jakarta Sans',sans-serif;cursor:pointer}
  .cp-add:hover{border-color:#0d9488;color:#0f766e;background:#f0fdfa}
  .cp-dica{font-size:12px;color:#64748b}
  .cp-chip{display:flex;align-items:center;gap:10px;border:1px solid #99f6e4;background:#f0fdfa;border-radius:10px;padding:6px 6px 6px 6px;max-width:100%;min-width:0}
  .cp-chip img,.cp-chip .cp-ic{width:40px;height:40px;border-radius:7px;object-fit:cover;flex:none;background:#fff;border:1px solid #e2e8f0;display:flex;align-items:center;justify-content:center;color:#b91c1c}
  .cp-chip span{font-size:13px;font-weight:700;color:#0f766e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .cp-chip small{display:block;font-size:11.5px;color:#64748b;font-weight:600}
  .cp-tira{width:32px;height:32px;border-radius:8px;border:0;background:none;color:#64748b;font-size:20px;cursor:pointer;flex:none}
  .cp-tira:hover{background:#fee2e2;color:#b91c1c}
  .cp-msg{font-size:12.5px;color:#b91c1c;font-weight:600;width:100%}
  .cp-msg:empty{display:none}

  .cpv{position:fixed;inset:0;background:rgba(15,23,42,.72);z-index:70;display:none;align-items:center;justify-content:center;padding:16px}
  .cpv.show{display:flex}
  .cpv-cx{background:#fff;border-radius:16px;width:min(720px,100%);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.35)}
  .cpv-cab{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #e2e8f0}
  .cpv-cab div{flex:1;min-width:0}
  .cpv-cab b{display:block;font-size:16px;font-weight:800}
  .cpv-cab span{display:block;font-size:12.5px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cpv-x{width:36px;height:36px;border-radius:9px;border:0;background:#f1f5f9;font-size:22px;cursor:pointer;flex:none}
  .cpv-corpo{flex:1;min-height:200px;overflow:auto;background:#f1f5f9;display:flex;align-items:flex-start;justify-content:center}
  .cpv-corpo img{max-width:100%;display:block;margin:0 auto}
  .cpv-corpo iframe{width:100%;height:70dvh;border:0;background:#fff}
  .cpv-corpo .cpv-av{padding:40px 20px;color:#64748b;font-size:14px;text-align:center;align-self:center}
  .cpv-pe{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #e2e8f0;overflow-x:auto;scrollbar-width:none}
  .cpv-pe::-webkit-scrollbar{display:none}
  .cpv-pe button,.cpv-pe a{flex:none;display:inline-flex;align-items:center;gap:6px;height:42px;padding:0 16px;border-radius:10px;border:1px solid #e2e8f0;background:#fff;color:#0f172a;font:700 14px 'Plus Jakarta Sans',sans-serif;cursor:pointer;text-decoration:none}
  .cpv-pe .ok{background:#0d9488;border-color:#0d9488;color:#fff}
  .cpv-pe .perigo{color:#b91c1c}
  .cpv-pe .esp{flex:1}
  .cpv-pe [disabled]{opacity:.5;pointer-events:none}
  @media (max-width:640px){
    .cpv{padding:0;align-items:stretch}
    .cpv-cx{border-radius:0;max-height:none;height:100dvh;width:100%}
    .cpv-corpo iframe{height:100%}
    .cpv-pe .esp{display:none}
  }`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // imagem → JPEG de até 1800 px (texto do comprovante continua legível); PDF vai como está
  function lerArquivo(f) {
    return new Promise((ok, falha) => {
      if (!f) return ok(null);
      const ehPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
      if (!ehPdf && !/^image\//.test(f.type)) return falha(new Error('Use uma imagem (foto ou print) ou um PDF.'));
      if (ehPdf && f.size > MAX_PDF) return falha(new Error('PDF grande demais (máximo 6 MB).'));
      const rd = new FileReader();
      rd.onerror = () => falha(new Error('Não consegui ler o arquivo.'));
      rd.onload = () => {
        if (ehPdf) return ok({ dados: String(rd.result).replace(/^data:[^;]*;/, 'data:application/pdf;'), nome: f.name || 'comprovante.pdf', pdf: true });
        const im = new Image();
        im.onerror = () => falha(new Error('Não consegui abrir essa imagem.'));
        im.onload = () => {
          const k = Math.min(1, MAX_LADO / Math.max(im.naturalWidth, im.naturalHeight));
          const cv = document.createElement('canvas');
          cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
          const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
          cx.drawImage(im, 0, 0, cv.width, cv.height);
          const nome = (f.name && !/^image\.\w+$/i.test(f.name) ? f.name.replace(/\.\w+$/, '') : 'comprovante') + '.jpg';
          ok({ dados: cv.toDataURL('image/jpeg', 0.85), nome });
        };
        im.src = rd.result;
      };
      rd.readAsDataURL(f);
    });
  }

  function seletor() {
    return new Promise(ok => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = 'image/*,application/pdf,.pdf';
      i.addEventListener('change', () => ok(i.files[0] || null), { once: true });
      // cancelou o seletor: o foco volta para a janela sem arquivo
      window.addEventListener('focus', () => setTimeout(() => { if (!i.files.length) ok(null); }, 600), { once: true });
      i.click();
    });
  }

  async function escolher() {
    const f = await seletor();
    return f ? lerArquivo(f) : null;
  }

  // campo dentro do modal de venda; aceita escolher, arrastar ou colar (Ctrl+V de um print)
  function campo(host, { ativo } = {}) {
    let atual = null;
    host.innerHTML = `<div class="cp-campo"></div>`;
    const raiz = host.firstElementChild;
    const desenhar = (msg = '') => {
      raiz.innerHTML = atual
        ? `<div class="cp-chip">${atual.pdf ? `<span class="cp-ic">${ICON_PDF}</span>` : `<img src="${atual.dados}" alt="">`}
             <span>${esc(atual.nome)}<small>${atual.pdf ? 'PDF' : 'Imagem'} · fica guardado com a venda</small></span>
             <button type="button" class="cp-tira" aria-label="Tirar o comprovante" title="Tirar">×</button></div>`
        : `<button type="button" class="cp-add">${ICON_CLIP}Anexar comprovante</button><span class="cp-dica">Opcional. Foto, print ou PDF; pode colar com Ctrl+V.</span>`;
      raiz.insertAdjacentHTML('beforeend', `<div class="cp-msg">${esc(msg)}</div>`);
    };
    const usar = async f => {
      try { atual = await lerArquivo(f); desenhar(); }
      catch (e) { desenhar(e.message); }
    };
    raiz.addEventListener('click', async e => {
      if (e.target.closest('.cp-tira')) { atual = null; desenhar(); return; }
      if (e.target.closest('.cp-add')) { const f = await seletor(); if (f) usar(f); }
    });
    raiz.addEventListener('dragover', e => e.preventDefault());
    raiz.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) usar(f); });
    document.addEventListener('paste', e => {
      if (ativo && !ativo()) return;
      const it = [...(e.clipboardData?.items || [])].find(x => x.kind === 'file');
      if (!it) return;
      e.preventDefault(); usar(it.getAsFile());
    });
    desenhar();
    return {
      valor: () => atual ? { dados: atual.dados, nome: atual.nome } : null,
      limpar: () => { atual = null; desenhar(); }
    };
  }

  // ── janela para ver o comprovante de uma venda ──
  let el;
  function montar() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'cpv'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="cpv-cx">
      <div class="cpv-cab"><div><b>Comprovante</b><span class="cpv-s"></span></div><button type="button" class="cpv-x" aria-label="Fechar">×</button></div>
      <div class="cpv-corpo"></div>
      <div class="cpv-pe"></div></div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('.cpv-x')) fechar(); });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && el.classList.contains('show') && !document.querySelector('.pq-fundo')) { e.preventDefault(); e.stopImmediatePropagation(); fechar(); }
    }, true);
    return el;
  }
  let urlPdf = '';
  function fechar() {
    el.classList.remove('show'); document.body.style.overflow = '';
    if (urlPdf) { URL.revokeObjectURL(urlPdf); urlPdf = ''; }
  }
  function blobDe(dados) {
    const [cab, b64] = dados.split(','); const tipo = cab.slice(5, cab.indexOf(';'));
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: tipo });
  }

  async function ver({ venda, worker, aoMudar, qtdLote = 1 }) {
    montar();
    const corpo = el.querySelector('.cpv-corpo'), pe = el.querySelector('.cpv-pe');
    el.querySelector('.cpv-s').textContent = [venda.comprador, new Date(venda.vendidoEm).toLocaleDateString('pt-BR')].filter(Boolean).join(' · ') +
      (qtdLote > 1 ? ` · vale para as ${qtdLote} vendas deste comprador` : '');
    corpo.innerHTML = '<div class="cpv-av">Abrindo o comprovante…</div>'; pe.innerHTML = '';
    el.classList.add('show'); document.body.style.overflow = 'hidden';
    let c;
    try { c = await worker({ action: 'verComprovante', vendaId: venda.id }, true); }
    catch (e) { corpo.innerHTML = `<div class="cpv-av">Não consegui abrir: ${esc(e.message)}</div>`; pe.innerHTML = `<span class="esp"></span><button type="button" class="ok" data-a="fechar">Fechar</button>`; ligar(); return; }
    const pdf = c.tipo === 'application/pdf';
    if (urlPdf) URL.revokeObjectURL(urlPdf);
    urlPdf = URL.createObjectURL(blobDe(c.dados));
    corpo.innerHTML = pdf ? `<iframe src="${urlPdf}" title="Comprovante em PDF"></iframe>` : `<img src="${urlPdf}" alt="Comprovante de pagamento">`;
    const nomeArq = c.nome || (pdf ? 'comprovante.pdf' : 'comprovante.jpg');
    pe.innerHTML = `<a href="${urlPdf}" download="${esc(nomeArq)}">Baixar</a>
      ${pdf ? `<a href="${urlPdf}" target="_blank" rel="noopener">Abrir em outra aba</a>` : ''}
      <button type="button" data-a="trocar">Trocar</button>
      <button type="button" class="perigo" data-a="remover">Remover</button>
      <span class="esp"></span><button type="button" class="ok" data-a="fechar">Fechar</button>`;
    ligar();

    function ligar() {
      pe.onclick = async e => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        if (b.dataset.a === 'fechar') return fechar();
        if (b.dataset.a === 'trocar') {
          let novo; try { novo = await escolher(); } catch (er) { corpo.insertAdjacentHTML('afterbegin', `<div class="cpv-av">${esc(er.message)}</div>`); return; }
          if (!novo) return;
          b.disabled = true; b.textContent = 'Enviando…';
          try {
            const r = await worker({ action: 'anexarComprovante', vendaId: venda.id, comprovante: { dados: novo.dados, nome: novo.nome } }, true);
            aoMudar && aoMudar(r.comprovante, r.vendas);
            ver({ venda, worker, aoMudar, qtdLote });
          } catch (er) { b.disabled = false; b.textContent = 'Trocar'; corpo.insertAdjacentHTML('afterbegin', `<div class="cpv-av">Não deu para trocar: ${esc(er.message)}</div>`); }
          return;
        }
        if (b.dataset.a === 'remover') {
          const sim = await window.perguntar({ titulo: 'Remover o comprovante?', texto: 'A venda continua registrada; só o arquivo do comprovante sai.',
            sub: qtdLote > 1 ? `Sai das ${qtdLote} vendas deste comprador.` : '', ok: 'Remover', perigo: true });
          if (!sim) return;
          b.disabled = true; b.textContent = 'Removendo…';
          try {
            const r = await worker({ action: 'removerComprovante', vendaId: venda.id }, true);
            aoMudar && aoMudar(null, r.vendas); fechar();
          } catch (er) { b.disabled = false; b.textContent = 'Remover'; corpo.insertAdjacentHTML('afterbegin', `<div class="cpv-av">Não deu para remover: ${esc(er.message)}</div>`); }
        }
      };
    }
  }

  window.Comprovante = { campo, escolher, ver, ICON_CLIP };
})();
