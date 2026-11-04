"""Banco de imagens: uma pasta só de fotos de produto no bucket público "imagens".

  produtos/        a junção de apps-oly/Catalogo e apps-oly-v2/imagens_olympikus,
                   sem repetição; quando o mesmo nome tem duas versões, fica a
                   mais nova (pela data do último commit de cada uma)
  produtos/mini/   miniaturas de 420px, geradas das fotos acima
  portal/          apps-oly/imagens_olympikus (categorias e banner do portal)

Manda só o que é novo ou mudou: o índice sistema.imagens guarda o md5 da
foto de origem (inclusive para a miniatura, que é derivada dela).

Uso:  py -I supabase/scripts/carga_imagens.py mini portal     (cabe no plano grátis)
      py -I supabase/scripts/carga_imagens.py                 (tudo: precisa do Pro)
"""
import hashlib
import io
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import winreg
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

PROJETO = "rczlnuemmluhkgwzdino"
URL = f"https://{PROJETO}.supabase.co"
APPS = Path(__file__).resolve().parents[2]
V2 = APPS.parent / "apps-oly-v2"
PASTAS_PRODUTO = [APPS / "Catalogo", V2 / "imagens_olympikus"]
EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
TIPOS = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}
MINI = 420

with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
    TOKEN = winreg.QueryValueEx(k, "SUPABASE_ACCESS_TOKEN")[0]
GESTAO = {"Authorization": f"Bearer {TOKEN}", "User-Agent": "cms-imagens", "Content-Type": "application/json"}


def pedir(url, metodo="GET", corpo=None, cab=None):
    req = urllib.request.Request(url, data=corpo, method=metodo, headers=cab or {})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def sql(consulta):
    st, r = pedir(f"https://api.supabase.com/v1/projects/{PROJETO}/database/query", "POST",
                  json.dumps({"query": consulta}).encode(), GESTAO)
    if st >= 300:
        raise RuntimeError(r.decode()[:300])
    return json.loads(r or b"[]")


st, r = pedir(f"https://api.supabase.com/v1/projects/{PROJETO}/api-keys?reveal=true", cab=GESTAO)
SECRETA = next(k["api_key"] for k in json.loads(r) if k.get("type") == "secret")
STORAGE = {"apikey": SECRETA}


def md5(dados):
    return hashlib.md5(dados).hexdigest()


def data_commit(p):
    """Data do último commit do arquivo (a de modificação, se não estiver no git)."""
    repo = APPS if APPS in p.parents else V2
    r = subprocess.run(["git", "-C", str(repo), "log", "-1", "--format=%ct", "--", str(p.relative_to(repo))],
                       capture_output=True, text=True)
    return int(r.stdout.strip() or p.stat().st_mtime)


def fonte(p):
    """Como a origem aparece no índice: fonte/<repo>/<pasta>/<nome>."""
    repo = APPS if APPS in p.parents else V2
    return f"fonte/{repo.name}/{p.relative_to(repo).as_posix()}"


MD5 = {}


def md5_de(p):
    if p not in MD5:
        MD5[p] = md5(p.read_bytes())
    return MD5[p]


def fotos_de_produto(ja, origem_ant):
    """nome do arquivo -> a foto escolhida entre as duas pastas.

    Com duas versões diferentes do mesmo nome, fica a mais nova: a que mudou
    desde a última vez (pelo md5 guardado no índice); se nenhuma mudou, a
    escolha anterior; sem histórico nenhum, a do commit mais recente."""
    escolha = {}
    for pasta in PASTAS_PRODUTO:
        for p in pasta.glob("*"):
            if not (p.is_file() and p.suffix.lower() in EXT):
                continue
            atual = escolha.get(p.name)
            if atual is None or md5_de(atual) == md5_de(p):
                escolha.setdefault(p.name, p)
                continue
            mudou = {q: ja.get(fonte(q)) not in (None, md5_de(q)) for q in (atual, p)}
            if mudou[atual] != mudou[p]:
                escolha[p.name] = atual if mudou[atual] else p
            elif origem_ant.get(p.name) in (fonte(atual), fonte(p)):
                escolha[p.name] = atual if origem_ant[p.name] == fonte(atual) else p
            elif data_commit(p) > data_commit(atual):
                escolha[p.name] = p
    return escolha


def miniatura(p):
    im = Image.open(p)
    im = im.convert("RGB") if im.mode not in ("RGB", "L") else im
    im.thumbnail((MINI, MINI), Image.LANCZOS)
    saida = io.BytesIO()
    im.save(saida, "JPEG", quality=82, optimize=True, progressive=True)
    return saida.getvalue()


