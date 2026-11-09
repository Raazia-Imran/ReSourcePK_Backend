// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PassportRegistry {
    address public writer;
    mapping(bytes32 => bytes32) private hashes;

    event Anchored(bytes32 indexed key, bytes32 hash);

    constructor() {
        writer = msg.sender;
    }

    function anchor(bytes32 key, bytes32 hash) external {
        require(msg.sender == writer, "not writer");
        require(hashes[key] == bytes32(0), "already anchored");

        hashes[key] = hash;

        emit Anchored(key, hash);
    }

    function get(bytes32 key) external view returns (bytes32) {
        return hashes[key];
    }
}
