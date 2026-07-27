+++
date = '2026-07-23T08:00:00+00:00'
draft = false
title = 'Hyperliquid: Everything There Is To Know'
description = "Collection of all the crumbs of technical details gathered from the internet"
+++

The docs: https://hyperliquid.gitbook.io/hyperliquid-docs
Here is and will be updated once any new information is out the currently useful technical details of the Hyperliquid's features and non-trading decision.
List of incidents: https://hyperliquid-co.gitbook.io/wiki/introduction/roadmap/incident

### HyperCore
Implementation of all the needed exchange primitives.

#### Order Book

HyperCore state includes an order book for each asset. The order book works similarly to that of centralized exchanges. Orders are added where price is an integer multiple of the tick size, and size is an integer multiple of lot size (i.e. strict rules for book records; for example, either 0.01 or 0.02, 2 records instead of scattering liquidity between the 2 prices, 0.00101, 0.00103 and so on). Orders are matched in price-time priority.

Operations on order books for perp assets take a reference to the clearinghouse, as all positions and margin checks are handled there. Margin checks happen on the opening of a new order, and again for the resting side at the matching of each order. This ensures that the margining system is consistent despite oracle price fluctuations after the resting order is placed.

One unique aspect of the Hyperliquid L1 is that the mempool and consensus logic are semantically aware of transactions that interact with HyperCore order books. Within a block, actions are sorted within each consensus batch (there are usually 1-2 consensus batches of actions in a block) as

- Actions that do not send GTC or IOC orders to any book \
Before any trading happens, the network processes administrative and state-changing actions. This includes deposits, withdrawals, internal transfers, and funding rate payments. This ensures everyone's account balances are 100% accurate before the matching engine starts pairing buyers and sellers. You can't trade with funds that haven't mathematically hit your account yet.
- Cancels \
If you send a request to cancel an existing order, the network processes it before any new trades are allowed to enter the book. This is a massive protection for market makers. If the market suddenly crashes, a market maker wants to cancel their buy orders so they don't get stuck buying an asset in freefall. By processing cancels before new orders, the protocol prevents predatory high-frequency traders from "picking off" outdated orders before the cancel can register.
- Actions that send at least one GTC or IOC \
Trading requests. "Modifies" are treated as new orders. If you change the price or size of an existing order, the system treats it as a brand-new order, pushing you to the back of the time-priority line in Tier 3. You cannot modify an order to cut in line

Within each category, actions are sorted in the order the block proposer (the validator leading that specific round) received them. It is a FIFO system within each category.

---

#### Permissionless spot quote assets

Becoming a spot quote asset is permissionless. 
The requirements for becoming a permissionless spot quote asset are as follows:

1. Wei decimals of 8 and size decimals of 2
2. Zero deployer fee share on the quote token
3. 200k HYPE staked, subject to the following slashing criteria based on validator voting: 

A peg mechanism to a price of 1 USD. A future network upgrade could increase the scope to other non-dollar stable assets 

QUOTE/USDC should have 100k USDC size on both sides within the price range from 0.998 to 1.002, inclusive 
QUOTE/USDC should have 1M USDC size on both sides within 0.99 and 1.01, inclusive 
HYPE/QUOTE should have 50k QUOTE size on both sides within a spread of 0.5%, inclusive

The 200k HYPE staked by the deployer are subject to slashing based on validator vote for poor quality quote assets. Upon deployment, this stake is committed for 3 years, after which it can be unstaked. This gives builders and users some assurance when choosing a quote asset. 

For any of the conditions above, if there is a three-day period during which the condition is not satisfied for a majority of uniformly spaced 1 second samples, the quote asset will be considered slashable. Validators will vote on the amount to slash when such conditions are violated. 

---

#### AQAv2

AQAv2 will be a requirement for quote assets to be listed against HIP-4 and validator-operated perp markets on a future network upgrade. There is no trading fee or volume contribution benefit to AQAv2. Other quote assets will continue to be supported for other markets, including spot and HIP-3 perps. 

AQAv2 allows specification of a “technical deployer” and a “treasury deployer.” The treasury deployer will designate a treasury address which will share 100% of the AQA rate (the cost-adjusted onchain reference rate oracle) with the protocol through the onchain AQA mechanic. This is twice the rate of revenue share of the existing AQA spec. The treasury deployer must stake 500k HYPE, which is slashable if the treasury address does not have sufficient balance for onchain revenue to be deducted. The technical deployer must stake 500k HYPE and ensure reliable mint, redemption, and cross-chain transfer infrastructure for the aligned quote asset. Both treasury and technical deployers require 6 months minimum notice before ceasing operation, during which their stake is slashable for the commitments above. The activation of AQAv2 is by validator vote, after both deployers have staked and sent the authorization transactions from the staking accounts. Under AQAv2, the linked HyperEVM contract that connects to HyperCore will also rebalance with the treasury address. The HyperEVM balance corresponding to minted HyperCore tokens will be held in a ratio of 9:1 between the treasury address and technical deployer’s linked EVM contract address, respectively. Reserve yield revenue accrues in 30 day intervals based on the block on each UTC date, automatically sent to the Assistance Fund 8 days after each interval completes. In the event that there is insufficient balance to deduct from the system interest address `0x50...00 + {token_index}` , the treasury deployer's stake is eligible to be slashed at an interest rate of 2% per day. The 30 day intervals begin on the date of activation.

---

#### Staking

HYPE staking on Hyperliquid happens within HyperCore. Just as USDC can be transferred between perps and spot accounts, HYPE can be transferred between spot and staking accounts. 

Within the staking account, HYPE may be staked to any number of validators. Here and in other docs, delegate and stake are used interchangeably, as Hyperliquid only supports delegated proof-of-stake. 

Each validator has a self-delegation requirement of 10k HYPE to become active. The self-delegation requirement is locked for one year. Any time that the self-delegation for a validator drops below 10k HYPE, the validator enters undelegate-only mode (i.e., where all future delegations to this validator are disabled), so the validator's total stake can only decrease going forward. 

Once active, validators produce blocks and receive rewards proportional to their total delegated stake. Validators may charge a commission to their delegators. This commission cannot be increased unless the new commission is less than or equal to 1%. This prevents scenarios where a validator attracts a large amount of stake and then raises the commission significantly to take advantage of unaware stakers.

