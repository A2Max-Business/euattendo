---
impacto: capacidade_nova
secao: adicionado
titulo: O agente responde a qualquer hora, sem abrir o horário do disparo
---

A janela anti-ban era **uma** só, e ela atendia a três coisas: a resposta do
agente, o disparo em massa e a cutucar de conversa parada. Com um único par de
horas, abrir o atendimento para 24 horas abria também o disparo — o que ninguém
pediu e é o caminho mais curto para o número ser banido.

Agora são **duas janelas**, por número:

| | antes | agora |
|---|---|---|
| Resposta a quem escreveu | 7h–22h | **0h–24h** |
| Disparos em massa | 7h–22h | 7h–22h (inalterado) |
| Cutucar conversa parada | 7h–22h | 7h–22h (inalterado) |

O que separa as duas é o tipo do envio: uma reação a uma mensagem recebida lê a
janela de resposta; a cutucar e o disparo leem a janela comercial.

**O anti-ban continua inteiro.** Abrir o horário não abre o limite: cap diário,
degraus de warm-up por idade do número e o intervalo entre envios seguem valendo
para os dois lados. Um número novo continua com 20 mensagens por dia até completar
o warm-up.

### ⚠️ Requer atenção

Atualize a instalação (`update.sh`) para receber as duas colunas novas. A
instalação que não atualizar **continua com o comportamento de sempre** — a
janela de resposta espelha a de disparo até alguém gravar o valor novo. Não há
o que configurar para o sistema não quebrar.

Para ajustar o horário de cada tipo de envio, grave na tabela `channel_knobs` do
seu número:

```sql
-- resposta 24h (padrão desta instalação)
update channel_knobs set reengajar_start_hour = 0,  reengajar_end_hour = 24
 where organization_id = '<sua org>' and channel_session_id = '<seu número>';

-- cutucar e disparo em 9h–21h, mais apertado que o padrão
update channel_knobs set window_start_hour = 9, window_end_hour = 21
 where organization_id = '<sua org>' and channel_session_id = '<seu número>';
```

Coluna pela metade não abre nada: sem o par completo, vale a janela de disparo.
É de propósito — `reengajar_start_hour = 0` sozinho produziria `0h–22h`, que é
abrir a madrugada pelo caminho que parece conservador.
