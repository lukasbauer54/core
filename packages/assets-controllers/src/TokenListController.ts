import type {
  ControllerGetStateAction,
  ControllerStateChangeEvent,
  RestrictedMessenger,
} from '@metamask/base-controller';
import { safelyExecute } from '@metamask/controller-utils';
import type {
  NetworkControllerStateChangeEvent,
  NetworkState,
  NetworkControllerGetNetworkClientByIdAction,
} from '@metamask/network-controller';
import { StaticIntervalPollingController } from '@metamask/polling-controller';
import type { Hex } from '@metamask/utils';
import { Mutex } from 'async-mutex';

import {
  isTokenListSupportedForNetwork,
  formatAggregatorNames,
  formatIconUrlWithProxy,
} from './assetsUtil';
import { fetchTokenListByChainId } from './token-service';

const DEFAULT_INTERVAL = 24 * 60 * 60 * 1000;
const DEFAULT_THRESHOLD = 24 * 60 * 60 * 1000;

const name = 'TokenListController';

export type TokenListToken = {
  name: string;
  symbol: string;
  decimals: number;
  address: string;
  occurrences: number;
  aggregators: string[];
  iconUrl: string;
};

export type TokenListMap = Record<string, TokenListToken>;

type DataCache = {
  timestamp: number;
  data: TokenListMap;
};
export type TokensChainsCache = {
  [chainId: Hex]: DataCache;
};

export type TokenListState = {
  tokensChainsCache: TokensChainsCache;
  preventPollingOnNetworkRestart: boolean;
};

export type TokenListStateChange = ControllerStateChangeEvent<
  typeof name,
  TokenListState
>;

export type TokenListControllerEvents = TokenListStateChange;

export type GetTokenListState = ControllerGetStateAction<
  typeof name,
  TokenListState
>;

export type TokenListControllerActions = GetTokenListState;

type AllowedActions = NetworkControllerGetNetworkClientByIdAction;

type AllowedEvents = NetworkControllerStateChangeEvent;

export type TokenListControllerMessenger = RestrictedMessenger<
  typeof name,
  TokenListControllerActions | AllowedActions,
  TokenListControllerEvents | AllowedEvents,
  AllowedActions['type'],
  AllowedEvents['type']
>;

const metadata = {
  tokensChainsCache: { persist: true, anonymous: true },
  preventPollingOnNetworkRestart: { persist: true, anonymous: true },
};

export const getDefaultTokenListState = (): TokenListState => {
  return {
    tokensChainsCache: {},
    preventPollingOnNetworkRestart: false,
  };
};

/** The input to start polling for the {@link TokenListController} */
type TokenListPollingInput = {
  chainId: Hex;
};

/**
 * Controller that passively polls on a set interval for the list of tokens from metaswaps api
 */
export class TokenListController extends StaticIntervalPollingController<TokenListPollingInput>()<
  typeof name,
  TokenListState,
  TokenListControllerMessenger
