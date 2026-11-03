"""Copia o cadastro de hoje (arquivos em data/) para o Supabase.

Gera um SQL que esvazia e recarrega as tabelas de cadastro, sem disparar a
auditoria (é carga, não alteração de alguém). Pode rodar quantas vezes
precisar até a virada: o GitHub continua sendo a fonte.

Uso:  py -I supabase/scripts/carga_cadastro.py <saida.sql>
      powershell -File supabase/scripts/sql.ps1 -Arquivo <saida.sql>
"""
import json
import re
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "data"
INDEX = Path(__file__).resolve().parents[2] / "index.html"


def ler(nome):
    return json.loads((DATA / nome).read_text(encoding="utf-8"))


def texto(v):
    v = (v or "").strip() if isinstance(v, str) else v
    return v if v not in ("", None) else None


def perfis():
    # A lista USERS do portal é a fonte de quem entra hoje
    bloco = re.search(r"var USERS = \[(.*?)\];", INDEX.read_text(encoding="utf-8"), re.S).group(1)
    linhas = []
    for m in re.finditer(r"codigo:\s*'(\d+)',\s*nome:\s*'([^']+)'(.*?)\}", bloco):
        codigo, nome, resto = m.groups()
        papel = "dev" if "dev: true" in resto else ("cms" if nome == "CMS" else "vendedor")
        linhas.append({"codigo": codigo, "nome": nome, "papel": papel})
    return linhas


def clientes():
    por_codigo, vinculos = {}, []
    for arq in sorted((DATA / "clientes").glob("*.json")):
        preposto = arq.stem
        for c in json.loads(arq.read_text(encoding="utf-8")):
            cod = str(c["codigo"]).strip()
            atual = por_codigo.setdefault(cod, {"codigo": cod})
            for campo, origem in (("razao", "nome"), ("cnpj", "cnpj"), ("telefone", "telefone"),
                                  ("cidade", "cidade"), ("uf", "estado"),
                                  ("email_nfe", "emailNfe"), ("email_bancario", "emailBancario")):
                if texto(c.get(origem)) and not atual.get(campo):
                    atual[campo] = texto(c.get(origem))
            av = texto(c.get("avista"))
            if av and "a_vista" not in atual:
                atual["a_vista"] = av.upper().startswith("S")
            vinculos.append({"cliente": cod, "preposto": preposto})
    for cod, fantasia in ler("clientes-fantasia.json")["clientes"].items():
        por_codigo.setdefault(cod, {"codigo": cod})["fantasia"] = texto(fantasia)
    for cod, c in ler("carteira-cms-clientes.json")["clientes"].items():
        atual = por_codigo.setdefault(cod, {"codigo": cod})
        atual.setdefault("razao", texto(c.get("razao")))
        if not atual.get("fantasia"):
            atual["fantasia"] = texto(c.get("nomeFantasia"))
        atual["porta"] = texto(c.get("porta"))
    # Vínculo só com quem é perfil; sem duplicar
    codigos_perfis = {p["codigo"] for p in perfis()}
    vinculos = [dict(t) for t in {tuple(v.items()) for v in vinculos if v["preposto"] in codigos_perfis}]
    return list(por_codigo.values()), vinculos


def produtos():
    return [{
        "artigo": p["codigo"], "cor": p["cor"], "marca": p["marca"],
        "descricao": texto(p.get("produto")), "categoria": texto(p.get("categoria")),
        "segmento": texto(p.get("segmento")), "genero": texto(p.get("genero")),
        "tamanhos": texto(p.get("tam")), "pdv": p.get("preco") or None,
        "custo": p.get("custo") or None, "imagem": texto(p.get("imagem")),
    } for p in ler("produtos.json")]


def fichas():
    return [{"chave": k, "marca": texto(v.get("marca")), "fonte": texto(v.get("fonte")),
             "dados": v, "lido_em": texto(v.get("lidoEm"))} for k, v in ler("fichas.json").items()]


def tabela_especial():
    linhas = []
    for artigo, regras in ler("tabela_especial.json").items():
        for r in regras:
            linhas.append({"artigo": artigo, "marca": texto(r.get("marca")),
                           "codigo_tabela": r["codigoTabela"], "custo": r.get("custo"),
                           "mkp": float(r["mkp"]) if texto(str(r.get("mkp") or "")) else None,
                           "vigencia": texto(r.get("vigencia")),
                           "vig_inicio": texto(r.get("vigInicio")), "vig_fim": texto(r.get("vigFim"))})
    return linhas


def marcacoes():
    exclusivos = [{"artigo": k.split("|", 1)[0], "cor": k.split("|", 1)[1], "canal": v}
                  for k, v in ler("exclusivos.json").items()]
    novidades = [{"artigo": k.split("|", 1)[0], "cor": k.split("|", 1)[1], "desde": v}
                 for k, v in ler("novidades.json").items()]
    faixas = [{"artigo": k, "faixa": v} for k, v in ler("faixas.json")["faixa"].items()]
    return exclusivos, novidades, faixas


def carga(tabela, linhas):
    # Só as colunas presentes no JSON: as outras ficam com o default da tabela
    corpo = json.dumps(linhas, ensure_ascii=False)
    assert "$carga$" not in corpo
    colunas = ", ".join(dict.fromkeys(k for linha in linhas for k in linha))
    return (f"insert into {tabela} ({colunas}) select {colunas} from "
            f"jsonb_populate_recordset(null::{tabela}, $carga${corpo}$carga$::jsonb);\n")


def main(saida):
    cli, vinc = clientes()
    exc, nov, fai = marcacoes()
    ordem = [
        ("cadastro.perfis", perfis()), ("cadastro.clientes", cli),
        ("cadastro.clientes_prepostos", vinc), ("cadastro.produtos", produtos()),
        ("cadastro.fichas", fichas()), ("cadastro.exclusivos", exc),
        ("cadastro.novidades", nov), ("cadastro.faixas", fai),
    ]
    sql = ["begin;\n", "set local session_replication_role = replica;\n",
           "truncate cadastro.clientes_prepostos, cadastro.clientes, cadastro.produtos, cadastro.fichas, "
           "cadastro.tabela_especial, cadastro.exclusivos, cadastro.novidades, cadastro.faixas;\n",
           "delete from cadastro.perfis where user_id is null;\n"]
    for tabela, linhas in ordem:
        if tabela == "cadastro.perfis":
            sql.append(carga(tabela, linhas).replace(");\n", ") on conflict (codigo) do nothing;\n"))
        else:
            sql.append(carga(tabela, linhas))
    sql.append(carga("cadastro.tabela_especial", tabela_especial()))
    sql.append("insert into sistema.publicacoes (base, origem, linhas, por) values "
               f"('cadastro', 'data/ do GitHub', {sum(len(l) for _, l in ordem)}, 'carga inicial');\n")
    sql.append("commit;\n")
    Path(saida).write_text("".join(sql), encoding="utf-8")
    for tabela, linhas in ordem:
        print(f"{tabela}: {len(linhas)}")
    print(f"cadastro.tabela_especial: {len(tabela_especial())}")


if __name__ == "__main__":
    main(sys.argv[1])
