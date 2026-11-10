"""Monta amostras/banco.json: todo artigo+cor que temos, com nome e foto.

Fontes, da mais confiável para a menos:
  o Catálogo Digital (apps-oly-v2: Produtos.xlsx, aba corre, produtos_ua.xlsx),
  a Detalhada (data/detalhada.json: referência, cor e nome de tudo que tem pedido),
  data/produtos.json, data/disponibilidades.json, data/dados_produtos.json,
  Produtos.xlsx e, por fim, os arquivos de foto da pasta Catalogo/.
Do Catálogo Digital vem também a COLEÇÃO de cada cor (campo "k"): quem está
na 1S27 está em linha e o cadastro não deixa virar amostra.
A cor é casada ignorando "/" e "_" (PTO/CH = PTO_CH = PTOCH).

Rodar da raiz do repo:  python amostras/gerar_banco.py
"""
import json, os, re

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT = os.path.join(RAIZ, "Catalogo")
V2 = os.path.join(os.path.dirname(RAIZ), "apps-oly-v2")      # Catálogo Digital
V2_IMG = os.path.join(V2, "imagens_olympikus")
MINI = os.path.join(CAT, "mini")

def chave(cor):
    return re.sub(r"[^A-Z0-9]", "", str(cor or "").upper())

banco = {}  # (artigo, chave_cor) -> item

def artigo_ok(a):
    # 43340469, 1290140 e também os de acessório, como OIWB271817
    return bool(re.fullmatch(r"[A-Z0-9]{5,12}", a)) and any(ch.isdigit() for ch in a)

# tipo do produto (campo "y"): calçado fica sem marca; "A" acessório (tamanho U), "C" confecção (tamanho M)
def tipo_catalogo(cat, tam):
    cat = str(cat or "").upper(); tam = str(tam or "").upper()
    if cat in ("ACC", "MEIA"): return "A"
    if cat == "V&A": return "C"
    if cat in ("FTW", "CHI"): return None
    if tam == "U": return "A"
    if "P" in tam and "M" in tam: return "C"
    return None

# pelo nome, quando nenhuma fonte disse o tipo
PAL_CONF = ("CALCA", "CALÇA", "CAMISETA", "CAMISA", "BLUSA", "TOP ", "TOP", "SHORT", "BERMUDA", "JAQUETA", "MOLETOM",
            "REGATA", "LEGGING", "CROPPED", "T-SHIRT", "TSHIRT", "POLO", "VESTIDO", "SAIA", "MACAQUINHO", "CORTA VENTO", "AGASALHO", "CONJUNTO")
PAL_ACC = ("MEIA", "BONE", "BONÉ", "MOCHILA", "BOLSA", "BAG", "VISEIRA", "GARRAFA", "SQUEEZE", "MUNHEQUEIRA", "TESTEIRA",
           "LUVA", "NECESSAIRE", "SACOLA", "POCHETE", "TOALHA", "HEADBAND", "GORRO", "CARTEIRA", "TRIPACK", "KIT MEIA")
def tipo_nome(nome):
    n = " " + str(nome or "").upper() + " "
    if any(" " + p in n for p in PAL_ACC): return "A"
    if any(" " + p in n for p in PAL_CONF): return "C"
    return None

def tipo_detalhada(marca):
    marca = str(marca or "").upper()
    if marca in ("ACOLY", "MEOLY", "UA_AC", "UA_ME"): return "A"
    if marca in ("CFOLY", "UA_CF"): return "C"
    return None

def junta(artigo, cor, nome=None, genero=None, preco=None, colecao=None, imagem=None, tipo=None):
    artigo = str(artigo or "").strip().upper()
    if artigo.endswith(".0"):
        artigo = artigo[:-2]
    cor = str(cor or "").strip().upper()
    if not artigo_ok(artigo) or not cor:
        return
    k = (artigo, chave(cor))
    it = banco.setdefault(k, {"a": artigo, "c": cor})
    # cor com barra é a forma de exibição preferida
    if "/" in cor and "/" not in it["c"]:
        it["c"] = cor
    if nome and not it.get("n"):
        it["n"] = str(nome).strip().upper()
    if genero and not it.get("g"):
        it["g"] = str(genero).strip().capitalize()
    if preco and not it.get("p"):
        try:
            it["p"] = round(float(preco), 2)
        except (TypeError, ValueError):
            pass
    col = str(colecao or "").strip().upper()
    if re.fullmatch(r"[12]S\d\d", col):
        it.setdefault("k", [])
        if col not in it["k"]:
            it["k"].append(col)
    if imagem and not it.get("u"):
        it["u"] = imagem
    if tipo and not it.get("y"):
        it["y"] = tipo

# fotos do Catálogo Digital: nome da coluna IMAGEM + a extensão que existir
v2_fotos = {}
if os.path.isdir(V2_IMG):
    for nome in os.listdir(V2_IMG):
        base, ext = os.path.splitext(nome)
        if ext.lower() in (".jpg", ".jpeg", ".png", ".webp") and "__" not in base:
            if base.upper() not in v2_fotos or ext.lower() == ".jpg":
                v2_fotos[base.upper()] = nome

