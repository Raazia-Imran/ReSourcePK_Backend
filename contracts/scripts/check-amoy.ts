import { network } from "hardhat";

const { ethers } = await network.create({ network: "amoy" });

console.log("Connected to Polygon Amoy");
console.log("Network:", await ethers.provider.getNetwork());
console.log("Wallet:", (await ethers.getSigners())[0].address);
console.log(
  "Balance:",
  await ethers.provider.getBalance((await ethers.getSigners())[0].address),
);
