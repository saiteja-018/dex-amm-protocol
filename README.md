# DEX AMM Project

## Overview

This project implements a simplified Decentralized Exchange (DEX) using the Automated Market Maker (AMM) model, similar to Uniswap V2. The DEX allows users to trade ERC-20 tokens in a decentralized, permissionless manner without relying on traditional order books or centralized intermediaries.

The implementation provides core DeFi functionality including liquidity provision, LP token management, token swaps using the constant product formula (x * y = k), and automated fee distribution to liquidity providers.

## Features

- **Initial and Subsequent Liquidity Provision**: First liquidity provider sets the initial price ratio, subsequent providers must maintain the existing ratio
- **LP Token Minting and Burning**: Liquidity providers receive LP tokens representing their share of the pool, which can be burned to withdraw liquidity
- **Token Swaps Using Constant Product Formula**: Implements x * y = k invariant for automated price discovery
- **0.3% Trading Fee**: Each swap incurs a 0.3% fee that remains in the pool, benefiting all liquidity providers
- **Proportional Fee Distribution**: Fees are automatically distributed proportionally to each LP's share when they withdraw liquidity
- **Reentrancy Protection**: Uses OpenZeppelin's ReentrancyGuard to prevent reentrancy attacks
- **Safe Token Transfers**: Utilizes SafeERC20 for secure token interactions

## Architecture

### Contract Structure

The project consists of two main smart contracts:

1. **DEX.sol**: The core AMM implementation containing:
   - Liquidity management functions (add/remove)
   - Token swap functions (bidirectional)
   - Price calculation and query functions
   - Fee calculation logic
   - LP token accounting (integrated approach)

2. **MockERC20.sol**: A simple ERC-20 token implementation for testing purposes with minting capability

### Key Design Decisions

- **Integrated LP Tokens**: LP tokens are managed within the DEX contract using a mapping rather than as a separate ERC-20 contract, simplifying the implementation while maintaining full functionality
- **Reentrancy Protection**: All state-changing functions use the `nonReentrant` modifier to prevent reentrancy attacks
- **Safe Math**: Utilizes Solidity 0.8+ built-in overflow/underflow protection
- **SafeERC20**: Uses OpenZeppelin's SafeERC20 wrapper for secure token transfers
- **Ratio Maintenance**: Subsequent liquidity additions automatically use the optimal amount to maintain the pool's price ratio

## Mathematical Implementation

### Constant Product Formula

The DEX implements the constant product formula: **x * y = k**

Where:
- `x` = reserve of Token A
- `y` = reserve of Token B  
- `k` = constant product (increases slightly with each trade due to fees)

For each swap, the formula ensures:
```
reserveA_new * reserveB_new >= reserveA_old * reserveB_old
```

The inequality accounts for the 0.3% fee that remains in the pool, causing `k` to increase over time.

### Fee Calculation

Each swap applies a 0.3% fee to the input amount:

```solidity
amountInWithFee = amountIn * 997
numerator = amountInWithFee * reserveOut
denominator = (reserveIn * 1000) + amountInWithFee
amountOut = numerator / denominator
```

This formula:
- Applies 997/1000 ratio (99.7% of input is used, 0.3% is fee)
- Keeps the fee in the pool automatically
- Ensures the constant product invariant is maintained
- Benefits all LP holders proportionally

### LP Token Minting

**Initial Liquidity (First Provider):**
```
liquidityMinted = sqrt(amountA * amountB)
```

This geometric mean approach ensures fair initial LP token allocation regardless of the token ratio chosen.

**Subsequent Liquidity:**
```
liquidityMinted = min(
    (amountA * totalLiquidity) / reserveA,
    (amountB * totalLiquidity) / reserveB
)
```

This ensures:
- New liquidity providers get LP tokens proportional to their contribution
- The pool ratio is maintained
- No arbitrage opportunities are created

### Liquidity Removal

Withdraw proportional share of both tokens:
```
amountA = (liquidityBurned * reserveA) / totalLiquidity
amountB = (liquidityBurned * reserveB) / totalLiquidity
```

This guarantees:
- Fair distribution based on LP token ownership
- Accumulated fees are included in the withdrawn amounts
- Pool ratio is maintained after withdrawal

## Setup Instructions

### Prerequisites

