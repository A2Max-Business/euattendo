---
impacto: capacidade_nova
secao: adicionado
titulo: A tela de atualização diz onde está o detalhe da disputa de banco
---

Quando a atualização pelo botão da tela encontra o banco em uso por outro processo e precisa de mais de uma passada, o resumo dessa disputa já aparecia no fim da atualização. Faltava dizer onde procurar o detalhe.

Agora, logo abaixo do resumo, a tela aponta o arquivo `.update.log`, na pasta do projeto no servidor, onde fica o que cada passada não aplicou. A linha aparece tanto quando a atualização termina bem quanto quando ela volta para a versão anterior. Se a rodada não teve disputa, ou se ela não foi medida, a linha não aparece. Nada muda para quem atualiza pela linha de comando. Não exige ação.

Contribuição de @webtecnica (#1040).
