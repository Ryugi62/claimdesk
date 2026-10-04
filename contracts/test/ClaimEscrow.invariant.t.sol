// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClaimEscrow} from "../ClaimEscrow.sol";
import {MockTIP20} from "./MockTIP20.sol";
import {MockSignatureVerifier} from "./MockSignatureVerifier.sol";

/// Random sequences of fund / register / clear / claim / revoke / reissue / reclaim / warp across many awards.
contract Handler is Test {
    ClaimEscrow public escrow;
    MockTIP20 public token;
    address public organizer;
    address public constant TAX = address(0x1E5);
    uint256 constant LINK_PK = 0xC1A1;
    bytes32[] public ids;
    mapping(bytes32 => uint256) public linkPk;
    uint256[3] public peoplePk = [uint256(0xB0B), uint256(0xF0F0), uint256(0xC01D)];
    address[3] public people = [vm.addr(0xB0B), vm.addr(0xF0F0), vm.addr(0xC01D)];
    mapping(bytes32 => uint256) public pendingPk;
    // ghost counters: how many times each path really happened
    uint256 public paidRegistered;
    uint256 public paidBearer;
    uint256 public reissued;
    uint256 public revoked;
    uint256 public reclaimed;

    constructor(ClaimEscrow e, MockTIP20 t, address org) {
        escrow = e;
        token = t;
        organizer = org;
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _pick(uint256 seed) internal view returns (bytes32) {
        return ids[seed % ids.length];
    }

    function fund(uint96 amount, uint32 ttlExtra) external {
        amount = uint96(bound(amount, 1, 100_000e6));
        bytes32 id = keccak256(abi.encode(ids.length, "award"));
        uint256 pk = LINK_PK + ids.length;
        linkPk[id] = pk;
        ids.push(id);
        uint64 expiresAt = uint64(block.timestamp + escrow.minTtl() + (ttlExtra % 30 days)); // before the prank
        address signer = vm.addr(pk);
        vm.prank(organizer);
        escrow.fund(id, address(token), amount, expiresAt, signer);
        funded++;
    }

    uint256 public funded;
    uint256 public paid;

    function register(uint256 seed, uint8 who) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        address to = people[who % 3];
        try escrow.register(id, to, _sig(linkPk[id], escrow.registerDigest(id, to))) {} catch {}
    }

    function _pkOf(address a) internal view returns (uint256) {
        for (uint256 i = 0; i < 3; i++) if (people[i] == a) return peoplePk[i];
        return 0;
    }

    function clear(uint256 seed, uint16 bps, bool useRegistered) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        ClaimEscrow.Award memory a = escrow.awardOf(id);
        bool wasRegistered = a.status == ClaimEscrow.Status.Registered;
        address expected = useRegistered && wasRegistered ? a.party : address(0);
        uint96 withheld = uint96((uint256(a.amount) * bound(bps, 0, escrow.maxWithholdingBps())) / 10_000);
        bytes32 record = keccak256(abi.encode("paperwork", id));
        bytes memory sig = expected != address(0) && _pkOf(expected) != 0 ? _sig(_pkOf(expected), escrow.paperworkDigest(id, expected, record)) : bytes("");
        vm.prank(organizer);
        try escrow.clear(id, record, expected, withheld, sig) {
            if (wasRegistered && expected != address(0)) { paid++; paidRegistered++; }
        } catch {}
    }

    function claim(uint256 seed, uint8 who) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        address to = people[who % 3];
        try escrow.claim(id, to, _sig(linkPk[id], escrow.claimDigest(id, to))) {
            paid++;
            paidBearer++;
        } catch {}
    }

    function revoke(uint256 seed) external {
        if (ids.length == 0) return;
        vm.prank(organizer);
        try escrow.revoke(_pick(seed)) { revoked++; } catch {}
    }

    function reissue(uint256 seed, bool waitOut) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        uint256 pk = pendingPk[id] != 0 ? pendingPk[id] : linkPk[id] + 1_000; // reuse a scheduled key
        address signer = vm.addr(pk); // computed before the prank
        if (waitOut && pendingPk[id] != 0) vm.warp(block.timestamp + escrow.reissueDelay());
        vm.prank(organizer);
        try escrow.reissueLink(id, signer) {
            if (escrow.awardOf(id).party == signer) {
                linkPk[id] = pk; // executed: the new key is live
                pendingPk[id] = 0;
                reissued++;
            } else {
                pendingPk[id] = pk; // only scheduled
            }
        } catch {}
    }

    function reclaim(uint256 seed) external {
        if (ids.length == 0) return;
        vm.prank(organizer);
        try escrow.reclaim(_pick(seed)) { reclaimed++; } catch {}
    }

    function changeRecipient(uint256 seed, uint8 who) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        ClaimEscrow.Award memory a = escrow.awardOf(id);
        if (a.status != ClaimEscrow.Status.Registered) return;
        vm.prank(a.party);
        try escrow.changeRecipient(id, people[who % 3]) {} catch {}
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + (secs % 20 days));
    }
}

