<p align="center">
  <img src="./packages/web/public/logo.jpg" width="200" alt="SuiIntent Logo" />
</p>

<h1 align="center">SuiIntent</h1>
<p align="center">
  <strong>A Natural Language-Driven Cross-Protocol DeFi Intent Orchestration Engine for Sui</strong>
</p>

<p align="center">
  <a href="https://github.com/applesline/SuiIntent/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License" />
  </a>
  <a href="https://nodejs.org">
    <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen" alt="Node Version" />
  </a>
  <a href="https://pnpm.io">
    <img src="https://img.shields.io/badge/package%20manager-pnpm-orange" alt="Package Manager" />
  </a>
  <a href="https://github.com/applesline/SuiIntent/issues">
    <img src="https://img.shields.io/github/issues/applesline/SuiIntent" alt="Issues" />
  </a>
</p>

<p align="center">
  <a href="README.md">English</a> | <b>中文</b>
</p>

---

## 🌟 One-Line Introduction

**SuiIntent** is a **cross-protocol DeFi intent orchestration engine** on the Sui blockchain. Simply describe your DeFi operations in natural language, and it will automatically understand your intent, orchestrate cross-protocol operations, construct a PTB (Programmable Transaction Block), and execute it with a single wallet signature.

> 💡 **Core Philosophy**: From "manually building multiple transactions" to "completing cross-protocol DeFi operations with one sentence"

---

## 🎯 Why SuiIntent?

The Sui ecosystem features numerous DeFi protocols including Cetus (DEX), Navi (Lending), Aftermath, Turbos, and more. However, users face three major pain points when performing cross-protocol operations:

| Pain Point | Traditional Approach | SuiIntent's Approach |
|------------|---------------------|---------------------|
| **Complex Operations** | Need to open multiple DApps and manually build multiple transactions | Describe your needs in one sentence, automatically orchestrate cross-protocol operations |
| **Gas Waste** | Each step requires a separate signature, paying gas multiple times | Leverage Sui PTB to merge multi-step operations into a single transaction — one signature, one gas fee |
| **High Barrier** | Need to understand each protocol's contract addresses and parameter formats | Natural language input, AI automatically parses parameters, one-click wallet signature |

**SuiIntent transforms Sui DeFi from an "expert tool" into "everyone's assistant."**

---

## ✨ Key Features

### 🧠 Natural Language → Cross-Protocol PTB

```
You input: "Swap 0.1 SUI for USDC on Cetus, then deposit USDC on Navi"

SuiIntent automatically completes:
┌─────────────────────────────────────────────────────────────┐
│ ① LLM Intent Parsing                                        │
│    └─ Identify needs: Cetus Swap + Navi Deposit             │
│    └─ Extract params: amount=0.1 SUI, coinIn=SUI, coinOut=USDC │
│                                                             │
│ ② Cross-Protocol Orchestration                              │
│    └─ Step 1: Cetus Swap (SUI → USDC)                      │
│    └─ Step 2: Navi Deposit (deposit USDC)                   │
│    └─ Auto-handle inter-step data dependencies (Swap output as Deposit input) │
│                                                             │
│ ③ PTB Construction                                          │
│    └─ Merge into a single Programmable Transaction Block     │
│    └─ Auto-resolve pool types, query sqrtPrice, calculate slippage │
│    └─ Handle Coin ownership (merge remaining SUI to gas, transfer outputs) │
│                                                             │
| ④ Wallet Signature & Execution                              │
│    └─ Browser wallet confirmation → one signature → on-chain execution │
│    └─ Atomicity guarantee: all succeed or all fail           │
└─────────────────────────────────────────────────────────────┘
```

**No need to switch between multiple DApps, no need to manually build transactions — just speak naturally.**

### 🔄 Supported DeFi Protocols

| Protocol | Type | Supported Operations | Integration Status |
|----------|------|---------------------|-------------------|
| **Cetus** | DEX (AMM) | Swap (token exchange) | ✅ Real contract calls |
| **Navi** | Lending Protocol | Deposit, Withdraw, Borrow, Repay | ✅ Real contract calls |
| **Sui Native** | Blockchain Native | Transfer | ✅ Real contract calls |

### ⚡ PTB Multi-Step Orchestration — Core Technical Highlight

Leveraging Sui's **Programmable Transaction Block (PTB)** atomicity to merge multi-step cross-protocol operations into a single transaction:

