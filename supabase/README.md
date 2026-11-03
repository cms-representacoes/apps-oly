# Banco do portal no Supabase

Projeto `cms-portal` (São Paulo, `rczlnuemmluhkgwzdino`), organização CMS Representações.
Enquanto a migração não vira a chave, **o GitHub continua sendo a fonte**: o banco é uma cópia que pode ser refeita a qualquer hora.

## Estrutura

| Schema | O que guarda |
|---|---|
| `sistema` | auditoria, publicações dos scripts, status das aplicações, documentos JSON, índice do arquivo histórico |
| `cadastro` | perfis (vendedor / cms / dev), clientes e vínculo com o vendedor, produtos, fichas, tabela especial, exclusivos, novidades, faixas |
| `repasse` | pedidos (+ itens e eventos), campanhas, rateio, lotes ocultos, links da vitrine, sacolas, desejos |
| `fabrica` | DISPO, cancelamentos, disponibilidades, imagens, grades CORRE/GERAL |
| `carteira` | Detalhada, movimento do mês, primeira previsão, Carteira CMS, ações, faturados, cortes de giro |
| `catalogo` | pedidos e rascunhos do Catálogo Digital |
| `matriz` | lojas, itens e pendências da Matriz Esportes |
| `relatorios` | Carta Campanha, Metas e o índice das planilhas no Storage |

Storage (privado): `relatorios/` (RFV e Performance) e `arquivo/backups/` (backups antigos em `.gz`).

Acesso: RLS em todas as tabelas. Vendedor vê só o que é dele; `cms` e `dev` veem e alteram tudo; aplicação marcada como em desenvolvimento só abre para `dev`.

## Refazer a cópia

O token pessoal fica na variável de usuário do Windows `SUPABASE_ACCESS_TOKEN` (nunca no repositório).

```powershell
# 1. migrações (só na primeira vez, em ordem)
powershell -File supabase/scripts/sql.ps1 -Arquivo supabase/migrations/<arquivo>.sql

# 2. cadastro
py -I supabase/scripts/carga_cadastro.py $env:TEMP\cadastro.sql
powershell -File supabase/scripts/sql.ps1 -Arquivo $env:TEMP\cadastro.sql

# 3. demais áreas (gera vários .sql; rodar todos, em ordem)
py -I supabase/scripts/carga_areas.py $env:TEMP\carga
Get-ChildItem $env:TEMP\carga\*.sql | Sort-Object Name | ForEach-Object { powershell -File supabase/scripts/sql.ps1 -Arquivo $_.FullName }

# 4. planilhas e backups para o Storage
py -I supabase/scripts/carga_arquivos.py
```

Cada carga esvazia e recarrega as suas tabelas sem disparar a auditoria.