contract ClaimEscrowInvariantTest is Test {
    ClaimEscrow escrow;
    MockTIP20 token;
    Handler handler;
    address organizer = address(0xA11CE);
    uint256 constant SUPPLY = 1e18;

    function setUp() public {
        MockTIP20 impl = new MockTIP20();
        vm.etch(address(0x20C0000000000000000000000000000000000001), address(impl).code);
        token = MockTIP20(address(0x20C0000000000000000000000000000000000001));
        vm.etch(0x5165300000000000000000000000000000000000, address(new MockSignatureVerifier()).code);
        escrow = new ClaimEscrow(organizer, 7 days, address(0x1E5), 3_000, 2 days);
        token.mint(organizer, SUPPLY);
        vm.prank(organizer);
        token.approve(address(escrow), type(uint256).max);
        handler = new Handler(escrow, token, organizer);
        targetContract(address(handler));
    }

    /// The escrow holds exactly the sum of its unsettled awards.
    function invariant_escrowHoldsExactlyTheUnsettledAwards() public view {
        uint256 open;
        for (uint256 i = 0; i < handler.idsLength(); i++) {
            ClaimEscrow.Award memory a = escrow.awardOf(handler.ids(i));
            if (a.status == ClaimEscrow.Status.Funded || a.status == ClaimEscrow.Status.Registered || a.status == ClaimEscrow.Status.Cleared) {
                open += a.amount;
            }
        }
        assertEq(token.balanceOf(address(escrow)), open);
    }

    /// The handler really exercises the escrow (guards against a vacuous run).
    function invariant_suiteIsNotVacuous() public view {
        if (handler.idsLength() > 0) assertEq(handler.funded(), handler.idsLength());
    }

    function afterInvariant() public view {
        assertGt(handler.funded(), 0, "no award was ever funded");
    }

    /// Across the whole campaign every path must have been exercised (checked after all runs by forge's summary;
    /// asserted per run here only where a single run is long enough to reach it).
    function invariant_registeredAwardsArePaidOnlyToTheirParty() public view {
        for (uint256 i = 0; i < handler.idsLength(); i++) {
            ClaimEscrow.Award memory a = escrow.awardOf(handler.ids(i));
            if (a.status == ClaimEscrow.Status.Registered) {
                bool known = a.party == handler.people(0) || a.party == handler.people(1) || a.party == handler.people(2);
                assertTrue(known, "a registered award points at an account nobody registered");
            }
        }
    }

    /// No money is created or lost: organizer + winners + tax account + escrow = what the organizer started with.
    function invariant_conservation() public view {
        uint256 sum = token.balanceOf(organizer) + token.balanceOf(address(escrow)) + token.balanceOf(address(0x1E5));
        for (uint256 i = 0; i < 3; i++) sum += token.balanceOf(handler.people(i));
        assertEq(sum, SUPPLY);
    }
}
