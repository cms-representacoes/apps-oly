"""Copia as demais áreas do portal (data/, carta/, metas/, apps-oly-v2/data)
para o Supabase.

Gera um SQL por área numa pasta de saída; cada um esvazia e recarrega as
suas tabelas sem disparar a auditoria. A Detalhada vai em partes, para não
estourar o tamanho de uma chamada. Pode rodar quantas vezes precisar até a
virada: o GitHub continua sendo a fonte.

Uso:  py -I supabase/scripts/carga_areas.py <pasta-de-saida>
      (depois roda cada .sql, em ordem, com supabase/scripts/sql.ps1)
"""
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from carga_cadastro import carga, perfis, texto  # noqa: E402

APPS = Path(__file__).resolve().parents[2]
DATA = APPS / "data"
V2 = APPS.parent / "apps-oly-v2"
EPOCA = date(1970, 1, 1)


def ler(caminho):
    return json.loads(Path(caminho).read_text(encoding="utf-8"))


def separar(obj, mapa):
    """Leva os campos de `mapa` (origem -> coluna) e guarda o resto em extra."""
    linha = {col: obj.get(orig) for orig, col in mapa.items()}
    linha["extra"] = {k: v for k, v in obj.items() if k not in mapa}
    return linha


def data_br(v):
    v = texto(v)
    if not v:
        return None
    try:
        return datetime.strptime(v, "%d/%m/%Y").date().isoformat()
    except ValueError:
        return None


def dia(n):
    return (EPOCA + timedelta(days=n)).isoformat() if n else None


def ms(v):
    return datetime.fromtimestamp(v / 1000, timezone.utc).isoformat() if v else None


# Nome que aparece nas bases (Detalhada, Carteira) -> código do perfil
def codigos_por_nome():
    mapa = {}
    for p in perfis():
        mapa[p["nome"].upper()] = p["codigo"]
        mapa[p["nome"].split()[0].upper()] = p["codigo"]
    mapa["C M S"] = mapa["CMS"]
    return mapa


LIMITE = 1_200_000  # a API do Supabase recusa chamadas de ~2 MB para cima


def em_pedacos(tabela, linhas):
    """Um insert por pedaço de até LIMITE bytes de JSON."""
    pedaco, tamanho = [], 0
    for linha in linhas:
        t = len(json.dumps(linha, ensure_ascii=False).encode("utf-8"))
        if pedaco and tamanho + t > LIMITE:
            yield carga(tabela, pedaco)
            pedaco, tamanho = [], 0
        pedaco.append(linha)
        tamanho += t
    if pedaco:
        yield carga(tabela, pedaco)


def bloco(tabelas_truncar, cargas):
    """Lista de comandos: o truncate primeiro, depois os inserts em pedaços."""
    sql = [f"truncate {', '.join(tabelas_truncar)};\n"] if tabelas_truncar else []
    for t, l in cargas:
        sql += list(em_pedacos(t, l))
    return sql


