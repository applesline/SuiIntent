<p align="center">
  <img src="./packages/web/public/logo.jpg" width="200" alt="SuiIntent Logo" />
</p>

<h1 align="center">SuiIntent</h1>
<p align="center">
  <strong>自然语言驱动的 Sui DeFi 跨协议意图编排引擎</strong>
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

## 🌟 一句话介绍

**SuiIntent** 是 Sui 区块链上的**跨协议 DeFi 意图编排引擎**。你只需用自然语言描述 DeFi 操作需求，它就能自动理解意图、编排跨协议操作、构建 PTB（Programmable Transaction Block），并通过浏览器钱包一键签名执行。

> 💡 **核心理念**：从"手动构建多笔交易"到"用一句话完成跨协议 DeFi 操作"

---

## 🎯 为什么需要 SuiIntent？

Sui 生态拥有 Cetus（DEX）、Navi（借贷）、Aftermath、Turbos 等众多 DeFi 协议，但用户在进行跨协议操作时面临三大痛点：

| 痛点 | 传统方式 | SuiIntent 的方式 |
|------|---------|-----------------|
| **操作复杂** | 需要分别打开多个 DApp，手动构建多笔交易 | 一句话描述需求，自动编排跨协议操作 |
| **Gas 浪费** | 每步操作需要单独签名，多次 Gas 费 | 利用 Sui PTB 将多步操作合并为单笔交易，一次签名，一次 Gas |
| **门槛高** | 需要理解每个协议的合约地址、参数格式 | 自然语言输入，AI 自动解析参数，钱包一键签名 |

**SuiIntent 让 Sui DeFi 从"专家工具"变成"每个人的助手"。**

---

## ✨ 核心特性

### 🧠 自然语言 → 跨协议 PTB

```
你输入： "在 Cetus 上卖出 0.1 SUI 买入 USDC，然后在 Navi 上存入 USDC"

SuiIntent 自动完成：
┌──────────────────────────────────────────────────────────────┐
│ ① LLM 意图解析                                                │
│    └─ 识别需求：Cetus Swap + Navi Deposit                     │
│    └─ 提取参数：amount=0.1 SUI，coinIn=SUI，coinOut=USDC      │
│                                                              │
│ ② 跨协议编排                                                  │
│    └─ 步骤1：Cetus Swap （SUI → USDC）                        │
│    └─ 步骤2：Navi Deposit （存入 USDC）                       │
│    └─ 自动处理步骤间数据依赖（Swap 输出作为 Deposit 输入）      │
│                                                              │
│ ③ 构建 PTB                                                   │
│    └─ 合并为单个 Programmable Transaction Block              │
│    └─ 自动解析池子类型、查询 sqrtPrice、计算滑点               │
│    └─ 处理 Coin 所有权（合并剩余 SUI 到 gas，转账输出）        │
│                                                             │
│ ④ 钱包签名执行                                                │
│    └─ 浏览器钱包确认 -> 一次签名 -> 链上执行                    │
│    └─ 原子性保证: 要么全部成功，要么全部失败                    │
└──────────────────────────────────────────────────────────────┘
```

**无需切换多个 DApp，无需手动构建交易，说人话就行。**

### 🔄 支持的 DeFi 协议

| 协议 | 类型 | 支持的操作 | 集成状态 |
|------|------|-----------|---------|
| **Cetus** | DEX (AMM) | Swap (代币兑换) | ✅ 真实合约调用 |
| **Navi** | 借贷协议 | Deposit, Withdraw, Borrow, Repay | ✅ 真实合约调用 |
| **Sui Native** | 区块链原生 | Transfer (转账) | ✅ 真实合约调用 |

### ⚡ PTB 多步编排 — 核心技术亮点

利用 Sui 的 **Programmable Transaction Block (PTB)** 原子性，将多步跨协议操作合并为单笔交易：

- **原子执行**：所有操作要么全部成功，要么全部失败
- **一次签名**：用户只需在钱包确认一次
- **一次 Gas**：合并后的交易只需支付一次 Gas 费
- **步骤间数据传递**：自动处理前一步骤的输出作为下一步骤的输入

**典型跨协议场景：**
```
"在 Cetus 上卖出 SUI 买入 USDC，然后在 Navi 上存入 USDC，最后将收益转入 0x..."
→ 合并为 1 笔 PTB 交易
→ 1 次签名
→ 1 次 Gas 费
```

