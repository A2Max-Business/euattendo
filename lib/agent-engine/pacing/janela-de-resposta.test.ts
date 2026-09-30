/**
 * A janela de RESPOSTA é diferente da janela de DISPARO (migration 0381).
 *
 * O dono pediu: responder a qualquer hora, NUNCA disparar nem cortar conversa
 * parada fora do horário comercial. Antes da 0381 as duas coisas liam o mesmo
 * par de horas de disparo, então abrir o atendimento para 24h abria o disparo
 * junto — exatamente o que não foi pedido.
 *
 * Estes testes existem para travar a SEPARAÇÃO, não o padrão: se alguém voltar
 * a ler as horas de DISPARO no caminho da resposta, este arquivo reprova.
 */
import { describe, expect, it } from 'vitest';

import { PACING_DEFAULTS, type PacingKnobs } from './defaults';
import {
  decidePacing,
  janelaDeEnvioAberta,
  proximaAberturaDaJanela,
} from './engine';

/** 2026-09-30 é quarta. 03:00 e 21:00 são as horas que separam as janelas. */
const AS_3H = new Date('2026-09-30T03:00:00-03:00'); // meia-noite-1h em São Paulo
const AS_21H = new Date('2026-09-30T21:00:00-03:00');
const AS_10H = new Date('2026-09-30T10:00:00-03:00');

/**
 * A hora local do TENANT, não a da máquina.
 *
 * `getHours()` devolve a hora no fuso do PROCESSO — e o runner pode ser UTC
 * enquanto a janela é avaliada em São Paulo. Foi assim que este arquivo
 * "provou" que o adiado era às 12h em vez das 9h: a diferença era o fuso do
 * teste, não o do motor. Ler a hora sem o fuso mede o relógio errado.
 */
const TZ = PACING_DEFAULTS.timezone;
const horaNoFuso = (d: Date): number =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d));

const knobs = (over: Partial<PacingKnobs> = {}): PacingKnobs => ({
  ...PACING_DEFAULTS,
  ...over,
});

const estado = { lastSentAt: null, sentToday: 0, numberActivatedAt: null };