# ─── Repasse ──────────────────────────────────────────────────────────
def repasse():
    pedidos, itens, eventos = [], [], []
    for p in ler(DATA / "pedidos.json"):
        linha = separar(p, {
            "id": "id", "createdAt": "criado_em", "updatedAt": "atualizado_em", "status": "status",
            "archived": "arquivado", "isDuplicate": "duplicado", "clienteCodigo": "cliente",
            "clienteNome": "cliente_nome", "prazo": "prazo", "campanha": "campanha",
            "observacoes": "observacoes", "exportedAt": "exportado_em", "lastAction": "ultima_acao",
            "lastActionLabel": "ultima_acao_rotulo", "lastActionAt": "ultima_acao_em",
            "preposto": None, "totals": None, "items": None, "history": None})
        linha.pop(None, None)
        linha["arquivado"] = bool(linha["arquivado"])
        linha["duplicado"] = bool(linha["duplicado"])
        linha["preposto"] = p["preposto"]["codigo"]
        linha["preposto_nome"] = p["preposto"].get("nome")
        linha["total_caixas"] = (p.get("totals") or {}).get("packs")
        linha["total_pares"] = (p.get("totals") or {}).get("units")
        pedidos.append(linha)
        for i, it in enumerate(p.get("items") or []):
            li = separar(it, {"codigo": "artigo", "produto": "descricao", "cor": "cor", "num": "lote",
                              "gci": "gci", "ebm": "ebm", "amount": "quantidade", "mode": "modo",
                              "packSize": "por_caixa", "totalUnits": "pares", "grade": "grade",
                              "prevFaturamento": "prev_faturamento"})
            li.update(pedido_id=p["id"], ordem=i)
            itens.append(li)
        for h in p.get("history") or []:
            le = separar(h, {"eventId": "evento_id", "at": "em", "action": "acao", "label": "rotulo",
                             "statusFrom": "status_de", "statusTo": "status_para",
                             "archivedFrom": "arquivado_de", "archivedTo": "arquivado_para",
                             "prepostoCodigo": "preposto", "notes": "notas", "meta": "meta"})
            le["pedido_id"] = p["id"]
            eventos.append(le)

    campanhas = []
    for c in ler(DATA / "campanhas.json"):
        l = separar(c, {"id": "id", "nome": "nome", "valor": "valor", "inicio": "inicio", "fim": "fim",
                        "produtos": "produtos", "cores": "cores", "vendedores": "vendedores", "conta": "conta",
                        "teto": "teto", "mostrarValor": "mostrar_valor", "mostrarPosicao": "mostrar_posicao",
                        "pausada": "pausada", "criadaEm": "criada_em"})
        l["pausada"] = bool(l["pausada"])
        campanhas.append(l)

    rateio = [{"lote": k, "selo": v.get("_selo"), "divisao": {a: b for a, b in v.items() if a != "_selo"}}
              for k, v in ler(DATA / "rateio.json").items()]
    ocultos = [{"chave": k} for k in ler(DATA / "ocultos.json")]

    links = []
    for cod, l in ler(DATA / "links_compartilhados.json").items():
        x = separar(l, {"vendedor": "vendedor", "vendedorNome": "vendedor_nome", "cliente": "cliente",
                        "clienteNome": "cliente_nome", "marca": "marca", "produtos": "produtos",
                        "validadeHoras": "validade_horas", "status": "status", "resposta": "resposta",
                        "criadoEm": None, "expiraEm": None, "respondidoEm": None})
        x.pop(None, None)
        x.update(codigo=cod, criado_em=ms(l.get("criadoEm")), expira_em=ms(l.get("expiraEm")),
                 respondido_em=ms(l["respondidoEm"]) if isinstance(l.get("respondidoEm"), (int, float)) else l.get("respondidoEm"))
        links.append(x)

    desejos = []
    for arq in sorted((DATA / "desejos").glob("*.json")):
        desejos += [{"preposto": arq.stem, "item": i} for i in dict.fromkeys(ler(arq))]
    desm = [{"chave": k, "dados": v} for k, v in ler(DATA / "desmembramentos.json").items()]

    return bloco(
        ["repasse.pedido_eventos", "repasse.pedido_itens", "repasse.pedidos", "repasse.campanhas",
         "repasse.rateio", "repasse.lotes_ocultos", "repasse.links_vitrine", "repasse.desejos",
         "repasse.desmembramentos"],
        [("repasse.pedidos", pedidos), ("repasse.pedido_itens", itens), ("repasse.pedido_eventos", eventos),
         ("repasse.campanhas", campanhas), ("repasse.rateio", rateio), ("repasse.lotes_ocultos", ocultos),
         ("repasse.links_vitrine", links), ("repasse.desejos", desejos), ("repasse.desmembramentos", desm)]), {
        "pedidos": len(pedidos), "itens": len(itens), "eventos": len(eventos), "campanhas": len(campanhas),
        "rateio": len(rateio), "ocultos": len(ocultos), "links": len(links), "desejos": len(desejos)}