### 🖥️ Web 管理控制台

| 页面 | 功能 |
|------|------|
| **💬 意图编排** | AI 聊天式交互，自然语言 → 跨协议 PTB |
| **📋 工作流** | 查看、编辑、执行已保存的工作流 |


### 🔐 钱包驱动架构

- 使用 `@mysten/dapp-kit` 集成 Sui 浏览器钱包
- 私钥永不离开钱包扩展
- 所有交易需用户在钱包中手动确认
- 支持 mainnet 和 testnet 一键切换

---

## 🏗️ 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      用户交互层                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Web Dashboard (React + Vite)            │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  │   │
│  │  │ 意图编排页面 │  │ 工作流管理   │  │ 测试网验证   │  │   │
│  │  └──────┬──────┘  └──────────────┘  └─────────────┘  │   │
│  │         │                                            │   │
│  │  ┌──────┴──────┐                                     │   │
│  │  │ @mysten/    │                                     │   │
│  │  │ dapp-kit    │  ← 钱包连接与签名                    │   │
│  │  └─────────────┘                                     │   │
│  └──────────────────────────────────────────────────────────┘
│         │
│         │ HTTP API (apiKey 用完即弃)
│         ▼
│  ┌─────────────────────────────────────────────────────────┐
│  │                    Daemon 服务层                         │
│  │  ┌───────────────────────────────────────────────────┐  │
│  │  │      CloudIntentEngine (LLM 意图解析引擎)          │  │
│  │  │  ┌──────────┐  ┌──────────┐  ┌────────────────┐   │  │
│  │  │  │ Sui MCP  │  │ 意图解析 │  │ 参数提取与映射  │   │  │
│  │  │  │ Tools    │  │          │  │                │   │  │
│  │  │  └──────────┘  └──────────┘  └────────────────┘   │  │
│  │  └───────────────────────────────────────────────────┘  │
│  └─────────────────────────────────────────────────────────┘
│         │
│         ▼
│  ┌──────────────────────────────────────────────────────────┐
│  │                   核心引擎层                              │
│  │                                                          │
│  │  ┌────────────────────────────────────────────────────┐  │
│  │  │      CrossProtocolOrchestrator (跨协议编排器)       │  │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │  │
│  │  │  │ CetusAdapter │  │ NaviAdapter  │  │SuiAdapter│  │  │
│  │  │  │ (Swap)       │  │(Dep/Borrow)  │  │(Transfer)│  │  │
│  │  │  └──────┬───────┘  └──────┬───────┘  └────┬─────┘  │  │
│  │  │         │                 │               │        │  │
│  │  │         └─────────────────┴───────────────┘        │  │
│  │  │                           │                        │  │
│  │  │         Transaction (PTB) ← 所有适配器追加指令      │  │
│  │  └────────────────────────────────────────────────────┘  │
│  │                                                          │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐   │
│  │  │ CoinType     │  │ Network      │  │ PTB Builder   │   │
│  │  │ Resolver     │  │ Config       │  │ (Gas 估算)    │   │
│  │  └──────────────┘  └──────────────┘  └───────────────┘   │
│  └──────────────────────────────────────────────────────────┘
│         │
│         ▼
│  ┌─────────────────────────────────────────────────────────┐
│  │                    Sui 区块链层                         │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │
│  │  │ Cetus    │  │ Navi     │  │ Sui Native           │   │
│  │  │ DEX      │  │ Protocol │  │ (Transfer, etc.)     │   │
│  │  └──────────┘  └──────────┘  └──────────────────────┘   │
│  └─────────────────────────────────────────────────────────┘
└────────────────────────────────────────────────────────────┘
```

### 核心模块

| 模块 | 说明 |
|------|------|
| **@intentorch/core** | 核心业务逻辑：跨协议编排器、协议适配器、PTB 构建、Coin 类型解析 |
| **@sui-intent/sui-mcp-server** | Sui DeFi MCP Server：将编排能力封装为 MCP 工具 |
| **@intentorch/web** | Web 管理控制台：React + TypeScript + Tailwind CSS + @mysten/dapp-kit |

---

## 🚦 快速开始

### 前置要求
- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Sui 浏览器钱包（如 [Sui Wallet](https://chrome.google.com/webstore/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil)）

### 安装
```bash
# 克隆仓库
git clone https://github.com/applesline/SuiIntent.git
cd SuiIntent

