---
impacto: nada_mudou
secao: corrigido
titulo: Turno descartado como obsoleto não emite mais a pergunta pendente do roteiro
---

Quando o #1940 recusa a resposta de um turno porque o cliente escreveu de novo enquanto o agente pensava, o turno é descartado. Mas, num agente com roteiro de atendimento, a pergunta pendente do roteiro ainda saía no fim desse turno descartado — e o turno da mensagem nova respondia em seguida. Efeito: resposta dupla.

Agora, num turno descartado como obsoleto nada mais sai, nem a pergunta do roteiro: ela segue feita para o turno da mensagem nova, que lê a conversa inteira. Nenhuma configuração ou ação é necessária.

Refs: #1940, #1943