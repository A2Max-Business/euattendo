---
impacto: nada_mudou
secao: corrigido
titulo: O relógio do card passa a ler stage_changed_at
---

O rodapé do card do Kanban mostrava "tempo no estágio" medido pela última
atividade (`last_activity_at`): qualquer nota, edição ou mensagem na conversa
zerava o relógio de um negócio que estava parado na mesma etapa há dias, e o
número mentia justamente para quem mais olhava o card. Agora o "tempo no
estágio" é medido pela entrada na etapa — a coluna `crm_leads.stage_changed_at`,
carimbada por trigger, que existia desde a migration 0071 e que nenhum código
lia. Negócio sem carimbo (dado legado) cai na data de criação, nunca na última
mensagem. Nota, edição ou resposta não muda mais o tempo mostrado: só mudar de
etapa zera. Contribuição de @webtecnica (PR #1908).