# -*- coding: utf-8 -*-
"""
Remonta, do histórico do git, o dia em que cada lote de repasse apareceu.

A vitrine do Repasses marca com o selo Novo o que entrou nos últimos dias.
Cada aparelho anota o que já viu, mas isso só vale a partir da primeira
visita: quem abre hoje não teria como saber o que entrou ontem. Este script
olha as revisões de `data/dispo.json` e grava, para cada lote (Nº + GCI), a
data em que ele apareceu pela primeira vez.

O arquivo não se atualiza sozinho — rode de novo quando quiser refrescar a
base (o registro de cada aparelho cobre o que entrar no meio tempo).

Uso:  python gerar_novidades_repasse.py [dias]
      (padrão: 30 dias de histórico, que já cobre com folga os 7 do selo)
"""
import json
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
FONTE = 'data/dispo.json'
DESTINO = RAIZ / 'data' / 'novidades-repasse.json'


def git(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True,
                          cwd=RAIZ, encoding='utf-8', errors='replace').stdout


def chave(lote):
    return f"{str(lote.get('num', '')).strip()}|{str(lote.get('gci', '')).strip()}"


def main():
    dias = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    limite = date.today() - timedelta(days=dias)

    revisoes = []
    for linha in git('log', '--format=%H %ad', '--date=short', '--reverse',
                     '--', FONTE).splitlines():
        sha, _, dia = linha.partition(' ')
        if dia.strip():
            revisoes.append((sha, dia.strip()))
    if not revisoes:
        raise SystemExit('Nenhuma revisão de dispo.json encontrada.')

    # A varredura começa um pouco antes do limite: um lote visto na revisão
    # anterior ao recorte não pode ser dado como novo.
    antes = [r for r in revisoes if date.fromisoformat(r[1]) < limite]
    dentro = [r for r in revisoes if date.fromisoformat(r[1]) >= limite]
    varrer = (antes[-1:] if antes else []) + dentro

    visto = {}
    for i, (sha, dia) in enumerate(varrer):
        try:
            lotes = json.loads(git('show', f'{sha}:{FONTE}'))
        except Exception:
            continue
        # a revisão-âncora marca o que já existia; ela não gera novidade
        marca = 'ja-estava' if (antes and i == 0) else dia
        for lote in lotes:
            visto.setdefault(chave(lote), marca)

    atuais = {chave(l) for l in json.loads((RAIZ / FONTE).read_text(encoding='utf-8'))}
    saida = {k: d for k, d in visto.items() if k in atuais and d != 'ja-estava'}

    DESTINO.write_text(json.dumps(saida, ensure_ascii=False, separators=(',', ':')),
                       encoding='utf-8')
    recentes = sum(1 for d in saida.values()
                   if (date.today() - date.fromisoformat(d)).days <= 7)
    print(f'{len(varrer)} revisões lidas · {len(atuais)} lotes na vitrine · '
          f'{len(saida)} com data · {recentes} nos últimos 7 dias')
    print(f'→ {DESTINO.relative_to(RAIZ)} ({DESTINO.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
