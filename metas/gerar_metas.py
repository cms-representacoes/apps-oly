"""
Metas por preposto: relatórios da Vulcabras -> metas/dados/metas.json.

    python metas/gerar_metas.py "C:\\...\\metas.xls" [mais arquivos...]

Lê dois formatos, porque os dois existem hoje no escritório:

  * metas.xls — "Carta Campanha, simples conferência" (.xls antigo). Um
    bloco por preposto, com meta, potencial, realizado, faturamento e
    devolução de cada faixa. É o arquivo do mês corrente.
  * CartaCampanhaAcompanhamentoMeta.xlsx — o acompanhamento, que traz
    vários meses de uma vez, só com meta e realizado.

Cada mês entra no JSON inteiro (todos os prepostos). Importar de novo o
mesmo mês substitui o que estava lá. A tela faz as contas: aqui só sai
número cru.

Enquanto o robô do EBM não existe, a tela também importa o .xls direto no
navegador — este script serve para publicar o histórico de uma vez.
"""
import datetime as dt
import json
import re
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

PASTA = Path(__file__).resolve().parent / "dados"
ARQUIVO = PASTA / "metas.json"

# Colunas do metas.xls (0 = A), conferidas pelo cabeçalho do relatório.
X = dict(marca=0, faixa=3, meta_qtd=6, meta_rs=7, pct_cc=10,
         pot_qtd=15, pot_rs=17, real_qtd=19, real_rs=20,
         fat_qtd=25, fat_rs=26, dev_qtd=28, dev_rs=30, atingiu=43)

# Prefixo do código da marca -> categoria do painel
CATEGORIAS = {"OLY": "calcados", "CHOLY": "chinelos", "CFOLY": "vestuario",
              "ACOLY": "acessorios", "MEOLY": "meias"}