- Docker and Docker Compose installed
- Git

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd dex-amm-protocol
```

2. Start Docker environment:
```bash
docker-compose up -d
```

3. Compile contracts:
```bash
docker-compose exec app npm run compile
```

4. Run tests:
```bash
docker-compose exec app npm test
```

5. Check coverage:
```bash
docker-compose exec app npm run coverage
```

6. Stop Docker:
```bash
docker-compose down
```

### Running Tests Locally (without Docker)

```bash
npm install
npm run compile
npm test
```

### Deployment

To deploy to a local Hardhat network:
```bash
npm run deploy
```

For testnet/mainnet deployment, configure the network in `hardhat.config.js` and run:
```bash
npx hardhat run scripts/deploy.js --network <network-name>
```

## Contract Addresses

*To be updated after deployment to testnet/mainnet*

- Token A: TBD
- Token B: TBD
- DEX: TBD

## Known Limitations

1. **Single Trading Pair**: The current implementation supports only one trading pair per DEX instance. For multiple pairs, deploy separate DEX contracts.

2. **No Slippage Protection**: The contract doesn't include a `minAmountOut` parameter. Users should implement slippage checks at the frontend level.

3. **No Deadline Parameter**: Transactions don't have a deadline, making them potentially vulnerable to being held and executed at unfavorable times.

4. **Integer Division Rounding**: Due to Solidity's integer division, very small amounts may result in rounding to zero.

5. **First Provider Advantage**: The first liquidity provider can set any initial price ratio, which may not reflect true market prices.

6. **No Flash Swap Support**: Unlike Uniswap V2, this implementation doesn't support flash swaps/loans.

7. **Gas Costs**: The implementation prioritizes clarity over gas optimization. Production deployments should consider additional optimizations.

## Security Considerations

### Implemented Security Measures

1. **Reentrancy Protection**: All external functions that modify state use OpenZeppelin's `ReentrancyGuard` modifier to prevent reentrancy attacks.

2. **SafeERC20**: Uses OpenZeppelin's SafeERC20 library to handle token transfers safely, protecting against tokens that don't return boolean values.

3. **Input Validation**: All functions validate inputs to ensure:
   - Amounts are greater than zero
   - Sufficient balances exist
   - Sufficient liquidity exists for operations
   - No division by zero occurs

4. **Checks-Effects-Interactions Pattern**: State updates occur before external calls to prevent reentrancy and ensure consistency.

5. **Integer Overflow Protection**: Utilizes Solidity 0.8+ built-in overflow/underflow protection.

6. **Reserve Synchronization**: Reserves are updated atomically with token transfers to prevent desynchronization attacks.

### Potential Risks

1. **Front-Running**: Like all AMMs, this DEX is susceptible to front-running attacks where miners or bots can observe pending transactions and submit their own with higher gas prices.

2. **Price Manipulation**: Large swaps can significantly impact the pool price, potentially allowing for sandwich attacks.

3. **Impermanent Loss**: Liquidity providers are exposed to impermanent loss when token prices diverge from the initial ratio.

4. **Smart Contract Risk**: Despite security measures, smart contracts always carry inherent risks. This code has not been professionally audited.

### Recommendations for Production

1. Conduct a professional security audit
2. Implement slippage protection parameters
3. Add deadline checks for time-sensitive operations
4. Consider implementing circuit breakers for emergency situations
5. Add admin functions for emergency pause/unpause
6. Implement multi-signature controls for critical operations
7. Consider using a price oracle for initial liquidity validation

## Testing

The test suite includes 27 comprehensive test cases covering:

- **Liquidity Management** (8 tests): Initial provision, LP token minting, subsequent additions, ratio maintenance, partial removal, correct token returns, zero amount reverts, insufficient liquidity reverts
- **Token Swaps** (8 tests): Bidirectional swaps, fee calculations, reserve updates, k increases, zero amount reverts, large swaps with price impact, multiple consecutive swaps
- **Price Calculations** (3 tests): Initial price, price updates after swaps, zero reserve handling
- **Fee Distribution** (2 tests): Fee accumulation for LPs, proportional distribution
- **Edge Cases** (3 tests): Very small amounts, very large amounts, multi-user interactions
- **Events** (3 tests): LiquidityAdded, LiquidityRemoved, Swap event emissions

All tests achieve >95% code coverage and validate both happy paths and error conditions.

## License

MIT

## Contributing

Contributions are welcome! Please ensure all tests pass and maintain code coverage above 80% for any pull requests.

## Contact

For questions or issues, please open an issue on GitHub.
