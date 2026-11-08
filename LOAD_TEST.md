# Teste de carga

O teste da Fase 16 é um experimento executado contra o ambiente completo. Ele
não substitui os testes de concorrência e não altera domínio, schema ou dados de
produção.

## Preparação

```bash
bun run infra:up:scaled
bun run migration:up
docker compose ps
bun run test:load
```

O runner exige ao menos três URLs distintas e verifica `/health/ready` em todas
antes de criar dados. O cenário padrão cria 25 wallets com `10000.00 BRL` e
mede 1.000 BETs de `1.00 BRL`, concorrência 50, distribuídas round-robin pelas
portas 3000–3002. Cada décima requisição repete integralmente a anterior para
exercitar idempotência durante a carga.

Criação de wallets, espera inicial da outbox e reconciliação final ficam fora da
janela de throughput. Isso evita inflar ou misturar o custo medido.

Execute em uma VM dedicada ao experimento, sem outras suítes ou tráfego no
mesmo banco. Use `LOAD_ENVIRONMENT_NOTE` para registrar tamanho/tipo da VM ou
limites de CPU/memória impostos aos containers que o sistema operacional não
permita descobrir automaticamente.

## O que fica registrado

Cada execução imprime um resumo e grava
`load-results/phase-sixteen-<timestamp>.json` contendo:

- commit Git, datas, hostname, SO, arquitetura, CPU e versões Bun/Node;
- URLs, número de requisições, concorrência, wallets e valores monetários;
- duração, throughput, p50, p95, p99, mínimo, média e máximo;
- contagem por status HTTP e status de negócio, taxa e amostras de erro;
- distribuição de requisições/sucessos/erros por instância;
- deltas Prometheus de transações, replays e conflitos;
- pico observado de `outbox_lag_seconds` e `outbox_pending`;
- reconciliação final e quantidade de lançamentos conferidos.

O diretório de resultados é ignorado pelo Git para que medições de máquinas
diferentes não pareçam resultados reproduzíveis do código. Para apresentar uma
execução, preserve o JSON da VM e registre no card o ambiente e os números sem
selecionar apenas a melhor tentativa.

## Configuração

| Variável                          | Padrão                                                   |
| --------------------------------- | -------------------------------------------------------- |
| `LOAD_API_URLS`                   | `http://127.0.0.1:3000,3001,3002` com os hosts completos |
| `LOAD_REQUESTS`                   | `1000`                                                   |
| `LOAD_CONCURRENCY`                | `50`                                                     |
| `LOAD_WALLETS`                    | `25`                                                     |
| `LOAD_DUPLICATE_EVERY`            | `10`; use `0` para não gerar replays                     |
| `LOAD_INITIAL_BALANCE`            | `10000.00`                                               |
| `LOAD_BET_AMOUNT`                 | `1.00`                                                   |
| `LOAD_REQUEST_TIMEOUT_MS`         | `10000`                                                  |
| `LOAD_METRICS_SAMPLE_INTERVAL_MS` | `250`                                                    |
| `LOAD_OUTBOX_DRAIN_TIMEOUT_MS`    | `10000`                                                  |
| `LOAD_REPORT_DIR`                 | `load-results`                                           |
| `LOAD_ENVIRONMENT_NOTE`           | vazio; descrição livre da VM e limites dos containers    |

Exemplo de segunda execução mais intensa:

```bash
LOAD_ENVIRONMENT_NOTE='VM 4 vCPU / 8 GB' \
LOAD_REQUESTS=5000 LOAD_CONCURRENCY=100 LOAD_WALLETS=50 \
bun run test:load
```

Valores monetários continuam sendo strings decimais com duas casas. Os números
de concorrência, latência e contagem usam `number` porque não representam
dinheiro.

## Critério de aprovação e leitura honesta

O comando termina com erro se houver resposta diferente de `200/PROCESSED`,
falha ao coletar métricas ou wallet inconsistente na reconciliação. Outbox lag e
conflitos não são escondidos nem convertidos em falha automaticamente: são
resultados operacionais que devem ser discutidos junto do throughput.

O resultado mede esta VM, esta configuração e este commit. Ele não é uma meta
universal de RPS, não prova capacidade de produção e não deve ser comparado com
outra máquina sem registrar as diferenças de CPU, rede e containers.