Delegations to a particular validator have a lockup duration of 1 day. After this lockup, delegations may be partially or fully undelegated at any time. Undelegated balances instantly reflect in staking account balance. 

Transfers from spot account to staking account are instant. However, transfers from staking account to spot account have a 7 day unstaking queue. Most other proof-of-stake chains have a similar mechanism, which ensures that large-scale consensus attacks are penalized by slashing or social layer mechanisms. There is currently no automatic slashing implemented. Each address may have at most 5 pending withdrawals in the unstaking queue. 

As an example, if you initiate a staking to spot transfer of 100 HYPE at 08:00:00 UTC on March 11 and a transfer of 50 HYPE at 09:00:00 UTC on March 12, the 100 HYPE transfer will be finalized at 08:00:01 UTC on March 18 and the 50 HYPE transfer will be finalized at 09:00:01 UTC on March 19. 

The staking reward rate formula is inspired by Ethereum, where the reward rate is inversely proportional to the square root of total HYPE staked. At 400M total HYPE staked, the reward rate is approximately 2.37% per year. Staking rewards come from the future emissions reserve.

Rewards are accrued every minute and distributed to stakers every day. Rewards are redelegated automatically to the staked validator, i.e., compounded. Rewards are based on the minimum balance that a delegator has staked during each staking epoch (100k rounds, as explained below).

Technical Details
The notion of a quorum is essential to modern proof-of-stake consensus algorithms such as HyperBFT. A quorum is any set of validators that has more than ⅔ of the total stake in the network. The operating requirement of consensus is that a quorum of stake is honest (non-Byzantine). Therefore it is an essential responsibility of every staker to only delegate to trusted validators. 

HyperBFT consensus proceeds in rounds, which is a fundamental discrete bundle of transactions along with signatures from a quorum of validators. Each round may be committed after certain conditions are met, after which it is sent to the execution state for processing. A key property of the consensus algorithm is that all honest nodes agree on the ordered list of committed rounds.

i.e. consensus and execution layers are separate, like ePBS in Ethereum.

Rounds may result in a new execution state block. Execution blocks are indexed by a separate increasing counter called height. Height only increments on consensus rounds with at least one transaction.

The validator set evolves in epochs of 100k rounds, which is approximately 90 minutes on mainnet. The validators and consensus stakes are static for each staking epoch.

Validators may vote to jail peers that do not respond with adequate latency or frequency to the consensus messages of the voter. Upon receiving a quorum of jail votes, a validator becomes jailed and no longer participates in consensus. A jailed validator does not produce rewards for its delegators. A validator may unjail itself by diagnosing and fixing the causes, subject to onchain unjailing rate limits. Note that jailing is not the same as slashing, which is reserved for provably malicious behavior such as double-signing blocks at the same round. 

---

#### Multisig

HyperCore supports native multi-sig actions. This allows multiple private keys to control a single account for additional security. Unlike other chains, multi-sig is available as a built-in primitive on HyperCore as opposed to relying on smart contracts. 

The multi-sig workflow is described below:

To convert a user to a multi-sig user, the user sends a ConvertToMultiSigUser action with the authorized users and the minimum number of authorized users required to sign an action. Authorized users must be existing users on Hyperliquid. Once a user has been converted into a multi-sig user, all its actions must be sent via multi-sig. 

To send an action, each authorized user must sign a payload to produce a signature. A MultiSig action wraps around any normal action and includes a list of signatures from authorized users. 

The MultiSig payload also contains the target multi-sig user and the authorized user who will ultimately send the MultiSig action to the blockchain. The sender of the final action is also known as the leader (transaction lead address) of the multi-sig action.

When a multi-sig action is sent, only the nonce set of the authorized user who sent the transaction is validated and updated.

Similar to normal actions, the leader can also be an API wallet of an authorized user. In this case, the nonce of the API wallet is checked and updated. 

A multi-sig user's set of authorized users and/or the threshold may be updated by sending a MultiSig action wrapping a ConvertToMultiSigUser action describing the new state.

A multi-sig user can be converted back to a normal user by sending a ConvertToMultiSigUser via multi-sig. In this case, the set of authorized users can be set to empty and conversion to a normal user will be performed.

Miscellaneous notes: 

- The leader (transaction lead address) must be an authorized user, not the multi-sig account
- Each signature must use the same information, e.g., same nonce, transaction lead address, etc. 
- The leader must collect all signatures before submitting the action 
- A user can be a multi-sig user and an authorized user for another multi-sig user at the same time. A user may be an authorized user for multiple multi-sig users. The maximum allowed number of authorized users for a given multi-sig user is 10. 

Important for HyperEVM users: Converting a user to a multi-sig still leaves the HyperEVM user controllable by the original wallet. CoreWriter does not work for multi-sig users. In general, multi-sig users should not interact with the HyperEVM before or after conversion.

---

#### Builder Codes

Builder codes allow builders to receive a fee on fills that they send on behalf of a user. They are set per-order for maximal flexibility. The user must approve a maximum builder fee for each builder, and can revoke permissions at any time. Builder codes are processed entirely onchain as part of the fee logic.

In order to use builder codes, the end user would first approve a max fee for the builder address via the ApproveBuilderFee action. This action must be signed by the user's main wallet, not an agent/API wallet. The builder must have at least 100 USDC in perps account value and must use standard as the account abstraction mode.

Builder codes currently only apply to fees that are collected in the quote or collateral asset. In other words, builder codes do not apply to the buying side of spot trades but apply to both sides of perp trades. Builder fees charged can be at most 0.1% on perps and 1% on spot.

Each user can have a maximum of 10 active builder code approvals at a time.

---

#### Crypto Perps

Hyperliquid perpetuals are derivatives products without expiration date. Instead, they rely on funding payments to ensure convergence to the underlying spot price over time.

Hyperliquid has one main style of margining for perpetual contracts: USDC margining, USDT denominated linear contracts. That is, the oracle price is denominated in USDT, but the collateral is USDC. This allows for the best combination of liquidity and accessibility. Note that no conversions with the USDC/USDT exchange rate are applied, so these contracts are technically quanto contracts where USDT pnl is denominated in USDC.

USDT has the deepest pricing liquidity: The vast majority of global crypto spot trading (especially on dominant centralized exchanges like Binance) happens against USDT. Because the spot markets for BTC/USDT or SOL/USDT are incredibly deep, price oracles that track USDT pairs are the most accurate and the hardest for malicious actors to manipulate. If Hyperliquid tracked BTC/USDC instead, the oracle would be less robust and more vulnerable to sudden price wicks on less liquid order books.

