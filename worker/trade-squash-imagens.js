// ═══════════════════════════════════════════════════════════════════════════
// TRADE SQUASH — BUSCA AUTOMÁTICA DE IMAGENS
// ═══════════════════════════════════════════════════════════════════════════
// Porta para o Worker o que o app Python (gui.py + scraper.py + downloader.py)
// faz hoje na máquina do usuário. O Selenium sai de cena: o login vira um POST
// de formulário Rails, e o resto já era HTTP puro no Python.
//
// COMO INSTALAR
//   1. Cole o bloco "HELPERS" logo antes de `// ── ROTEAMENTO ──` no worker.
//   2. Cole o bloco "ACTIONS" dentro do `if (request.method === "PATCH")`,
//      junto das outras actions (antes do `return ... action inválida`).
//   3. Acrescente em WRITE_ACTIONS:  "tsBuscarImagens", "tsDiagnostico"
//   4. Cadastre os secrets no painel da Cloudflare:
//         TS_USERNAME   e   TS_PASSWORD
//      (Settings → Variables → Encrypt. NUNCA no HTML do admin.)
//
// LIMITE DE SUBREQUISIÇÕES
//   Cada item custa ~5 subrequisições (busca + página + imagem + 2 do GitHub).
//   O plano gratuito permite 50 por invocação; o pago, 1000. Por isso o admin
//   manda o trabalho em lotes — veja TS_MAX_ITENS_LOTE abaixo.
// ═══════════════════════════════════════════════════════════════════════════


// ─────────────────────────────────────────────────────────────────────────────
// HELPERS  (colar antes de `// ── ROTEAMENTO ──`)
// ─────────────────────────────────────────────────────────────────────────────

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

