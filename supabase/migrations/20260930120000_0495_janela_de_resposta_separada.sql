-- ═══ Janela de RESPOSTA separada da janela de DISPARO (0495) ═══
--
-- O dono pediu: o agente responde a qualquer hora do dia, mas NADA de disparo
-- em massa nem cutucar conversa parada fora do horário comercial. As duas coisas
-- regidas por UM knob (`window_start_hour`/`window_end_hour`), então abrir a
-- janela do agente para 24h abriria também a do disparo.
--
-- Por que colunas soltas e não um jsonb: o projeto trata `window_*_hour` como
-- coluna desde a 0010 e a tela de Conexões já os edita. `reengajar_knobs`
-- nasceria jsonb sem CHECK forte e divergiria do vizinho na mesma tabela.
--
-- O DEFAULT de `reengajar_start_hour` é 9 e `reengajar_end_hour` é 21 — mais
-- apertado que o disparo (7h–22h) porque cutucar quem SUMIU é o que mais
-- incomoda: essa mensagem chega para alguém que não pediu nada. Quem preferir
-- igualar ao disparo grava 7 e 22.
--
-- ⚠️ NULL = conserva o comportamento de HOJE (o agente espera na janela do
-- disparo). Um clone que nunca gravou estas colunas não muda de comportamento
-- por causa desta migration — e é por isso que o default é NULL e não 0/24.
alter table channel_knobs
  add column if not exists reengajar_start_hour smallint,
  add column if not exists reengajar_end_hour smallint;

comment on column channel_knobs.reengajar_start_hour is
  'Início da janela de RESPOSTA do agente (h, hora local da org). NULL = usa window_start_hour (comportamento anterior).';
comment on column channel_knobs.reengajar_end_hour is
  'Fim da janela de RESPOSTA do agente (h, exclusivo; 24 = meia-noite). NULL = usa window_end_hour.';

-- 0..24. `end` pode ser 24 (meia-noite seguinte) porque `insideWindow` compara
-- `wall.h < windowEndHour` e a hora local nunca passa de 23.
-- O `drop … if exists` antes do `add` e o que torna a migration reaplicavel:
-- o `update.sh` de quem ja aplicou a 0495 roda o apendice do baseline de novo, e
-- `add constraint` sem guarda quebra com 'already exists'. Mesmo par no baseline.
alter table channel_knobs
  drop constraint if exists channel_knobs_reengajar_horas_validas;
alter table channel_knobs
  add constraint channel_knobs_reengajar_horas_validas
  check (
    (reengajar_start_hour is null or reengajar_start_hour between 0 and 23)
    and (reengajar_end_hour is null or reengajar_end_hour between 1 and 24)
  );