"""Cópia diária do portal para o Supabase (até a virada, o GitHub é a fonte).

Roda as três cargas sobre os arquivos da pasta em que está (o espelho do
GitHub que o robô atualiza antes) e confere no fim se o banco bateu com os
arquivos. Registra o resultado em sistema.publicacoes (base 'copia-diaria').

Uso:  py -I supabase/scripts/copia_diaria.py
Saída: 0 = cópia feita e conferida | 1 = erro (detalhe no texto impresso)
"""
import json
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import winreg
from pathlib import Path

AQUI = Path(__file__).resolve().parent
APPS = AQUI.parents[1]
PROJETO = "rczlnuemmluhkgwzdino"


def token():
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
        return winreg.QueryValueEx(k, "SUPABASE_ACCESS_TOKEN")[0]


def sql(consulta, tentativas=3):
    corpo = json.dumps({"query": consulta}).encode("utf-8")
    for i in range(tentativas):
        req = urllib.request.Request(
            f"https://api.supabase.com/v1/projects/{PROJETO}/database/query", data=corpo, method="POST",
            headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json",
                     "User-Agent": "cms-copia-diaria"})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read() or b"[]")
        except urllib.error.HTTPError as e:
            erro = e.read().decode("utf-8", "replace")[:400]
            # 5xx e limite de chamadas: espera e tenta de novo; o resto é erro de verdade
            if e.code < 500 and e.code != 429:
                raise RuntimeError(erro)
        except urllib.error.URLError as e:
            erro = str(e)
        time.sleep(20 * (i + 1))
    raise RuntimeError(erro)


def rodar_arquivo(caminho):
    sql(Path(caminho).read_text(encoding="utf-8"))


def gerar(script, destino):
    r = subprocess.run([sys.executable, "-I", str(AQUI / script), str(destino)],
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        raise RuntimeError(f"{script}: {r.stderr[-600:]}")
    return r.stdout


def esperado():
    """Contagens e somas tiradas direto dos arquivos, para conferir o banco."""
    d = json.loads((APPS / "data" / "detalhada.json").read_text(encoding="utf-8"))
    p = json.loads((APPS / "data" / "pedidos.json").read_text(encoding="utf-8"))
    return {
        "detalhada": len(d["l"]), "det_cart": sum(r[11] for r in d["l"]),
        "pedidos": len(p), "ped_pares": sum((x.get("totals") or {}).get("units") or 0 for x in p),
        "produtos": len(json.loads((APPS / "data" / "produtos.json").read_text(encoding="utf-8"))),
    }


def no_banco():
    r = sql("""select json_build_object(
      'detalhada', (select count(*) from carteira.detalhada),
      'det_cart',  (select coalesce(sum(cart), 0) from carteira.detalhada),
      'pedidos',   (select count(*) from repasse.pedidos),
      'ped_pares', (select coalesce(sum(total_pares), 0) from repasse.pedidos),
      'produtos',  (select count(*) from cadastro.produtos)) as r""")
    return r[0]["r"]


def main():
    inicio = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        print(gerar("carga_cadastro.py", tmp / "cadastro.sql").strip())
        rodar_arquivo(tmp / "cadastro.sql")
        print(gerar("carga_areas.py", tmp / "areas").strip())
        arquivos = sorted((tmp / "areas").glob("*.sql"))
        for i, arq in enumerate(arquivos, 1):
            rodar_arquivo(arq)
        print(f"{len(arquivos)} partes enviadas")
    r = subprocess.run([sys.executable, "-I", str(AQUI / "carga_arquivos.py")],
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        raise RuntimeError(f"carga_arquivos.py: {r.stderr[-600:]}")
    print(r.stdout.strip())

    esp, banco = esperado(), no_banco()
    diferencas = {k: (esp[k], banco.get(k)) for k in esp if esp[k] != banco.get(k)}
    segundos = round(time.time() - inicio)
    situacao = "ok" if not diferencas else "DIVERGENTE"
    sql("insert into sistema.publicacoes (base, origem, linhas, por) values "
        f"('copia-diaria', '{situacao} em {segundos}s', {banco['detalhada']}, 'robo copia diaria')")
    print(f"conferencia: {situacao} {json.dumps(diferencas) if diferencas else ''} ({segundos}s)")
    return 0 if not diferencas else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"ERRO: {e}")
        sys.exit(1)
