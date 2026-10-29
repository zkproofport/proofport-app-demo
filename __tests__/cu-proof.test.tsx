// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CuDemo from '../app/components/CuDemo';
import { CU_RECEIPT_DELAY_MS, CU_VERIFY_MS, CU_WAIT_MS } from '../lib/useCuProof';
import { scopeHash, verifyAnswer } from '../lib/kproof/verify';
import type { RequestStatus } from '../lib/kproof/relay';

const external = vi.hoisted(() => ({
  create: vi.fn(),
  stop: vi.fn(),
  watch: vi.fn(),
  qr: vi.fn(),
  offchain: vi.fn(),
}));
vi.mock('../lib/kproof/relay', () => ({
  RelayClient: class {
    createRequest = external.create;
    watch = external.watch;
  },
}));
vi.mock('../lib/kproof/offchain', () => ({ verifyOffChain: external.offchain }));
vi.mock('qrcode', () => ({ toDataURL: external.qr }));
let host: HTMLDivElement;
let root: Root;
let update: (status: RequestStatus) => void;
const word = (value: number) => '0x' + value.toString(16).padStart(64, '0');
function answer(scope: string): RequestStatus {
  return {
    requestId: 'cu-request',
    status: 'completed',
    circuit: 'mdl_kr_age',
    proof: '0x1234',
    publicInputs: [...Array.from(scopeHash(scope), word), ...Array(32).fill(word(0)), word(19), word(2026)],
  };
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find((node) => node.textContent?.includes(label));
  expect(button, label).toBeTruthy();
  await act(async () => {
    button!.click();
  });
}
async function receive(result?: RequestStatus) {
  await click('성인인증 및 결제 시작');
  await deliver(result ?? answer(external.create.mock.calls.at(-1)![1].scope));
}
async function deliver(result: RequestStatus) {
  await act(async () => update(result));
  await act(async () => vi.advanceTimersByTime(CU_RECEIPT_DELAY_MS));
}
const modal = () => host.querySelector('dialog')!;
const status = () => modal().querySelector('[role="status"]')!.textContent;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T03:00:00Z'));
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: '0x01' }) }));
  external.create.mockResolvedValue({
    requestId: 'cu-request',
    deepLink: 'kproof://proof-request?data=test',
  });
  external.qr.mockResolvedValue('data:image/png;base64,test');
  external.offchain.mockResolvedValue({ valid: true, ms: 20 });
  external.watch.mockImplementation((_id, callback) => {
    update = callback;
    return external.stop;
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<CuDemo />);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CU optional proof verification', () => {
  it('requests KProof age 19 with a fresh checkout scope', async () => {
    await click('성인인증 및 결제 시작');
    expect(external.create).toHaveBeenCalledWith(
      'mdl_kr_age',
      { scope: expect.stringMatching(/^kproof-demo:cu:checkout:/), ageThreshold: 19 },
      expect.stringContaining('CU')
    );
    expect(host.querySelector('a.cu-primary')?.getAttribute('href')).toMatch(/^kproof:/);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="맥주 수량 늘리기"]')!.disabled).toBe(true);
  });
  it('opens the real receipt and waits for the user to choose a verifier', async () => {
    await receive();
    expect(modal().hasAttribute('open')).toBe(true);
    expect(status()).toContain('처리 방식 선택');
    expect(modal().textContent).toContain('2 bytes');
    expect(modal().textContent).toContain('검증용 공개 입력 66개');
    expect(JSON.parse(modal().querySelector('pre')!.textContent!)).toEqual(
      answer(external.create.mock.calls[0][1].scope)
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(external.offchain).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('인증 및 결제 완료');
  });
  it('holds the loading state for two seconds and ignores duplicate completion events', async () => {
    await click('성인인증 및 결제 시작');
    const result = answer(external.create.mock.calls[0][1].scope);
    const arrivedAt = Date.now();
    await act(async () => update(result));
    expect(external.stop).toHaveBeenCalled();
    expect(modal()).toBeNull();
    expect(host.textContent).toContain('성인인증 증명 생성 중');
    expect(host.textContent).not.toContain('증명 수신 완료');
    await act(async () => vi.advanceTimersByTime(CU_RECEIPT_DELAY_MS - 1));
    expect(modal()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => update({ ...result, proof: '0xdead' }));
    await act(async () => vi.advanceTimersByTime(1));
    expect(modal().hasAttribute('open')).toBe(true);
    expect(JSON.parse(modal().querySelector('pre')!.textContent!).proof).toBe('0x1234');
    expect(modal().querySelector('.cu-receipt-top')!.textContent).toContain(
      new Date(arrivedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })
    );
  });
  it('discards a delayed receipt after cancellation and does not leak it into the next request', async () => {
    await click('성인인증 및 결제 시작');
    await act(async () => update(answer(external.create.mock.calls[0][1].scope)));
    await act(async () => vi.advanceTimersByTime(1_000));
    await click('요청 취소');
    await click('성인인증 및 결제 시작');
    await act(async () => vi.advanceTimersByTime(CU_RECEIPT_DELAY_MS));
    expect(modal()).toBeNull();
    expect(host.textContent).toContain('QR 스캔으로 인증 및 결제');
    expect(fetch).not.toHaveBeenCalled();
    await deliver(answer(external.create.mock.calls[1][1].scope));
    expect(modal().hasAttribute('open')).toBe(true);
  });
  it('clears the delayed receipt timer on unmount', async () => {
    await click('성인인증 및 결제 시작');
    await act(async () => update(answer(external.create.mock.calls[0][1].scope)));
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTime(CU_RECEIPT_DELAY_MS));
    expect(modal()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not expire a proof received just before the request deadline during its presentation delay', async () => {
    await click('성인인증 및 결제 시작');
    await act(async () => vi.advanceTimersByTime(CU_WAIT_MS - 1));
    await deliver(answer(external.create.mock.calls[0][1].scope));
    expect(modal().hasAttribute('open')).toBe(true);
    expect(host.textContent).not.toContain('인증 요청 만료');
  });
  it('uses only the contract read call when on-chain verification is selected', async () => {
    await receive();
    await click('온체인 검증 및 결제 실행');
    expect(fetch).toHaveBeenCalledWith(
      'https://sepolia.base.org',
      expect.objectContaining({ method: 'POST' })
    );
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).method).toBe('eth_call');
    expect(external.offchain).not.toHaveBeenCalled();
    expect(status()).toContain('검증 완료');
    expect(modal().querySelector('[aria-label="결제 영수증"]')).not.toBeNull();
    await click('결제 내역 확인');
    expect(host.querySelector('.cu-checkout-panel')!.textContent).toContain('인증 및 결제 완료');
  });
  it('uses local verification without an RPC call when off-chain is selected', async () => {
    await receive();
    await click('오프체인 검증하기');
    expect(external.offchain).toHaveBeenCalledWith(
      'mdl_kr_age',
      '0x1234',
      expect.any(Array),
      expect.any(Object)
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(host.textContent).toContain('오프체인 검증 완료 · 이 브라우저');
    expect(host.querySelector('[aria-label="결제 영수증"]')).toBeNull();
  });
  it('retains independent results when the same proof is verified both ways', async () => {
    await receive();
    await click('온체인 검증 및 결제 실행');
    await click('오프체인 검증하기');
    expect(host.querySelectorAll('.cu-verifier-card[data-state="passed"]')).toHaveLength(2);
    expect(host.textContent).toContain('온체인 + 오프체인 검증 완료');
    expect(external.create).toHaveBeenCalledTimes(1);
  });
  it.each(['scope', 'age', 'year', 'circuit'] as const)(
    'rejects a mismatched %s before invoking either verifier',
    async (fault) => {
      await click('성인인증 및 결제 시작');
      const result = answer(fault === 'scope' ? 'another-checkout' : external.create.mock.calls[0][1].scope);
      if (fault === 'age') result.publicInputs![64] = word(18);
      if (fault === 'year') result.publicInputs![65] = word(2025);
      if (fault === 'circuit') result.circuit = 'mdl_kr_ownership';
      await deliver(result);
      await click('온체인 검증 및 결제 실행');
      await click('오프체인 검증하기');
      expect(fetch).not.toHaveBeenCalled();
      expect(external.offchain).not.toHaveBeenCalled();
      expect(host.textContent).not.toContain('인증 및 결제 완료');
    }
  );
  it.each(['onchain', 'offchain'])('keeps purchase locked if %s rejects the proof', async (method) => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ result: '0x00' }) } as Response);
    external.offchain.mockResolvedValue({ valid: false, ms: 3 });
    await receive();
    await click(method === 'onchain' ? '온체인 검증 및 결제 실행' : '오프체인 검증하기');
    expect(host.textContent).not.toContain('인증 및 결제 완료');
    expect(status()).toContain('검증 실패');
  });
  it('retains a successful local check if the optional RPC comparison fails', async () => {
    await receive();
    await click('오프체인 검증하기');
    vi.mocked(fetch).mockRejectedValue(new Error('RPC unavailable'));
    await click('온체인 검증 및 결제 실행');
    expect(host.querySelectorAll('.cu-verifier-card[data-state="passed"]')).toHaveLength(1);
    expect(host.querySelectorAll('.cu-verifier-card[data-state="failed"]')).toHaveLength(1);
    expect(host.textContent).toContain('오프체인 검증 완료 · 이 브라우저');
  });
  it('shows checking, permits only one verifier at a time, and ignores a result after reset', async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    await receive();
    await click('온체인 검증 및 결제 실행');
    expect(status()).toContain('성인인증 및 결제 처리 중');
    expect(
      [...host.querySelectorAll<HTMLButtonElement>('.cu-verifier-card>button')].every(
        (button) => button.disabled
      )
    ).toBe(true);
    await click('주문 화면으로');
    await click('요청 취소');
    await act(async () => {
      resolve({ ok: true, json: async () => ({ result: '0x01' }) } as Response);
    });
    expect(host.textContent).toContain('성인인증 및 결제');
    expect(host.querySelector('dialog')).toBeNull();
  });
  it('times out an unavailable verifier and allows retrying the same proof', async () => {
    external.offchain.mockImplementation(() => new Promise(() => {}));
    await receive();
    await click('오프체인 검증하기');
    await act(async () => {
      vi.advanceTimersByTime(CU_VERIFY_MS);
    });
    expect(modal().textContent).toContain('검증 시간이 초과');
    external.offchain.mockResolvedValue({ valid: true, ms: 1 });
    await click('오프체인 다시 검증하기');
    expect(status()).toContain('검증 완료');
    expect(external.create).toHaveBeenCalledTimes(1);
  });
  it.each(['cancelled', 'expired', 'error'] as const)('handles relay %s without verifying', async (state) => {
    await click('성인인증 및 결제 시작');
    await act(async () => update({ requestId: 'cu-request', status: state }));
    expect(fetch).not.toHaveBeenCalled();
    expect(host.textContent).toContain('다시 인증하기');
  });
  it('expires an unanswered request', async () => {
    await click('성인인증 및 결제 시작');
    await act(async () => {
      vi.advanceTimersByTime(CU_WAIT_MS);
    });
    expect(host.textContent).toContain('인증 요청 만료');
    expect(external.stop).toHaveBeenCalled();
  });
  it('ignores a previous request after cancel and retries with a fresh scope', async () => {
    await click('성인인증 및 결제 시작');
    const old = update;
    const scope = external.create.mock.calls[0][1].scope;
    await click('요청 취소');
    await click('성인인증 및 결제 시작');
    await act(async () => old(answer(scope)));
    expect(host.querySelector('dialog')).toBeNull();
    expect(external.create.mock.calls[1][1].scope).not.toBe(scope);
  });
  it('does not open a popup over another tab, and can reopen a dismissed receipt', async () => {
    await act(async () => root.render(<CuDemo isActive={false} />));
    await receive();
    expect(modal().hasAttribute('open')).toBe(false);
    await act(async () => root.render(<CuDemo isActive />));
    expect(modal().hasAttribute('open')).toBe(true);
    await act(async () => {
      modal().dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }));
    });
    expect(modal().hasAttribute('open')).toBe(false);
    await click('검증 및 결제 진행');
    expect(modal().hasAttribute('open')).toBe(true);
  });
  it('refuses a non-KProof deep link', async () => {
    external.create.mockResolvedValue({ requestId: 'x', deepLink: 'javascript:alert(1)' });
    await click('성인인증 및 결제 시작');
    expect(external.qr).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).toBeTruthy();
  });
  it('rejects malformed input without a verification call', async () => {
    const result = answer('test');
    result.publicInputs = ['0x01'];
    expect(
      (
        await verifyAnswer({ circuitId: 'mdl_kr_age', inputs: { scope: 'test', ageThreshold: 19 } }, result, {
          environment: 'staging',
          method: 'offchain',
        })
      ).valid
    ).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(external.offchain).not.toHaveBeenCalled();
  });
  it('completes the checkout presentation only after on-chain success, without wallet or transfer calls', async () => {
    const wallet = vi.fn();
    vi.stubGlobal('ethereum', { request: wallet });
    await click('성인인증 및 결제 시작');
    expect(host.textContent).toContain('QR 스캔으로 인증 및 결제');
    expect(host.querySelector('.cu-payment-summary')!.textContent).toContain('3,000 dKRW');
    expect(host.querySelector('[aria-label="결제 영수증"]')).toBeNull();
    await deliver(answer(external.create.mock.calls[0][1].scope));
    expect(host.querySelector('[aria-label="결제 영수증"]')).toBeNull();
    await click('온체인 검증 및 결제 실행');
    expect(modal().querySelector('[aria-label="결제 영수증"]')!.textContent).toContain('3,000 dKRW');
    expect(wallet).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init!.body as string).method)).toEqual([
      'eth_call',
    ]);
    const chainButton = modal().querySelector<HTMLButtonElement>('.cu-verifier-card button')!;
    expect(chainButton.disabled).toBe(true);
    await act(async () => chainButton.click());
    expect(fetch).toHaveBeenCalledTimes(1);
    await click('결제 내역 확인');
    await click('다음 주문');
    expect(host.querySelector('[aria-label="결제 영수증"]')).toBeNull();
    expect(host.textContent).not.toContain('인증 및 결제 완료');
  });
  it('supports verification-only selection before QR creation', async () => {
    await click('오프체인');
    await click('성인인증 시작');
    expect(external.create.mock.calls[0][2]).toBe('CU 성인인증');
    expect(host.textContent).toContain('QR 스캔으로 성인인증');
    expect(host.querySelector('.cu-payment-summary')).toBeNull();
    await deliver(answer(external.create.mock.calls[0][1].scope));
    expect(modal().querySelector('[data-selected="true"]')!.textContent).toContain('오프체인');
    await click('오프체인 검증하기');
    expect(host.querySelector('[aria-label="결제 영수증"]')).toBeNull();
    await click('온체인 검증 및 결제 실행');
    expect(modal().querySelector('[aria-label="결제 영수증"]')).not.toBeNull();
  });
  it('keeps the order amount and receipt stable across an off-chain comparison', async () => {
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="맥주 수량 늘리기"]')!.click());
    await receive();
    await click('온체인 검증 및 결제 실행');
    const receipt = modal().querySelector('[aria-label="결제 영수증"]')!.textContent;
    expect(receipt).toContain('6,000 dKRW');
    expect(receipt).toContain('× 2');
    expect(host.querySelector<HTMLButtonElement>('[aria-label="맥주 수량 늘리기"]')!.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(5_000));
    external.offchain.mockResolvedValue({ valid: false, ms: 3 });
    await click('오프체인 검증하기');
    expect(modal().querySelector('[aria-label="결제 영수증"]')!.textContent).toBe(receipt);
  });
});
