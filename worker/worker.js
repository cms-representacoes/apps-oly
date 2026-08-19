export default {
  async fetch(request, env) {
    // ── CORS: lista de origens permitidas ────────────────────────────────────
    // Adicione aqui qualquer outro domínio que vá consumir o Worker (catálogo, admin, etc)
    const ALLOWED_ORIGINS = [
      "https://cms-representacoes.github.io",
      "https://marcosrep-cms.workers.dev",
      "http://localhost:3000",
      "http://127.0.0.1:5500"
    ];
    const origin = request.headers.get("Origin") || "";
    const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin);
    const corsHeaders = {
      "Access-Control-Allow-Origin": isAllowedOrigin ? origin : ALLOWED_ORIGINS[0],
      "Vary": "Origin",
      "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      "Content-Type": "application/json; charset=utf-8"
    };

    // ── ACTIONS QUE EXIGEM AUTENTICAÇÃO (writes) ────────────────────────────
    const WRITE_ACTIONS = new Set([
      "save",
      "saveDispo",
      "saveProdutos",
      "uploadImagem",
      "saveImagensHistorico",
      "saveDisponibilidades",
      "saveOcultosDisp",
      "saveOcultos",
      "saveCategoryImage",
      "saveTabelaEspecial",
      "saveStatus",
      "setStatusVitrine",
      "saveCarteira",
      "saveAcaoCarteira",
      "saveClientesCadastrados",
      "saveFaturados",
      "saveRateio",
      "resolverMatrizPendente",
      "deleteMatrizItens",
      "limparHistoricoMatriz",
      "uploadMatrizImagem",
      "clearPedidosHistorico",
      "tsBuscarImagens",
      "tsDiagnostico",
      "tsInspecionarLogin",
      "saveExclusivos"
    ]);

    function requireAdmin(action) {
      // Só exige token em writes
      if (!WRITE_ACTIONS.has(action)) return null;
      // Se não houver token configurado no Worker, registra aviso mas libera (modo de transição)
      if (!env.ADMIN_TOKEN) {
        console.warn("[SECURITY] ADMIN_TOKEN não configurado — write liberado em modo legado:", action);
        return null;
      }
      const provided = request.headers.get("X-Admin-Token") || "";
      if (provided !== env.ADMIN_TOKEN) {
        return new Response(
          JSON.stringify({ success: false, error: "Não autorizado" }),
          { status: 401, headers: corsHeaders }
        );
      }
      return null;
    }

    // Versão por método HTTP — DESATIVADA: vendedor precisa criar/editar pedidos
    // sem login (POST/PUT/DELETE liberados). A proteção fica nas actions de write
    // do PATCH (saveDisponibilidades, uploadImagem, etc).

    const githubHeaders = {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "repasse-worker"
    };

    // Defesa contra espaço invisível colado nas variáveis de ambiente da Cloudflare
    // (já causou 404 silencioso antes em GITHUB_BRANCH — agora protegido pra sempre).
    env.GITHUB_OWNER = String(env.GITHUB_OWNER || "").trim();
    env.GITHUB_REPO  = String(env.GITHUB_REPO  || "").trim();
    if (env.GITHUB_IMG_REPO) env.GITHUB_IMG_REPO = String(env.GITHUB_IMG_REPO).trim();

    const GITHUB_PEDIDOS       = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/pedidos.json`;
    const GITHUB_DESM          = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/desmembramentos.json`;
    const GITHUB_OCULTOS       = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/ocultos.json`;
    const GITHUB_DISPO         = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/dispo.json`;
    const GITHUB_PRODUTOS      = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/produtos.json`;
    const GITHUB_DISPONIB      = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/disponibilidades.json`;
    const GITHUB_OCULTOS_DISP  = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/ocultos_disponibilidades.json`;
    const GITHUB_TABELA_ESP    = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/tabela_especial.json`;
    // Produtos de canal exclusivo (DTC / ML) — NÃO vão para a vitrine.
    // Mapa { "ARTIGO|COR": "DTC" | "ML" | "DTC+ML" }
    const GITHUB_EXCLUSIVOS    = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/exclusivos.json`;
    const GITHUB_LINKS         = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/links_compartilhados.json`;
    const GITHUB_IMG_HIST      = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/disponibilidades_imagens.json`;
    const GITHUB_STATUS        = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/app_status.json`;
    const GITHUB_RATEIO        = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/rateio.json`;
    const GITHUB_PREPOSTOS     = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/prepostos.json`;
    // Histórico de pedidos do Catálogo Digital — 1 arquivo por comissionista
    const GITHUB_CAT_HIST_BASE = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/catalogo-historico`;
    // Rascunhos de pedido do Catálogo Digital — 1 arquivo por comissionista
    const GITHUB_CAT_RASC_BASE = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/catalogo-rascunhos`;
    // Imagens das categorias da home do Catálogo Digital
    const GITHUB_CAT_IMG_BASE  = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/imagens_olympikus/categorias`;
    // Listagem de clientes — 1 arquivo por vendedor (código)
    const GITHUB_CLIENTES_BASE = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/clientes`;
    // Desejos do vendedor (watchlist de produtos)
    const GITHUB_DESEJOS_BASE = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/desejos`;
    // Status da vitrine (pausada / ativa)
    const GITHUB_VITRINE_STATUS = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/vitrine_status.json`;
    // Carteira CMS — pedidos importados + ações dos vendedores
    const GITHUB_CARTEIRA       = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/carteira-cms.json`;
    // Carteira CMS — apenas as AÇÕES (arquivo pequeno: { acoes: { chave: {acao, repasse} } })
    const GITHUB_CARTEIRA_ACOES = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/carteira-cms-acoes.json`;
    // Carteira CMS — clientes cadastrados manualmente (sem compra): { clientes: { cod: {codigo,razao,nomeFantasia,porta} } }
    const GITHUB_CLIENTES = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/carteira-cms-clientes.json`;
    // Carteira CMS — histórico de faturados: { faturados: { cod: { artigo: {desc, cores:{cor:pares}} } } }
    const GITHUB_FATURADOS = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/carteira-cms-faturados.json`;
    const GITHUB_PERFORMANCE = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/performance.json`;
    // Relatório RFV (Recência · Frequência · Valor) — dados publicados
    const GITHUB_RFV = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/rfv.json`;
    // Estoque Virtual — Matriz Esportes (lojas + itens reportados por cada loja + pendentes de cadastro)
    const GITHUB_MATRIZ = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/matriz_estoque.json`;
    // Repositório onde ficam as imagens de produto (pode ser diferente do repo de dados)
    const GITHUB_IMG_REPO = env.GITHUB_IMG_REPO || "apps-oly-v2";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── HELPERS ──────────────────────────────────────────────────────────────

    // Decodifica Base64 (suporta UTF-8 corretamente)
    function decodeB64(b64) {
      const clean = String(b64 || "").replace(/\s/g, "");
      if (!clean) return "";
      const bin = atob(clean);
      // Converte binário → UTF-8
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      return new TextDecoder("utf-8").decode(bytes);
    }

    async function getFile(url) {
      const res = await fetch(url, { headers: githubHeaders });
      if (res.status === 404) return { content: null, sha: null };
      if (!res.ok) throw new Error(`GET GitHub falhou (${res.status}): ${await res.text()}`);
      const data = await res.json();
      const sha = data.sha;

      let rawText = "";
      // A Contents API só retorna 'content' em Base64 para arquivos até 1 MB.
      // Acima disso, 'content' vem vazio e precisamos buscar o blob pela git_url.
      if (data.content && data.content.trim() !== "") {
        rawText = decodeB64(data.content);
      } else if (data.git_url) {
        // Arquivo grande (> 1 MB): busca o blob diretamente (sem limite de tamanho)
        const blobRes = await fetch(data.git_url, { headers: githubHeaders });
        if (!blobRes.ok) {
          throw new Error(`GET blob GitHub falhou (${blobRes.status}): ${await blobRes.text()}`);
        }
        const blob = await blobRes.json();
        rawText = decodeB64(blob.content);
      } else if (data.download_url) {
        // Fallback final: baixa o conteúdo cru
        const dlRes = await fetch(data.download_url, { headers: githubHeaders });
        if (!dlRes.ok) {
          throw new Error(`GET download GitHub falhou (${dlRes.status})`);
        }
        rawText = await dlRes.text();
      } else {
        throw new Error("GET GitHub: não foi possível obter o conteúdo do arquivo.");
      }

      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch (e) {
        // JSON inválido NÃO deve ser tratado como "arquivo vazio" —
        // isso protegeria contra sobrescrever dados bons com lista vazia.
        throw new Error(`JSON inválido no arquivo: ${e.message}`);
      }
      return { content: parsed, sha, raw: rawText };
    }

    // ── Git Data API: cria/atualiza um arquivo via blob+tree+commit ─────────
    // Substitui a Contents API simples (PUT /contents/{path}), que falha com
    // 404/erro em arquivos que passam de ~1MB depois de codificados em Base64.
    // A Git Data API não tem esse limite prático de tamanho.
    function parseRepoUrl(url) {
      const m = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
      if (!m) throw new Error(`URL de repositório inesperada: ${url}`);
      return { owner: m[1].trim(), repo: m[2].trim(), path: m[3].trim() };
    }

    async function gitCreateBlob(owner, repo, contentStr) {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        headers: { ...githubHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ content: btoa(unescape(encodeURIComponent(contentStr))), encoding: "base64" })
      });
      if (!res.ok) throw new Error(`Git blob falhou (${res.status}): ${await res.text()}`);
      const data = await res.json();
      return data.sha;
    }

    // Para conteúdo binário que JÁ vem em base64 (ex: imagens) — sem re-codificar como texto.
    async function gitCreateBlobFromBase64(owner, repo, base64Content) {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        headers: { ...githubHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ content: base64Content, encoding: "base64" })
      });
      if (!res.ok) throw new Error(`Git blob (binário) falhou (${res.status}): ${await res.text()}`);
      const data = await res.json();
      return data.sha;
    }

    // Passos 1-2 e 4-6 do commit via Git Data API, reutilizável tanto para texto quanto para
    // binário — recebe um blobSha já pronto em vez de criar o blob internamente.
    async function gitCommitBlob(owner, repo, branch, path, blobSha, message) {
      const cleanBranch = String(branch || "main").trim();
      const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(cleanBranch)}`;
      const refRes = await fetch(refUrl, { headers: githubHeaders });
      if (!refRes.ok) throw new Error(`Git ref falhou (${refRes.status}) em ${refUrl}: ${await refRes.text()}`);
      const parentCommitSha = (await refRes.json()).object.sha;

      const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${parentCommitSha}`, { headers: githubHeaders });
      if (!commitRes.ok) throw new Error(`Git commit (get) falhou (${commitRes.status}): ${await commitRes.text()}`);
      const baseTreeSha = (await commitRes.json()).tree.sha;

      const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
        method: "POST",
        headers: { ...githubHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ base_tree: baseTreeSha, tree: [{ path, mode: "100644", type: "blob", sha: blobSha }] })
      });
      if (!treeRes.ok) throw new Error(`Git tree falhou (${treeRes.status}): ${await treeRes.text()}`);
      const treeSha = (await treeRes.json()).sha;

      const newCommitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
        method: "POST",
        headers: { ...githubHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ message, tree: treeSha, parents: [parentCommitSha] })
      });
      if (!newCommitRes.ok) throw new Error(`Git commit (create) falhou (${newCommitRes.status}): ${await newCommitRes.text()}`);
      const newCommitSha = (await newCommitRes.json()).sha;

      const updateRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(cleanBranch)}`, {
        method: "PATCH",
        headers: { ...githubHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ sha: newCommitSha })
      });
      if (!updateRefRes.ok) throw new Error(`Git ref (update) falhou (${updateRefRes.status}): ${await updateRefRes.text()}`);
      return newCommitSha;
    }

    async function gitCommitFile(owner, repo, branch, path, contentStr, message) {
      const blobSha = await gitCreateBlob(owner, repo, contentStr);
      return gitCommitBlob(owner, repo, branch, path, blobSha, message);
    }

    async function saveFile(url, content, sha, message) {
      const { owner, repo, path } = parseRepoUrl(url);
      const branch = env.GITHUB_BRANCH || "main";

      // Backup: salva snapshot antes de sobrescrever (só para arquivos principais)
      const isMainFile = [GITHUB_PEDIDOS, GITHUB_DISPO, GITHUB_PRODUTOS].includes(url);
      if (isMainFile && sha) {
        try {
          const backupPath = path.replace("data/", "data/backups/").replace(".json", `_backup_${new Date().toISOString().slice(0,10)}.json`);
          const backupUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${backupPath}`;
          // Verifica se backup do dia já existe
          const existingBackup = await fetch(backupUrl, { headers: githubHeaders });
          if (existingBackup.status === 404) {
            // Lê o conteúdo atual (getFile já lida com arquivos > 1 MB)
            const cur = await getFile(url);
            if (cur && cur.raw) {
              await gitCommitFile(owner, repo, branch, backupPath, cur.raw, `backup: ${message}`);
            }
          }
        } catch (_) { /* não bloqueia a escrita principal se backup falhar */ }
      }

      const jsonStr = JSON.stringify(content, null, 2);
      await gitCommitFile(owner, repo, branch, path, jsonStr, message);
      return { success: true };
    }

    // Atalhos para pedidos
    async function getPedidos() { return getFile(GITHUB_PEDIDOS); }
    async function savePedidos(list, sha, msg = "update pedidos") {
      return saveFile(GITHUB_PEDIDOS, list, sha, msg);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TRADE SQUASH — busca automática de imagens de produto
    // ═══════════════════════════════════════════════════════════════════════
    // Porta o que o app Python fazia na máquina do usuário. O Selenium sai de
    // cena: o login vira um POST de formulário Rails, e o resto (busca e
    // download) já era HTTP puro lá.
    // Exige os secrets TS_USERNAME e TS_PASSWORD no painel da Cloudflare.

    const TS_BASE      = "https://app.tradesquash.com";
    const TS_SEARCH    = `${TS_BASE}/search/showcase/products`;
    const TS_TENANTS   = { oly: "olympikus", ua: "under-armour" };
    const TS_UA_HEADER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                         "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

    // Espelha normalizarChave() do painel admin. As duas regras PRECISAM ser
    // idênticas, senão a imagem sobe com um nome que o painel não reconhece.
    function tsNormalizarChave(valor) {
      return String(valor || "")
        .replace(/\.(jpe?g|png|webp)$/i, "")
        .toUpperCase()
        .replace(/[\/\-\s.]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .trim();
    }
    function tsNomeArquivo(artigo, cor) {
      return `${tsNormalizarChave(artigo)}_${tsNormalizarChave(cor)}.jpg`;
    }

    // Comparação frouxa usada pelo Python: ignora espaço, _, - e /
    function tsSolto(texto) {
      return String(texto || "").replace(/[\s_\-/]/g, "").toUpperCase();
    }

    // Workers novos expõem getSetCookie(); mantemos fallback para o header
    // concatenado, que é como as runtimes antigas devolvem.
    function tsColherCookies(cookieAtual, res) {
      const jar = {};
      for (const par of String(cookieAtual || "").split(";")) {
        const [k, ...v] = par.trim().split("=");
        if (k) jar[k] = v.join("=");
      }
      let novos = [];
      try { novos = res.headers.getSetCookie ? res.headers.getSetCookie() : []; }
      catch (_) { novos = []; }
      if (!novos.length) {
        const bruto = res.headers.get("set-cookie");
        if (bruto) novos = bruto.split(/,(?=[^;]+?=)/);
      }
      for (const sc of novos) {
        const [k, ...v] = String(sc).split(";")[0].trim().split("=");
        if (k) jar[k] = v.join("=");
      }
      return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    }

    // Lê um atributo de uma tag HTML solta (ex.: name="x" de um <input ...>)
    function tsAttr(tag, attr) {
      const m = String(tag).match(new RegExp(attr + '\\s*=\\s*"([^"]*)"', "i"));
      return m ? m[1] : "";
    }

    // Encontra o <form> de login: é aquele que contém um input de senha.
    // A página tem outros formulários (busca, newsletter), e pegar o primeiro
    // levaria a postar no endereço errado.
    function tsFormLogin(html) {
      const forms = [...String(html).matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)];
      for (const f of forms) {
        if (/type\s*=\s*"password"/i.test(f[1])) {
          const abre = f[0].match(/<form\b[^>]*>/i);
          return { tag: abre ? abre[0] : "", corpo: f[1] };
        }
      }
      return null;
    }

    // Monta o corpo do POST lendo os campos REAIS do formulário.
    // Não fixamos "user[email]" — o Trade Squash já renomeou esses campos antes
    // (o scraper Python tinha comentário sobre isso), e o Selenium não se
    // importava porque localizava por type. Aqui descobrimos os nomes na hora.
    function tsMontarPayload(corpo, usuario, senha) {
      const inputs = [...String(corpo).matchAll(/<input\b[^>]*>/gi)].map(m => m[0]);
      const dados = new URLSearchParams();
      const achados = { email: "", senha: "", termos: "", valorTermos: "1", ocultos: [] };

      for (const tag of inputs) {
        const name = tsAttr(tag, "name");
        if (!name) continue;
        const type = (tsAttr(tag, "type") || "text").toLowerCase();
        const value = tsAttr(tag, "value");

        if (type === "email" || (!achados.email && /e-?mail|login|user(name)?$/i.test(name))) {
          achados.email = name; continue;
        }
        if (type === "password") { achados.senha = name; continue; }
        if (type === "checkbox") {
          // "Remember me" fica de fora de propósito
          if (/term|accept|aceite|polic|privac/i.test(name)) {
            achados.termos = name;
            achados.valorTermos = value || "1";
          }
          continue;
        }
        // hidden (authenticity_token, utf8, _method...) e submit vão como estão
        if (type === "hidden" || type === "submit") {
          dados.set(name, value);
          if (type === "hidden") achados.ocultos.push(name);
        }
      }

      if (achados.email)  dados.set(achados.email, usuario);
      if (achados.senha)  dados.set(achados.senha, senha);
      // depois dos hidden: o Rails emite um hidden "0" com o mesmo nome do
      // checkbox, e o valor marcado precisa sobrescrever aquele zero
      if (achados.termos) dados.set(achados.termos, achados.valorTermos);

      return { dados, achados };
    }

    // Rails clássico: GET no formulário para pegar authenticity_token + cookie,
    // POST com as credenciais, e GET na showcase para o servidor contextualizar
    // o tenant (o Python fazia isso clicando no botão "Vitrine").
    async function tsLogin(tenant) {
      if (!env.TS_USERNAME || !env.TS_PASSWORD) {
        throw new Error("TS_USERNAME/TS_PASSWORD não configurados nos secrets do Worker.");
      }
      const cab = { "User-Agent": TS_UA_HEADER, "Accept-Language": "pt-BR,pt;q=0.9" };

      const r1 = await fetch(`${TS_BASE}/session/new`, { headers: cab, redirect: "follow" });
      if (!r1.ok) throw new Error(`GET /session/new falhou (${r1.status})`);
      const html = await r1.text();
      let cookie = tsColherCookies("", r1);

      const formulario = tsFormLogin(html);
      if (!formulario) {
        throw new Error("Formulário de login não encontrado (nenhum <form> com campo de senha).");
      }

      const acao = tsAttr(formulario.tag, "action") || "/session";
      const urlPost = acao.startsWith("http")
        ? acao
        : TS_BASE + (acao.startsWith("/") ? acao : "/" + acao);

      const { dados, achados } = tsMontarPayload(formulario.corpo, env.TS_USERNAME, env.TS_PASSWORD);
      if (!achados.email || !achados.senha) {
        throw new Error(`Campos de login não identificados (email="${achados.email}", senha="${achados.senha}").`);
      }

      const r2 = await fetch(urlPost, {
        method: "POST",
        headers: {
          ...cab,
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
          Referer: `${TS_BASE}/session/new`,
          Origin: TS_BASE
        },
        body: dados.toString(),
        redirect: "manual"
      });
      cookie = tsColherCookies(cookie, r2);
      if (r2.status >= 400) throw new Error(`POST de login falhou (${r2.status})`);
      // Guarda o que foi detectado, para o diagnóstico conseguir mostrar
      globalThis.__TS_ULTIMO_FORM = { urlPost, ...achados, statusPost: r2.status };

      const showcase = `${TS_BASE}/${tenant}/showcase`;
      const r3 = await fetch(showcase, { headers: { ...cab, Cookie: cookie }, redirect: "follow" });
      cookie = tsColherCookies(cookie, r3);
      const htmlShow = await r3.text();
      if (/name="authenticity_token"/i.test(htmlShow) && /session/i.test(r3.url || "")) {
        throw new Error("Login recusado — voltou para a tela de sessão. Confira TS_USERNAME/TS_PASSWORD.");
      }
      return { cookie, tenant, showcase, criadoEm: Date.now() };
    }

    async function tsSessao(tenant, forcar) {
      const valida = globalThis.__TS_SESSAO &&
                     globalThis.__TS_SESSAO.tenant === tenant &&
                     (Date.now() - globalThis.__TS_SESSAO.criadoEm) < 20 * 60 * 1000;
      if (valida && !forcar) return globalThis.__TS_SESSAO;
      globalThis.__TS_SESSAO = await tsLogin(tenant);
      return globalThis.__TS_SESSAO;
    }

    // UA traz ARTIGO_COR_TAMANHO (vários tamanhos por cor); Olympikus, ARTIGO-COR.
    // Removemos o último pedaço só quando ele parece tamanho.
    function tsChaveSemTamanho(sku) {
      const partes = String(sku).split(/[_-]/);
      if (partes.length <= 2) return String(sku).toUpperCase();
      const ultimo = partes[partes.length - 1].toUpperCase();
      const tamanhos = ["P","PP","M","G","GG","EG","EGG","XS","S","L","XL","XXL"];
      const ehTamanho = ultimo.length <= 3 && (
        tamanhos.includes(ultimo) || /^\d+G+$/.test(ultimo) || /^\d{2,3}$/.test(ultimo)
      );
      return (ehTamanho ? partes.slice(0, -1).join("_") : String(sku)).toUpperCase();
    }

    async function tsBuscar(sessao, artigo, cor) {
      const url = `${TS_SEARCH}?format=json&tenant=${encodeURIComponent(sessao.tenant)}` +
                  `&limit=50&query=${encodeURIComponent(artigo)}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": TS_UA_HEADER,
          Accept: "application/json, text/html, */*",
          Referer: sessao.showcase,
          "X-Requested-With": "XMLHttpRequest",
          Cookie: sessao.cookie
        }
      });
      if (res.status === 401 || res.status === 403) throw new Error("SESSAO_EXPIRADA");
      if (!res.ok) return [];

      let lista;
      try { lista = await res.json(); } catch (_) { return []; }
      if (!Array.isArray(lista)) return [];

      const artigoN = tsSolto(artigo);
      const corN    = tsSolto(cor);
      const vistos  = new Set();
      const casados = [];
      for (const p of lista) {
        const sku = tsSolto(p && p.sku);
        if (!sku.includes(artigoN)) continue;
        if (corN && !sku.includes(corN)) continue;
        const chave = tsChaveSemTamanho(String((p && p.sku) || ""));
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        casados.push(p);
      }
      return casados;
    }

    // Mesma escada de preferências do downloader.py, sem BeautifulSoup:
    // candidatas do CDN → exclui logos → prefere _FC (UA) → prefere a principal
    // da Olympikus (sem sufixo _A/_B antes do -500x500) → primeira candidata.
    async function tsUrlImagem(sessao, redirect, artigo) {
      const res = await fetch(TS_BASE + redirect, {
        headers: {
          "User-Agent": TS_UA_HEADER,
          Accept: "text/html,*/*",
          Referer: sessao.showcase,
          Cookie: sessao.cookie
        }
      });
      if (res.status === 401 || res.status === 403) throw new Error("SESSAO_EXPIRADA");
      if (!res.ok) return null;
      const html = await res.text();

      const todas = [...html.matchAll(/<img[^>]+src="([^"]*static\.tradesquash\.com[^"]*)"/gi)]
        .map(m => m[1]);
      const excluir = /(logo|lockup|tsq-logo|banner|powered|aws-logo)/i;
      const candidatas = todas.filter(src =>
        src && !excluir.test(src) && (!artigo || src.includes(artigo)));
      if (!candidatas.length) return null;

      const fc = candidatas.find(s => s.toUpperCase().includes("_FC"));
      if (fc) return fc;

      const principalOly = candidatas.find(src => {
        const nome = src.split("/").pop() || "";
        const m = nome.match(/^(.+?)-\d+x\d+\.[a-z]+$/i);
        return m ? !/_[A-Z]$/i.test(m[1]) : false;
      });
      return principalOly || candidatas[0];
    }

    // O Python usava MD5, mas a Web Crypto não oferece MD5 — para detectar
    // "duas cores com a mesma foto", qualquer hash serve.
    async function tsHash(buf) {
      const d = await crypto.subtle.digest("SHA-256", buf);
      return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
    }

    function tsBase64(buf) {
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      return btoa(bin);
    }

    // ── ROTEAMENTO ───────────────────────────────────────────────────────────

    try {

      // GET — retorna pedidos (array, mantém retrocompatibilidade)
      if (request.method === "GET") {
        const { content } = await getPedidos();
        return new Response(JSON.stringify(content || []), { status: 200, headers: corsHeaders });
      }

      // POST — novo pedido (público — vendedor cria pedidos sem login)
      if (request.method === "POST") {
        const body = await request.json();

        // Cadastro de prepostos (compartilhado com outra aplicacao que usa este worker).
        // Guarda numa lista propria (data/prepostos.json), NUNCA em pedidos.json.
        if (body && body.action === "getPrepostos") {
          const { content } = await getFile(GITHUB_PREPOSTOS);
          const lista = Array.isArray(content) ? content : (content && Array.isArray(content.data) ? content.data : []);
          return new Response(JSON.stringify(lista), { status: 200, headers: corsHeaders });
        }
        if (body && body.action === "savePrepostos" && Array.isArray(body.data)) {
          const { sha } = await getFile(GITHUB_PREPOSTOS);
          await saveFile(GITHUB_PREPOSTOS, body.data, sha, "update prepostos");
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        // Protecao: so grava se for REALMENTE um pedido (tem id e items).
        // Evita que chamadas como {action:"getPrepostos"} caiam no pedidos.json.
        if (!body || body.action || !body.id || !Array.isArray(body.items)) {
          return new Response(JSON.stringify({ success: false, error: "Payload nao e um pedido valido." }), { status: 400, headers: corsHeaders });
        }

        const { content, sha } = await getPedidos();
        const list = content || [];
        list.push({ ...body, createdAt: body.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
        await savePedidos(list, sha, "novo pedido");
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
      }

      // PUT — atualiza pedido existente (público — vendedor edita seus próprios pedidos)
      if (request.method === "PUT") {
        const body = await request.json();
        if (!body?.id) return new Response(JSON.stringify({ success: false, error: "ID não informado." }), { status: 400, headers: corsHeaders });
        const { content, sha } = await getPedidos();
        const list = content || [];
        const idx = list.findIndex(p => p.id === body.id);
        if (idx === -1) return new Response(JSON.stringify({ success: false, error: "Pedido não encontrado." }), { status: 404, headers: corsHeaders });
        list[idx] = { ...list[idx], ...body, updatedAt: new Date().toISOString() };
        await savePedidos(list, sha, "update pedido");
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
      }

      // DELETE — exclui pedido e limpa desmembramentos órfãos (público — vendedor cancela seus pedidos)
      if (request.method === "DELETE") {
        const body = await request.json();
        if (!body?.id) return new Response(JSON.stringify({ success: false, error: "ID não informado." }), { status: 400, headers: corsHeaders });

        // Remove o pedido
        const { content, sha } = await getPedidos();
        const list = (content || []).filter(p => p.id !== body.id);
        if (list.length === (content||[]).length) return new Response(JSON.stringify({ success: false, error: "Pedido não encontrado." }), { status: 404, headers: corsHeaders });
        await savePedidos(list, sha, "delete pedido");

        // Limpa entradas do desmembramentos que referenciam este pedido
        // Chave do desmembramento: "codigo|cor|prevFat" → { "orderId||gci||cor": status }
        try {
          const { content: desm, sha: desmSha } = await getFile(GITHUB_DESM);
          if (desm && typeof desm === 'object') {
            const desmLimpo = {};
            for (const [chave, lojas] of Object.entries(desm)) {
              const lojasFiltradas = {};
              for (const [lineKey, status] of Object.entries(lojas || {})) {
                // lineKey formato: "orderId||gci||cor" — remove se contém o id excluído
                if (!lineKey.startsWith(body.id + '||')) {
                  lojasFiltradas[lineKey] = status;
                }
              }
              // Só mantém a chave se ainda tem lojas
              if (Object.keys(lojasFiltradas).length > 0) {
                desmLimpo[chave] = lojasFiltradas;
              }
            }
            await saveFile(GITHUB_DESM, desmLimpo, desmSha, "limpar desmembramentos do pedido " + body.id);
          }
        } catch(_) { /* não bloqueia o delete se desmembramentos falhar */ }

        return new Response(JSON.stringify({ success: true, deletedId: body.id }), { status: 200, headers: corsHeaders });
      }

      // PATCH — salva/lê desmembramentos (arquivo separado)
      if (request.method === "PATCH") {
        const body = await request.json();

        // 🔒 Bloqueia writes sem token de admin (no-op para reads)
        const authFail = requireAdmin(body?.action);
        if (authFail) return authFail;

        // PATCH sem body ou com action:"get" → retorna desmembramentos
        if (!body || body.action === "get") {
          const { content } = await getFile(GITHUB_DESM);
          return new Response(JSON.stringify(content || {}), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"save" e data:{} → salva desmembramentos
        if (body.action === "save" && body.data) {
          const { content, sha } = await getFile(GITHUB_DESM);
          const merged = { ...(content || {}), ...body.data };
          await saveFile(GITHUB_DESM, merged, sha, "update desmembramentos");
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"getDispo" → retorna dispo.json
        if (body.action === "getDispo") {
          const { content } = await getFile(GITHUB_DISPO);
          return new Response(JSON.stringify(Array.isArray(content) ? content : []), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"saveDispo" e data:[] → salva dispo.json completo
        if (body.action === "saveDispo" && body.data !== undefined) {
          const { sha } = await getFile(GITHUB_DISPO);
          await saveFile(GITHUB_DISPO, Array.isArray(body.data) ? body.data : [], sha, "update dispo");
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"getStatus" → retorna status do app (manutenção). Público.
        if (body.action === "getStatus") {
          const { content } = await getFile(GITHUB_STATUS);
          const status = (content && typeof content === "object") ? content : { paused: false, message: "" };
          return new Response(JSON.stringify(status), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"saveStatus" → pausa/retoma o app (write, exige admin)
        if (body.action === "saveStatus" && body.data !== undefined) {
          const { sha } = await getFile(GITHUB_STATUS);
          const status = {
            paused: !!body.data.paused,
            message: String(body.data.message || ""),
            updatedAt: new Date().toISOString()
          };
          await saveFile(GITHUB_STATUS, status, sha, status.paused ? "app pausado (manutencao)" : "app retomado");
          return new Response(JSON.stringify({ success: true, status }), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"getRateio" → cotas por vendedor (objeto por Nº). Público.
        if (body.action === "getRateio") {
          const { content } = await getFile(GITHUB_RATEIO);
          const rateio = (content && typeof content === "object" && !Array.isArray(content)) ? content : {};
          return new Response(JSON.stringify(rateio), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"saveRateio" → grava cotas (write, exige admin)
        if (body.action === "saveRateio" && body.data !== undefined) {
          const { sha } = await getFile(GITHUB_RATEIO);
          const data = (body.data && typeof body.data === "object" && !Array.isArray(body.data)) ? body.data : {};
          await saveFile(GITHUB_RATEIO, data, sha, "update rateio");
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"getPrepostos" -> lista de prepostos (compartilhada)
        if (body.action === "getPrepostos") {
          const { content } = await getFile(GITHUB_PREPOSTOS);
          const lista = Array.isArray(content) ? content : (content && Array.isArray(content.data) ? content.data : []);
          return new Response(JSON.stringify(lista), { status: 200, headers: corsHeaders });
        }
        // PATCH com action:"savePrepostos" + data:[{codigo,nome}] -> grava a lista
        if (body.action === "savePrepostos" && Array.isArray(body.data)) {
          const { sha } = await getFile(GITHUB_PREPOSTOS);
          await saveFile(GITHUB_PREPOSTOS, body.data, sha, "update prepostos");
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"getProdutos" → retorna produtos.json
        if (body.action === "getProdutos") {
          const { content } = await getFile(GITHUB_PRODUTOS);
          return new Response(JSON.stringify(Array.isArray(content) ? content : []), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"saveProdutos" e data:[] → salva produtos.json completo
        if (body.action === "saveProdutos" && body.data !== undefined) {
          const { sha } = await getFile(GITHUB_PRODUTOS);
          await saveFile(GITHUB_PRODUTOS, Array.isArray(body.data) ? body.data : [], sha, "update produtos");
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        // ── CARTEIRA CMS ──────────────────────────────────────────────────
        // PATCH com action:"getCarteira" → retorna carteira-cms.json
        // Estrutura: { pedidos: [...], atualizadoEm: "ISO", importadoPor: "NOME" }
        if (body.action === "getCarteira") {
          const { content } = await getFile(GITHUB_CARTEIRA);
          const data = (content && typeof content === "object")
            ? content
            : { pedidos: [], atualizadoEm: null, importadoPor: null };
          return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"saveCarteira" e data:{pedidos:[], importadoPor:""} → salva carteira completa
        if (body.action === "saveCarteira" && body.data !== undefined) {
          const { sha } = await getFile(GITHUB_CARTEIRA);
          const payload = {
            pedidos: Array.isArray(body.data.pedidos) ? body.data.pedidos : [],
            atualizadoEm: new Date().toISOString(),
            importadoPor: String(body.data.importadoPor || "")
          };
          const msg = body.data.modo === "acoes"
            ? `update acoes carteira por ${payload.importadoPor || "?"}`
            : `update carteira (${payload.pedidos.length} pedidos) por ${payload.importadoPor || "?"}`;
          await saveFile(GITHUB_CARTEIRA, payload, sha, msg);
          return new Response(JSON.stringify({ success: true, atualizadoEm: payload.atualizadoEm }), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"getAcoesCarteira" → retorna { acoes: { chave: {acao, repasse} } }
        if (body.action === "getAcoesCarteira") {
          const { content } = await getFile(GITHUB_CARTEIRA_ACOES);
          const data = (content && typeof content === "object" && content.acoes) ? content : { acoes: {} };
          return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"saveAcaoCarteira" + itens:[{key, acao, repasse}] → upsert no arquivo pequeno
        if (body.action === "saveAcaoCarteira" && Array.isArray(body.itens)) {
          const { content, sha } = await getFile(GITHUB_CARTEIRA_ACOES);
          const mapa = (content && typeof content === "object" && content.acoes) ? content.acoes : {};
          for (const it of body.itens) {
            if (!it || !it.key) continue;
            // Grava SEMPRE (inclusive MANTER) — assim a reversão se propaga para os outros dispositivos
            mapa[it.key] = { acao: it.acao || "MANTER", repasse: it.repasse || null };
          }
          const payload = { acoes: mapa, atualizadoEm: new Date().toISOString(), por: String(body.por || "") };
          await saveFile(GITHUB_CARTEIRA_ACOES, payload, sha, `acoes carteira (${body.itens.length}) por ${payload.por || "?"}`);
          return new Response(JSON.stringify({ success: true, total: Object.keys(mapa).length }), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"getClientesCadastrados" → retorna { clientes: { cod: {...} } }
        if (body.action === "getClientesCadastrados") {
          const { content } = await getFile(GITHUB_CLIENTES);
          const data = (content && typeof content === "object" && content.clientes) ? content : { clientes: {} };
          return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"saveClientesCadastrados" + itens:[{codigo,razao,nomeFantasia,porta,remover?}] → upsert/remove
        if (body.action === "saveClientesCadastrados" && Array.isArray(body.itens)) {
          const { content, sha } = await getFile(GITHUB_CLIENTES);
          const mapa = (content && typeof content === "object" && content.clientes) ? content.clientes : {};
          for (const it of body.itens) {
            if (!it || !it.codigo) continue;
            if (it.remover) {
              delete mapa[String(it.codigo)];
            } else {
              mapa[String(it.codigo)] = {
                codigo: String(it.codigo),
                razao: it.razao || "",
                nomeFantasia: it.nomeFantasia || "",
                porta: it.porta || "",
              };
            }
          }
          const payload = { clientes: mapa, atualizadoEm: new Date().toISOString(), por: String(body.por || "") };
          await saveFile(GITHUB_CLIENTES, payload, sha, `clientes cadastrados (${body.itens.length}) por ${payload.por || "?"}`);
          return new Response(JSON.stringify({ success: true, total: Object.keys(mapa).length }), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"getFaturados" → retorna { faturados: { cod: { artigo: {...} } } }
        if (body.action === "getFaturados") {
          const { content } = await getFile(GITHUB_FATURADOS);
          const data = (content && typeof content === "object" && content.faturados) ? content : { faturados: {} };
          return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"saveFaturados" + faturados:{...} → salva o histórico completo (substitui)
        if (body.action === "saveFaturados" && body.faturados && typeof body.faturados === "object") {
          const { sha } = await getFile(GITHUB_FATURADOS);
          const payload = { faturados: body.faturados, atualizadoEm: new Date().toISOString(), por: String(body.por || "") };
          await saveFile(GITHUB_FATURADOS, payload, sha, `faturados (${Object.keys(body.faturados).length} clientes) por ${payload.por || "?"}`);
          return new Response(JSON.stringify({ success: true, clientes: Object.keys(body.faturados).length }), { status: 200, headers: corsHeaders });
        }
        if (body.action === "uploadImagem" && body.nome && body.base64) {
          const nome = body.nomeArquivo || body.nome; // nome final do arquivo ex: "43242437_PTO_PT.jpg"
          // Disponibilidades sempre guardou imagem no MESMO repositório dos dados
          // (env.GITHUB_REPO, ex: apps-oly), na pasta "Catalogo" — configuração original.
          const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/Catalogo/${nome}`;
          const existing = await fetch(url, { headers: githubHeaders });
          const sha = existing.ok ? (await existing.json()).sha : undefined;
          const uploadBody = {
            message: `disponibilidades: upload imagem — ${nome}`,
            content: body.base64,
            branch: env.GITHUB_BRANCH || "main"
          };
          if (sha) uploadBody.sha = sha;
          const res = await fetch(url, {
            method: "PUT",
            headers: { ...githubHeaders, "Content-Type": "application/json" },
            body: JSON.stringify(uploadBody)
          });
          if (!res.ok) throw new Error(`Upload imagem falhou (${res.status}) em ${url}: ${await res.text()}`);
          return new Response(JSON.stringify({ success: true, arquivo: nome }), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"getImagensHistorico" → retorna mapa artigo|cor → imagem
        if (body.action === "getImagensHistorico") {
          const { content } = await getFile(GITHUB_IMG_HIST);
          return new Response(JSON.stringify(content && typeof content === 'object' ? content : {}), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"saveImagensHistorico" e data:{} → salva mapa imagens
        if (body.action === "saveImagensHistorico" && body.data !== undefined) {
          const { content, sha } = await getFile(GITHUB_IMG_HIST);
          const merged = { ...(content || {}), ...body.data };
          await saveFile(GITHUB_IMG_HIST, merged, sha, "update historico imagens disponibilidades");
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"getDisponibilidades" → retorna disponibilidades.json
        if (body.action === "getDisponibilidades") {
          const { content } = await getFile(GITHUB_DISPONIB);
          return new Response(JSON.stringify(Array.isArray(content) ? content : []), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"saveDisponibilidades" e data:[] → salva disponibilidades.json completo
        if (body.action === "saveDisponibilidades" && body.data !== undefined) {
          const { sha } = await getFile(GITHUB_DISPONIB);
          await saveFile(GITHUB_DISPONIB, Array.isArray(body.data) ? body.data : [], sha, "update disponibilidades");
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"getOcultosDisp" → retorna ocultos_disponibilidades.json
        if (body.action === "getOcultosDisp") {
          const { content } = await getFile(GITHUB_OCULTOS_DISP);
          return new Response(JSON.stringify(Array.isArray(content) ? content : []), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"saveOcultosDisp" e data:[] → salva ocultos_disponibilidades.json
        if (body.action === "saveOcultosDisp" && body.data !== undefined) {
          const { sha } = await getFile(GITHUB_OCULTOS_DISP);
          await saveFile(GITHUB_OCULTOS_DISP, Array.isArray(body.data) ? body.data : [], sha, "update ocultos disponibilidades");
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        // ── EXCLUSIVOS DE CANAL (DTC / ML) ────────────────────────────────
        // getExclusivos → mapa { "ARTIGO|COR": "DTC"|"ML"|"DTC+ML" }. Público:
        // a vitrine e o admin precisam ler para não exibir esses produtos.
        if (body.action === "getExclusivos") {
          const { content } = await getFile(GITHUB_EXCLUSIVOS);
          const mapa = (content && typeof content === "object" && !Array.isArray(content)) ? content : {};
          return new Response(JSON.stringify(mapa), { status: 200, headers: corsHeaders });
        }

        // saveExclusivos → grava o mapa COMPLETO (write, exige admin).
        // Substitui em vez de mesclar: é assim que a remoção funciona — o admin
        // manda a lista final, e o que não está nela deixa de ser exclusivo.
        if (body.action === "saveExclusivos" && body.data !== undefined) {
          const entrada = (body.data && typeof body.data === "object" && !Array.isArray(body.data)) ? body.data : {};
          const canaisOk = new Set(["DTC", "ML", "DTC+ML"]);
          const limpo = {};
          for (const [chave, canal] of Object.entries(entrada)) {
            // chave precisa ser "ARTIGO|COR" e o canal precisa ser conhecido,
            // senão um erro no front viraria lixo permanente no arquivo
            if (!/^[^|]+\|[^|]+$/.test(String(chave))) continue;
            const c = String(canal || "").toUpperCase().trim();
            if (!canaisOk.has(c)) continue;
            limpo[String(chave).toUpperCase()] = c;
          }
          const { sha } = await getFile(GITHUB_EXCLUSIVOS);
          await saveFile(GITHUB_EXCLUSIVOS, limpo, sha, `exclusivos de canal (${Object.keys(limpo).length})`);
          return new Response(JSON.stringify({ success: true, total: Object.keys(limpo).length }),
            { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"getTabelaEspecial" → retorna tabela_especial.json
        if (body.action === "getTabelaEspecial") {
          const { content } = await getFile(GITHUB_TABELA_ESP);
          return new Response(JSON.stringify(content && typeof content === "object" ? content : {}), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"saveTabelaEspecial" e data:{} → salva tabela_especial.json
        if (body.action === "saveTabelaEspecial" && body.data !== undefined) {
          const { sha } = await getFile(GITHUB_TABELA_ESP);
          await saveFile(GITHUB_TABELA_ESP, (body.data && typeof body.data === "object") ? body.data : {}, sha, "update tabela especial");
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        // ─────────────────────────────────────────────────────────────────────
        // VITRINE COMPARTILHADA — links vendedor↔cliente
        // Estrutura de cada link em links_compartilhados.json:
        //   { codigo: { vendedor, vendedorNome, cliente, marca, produtos:[],
        //               criadoEm, expiraEm, status, resposta:{}, respondidoEm } }
        // Estas actions NÃO entram em WRITE_ACTIONS: o cliente precisa gravar
        // sua resposta sem token (igual savePedidoHistorico dos vendedores).
        // ─────────────────────────────────────────────────────────────────────
        const VL_48H = 48 * 60 * 60 * 1000;
        function gerarCodigoLink() {
          const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
          let s = "";
          for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
          return s;
        }

        // criarLink — vendedor gera um link com produtos selecionados
        if (body.action === "criarLink" && body.data) {
          const { content } = await getFile(GITHUB_LINKS);
          const links = (content && typeof content === "object") ? content : {};
          let codigo = gerarCodigoLink();
          let guard = 0;
          while (links[codigo] && guard < 20) { codigo = gerarCodigoLink(); guard++; }
          const agora = Date.now();
          links[codigo] = {
            vendedor:     String(body.data.vendedor || ""),
            vendedorNome: String(body.data.vendedorNome || ""),
            cliente:      String(body.data.cliente || ""),
            marca:        String(body.data.marca || ""),
            produtos:     Array.isArray(body.data.produtos) ? body.data.produtos : [],
            criadoEm:     agora,
            expiraEm:     agora + VL_48H,
            status:       "aguardando",
            resposta:     null,
            respondidoEm: null
          };
          const { sha } = await getFile(GITHUB_LINKS);
          await saveFile(GITHUB_LINKS, links, sha, "novo link compartilhado");
          return new Response(JSON.stringify({ success: true, codigo }), { status: 200, headers: corsHeaders });
        }

        // getLink — cliente carrega os produtos de um link
        if (body.action === "getLink" && body.codigo) {
          const { content } = await getFile(GITHUB_LINKS);
          const links = (content && typeof content === "object") ? content : {};
          const link = links[body.codigo];
          if (!link) {
            return new Response(JSON.stringify({ success: false, erro: "nao_encontrado" }), { status: 200, headers: corsHeaders });
          }
          const expirado = Date.now() > Number(link.expiraEm || 0);
          return new Response(JSON.stringify({ success: true, link, expirado }), { status: 200, headers: corsHeaders });
        }

        // salvarResposta — cliente grava sua seleção (pode reenviar)
        if (body.action === "salvarResposta" && body.codigo && body.data) {
          const { content } = await getFile(GITHUB_LINKS);
          const links = (content && typeof content === "object") ? content : {};
          const link = links[body.codigo];
          if (!link) {
            return new Response(JSON.stringify({ success: false, erro: "nao_encontrado" }), { status: 200, headers: corsHeaders });
          }
          if (Date.now() > Number(link.expiraEm || 0)) {
            return new Response(JSON.stringify({ success: false, erro: "expirado" }), { status: 200, headers: corsHeaders });
          }
          link.resposta     = body.data.resposta || {};
          link.respondidoEm = Date.now();
          link.status       = "respondido";
          const { sha } = await getFile(GITHUB_LINKS);
          await saveFile(GITHUB_LINKS, links, sha, "resposta do cliente");
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        // getLinksVendedor — lista os links de um vendedor (por código)
        if (body.action === "getLinksVendedor" && body.vendedor) {
          const { content } = await getFile(GITHUB_LINKS);
          const links = (content && typeof content === "object") ? content : {};
          const agora = Date.now();
          const meus = [];
          for (const [codigo, l] of Object.entries(links)) {
            if (String(l.vendedor) !== String(body.vendedor)) continue;
            meus.push({
              codigo,
              cliente:      l.cliente,
              marca:        l.marca,
              qtdProdutos:  Array.isArray(l.produtos) ? l.produtos.length : 0,
              criadoEm:     l.criadoEm,
              expiraEm:     l.expiraEm,
              expirado:     agora > Number(l.expiraEm || 0),
              status:       l.status,
              respondidoEm: l.respondidoEm,
              concluidoEm:  l.concluidoEm || null,
              qtdResposta:  (l.resposta && l.resposta.itens) ? l.resposta.itens.length : 0
            });
          }
          meus.sort((a, b) => Number(b.criadoEm) - Number(a.criadoEm));
          return new Response(JSON.stringify({ success: true, links: meus }), { status: 200, headers: corsHeaders });
        }

        // getLinkCompleto — vendedor abre 1 link com a resposta completa
        if (body.action === "getLinkCompleto" && body.codigo) {
          const { content } = await getFile(GITHUB_LINKS);
          const links = (content && typeof content === "object") ? content : {};
          const link = links[body.codigo];
          if (!link) {
            return new Response(JSON.stringify({ success: false, erro: "nao_encontrado" }), { status: 200, headers: corsHeaders });
          }
          return new Response(JSON.stringify({ success: true, link }), { status: 200, headers: corsHeaders });
        }

        // reativarLink — vendedor dá +48h num link expirado
        if (body.action === "reativarLink" && body.codigo) {
          const { content } = await getFile(GITHUB_LINKS);
          const links = (content && typeof content === "object") ? content : {};
          const link = links[body.codigo];
          if (!link) {
            return new Response(JSON.stringify({ success: false, erro: "nao_encontrado" }), { status: 200, headers: corsHeaders });
          }
          link.expiraEm = Date.now() + VL_48H;
          if (link.status === "expirado") link.status = "aguardando";
          const { sha } = await getFile(GITHUB_LINKS);
          await saveFile(GITHUB_LINKS, links, sha, "reativar link +48h");
          return new Response(JSON.stringify({ success: true, expiraEm: link.expiraEm }), { status: 200, headers: corsHeaders });
        }

        // apagarLinks — apaga 1 ou mais links pelo código
        if (body.action === "apagarLinks" && Array.isArray(body.codigos)) {
          const { content, sha } = await getFile(GITHUB_LINKS);
          const links = (content && typeof content === "object") ? content : {};
          let apagados = 0;
          for (const cod of body.codigos) {
            if (links[cod]) { delete links[cod]; apagados++; }
          }
          await saveFile(GITHUB_LINKS, links, sha, `apagar ${apagados} link(s)`);
          return new Response(JSON.stringify({ success: true, apagados }), { status: 200, headers: corsHeaders });
        }

        // marcarLinkConcluido — vendedor marca como pedido gerado (status: concluido)
        if (body.action === "marcarLinkConcluido" && body.codigo) {
          const { content, sha } = await getFile(GITHUB_LINKS);
          const links = (content && typeof content === "object") ? content : {};
          const link = links[body.codigo];
          if (!link) {
            return new Response(JSON.stringify({ success: false, erro: "nao_encontrado" }), { status: 200, headers: corsHeaders });
          }
          link.status = "concluido";
          link.concluidoEm = Date.now();
          await saveFile(GITHUB_LINKS, links, sha, "marcar link como concluido");
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        // ── CLIENTES (consulta por vendedor) ────────────────────────────────
        // getClientes — retorna { vendedor, clientes:[] } de 1 vendedor
        if (body.action === "getClientes" && body.vendedor) {
          const codVend = String(body.vendedor).replace(/[^\w-]/g, "");
          const url = `${GITHUB_CLIENTES_BASE}/${codVend}.json`;
          try {
            const { content } = await getFile(url);
            return new Response(JSON.stringify({
              success: true,
              vendedor: codVend,
              clientes: Array.isArray(content) ? content : (content?.clientes || [])
            }), { status: 200, headers: corsHeaders });
          } catch (e) {
            return new Response(JSON.stringify({ success: true, vendedor: codVend, clientes: [] }), { status: 200, headers: corsHeaders });
          }
        }

        // saveClientes — admin sobe lista de clientes do vendedor
        // Espera: { action:"saveClientes", vendedor:"114611", data:[...] }
        if (body.action === "saveClientes" && body.vendedor && Array.isArray(body.data)) {
          const codVend = String(body.vendedor).replace(/[^\w-]/g, "");
          const url = `${GITHUB_CLIENTES_BASE}/${codVend}.json`;
          let sha = null;
          try { ({ sha } = await getFile(url)); } catch (_) { /* arquivo novo */ }
          await saveFile(url, body.data, sha, `clientes ${codVend} (${body.data.length})`);
          return new Response(JSON.stringify({ success: true, total: body.data.length }), { status: 200, headers: corsHeaders });
        }

        // listClientesVendedores — lista códigos de vendedores com base salva
        if (body.action === "listClientesVendedores") {
          try {
            const r = await fetch(GITHUB_CLIENTES_BASE, { headers: githubHeaders });
            if (!r.ok) {
              return new Response(JSON.stringify({ success: true, vendedores: [] }), { status: 200, headers: corsHeaders });
            }
            const arr = await r.json();
            const vendedores = (Array.isArray(arr) ? arr : [])
              .filter(f => f.name && f.name.endsWith(".json"))
              .map(f => ({ codigo: f.name.replace(/\.json$/, ""), size: f.size }));
            return new Response(JSON.stringify({ success: true, vendedores }), { status: 200, headers: corsHeaders });
          } catch (e) {
            return new Response(JSON.stringify({ success: true, vendedores: [] }), { status: 200, headers: corsHeaders });
          }
        }

        // ── DESEJOS (watchlist de produtos por vendedor) ────────────────────
        // getDesejos — retorna lista de chaves favoritadas do vendedor
        if (body.action === "getDesejos" && body.vendedor) {
          const codVend = String(body.vendedor).replace(/[^\w-]/g, "");
          const url = `${GITHUB_DESEJOS_BASE}/${codVend}.json`;
          try {
            const { content } = await getFile(url);
            return new Response(JSON.stringify({
              success: true,
              vendedor: codVend,
              desejos: Array.isArray(content) ? content : (content?.desejos || [])
            }), { status: 200, headers: corsHeaders });
          } catch (e) {
            return new Response(JSON.stringify({ success: true, vendedor: codVend, desejos: [] }), { status: 200, headers: corsHeaders });
          }
        }

        // saveDesejos — vendedor salva sua lista de favoritos (sem token, vendedor identifica via UI)
        // Espera: { action:"saveDesejos", vendedor:"114611", data:["ARTIGO|COR", ...] }
        if (body.action === "saveDesejos" && body.vendedor && Array.isArray(body.data)) {
          const codVend = String(body.vendedor).replace(/[^\w-]/g, "");
          // Limita: máx 100 desejos por vendedor + chave válida
          const limpa = body.data
            .filter(k => typeof k === "string" && /^[\w-]+\|[\w-]+$/.test(k))
            .slice(0, 100);
          const url = `${GITHUB_DESEJOS_BASE}/${codVend}.json`;
          let sha = null;
          try { ({ sha } = await getFile(url)); } catch (_) { /* novo */ }
          await saveFile(url, limpa, sha, `desejos ${codVend} (${limpa.length})`);
          return new Response(JSON.stringify({ success: true, total: limpa.length }), { status: 200, headers: corsHeaders });
        }

        // ── STATUS DA VITRINE (pausada / ativa) ─────────────────────────────
        // getStatusVitrine — público (vitrine consulta a cada carregamento)
        if (body.action === "getStatusVitrine") {
          try {
            const { content } = await getFile(GITHUB_VITRINE_STATUS);
            const pausada = !!(content && content.pausada);
            return new Response(JSON.stringify({
              success: true,
              pausada,
              pausadoEm: content?.pausadoEm || null,
              motivo: content?.motivo || ''
            }), { status: 200, headers: corsHeaders });
          } catch (e) {
            return new Response(JSON.stringify({ success: true, pausada: false }), { status: 200, headers: corsHeaders });
          }
        }

        // setStatusVitrine — admin pausa/despausa
        // Espera: { action:"setStatusVitrine", pausada:true|false, motivo:"opcional" }
        if (body.action === "setStatusVitrine" && typeof body.pausada === "boolean") {
          let sha = null;
          try { ({ sha } = await getFile(GITHUB_VITRINE_STATUS)); } catch (_) { /* arquivo novo */ }
          const novo = {
            pausada: body.pausada,
            pausadoEm: body.pausada ? Date.now() : null,
            motivo: String(body.motivo || '')
          };
          await saveFile(GITHUB_VITRINE_STATUS, novo, sha, body.pausada ? "vitrine pausada" : "vitrine ativada");
          return new Response(JSON.stringify({ success: true, ...novo }), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"getOcultos" → retorna lista de ocultos
        if (body.action === "getOcultos") {
          const { content } = await getFile(GITHUB_OCULTOS);
          return new Response(JSON.stringify(Array.isArray(content) ? content : []), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"saveOcultos" e data:[] → salva lista de ocultos
        if (body.action === "saveOcultos" && body.data !== undefined) {
          const { sha } = await getFile(GITHUB_OCULTOS);
          await saveFile(GITHUB_OCULTOS, Array.isArray(body.data) ? body.data : [], sha, "update ocultos");
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"getPedidoHistorico" e comissionista → retorna array de pedidos
        if (body.action === "getPedidoHistorico" && body.comissionista) {
          const safeId = String(body.comissionista).replace(/[^a-zA-Z0-9_-]/g, "");
          if (!safeId) return new Response(JSON.stringify([]), { status: 200, headers: corsHeaders });
          const url = `${GITHUB_CAT_HIST_BASE}/${safeId}.json`;
          try {
            const { content } = await getFile(url);
            return new Response(JSON.stringify(Array.isArray(content) ? content : []), { status: 200, headers: corsHeaders });
          } catch (_) {
            // Arquivo ainda não existe — retorna lista vazia
            return new Response(JSON.stringify([]), { status: 200, headers: corsHeaders });
          }
        }

        // PATCH com action:"savePedidoHistorico" + comissionista + pedido → adiciona ao histórico
        if (body.action === "savePedidoHistorico" && body.comissionista && body.pedido) {
          const safeId = String(body.comissionista).replace(/[^a-zA-Z0-9_-]/g, "");
          if (!safeId) {
            return new Response(JSON.stringify({ success: false, error: "Comissionista inválido" }), { status: 400, headers: corsHeaders });
          }
          const url = `${GITHUB_CAT_HIST_BASE}/${safeId}.json`;
          let lista = [];
          let sha = null;
          let arquivoExiste = false;
          // Tenta ler o arquivo atual.
          try {
            const r = await getFile(url);
            if (r.sha) {
              // Arquivo EXISTE
              arquivoExiste = true;
              sha = r.sha;
              lista = Array.isArray(r.content) ? r.content : [];
            }
            // r.sha null = arquivo realmente não existe (404) → primeiro pedido, lista vazia ok
          } catch (err) {
            // ⚠️ A leitura FALHOU mas o arquivo pode existir.
            // NUNCA sobrescrever com lista vazia — isso apagaria todo o histórico.
            // Aborta o save e devolve erro pro app tentar de novo.
            return new Response(JSON.stringify({
              success: false,
              error: "Não foi possível ler o histórico atual. Pedido NÃO salvo (proteção contra perda de dados). Tente novamente.",
              detail: String(err && err.message || err)
            }), { status: 503, headers: corsHeaders });
          }
          // Backup ANTES de sobrescrever (snapshot do dia)
          if (arquivoExiste && lista.length > 0) {
            try {
              const backupUrl = `${GITHUB_CAT_HIST_BASE.replace('/contents/data/', '/contents/data/backups/')}/${safeId}_backup_${new Date().toISOString().slice(0,10)}.json`;
              const existingBk = await fetch(backupUrl, { headers: githubHeaders });
              if (existingBk.status === 404) {
                // Cria backup do dia (1x por dia por comissionista)
                const bkContent = btoa(unescape(encodeURIComponent(JSON.stringify(lista))));
                await fetch(backupUrl, {
                  method: "PUT",
                  headers: { ...githubHeaders, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    message: `backup historico - ${safeId}`,
                    content: bkContent,
                    branch: env.GITHUB_BRANCH
                  })
                });
              }
            } catch (_) { /* backup não bloqueia o save principal */ }
          }
          // Adiciona o pedido novo no topo
          lista.unshift(body.pedido);
          // Limita a 1000 pedidos por comissionista (evita arquivo gigante)
          if (lista.length > 1000) lista = lista.slice(0, 1000);
          await saveFile(url, lista, sha, `historico catalogo - ${safeId}`);
          return new Response(JSON.stringify({ success: true, total: lista.length }), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"clearPedidosHistorico" + comissionista → apaga todos os pedidos finalizados
        // Exige X-Admin-Token (validado no início pra ações de escrita).
        // Faz backup manual antes de sobrescrever (histórico não está na lista de arquivos com backup automático).
        if (body.action === "clearPedidosHistorico" && body.comissionista) {
          const safeId = String(body.comissionista).replace(/[^a-zA-Z0-9_-]/g, "");
          if (!safeId) {
            return new Response(JSON.stringify({ success: false, error: "Comissionista inválido" }), { status: 400, headers: corsHeaders });
          }
          const url = `${GITHUB_CAT_HIST_BASE}/${safeId}.json`;
          let sha = null;
          let listaAtual = [];
          try {
            const r = await getFile(url);
            sha = r.sha || null;
            listaAtual = Array.isArray(r.content) ? r.content : [];
          } catch (_) {
            // Arquivo já não existe — nada a limpar
            return new Response(JSON.stringify({ success: true, cleared: 0, message: "Sem histórico para limpar" }), { status: 200, headers: corsHeaders });
          }
          if (!sha || listaAtual.length === 0) {
            return new Response(JSON.stringify({ success: true, cleared: 0, message: "Sem histórico para limpar" }), { status: 200, headers: corsHeaders });
          }
          const totalAntes = listaAtual.length;
          // Backup manual: salva snapshot antes de limpar (independente do backup diário).
          // Nome do backup carrega data + hora + total pra facilitar rastreio.
          try {
            const now = new Date();
            const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
            const backupUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/backups/catalogo-historico/${safeId}_pre-clear_${stamp}_${totalAntes}itens.json`;
            await saveFile(backupUrl, listaAtual, null, `backup pre-clear historico ${safeId} (${totalAntes} pedidos)`);
          } catch (bkErr) {
            // Se o backup falhar, NÃO limpa (segurança).
            return new Response(JSON.stringify({
              success: false,
              error: "Falha ao criar backup antes de limpar. Nada foi apagado.",
              detail: String(bkErr && bkErr.message || bkErr)
            }), { status: 500, headers: corsHeaders });
          }
          // Só depois do backup confirmado é que limpa o arquivo original (sobrescreve com []).
          await saveFile(url, [], sha, `clear historico catalogo - ${safeId} (${totalAntes} pedidos removidos)`);
          return new Response(JSON.stringify({ success: true, cleared: totalAntes }), { status: 200, headers: corsHeaders });
        }

        // ── RASCUNHOS DE PEDIDO ──────────────────────────────────────────
        // getRascunhos + comissionista → retorna array de rascunhos
        if (body.action === "getRascunhos" && body.comissionista) {
          const safeId = String(body.comissionista).replace(/[^a-zA-Z0-9_-]/g, "");
          if (!safeId) return new Response(JSON.stringify([]), { status: 200, headers: corsHeaders });
          const url = `${GITHUB_CAT_RASC_BASE}/${safeId}.json`;
          try {
            const { content } = await getFile(url);
            return new Response(JSON.stringify(Array.isArray(content) ? content : []), { status: 200, headers: corsHeaders });
          } catch (err) {
            // Erro de leitura — NÃO devolve vazio como se não houvesse rascunho
            return new Response(JSON.stringify({ success: false, error: "Falha ao ler rascunhos. Tente novamente." }), { status: 503, headers: corsHeaders });
          }
        }

        // saveRascunho + comissionista + rascunho → cria OU atualiza (por id)
        if (body.action === "saveRascunho" && body.comissionista && body.rascunho) {
          const safeId = String(body.comissionista).replace(/[^a-zA-Z0-9_-]/g, "");
          if (!safeId) {
            return new Response(JSON.stringify({ success: false, error: "Comissionista inválido" }), { status: 400, headers: corsHeaders });
          }
          const url = `${GITHUB_CAT_RASC_BASE}/${safeId}.json`;
          let lista = [];
          let sha = null;
          let arquivoExiste = false;
          try {
            const r = await getFile(url);
            if (r.sha) {
              arquivoExiste = true;
              sha = r.sha;
              lista = Array.isArray(r.content) ? r.content : [];
            }
          } catch (err) {
            // Proteção: não sobrescrever com lista vazia se a leitura falhar
            return new Response(JSON.stringify({
              success: false,
              error: "Não foi possível ler os rascunhos atuais. Rascunho NÃO salvo. Tente novamente.",
              detail: String(err && err.message || err)
            }), { status: 503, headers: corsHeaders });
          }
          // Atualiza se já existe (mesmo id), senão adiciona no topo
          const rid = String(body.rascunho.id || "");
          const idx = lista.findIndex(x => String(x.id) === rid);
          if (idx >= 0) {
            lista[idx] = body.rascunho;
          } else {
            lista.unshift(body.rascunho);
          }
          if (lista.length > 200) lista = lista.slice(0, 200);
          await saveFile(url, lista, sha, `rascunhos catalogo - ${safeId}`);
          return new Response(JSON.stringify({ success: true, total: lista.length }), { status: 200, headers: corsHeaders });
        }

        // deleteRascunho + comissionista + id → remove um rascunho
        if (body.action === "deleteRascunho" && body.comissionista && body.id) {
          const safeId = String(body.comissionista).replace(/[^a-zA-Z0-9_-]/g, "");
          if (!safeId) {
            return new Response(JSON.stringify({ success: false, error: "Comissionista inválido" }), { status: 400, headers: corsHeaders });
          }
          const url = `${GITHUB_CAT_RASC_BASE}/${safeId}.json`;
          let lista = [];
          let sha = null;
          try {
            const r = await getFile(url);
            if (!r.sha) {
              // Arquivo não existe — nada a apagar
              return new Response(JSON.stringify({ success: true, total: 0 }), { status: 200, headers: corsHeaders });
            }
            sha = r.sha;
            lista = Array.isArray(r.content) ? r.content : [];
          } catch (err) {
            return new Response(JSON.stringify({
              success: false,
              error: "Não foi possível ler os rascunhos. Exclusão não realizada.",
              detail: String(err && err.message || err)
            }), { status: 503, headers: corsHeaders });
          }
          const rid = String(body.id);
          const nova = lista.filter(x => String(x.id) !== rid);
          await saveFile(url, nova, sha, `rascunhos catalogo - ${safeId} (remover)`);
          return new Response(JSON.stringify({ success: true, total: nova.length }), { status: 200, headers: corsHeaders });
        }

        // PATCH com action:"saveCategoryImage" + categoria + base64 → upload imagem categoria
        if (body.action === "saveCategoryImage" && body.categoria && body.base64) {
          // Sanitiza nome: aceita apenas letras, números e &
          const safeCat = String(body.categoria).replace(/[^a-zA-Z0-9&]/g, "");
          if(!safeCat){
            return new Response(JSON.stringify({ success: false, error: "Categoria inválida" }), { status: 400, headers: corsHeaders });
          }
          // Marca: "ua" salva em subpasta; demais (oly/ausente) na raiz de categorias
          const marca = String(body.marca || "oly").toLowerCase();
          const subPasta = (marca === "ua") ? "/ua" : "";
          // Sempre salva como PNG (front-end converte antes)
          const url = `${GITHUB_CAT_IMG_BASE}${subPasta}/${safeCat}.png`;
          // Verifica se já existe (pra obter o sha)
          const existing = await fetch(url, { headers: githubHeaders });
          const sha = existing.ok ? (await existing.json()).sha : undefined;
          const uploadBody = {
            message: `imagem categoria: ${safeCat}`,
            content: body.base64,
            branch: env.GITHUB_BRANCH
          };
          if(sha) uploadBody.sha = sha;
          const res = await fetch(url, {
            method: "PUT",
            headers: { ...githubHeaders, "Content-Type": "application/json" },
            body: JSON.stringify(uploadBody)
          });
          if(!res.ok) throw new Error(`Upload categoria falhou (${res.status}): ${await res.text()}`);
          return new Response(JSON.stringify({ success: true, categoria: safeCat }), { status: 200, headers: corsHeaders });
        }


        // PATCH action:"getPerformance" → retorna a planilha (base64). Público (leitura).
        if (body.action === "getPerformance") {
          try {
            const { content } = await getFile(GITHUB_PERFORMANCE);
            const data = (content && typeof content === "object") ? content : { name: "", b64: "" };
            return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
          } catch (_) {
            return new Response(JSON.stringify({ name: "", b64: "" }), { status: 200, headers: corsHeaders });
          }
        }

        // PATCH action:"savePerformance" + data:{key,ano,sem,name,b64} → grava 1 período (sem senha)
        if (body.action === "savePerformance" && body.data && body.data.b64) {
          const { content, sha } = await getFile(GITHUB_PERFORMANCE);
          let periods = {};
          if (content && typeof content === "object") {
            if (content.periods && typeof content.periods === "object") {
              periods = content.periods;
            } else if (content.b64) {
              const lk = (content.ano ? String(content.ano) : "2025") + "-ALL";
              periods[lk] = { ano: String(content.ano || "2025"), sem: "ALL", name: content.name || "planilha.xlsx", b64: content.b64, updatedAt: content.updatedAt || new Date().toISOString() };
            }
          }
          const ano = String(body.data.ano || "");
          const sem = ["ALL", "S1", "S2"].includes(body.data.sem) ? body.data.sem : "ALL";
          const key = String(body.data.key || (ano + "-" + sem));
          periods[key] = { ano, sem, name: String(body.data.name || "planilha.xlsx"), b64: String(body.data.b64), updatedAt: new Date().toISOString() };
          await saveFile(GITHUB_PERFORMANCE, { periods }, sha, "update performance " + key);
          return new Response(JSON.stringify({ success: true, key }), { status: 200, headers: corsHeaders });
        }

        // PATCH action:"getRfv" → retorna os dados publicados do RFV. Público (leitura).
        if (body.action === "getRfv") {
          try {
            const { content } = await getFile(GITHUB_RFV);
            const data = (content && typeof content === "object") ? content : {};
            return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
          } catch (_) {
            return new Response(JSON.stringify({}), { status: 200, headers: corsHeaders });
          }
        }

        // PATCH action:"saveRfv" + data:{...} → grava os dados do RFV (sem senha, como o performance).
        // O objeto 'data' é gravado como está (o front decide o formato: arquivos crus, dataset processado, etc.)
        if (body.action === "saveRfv" && body.data && typeof body.data === "object") {
          const { sha } = await getFile(GITHUB_RFV);
          const payload = { ...body.data, updatedAt: new Date().toISOString() };
          await saveFile(GITHUB_RFV, payload, sha, "update rfv");
          return new Response(JSON.stringify({ success: true, updatedAt: payload.updatedAt }), { status: 200, headers: corsHeaders });
        }
        // ── ESTOQUE VIRTUAL · MATRIZ ESPORTES ──────────────────────────────────

        // PATCH action:"getMatrizEstoque" → retorna lojas + pendentes. Público (leitura).
        if (body.action === "getMatrizEstoque") {
          const { content } = await getFile(GITHUB_MATRIZ);
          const data = (content && typeof content === "object") ? content : { lojas: [], pendentes: [] };
          return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: corsHeaders });
        }

        // PATCH action:"saveMatrizLoja" + token + marcas:{...} → a própria loja salva o estoque/venda
        // dos itens já cadastrados. Aberto (o token na URL já identifica a loja).
        if (body.action === "saveMatrizLoja" && body.token && body.marcas && typeof body.marcas === "object") {
          const { content, sha } = await getFile(GITHUB_MATRIZ);
          const data = (content && typeof content === "object") ? content : { lojas: [], pendentes: [] };
          const loja = (data.lojas || []).find(l => l.token === body.token);
          if (!loja) return new Response(JSON.stringify({ success: false, error: "Loja não encontrada." }), { status: 404, headers: corsHeaders });
          loja.marcas = body.marcas;
          loja.ultimaAtualizacaoLoja = new Date().toISOString();
          await saveFile(GITHUB_MATRIZ, data, sha, `matriz: estoque atualizado — ${loja.nome}`);
          return new Response(JSON.stringify({ success: true, updatedAt: loja.ultimaAtualizacaoLoja }), { status: 200, headers: corsHeaders });
        }

        // PATCH action:"addMatrizPendente" + token + artigo/descricao/cor → loja reporta produto fora
        // da lista cadastrada. Fica pendente até o admin cadastrar corretamente. Aberto.
        if (body.action === "addMatrizPendente" && body.token) {
          const { content, sha } = await getFile(GITHUB_MATRIZ);
          const data = (content && typeof content === "object") ? content : { lojas: [], pendentes: [] };
          const loja = (data.lojas || []).find(l => l.token === body.token);
          if (!loja) return new Response(JSON.stringify({ success: false, error: "Loja não encontrada." }), { status: 404, headers: corsHeaders });
          const pendente = {
            id: `pend_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            tipo: "novo",
            lojaCodigo: loja.codigo,
            lojaNome: loja.nome,
            marca: String(body.marca || ""),
            artigo: String(body.artigo || ""),
            descricao: String(body.descricao || ""),
            cor: String(body.cor || ""),
            estoqueAtual: Number(body.estoqueAtual) || 0,
            venda: Number(body.venda) || 0,
            status: "pendente",
            criadoEm: new Date().toISOString()
          };
          data.pendentes = data.pendentes || [];
          data.pendentes.push(pendente);
          await saveFile(GITHUB_MATRIZ, data, sha, `matriz: pendente — ${loja.nome} — ${pendente.artigo}/${pendente.cor}`);
          return new Response(JSON.stringify({ success: true, id: pendente.id }), { status: 200, headers: corsHeaders });
        }

        // PATCH action:"flagMatrizRemocao" + token + marca + itemId → loja sinaliza que um produto
        // já cadastrado NÃO existe na loja. Fica pendente até o admin excluir do catálogo. Aberto.
        if (body.action === "flagMatrizRemocao" && body.token && body.marca && body.itemId) {
          const { content, sha } = await getFile(GITHUB_MATRIZ);
          const data = (content && typeof content === "object") ? content : { lojas: [], pendentes: [] };
          const loja = (data.lojas || []).find(l => l.token === body.token);
          if (!loja) return new Response(JSON.stringify({ success: false, error: "Loja não encontrada." }), { status: 404, headers: corsHeaders });
          const item = (loja.marcas[body.marca] || []).find(i => i.id === body.itemId);
          if (!item) return new Response(JSON.stringify({ success: false, error: "Item não encontrado." }), { status: 404, headers: corsHeaders });
          // Evita duplicar sinalização do mesmo item
          const jaSinalizado = (data.pendentes || []).some(p => p.tipo === "remocao" && p.itemId === body.itemId && p.lojaCodigo === loja.codigo && p.status === "pendente");
          if (jaSinalizado) return new Response(JSON.stringify({ success: true, duplicate: true }), { status: 200, headers: corsHeaders });
          const pendente = {
            id: `pend_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            tipo: "remocao",
            lojaCodigo: loja.codigo,
            lojaNome: loja.nome,
            marca: String(body.marca),
            itemId: String(body.itemId),
            artigo: item.artigo,
            descricao: item.descricao,
            cor: item.cor,
            status: "pendente",
            criadoEm: new Date().toISOString()
          };
          data.pendentes = data.pendentes || [];
          data.pendentes.push(pendente);
          await saveFile(GITHUB_MATRIZ, data, sha, `matriz: sinalizado para remoção — ${loja.nome} — ${item.artigo}/${item.cor}`);
          return new Response(JSON.stringify({ success: true, id: pendente.id }), { status: 200, headers: corsHeaders });
        }

        // PATCH action:"cancelarMatrizRemocao" + token + itemId -> a propria loja desfaz uma
        // sinalizacao de "nao existe" ainda pendente (se errou ao marcar). Aberto.
        if (body.action === "cancelarMatrizRemocao" && body.token && body.itemId) {
          const { content, sha } = await getFile(GITHUB_MATRIZ);
          const data = (content && typeof content === "object") ? content : { lojas: [], pendentes: [] };
          const loja = (data.lojas || []).find(l => l.token === body.token);
          if (!loja) return new Response(JSON.stringify({ success: false, error: "Loja nao encontrada." }), { status: 404, headers: corsHeaders });
          const idx = (data.pendentes || []).findIndex(p => p.tipo === "remocao" && p.itemId === body.itemId && p.lojaCodigo === loja.codigo && p.status === "pendente");
          if (idx === -1) return new Response(JSON.stringify({ success: true, notFound: true }), { status: 200, headers: corsHeaders });
          data.pendentes.splice(idx, 1);
          await saveFile(GITHUB_MATRIZ, data, sha, `matriz: sinalizacao cancelada - ${loja.nome} - ${body.itemId}`);
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        // PATCH action:"resolverMatrizPendente" + id + status → admin marca um pendente como
        // aprovado/rejeitado. Se for tipo "remocao" e aprovado, o item sai de fato do catálogo
        // da loja. Se for tipo "novo" e aprovado, fica só marcado (o cadastro real é manual). Exige admin.
        if (body.action === "resolverMatrizPendente" && body.id) {
          const { content, sha } = await getFile(GITHUB_MATRIZ);
          const data = (content && typeof content === "object") ? content : { lojas: [], pendentes: [] };
          const idx = (data.pendentes || []).findIndex(p => p.id === body.id);
          if (idx === -1) return new Response(JSON.stringify({ success: false, error: "Pendente não encontrado." }), { status: 404, headers: corsHeaders });
          const pendente = data.pendentes[idx];
          const novoStatus = ["aprovado", "rejeitado"].includes(body.status) ? body.status : "resolvido";
          pendente.status = novoStatus;
          pendente.resolvidoEm = new Date().toISOString();

          if (pendente.tipo === "remocao" && novoStatus === "aprovado") {
            const loja = (data.lojas || []).find(l => l.codigo === pendente.lojaCodigo);
            if (loja && Array.isArray(loja.marcas[pendente.marca])) {
              loja.marcas[pendente.marca] = loja.marcas[pendente.marca].filter(i => i.id !== pendente.itemId);
            }
          }

          if ((pendente.tipo === "novo" || !pendente.tipo) && novoStatus === "aprovado") {
            const loja = (data.lojas || []).find(l => l.codigo === pendente.lojaCodigo);
            if (loja) {
              if (!loja.marcas[pendente.marca]) loja.marcas[pendente.marca] = [];
              const novoId = `${pendente.artigo}|${pendente.cor}`;
              const jaExiste = loja.marcas[pendente.marca].some(i => i.id === novoId);
              if (!jaExiste) {
                loja.marcas[pendente.marca].push({
                  id: novoId,
                  artigo: pendente.artigo,
                  descricao: pendente.descricao,
                  cor: pendente.cor,
                  estoqueAtual: Number(pendente.estoqueAtual) || 0,
                  venda: Number(pendente.venda) || 0,
                  preposto: null
                });
              }
            }
          }

          await saveFile(GITHUB_MATRIZ, data, sha, `matriz: pendente resolvido — ${body.id}`);
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        }

        // PATCH action:"deleteMatrizItens" + lojaCodigo + marca + itemIds:[...] → admin remove um ou
        // mais itens do catálogo de uma loja diretamente (exclusão manual, sem passar por pendente).
        if (body.action === "deleteMatrizItens" && body.lojaCodigo && body.marca && Array.isArray(body.itemIds) && body.itemIds.length) {
          const { content, sha } = await getFile(GITHUB_MATRIZ);
          const data = (content && typeof content === "object") ? content : { lojas: [], pendentes: [] };
          const loja = (data.lojas || []).find(l => String(l.codigo) === String(body.lojaCodigo));
          if (!loja) return new Response(JSON.stringify({ success: false, error: "Loja não encontrada." }), { status: 404, headers: corsHeaders });
          if (!Array.isArray(loja.marcas[body.marca])) return new Response(JSON.stringify({ success: false, error: "Marca não encontrada." }), { status: 404, headers: corsHeaders });
          const idsSet = new Set(body.itemIds.map(String));
          const antes = loja.marcas[body.marca].length;
          loja.marcas[body.marca] = loja.marcas[body.marca].filter(i => !idsSet.has(String(i.id)));
          const removidos = antes - loja.marcas[body.marca].length;
          await saveFile(GITHUB_MATRIZ, data, sha, `matriz: exclusão manual — ${loja.nome} — ${removidos} item(ns)`);
          return new Response(JSON.stringify({ success: true, removidos }), { status: 200, headers: corsHeaders });
        }

        // PATCH action:"uploadMatrizImagem" + nomeArquivo + base64 → admin envia a foto de um produto
        // sem imagem. Salva no repositório de imagens, na pasta imagens_olympikus, com o nome padrão
        // ARTIGO_COR.jpg (mesma convenção usada pelas imagens já existentes). Usa a Git Data API
        // (mesmo mecanismo confiável do saveFile) em vez da Contents API simples.
        if (body.action === "uploadMatrizImagem" && body.nomeArquivo && body.base64) {
          const nome = String(body.nomeArquivo);
          const owner = env.GITHUB_OWNER;
          const branch = env.GITHUB_BRANCH || "main";
          const blobSha = await gitCreateBlobFromBase64(owner, GITHUB_IMG_REPO, body.base64);
          await gitCommitBlob(owner, GITHUB_IMG_REPO, branch, `imagens_olympikus/${nome}`, blobSha, `matriz: upload imagem — ${nome}`);
          return new Response(JSON.stringify({ success: true, arquivo: nome }), { status: 200, headers: corsHeaders });
        }

        // PATCH action:"limparHistoricoMatriz" → admin apaga permanentemente as pendências já
        // resolvidas (aprovadas/rejeitadas), mantendo só as que ainda estão em aberto.
        if (body.action === "limparHistoricoMatriz") {
          const { content, sha } = await getFile(GITHUB_MATRIZ);
          const data = (content && typeof content === "object") ? content : { lojas: [], pendentes: [] };
          const antes = (data.pendentes || []).length;
          data.pendentes = (data.pendentes || []).filter(p => p.status === "pendente");
          const removidos = antes - data.pendentes.length;
          await saveFile(GITHUB_MATRIZ, data, sha, `matriz: histórico de pendências limpo (${removidos} removida(s))`);
          return new Response(JSON.stringify({ success: true, removidos }), { status: 200, headers: corsHeaders });
        }

        // ── TRADE SQUASH: diagnóstico do login ────────────────────────────
        // Rode uma vez após o deploy, para provar que o login funciona sem
        // navegador antes de disparar o lote inteiro.
        if (body.action === "tsDiagnostico") {
          const tenant = TS_TENANTS[String(body.marca || "oly")] || TS_TENANTS.oly;
          globalThis.__TS_ULTIMO_FORM = null;
          try {
            const s = await tsSessao(tenant, true);
            const amostra = await tsBuscar(s, String(body.artigo || ""), String(body.cor || ""));
            return new Response(JSON.stringify({
              success: true,
              tenant,
              formulario: globalThis.__TS_ULTIMO_FORM,
              cookies: s.cookie.split(";").length,
              amostraEncontrada: amostra.length,
              primeiroSku: amostra[0] ? amostra[0].sku : null
            }), { status: 200, headers: corsHeaders });
          } catch (e) {
            // Devolve o que foi detectado no formulário mesmo quando falha —
            // é isso que diz SE os campos foram achados e com quais nomes.
            return new Response(JSON.stringify({
              success: false,
              tenant,
              error: String((e && e.message) || e),
              formulario: globalThis.__TS_ULTIMO_FORM
            }), { status: 200, headers: corsHeaders });
          }
        }

        // ── TRADE SQUASH: espelho cru da tela de login ────────────────────
        // Só para depurar: mostra os campos que o site está renderizando hoje,
        // sem tentar logar. Nenhuma credencial é enviada.
        if (body.action === "tsInspecionarLogin") {
          try {
            const r = await fetch(`${TS_BASE}/session/new`, {
              headers: { "User-Agent": TS_UA_HEADER, "Accept-Language": "pt-BR,pt;q=0.9" }
            });
            const html = await r.text();
            const f = tsFormLogin(html);
            if (!f) {
              return new Response(JSON.stringify({
                success: false, status: r.status, tamanhoHtml: html.length,
                error: "Nenhum <form> com campo de senha na página."
              }), { status: 200, headers: corsHeaders });
            }
            const campos = [...f.corpo.matchAll(/<input\b[^>]*>/gi)].map(m => ({
              name: tsAttr(m[0], "name"),
              type: (tsAttr(m[0], "type") || "text").toLowerCase(),
              value: tsAttr(m[0], "type").toLowerCase() === "hidden"
                ? (tsAttr(m[0], "value") ? "(preenchido)" : "(vazio)")
                : tsAttr(m[0], "value")
            })).filter(c => c.name);
            return new Response(JSON.stringify({
              success: true,
              status: r.status,
              action: tsAttr(f.tag, "action"),
              method: tsAttr(f.tag, "method"),
              campos
            }), { status: 200, headers: corsHeaders });
          } catch (e) {
            return new Response(JSON.stringify({
              success: false, error: String((e && e.message) || e)
            }), { status: 200, headers: corsHeaders });
          }
        }

        // ── TRADE SQUASH: busca e sobe as imagens de um LOTE ──────────────
        // Espera: { action:"tsBuscarImagens", marca:"oly"|"ua",
        //           itens:[{artigo, cor, descricao}] }
        // Devolve: { success, resultados:[{artigo, cor, status, nome, motivo}] }
        //   status: "ok" | "duplicada" | "nao_encontrado" | "erro"
        //
        // O admin agrupa os itens por ARTIGO ao montar o lote — assim todas as
        // cores de um artigo chegam juntas e a deduplicação funciona.
        // Cada item custa ~5 subrequisições; o teto do plano free é 50.
        if (body.action === "tsBuscarImagens" && Array.isArray(body.itens)) {
          const TS_MAX_ITENS_LOTE = 8;
          const marcaKey = String(body.marca || "oly").toLowerCase();
          const tenant = TS_TENANTS[marcaKey];
          if (!tenant) {
            return new Response(JSON.stringify({ success: false, error: "Marca inválida." }),
              { status: 400, headers: corsHeaders });
          }
          const itens = body.itens.slice(0, TS_MAX_ITENS_LOTE);

          let sessao;
          try {
            sessao = await tsSessao(tenant, !!body.relogar);
          } catch (e) {
            return new Response(JSON.stringify({
              success: false,
              error: "Falha no login do Trade Squash: " + String((e && e.message) || e)
            }), { status: 200, headers: corsHeaders });
          }

          const owner  = env.GITHUB_OWNER;
          const branch = env.GITHUB_BRANCH || "main";
          const vistosUrl  = new Map(); // artigo → Map(url → cor)
          const vistosHash = new Map(); // artigo → Map(hash → cor)
          const resultados = [];

          for (const it of itens) {
            const artigo = String((it && it.artigo) || "").trim();
            const cor    = String((it && it.cor) || "").trim();
            if (!artigo || !cor) {
              resultados.push({ artigo, cor, status: "erro", motivo: "Artigo ou cor vazio" });
              continue;
            }
            try {
              const matches = await tsBuscar(sessao, artigo, cor);
              if (!matches.length) {
                resultados.push({ artigo, cor, status: "nao_encontrado",
                                  motivo: "Nenhum SKU casou com artigo + cor" });
                continue;
              }
              const redirect = matches[0].redirect || "";
              if (!redirect) {
                resultados.push({ artigo, cor, status: "nao_encontrado",
                                  motivo: "SKU sem link de detalhe" });
                continue;
              }
              const urlImg = await tsUrlImagem(sessao, redirect, artigo);
              if (!urlImg) {
                resultados.push({ artigo, cor, status: "nao_encontrado",
                                  motivo: "Nenhuma imagem do CDN na página do produto" });
                continue;
              }

              // Duplicata por URL — a segunda cor não chega a ser baixada
              if (!vistosUrl.has(artigo)) vistosUrl.set(artigo, new Map());
              const porUrl = vistosUrl.get(artigo);
              if (porUrl.has(urlImg)) {
                resultados.push({ artigo, cor, status: "duplicada",
                                  motivo: `Mesma imagem da cor ${porUrl.get(urlImg)}` });
                continue;
              }

              const imgRes = await fetch(urlImg, {
                headers: { "User-Agent": TS_UA_HEADER, Referer: sessao.showcase }
              });
              if (!imgRes.ok) {
                resultados.push({ artigo, cor, status: "erro", motivo: `Download HTTP ${imgRes.status}` });
                continue;
              }
              const tipo = imgRes.headers.get("Content-Type") || "";
              if (!/image/i.test(tipo)) {
                resultados.push({ artigo, cor, status: "erro", motivo: `Não é imagem (${tipo})` });
                continue;
              }
              const buf = await imgRes.arrayBuffer();
              if (buf.byteLength < 2048) {
                resultados.push({ artigo, cor, status: "erro", motivo: "Imagem menor que 2 KB (suspeita)" });
                continue;
              }

              // Duplicata por conteúdo
              const hash = await tsHash(buf);
              if (!vistosHash.has(artigo)) vistosHash.set(artigo, new Map());
              const porHash = vistosHash.get(artigo);
              if (porHash.has(hash)) {
                resultados.push({ artigo, cor, status: "duplicada",
                                  motivo: `Conteúdo idêntico ao da cor ${porHash.get(hash)}` });
                continue;
              }

              // Sobe para Catalogo/ com o nome que o painel espera.
              // Usa a Git Data API (mesma do saveFile), sem limite prático de tamanho.
              const nome = tsNomeArquivo(artigo, cor);
              const blobSha = await gitCreateBlobFromBase64(owner, env.GITHUB_REPO, tsBase64(buf));
              await gitCommitBlob(owner, env.GITHUB_REPO, branch, `Catalogo/${nome}`, blobSha,
                                  `disponibilidades: imagem automática — ${nome}`);

              porUrl.set(urlImg, cor);
              porHash.set(hash, cor);
              resultados.push({ artigo, cor, status: "ok", nome });

            } catch (e) {
              const msg = String((e && e.message) || e);
              if (msg === "SESSAO_EXPIRADA") {
                globalThis.__TS_SESSAO = null;
                return new Response(JSON.stringify({
                  success: false, sessaoExpirada: true,
                  error: "Sessão do Trade Squash expirou. Repita o lote.",
                  resultados
                }), { status: 200, headers: corsHeaders });
              }
              resultados.push({ artigo, cor, status: "erro", motivo: msg });
            }
          }

          // Atualiza o histórico de imagens de uma vez só (1 commit por lote)
          const novas = {};
          for (const r of resultados) {
            if (r.status === "ok") novas[`${r.artigo}|${r.cor}`] = r.nome.replace(/\.jpg$/i, "");
          }
          if (Object.keys(novas).length) {
            try {
              const { content, sha } = await getFile(GITHUB_IMG_HIST);
              await saveFile(GITHUB_IMG_HIST, { ...(content || {}), ...novas }, sha,
                             "historico imagens (busca automatica)");
            } catch (_) { /* não invalida as imagens já enviadas */ }
          }

          return new Response(JSON.stringify({ success: true, resultados }),
            { status: 200, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ success: false, error: "PATCH: action inválida." }), { status: 400, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: corsHeaders });

    } catch (error) {
      return new Response(JSON.stringify({ success: false, error: error.message || "Erro interno" }), { status: 500, headers: corsHeaders });
    }
  }
};