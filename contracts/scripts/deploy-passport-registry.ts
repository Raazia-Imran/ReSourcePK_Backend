import { network } from "hardhat";

const { ethers } = await network.create({ network: "amoy" });

async function main() {
  console.log("Deploying PassportRegistry to Polygon Amoy...");

  const registry = await ethers.deployContract("PassportRegistry");

  await registry.waitForDeployment();

  const contractAddress = await registry.getAddress();
  const writerAddress = await registry.writer();

  console.log("-----------------------------------");
  console.log("Deployment successful!");
  console.log("Contract address:", contractAddress);
  console.log("Writer address:", writerAddress);
  console.log("-----------------------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});