describe('janela de resposta separada da janela de disparo (0381)', () => {
  it('a 3h a resposta é liberada e o disparo é barrado', () => {
    const k = knobs({ reengajarStartHour: 0, reengajarEndHour: 24 });

    expect(janelaDeEnvioAberta(AS_3H, k, true)).toBe(true);
    expect(janelaDeEnvioAberta(AS_3H, k, false)).toBe(false);
  });

  it('o mesmo número de knobs decide diferente conforme o tipo de envio', () => {
    const k = knobs({ reengajarStartHour: 0, reengajarEndHour: 24 });

    const resposta = decidePacing({
      now: AS_3H, knobs: k, state: estado, crmDailyLimit: null, resposta: true,
    });
    const disparo = decidePacing({
      now: AS_3H, knobs: k, state: estado, crmDailyLimit: null, resposta: false,
    });

    expect(resposta.allow).toBe(true);
    expect(disparo.allow).toBe(false);
    if (!disparo.allow) expect(disparo.code).toBe('outside_window');
  });

  it('omitir `resposta` é DISPARO — a direção que fecha o número', () => {
    const k = knobs({ reengajarStartHour: 0, reengajarEndHour: 24 });
    // O chamador que esquece o campo não pode abrir o número às 3h.
    expect(janelaDeEnvioAberta(AS_3H, k)).toBe(false);
    expect(decidePacing({ now: AS_3H, knobs: k, state: estado, crmDailyLimit: null }).allow).toBe(false);
  });

  it('dentro do horário comercial os dois são liberados', () => {
    const k = knobs({ reengajarStartHour: 0, reengajarEndHour: 24 });
    expect(janelaDeEnvioAberta(AS_10H, k, true)).toBe(true);
    expect(janelaDeEnvioAberta(AS_10H, k, false)).toBe(true);
  });

  it('sem `reengajar*` gravado, a resposta herda a janela do disparo', () => {
    // Clone que rodou a 0381 sem gravar as colunas: `undefined` cai no par de
    // disparo, que é o comportamento de sempre — não vira 0-24 sozinho.
    const k = knobs({ reengajarStartHour: undefined as unknown as number, reengajarEndHour: undefined as unknown as number });
    expect(janelaDeEnvioAberta(AS_3H, k, true)).toBe(false);
    expect(janelaDeEnvioAberta(AS_10H, k, true)).toBe(true);
  });

  it('par de resposta incompleto (só o início) não abre a janela', () => {
    // Gravar só `reengajar_start_hour=0` e deixar o fim vazio é configuração
    // pela metade. A resposta NÃO pode virar 0h-infinito por acidente.
    const k = knobs({ reengajarStartHour: 0, reengajarEndHour: undefined as unknown as number });
    expect(janelaDeEnvioAberta(AS_3H, k, true)).toBe(false);
  });

  it('o veto da RESPOSTA atrasa para a abertura da resposta, não 7h', () => {
    // Resposta com janela própria 9h-21h: fora dela, o adiado é 9h, não o
    // `window_start_hour` do disparo. É o que o dono vê no painel.
    const k = knobs({ reengajarStartHour: 9, reengajarEndHour: 21 });
    const d = decidePacing({
      now: AS_3H, knobs: k, state: estado, crmDailyLimit: null, resposta: true, rng: () => 0,
    });
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(horaNoFuso(d.nextAllowedAt)).toBe(9);
      expect(d.reason).toContain('resposta');
      expect(d.reason).toContain('9h-21h');
    }
  });

  it('o veto do DISPARO continua citando a janela de disparo', () => {
    const k = knobs({ reengajarStartHour: 0, reengajarEndHour: 24 });
    const d = decidePacing({
      now: AS_3H, knobs: k, state: estado, crmDailyLimit: null, resposta: false, rng: () => 0,
    });
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toContain('7h-22h');
      expect(d.reason).not.toContain('0h-24h');
    }
  });

  it('cap diário continua valendo na RESPOSTA — 24h não é sem limite', () => {
    // A janela é cortesia; o anti-ban (cap, warm-up, throttle) não abre junto.
    const k = knobs({ reengajarStartHour: 0, reengajarEndHour: 24 });
    const d = decidePacing({
      now: AS_3H, knobs: k, state: { ...estado, sentToday: 999 }, crmDailyLimit: null, resposta: true,
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.code).not.toBe('outside_window');
  });

  it('domingo desligado cala a resposta também (knob único, sem par)', () => {
    const k = knobs({ reengajarStartHour: 0, reengajarEndHour: 24, allowSunday: false });
    const domingo = new Date('2026-10-04T12:00:00-03:00'); // domingo
    expect(janelaDeEnvioAberta(domingo, k, true)).toBe(false);
  });

  it('o padrão do repositório continua espelhando a janela de disparo', () => {
    // Se este teste quebrar, todo clone que não gravou `reengajar_*` mudou de
    // comportamento sem ninguém pedir.
    expect(PACING_DEFAULTS.reengajarStartHour).toBe(PACING_DEFAULTS.windowStartHour);
    expect(PACING_DEFAULTS.reengajarEndHour).toBe(PACING_DEFAULTS.windowEndHour);
  });

  it('proximaAberturaDaJanela segue a janela do tipo de envio', () => {
    const k = knobs({ reengajarStartHour: 0, reengajarEndHour: 24 });
    // Às 21h, para o disparo só amanhã 7h; para a resposta, amanhã 0h.
    const paraDisparo = proximaAberturaDaJanela(AS_21H, k, false, () => 0);
    const paraResposta = proximaAberturaDaJanela(AS_21H, k, true, () => 0);
    expect(horaNoFuso(paraDisparo)).toBe(7);
    expect(horaNoFuso(paraResposta)).toBe(0);
  });
});