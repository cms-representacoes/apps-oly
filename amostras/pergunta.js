/* Modal de pergunta das telas de Amostras.
   Uso: if (!(await perguntar({ titulo, texto, detalhe, imagem, ok, perigo }))) return;
   imagem: endereço ou data: de uma foto para conferir antes de confirmar.
   Esc ou clicar fora = Cancelar; Enter = confirmar. */
(function () {
  const css = `
  .pq-fundo{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:100;opacity:0;transition:opacity .15s}
  .pq-fundo.show{opacity:1}
  .pq-caixa{background:#fff;border-radius:16px;width:100%;max-width:400px;box-shadow:0 24px 60px rgba(15,23,42,.35);padding:22px 22px 18px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#0f172a;transform:translateY(8px) scale(.98);transition:transform .15s}
  .pq-fundo.show .pq-caixa{transform:none}
  .pq-ico{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:#ccfbf1;color:#0f766e;margin-bottom:14px}
  .pq-caixa.perigo .pq-ico{background:#fee2e2;color:#dc2626}
  .pq-tit{font-size:17px;font-weight:800;margin:0 0 6px}
  .pq-txt{font-size:14px;color:#475569;margin:0;line-height:1.45}
  .pq-det{margin:12px 0 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;font-size:13.5px;font-weight:700;color:#0f172a}
  .pq-det small{display:block;font-weight:600;color:#64748b;font-size:12.5px;margin-top:2px}
  .pq-img{margin:14px 0 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;display:flex;align-items:center;justify-content:center;padding:8px}
  .pq-img img{max-width:100%;max-height:min(46vh,340px);object-fit:contain;border-radius:8px;background:#fff}
  .pq-caixa.com-img{max-width:460px}
  .pq-bts{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}
  .pq-bts button{height:40px;padding:0 16px;border-radius:10px;font:700 14px 'Plus Jakarta Sans',system-ui,sans-serif;cursor:pointer;border:1px solid #e2e8f0;background:#fff;color:#334155}
  .pq-bts button:hover{background:#f1f5f9}
  .pq-bts .pq-ok{border:0;background:#0d9488;color:#fff}
  .pq-bts .pq-ok:hover{background:#0f766e}
  .pq-caixa.perigo .pq-ok{background:#dc2626}
  .pq-caixa.perigo .pq-ok:hover{background:#b91c1c}
  @media (max-width:480px){
    .pq-fundo{align-items:flex-end;padding:0}
    .pq-caixa{max-width:none;border-radius:18px 18px 0 0;padding:20px 16px calc(16px + env(safe-area-inset-bottom))}
    .pq-bts{flex-direction:column-reverse}
    .pq-bts button{width:100%;height:46px}
  }`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const ICO = {
    perigo: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
    normal: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>'
  };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  window.perguntar = function ({ titulo = 'Confirmar?', texto = '', detalhe = '', sub = '', imagem = '', ok = 'Confirmar', cancelar = 'Cancelar', perigo = false } = {}) {
    return new Promise(resolve => {
      const antes = document.activeElement;
      const f = document.createElement('div');
      f.className = 'pq-fundo';
      f.innerHTML = `<div class="pq-caixa${perigo ? ' perigo' : ''}${imagem ? ' com-img' : ''}" role="alertdialog" aria-modal="true" aria-labelledby="pq-tit">
        ${imagem ? '' : `<div class="pq-ico">${perigo ? ICO.perigo : ICO.normal}</div>`}
        <p class="pq-tit" id="pq-tit">${esc(titulo)}</p>
        ${texto ? `<p class="pq-txt">${esc(texto)}</p>` : ''}
        ${imagem ? `<div class="pq-img"><img src="${esc(imagem)}" alt="" referrerpolicy="no-referrer"></div>` : ''}
        ${detalhe ? `<div class="pq-det">${esc(detalhe)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>` : ''}
        <div class="pq-bts"><button type="button" class="pq-nao">${esc(cancelar)}</button><button type="button" class="pq-ok">${esc(ok)}</button></div>
      </div>`;
      document.body.appendChild(f);
      requestAnimationFrame(() => f.classList.add('show'));
      const btOk = f.querySelector('.pq-ok'), btNao = f.querySelector('.pq-nao');
      (perigo ? btNao : btOk).focus();

      const fim = r => {
        window.removeEventListener('keydown', tecla, true);
        f.remove();
        if (antes && antes.focus) try { antes.focus(); } catch (_) {}
        resolve(r);
      };
      // captura antes das outras telas: o Esc aqui só fecha o modal
      const tecla = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fim(false); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); fim(document.activeElement === btNao ? false : true); }
        else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === btOk ? btNao : btOk).focus(); }
      };
      window.addEventListener('keydown', tecla, true);
      btOk.onclick = () => fim(true);
      btNao.onclick = () => fim(false);
      f.addEventListener('click', e => { if (e.target === f) fim(false); });
    });
  };
})();
