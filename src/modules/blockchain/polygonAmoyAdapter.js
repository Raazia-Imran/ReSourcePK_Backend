
// const { JsonRpcProvider, Wallet, Contract } = require("ethers");

// const AMOY_CHAIN_ID = 80002;

// const ABI = [
//   "function anchor(bytes32 key, bytes32 hash) external",
//   "function get(bytes32 key) external view returns (bytes32)",
// ];

// class PolygonAmoyAdapter {
//   constructor({ rpcUrl, privateKey, contractAddress }) {
//     if (!rpcUrl || !privateKey || !contractAddress) {
//       throw new Error("Polygon Amoy configuration is incomplete");
//     }

//     this.provider = new JsonRpcProvider(rpcUrl, AMOY_CHAIN_ID);
//     this.wallet = new Wallet(privateKey, this.provider);
//     this.contract = new Contract(contractAddress, ABI, this.wallet);
//   }

//   validateBytes32(value, fieldName) {
//     if (
//       typeof value !== "string" ||
//       !/^0x[0-9a-fA-F]{64}$/.test(value)
//     ) {
//       throw new TypeError(`${fieldName} must be a valid bytes32 value`);
//     }
//   }

//   async get(key) {
//     this.validateBytes32(key, "key");
//     return this.contract.get(key);
//   }

//   async anchor(key, hash) {
//     this.validateBytes32(key, "key");
//     this.validateBytes32(hash, "hash");

//     const tx = await this.contract.anchor(key, hash);
//     const receipt = await tx.wait();

//     if (!receipt || receipt.status !== 1) {
//       throw new Error("Polygon Amoy anchor transaction failed");
//     }

//     return tx.hash;
//   }
// }

// module.exports = { PolygonAmoyAdapter };



// const { JsonRpcProvider, Wallet, Contract } = require("ethers");

// const AMOY_CHAIN_ID = 80002;

// const ABI = [
//   "function anchor(bytes32 key, bytes32 hash) external",
//   "function get(bytes32 key) external view returns (bytes32)",
// ];

// class PolygonAmoyAdapter {
//   constructor({ rpcUrl, privateKey, contractAddress }) {
//     if (!rpcUrl || !privateKey || !contractAddress) {
//       throw new Error("Polygon Amoy configuration is incomplete");
//     }

//     this.provider = new JsonRpcProvider(rpcUrl, AMOY_CHAIN_ID);
//     this.wallet = new Wallet(privateKey, this.provider);
//     this.contract = new Contract(contractAddress, ABI, this.wallet);
//   }

//   validateBytes32(value, fieldName) {
//     if (
//       typeof value !== "string" ||
//       !/^0x[0-9a-fA-F]{64}$/.test(value)
//     ) {
//       throw new TypeError(`${fieldName} must be a valid bytes32 value`);
//     }
//   }

//   async get(key) {
//     this.validateBytes32(key, "key");
//     return this.contract.get(key);
//   }

//   async anchor(key, hash) {
//     this.validateBytes32(key, "key");
//     this.validateBytes32(hash, "hash");

//     const tx = await this.contract.anchor(key, hash);
//     const receipt = await tx.wait();

//     if (!receipt || receipt.status !== 1) {
//       throw new Error("Polygon Amoy anchor transaction failed");
//     }

//     return tx.hash;
//   }
// }

// module.exports = { PolygonAmoyAdapter };

const { JsonRpcProvider, Wallet, Contract } = require("ethers");

const AMOY_CHAIN_ID = 80002;

const ABI = [
  "function anchor(bytes32 key, bytes32 hash) external",
  "function get(bytes32 key) external view returns (bytes32)",
];

class PolygonAmoyAdapter {
  constructor({ rpcUrl, privateKey, contractAddress }) {
    if (!rpcUrl || !contractAddress) {
      throw new Error("Polygon Amoy configuration is incomplete");
    }

    this.provider = new JsonRpcProvider(rpcUrl, AMOY_CHAIN_ID);

    // A wallet is optional for read-only verification.
    this.wallet = privateKey
      ? new Wallet(privateKey, this.provider)
      : null;

    this.contract = new Contract(
      contractAddress,
      ABI,
      this.wallet || this.provider,
    );
  }

  validateBytes32(value, fieldName) {
    if (
      typeof value !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(value)
    ) {
      throw new TypeError(`${fieldName} must be a valid bytes32 value`);
    }
  }

  async get(key) {
    this.validateBytes32(key, "key");
    return this.contract.get(key);
  }

  async anchor(key, hash) {
    if (!this.wallet) {
      throw new Error("A wallet is required to write blockchain anchors");
    }

    this.validateBytes32(key, "key");
    this.validateBytes32(hash, "hash");

    const tx = await this.contract.anchor(key, hash);
    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error("Polygon Amoy anchor transaction failed");
    }

    return tx.hash;
  }
}

module.exports = { PolygonAmoyAdapter };