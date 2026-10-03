// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev The two TIP-20 calls the escrow needs (Tempo's stablecoin token standard).
interface ITIP20 {
    function transferWithMemo(address to, uint256 amount, bytes32 memo) external;
    function transferFromWithMemo(address from, address to, uint256 amount, bytes32 memo) external returns (bool);
}

/// @title ClaimEscrow — pay prize winners by link, only after their paperwork is cleared for the account that gets paid.
/// @notice Lifecycle of one award (id = its 32-byte reference, also the TIP-20 memo on every transfer):
///   Funded ──register(link key)──► Registered ──clear(expected = that account)──► Claimed   (path A, paid in the clear tx)
///   Funded ──clear(expected = 0)──► Cleared ──claim(link key)──► Claimed                    (path B, bearer)
///   Funded|Registered ──revoke──► Revoked (money back now)      Funded|Registered|Cleared ──expiry──► reclaim
///   Registration is write-once for the link; only the registered account itself can move it (changeRecipient);
///   the organizer can reissue the link (new key, registration wiped) only before clearance.
contract ClaimEscrow {
    enum Status { None, Funded, Registered, Cleared, Claimed, Expired, Reclaimed, Revoked }

    struct Award {
        address token;   // slot 0
        uint96 amount;   // slot 0
        address party;   // slot 1 — the link's claim key while Funded/Cleared; the registered account once Registered
        uint64 expiresAt; // slot 1
        Status status;   // slot 1
    }

    /// @notice Shortest life an award can be funded with — a visible floor on how fast an organizer can take it back.
    uint64 public immutable minTtl;
    /// @notice Where tax withheld at source goes, and the most that can ever be withheld — both fixed at deploy,
    ///         so withholding cannot become a disguised redirect.
    address public immutable taxAccount;
    uint16 public immutable maxWithholdingBps;
    uint64 public constant MAX_TTL = 366 days;
    /// @dev Tempo's TIP-20 tokens live at precompile addresses starting 0x20c0 — no look-alike token contracts.
    bytes2 private constant TIP20_PREFIX = 0x20c0;

    address public organizer;
    address public pendingOrganizer;
    mapping(bytes32 => Award) private awards;

    event Funded(bytes32 indexed id, address indexed token, uint256 amount, uint64 expiresAt, address claimSigner);
    event Registered(bytes32 indexed id, address indexed recipient);
    event RecipientChanged(bytes32 indexed id, address indexed previous, address indexed next);
    event LinkReissued(bytes32 indexed id, address claimSigner);
    event Cleared(bytes32 indexed id, bytes32 paperworkHash, address recipient, uint256 withheld, address taxAccount);
    event Claimed(bytes32 indexed id, address indexed recipient, uint256 amount, bytes32 memo);
    event Revoked(bytes32 indexed id, uint256 amount);
    event Reclaimed(bytes32 indexed id, uint256 amount, bytes32 memo);
    event OrganizerProposed(address indexed next);
    event OrganizerChanged(address indexed previous, address indexed next);

    error NotOrganizer();
    error NotRecipient();
    error UnknownAward();
    error WrongState();
    error Expired();
    error NotExpired();
    error BadClaimSignature();
    error RecipientMismatch();
    error InvalidAward();
    error InvalidWithholding();
    error TransferFailed();

    modifier onlyOrganizer() {
        if (msg.sender != organizer) revert NotOrganizer();
        _;
    }

    constructor(address organizer_, uint64 minTtl_, address taxAccount_, uint16 maxWithholdingBps_) {
        if (maxWithholdingBps_ > 5_000 || (maxWithholdingBps_ > 0 && taxAccount_ == address(0))) revert InvalidWithholding();
        organizer = organizer_ == address(0) ? msg.sender : organizer_;
        minTtl = minTtl_;
        taxAccount = taxAccount_;
        maxWithholdingBps = maxWithholdingBps_;
        emit OrganizerChanged(address(0), organizer);
    }

    // ------------------------------------------------------------------ organizer

    /// @notice Lock `amount` of `token` for one award, pulled from the organizer with the award id as memo.
    function fund(bytes32 id, address token, uint96 amount, uint64 expiresAt, address claimSigner) external onlyOrganizer {
        if (awards[id].status != Status.None) revert WrongState();
        if (
            id == bytes32(0) || bytes2(bytes20(token)) != TIP20_PREFIX || amount == 0 || claimSigner == address(0)
                || expiresAt < block.timestamp + minTtl || expiresAt > block.timestamp + MAX_TTL
        ) revert InvalidAward();
        awards[id] = Award(token, amount, claimSigner, expiresAt, Status.Funded);
        if (!ITIP20(token).transferFromWithMemo(msg.sender, address(this), amount, id)) revert TransferFailed();
        emit Funded(id, token, amount, expiresAt, claimSigner);
    }

    /// @notice The paperwork (tax form, identity check, acceptance) is complete for `expectedRecipient`.
    /// @param paperworkHash hash of the organizer's paperwork record — the record stays off-chain.
    /// @param expectedRecipient the account the paperwork was checked against: the registered account (paid now),
    ///                          or zero when nobody registered (opens a bearer claim). Anything else reverts.
    /// @param withheld tax withheld at source (≤ maxWithholdingBps of the award), sent to the fixed `taxAccount` now
    ///                 with the award memo (0 for none).
    function clear(bytes32 id, bytes32 paperworkHash, address expectedRecipient, uint96 withheld) external onlyOrganizer {
        Award storage a = _live(id);
        bool registered = a.status == Status.Registered;
        if (!registered && a.status != Status.Funded) revert WrongState();
        if (expectedRecipient != (registered ? a.party : address(0))) revert RecipientMismatch();
        if (uint256(withheld) * 10_000 > uint256(a.amount) * maxWithholdingBps) revert InvalidWithholding();
        emit Cleared(id, paperworkHash, expectedRecipient, withheld, taxAccount);
        if (withheld > 0) {
            a.amount -= withheld;
            ITIP20(a.token).transferWithMemo(taxAccount, withheld, id);
        }
        if (registered) _pay(id, a, a.party);
        else a.status = Status.Cleared;
    }

    /// @notice Before clearance: issue a new link key and wipe any registration (a leaked or forwarded link).
    function reissueLink(bytes32 id, address newSigner) external onlyOrganizer {
        Award storage a = _live(id);
        if (a.status != Status.Funded && a.status != Status.Registered) revert WrongState();
        if (newSigner == address(0)) revert InvalidAward();
        a.party = newSigner;
        a.status = Status.Funded;
        emit LinkReissued(id, newSigner);
    }

    /// @notice Before clearance (e.g. failed due diligence): cancel and return the money now.
    function revoke(bytes32 id) external onlyOrganizer {
        Award storage a = _known(id);
        if (a.status != Status.Funded && a.status != Status.Registered) revert WrongState();
        a.status = Status.Revoked;
        ITIP20(a.token).transferWithMemo(organizer, a.amount, id);
        emit Revoked(id, a.amount);
    }

    /// @notice After expiry, return an unsettled award to the organizer (with its memo).
    function reclaim(bytes32 id) external onlyOrganizer {
        Award storage a = _known(id);
        if (!_unsettled(a.status)) revert WrongState();
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

    /// @notice Path A: the link holder names the account to be paid. Write-once — afterwards the link has no power.
    function register(bytes32 id, address recipient, bytes calldata signature) external {
        Award storage a = _live(id);
        if (a.status != Status.Funded) revert WrongState();
        if (recipient == address(0) || _recover(registerDigest(id, recipient), signature) != a.party) revert BadClaimSignature();
        a.party = recipient; // the link key is retired in the same slot
        a.status = Status.Registered;
        emit Registered(id, recipient);
    }

    /// @notice The registered account moves the payout to another account it controls (before clearance).
    function changeRecipient(bytes32 id, address next) external {
        Award storage a = _live(id);
        if (a.status != Status.Registered) revert WrongState();
        if (msg.sender != a.party) revert NotRecipient();
        if (next == address(0)) revert InvalidAward();
        emit RecipientChanged(id, a.party, next);
        a.party = next;
    }

    /// @notice Path B: pay a cleared award that had no registered account to the recipient the link's key signed for.
    function claim(bytes32 id, address recipient, bytes calldata signature) external {
        Award storage a = _live(id);
        if (a.status != Status.Cleared) revert WrongState();
        if (recipient == address(0) || _recover(claimDigest(id, recipient), signature) != a.party) revert BadClaimSignature();
        _pay(id, a, recipient);
    }

    // ------------------------------------------------------------------ views

    /// @notice Effective status: unsettled awards past expiry read as Expired.
    function statusOf(bytes32 id) external view returns (Status) {
        Award storage a = awards[id];
        if (_unsettled(a.status) && block.timestamp >= a.expiresAt) return Status.Expired;
        return a.status;
    }

    function awardOf(bytes32 id) external view returns (Award memory) {
        return awards[id];
    }

    function claimDigest(bytes32 id, address recipient) public view returns (bytes32) {
        return _digest("claimdesk.claim", id, recipient);
    }

    function registerDigest(bytes32 id, address recipient) public view returns (bytes32) {
        return _digest("claimdesk.register", id, recipient);
    }

    // ------------------------------------------------------------------ internals

    function _unsettled(Status s) private pure returns (bool) {
        return s == Status.Funded || s == Status.Registered || s == Status.Cleared;
    }

    function _known(bytes32 id) private view returns (Award storage a) {
        a = awards[id];
        if (a.status == Status.None) revert UnknownAward();
    }

    /// @dev Known, unsettled and not expired.
    function _live(bytes32 id) private view returns (Award storage a) {
        a = _known(id);
        if (!_unsettled(a.status)) revert WrongState();
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
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0); // malleable
        return ecrecover(digest, v, r, s);
    }
}
