/**
 * CetusAdapter 单元测试
 *
 * 使用真实的 @mysten/sui Transaction 对象进行测试。
 */

import { Transaction } from '@mysten/sui/transactions';
import { CetusAdapter } from '../adapters/cetus-adapter.js';

describe('CetusAdapter', () => {
  let adapter: CetusAdapter;

  beforeEach(async () => {
    adapter = new CetusAdapter();
    await adapter.initialize({
      network: 'testnet',
      contractAddresses: {
        cetus_package: '0xcetus_package',
      },
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      const a = new CetusAdapter();
      await expect(
        a.initialize({
          network: 'testnet',
          contractAddresses: {},
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('getQuote', () => {
    it('should return a swap quote', async () => {
      const quote = await adapter.getQuote({
        coinTypeIn: '0x2::sui::SUI',
        coinTypeOut: '0x...::usdc::USDC',
        amount: '1000000000',
      });

      expect(quote.protocol).toBe('cetus');
      expect(quote.fromToken.coinType).toBe('0x2::sui::SUI');
      expect(quote.toToken.coinType).toBe('0x...::usdc::USDC');
      expect(quote.minimumReceived).toBeDefined();
    });

    it('should throw for missing params', async () => {
      await expect(
        adapter.getQuote({}),
      ).rejects.toThrow('Missing required parameters');
    });
  });

  describe('addCommands', () => {
    it('should add swap commands to transaction', async () => {
      const tx = new Transaction();
      await adapter.addCommands(tx, {
        poolId: '0xpool123',
        coinTypeIn: '0x2::sui::SUI',
        coinTypeOut: '0x...::usdc::USDC',
        amount: '1000000000',
      });

      // 验证 addCommands 不会抛出异常
      expect(true).toBe(true);
    });

    it('should throw for missing params', async () => {
      const tx = new Transaction();
      await expect(
        adapter.addCommands(tx, {}),
      ).rejects.toThrow('Missing required parameters for Cetus swap');
    });
  });

  describe('validateParams', () => {
    it('should return null for valid params', () => {
      const result = adapter.validateParams({
        coinTypeIn: '0x2::sui::SUI',
        coinTypeOut: '0x...::usdc::USDC',
        amount: '1000000000',
      });

      expect(result).toBeNull();
    });

    it('should return error for missing params', () => {
      const result = adapter.validateParams({});
      expect(result).toContain('Missing required parameter');
    });
  });

  describe('getPoolInfo', () => {
    it('should return pool info', async () => {
      const info = await adapter.getPoolInfo('0xpool123');
      expect(info.poolId).toBe('0xpool123');
      expect(info.fee).toBe(30);
    });
  });
});
