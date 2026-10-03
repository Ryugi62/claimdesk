// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClaimEscrow} from "../ClaimEscrow.sol";
import {MockTIP20} from "./MockTIP20.sol";

contract ClaimEscrowTest is Test {
    ClaimEscrow escrow;
    MockTIP20 token;
    address organizer = address(0xA11CE);
    uint256 claimPk = 0xC1A1;
    address claimSigner;
    address winner = address(0xB0B);
    bytes32 constant ID = keccak256("WF-2026-TEMPO-03");
    bytes32 constant MEMO = bytes32("WF-2026-TEMPO-03");
    uint96 constant AMOUNT = 10_000e6;

    event Claimed(bytes32 indexed id, address indexed recipient, uint256 amount, bytes32 memo);

    function setUp() public {
        token = new MockTIP20();
        vm.prank(organizer);
        escrow = new ClaimEscrow();
        claimSigner = vm.addr(claimPk);
        token.mint(organizer, 100_000e6);
        vm.prank(organizer);
        token.approve(address(escrow), type(uint256).max);
    }

    function _fund(uint64 ttl) internal {
        vm.prank(organizer);
        escrow.fund(ID, address(token), AMOUNT, uint64(block.timestamp) + ttl, claimSigner, MEMO);
    }

    function _sig(address recipient) internal view returns (bytes memory) {
        bytes32 digest = escrow.claimDigest(ID, recipient);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(claimPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_fund_pullsTokensIntoEscrow() public {
        _fund(1 days);
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
        assertEq(uint8(escrow.statusOf(ID)), uint8(ClaimEscrow.Status.Funded));
    }

    // AC-3
    function test_claim_beforeClearance_reverts() public {
        _fund(1 days);
        bytes memory sig = _sig(winner);
        vm.expectRevert(ClaimEscrow.NotCleared.selector);
        escrow.claim(ID, winner, sig);
    }

    // AC-4
    function test_claim_afterClearance_paysWithMemo() public {
        _fund(1 days);
        vm.prank(organizer);
        escrow.clear(ID, keccak256("w8ben+kyc"));
        bytes memory sig = _sig(winner);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit Claimed(ID, winner, AMOUNT, MEMO);
        escrow.claim(ID, winner, sig);
        assertEq(token.balanceOf(winner), AMOUNT);
        assertEq(uint8(escrow.statusOf(ID)), uint8(ClaimEscrow.Status.Claimed));
    }

    // AC-5
    function test_claim_twice_reverts() public {
        _fund(1 days);
        vm.prank(organizer);
        escrow.clear(ID, keccak256("w8ben"));
        bytes memory sig = _sig(winner);
        escrow.claim(ID, winner, sig);
        vm.expectRevert(ClaimEscrow.AlreadySettled.selector);
        escrow.claim(ID, winner, sig);
    }

    // AC-6
    function test_claim_redirectedRecipient_reverts() public {
        _fund(1 days);
        vm.prank(organizer);
        escrow.clear(ID, keccak256("w8ben"));
        bytes memory sig = _sig(winner);
        vm.expectRevert(ClaimEscrow.BadClaimSignature.selector);
        escrow.claim(ID, address(0xBAD), sig);
    }

    // AC-7
    function test_expired_claimReverts_organizerReclaims() public {
        _fund(1 hours);
        vm.prank(organizer);
        escrow.clear(ID, keccak256("w8ben"));
        vm.warp(block.timestamp + 2 hours);
        assertEq(uint8(escrow.statusOf(ID)), uint8(ClaimEscrow.Status.Expired));
        bytes memory sig = _sig(winner);
        vm.expectRevert(ClaimEscrow.Expired.selector);
        escrow.claim(ID, winner, sig);
        uint256 before = token.balanceOf(organizer);
        vm.prank(organizer);
        escrow.reclaim(ID);
        assertEq(token.balanceOf(organizer), before + AMOUNT);
        assertEq(uint8(escrow.statusOf(ID)), uint8(ClaimEscrow.Status.Reclaimed));
    }

    function test_reclaim_beforeExpiry_reverts() public {
        _fund(1 days);
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.NotExpired.selector);
        escrow.reclaim(ID);
    }

    function test_onlyOrganizer_canFundClearReclaim() public {
        vm.expectRevert(ClaimEscrow.NotOrganizer.selector);
        escrow.fund(ID, address(token), AMOUNT, uint64(block.timestamp + 1 days), claimSigner, MEMO);
        _fund(1 days);
        vm.expectRevert(ClaimEscrow.NotOrganizer.selector);
        escrow.clear(ID, bytes32(0));
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(ClaimEscrow.NotOrganizer.selector);
        escrow.reclaim(ID);
    }

    function test_fund_sameIdTwice_reverts() public {
        _fund(1 days);
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.AlreadyExists.selector);
        escrow.fund(ID, address(token), AMOUNT, uint64(block.timestamp + 1 days), claimSigner, MEMO);
    }

    function test_claim_unknownAward_reverts() public {
        vm.expectRevert(ClaimEscrow.UnknownAward.selector);
        escrow.claim(keccak256("nope"), winner, hex"00");
    }

    function test_clear_afterExpiry_reverts() public {
        _fund(1 hours);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(organizer);
        vm.expectRevert(ClaimEscrow.Expired.selector);
        escrow.clear(ID, bytes32(0));
    }
}
