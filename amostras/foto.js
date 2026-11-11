/* Janela "Foto da amostra", usada pelo cadastro e pelo estoque.
   const r = await FotoAmostra.escolher({ artigo, cor, nome, worker });
   → { b64: 'data:image/jpeg;base64,...' } | { url: 'https://...' } | null (cancelou)
   Quem chamou grava (salvarImagemCatalogo). Caminhos: Trade Squash (mostra e pergunta),
   Google em aba nova + colar, arquivo do computador/celular, arrastar e link. */
(function () {
  const css = `
  .fa-fundo{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:95}
  .fa{background:#fff;border-radius:16px;width:100%;max-width:560px;max-height:calc(100vh - 32px);display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(15,23,42,.35);overflow:hidden;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#0f172a}
  .fa-cab{padding:16px 18px 12px;border-bottom:1px solid #e2e8f0;display:flex;align-items:flex-start;gap:8px}
  .fa-cab b{font-size:16px;display:block}
  .fa-cab span{font-size:12.5px;color:#64748b}
  .fa-x{margin-left:auto;width:34px;height:34px;border-radius:9px;border:0;background:#f1f5f9;color:#64748b;font-size:20px;cursor:pointer;flex:none}
  .fa-corpo{overflow:auto;padding:14px 18px;flex:1}
  .fa-acoes{display:flex;gap:8px;flex-wrap:wrap}
  .fa-acoes button,.fa-acoes label{height:38px;padding:0 12px;border-radius:9px;border:1px solid #e2e8f0;background:#fff;color:#334155;font:700 13px 'Plus Jakarta Sans',sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
  .fa-acoes button:hover,.fa-acoes label:hover{background:#f1f5f9}
  .fa-acoes .ts{border-color:#0d9488;color:#0f766e}
  .fa-acoes .gg{border-color:#2563eb;color:#1d4ed8}
  .fa-acoes button:disabled{opacity:.7;cursor:wait}
  .fa-gira{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:fa-gira .7s linear infinite}
  @keyframes fa-gira{to{transform:rotate(360deg)}}
  .fa-cola{margin-top:12px;border:2px dashed #cbd5e1;border-radius:12px;background:#f8fafc;min-height:170px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:14px;text-align:center;color:#64748b;font-size:13px;outline:none;cursor:text}
  .fa-cola:focus,.fa-cola.arrasta{border-color:#0d9488;background:#f0fdfa}
  .fa-cola b{color:#0f172a;font-size:14px}
  .fa-cola kbd{font:700 12px 'Plus Jakarta Sans',sans-serif;background:#fff;border:1px solid #e2e8f0;border-bottom-width:2px;border-radius:5px;padding:1px 6px;color:#0f172a}
  .fa-cola img{max-width:100%;max-height:280px;object-fit:contain;border-radius:8px;background:#fff}
  .fa-link{width:100%;height:38px;margin-top:8px;border:1px solid #e2e8f0;border-radius:10px;padding:0 12px;font:500 13px 'Plus Jakarta Sans',sans-serif;outline:none}
  .fa-link:focus{border-color:#0d9488}
  .fa-dica{font-size:12px;color:#64748b;margin:8px 2px 0;line-height:1.4}
  .fa-pe{padding:12px 18px;border-top:1px solid #e2e8f0;display:flex;align-items:center;gap:10px}
  .fa-sel{font-size:12.5px;color:#64748b;flex:1;min-width:0}
  .fa-sel.erro{color:#dc2626;font-weight:700}
  .fa-sel.ok{color:#0f766e;font-weight:700}
  .fa-pe button{height:42px;padding:0 16px;border-radius:10px;font:700 14px 'Plus Jakarta Sans',sans-serif;cursor:pointer;border:1px solid #e2e8f0;background:#fff;color:#334155;white-space:nowrap}
  .fa-pe .fa-ok{border:0;background:#0d9488;color:#fff}
  .fa-pe .fa-ok:disabled{background:#cbd5e1;cursor:not-allowed}
  .fa-cel{display:none}
  .ts-fundo{z-index:98}
  .ts-marca{display:inline-block;font-style:normal;font-size:11px;font-weight:800;color:#fff;border-radius:999px;padding:2px 9px;margin-left:6px;vertical-align:2px}
  .ts-txt{font-size:13.5px;color:#334155;margin:0 0 10px;line-height:1.45}
  .ts-cores{display:flex;flex-wrap:wrap;gap:6px}
  .ts-cores button{height:36px;padding:0 12px;border-radius:999px;border:1px solid #e2e8f0;background:#fff;color:#334155;font:700 13px 'Plus Jakarta Sans',sans-serif;cursor:pointer}
  .ts-cores button:hover{border-color:#0d9488;color:#0f766e}
  .ts-cores button.on{background:#0d9488;border-color:#0d9488;color:#fff}
  .ts-ver{cursor:default;min-height:220px}
  .ts-ver img{max-height:320px}
  @media (max-width:600px){
    .fa-fundo{padding:0;align-items:stretch}
    .fa{max-width:none;max-height:none;border-radius:0}
    .fa-pe{flex-wrap:wrap;padding-bottom:calc(12px + env(safe-area-inset-bottom))}
    .fa-sel{flex-basis:100%}
    .fa-pe button{flex:1}
    .fa-pc{display:none}.fa-cel{display:inline}
    .fa-acoes{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:0 -18px;padding:0 18px}
    .fa-acoes::-webkit-scrollbar{display:none}
    .fa-acoes button,.fa-acoes label{flex:none;white-space:nowrap}
    .fa-link{font-size:16px}
  }`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // imagem vira JPEG de até 1200 px (o banco é todo .jpg); link sem permissão (CORS) falha e o Worker baixa
  function paraJpeg(src) {
    return new Promise((ok, falha) => {
      const im = new Image();
      if (!src.startsWith('data:') && !src.startsWith('blob:')) im.crossOrigin = 'anonymous';
      im.onload = () => {
        try {
          const k = Math.min(1, 1200 / Math.max(im.naturalWidth, im.naturalHeight));
          const cv = document.createElement('canvas');
          cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
          const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
          cx.drawImage(im, 0, 0, cv.width, cv.height);
          ok({ b64: cv.toDataURL('image/jpeg', 0.9), w: im.naturalWidth, h: im.naturalHeight });
        } catch (e) { falha(e); }
      };
      im.onerror = () => falha(new Error('não abriu a imagem'));
      im.src = src;
    });
  }

  // marca pelo artigo (a mesma regra da loja): 7 dígitos é Under Armour
  const MARCAS = { oly: { nome: 'Olympikus', cor: '#2c39e2' }, ua: { nome: 'Under Armour', cor: '#111' } };
  const marcaDe = a => /^\d{7}$/.test(String(a || '').trim()) ? 'ua' : 'oly';

  // procura no Trade Squash sem gravar: primeiro na marca do artigo, depois na outra.
  // → { foto, marca } | { cores:[{cor,sku,nome}], marca } (achou o artigo, não a cor) | { erro }
  async function previaTS(worker, artigo, cor) {
    const m1 = marcaDe(artigo), ordem = [m1, m1 === 'ua' ? 'oly' : 'ua'];
    let erro = '';
    for (const marca of ordem) {
      try {
        const d = await worker({ action: 'tsPreviaImagem', marca, artigo, cor }, true);
        if (d.achou && d.base64) return { foto: d.base64, marca };
        if (d.cores && d.cores.length) return { cores: d.cores, marca };   // o artigo é desta marca
      } catch (e) { erro = e.message; }
    }
    return { erro };
  }

  // Busca + janela de confirmação. Se a cor exata não existir lá (comum na UA),
  // mostra as cores do artigo no Trade Squash para a pessoa escolher pela foto.
  // → { foto, marca } | { recusou:true } | { nao:true } | { erro }
  async function trazerTS({ worker, artigo, cor, nome = '', ok = 'Usar esta foto' }) {
    const r = await previaTS(worker, artigo, cor);
    if (!r.foto && !r.cores) return r.erro ? { erro: r.erro } : { nao: true };
    const mc = MARCAS[r.marca];
    return new Promise(resolve => {
      const f = document.createElement('div');
      f.className = 'fa-fundo ts-fundo';
      const sub = [artigo, cor, nome].filter(Boolean).join(' · ');
      f.innerHTML = `<div class="fa" role="dialog" aria-modal="true" aria-label="Foto do Trade Squash">
        <div class="fa-cab"><div><b>Foto do Trade Squash <i class="ts-marca" style="background:${mc.cor}">${mc.nome}</i></b><span>${esc(sub)}</span></div><button class="fa-x" type="button" aria-label="Fechar">×</button></div>
        <div class="fa-corpo">
          ${r.cores ? `<p class="ts-txt">Não achei a cor <b>${esc(cor)}</b> no Trade Squash da ${mc.nome}: lá as cores têm outros códigos. Este artigo tem estas cores lá; toque numa para ver a foto.</p>
            <div class="ts-cores">${r.cores.map(c => `<button type="button" data-cor="${esc(c.cor)}" title="${esc(c.nome || c.sku)}">${esc(c.cor)}</button>`).join('')}</div>` : ''}
          <div class="fa-cola ts-ver">${r.foto ? '' : '<span>Escolha uma cor acima.</span>'}</div>
          ${r.cores ? `<p class="fa-dica">A foto escolhida fica guardada com a nossa cor (<b>${esc(cor)}</b>).</p>` : ''}
        </div>
        <div class="fa-pe"><span class="fa-sel"></span><button type="button" class="fa-nao">${r.foto ? 'Não é essa' : 'Nenhuma é essa'}</button><button type="button" class="fa-ok" disabled>${esc(ok)}</button></div>
      </div>`;
      document.body.appendChild(f);
      const $ = s => f.querySelector(s);
      const ver = $('.ts-ver'), btOk = $('.fa-ok');
      let foto = null, pedido = 0;
      const pe = (t, tipo) => { const el = $('.fa-sel'); el.textContent = t; el.className = 'fa-sel' + (tipo ? ' ' + tipo : ''); btOk.disabled = !foto; };
      const mostrar = (b64, txt) => { foto = b64; ver.innerHTML = ''; const im = document.createElement('img'); im.alt = ''; im.src = b64; ver.appendChild(im); pe(txt, 'ok'); };
      if (r.foto) mostrar(r.foto, `Achei a cor ${cor} na ${mc.nome}. É ela?`);
      else pe(`${r.cores.length} ${r.cores.length === 1 ? 'cor' : 'cores'} deste artigo no Trade Squash.`);

      const ac = $('.ts-cores');
      if (ac) ac.addEventListener('click', async e => {
        const b = e.target.closest('[data-cor]'); if (!b) return;
        ac.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        const n = ++pedido; foto = null;
        ver.innerHTML = '<span class="fa-gira"></span>'; pe(`Abrindo a cor ${b.dataset.cor}…`);
        try {
          const d = await worker({ action: 'tsPreviaImagem', marca: r.marca, artigo, cor: b.dataset.cor }, true);
          if (n !== pedido) return;   // clicou em outra enquanto carregava
          if (d.achou && d.base64) mostrar(d.base64, `Cor ${b.dataset.cor} do Trade Squash. É a da amostra?`);
          else { ver.innerHTML = '<span>Essa cor está sem foto no Trade Squash.</span>'; pe('Tente outra cor.', 'erro'); }
        } catch (er) { if (n === pedido) { ver.innerHTML = ''; pe('Não deu para abrir: ' + er.message, 'erro'); } }
      });
      const fim = v => { window.removeEventListener('keydown', tecla, true); f.remove(); resolve(v); };
      const tecla = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fim({ recusou: true }); } };
      window.addEventListener('keydown', tecla, true);
      $('.fa-x').addEventListener('click', () => fim({ recusou: true }));
      $('.fa-nao').addEventListener('click', () => fim({ recusou: true }));
      f.addEventListener('click', e => { if (e.target === f) fim({ recusou: true }); });
      btOk.addEventListener('click', () => { if (foto) fim({ foto, marca: r.marca }); });
    });
  }

  function escolher({ artigo = '', cor = '', nome = '', worker, titulo = 'Foto da amostra' } = {}) {
    return new Promise(resolve => {
      const VAZIA = `<b>Cole ou arraste a foto aqui</b><span class="fa-pc">Clique aqui e aperte <kbd>Ctrl</kbd> + <kbd>V</kbd></span><span class="fa-cel">Toque e segure aqui e escolha Colar</span>`;
      const f = document.createElement('div');
      f.className = 'fa-fundo';
      f.innerHTML = `<div class="fa" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
        <div class="fa-cab"><div><b>${esc(titulo)}</b><span>${esc([artigo, cor, nome].filter(Boolean).join(' · '))}</span></div><button class="fa-x" type="button" aria-label="Fechar">×</button></div>
        <div class="fa-corpo">
          <div class="fa-acoes">
            <button type="button" class="ts">Buscar no Trade Squash</button>
            <button type="button" class="gg">Buscar no Google</button>
            <label>📁 Escolher arquivo<input type="file" accept="image/*" hidden></label>
          </div>
          <div class="fa-cola" tabindex="0" contenteditable="true" spellcheck="false" aria-label="Cole ou arraste a foto aqui">${VAZIA}</div>
          <input class="fa-link" type="url" inputmode="url" placeholder="ou cole o endereço (link) da imagem" autocomplete="off">
          <p class="fa-dica">No Google, clique com o botão direito na foto certa, escolha <b>Copiar imagem</b> e volte aqui para colar. No celular, <b>Escolher arquivo</b> também deixa tirar a foto na hora.</p>
        </div>
        <div class="fa-pe"><span class="fa-sel">Escolha um caminho para trazer a foto.</span><button type="button" class="fa-nao">Cancelar</button><button type="button" class="fa-ok" disabled>Usar esta foto</button></div>
      </div>`;
      document.body.appendChild(f);
      const antesOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
      const $ = s => f.querySelector(s);
      const cola = $('.fa-cola'), btOk = $('.fa-ok'), btTs = $('.ts');
      let foto = null;

      const pe = (t, tipo) => { const el = $('.fa-sel'); el.textContent = t; el.className = 'fa-sel' + (tipo ? ' ' + tipo : ''); btOk.disabled = !foto; };
      function mostrar(nova, info) {
        foto = nova;
        if (!foto) { cola.innerHTML = VAZIA; pe('Escolha um caminho para trazer a foto.'); return; }
        cola.innerHTML = '';
        const im = document.createElement('img'); im.alt = ''; im.referrerPolicy = 'no-referrer'; im.src = foto.b64 || foto.url;
        im.onerror = () => { mostrar(null); pe('Esse link não abriu como imagem. Copie a imagem em si ou outro link.', 'erro'); };
        cola.appendChild(im);
        pe(`${info ? info + '. ' : ''}É essa a foto? Se for, clique em Usar esta foto.`, 'ok');
      }
      async function arquivo(file) {
        if (!file || !/^image\//.test(file.type)) { pe('Isso não é uma imagem.', 'erro'); return; }
        const url = URL.createObjectURL(file);
        try { const j = await paraJpeg(url); mostrar({ b64: j.b64 }, `Prévia · ${j.w}×${j.h}`); }
        catch (e) { pe('Não consegui ler essa imagem.', 'erro'); }
        finally { URL.revokeObjectURL(url); }
      }
      async function link(l) {
        l = String(l || '').trim();
        try { const u = new URL(l); const real = u.searchParams.get('imgurl') || u.searchParams.get('mediaurl'); if (real) l = real; } catch (e) {}
        if (!/^(https?:|data:image\/)/i.test(l)) { pe('Isso não parece uma imagem nem o link de uma.', 'erro'); return; }
        try { const j = await paraJpeg(l); mostrar({ b64: j.b64 }, `Prévia · ${j.w}×${j.h}`); }
        catch (e) { mostrar({ url: l }, 'Prévia · ' + new URL(l).hostname.replace(/^www\./, '')); }
      }
      function fim(r) {
        window.removeEventListener('keydown', tecla, true);
        document.body.style.overflow = antesOverflow;
        f.remove(); resolve(r);
      }
      const tecla = e => {
        if (e.key === 'Escape' && !document.querySelector('.pq-fundo')) { e.preventDefault(); e.stopImmediatePropagation(); fim(null); }
      };
      window.addEventListener('keydown', tecla, true);

      btTs.addEventListener('click', async () => {
        if (!artigo || !cor || !worker) { pe('Sem artigo e cor não dá para buscar no Trade Squash.', 'erro'); return; }
        btTs.disabled = true; btTs.innerHTML = '<span class="fa-gira"></span>Buscando…';
        const r = await trazerTS({ worker, artigo, cor, nome });
        btTs.disabled = false; btTs.textContent = 'Buscar no Trade Squash';
        if (r.foto) mostrar({ b64: r.foto }, 'Do Trade Squash · ' + MARCAS[r.marca].nome);
        else if (r.erro) pe('Não deu para buscar no Trade Squash: ' + r.erro, 'erro');
        else if (r.nao) pe('Não achei no Trade Squash. Tente o Google ou um arquivo.');
        else pe('Foto do Trade Squash recusada. Tente o Google ou um arquivo.');
      });
      $('.gg').addEventListener('click', () => {
        const termo = [MARCAS[marcaDe(artigo)].nome, nome, artigo].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        window.open('https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(termo), '_blank', 'noopener');
        pe('Copie a foto certa no Google e volte aqui para colar.');
        setTimeout(() => cola.focus(), 300);
      });
      $('input[type=file]').addEventListener('change', e => { arquivo(e.target.files[0]); e.target.value = ''; });
      f.addEventListener('paste', e => {
        const dt = e.clipboardData; if (!dt) return;
        const arq = [...dt.items].find(i => i.kind === 'file' && i.type.startsWith('image/'));
        if (arq) { e.preventDefault(); arquivo(arq.getAsFile()); return; }
        if (e.target.classList.contains('fa-link')) return;
        e.preventDefault();
        const html = dt.getData('text/html'); const m = html && html.match(/<img[^>]+src="([^"]+)"/i);
        const txt = (m && m[1].replace(/&amp;/g, '&')) || dt.getData('text/plain');
        if (txt) link(txt); else pe('Não veio imagem na área de transferência. Copie a foto de novo.', 'erro');
      });
      cola.addEventListener('beforeinput', e => { if (e.inputType !== 'insertFromPaste') e.preventDefault(); });
      cola.addEventListener('drop', e => {
        e.preventDefault(); cola.classList.remove('arrasta');
        const fl = e.dataTransfer.files && e.dataTransfer.files[0];
        if (fl) return arquivo(fl);
        const u = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (u) link(u);
      });
      cola.addEventListener('dragover', e => { e.preventDefault(); cola.classList.add('arrasta'); });
      cola.addEventListener('dragleave', () => cola.classList.remove('arrasta'));
      let tm; $('.fa-link').addEventListener('input', e => { clearTimeout(tm); tm = setTimeout(() => e.target.value.trim() && link(e.target.value), 250); });
      $('.fa-x').addEventListener('click', () => fim(null));
      $('.fa-nao').addEventListener('click', () => fim(null));
      f.addEventListener('click', e => { if (e.target === f) fim(null); });
      btOk.addEventListener('click', () => { if (foto) fim(foto); });
    });
  }

  window.FotoAmostra = { escolher, paraJpeg, previaTS, trazerTS, marcaDe, MARCAS };
})();
