import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Explicit import d3-transition to ensure selection.interrupt is correctly registered on d3-selection prototype.
// @reactflow/core's ESM version only imported d3-zoom and d3-selection, but d3-zoom's ESM version
// did not import d3-transition, causing selection.interrupt not registered and throwing error.
import 'd3-transition'
import { SuiClientProvider, WalletProvider, createNetworkConfig } from '@mysten/dapp-kit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@mysten/dapp-kit/dist/index.css'
import App from './App.tsx'

const queryClient = new QueryClient()

// 配置 Sui 网络（默认使用 mainnet）
const { networkConfig } = createNetworkConfig({
  testnet: { url: 'https://fullnode.testnet.sui.io:443', network: 'testnet' as const },
  mainnet: { url: 'https://fullnode.mainnet.sui.io:443', network: 'mainnet' as const },
  devnet: { url: 'https://fullnode.devnet.sui.io:443', network: 'devnet' as const },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="mainnet">
        <WalletProvider>
          <App />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </StrictMode>,
)