USDC is the preferred on-chain collateral: While USDT dominates centralized exchanges, USDC is historically the preferred stablecoin for decentralized finance (DeFi) and bridging. Users can easily bridge USDC from networks like Arbitrum directly to Hyperliquid's Layer 1 without cross-chain friction.

There is a logical exception for Hyperliquid's native assets like PURR and HYPE. Because their primary spot liquidity actually lives on Hyperliquid itself and trades against USDC, those specific perpetual contracts are entirely USDC-denominated.

In traditional finance, a quanto (quantity-adjusting) contract is a derivative where the underlying asset is priced in one currency, but the trade is settled in a different currency at a fixed exchange rate.

On Hyperliquid, you are trading an asset priced in USDT, but your profits are paid out in USDC.

Normally, if you made a 100 USDT profit, the exchange would have to calculate the real-time conversion value of USDT against USDC (which might temporarily be $0.998 or $1.002) before crediting your account. Hyperliquid skips this step. They apply a strictly fixed 1:1 exchange rate.

If your trade makes 100 USDT in PnL, you are credited exactly 100 USDC. This simplifies the matching engine's math, avoids reliance on a secondary stablecoin exchange rate, and allows the chain to process transactions at blistering sub-second speeds.

---

#### Breakers

Hyperliquid does not have traditional exchange-style circuit breakers like the NYSE's Level 1/2/3 halts. Instead, it uses a layered set of protocol-level constraints that function as rate limiters and safety bounds. Mark price moves are clamped to 1% per oracle update cycle (roughly every 3 seconds with a minimum 2.5-second cooldown).

All prices are clamped to 10x the start-of-day value as an absolute ceiling. Mark prices cannot be updated if doing so would push open interest above 10x the OI cap. And if the deployer stops publishing oracle updates, stale mark prices automatically revert to the local mark price (median of best bid, best ask, last trade) after 10 seconds.

If an asset moves more than 50% relative to its start-of-day price, validators conduct a review to determine whether the deployer should be slashed. The deployer's 500,000 HYPE security bond is at stake — irregular inputs or prolonged downtime can result in up to 100% slashing, with slashed HYPE burned permanently.


### HyperEVM
Layer-1 blockchain. It launched on mainnet on February 18, 2025. It is not a rollup, not a sidechain, and not a separate chain — it is part of the same L1, secured by the same HyperBFT consensus as the rest of Hyperliquid. HyperEVM is based on the Cancun EVM specification (without blob).

What makes HyperEVM different from every other EVM chain is what it connects to. On Ethereum, Arbitrum, or Base, smart contracts interact with AMMs and external oracles. On HyperEVM, smart contracts can natively read from and write to HyperCore. This means a contract can check live perp prices, place limit orders on the order book, and manage vault positions — all on-chain, with no bridges or off-chain components.

All existing Ethereum tooling works. The gas token is HYPE, and both base fees and priority fees are burned. It uses a dual-block architecture — small blocks every 2 seconds for fast lightweight transactions, and big blocks every 60 seconds for contract deployments and complex operations.

The HyperEVM "mempool" is still onchain state with respect to the umbrella L1 execution, but is split into two independent mempools that source transactions for the two block types. The two block types are interleaved with a unique increasing sequence of EVM block numbers. The onchain mempool implementation accepts only the next 8 nonces for each address. Transactions older than 1 day old in the mempool are pruned. 

The initial configuration is set conservatively, and throughput is expected to increase over successive technical upgrades. Fast block duration is set to 1 seconds with a 3M gas limit. Slow block duration is set to 1 minute with a 30M gas limit.


#### Connection between them

HyperEVM and HyperCore are two execution environments on the same chain, and contracts move data between them in two directions:

- Read — HyperCore exposes read precompiles starting at 0x0000000000000000000000000000000000000800. A contract calls them to query perp positions, spot balances, oracle prices, staking delegations, and the L1 block number. The returned values match HyperCore state at the time the EVM block is built.
- Write — the CoreWriter system contract at 0x3333333333333333333333333333333333333333 sends actions to HyperCore.

This split mirrors the API: read precompiles are the on-chain equivalent of `/info` queries, and CoreWriter is the on-chain equivalent of signed `/exchange` actions. The difference is that CoreWriter actions are authored by the calling contract’s own address—the contract is the HyperCore actor, so no off-chain signature is involved.

When you call `sendRawAction`, the contract burns roughly 25,000 gas and emits a log that HyperCore picks up and processes as an action. A basic call costs around 47,000 gas in total. The action runs as the caller’s HyperCore user—the contract address that invoked `sendRawAction`.

CoreWriter actions are fire-and-forget. `sendRawAction` emits its log and the EVM transaction succeeds whether or not HyperCore accepts the action. If the action is malformed or the account is not set up, HyperCore drops it silently—no EVM revert, no error event, and the order simply never appears in openOrders. This is the single most common source of confusion, so check the following before concluding that CoreWriter is broken.

**The account must exist on HyperCore first**

A CoreWriter action runs as the contract’s HyperCore user, and that user must already exist on HyperCore before the EVM block is built. An address becomes a HyperCore user once it receives a Core asset such as USDC.
Initializing the account with a HyperEVM-to-HyperCore transfer in the same block as the action does not work—the action is still rejected. Fund the contract’s HyperCore account in an earlier block, then send actions.
Send a small amount of USDC to the contract’s address on HyperCore in a separate, earlier transaction. You can confirm the account exists on-chain by calling the core-user-exists precompile at 0x0000000000000000000000000000000000000810

**Perp orders need USDC on the perp side**

Bridging USDC from HyperEVM lands it in the contract’s spot balance. A perp limit order draws on the perp balance, so a freshly funded contract can hold plenty of USDC and still have its orders dropped. Move funds to the perp side first with a USD class transfer (action 7, toPerp: true).

**Core => EVM**

1. You send a spotSend action with the system address (0x20...0 for USDC) as the destination
2. Hyperliquid detects this as a bridge request and triggers a system transaction
3. The system transaction calls transfer(sender_address, amount) on the linked ERC20 contract
4. USDC appears in your HyperEVM wallet (the sender’s address)

