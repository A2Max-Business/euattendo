---
impacto: capacidade_nova
secao: adicionado
titulo: A tela de atualização conta quando o banco precisou de segunda tentativa
---

Quando você atualiza pelo botão da tela e o banco estava sendo usado por outro processo, a atualização não para na primeira recusa: o servidor tenta de novo e fecha. Isso já acontecia — o que não acontecia era eu **contar**. A tela dizia "sucesso" e o aviso de que houve disputa, quantas retentativas custou e em qual passada tudo fechou ficava escondido no arquivo `.update.log`, no servidor, onde só quem tem acesso de terminal lia.

Agora o resumo aparece junto do fim da atualização, em português: diz que a base estava ocupada, quantas passadas foram necessárias e onde está o detalhe passo a passo (o `.update.log`, na pasta do projeto no servidor). Se a rodada não teve disputa nenhuma, não aparece linha nenhuma — aviso sem motivo é ruído, e quem ignora o ruído acaba ignorando o aviso de verdade. Nada muda para quem atualiza pela linha de comando, e o `.update.log` continua sendo a fonte detalhada de sempre.

Contribuição de @webtecnica (#1040).