> {
  private readonly mutex = new Mutex();

  private intervalId?: ReturnType<typeof setTimeout>;

  private readonly intervalDelay: number;

  private readonly cacheRefreshThreshold: number;

  private chainId: Hex;

  private abortController: AbortController;

  /**
   * Creates a TokenListController instance.
   *
   * @param options - The controller options.
   * @param options.chainId - The chain ID of the current network.
   * @param options.onNetworkStateChange - A function for registering an event handler for network state changes.
   * @param options.interval - The polling interval, in milliseconds.
   * @param options.cacheRefreshThreshold - The token cache expiry time, in milliseconds.
   * @param options.messenger - A restricted messenger.
   * @param options.state - Initial state to set on this controller.
   * @param options.preventPollingOnNetworkRestart - Determines whether to prevent poilling on network restart in extension.
   */
  constructor({
    chainId,
    preventPollingOnNetworkRestart = false,
    onNetworkStateChange,
    interval = DEFAULT_INTERVAL,
    cacheRefreshThreshold = DEFAULT_THRESHOLD,
    messenger,
    state,
  }: {
    chainId: Hex;
    preventPollingOnNetworkRestart?: boolean;
    onNetworkStateChange?: (
      listener: (networkState: NetworkState) => void,
    ) => void;
    interval?: number;
    cacheRefreshThreshold?: number;
    messenger: TokenListControllerMessenger;
    state?: Partial<TokenListState>;
  }) {
    super({
      name,
      metadata,
      messenger,
      state: { ...getDefaultTokenListState(), ...state },
    });
    this.intervalDelay = interval;
    this.setIntervalLength(interval);
    this.cacheRefreshThreshold = cacheRefreshThreshold;
    this.chainId = chainId;
    this.updatePreventPollingOnNetworkRestart(preventPollingOnNetworkRestart);
    this.abortController = new AbortController();
    if (onNetworkStateChange) {
      // TODO: Either fix this lint violation or explain why it's necessary to ignore.
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onNetworkStateChange(async (networkControllerState) => {
        await this.#onNetworkControllerStateChange(networkControllerState);
      });
    } else {
      this.messagingSystem.subscribe(
        'NetworkController:stateChange',
        // TODO: Either fix this lint violation or explain why it's necessary to ignore.
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        async (networkControllerState) => {
          await this.#onNetworkControllerStateChange(networkControllerState);
        },
      );
    }
  }

  /**
   * Updates state and restarts polling on changes to the network controller
   * state.
   *
   * @param networkControllerState - The updated network controller state.
   */
  async #onNetworkControllerStateChange(networkControllerState: NetworkState) {
    const selectedNetworkClient = this.messagingSystem.call(
      'NetworkController:getNetworkClientById',
      networkControllerState.selectedNetworkClientId,
    );
    const { chainId } = selectedNetworkClient.configuration;

    if (this.chainId !== chainId) {
      this.abortController.abort();
      this.abortController = new AbortController();
      this.chainId = chainId;
      if (this.state.preventPollingOnNetworkRestart) {
        this.clearingTokenListData();
      }
    }
  }

  // Eventually we want to remove start/restart/stop controls in favor of new _executePoll API
  // Maintaining these functions for now until we can safely deprecate them for backwards compatibility
  /**
   * Start polling for the token list.
   *
   * @deprecated This method is deprecated and will be removed in the future.
   * Consider using the new polling approach instead
   */
  async start() {
    if (!isTokenListSupportedForNetwork(this.chainId)) {
      return;
    }
    await this.#startDeprecatedPolling();
  }

  /**
   * Restart polling for the token list.
   *
   * @deprecated This method is deprecated and will be removed in the future.
   * Consider using the new polling approach instead
   */
  async restart() {
    this.stopPolling();
    await this.#startDeprecatedPolling();
  }

  /**
   * Stop polling for the token list.
   *
   * @deprecated This method is deprecated and will be removed in the future.
   * Consider using the new polling approach instead
   */
  stop() {
    this.stopPolling();
  }

  /**
   * This stops any active polling.
   *
   * @deprecated This method is deprecated and will be removed in the future.
   * Consider using the new polling approach instead
   */
  override destroy() {
    super.destroy();
    this.stopPolling();
  }

  /**
   * This stops any active polling intervals.
   *
   * @deprecated This method is deprecated and will be removed in the future.
   * Consider using the new polling approach instead
   */
  private stopPolling() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  /**
   * Starts a new polling interval for a given chainId (this should be deprecated in favor of _executePoll)
   *
   * @deprecated This method is deprecated and will be removed in the future.
   * Consider using the new polling approach instead
   */
  async #startDeprecatedPolling(): Promise<void> {
    // renaming this to avoid collision with base class
    await safelyExecute(() => this.fetchTokenList(this.chainId));
    // TODO: Either fix this lint violation or explain why it's necessary to ignore.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.intervalId = setInterval(async () => {
      await safelyExecute(() => this.fetchTokenList(this.chainId));
    }, this.intervalDelay);
  }

  /**
   * This starts a new polling loop for any given chain. Under the hood it is deduping polls
   *
   * @param input - The input for the poll.
   * @param input.chainId - The chainId of the chain to trigger the fetch.
   * @returns A promise that resolves when this operation completes.
   */
  async _executePoll({ chainId }: TokenListPollingInput): Promise<void> {
    return this.fetchTokenList(chainId);
  }

  /**
   * Fetching token list from the Token Service API. This will fetch tokens across chains. It will update tokensChainsCache (scoped across chains), and also the tokenList (scoped for the selected chain)
   *
   * @param chainId - The chainId of the current chain triggering the fetch.
   */
  async fetchTokenList(chainId: Hex): Promise<void> {
    const releaseLock = await this.mutex.acquire();
    try {
      if (this.isCacheValid(chainId)) {
        return;
      }

      // Fetch fresh token list from the API
      const tokensFromAPI = await safelyExecute(
        () =>
          fetchTokenListByChainId(
            chainId,
            this.abortController.signal,
          ) as Promise<TokenListToken[]>,
      );

      // Have response - process and update list
      if (tokensFromAPI) {
        // Format tokens from API (HTTP) and update tokenList
        const tokenList: TokenListMap = {};
        for (const token of tokensFromAPI) {
          tokenList[token.address] = {
            ...token,
            aggregators: formatAggregatorNames(token.aggregators),
            iconUrl: formatIconUrlWithProxy({
              chainId,
              tokenAddress: token.address,
            }),
          };
        }

        this.update((state) => {
          const newDataCache: DataCache = { data: {}, timestamp: Date.now() };
          state.tokensChainsCache[chainId] ??= newDataCache;
          state.tokensChainsCache[chainId].data = tokenList;
          state.tokensChainsCache[chainId].timestamp = Date.now();
        });
        return;
      }

      // No response - fallback to previous state, or initialise empty
      if (!tokensFromAPI) {
        this.update((state) => {
          const newDataCache: DataCache = { data: {}, timestamp: Date.now() };
          state.tokensChainsCache[chainId] ??= newDataCache;
          state.tokensChainsCache[chainId].timestamp = Date.now();
        });
      }
    } finally {
      releaseLock();
    }
  }

  isCacheValid(chainId: Hex): boolean {
    const { tokensChainsCache }: TokenListState = this.state;
    const timestamp: number | undefined = tokensChainsCache[chainId]?.timestamp;
    const now = Date.now();
    return (
      timestamp !== undefined && now - timestamp < this.cacheRefreshThreshold
    );
  }

  /**
   * Clearing tokenList and tokensChainsCache explicitly.
   */
  clearingTokenListData(): void {
    this.update(() => {
      return {
        ...this.state,
        tokensChainsCache: {},
      };
    });
  }

  /**
   * Updates preventPollingOnNetworkRestart from extension.
   *
   * @param shouldPreventPolling - Determine whether to prevent polling on network change
   */
  updatePreventPollingOnNetworkRestart(shouldPreventPolling: boolean): void {
    this.update(() => {
      return {
        ...this.state,
        preventPollingOnNetworkRestart: shouldPreventPolling,
      };
    });
  }
}

export default TokenListController;
