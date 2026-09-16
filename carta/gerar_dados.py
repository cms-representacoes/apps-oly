"""
Carta campanha: planilha da Vulcabras -> um JSON por vendedor/marca/mês.

    python carta/gerar_dados.py "C:\\...\\CartaCampanhaAcompanhamentoMeta.xlsx"

A planilha é o "Relatório acompanhamento de metas". Cada linha é uma faixa
(calçados) ou uma família (meias, chinelos...) de um mês. As linhas SEM
preposto são o escritório inteiro; as demais são de cada vendedor.

O JSON sai cru (meta e realizado, em pares e em R$). Nada de cor, gatilho
ou valor da carta é decidido aqui: isso é trabalho da tela, que refaz a
conta no navegador. Assim uma regra nova não obriga a gerar tudo de novo.

Depois de gravar os meses, o índice (dados/indice.json) é refeito a partir
dos arquivos que existem na pasta, e não só do que veio nesta planilha:
um mês que não aparece mais na exportação continua disponível.
"""
import datetime as dt
import json
import os
import sys
import warnings
from collections import defaultdict
from pathlib import Path

import openpyxl

warnings.filterwarnings("ignore")   # a planilha vem sem estilo padrão

PASTA = Path(__file__).resolve().parent / "dados"

# Colunas da aba (0 = A). Conferidas pelo cabeçalho da linha 2.
C_MES, C_ANO = 0, 1
C_REP_COD, C_REP_NOME = 6, 7
C_PREP_COD, C_PREP_NOME = 8, 9
C_CARTA_COD, C_CARTA_NOME = 10, 11
C_INICIO, C_FIM = 12, 13
C_MARCA, C_ORDEM, C_FAIXA = 17, 18, 19
C_META_QTD, C_META_RS = 20, 21
C_PCT = 23
C_QTD, C_RS = 29, 30

NOMES_FAIXA = {
    "CORRE": "Corre",
    "CORRIDA/TREINO": "Corrida e treino",
    "CONF_MASC": "Conforto masculino",
    "CONF_FEM": "Conforto feminino",
    "CLASSICOS": "Clássicos",
    "INFANTIL": "Infantil",
    "OUTROS": "Outros",
}
# Ordem de leitura pedida pelo escritório (não a da Vulcabras).
ORDEM_FAIXA = ["CORRE", "CORRIDA/TREINO", "CONF_MASC", "CONF_FEM", "CLASSICOS", "INFANTIL", "OUTROS"]

# Família = prefixo do código da marca na planilha (ACOLY, MEOLY, ACUA...).
FAMILIAS = [("ME", "Meias"), ("CH", "Chinelos"), ("AC", "Acessórios"), ("CF", "Vestuário")]


def texto(v):
    """A exportação grava UTF-8 lido como Latin-1 em alguns campos."""
    if v is None:
        return ""
    s = str(v).strip()
    try:
        return s.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def numero(v):
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return 0.0


def data_iso(v):
    s = texto(v)
    if not s:
        return None
    try:
        return dt.datetime.strptime(s, "%d/%m/%Y").date().isoformat()
    except ValueError:
        return None


def codigo(v):
    s = texto(v)
    return s[:-2] if s.endswith(".0") else s


def marca_da_carta(nome_carta):
    """'OLY 2026' -> 'OLY'; 'UA 2026' -> 'UA'."""
    return (nome_carta.split() or ["?"])[0].upper()


def familia(cod_marca, marca):
    for prefixo, nome in FAMILIAS:
        if cod_marca.startswith(prefixo) and cod_marca[len(prefixo):] == marca:
            return nome
    return None


def bloco(r):
    return {
        "meta_qtd": numero(r[C_META_QTD]),
        "meta_rs": numero(r[C_META_RS]),
        "qtd": numero(r[C_QTD]),
        "rs": numero(r[C_RS]),
        # A planilha não traz carteira; o potencial fica igual ao faturado
        # até alguém preencher estes dois campos.
        "carteira_qtd": 0,
        "carteira_rs": 0,
    }


VAZIO = {"meta_qtd": 0, "meta_rs": 0, "qtd": 0, "rs": 0, "carteira_qtd": 0, "carteira_rs": 0}


def ler(caminho):
    # read_only não serve: a exportação não grava as dimensões da aba e ele
    # enxerga só a primeira linha.
    wb = openpyxl.load_workbook(caminho, data_only=True)
    ws = wb.worksheets[0]
    linhas = list(ws.iter_rows(values_only=True))
    cab = [texto(c) for c in linhas[1]]
    esperado = {C_REP_COD: "Representante", C_PREP_COD: "Preposto", C_MARCA: "Marca",
                C_FAIXA: "Faixa", C_META_QTD: "Quantidade Meta", C_RS: "Valor Liquido"}
    for col, nome in esperado.items():
        if cab[col] != nome:
            sys.exit(f"Coluna {col + 1} deveria ser '{nome}' e veio '{cab[col]}'. O layout da planilha mudou.")
    return [r for r in linhas[2:] if r and r[C_MES] not in (None, "")]


