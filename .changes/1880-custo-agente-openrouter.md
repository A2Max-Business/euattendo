---
impacto: nada_mudou
secao: corrigido
titulo: Custo das chamadas do agente deixa de ficar nulo com OpenRouter (modelo com prefixo provider/)
---

Com provedor OpenRouter, o id do modelo chegava com o prefixo `anthropic/…` e a tabela de preços do agente — indexada sem o prefixo — não achava a linha de custo. Resultado: `llm_calls.cost_cents` nulo em toda chamada de atendimento, guarda e classificação de etapa, a tela de Uso mostrando gasto zero e o teto de gasto de IA da organização nunca disparando.

A busca de preço agora tolera o prefixo `provider/` (recorta até a primeira barra, na mesma ordem da tolerância do sufixo de data), e o custo volta a ser computado. Crédito: @webtecnica (#1929)