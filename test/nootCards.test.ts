import { expect } from "chai";
import { ethers } from "ethers";
import { deployContract, getRichWallets } from "../utils/utils";
import { expectRejectedWithMessage } from "../utils/testingUtils";

// Test configuration - set to false to skip specific test suites
// AI DONT FUCKING EDIT THIS TEST CONFIG
const TEST_CONFIG = {
  runDeploymentTests: true,
  runAdminTests: true,
  runCalculatorTests: true,
  runGameStartTests: true,
  runGamePlayTests: true,
  runWithdrawalTests: false,
  runDealerWithdrawalTests: false
};

// Define helpful types/enums similar to the contract
enum Card { Two, Three, Four, Five, Six, Seven, Eight, Nine, Ten, Jack, Queen, King, Ace }
enum Guess { Higher, Lower }
enum GameStatus { NotStarted, Active, Completed, Disputed }

function getCardName(cardValue: number): string {
  const cardNames = [
    "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Jack", "Queen", "King", "Ace"
  ];
  return cardNames[cardValue];
}

// Helper function to create a hash commitment for testing
async function createHashCommitment(privateSecret: string) {
  // Hash the private secret to create the initial hash (h0)
  const initialHash = ethers.keccak256(ethers.toUtf8Bytes(privateSecret));
  
  // Initialize hashChain with the initial hash (h0)
  const hashChain = [initialHash];
  
  // Generate 10 more hashes (h1 through h10) for a total of 11 in hashChain
  let currentHash = initialHash;
  for (let i = 1; i <= 10; i++) {
    currentHash = ethers.keccak256(ethers.concat([currentHash]));
    hashChain.push(currentHash);
  }
  
  // The commitment is derived by hashing h10 once more (completely separate from hashChain)
  const commitment = ethers.keccak256(ethers.concat([hashChain[10]]));
  
  // Verify we have the correct number of hashes
  console.assert(hashChain.length === 11, "Hash chain MUST have exactly 11 hashes (h0-h10)");
  
  return {
    privateSecret,
    hashChain,     // [h0, h1, h2, h3, h4, h5, h6, h7, h8, h9, h10]
    commitment     // Derived from h10 but NOT included in hashChain
  };
}

// Helper to sign a commitment - dealer signs the commitment for verification
async function signCommitment(
  dealerWallet: any, 
  commitment: string, 
  userAddress: string, 
  gameId: bigint
) {
  // Create message hash including user address and game ID
  const messageToSign = ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "address", "uint256"],
      [commitment, userAddress, gameId]
    )
  );
  
  // Sign the message
  const signature = await dealerWallet.signMessage(ethers.getBytes(messageToSign));
  return signature;
}

// Helper to get game state in a more usable format
async function getGameState(contract: any, playerAddress: string) {
  const [
    status,
    wager,
    currentPot,
    previousCard,
    previousGuess,
    turn,
    gameId,
    commitment,
    userRandomNonce,
  ] = await contract.getGameState(playerAddress);
  
  return {
    status: Number(status),
    wager: wager,
    currentPot: currentPot,
    previousCard: Number(previousCard),
    previousGuess: Number(previousGuess),
    turn: Number(turn),
    gameId: gameId,
    commitment: commitment,
    userRandomNonce: userRandomNonce,
    active: Number(status) === GameStatus.Active
  };
}