def montar(linhas, atualizado_em, origem):
    # (marca, mês) -> escritório: {faixa: bloco}; vendedores: {cod: {...}}
    meses = defaultdict(lambda: {"escritorio": {}, "vendedores": defaultdict(dict),
                                 "nomes": {}, "carta": {}, "cartas_vend": {}, "rep": None})
    for r in linhas:
        mes = f"{int(r[C_ANO]):04d}-{int(r[C_MES]):02d}"
        marca = marca_da_carta(texto(r[C_CARTA_NOME]))
        m = meses[(marca, mes)]
        chave = texto(r[C_FAIXA]).upper() if texto(r[C_MARCA]).upper() == marca else texto(r[C_MARCA]).upper()
        item = {"marca": texto(r[C_MARCA]).upper(), "faixa": chave, "pct": numero(r[C_PCT]), "bloco": bloco(r)}
        carta = {"codigo": codigo(r[C_CARTA_COD]), "nome": texto(r[C_CARTA_NOME]),
                 "inicio": data_iso(r[C_INICIO]), "fechamento": data_iso(r[C_FIM])}
        m["rep"] = {"codigo": codigo(r[C_REP_COD]), "nome": texto(r[C_REP_NOME])}
        prep = codigo(r[C_PREP_COD])
        if not prep:
            m["escritorio"][chave] = item
            m["carta"] = carta
        else:
            m["vendedores"][prep][chave] = item
            m["nomes"][prep] = texto(r[C_PREP_NOME])
            m["cartas_vend"][prep] = carta

    gerados = []
    for (marca, mes), m in sorted(meses.items()):
        # Under Armour inteira entra na regra 360 da Olympikus
        ua = meses.get(("UA", mes))
        for vend, itens in m["vendedores"].items():
            doc = documento(marca, mes, vend, m, itens, ua, atualizado_em, origem)
            destino = PASTA / vend / marca / f"{mes}.json"
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
            gerados.append(destino)
    return gerados


def documento(marca, mes, vend, m, itens, ua, atualizado_em, origem):
    chaves = set(itens) | set(m["escritorio"])
    faixas, familias_ = [], []
    for chave in chaves:
        ref = itens.get(chave) or m["escritorio"].get(chave)
        linha = {
            "codigo": chave,
            # % da carta do VENDEDOR; a linha do escritório traz o % da CMS
            "pct_carta": itens[chave]["pct"] if chave in itens else 0,
            "escritorio": m["escritorio"][chave]["bloco"] if chave in m["escritorio"] else dict(VAZIO),
            "vendedor": itens[chave]["bloco"] if chave in itens else dict(VAZIO),
        }
        if ref["marca"] == marca:
            linha["nome"] = NOMES_FAIXA.get(chave, chave.title())
            faixas.append(linha)
        else:
            linha["nome"] = familia(chave, marca) or chave
            familias_.append(linha)
    faixas.sort(key=lambda f: ORDEM_FAIXA.index(f["codigo"]) if f["codigo"] in ORDEM_FAIXA else 99)
    ordem_fam = [n for _, n in FAMILIAS]
    familias_.sort(key=lambda f: ordem_fam.index(f["nome"]) if f["nome"] in ordem_fam else 99)

    ua_rs = 0.0
    if ua and vend in ua["vendedores"]:
        ua_rs = round(sum(i["bloco"]["rs"] for i in ua["vendedores"][vend].values()), 2)

    return {
        "versao": 1,
        "exemplo": False,
        "gerado_em": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "atualizado_em": atualizado_em,
        "origem": origem,
        "marca": marca,
        "mes": mes,
        "carta": m["cartas_vend"].get(vend) or m["carta"],
        "escritorio": m["rep"],
        "vendedor": {"codigo": vend, "nome": m["nomes"].get(vend, vend)},
        "parcelas": [
            {"rotulo": "1ª parcela", "fator": 0.5, "previsao": None},
            {"rotulo": "2ª parcela", "fator": 0.5, "previsao": None},
        ],
        "faixas": faixas,
        "familias": familias_,
        "under_armour": {"rs": ua_rs, "carteira_rs": 0},
    }


def refazer_indice():
    vendedores = {}
    atualizado = ""
    for arq in sorted(PASTA.glob("*/*/*.json")):
        vend, marca, mes = arq.parent.parent.name, arq.parent.name, arq.stem
        doc = json.loads(arq.read_text(encoding="utf-8"))
        v = vendedores.setdefault(vend, {"codigo": vend, "nome": doc["vendedor"]["nome"], "marcas": {}})
        v["marcas"].setdefault(marca, []).append(mes)
        atualizado = max(atualizado, doc.get("atualizado_em") or "")
    indice = {
        "atualizado_em": atualizado,
        "vendedores": sorted(vendedores.values(), key=lambda v: v["nome"]),
    }
    (PASTA / "indice.json").write_text(json.dumps(indice, ensure_ascii=False, indent=1), encoding="utf-8")
    return indice


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    caminho = Path(sys.argv[1])
    quando = dt.datetime.fromtimestamp(os.path.getmtime(caminho)).astimezone().isoformat(timespec="seconds")
    gerados = montar(ler(caminho), quando, caminho.name)
    indice = refazer_indice()
    print(f"{len(gerados)} arquivo(s) gravado(s); índice com {len(indice['vendedores'])} vendedor(es).")


if __name__ == "__main__":
    main()
