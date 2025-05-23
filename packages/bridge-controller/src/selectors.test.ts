import { SolScope } from '@metamask/keyring-api';

import type { BridgeAppState } from './selectors';
import {
  selectExchangeRateByChainIdAndAddress,
  selectIsAssetExchangeRateInState,
  selectBridgeQuotes,
  selectIsQuoteExpired,
  selectBridgeFeatureFlags,
} from './selectors';
import { SortOrder, RequestStatus, ChainId } from './types';

describe('Bridge Selectors', () => {
  describe('selectExchangeRateByChainIdAndAddress', () => {
    const mockExchangeRateSources = {
      assetExchangeRates: {
        'eip155:1/erc20:0x123': {
          exchangeRate: '2.5',
          usdExchangeRate: '1.5',
        },
        'solana:101/spl:456': {
          exchangeRate: '3.0',
        },
      },
      currencyRates: {
        ETH: {
          conversionRate: 1800,
          usdConversionRate: 1800,
        },
      },
      marketData: {
        '0x1': {
          '0xabc': {
            price: 50,
          },
        },
      },
      conversionRates: {
        [`${SolScope.Mainnet}/token:789`]: {
          rate: '4.0',
        },
      },
    } as unknown as BridgeAppState;

    it('should return empty object if chainId or address is missing', () => {
      expect(
        selectExchangeRateByChainIdAndAddress(
          mockExchangeRateSources,
          undefined,
          undefined,
        ),
      ).toStrictEqual({});
      expect(
        selectExchangeRateByChainIdAndAddress(mockExchangeRateSources, '1'),
      ).toStrictEqual({});
      expect(
        selectExchangeRateByChainIdAndAddress(
          mockExchangeRateSources,
          undefined,
          '0x123',
        ),
      ).toStrictEqual({});
    });

    it('should return bridge controller rate if available', () => {
      const result = selectExchangeRateByChainIdAndAddress(
        mockExchangeRateSources,
        '1',
        '0x123',
      );
      expect(result).toStrictEqual({
        exchangeRate: '2.5',
        usdExchangeRate: '1.5',
      });
    });

    it('should handle Solana chain rates', () => {
      const result = selectExchangeRateByChainIdAndAddress(
        mockExchangeRateSources,
        SolScope.Mainnet,
        '789',
      );
      expect(result).toStrictEqual({
        exchangeRate: '4.0',
        usdExchangeRate: undefined,
      });
    });

    it('should handle EVM native asset rates', () => {
      const result = selectExchangeRateByChainIdAndAddress(
        mockExchangeRateSources,
        '1',
        '0x0000000000000000000000000000000000000000',
      );
      expect(result).toStrictEqual({
        exchangeRate: '1800',
        usdExchangeRate: '1800',
      });
    });

    it('should handle EVM token rates', () => {
      const result = selectExchangeRateByChainIdAndAddress(
        mockExchangeRateSources,
        '1',
        '0xabc',
      );
      expect(result).toStrictEqual({
        exchangeRate: '50',
        usdExchangeRate: undefined,
      });
    });
  });

  describe('selectIsAssetExchangeRateInState', () => {
    const mockExchangeRateSources = {
      assetExchangeRates: {
        'eip155:1/erc20:0x123': {
          exchangeRate: '2.5',
        },
      },
      currencyRates: {},
      marketData: {},
      conversionRates: {},
    } as unknown as BridgeAppState;

    it('should return true if exchange rate exists for both currency and USD', () => {
      expect(
        selectIsAssetExchangeRateInState(
          {
            ...mockExchangeRateSources,
            assetExchangeRates: {
              ...mockExchangeRateSources.assetExchangeRates,
              'eip155:1/erc20:0x123': {
                ...mockExchangeRateSources.assetExchangeRates[
                  'eip155:1/erc20:0x123'
                ],
                usdExchangeRate: '1.5',
              },
            },
          },
          '1',
          '0x123',
        ),
      ).toBe(true);
    });

    it('should return false if USD exchange rate does not exist', () => {
      expect(
        selectIsAssetExchangeRateInState(mockExchangeRateSources, '1', '0x123'),
      ).toBe(false);
    });

    it('should return false if exchange rate does not exist', () => {
      expect(
        selectIsAssetExchangeRateInState(mockExchangeRateSources, '1', '0x456'),
      ).toBe(false);
    });

    it('should return false if parameters are missing', () => {
      expect(selectIsAssetExchangeRateInState(mockExchangeRateSources)).toBe(
        false,
      );
      expect(
        selectIsAssetExchangeRateInState(mockExchangeRateSources, '1'),
      ).toBe(false);
    });
  });

  describe('selectIsQuoteExpired', () => {
    const mockState = {
      quotes: [],
      quoteRequest: {
        srcChainId: '1',
        destChainId: '137',
        srcTokenAddress: '0x0000000000000000000000000000000000000000',
        destTokenAddress: '0x0000000000000000000000000000000000000000',
        insufficientBal: false,
      },
      quotesLastFetched: Date.now(),
      quotesLoadingStatus: RequestStatus.FETCHED,
      quoteFetchError: null,
      quotesRefreshCount: 0,
      quotesInitialLoadTime: Date.now(),
      remoteFeatureFlags: {
        bridgeConfig: {
          maxRefreshCount: 5,
          refreshRate: 30000,
          chains: {},
          support: true,
          minimumVersion: '0.0.0',
        },
      },
      assetExchangeRates: {},
      currencyRates: {},
      marketData: {},
      conversionRates: {},
      participateInMetaMetrics: true,
      gasFeeEstimates: {
        estimatedBaseFee: '50',
        medium: {
          suggestedMaxPriorityFeePerGas: '75',
          suggestedMaxFeePerGas: '1',
        },
        high: {
          suggestedMaxPriorityFeePerGas: '100',
          suggestedMaxFeePerGas: '2',
        },
      },
    } as unknown as BridgeAppState;

    const mockClientParams = {
      sortOrder: SortOrder.COST_ASC,
      selectedQuote: null,
    };

    it('should return false when quote is not expired', () => {
      const result = selectIsQuoteExpired(
        mockState,
        mockClientParams,
        Date.now(),
      );
      expect(result).toBe(false);
    });

    it('should return true when quote is expired', () => {
      const stateWithOldQuote = {
        ...mockState,
        quotesRefreshCount: 5,
        quotesLastFetched: Date.now() - 40000, // 40 seconds ago
      } as unknown as BridgeAppState;

      const result = selectIsQuoteExpired(
        stateWithOldQuote,
        mockClientParams,
        Date.now(),
      );
      expect(result).toBe(true);
    });

    it('should handle chain-specific quote refresh rate', () => {
      const stateWithOldQuote = {
        ...mockState,
        quotesRefreshCount: 5,
        quotesLastFetched: Date.now() - 40000, // 40 seconds ago
        remoteFeatureFlags: {
          bridgeConfig: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...(mockState.remoteFeatureFlags.bridgeConfig as any),
            chains: {
              '1': {
                refreshRate: 41000,
                isActiveSrc: true,
                isActiveDest: true,
              },
            },
          },
        },
      } as unknown as BridgeAppState;

      const result = selectIsQuoteExpired(
        stateWithOldQuote,
        mockClientParams,
        Date.now(),
      );
      expect(result).toBe(false);
    });

    it('should handle quote expiration when srcChainId is unset', () => {
      const stateWithOldQuote = {
        ...mockState,
        quoteRequest: {
          ...mockState.quoteRequest,
          srcChainId: undefined,
        },
        quotesRefreshCount: 5,
        quotesLastFetched: Date.now() - 40000, // 40 seconds ago
        remoteFeatureFlags: {
          bridgeConfig: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...(mockState.remoteFeatureFlags.bridgeConfig as any),
            chains: {
              '1': {
                refreshRate: 41000,
                isActiveSrc: true,
                isActiveDest: true,
              },
            },
          },
        },
      } as unknown as BridgeAppState;

      const result = selectIsQuoteExpired(
        stateWithOldQuote,
        mockClientParams,
        Date.now(),
      );
      expect(result).toBe(true);
    });
  });

  describe('selectBridgeQuotes', () => {
    const mockQuote = {
      quote: {
        srcChainId: '1',
        destChainId: '137',
        srcTokenAmount: '1000000000000000000',
        destTokenAmount: '2000000000000000000',
        srcAsset: {
          address: '0x0000000000000000000000000000000000000000',
          decimals: 18,
        },
        destAsset: {
          address: '0x0000000000000000000000000000000000000000',
          decimals: 18,
        },
        bridges: ['bridge1'],
        bridgeId: 'bridge1',
        steps: ['step1'],
        feeData: {
          metabridge: {
            amount: '100000000000000000',
          },
        },
      },
      estimatedProcessingTimeInSeconds: 300,
      trade: {
        value: '0x0',
        gasLimit: '21000',
      },
      approval: {
        gasLimit: '46000',
      },
    };

    const mockState = {
      quotes: [mockQuote],
      quoteRequest: {
        srcChainId: '1',
        destChainId: '137',
        srcTokenAddress: '0x0000000000000000000000000000000000000000',
        destTokenAddress: '0x0000000000000000000000000000000000000000',
        insufficientBal: false,
      },
      quotesLastFetched: Date.now(),
      quotesLoadingStatus: RequestStatus.FETCHED,
      quoteFetchError: null,
      quotesRefreshCount: 0,
      quotesInitialLoadTime: Date.now(),
      remoteFeatureFlags: {
        bridgeConfig: {
          minimumVersion: '0.0.0',
          maxRefreshCount: 5,
          refreshRate: 30000,
          chains: {},
          support: true,
        },
      },
      assetExchangeRates: {},
      currencyRates: {
        ETH: {
          conversionRate: 1800,
          usdConversionRate: 1800,
        },
      },
      marketData: {},
      conversionRates: {},
      participateInMetaMetrics: true,
    } as unknown as BridgeAppState;

    const mockClientParams = {
      bridgeFeesPerGas: {
        estimatedBaseFeeInDecGwei: '50',
        maxPriorityFeePerGasInDecGwei: '2',
        maxFeePerGasInDecGwei: '100',
      },
      sortOrder: SortOrder.COST_ASC,
      selectedQuote: null,
    };

    it('should return sorted quotes with metadata', () => {
      const result = selectBridgeQuotes(mockState, mockClientParams);

      expect(result.sortedQuotes).toHaveLength(1);
      expect(result.recommendedQuote).toBeDefined();
      expect(result.activeQuote).toBeDefined();
      expect(result.isLoading).toBe(false);
      expect(result.quoteFetchError).toBeNull();
      expect(result.isQuoteGoingToRefresh).toBe(true);
    });

    it('should only fetch quotes once if balance is insufficient', () => {
      const result = selectBridgeQuotes(
        {
          ...mockState,
          quoteRequest: { ...mockState.quoteRequest, insufficientBal: true },
        },
        mockClientParams,
      );

      expect(result.sortedQuotes).toHaveLength(1);
      expect(result.recommendedQuote).toBeDefined();
      expect(result.activeQuote).toBeDefined();
      expect(result.isLoading).toBe(false);
      expect(result.quoteFetchError).toBeNull();
      expect(result.isQuoteGoingToRefresh).toBe(false);
    });

    it('should handle different sort orders', () => {
      const resultCostAsc = selectBridgeQuotes(mockState, {
        ...mockClientParams,
        sortOrder: SortOrder.COST_ASC,
      });
      const resultEtaAsc = selectBridgeQuotes(mockState, {
        ...mockClientParams,
        sortOrder: SortOrder.ETA_ASC,
      });

      expect(resultCostAsc.sortedQuotes).toBeDefined();
      expect(resultEtaAsc.sortedQuotes).toBeDefined();
    });

    it('should handle selected quote', () => {
      const result = selectBridgeQuotes(mockState, {
        ...mockClientParams,
        selectedQuote: mockQuote as never,
      });

      expect(result.activeQuote).toStrictEqual(mockQuote);
    });

    it('should handle quote refresh state', () => {
      const stateWithMaxRefresh = {
        ...mockState,
        quotesRefreshCount: 5,
      } as unknown as BridgeAppState;

      const result = selectBridgeQuotes(stateWithMaxRefresh, mockClientParams);
      expect(result.isQuoteGoingToRefresh).toBe(false);
    });

    it('should handle loading state', () => {
      const loadingState = {
        ...mockState,
        quotesLoadingStatus: RequestStatus.LOADING,
      } as unknown as BridgeAppState;

      const result = selectBridgeQuotes(loadingState, mockClientParams);
      expect(result.isLoading).toBe(true);
    });

    it('should handle error state', () => {
      const errorState = {
        ...mockState,
        quoteFetchError: new Error('Test error'),
        quotesLoadingStatus: RequestStatus.ERROR,
      } as unknown as BridgeAppState;

      const result = selectBridgeQuotes(errorState, mockClientParams);
      expect(result.quoteFetchError).toBeDefined();
    });

    it('should handle Solana quotes', () => {
      const solanaQuote = {
        ...mockQuote,
        quote: {
          ...mockQuote.quote,
          srcChainId: ChainId.SOLANA,
          srcAsset: {
            address: 'solanaNativeAddress',
            decimals: 9,
          },
        },
        solanaFeesInLamports: '5000',
      };

      const solanaState = {
        ...mockState,
        quotes: [solanaQuote],
        quoteRequest: {
          ...mockState.quoteRequest,
          srcChainId: ChainId.SOLANA,
          srcTokenAddress: 'solanaNativeAddress',
        },
      } as unknown as BridgeAppState;

      const result = selectBridgeQuotes(solanaState, mockClientParams);
      expect(result.sortedQuotes).toHaveLength(1);
    });
  });

  describe('selectBridgeFeatureFlags', () => {
    const mockValidBridgeConfig = {
      minimumVersion: '0.0.0',
      refreshRate: 3,
      maxRefreshCount: 1,
      support: true,
      chains: {
        '1': {
          isActiveSrc: true,
          isActiveDest: true,
        },
        '10': {
          isActiveSrc: true,
          isActiveDest: false,
        },
        '59144': {
          isActiveSrc: true,
          isActiveDest: true,
        },
        '120': {
          isActiveSrc: true,
          isActiveDest: false,
        },
        '137': {
          isActiveSrc: false,
          isActiveDest: true,
        },
        '11111': {
          isActiveSrc: false,
          isActiveDest: true,
        },
        '1151111081099710': {
          isActiveSrc: true,
          isActiveDest: true,
        },
      },
    };

    const mockInvalidBridgeConfig = {
      minimumVersion: 1, // Should be a string
      maxRefreshCount: 'invalid', // Should be a number
      refreshRate: 'invalid', // Should be a number
      chains: 'invalid', // Should be an object
    };

    it('should return formatted feature flags when valid config is provided', () => {
      const result = selectBridgeFeatureFlags({
        remoteFeatureFlags: {
          bridgeConfig: mockValidBridgeConfig,
        },
      });

      expect(result).toStrictEqual({
        minimumVersion: '0.0.0',
        refreshRate: 3,
        maxRefreshCount: 1,
        support: true,
        chains: {
          'eip155:1': {
            isActiveSrc: true,
            isActiveDest: true,
          },
          'eip155:10': {
            isActiveSrc: true,
            isActiveDest: false,
          },
          'eip155:59144': {
            isActiveSrc: true,
            isActiveDest: true,
          },
          'eip155:120': {
            isActiveSrc: true,
            isActiveDest: false,
          },
          'eip155:137': {
            isActiveSrc: false,
            isActiveDest: true,
          },
          'eip155:11111': {
            isActiveSrc: false,
            isActiveDest: true,
          },
          'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': {
            isActiveSrc: true,
            isActiveDest: true,
          },
        },
      });
    });

    it('should return default feature flags when invalid config is provided', () => {
      const result = selectBridgeFeatureFlags({
        remoteFeatureFlags: {
          bridgeConfig: mockInvalidBridgeConfig,
        },
      });

      expect(result).toStrictEqual({
        minimumVersion: '0.0.0',
        maxRefreshCount: 5,
        refreshRate: 30000,
        chains: {},
        support: false,
      });
    });

    it('should return default feature flags when bridgeConfig is undefined', () => {
      const result = selectBridgeFeatureFlags({
        // @ts-expect-error - This is a test case
        remoteFeatureFlags: {},
      });

      expect(result).toStrictEqual({
        minimumVersion: '0.0.0',
        maxRefreshCount: 5,
        refreshRate: 30000,
        chains: {},
        support: false,
      });
    });

    it('should return default feature flags when bridgeConfig is null', () => {
      const result = selectBridgeFeatureFlags({
        remoteFeatureFlags: {
          bridgeConfig: null,
        },
      });

      expect(result).toStrictEqual({
        minimumVersion: '0.0.0',
        maxRefreshCount: 5,
        refreshRate: 30000,
        chains: {},
        support: false,
      });
    });
  });
});
