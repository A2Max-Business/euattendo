---
impacto: nada_mudou
secao: corrigido
titulo: O playbook de agenda ensina os dois passos — listar o que a empresa atende e só depois consultar horários
---

O playbook `agendamento` — o texto que entra na conversa quando o cliente fala em "agendar", "horário disponível" ou "que horas vocês" — começava no meio da cadeia. Ele dizia que a IA só tem acesso à agenda se `crm_find_free_slots` estiver disponível e mandava consultar horários, mas nunca disse de onde vem o `event_type_slug` que essa ferramenta exige. O primeiro passo, `crm_list_event_types`, não aparecia em nenhuma linha do texto: medido, zero ocorrências em `supabase/`.

O resultado era a cena da issue #1019: a IA listava os tipos com sucesso e parava ali, respondendo "vou verificar" — ou escalando para a equipe — em vez de oferecer um horário real.

O corpo publicado agora ensina a cadeia inteira: primeiro `crm_list_event_types` (daí sai o `slug` de cada tipo de atendimento), depois `crm_find_free_slots` com esse `event_type_slug` **no mesmo turno**, e quando o cliente escolhe um horário, `crm_book_appointment` com o `starts_at` que a consulta devolveu. Parar depois da lista e responder "vou verificar" passa a ser nomeado como o defeito que é.

Todo nome de ferramenta novo entra **dentro de uma condição** ("se `crm_list_event_types` também estiver na sua mão", "se você não tem a ferramenta"). Este texto é da organização inteira e chega por palavra-chave, sem saber quais capacidades o agente tem ligadas — e o desfecho de quem não tem a ferramenta continua sendo o mesmo: não inventar horário e sinalizar para a equipe. Quem já instala recebe o corpo novo pela migration `0486`; instalação nova recebe pelo `baseline.sql`. Nenhuma ação é necessária.

Contribuição de @webtecnica (#1019).
