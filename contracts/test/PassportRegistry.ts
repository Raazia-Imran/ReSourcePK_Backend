import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("PassportRegistry", function () {
  it("should allow the writer to anchor a hash and retrieve it", async function () {
    const registry = await ethers.deployContract("PassportRegistry");

    const key = ethers.id("passport-001:version-1");
    const hash = ethers.id("passport-data-hash");

    await registry.anchor(key, hash);

    expect(await registry.get(key)).to.equal(hash);
  });

  it("should reject an unauthorized wallet", async function () {
    const registry = await ethers.deployContract("PassportRegistry");

    const signers = await ethers.getSigners();
    const otherWallet = signers[1];

    const key = ethers.id("passport-002:version-1");
    const hash = ethers.id("passport-data-hash");

    await expect(
      registry.connect(otherWallet).anchor(key, hash),
    ).to.be.revertedWith("not writer");
  });

  it("should reject anchoring the same key twice", async function () {
    const registry = await ethers.deployContract("PassportRegistry");

    const key = ethers.id("passport-003:version-1");
    const firstHash = ethers.id("first-passport-hash");
    const secondHash = ethers.id("second-passport-hash");

    await registry.anchor(key, firstHash);

    await expect(registry.anchor(key, secondHash)).to.be.revertedWith(
      "already anchored",
    );
  });

  it("should return zero bytes32 for an unknown key", async function () {
    const registry = await ethers.deployContract("PassportRegistry");

    const unknownKey = ethers.id("unknown-passport:version-1");

    expect(await registry.get(unknownKey)).to.equal(ethers.ZeroHash);
  });
});