# ─── Fábrica ──────────────────────────────────────────────────────────
def fabrica():
    dispo = []
    for d in ler(DATA / "dispo.json"):
        l = separar(d, {"num": "lote", "ebm": "ebm", "gci": "gci", "filial": "filial", "codigo": "artigo",
                        "produto": "descricao", "cor": "cor", "pedidoMae": "pedido_mae", "saldo": "saldo",
                        "grade": "grade", "dataEntrega": None})
        l.pop(None, None)
        l["data_entrega"] = data_br(d.get("dataEntrega"))
        dispo.append(l)
    canc = []
    for c in ler(DATA / "cancelamentos-dispo.json"):
        l = separar(c, {"id": "id", "num": "lote", "gci": "gci", "codigo": "artigo", "produto": "descricao",
                        "cor": "cor", "filial": "filial", "caixas": "caixas", "porCaixa": "por_caixa",
                        "pares": "pares", "saldoAntes": "saldo_antes", "saldoDepois": "saldo_depois",
                        "total": "total", "motivo": "motivo", "obs": "obs", "por": "por", "em": "em",
                        "dataEntrega": None})
        l.pop(None, None)
        l["data_entrega"] = data_br(c.get("dataEntrega"))
        canc.append(l)
    disp = []
    for d in ler(DATA / "disponibilidades.json"):
        disp.append(separar(d, {
            "marca": "marca", "prevFat": "prev_fat", "empresa": "empresa", "artigo": "artigo",
            "descricao": "descricao", "cor": "cor", "linha": "linha", "genero": "genero",
            "categoria": "categoria", "categoriaOriginal": "categoria_original",
            "categoriaProduto": "categoria_produto", "pdv": "pdv", "totalGeral": "total",
            "codigoTabela": "codigo_tabela", "mkp": "mkp", "custo": "custo", "imagem": "imagem",
            "grade": "grade", "quinzenas": "quinzenas", "tabelasEspeciais": "tabelas_especiais"}))
    for l in disp:
        for c in ("mkp", "custo"):
            l[c] = None if l[c] in ("", None) else str(l[c])
    ocultos = [{"chave": k if isinstance(k, str) else json.dumps(k)} for k in ler(DATA / "ocultos_disponibilidades.json")]
    imagens = [{"chave": k, "imagem": v} for k, v in ler(DATA / "disponibilidades_imagens.json").items()]
    prods = [{"chave": k, "nome": v.get("nome"), "categoria": v.get("cat"), "genero": v.get("gen"), "pdv": v.get("pdv")}
             for k, v in ler(DATA / "dados_produtos.json").items()]
    grades = []
    for familia in ("corre", "geral"):
        g = ler(DATA / f"grade-{familia}.json")
        # CORRE vem numa aba só; GERAL, em blocos (uma aba por marca/tipo)
        for b in g.get("blocos") or [{"aba": g.get("aba") or "", "cab": g["cab"], "l": g["l"]}]:
            for i, linha in enumerate(b["l"]):
                grades.append({"familia": familia, "aba": b["aba"], "linha": i, "dados": dict(zip(b["cab"], linha))})
    sql = bloco(
        ["fabrica.dispo", "fabrica.dispo_cancelamentos", "fabrica.disponibilidades",
         "fabrica.disponibilidades_ocultos", "fabrica.imagens", "fabrica.produtos_disponibilidade",
         "fabrica.grade_carteira"],
        [("fabrica.dispo", dispo), ("fabrica.dispo_cancelamentos", canc), ("fabrica.disponibilidades", disp),
         ("fabrica.disponibilidades_ocultos", ocultos), ("fabrica.imagens", imagens),
         ("fabrica.produtos_disponibilidade", prods), ("fabrica.grade_carteira", grades)])
    pubs = []
    for familia in ("corre", "geral"):
        g = ler(DATA / f"grade-{familia}.json")
        pubs.append({"base": f"grade-{familia}", "origem": g.get("origem"), "gerado_em": g.get("gerado"),
                     "publicado_em": g.get("publicadoEm"), "por": g.get("por"),
                     "linhas": sum(len(b["l"]) for b in g.get("blocos") or [g])})
    return sql + bloco([], [("sistema.publicacoes", pubs)]), {
        "dispo": len(dispo), "cancelamentos": len(canc), "disponibilidades": len(disp),
        "imagens": len(imagens), "produtos_disp": len(prods), "grades": len(grades)}


