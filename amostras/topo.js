// Botão redondo de voltar ao topo (o mesmo modelo da vitrine do Showroom).
// Aparece depois de uma tela e meia rolada e sobe acima de qualquer barra
// fixa do rodapé que estiver à vista.
//   <script src="topo.js" data-cor="#FFBE0B,#FFD35A,#D99A00" data-tinta="#1A1407" data-evitar=".barra"></script>
(() => {
  const s = document.currentScript;
  const [cor, claro, escuro] = (s.dataset.cor || '#0d9488,#2dd4bf,#0f766e').split(',');
  const tinta = s.dataset.tinta || '#fff';
  const evitar = s.dataset.evitar || '';

  const st = document.createElement('style');
  st.textContent = `
  .topo-fab{position:fixed;z-index:45;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));
    width:48px;height:48px;border-radius:50%;border:0;color:${tinta};cursor:pointer;
    background:linear-gradient(145deg,${claro},${cor} 55%,${escuro});
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 10px 24px ${cor}73,0 0 0 3px rgba(255,255,255,.9),inset 0 1px 0 rgba(255,255,255,.25);
    opacity:0;transform:translateY(10px);transition:opacity .2s,transform .2s,bottom .2s}
  .topo-fab[hidden]{display:none}
  .topo-fab.on{opacity:1;transform:none}
  .topo-fab:hover{filter:brightness(1.08)}
  @media (min-width:900px){ .topo-fab{right:24px;bottom:24px} }
  @media (prefers-reduced-motion:reduce){ .topo-fab{transition:none} }`;
  document.head.appendChild(st);

  const b = document.createElement('button');
  b.type = 'button'; b.className = 'topo-fab'; b.hidden = true;
  b.title = 'Voltar ao topo'; b.setAttribute('aria-label', 'Voltar ao topo');
  b.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  b.addEventListener('click', () => window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' }));
  document.body.appendChild(b);

  // quanto as barras do rodapé ocupam agora (a do WhatsApp, a de selecionados…)
  const folga = () => {
    let h = 0;
    if (evitar) document.querySelectorAll(evitar).forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.height && r.top < innerHeight - 4 && r.bottom > innerHeight - 40 && getComputedStyle(el).visibility !== 'hidden') h = Math.max(h, innerHeight - r.top);
    });
    return h;
  };
  let t = null;
  const ver = () => {
    const f = folga();
    b.style.bottom = f ? `${Math.round(f + 12)}px` : '';
    const mostra = window.scrollY > innerHeight * 1.5;
    if (mostra === b.classList.contains('on')) return;
    clearTimeout(t);
    if (mostra) { b.hidden = false; requestAnimationFrame(() => b.classList.add('on')); }
    else { b.classList.remove('on'); t = setTimeout(() => { if (!b.classList.contains('on')) b.hidden = true; }, 220); }
  };
  addEventListener('scroll', ver, { passive: true });
  addEventListener('resize', ver);
  // a barra pode entrar ou sair sem rolagem (marcou um item, escolheu um produto)
  setInterval(ver, 400);
  ver();
})();
