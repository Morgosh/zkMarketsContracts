export function generatePrivateKeyWithSalt(salt: string): string {
    const allowedChars = "0123456789abcdef";
    let privateKey = "";
    let seed = 0;
  
    // Calculate seed from salt
    for (const char of salt) {
      seed += char.charCodeAt(0);
    }
  
    // Generate private key
    for (let i = 0; i < 64; i++) {
      const randomIndex = (seed * (i + 1) + i) % allowedChars.length;
      privateKey += allowedChars[randomIndex];
    }
  
    return privateKey;
  }
  