A transfer from HyperCore to HyperEVM costs 200k gas at the base gas price of the next HyperEVM block.

**EVM => Core**

1. Call `bridgeToCore` in the library or handle cases listed there separately. `deposit` in USDC's token (CoreDepositWallet) calls the same CoreWriter's `SEND_ASSET` action (`sendAsset` in the lib), but let's you configure to which dexes (HIP-3) you can and cannot transfer.

A transfer from HyperEVM to HyperCore costs similar gas to the equivalent transfer of the ERC20 token or HYPE to any other address on the HyperEVM that has an existing balance.

CoreWriterLib from `hyperliquid-dev/hyper-evm-lib`
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {PrecompileLib} from "./PrecompileLib.sol";
import {HLConstants} from "./common/HLConstants.sol";
import {HLConversions} from "./common/HLConversions.sol";

import {ICoreWriter} from "./interfaces/ICoreWriter.sol";
import {ICoreDepositWallet} from "./interfaces/ICoreDepositWallet.sol";

/**
 * @title CoreWriterLib v1.1
 * @author Obsidian (https://x.com/ObsidianAudits)
 * @notice A library for interacting with HyperEVM's CoreWriter
 *
 * @dev Additional functionality for:
 * - Bridging assets between EVM and HyperCore
 * - Converting decimal representations between EVM and HyperCore amounts
 * - Security checks before sending actions to CoreWriter
 */
