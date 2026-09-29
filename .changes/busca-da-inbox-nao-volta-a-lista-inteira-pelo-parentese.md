---
impacto: nada_mudou
secao: corrigido
titulo: A busca da caixa de entrada deixa de devolver a lista inteira quando o termo tem só parênteses
---

Digitar um termo feito só de parênteses (`()` ou `((`) na busca da caixa de entrada podia devolver a
lista inteira de conversas, em vez de nada — o parêntese escapava do piso de tamanho do termo e
virando curinga do PostgREST, a consulta casava tudo. Agora o piso mede o termo sem os parênteses,
no mesmo lugar (régua única) que a busca de contatos já usava: abaixo do tamanho mínimo, a busca
não vai ao banco. Nenhuma configuração ou ação é necessária.

Contribuição de @webtecnica (#1895).