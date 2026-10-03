// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClaimEscrow} from "../ClaimEscrow.sol";
import {MockTIP20} from "./MockTIP20.sol";

/// Random sequences of fund / register / clear / claim / revoke / reissue / reclaim / warp across many awards.
contract Handler is Test {
    ClaimEscrow public escrow;
    MockTIP20 public token;
    address public organizer;
    address public constant TAX = address(0x1E5);
    uint256 constant LINK_PK = 0xC1A1;
    bytes32[] public ids;
    mapping(bytes32 => uint256) public linkPk;
    address[3] public people = [address(0xB0B), address(0xF0F0), address(0xC01D)];

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
        vm.prank(organizer);
        escrow.fund(id, address(token), amount, uint64(block.timestamp + escrow.minTtl() + (ttlExtra % 30 days)), vm.addr(pk));
    }

    function register(uint256 seed, uint8 who) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        address to = people[who % 3];
        try escrow.register(id, to, _sig(linkPk[id], escrow.registerDigest(id, to))) {} catch {}
    }

    function clear(uint256 seed, uint16 bps, bool useRegistered) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        ClaimEscrow.Award memory a = escrow.awardOf(id);
        address expected = useRegistered && a.status == ClaimEscrow.Status.Registered ? a.party : address(0);
        uint96 withheld = uint96((uint256(a.amount) * bound(bps, 0, escrow.maxWithholdingBps())) / 10_000);
        vm.prank(organizer);
        try escrow.clear(id, keccak256("paperwork"), expected, withheld) {} catch {}
    }

    function claim(uint256 seed, uint8 who) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        address to = people[who % 3];
        try escrow.claim(id, to, _sig(linkPk[id], escrow.claimDigest(id, to))) {} catch {}
    }

    function revoke(uint256 seed) external {
        if (ids.length == 0) return;
        vm.prank(organizer);
        try escrow.revoke(_pick(seed)) {} catch {}
    }

    function reissue(uint256 seed) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        uint256 pk = linkPk[id] + 1_000;
        vm.prank(organizer);
        try escrow.reissueLink(id, vm.addr(pk)) {
            linkPk[id] = pk;
        } catch {}
    }

    function reclaim(uint256 seed) external {
        if (ids.length == 0) return;
        vm.prank(organizer);
        try escrow.reclaim(_pick(seed)) {} catch {}
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
        escrow = new ClaimEscrow(organizer, 7 days, address(0x1E5), 3_000);
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

    /// No money is created or lost: organizer + winners + tax account + escrow = what the organizer started with.
    function invariant_conservation() public view {
        uint256 sum = token.balanceOf(organizer) + token.balanceOf(address(escrow)) + token.balanceOf(address(0x1E5));
        for (uint256 i = 0; i < 3; i++) sum += token.balanceOf(handler.people(i));
        assertEq(sum, SUPPLY);
    }
}