# 安装依赖
pnpm install

# 构建所有包
pnpm build
```

### 启动
```bash
# 方式一：一键启动（推荐）
# Vite 开发服务器会自动内嵌启动 DaemonServer（端口 9658）
pnpm --filter @intentorch/web dev

# 方式二：分别启动（调试用）
# 先启动守护进程（提供 LLM 意图解析和 PTB 构建 API）
node packages/core/start_daemon.mjs

# 再启动 Web 控制台（新开终端）
pnpm --filter @intentorch/web dev

# 打开浏览器访问 http://localhost:5173
```

### 完整使用流程
```bash
# 1. 打开 Web 控制台
# 2. 点击右上角 "Connect Wallet" 连接 Sui 钱包
# 3. 点击 ⚙️ 配置 AI 提供商和 API Key
# 4. 在编排页面输入自然语言意图，例如：
#    "在 Cetus 上卖出 0.1 SUI 买入 USDC，然后在 Navi 上存入 USDC"
# 5. AI 自动解析 → 生成跨协议计划 → 模拟执行 (Dry Run)
# 6. 确认后点击执行 → 钱包签名 → 链上执行
```

---

## 📸 场景示例

### 场景一：跨协议 Swap + Deposit
```
你： "在 Cetus 上卖出 0.1 SUI 买入 USDC，然后在 Navi 上存入 USDC"

SuiIntent：
✅ LLM 解析意图 → Cetus Swap + Navi Deposit
✅ 自动匹配工具 → cetus_swap + navi_deposit
✅ 参数映射 → coinTypeIn=SUI, coinTypeOut=USDC, amount=100000000
✅ 构建 PTB → 合并为单笔交易
✅ 钱包签名 → 链上执行
✅ 原子性保证 → 要么全部成功，要么全部失败
```

### 场景二：跨协议 Swap + Transfer
```
你： "在 Cetus 上卖出 SUI 买入 USDC，然后将 USDC 转入 0x..."

SuiIntent：
✅ 步骤1: Cetus Swap (SUI → USDC)
✅ 步骤2: Sui Transfer (USDC → 目标地址)
✅ 自动处理步骤间数据依赖
✅ 合并为单笔 PTB 交易
```

### 场景三：Navi 借贷操作
```
你： "在 Navi 上存入 10 SUI"

SuiIntent：
✅ 解析意图 → Navi Deposit
✅ 参数提取 → coinType=SUI, amount=10000000000
✅ 构建 PTB → 调用 Navi incentive_v3::entry_deposit
✅ 钱包签名 → 链上执行
```

---

## 🧩 技术亮点

### 1. 真实链上合约调用
- **Cetus Adapter**: 使用 `router::swap` 合约，自动解析池子类型、查询当前 sqrtPrice、计算滑点保护
- **Navi Adapter**: 使用 `incentive_v3` 合约，支持 deposit/withdraw/borrow/repay，动态获取合约配置
- **Sui Adapter**: 使用 `Transaction.transferObjects` 进行原生转账

### 2. 智能 PTB 构建
- 自动处理 Coin 所有权（`splitCoins`、`coin::zero`、`MergeCoins`）
- 步骤间数据依赖注入（前一步骤的输出作为下一步骤的输入）
- 未使用的 Coin 自动转回用户地址（避免 `UnusedValueWithoutDrop` 错误）

### 3. 动态 Coin 类型解析
- 通过 Cetus `coin_list` 动态字段从链上获取代币列表
- 支持代币简写（如 "USDC"）到完整链上地址的自动映射
- 内置默认映射作为快速路径，后台异步刷新

### 4. 钱包驱动安全架构
- 私钥永不离开浏览器钱包
- 所有交易需用户在钱包中手动确认
- 支持 Dry Run 模拟执行，执行前预览资产变动

---


## 📄 许可证

本项目基于 [Apache 2.0](LICENSE) 许可证开源。

---

<p align="center">
  <b>SuiIntent</b> — 从"手动构建多笔交易"到"用一句话完成跨协议 DeFi 操作"
</p>
<p align="center">
  <a href="https://github.com/applesline/SuiIntent">GitHub</a> •
  <a href="https://github.com/applesline/SuiIntent/issues">Issues</a>
</p>