- **Atomic Execution**: All operations either succeed or fail together
- **One Signature**: Users only need to confirm once in their wallet
- **One Gas Fee**: The merged transaction pays only one gas fee
- **Inter-Step Data Passing**: Automatically handles the output of one step as input to the next

**Typical Cross-Protocol Scenario:**
```
"Swap SUI for USDC on Cetus, then deposit USDC on Navi, and finally transfer the yield to 0x..."
→ Merged into 1 PTB transaction
→ 1 signature
→ 1 gas fee
```

### 🖥️ Web Management Console

| Page | Function |
|------|----------|
| **💬 Intent Orchestration** | AI chat-style interaction, natural language → cross-protocol PTB |
| **📋 Workflows** | View, edit, and execute saved workflows |
| **🧪 Testnet Verification** | Verify cross-protocol operations on Sui Testnet |

### 🔐 Wallet-Driven Architecture

- Integrates Sui browser wallets via `@mysten/dapp-kit`
- Private keys never leave the wallet extension
- All transactions require manual confirmation in the wallet
- Supports one-click switching between mainnet and testnet

---

## 🏗️ Architecture Design

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interaction Layer                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Web Dashboard (React + Vite)             │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  │   │
│  │  │ Intent      │  │ Workflow     │  │ Testnet     │  │   │
│  │  │ Orchestration│  │ Management   │  │ Verification│  │   │
│  │  └──────┬──────┘  └──────────────┘  └─────────────┘  │   │
│  │         │                                              │   │
│  │  ┌──────┴──────┐                                       │   │
│  │  │ @mysten/    │                                       │   │
│  │  │ dapp-kit    │  ← Wallet connection & signing        │   │
│  │  └─────────────┘                                       │   │
│  └──────────────────────────────────────────────────────────┘
│         │
│         │ HTTP API (apiKey used once)
│         ▼
│  ┌──────────────────────────────────────────────────────────┐
│  │                    Daemon Service Layer                    │
│  │  ┌────────────────────────────────────────────────────┐  │
│  │  │      CloudIntentEngine (LLM Intent Parsing Engine)  │  │
│  │  │  ┌──────────┐  ┌──────────┐  ┌────────────────┐   │  │
│  │  │  │ Sui MCP  │  │ Intent   │  │ Parameter      │   │  │
│  │  │  │ Tools    │  │ Parsing  │  │ Extraction &   │   │  │
│  │  │  │          │  │          │  │ Mapping        │   │  │
│  │  │  └──────────┘  └──────────┘  └────────────────┘   │  │
│  │  └────────────────────────────────────────────────────┘  │
│  └──────────────────────────────────────────────────────────┘
│         │
│         ▼
│  ┌──────────────────────────────────────────────────────────┐
│  │                    Core Engine Layer                       │
│  │                                                          │
│  │  ┌────────────────────────────────────────────────────┐  │
│  │  │      CrossProtocolOrchestrator                      │  │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │  │
│  │  │  │ CetusAdapter │  │ NaviAdapter  │  │SuiAdapter│  │  │
│  │  │  │ (Swap)       │  │(Dep/Borrow)  │  │(Transfer)│  │  │
│  │  │  └──────┬───────┘  └──────┬───────┘  └────┬─────┘  │  │
│  │  │         │                  │                │        │  │
│  │  │         └──────────────────┴────────────────┘        │  │
│  │  │                    │                                  │  │
│  │  │         Transaction (PTB) ← All adapters append cmds │  │
│  │  └────────────────────────────────────────────────────┘  │
│  │                                                          │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  │ CoinType     │  │ Network      │  │ PTB Builder   │  │
│  │  │ Resolver     │  │ Config       │  │ (Gas Estimate)│  │
│  │  └──────────────┘  └──────────────┘  └───────────────┘  │
│  └──────────────────────────────────────────────────────────┘
│         │
│         ▼
│  ┌──────────────────────────────────────────────────────────┐
│  │                    Sui Blockchain Layer                    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │
│  │  │ Cetus    │  │ Navi     │  │ Sui Native           │   │
│  │  │ DEX      │  │ Protocol │  │ (Transfer, etc.)     │   │
│  │  └──────────┘  └──────────┘  └──────────────────────┘   │
│  └──────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
```

### Core Modules

| Module | Description |
|--------|-------------|
| **@intentorch/core** | Core business logic: cross-protocol orchestrator, protocol adapters, PTB builder, Coin type resolver |
| **@sui-intent/sui-mcp-server** | Sui DeFi MCP Server: encapsulates orchestration capabilities as MCP tools |
| **@intentorch/web** | Web management console: React + TypeScript + Tailwind CSS + @mysten/dapp-kit |

---

## 🚦 Quick Start

### Prerequisites
- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Sui browser wallet (e.g., [Sui Wallet](https://chrome.google.com/webstore/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil))

### Installation
```bash
# Clone the repository
git clone https://github.com/applesline/SuiIntent.git
cd SuiIntent

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Launch
```bash
# Option 1: One-click start (recommended)
# Vite dev server will automatically embed and start DaemonServer (port 9658)
pnpm --filter @intentorch/web dev

# Option 2: Start separately (for debugging)
# First start the daemon (provides LLM intent parsing and PTB construction API)
node packages/core/start_daemon.mjs

# Then start the Web console (in a new terminal)
pnpm --filter @intentorch/web dev

# Open browser at http://localhost:5173
```