def itens(grupo, fotos):
    """(caminho no bucket, função que devolve os bytes, md5 da origem, tipo, origem)"""
    if grupo == "portal":
        pasta = APPS / "imagens_olympikus"
        for p in pasta.rglob("*"):
            if p.is_file() and p.suffix.lower() in EXT:
                yield f"portal/{p.relative_to(pasta).as_posix()}", p.read_bytes, md5_de(p), TIPOS[p.suffix.lower()], fonte(p)
        return
    if grupo == "mini":
        # a miniatura é sempre .jpg: com "x.jpg" e "x.png", vale a .jpg
        por_base = {}
        for nome, p in sorted(fotos.items(), key=lambda kv: kv[1].suffix.lower() not in (".jpg", ".jpeg")):
            por_base.setdefault(Path(nome).stem, p)
        for base, p in sorted(por_base.items()):
            yield f"produtos/mini/{base}.jpg", (lambda p=p: miniatura(p)), md5_de(p), "image/jpeg", fonte(p)
        return
    for nome, p in sorted(fotos.items()):
        yield f"produtos/{nome}", p.read_bytes, md5_de(p), TIPOS[p.suffix.lower()], fonte(p)


def garantir_bucket():
    st, r = pedir(f"{URL}/storage/v1/bucket", "POST",
                  json.dumps({"id": "imagens", "name": "imagens", "public": True}).encode(),
                  {**STORAGE, "Content-Type": "application/json"})
    if st >= 300 and b"already exists" not in r and b"Duplicate" not in r:
        raise RuntimeError(f"bucket: {r[:200]}")


def enviar(item):
    caminho, conteudo, origem, tipo, _ = item
    try:
        dados = conteudo()
    except Exception as e:          # arquivo que não é imagem de verdade: pula e avisa
        return caminho, origem, 0, f"IGNORADO (não abre como imagem: {type(e).__name__})"
    for tentativa in range(3):
        st, r = pedir(f"{URL}/storage/v1/object/imagens/{urllib.parse.quote(caminho)}", "POST", dados,
                      {**STORAGE, "Content-Type": tipo, "x-upsert": "true", "cache-control": "max-age=86400"})
        if st < 300:
            return caminho, origem, len(dados), None
        time.sleep(3 * (tentativa + 1))
    return caminho, origem, 0, r[:150].decode("utf-8", "replace")


def main(grupos):
    garantir_bucket()
    linhas = sql("select caminho, md5, origem, bytes from sistema.imagens")
    ja = {r["caminho"]: r["md5"] for r in linhas}
    # a escolha anterior de cada nome, lida das miniaturas e das fotos
    origem_ant = {}
    for r in linhas:
        if r["origem"] and r["caminho"].startswith("produtos/"):
            origem_ant[r["origem"].rsplit("/", 1)[-1]] = r["origem"]
    fotos = fotos_de_produto(ja, origem_ant)
    todos = [i for g in grupos for i in itens(g, fotos)]
    origem_de = {i[0]: i[4] for i in todos}
    fila = [i for i in todos if ja.get(i[0]) != i[2]]
    print(f"{len(fila)} imagens novas ou alteradas")
    ok, erros = [], []
    with ThreadPoolExecutor(8) as ex:
        for n, res in enumerate(ex.map(enviar, fila), 1):
            (erros if res[3] else ok).append(res)
            if n % 1000 == 0:
                print(f"  {n}/{len(fila)}")
    q = lambda v: "null" if v is None else "'" + str(v).replace("'", "''") + "'"
    registros = [(c, m, b, origem_de[c]) for c, m, b, _ in ok]
    # já enviadas, mas sem a origem anotada (índice de antes desta regra)
    guardada = {r["caminho"]: (r["origem"], r.get("bytes") or 0) for r in linhas}
    for caminho, _, md5_origem, _, origem in todos:
        if caminho in guardada and ja.get(caminho) == md5_origem and guardada[caminho][0] != origem:
            registros.append((caminho, md5_origem, guardada[caminho][1], origem))
    # o md5 de cada origem das fotos de produto (é o que decide a "mais nova")
    for p in {p for p in fotos.values()} | {q2 for pasta in PASTAS_PRODUTO for q2 in pasta.glob("*")
                                            if q2.is_file() and q2.suffix.lower() in EXT and q2.name in fotos}:
        if ja.get(fonte(p)) != md5_de(p):
            registros.append((fonte(p), md5_de(p), 0, None))
    for i in range(0, len(registros), 1000):
        valores = ",".join(f"({q(c)},{q(m)},{b},{q(o)})" for c, m, b, o in registros[i:i + 1000])
        sql("insert into sistema.imagens (caminho, md5, bytes, origem) values " + valores +
            " on conflict (caminho) do update set md5 = excluded.md5, bytes = excluded.bytes, "
            "origem = excluded.origem, enviado_em = now()")
    ignorados = [e for e in erros if e[3].startswith("IGNORADO")]
    erros = [e for e in erros if not e[3].startswith("IGNORADO")]
    print(f"enviadas: {len(ok)} ({sum(b for _, _, b, _ in ok) / 1e6:.1f} MB) | ignoradas: {len(ignorados)} | erros: {len(erros)}")
    for c, _, _, e in ignorados[:10] + erros[:10]:
        print("  ", c, e)
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["portal", "produtos", "mini"]))
