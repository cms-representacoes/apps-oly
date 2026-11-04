"""Leva para o Storage do Supabase o que hoje é arquivo dentro do repositório:

  relatorios/  planilhas do RFV e da Performance (hoje em base64 dentro do JSON)
  arquivo/     backups antigos de data/backups, compactados em .gz

Os dois buckets são privados. Cada arquivo ganha uma linha de índice no banco
(relatorios.arquivos e sistema.arquivo_historico).

O token pessoal sai da variável de usuário SUPABASE_ACCESS_TOKEN; a chave de
serviço é pedida à API na hora e nunca é gravada nem exibida.

Uso:  py -I supabase/scripts/carga_arquivos.py
"""
import base64
import gzip
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import winreg
from pathlib import Path

PROJETO = "rczlnuemmluhkgwzdino"
URL = f"https://{PROJETO}.supabase.co"
DATA = Path(__file__).resolve().parents[2] / "data"


def token_pessoal():
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
        return winreg.QueryValueEx(k, "SUPABASE_ACCESS_TOKEN")[0]


def pedir(url, metodo="GET", corpo=None, cabecalhos=None):
    req = urllib.request.Request(url, data=corpo, method=metodo, headers=cabecalhos or {})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


TOKEN = token_pessoal()
GESTAO = {"Authorization": f"Bearer {TOKEN}", "User-Agent": "cms-carga"}


def sql(consulta):
    st, r = pedir(f"https://api.supabase.com/v1/projects/{PROJETO}/database/query", "POST",
                  json.dumps({"query": consulta}).encode(), {**GESTAO, "Content-Type": "application/json"})
    if st >= 300:
        raise RuntimeError(r.decode()[:300])
    return json.loads(r or b"[]")


def chave_servico():
    st, r = pedir(f"https://api.supabase.com/v1/projects/{PROJETO}/api-keys?reveal=true", cabecalhos=GESTAO)
    # A chave secreta nova (sb_secret_...), que se troca sem derrubar o resto;
    # as legadas (anon / service_role) vão ser desligadas
    for k in json.loads(r):
        if k.get("type") == "secret":
            return k["api_key"]
    raise RuntimeError("chave secreta não encontrada")


SERVICO = chave_servico()
# A chave nova não é JWT: vai só no cabeçalho apikey
STORAGE = {"apikey": SERVICO}


def criar_bucket(nome):
    st, r = pedir(f"{URL}/storage/v1/bucket", "POST",
                  json.dumps({"id": nome, "name": nome, "public": False}).encode(),
                  {**STORAGE, "Content-Type": "application/json"})
    if st >= 300 and b"already exists" not in r and b"Duplicate" not in r:
        raise RuntimeError(f"bucket {nome}: {r[:200]}")


def enviar(bucket, caminho, conteudo, tipo):
    alvo = urllib.parse.quote(caminho)
    st, r = pedir(f"{URL}/storage/v1/object/{bucket}/{alvo}", "POST", conteudo,
                  {**STORAGE, "Content-Type": tipo, "x-upsert": "true"})
    if st >= 300:
        raise RuntimeError(f"{bucket}/{caminho}: {r[:200]}")


def q(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def relatorios():
    criar_bucket("relatorios")
    linhas = []
    rfv = json.loads((DATA / "rfv.json").read_text(encoding="utf-8"))
    for chave, f in rfv["files"].items():
        caminho = f"rfv/{f['name']}"
        enviar("relatorios", caminho, base64.b64decode(f["b64"]),
               "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        linhas.append(("rfv", chave, f["name"], caminho, rfv.get("updatedAt"),
                       json.dumps({"corrSem": rfv.get("corrSem")})))
    perf = json.loads((DATA / "performance.json").read_text(encoding="utf-8"))
    for chave, f in perf["periods"].items():
        conteudo = base64.b64decode(f["b64"])
        # 2026-ALL é JSON já processado, não planilha
        tipo = "application/json" if conteudo[:1] == b"{" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        # O Storage só aceita ASCII no caminho; o nome original fica no índice
        nome = re.sub(r"[^A-Za-z0-9.\-]+", "_", f["name"])
        caminho = f"performance/{chave}/{nome}"
        enviar("relatorios", caminho, conteudo, tipo)
        linhas.append(("performance", chave, f["name"], caminho, f.get("updatedAt"),
                       json.dumps({"ano": f.get("ano"), "sem": f.get("sem")})))
    valores = ",".join(f"({q(a)},{q(b)},{q(c)},{q(d)},{q(e)},{q(x)}::jsonb)" for a, b, c, d, e, x in linhas)
    sql("delete from relatorios.arquivos; insert into relatorios.arquivos "
        f"(relatorio, chave, nome, caminho, atualizado_em, extra) values {valores};")
    return len(linhas)


def backups():
    criar_bucket("arquivo")
    # Backup é foto de um dia: o que já subiu não muda, só os novos vão
    ja_enviados = {r["caminho"] for r in sql("select caminho from sistema.arquivo_historico")}
    linhas, total, total_gz = [], 0, 0
    for arq in sorted((DATA / "backups").rglob("*.json")):
        bruto = arq.read_bytes()
        gz = gzip.compress(bruto, 9)
        rel = arq.relative_to(DATA / "backups").as_posix()
        caminho = f"backups/{rel}.gz"
        if caminho not in ja_enviados:
            enviar("arquivo", caminho, gz, "application/gzip")
        tipo = rel.split("/")[0] if "/" in rel else rel.split("_backup")[0]
        m = re.search(r"(\d{4}-\d{2}-\d{2})", rel)
        linhas.append((caminho, tipo, m.group(1) if m else None, len(bruto), len(gz)))
        total += len(bruto)
        total_gz += len(gz)
    valores = ",".join(f"({q(c)},{q(t)},{q(d)},{b},{g})" for c, t, d, b, g in linhas)
    sql("delete from sistema.arquivo_historico; insert into sistema.arquivo_historico "
        f"(caminho, tipo, data, bytes_original, bytes_gzip) values {valores};")
    return len(linhas), total, total_gz


if __name__ == "__main__":
    print("relatorios:", relatorios())
    n, b, g = backups()
    print(f"backups: {n} arquivos, {b / 1e6:.1f} MB -> {g / 1e6:.1f} MB compactados")
    sys.exit(0)
