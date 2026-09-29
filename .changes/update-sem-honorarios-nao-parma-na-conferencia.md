---
impacto: nada_mudou
secao: corrigido
titulo: Atualização de instalação sem o módulo de honorários para de acusar regra que não existe
---

Atualizar uma instalação SEM o módulo de honorários parava no meio, com o CRM
de pé no aviso vermelho `⛔ REGRAS DE ISOLAMENTO AUSENTES` e as 8 regras de
`honorarios_contratos`/`honorarios_parcelas` listadas como faltando. Elas não
faltavam: estão escritas DENTRO do corpo de `public.fn_honorarios_provisionar()`
no `supabase/baseline.sql`, função que só executa quando alguém chama
`fn_modulo_instalar('honorarios', …)`. Criar a função não cria tabela nenhuma, e
o conferidor do `update.sh` montava a lista do que é esperado lendo TODO
`create policy … on public.X` do texto do arquivo — inclusive o que estava dentro
da função. Sem o módulo as tabelas não existem, a recriação responde
`relation does not exist`, a segunda conferência acusa as mesmas 8 e o script
sai em 1 com o sistema parado.

A conferência agora só cobra regra cuja tabela já existe em `public` — medida no
banco, não no texto. Quem tem o módulo instalado continua cobrado igual, e regra
de tabela existente que sumir do banco continua derrubando a atualização: o que
some é só a acusação sobre módulo que ninguém instalou. Se a consulta de tabelas
não responder (banco fora do ar), nada é filtrado e o aviso continua saindo —
ele nunca fica mudo.

Não exige ação de ninguém.

Contribuição de @webtecnica (#1906).
