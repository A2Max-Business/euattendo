---
impacto: nada_mudou
secao: corrigido
titulo: Atualização de instalação sem o módulo de honorários não para mais no aviso de regras de isolamento
---

Desde a 1.61.0, atualizar uma instalação que não tem o módulo de honorários parava no passo do banco com o aviso vermelho `⛔ REGRAS DE ISOLAMENTO AUSENTES`, listando 8 regras das tabelas `honorarios_contratos` e `honorarios_parcelas`, e deixava o CRM parado atrás da página de manutenção. Não faltava regra nenhuma: essas 8 só existem depois que o módulo é instalado, e a conferência as cobrava mesmo assim. Agora a conferência só cobra regra de tabela que existe no banco, e uma regra de tabela existente que sumir continua parando a atualização, como antes.

Quem não ficou preso não precisa fazer nada: a próxima atualização passa direto. Isso vale também para quem ainda está numa versão anterior à 1.61.0, porque esta versão muda o `supabase/baseline.sql` de forma que a conferência do `update.sh` antigo, que é o que roda durante a atualização, deixa de contar essas 8 regras.

Se a sua atualização para a 1.61.0, 1.62.0 ou 1.63.0 parou nesse aviso, o CRM está fora do ar e o botão da tela não responde. Entre no servidor e rode a atualização de novo, na pasta do CRM: `bash hostgator-setup-kit/update.sh`. Ela termina e tira a página de manutenção do ar. Se mesmo assim parar no mesmo aviso, rode estes três comandos, que trocam o código para esta versão antes de atualizar e assim usam a conferência nova: `git fetch --tags origin`, depois `git checkout v1.63.1`, depois `bash hostgator-setup-kit/update.sh --to v1.63.1 --force`.

Contribuição de @webtecnica (#1906).