def le_catalogo_digital():
    import openpyxl
    for arq in ("Produtos.xlsx", "produtos_ua.xlsx"):
        caminho = os.path.join(V2, arq)
        if not os.path.exists(caminho):
            print("Catálogo Digital sem", arq)
            continue
        for ws in openpyxl.load_workbook(caminho, read_only=True, data_only=True).worksheets:
            linhas = ws.iter_rows(values_only=True)
            cab = [str(c or "").strip().upper() for c in next(linhas, [])]
            if "CODIGO" not in cab or "COR" not in cab:
                continue
            ix = {n: i for i, n in enumerate(cab)}
            pega = lambda r, n: r[ix[n]] if n in ix and ix[n] < len(r) else None
            for r in linhas:
                img = str(pega(r, "IMAGEM") or "").strip().upper()
                junta(pega(r, "CODIGO"), pega(r, "COR"), pega(r, "PRODUTO"), pega(r, "GÊNERO"),
                      pega(r, "PREÇO"), pega(r, "COLEÇÃO"), v2_fotos.get(img),
                      tipo_catalogo(pega(r, "CATEGORIA"), pega(r, "TAM")))

def le_json(rel):
    with open(os.path.join(RAIZ, rel), encoding="utf-8") as f:
        return json.load(f)

try:
    le_catalogo_digital()
except Exception as e:
    print("Catálogo Digital ignorado:", e)

# Detalhada: produto com pedido que pode não estar em nenhuma coleção do catálogo
try:
    det = le_json("data/detalhada.json")
    refs, cores, marcas = det["dic"]["ref"], det["dic"]["cor"], det["dic"]["marca"]
    vistos = set()
    for r in det["l"]:
        k = (r[5], r[6])
        if k in vistos:
            continue
        vistos.add(k)
        art, nome = refs[r[5]]
        junta(art, cores[r[6]], nome, tipo=tipo_detalhada(marcas[r[2]]))
except Exception as e:
    print("Detalhada ignorada:", e)

for p in le_json("data/produtos.json"):
    junta(p.get("codigo"), p.get("cor"), p.get("produto"), p.get("genero"), p.get("preco"))

for p in le_json("data/disponibilidades.json"):
    junta(p.get("artigo"), p.get("cor"), p.get("descricao"), p.get("genero"), p.get("pdv"))

for k, v in le_json("data/dados_produtos.json").items():
    art, _, cor = k.partition("|")
    gen = {"F": "Feminino", "M": "Masculino", "U": "Unissex"}.get(v.get("gen"), v.get("gen"))
    junta(art, cor.replace("_", "/"), v.get("nome"), gen, v.get("pdv"))

try:
    import openpyxl
    ws = openpyxl.load_workbook(os.path.join(RAIZ, "Produtos.xlsx"), read_only=True).active
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue
        junta(row[3], row[6], row[4], row[7], row[8])
except Exception as e:  # planilha é só complemento
    print("Produtos.xlsx ignorada:", e)

# fotos: a principal de cada artigo+cor (sem __02, __03...)
fotos = {}
for nome in os.listdir(CAT):
    base, ext = os.path.splitext(nome)
    if ext.lower() not in (".jpg", ".jpeg", ".png") or "__" in base:
        continue
    base = base.replace(".jpg", "")  # casos "X.jpg.jpeg"
    art, _, cor = base.partition("_")
    art = art.upper()
    if not artigo_ok(art) or not cor:
        continue
    k = (art, chave(cor))
    # prefere .jpg com nome limpo
    if k not in fotos or nome.lower().endswith(".jpg"):
        fotos[k] = nome
    if k not in banco:
        junta(art, cor.replace("_", "/"))

for k, it in banco.items():
    f = fotos.get(k)
    if f:
        it["f"] = f
        if os.path.exists(os.path.join(MINI, f)):
            it["m"] = 1
        it.pop("u", None)          # a do nosso banco vale mais
    elif "u" not in it:
        # sem foto no nosso banco: a pasta do Catálogo Digital (a mesma que a Detalhada usa)
        nome_v2 = v2_fotos.get(f'{it["a"]}_{it["c"].replace("/", "_")}'.upper())
        if nome_v2:
            it["u"] = nome_v2
    if "k" in it:
        it["k"].sort()

# cor sem tipo: herda das outras cores do mesmo artigo; na falta, pelo nome
tipo_artigo = {}
for it in banco.values():
    if it.get("y"):
        tipo_artigo.setdefault(it["a"], it["y"])
for it in banco.values():
    if not it.get("y"):
        y = tipo_artigo.get(it["a"]) or tipo_nome(it.get("n"))
        if y:
            it["y"] = y

itens = sorted(banco.values(), key=lambda x: (x["a"], x["c"]))
saida = os.path.join(RAIZ, "amostras", "banco.json")
with open(saida, "w", encoding="utf-8") as f:
    json.dump(itens, f, ensure_ascii=False, separators=(",", ":"))
com_foto = sum(1 for x in itens if "f" in x)
# lista curta das cores em linha, que o Worker confere antes de gravar
linha = sorted(chave(x["a"]) + "|" + chave(x["c"]) for x in itens if "1S27" in x.get("k", []))
from datetime import datetime
os.makedirs(os.path.join(RAIZ, "data", "amostras"), exist_ok=True)
with open(os.path.join(RAIZ, "data", "amostras", "em-linha.json"), "w", encoding="utf-8") as f:
    json.dump({"colecao": "1S27", "geradoEm": datetime.now().isoformat(timespec="seconds"), "cores": linha},
              f, ensure_ascii=False, separators=(",", ":"))

so_v2 = sum(1 for x in itens if "u" in x)
em_linha = sum(1 for x in itens if "1S27" in x.get("k", []))
print(f"{len(itens)} artigo+cor, {com_foto} com foto no Catalogo + {so_v2} só no Catálogo Digital, "
      f"{em_linha} em linha (1S27), {len({x['a'] for x in itens})} artigos -> {saida}")
