---
impacto: nada_mudou
secao: adicionado
titulo: Módulos opcionais passam a poder declarar o que a anonimização de LGPD apaga neles
---

Um **módulo opcional** passa a ter como fazer a exclusão de dados de LGPD alcançar as tabelas dele, sem que a instalação precise lembrar de nada: o módulo declara uma vez, na própria migration, quais colunas guardam texto livre sobre a pessoa e como a linha se liga a ele, e a anonimização passa a redigir essas colunas junto com as do resto do sistema. Hoje nenhum módulo declara seção (honorários não guarda texto livre sobre a pessoa), então nada muda na sua instalação até um módulo declarar. Quem **não** instalou o módulo não muda de comportamento — a seção declarada para uma tabela que não existe é pulada na hora, sem erro, e a exclusão do contato segue funcionando igualzinho. Antes, o caminho seguro seria alguém reescrever a cascata inteira de anonimização a cada módulo novo; quem esquecesse entregaria **sucesso com a pessoa ainda legível**, que é exatamente o que a LGPD não permite.

A declaração errada (coluna que não existe) agora **falha alto**, dizendo qual módulo e qual tabela, em vez de redigir pela metade e devolver sucesso — porque entregar um pedido de exclusão como cumprido com dado legível é pior do que ele falhar e ser repetido. O registro que guarda essas seções é fechado: só quem aplica o schema escreve nele — nem a chave de serviço do app —, e o gatilho não roda em papel de cliente.

Também entra a prova de que **as funções de um módulo existem mesmo sem as tabelas dele** — que é como toda instalação vive, já que as tabelas só nascem quando alguém instala o módulo: a cadeia inteira é recriada com a validação de corpo ligada e as tabelas ausentes, e tem de compilar. Não exige ação de quem já está rodando: o `update.sh` cria a tabela do registro (vazia) e o gatilho, sem nenhuma mudança de tela.

Contribuição de @webtecnica (#1901).
