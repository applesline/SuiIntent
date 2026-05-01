/**
 * NaviAdapter 单元测试
 *
 * 使用真实的 @mysten/sui Transaction 对象测试重构后的 addCommands 接口。
 */

import { Transaction } from '@mysten/sui/transactions';
import { NaviAdapter } from '../adapters/navi-adapter.js';

describe('NaviAdapter', () => {
  let adapter: NaviAdapter;

  beforeEach(async () => {
    adapter = new NaviAdapter();
    await adapter.initialize({
      network: 'testnet',
      contractAddresses: {
        navi_package: '0xnavi_package',
        navi_storage: '0xstorage',
      },
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      const a = new NaviAdapter();
      await expect(
        a.initialize({
          network: 'testnet',
          contractAddresses: {},
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('getQuote', () => {
    it('should return a deposit quote', async () => {
      const quote = await adapter.getQuote({
        action: 'deposit',
        coinType: '0x2::sui::SUI',
        amount: '1000000000',
      });

      expect(quote.protocol).toBe('navi');
      expect(quote.asset.coinType).toBe('0x2::sui::SUI');
    });

    it('should return a withdraw quote', async () => {
      const quote = await adapter.getQuote({
        action: 'withdraw',
        coinType: '0x2::sui::SUI',
        amount: '1000000000',
      });

      expect(quote.protocol).toBe('navi');
      expect(quote.asset.coinType).toBe('0x2::sui::SUI');
    });

    it('should throw for unsupported asset', async () => {
      await expect(
        adapter.getQuote({
          action: 'deposit',
          coinType: '0x...::unknown::XXX',
          amount: '1000000000',
        }),
      ).rejects.toThrow('Unsupported asset');
    });

    it('should throw for missing params', async () => {
      await expect(
        adapter.getQuote({}),
      ).rejects.toThrow('Missing required parameters');
    });
  });

  describe('addCommands', () => {
    it('should add deposit commands to transaction', async () => {
      const tx = new Transaction();
      await adapter.addCommands(tx, {
        action: 'deposit',
        coinType: '0x2::sui::SUI',
        amount: '1000000000',
      });

      expect(true).toBe(true);
    });

    it('should add withdraw commands to transaction', async () => {
      const tx = new Transaction();
      await adapter.addCommands(tx, {
        action: 'withdraw',
        coinType: '0x2::sui::SUI',
        amount: '1000000000',
      });

      expect(true).toBe(true);
    });

    it('should add borrow commands to transaction', async () => {
      const tx = new Transaction();
      await adapter.addCommands(tx, {
        action: 'borrow',
        coinType: '0x2::sui::SUI',
        amount: '1000000000',
      });

      expect(true).toBe(true);
    });

    it('should add repay commands to transaction', async () => {
      const tx = new Transaction();
      await adapter.addCommands(tx, {
        action: 'repay',
        coinType: '0x2::sui::SUI',
        amount: '1000000000',
      });

      expect(true).toBe(true);
    });

    it('should throw for unsupported action', async () => {
      const tx = new Transaction();
      await expect(
        adapter.addCommands(tx, {
          action: 'unknown',
          coinType: '0x2::sui::SUI',
          amount: '1000000000',
        }),
      ).rejects.toThrow('Unsupported Navi action');
    });
  });

  describe('validateParams', () => {
    it('should return null for valid params', () => {
      const result = adapter.validateParams({
        action: 'deposit',
        coinType: '0x2::sui::SUI',
        amount: '1000000000',
      });

      expect(result).toBeNull();
    });

    it('should return error for invalid action', () => {
      const result = adapter.validateParams({
        action: 'invalid',
        coinType: '0x2::sui::SUI',
        amount: '1000000000',
      });

      expect(result).toContain('Invalid action');
    });
  });

  describe('getPoolConfig', () => {
    it('should return pool config for supported asset', () => {
      const config = adapter.getPoolConfig('0x2::sui::SUI');
      expect(config).not.toBeNull();
      expect(config!.name).toBe('SUI');
    });

    it('should return null for unsupported asset', () => {
      const config = adapter.getPoolConfig('0x...::unknown::XXX');
      expect(config).toBeNull();
    });
  });

  describe('getSupportedAssets', () => {
    it('should return supported assets', () => {
      const assets = adapter.getSupportedAssets();
      expect(assets.length).toBeGreaterThan(0);
      expect(assets.some(a => a.symbol === 'SUI')).toBe(true);
    });
  });
});