# ─── Carteira ─────────────────────────────────────────────────────────
def carteira():
    nomes = codigos_por_nome()
    d = ler(DATA / "detalhada.json")
    dic = d["dic"]

    def at(campo, i):
        return dic[campo][i] if i is not None and 0 <= i < len(dic[campo]) else None

    linhas = []
    for r in d["l"]:
        r = r + [None] * (17 - len(r))
        cli = at("cli", r[1]) or [None, None]
        ref = at("ref", r[5]) or [None, None]
        prep = at("prep", r[0])
        linhas.append({
            "preposto": nomes.get((prep or "").upper()), "preposto_nome": prep,
            "cliente": str(cli[0]) if cli[0] is not None else None, "cliente_nome": cli[1],
            "marca": at("marca", r[2]), "fabrica": at("fab", r[3]), "filial": at("fil", r[4]),
            "referencia": str(ref[0]) if ref[0] is not None else None, "descricao": ref[1],
            "cor": at("cor", r[6]), "gci": str(r[7]) if r[7] else None, "nf": str(r[8]) if r[8] else None,
            "oc": at("oc", r[9]) if r[9] is not None and r[9] >= 0 else None,
            "prev_fat": dia(r[10]), "cart": r[11] or 0, "fat": r[12] or 0, "data_fat": dia(r[13]),
            "faixa": at("faixa", r[14]),
            "cod_comercial": str(at("comer", r[15])) if r[15] is not None and at("comer", r[15]) is not None else None,
            "cod_financeiro": str(at("finan", r[16])) if r[16] is not None and at("finan", r[16]) is not None else None,
        })

    mov, mdic = d.get("mov") or {}, (d.get("mov") or {}).get("dic", {})

    def mat(campo, i):
        lista = mdic.get(campo, [])
        return lista[i] if isinstance(i, int) and 0 <= i < len(lista) else None

    movimento = []
    for e in mov.get("ev", []):
        ref = mat("ref", e[3]) or [None, None]
        cli = mat("cli", e[5]) or [None, None]
        prep = mat("prep", e[6])
        movimento.append({
            "dia": dia(e[0]), "tipo": e[1], "gci": str(e[2]) if e[2] else None,
            "referencia": str(ref[0]) if ref[0] is not None else None, "descricao": ref[1],
            "cor": mat("cor", e[4]), "cliente": str(cli[0]) if cli[0] is not None else None,
            "cliente_nome": cli[1], "preposto": nomes.get((prep or "").upper()), "preposto_nome": prep,
            "marca": mat("marca", e[7]), "faixa": mat("faixa", e[8]), "prev_fat": dia(e[9]) if e[9] and e[9] > 0 else None,
            "quantidade": e[10], "motivo": e[11] or None, "fat_antes": e[12]})

    prev0 = [{"chave": k, "cliente": k.split("|")[0], "prev_fat": dia(v)}
             for k, v in ((d.get("prev0") or {}).get("k") or {}).items()]

    cms = ler(DATA / "carteira-cms.json")
    cart = [{
        "cliente": texto(p.get("cliente_cod")), "preposto": nomes.get((p.get("preposto") or "").upper()),
        "preposto_nome": p.get("preposto"), "marca": p.get("marca"), "tipo": p.get("tipo"),
        "artigo": p.get("artigo"), "descricao": p.get("descricao"), "cor": p.get("cor"),
        "gci": texto(p.get("gci")), "ebm": texto(p.get("ebm")), "grade": p.get("grade"),
        "total": p.get("total"), "preco_unit": p.get("preco_unit"), "total_preco": p.get("total_preco"),
        "prev_fat": p.get("prev_fat"), "acao": p.get("acao"), "dados": p} for p in cms["pedidos"]]

    ac = ler(DATA / "carteira-cms-acoes.json")
    acoes = [{"chave": k, "cliente": k.split("|")[0], "acao": v.get("acao"), "repasse": v.get("repasse"),
              "por": ac.get("por"), "atualizado_em": ac.get("atualizadoEm")} for k, v in ac["acoes"].items()]

    fat = []
    for cli, arts in ler(DATA / "carteira-cms-faturados.json")["faturados"].items():
        for art, v in arts.items():
            for cor, pares in (v.get("cores") or {}).items():
                fat.append({"cliente": cli, "artigo": art, "descricao": v.get("desc"), "cor": cor, "pares": pares})

    cortes = []
    for arq in sorted((DATA / "giro-cortes").glob("*.json")):
        g = ler(arq)
        cortes.append({"cliente": g.get("cliente") or arq.stem, "itens": g.get("itens") or [],
                       "atualizado_em": g.get("atualizadoEm"), "por": g.get("por")})

    partes = bloco(["carteira.detalhada", "carteira.movimento", "carteira.primeira_previsao",
                    "carteira.carteira_cms", "carteira.acoes", "carteira.faturados", "carteira.giro_cortes"],
                   [("carteira.movimento", movimento), ("carteira.primeira_previsao", prev0),
                    ("carteira.carteira_cms", cart), ("carteira.acoes", acoes),
                    ("carteira.faturados", fat), ("carteira.giro_cortes", cortes),
                    ("carteira.detalhada", linhas)])
    info = ler(DATA / "detalhada-info.json")
    partes += bloco([], [("sistema.publicacoes", [{
        "base": "detalhada", "origem": info.get("origem"), "gerado_em": info.get("gerado"),
        "publicado_em": info.get("publicadoEm"), "linhas": info.get("linhas"), "por": info.get("por")}])])
    sem_codigo = sorted({l["preposto_nome"] for l in linhas if l["preposto_nome"] and not l["preposto"]})
    return partes, {"detalhada": len(linhas), "movimento": len(movimento), "prev0": len(prev0),
                    "carteira_cms": len(cart), "acoes": len(acoes), "faturados": len(fat),
                    "giro_cortes": len(cortes), "prepostos_sem_codigo": sem_codigo}


