// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Stand-in for Tempo's signature-verifier precompile (0x5165…) in plain-EVM tests: secp256k1 over the raw hash.
contract MockSignatureVerifier {
    function recover(bytes32 hash, bytes calldata sig) external pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        return ecrecover(hash, v, r, s);
    }
}
