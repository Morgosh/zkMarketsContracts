import { ethers } from 'ethers';
import contractAbi from '../../src/contract/abis/NootCards.abi.json';
import { NOOTCARDS_CONTRACT_ADDRESS, RPC_URL, WS_URL } from '../../src/contract/utils/consts';

// DEALER_SECRET should be stored in environment variables on server
// This is the private secret used to generate the hash chain
const DEALER_SECRET_PREFIX = process.env.DEALER_SECRET_PREFIX || 'dealer_secret_';

// Create a provider to connect to the blockchain
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Create contract instance to read game state
const contract = new ethers.Contract(NOOTCARDS_CONTRACT_ADDRESS, contractAbi, provider);

// Dealer wallet for signing commitments
const DEALER_PRIVATE_KEY = process.env.DEALER_PRIVATE_KEY || '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const dealerWallet = new ethers.Wallet(DEALER_PRIVATE_KEY, provider);

// Helper function to create a hash commitment for a game
async function createHashCommitment(playerAddress, gameId) {
  // Create a unique secret for this player and game
  const privateSecret = `${DEALER_SECRET_PREFIX}${playerAddress}_${gameId}`;
  
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
  
  return {
    privateSecret,
    hashChain,    // [h0, h1, h2, h3, h4, h5, h6, h7, h8, h9, h10]
    commitment    // Derived from h10 but NOT included in hashChain
  };
}

// Helper to sign a commitment
async function signCommitment(commitment, playerAddress, gameId) {
  // Create message hash
  const messageToSign = ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "address", "uint256"],
      [commitment, playerAddress, gameId]
    )
  );
  
  // Sign the message
  const signature = await dealerWallet.signMessage(ethers.getBytes(messageToSign));
  return signature;
}

