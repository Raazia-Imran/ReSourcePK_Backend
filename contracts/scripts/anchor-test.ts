import { network } from "hardhat";

const { ethers } = await network.create({ network: "amoy" });

async function main() {
  const address = process.env.PASSPORT_CONTRACT_ADDRESS;

  if (!address) {
    throw new Error("PASSPORT_CONTRACT_ADDRESS is missing from .env");
  }

  const registry = await ethers.getContractAt(
    "PassportRegistry",
    address
  );

  // Dummy data only — no real passport information.
  const key = ethers.id("rethread-demo-passport:version-1");
  const expectedHash = ethers.id("rethread-demo-content-hash-v1");

  console.log("Anchoring dummy passport hash...");

  const transaction = await registry.anchor(key, expectedHash);

  console.log("Transaction submitted:", transaction.hash);

  const receipt = await transaction.wait();

  console.log("Transaction status:", receipt?.status);
  console.log("Block number:", receipt?.blockNumber);

  const storedHash = await registry.get(key);

  console.log("Expected hash:", expectedHash);
  console.log("Retrieved hash:", storedHash);

  if (storedHash !== expectedHash) {
    throw new Error("Hash verification failed!");
  }

  console.log("SUCCESS: Hash anchored and retrieved correctly!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});