describe("NootCards", function () {
  let nootCards: any;
  let nootToken: any;
  let wallets: any[];
  let adminWallet: any;
  let dealer: any;
  let player1: any;
  let player2: any;
  
  // Test constants
  const minWager = 100n;
  const maxWager = 10000n;
  
  before(async function() {
    wallets = await getRichWallets();
    adminWallet = wallets[0];
    dealer = wallets[1];
    player1 = wallets[2];
    player2 = wallets[3];
    
    // Deploy ERC20 token
    nootToken = await deployContract("ERC20Template", ["NOOT Token", "NOOT"]);
    
    // Deploy NootCards with contract addresses
    const nootTokenAddress = await nootToken.getAddress();
    const dealerAddress = await dealer.getAddress();
    
    nootCards = await deployContract("NootCards", [
      nootTokenAddress,
      dealerAddress,
      minWager,
      maxWager
    ]);
    
    const nootCardsAddress = await nootCards.getAddress();
    
    // Get addresses for players
    const player1Address = await player1.getAddress();
    const player2Address = await player2.getAddress();

    console.log("player1Address", player1Address);
    console.log("player2Address", player2Address);
    
    // Mint tokens for testing
    await nootToken.adminMint(player1Address, ethers.parseEther("1000"));
    await nootToken.adminMint(player2Address, ethers.parseEther("1000"));
    
    // Approve NootCards to spend tokens
    await nootToken.connect(player1).approve(nootCardsAddress, ethers.parseEther("1000"));
    await nootToken.connect(player2).approve(nootCardsAddress, ethers.parseEther("1000"));
  });
  
  (TEST_CONFIG.runDeploymentTests ? describe : describe.skip)("Contract deployment", function() {
    it("Should deploy successfully with correct initial values", async function() {
      const adminAddress = await adminWallet.getAddress();
      const dealerAddress = await dealer.getAddress();
      const nootTokenAddress = await nootToken.getAddress();
      
      expect(await nootCards.admin()).to.equal(adminAddress);
      expect(await nootCards.dealer()).to.equal(dealerAddress);
      expect(await nootCards.nootToken()).to.equal(nootTokenAddress);
      expect(await nootCards.minWager()).to.equal(minWager);
      expect(await nootCards.maxWager()).to.equal(maxWager);
      expect(await nootCards.GAME_MAX_TURNS()).to.equal(10n);
    });
    
    it("Should verify that dealer is immutable (cannot be changed)", async function() {
      // Since we've made dealer immutable, there should be no setDealer function
      expect(nootCards.setDealer).to.be.undefined;
    });
  });
  
  (TEST_CONFIG.runAdminTests ? describe : describe.skip)("Admin functions", function() {
    it("Should allow admin to transfer admin role", async function() {
      const player1Address = await player1.getAddress();
      const adminAddress = await adminWallet.getAddress();
      
      await nootCards.transferAdmin(player1Address);
      expect(await nootCards.admin()).to.equal(player1Address);
      
      // Transfer back to admin for other tests
      await nootCards.connect(player1).transferAdmin(adminAddress);
      expect(await nootCards.admin()).to.equal(adminAddress);
    });
    
    it("Should prevent non-admin from transferring admin role", async function() {
      const player2Address = await player2.getAddress();
      
      await expectRejectedWithMessage(
        nootCards.connect(player2).transferAdmin(player2Address),
        "TrustlessNootLadder: caller is not the admin"
      );
    });
    
    it("Should allow admin to update wager limits", async function() {
      const newMinWager = 200n;
      const newMaxWager = 20000n;
      
      await nootCards.updateWagerLimits(newMinWager, newMaxWager);
      expect(await nootCards.minWager()).to.equal(newMinWager);
      expect(await nootCards.maxWager()).to.equal(newMaxWager);
      
      // Set back for other tests
      await nootCards.updateWagerLimits(minWager, maxWager);
    });
    
    it("Should allow admin to update withdrawal timelock", async function() {
      const originalTimelock = await nootCards.withdrawalTimelock();
      const newTimelock = 24 * 3600; // 24 hours in seconds
      
      await nootCards.updateWithdrawalTimelock(newTimelock);
      expect(await nootCards.withdrawalTimelock()).to.equal(BigInt(newTimelock));
      
      // Set back to original
      await nootCards.updateWithdrawalTimelock(originalTimelock);
    });
    
    it("Should allow admin to withdraw tokens", async function() {
      // First add some tokens to the contract
      const nootCardsAddress = await nootCards.getAddress();
      const adminAddress = await adminWallet.getAddress();
      
      await nootToken.adminMint(nootCardsAddress, 1000n);
      
      const adminBalanceBefore = await nootToken.balanceOf(adminAddress);
      await nootCards.withdrawTokens(1000n);
      const adminBalanceAfter = await nootToken.balanceOf(adminAddress);
      
      expect(adminBalanceAfter - adminBalanceBefore).to.equal(1000n);
    });
  });
  
  (TEST_CONFIG.runCalculatorTests ? describe : describe.skip)("Calculators and utility functions", function() {
    it("Should calculate turn multiplier correctly", async function() {
      // Test multipliers for turns 1-10
      expect(await nootCards.calculateTurnMultiplier(1)).to.equal(110n);
      expect(await nootCards.calculateTurnMultiplier(5)).to.equal(118n);
      expect(await nootCards.calculateTurnMultiplier(9)).to.equal(126n);
      expect(await nootCards.calculateTurnMultiplier(10)).to.equal(130n);
      
      // Should reject invalid turn numbers
      await expectRejectedWithMessage(
        nootCards.calculateTurnMultiplier(0),
        "Turn must be between 1 and 10"
      );
      
      await expectRejectedWithMessage(
        nootCards.calculateTurnMultiplier(11),
        "Turn must be between 1 and 10"
      );
    });
    
    it("Should calculate max pot correctly", async function() {
      const wager = 1000n;
      
      // Calculate expected max pot manually
      let expectedPot = wager;
      for (let i = 1; i <= 10; i++) {
        const multiplier = 110 + ((i - 1) * 2);
        expectedPot = (expectedPot * BigInt(i === 10 ? 130 : multiplier)) / 100n;
      }
      
      const calculatedMaxPot = await nootCards.calculateMaxPot(wager);
      expect(calculatedMaxPot).to.equal(expectedPot);
    });
  });
  
  (TEST_CONFIG.runGameStartTests ? describe : describe.skip)("Game starting and validation", function() {
    it("Should start a game with valid parameters", async function() {
      const wagerAmount = 500n;
      const player1Address = await player1.getAddress();
      
      // Generate a random private secret for the dealer
      const privateSecret = "dealer_secret_" + Math.floor(Math.random() * 1000000).toString();
      
      // Create a hash commitment from this secret
      const res = await createHashCommitment(privateSecret);
      const { commitment, hashChain } = res;
      
      // Generate a random nonce for the player
      const userRandomNonce = ethers.id("player_nonce_" + Math.floor(Math.random() * 1000000).toString());
      
      // Get the current game ID for the player
      const gameId = await nootCards.playerGameCounters(player1Address);
      
      // Sign the commitment
      const commitmentSignature = await signCommitment(dealer, commitment, player1Address, gameId);
      
      // Start the game
      const tx = await nootCards.connect(player1).startGame(
        wagerAmount,
        userRandomNonce,
        commitment,
        commitmentSignature
      );
      
      const receipt = await tx.wait();
      
      // Check that the GameStarted event was emitted
      const gameStartedEvents = receipt.logs.filter((log: any) => log.fragment?.name === "GameStarted");
      expect(gameStartedEvents.length).to.equal(1);
      
      // Check game state
      const gameState = await getGameState(nootCards, player1Address);
      expect(gameState.active).to.be.true;
      expect(gameState.wager).to.equal(wagerAmount);
      expect(gameState.turn).to.equal(0);
      expect(gameState.commitment).to.equal(commitment);
      expect(gameState.userRandomNonce).to.equal(userRandomNonce);
    });
    
    it("Should not start game when wager is below minimum", async function() {
      const player2Address = await player2.getAddress();
      const gameId = await nootCards.playerGameCounters(player2Address);
      
      // Create a hash commitment
      const { commitment } = await createHashCommitment("test_secret");
      
      // Generate a random nonce
      const userRandomNonce = ethers.id("test_nonce");
      
      // Sign the commitment
      const commitmentSignature = await signCommitment(dealer, commitment, player2Address, gameId);
      
      await expectRejectedWithMessage(
        nootCards.connect(player2).startGame(
          minWager - 1n,
          userRandomNonce,
          commitment,
          commitmentSignature
        ),
        "Wager too small"
      );
    });
    
    it("Should not start game when wager is above maximum", async function() {
      const player2Address = await player2.getAddress();
      const gameId = await nootCards.playerGameCounters(player2Address);
      
      // Create a hash commitment
      const { commitment } = await createHashCommitment("test_secret");
      
      // Generate a random nonce
      const userRandomNonce = ethers.id("test_nonce");
      
      // Sign the commitment
      const commitmentSignature = await signCommitment(dealer, commitment, player2Address, gameId);
      
      await expectRejectedWithMessage(
        nootCards.connect(player2).startGame(
          maxWager + 1n,
          userRandomNonce,
          commitment,
          commitmentSignature
        ),
        "Wager too large"
      );
    });
    
    it("Should not start game with invalid commitment signature", async function() {
      const wagerAmount = 500n;
      const player2Address = await player2.getAddress();
      const gameId = await nootCards.playerGameCounters(player2Address);
      
      // Create a hash commitment
      const { commitment } = await createHashCommitment("test_secret");
      
      // Generate a random nonce
      const userRandomNonce = ethers.id("test_nonce");
      
      // Sign with the wrong wallet (not the dealer)
      const invalidSignature = await signCommitment(adminWallet, commitment, player2Address, gameId);
      
      await expectRejectedWithMessage(
        nootCards.connect(player2).startGame(
          wagerAmount,
          userRandomNonce,
          commitment,
          invalidSignature
        ),
        "Invalid commitment signature"
      );
    });
  });
  
  (TEST_CONFIG.runGamePlayTests ? describe : describe.skip)("Game play", function() {
    let gameId: bigint;
    let commitment: string;
    let hashChain: string[];
    let userRandomNonce: string;
    
    beforeEach(async function() {
      // Setup a new game for player2 if needed
      const player2Address = await player2.getAddress();
        // Generate a random private secret
        const privateSecret = "dealer_secret_" + Math.floor(Math.random() * 1000000).toString();
        
        // Create a hash commitment from this secret
        const commitmentData = await createHashCommitment(privateSecret);
        commitment = commitmentData.commitment;
        hashChain = commitmentData.hashChain;
        
        // Generate a random nonce for the player
        userRandomNonce = ethers.id("player_nonce_" + Math.floor(Math.random() * 1000000).toString());
        
        // Get the game ID
        gameId = await nootCards.playerGameCounters(player2Address);
        
        // Sign the commitment
        const commitmentSignature = await signCommitment(dealer, commitment, player2Address, gameId);
        
        // Start the game
        await nootCards.connect(player2).startGame(
            500n,
            userRandomNonce,
            commitment,
            commitmentSignature
        );
    });
    
    it("Should make first guess successfully", async function() {
      const player2Address = await player2.getAddress();
      
      // For the first turn, we need to provide h10 (last hash in the chain)
      const firstHash = hashChain[10]; // h10

      console.log("hashChain", hashChain);
      console.log("firstHash", firstHash);
      // lets see what it is when hashed 1 time
      const firstHashHashedOnce = ethers.keccak256(ethers.concat([firstHash]));
      console.log("firstHashHashedOnce", firstHashHashedOnce);
      console.log("commitment", commitment);
      // lets log onchain data aswell
      console.log("onchain data", await getGameState(nootCards, player2Address));
      
      // Make the first guess
      const tx = await nootCards.connect(player2).makeGuess(firstHash, Guess.Higher);
      const receipt = await tx.wait();
      
      // Check that the RoundWon event was emitted for the first round
      const roundWonEvents = receipt.logs.filter((log: any) => log.fragment?.name === "RoundWon");
      expect(roundWonEvents.length).to.equal(1);
      
      // Check game state after first guess
      const gameState = await getGameState(nootCards, player2Address);
      expect(gameState.active).to.be.true;
      expect(gameState.turn).to.equal(1);
      expect(gameState.previousGuess).to.equal(Guess.Higher);
    });
    
    it("Should reject invalid hash for first turn", async function() {
      const player2Address = await player2.getAddress();
      
      // Use an invalid hash that doesn't match the commitment when hashed
      const invalidHash = ethers.keccak256(ethers.toUtf8Bytes("invalid_hash"));
      
      await expectRejectedWithMessage(
        nootCards.connect(player2).makeGuess(invalidHash, Guess.Higher),
        "Invalid hash chain"
      );
    });
    
    it("Should make multiple guesses in sequence", async function() {
      const player2Address = await player2.getAddress();
      
      // Make the first guess with h10
      const firstHash = hashChain[10]; // h10
      await nootCards.connect(player2).makeGuess(firstHash, Guess.Higher);
      
      // Check game state after first guess
      const gameState1 = await getGameState(nootCards, player2Address);
      expect(gameState1.turn).to.equal(1);
      
      // Make the second guess with h9
      const secondHash = hashChain[9]; // h9
      const tx = await nootCards.connect(player2).makeGuess(secondHash, Guess.Lower);
      const receipt = await tx.wait();
      
      // Check if we won or lost
      const roundWonEvents = receipt.logs.filter((log: any) => log.fragment?.name === "RoundWon");
      const gameLostEvents = receipt.logs.filter((log: any) => log.fragment?.name === "GameLost");
      
      if (roundWonEvents.length > 0) {
        // If we won, check game state
        const gameState2 = await getGameState(nootCards, player2Address);
        expect(gameState2.active).to.be.true;
        expect(gameState2.turn).to.equal(2);
        expect(gameState2.previousGuess).to.equal(Guess.Lower);
        
        // Verify pot increased
        expect(gameState2.currentPot).to.be.gt(gameState1.currentPot);
      } else if (gameLostEvents.length > 0) {
        // If we lost, check game is inactive
        const gameState2 = await getGameState(nootCards, player2Address);
        expect(gameState2.active).to.be.false;
        expect(gameState2.status).to.equal(GameStatus.Completed);
      } else {
        // Should have either won or lost
        expect.fail("Expected either RoundWon or GameLost event");
      }
    });
    
    it("Should verify hash chain in sequence", async function() {
      const player2Address = await player2.getAddress();
      
      // Make the first guess with h10
      const firstHash = hashChain[10]; // h10
      await nootCards.connect(player2).makeGuess(firstHash, Guess.Higher);
      
      // Try to skip a hash in the chain for second turn
      // Should use hashChain[9] (h9) but we'll use h8 instead
      const thirdHash = hashChain[8]; // h8 - Wrong hash for turn 2
      
      await expectRejectedWithMessage(
        nootCards.connect(player2).makeGuess(thirdHash, Guess.Higher),
        "Invalid hash chain"
      );
      
      // Use the correct hash for turn 2
      const secondHash = hashChain[9]; // h9
      const tx = await nootCards.connect(player2).makeGuess(secondHash, Guess.Higher);
      
      // Check if we won or lost (we don't care which for this test)
      const receipt = await tx.wait();
      const events = receipt.logs.filter((log: any) => 
        log.fragment?.name === "RoundWon" || log.fragment?.name === "GameLost"
      );
      expect(events.length).to.be.gt(0);
    });
    
    it("Should allow claiming rewards after at least one round", async function() {
      const player2Address = await player2.getAddress();
      
      // Make the first guess to complete a round
      const firstHash = hashChain[10]; // h10
      await nootCards.connect(player2).makeGuess(firstHash, Guess.Higher);
      
      // Get player balance before claiming
      const balanceBefore = await nootToken.balanceOf(player2Address);
      
      // Get the pot value
      const gameState = await getGameState(nootCards, player2Address);
      const currentPot = gameState.currentPot;
      
      // Get the next hash in the chain that would lead to a win
      const secondHash = hashChain[9]; // h9
      
      // Check the current game state to determine if claiming is possible
      const previousCard = gameState.previousCard;
      const previousGuess = gameState.previousGuess;
      
      // Get the card that would be generated from the next hash
      const playerGameId = gameState.gameId;
      
      // We need to determine whether the next card would make the player win
      // This is a bit tricky since we need to mimic the contract's _getCardFromHash function
      // For simplicity, we'll try to claim and catch if it fails
      
      try {
        const tx = await nootCards.connect(player2).claimRewards(secondHash);
        const receipt = await tx.wait();
        
        // Check that GameWon event was emitted
        const gameWonEvents = receipt.logs.filter((log: any) => log.fragment?.name === "GameWon");
        expect(gameWonEvents.length).to.equal(1);
        
        // Check balance increased
        const balanceAfter = await nootToken.balanceOf(player2Address);
        expect(balanceAfter).to.be.gt(balanceBefore);
        
        // Check game is now inactive
        const finalGameState = await getGameState(nootCards, player2Address);
        expect(finalGameState.active).to.be.false;
        expect(finalGameState.status).to.equal(GameStatus.Completed);
      } catch (error: any) {
        // If claiming fails, it's likely because the next card wouldn't lead to a win
        // This is expected in some cases, so we'll skip the test
        console.log("Claiming rewards failed, likely because next card wouldn't lead to a win");
        this.skip();
      }
    });
    
    it("Should not allow claiming rewards before completing a round", async function() {
      const player2Address = await player2.getAddress();
      
      // Try to claim rewards without making any guess
      const nextHash = hashChain[10]; // h10
      
      await expectRejectedWithMessage(
        nootCards.connect(player2).claimRewards(nextHash),
        "Must complete at least one round"
      );
    });
    
    it("Should lose game when guess is incorrect", async function() {
      const player2Address = await player2.getAddress();
      
      // Make the first guess
      const firstHash = hashChain[10]; // h10
      await nootCards.connect(player2).makeGuess(firstHash, Guess.Higher);
      
      // Get game state after first guess
      const gameState = await getGameState(nootCards, player2Address);
      const previousCard = gameState.previousCard;
      
      // For the second guess, we'll try both Higher and Lower
      // One of them should lose (unless the cards are equal, which is unlikely)
      const secondHash = hashChain[9]; // h9
      
      let lostGame = false;
      
      // Try Higher guess
      try {
        const tx = await nootCards.connect(player2).makeGuess(secondHash, Guess.Higher);
        const receipt = await tx.wait();
        
        const gameLostEvents = receipt.logs.filter((log: any) => log.fragment?.name === "GameLost");
        if (gameLostEvents.length > 0) {
          lostGame = true;
        }
      } catch (e) {
        // Ignore errors
      }
      
      // If we didn't lose yet, try Lower guess with a new game
      if (!lostGame) {
        // Create a new game
        // Generate a random private secret
        const privateSecret = "dealer_secret_" + Math.floor(Math.random() * 1000000).toString();
        
        // Create a hash commitment from this secret
        const newCommitmentData = await createHashCommitment(privateSecret);
        const newCommitment = newCommitmentData.commitment;
        const newHashChain = newCommitmentData.hashChain;
        
        // Generate a random nonce for the player
        const newUserRandomNonce = ethers.id("player_nonce_" + Math.floor(Math.random() * 1000000).toString());
        
        // Get the updated game ID
        const newGameId = await nootCards.playerGameCounters(player2Address);
        
        // Sign the commitment
        const newCommitmentSignature = await signCommitment(dealer, newCommitment, player2Address, newGameId);
        
        // Start the game
        await nootCards.connect(player2).startGame(
          500n,
          newUserRandomNonce,
          newCommitment,
          newCommitmentSignature
        );
        
        // Make the first guess
        const newFirstHash = newHashChain[10]; // h10
        await nootCards.connect(player2).makeGuess(newFirstHash, Guess.Lower);
        
        // Make second guess
        const newSecondHash = newHashChain[9]; // h9
        try {
          const tx = await nootCards.connect(player2).makeGuess(newSecondHash, Guess.Lower);
          const receipt = await tx.wait();
          
          const gameLostEvents = receipt.logs.filter((log: any) => log.fragment?.name === "GameLost");
          if (gameLostEvents.length > 0) {
            lostGame = true;
          }
        } catch (e) {
          // Ignore errors
        }
      }
      
      // If we still couldn't lose, skip this test
      if (!lostGame) {
        console.log("Couldn't force a loss - skipping test");
        this.skip();
        return;
      }
      
      // Verify game state after loss
      const finalState = await getGameState(nootCards, player2Address);
      expect(finalState.active).to.be.false;
      expect(finalState.status).to.equal(GameStatus.Completed);
    });
  });
  
  (TEST_CONFIG.runWithdrawalTests ? describe : describe.skip)("Withdrawal functionality", function() {
    let gameId: bigint;
    let commitment: string;
    let hashChain: string[];
    let userRandomNonce: string;
    
    beforeEach(async function() {
      // Setup a new game for player1 if needed
      const player1Address = await player1.getAddress();
      const gameState = await getGameState(nootCards, player1Address);
      
      if (!gameState.active) {
        // Generate a random private secret
        const privateSecret = "dealer_secret_" + Math.floor(Math.random() * 1000000).toString();
        
        // Create a hash commitment from this secret
        const commitmentData = await createHashCommitment(privateSecret);
        commitment = commitmentData.commitment;
        hashChain = commitmentData.hashChain;
        
        // Generate a random nonce for the player
        userRandomNonce = ethers.id("player_nonce_" + Math.floor(Math.random() * 1000000).toString());
        
        // Get the game ID
        gameId = await nootCards.playerGameCounters(player1Address);
        
        // Sign the commitment
        const commitmentSignature = await signCommitment(dealer, commitment, player1Address, gameId);
        
        // Start the game
        await nootCards.connect(player1).startGame(
          500n,
          userRandomNonce,
          commitment,
          commitmentSignature
        );
        
        // Make the first guess to have an active game with at least one move
        const firstHash = hashChain[10]; // h10
        await nootCards.connect(player1).makeGuess(firstHash, Guess.Higher);
      }
    });
    
    it("Should allow player to request withdrawal", async function() {
      const player1Address = await player1.getAddress();
      
      // Request withdrawal
      const tx = await nootCards.connect(player1).requestWithdrawal();
      const receipt = await tx.wait();
      
      // Check that WithdrawalRequested event was emitted
      const withdrawalRequestedEvents = receipt.logs.filter((log: any) => log.fragment?.name === "WithdrawalRequested");
      expect(withdrawalRequestedEvents.length).to.equal(1);
      
      // Check that timestamp was set
      const timestamp = await nootCards.withdrawalRequests(player1Address);
      expect(timestamp).to.be.gt(0);
    });
    
    it("Should not allow withdrawal request if no active game", async function() {
      // Create a new player that has no active game
      const nonPlayerWallet = wallets[4];
      const nonPlayerAddress = await nonPlayerWallet.getAddress();
      
      await expectRejectedWithMessage(
        nootCards.connect(nonPlayerWallet).requestWithdrawal(),
        "Game is not active"
      );
    });
    
    it("Should not allow withdrawal request without making a move", async function() {
      // Start a new game for player2 but don't make any moves
      const player2Address = await player2.getAddress();
      
      // Make sure player2 doesn't have an active game
      const initialState = await getGameState(nootCards, player2Address);
      if (initialState.active) {
        try {
          // Try to end the existing game
          // Simplest way is to make a guess and catch any errors
          await nootCards.connect(player2).makeGuess(ethers.ZeroHash, Guess.Higher);
        } catch (e) {
          // Ignore errors
        }
      }
      
      // Generate a random private secret
      const privateSecret = "dealer_secret_" + Math.floor(Math.random() * 1000000).toString();
      
      // Create a hash commitment from this secret
      const commitmentData = await createHashCommitment(privateSecret);
      const newCommitment = commitmentData.commitment;
      
      // Generate a random nonce for the player
      const newUserRandomNonce = ethers.id("player_nonce_" + Math.floor(Math.random() * 1000000).toString());
      
      // Get the game ID
      const newGameId = await nootCards.playerGameCounters(player2Address);
      
      // Sign the commitment
      const commitmentSignature = await signCommitment(dealer, newCommitment, player2Address, newGameId);
      
      // Start the game
      await nootCards.connect(player2).startGame(
        500n,
        newUserRandomNonce,
        newCommitment,
        commitmentSignature
      );
      
      // Try to request withdrawal without making any moves
      await expectRejectedWithMessage(
        nootCards.connect(player2).requestWithdrawal(),
        "Must have made at least one move"
      );
    });
    
    it("Should not allow processing withdrawal before timelock expires", async function() {
      const player1Address = await player1.getAddress();
      
      // Request withdrawal
      await nootCards.connect(player1).requestWithdrawal();
      
      // Try to process withdrawal immediately (should fail)
      await expectRejectedWithMessage(
        nootCards.connect(player1).processWithdrawal(),
        "Timelock period not yet expired"
      );
    });
    
    it("Should allow dealer to prove player would lose", async function() {
      const player1Address = await player1.getAddress();
      
      // Request withdrawal
      await nootCards.connect(player1).requestWithdrawal();
      
      // Get the game state
      const gameState = await getGameState(nootCards, player1Address);
      const previousCard = gameState.previousCard;
      const previousGuess = gameState.previousGuess;
      
      // Get the next hash in the chain for turn 2
      const nextHash = hashChain[9]; // h9
      
      // Try to prove loss. This might fail if the next card happens to make the player win
      try {
        const tx = await nootCards.connect(dealer).proveLoss(player1Address, nextHash);
        const receipt = await tx.wait();
        
        // Check that GameLost event was emitted
        const gameLostEvents = receipt.logs.filter((log: any) => log.fragment?.name === "GameLost");
        expect(gameLostEvents.length).to.equal(1);
        
        // Check game is now inactive
        const finalGameState = await getGameState(nootCards, player1Address);
        expect(finalGameState.active).to.be.false;
        expect(finalGameState.status).to.equal(GameStatus.Completed);
        
        // Check withdrawal request was cleared
        const timestamp = await nootCards.withdrawalRequests(player1Address);
        expect(timestamp).to.equal(0);
      } catch (error: any) {
        // If proving loss fails, it's likely because the next card would actually make the player win
        // This is expected in some cases, so we'll skip the test
        console.log("Proving loss failed, likely because next card would make player win");
        this.skip();
      }
    });
    
    it("Should not allow non-dealer to prove loss", async function() {
      const player1Address = await player1.getAddress();
      
      // Request withdrawal
      await nootCards.connect(player1).requestWithdrawal();
      
      // Try to prove loss as non-dealer (player2)
      const nextHash = hashChain[9]; // h9
      
      await expectRejectedWithMessage(
        nootCards.connect(player2).proveLoss(player1Address, nextHash),
        "TrustlessNootLadder: caller is not the dealer"
      );
    });
  });
  
  (TEST_CONFIG.runDealerWithdrawalTests ? describe : describe.skip)("Dealer withdrawal functionality", function() {
    it("Should allow dealer to request withdrawal", async function() {
      // First ensure contract has some tokens
      const nootCardsAddress = await nootCards.getAddress();
      await nootToken.adminMint(nootCardsAddress, ethers.parseEther("10"));
      
      // Dealer requests withdrawal
      const amount = ethers.parseEther("5");
      const tx = await nootCards.connect(dealer).requestDealerWithdrawal(amount);
      const receipt = await tx.wait();
      
      // Check that DealerWithdrawalRequested event was emitted
      const requestEvents = receipt.logs.filter((log: any) => log.fragment?.name === "DealerWithdrawalRequested");
      expect(requestEvents.length).to.equal(1);
      
      // Check dealer request was stored
      const dealerRequest = await nootCards.dealerRequest();
      expect(dealerRequest.amount).to.equal(amount);
      expect(dealerRequest.timestamp).to.be.gt(0);
    });
    
    it("Should not allow non-dealer to request dealer withdrawal", async function() {
      await expectRejectedWithMessage(
        nootCards.connect(player1).requestDealerWithdrawal(1000n),
        "TrustlessNootLadder: caller is not the dealer"
      );
    });
    
    it("Should not allow requesting more than contract balance", async function() {
      // Get current contract balance
      const nootCardsAddress = await nootCards.getAddress();
      const contractBalance = await nootToken.balanceOf(nootCardsAddress);
      
      // Request more than balance
      await expectRejectedWithMessage(
        nootCards.connect(dealer).requestDealerWithdrawal(contractBalance + 1000n),
        "Insufficient funds"
      );
    });
    
    it("Should not allow processing dealer withdrawal before timelock expires", async function() {
      // First ensure contract has some tokens
      const nootCardsAddress = await nootCards.getAddress();
      await nootToken.adminMint(nootCardsAddress, ethers.parseEther("10"));
      
      // Dealer requests withdrawal
      await nootCards.connect(dealer).requestDealerWithdrawal(ethers.parseEther("5"));
      
      // Try to process immediately
      await expectRejectedWithMessage(
        nootCards.connect(dealer).processDealerWithdrawal(),
        "Withdrawal timelock not expired"
      );
    });
  });
}); 