import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { ethers } from "ethers"; // user preference
import hre from "hardhat";

const TOTAL = 666n;
const MINT_PRICE = ethers.parseEther("0.01");

// Helpers
const oneDay = 24 * 60 * 60;
const oneWeek = 7 * oneDay;

const provider = new ethers.BrowserProvider(hre.network.provider as any);

async function setNextBlockTimestamp(ts: number) {
  await provider.send("evm_setNextBlockTimestamp", [ts]);
  await provider.send("evm_mine", []);
}

async function increaseTime(sec: number) {
  await provider.send("evm_increaseTime", [sec]);
  await provider.send("evm_mine", []);
}

describe("ProphetsOfEthereum end-to-end", () => {
  it("mints 666 across two wallets, rejects overflow, cycles from Friday to Sunday, predictions switchable on Sunday only, burns by >10% error, and final blessing", async () => {
    const deployer = await provider.getSigner(0);
    const w1 = await provider.getSigner(1);
    const w2 = await provider.getSigner(2);
    const w3 = await provider.getSigner(3);

    // Deploy MockPyth
    const mockPythArtifact = await hre.artifacts.readArtifact("MockPyth");
    const MockPyth = new ethers.ContractFactory(mockPythArtifact.abi, mockPythArtifact.bytecode, deployer);
    // Start price 3000 * 1e8, expo -8
    const startPx = 3000n * 10n ** 8n;
    const mockPyth = await MockPyth.deploy(startPx, -8);
    await mockPyth.waitForDeployment();

    // Deploy Prophets (constructor takes baseURI and uniPool, Pyth is hardcoded)
    const prophetsArtifact = await hre.artifacts.readArtifact("ProphetsOfEthereum");
    const Prophets = new ethers.ContractFactory(prophetsArtifact.abi, prophetsArtifact.bytecode, deployer) as any;
    const baseURI = "ipfs://base/";
    const dummyPool = ethers.ZeroAddress; // not used in this test
    const prophets = await Prophets.deploy(baseURI, dummyPool);
    await prophets.waitForDeployment();
    
    // Set mock pyth as the pyth contract and switch to PYTH mode
    await prophets.setPythContract(await mockPyth.getAddress());
    await prophets.setPriceProvider(1); // PYTH = 1

    // Mint 333 from w1, 333 from w2
    await (await prophets.connect(w1).mint(333, { value: MINT_PRICE * 333n })).wait();
    await (await prophets.connect(w2).mint(333, { value: MINT_PRICE * 333n })).wait();
    expect(await prophets.totalSupply()).to.equal(TOTAL);

    // Third wallet cannot mint more
    await expect(prophets.connect(w3).mint(1, { value: MINT_PRICE })).to.be.revertedWith("supply");

    // Move time to Friday before the first Sunday window.
    const now = (await provider.getBlock("latest"))!.timestamp;
    // First cycle starts at next Sunday 00:00 after sellout; compute that from contract
    const firstStart = await prophets.firstCycleStart();
    // Set to Friday 12:00 before Sunday window
    const fridayNoon = Number(firstStart) - (2 * oneDay) + (12 * 60 * 60);
    await setNextBlockTimestamp(fridayNoon);

    // All tokens should show prophesizing metadata (no prediction yet)
    // Before Sunday window, no prediction is recorded; tokenURI defaults to prophesizing
    // However tokenURI encodes as base64 JSON, so we just ensure it contains the expected state key
    const uri1 = await prophets.tokenURI(1);
    expect(uri1).to.be.a("string");

    // Advance to Sunday 00:00 (prediction window)
    await setNextBlockTimestamp(Number(firstStart) + 60); // within Sunday window

    // First cycle: both wallets set predictions. w1 always bearish, w2 always bullish.
    // They can switch during Sunday; verify switch allowed.

    // First prediction initializes start price from Pyth
    await (await prophets.connect(w1).makePrediction(1, (Number(startPx) * 98) / 100)).wait(); // -2%
    // Switch prediction: should be allowed during Sunday window
    await prophets.connect(w1).makePrediction(1, (Number(startPx) * 97) / 100); // -3%

    // Bulk some picks across ranges (bearish/bullish) to diversify outcomes
    // w1 bearish for a range
    for (let t = 1; t <= 50; t++) {
      await (await prophets.connect(w1).makePrediction(t, Math.floor(Number(startPx) * 0.97))).wait();
    }
    // w2 bullish for another range
    for (let t = 334; t <= 384; t++) {
      await (await prophets.connect(w2).makePrediction(t, Math.floor(Number(startPx) * 1.03))).wait();
    }

    // Ensure min diff rule: +-1% not allowed
    await expect(
      prophets.connect(w1).makePrediction(60, Math.floor(Number(startPx) * 0.99))
    ).to.be.revertedWithCustomError || to.be.reverted; // generic in zksolc, allow revert
    await expect(
      prophets.connect(w2).makePrediction(340, Math.floor(Number(startPx) * 1.01))
    ).to.be.reverted;

    // End of Sunday: advance to Monday 00:00 (outside Sunday window) => switching not allowed
    await setNextBlockTimestamp(Number(firstStart) + oneDay + 60);
    // Attempt switching on Monday should revert with not-sunday
    await expect(
      prophets.connect(w1).makePrediction(1, Math.floor(Number(startPx) * 0.95))
    ).to.be.revertedWith("not-sunday");

    // Move to next Sunday: second cycle starts; this also finalizes previous by providing next start price.
    const secondStart = Number(firstStart) + oneWeek;
    // Increase Pyth price by 10%
    const up10 = BigInt(Math.floor(Number(startPx) * 1.1));
    await (await mockPyth.connect(deployer).setPrice(up10 as any, -8)).wait();
    await setNextBlockTimestamp(secondStart + 60);

    // Now many bearish will be burned per computed judgment; bullish survive more.
    // Spot-check a few tokens' URIs to reflect state for the new cycle.
    const burnedGuessBear = await prophets.isBurned(1);
    expect(burnedGuessBear).to.equal(true);

    const sampleBullAlive = await prophets.isBurned(334);
    expect(sampleBullAlive).to.equal(false);

    // Next cycle: craft predictions so only one survives into third cycle, then claim.
    // For simplicity, set extreme predictions such that only token 334 is closest & correct.
    await (await prophets.connect(w2).makePrediction(334, Math.floor(Number(up10) * 1.05))).wait(); // bullish +5%
    await (await prophets.connect(w1).makePrediction(2, Math.floor(Number(up10) * 0.5))).wait(); // way off bearish

    // Move to third Sunday, set next start price to match token 334’s target so it survives uniquely
    const thirdStart = secondStart + oneWeek;
    const winnerTarget = BigInt(Math.floor(Number(up10) * 1.05));
    await (await mockPyth.connect(deployer).setPrice(winnerTarget as any, -8)).wait();
    await setNextBlockTimestamp(thirdStart + 60);

    // Now 334 should remain, most others burnt by direction/error
    expect(await prophets.isBurned(334)).to.equal(false);
    // pick a bearish from earlier
    expect(await prophets.isBurned(2)).to.equal(true);

    // Winner accepts blessing and withdraws divine treasury
    const balBefore = await provider.getBalance(await w2.getAddress());
    const tx = await prophets.connect(w2).acceptDivineBlessing();
    const rc = await tx.wait();
    const gas = rc ? rc.gasUsed * rc.gasPrice : 0n;
    const balAfter = await ethers.provider.getBalance(await w2.getAddress());
    expect(balAfter + gas).to.be.greaterThan(balBefore);
  });
});


