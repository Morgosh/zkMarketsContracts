// lets define getter functions
import { ethers } from "ethers"

// Card enum mapping
export enum Card {
  Two = 0,
  Three = 1,
  Four = 2,
  Five = 3,
  Six = 4,
  Seven = 5,
  Eight = 6,
  Nine = 7,
  Ten = 8,
  Jack = 9,
  Queen = 10,
  King = 11,
  Ace = 12
}

// Guess enum mapping
export enum Guess {
  Higher = 0,
  Lower = 1
}

// Get card name from value
export function getCardName(cardValue: number): string {
  const cardNames = ["Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Jack", "Queen", "King", "Ace"];
  return cardNames[cardValue];
}

// Get contract settings
export async function getContractSettings(contract: ethers.Contract) {
  const admin = await contract.admin();
  const nootToken = await contract.nootToken();
  const mockRandomProvider = await contract.mockRandomProvider();
  const minWager = await contract.minWager();
  const maxWager = await contract.maxWager();
  const maxTurns = await contract.maxTurns();
  const multiplier = await contract.multiplier();

  return {
    admin,
    nootToken,
    randomProvider: mockRandomProvider, // Keep the property name for backward compatibility
    minWager,
    maxWager,
    maxTurns,
    multiplier: Number(multiplier) / 100 // Convert to decimal representation
  };
}

// Get current game state for a player
export async function getGameState(contract: ethers.Contract) {
  // Call the contract's getGameState function
  const result = await contract.getGameState();

  // Parse the returned values
  return {
    active: result[0],
    wager: result[1],
    currentPot: result[2],
    currentCard: result[3],
    currentCardName: getCardName(Number(result[3])),
    turnsLeft: Number(result[4]),
    totalTurns: Number(result[5])
  };
}

// Calculate potential win amount based on current pot and remaining turns
export function calculatePotentialWin(currentPot: ethers.BigNumberish, multiplier: number, remainingTurns: number): ethers.BigNumberish {
  let pot = ethers.parseUnits(currentPot.toString(), 0);
  const multiplierBN = ethers.parseUnits((multiplier * 100).toString(), 0);
  
  for (let i = 0; i < remainingTurns; i++) {
    pot = (pot * multiplierBN) / ethers.parseUnits("100", 0);
  }
  
  return pot;
}

// Format card comparison for display
export function formatCardComparison(previousCard: number, newCard: number, guess: Guess): string {
  const previousCardName = getCardName(previousCard);
  const newCardName = getCardName(newCard);
  const guessName = guess === Guess.Higher ? "higher" : "lower";
  const result = previousCard < newCard ? "higher" : previousCard > newCard ? "lower" : "same";
  const won = guessName === result;
  
  return `Previous card: ${previousCardName}, New card: ${newCardName}, Guess: ${guessName}, Result: ${result}, Won: ${won}`;
}