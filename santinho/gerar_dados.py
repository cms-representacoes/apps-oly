"""
Santinho digital: dados abertos do TSE -> dados/candidatos.json + fotos/.

    python santinho/gerar_dados.py

Baixa direto do CDN de dados abertos do TSE (cdn.tse.jus.br) o cadastro de
candidatos de 2026, o cadastro complementar e as fotos do Maranhão e da
Presidência. A busca do site DivulgaCand não serve: recusa acesso
automático e não deixa outra página chamá-la.

Só entra quem está na urna (ST_CANDIDATO_INSERIDO_URNA = SIM). Quem está na
urna mas com o voto em risco (sub judice, nulo técnico) entra marcado, para
a tela avisar. Vices e suplentes ficam de fora: não se vota neles.

As fotos viram miniaturas de 150x200 com o número da candidatura no nome
(fotos/<SQ>.jpg). Rodar de novo atualiza tudo: o TSE regera os arquivos
várias vezes por dia perto da eleição.
"""
import csv
import io
import json
import sys
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps

UF = "MA"
BASE = "https://cdn.tse.jus.br/estatistica/sead"
CAND = f"{BASE}/odsele/consulta_cand/consulta_cand_2026.zip"
COMPL = f"{BASE}/odsele/consulta_cand_complementar/consulta_cand_complementar_2026.zip"
FOTOS = f"{BASE}/eleicoes/eleicoes2026/fotos/foto_cand2026_{{uf}}_div.zip"

# Ordem da urna nas eleições gerais. Senado tem duas vagas em 2026: são dois
# votos seguidos, no mesmo conjunto de candidatos.
CARGOS = {
    "DEPUTADO FEDERAL": "df",
    "DEPUTADO ESTADUAL": "de",
    "SENADOR": "se",
    "GOVERNADOR": "gv",
    "PRESIDENTE": "pr",
}

PASTA = Path(__file__).resolve().parent
TAM = (150, 200)


def baixar(url):
    print("baixando", url)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return zipfile.ZipFile(io.BytesIO(r.read()))


def ler_csv(zf, nome):
    texto = zf.read(nome).decode("latin1")
    return list(csv.DictReader(io.StringIO(texto), delimiter=";"))


def limpo(v):
    return "" if v in ("#NULO", "#NE", "-1", "-3") else v.strip()


def main():
    zc, zx = baixar(CAND), baixar(COMPL)
    candidatos, gerado = [], ""
    for uf in (UF, "BR"):
        compl = {x["SQ_CANDIDATO"]: x for x in ler_csv(zx, f"consulta_cand_complementar_2026_{uf}.csv")}
        fotos = baixar(FOTOS.format(uf=uf))
        nomes_fotos = {n.split("_")[0][3:]: n for n in fotos.namelist() if n.endswith(".jpg")}
        for x in ler_csv(zc, f"consulta_cand_2026_{uf}.csv"):
            cargo = CARGOS.get(x["DS_CARGO"])
            c = compl.get(x["SQ_CANDIDATO"], {})
            if not cargo or c.get("ST_CANDIDATO_INSERIDO_URNA") != "SIM":
                continue
            gerado = gerado or f'{x["DT_GERACAO"]} {x["HH_GERACAO"]}'
            sq = x["SQ_CANDIDATO"]
            foto = nomes_fotos.get(sq)
            if foto:
                img = ImageOps.fit(Image.open(io.BytesIO(fotos.read(foto))).convert("RGB"), TAM, Image.LANCZOS)
                (PASTA / "fotos").mkdir(exist_ok=True)
                img.save(PASTA / "fotos" / f"{sq}.jpg", quality=72, optimize=True, progressive=True)
            destino = limpo(c.get("NM_TIPO_DESTINACAO_VOTOS", ""))
            candidatos.append({
                "c": cargo,
                "n": x["NR_CANDIDATO"],
                "u": x["NM_URNA_CANDIDATO"],
                "nm": limpo(x["NM_SOCIAL_CANDIDATO"]) or x["NM_CANDIDATO"],
                "p": x["SG_PARTIDO"],
                "f": limpo(x["SG_FEDERACAO"]) or limpo(x["NM_COLIGACAO"]),
                "sq": sq,
                "foto": bool(foto),
                "aviso": "" if destino in ("", "Válido") else destino,
            })

    candidatos.sort(key=lambda k: (list(CARGOS.values()).index(k["c"]), k["u"]))
    (PASTA / "dados").mkdir(exist_ok=True)
    saida = {
        "uf": UF,
        "eleicao": "Eleições Gerais 2026 · 1º turno · 04/10/2026",
        "gerado_tse": gerado,
        "gerado_em": datetime.now().strftime("%d/%m/%Y %H:%M"),
        "candidatos": candidatos,
    }
    (PASTA / "dados" / "candidatos.json").write_text(
        json.dumps(saida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    por_cargo = {}
    for k in candidatos:
        por_cargo[k["c"]] = por_cargo.get(k["c"], 0) + 1
    sem_foto = sum(1 for k in candidatos if not k["foto"])
    print(f"{len(candidatos)} candidatos {por_cargo}; sem foto: {sem_foto}; TSE gerou em {gerado}")


if __name__ == "__main__":
    sys.exit(main())
