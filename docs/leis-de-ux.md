# Leis de UX, traduzidas para os nossos apps

As trinta leis do lawsofux.com são boas como vocabulário e ruins como receita.
Servem para explicar por que uma tela incomoda; não servem para decidir o que
construir. Este documento é a tradução delas para o que o nosso vendedor faz:
vender calçado pelo celular, no balcão de uma loja, com pouco tempo e sinal
ruim.

São nove regras. Cada uma diz o que fazer, de onde veio e onde já está no
código — se não dá para apontar o lugar, não virou regra.

---

## 1. Parecer com o que ele já usa

O vendedor vive no EBM, no WhatsApp e no Excel. Nossa tela tem de falar a
língua desses três. Chamamos GCI de GCI, não de "número do pedido". Data de
faturamento é data de faturamento. Quando um nome nosso disputa com um nome do
EBM, o do EBM ganha.

> **Lei de Jakob.** As pessoas passam a maior parte do tempo em *outros* apps,
> e esperam que o nosso funcione como aqueles.

No aviso de produto duplicado (`js/carteira.js`), cada linha mostra GCI, data e
pares — os mesmos três campos que ele leria na Detalhada.

## 2. Responder rápido; quando não der, dizer o que está acontecendo

Abaixo de meio segundo a pessoa mantém o ritmo. Acima disso ela sai do fluxo,
clica de novo, desconfia. Nenhuma tela espera um arquivo grande para começar a
funcionar, e toda espera tem texto dizendo o que está sendo feito.

> **Limiar de Doherty.** A produtividade sobe quando o sistema responde em
> menos de ~400 ms.

A Detalhada tem 5 MB e nunca vai para o celular: o aviso lê um índice de 180 KB
na rede, uma vez por sessão. Enquanto confere, o botão diz *"Conferindo a
carteira…"* (`vitrine/index.html`, função `enviarRepasse`).

## 3. Alvo grande, e o botão perigoso nunca recebe o foco

Qualquer coisa que se toca tem 44 px de lado, no mínimo. No celular, botão de
ação ocupa a largura inteira. E em toda escolha com consequência, quem começa
focado é o caminho seguro — nunca o que envia, apaga ou confirma.

> **Lei de Fitts.** O tempo para acertar um alvo depende do tamanho dele e da
> distância.

No modal do aviso, os botões viram largura cheia abaixo de 560 px e o foco
começa em "Revisar o pedido"; Esc e clique fora também voltam, nunca enviam.
Os botões redondos do Repasses e o `topo-fab` do Showroom têm 44 e 48 px.

## 4. O erro é o pico da experiência; capriche nele

Ninguém lembra da tela que funcionou. Lembram do pedido que não foi e do par
que chegou duas vezes. Mensagem de erro é onde o produto é julgado, então ela
diz o que aconteceu, o que dá para fazer agora, e nunca deixa a pessoa presa.

> **Regra do Pico-Fim.** A lembrança de uma experiência se forma no momento
> mais intenso e no final.

Quando o índice da carteira não carrega, o vendedor vê *"Não deu para ver a
carteira do cliente"* com a opção de enviar assim mesmo. O aviso informa; não
proíbe.

## 5. Mostrar, em vez de fazer lembrar

Nada que a pessoa precise guardar na cabeça entre uma tela e outra. O dado que
sustenta a decisão aparece junto da decisão — inclusive a foto, que é
reconhecida mais rápido que qualquer código.

> **Memória de trabalho.** O que está à vista não ocupa memória.

O aviso mostra a miniatura do par, os pares deste repasse e a data da base no
rodapé: tudo o que ele precisaria lembrar para decidir está na mesma tela.

## 6. Agrupar com significado e cortar a lista

Lista longa não cabe na tela do celular e empurra o botão para fora. Mostre as
primeiras — que são as que importam — e resuma o resto numa linha, dizendo
quantas são.

> **Chunking** e **Efeito de Posição Serial.** Lembramos do começo e do fim, e
> entendemos melhor o que vem em blocos com sentido.

Um cliente grande tem oito encomendas do mesmo par. O modal mostra as três mais
próximas de faturar e resume: *"+ 5 encomendas · 48 pares · até 17/05/2027"*.
As cores seguem a mesma ideia: seis, depois "e N outras cores".

## 7. A complexidade não some; ela fica com quem tem mais contexto

Toda regra difícil mora em um lugar só, e esse lugar é o nosso código — nunca a
cabeça do vendedor, nunca uma instrução de uso.

> **Lei de Tesler.** Todo sistema tem uma complexidade que não pode ser
> eliminada, apenas deslocada.

`js/disponivel.js` faz uma conta só de saldo, usada pelo Showroom e pelo Nexo:
se cada um calculasse o seu, o Nexo diria "tem" onde a tela diz "não tem". O
índice da carteira é derivado uma vez por dia no Worker, não a cada envio.

## 8. Destacar uma coisa só

Se tudo grita, nada é ouvido. Cada tela tem um único ponto de ênfase, e ele é o
que muda a decisão.

> **Efeito Von Restorff.** Entre itens parecidos, o que se destaca é lembrado.

O modal inteiro é âmbar; a única cor forte é a etiqueta vermelha **Duplicado ·
mesma cor**. "Parecido" ficou em cinza, porque é contexto, não motivo.

## 9. Aceitar entrada torta, escrever saída exata

Planilha vem com coluna trocada, cor com barra, código com espaço. A tela
absorve isso em silêncio e grava sempre no formato certo.

> **Lei de Postel.** Seja tolerante no que aceita, rigoroso no que produz.

`desinverte()` conserta a planilha que troca Código e Produto; `corArquivo()`
transforma `PTO/CH` em `PTO_CH` para achar a foto. O vendedor nunca fica
sabendo que houve conserto.

---

## As que não viraram regra, e por quê

**Lei de Miller (7±2).** É a mais mal usada do conjunto. Miller falava de
memória de curtíssimo prazo, não de tamanho de menu. Limitar a lista de
produtos a sete itens seria absurdo. O que aproveitamos dela está na regra 5.

**Lei de Hick.** Vale para escolhas equivalentes e desconhecidas. O vendedor
conhece o catálogo de cor: para ele, mil produtos com busca boa decidem mais
rápido que vinte categorias. Onde ela vale de verdade é no número de botões de
uma caixa de decisão — e lá são dois.

**Efeito Estética-Usabilidade.** É real e por isso perigoso: a tela bonita
esconde o defeito grave numa demonstração. Serve de alerta na hora de testar,
não de justificativa para gastar tempo em enfeite.

**Princípio de Pareto, Lei de Parkinson, Fluxo.** São sobre gestão e sobre a
pessoa, não sobre interface. Ficam de fora.

**As leis da Gestalt** (proximidade, semelhança, região comum, conexão
uniforme, Prägnanz) não entram como regra porque já estão embutidas em como
montamos card, tabela e modal. Elas explicam o que fazemos; não mudam decisão.

---

## Como isso se usa

Na **revisão**, não na criação. Primeiro se resolve o problema do vendedor;
depois se passa a tela por estas nove regras e se conserta o que não passar.

Citar o nome da lei só quando ele mudar a decisão. "Apliquei a Lei de Hick" em
cima de um menu que continua confuso não é argumento — é enfeite.

E quando duas regras brigarem — a 6 manda cortar a lista, a 5 manda mostrar
tudo — ganha quem estiver mais perto da decisão que o vendedor precisa tomar
naquela tela.