# ─── Catálogo ─────────────────────────────────────────────────────────
def catalogo():
    pedidos, itens, rasc, vistos = [], [], [], set()
    for arq in sorted((DATA / "catalogo-historico").glob("*.json")):
        origem = "vitrine" if arq.stem.startswith("vitrine-") else "catalogo"
        dono = arq.stem.split("-")[-1]
        for p in ler(arq):
            # O histórico tem pedido gravado duas vezes, idêntico: fica um só
            if p["id"] in vistos:
                continue
            vistos.add(p["id"])
            l = separar(p, {"id": "id", "createdAt": "criado_em", "comissionista": "preposto",
                            "comissionistaNome": "preposto_nome", "clientCode": "cliente",
                            "payment": "pagamento", "priceTable": "tabela_preco", "campaign": "campanha",
                            "dataDesejada": "data_desejada", "pedidoCliente": "pedido_cliente",
                            "totalItens": "total_itens", "valorTotal": "valor_total", "items": None})
            l.pop(None, None)
            l["preposto"] = l["preposto"] or dono
            l["origem"] = origem
            pedidos.append(l)
            for i, it in enumerate(p.get("items") or []):
                itens.append({"pedido_id": p["id"], "ordem": i, "artigo": it.get("codigo"),
                              "descricao": it.get("produto"), "cor": it.get("cor"),
                              "quantidade": it.get("totalQty", it.get("qty")), "preco": it.get("preco"),
                              "dados": it})
    for arq in sorted((DATA / "catalogo-rascunhos").glob("*.json")):
        for r in ler(arq):
            rasc.append({"id": r.get("id") or f"{arq.stem}-{len(rasc)}", "preposto": arq.stem, "dados": r})
    return bloco(["catalogo.pedido_itens", "catalogo.pedidos", "catalogo.rascunhos"],
                 [("catalogo.pedidos", pedidos), ("catalogo.pedido_itens", itens), ("catalogo.rascunhos", rasc)]), {
        "pedidos": len(pedidos), "itens": len(itens), "rascunhos": len(rasc)}


# ─── Matriz ───────────────────────────────────────────────────────────
def matriz():
    m = ler(DATA / "matriz_estoque.json")
    lojas, itens, pend = [], [], []
    for lj in m["lojas"]:
        l = separar(lj, {"codigo": "codigo", "nome": "nome", "cidade": "cidade", "token": "token",
                         "ultimaAtualizacaoLoja": "ultima_atualizacao", "marcas": None})
        l.pop(None, None)
        lojas.append(l)
        for marca, lista in (lj.get("marcas") or {}).items():
            for it in lista:
                x = separar(it, {"id": "item_id", "artigo": "artigo", "descricao": "descricao", "cor": "cor",
                                 "preposto": "preposto", "estoqueAtual": "estoque", "venda": "venda",
                                 "atualizadoEm": "atualizado_em"})
                x.update(loja=lj["codigo"], marca=marca)
                itens.append(x)
    for p in m.get("pendentes", []):
        pend.append(separar(p, {"id": "id", "tipo": "tipo", "lojaCodigo": "loja", "lojaNome": "loja_nome",
                                "marca": "marca", "itemId": "item_id", "artigo": "artigo", "descricao": "descricao",
                                "cor": "cor", "status": "status", "criadoEm": "criado_em",
                                "resolvidoEm": "resolvido_em"}))
    return bloco(["matriz.itens", "matriz.pendentes", "matriz.lojas"],
                 [("matriz.lojas", lojas), ("matriz.itens", itens), ("matriz.pendentes", pend)]), {
        "lojas": len(lojas), "itens": len(itens), "pendentes": len(pend)}