// ── Cookies ─────────────────────────────────────────────────────────────────
// Workers expõem getSetCookie() nas versões novas; mantemos um fallback para
// o header concatenado, que é como as runtimes antigas devolvem.
function tsColherCookies(cookieAtual, res) {
  const jar = {};
  for (const par of String(cookieAtual || "").split(";")) {
    const [k, ...v] = par.trim().split("=");
    if (k) jar[k] = v.join("=");
  }
  let novos = [];
  try {
    novos = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  } catch (_) { novos = []; }
  if (!novos.length) {
    const bruto = res.headers.get("set-cookie");
    if (bruto) novos = bruto.split(/,(?=[^;]+?=)/);
  }
  for (const sc of novos) {
    const primeiro = String(sc).split(";")[0];
    const [k, ...v] = primeiro.trim().split("=");
    if (k) jar[k] = v.join("=");
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

// ── Login ───────────────────────────────────────────────────────────────────
// Rails clássico: GET no formulário para pegar o authenticity_token e o cookie
// de sessão, POST com as credenciais, depois GET na showcase para o servidor
// contextualizar o tenant (o Python fazia isso clicando no botão "Vitrine").
async function tsLogin(env, tenant) {
  if (!env.TS_USERNAME || !env.TS_PASSWORD) {
    throw new Error("TS_USERNAME/TS_PASSWORD não configurados nos secrets do Worker.");
  }

  const cab = { "User-Agent": TS_UA_HEADER, "Accept-Language": "pt-BR,pt;q=0.9" };

  // 1) Formulário de login
  const r1 = await fetch(`${TS_BASE}/session/new`, { headers: cab, redirect: "follow" });
  if (!r1.ok) throw new Error(`GET /session/new falhou (${r1.status})`);
  const html = await r1.text();
  let cookie = tsColherCookies("", r1);

  const token =
    (html.match(/name="authenticity_token"[^>]*\svalue="([^"]+)"/i) || [])[1] ||
    (html.match(/value="([^"]+)"[^>]*\sname="authenticity_token"/i) || [])[1] || "";
  if (!token) throw new Error("authenticity_token não encontrado na tela de login.");

  const acao = (html.match(/<form[^>]+action="([^"]+)"[^>]*>/i) || [])[1] || "/session";
  const urlPost = acao.startsWith("http") ? acao : TS_BASE + (acao.startsWith("/") ? acao : "/" + acao);

  // O site passou a exigir o aceite dos termos. Mandamos o campo se ele existir
  // no formulário — é o equivalente ao clique no checkbox que o Selenium fazia.
  const form = new URLSearchParams();
  form.set("authenticity_token", token);
  form.set("user[email]", env.TS_USERNAME);
  form.set("user[password]", env.TS_PASSWORD);
  const mTermos = html.match(/name="([^"]*(?:terms|aceite)[^"]*)"/i);
  if (mTermos) form.set(mTermos[1], "1");
  form.set("commit", "Entrar");

  // 2) Submete. redirect:"manual" para colher o cookie de sessão do 302.
  const r2 = await fetch(urlPost, {
    method: "POST",
    headers: { ...cab, "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: form.toString(),
    redirect: "manual"
  });
  cookie = tsColherCookies(cookie, r2);
  if (r2.status >= 400) throw new Error(`POST de login falhou (${r2.status})`);

  // 3) Ativa a marca — sem isso o servidor devolve página genérica, sem foto.
  const showcase = `${TS_BASE}/${tenant}/showcase`;
  const r3 = await fetch(showcase, { headers: { ...cab, Cookie: cookie }, redirect: "follow" });
  cookie = tsColherCookies(cookie, r3);
  const htmlShow = await r3.text();
  if (/name="authenticity_token"/i.test(htmlShow) && /session/i.test(r3.url || "")) {
    throw new Error("Login recusado — voltou para a tela de sessão. Confira TS_USERNAME/TS_PASSWORD.");
  }

  return { cookie, tenant, showcase, criadoEm: Date.now() };
}

// Cache no escopo do módulo: sobrevive entre invocações no mesmo isolate.
// Não é garantido — quando o isolate é reciclado, simplesmente faz login de novo.
let TS_SESSAO = null;
async function tsSessao(env, tenant, forcar) {
  const valida = TS_SESSAO &&
                 TS_SESSAO.tenant === tenant &&
                 (Date.now() - TS_SESSAO.criadoEm) < 20 * 60 * 1000;
  if (valida && !forcar) return TS_SESSAO;
  TS_SESSAO = await tsLogin(env, tenant);
  return TS_SESSAO;
}

// ── Busca do produto (API JSON) ─────────────────────────────────────────────
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

// UA traz ARTIGO_COR_TAMANHO (vários tamanhos por cor); Olympikus traz ARTIGO-COR.
// Removemos o último pedaço só quando ele parece tamanho.
function tsChaveSemTamanho(sku) {
  const partes = String(sku).split(/[_-]/);
  if (partes.length <= 2) return sku.toUpperCase();
  const ultimo = partes[partes.length - 1].toUpperCase();
  const tamanhos = ["P","PP","M","G","GG","EG","EGG","XS","S","L","XL","XXL"];
  const ehTamanho = ultimo.length <= 3 && (
    tamanhos.includes(ultimo) || /^\d+G+$/.test(ultimo) || /^\d{2,3}$/.test(ultimo)
  );
  return (ehTamanho ? partes.slice(0, -1).join("_") : sku).toUpperCase();
}

// ── URL da imagem principal ─────────────────────────────────────────────────
// Mesma escada de preferências do downloader.py, sem BeautifulSoup:
// candidatas do CDN → exclui logos → prefere _FC (UA) → prefere a principal
// da Olympikus (sem sufixo _A/_B antes do -500x500) → primeira candidata.
async function tsUrlImagem(sessao, redirect, artigo) {
  const url = TS_BASE + redirect;
  const res = await fetch(url, {
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
  const candidatas = todas.filter(src => src && !excluir.test(src) && (!artigo || src.includes(artigo)));
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

// SHA-256 do conteúdo. O Python usava MD5, mas a Web Crypto não oferece MD5 —
// para detectar "duas cores com a mesma foto" qualquer hash serve.
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


// ─────────────────────────────────────────────────────────────────────────────
// ACTIONS  (colar dentro do `if (request.method === "PATCH")`)
// ─────────────────────────────────────────────────────────────────────────────
/*

        // ── TRADE SQUASH: diagnóstico do login ────────────────────────────
        // Use uma vez após instalar, para provar que o login funciona sem
        // navegador antes de rodar o lote inteiro.
        if (body.action === "tsDiagnostico") {
          const tenant = TS_TENANTS[String(body.marca || "oly")] || TS_TENANTS.oly;
          try {
            const s = await tsSessao(env, tenant, true);
            const amostra = await tsBuscar(s, String(body.artigo || ""), String(body.cor || ""));
            return new Response(JSON.stringify({
              success: true,
              tenant,
              cookies: s.cookie.split(";").length,
              amostraEncontrada: amostra.length,
              primeiroSku: amostra[0] ? amostra[0].sku : null
            }), { status: 200, headers: corsHeaders });
          } catch (e) {
            return new Response(JSON.stringify({
              success: false, tenant, error: String(e && e.message || e)
            }), { status: 200, headers: corsHeaders });
          }
        }

        // ── TRADE SQUASH: busca e sobe as imagens de um LOTE de itens ─────
        // Espera: { action:"tsBuscarImagens", marca:"oly"|"ua",
        //           itens:[{artigo, cor, descricao}] }
        // Devolve: { success, resultados:[{artigo, cor, status, nome, motivo}] }
        //   status: "ok" | "duplicada" | "nao_encontrado" | "erro"
        //
        // O admin agrupa os itens por ARTIGO ao montar o lote — assim todas as
        // cores de um artigo chegam juntas e a deduplicação funciona.
        if (body.action === "tsBuscarImagens" && Array.isArray(body.itens)) {
          const TS_MAX_ITENS_LOTE = 8; // conservador: cabe no limite do plano free
          const marcaKey = String(body.marca || "oly").toLowerCase();
          const tenant = TS_TENANTS[marcaKey];
          if (!tenant) {
            return new Response(JSON.stringify({ success: false, error: "Marca inválida." }),
              { status: 400, headers: corsHeaders });
          }
          const itens = body.itens.slice(0, TS_MAX_ITENS_LOTE);

          let sessao;
          try {
            sessao = await tsSessao(env, tenant, !!body.relogar);
          } catch (e) {
            return new Response(JSON.stringify({
              success: false, error: "Falha no login do Trade Squash: " + String(e && e.message || e)
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

              const imgRes = await fetch(urlImg, { headers: { "User-Agent": TS_UA_HEADER, Referer: sessao.showcase } });
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

              // Sobe para Catalogo/ com o nome que o painel espera
              const nome = tsNomeArquivo(artigo, cor);
              const blobSha = await gitCreateBlobFromBase64(owner, env.GITHUB_REPO, tsBase64(buf));
              await gitCommitBlob(owner, env.GITHUB_REPO, branch, `Catalogo/${nome}`, blobSha,
                                  `disponibilidades: imagem automática — ${nome}`);

              porUrl.set(urlImg, cor);
              porHash.set(hash, cor);
              resultados.push({ artigo, cor, status: "ok", nome });

            } catch (e) {
              const msg = String(e && e.message || e);
              if (msg === "SESSAO_EXPIRADA") {
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

*/