library CoreWriterLib {
    using SafeERC20 for IERC20;

    ICoreWriter constant coreWriter = ICoreWriter(0x3333333333333333333333333333333333333333);

    error CoreWriterLib__StillLockedUntilTimestamp(uint64 lockedUntilTimestamp);
    error CoreWriterLib__CannotSelfTransfer();
    error CoreWriterLib__HypeTransferFailed();
    error CoreWriterLib__CoreAmountTooLarge(uint256 amount);
    error CoreWriterLib__EvmAmountTooSmall(uint256 amount);

    /*//////////////////////////////////////////////////////////////
                       EVM <---> Core Bridging
    //////////////////////////////////////////////////////////////*/

    function bridgeToCore(address tokenAddress, uint256 evmAmount) internal {
        uint64 tokenIndex = PrecompileLib.getTokenIndex(tokenAddress);
        bridgeToCore(tokenIndex, evmAmount);
    }

    /**
    * @dev All tokens (including USDC) will be bridged to the spot dex
    */
    function bridgeToCore(uint64 token, uint256 evmAmount) internal {
        ICoreDepositWallet coreDepositWallet = ICoreDepositWallet(HLConstants.coreDepositWallet());
        
        // Check if amount would be 0 after conversion to prevent token loss
        uint64 coreAmount = HLConversions.evmToWei(token, evmAmount);
        if (coreAmount == 0) revert CoreWriterLib__EvmAmountTooSmall(evmAmount);
        address systemAddress = getSystemAddress(token);
        if (HLConstants.isUsdc(token)) {
            IERC20(HLConstants.usdc()).approve(address(coreDepositWallet), evmAmount);
            coreDepositWallet.deposit(evmAmount, uint32(type(uint32).max));
        } else if (isHype(token)) {
            (bool success,) = systemAddress.call{value: evmAmount}("");
            if (!success) revert CoreWriterLib__HypeTransferFailed();
        } else {
            PrecompileLib.TokenInfo memory info = PrecompileLib.tokenInfo(uint32(token));
            address tokenAddress = info.evmContract;
            IERC20(tokenAddress).safeTransfer(systemAddress, evmAmount);
        }
    }

    /**
     * @notice Bridges USDC from EVM to Core to a specific recipient
     * @param recipient The address that will receive the USDC on Core
     * @param evmAmount The amount of USDC to bridge (in EVM decimals)
     * @param destinationDex The dex to send the USDC to on Core (type(uint32).max for spot, 0 for default perp dex)
     */
    function bridgeUsdcToCoreFor(address recipient, uint256 evmAmount, uint32 destinationDex) internal {
        ICoreDepositWallet coreDepositWallet = ICoreDepositWallet(HLConstants.coreDepositWallet());

        // Check if amount would be 0 after conversion to prevent token loss
        uint64 coreAmount = HLConversions.evmToWei(HLConstants.USDC_TOKEN_INDEX, evmAmount);
        if (coreAmount == 0) revert CoreWriterLib__EvmAmountTooSmall(evmAmount);

        IERC20(HLConstants.usdc()).approve(address(coreDepositWallet), evmAmount);
        coreDepositWallet.depositFor(recipient, evmAmount, destinationDex);
    }

    function bridgeToEvm(address tokenAddress, uint256 evmAmount) internal {
        uint64 tokenIndex = PrecompileLib.getTokenIndex(tokenAddress);
        bridgeToEvm(tokenIndex, evmAmount, true);
    }

    // NOTE: For bridging non-HYPE tokens, the contract must hold some HYPE on core (enough to cover the transfer gas), otherwise sendAsset will fail
    function bridgeToEvm(uint64 token, uint256 amount, bool isEvmAmount) internal {
        uint64 coreAmount;
        if (isEvmAmount) {
            coreAmount = HLConversions.evmToWei(token, amount);
            if (coreAmount == 0) revert CoreWriterLib__EvmAmountTooSmall(amount);
        } else {
            if (amount > type(uint64).max) revert CoreWriterLib__CoreAmountTooLarge(amount);
            coreAmount = uint64(amount);
        }

        sendAsset(
            getSystemAddress(token),
            address(0),
            HLConstants.SPOT_DEX,
            HLConstants.SPOT_DEX,
            token,
            coreAmount
        );
    }

    function spotSend(address to, uint64 token, uint64 amountWei) internal {
        // Self-transfers will always fail, so reverting here
        if (to == address(this)) revert CoreWriterLib__CannotSelfTransfer();

        coreWriter.sendRawAction(
            abi.encodePacked(uint8(1), HLConstants.SPOT_SEND_ACTION, abi.encode(to, token, amountWei))
        );
    }

    /*//////////////////////////////////////////////////////////////
                          Bridging Utils
    //////////////////////////////////////////////////////////////*/

    function getSystemAddress(uint64 index) internal view returns (address) {
        if (index == HLConstants.hypeTokenIndex()) {
            return HLConstants.HYPE_SYSTEM_ADDRESS;
        }
        return address(HLConstants.BASE_SYSTEM_ADDRESS + index);
    }

    function isHype(uint64 index) internal view returns (bool) {
        return index == HLConstants.hypeTokenIndex();
    }

    /*//////////////////////////////////////////////////////////////
                              Staking
    //////////////////////////////////////////////////////////////*/
    function delegateToken(address validator, uint64 amountWei, bool undelegate) internal {
        coreWriter.sendRawAction(
            abi.encodePacked(uint8(1), HLConstants.TOKEN_DELEGATE_ACTION, abi.encode(validator, amountWei, undelegate))
        );
    }

    function depositStake(uint64 amountWei) internal {
        coreWriter.sendRawAction(abi.encodePacked(uint8(1), HLConstants.STAKING_DEPOSIT_ACTION, abi.encode(amountWei)));
    }

    function withdrawStake(uint64 amountWei) internal {
        coreWriter.sendRawAction(abi.encodePacked(uint8(1), HLConstants.STAKING_WITHDRAW_ACTION, abi.encode(amountWei)));
    }

    /*//////////////////////////////////////////////////////////////
                              Trading
    //////////////////////////////////////////////////////////////*/

    function toMilliseconds(uint64 timestamp) internal pure returns (uint64) {
        return timestamp * 1000;
    }

    function _canWithdrawFromVault(address vault) internal view returns (bool, uint64) {
        PrecompileLib.UserVaultEquity memory vaultEquity = PrecompileLib.userVaultEquity(address(this), vault);

        return
            (
                toMilliseconds(uint64(block.timestamp)) > vaultEquity.lockedUntilTimestamp,
                vaultEquity.lockedUntilTimestamp
            );
    }

    function vaultTransfer(address vault, bool isDeposit, uint64 usdAmount) internal {
        if (!isDeposit) {
            (bool canWithdraw, uint64 lockedUntilTimestamp) = _canWithdrawFromVault(vault);

            if (!canWithdraw) revert CoreWriterLib__StillLockedUntilTimestamp(lockedUntilTimestamp);
        }

        coreWriter.sendRawAction(
            abi.encodePacked(uint8(1), HLConstants.VAULT_TRANSFER_ACTION, abi.encode(vault, isDeposit, usdAmount))
        );
    }

    function transferUsdClass(uint64 ntl, bool toPerp) internal {
        coreWriter.sendRawAction(
            abi.encodePacked(uint8(1), HLConstants.USD_CLASS_TRANSFER_ACTION, abi.encode(ntl, toPerp))
        );
    }

    function placeLimitOrder(
        uint32 asset,
        bool isBuy,
        uint64 limitPx,
        uint64 sz,
        bool reduceOnly,
        uint8 encodedTif,
        uint128 cloid
    ) internal {
        coreWriter.sendRawAction(
            abi.encodePacked(
                uint8(1),
                HLConstants.LIMIT_ORDER_ACTION,
                abi.encode(asset, isBuy, limitPx, sz, reduceOnly, encodedTif, cloid)
            )
        );
    }

    function addApiWallet(address wallet, string memory name) internal {
        coreWriter.sendRawAction(
            abi.encodePacked(uint8(1), HLConstants.ADD_API_WALLET_ACTION, abi.encode(wallet, name))
        );
    }

    function cancelOrderByOrderId(uint32 asset, uint64 orderId) internal {
        coreWriter.sendRawAction(
            abi.encodePacked(uint8(1), HLConstants.CANCEL_ORDER_BY_OID_ACTION, abi.encode(asset, orderId))
        );
    }

    function cancelOrderByCloid(uint32 asset, uint128 cloid) internal {
        coreWriter.sendRawAction(
            abi.encodePacked(uint8(1), HLConstants.CANCEL_ORDER_BY_CLOID_ACTION, abi.encode(asset, cloid))
        );
    }

    function finalizeEvmContract(uint64 token, uint8 encodedVariant, uint64 createNonce) internal {
        coreWriter.sendRawAction(
            abi.encodePacked(
                uint8(1), HLConstants.FINALIZE_EVM_CONTRACT_ACTION, abi.encode(token, encodedVariant, createNonce)
            )
        );
    }

    function approveBuilderFee(uint64 maxFeeRate, address builder) internal {
        coreWriter.sendRawAction(
            abi.encodePacked(uint8(1), HLConstants.APPROVE_BUILDER_FEE_ACTION, abi.encode(maxFeeRate, builder))
        );
    }

    function sendAsset(address destination, address subAccount, uint32 source_dex, uint32 destination_dex, uint64 token, uint64 amountWei) internal {
        coreWriter.sendRawAction(
            abi.encodePacked(uint8(1), HLConstants.SEND_ASSET_ACTION, abi.encode(destination, subAccount, source_dex, destination_dex, token, amountWei))
        );
    }

    /*//////////////////////////////////////////////////////////////
                            Borrow/Lend
    //////////////////////////////////////////////////////////////*/

    /// @dev encodedOperation: 0 = Supply, 1 = Withdraw
    /// @dev If amountWei is 0, the operation is applied maximally (e.g. withdraw full balance)
    function borrowLend(uint8 encodedOperation, uint64 token, uint64 amountWei) internal {
        coreWriter.sendRawAction(
            abi.encodePacked(uint8(1), HLConstants.BORROW_LEND_ACTION, abi.encode(encodedOperation, token, amountWei))
        );
    }

    /*//////////////////////////////////////////////////////////////
                            Abstraction
    //////////////////////////////////////////////////////////////*/

    /// @dev abstraction: 1 = disabled, 2 = unifiedAccount, 3 = portfolioMargin
    /// @dev `user` can either be the master user or a sub-account
    function setAbstraction(address user, uint8 abstraction) internal {
        coreWriter.sendRawAction(
            abi.encodePacked(uint8(1), HLConstants.SET_ABSTRACTION_ACTION, abi.encode(user, abstraction))
        );
    }
}
```

PrecompilesLib from `hyperliquid-dev/hyper-evm-lib`
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ITokenRegistry} from "./interfaces/ITokenRegistry.sol";
import {HLConstants} from "./common/HLConstants.sol";

/**
 * @title PrecompileLib v1.0
 * @author Obsidian (https://x.com/ObsidianAudits)
 * @notice A library with helper functions for interacting with HyperEVM's precompiles
 */
library PrecompileLib {
    // Onchain record of token indices for each linked evm contract
    ITokenRegistry constant REGISTRY = ITokenRegistry(0x0b51d1A9098cf8a72C325003F44C194D41d7A85B);

    /*//////////////////////////////////////////////////////////////
                  Custom Utility Functions
        (Overloads accepting token address instead of index)
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Gets TokenInfo for a given token address by looking up its index and fetching from the precompile.
     * @dev Overload of tokenInfo(uint64 token)
     */
    function tokenInfo(address tokenAddress) internal view returns (TokenInfo memory) {
        uint64 index = getTokenIndex(tokenAddress);
        return tokenInfo(index);
    }

    /**
     * @notice Gets SpotInfo for the token/USDC market using the token address.
     * @dev Overload of spotInfo(uint64 tokenIndex)
     * Finds the spot market where USDC (index 0) is the quote.
     */
    function spotInfo(address tokenAddress) internal view returns (SpotInfo memory) {
        uint64 tokenIndex = getTokenIndex(tokenAddress);
        uint64 spotIndex = getSpotIndex(tokenIndex);
        return spotInfo(spotIndex);
    }

    /**
     * @notice Gets the spot price for the token/USDC market using the token address.
     * @dev Overload of spotPx(uint64 spotIndex)
     */
    function spotPx(address tokenAddress) internal view returns (uint64) {
        uint64 tokenIndex = getTokenIndex(tokenAddress);
        uint64 spotIndex = getSpotIndex(tokenIndex);
        return spotPx(spotIndex);
    }

    /**
     * @notice Gets a user's spot balance for a given token address.
     * @dev Overload of spotBalance(address user, uint64 token)
     */
    function spotBalance(address user, address tokenAddress) internal view returns (SpotBalance memory) {
        uint64 tokenIndex = getTokenIndex(tokenAddress);
        return spotBalance(user, tokenIndex);
    }

    /**
     * @notice Gets the index of a token from its address. Reverts if token is not linked to HyperCore.
     */
    function getTokenIndex(address tokenAddress) internal view returns (uint64) {
        if (tokenAddress == HLConstants.usdc()) {
            return HLConstants.USDC_TOKEN_INDEX;
        }
        return REGISTRY.getTokenIndex(tokenAddress);
    }

    /**
     * @notice Gets the spot market index for the token/USDC pair for a token using its address.
     * @dev Overload of getSpotIndex(uint64 tokenIndex)
     */
    function getSpotIndex(address tokenAddress) internal view returns (uint64) {
        uint64 tokenIndex = getTokenIndex(tokenAddress);
        return getSpotIndex(tokenIndex);
    }

    /**
     * @notice Gets the spot market index for a token.
     * @dev If only one spot market exists, returns it. Otherwise, finds the spot market with USDC as the quote token.
     */
    function getSpotIndex(uint64 tokenIndex) internal view returns (uint64) {
        uint64[] memory spots = tokenInfo(tokenIndex).spots;

        if (spots.length == 1) return spots[0];

        for (uint256 idx = 0; idx < spots.length; idx++) {
            SpotInfo memory spot = spotInfo(spots[idx]);
            if (spot.tokens[1] == 0) {
                // index 0 = USDC
                return spots[idx];
            }
        }
        revert PrecompileLib__SpotIndexNotFound();
    }

    /*//////////////////////////////////////////////////////////////
                  Using Alternate Quote Token (non USDC)
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Gets the spot market index for a token/quote pair.
     * Iterates all spot markets for the token and matches the quote token index.
     * @dev Overload of getSpotIndex(uint64 tokenIndex)
     */
    function getSpotIndex(uint64 tokenIndex, uint64 quoteTokenIndex) internal view returns (uint64) {
        uint64[] memory spots = tokenInfo(tokenIndex).spots;

        for (uint256 idx = 0; idx < spots.length; idx++) {
            SpotInfo memory spot = spotInfo(spots[idx]);
            if (spot.tokens[1] == quoteTokenIndex) {
                return spots[idx];
            }
        }
        revert PrecompileLib__SpotIndexNotFound();
    }

    /**
     * @notice Gets SpotInfo for a token/quote pair using token addresses.
     * Looks up both token and quote indices, then finds the spot market.
     * @dev Overload of spotInfo(uint64 spotIndex)
     */
    function spotInfo(address token, address quoteToken) internal view returns (SpotInfo memory) {
        uint64 tokenIndex = getTokenIndex(token);
        uint64 quoteTokenIndex = getTokenIndex(quoteToken);
        uint64 spotIndex = getSpotIndex(tokenIndex, quoteTokenIndex);
        return spotInfo(spotIndex);
    }

    /**
     * @notice Gets the spot price for a token/quote pair using token addresses.
     * Looks up both token and quote indices, then finds the spot market.
     * @dev Overload of spotPx(uint64 spotIndex)
     */
    function spotPx(address token, address quoteToken) internal view returns (uint64) {
        uint64 tokenIndex = getTokenIndex(token);
        uint64 quoteTokenIndex = getTokenIndex(quoteToken);
        uint64 spotIndex = getSpotIndex(tokenIndex, quoteTokenIndex);
        return spotPx(spotIndex);
    }

    /*//////////////////////////////////////////////////////////////
                        Price decimals normalization
    //////////////////////////////////////////////////////////////*/

    // returns spot price as a fixed-point integer with 8 decimals
    function normalizedSpotPx(uint64 spotIndex) internal view returns (uint256) {
        SpotInfo memory info = spotInfo(spotIndex);
        uint8 baseSzDecimals = tokenInfo(info.tokens[0]).szDecimals;
        return spotPx(spotIndex) * 10 ** baseSzDecimals;
    }

    // returns mark price as a fixed-point integer with 6 decimals
    function normalizedMarkPx(uint32 perpIndex) internal view returns (uint256) {
        PerpAssetInfo memory info = perpAssetInfo(perpIndex);
        return markPx(perpIndex) * 10 ** info.szDecimals;
    }

    // returns perp oracle price as a fixed-point integer with 6 decimals
    function normalizedOraclePx(uint32 perpIndex) internal view returns (uint256) {
        PerpAssetInfo memory info = perpAssetInfo(perpIndex);
        return oraclePx(perpIndex) * 10 ** info.szDecimals;
    }

    /*//////////////////////////////////////////////////////////////
                              Precompile Calls
    //////////////////////////////////////////////////////////////*/


    function position(address user, uint32 perp) internal view returns (Position memory) {
        (bool success, bytes memory result) = HLConstants.POSITION2_PRECOMPILE_ADDRESS.staticcall(abi.encode(user, perp));
        if (!success) revert PrecompileLib__Position2PrecompileFailed();
        return abi.decode(result, (Position));
    }


    function spotBalance(address user, uint64 token) internal view returns (SpotBalance memory) {
        (bool success, bytes memory result) =
            HLConstants.SPOT_BALANCE_PRECOMPILE_ADDRESS.staticcall(abi.encode(user, token));
        if (!success) revert PrecompileLib__SpotBalancePrecompileFailed();
        return abi.decode(result, (SpotBalance));
    }

    function userVaultEquity(address user, address vault) internal view returns (UserVaultEquity memory) {
        (bool success, bytes memory result) =
            HLConstants.VAULT_EQUITY_PRECOMPILE_ADDRESS.staticcall(abi.encode(user, vault));
        if (!success) revert PrecompileLib__VaultEquityPrecompileFailed();
        return abi.decode(result, (UserVaultEquity));
    }

    function withdrawable(address user) internal view returns (uint64) {
        (bool success, bytes memory result) = HLConstants.WITHDRAWABLE_PRECOMPILE_ADDRESS.staticcall(abi.encode(user));
        if (!success) revert PrecompileLib__WithdrawablePrecompileFailed();
        return abi.decode(result, (Withdrawable)).withdrawable;
    }

    function delegations(address user) internal view returns (Delegation[] memory) {
        (bool success, bytes memory result) = HLConstants.DELEGATIONS_PRECOMPILE_ADDRESS.staticcall(abi.encode(user));
        if (!success) revert PrecompileLib__DelegationsPrecompileFailed();
        return abi.decode(result, (Delegation[]));
    }

    function delegatorSummary(address user) internal view returns (DelegatorSummary memory) {
        (bool success, bytes memory result) =
            HLConstants.DELEGATOR_SUMMARY_PRECOMPILE_ADDRESS.staticcall(abi.encode(user));
        if (!success) revert PrecompileLib__DelegatorSummaryPrecompileFailed();
        return abi.decode(result, (DelegatorSummary));
    }

    function markPx(uint32 perpIndex) internal view returns (uint64) {
        (bool success, bytes memory result) = HLConstants.MARK_PX_PRECOMPILE_ADDRESS.staticcall(abi.encode(perpIndex));
        if (!success) revert PrecompileLib__MarkPxPrecompileFailed();
        return abi.decode(result, (uint64));
    }

    function oraclePx(uint32 perpIndex) internal view returns (uint64) {
        (bool success, bytes memory result) = HLConstants.ORACLE_PX_PRECOMPILE_ADDRESS.staticcall(abi.encode(perpIndex));
        if (!success) revert PrecompileLib__OraclePxPrecompileFailed();
        return abi.decode(result, (uint64));
    }

    function spotPx(uint64 spotIndex) internal view returns (uint64) {
        (bool success, bytes memory result) = HLConstants.SPOT_PX_PRECOMPILE_ADDRESS.staticcall(abi.encode(spotIndex));
        if (!success) revert PrecompileLib__SpotPxPrecompileFailed();
        return abi.decode(result, (uint64));
    }

    function perpAssetInfo(uint32 perp) internal view returns (PerpAssetInfo memory) {
        (bool success, bytes memory result) =
            HLConstants.PERP_ASSET_INFO_PRECOMPILE_ADDRESS.staticcall(abi.encode(perp));
        if (!success) revert PrecompileLib__PerpAssetInfoPrecompileFailed();
        return abi.decode(result, (PerpAssetInfo));
    }

    function spotInfo(uint64 spotIndex) internal view returns (SpotInfo memory) {
        (bool success, bytes memory result) = HLConstants.SPOT_INFO_PRECOMPILE_ADDRESS.staticcall(abi.encode(spotIndex));
        if (!success) revert PrecompileLib__SpotInfoPrecompileFailed();
        return abi.decode(result, (SpotInfo));
    }

    function tokenInfo(uint64 token) internal view returns (TokenInfo memory) {
        (bool success, bytes memory result) = HLConstants.TOKEN_INFO_PRECOMPILE_ADDRESS.staticcall(abi.encode(token));
        if (!success) revert PrecompileLib__TokenInfoPrecompileFailed();
        return abi.decode(result, (TokenInfo));
    }

    function tokenSupply(uint64 token) internal view returns (TokenSupply memory) {
        (bool success, bytes memory result) = HLConstants.TOKEN_SUPPLY_PRECOMPILE_ADDRESS.staticcall(abi.encode(token));
        if (!success) revert PrecompileLib__TokenSupplyPrecompileFailed();
        return abi.decode(result, (TokenSupply));
    }

    function l1BlockNumber() internal view returns (uint64) {
        (bool success, bytes memory result) = HLConstants.L1_BLOCK_NUMBER_PRECOMPILE_ADDRESS.staticcall(abi.encode());
        if (!success) revert PrecompileLib__L1BlockNumberPrecompileFailed();
        return abi.decode(result, (uint64));
    }

    function bbo(uint64 asset) internal view returns (Bbo memory) {
        (bool success, bytes memory result) = HLConstants.BBO_PRECOMPILE_ADDRESS.staticcall(abi.encode(asset));
        if (!success) revert PrecompileLib__BboPrecompileFailed();
        return abi.decode(result, (Bbo));
    }

    function accountMarginSummary(uint32 perpDexIndex, address user)
        internal
        view
        returns (AccountMarginSummary memory)
    {
        (bool success, bytes memory result) = HLConstants.ACCOUNT_MARGIN_SUMMARY_PRECOMPILE_ADDRESS
            .staticcall(abi.encode(perpDexIndex, user));
        if (!success) revert PrecompileLib__AccountMarginSummaryPrecompileFailed();
        return abi.decode(result, (AccountMarginSummary));
    }

    function coreUserExists(address user) internal view returns (bool) {
        (bool success, bytes memory result) =
            HLConstants.CORE_USER_EXISTS_PRECOMPILE_ADDRESS.staticcall(abi.encode(user));
        if (!success) revert PrecompileLib__CoreUserExistsPrecompileFailed();
        return abi.decode(result, (CoreUserExists)).exists;
    }

    function borrowLendUserState(
        address user,
        uint64 token
    ) internal view returns (BorrowLendUserTokenState memory) {
        (bool success, bytes memory result) = HLConstants.BORROW_LEND_USER_STATE_PRECOMPILE_ADDRESS.staticcall(abi.encode(user, token));
        if (!success) revert PrecompileLib__BorrowLendUserStatePrecompileFailed();
        return abi.decode(result, (BorrowLendUserTokenState));
    }

    function borrowLendReserveState(
        uint64 token
    ) internal view returns (BorrowLendReserveState memory) {
        (bool success, bytes memory result) = HLConstants.BORROW_LEND_RESERVE_STATE_PRECOMPILE_ADDRESS.staticcall(abi.encode(token));
        if (!success) revert PrecompileLib__BorrowLendReserveStatePrecompileFailed();
        return abi.decode(result, (BorrowLendReserveState));
    }

    /*//////////////////////////////////////////////////////////////
                       Structs
    //////////////////////////////////////////////////////////////*/
    struct Position {
        int64 szi;
        uint64 entryNtl;
        int64 isolatedRawUsd;
        uint32 leverage;
        bool isIsolated;
    }

    struct SpotBalance {
        uint64 total;
        uint64 hold;
        uint64 entryNtl;
    }

    struct UserVaultEquity {
        uint64 equity;
        uint64 lockedUntilTimestamp;
    }

    struct Withdrawable {
        uint64 withdrawable;
    }

    struct Delegation {
        address validator;
        uint64 amount;
        uint64 lockedUntilTimestamp;
    }

    struct DelegatorSummary {
        uint64 delegated;
        uint64 undelegated;
        uint64 totalPendingWithdrawal;
        uint64 nPendingWithdrawals;
    }

    struct PerpAssetInfo {
        string coin;
        uint32 marginTableId;
        uint8 szDecimals;
        uint8 maxLeverage;
        bool onlyIsolated;
    }

    struct SpotInfo {
        string name;
        uint64[2] tokens;
    }

    struct TokenInfo {
        string name;
        uint64[] spots;
        uint64 deployerTradingFeeShare;
        address deployer;
        address evmContract;
        uint8 szDecimals;
        uint8 weiDecimals;
        int8 evmExtraWeiDecimals;
    }

    struct UserBalance {
        address user;
        uint64 balance;
    }

    struct TokenSupply {
        uint64 maxSupply;
        uint64 totalSupply;
        uint64 circulatingSupply;
        uint64 futureEmissions;
        UserBalance[] nonCirculatingUserBalances;
    }

    struct Bbo {
        uint64 bid;
        uint64 ask;
    }

    struct AccountMarginSummary {
        int64 accountValue;
        uint64 marginUsed;
        uint64 ntlPos;
        int64 rawUsd;
    }

    struct CoreUserExists {
        bool exists;
    }

    struct BasisAndValue {
        uint64 basis;
        uint64 value;
    }

    struct BorrowLendUserTokenState {
        BasisAndValue borrow;
        BasisAndValue supply;
    }

    struct BorrowLendReserveState {
        uint64 borrowYearlyRateBps;
        uint64 supplyYearlyRateBps;
        uint64 balance;
        uint64 utilizationBps;
        uint64 oraclePx;
        uint64 ltvBps;
        uint64 totalSupplied;
        uint64 totalBorrowed;
    }

    error PrecompileLib__Position2PrecompileFailed();
    error PrecompileLib__SpotBalancePrecompileFailed();
    error PrecompileLib__VaultEquityPrecompileFailed();
    error PrecompileLib__WithdrawablePrecompileFailed();
    error PrecompileLib__DelegationsPrecompileFailed();
    error PrecompileLib__DelegatorSummaryPrecompileFailed();
    error PrecompileLib__MarkPxPrecompileFailed();
    error PrecompileLib__OraclePxPrecompileFailed();
    error PrecompileLib__SpotPxPrecompileFailed();
    error PrecompileLib__PerpAssetInfoPrecompileFailed();
    error PrecompileLib__SpotInfoPrecompileFailed();
    error PrecompileLib__TokenInfoPrecompileFailed();
    error PrecompileLib__TokenSupplyPrecompileFailed();
    error PrecompileLib__L1BlockNumberPrecompileFailed();
    error PrecompileLib__BboPrecompileFailed();
    error PrecompileLib__AccountMarginSummaryPrecompileFailed();
    error PrecompileLib__CoreUserExistsPrecompileFailed();
    error PrecompileLib__SpotIndexNotFound();
    error PrecompileLib__BorrowLendUserStatePrecompileFailed();
    error PrecompileLib__BorrowLendReserveStatePrecompileFailed();
}
```