# ─── Relatórios e documentos ──────────────────────────────────────────
def relatorios():
    carta = []
    for arq in sorted((APPS / "carta" / "dados").glob("*/*/*.json")):
        carta.append({"preposto": arq.parts[-3], "marca": arq.parts[-2], "mes": arq.stem, "dados": ler(arq)})
    metas_doc = ler(APPS / "metas" / "dados" / "metas.json")
    metas = [{"mes": m["mes"], "dados": m} for m in metas_doc["meses"]]
    docs = [
        {"chave": "carta/indice", "app": "carta", "dados": ler(APPS / "carta" / "dados" / "indice.json"), "origem": "carta/dados/indice.json"},
        {"chave": "metas/geral", "app": "metas", "dados": {k: v for k, v in metas_doc.items() if k != "meses"}, "origem": "metas/dados/metas.json"},
        {"chave": "status/portal", "app": "portal", "dados": ler(DATA / "app_status.json"), "origem": "data/app_status.json"},
        {"chave": "status/vitrine", "app": "vitrine", "dados": ler(DATA / "vitrine_status.json"), "origem": "data/vitrine_status.json"},
        {"chave": "repasse/novidades", "app": "repasses", "dados": ler(DATA / "novidades-repasse.json"), "origem": "data/novidades-repasse.json"},
        {"chave": "vitrine/reativar", "app": "vitrine", "dados": ler(DATA / "reativar.json"), "origem": "data/reativar.json"},
    ]
    for arq in sorted((V2 / "data").glob("*.json")):
        docs.append({"chave": f"v2/{arq.stem}", "app": "apps-oly-v2", "dados": ler(arq), "origem": f"apps-oly-v2/data/{arq.name}"})
    status = [
        {"app": "portal", "pausado": bool(ler(DATA / "app_status.json").get("paused")),
         "mensagem": ler(DATA / "app_status.json").get("message") or ""},
        {"app": "vitrine", "pausado": bool(ler(DATA / "vitrine_status.json").get("pausada")),
         "mensagem": ler(DATA / "vitrine_status.json").get("motivo") or ""},
    ]
    return bloco(["relatorios.carta", "relatorios.metas", "sistema.documentos", "sistema.status_app"],
                 [("relatorios.carta", carta), ("relatorios.metas", metas), ("sistema.documentos", docs),
                  ("sistema.status_app", status)]), {
        "carta": len(carta), "metas": len(metas), "documentos": len(docs)}


def main(saida):
    pasta = Path(saida)
    pasta.mkdir(parents=True, exist_ok=True)
    n = 0
    for nome, gerar in (("repasse", repasse), ("fabrica", fabrica), ("carteira", carteira),
                        ("catalogo", catalogo), ("matriz", matriz), ("relatorios", relatorios)):
        comandos, contagem = gerar()
        # Junta os comandos em arquivos abaixo do limite; cada arquivo é uma transação
        arquivo, tamanho = [], 0
        for c in comandos + [None]:
            if arquivo and (c is None or tamanho + len(c.encode("utf-8")) > LIMITE * 1.3):
                n += 1
                corpo = "begin;\nset local session_replication_role = replica;\n" + "".join(arquivo) + "commit;\n"
                (pasta / f"{n:03d}_{nome}.sql").write_text(corpo, encoding="utf-8")
                arquivo, tamanho = [], 0
            if c is not None:
                arquivo.append(c)
                tamanho += len(c.encode("utf-8"))
        print(nome, json.dumps(contagem, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1])