def numero(v):
    """'4,495' -> 4495.0; '' -> None. O relatório grava número como texto."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    if s in ("", "-"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def texto(v):
    return str(v).strip() if v is not None else ""


# A conferência abrevia o nome da faixa ("CORRIDA/TREI") e o acompanhamento
# escreve inteiro ("CORRIDA/TREINO"). Sem unificar, a mesma faixa entra duas
# vezes e a meta do mês dobra.
FAIXA_PADRAO = ["CORRIDA/TREINO", "CONF_MASC", "CONF_FEM", "CLASSICOS",
                "INFANTIL", "CORRE", "VISUAL", "OUTROS"]


def faixa_padrao(f):
    f = (f or "").strip().upper()
    for cheia in FAIXA_PADRAO:
        if f and (cheia.startswith(f) or f.startswith(cheia)):
            return cheia
    return f


def linha_vazia(l):
    return all(l.get(k) in (None, 0) for k in
               ("meta_qtd", "meta_rs", "real_qtd", "real_rs", "pot_qtd", "fat_qtd"))


# ── metas.xls (simples conferência) ──────────────────────────────────────
def ler_xls(caminho):
    import xlrd
    ws = xlrd.open_workbook(str(caminho)).sheet_by_index(0)

    def cel(i, j):
        v = ws.cell_value(i, j)
        return v.strip() if isinstance(v, str) else v

    # "Período:" aparece duas vezes: no cabeçalho do relatório (MM/AAAA) e
    # dentro do bloco de cada preposto (data em número). Só o primeiro vale.
    periodo, visao = "", ""
    for i in range(min(6, ws.nrows)):
        for j in range(ws.ncols):
            rot = texto(cel(i, j))
            if not rot.startswith(("Período", "Visão")):
                continue
            valor = ""
            for k in range(j + 1, min(j + 8, ws.ncols)):
                if texto(cel(i, k)):
                    valor = texto(cel(i, k))
                    break
            if rot.startswith("Período") and not periodo and re.match(r"\d{1,2}/\d{4}", valor):
                periodo = valor
            elif rot.startswith("Visão") and not visao:
                visao = valor
    m = re.match(r"(\d{1,2})/(\d{4})", periodo)
    if not m:
        sys.exit("Não achei o período (MM/AAAA) no cabeçalho de %s" % caminho.name)
    mes = "%s-%02d" % (m.group(2), int(m.group(1)))

    prepostos, atual, marca = [], None, ""
    for i in range(ws.nrows):
        a, faixa = texto(cel(i, X["marca"])), texto(cel(i, X["faixa"]))
        cab = re.match(r"^(\d{4,9})\s*-\s*(.+)$", a)
        if cab:
            atual = {"codigo": cab.group(1), "nome": cab.group(2).strip(), "linhas": []}
            prepostos.append(atual)
            marca = ""
            continue
        if atual is None:
            continue
        if a.upper().startswith("TOTAL"):
            continue                      # os totais a tela refaz
        if a and " - " in a:
            marca = a.split(" - ")[0].strip().upper()
        if not faixa or faixa.upper() == "OUTROS":
            continue
        l = {"marca": marca or faixa_padrao(faixa), "faixa": faixa_padrao(faixa),
             "atingiu": texto(cel(i, X["atingiu"]))}
        for campo in ("meta_qtd", "meta_rs", "pot_qtd", "pot_rs", "real_qtd",
                      "real_rs", "fat_qtd", "fat_rs", "dev_qtd", "dev_rs", "pct_cc"):
            l[campo] = numero(cel(i, X[campo]))
        if not linha_vazia(l):
            atual["linhas"].append(l)

    return [{"mes": mes, "origem": caminho.name, "visao": visao,
             "importado_em": agora(), "prepostos": [p for p in prepostos if p["linhas"]]}]


# ── CartaCampanhaAcompanhamentoMeta.xlsx (vários meses) ──────────────────
def ler_xlsx(caminho):
    import openpyxl
    ws = openpyxl.load_workbook(str(caminho), data_only=True).worksheets[0]
    linhas = list(ws.iter_rows(values_only=True))

    def conserta(v):
        if isinstance(v, str):
            try:
                return v.encode("latin1").decode("utf-8")
            except (UnicodeEncodeError, UnicodeDecodeError):
                return v
        return v

    meses = {}
    for r in linhas[2:]:
        if not r or r[0] in (None, ""):
            continue
        mes = "%04d-%02d" % (int(r[1]), int(r[0]))
        prep = texto(conserta(r[8])).replace(".0", "")
        if not prep:
            continue                      # linha do escritório inteiro
        nome = texto(conserta(r[9]))
        marca = texto(conserta(r[17])).upper()
        faixa = texto(conserta(r[19])).upper()
        if faixa == "OUTROS":
            continue
        m = meses.setdefault(mes, {})
        p = m.setdefault(prep, {"codigo": prep, "nome": nome, "linhas": []})
        p["linhas"].append({
            "marca": marca, "faixa": faixa_padrao(faixa),
            "meta_qtd": numero(r[20]), "meta_rs": numero(r[21]),
            "pot_qtd": None, "pot_rs": None,
            "real_qtd": numero(r[29]), "real_rs": numero(r[30]),
            "fat_qtd": None, "fat_rs": None, "dev_qtd": None, "dev_rs": None,
            "pct_cc": numero(r[23]), "atingiu": texto(conserta(r[26])),
        })
    return [{"mes": mes, "origem": caminho.name, "visao": "",
             "importado_em": agora(),
             "prepostos": [p for p in ps.values() if p["linhas"]]}
            for mes, ps in sorted(meses.items())]


# ── pasta da Carta Campanha (carta/dados) ────────────────────────────────
def ler_carta(pasta):
    """Aproveita o histórico que a Carta Campanha já converteu.

    São os mesmos meses da Vulcabras, só que por vendedor e sem potencial
    nem devolução: serve para o gráfico ao longo do tempo não nascer com
    um mês só."""
    meses = {}
    for arq in sorted(Path(pasta).glob("*/*/*.json")):
        doc = json.loads(arq.read_text(encoding="utf-8"))
        if doc.get("exemplo"):
            continue                      # o set/26 montado para teste fica de fora
        mes = doc["mes"]
        p = meses.setdefault(mes, {}).setdefault(doc["vendedor"]["codigo"], {
            "codigo": doc["vendedor"]["codigo"], "nome": doc["vendedor"]["nome"], "linhas": []})
        for grupo, ehFaixa in ((doc.get("faixas") or [], True), (doc.get("familias") or [], False)):
            for f in grupo:
                v = f.get("vendedor") or {}
                l = {"marca": doc.get("marca", "OLY") if ehFaixa else f["codigo"],
                     "faixa": faixa_padrao(f["codigo"]),
                     "meta_qtd": v.get("meta_qtd"), "meta_rs": v.get("meta_rs"),
                     "pot_qtd": None, "pot_rs": None,
                     "real_qtd": v.get("qtd"), "real_rs": v.get("rs"),
                     "fat_qtd": None, "fat_rs": None, "dev_qtd": None, "dev_rs": None,
                     "pct_cc": f.get("pct_carta"), "atingiu": ""}
                if l["faixa"] != "OUTROS" and not linha_vazia(l):
                    p["linhas"].append(l)
    return [{"mes": mes, "origem": "carta/dados", "visao": "",
             "importado_em": agora(),
             "prepostos": [p for p in ps.values() if p["linhas"]]}
            for mes, ps in sorted(meses.items())]


# ── CartaCampanhaNotas.xlsx (nota a nota) ────────────────────────────────
# Quando o EBM exporta a conferência sem o realizado, este relatório salva:
# ele traz preposto, faixa, quantidade e valor de cada nota, com FAT e DEV
# (a devolução já vem negativa). Some tudo e sai o realizado do mês.
N = dict(preposto=6, nome=7, movimento=8, data=12, faixa=21, marca=22, valor=25, qtd=26)


MES_NOME = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho",
            "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]


def mes_pelo_nome(nome):
    """'Notas Janeiro.xlsx' ou 'notas 01-2026.xlsx' -> '2026-01'.

    O relatório de notas não diz de que apuração é; o nome do arquivo, sim,
    e ele é mais confiável do que adivinhar pela data das notas."""
    limpo = nome.lower()
    for ch, novo in (("ç", "c"), ("ã", "a"), ("á", "a"), ("é", "e"), ("ê", "e"), ("í", "i"), ("ó", "o")):
        limpo = limpo.replace(ch, novo)
    achado = re.search(r"(\d{2})[-_ ](\d{4})", limpo)
    if achado:
        return "%s-%s" % (achado.group(2), achado.group(1))
    ano = re.search(r"(20\d{2})", limpo)
    for i, m in enumerate(MES_NOME, 1):
        if m in limpo:
            return "%s-%02d" % (ano.group(1) if ano else dt.date.today().year, i)
    return None


def ler_notas(caminho):
    import openpyxl
    ws = openpyxl.load_workbook(str(caminho), data_only=True).worksheets[0]
    linhas = list(ws.iter_rows(values_only=True))[2:]

    # O relatório não diz de que apuração é: o mês é o das notas, e a
    # apuração puxa devolução de meses anteriores, então vale a maioria.
    contagem = {}
    for r in linhas:
        d = texto(r[N["data"]])
        if len(d) == 10:
            contagem[d[6:10] + "-" + d[3:5]] = contagem.get(d[6:10] + "-" + d[3:5], 0) + 1
    if not contagem:
        sys.exit("Sem data de nota em %s" % caminho.name)
    mes = mes_pelo_nome(caminho.name) or max(contagem, key=contagem.get)

    prepostos = {}
    for r in linhas:
        cod = texto(r[N["preposto"]])
        if not cod:
            continue
        faixa = texto(r[N["faixa"]]).upper()
        if not faixa or faixa == "OUTROS":
            continue
        marca = texto(r[N["marca"]]).split(" - ")[0].strip().upper()
        faixa = faixa_padrao(faixa)
        p = prepostos.setdefault(cod, {"codigo": cod, "nome": texto(r[N["nome"]]), "linhas": {}})
        l = p["linhas"].setdefault((marca, faixa), {
            "marca": marca, "faixa": faixa, "meta_qtd": None, "meta_rs": None,
            "pot_qtd": None, "pot_rs": None, "real_qtd": 0.0, "real_rs": 0.0,
            "fat_qtd": 0.0, "fat_rs": 0.0, "dev_qtd": 0.0, "dev_rs": 0.0,
            "pct_cc": None, "atingiu": ""})
        q, v = numero(r[N["qtd"]]) or 0, numero(r[N["valor"]]) or 0
        l["real_qtd"] += q
        l["real_rs"] += v
        alvo = "dev" if texto(r[N["movimento"]]).upper() == "DEV" else "fat"
        l[alvo + "_qtd"] += q
        l[alvo + "_rs"] += v

    saida = []
    for p in prepostos.values():
        p["linhas"] = [dict(l, real_rs=round(l["real_rs"], 2), fat_rs=round(l["fat_rs"], 2),
                            dev_rs=round(l["dev_rs"], 2)) for l in p["linhas"].values()]
        saida.append(p)
    return [{"mes": mes, "origem": caminho.name, "visao": "", "importado_em": agora(),
             "so_realizado": True, "prepostos": saida}]


def agora():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def combinar(antigo, novo):
    """Junta duas leituras do mesmo mês, campo a campo.

    A conferência do EBM às vezes sai só com a meta, e o relatório de
    notas só tem o realizado: quem tem valor preenche, quem não tem
    respeita o que já estava lá."""
    if not antigo:
        return novo
    indice = {}
    for p in antigo["prepostos"]:
        for l in p["linhas"]:
            indice[(p["codigo"], l["marca"], l["faixa"])] = l
    usadas = set()
    for p in novo["prepostos"]:
        for l in p["linhas"]:
            chave = (p["codigo"], l["marca"], l["faixa"])
            usadas.add(chave)
            velha = indice.get(chave)
            if not velha:
                continue
            for campo, valor in velha.items():
                if l.get(campo) in (None, "") and valor not in (None, ""):
                    l[campo] = valor
    # linha que existia e não veio na leitura nova continua valendo
    por_prep = {p["codigo"]: p for p in novo["prepostos"]}
    for p in antigo["prepostos"]:
        for l in p["linhas"]:
            if (p["codigo"], l["marca"], l["faixa"]) in usadas:
                continue
            destino = por_prep.get(p["codigo"])
            if destino is None:
                destino = {"codigo": p["codigo"], "nome": p["nome"], "linhas": []}
                por_prep[p["codigo"]] = destino
                novo["prepostos"].append(destino)
            destino["linhas"].append(l)
    if novo.get("so_realizado") and antigo.get("origem"):
        novo["origem"] = antigo["origem"] + " + " + novo["origem"]
    return novo


def juntar(base, novos):
    """Mês importado de novo substitui o anterior."""
    por_mes = {m["mes"]: m for m in base.get("meses", [])}
    for m in novos:
        # Mês sem nenhum preposto (exportação só do escritório) não pode
        # apagar um mês bom que já estava no arquivo.
        if not m["prepostos"] and por_mes.get(m["mes"], {}).get("prepostos"):
            continue
        por_mes[m["mes"]] = combinar(por_mes.get(m["mes"]), m)
    base["meses"] = [por_mes[k] for k in sorted(por_mes)]
    base["atualizado_em"] = agora()
    base["versao"] = 1
    base["categorias"] = CATEGORIAS
    return base


def ler(caminho):
    """Escolhe o leitor pelo arquivo: notas, conferência ou acompanhamento."""
    if "nota" in caminho.name.lower():
        return ler_notas(caminho)
    if caminho.suffix.lower() == ".xls":
        return ler_xls(caminho)
    return ler_xlsx(caminho)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    base = {}
    if ARQUIVO.exists():
        base = json.loads(ARQUIVO.read_text(encoding="utf-8"))
    novos = []
    for arg in sys.argv[1:]:
        caminho = Path(arg)
        if not caminho.exists():
            sys.exit("Não encontrei %s" % caminho)
        if caminho.is_dir():
            # pasta com os relatórios do EBM (um .xls por mês) ou a pasta de
            # dados da Carta Campanha
            # o acompanhamento (.xlsx) entra primeiro e a simples
            # conferência (.xls) depois, porque é ela que bate com o BI
            planilhas = sorted(caminho.glob("*.xlsx")) + sorted(caminho.glob("*.xls"))
            if planilhas:
                for x in planilhas:
                    novos += ler(x)
            else:
                novos += ler_carta(caminho)
        else:
            novos += ler(caminho)
    base = juntar(base, novos)
    PASTA.mkdir(parents=True, exist_ok=True)
    ARQUIVO.write_text(json.dumps(base, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("%d mês(es) no arquivo: %s" % (len(base["meses"]), ", ".join(m["mes"] for m in base["meses"])))
    for m in base["meses"]:
        print("  %s  %d preposto(s)  %d linha(s)  [%s]" % (
            m["mes"], len(m["prepostos"]), sum(len(p["linhas"]) for p in m["prepostos"]), m["origem"]))


if __name__ == "__main__":
    main()
