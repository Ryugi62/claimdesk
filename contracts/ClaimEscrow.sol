// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev The two TIP-20 calls the escrow needs (Tempo's stablecoin token standard).
interface ITIP20 {
    function transferWithMemo(address to, uint256 amount, bytes32 memo) external;
    function transferFromWithMemo(address from, address to, uint256 amount, bytes32 memo) external returns (bool);
}

/// @title ClaimEscrow — pay prize winners by link, only after their paperwork is cleared.
/// @notice Each award is locked up front (the winner can see it), and settles exactly once:
///         - path A (default): the winner opens the link early and registers an account; the organizer's
///           clearance of that winner's paperwork pays that exact account in the same transaction;
///         - path B: no account registered → clearance opens a bearer claim for the link holder;
///         - or the organizer revokes it before clearance, or reclaims it after expiry.
///         The award id is its 32-byte reference and rides on every TIP-20 transfer as the memo.
contract ClaimEscrow {
    enum Status { None, Funded, Cleared, Claimed, Expired, Reclaimed, Revoked }

    struct Award {
        address token;       // slot 0
        uint96 amount;       // slot 0
        address claimSigner; // slot 1 — address of the one-time key inside the claim link
        uint64 expiresAt;    // slot 1
        Status status;       // slot 1
        address recipient;   // slot 2 — written only when the winner registers (path A)
    }

    uint64 public constant MAX_TTL = 366 days;

    address public organizer;
    address public pendingOrganizer;
    mapping(bytes32 => Award) private awards;

    event Funded(bytes32 indexed id, address indexed token, uint256 amount, uint64 expiresAt, address claimSigner);
    event Registered(bytes32 indexed id, address indexed recipient);
    event Cleared(bytes32 indexed id, bytes32 paperworkHash, address recipient);
    event Claimed(bytes32 indexed id, address indexed recipient, uint256 amount, bytes32 memo);
    event Revoked(bytes32 indexed id, uint256 amount);
    event Reclaimed(bytes32 indexed id, uint256 amount, bytes32 memo);
    event SignerRotated(bytes32 indexed id, address claimSigner);
    event OrganizerProposed(address indexed next);
    event OrganizerChanged(address indexed previous, address indexed next);

    error NotOrganizer();
    error AlreadyExists();
    error UnknownAward();
    error NotCleared();
    error AlreadyCleared();
    error AlreadySettled();
    error Expired();
    error NotExpired();
    error BadClaimSignature();
    error InvalidAward();
    error TransferFailed();

    modifier onlyOrganizer() {
        if (msg.sender != organizer) revert NotOrganizer();
        _;
    }

    constructor(address organizer_) {
        organizer = organizer_ == address(0) ? msg.sender : organizer_;
        emit OrganizerChanged(address(0), organizer);
    }

    // ------------------------------------------------------------------ organizer

    /// @notice Lock `amount` of `token` for one award, pulled from the organizer with the award id as memo.
    function fund(bytes32 id, address token, uint96 amount, uint64 expiresAt, address claimSigner) external onlyOrganizer {
        if (awards[id].status != Status.None) revert AlreadyExists();
        if (
            id == bytes32(0) || token == address(0) || amount == 0 || claimSigner == address(0)
                || expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_TTL
        ) revert InvalidAward();
        awards[id] = Award(token, amount, claimSigner, expiresAt, Status.Funded, address(0));
        if (!ITIP20(token).transferFromWithMemo(msg.sender, address(this), amount, id)) revert TransferFailed();
        emit Funded(id, token, amount, expiresAt, claimSigner);
    }

    /// @notice The organizer states this award's paperwork (tax form, identity check, acceptance) is complete.
    ///         If the winner registered an account, that account is paid now; otherwise a bearer claim opens.
    /// @param paperworkHash hash of the organizer's paperwork record — the record stays off-chain.
    function clear(bytes32 id, bytes32 paperworkHash) external onlyOrganizer {
        Award storage a = _live(id);
        if (a.status != Status.Funded) revert AlreadyCleared();
        emit Cleared(id, paperworkHash, a.recipient);
        if (a.recipient != address(0)) {
            _pay(id, a, a.recipient);
        } else {
            a.status = Status.Cleared;
        }
    }

    /// @notice Cancel an award before its paperwork is cleared (e.g. failed due diligence). Funds return now.
    ///         After clearance the award can no longer be withdrawn by the organizer — that is the commitment.
    function revoke(bytes32 id) external onlyOrganizer {
        Award storage a = _known(id);
        if (a.status == Status.Cleared) revert AlreadyCleared();
        if (a.status != Status.Funded) revert AlreadySettled();
        a.status = Status.Revoked;
        ITIP20(a.token).transferWithMemo(organizer, a.amount, id);
        emit Revoked(id, a.amount);
    }

    /// @notice Replace the claim key of a leaked or lost link (before the award settles).
    function rotateSigner(bytes32 id, address newSigner) external onlyOrganizer {
        Award storage a = _known(id);
        if (a.status != Status.Funded && a.status != Status.Cleared) revert AlreadySettled();
        if (newSigner == address(0)) revert InvalidAward();
        a.claimSigner = newSigner;
        emit SignerRotated(id, newSigner);
    }

    /// @notice After expiry, return an unsettled award to the organizer (with its memo).
    function reclaim(bytes32 id) external onlyOrganizer {
        Award storage a = _known(id);
        if (a.status != Status.Funded && a.status != Status.Cleared) revert AlreadySettled();
        if (block.timestamp < a.expiresAt) revert NotExpired();
        a.status = Status.Reclaimed;
        ITIP20(a.token).transferWithMemo(organizer, a.amount, id);
        emit Reclaimed(id, a.amount, id);
    }

    function proposeOrganizer(address next) external onlyOrganizer {
        pendingOrganizer = next;
        emit OrganizerProposed(next);
    }

    function acceptOrganizer() external {
        if (msg.sender != pendingOrganizer || msg.sender == address(0)) revert NotOrganizer();
        emit OrganizerChanged(organizer, msg.sender);
        organizer = msg.sender;
        pendingOrganizer = address(0);
    }

    // ------------------------------------------------------------------ winner (anyone may submit; the link's key decides)

    /// @notice Path A: the link holder names the account to be paid when paperwork clears. Changeable until then.
    function register(bytes32 id, address recipient, bytes calldata signature) external {
        Award storage a = _live(id);
        if (a.status != Status.Funded) revert AlreadyCleared();
        if (recipient == address(0) || _recover(registerDigest(id, recipient), signature) != a.claimSigner) {
            revert BadClaimSignature();
        }
        a.recipient = recipient;
        emit Registered(id, recipient);
    }

    /// @notice Path B: pay a cleared award that had no registered account to the recipient the link's key signed for.
    function claim(bytes32 id, address recipient, bytes calldata signature) external {
        Award storage a = _live(id);
        if (a.status != Status.Cleared) revert NotCleared();
        if (recipient == address(0) || _recover(claimDigest(id, recipient), signature) != a.claimSigner) {
            revert BadClaimSignature();
        }
        _pay(id, a, recipient);
    }

    // ------------------------------------------------------------------ views

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

    /// @notice What the claim key signs to pay `recipient` (EIP-191 over a domain tag, this escrow, chain, award, recipient).
    function claimDigest(bytes32 id, address recipient) public view returns (bytes32) {
        return _digest("claimdesk.claim", id, recipient);
    }

    /// @notice What the claim key signs to register `recipient` as the account to be paid.
    function registerDigest(bytes32 id, address recipient) public view returns (bytes32) {
        return _digest("claimdesk.register", id, recipient);
    }

    // ------------------------------------------------------------------ internals

    function _known(bytes32 id) private view returns (Award storage a) {
        a = awards[id];
        if (a.status == Status.None) revert UnknownAward();
    }

    /// @dev Known, unsettled and not expired.
    function _live(bytes32 id) private view returns (Award storage a) {
        a = _known(id);
        if (a.status != Status.Funded && a.status != Status.Cleared) revert AlreadySettled();
        if (block.timestamp >= a.expiresAt) revert Expired();
    }

    function _pay(bytes32 id, Award storage a, address to) private {
        a.status = Status.Claimed;
        ITIP20(a.token).transferWithMemo(to, a.amount, id);
        emit Claimed(id, to, a.amount, id);
    }

    function _digest(string memory tag, bytes32 id, address recipient) private view returns (bytes32) {
        bytes32 inner = keccak256(abi.encode(keccak256(bytes(tag)), address(this), block.chainid, id, recipient));
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
