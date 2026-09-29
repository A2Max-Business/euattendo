---
impacto: nada_mudou
secao: corrigido
titulo: Dar merge na main deixa de ser acusado como autoria de quem fez o merge
---

Mergear a `main` na sua branch voltou a passar sem válvula nenhuma — e sem afrouxar nada. Quem atualizava a branch com o que a `main` publicou (um invariante reescrito, uma migration nova) era tratado como quem escreveu aquilo: a catraca de invariantes e a guarda de `plan/features.json` liam o índice do merge inteiro e não tinham como separar o que veio da `main` do que a branch introduziu. A causa era do git, não da regra: ele chama o `pre-merge-commit` ANTES de escrever o `MERGE_HEAD`, então as referências de procedência estavam vazias no instante exato em que a pergunta é feita — e a guarda, no lado seguro, falhava fechado sobre o merge todo. Era o lado seguro errado: ela não estava defendendo a regra, estava punindo o merge.

A regra continua idêntica. O que mudou é como o alcance é calculado: o git entrega o outro lado, naquele instante, em `GITHEAD_<sha>=<ref>`, e é por ali que a guarda agora enxerga de onde veio o que o commit tem. Com o outro lado em mãos, as condições de procedência valem igual no caminho limpo e no caminho conflituoso — o que a `main` já tinha continua não sendo autoria de quem mergeia, o invariante da `main` modificado pela branch continua barrado, e a migration com sequência já usada continua barrada. Nenhuma barreira foi removida, nenhum escape foi retirado: o que some é só a acusação sobre o merge.

Como esse sinal é uma variável de ambiente, quem roda o commit pode forjá-lo, e o mesmo valia para um `MERGE_HEAD` escrito à mão. Por isso a guarda de `plan/features.json` ganhou as duas condições que a catraca de invariantes já tinha: o conteúdo que entra tem de ser o que a `main` tem agora, e a branch não pode ter tocado o arquivo. Antes, um commit comum com o sinal apontando para uma versão antiga da `main` conseguia apagar features do plano.

Não exige ação de ninguém.

Contribuição de @webtecnica (#1900).