### Complete Usage Flow
```bash
# 1. Open the Web console
# 2. Click "Connect Wallet" in the top-right corner to connect your Sui wallet
# 3. Click ⚙️ to configure AI provider and API Key
# 4. Enter a natural language intent on the orchestration page, for example:
#    "Swap 0.1 SUI for USDC on Cetus, then deposit USDC on Navi"
# 5. AI auto-parses → generates cross-protocol plan → simulates execution (Dry Run)
# 6. Confirm and click execute → wallet signature → on-chain execution
```

---

## 📸 Usage Scenarios

### Scenario 1: Cross-Protocol Swap + Deposit
```
You: "Swap 0.1 SUI for USDC on Cetus, then deposit USDC on Navi"

SuiIntent:
✅ LLM parses intent → Cetus Swap + Navi Deposit
✅ Auto-matches tools → cetus_swap + navi_deposit
✅ Parameter mapping → coinTypeIn=SUI, coinTypeOut=USDC, amount=100000000
✅ Builds PTB → merges into a single transaction
✅ Wallet signature → on-chain execution
✅ Atomicity guarantee → all succeed or all fail
```

### Scenario 2: Cross-Protocol Swap + Transfer
```
You: "Swap SUI for USDC on Cetus, then transfer USDC to 0x..."

SuiIntent:
✅ Step 1: Cetus Swap (SUI → USDC)
✅ Step 2: Sui Transfer (USDC → target address)
✅ Auto-handles inter-step data dependencies
✅ Merges into a single PTB transaction
```

### Scenario 3: Navi Lending Operations
```
You: "Deposit 10 SUI on Navi"

SuiIntent:
✅ Parses intent → Navi Deposit
✅ Extracts params → coinType=SUI, amount=10000000000
✅ Builds PTB → calls Navi incentive_v3::entry_deposit
✅ Wallet signature → on-chain execution
```

---

## 🧩 Technical Highlights

### 1. Real On-Chain Contract Calls
- **Cetus Adapter**: Uses `router::swap` contract, auto-resolves pool types, queries current sqrtPrice, calculates slippage protection
- **Navi Adapter**: Uses `incentive_v3` contract, supports deposit/withdraw/borrow/repay, dynamically fetches contract configuration
- **Sui Adapter**: Uses `Transaction.transferObjects` for native transfers

### 2. Intelligent PTB Construction
- Automatically handles Coin ownership (`splitCoins`, `coin::zero`, `MergeCoins`)
- Inter-step data dependency injection (output of previous step as input to next step)
- Unused Coins automatically transferred back to user address (avoids `UnusedValueWithoutDrop` errors)

### 3. Dynamic Coin Type Resolution
- Fetches token list from chain via Cetus `coin_list` dynamic fields
- Supports automatic mapping from token abbreviations (e.g., "USDC") to full on-chain addresses
- Built-in default mappings as fast path, with background async refresh

### 4. Wallet-Driven Security Architecture
- Private keys never leave the browser wallet
- All transactions require manual confirmation in the wallet
- Supports Dry Run simulation to preview asset changes before execution

---

## 📄 License

This project is open-sourced under the [Apache 2.0](LICENSE) license.

---

<p align="center">
  <b>SuiIntent</b> — From "manually building multiple transactions" to "completing cross-protocol DeFi operations with one sentence"
</p>
<p align="center">
  <a href="https://github.com/applesline/SuiIntent">GitHub</a> •
  <a href="https://github.com/applesline/SuiIntent/issues">Issues</a>
</p>
