// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev The two TIP-20 calls the escrow needs (Tempo's stablecoin token standard).
interface ITIP20 {
    function transferWithMemo(address to, uint256 amount, bytes32 memo) external;
    function transferFromWithMemo(address from, address to, uint256 amount, bytes32 memo) external returns (bool);
}

/// @title ClaimEscrow — pay prize winners by link, only after their paperwork is cleared.
/// @notice One escrow per organizer. Each award is funded once, cleared once, and settles once:
///         either claimed by the holder of its claim link, or reclaimed by the organizer after expiry.
///         Every payout is a TIP-20 transfer carrying the award's 32-byte memo.
contract ClaimEscrow {
    enum Status { None, Funded, Cleared, Claimed, Expired, Reclaimed }

    struct Award {
        address token;       // slot 0 (20 bytes)
        uint96 amount;       // slot 0 (12 bytes)
        address claimSigner; // slot 1 (20 bytes) — address of the one-time key inside the claim link
        uint64 expiresAt;    // slot 1 (8 bytes)
        Status status;       // slot 1 (1 byte)
        bytes32 memo;        // slot 2
    }

    address public immutable organizer;
    mapping(bytes32 => Award) private awards;

    event Funded(bytes32 indexed id, address indexed token, uint256 amount, uint64 expiresAt, address claimSigner, bytes32 memo);
    event Cleared(bytes32 indexed id, bytes32 paperworkHash);
    event Claimed(bytes32 indexed id, address indexed recipient, uint256 amount, bytes32 memo);
    event Reclaimed(bytes32 indexed id, uint256 amount, bytes32 memo);

    error NotOrganizer();
    error AlreadyExists();
    error UnknownAward();
    error NotCleared();
    error AlreadySettled();
    error Expired();
    error NotExpired();
    error BadClaimSignature();
    error InvalidAward();

    modifier onlyOrganizer() {
        if (msg.sender != organizer) revert NotOrganizer();
        _;
    }

    constructor() {
        organizer = msg.sender;
    }

    /// @notice Lock `amount` of `token` for one award. Pulls from the organizer with the award memo.
    function fund(bytes32 id, address token, uint96 amount, uint64 expiresAt, address claimSigner, bytes32 memo)
        external
        onlyOrganizer
    {
        if (awards[id].status != Status.None) revert AlreadyExists();
        if (token == address(0) || amount == 0 || claimSigner == address(0) || expiresAt <= block.timestamp) {
            revert InvalidAward();
        }
        awards[id] = Award(token, amount, claimSigner, expiresAt, Status.Funded, memo);
        ITIP20(token).transferFromWithMemo(msg.sender, address(this), amount, memo);
        emit Funded(id, token, amount, expiresAt, claimSigner, memo);
    }

    /// @notice The organizer states that this award's paperwork (tax form, identity check, acceptance) is complete.
    /// @param paperworkHash hash of the organizer's paperwork record — the record itself stays off-chain.
    function clear(bytes32 id, bytes32 paperworkHash) external onlyOrganizer {
        Award storage a = awards[id];
        if (a.status == Status.None) revert UnknownAward();
        if (a.status != Status.Funded) revert AlreadySettled();
        if (block.timestamp >= a.expiresAt) revert Expired();
        a.status = Status.Cleared;
        emit Cleared(id, paperworkHash);
    }

    /// @notice Pay a cleared award to `recipient`. Anyone may submit; only the claim link's key can choose the recipient.
    function claim(bytes32 id, address recipient, bytes calldata signature) external {
        Award storage a = awards[id];
        if (a.status == Status.None) revert UnknownAward();
        if (a.status == Status.Claimed || a.status == Status.Reclaimed) revert AlreadySettled();
        if (block.timestamp >= a.expiresAt) revert Expired();
        if (a.status != Status.Cleared) revert NotCleared();
        if (recipient == address(0) || _recover(claimDigest(id, recipient), signature) != a.claimSigner) {
            revert BadClaimSignature();
        }
        a.status = Status.Claimed;
        ITIP20(a.token).transferWithMemo(recipient, a.amount, a.memo);
        emit Claimed(id, recipient, a.amount, a.memo);
    }

    /// @notice After expiry, return an unclaimed award to the organizer (with its memo).
    function reclaim(bytes32 id) external onlyOrganizer {
        Award storage a = awards[id];
        if (a.status == Status.None) revert UnknownAward();
        if (a.status == Status.Claimed || a.status == Status.Reclaimed) revert AlreadySettled();
        if (block.timestamp < a.expiresAt) revert NotExpired();
        a.status = Status.Reclaimed;
        ITIP20(a.token).transferWithMemo(organizer, a.amount, a.memo);
        emit Reclaimed(id, a.amount, a.memo);
    }

    /// @notice Effective status: Funded/Cleared awards past expiry read as Expired.
    function statusOf(bytes32 id) external view returns (Status) {
        Award storage a = awards[id];
        if ((a.status == Status.Funded || a.status == Status.Cleared) && block.timestamp >= a.expiresAt) {
            return Status.Expired;
        }
        return a.status;
    }

    function awardOf(bytes32 id) external view returns (Award memory) {
        return awards[id];
    }

    /// @notice What the claim key signs (EIP-191 personal_sign over this escrow, chain, award and recipient).
    function claimDigest(bytes32 id, address recipient) public view returns (bytes32) {
        bytes32 inner = keccak256(abi.encode(address(this), block.chainid, id, recipient));
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        // reject malleable signatures (upper half s)
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