Transferring tokens from HyperEVM to HyperCore can be done using an ERC20 transfer with the corresponding system address as the destination. The tokens are credited to the Core based on the emitted Transfer(address from, address to, uint256 value) from the linked contract.

CoreWriter actions are not applied the instant the EVM transaction lands. On an L1 block that produces a HyperEVM block, the order of operations is:
1. The L1 block is built.
2. The EVM block is built.
3. EVM-to-Core transfers are processed.
4. CoreWriter actions are enqueued & processed (the EVM actions itself are ran right away as always, but processed by the Core in the future blocks).

This delay is designed to outlast the typical mempool inclusion window. By forcing an EVM-originated order to wait out several native L1 blocks, the network ensures that a trader cannot use the EVM layer to front-run or jump the queue of native orderbook traders.

Transfers from HyperCore to HyperEVM are queued on the L1 until the next HyperEVM block. Transfers from HyperEVM to HyperCore happen in the same L1 block as the HyperEVM block, immediately after the HyperEVM block is built.

**Verify the result**

CoreWriter does not return a value to the caller — sendRawAction only emits a log. To confirm an action took effect, read HyperCore state:
- Query the API /info endpoint (for example, clearinghouseState for perp balances or spotClearinghouseState for spot balances) for the contract address.
- Read it on-chain through the HyperCore read precompiles at 0x0800 and above.
- Watch the L1 explorer for the enqueuing and execution entries described above.

If an action does not appear, work through Make sure your action lands: an uninitialized HyperCore account, funds on the wrong (spot vs perp) side, a size that violates szDecimals, or checking before the action delay elapses.
