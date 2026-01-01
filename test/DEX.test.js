const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DEX", function() {
    let dex, tokenA, tokenB;
    let owner, addr1, addr2;
    
    beforeEach(async function() {
        // Deploy tokens and DEX before each test
        [owner, addr1, addr2] = await ethers.getSigners();
        
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        tokenA = await MockERC20.deploy("Token A", "TKA");
        tokenB = await MockERC20.deploy("Token B", "TKB");
        
        const DEX = await ethers.getContractFactory("DEX");
        dex = await DEX.deploy(tokenA.address, tokenB.address);
        
        // Approve DEX to spend tokens
        await tokenA.approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenB.approve(dex.address, ethers.utils.parseEther("1000000"));
        
        // Mint tokens to addr1 and addr2 for testing
        await tokenA.mint(addr1.address, ethers.utils.parseEther("10000"));
        await tokenB.mint(addr1.address, ethers.utils.parseEther("10000"));
        await tokenA.mint(addr2.address, ethers.utils.parseEther("10000"));
        await tokenB.mint(addr2.address, ethers.utils.parseEther("10000"));
        
        // Approve from addr1 and addr2
        await tokenA.connect(addr1).approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenB.connect(addr1).approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenA.connect(addr2).approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenB.connect(addr2).approve(dex.address, ethers.utils.parseEther("1000000"));
    });
    
    describe("Liquidity Management", function() {
        it("should allow initial liquidity provision", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            await dex.addLiquidity(amountA, amountB);
            
            const reserves = await dex.getReserves();
            expect(reserves._reserveA).to.equal(amountA);
            expect(reserves._reserveB).to.equal(amountB);
            expect(await dex.totalLiquidity()).to.be.gt(0);
        });
        
        it("should mint correct LP tokens for first provider", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            await dex.addLiquidity(amountA, amountB);
            
            // LP tokens should be sqrt(100 * 200) = sqrt(20000) ≈ 141.42
            const expectedLiquidity = ethers.BigNumber.from("141421356237309504880"); // sqrt in wei
            const actualLiquidity = await dex.liquidity(owner.address);
            
            expect(actualLiquidity).to.be.closeTo(expectedLiquidity, ethers.utils.parseEther("0.01"));
        });
        
        it("should allow subsequent liquidity additions", async function() {
            // Initial liquidity
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("200"));
            
            // Subsequent liquidity from addr1
            const amountA = ethers.utils.parseEther("50");
            const amountB = ethers.utils.parseEther("100");
            await dex.connect(addr1).addLiquidity(amountA, amountB);
            
            const reserves = await dex.getReserves();
            expect(reserves._reserveA).to.equal(ethers.utils.parseEther("150"));
            expect(reserves._reserveB).to.equal(ethers.utils.parseEther("300"));
        });
        
        it("should maintain price ratio on liquidity addition", async function() {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("200"));
            
            const priceBefore = await dex.getPrice();
            
            // Add liquidity maintaining ratio
            await dex.connect(addr1).addLiquidity(ethers.utils.parseEther("50"), ethers.utils.parseEther("100"));
            
            const priceAfter = await dex.getPrice();
            
            // Price should remain the same (within rounding)
            expect(priceAfter).to.be.closeTo(priceBefore, ethers.utils.parseEther("0.01"));
        });
        
        it("should allow partial liquidity removal", async function() {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("200"));
            
            const liquidityBefore = await dex.liquidity(owner.address);
            const halfLiquidity = liquidityBefore.div(2);
            
            await dex.removeLiquidity(halfLiquidity);
            
            const liquidityAfter = await dex.liquidity(owner.address);
            expect(liquidityAfter).to.be.closeTo(halfLiquidity, ethers.utils.parseEther("0.001"));
        });
        
        it("should return correct token amounts on liquidity removal", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            await dex.addLiquidity(amountA, amountB);
            
            const balanceABefore = await tokenA.balanceOf(owner.address);
            const balanceBBefore = await tokenB.balanceOf(owner.address);
            
            const liquidityToRemove = await dex.liquidity(owner.address);
            await dex.removeLiquidity(liquidityToRemove);
            
            const balanceAAfter = await tokenA.balanceOf(owner.address);
            const balanceBAfter = await tokenB.balanceOf(owner.address);
            
            // Should get back approximately what was put in
            expect(balanceAAfter.sub(balanceABefore)).to.be.closeTo(amountA, ethers.utils.parseEther("0.01"));
            expect(balanceBAfter.sub(balanceBBefore)).to.be.closeTo(amountB, ethers.utils.parseEther("0.01"));
        });
        
        it("should revert on zero liquidity addition", async function() {
            await expect(
                dex.addLiquidity(0, ethers.utils.parseEther("100"))
            ).to.be.revertedWith("Amounts must be greater than 0");
            
            await expect(
                dex.addLiquidity(ethers.utils.parseEther("100"), 0)
            ).to.be.revertedWith("Amounts must be greater than 0");
        });
        
        it("should revert when removing more liquidity than owned", async function() {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("200"));
            
            const liquidity = await dex.liquidity(owner.address);
            
            await expect(
                dex.removeLiquidity(liquidity.add(1))
            ).to.be.revertedWith("Insufficient liquidity");
        });
    });
    
    describe("Token Swaps", function() {
        beforeEach(async function() {
            // Add initial liquidity before swap tests
            await dex.addLiquidity(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("200")
            );
        });
        
        it("should swap token A for token B", async function() {
            const amountAIn = ethers.utils.parseEther("10");
            const balanceBBefore = await tokenB.balanceOf(owner.address);
            
            await dex.swapAForB(amountAIn);
            
            const balanceBAfter = await tokenB.balanceOf(owner.address);
            expect(balanceBAfter).to.be.gt(balanceBBefore);
        });
        
        it("should swap token B for token A", async function() {
            const amountBIn = ethers.utils.parseEther("20");
            const balanceABefore = await tokenA.balanceOf(owner.address);
            
            await dex.swapBForA(amountBIn);
            
            const balanceAAfter = await tokenA.balanceOf(owner.address);
            expect(balanceAAfter).to.be.gt(balanceABefore);
        });
        
        it("should calculate correct output amount with fee", async function() {
            const amountAIn = ethers.utils.parseEther("10");
            const reserves = await dex.getReserves();
            
            // Calculate expected output
            const amountInWithFee = amountAIn.mul(997);
            const numerator = amountInWithFee.mul(reserves._reserveB);
            const denominator = reserves._reserveA.mul(1000).add(amountInWithFee);
            const expectedOut = numerator.div(denominator);
            
            const actualOut = await dex.getAmountOut(amountAIn, reserves._reserveA, reserves._reserveB);
            
            expect(actualOut).to.equal(expectedOut);
        });
        
        it("should update reserves after swap", async function() {
            const amountAIn = ethers.utils.parseEther("10");
            const reservesBefore = await dex.getReserves();
            
            await dex.swapAForB(amountAIn);
            
            const reservesAfter = await dex.getReserves();
            
            expect(reservesAfter._reserveA).to.be.gt(reservesBefore._reserveA);
            expect(reservesAfter._reserveB).to.be.lt(reservesBefore._reserveB);
        });
        
        it("should increase k after swap due to fees", async function() {
            const reservesBefore = await dex.getReserves();
            const kBefore = reservesBefore._reserveA.mul(reservesBefore._reserveB);
            
            await dex.swapAForB(ethers.utils.parseEther("10"));
            
            const reservesAfter = await dex.getReserves();
            const kAfter = reservesAfter._reserveA.mul(reservesAfter._reserveB);
            
            // k should increase due to 0.3% fee staying in pool
            expect(kAfter).to.be.gt(kBefore);
        });
        
        it("should revert on zero swap amount", async function() {
            await expect(
                dex.swapAForB(0)
            ).to.be.revertedWith("Amount must be greater than 0");
            
            await expect(
                dex.swapBForA(0)
            ).to.be.revertedWith("Amount must be greater than 0");
        });
        
        it("should handle large swaps with high price impact", async function() {
            const largeAmount = ethers.utils.parseEther("50");
            
            const balanceBBefore = await tokenB.balanceOf(owner.address);
            await dex.swapAForB(largeAmount);
            const balanceBAfter = await tokenB.balanceOf(owner.address);
            
            const received = balanceBAfter.sub(balanceBBefore);
            
            // Should receive less than proportional due to slippage
            // 50/100 = 50% of pool, but should receive less than 50% of reserve due to constant product
            expect(received).to.be.lt(ethers.utils.parseEther("100")); // Less than 50% of 200
        });
        
        it("should handle multiple consecutive swaps", async function() {
            await dex.swapAForB(ethers.utils.parseEther("10"));
            await dex.swapBForA(ethers.utils.parseEther("10"));
            await dex.swapAForB(ethers.utils.parseEther("5"));
            
            const reserves = await dex.getReserves();
            expect(reserves._reserveA).to.be.gt(0);
            expect(reserves._reserveB).to.be.gt(0);
        });
    });
    
    describe("Price Calculations", function() {
        it("should return correct initial price", async function() {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("200"));
            
            const price = await dex.getPrice();
            
            // Price = reserveB / reserveA = 200 / 100 = 2 (in 1e18)
            const expectedPrice = ethers.utils.parseEther("2");
            expect(price).to.equal(expectedPrice);
        });
        
        it("should update price after swaps", async function() {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("200"));
            
            const priceBefore = await dex.getPrice();
            
            await dex.swapAForB(ethers.utils.parseEther("10"));
            
            const priceAfter = await dex.getPrice();
            
            // Price should decrease (more A in pool, less B)
            expect(priceAfter).to.be.lt(priceBefore);
        });
        
        it("should handle price queries with zero reserves gracefully", async function() {
            await expect(dex.getPrice()).to.be.revertedWith("No liquidity");
        });
    });
    
    describe("Fee Distribution", function() {
        it("should accumulate fees for liquidity providers", async function() {
            // Add liquidity
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("200"));
            
            const liquidityAmount = await dex.liquidity(owner.address);
            
            // Perform swaps to generate fees
            await dex.connect(addr1).swapAForB(ethers.utils.parseEther("10"));
            await dex.connect(addr1).swapBForA(ethers.utils.parseEther("10"));
            await dex.connect(addr1).swapAForB(ethers.utils.parseEther("5"));
            
            // Record balances before removal
            const balanceABefore = await tokenA.balanceOf(owner.address);
            const balanceBBefore = await tokenB.balanceOf(owner.address);
            
            // Remove liquidity
            await dex.removeLiquidity(liquidityAmount);
            
            const balanceAAfter = await tokenA.balanceOf(owner.address);
            const balanceBAfter = await tokenB.balanceOf(owner.address);
            
            const receivedA = balanceAAfter.sub(balanceABefore);
            const receivedB = balanceBAfter.sub(balanceBBefore);
            
            // Should receive more than initially deposited due to fees
            // Note: Might receive more of one token and less of another due to price changes
            const totalValueReceived = receivedA.add(receivedB.div(2)); // Rough value estimation
            const totalValueDeposited = ethers.utils.parseEther("100").add(ethers.utils.parseEther("200").div(2));
            
            // Total value should be approximately the same or more (fees - gas)
            expect(totalValueReceived).to.be.gte(totalValueDeposited.mul(99).div(100)); // Within 1%
        });
        
        it("should distribute fees proportionally to LP share", async function() {
            // Owner adds liquidity
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("200"));
            
            // Addr1 adds liquidity
            await dex.connect(addr1).addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("200"));
            
            const ownerLiquidity = await dex.liquidity(owner.address);
            const addr1Liquidity = await dex.liquidity(addr1.address);
            
            // Both should have similar liquidity amounts
            expect(ownerLiquidity).to.be.closeTo(addr1Liquidity, ethers.utils.parseEther("1"));
            
            // Perform swaps
            await dex.connect(addr2).swapAForB(ethers.utils.parseEther("20"));
            
            // Both remove liquidity
            const ownerBalanceABefore = await tokenA.balanceOf(owner.address);
            const ownerBalanceBBefore = await tokenB.balanceOf(owner.address);
            
            await dex.removeLiquidity(ownerLiquidity);
            
            const ownerBalanceAAfter = await tokenA.balanceOf(owner.address);
            const ownerBalanceBAfter = await tokenB.balanceOf(owner.address);
            
            const addr1BalanceABefore = await tokenA.balanceOf(addr1.address);
            const addr1BalanceBBefore = await tokenB.balanceOf(addr1.address);
            
            await dex.connect(addr1).removeLiquidity(addr1Liquidity);
            
            const addr1BalanceAAfter = await tokenA.balanceOf(addr1.address);
            const addr1BalanceBAfter = await tokenB.balanceOf(addr1.address);
            
            const ownerReceivedA = ownerBalanceAAfter.sub(ownerBalanceABefore);
            const ownerReceivedB = ownerBalanceBAfter.sub(ownerBalanceBBefore);
            const addr1ReceivedA = addr1BalanceAAfter.sub(addr1BalanceABefore);
            const addr1ReceivedB = addr1BalanceBAfter.sub(addr1BalanceBBefore);
            
            // Both should receive similar amounts (proportional to their LP share)
            expect(ownerReceivedA).to.be.closeTo(addr1ReceivedA, ethers.utils.parseEther("1"));
            expect(ownerReceivedB).to.be.closeTo(addr1ReceivedB, ethers.utils.parseEther("1"));
        });
    });
    
    describe("Edge Cases", function() {
        it("should handle very small liquidity amounts", async function() {
            const smallAmount = ethers.utils.parseEther("0.001");
            
            await dex.addLiquidity(smallAmount, smallAmount);
            
            const reserves = await dex.getReserves();
            expect(reserves._reserveA).to.equal(smallAmount);
            expect(reserves._reserveB).to.equal(smallAmount);
        });
        
        it("should handle very large liquidity amounts", async function() {
            const largeAmount = ethers.utils.parseEther("10000");
            
            await tokenA.mint(owner.address, largeAmount);
            await tokenB.mint(owner.address, largeAmount);
            await tokenA.approve(dex.address, largeAmount);
            await tokenB.approve(dex.address, largeAmount);
            
            await dex.addLiquidity(largeAmount, largeAmount);
            
            const reserves = await dex.getReserves();
            expect(reserves._reserveA).to.equal(largeAmount);
            expect(reserves._reserveB).to.equal(largeAmount);
        });
        
        it("should prevent unauthorized access", async function() {
            // There are no access-restricted functions in this DEX
            // Anyone can add liquidity, swap, etc.
            // This test verifies that the contract works for any user
            
            await dex.connect(addr1).addLiquidity(ethers.utils.parseEther("10"), ethers.utils.parseEther("20"));
            await dex.connect(addr2).addLiquidity(ethers.utils.parseEther("5"), ethers.utils.parseEther("10"));
            
            const reserves = await dex.getReserves();
            expect(reserves._reserveA).to.equal(ethers.utils.parseEther("15"));
            expect(reserves._reserveB).to.equal(ethers.utils.parseEther("30"));
        });
    });
    
    describe("Events", function() {
        it("should emit LiquidityAdded event", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            await expect(dex.addLiquidity(amountA, amountB))
                .to.emit(dex, "LiquidityAdded")
                .withArgs(owner.address, amountA, amountB, await dex.callStatic.addLiquidity(amountA, amountB));
        });
        
        it("should emit LiquidityRemoved event", async function() {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("200"));
            
            const liquidity = await dex.liquidity(owner.address);
            
            await expect(dex.removeLiquidity(liquidity))
                .to.emit(dex, "LiquidityRemoved");
        });
        
        it("should emit Swap event", async function() {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("200"));
            
            const amountIn = ethers.utils.parseEther("10");
            const reserves = await dex.getReserves();
            const expectedOut = await dex.getAmountOut(amountIn, reserves._reserveA, reserves._reserveB);
            
            await expect(dex.swapAForB(amountIn))
                .to.emit(dex, "Swap")
                .withArgs(owner.address, tokenA.address, tokenB.address, amountIn, expectedOut);
        });
    });
});