export default async function handler(req, res) {
  // Only allow POST requests for security
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let eventListener = null;
  let responded = false;
  let wsProvider = null;
  let wsContract = null;

  // Function to ensure we only respond once
  const safeResponse = async (statusCode, data) => {
    if (!responded) {
      responded = true;
      
      // Return response
      res.status(statusCode).json(data);

      // Remove event listeners
      if (eventListener && wsContract) {
        try {
          // lets sleep a bit to handle this error: WebSocket was closed before the connection was established
          await new Promise(resolve => setTimeout(resolve, 1000));
          wsContract.removeAllListeners();
          wsContract.runner?.websocket?.close();
        } catch (e) {
          console.error('Error removing event listener:', e);
        }
      }
    }
  };

  try {
    let { playerAddress, turn, waitForEvent, requestType } = req.body;
    console.log("playerAddress", playerAddress, "turn", turn, "waitForEvent", waitForEvent, "requestType", requestType);
    let waitForRoundEnd;

    // Input validation
    if (!playerAddress || !ethers.isAddress(playerAddress)) {
      return await safeResponse(400, { error: 'Valid player address is required' });
    }

    // Setup WebSocket event listening if needed
    if(waitForEvent) {
      try {
        // Initialize WebSocket provider
        wsProvider = new ethers.WebSocketProvider(WS_URL);
        wsContract = new ethers.Contract(NOOTCARDS_CONTRACT_ADDRESS, contractAbi, wsProvider);
        
        // Set up error handler for WebSocket provider
        wsProvider.on('error', (error) => {
          console.error('WebSocket provider error:', error.message);
        });
        
        waitForRoundEnd = new Promise((resolve, reject) => {
          try {
            // Set up event listener for relevant events
            eventListener = (eventRes) => {       
              try {
                if(turn === 0 && requestType === 'startGame') {
                  //event GameStarted(address indexed player, uint256 wager, uint256 gameId);
                  const [player, wager, gameId] = eventRes.args;
                  resolve({
                    player: player,
                    wager: Number(wager),
                    gameId: Number(gameId)
                  });
                } else {
                  //event GuessMade(address indexed player, Card previousCard, Card newCard, Guess guess, uint8 turn);
                  const [player, previousCard, newCard, guess, currentTurn] = eventRes.args;
                  resolve({
                    player,
                    previousCard: Number(previousCard),
                    newCard: Number(newCard),
                    guess: Number(guess),
                    turn: Number(currentTurn)
                  });
                }
              } catch (eventError) {
                reject(eventError);
              }
            };
            
            // Safely subscribe to event
            try {
              const eventFilter = turn === 0 && requestType === 'startGame' 
                ? wsContract.filters.GameStarted(playerAddress) 
                : wsContract.filters.GuessMade(playerAddress);
              wsContract.on(eventFilter, eventListener);
            } catch (subError) {
              console.error('Error subscribing to event:', subError.message);
              reject(subError);
            }
          } catch (setupError) {
            console.error('Error setting up event listener:', setupError.message);
            reject(setupError);
          }
        });

        // Add explicit catch to handle Promise rejection
        waitForRoundEnd.catch(error => {
          console.error('Event listener error caught:', error.message);
          // If we haven't responded yet, we'll handle this in the main try/catch
        });
        
      } catch (wsError) {
        console.error('WebSocket setup error:', wsError.message);
        // Continue without WebSocket functionality
        waitForEvent = false;
      }
    }

    // Get game state from the contract
    const gameState = await contract.getGameState(playerAddress);
    const localContractState = {
      status: Number(gameState[0]),
      wager: Number(gameState[1]),
      currentPot: Number(gameState[2]),
      currentCard: Number(gameState[3]),
      currentGuess: Number(gameState[4]),
      turn: Number(gameState[5]),
      gameId: Number(gameState[6]),
      commitment: gameState[7],
      userRandomNonce: gameState[8],
      paymentType: Number(gameState[9]),
      active: Number(gameState[0]) === 0  // 0 = Active in GameStatus enum
    };
    
    // Handle different request types
    if (requestType === 'startGame') {
      // Generate new commitment and hash chain for a new game
      const gameId = await contract.playerGameCounters(playerAddress);
      const { commitment, hashChain } = await createHashCommitment(playerAddress, gameId);
      
      // Sign the commitment
      const signature = await signCommitment(commitment, playerAddress, gameId);
      
      return await safeResponse(200, {
        commitment,
        signature,
        gameId: gameId.toString(),
        // Include only h0-h10 hash chain, not the commitment
        hashChain
      });
    } else if (requestType === 'makeGuess' || requestType === 'claimRewards') {
      // If user is trying to make a guess or claim rewards, provide the next hash in the chain
      
      if (!localContractState.active) {
        return await safeResponse(400, { error: 'No active game found' });
      }
      
      // Recreate the hash chain for this game
      const { hashChain } = await createHashCommitment(playerAddress, localContractState.gameId);
      
      // For the first turn, we reveal h10
      // For subsequent turns, we go backwards: h9, h8, etc.
      const currentTurn = localContractState.turn;
      const hashToReveal = hashChain[10 - currentTurn];
      
      if (waitForEvent) {
        try {
          // Wait for the event with a timeout
          const eventResult = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timeout waiting for event')), 10000);
            waitForRoundEnd.then(resolve).catch(reject).finally(() => clearTimeout(timer));
          });
          
          // Update local state based on event result
          localContractState.currentCard = eventResult.newCard;
          localContractState.turn = eventResult.turn;
        } catch (eventError) {
          console.error('Event error caught:', eventError.message);
          return await safeResponse(408, { 
            error: 'Event timeout', 
            message: 'Timed out waiting for event'
          });
        }
      }
      
      return await safeResponse(200, {
        hashToReveal,
        gameId: localContractState.gameId.toString(),
        turn: localContractState.turn,
        currentCard: localContractState.currentCard,
        contractState: localContractState
      });
    }
    
    // Default response for unknown request types
    return await safeResponse(400, { error: 'Invalid request type' });

  } catch (error) {
    console.error('Error handling request:', error);
    return await safeResponse(500, { 
      error: 'Internal server error',
      message: error.message
    });
  }
} 