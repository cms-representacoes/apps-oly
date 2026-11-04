/* ═══════════════════════════════════════════════════════════════════
   banco.js — login e acesso ao banco do portal (Supabase)

   Um só arquivo para todas as aplicações. Uso:

     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>
     <script src="../js/banco.js"></script>
     const perfil = await CMSBanco.exigirLogin();   // { codigo, nome, papel }
     const { data } = await CMSBanco.db.schema('relatorios').from('metas').select('*');

   A chave abaixo é a publicável: foi feita para ir nas telas. Quem decide o
   que cada um vê é o banco (RLS), pelo login.

   Também cuida do convite e do "esqueci a senha": o link do e-mail volta
   para a própria tela, que pede a senha nova.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
  const URL_BANCO = 'https://rczlnuemmluhkgwzdino.supabase.co';
  const CHAVE_PUBLICA = 'sb_publishable_8_E2odMRUb-y-q3CLp0BUg_J1UeZUh7';

  // O link do convite/recuperação chega com #type=invite|recovery
  const tipoNoLink = new URLSearchParams(location.hash.slice(1)).get('type');
  const db = window.supabase.createClient(URL_BANCO, CHAVE_PUBLICA, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'cms_banco_sessao' }
  });

  let perfil = null;

  async function lerPerfil(){
    const { data, error } = await db.schema('sistema').rpc('meu_perfil');
    if(error) throw error;
    return (data && data[0]) || null;
  }

  /* ── a janela de login ─────────────────────────────────────────── */
  const CSS = `
  .cb-fundo{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
    padding:16px;background:rgba(8,20,24,.72);backdrop-filter:blur(6px);font-family:inherit}
  .cb-caixa{width:100%;max-width:380px;background:#fff;color:#14272b;border-radius:18px;padding:26px 22px;
    box-shadow:0 24px 64px rgba(0,0,0,.35)}
  .cb-caixa h2{margin:0 0 4px;font-size:20px}
  .cb-caixa p{margin:0 0 18px;font-size:14px;color:#55696d;line-height:1.45}
  .cb-caixa label{display:block;font-size:13px;font-weight:700;margin:12px 0 6px}
  .cb-caixa input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:12px 14px;
    border:1.5px solid #cfdcde;border-radius:12px;outline:none;background:#fff;color:#14272b}
  .cb-caixa input:focus{border-color:#0f8b8d}
  .cb-caixa button{width:100%;margin-top:18px;font:inherit;font-size:16px;font-weight:800;padding:13px;
    border:0;border-radius:12px;background:#0f8b8d;color:#fff;cursor:pointer}
  .cb-caixa button[disabled]{opacity:.6;cursor:wait}
  .cb-link{display:block;margin-top:14px;text-align:center;font-size:13px;color:#0f8b8d;cursor:pointer;
    background:none!important;color:#0f8b8d!important;padding:0!important;margin-top:14px!important;font-weight:600!important}
  .cb-msg{min-height:18px;margin-top:12px;font-size:13px;color:#b42318}
  .cb-msg.ok{color:#0f7a4a}
  @media (prefers-color-scheme:dark){
    .cb-caixa{background:#13252a;color:#e6f0f1}.cb-caixa p{color:#9fb4b7}
    .cb-caixa input{background:#0c1a1e;color:#e6f0f1;border-color:#2a4449}
  }`;

  function janela(html){
    if(!document.getElementById('cb-css')){
      const s = document.createElement('style'); s.id = 'cb-css'; s.textContent = CSS; document.head.appendChild(s);
    }
    let f = document.getElementById('cb-fundo');
    if(!f){ f = document.createElement('div'); f.id = 'cb-fundo'; f.className = 'cb-fundo'; document.body.appendChild(f); }
    f.innerHTML = `<form class="cb-caixa" novalidate>${html}<div class="cb-msg" id="cb-msg"></div></form>`;
    return f.querySelector('form');
  }
  const fechar = () => { const f = document.getElementById('cb-fundo'); if(f) f.remove(); };
  const msg = (t, ok) => { const m = document.getElementById('cb-msg'); m.textContent = t; m.className = 'cb-msg' + (ok ? ' ok' : ''); };

  function pedirEntrada(){
    return new Promise(resolve => {
      const form = janela(`
        <h2>Entrar no portal</h2>
        <p>Use o e-mail e a senha do seu acesso.</p>
        <label for="cb-email">E-mail</label>
        <input id="cb-email" type="email" autocomplete="username" required>
        <label for="cb-senha">Senha</label>
        <input id="cb-senha" type="password" autocomplete="current-password" required>
        <button type="submit">Entrar</button>
        <button type="button" class="cb-link" id="cb-esqueci">Esqueci a senha</button>`);
      form.querySelector('#cb-email').focus();
      form.querySelector('#cb-esqueci').onclick = async () => {
        const email = form.querySelector('#cb-email').value.trim();
        if(!email){ msg('Digite o seu e-mail acima e clique de novo.'); return; }
        const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
        msg(error ? 'Não deu para enviar agora. Tente de novo em alguns minutos.'
                  : 'Se o e-mail tiver acesso, chega um link para criar a senha nova.', !error);
      };
      form.onsubmit = async ev => {
        ev.preventDefault();
        const bt = form.querySelector('button[type=submit]'); bt.disabled = true; msg('');
        const { error } = await db.auth.signInWithPassword({
          email: form.querySelector('#cb-email').value.trim(),
          password: form.querySelector('#cb-senha').value });
        bt.disabled = false;
        if(error){ msg('E-mail ou senha não conferem.'); return; }
        resolve();
      };
    });
  }

  function pedirSenhaNova(convite){
    return new Promise(resolve => {
      const form = janela(`
        <h2>${convite ? 'Bem-vindo ao portal' : 'Senha nova'}</h2>
        <p>${convite ? 'Crie a sua senha de acesso.' : 'Escolha a sua senha nova.'} Mínimo de 10 caracteres.</p>
        <label for="cb-s1">Senha</label>
        <input id="cb-s1" type="password" autocomplete="new-password" required>
        <label for="cb-s2">Repita a senha</label>
        <input id="cb-s2" type="password" autocomplete="new-password" required>
        <button type="submit">Salvar senha</button>`);
      form.querySelector('#cb-s1').focus();
      form.onsubmit = async ev => {
        ev.preventDefault();
        const s1 = form.querySelector('#cb-s1').value, s2 = form.querySelector('#cb-s2').value;
        if(s1.length < 10){ msg('A senha precisa ter pelo menos 10 caracteres.'); return; }
        if(s1 !== s2){ msg('As duas senhas não estão iguais.'); return; }
        const bt = form.querySelector('button'); bt.disabled = true;
        const { error } = await db.auth.updateUser({ password: s1 });
        bt.disabled = false;
        if(error){ msg('Não deu para salvar: ' + error.message); return; }
        history.replaceState(null, '', location.pathname + location.search);
        resolve();
      };
    });
  }

  /* ── o que as telas chamam ─────────────────────────────────────── */
  async function exigirLogin(){
    let { data: { session } } = await db.auth.getSession();
    if(session && (tipoNoLink === 'invite' || tipoNoLink === 'recovery')){
      await pedirSenhaNova(tipoNoLink === 'invite');
    }
    if(!session){
      await pedirEntrada();
    }
    perfil = await lerPerfil();
    if(!perfil){
      janela(`<h2>Sem acesso</h2><p>Este login não está ligado a nenhum usuário do portal. Fale com a CMS.</p>
              <button type="button" id="cb-sair">Sair</button>`).querySelector('#cb-sair').onclick = sair;
      throw new Error('login sem perfil');
    }
    fechar();
    return perfil;
  }

  async function sair(){
    await db.auth.signOut();
    location.reload();
  }

  window.CMSBanco = {
    db, exigirLogin, sair,
    get perfil(){ return perfil; },
    souAdmin: () => !!perfil && (perfil.papel === 'cms' || perfil.papel === 'dev'),
    souDev: () => !!perfil && perfil.papel === 'dev',
  };
})();
